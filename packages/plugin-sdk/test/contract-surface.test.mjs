import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  RUNTIME_API_VERSION,
  SDK_VERSION,
  createExtensionTarget,
  createResourceRef,
  parseExtensionTarget
} from "../dist/index.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("exports SDK and runtime API contract constants", () => {
  const packageJson = JSON.parse(readFileSync(resolve(packageDir, "package.json"), "utf8"));

  assert.equal(SDK_VERSION, packageJson.version);
  assert.equal(RUNTIME_API_VERSION, "2.2.0");
});

test("exports manifest V4 author-facing declarations", () => {
  const declarations = readFileSync(resolve(packageDir, "dist", "index.d.ts"), "utf8");

  assert.match(declarations, /export type BakingRLCompatibleApiVersion = `2\.2\.\$\{number\}`;/);
  assert.match(declarations, /export type PluginManifestV4Contributes = \{/);
  assert.match(declarations, /contributions\?: ContributionContribution\[\];/);
  assert.match(declarations, /resources\?: ContributionResource\[\];/);
  assert.match(declarations, /export type PluginManifestV4 = \{/);
  assert.match(declarations, /schemaVersion: "bakingrl\.plugin\/4";/);
  assert.match(declarations, /bakingrlApi: BakingRLCompatibleApiVersion;/);
});

test("builds and parses extension point targets", () => {
  const target = createExtensionTarget("com.example.platform", "items");

  assert.equal(target, "com.example.platform/items");
  assert.deepEqual(parseExtensionTarget(target), {
    packageId: "com.example.platform",
    extensionPointId: "items"
  });
});

test("rejects ambiguous extension point targets", () => {
  for (const target of ["", "items", "/items", "com.example.platform/", "com.example.platform/items/extra"]) {
    assert.equal(parseExtensionTarget(target), null);
  }
});

test("builds resource references", () => {
  assert.equal(createResourceRef("com.example.contributor", "contentData"), "com.example.contributor/contentData");
});
