#!/usr/bin/env node
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";

const appId = "com.quillianne.bakingrl";
const runtimeApiVersion = "1.0.0";
const sdkVersion = "1.0.1";
const supportedRuntimeApiRange = ">=1.0.0 <2.0.0";
const v3ContributionMaps = [
  "commands",
  "services",
  "visuals",
  "views",
  "pages",
  "overlays",
  "webviews",
  "configuration",
  "assets",
  "schemas"
];
const emptyV3Contributes = () => Object.fromEntries(v3ContributionMaps.map((name) => [name, {}]));

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
  if (manifest.schema !== "bakingrl.plugin/3") {
    fail("manifest.schema must be bakingrl.plugin/3");
  }
  for (const field of ["id", "name", "version"]) {
    if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
      fail(`manifest.${field} must be a non-empty string`);
    }
  }
  validatePackageId(manifest.id);
  return manifest;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function assertStringArray(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    fail(`${label} must be an array of non-empty strings`);
  }
  if (!allowEmpty && value.length === 0) {
    fail(`${label} must contain at least one event`);
  }
  return value;
}

function parseSemver(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null;
  }
  return parts;
}

function isRuntimeApiSupported(parsed) {
  const minimum = parseSemver(runtimeApiVersion);
  if (!minimum) return false;
  const [major, minor, patch] = parsed;
  const [minMajor, minMinor, minPatch] = minimum;
  if (major !== minMajor) return false;
  if (minor < minMinor) return false;
  if (minor === minMinor && patch < minPatch) return false;
  return true;
}

function validateRuntimeCompatibility(manifest) {
  const runtimeApi = manifest.compatibility?.runtimeApi;
  const parsed = parseSemver(runtimeApi);
  if (!parsed) {
    fail(`manifest.compatibility.runtimeApi must declare a semver version like ${runtimeApiVersion}`);
  }
  if (!isRuntimeApiSupported(parsed)) {
    fail(`manifest.compatibility.runtimeApi ${runtimeApi} is not supported by helper runtime API range ${supportedRuntimeApiRange}`);
  }
  const sdk = manifest.compatibility?.sdk;
  if (sdk !== undefined && !parseSemver(sdk)) {
    fail(`manifest.compatibility.sdk must be a semver version like ${sdkVersion}`);
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

function validatePathField(packageDir, label, object, field, artifactLabel) {
  if (typeof object?.[field] !== "string" || object[field].trim() === "") {
    fail(`${label}.${field} must point to a ${artifactLabel.toLowerCase()} file`);
  }
  const artifactPath = resolve(packageDir, object[field]);
  if (!isInsideDirectory(packageDir, artifactPath)) {
    fail(`${label}.${field} must stay inside the package`);
  }
  if (!existsSync(artifactPath)) {
    fail(`${artifactLabel} does not exist: ${object[field]}`);
  }
  if (statSync(artifactPath).isFile() && statSync(artifactPath).size === 0) {
    fail(`${artifactLabel} is empty: ${object[field]}`);
  }
}

function validateOptionalPathField(packageDir, label, object, field, artifactLabel) {
  if (object[field] === undefined) return;
  validatePathField(packageDir, label, object, field, artifactLabel);
}

function validateOptionalString(value, label) {
  if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
    fail(`${label} must be a non-empty string`);
  }
}

function validateStringRecord(value, label) {
  assertPlainObject(value, label);
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      fail(`${label}.${key} must be a string`);
    }
  }
}

function validateDefaultSize(value, label) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => !Number.isFinite(entry) || entry <= 0)) {
    fail(`${label} must be a [width, height] array of positive numbers`);
  }
}

function validateV3Sidecar(packageDir, name, sidecar) {
  assertPlainObject(sidecar, `runtime.sidecars.${name}`);
  validatePathField(packageDir, `runtime.sidecars.${name}`, sidecar, "command", "Sidecar command");
  if (sidecar.protocol !== "jsonrpc-stdio") {
    fail(`runtime.sidecars.${name}.protocol must be "jsonrpc-stdio"`);
  }
  if (!["manual", "onActivation", "onStartup"].includes(sidecar.activation)) {
    fail(`runtime.sidecars.${name}.activation must be manual, onActivation, or onStartup`);
  }
  if (sidecar.args !== undefined) assertStringArray(sidecar.args, `runtime.sidecars.${name}.args`);
  if (sidecar.env !== undefined) validateStringRecord(sidecar.env, `runtime.sidecars.${name}.env`);
  if (sidecar.platforms !== undefined) {
    assertStringArray(sidecar.platforms, `runtime.sidecars.${name}.platforms`);
    const supported = new Set(["darwin", "linux", "win32"]);
    for (const platformName of sidecar.platforms) {
      if (!supported.has(platformName)) {
        fail(`runtime.sidecars.${name}.platforms contains unsupported platform '${platformName}'`);
      }
    }
  }
}

function validateContributes(packageDir, contributes) {
  assertPlainObject(contributes, "manifest.contributes");
  const expected = new Set(v3ContributionMaps);
  for (const key of Object.keys(contributes)) {
    if (!expected.has(key)) fail(`manifest.contributes.${key} is not supported`);
  }
  for (const mapName of v3ContributionMaps) {
    assertPlainObject(contributes[mapName], `manifest.contributes.${mapName}`);
  }

  for (const [name, command] of Object.entries(contributes.commands)) {
    assertPlainObject(command, `contributes.commands.${name}`);
    validateOptionalString(command.title, `contributes.commands.${name}.title`);
    validateOptionalString(command.category, `contributes.commands.${name}.category`);
    validateOptionalString(command.icon, `contributes.commands.${name}.icon`);
  }

  for (const [name, service] of Object.entries(contributes.services)) {
    assertPlainObject(service, `contributes.services.${name}`);
    validateOptionalString(service.title, `contributes.services.${name}.title`);
    validateOptionalString(service.sidecar, `contributes.services.${name}.sidecar`);
    if (service.methods !== undefined) assertStringArray(service.methods, `contributes.services.${name}.methods`);
    validateOptionalPathField(packageDir, `contributes.services.${name}`, service, "schema", "Service schema");
  }

  for (const [name, visual] of Object.entries(contributes.visuals)) {
    assertPlainObject(visual, `contributes.visuals.${name}`);
    validateOptionalString(visual.title, `contributes.visuals.${name}.title`);
    validateOptionalString(visual.description, `contributes.visuals.${name}.description`);
    validateBuiltEntry(packageDir, "contributes.visuals", name, visual);
    validateDefaultSize(visual.defaultSize, `contributes.visuals.${name}.defaultSize`);
    validateOptionalPathField(packageDir, `contributes.visuals.${name}`, visual, "settings", "Visual settings schema");
  }

  for (const mapName of ["views", "pages", "overlays", "webviews"]) {
    for (const [name, webview] of Object.entries(contributes[mapName])) {
      assertPlainObject(webview, `contributes.${mapName}.${name}`);
      validateOptionalString(webview.title, `contributes.${mapName}.${name}.title`);
      validateOptionalString(webview.description, `contributes.${mapName}.${name}.description`);
      if (webview.entry === undefined && webview.path === undefined) {
        fail(`contributes.${mapName}.${name} must declare entry or path`);
      }
      if (webview.entry !== undefined) validateBuiltEntry(packageDir, `contributes.${mapName}`, name, webview);
      validateOptionalPathField(packageDir, `contributes.${mapName}.${name}`, webview, "path", `${mapName} path`);
      validateOptionalString(webview.icon, `contributes.${mapName}.${name}.icon`);
      validateOptionalString(webview.configuration, `contributes.${mapName}.${name}.configuration`);
      validateOptionalString(webview.route, `contributes.${mapName}.${name}.route`);
      validateDefaultSize(webview.defaultSize, `contributes.${mapName}.${name}.defaultSize`);
    }
  }

  for (const [name, configuration] of Object.entries(contributes.configuration)) {
    assertPlainObject(configuration, `contributes.configuration.${name}`);
    validateOptionalString(configuration.title, `contributes.configuration.${name}.title`);
    validateOptionalString(configuration.description, `contributes.configuration.${name}.description`);
    validatePathField(packageDir, `contributes.configuration.${name}`, configuration, "schema", "Configuration schema");
  }

  for (const [name, asset] of Object.entries(contributes.assets)) {
    assertPlainObject(asset, `contributes.assets.${name}`);
    validatePathField(packageDir, `contributes.assets.${name}`, asset, "path", "Asset");
  }

  for (const [name, schema] of Object.entries(contributes.schemas)) {
    assertPlainObject(schema, `contributes.schemas.${name}`);
    validatePathField(packageDir, `contributes.schemas.${name}`, schema, "path", "Schema");
  }
}

function validateDiagnostics(diagnostics) {
  if (diagnostics === undefined) return;
  assertPlainObject(diagnostics, "manifest.diagnostics");
  if (diagnostics.enabled !== undefined && typeof diagnostics.enabled !== "boolean") {
    fail("manifest.diagnostics.enabled must be a boolean");
  }
  validateOptionalString(diagnostics.channel, "manifest.diagnostics.channel");
}

function validateV3ContributionReferences(manifest) {
  const sidecars = manifest.runtime.sidecars ?? {};
  for (const [name, service] of Object.entries(manifest.contributes.services)) {
    if (service.sidecar !== undefined && !Object.prototype.hasOwnProperty.call(sidecars, service.sidecar)) {
      fail(`contributes.services.${name}.sidecar must reference a declared runtime.sidecars entry`);
    }
  }
}

function validateCapabilities(capabilities) {
  assertPlainObject(capabilities, "manifest.capabilities");
  const permissions = capabilities.permissions ?? {};
  assertPlainObject(permissions, "manifest.capabilities.permissions");
  const bus = permissions.bus ?? {};
  const registry = permissions.registry ?? {};
  const network = permissions.network ?? {};
  assertPlainObject(bus, "manifest.capabilities.permissions.bus");
  assertPlainObject(registry, "manifest.capabilities.permissions.registry");
  assertPlainObject(network, "manifest.capabilities.permissions.network");
  for (const [key, value] of Object.entries(bus)) {
    if (key !== "read" && key !== "publish") fail(`manifest.capabilities.permissions.bus.${key} is not supported`);
    assertStringArray(value, `manifest.capabilities.permissions.bus.${key}`);
  }
  for (const [key, value] of Object.entries(registry)) {
    if (key !== "read" && key !== "write") fail(`manifest.capabilities.permissions.registry.${key} is not supported`);
    assertStringArray(value, `manifest.capabilities.permissions.registry.${key}`);
  }
  for (const [key, value] of Object.entries(network)) {
    if (key !== "http" && key !== "websocket") fail(`manifest.capabilities.permissions.network.${key} is not supported`);
    assertStringArray(value, `manifest.capabilities.permissions.network.${key}`);
  }
  if (permissions.storage !== undefined) assertStringArray(permissions.storage, "manifest.capabilities.permissions.storage");
}

function validatePackageV3(packageDir, manifest) {
  if (manifest.kind !== "trusted") fail("manifest.kind must be trusted for bakingrl.plugin/3 packages");
  const runtime = assertPlainObject(manifest.runtime, "manifest.runtime");
  const extensionHost = assertPlainObject(runtime.extensionHost, "manifest.runtime.extensionHost");
  validateBuiltEntry(packageDir, "runtime", "extensionHost", extensionHost);
  const sidecars = runtime.sidecars;
  assertPlainObject(sidecars, "manifest.runtime.sidecars");
  for (const [name, sidecar] of Object.entries(sidecars)) {
    validateV3Sidecar(packageDir, name, sidecar);
  }
  const activation = assertPlainObject(manifest.activation, "manifest.activation");
  assertStringArray(activation.events, "manifest.activation.events", { allowEmpty: false });
  validateContributes(packageDir, manifest.contributes);
  validateV3ContributionReferences(manifest);
  validateCapabilities(manifest.capabilities);
  validatePackageSettingsSchema(packageDir, manifest.settings);
  validateDiagnostics(manifest.diagnostics);
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

function validatePackage(packageDir, { print = true } = {}) {
  const manifest = readPackageManifest(packageDir);
  validateRuntimeCompatibility(manifest);
  validatePackageV3(packageDir, manifest);
  if (print) console.log(`Package validation passed: ${manifest.id}`);
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
  const permissions = manifest.capabilities?.permissions ?? {};
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
  const manifest = validatePackage(packageDir, { print: false });
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
  const manifest = validatePackage(packageDir, { print: false });
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

function collectBuildEntries(manifest) {
  const entries = [];
  const addEntry = (kind, name, entry) => {
    if (typeof entry === "string") entries.push({ kind, name, entry });
  };

  addEntry("runtime.extensionHost", "extensionHost", manifest.runtime?.extensionHost?.entry);
  for (const [name, visual] of Object.entries(manifest.contributes?.visuals ?? {})) {
    addEntry("contributes.visuals", name, visual.entry);
  }
  for (const mapName of ["views", "pages", "overlays", "webviews"]) {
    for (const [name, webview] of Object.entries(manifest.contributes?.[mapName] ?? {})) {
      addEntry(`contributes.${mapName}`, name, webview.entry);
    }
  }
  return entries;
}

function doctor(packageDir) {
  const manifest = validatePackage(packageDir, { print: false });
  const summary = {
    ok: true,
    packageDir,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    schema: manifest.schema,
    kind: manifest.kind ?? null,
    runtimeApi: manifest.compatibility?.runtimeApi ?? null,
    supportedRuntimeApiRange,
    checks: {
      manifest: true,
      runtimeCompatibility: true,
      buildEntries: true
    },
    buildEntries: collectBuildEntries(manifest)
  };
  summary.sidecars = Object.keys(manifest.runtime.sidecars);
  summary.activation = manifest.activation;
  summary.contributes = Object.fromEntries(v3ContributionMaps.map((name) => [name, Object.keys(manifest.contributes[name])]));
  console.log(JSON.stringify(summary, null, 2));
}

function inspect(packageDir) {
  const manifest = validatePackage(packageDir, { print: false });
  const summary = {
    id: manifest.id,
    schema: manifest.schema,
    kind: manifest.kind,
    version: manifest.version,
    compatibility: manifest.compatibility,
    settings: manifest.settings ?? null,
    diagnostics: manifest.diagnostics ?? null,
    runtime: manifest.runtime,
    activation: manifest.activation,
    contributes: manifest.contributes ?? {},
    capabilities: manifest.capabilities ?? {}
  };
  console.log(JSON.stringify(summary, null, 2));
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
  if (command === "doctor") return doctor(packageDir);
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
  fail("Usage: node scripts/bakingrl-plugin.mjs <validate|doctor|validate-listing|pack|inspect|install-local|packages-dir> [package-dir]\n       node scripts/bakingrl-plugin.mjs keygen [key-file]\n       node scripts/bakingrl-plugin.mjs sign --key <key-file> [package-dir]\n       node scripts/bakingrl-plugin.mjs pack [package-dir] [--sign <key-file>]\n       node scripts/bakingrl-plugin.mjs release-metadata [package-dir] --bundle-url <url> --listing-url <url> [--bundle <path>] [--output <path>]\n       node scripts/bakingrl-plugin.mjs marketplace-entry [package-dir] --developer <id> --bundle-url <url> --listing-url <url> [--bundle <path>] [--reviewed-at <iso>] [--output <path>]");
}

main();
