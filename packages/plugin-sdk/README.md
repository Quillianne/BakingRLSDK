# @bakingrl/plugin-sdk

TypeScript contracts and helpers for BakingRL plugin packages.

## Install

```sh
npm install @bakingrl/plugin-sdk
```

## Usage

```ts
import { defineVisual, defineWebview, type VisualContext, type WebviewContext } from "@bakingrl/plugin-sdk";

export default defineVisual({
  mount(context: VisualContext) {
    context.root.textContent = "Hello BakingRL";
  },
  editor: {
    mount(context: VisualContext) {
      context.root.textContent = "Editor preview";
    },
    actions() {
      return [
        {
          id: "trigger",
          label: "Trigger",
          run(context: VisualContext) {
            context.root.textContent = "Triggered";
          }
        }
      ];
    }
  }
});
```

Declared webviews export a `mount(context)` module too:

```ts
export default defineWebview({
  async mount(context: WebviewContext) {
    const settings = await context.settings.get();
    context.root.textContent = String(settings.title ?? "Tool");
  }
});
```

This SDK targets BakingRL trusted plugin package schema `bakingrl.plugin/4`,
SDK version `2.1.1`, and `bakingrlApi: "2.1.0"` for the current V4 runtime
contract.

See the repository `docs-src/` documentation for the full SDK API, manifest
format, telemetry types, and security model.
