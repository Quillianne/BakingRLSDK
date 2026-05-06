# BakingRL SDK

BakingRL SDK contains the TypeScript contracts, helper functions, and package
scaffolding tools used to build BakingRL plugin packages.

This repository is for plugin authors. If you want to run the desktop
application, use the `BakingRL` repository. If you want maintained first-party
plugins, use the `BakingRLPlugins` repository.

## What You Can Build

A BakingRL plugin package can expose one or more capabilities:

- Visuals rendered in overlays, OBS browser sources, or custom pages.
- Components imported by other visual exports through the host.
- Services running in a sandboxed backend runtime.
- Connectors with explicit host-mediated HTTP and WebSocket permissions.
- Page templates that users can import into BakingRL.

## Repository Layout

```txt
packages/plugin-sdk/              TypeScript SDK published as @bakingrl/plugin-sdk
packages/create-bakingrl-plugin/  Scaffolder and package helper CLI
docs-src/                         Quarkdown source for public documentation
docs-site/                        Generated site output, ignored locally
```

## Local Setup

```sh
npm install
npm run check
```

## Local Global Install

Until the SDK and scaffolder are published to npm, install this checkout
globally:

```sh
cd BakingRLSDK
npm install
npm install -g .
```

This exposes two commands:

```sh
create-bakingrl-plugin
bakingrl-plugin
```

When installed from the repository root, generated packages automatically use
the SDK from this checkout:

```json
"@bakingrl/plugin-sdk": "file:../../BakingRLSDK/packages/plugin-sdk"
```

After editing SDK types or runtime helpers, rebuild the SDK:

```sh
npm run build
```

If you changed the generator, package helper, templates, or global command
metadata, refresh the global local install:

```sh
npm install -g . --force
```

Create a plugin package from this local checkout without global install:

```sh
npm run create -- my-package
cd my-package
npm install
npm run build
npm run pack
npm run install:local
```

The generated package uses the local SDK while you are working before npm
publication. Published scaffolds will use the published package version of
`@bakingrl/plugin-sdk`.

## Documentation

Detailed documentation is authored with Quarkdown under [docs-src](docs-src).
[docs-src/main.qd](docs-src/main.qd) is the landing page; actual chapters live
in [docs-src/chapters](docs-src/chapters) and are generated as separate
subdocument pages. The generated output is intended for GitHub Pages.

Install Quarkdown:

```sh
curl -fsSL https://raw.githubusercontent.com/quarkdown-labs/get-quarkdown/refs/heads/main/install.sh | sudo env "PATH=$PATH" bash
```

Build the documentation site:

```sh
npm run docs:build
```

Live preview:

```sh
npm run docs:dev
```

## Compatibility

This SDK targets BakingRL plugin package schema `bakingrl.plugin/2` and SDK
version `0.2.x`.
