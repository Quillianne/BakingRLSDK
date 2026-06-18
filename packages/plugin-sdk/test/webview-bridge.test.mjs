import assert from "node:assert/strict";
import test from "node:test";
import { createWebviewBridge } from "../dist/index.js";

function createEndpoint() {
  const messages = [];
  const handlers = new Set();
  return {
    messages,
    endpoint: {
      postMessage(message) {
        messages.push(message);
      },
      onMessage(handler) {
        handlers.add(handler);
        return {
          dispose() {
            handlers.delete(handler);
          }
        };
      }
    },
    emit(message) {
      for (const handler of [...handlers]) handler(message);
    },
    handlerCount() {
      return handlers.size;
    }
  };
}

test("createWebviewBridge posts BakingRL host protocol messages", async () => {
  const harness = createEndpoint();
  const bridge = createWebviewBridge(harness.endpoint);

  await bridge.ready();
  await bridge.post("custom:event", { value: 42 });

  assert.deepEqual(harness.messages[0], {
    source: "bakingrl-webview",
    type: "bakingrl:webview:ready"
  });
  assert.deepEqual(harness.messages[1], {
    source: "bakingrl-webview",
    type: "custom:event",
    payload: { value: 42 }
  });
});

test("createWebviewBridge resolves host result messages by id", async () => {
  const harness = createEndpoint();
  const bridge = createWebviewBridge(harness.endpoint);

  const result = bridge.request("bakingrl:asset-url", { ref: "resources/logo.svg" });
  const request = harness.messages[0];

  assert.equal(request.source, "bakingrl-webview");
  assert.equal(request.type, "bakingrl:asset-url");
  assert.deepEqual(request.payload, { ref: "resources/logo.svg" });
  assert.equal(typeof request.id, "string");
  assert.equal(harness.handlerCount(), 1);

  harness.emit({
    source: "bakingrl-host",
    type: "bakingrl:asset-url:result",
    id: request.id,
    payload: {
      ref: "resources/logo.svg",
      url: "http://localhost/package/resources/logo.svg"
    }
  });

  assert.deepEqual(await result, {
    ref: "resources/logo.svg",
    url: "http://localhost/package/resources/logo.svg"
  });
  assert.equal(harness.handlerCount(), 0);
});

test("createWebviewBridge rejects host result payload errors", async () => {
  const harness = createEndpoint();
  const bridge = createWebviewBridge(harness.endpoint);

  const result = bridge.request("bakingrl:configuration-settings-save", { values: {} });
  const request = harness.messages[0];

  harness.emit({
    source: "bakingrl-host",
    type: "bakingrl:configuration-settings-save:result",
    id: request.id,
    payload: {
      error: "settings rejected"
    }
  });

  await assert.rejects(result, /settings rejected/);
  assert.equal(harness.handlerCount(), 0);
});

test("createWebviewBridge filters incoming messages to the host source", async () => {
  const harness = createEndpoint();
  const bridge = createWebviewBridge(harness.endpoint);
  const received = [];

  const subscription = bridge.on((message) => {
    received.push(message.type);
  });

  harness.emit({ source: "other", type: "ignored" });
  harness.emit({ source: "bakingrl-host", type: "bakingrl:webview:init" });
  harness.emit({ source: "bakingrl-host", type: "bakingrl:webview:update" });
  subscription.dispose();
  harness.emit({ source: "bakingrl-host", type: "after-dispose" });

  assert.deepEqual(received, ["bakingrl:webview:init", "bakingrl:webview:update"]);
});

test("createWebviewBridge still accepts generic response messages", async () => {
  const harness = createEndpoint();
  const bridge = createWebviewBridge(harness.endpoint);

  const result = bridge.request("custom:request", { ok: true });
  const request = harness.messages[0];

  harness.emit({
    source: "bakingrl-host",
    type: "response",
    requestId: request.id,
    payload: { ok: true }
  });

  assert.deepEqual(await result, { ok: true });
});
