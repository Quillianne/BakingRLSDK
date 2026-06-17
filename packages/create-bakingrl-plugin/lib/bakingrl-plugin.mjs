#!/usr/bin/env node
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";

const appId = "com.quillianne.bakingrl";
const runtimeApiVersion = "2.1.0";
const allowedTopLevelFields = new Set([
  "schemaVersion",
  "id",
  "name",
  "version",
  "author",
  "bakingrlApi",
  "dependencies",
  "runtime",
  "contributes",
  "externalSurfaces"
]);
const rejectedTopLevelFields = ["schema", "compatibility", "capabilities", "kind", "activation", "settings", "diagnostics", "safeMode"];
const legacyContributeGroups = ["views", "pages", "overlays", "configuration", "assets", "schemas"];
const supportedContributionSections = new Set([
  "commands",
  "services",
  "visuals",
  "settings",
  "extensionPoints",
  "contributions",
  "resources",
  "webviews"
]);
const supportedExternalSurfaces = new Set(["obs", "web", "remote"]);
const allowedVisualKinds = new Set(["overlay", "config", "external"]);
const allowedWebviewKinds = new Set(["tool", "settings", "panel"]);
const sidecarRuntimePattern = /^sidecar:[a-zA-Z0-9._-]+$/;
const sidecarActivationModes = new Set(["manual", "onEnable", "onStartup"]);
const sidecarProtocol = "jsonrpc-stdio";
const supportedArtifactPlatforms = new Set(["any", "darwin-arm64", "darwin-x64", "linux-x64", "windows-x64"]);

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

function validatePackageId(value, label = "manifest.id") {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  if (value === "." || value === ".." || value.startsWith(".") || value.endsWith(".")) {
    fail(`${label} must not contain empty or dot-only path segments`);
  }
  if (value.split(".").some((segment) => segment.length === 0)) {
    fail(`${label} must not contain empty dot-separated segments`);
  }
  if (value.startsWith("plugin.")) {
    fail(`${label} must not include the reserved 'plugin.' runtime prefix`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    fail(`${label} contains unsupported characters`);
  }
}

function readPackageManifest(packageDir) {
  const manifestPath = join(packageDir, "bakingrl.plugin.json");
  if (!existsSync(manifestPath)) fail(`Missing bakingrl.plugin.json in ${packageDir}`);
  const manifest = readJson(manifestPath);
  const { schemaVersion: manifestSchemaVersion, bakingrlApi: manifestBakingrlApi } = manifest;
  if (manifestSchemaVersion !== "bakingrl.plugin/4") {
    fail("schemaVersion must be bakingrl.plugin/4");
  }
  if (typeof manifestBakingrlApi !== "string" || manifestBakingrlApi.trim() === "") {
    fail("manifest.bakingrlApi must be a non-empty string");
  }
  for (const field of ["id", "name", "version"]) {
    if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
      fail(`manifest.${field} must be a non-empty string`);
    }
  }
  for (const field of rejectedTopLevelFields) {
    if (Object.prototype.hasOwnProperty.call(manifest, field)) {
      fail(`manifest.${field} is not supported in bakingrl.plugin/4`);
    }
  }
  assertAllowedKeys(manifest, "manifest", allowedTopLevelFields);
  validatePackageId(manifest.id);
  return { ...manifest, schemaVersion: manifestSchemaVersion, bakingrlApi: manifestBakingrlApi };
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function assertAllowedKeys(value, label, allowedKeys) {
  assertPlainObject(value, label);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail(`${label}.${key} is not supported`);
  }
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

function parseRuntimeApi(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function compareRuntimeApi(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  return 0;
}

function validateSemverRange(value, label) {
  if (value === undefined) return;
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty semver range`);
  }
  const trimmed = value.trim();
  const token = String.raw`(?:v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?|\d+\.x|\d+\.\*|\*)`;
  const comparator = String.raw`(?:[\^~]|>=|<=|>|<|=)?\s*${token}`;
  const rangePattern = new RegExp(String.raw`^${comparator}(?:\s+(?:-\s+)?${comparator})*(?:\s*\|\|\s*${comparator}(?:\s+(?:-\s+)?${comparator})*)*$`);
  if (!rangePattern.test(trimmed)) {
    fail(`${label} must be a semver range such as "^1.0.0", ">=1.0.0 <2.0.0", or "*"`);
  }
}

function validateSemverVersion(value, label) {
  if (value === undefined) return;
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty semver version`);
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.trim())) {
    fail(`${label} must be a semver version such as "1.0.0"`);
  }
}

function validateRuntimeCompatibility(manifest) {
  const runtimeApi = manifest.bakingrlApi;
  const current = parseRuntimeApi(runtimeApiVersion);
  const declared = parseRuntimeApi(runtimeApi);
  if (!declared) {
    fail("manifest.bakingrlApi must be an exact semver version");
  }
  if (declared.major !== current.major || compareRuntimeApi(declared, current) > 0) {
    fail(`manifest.bakingrlApi must be compatible with "${runtimeApiVersion}"`);
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

function validatePackageRelativePath(packageDir, label, rawPath, artifactLabel) {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    fail(`${label} must point to a ${artifactLabel.toLowerCase()} file`);
  }
  const artifactPath = resolve(packageDir, rawPath);
  if (!isInsideDirectory(packageDir, artifactPath)) {
    fail(`${label} must stay inside the package`);
  }
  if (!existsSync(artifactPath)) {
    fail(`${artifactLabel} does not exist: ${rawPath}`);
  }
  if (statSync(artifactPath).isFile() && statSync(artifactPath).size === 0) {
    fail(`${artifactLabel} is empty: ${rawPath}`);
  }
}

function validatePathField(packageDir, label, object, field, artifactLabel) {
  validatePackageRelativePath(packageDir, `${label}.${field}`, object?.[field], artifactLabel);
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

function validateExportName(label, value) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    fail(`${label} must contain only letters, numbers, "_" and "-"`);
  }
}

function validateExtensionPointId(label, value) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  if (value === "." || value === ".." || value.startsWith(".") || value.endsWith(".")) {
    fail(`${label} must not contain empty or dot-only path segments`);
  }
  if (value.split(".").some((segment) => segment.length === 0)) {
    fail(`${label} must not contain empty dot-separated segments`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    fail(`${label} must contain only letters, numbers, ".", "_" and "-"`);
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

function validateJsonValue(value, label) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) fail(`${label} must be JSON-serializable`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonValue(entry, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) validateJsonValue(entry, `${label}.${key}`);
    return;
  }
  fail(`${label} must be JSON-serializable`);
}

function validateJsonObject(value, label) {
  assertPlainObject(value, label);
  validateJsonValue(value, label);
}

function validatePositiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    fail(`${label} must be a positive number`);
  }
}

function validateDefaultSize(value, label) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => !Number.isFinite(entry) || entry <= 0)) {
    fail(`${label} must be a [width, height] array of positive numbers`);
  }
}

function validateSidecarHealthCheck(value, label) {
  if (value === undefined) return;
  assertPlainObject(value, label);
  assertAllowedKeys(value, label, new Set(["method", "intervalMs", "timeoutMs"]));
  validateExportName(`${label}.method`, value.method);
  if (value.intervalMs !== undefined) validatePositiveNumber(value.intervalMs, `${label}.intervalMs`);
  if (value.timeoutMs !== undefined) validatePositiveNumber(value.timeoutMs, `${label}.timeoutMs`);
}

function validateRuntimeSidecar(packageDir, sidecar, index) {
  const label = `manifest.runtime.sidecars[${index}]`;
  assertPlainObject(sidecar, label);
  assertAllowedKeys(sidecar, label, new Set(["id", "bin", "args", "env", "platforms", "protocol", "activation", "healthCheck"]));
  if (sidecar.id === undefined) fail(`${label}.id is required`);
  validateExportName(`${label}.id`, sidecar.id);
  validatePathField(packageDir, label, sidecar, "bin", "Sidecar binary");
  if (sidecar.protocol !== sidecarProtocol) {
    fail(`${label}.protocol must be "${sidecarProtocol}"`);
  }
  if (sidecar.activation !== undefined && !sidecarActivationModes.has(sidecar.activation)) {
    fail(`${label}.activation must be manual, onEnable, or onStartup`);
  }
  if (sidecar.args !== undefined) assertStringArray(sidecar.args, `${label}.args`);
  if (sidecar.env !== undefined) validateStringRecord(sidecar.env, `${label}.env`);
  if (sidecar.platforms !== undefined) assertStringArray(sidecar.platforms, `${label}.platforms`);
  validateSidecarHealthCheck(sidecar.healthCheck, `${label}.healthCheck`);
  if (sidecar.activation === undefined) sidecar.activation = "onEnable";
}

function validateContributionCommands(packageDir, commands = []) {
  if (!Array.isArray(commands)) {
    fail("manifest.contributes.commands must be an array");
  }
  const ids = new Set();
  for (const [index, command] of Object.entries(commands)) {
    const label = `manifest.contributes.commands[${index}]`;
    assertPlainObject(command, label);
    assertAllowedKeys(command, label, new Set(["id", "title", "category", "icon"]));
    validateExportName(`${label}.id`, command.id);
    if (ids.has(command.id)) fail(`${label}.id is duplicated`);
    ids.add(command.id);
    validateOptionalString(command.title, `${label}.title`);
    validateOptionalString(command.category, `${label}.category`);
    validateOptionalString(command.icon, `${label}.icon`);
  }
  return ids;
}

function validateContributionServices(packageDir, services = [], sidecarIds) {
  if (!Array.isArray(services)) {
    fail("manifest.contributes.services must be an array");
  }
  const ids = new Set();
  for (const [index, service] of Object.entries(services)) {
    const label = `manifest.contributes.services[${index}]`;
    assertPlainObject(service, label);
    assertAllowedKeys(service, label, new Set(["id", "runtime", "methods", "schema"]));
    validateExportName(`${label}.id`, service.id);
    if (ids.has(service.id)) fail(`${label}.id is duplicated`);
    ids.add(service.id);
    if (service.runtime !== undefined) {
      if (typeof service.runtime !== "string" || service.runtime.trim() === "") {
        fail(`${label}.runtime must be a non-empty string`);
      }
      if (service.runtime === "node") {
        // valid
      } else if (service.runtime.startsWith("sidecar:")) {
        if (!sidecarRuntimePattern.test(service.runtime)) {
          fail(`${label}.runtime must be "node" or "sidecar:<id>"`);
        }
        const sidecarId = service.runtime.slice("sidecar:".length);
        if (!sidecarIds.has(sidecarId)) {
          fail(`${label}.runtime references unknown runtime.sidecars id '${sidecarId}'`);
        }
      } else {
        fail(`${label}.runtime must be "node" or "sidecar:<id>"`);
      }
    }
    if (service.methods !== undefined) assertStringArray(service.methods, `${label}.methods`);
    validateOptionalPathField(packageDir, label, service, "schema", "Service schema");
  }
  return ids;
}

function validateContributionVisuals(packageDir, visuals = []) {
  if (!Array.isArray(visuals)) {
    fail("manifest.contributes.visuals must be an array");
  }
  const ids = new Set();
  for (const [index, visual] of Object.entries(visuals)) {
    const label = `manifest.contributes.visuals[${index}]`;
    assertPlainObject(visual, label);
    assertAllowedKeys(visual, label, new Set(["id", "kind", "entry", "defaultSize", "instanceSettings", "remoteCompatible"]));
    validateExportName(`${label}.id`, visual.id);
    if (ids.has(visual.id)) fail(`${label}.id is duplicated`);
    ids.add(visual.id);
    if (visual.entry === undefined) fail(`${label}.entry is required`);
    validateBuiltEntry(packageDir, "contributes.visuals", index, visual);
    if (visual.kind !== undefined) {
      if (!allowedVisualKinds.has(visual.kind)) {
        fail(`${label}.kind must be overlay, config, or external`);
      }
    }
    validateDefaultSize(visual.defaultSize, `${label}.defaultSize`);
    validateOptionalPathField(packageDir, label, visual, "instanceSettings", "Visual instance settings schema");
    if (visual.remoteCompatible !== undefined && typeof visual.remoteCompatible !== "boolean") {
      fail(`${label}.remoteCompatible must be a boolean`);
    }
  }
  return ids;
}

function validateContributesSettings(packageDir, contributes) {
  const settings = contributes.settings;
  if (settings === undefined) return;
  assertPlainObject(settings, "manifest.contributes.settings");
  assertAllowedKeys(settings, "manifest.contributes.settings", new Set(["schema", "ui"]));
  for (const key of Object.keys(settings)) {
    if (key !== "schema" && key !== "ui") {
      fail(`manifest.contributes.settings.${key} is not supported`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(settings, "schema")) {
    validateOptionalPathField(packageDir, "manifest.contributes.settings", settings, "schema", "Settings schema");
  }
  if (Object.prototype.hasOwnProperty.call(settings, "ui")) {
    if (typeof settings.ui !== "string") {
      fail("manifest.contributes.settings.ui must be a visual id");
    }
    validateExportName("manifest.contributes.settings.ui", settings.ui);
    const visual = (contributes.visuals ?? []).find((entry) => entry.id === settings.ui && entry.kind === "config");
    if (!visual) {
      fail(`manifest.contributes.settings.ui must reference a visual with kind config (${settings.ui})`);
    }
  }
}

function validateDependencies(manifest) {
  const dependencies = manifest.dependencies;
  const ids = new Set();
  if (dependencies === undefined) return ids;
  if (!Array.isArray(dependencies)) {
    fail("manifest.dependencies must be an array");
  }
  for (const [index, dependency] of Object.entries(dependencies)) {
    const label = `manifest.dependencies[${index}]`;
    assertPlainObject(dependency, label);
    assertAllowedKeys(dependency, label, new Set(["packageId", "version", "optional"]));
    validatePackageId(dependency.packageId, `${label}.packageId`);
    if (dependency.packageId === manifest.id) {
      fail(`${label}.packageId must not reference the package itself`);
    }
    if (ids.has(dependency.packageId)) fail(`${label}.packageId is duplicated`);
    ids.add(dependency.packageId);
    validateSemverRange(dependency.version, `${label}.version`);
    if (dependency.optional !== undefined && typeof dependency.optional !== "boolean") {
      fail(`${label}.optional must be a boolean`);
    }
  }
  return ids;
}

function parseExtensionTarget(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be formatted as "package.id/extensionPointId"`);
  }
  const slashIndex = value.indexOf("/");
  if (slashIndex <= 0 || slashIndex !== value.lastIndexOf("/") || slashIndex === value.length - 1) {
    fail(`${label} must be formatted as "package.id/extensionPointId"`);
  }
  const packageId = value.slice(0, slashIndex);
  const extensionPointId = value.slice(slashIndex + 1);
  validatePackageId(packageId, `${label} package id`);
  validateExtensionPointId(`${label} extension point id`, extensionPointId);
  return { packageId, extensionPointId };
}

function validateContributionExtensionPoints(packageDir, extensionPoints = [], serviceIds) {
  if (!Array.isArray(extensionPoints)) {
    fail("manifest.contributes.extensionPoints must be an array");
  }
  const ids = new Set();
  for (const [index, extensionPoint] of Object.entries(extensionPoints)) {
    const label = `manifest.contributes.extensionPoints[${index}]`;
    assertPlainObject(extensionPoint, label);
    assertAllowedKeys(extensionPoint, label, new Set(["id", "version", "title", "description", "schema", "service"]));
    validateExtensionPointId(`${label}.id`, extensionPoint.id);
    if (ids.has(extensionPoint.id)) fail(`${label}.id is duplicated`);
    ids.add(extensionPoint.id);
    validateSemverVersion(extensionPoint.version, `${label}.version`);
    validateOptionalString(extensionPoint.title, `${label}.title`);
    validateOptionalString(extensionPoint.description, `${label}.description`);
    validateOptionalPathField(packageDir, label, extensionPoint, "schema", "Extension point schema");
    if (extensionPoint.service !== undefined) {
      validateExportName(`${label}.service`, extensionPoint.service);
      if (!serviceIds.has(extensionPoint.service)) {
        fail(`${label}.service references unknown contributes.services id '${extensionPoint.service}'`);
      }
    }
  }
  return ids;
}

function validateContributionResources(packageDir, resources = []) {
  if (!Array.isArray(resources)) {
    fail("manifest.contributes.resources must be an array");
  }
  const ids = new Set();
  for (const [index, resource] of Object.entries(resources)) {
    const label = `manifest.contributes.resources[${index}]`;
    assertPlainObject(resource, label);
    assertAllowedKeys(resource, label, new Set(["id", "path", "paths", "type", "visibility", "metadata"]));
    validateExportName(`${label}.id`, resource.id);
    if (ids.has(resource.id)) fail(`${label}.id is duplicated`);
    ids.add(resource.id);
    const hasPath = Object.prototype.hasOwnProperty.call(resource, "path");
    const hasPaths = Object.prototype.hasOwnProperty.call(resource, "paths");
    if (hasPath && hasPaths) fail(`${label} must declare either path or paths, not both`);
    if (!hasPath && !hasPaths) fail(`${label} must declare path or paths`);
    if (hasPath) {
      validatePackageRelativePath(packageDir, `${label}.path`, resource.path, "Resource");
    }
    if (hasPaths) {
      assertStringArray(resource.paths, `${label}.paths`, { allowEmpty: false });
      resource.paths.forEach((path, pathIndex) => {
        validatePackageRelativePath(packageDir, `${label}.paths[${pathIndex}]`, path, "Resource");
      });
    }
    const visibility = resource.visibility ?? "private";
    if (visibility !== "public" && visibility !== "private") {
      fail(`${label}.visibility must be public or private`);
    }
    if (visibility === "public" && (typeof resource.type !== "string" || resource.type.trim() === "")) {
      fail(`${label}.type is required for public resources`);
    }
    if (resource.type !== undefined && (typeof resource.type !== "string" || resource.type.trim() === "")) {
      fail(`${label}.type must be a non-empty string`);
    }
    if (resource.metadata !== undefined) validateJsonObject(resource.metadata, `${label}.metadata`);
  }
  return ids;
}

function validateContributionWebviews(packageDir, webviews = []) {
  if (!Array.isArray(webviews)) {
    fail("manifest.contributes.webviews must be an array");
  }
  const ids = new Set();
  for (const [index, webview] of Object.entries(webviews)) {
    const label = `manifest.contributes.webviews[${index}]`;
    assertPlainObject(webview, label);
    assertAllowedKeys(webview, label, new Set(["id", "entry", "title", "kind", "defaultSize"]));
    validateExportName(`${label}.id`, webview.id);
    if (ids.has(webview.id)) fail(`${label}.id is duplicated`);
    ids.add(webview.id);
    if (webview.entry === undefined) fail(`${label}.entry is required`);
    validateBuiltEntry(packageDir, "contributes.webviews", index, webview);
    validateOptionalString(webview.title, `${label}.title`);
    if (webview.kind !== undefined && !allowedWebviewKinds.has(webview.kind)) {
      fail(`${label}.kind must be tool, settings, or panel`);
    }
    validateDefaultSize(webview.defaultSize, `${label}.defaultSize`);
  }
  return ids;
}

function validateContributionContributions(packageDir, manifest, contributions = [], dependencyIds, extensionPointIds, visualIds, serviceIds, resourceIds) {
  if (!Array.isArray(contributions)) {
    fail("manifest.contributes.contributions must be an array");
  }
  const ids = new Set();
  for (const [index, contribution] of Object.entries(contributions)) {
    const label = `manifest.contributes.contributions[${index}]`;
    assertPlainObject(contribution, label);
    assertAllowedKeys(contribution, label, new Set([
      "id",
      "target",
      "kind",
      "title",
      "description",
      "dataSchema",
      "visual",
      "service",
      "resources",
      "metadata"
    ]));
    validateExportName(`${label}.id`, contribution.id);
    if (ids.has(contribution.id)) fail(`${label}.id is duplicated`);
    ids.add(contribution.id);
    const target = parseExtensionTarget(contribution.target, `${label}.target`);
    if (target.packageId === manifest.id) {
      if (!extensionPointIds.has(target.extensionPointId)) {
        fail(`${label}.target references unknown local extension point '${target.extensionPointId}'`);
      }
    } else if (!dependencyIds.has(target.packageId)) {
      fail(`${label}.target references external package '${target.packageId}' without a matching manifest.dependencies entry`);
    }
    validateOptionalString(contribution.kind, `${label}.kind`);
    validateOptionalString(contribution.title, `${label}.title`);
    validateOptionalString(contribution.description, `${label}.description`);
    validateOptionalPathField(packageDir, label, contribution, "dataSchema", "Contribution data schema");
    if (contribution.visual !== undefined) {
      validateExportName(`${label}.visual`, contribution.visual);
      if (!visualIds.has(contribution.visual)) {
        fail(`${label}.visual references unknown contributes.visuals id '${contribution.visual}'`);
      }
    }
    if (contribution.service !== undefined) {
      validateExportName(`${label}.service`, contribution.service);
      if (!serviceIds.has(contribution.service)) {
        fail(`${label}.service references unknown contributes.services id '${contribution.service}'`);
      }
    }
    if (contribution.resources !== undefined) {
      assertStringArray(contribution.resources, `${label}.resources`);
      for (const resourceId of contribution.resources) {
        validateExportName(`${label}.resources[]`, resourceId);
        if (!resourceIds.has(resourceId)) {
          fail(`${label}.resources references unknown contributes.resources id '${resourceId}'`);
        }
      }
    }
    if (contribution.metadata !== undefined) validateJsonObject(contribution.metadata, `${label}.metadata`);
  }
  return ids;
}

function validatePackageRuntime(packageDir, manifest) {
  if (manifest.runtime === undefined) return new Set();
  const runtime = assertPlainObject(manifest.runtime, "manifest.runtime");
  assertAllowedKeys(runtime, "manifest.runtime", new Set(["node", "sidecars"]));
  if (runtime.node !== undefined) {
    assertPlainObject(runtime.node, "manifest.runtime.node");
    assertAllowedKeys(runtime.node, "manifest.runtime.node", new Set(["entry"]));
    validateBuiltEntry(packageDir, "manifest.runtime", "node", runtime.node);
  }
  const sidecarIds = new Set();
  if (runtime.sidecars !== undefined) {
    if (!Array.isArray(runtime.sidecars)) {
      fail("manifest.runtime.sidecars must be an array");
    }
    for (const [index, sidecar] of Object.entries(runtime.sidecars)) {
      validateRuntimeSidecar(packageDir, sidecar, index);
      if (sidecarIds.has(sidecar.id)) fail(`manifest.runtime.sidecars[${index}].id is duplicated`);
      sidecarIds.add(sidecar.id);
    }
  }
  return sidecarIds;
}

function validateContributesSection(manifest, packageDir, sidecarIds, dependencyIds) {
  const contributes = manifest.contributes ?? {};
  if (contributes !== undefined) {
    assertPlainObject(contributes, "manifest.contributes");
  }
  for (const key of Object.keys(contributes)) {
    if (!supportedContributionSections.has(key)) fail(`manifest.contributes.${key} is not supported`);
  }
  for (const legacyGroup of legacyContributeGroups) {
    if (Object.prototype.hasOwnProperty.call(contributes, legacyGroup)) {
      fail(`manifest.contributes.${legacyGroup} is not supported`);
    }
  }
  validateContributionCommands(packageDir, contributes.commands);
  const serviceIds = validateContributionServices(packageDir, contributes.services, sidecarIds);
  const visualIds = validateContributionVisuals(packageDir, contributes.visuals);
  const extensionPointIds = validateContributionExtensionPoints(packageDir, contributes.extensionPoints, serviceIds);
  const resourceIds = validateContributionResources(packageDir, contributes.resources);
  validateContributionWebviews(packageDir, contributes.webviews);
  validateContributionContributions(
    packageDir,
    manifest,
    contributes.contributions,
    dependencyIds,
    extensionPointIds,
    visualIds,
    serviceIds,
    resourceIds
  );
  validateContributesSettings(packageDir, contributes);
}

function validateRuntimeRef(label, value, sidecarIds = null) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  if (value === "node") return;
  if (sidecarRuntimePattern.test(value)) {
    const sidecarId = value.slice("sidecar:".length);
    if (sidecarIds && !sidecarIds.has(sidecarId)) {
      fail(`${label} references unknown runtime.sidecars id '${sidecarId}'`);
    }
    return;
  }
  fail(`${label} must be "node" or "sidecar:<id>"`);
}

function validateExternalSurfaces(manifest, sidecarIds) {
  if (manifest.externalSurfaces === undefined) return;
  const externalSurfaces = assertPlainObject(manifest.externalSurfaces, "manifest.externalSurfaces");
  for (const [surface, declaration] of Object.entries(externalSurfaces)) {
    if (!supportedExternalSurfaces.has(surface)) {
      fail(`manifest.externalSurfaces.${surface} is not supported`);
    }
    const label = `manifest.externalSurfaces.${surface}`;
    assertAllowedKeys(declaration, label, new Set(["runtime"]));
    if (!Object.prototype.hasOwnProperty.call(declaration, "runtime")) {
      fail(`${label}.runtime is required`);
    }
    validateRuntimeRef(`${label}.runtime`, declaration.runtime, sidecarIds);
  }
}

function validatePackageV4(packageDir, manifest) {
  const dependencyIds = validateDependencies(manifest);
  const sidecarIds = validatePackageRuntime(packageDir, manifest);
  validateContributesSection(manifest, packageDir, sidecarIds, dependencyIds);
  validateExternalSurfaces(manifest, sidecarIds);
}

function validateNoEmbeddedNodeRuntime(packageDir) {
  for (const file of walkFiles(packageDir)) {
    const normalized = file.split("\\").join("/");
    const lower = normalized.toLowerCase();
    const parts = lower.split("/");
    const basename = parts.at(-1);
    if (basename === "node" || basename === "node.exe" || /(^|\/)bin\/node[^/]*$/.test(lower)) {
      fail(`Package must not embed a Node runtime binary: ${normalized}`);
    }
  }
}

function validatePackage(packageDir, { print = true } = {}) {
  const manifest = readPackageManifest(packageDir);
  validateRuntimeCompatibility(manifest);
  validatePackageV4(packageDir, manifest);
  validateNoEmbeddedNodeRuntime(packageDir);
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

function artifactPlatform(options) {
  const value = options.platform === undefined || options.platform === true ? "any" : String(options.platform).trim();
  if (!supportedArtifactPlatforms.has(value)) {
    fail(`--platform must be one of: ${Array.from(supportedArtifactPlatforms).join(", ")}.`);
  }
  return value;
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
  const artifact = {
    platform: artifactPlatform(options),
    bundleUrl,
    bundleSha256: sha256File(bundlePath),
    signaturePublicKey: readSignaturePublicKey(packageDir)
  };
  const metadata = {
    schema: "bakingrl.plugin-release/1",
    packageId: manifest.id,
    version: manifest.version,
    repo: listing.repo,
    listingUrl,
    artifacts: [artifact],
    runtimeApi: manifest.bakingrlApi ?? null,
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
  const artifact = {
    platform: artifactPlatform(options),
    bundleUrl,
    bundleSha256: sha256File(bundlePath),
    signaturePublicKey: readSignaturePublicKey(packageDir)
  };
  const entry = {
    schema: "bakingrl.marketplace-package/1",
    id: manifest.id,
    developerId,
    repo: listing.repo,
    listingUrl,
    approvedVersions: [
      {
        version: manifest.version,
        artifacts: [artifact],
        runtimeApi: manifest.bakingrlApi ?? null,
        review: {
          status: "approved",
          reviewedAt
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

  addEntry("runtime.node", "node", manifest.runtime?.node?.entry);
  for (const sidecar of manifest.runtime?.sidecars ?? []) {
    addEntry("runtime.sidecars", sidecar.id, sidecar.bin);
  }
  for (const visual of manifest.contributes?.visuals ?? []) {
    addEntry("contributes.visuals", visual.id, visual.entry);
  }
  for (const webview of manifest.contributes?.webviews ?? []) {
    addEntry("contributes.webviews", webview.id, webview.entry);
  }
  return entries;
}

function doctor(packageDir) {
  const manifest = validatePackage(packageDir, { print: false });
  const { schemaVersion: manifestSchemaVersion, bakingrlApi: manifestBakingrlApi } = manifest;
  const summary = {
    ok: true,
    packageDir,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    schemaVersion: manifestSchemaVersion,
    bakingrlApi: manifestBakingrlApi ?? null,
    checks: {
      manifest: true,
      runtimeCompatibility: true,
      buildEntries: true
    },
    buildEntries: collectBuildEntries(manifest),
    dependencies: manifest.dependencies ?? [],
    sidecars: (manifest.runtime?.sidecars ?? []).map((sidecar) => sidecar.id),
    externalSurfaces: manifest.externalSurfaces ?? null,
    contributes: {
      commands: (manifest.contributes?.commands ?? []).map((command) => command.id),
      services: (manifest.contributes?.services ?? []).map((service) => service.id),
      visuals: (manifest.contributes?.visuals ?? []).map((visual) => visual.id),
      extensionPoints: (manifest.contributes?.extensionPoints ?? []).map((extensionPoint) => extensionPoint.id),
      contributions: (manifest.contributes?.contributions ?? []).map((contribution) => contribution.id),
      resources: (manifest.contributes?.resources ?? []).map((resource) => resource.id),
      webviews: (manifest.contributes?.webviews ?? []).map((webview) => webview.id),
      settings: manifest.contributes?.settings ?? null
    }
  };
  console.log(JSON.stringify(summary, null, 2));
}

function inspect(packageDir) {
  const manifest = validatePackage(packageDir, { print: false });
  const { schemaVersion: manifestSchemaVersion, bakingrlApi: manifestBakingrlApi } = manifest;
  const summary = {
    id: manifest.id,
    schemaVersion: manifestSchemaVersion,
    version: manifest.version,
    bakingrlApi: manifestBakingrlApi ?? null,
    dependencies: manifest.dependencies ?? [],
    runtime: manifest.runtime,
    contributes: manifest.contributes ?? {},
    externalSurfaces: manifest.externalSurfaces ?? null
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
  fail("Usage: node scripts/bakingrl-plugin.mjs <validate|doctor|validate-listing|pack|inspect|install-local|packages-dir> [package-dir]\n       node scripts/bakingrl-plugin.mjs keygen [key-file]\n       node scripts/bakingrl-plugin.mjs sign --key <key-file> [package-dir]\n       node scripts/bakingrl-plugin.mjs pack [package-dir] [--sign <key-file>]\n       node scripts/bakingrl-plugin.mjs release-metadata [package-dir] --bundle-url <url> --listing-url <url> [--bundle <path>] [--platform <platform>] [--output <path>]\n       node scripts/bakingrl-plugin.mjs marketplace-entry [package-dir] --developer <id> --bundle-url <url> --listing-url <url> [--bundle <path>] [--platform <platform>] [--reviewed-at <iso>] [--output <path>]");
}

main();
