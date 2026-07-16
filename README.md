# BakingRL SDK

BakingRL SDK contains the TypeScript contracts, helper functions, and package
scaffolding tools used to build BakingRL plugin packages.

This repository is for plugin authors. If you want to run the desktop
application, use the `BakingRL` repository. If you want maintained first-party
plugins, use the `BakingRLPlugins` repository.

## What You Can Build

A BakingRL plugin package can expose one or more runtime surfaces:

- A Node extension host with `activate(context)` and `deactivate()`.
- Commands and services registered from extension host code.
- Host-opened browser webviews for tools, settings, panels, and desktop
  surfaces.
- Plugin extension points and contributions for host-mediated plugin chains.
- Public and private package resources consumed through host policy.
- First-class native Rust or system sidecars supervised over JSON-RPC stdio.
- Host-owned package settings, secret metadata, resources, schemas,
  diagnostics, telemetry, and plugin graph mediation.

## Repository Layout

```txt
packages/plugin-sdk/              TypeScript SDK published as @bakingrl/plugin-sdk
packages/create-bakingrl-plugin/  Scaffolder and package helper CLI published as @bakingrl/create-plugin
docs-src/                         Quarkdown source for public documentation
docs-site/                        Generated site output, ignored locally
```

## Local Setup

```sh
npm install
npm run check
```

## Published Install

Install the published scaffolder and helper CLI globally:

```sh
npm install -g @bakingrl/create-plugin
```

This exposes two commands:

```sh
create-bakingrl-plugin
bakingrl-plugin
```

Create a plugin package:

```sh
create-bakingrl-plugin my-package
cd my-package
npm install
npm run build
npm run pack
```

Published scaffolds use the published SDK package:

```json
"@bakingrl/plugin-sdk": "^2.3.0"
```

## Local Global Install

When developing this SDK repository itself, install this checkout globally:

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

The generated package uses the local SDK while you are working in this checkout.

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

This SDK targets BakingRL plugin package schema `bakingrl.plugin/4`, SDK
version `2.3.0`, and `bakingrlApi: "2.3.0"` for the current V4 runtime
contract. The helper CLI accepts only the `2.3.x` runtime API window, with
`2.3.0` as the minimum supported version. There is no legacy path adapter or
automatic storage migration in this SDK.
