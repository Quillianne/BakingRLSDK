import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  RL_TELEMETRY_EVENT_NAMES,
  RL_TELEMETRY_FRAME_TEMPLATES,
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

test("exports host-mediated webview context declarations", () => {
  const declarations = readFileSync(resolve(packageDir, "dist", "index.d.ts"), "utf8");

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
