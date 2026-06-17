#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templatesRoot = join(packageRoot, "templates");
const helperPath = join(packageRoot, "lib", "bakingrl-plugin.mjs");

const templates = [
  {
    id: "extension-plugin",
    label: "Extension Plugin Package",
    description: "Manifest v4 with a Node extension runtime and a visual contribution."
  },
  {
    id: "overlay-plugin",
    label: "Overlay Plugin Package",
    description: "Manifest v4 with a Node runtime and overlay-style visual contribution."
  },
  {
    id: "native-sidecar-plugin",
    label: "Native Sidecar Plugin Package",
    description: "Manifest v4 with a Rust JSON-RPC stdio sidecar."
  }
];

function parseArgs(argv) {
  const result = { name: "", template: "extension-plugin", force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--template" || arg === "-t") {
      result.template = argv[index + 1] ?? result.template;
      index += 1;
    } else if (arg.startsWith("--template=")) {
      result.template = arg.slice("--template=".length);
    } else if (arg === "--force") {
      result.force = true;
    } else if (!result.name) {
      result.name = arg;
    }
  }
  return result;
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleFromSlug(slug) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isDirectoryEmpty(path) {
  if (!existsSync(path)) return true;
  if (!statSync(path).isDirectory()) return false;
  return readdirSync(path).length === 0;
}

function packageRelativeFileDependency(packageDir, dependencyDir) {
  const relativePath = relative(packageDir, dependencyDir).split(sep).join("/");
  return `file:${relativePath.startsWith(".") ? relativePath : `./${relativePath}`}`;
}

function sdkDependency(packageDir) {
  const localSdkPath = resolve(packageRoot, "..", "plugin-sdk");
  if (existsSync(localSdkPath)) return packageRelativeFileDependency(packageDir, localSdkPath);

  return "^2.1.1";
}

function copyTemplate(source, target, replacements) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const sourcePath = join(source, entry);
    const targetPath = join(target, entry);
    const stat = statSync(sourcePath);
    if (stat.isDirectory()) {
      copyTemplate(sourcePath, targetPath, replacements);
      continue;
    }
    const textExtensions = new Set([".json", ".ts", ".js", ".svelte", ".html", ".css", ".md", ".toml", ".rs"]);
    const ext = entry.includes(".") ? entry.slice(entry.lastIndexOf(".")) : "";
    if (textExtensions.has(ext)) {
      let content = readFileSync(sourcePath, "utf8");
      for (const [key, value] of Object.entries(replacements)) {
        content = content.replaceAll(key, value);
      }
      writeFileSync(targetPath, content);
    } else {
      copyFileSync(sourcePath, targetPath);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.name) {
    const rl = readline.createInterface({ input, output });
    try {
      args.name = await rl.question("Plugin package directory name: ");
    } finally {
      rl.close();
    }
  }

  if (!templates.some((template) => template.id === args.template)) {
    console.error(`Unknown template: ${args.template}`);
    process.exit(1);
  }

  const targetDir = resolve(process.cwd(), args.name);
  const slug = slugify(basename(targetDir));
  if (!slug) {
    console.error("Package name must contain at least one letter or number.");
    process.exit(1);
  }
  if (args.force && existsSync(targetDir)) {
    if (targetDir === dirname(targetDir)) {
      console.error(`Refusing to overwrite filesystem root: ${targetDir}`);
      process.exit(1);
    }
    rmSync(targetDir, { recursive: true, force: true });
  }
  if (!args.force && !isDirectoryEmpty(targetDir)) {
    console.error(`Target directory is not empty: ${targetDir}`);
    console.error("Use --force to write into it anyway.");
    process.exit(1);
  }

  const title = titleFromSlug(slug);
  const pluginId = `com.example.${slug.replaceAll("-", "_")}`;
  const sdkDependencyValue = sdkDependency(targetDir);

  copyTemplate(join(templatesRoot, args.template), targetDir, {
    "__PLUGIN_SLUG__": slug,
    "__PLUGIN_NAME__": title,
    "__PLUGIN_ID__": pluginId,
    "__PLUGIN_SDK_DEP__": sdkDependencyValue
  });

  mkdirSync(join(targetDir, "scripts"), { recursive: true });
  copyFileSync(helperPath, join(targetDir, "scripts", "bakingrl-plugin.mjs"));

  console.log(`Created ${title} in ${basename(targetDir)}`);
  console.log(`SDK dependency: ${sdkDependencyValue}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${args.name}`);
  console.log("  npm install");
  console.log("  npm run build");
  console.log("  npm run pack");
  console.log("  npm run install:local");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
