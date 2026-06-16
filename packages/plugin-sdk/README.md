# @bakingrl/plugin-sdk

TypeScript contracts and helpers for BakingRL plugin packages.

## Install

```sh
npm install @bakingrl/plugin-sdk
```

## Usage

```ts
import { defineVisual, type VisualContext } from "@bakingrl/plugin-sdk";

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

This SDK targets BakingRL trusted plugin package schema `bakingrl.plugin/3`,
SDK version `1.0.2`, and runtime API `1.0.0`. Current BakingRL hosts support
`>=1.0.0 <2.0.0`.

See the repository `docs-src/` documentation for the full SDK API, manifest
format, telemetry types, and security model.
