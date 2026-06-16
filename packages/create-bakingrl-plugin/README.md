# @bakingrl/create-plugin

Scaffolder and helper CLI for BakingRL plugin packages.

## Install

```sh
npm install -g @bakingrl/create-plugin
```

This exposes:

```sh
create-bakingrl-plugin
bakingrl-plugin
```

## Create A Package

```sh
create-bakingrl-plugin my-package
create-bakingrl-plugin overlay-package --template overlay-plugin
create-bakingrl-plugin native-package --template native-sidecar-plugin
cd my-package
npm install
npm run build
npm run pack
```

## Helper CLI

Generated packages include `scripts/bakingrl-plugin.mjs`, but the global
`bakingrl-plugin` command can also validate, diagnose, pack, inspect, sign,
and install trusted v3 plugin packages during development.

New packages declare `compatibility.runtimeApi` with the current BakingRL
runtime API (`1.0.0`). The helper refuses to validate packages that omit it or
target outside `>=1.0.0 <2.0.0`.

Current templates are `extension-plugin`, `overlay-plugin`, and
`native-sidecar-plugin`. Package-level `settings` schemas render host-owned
settings forms, and custom UI is declared through `contributes.webviews`,
`contributes.pages`, or `contributes.overlays`.
