#!/usr/bin/env node
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";

const appId = "com.quillianne.bakingrl";
const runtimeApiVersion = "0.4.0";
const sdkVersion = "0.4.0";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Unable to read valid JSON at ${path}: ${error.message}`);
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function appDataDir() {
  if (process.env.BAKINGRL_PACKAGES_DIR) return resolve(process.env.BAKINGRL_PACKAGES_DIR);
  switch (platform()) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", appId, "packages");
    case "win32":
      return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), appId, "packages");
    default:
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), appId, "packages");
  }
}

function isInsideDirectory(parentDir, childPath) {
  const childRelative = relative(parentDir, childPath);
  return childRelative !== ".." && !childRelative.startsWith(`..${sep}`) && !childRelative.startsWith("/");
}

function validatePackageId(value) {
  if (value === "." || value === ".." || value.startsWith(".") || value.endsWith(".")) {
    fail("manifest.id must not contain empty or dot-only path segments");
  }
  if (value.split(".").some((segment) => segment.length === 0)) {
    fail("manifest.id must not contain empty dot-separated segments");
  }
  if (value.startsWith("plugin.")) {
    fail("manifest.id must not include the reserved 'plugin.' runtime prefix");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    fail("manifest.id contains unsupported characters");
  }
}

function readPackageManifest(packageDir) {
  const manifestPath = join(packageDir, "bakingrl.plugin.json");
  if (!existsSync(manifestPath)) fail(`Missing bakingrl.plugin.json in ${packageDir}`);
  const manifest = readJson(manifestPath);
  if (manifest.schema !== "bakingrl.plugin/2") fail("manifest.schema must be bakingrl.plugin/2");
  for (const field of ["id", "name", "version"]) {
    if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
      fail(`manifest.${field} must be a non-empty string`);
    }
  }
  validatePackageId(manifest.id);
  return manifest;
}

function parseSemver(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null;
  }
  return parts;
}

function validateRuntimeCompatibility(manifest) {
  const runtimeApi = manifest.compatibility?.runtimeApi;
  const parsed = parseSemver(runtimeApi);
  if (!parsed) {
    fail("manifest.compatibility.runtimeApi must declare a semver version like 0.4.0");
  }
  if (parsed[0] !== 0 || parsed[1] !== 4) {
    fail(`manifest.compatibility.runtimeApi ${runtimeApi} is not compatible with helper runtime API ${runtimeApiVersion}`);
  }
  const sdk = manifest.compatibility?.sdk;
  if (sdk !== undefined && !parseSemver(sdk)) {
    fail("manifest.compatibility.sdk must be a semver version like 0.4.0");
  }
}

function validateBuiltEntry(packageDir, groupName, name, exportDef) {
  if (typeof exportDef.entry !== "string" || !exportDef.entry.endsWith(".js")) {
    fail(`${groupName}.${name}.entry must point to a built .js file`);
  }
  const entryPath = resolve(packageDir, exportDef.entry);
  if (!isInsideDirectory(packageDir, entryPath)) {
    fail(`${groupName}.${name}.entry must stay inside the package`);
  }
  if (!existsSync(entryPath)) {
    fail(`Built entry does not exist: ${exportDef.entry}`);
  }
  if (statSync(entryPath).size === 0) {
    fail(`Built entry is empty: ${exportDef.entry}`);
  }
}

function validatePackageSettingsSchema(packageDir, settingsPath) {
  if (settingsPath === undefined) return;
  if (typeof settingsPath !== "string" || settingsPath.trim() === "") {
    fail("manifest.settings must point to a package settings JSON Schema file");
  }
  const schemaPath = resolve(packageDir, settingsPath);
  if (!isInsideDirectory(packageDir, schemaPath)) {
    fail("manifest.settings must stay inside the package");
  }
  if (!existsSync(schemaPath)) {
    fail(`Package settings schema does not exist: ${settingsPath}`);
  }
  const schema = readJson(schemaPath);
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    fail("manifest.settings must point to a JSON Schema object");
  }
  if (schema.type !== undefined && schema.type !== "object") {
    fail("package settings schema type must be \"object\"");
  }
  if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
    fail("package settings schema must declare properties");
  }
  for (const [key, property] of Object.entries(schema.properties)) {
    validateSettingsProperty(`settings.${key}`, property);
  }
}

function validateSettingsProperty(label, property) {
  if (!property || typeof property !== "object" || Array.isArray(property)) {
    fail(`${label} must be a JSON Schema property object`);
  }
  const type = Array.isArray(property.type) ? property.type.filter((entry) => entry !== "null")[0] : property.type;
  const inferredType = type ?? inferSettingsPropertyType(property);
  const supported = new Set(["string", "number", "integer", "boolean", "array"]);
  if (!supported.has(inferredType)) {
    fail(`${label}.type must be string, number, integer, boolean, or an enum-backed array`);
  }
  if (property["x-bakingrl-secret"] === true) {
    if (inferredType !== "string") {
      fail(`${label} is a secret and must use type "string"`);
    }
    if (Object.prototype.hasOwnProperty.call(property, "default")) {
      fail(`${label} is a secret and must not declare a default value`);
    }
  }
  if (inferredType === "array") {
    const itemType = property.items ? inferSettingsPropertyType(property.items) : null;
    const itemOptions = property.items?.enum ?? property.items?.oneOf ?? property.items?.anyOf;
    if (!itemType || !itemOptions) {
      fail(`${label} arrays must declare primitive options on items`);
    }
  }
}

function inferSettingsPropertyType(property) {
  if (Array.isArray(property.enum) && property.enum.length) {
    const firstType = typeof property.enum[0];
    if (property.enum.every((entry) => typeof entry === firstType) && ["string", "number", "boolean"].includes(firstType)) {
      return firstType === "number" ? "number" : firstType;
    }
  }
  if (property.items) return "array";
  return property.type ?? "string";
}

function validatePackage(packageDir) {
  const manifest = readPackageManifest(packageDir);
  validateRuntimeCompatibility(manifest);
  validatePackageSettingsSchema(packageDir, manifest.settings);
  if (!manifest.exports || typeof manifest.exports !== "object") {
    fail("manifest.exports is required");
  }
  if (manifest.exports.overlays) {
    fail("manifest.exports.overlays has been renamed to manifest.exports.layouts");
  }
  const entryGroups = [
    ["visuals", manifest.exports.visuals ?? {}],
    ["components", manifest.exports.components ?? {}],
    ["services", manifest.exports.services ?? {}],
    ["connectors", manifest.exports.connectors ?? {}]
  ];
  let exportCount = 0;
  for (const [groupName, group] of entryGroups) {
    for (const [name, exportDef] of Object.entries(group)) {
      exportCount += 1;
      validateBuiltEntry(packageDir, groupName, name, exportDef);
    }
  }
  for (const [groupName, label, group] of [
    ["pages", "Page", manifest.exports.pages ?? {}],
    ["layouts", "Layout", manifest.exports.layouts ?? {}]
  ]) {
    for (const [name, exportDef] of Object.entries(group)) {
      exportCount += 1;
      if (typeof exportDef.path !== "string" || exportDef.path.trim() === "") {
        fail(`${groupName}.${name}.path must point to a ${label.toLowerCase()} template JSON file`);
      }
      const templatePath = resolve(packageDir, exportDef.path);
      if (!isInsideDirectory(packageDir, templatePath)) {
        fail(`${groupName}.${name}.path must stay inside the package`);
      }
      if (!existsSync(templatePath)) {
        fail(`${label} template does not exist: ${exportDef.path}`);
      }
    }
  }
  if (manifest.exports.configuration) {
    exportCount += 1;
    const configuration = manifest.exports.configuration;
    if (typeof configuration.path !== "string" || configuration.path.trim() === "") {
      fail("configuration.path must point to a configuration page JSON file");
    }
    const pagePath = resolve(packageDir, configuration.path);
    if (!isInsideDirectory(packageDir, pagePath)) {
      fail("configuration.path must stay inside the package");
    }
    if (!existsSync(pagePath)) {
      fail(`Configuration page does not exist: ${configuration.path}`);
    }
    const visuals = configuration.visuals ?? {};
    for (const [name, exportDef] of Object.entries(visuals)) {
      validateBuiltEntry(packageDir, "configuration.visuals", name, exportDef);
    }
  }
  if (exportCount === 0) fail("Package must export at least one capability");
  console.log(`Package validation passed: ${manifest.id}`);
  return manifest;
}

function parseOptions(args) {
  const options = { positional: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      options.positional.push(arg);
      continue;
    }
    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf("=");
    const rawKey = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : raw.slice(equalsIndex + 1);
    const key = rawKey.replaceAll("-", "_");
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
    } else if (args[index + 1] && !args[index + 1].startsWith("--")) {
      options[key] = args[index + 1];
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function requireOption(options, key, label) {
  const value = options[key];
  if (typeof value !== "string" || value.trim() === "") fail(`Missing ${label}.`);
  return value.trim();
}

function optionalUrl(value, label, repoParts = null) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") fail(`${label} must be a URL string.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} must be a valid URL.`);
  }
  if (parsed.protocol !== "https:") fail(`${label} must use HTTPS.`);
  if (repoParts && !isGitHubAssetUrlForRepo(parsed, repoParts)) {
    fail(`${label} must point to the declared GitHub repository or one of its release assets.`);
  }
  return value;
}

function githubRepoParts(repoUrl) {
  let parsed;
  try {
    parsed = new URL(repoUrl);
  } catch {
    fail("marketplace/listing.json repo must be a valid HTTPS GitHub URL.");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    fail("marketplace/listing.json repo must use https://github.com/<owner>/<repo>.");
  }
  const [owner, repo, ...rest] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !repo || rest.length > 0) {
    fail("marketplace/listing.json repo must use https://github.com/<owner>/<repo>.");
  }
  return { owner, repo: repo.replace(/\.git$/, "") };
}

function isGitHubAssetUrlForRepo(parsed, repoParts) {
  const path = parsed.pathname.split("/").filter(Boolean);
  if (parsed.hostname === "github.com") {
    const [owner, repo, segment, action] = path;
    return owner === repoParts.owner
      && repo?.replace(/\.git$/, "") === repoParts.repo
      && ((segment === "releases" && action === "download") || segment === "raw");
  }
  if (parsed.hostname === "raw.githubusercontent.com") {
    const [owner, repo] = path;
    return owner === repoParts.owner && repo === repoParts.repo;
  }
  return false;
}

function validateString(value, label, { max = 1000 } = {}) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string.`);
  if (value.length > max) fail(`${label} is too long.`);
  return value;
}

function validateListing(packageDir, { print = true } = {}) {
  const manifest = readPackageManifest(packageDir);
  const listingPath = join(packageDir, "marketplace", "listing.json");
  if (!existsSync(listingPath)) fail(`Missing marketplace/listing.json in ${packageDir}`);
  const listing = readJson(listingPath);
  if (listing.schema !== "bakingrl.plugin-listing/1") {
    fail("marketplace/listing.json schema must be bakingrl.plugin-listing/1");
  }
  if (listing.packageId !== manifest.id) {
    fail(`marketplace/listing.json packageId must match manifest.id (${manifest.id}).`);
  }
  validateString(listing.displayName ?? manifest.name, "marketplace/listing.json displayName", { max: 120 });
  validateString(listing.shortDescription, "marketplace/listing.json shortDescription", { max: 180 });
  validateString(listing.longDescription, "marketplace/listing.json longDescription", { max: 8000 });
  if (!Array.isArray(listing.tags) || listing.tags.some((tag) => typeof tag !== "string" || tag.trim() === "")) {
    fail("marketplace/listing.json tags must be an array of non-empty strings.");
  }
  const repoParts = githubRepoParts(validateString(listing.repo, "marketplace/listing.json repo", { max: 240 }));
  optionalUrl(listing.iconUrl, "marketplace/listing.json iconUrl", repoParts);
  optionalUrl(listing.bannerUrl, "marketplace/listing.json bannerUrl", repoParts);
  if (!Array.isArray(listing.screenshots)) fail("marketplace/listing.json screenshots must be an array.");
  for (const [index, screenshot] of listing.screenshots.entries()) {
    if (!screenshot || typeof screenshot !== "object" || Array.isArray(screenshot)) {
      fail(`marketplace/listing.json screenshots[${index}] must be an object.`);
    }
    optionalUrl(screenshot.url, `marketplace/listing.json screenshots[${index}].url`, repoParts);
    if (screenshot.alt !== undefined) validateString(screenshot.alt, `marketplace/listing.json screenshots[${index}].alt`, { max: 180 });
    if (screenshot.caption !== undefined) validateString(screenshot.caption, `marketplace/listing.json screenshots[${index}].caption`, { max: 240 });
  }
  const links = listing.links ?? {};
  if (!links || typeof links !== "object" || Array.isArray(links)) fail("marketplace/listing.json links must be an object.");
  for (const [key, value] of Object.entries(links)) {
    optionalUrl(value, `marketplace/listing.json links.${key}`);
  }
  if (print) console.log(`Marketplace listing validation passed: ${manifest.id}`);
  return { manifest, listing, repoParts };
}

function effectivePermissions(manifest) {
  const packageScope = `plugin.${manifest.id}.*`;
  const storageScope = "plugin://self/*";
  const permissions = manifest.permissions ?? {};
  const bus = permissions.bus ?? {};
  const registry = permissions.registry ?? {};
  const network = permissions.network ?? {};
  const storageRequested = Array.isArray(permissions.storage) && permissions.storage.includes(storageScope);
  return {
    bus: {
      read: Array.isArray(bus.read) ? bus.read : [],
      publish: Array.isArray(bus.publish) ? bus.publish.filter((pattern) => pattern === packageScope) : []
    },
    registry: {
      read: Array.isArray(registry.read) ? registry.read : [],
      write: Array.isArray(registry.write) ? registry.write.filter((pattern) => pattern === packageScope) : []
    },
    network: {
      http: Array.isArray(network.http) ? network.http : [],
      websocket: Array.isArray(network.websocket) ? network.websocket : []
    },
    storage: {
      read: storageRequested ? [storageScope] : [],
      write: storageRequested ? [storageScope] : []
    }
  };
}

function findBundlePath(packageDir, manifest) {
  const bundlePath = join(packageDir, "dist-bundles", `${manifest.id}-${manifest.version}.brlp`);
  if (!existsSync(bundlePath)) fail(`Missing packed bundle: ${bundlePath}`);
  return bundlePath;
}

function readSignaturePublicKey(packageDir) {
  const signaturePath = join(packageDir, "signature.ed25519");
  if (!existsSync(signaturePath)) fail("Missing signature.ed25519. Run pack --sign before generating marketplace metadata.");
  const signature = readJson(signaturePath);
  if (signature.algorithm !== "ed25519" || typeof signature.publicKey !== "string" || signature.publicKey.trim() === "") {
    fail("signature.ed25519 must contain an Ed25519 publicKey.");
  }
  return signature.publicKey;
}

function writeOrPrintJson(value, outputPath) {
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeJson(outputPath, value);
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
}

function releaseMetadata(packageDir, args) {
  const options = parseOptions(args);
  const manifest = validatePackage(packageDir);
  const { listing } = validateListing(packageDir, { print: false });
  const bundlePath = options.bundle ? resolve(process.cwd(), options.bundle) : findBundlePath(packageDir, manifest);
  if (!existsSync(bundlePath)) fail(`Bundle does not exist: ${bundlePath}`);
  const bundleUrl = requireOption(options, "bundle_url", "--bundle-url");
  const listingUrl = requireOption(options, "listing_url", "--listing-url");
  const metadata = {
    schema: "bakingrl.plugin-release/1",
    packageId: manifest.id,
    version: manifest.version,
    repo: listing.repo,
    listingUrl,
    bundleUrl,
    bundleSha256: sha256File(bundlePath),
    signaturePublicKey: readSignaturePublicKey(packageDir),
    runtimeApi: manifest.compatibility?.runtimeApi ?? null,
    generatedAt: new Date().toISOString()
  };
  writeOrPrintJson(metadata, options.output ? resolve(process.cwd(), options.output) : null);
}

function marketplaceEntry(packageDir, args) {
  const options = parseOptions(args);
  const developerId = requireOption(options, "developer", "--developer");
  const manifest = validatePackage(packageDir);
  const { listing } = validateListing(packageDir, { print: false });
  const bundlePath = options.bundle ? resolve(process.cwd(), options.bundle) : findBundlePath(packageDir, manifest);
  if (!existsSync(bundlePath)) fail(`Bundle does not exist: ${bundlePath}`);
  const bundleUrl = requireOption(options, "bundle_url", "--bundle-url");
  const listingUrl = requireOption(options, "listing_url", "--listing-url");
  const reviewedAt = typeof options.reviewed_at === "string" ? options.reviewed_at : new Date().toISOString();
  const entry = {
    schema: "bakingrl.marketplace-package/1",
    id: manifest.id,
    developerId,
    repo: listing.repo,
    listingUrl,
    approvedVersions: [
      {
        version: manifest.version,
        bundleUrl,
        bundleSha256: sha256File(bundlePath),
        signaturePublicKey: readSignaturePublicKey(packageDir),
        runtimeApi: manifest.compatibility?.runtimeApi ?? null,
        review: {
          status: "approved",
          reviewedAt,
          permissions: effectivePermissions(manifest)
        }
      }
    ]
  };
  writeOrPrintJson(entry, options.output ? resolve(process.cwd(), options.output) : null);
}

function pathForZip(path) {
  return path.split(sep).join("/");
}

function excludedPackageFile(packageDir, maybePath) {
  if (!maybePath) return null;
  const resolved = resolve(process.cwd(), maybePath);
  if (!isInsideDirectory(packageDir, resolved)) return null;
  return pathForZip(relative(packageDir, resolved));
}

function walkFiles(root, dir = root, output = [], excludedFiles = new Set()) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist-bundles") continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walkFiles(root, path, output, excludedFiles);
    } else if (stat.isFile()) {
      const relativePath = pathForZip(relative(root, path));
      if (!excludedFiles.has(relativePath)) output.push(relativePath);
    }
  }
  return output.sort();
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zipDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function zipHeader(size) {
  return Buffer.alloc(size);
}

function assertZip32(value, label) {
  if (value > 0xffffffff) fail(`${label} is too large for .brlp ZIP32 archives.`);
}

function writeZipArchive(packageDir, bundlePath, excludedFiles = new Set()) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;

  for (const file of walkFiles(packageDir, packageDir, [], excludedFiles)) {
    const path = join(packageDir, file);
    const contents = readFileSync(path);
    const compressed = deflateRawSync(contents, { level: 9 });
    const name = Buffer.from(file, "utf8");
    const { time, date } = zipDateTime(statSync(path).mtime);
    const checksum = crc32(contents);

    assertZip32(offset, "ZIP local header offset");
    assertZip32(compressed.length, `Compressed file '${file}'`);
    assertZip32(contents.length, `File '${file}'`);

    const local = zipHeader(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, name, compressed);

    const central = zipHeader(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralDirectory.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralOffset = offset;
  const centralSize = centralDirectory.reduce((total, chunk) => total + chunk.length, 0);
  assertZip32(centralOffset, "ZIP central directory offset");
  assertZip32(centralSize, "ZIP central directory");
  if (centralDirectory.length / 2 > 0xffff) fail(".brlp bundle contains too many files for ZIP32.");

  const end = zipHeader(22);
  const entryCount = centralDirectory.length / 2;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  writeFileSync(bundlePath, Buffer.concat([...chunks, ...centralDirectory, end]));
}

function slugifyName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validateExportName(value) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("Export name must be a non-empty string.");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    fail(`Export name '${value}' can only contain letters, numbers, dashes, and underscores.`);
  }
}

function writeNewFile(path, contents) {
  if (existsSync(path)) fail(`Refusing to overwrite existing file: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function addViteInput(packageDir, inputName, sourcePath) {
  const configPath = join(packageDir, "vite.config.ts");
  if (!existsSync(configPath)) fail(`Missing vite.config.ts in ${packageDir}`);
  const config = readFileSync(configPath, "utf8");
  if (config.includes(`"${inputName}"`) || config.includes(`'${inputName}'`)) {
    fail(`vite.config.ts already contains input '${inputName}'.`);
  }
  const marker = "      input: {\n";
  const start = config.indexOf(marker);
  if (start === -1) {
    fail("Unable to update vite.config.ts: expected the generated input block format.");
  }
  const innerStart = start + marker.length;
  const endMarker = "\n      },\n      output:";
  const end = config.indexOf(endMarker, innerStart);
  if (end === -1) {
    fail("Unable to update vite.config.ts: expected the generated output block format.");
  }
  const inner = config.slice(innerStart, end).trimEnd();
  const needsComma = inner.trim().length > 0 && !inner.trimEnd().endsWith(",");
  const nextInner = `${inner}${needsComma ? "," : ""}\n        "${inputName}": "${sourcePath}"`;
  writeFileSync(configPath, `${config.slice(0, innerStart)}${nextInner}${config.slice(end)}`);
}

function addCapability(packageDir, capability, exportName) {
  const groups = {
    visual: "visuals",
    component: "components",
    service: "services",
    connector: "connectors"
  };
  const group = groups[capability];
  if (!group) fail("Capability must be one of: visual, component, service, connector.");
  validateExportName(exportName);
  const slug = slugifyName(exportName);
  if (!slug) fail("Export name must contain at least one letter or number.");

  const manifestPath = join(packageDir, "bakingrl.plugin.json");
  if (!existsSync(manifestPath)) fail(`Missing bakingrl.plugin.json in ${packageDir}`);
  const manifest = readJson(manifestPath);
  if (manifest.schema !== "bakingrl.plugin/2") fail("manifest.schema must be bakingrl.plugin/2");
  manifest.exports ??= {};
  manifest.exports[group] ??= {};
  if (manifest.exports[group][exportName]) {
    fail(`${capability} export '${exportName}' already exists in bakingrl.plugin.json.`);
  }

  if (capability === "visual") {
    const sourcePath = `src/visuals/${slug}/index.ts`;
    manifest.exports.visuals[exportName] = {
      entry: `dist/visuals/${slug}.js`,
      defaultSize: [320, 120]
    };
    writeNewFile(
      join(packageDir, sourcePath),
      `import { defineVisual, type VisualContext } from "@bakingrl/plugin-sdk";

function render(context: VisualContext) {
  context.root.innerHTML = \`
    <div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:rgba(10,14,18,.82);color:white;border:1px solid rgba(255,255,255,.18);font:700 20px Inter,Arial,sans-serif;opacity:\${context.item.opacity};">
      ${exportName}
    </div>
  \`;
}

export default defineVisual({
  async mount(context: VisualContext) {
    render(context);
  },
  update(context: VisualContext) {
    render(context);
  }
});
`
    );
    addViteInput(packageDir, `visuals/${slug}`, sourcePath);
  } else if (capability === "component") {
    const sourcePath = `src/components/${slug}/index.ts`;
    const propsPath = `src/components/${slug}/props.schema.json`;
    manifest.exports.components[exportName] = {
      entry: `dist/components/${slug}.js`,
      props: propsPath
    };
    writeNewFile(
      join(packageDir, sourcePath),
      `import { defineComponent, type ComponentContext } from "@bakingrl/plugin-sdk";

export default defineComponent({
  async mount(context: ComponentContext, props: Record<string, unknown>) {
    const label = String(props.label ?? "${exportName}");
    context.root.innerHTML = \`
      <span style="display:inline-flex;align-items:center;color:white;font:700 14px Inter,Arial,sans-serif;">
        \${label}
      </span>
    \`;
  }
});
`
    );
    writeNewFile(
      join(packageDir, propsPath),
      `${JSON.stringify(
        {
          type: "object",
          properties: {
            label: { type: "string" }
          },
          additionalProperties: true
        },
        null,
        2
      )}\n`
    );
    addViteInput(packageDir, `components/${slug}`, sourcePath);
  } else if (capability === "service") {
    const sourcePath = `src/services/${slug}/index.ts`;
    const schemaPath = `src/services/${slug}/methods.schema.json`;
    manifest.exports.services[exportName] = {
      entry: `dist/services/${slug}.js`,
      methods: ["ping"],
      schema: schemaPath
    };
    writeNewFile(
      join(packageDir, sourcePath),
      `import { defineService } from "@bakingrl/plugin-sdk";

export default defineService({
  methods: {
    async ping(input: unknown) {
      return { ok: true, input };
    }
  }
});
`
    );
    writeNewFile(
      join(packageDir, schemaPath),
      `${JSON.stringify(
        {
          type: "object",
          methods: {
            ping: {
              input: true,
              output: {
                type: "object",
                properties: {
                  ok: { type: "boolean" }
                }
              }
            }
          }
        },
        null,
        2
      )}\n`
    );
    addViteInput(packageDir, `services/${slug}`, sourcePath);
  } else {
    const sourcePath = `src/connectors/${slug}/index.ts`;
    manifest.exports.connectors[exportName] = {
      entry: `dist/connectors/${slug}.js`
    };
    writeNewFile(
      join(packageDir, sourcePath),
      `import { defineConnector, type ConnectorContext } from "@bakingrl/plugin-sdk";

export default defineConnector({
  async mount(context: ConnectorContext) {
    context.diagnostics.log("${exportName} connector mounted.");
  }
});
`
    );
    addViteInput(packageDir, `connectors/${slug}`, sourcePath);
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Added ${capability} export '${exportName}'.`);
}

function writeHashes(packageDir, excludedFiles = new Set()) {
  const files = {};
  for (const file of walkFiles(packageDir, packageDir, [], excludedFiles)) {
    if (file === "manifest.hashes.json" || file === "signature.ed25519") continue;
    files[file] = sha256File(join(packageDir, file));
  }
  const raw = JSON.stringify({ files }, null, 2);
  writeFileSync(join(packageDir, "manifest.hashes.json"), raw);
  return raw;
}

function publicKeyRawFromSpki(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  const ed25519SpkiHeader = Buffer.from("302a300506032b6570032100", "hex");
  if (der.length !== ed25519SpkiHeader.length + 32 || !der.subarray(0, ed25519SpkiHeader.length).equals(ed25519SpkiHeader)) {
    fail("Generated Ed25519 public key has an unsupported SPKI encoding.");
  }
  return der.subarray(ed25519SpkiHeader.length);
}

function keygen(keyPath) {
  const target = resolve(process.cwd(), keyPath ?? "bakingrl-signing-key.json");
  if (existsSync(target)) fail(`Refusing to overwrite existing key file: ${target}`);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyRaw = publicKeyRawFromSpki(publicKey);
  writeFileSync(
    target,
    `${JSON.stringify(
      {
        algorithm: "ed25519",
        publicKey: publicKeyRaw.toString("base64"),
        privateKeyPem
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
  console.log(`Created signing key ${target}`);
}

function signingKeyFromFile(keyPath) {
  if (!keyPath) fail("Missing signing key path.");
  const key = readJson(resolve(process.cwd(), keyPath));
  if (key.algorithm !== "ed25519") fail("Signing key algorithm must be ed25519.");
  if (typeof key.publicKey !== "string" || typeof key.privateKeyPem !== "string") {
    fail("Signing key must contain publicKey and privateKeyPem.");
  }
  return key;
}

function writeSignature(packageDir, keyPath) {
  const key = signingKeyFromFile(keyPath);
  const excludedKeyFile = excludedPackageFile(packageDir, keyPath);
  const hashesRaw = writeHashes(
    packageDir,
    new Set(excludedKeyFile ? [excludedKeyFile] : [])
  );
  const signature = sign(null, Buffer.from(hashesRaw), key.privateKeyPem);
  writeFileSync(
    join(packageDir, "signature.ed25519"),
    `${JSON.stringify(
      {
        algorithm: "ed25519",
        publicKey: key.publicKey,
        signature: signature.toString("base64"),
        signedFile: "manifest.hashes.json"
      },
      null,
      2
    )}\n`
  );
}

function signPackage(packageDir, keyPath) {
  validatePackage(packageDir);
  writeSignature(packageDir, keyPath);
  console.log(`Signed ${packageDir}`);
}

function pack(packageDir, keyPath) {
  const manifest = validatePackage(packageDir);
  const excludedKeyFile = excludedPackageFile(packageDir, keyPath);
  if (keyPath) {
    writeSignature(packageDir, keyPath);
  } else {
    writeHashes(packageDir);
  }
  const outDir = join(packageDir, "dist-bundles");
  mkdirSync(outDir, { recursive: true });
  const bundlePath = join(outDir, `${manifest.id}-${manifest.version}.brlp`);
  if (existsSync(bundlePath)) rmSync(bundlePath, { force: true });
  writeZipArchive(packageDir, bundlePath, new Set(excludedKeyFile ? [excludedKeyFile] : []));
  console.log(`Packed ${bundlePath}`);
}

function inspect(packageDir) {
  const manifest = validatePackage(packageDir);
  console.log(JSON.stringify({
    id: manifest.id,
    version: manifest.version,
    compatibility: manifest.compatibility,
    exports: manifest.exports,
    imports: manifest.imports ?? {},
    permissions: manifest.permissions ?? {}
  }, null, 2));
}

function installLocal(packageDir) {
  const manifest = validatePackage(packageDir);
  const packagesDir = appDataDir();
  const target = resolve(packagesDir, manifest.id);
  if (target === packagesDir || !isInsideDirectory(packagesDir, target)) {
    fail(`Refusing to install package outside packages directory: ${target}`);
  }
  mkdirSync(packagesDir, { recursive: true });
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  const copy = spawnSync("cp", ["-R", packageDir, target], { stdio: "inherit" });
  if (copy.status !== 0) fail("Failed to install package locally.");
  console.log(`Installed ${manifest.id} to ${target}`);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "add") {
    const [capability, exportName, maybeDir] = args;
    if (!capability || !exportName) {
      fail("Usage: node scripts/bakingrl-plugin.mjs add <visual|component|service|connector> <export-name> [package-dir]");
    }
    const packageDir = resolve(process.cwd(), maybeDir && !maybeDir.startsWith("-") ? maybeDir : ".");
    return addCapability(packageDir, capability, exportName);
  }
  if (command === "keygen") return keygen(args[0]);
  if (command === "sign") {
    const keyIndex = args.indexOf("--key");
    if (keyIndex === -1 || !args[keyIndex + 1]) {
      fail("Usage: node scripts/bakingrl-plugin.mjs sign --key <key-file> [package-dir]");
    }
    const keyPath = args[keyIndex + 1];
    const maybeDir = args.find((arg, index) => index !== keyIndex && index !== keyIndex + 1 && !arg.startsWith("-"));
    const packageDir = resolve(process.cwd(), maybeDir ?? ".");
    return signPackage(packageDir, keyPath);
  }

  const maybeDir = args[0];
  const packageDir = resolve(process.cwd(), maybeDir && !maybeDir.startsWith("-") ? maybeDir : ".");
  if (command === "validate") return validatePackage(packageDir);
  if (command === "validate-listing") return validateListing(packageDir);
  if (command === "release-metadata") return releaseMetadata(packageDir, args);
  if (command === "marketplace-entry") return marketplaceEntry(packageDir, args);
  if (command === "pack") {
    const keyIndex = args.indexOf("--sign");
    const keyPath = keyIndex === -1 ? null : args[keyIndex + 1];
    if (keyIndex !== -1 && !keyPath) fail("Usage: node scripts/bakingrl-plugin.mjs pack [package-dir] [--sign <key-file>]");
    const explicitDir = args.find((arg, index) => index !== keyIndex && index !== keyIndex + 1 && !arg.startsWith("-"));
    return pack(resolve(process.cwd(), explicitDir ?? "."), keyPath);
  }
  if (command === "inspect") return inspect(packageDir);
  if (command === "install-local") return installLocal(packageDir);
  if (command === "packages-dir") {
    console.log(appDataDir());
    return;
  }
  fail("Usage: node scripts/bakingrl-plugin.mjs <validate|validate-listing|pack|inspect|install-local|packages-dir> [package-dir]\n       node scripts/bakingrl-plugin.mjs add <visual|component|service|connector> <export-name> [package-dir]\n       node scripts/bakingrl-plugin.mjs keygen [key-file]\n       node scripts/bakingrl-plugin.mjs sign --key <key-file> [package-dir]\n       node scripts/bakingrl-plugin.mjs pack [package-dir] [--sign <key-file>]\n       node scripts/bakingrl-plugin.mjs release-metadata [package-dir] --bundle-url <url> --listing-url <url> [--bundle <path>] [--output <path>]\n       node scripts/bakingrl-plugin.mjs marketplace-entry [package-dir] --developer <id> --bundle-url <url> --listing-url <url> [--bundle <path>] [--reviewed-at <iso>] [--output <path>]");
}

main();
