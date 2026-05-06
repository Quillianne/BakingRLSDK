#!/usr/bin/env node
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";

const appId = "com.quillianne.bakingrl";

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

function validatePackage(packageDir) {
  const manifestPath = join(packageDir, "bakingrl.plugin.json");
  if (!existsSync(manifestPath)) fail(`Missing bakingrl.plugin.json in ${packageDir}`);
  const manifest = readJson(manifestPath);
  if (manifest.schema !== "bakingrl.plugin/2") fail("manifest.schema must be bakingrl.plugin/2");
  for (const field of ["id", "name", "version"]) {
    if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
      fail(`manifest.${field} must be a non-empty string`);
    }
  }
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
  if (exportCount === 0) fail("Package must export at least one capability");
  console.log(`Package validation passed: ${manifest.id}`);
  return manifest;
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

export default defineVisual({
  async mount(context: VisualContext) {
    context.root.innerHTML = \`
      <div style="display:flex;align-items:center;justify-content:center;height:100%;background:rgba(10,14,18,.82);color:white;border:1px solid rgba(255,255,255,.18);font:700 20px Inter,Arial,sans-serif;">
        ${exportName}
      </div>
    \`;
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
  const excludes = ["dist-bundles/*", "node_modules/*", ".git/*"];
  if (excludedKeyFile) excludes.push(excludedKeyFile);
  const zip = spawnSync("zip", ["-qr", bundlePath, ".", "-x", ...excludes], {
    cwd: packageDir,
    stdio: "inherit"
  });
  if (zip.status !== 0) fail("Failed to create .brlp bundle. Ensure the zip command is available.");
  console.log(`Packed ${bundlePath}`);
}

function inspect(packageDir) {
  const manifest = validatePackage(packageDir);
  console.log(JSON.stringify({
    id: manifest.id,
    version: manifest.version,
    exports: manifest.exports,
    imports: manifest.imports ?? {},
    permissions: manifest.permissions ?? {}
  }, null, 2));
}

function installLocal(packageDir) {
  const manifest = validatePackage(packageDir);
  const packagesDir = appDataDir();
  const target = join(packagesDir, manifest.id);
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
  fail("Usage: node scripts/bakingrl-plugin.mjs <validate|pack|inspect|install-local|packages-dir> [package-dir]\n       node scripts/bakingrl-plugin.mjs add <visual|component|service|connector> <export-name> [package-dir]\n       node scripts/bakingrl-plugin.mjs keygen [key-file]\n       node scripts/bakingrl-plugin.mjs sign --key <key-file> [package-dir]\n       node scripts/bakingrl-plugin.mjs pack [package-dir] [--sign <key-file>]");
}

main();
