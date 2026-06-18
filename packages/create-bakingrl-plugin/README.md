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
create-bakingrl-plugin platform-package --template platform-plugin
create-bakingrl-plugin contributor-package --template contributor-plugin
create-bakingrl-plugin content-package --template content-pack-plugin
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
package manifests in the `>=2.0.0 <=2.1.x` runtime API window. Manifests that
declare `2.2.0` or newer require a newer host and are rejected by this target
validator.

Current templates are `extension-plugin`, `overlay-plugin`,
`native-sidecar-plugin`, `platform-plugin`, `contributor-plugin`, and
`content-pack-plugin`. Package-level settings schema moved to
`contributes.settings.schema` and remains host-owned. Browser visuals,
webviews, extension points, contributions, and resources are declared through
`contributes`.
