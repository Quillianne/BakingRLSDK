# @bakingrl/plugin-sdk

TypeScript contracts and helpers for BakingRL plugin packages.

## Install

```sh
npm install @bakingrl/plugin-sdk
```

## Usage

```ts
import { defineWebview, type WebviewContext } from "@bakingrl/plugin-sdk";

export default defineWebview({
  async mount(context: WebviewContext) {
    const settings = await context.settings.get();
    const snapshot = await context.telemetryHub.snapshot<"UpdateState">();
    context.root.textContent = String(settings.title ?? snapshot?.Data.MatchGuid ?? "Tool");
  }
});
```

Extensions can register commands and services:

```ts
import { defineExtension, type ExtensionContext } from "@bakingrl/plugin-sdk";

export const activate = defineExtension({
  activate(context: ExtensionContext) {
    context.services.register("echo", {
      ping(input) {
        return { ok: true, input };
      }
    });
  }
}).activate;
```

Browser webview entries can use the host bridge without copying the internal
`postMessage` protocol:

```ts
import { createWebviewBridge } from "@bakingrl/plugin-sdk";

const bridge = createWebviewBridge();
bridge.ready();

const asset = await bridge.request<{ url: string }>("bakingrl:asset-url", {
  ref: "resources/logo.svg"
});
```

This SDK targets BakingRL trusted plugin package schema `bakingrl.plugin/4`,
SDK version `2.2.0`, and `bakingrlApi: "2.2.0"` for the current V4 runtime
contract. Compatible packages target `2.2.x`; manifests outside `2.2.x`
require a different host target.

See the repository `docs-src/` documentation for the full SDK API, manifest
format, telemetry types, and security model.
