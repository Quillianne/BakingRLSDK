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
  }
});
```

This SDK targets BakingRL plugin package schema `bakingrl.plugin/2` and runtime
API `0.4.0`. Current BakingRL hosts support `>=0.4.0 <0.5.0`.

See the repository `docs-src/` documentation for the full SDK API, manifest
format, telemetry types, and security model.
