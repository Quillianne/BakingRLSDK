#!/usr/bin/env node
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";

const appId = "com.quillianne.bakingrl";
const runtimeApiVersion = "2.3.0";
const minSupportedRuntimeApiVersion = "2.3.0";
const allowedTopLevelFields = new Set([
  "schemaVersion",
  "id",
  "name",
  "version",
  "author",
  "bakingrlApi",
  "permissions",
  "dependencies",
  "runtime",
  "contributes"
]);
const rejectedTopLevelFields = [
  "schema",
  "compatibility",
  "capabilities",
  "kind",
  "activation",
  "settings",
  "diagnostics",
  "safeMode",
  "externalSurfaces"
];
const removedContributeGroups = new Map([
  ["visuals", "manifest.contributes.visuals is not supported in runtime API 2.3; use webviews for host-opened UI and resources/services/metadata for platform contributions"],
  ["views", "manifest.contributes.views is not supported; use contributes.webviews"],
  ["pages", "manifest.contributes.pages is not supported; use contributes.webviews"],
  ["overlays", "manifest.contributes.overlays is not supported; expose overlay behavior through a platform plugin contract"],
  ["configuration", "manifest.contributes.configuration is not supported; use contributes.settings"],
  ["assets", "manifest.contributes.assets is not supported; use contributes.resources"],
  ["schemas", "manifest.contributes.schemas is not supported; reference schemas from settings, services, extension points, or contributions"]
]);
const supportedContributionSections = new Set([
  "commands",
  "services",
  "settings",
  "extensionPoints",
  "contributions",
  "resources",
  "webviews"
]);
const allowedWebviewKinds = new Set(["tool", "settings", "panel"]);
const httpSchemes = new Set(["http", "https"]);
const websocketSchemes = new Set(["ws", "wss"]);
const listenTransports = new Set(["http", "https", "ws", "wss", "tcp"]);
const supportedSettingSchemaTypes = new Set(["string", "number", "integer", "boolean", "array", "object"]);
const sidecarRuntimePattern = /^sidecar:[a-zA-Z0-9._-]+$/;
const sidecarActivationModes = new Set(["manual", "onEnable", "onStartup"]);
const sidecarProtocol = "jsonrpc-stdio";
const sidecarHealthCheckMinIntervalMs = 500;
const sidecarHealthCheckMinTimeoutMs = 100;
const supportedSubmissionPlatforms = new Set([
  "any",
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "windows-x64"
]);

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
  const minimum = parseRuntimeApi(minSupportedRuntimeApiVersion);
  const declared = parseRuntimeApi(runtimeApi);
  if (!declared) {
    fail("manifest.bakingrlApi must be an exact semver version");
  }
  if (
    declared.major !== current.major ||
    declared.minor !== current.minor ||
    declared.major !== minimum.major ||
    declared.minor !== minimum.minor
  ) {
    fail(`manifest.bakingrlApi must target host runtime API ${current.major}.${current.minor}.x (minimum ${minSupportedRuntimeApiVersion})`);
  }
  return declared;
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
  return artifactPath;
}

function validatePathField(packageDir, label, object, field, artifactLabel) {
  return validatePackageRelativePath(packageDir, `${label}.${field}`, object?.[field], artifactLabel);
}

function validateOptionalPathField(packageDir, label, object, field, artifactLabel) {
  if (object[field] === undefined) return;
  return validatePathField(packageDir, label, object, field, artifactLabel);
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

function validateNumberAtLeast(value, label, minimum) {
  if (!Number.isFinite(value) || value < minimum) {
    fail(`${label} must be a number >= ${minimum}`);
  }
}

function validateDefaultSize(value, label) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => !Number.isFinite(entry) || entry <= 0)) {
    fail(`${label} must be a [width, height] array of positive numbers`);
  }
}

function validatePosition(value, label) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => !Number.isFinite(entry))) {
    fail(`${label} must be an [x, y] array of finite numbers`);
  }
}

function requireObjectFields(value, label, fields) {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      fail(`${label}.${field} is required`);
    }
  }
}

function validatePermissionPattern(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  const firstWildcard = value.indexOf("*");
  if (firstWildcard !== -1 && (firstWildcard !== value.length - 1 || value.lastIndexOf("*") !== firstWildcard)) {
    fail(`${label} may contain only one terminal '*' wildcard`);
  }
}

function validatePermissionPatterns(value, label, validator = validatePermissionPattern) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
  }
  value.forEach((entry, index) => validator(entry, `${label}[${index}]`));
}

function validateStoragePermissionPattern(value, label) {
  validatePermissionPattern(value, label);
  if (value === "*") return;
  const path = value.endsWith("*") ? value.slice(0, -1) : value;
  if (
    path.startsWith("/") ||
    path.startsWith("~") ||
    path.includes("\\") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)
  ) {
    fail(`${label} must be a relative storage path using '/' separators`);
  }
  const normalizedPath = path.endsWith("/") ? path.slice(0, -1) : path;
  if (normalizedPath === "" || normalizedPath.includes("//")) {
    fail(`${label} must be a normalized relative storage path`);
  }
  if (normalizedPath.split("/").some((segment) => segment === "." || segment === ".." || segment === "")) {
    fail(`${label} must not contain '.' or '..' path segments`);
  }
}

function validatePorts(value, label) {
  if (value === "*") return;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)
  ) {
    fail(`${label} must be '*' or a non-empty array of ports from 1 to 65535`);
  }
}

function validateNetworkEndpoint(endpoint, label, schemes) {
  assertPlainObject(endpoint, label);
  assertAllowedKeys(endpoint, label, new Set(["scheme", "host", "ports", "pathPrefixes"]));
  requireObjectFields(endpoint, label, ["scheme", "host", "ports"]);
  if (!schemes.has(endpoint.scheme)) {
    fail(`${label}.scheme must be one of ${Array.from(schemes).join(", ")}`);
  }
  if (typeof endpoint.host !== "string" || endpoint.host.trim() === "") {
    fail(`${label}.host must be a non-empty string`);
  }
  validatePorts(endpoint.ports, `${label}.ports`);
  if (endpoint.pathPrefixes !== undefined) {
    validatePermissionPatterns(endpoint.pathPrefixes, `${label}.pathPrefixes`, (prefix, prefixLabel) => {
      if (typeof prefix !== "string" || !prefix.startsWith("/") || prefix.includes("?") || prefix.includes("#")) {
        fail(`${prefixLabel} must be an absolute URL path without a query or fragment`);
      }
    });
  }
}

function validateListenEndpoint(endpoint, label) {
  assertPlainObject(endpoint, label);
  assertAllowedKeys(endpoint, label, new Set(["transport", "host", "ports"]));
  requireObjectFields(endpoint, label, ["transport", "host", "ports"]);
  if (!listenTransports.has(endpoint.transport)) {
    fail(`${label}.transport must be one of ${Array.from(listenTransports).join(", ")}`);
  }
  if (typeof endpoint.host !== "string" || endpoint.host.trim() === "") {
    fail(`${label}.host must be a non-empty string`);
  }
  validatePorts(endpoint.ports, `${label}.ports`);
}

function validatePermissionGroup(value, label, fields, validator = validatePermissionPatterns) {
  assertPlainObject(value, label);
  assertAllowedKeys(value, label, new Set(fields));
  requireObjectFields(value, label, fields);
  for (const field of fields) validator(value[field], `${label}.${field}`);
}

function validateManifestPermissions(manifest) {
  if (manifest.permissions === undefined) return;
  const permissions = assertPlainObject(manifest.permissions, "manifest.permissions");
  const groups = ["bus", "registry", "network", "storage"];
  assertAllowedKeys(permissions, "manifest.permissions", new Set(groups));
  requireObjectFields(permissions, "manifest.permissions", groups);
  validatePermissionGroup(permissions.bus, "manifest.permissions.bus", ["read", "publish"]);
  validatePermissionGroup(permissions.registry, "manifest.permissions.registry", ["read", "write"]);
  validatePermissionGroup(
    permissions.storage,
    "manifest.permissions.storage",
    ["read", "write"],
    (value, label) => validatePermissionPatterns(value, label, validateStoragePermissionPattern)
  );

  const network = assertPlainObject(permissions.network, "manifest.permissions.network");
  const networkFields = ["http", "websocket", "listen"];
  assertAllowedKeys(network, "manifest.permissions.network", new Set(networkFields));
  requireObjectFields(network, "manifest.permissions.network", networkFields);
  if (!Array.isArray(network.http)) fail("manifest.permissions.network.http must be an array");
  if (!Array.isArray(network.websocket)) fail("manifest.permissions.network.websocket must be an array");
  if (!Array.isArray(network.listen)) fail("manifest.permissions.network.listen must be an array");
  network.http.forEach((endpoint, index) => {
    validateNetworkEndpoint(endpoint, `manifest.permissions.network.http[${index}]`, httpSchemes);
  });
  network.websocket.forEach((endpoint, index) => {
    validateNetworkEndpoint(endpoint, `manifest.permissions.network.websocket[${index}]`, websocketSchemes);
  });
  network.listen.forEach((endpoint, index) => {
    validateListenEndpoint(endpoint, `manifest.permissions.network.listen[${index}]`);
  });
}

function validateSurfaceDeclaration(surface, label) {
  assertPlainObject(surface, label);
  assertAllowedKeys(
    surface,
    label,
    new Set(["defaultPosition", "defaultScreen", "transparent", "alwaysOnTop", "clickThrough", "resizable"])
  );
  if (surface.defaultPosition !== undefined) {
    validatePosition(surface.defaultPosition, `${label}.defaultPosition`);
  }
  validateOptionalString(surface.defaultScreen, `${label}.defaultScreen`);
  for (const field of ["transparent", "alwaysOnTop", "clickThrough", "resizable"]) {
    if (surface[field] !== undefined && typeof surface[field] !== "boolean") {
      fail(`${label}.${field} must be a boolean`);
    }
  }
}

function validateSidecarHealthCheck(value, label) {
  if (value === undefined) return;
  assertPlainObject(value, label);
  assertAllowedKeys(value, label, new Set(["method", "intervalMs", "timeoutMs"]));
  validateExportName(`${label}.method`, value.method);
  if (value.intervalMs !== undefined) {
    validateNumberAtLeast(value.intervalMs, `${label}.intervalMs`, sidecarHealthCheckMinIntervalMs);
  }
  if (value.timeoutMs !== undefined) {
    validateNumberAtLeast(value.timeoutMs, `${label}.timeoutMs`, sidecarHealthCheckMinTimeoutMs);
  }
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

function validateSettingsSchema(schema, label) {
  assertPlainObject(schema, label);
  if (schema.type !== undefined && schema.type !== "object") {
    fail(`${label}.type must be "object"`);
  }
  let properties;
  if (schema.properties !== undefined) {
    properties = assertPlainObject(schema.properties, `${label}.properties`);
  }
  if (schema.required !== undefined) {
    assertStringArray(schema.required, `${label}.required`);
    for (const key of schema.required) {
      if (properties && !Object.prototype.hasOwnProperty.call(properties, key)) {
        fail(`${label}.required references unknown property '${key}'`);
      }
    }
  }
  if (!properties) return;
  for (const [key, property] of Object.entries(properties)) {
    validateSettingsSchemaProperty(property, `${label}.properties.${key}`, key);
  }
}

function validateSettingsSchemaProperty(property, label, key) {
  assertPlainObject(property, label);
  if (typeof property.type !== "string" || !supportedSettingSchemaTypes.has(property.type)) {
    fail(`${label}.type must be one of ${Array.from(supportedSettingSchemaTypes).join(", ")}`);
  }
  if (property["x-bakingrl-secret"] !== undefined && typeof property["x-bakingrl-secret"] !== "boolean") {
    fail(`${label}.x-bakingrl-secret must be a boolean`);
  }
  if (
    property["x-bakingrl-restart-required"] !== undefined &&
    typeof property["x-bakingrl-restart-required"] !== "boolean"
  ) {
    fail(`${label}.x-bakingrl-restart-required must be a boolean`);
  }
  if (property["x-bakingrl-secret"] === true) {
    if (property.type !== "string") {
      fail(`${label}.type must be "string" for secret setting '${key}'`);
    }
    if (Object.prototype.hasOwnProperty.call(property, "default")) {
      fail(`${label}.default is not allowed for secret setting '${key}'`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(property, "default")) {
    validateSettingsSchemaDefault(property.default, property.type, `${label}.default`, key);
  }
}

function validateSettingsSchemaDefault(value, type, label, key) {
  const valid =
    (type === "string" && typeof value === "string") ||
    (type === "number" && typeof value === "number") ||
    (type === "integer" && Number.isInteger(value)) ||
    (type === "boolean" && typeof value === "boolean") ||
    (type === "array" && Array.isArray(value)) ||
    (type === "object" && value !== null && typeof value === "object" && !Array.isArray(value));
  if (!valid) {
    fail(`${label} must match schema type '${type}' for setting '${key}'`);
  }
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

function validateContributesSettings(packageDir, contributes, webviewsById) {
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
    const schemaPath = validateOptionalPathField(packageDir, "manifest.contributes.settings", settings, "schema", "Settings schema");
    validateSettingsSchema(readJson(schemaPath), "manifest.contributes.settings.schema");
  }
  if (Object.prototype.hasOwnProperty.call(settings, "ui")) {
    if (typeof settings.ui !== "string") {
      fail("manifest.contributes.settings.ui must be a webview id");
    }
    validateExportName("manifest.contributes.settings.ui", settings.ui);
    const webview = webviewsById.get(settings.ui);
    if (!webview || webview.kind !== "settings") {
      fail(`manifest.contributes.settings.ui must reference a webview with kind settings (${settings.ui})`);
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
  const webviewsById = new Map();
  for (const [index, webview] of Object.entries(webviews)) {
    const label = `manifest.contributes.webviews[${index}]`;
    assertPlainObject(webview, label);
    const declaresSurface = webview.kind === "surface" || Object.prototype.hasOwnProperty.call(webview, "surface");
    assertAllowedKeys(
      webview,
      label,
      new Set(declaresSurface ? ["id", "entry", "title", "kind", "defaultSize", "surface"] : ["id", "entry", "title", "kind", "defaultSize"])
    );
    validateExportName(`${label}.id`, webview.id);
    if (webviewsById.has(webview.id)) fail(`${label}.id is duplicated`);
    webviewsById.set(webview.id, webview);
    if (webview.entry === undefined) fail(`${label}.entry is required`);
    validateBuiltEntry(packageDir, "contributes.webviews", index, webview);
    validateOptionalString(webview.title, `${label}.title`);
    if (declaresSurface) {
      if (webview.kind !== "surface") fail(`${label}.kind must be surface when ${label}.surface is declared`);
      if (webview.defaultSize === undefined) fail(`${label}.defaultSize is required for surface webviews`);
      if (webview.surface === undefined) fail(`${label}.surface is required for surface webviews`);
      validateDefaultSize(webview.defaultSize, `${label}.defaultSize`);
      validateSurfaceDeclaration(webview.surface, `${label}.surface`);
    } else {
      if (webview.kind !== undefined && !allowedWebviewKinds.has(webview.kind)) {
        fail(`${label}.kind must be tool, settings, panel, or surface`);
      }
      validateDefaultSize(webview.defaultSize, `${label}.defaultSize`);
    }
  }
  return webviewsById;
}

function validateContributionContributions(packageDir, manifest, contributions = [], dependencyIds, extensionPointIds, serviceIds, resourceIds) {
  if (!Array.isArray(contributions)) {
    fail("manifest.contributes.contributions must be an array");
  }
  const ids = new Set();
  for (const [index, contribution] of Object.entries(contributions)) {
    const label = `manifest.contributes.contributions[${index}]`;
    assertPlainObject(contribution, label);
    if (Object.prototype.hasOwnProperty.call(contribution, "visual")) {
      fail(`${label}.visual is not supported in runtime API 2.3; use metadata, resources, or service references`);
    }
    assertAllowedKeys(contribution, label, new Set([
      "id",
      "target",
      "kind",
      "title",
      "description",
      "dataSchema",
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
    if (removedContributeGroups.has(key)) fail(removedContributeGroups.get(key));
    if (!supportedContributionSections.has(key)) fail(`manifest.contributes.${key} is not supported`);
  }
  validateContributionCommands(packageDir, contributes.commands);
  const serviceIds = validateContributionServices(packageDir, contributes.services, sidecarIds);
  const extensionPointIds = validateContributionExtensionPoints(packageDir, contributes.extensionPoints, serviceIds);
  const resourceIds = validateContributionResources(packageDir, contributes.resources);
  const webviewsById = validateContributionWebviews(packageDir, contributes.webviews);
  validateContributionContributions(
    packageDir,
    manifest,
    contributes.contributions,
    dependencyIds,
    extensionPointIds,
    serviceIds,
    resourceIds
  );
  validateContributesSettings(packageDir, contributes, webviewsById);
}

function validatePackageV4(packageDir, manifest) {
  const dependencyIds = validateDependencies(manifest);
  const sidecarIds = validatePackageRuntime(packageDir, manifest);
  validateContributesSection(manifest, packageDir, sidecarIds, dependencyIds);
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
  validateOptionalString(manifest.author, "manifest.author");
  validateManifestPermissions(manifest);
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

function validateListingString(value, label, maximum) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string.`);
  }
  if (value.length > maximum) fail(`${label} must be at most ${maximum} characters.`);
  return value;
}

function parseHttpsUrl(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty HTTPS URL.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") fail(`${label} must use HTTPS.`);
  return parsed;
}

function githubRepoParts(value, label = "marketplace/listing.json repo") {
  const parsed = parseHttpsUrl(value, label);
  if (parsed.hostname !== "github.com") {
    fail(`${label} must use https://github.com/<owner>/<repo>.`);
  }
  const [owner, rawRepo, ...rest] = parsed.pathname.split("/").filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo || rest.length > 0) {
    fail(`${label} must use https://github.com/<owner>/<repo>.`);
  }
  return { owner, repo };
}

function isGitHubRepoUrl(parsed, repoParts, { releaseAsset = false } = {}) {
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parsed.hostname === "github.com") {
    const [owner, rawRepo, segment, action] = parts;
    if (owner !== repoParts.owner || rawRepo?.replace(/\.git$/, "") !== repoParts.repo) return false;
    return releaseAsset ? segment === "releases" && action === "download" : true;
  }
  if (!releaseAsset && parsed.hostname === "raw.githubusercontent.com") {
    const [owner, repo] = parts;
    return owner === repoParts.owner && repo === repoParts.repo;
  }
  return false;
}

function validateOptionalListingUrl(value, label, repoParts) {
  if (value === undefined || value === null) return;
  const parsed = parseHttpsUrl(value, label);
  if (!isGitHubRepoUrl(parsed, repoParts)) {
    fail(`${label} must point to the declared GitHub repository.`);
  }
}

function validateListing(packageDir, { print = true } = {}) {
  const manifest = readPackageManifest(packageDir);
  const listingPath = join(packageDir, "marketplace", "listing.json");
  if (!existsSync(listingPath)) fail(`Missing marketplace/listing.json in ${packageDir}`);
  const listing = readJson(listingPath);
  assertAllowedKeys(
    listing,
    "marketplace/listing.json",
    new Set([
      "schema",
      "packageId",
      "displayName",
      "shortDescription",
      "longDescription",
      "tags",
      "repo",
      "iconUrl",
      "bannerUrl",
      "screenshots",
      "links"
    ])
  );
  requireObjectFields(listing, "marketplace/listing.json", [
    "schema",
    "packageId",
    "displayName",
    "shortDescription",
    "longDescription",
    "tags",
    "repo",
    "screenshots"
  ]);
  if (listing.schema !== "bakingrl.plugin-listing/1") {
    fail("marketplace/listing.json schema must be bakingrl.plugin-listing/1");
  }
  if (listing.packageId !== manifest.id) {
    fail(`marketplace/listing.json packageId must match manifest.id (${manifest.id}).`);
  }
  validateListingString(listing.displayName, "marketplace/listing.json displayName", 120);
  validateListingString(listing.shortDescription, "marketplace/listing.json shortDescription", 180);
  validateListingString(listing.longDescription, "marketplace/listing.json longDescription", 8000);
  if (!Array.isArray(listing.tags) || listing.tags.some((tag) => typeof tag !== "string" || tag.trim() === "")) {
    fail("marketplace/listing.json tags must be an array of non-empty strings.");
  }
  const repo = validateListingString(listing.repo, "marketplace/listing.json repo", 240);
  const repoParts = githubRepoParts(repo);
  validateOptionalListingUrl(listing.iconUrl, "marketplace/listing.json iconUrl", repoParts);
  validateOptionalListingUrl(listing.bannerUrl, "marketplace/listing.json bannerUrl", repoParts);
  if (!Array.isArray(listing.screenshots)) fail("marketplace/listing.json screenshots must be an array.");
  for (const [index, screenshot] of listing.screenshots.entries()) {
    const label = `marketplace/listing.json screenshots[${index}]`;
    assertPlainObject(screenshot, label);
    assertAllowedKeys(screenshot, label, new Set(["url", "alt", "caption"]));
    requireObjectFields(screenshot, label, ["url"]);
    validateOptionalListingUrl(screenshot.url, `${label}.url`, repoParts);
    if (screenshot.alt !== undefined) validateListingString(screenshot.alt, `${label}.alt`, 180);
    if (screenshot.caption !== undefined) validateListingString(screenshot.caption, `${label}.caption`, 240);
  }
  if (listing.links !== undefined) {
    assertPlainObject(listing.links, "marketplace/listing.json links");
    for (const [key, value] of Object.entries(listing.links)) {
      parseHttpsUrl(value, `marketplace/listing.json links.${key}`);
    }
  }
  if (print) console.log(`Marketplace author listing validation passed: ${manifest.id}`);
  return { listing, manifest, repoParts };
}

function submissionPlatform(options) {
  const value = options.platform === undefined || options.platform === true ? "any" : String(options.platform).trim();
  if (!supportedSubmissionPlatforms.has(value)) {
    fail(`--platform must be one of: ${Array.from(supportedSubmissionPlatforms).join(", ")}.`);
  }
  return value;
}

function submissionRuntime(manifest, artifactPlatform) {
  const sidecars = (manifest.runtime?.sidecars ?? []).map((sidecar) => {
    const platforms = sidecar.platforms?.length > 0 ? [...sidecar.platforms] : [artifactPlatform];
    for (const platform of platforms) {
      if (!supportedSubmissionPlatforms.has(platform)) {
        fail(`manifest.runtime.sidecars '${sidecar.id}' uses unsupported marketplace platform '${platform}'.`);
      }
    }
    return { id: sidecar.id, platforms };
  });
  const webviews = (manifest.contributes?.webviews ?? []).map((webview) => ({
    id: webview.id,
    kind: webview.kind ?? "tool"
  }));
  return {
    node: Boolean(manifest.runtime?.node),
    sidecars,
    webviews
  };
}

function emptyManifestPermissions() {
  return {
    bus: { read: [], publish: [] },
    registry: { read: [], write: [] },
    network: { http: [], websocket: [], listen: [] },
    storage: { read: [], write: [] }
  };
}

function findBundlePath(packageDir, manifest) {
  const bundlePath = join(packageDir, "dist-bundles", `${manifest.id}-${manifest.version}.brlp`);
  if (!existsSync(bundlePath)) fail(`Missing packed bundle: ${bundlePath}`);
  return bundlePath;
}

function readSignaturePublicKey(packageDir) {
  const signaturePath = join(packageDir, "signature.ed25519");
  if (!existsSync(signaturePath)) {
    fail("Missing signature.ed25519. Run pack --sign before preparing a marketplace submission.");
  }
  const signature = readJson(signaturePath);
  if (signature.algorithm !== "ed25519" || typeof signature.publicKey !== "string" || signature.publicKey.trim() === "") {
    fail("signature.ed25519 must contain an Ed25519 publicKey.");
  }
  return signature.publicKey;
}

function writeOrPrintJson(value, outputPath) {
  if (!outputPath) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeJson(outputPath, value);
}

function prepareSubmission(packageDir, args) {
  const options = parseOptions(args);
  const developerId = requireOption(options, "developer", "--developer");
  validatePackageId(developerId, "--developer");
  const manifest = validatePackage(packageDir, { print: false });
  const { listing, repoParts } = validateListing(packageDir, { print: false });
  const bundlePath = options.bundle
    ? resolve(process.cwd(), requireOption(options, "bundle", "--bundle"))
    : findBundlePath(packageDir, manifest);
  if (!existsSync(bundlePath) || !statSync(bundlePath).isFile()) fail(`Bundle does not exist: ${bundlePath}`);

  const bundleUrl = requireOption(options, "bundle_url", "--bundle-url");
  if (!isGitHubRepoUrl(parseHttpsUrl(bundleUrl, "--bundle-url"), repoParts, { releaseAsset: true })) {
    fail("--bundle-url must be a GitHub release asset from the listing repository.");
  }
  const listingUrl = requireOption(options, "listing_url", "--listing-url");
  if (!isGitHubRepoUrl(parseHttpsUrl(listingUrl, "--listing-url"), repoParts)) {
    fail("--listing-url must point to the listing repository.");
  }
  const platform = submissionPlatform(options);

  const submission = {
    schema: "bakingrl.marketplace-submission/1",
    packageId: manifest.id,
    developerId,
    version: manifest.version,
    runtimeApi: manifest.bakingrlApi,
    repo: listing.repo,
    listingUrl,
    listing,
    dependencies: (manifest.dependencies ?? []).map((dependency) => ({
      packageId: dependency.packageId,
      version: dependency.version,
      optional: dependency.optional ?? false
    })),
    runtime: submissionRuntime(manifest, platform),
    artifacts: [
      {
        platform,
        bundleUrl,
        bundleSha256: sha256File(bundlePath),
        signaturePublicKey: readSignaturePublicKey(packageDir)
      }
    ],
    permissions: manifest.permissions ?? emptyManifestPermissions(),
    generatedAt: new Date().toISOString()
  };
  const outputPath = options.output ? resolve(process.cwd(), String(options.output)) : null;
  writeOrPrintJson(submission, outputPath);
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
    permissions: manifest.permissions ?? null,
    sidecars: (manifest.runtime?.sidecars ?? []).map((sidecar) => sidecar.id),
    contributes: {
      commands: (manifest.contributes?.commands ?? []).map((command) => command.id),
      services: (manifest.contributes?.services ?? []).map((service) => service.id),
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
    permissions: manifest.permissions ?? null,
    dependencies: manifest.dependencies ?? [],
    runtime: manifest.runtime,
    contributes: manifest.contributes ?? {}
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
  if (command === "validate-listing") return validateListing(packageDir);
  if (command === "prepare-submission" || command === "submission") {
    const options = parseOptions(args);
    const submissionDir = resolve(process.cwd(), options.positional[0] ?? ".");
    return prepareSubmission(submissionDir, args);
  }
  if (command === "doctor") return doctor(packageDir);
  if (command === "pack") {
    const keyIndex = args.indexOf("--sign");
    const keyPath = keyIndex === -1 ? null : args[keyIndex + 1];
    if (keyIndex !== -1 && !keyPath) fail("Usage: node scripts/bakingrl-plugin.mjs pack [package-dir] [--sign <key-file>]");
    const explicitDir = args.find(
      (arg, index) =>
        !arg.startsWith("-") &&
        (keyIndex === -1 || (index !== keyIndex && index !== keyIndex + 1))
    );
    return pack(resolve(process.cwd(), explicitDir ?? "."), keyPath);
  }
  if (command === "inspect") return inspect(packageDir);
  if (command === "install-local") return installLocal(packageDir);
  if (command === "packages-dir") {
    console.log(appDataDir());
    return;
  }
  fail("Usage: node scripts/bakingrl-plugin.mjs <validate|doctor|validate-listing|pack|inspect|install-local|packages-dir> [package-dir]\n       node scripts/bakingrl-plugin.mjs keygen [key-file]\n       node scripts/bakingrl-plugin.mjs sign --key <key-file> [package-dir]\n       node scripts/bakingrl-plugin.mjs pack [package-dir] [--sign <key-file>]\n       node scripts/bakingrl-plugin.mjs prepare-submission [package-dir] --developer <id> --bundle-url <url> --listing-url <url> [--bundle <path>] [--platform <platform>] [--output <path>]");
}

main();
