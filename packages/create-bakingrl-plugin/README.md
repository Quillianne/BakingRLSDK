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
cd my-package
npm install
npm run build
npm run pack
```

## Helper CLI

Generated packages include `scripts/bakingrl-plugin.mjs`, but the global
`bakingrl-plugin` command can also validate, pack, inspect, sign, and install
plugin packages during development.

New packages declare `compatibility.runtimeApi` with the current BakingRL
runtime API (`0.4.0`). The helper refuses to validate packages that omit it or
target an incompatible runtime API range.

The current template can be extended with visuals, components, services, and
connectors through `npm run add -- <type> <name>`. Package-level `settings`
schemas render host-owned settings forms, and `exports.configuration` is
available when a plugin needs a private fixed-size custom configuration page.
