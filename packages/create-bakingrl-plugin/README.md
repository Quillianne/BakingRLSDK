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
(`2.4.0`). The helper validates the current V4 contract and accepts package
manifests in the `2.3.x` through `2.4.x` runtime API window, with `2.3.0` as
the minimum supported version. Presentation metadata requires
`bakingrlApi: "2.4.0"` or newer.

Current templates are `extension-plugin`, `native-sidecar-plugin`,
`platform-plugin`, `contributor-plugin`, and
`content-pack-plugin`. Package-level settings schema moved to
`contributes.settings.schema` and remains host-owned. Custom settings UI uses
`contributes.settings.ui` to reference a declared webview with
`kind: "settings"`. Webviews, extension points, contributions, resources, and
services are declared through `contributes`.

Every template also includes an author-owned `marketplace/listing.json`.
`validate-listing` checks that file, while `prepare-submission` emits unsigned
review input for the marketplace repository. It does not create an approved
catalogue entry or a signed marketplace index.
