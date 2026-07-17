import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  RL_TELEMETRY_EVENT_NAMES,
  RL_TELEMETRY_FRAME_TEMPLATES,
  MIN_SUPPORTED_RUNTIME_API_VERSION,
  RUNTIME_API_VERSION,
  SDK_VERSION,
  createExtensionTarget,
  createResourceRef,
  isBakingRLEvent,
  mockRocketLeagueEvent,
  telemetryFrameTemplate,
  parseExtensionTarget
} from "../dist/index.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedTelemetryEventNames = [
  "UpdateState",
  "BallHit",
  "ClockUpdatedSeconds",
  "CountdownBegin",
  "CrossbarHit",
  "GoalReplayEnd",
  "GoalReplayStart",
  "GoalReplayWillEnd",
  "GoalScored",
  "MatchCreated",
  "MatchInitialized",
  "MatchDestroyed",
  "MatchEnded",
  "MatchPaused",
  "MatchUnpaused",
  "PodiumStart",
  "ReplayCreated",
  "ReplayWillEnd",
  "RoundStarted",
  "StatfeedEvent"
];

test("exports SDK and runtime API contract constants", () => {
  const packageJson = JSON.parse(readFileSync(resolve(packageDir, "package.json"), "utf8"));

  assert.equal(SDK_VERSION, packageJson.version);
  assert.equal(RUNTIME_API_VERSION, "2.4.0");
  assert.equal(MIN_SUPPORTED_RUNTIME_API_VERSION, "2.3.0");
});

test("exports manifest V4 author-facing declarations", () => {
  const declarations = readFileSync(resolve(packageDir, "dist", "index.d.ts"), "utf8");

  assert.match(declarations, /export type BakingRLCompatibleApiVersion = `2\.\$\{3 \| 4\}\.\$\{number\}`;/);
  assert.match(declarations, /export type PluginManifestV4Contributes = \{/);
  assert.match(declarations, /contributions\?: ContributionContribution\[\];/);
  assert.match(declarations, /resources\?: ContributionResource\[\];/);
  assert.match(declarations, /export type PluginManifestV4 = \{/);
  assert.match(declarations, /schemaVersion: "bakingrl\.plugin\/4";/);
  assert.match(declarations, /bakingrlApi: BakingRLCompatibleApiVersion;/);
  assert.match(declarations, /export type PluginPresentation = \{[\s\S]*categories\?: string\[\];[\s\S]*primaryAction\?: PluginPrimaryAction;/);
  assert.match(declarations, /presentation\?: PluginPresentation;/);
  assert.match(declarations, /permissions\?: PluginPermissions;/);
  assert.match(declarations, /export type PluginGraphResource = ContributionResource & \{/);
  assert.match(declarations, /public: boolean;/);
  assert.match(declarations, /export type PluginGraphContributes = Omit<PluginManifestV4Contributes, "resources"> & \{/);
  assert.match(declarations, /contributes: PluginGraphContributes;/);
});

test("exports runtime API 2.3 permissions, surfaces, and storage contracts", () => {
  const declarations = readFileSync(resolve(packageDir, "dist", "index.d.ts"), "utf8");

  assert.match(declarations, /export type NetworkEndpoint = \{[\s\S]*scheme: "http" \| "https" \| "ws" \| "wss";[\s\S]*ports: "\*" \| number\[\];[\s\S]*pathPrefixes\?: string\[\];/);
  assert.match(declarations, /export type ListenEndpoint = \{[\s\S]*transport: "http" \| "https" \| "ws" \| "wss" \| "tcp";/);
  assert.match(declarations, /export type PluginPermissions = \{[\s\S]*bus: \{[\s\S]*publish: PermissionPattern\[\];[\s\S]*network: \{[\s\S]*listen: ListenEndpoint\[\];[\s\S]*storage: \{/);
  assert.match(declarations, /export type SurfaceDeclaration = \{[\s\S]*kind: "surface";[\s\S]*defaultSize: \[number, number\];[\s\S]*clickThrough\?: boolean;[\s\S]*resizable\?: boolean;/);
  assert.match(declarations, /export type ContributionWebview = StandardContributionWebview \| SurfaceDeclaration;/);
  assert.match(declarations, /export type WebviewOpenState = SurfaceState \| StandardWebviewState;/);
  assert.match(declarations, /open\(id: string, options\?: WebviewOpenOptions\): Promise<WebviewOpenState>;/);
  assert.doesNotMatch(declarations, /storagePath: string;/);
  assert.match(declarations, /export type PluginStorage = \{[\s\S]*readJson<T extends JsonValue = JsonValue>\(path: string\): Promise<T>;[\s\S]*writeJson\(path: string, value: JsonValue\): Promise<void>;[\s\S]*list\(prefix\?: string\): Promise<string\[\]>;[\s\S]*delete\(path: string\): Promise<boolean>;[\s\S]*usage\(\): Promise<\{/);
});

test("exports render bundle and author submission contracts without a catalogue schema", () => {
  const declarations = readFileSync(resolve(packageDir, "dist", "index.d.ts"), "utf8");

  assert.match(declarations, /export type RenderBundleV1 = \{[\s\S]*schema: "bakingrl\.render-bundle\/1";[\s\S]*initialData: Record<string, JsonValue>;/);
  assert.match(declarations, /export type PluginAuthorListingV1 = \{[\s\S]*schema: "bakingrl\.plugin-listing\/1";/);
  assert.match(declarations, /export type MarketplaceSubmissionRuntime = \{[\s\S]*node: boolean;[\s\S]*kind: "tool" \| "settings" \| "panel" \| "surface";/);
  assert.match(declarations, /export type MarketplaceSubmissionV1 = \{[\s\S]*schema: "bakingrl\.marketplace-submission\/1";[\s\S]*listing: PluginAuthorListingV1;[\s\S]*dependencies: MarketplaceSubmissionDependency\[\];[\s\S]*runtime: MarketplaceSubmissionRuntime;[\s\S]*permissions: PluginPermissions;/);
  assert.doesNotMatch(declarations, /bakingrl\.marketplace\/2/);
});

test("exports host-mediated webview context declarations", () => {
  const declarations = readFileSync(resolve(packageDir, "dist", "index.d.ts"), "utf8");

  assert.match(declarations, /export type AssetResolver = \{[\s\S]*url\(ref: string\): string \| Promise<string>;/);
  assert.match(declarations, /export type ConfigurationState = \{[\s\S]*hasSettingsWebview: boolean;[\s\S]*secrets: ConfigurationSecretState\[\];/);
  assert.doesNotMatch(declarations, /hasCustomPage/);
  assert.match(declarations, /export type WebviewPackageInfo = \{/);
  assert.match(declarations, /export type WebviewRuntimeInfo = \{/);
  assert.match(declarations, /export type WebviewItemDescriptor = \{/);
  assert.match(declarations, /export type WebviewStateController = \{/);
  assert.match(declarations, /export type WebviewSecretReader = \{/);
  assert.match(declarations, /export type WebviewContext = \{[\s\S]*package\?: WebviewPackageInfo;[\s\S]*runtime\?: WebviewRuntimeInfo;[\s\S]*services\?: ServiceCaller;[\s\S]*assets\?: AssetResolver;[\s\S]*diagnostics\?: ExtensionDiagnostics;[\s\S]*secrets\?: WebviewSecretReader;[\s\S]*setActive\?\(active: boolean\): void \| Promise<void>;/);
});

test("exports stable Rocket League telemetry templates and guards", () => {
  assert.deepEqual(RL_TELEMETRY_EVENT_NAMES, expectedTelemetryEventNames);

  for (const eventName of expectedTelemetryEventNames) {
    const template = RL_TELEMETRY_FRAME_TEMPLATES[eventName];
    assert.equal(template.Event, eventName);
    assert.ok(isBakingRLEvent(template, eventName));

    const cloned = telemetryFrameTemplate(eventName);
    assert.notEqual(cloned, template);
    assert.notEqual(cloned.Data, template.Data);

    cloned.Data.__testMutation = true;
    assert.equal(RL_TELEMETRY_FRAME_TEMPLATES[eventName].Data.__testMutation, undefined);

    const mock = mockRocketLeagueEvent(eventName, { MatchGuid: `mock-${eventName}` });
    assert.equal(mock.Event, eventName);
    assert.equal(mock.Data.MatchGuid, `mock-${eventName}`);
  }

  assert.equal(isBakingRLEvent(null), false);
  assert.equal(isBakingRLEvent({ Event: "UpdateState" }, "UpdateState"), false);
  assert.equal(isBakingRLEvent({ Event: "GoalScored", Data: {} }, "UpdateState"), false);
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
