# Quarkdown Documentation Source

`main.qd` is the landing page of the public BakingRL SDK documentation. Each
chapter lives in `chapters/` and is linked as a Quarkdown subdocument, so the
generated site contains one HTML page per chapter.

This source is English-only for now. Future French documentation should use a
separate source directory or build target with the same stable slugs, instead
of mixing languages inside the same page.

```txt
main.qd
_nav.qd
_setup.qd
chapters/
  introduction.qd
  getting-started.qd
  authoring-workflows.qd
  sdk-api.qd
  plugin-package-format.qd
  package-cli.qd
  security-model.qd
  telemetry-types.qd
```

Build:

```sh
npm run docs:build
```

The build script uses `--subdoc-naming file-name` so generated URLs stay stable
when pages move inside `docs-src/`.

Each page defines `.docname`; do not repeat that title as the first Markdown
heading, otherwise Quarkdown renders a duplicate visible title.

Live preview:

```sh
npm run docs:dev
```

Install Quarkdown first:

```sh
curl -fsSL https://raw.githubusercontent.com/quarkdown-labs/get-quarkdown/refs/heads/main/install.sh | sudo env "PATH=$PATH" bash
```
