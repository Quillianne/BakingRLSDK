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
and install V4 plugin packages during development.

New packages declare `bakingrlApi` with the current BakingRL runtime API
(`2.1.0`). The helper validates the current V4 contract and accepts compatible
`2.x` package manifests up to the current runtime API.

Current templates are `extension-plugin`, `overlay-plugin`, and
`native-sidecar-plugin`. Package-level settings schema moved to
`contributes.settings.schema` and remains host-owned. Browser visuals,
webviews, extension points, contributions, and resources are declared through
`contributes`.
