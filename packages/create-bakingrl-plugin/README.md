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
(`2.0.0`). The helper validates the exact current V4 contract,
`bakingrlApi: "2.0.0"`.

Current templates are `extension-plugin`, `overlay-plugin`, and
`native-sidecar-plugin`. Package-level settings schema moved to
`contributes.settings.schema` and remains host-owned. Visual entries are
declared through `contributes.visuals` with an `id` and JS entry.
