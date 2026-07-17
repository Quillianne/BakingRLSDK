import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import test from "node:test";
import assert from "node:assert/strict";

const cli = fileURLToPath(new URL("../lib/bakingrl-plugin.mjs", import.meta.url));
const createCli = fileURLToPath(new URL("../bin/create-bakingrl-plugin.mjs", import.meta.url));
const sidecarBin = "sidecars/native-helper/bin";
const legacyContributes = ["pages", "views", "overlays", "configuration", "visuals", "assets", "schemas"];

function withPackage(manifest, callback) {
  const dir = mkdtempSync(join(tmpdir(), "bakingrl-sdk-validate-"));
  try {
    writeFileSync(join(dir, "bakingrl.plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function validatePackage(manifest, setupPackage) {
  return withPackage(manifest, (dir) => {
    setupPackage?.(dir);
    execFileSync(process.execPath, [cli, "validate", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  });
}

function validatePackageFailure(manifest, setupPackage) {
  return withPackage(manifest, (dir) => {
    setupPackage?.(dir);
    try {
      execFileSync(process.execPath, [cli, "validate", dir], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      assert.fail("Expected package validation to fail");
    } catch (error) {
      return `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }
  });
}

function withTempDir(callback) {
  const dir = mkdtempSync(join(tmpdir(), "bakingrl-sdk-template-"));
  try {
    return callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function scaffoldPackage(root, name, template) {
  execFileSync(process.execPath, [createCli, name, "--template", template], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return join(root, name);
}

function writeGeneratedEntry(packageDir, relativePath) {
  const path = join(packageDir, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "export default {};\n");
}

function writeTextEntry(packageDir, relativePath, contents) {
  const path = join(packageDir, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function writeNodePackage(packageDir, contents = "export function activate() {}\nexport function deactivate() {}\n") {
  writeJsonEntry(packageDir, "package.json", { type: "module" });
  writeTextEntry(packageDir, "dist/extension/index.js", contents);
}

function writeJsonEntry(packageDir, relativePath, value) {
  const path = join(packageDir, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function validateGeneratedPackage(packageDir) {
  execFileSync(process.execPath, [join(packageDir, "scripts", "bakingrl-plugin.mjs"), "validate", packageDir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runCliFailure(args, { cwd = tmpdir(), env = process.env } = {}) {
  try {
    execFileSync(process.execPath, [cli, ...args], {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    assert.fail("Expected helper CLI command to fail");
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

async function waitForValue(callback, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = callback();
    if (value) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function waitForChild(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
  });
}

function assertGeneratedV4Manifest(packageDir, expectedId) {
  const manifest = readJson(join(packageDir, "bakingrl.plugin.json"));
  const packageJson = readJson(join(packageDir, "package.json"));
  const listing = readJson(join(packageDir, "marketplace", "listing.json"));
  assert.equal(manifest.schemaVersion, "bakingrl.plugin/4");
  assert.equal(manifest.bakingrlApi, "2.3.0");
  assert.equal(manifest.id, expectedId);
  assert.deepEqual(manifest.permissions, emptyPermissions());
  assert.equal(listing.schema, "bakingrl.plugin-listing/1");
  assert.equal(listing.packageId, expectedId);
  assert.equal(packageJson.scripts["validate:listing"], "node scripts/bakingrl-plugin.mjs validate-listing");
  assert.equal(packageJson.scripts.submission, "node scripts/bakingrl-plugin.mjs prepare-submission");
  execFileSync(process.execPath, [join(packageDir, "scripts", "bakingrl-plugin.mjs"), "validate-listing", packageDir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(manifest.compatibility, undefined);
  assert.equal(manifest.externalSurfaces, undefined);
  for (const group of legacyContributes) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(manifest.contributes ?? {}, group),
      false,
      `generated ${expectedId} should not declare contributes.${group}`
    );
  }
  return manifest;
}

function expectedIdForScaffold(name) {
  return `com.example.${name.replaceAll("-", "_")}`;
}

function baseManifest(overrides = {}) {
  return {
    schemaVersion: "bakingrl.plugin/4",
    bakingrlApi: "2.3.0",
    id: "com.example.package",
    name: "Example Package",
    version: "1.0.0",
    ...overrides
  };
}

function nodeRuntimeManifest(overrides = {}) {
  return baseManifest({
    runtime: {
      node: {
        entry: "dist/extension/index.js"
      }
    },
    ...overrides
  });
}

function emptyPermissions() {
  return {
    bus: { read: [], publish: [] },
    registry: { read: [], write: [] },
    network: { http: [], websocket: [], listen: [] },
    storage: { read: [], write: [] }
  };
}

function sidecarManifest(healthCheck) {
  return baseManifest({
    runtime: {
      sidecars: [
        {
          id: "native-helper",
          bin: sidecarBin,
          protocol: "jsonrpc-stdio",
          healthCheck
        }
      ]
    }
  });
}

function writeSidecarBin(packageDir) {
  writeGeneratedEntry(packageDir, sidecarBin);
}

function writeResource(packageDir, relativePath = "resources/preset.json") {
  writeGeneratedEntry(packageDir, relativePath);
}

function writeAuthorListing(packageDir, packageId = "com.example.package") {
  writeJsonEntry(packageDir, "marketplace/listing.json", {
    schema: "bakingrl.plugin-listing/1",
    packageId,
    displayName: "Example Package",
    shortDescription: "A compact example package.",
    longDescription: "An author-owned package listing used to exercise the SDK publication workflow.",
    tags: ["example"],
    repo: "https://github.com/example/package",
    iconUrl: null,
    bannerUrl: null,
    screenshots: [],
    links: {
      docs: "https://github.com/example/package#readme",
      support: "https://github.com/example/package/issues"
    }
  });
}

test("validator requires manifest schema V4", () => {
  const output = validatePackageFailure(baseManifest({ schemaVersion: "bakingrl.plugin/3" }));
  assert.match(output, /schemaVersion must be bakingrl\.plugin\/4/);
});

test("validator accepts runtime API 2.3.x manifests", () => {
  validatePackage(baseManifest({ bakingrlApi: "2.3.0" }));
  validatePackage(baseManifest({ bakingrlApi: "2.3.99" }));
});

test("validator rejects every runtime API outside 2.3.x", () => {
  const legacyOutput = validatePackageFailure(baseManifest({ bakingrlApi: "2.2.99" }));
  assert.match(legacyOutput, /target host runtime API 2\.3\.x \(minimum 2\.3\.0\)/);
  const futureOutput = validatePackageFailure(baseManifest({ bakingrlApi: "2.4.0" }));
  assert.match(futureOutput, /target host runtime API 2\.3\.x \(minimum 2\.3\.0\)/);
});

test("validator accepts structured runtime API 2.3 permissions", () => {
  validatePackage(baseManifest({
    permissions: {
      bus: {
        read: ["UpdateState", "plugin.com.example.source.*"],
        publish: ["plugin.com.example.package.*"]
      },
      registry: {
        read: ["plugin.com.example.source.snapshot"],
        write: ["plugin.com.example.package.*"]
      },
      network: {
        http: [
          {
            scheme: "https",
            host: "api.example.com",
            ports: [443],
            pathPrefixes: ["/v1/"]
          }
        ],
        websocket: [
          {
            scheme: "wss",
            host: "stream.example.com",
            ports: "*"
          }
        ],
        listen: [
          {
            transport: "tcp",
            host: "127.0.0.1",
            ports: [9134]
          }
        ]
      },
      storage: {
        read: ["state.json", "history/*"],
        write: ["state.json", "history/*"]
      }
    }
  }));
});

test("validator rejects malformed permission patterns and network endpoints", () => {
  const wildcardOutput = validatePackageFailure(baseManifest({
    permissions: {
      ...emptyPermissions(),
      bus: { read: ["plugin.*.state"], publish: [] }
    }
  }));
  assert.match(wildcardOutput, /may contain only one terminal '\*' wildcard/);

  const schemeOutput = validatePackageFailure(baseManifest({
    permissions: {
      ...emptyPermissions(),
      network: {
        http: [{ scheme: "wss", host: "example.com", ports: [443] }],
        websocket: [],
        listen: []
      }
    }
  }));
  assert.match(schemeOutput, /network\.http\[0\]\.scheme must be one of http, https/);
});

test("validator accepts only relative runtime API 2.3 storage permission paths", () => {
  for (const path of ["plugin://self/*", "/absolute/*", "../escape/*", "nested\\windows/*"]) {
    const output = validatePackageFailure(baseManifest({
      permissions: {
        ...emptyPermissions(),
        storage: { read: [path], write: [] }
      }
    }));
    assert.match(output, /relative storage path|must not contain '\.' or '\.\.' path segments/);
  }
});

test("validator accepts runtime API 2.3 surface webviews", () => {
  validatePackage(baseManifest({
    contributes: {
      webviews: [
        {
          id: "overlay",
          entry: "dist/webviews/overlay.js",
          title: "Overlay",
          kind: "surface",
          defaultSize: [1280, 720],
          surface: {
            defaultPosition: [40, 60],
            defaultScreen: "primary",
            transparent: true,
            alwaysOnTop: true,
            clickThrough: false,
            resizable: true
          }
        }
      ]
    }
  }), (dir) => writeGeneratedEntry(dir, "dist/webviews/overlay.js"));
});

test("validator requires complete surface declarations", () => {
  const missingSizeOutput = validatePackageFailure(baseManifest({
    contributes: {
      webviews: [
        {
          id: "overlay",
          entry: "dist/webviews/overlay.js",
          kind: "surface",
          surface: {}
        }
      ]
    }
  }), (dir) => writeGeneratedEntry(dir, "dist/webviews/overlay.js"));
  assert.match(missingSizeOutput, /defaultSize is required for surface webviews/);

  const capabilityOutput = validatePackageFailure(baseManifest({
    contributes: {
      webviews: [
        {
          id: "overlay",
          entry: "dist/webviews/overlay.js",
          kind: "surface",
          defaultSize: [640, 360],
          surface: { transparent: "yes" }
        }
      ]
    }
  }), (dir) => writeGeneratedEntry(dir, "dist/webviews/overlay.js"));
  assert.match(capabilityOutput, /surface\.transparent must be a boolean/);
});

test("validator rejects external contributions without a declared dependency", () => {
  const output = validatePackageFailure(baseManifest({
    id: "com.example.contributor",
    contributes: {
      contributions: [
        {
          id: "scorebug",
          target: "com.example.host/items"
        }
      ]
    }
  }));
  assert.match(output, /without a matching manifest\.dependencies entry/);
});

test("validator accepts external contributions with a declared dependency", () => {
  validatePackage(baseManifest({
    id: "com.example.contributor",
    dependencies: [
      {
        packageId: "com.example.host",
        version: "^1.0.0"
      }
    ],
    contributes: {
      contributions: [
        {
          id: "scorebug",
          target: "com.example.host/items"
        }
      ]
    }
  }));
});

test("validator rejects removed host-owned visual surfaces", () => {
  const output = validatePackageFailure(baseManifest({
    contributes: {
      visuals: []
    }
  }));
  assert.match(output, /contributes\.visuals is not supported in runtime API 2\.3/);
});

test("validator rejects legacy contribution groups", () => {
  for (const group of legacyContributes) {
    const output = validatePackageFailure(baseManifest({
      contributes: {
        [group]: []
      }
    }));
    assert.match(output, new RegExp(`contributes\\.${group}.*not supported`));
  }
});

test("validator accepts local contributions backed by resources", () => {
  validatePackage(baseManifest({
    contributes: {
      services: [
        {
          id: "platform",
          runtime: "node",
          methods: ["snapshot"]
        }
      ],
      extensionPoints: [
        {
          id: "items",
          service: "platform"
        }
      ],
      resources: [
        {
          id: "preset",
          path: "resources/preset.json",
          type: "application/json",
          visibility: "public"
        }
      ],
      contributions: [
        {
          id: "starter",
          target: "com.example.package/items",
          service: "platform",
          resources: ["preset"],
          metadata: {
            category: "starter"
          }
        }
      ]
    }
  }), writeResource);
});

test("validator rejects contributions that reference unknown resources", () => {
  const output = validatePackageFailure(baseManifest({
    contributes: {
      extensionPoints: [
        {
          id: "items"
        }
      ],
      resources: [
        {
          id: "preset",
          path: "resources/preset.json",
          type: "application/json",
          visibility: "public"
        }
      ],
      contributions: [
        {
          id: "starter",
          target: "com.example.package/items",
          resources: ["missing"]
        }
      ]
    }
  }), writeResource);

  assert.match(output, /resources references unknown contributes\.resources id 'missing'/);
});

test("validator rejects invalid resource declarations", () => {
  const missingTypeOutput = validatePackageFailure(baseManifest({
    contributes: {
      resources: [
        {
          id: "preset",
          path: "resources/preset.json",
          visibility: "public"
        }
      ]
    }
  }), writeResource);
  assert.match(missingTypeOutput, /resources\[0\]\.type is required for public resources/);

  const duplicatedPathOutput = validatePackageFailure(baseManifest({
    contributes: {
      resources: [
        {
          id: "preset",
          path: "resources/preset.json",
          paths: ["resources/extra.json"],
          type: "application/json",
          visibility: "public"
        }
      ]
    }
  }), (dir) => {
    writeResource(dir, "resources/preset.json");
    writeResource(dir, "resources/extra.json");
  });
  assert.match(duplicatedPathOutput, /resources\[0\] must declare either path or paths, not both/);
});

test("validator rejects contribution visual references", () => {
  const output = validatePackageFailure(baseManifest({
    id: "com.example.contributor",
    dependencies: [
      {
        packageId: "com.example.host",
        version: "^1.0.0"
      }
    ],
    contributes: {
      contributions: [
        {
          id: "scorebug",
          target: "com.example.host/items",
          visual: "scorebug"
        }
      ]
    }
  }));
  assert.match(output, /contributions\[0\]\.visual is not supported in runtime API 2\.3/);
});

test("validator accepts settings UI backed by a settings webview", () => {
  validatePackage(baseManifest({
    contributes: {
      settings: {
        ui: "settings"
      },
      webviews: [
        {
          id: "settings",
          entry: "dist/webviews/settings.js",
          kind: "settings"
        }
      ]
    }
  }), (dir) => {
    writeGeneratedEntry(dir, "dist/webviews/settings.js");
  });
});

test("validator accepts a typed settings schema with host-owned secrets", () => {
  validatePackage(baseManifest({
    contributes: {
      settings: {
        schema: "schemas/settings.schema.json"
      }
    }
  }), (dir) => {
    writeJsonEntry(dir, "schemas/settings.schema.json", {
      type: "object",
      required: ["apiKey"],
      properties: {
        enabled: {
          type: "boolean",
          default: true
        },
        retryCount: {
          type: "integer",
          default: 3
        },
        apiKey: {
          type: "string",
          "x-bakingrl-secret": true
        }
      }
    });
  });
});

test("validator rejects settings schema defaults with the wrong type", () => {
  const output = validatePackageFailure(baseManifest({
    contributes: {
      settings: {
        schema: "schemas/settings.schema.json"
      }
    }
  }), (dir) => {
    writeJsonEntry(dir, "schemas/settings.schema.json", {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          default: "yes"
        }
      }
    });
  });
  assert.match(output, /default must match schema type 'boolean'/);
});

test("validator rejects secret settings with defaults", () => {
  const output = validatePackageFailure(baseManifest({
    contributes: {
      settings: {
        schema: "schemas/settings.schema.json"
      }
    }
  }), (dir) => {
    writeJsonEntry(dir, "schemas/settings.schema.json", {
      type: "object",
      properties: {
        apiKey: {
          type: "string",
          "x-bakingrl-secret": true,
          default: "inline-secret"
        }
      }
    });
  });
  assert.match(output, /default is not allowed for secret setting 'apiKey'/);
});

test("validator rejects settings UI without a settings webview", () => {
  const output = validatePackageFailure(baseManifest({
    contributes: {
      settings: {
        ui: "settings"
      },
      webviews: [
        {
          id: "settings",
          entry: "dist/webviews/settings.js",
          kind: "tool"
        }
      ]
    }
  }), (dir) => {
    writeGeneratedEntry(dir, "dist/webviews/settings.js");
  });
  assert.match(output, /settings\.ui must reference a webview with kind settings/);
});

test("validator rejects external surfaces", () => {
  const output = validatePackageFailure(baseManifest({
    externalSurfaces: {
      obs: {
        runtime: "node"
      }
    }
  }));
  assert.match(output, /manifest\.externalSurfaces is not supported/);
});

test("validator accepts sidecar health check host minimum bounds", () => {
  validatePackage(sidecarManifest({
    method: "ping",
    intervalMs: 500,
    timeoutMs: 100
  }), writeSidecarBin);
});

test("validator rejects sidecar health check intervals below the host minimum", () => {
  const output = validatePackageFailure(sidecarManifest({
    method: "ping",
    intervalMs: 499,
    timeoutMs: 100
  }), writeSidecarBin);
  assert.match(output, /manifest\.runtime\.sidecars\[0\]\.healthCheck\.intervalMs must be a number >= 500/);
});

test("validator rejects sidecar health check timeouts below the host minimum", () => {
  const output = validatePackageFailure(sidecarManifest({
    method: "ping",
    intervalMs: 500,
    timeoutMs: 99
  }), writeSidecarBin);
  assert.match(output, /manifest\.runtime\.sidecars\[0\]\.healthCheck\.timeoutMs must be a number >= 100/);
});

test("listing validator accepts author-owned listing metadata", () => {
  withPackage(baseManifest(), (dir) => {
    writeAuthorListing(dir);
    execFileSync(process.execPath, [cli, "validate-listing", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  });
});

test("submission command emits review input without catalogue approval fields", () => {
  const permissions = emptyPermissions();
  withPackage(baseManifest({ permissions }), (dir) => {
    writeAuthorListing(dir);
    const keyPath = join(dir, "bakingrl-signing-key.json");
    execFileSync(process.execPath, [cli, "keygen", keyPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    execFileSync(process.execPath, [cli, "pack", dir, "--sign", keyPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const outputPath = join(dir, "submission.json");
    execFileSync(process.execPath, [
      cli,
      "prepare-submission",
      dir,
      "--developer",
      "example",
      "--bundle-url",
      "https://github.com/example/package/releases/download/v1.0.0/com.example.package-1.0.0.brlp",
      "--listing-url",
      "https://raw.githubusercontent.com/example/package/v1.0.0/marketplace/listing.json",
      "--platform",
      "windows-x64",
      "--output",
      outputPath
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    const submission = readJson(outputPath);
    assert.equal(submission.schema, "bakingrl.marketplace-submission/1");
    assert.equal(submission.packageId, "com.example.package");
    assert.equal(submission.runtimeApi, "2.3.0");
    assert.equal(submission.artifacts[0].platform, "windows-x64");
    assert.match(submission.artifacts[0].bundleSha256, /^[a-f0-9]{64}$/);
    assert.equal(submission.listing.schema, "bakingrl.plugin-listing/1");
    assert.deepEqual(submission.dependencies, []);
    assert.deepEqual(submission.runtime, {
      node: false,
      sidecars: [],
      webviews: []
    });
    assert.deepEqual(submission.permissions, permissions);
    assert.equal(submission.review, undefined);
    assert.equal(submission.approvedVersions, undefined);
  });
});

test("submission command rejects source metadata that differs from the exact signed bundle", () => {
  withPackage(baseManifest(), (dir) => {
    writeAuthorListing(dir);
    const keyPath = join(dir, "bakingrl-signing-key.json");
    execFileSync(process.execPath, [cli, "keygen", keyPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    execFileSync(process.execPath, [cli, "pack", dir, "--sign", keyPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const listing = readJson(join(dir, "marketplace/listing.json"));
    listing.longDescription = "Changed after the release artifact was signed.";
    writeJsonEntry(dir, "marketplace/listing.json", listing);
    const output = runCliFailure([
      "prepare-submission",
      dir,
      "--developer",
      "example",
      "--bundle-url",
      "https://github.com/example/package/releases/download/v1.0.0/com.example.package-1.0.0.brlp",
      "--listing-url",
      "https://raw.githubusercontent.com/example/package/v1.0.0/marketplace/listing.json"
    ]);
    assert.match(output, /Bundle entry 'marketplace\/listing\.json' does not match the staged package snapshot/);
  });
});

test("submission command rejects signed ZIP entries marked as Unix symlinks", () => {
  withPackage(baseManifest(), (dir) => {
    writeAuthorListing(dir);
    const keyPath = join(dir, "bakingrl-signing-key.json");
    execFileSync(process.execPath, [cli, "keygen", keyPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    execFileSync(process.execPath, [cli, "pack", dir, "--sign", keyPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const bundlePath = join(dir, "dist-bundles/com.example.package-1.0.0.brlp");
    markZipEntryAsUnixSymlink(bundlePath, "marketplace/listing.json");
    const output = runCliFailure([
      "prepare-submission",
      dir,
      "--developer",
      "example",
      "--bundle-url",
      "https://github.com/example/package/releases/download/v1.0.0/com.example.package-1.0.0.brlp",
      "--listing-url",
      "https://raw.githubusercontent.com/example/package/v1.0.0/marketplace/listing.json"
    ]);
    assert.match(output, /Bundle ZIP must not contain symbolic links: 'marketplace\/listing\.json'/);
  });
});

test("submission command rejects implicit ZIP directory case and kind collisions", () => {
  for (const fixture of [
    {
      files: [["assets/Foo", "file\n"], ["assets/baz/bar.js", "nested\n"]],
      from: "assets/baz/bar.js",
      to: "assets/foo/bar.js"
    },
    {
      files: [["assets/Foo/a.js", "first\n"], ["assets/bar/b.js", "second\n"]],
      from: "assets/bar/b.js",
      to: "assets/foo/b.js"
    }
  ]) {
    withPackage(baseManifest(), (dir) => {
      writeAuthorListing(dir);
      for (const [relativePath, contents] of fixture.files) writeTextEntry(dir, relativePath, contents);
      const keyPath = join(dir, "bakingrl-signing-key.json");
      execFileSync(process.execPath, [cli, "keygen", keyPath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      execFileSync(process.execPath, [cli, "pack", dir, "--sign", keyPath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      const bundlePath = join(dir, "dist-bundles/com.example.package-1.0.0.brlp");
      renameZipEntrySameLength(bundlePath, fixture.from, fixture.to);
      const output = runCliFailure([
        "prepare-submission",
        dir,
        "--developer",
        "example",
        "--bundle-url",
        "https://github.com/example/package/releases/download/v1.0.0/com.example.package-1.0.0.brlp",
        "--listing-url",
        "https://raw.githubusercontent.com/example/package/v1.0.0/marketplace/listing.json"
      ]);
      assert.match(output, /Installable package paths collide on Windows/);
    });
  }
});

test("validator requires ESM package metadata for Node runtimes", () => {
  const missingOutput = validatePackageFailure(nodeRuntimeManifest(), (dir) => {
    writeTextEntry(dir, "dist/extension/index.js", "export function activate() {}\n");
  });
  assert.match(missingOutput, /must include a package\.json file with type set to module/);

  const commonJsOutput = validatePackageFailure(nodeRuntimeManifest(), (dir) => {
    writeJsonEntry(dir, "package.json", { type: "commonjs" });
    writeTextEntry(dir, "dist/extension/index.js", "export function activate() {}\n");
  });
  assert.match(commonJsOutput, /must set package\.json "type" to "module"/);
});

test("pack preflight rejects invalid Node entry syntax", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, "export function activate( {\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /Node runtime static preflight failed/);
    assert.match(output, /SyntaxError/);
    assert.equal(existsSync(join(dir, "manifest.hashes.json")), false);
  });
});

test("pack preflight rejects a missing relative import", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, 'import "\.\/missing-chunk.js";\nexport function activate() {}\n');
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /Node runtime static preflight failed/);
    assert.match(output, /does not resolve to an installable file/);
    assert.match(output, /missing-chunk\.js/);
  });
});

test("pack preflight validates named and default import bindings", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      'import { missing } from "./chunk.js";\nexport function activate() { return missing; }\n'
    );
    writeTextEntry(dir, "dist/extension/chunk.js", "export const available = 1;\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /named import.*requests missing export 'missing'/);
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      'import missing from "./chunk.js";\nexport function activate() { return missing; }\n'
    );
    writeTextEntry(dir, "dist/extension/chunk.js", "export const available = 1;\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /default import.*requests missing default export/);
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      'import present from "./chunk.js";\nexport function activate() { return present; }\n'
    );
    writeTextEntry(dir, "dist/extension/chunk.js", "export default function present() {}\n");
    execFileSync(process.execPath, [cli, "pack", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  });
});

test("pack preflight validates named re-export bindings", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      'export { missing } from "./chunk.js";\nexport function activate() {}\n'
    );
    writeTextEntry(dir, "dist/extension/chunk.js", "export const available = 1;\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /named re-export.*requests missing export 'missing'/);
  });
});

test("pack preflight validates Node built-in import and re-export bindings", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      'import fs, { readFileSync } from "fs";\nexport function activate() { return [fs, readFileSync]; }\n'
    );
    execFileSync(process.execPath, [cli, "pack", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      'import { definitelyMissing } from "node:fs";\nexport function activate() { return definitelyMissing; }\n'
    );
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /named import.*node:fs.*requests missing export 'definitelyMissing'/);
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, 'export { definitelyMissing as activate } from "node:fs";\n');
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /named re-export.*node:fs.*requests missing export 'definitelyMissing'/);
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, 'export { constants as activate } from "node:fs";\n');
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /activate export is statically non-callable/);
  });
});

test("pack preflight detects ambiguous export-star bindings", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, 'export * from "./first.js";\nexport * from "./second.js";\n');
    writeTextEntry(dir, "dist/extension/first.js", "export function activate() {}\n");
    writeTextEntry(dir, "dist/extension/second.js", "export function activate() {}\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /activate export is ambiguous across export-star declarations/);
  });
});

test("pack preflight preserves valid namespace and same-origin export-star semantics", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      'import * as helpers from "./chunk.js";\nexport function activate() { return helpers; }\n'
    );
    writeTextEntry(dir, "dist/extension/chunk.js", "export const available = 1;\n");
    execFileSync(process.execPath, [cli, "pack", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, 'export * from "./origin.js";\nexport * from "./relay.js";\n');
    writeTextEntry(dir, "dist/extension/origin.js", "export function activate() {}\n");
    writeTextEntry(dir, "dist/extension/relay.js", 'export { activate } from "./origin.js";\n');
    execFileSync(process.execPath, [cli, "pack", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, 'export * from "./cycle-a.js";\n');
    writeTextEntry(dir, "dist/extension/cycle-a.js", 'export * from "./cycle-b.js";\n');
    writeTextEntry(
      dir,
      "dist/extension/cycle-b.js",
      'export * from "./cycle-a.js";\nexport function activate() {}\n'
    );
    execFileSync(process.execPath, [cli, "pack", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  });
});

test("pack preflight rejects package-local module query strings and fragments", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, 'import "./chunk.js?variant=one";\nexport function activate() {}\n');
    writeTextEntry(dir, "dist/extension/chunk.js", "export {};\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /query strings and fragments are not supported/);
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, 'export async function activate() { return import("./chunk.js#variant"); }\n');
    writeTextEntry(dir, "dist/extension/chunk.js", "export {};\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /query strings and fragments are not supported/);
  });
});

test("pack preflight rejects module extensions unsupported by the Node ESM runtime", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, 'import "./config.JSON";\nexport function activate() {}\n');
    writeTextEntry(dir, "dist/extension/config.JSON", '{"enabled":true}\n');
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /unsupported extension '\.JSON'/);
  });
});

test("pack preflight does not resolve bare imports from a parent node_modules", () => {
  withTempDir((root) => {
    const dir = join(root, "plugin");
    mkdirSync(dir, { recursive: true });
    writeJsonEntry(dir, "bakingrl.plugin.json", nodeRuntimeManifest());
    writeNodePackage(
      dir,
      'import { value } from "masked-dependency";\nexport function activate() { return value; }\n'
    );
    writeJsonEntry(root, "node_modules/masked-dependency/package.json", {
      name: "masked-dependency",
      version: "1.0.0",
      type: "module",
      exports: "./index.js"
    });
    writeTextEntry(root, "node_modules/masked-dependency/index.js", "export const value = 42;\n");

    const output = runCliFailure(["pack", dir]);
    assert.match(output, /Node runtime static preflight failed/);
    assert.match(output, /masked-dependency/);
    assert.match(output, /external bare dependency/);
  });
});

test("pack preflight follows literal dynamic imports without executing them", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      'export async function activate() { await import("./missing-dynamic.js"); }\n'
    );
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /dynamic import '\.\/missing-dynamic\.js'/);
    assert.match(output, /does not resolve to an installable file/);
  });
});

test("pack preflight rejects non-literal dynamic imports", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      'export async function activate(name) { await import(`./${name}.js`); }\n'
    );
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /dynamic import.*must use a string literal/);
  });
});

test("pack preflight requires an activate export", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, "export function deactivate() {}\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /runtime\.node\.entry must statically export activate\(context\)/);
  });
});

test("pack preflight rejects missing and statically non-callable activate bindings", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, "export { activate };\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /Export 'activate' is not defined|Export 'activate' is not defined in module/);
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, "export const activate = 1;\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /activate export is statically non-callable/);
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      "export const activate = 1;\nfunction nested() { function activate() {} return activate; }\n"
    );
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /activate export is statically non-callable/);
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, 'export { activate } from "./chunk.js";\n');
    writeTextEntry(dir, "dist/extension/chunk.js", "export function somethingElse() {}\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /named re-export.*requests missing export 'activate'/);
  });
});

test("pack preflight follows re-exported default activation objects and their callability", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, 'export { default } from "./chunk.js";\n');
    writeTextEntry(
      dir,
      "dist/extension/chunk.js",
      "export default { activate() {}, deactivate() {} };\n"
    );
    execFileSync(process.execPath, [cli, "pack", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, 'export { default as activate } from "./chunk.js";\n');
    writeTextEntry(dir, "dist/extension/chunk.js", "export default 1;\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /activate export is statically non-callable/);
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, 'export { default } from "./chunk.js";\n');
    writeTextEntry(dir, "dist/extension/chunk.js", "export default { activate: 1 };\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /activate export is statically non-callable/);
  });
});

test("pack preflight validates JSON imports and their required attributes", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      'import config from "./config.json" with { type: "json" };\nexport function activate() { return config; }\n'
    );
    writeJsonEntry(dir, "dist/extension/config.json", { enabled: true });
    execFileSync(process.execPath, [cli, "pack", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, 'import config from "./config.json";\nexport function activate() { return config; }\n');
    writeJsonEntry(dir, "dist/extension/config.json", { enabled: true });
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /must declare import attributes with \{ type: "json" \}/);
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      'import config from "./config.json" with { type: "json", extra: "invalid" };\n' +
        "export function activate() { return config; }\n"
    );
    writeJsonEntry(dir, "dist/extension/config.json", { enabled: true });
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /must declare import attributes with \{ type: "json" \} exactly/);
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      'import chunk from "./chunk.js" with { type: "json" };\nexport function activate() { return chunk; }\n'
    );
    writeTextEntry(dir, "dist/extension/chunk.js", "export default {};\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /must not declare import attributes.*only for JSON modules/);
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      'import fs from "node:fs" with { type: "json" };\nexport function activate() { return fs; }\n'
    );
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /must not declare import attributes.*only for JSON modules/);
  });

  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(
      dir,
      'export async function activate() { return import("./config.json", { with: { type: "json", extra: "invalid" } }); }\n'
    );
    writeJsonEntry(dir, "dist/extension/config.json", { enabled: true });
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /must declare import attributes with \{ type: "json" \} exactly/);
  });
});

test("doctor static preflight never evaluates plugin top-level code", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    const marker = join(dir, "preflight-must-not-run.txt");
    writeNodePackage(
      dir,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "executed");\nexport function activate() {}\n`
    );
    execFileSync(process.execPath, [cli, "doctor", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    assert.equal(existsSync(marker), false);
  });
});

test("doctor reports the staged Node runtime preflight", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir);
    const output = execFileSync(process.execPath, [cli, "doctor", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const summary = JSON.parse(output);
    assert.equal(summary.checks.nodeRuntimePreflight, true);
    assert.equal(summary.nodeRuntime.status, "passed");
    assert.equal(summary.nodeRuntime.mode, "static");
    assert.equal(summary.nodeRuntime.entry, "dist/extension/index.js");
    assert.equal(summary.nodeRuntime.nodeVersion, process.version);
    assert.deepEqual(summary.nodeRuntime.modules, ["dist/extension/index.js"]);
    assert.deepEqual(summary.nodeRuntime.exports, ["activate", "deactivate"]);
  });
});

test("install-local stages only bundle-eligible files and replaces after preflight", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir);
    writeTextEntry(dir, "node_modules/dev-only/index.js", "export {};\n");
    writeTextEntry(dir, ".git/HEAD", "ref: refs/heads/main\n");
    writeTextEntry(dir, "dist-bundles/old.brlp", "old bundle\n");

    withTempDir((packagesDir) => {
      const target = join(packagesDir, "com.example.package");
      writeTextEntry(target, "old-install.txt", "old\n");
      execFileSync(process.execPath, [cli, "install-local", dir], {
        env: { ...process.env, BAKINGRL_PACKAGES_DIR: packagesDir },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });

      assert.ok(existsSync(join(target, "bakingrl.plugin.json")));
      assert.ok(existsSync(join(target, "package.json")));
      assert.ok(existsSync(join(target, "dist/extension/index.js")));
      assert.equal(existsSync(join(target, "old-install.txt")), false);
      assert.equal(existsSync(join(target, "node_modules")), false);
      assert.equal(existsSync(join(target, ".git")), false);
      assert.equal(existsSync(join(target, "dist-bundles")), false);
    });
  });
});

test("install-local keeps the previous package when staged preflight fails", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, "export function deactivate() {}\n");
    withTempDir((packagesDir) => {
      const target = join(packagesDir, "com.example.package");
      writeTextEntry(target, "old-install.txt", "keep me\n");

      const output = runCliFailure(["install-local", dir], {
        env: { ...process.env, BAKINGRL_PACKAGES_DIR: packagesDir }
      });
      assert.match(output, /Failed to install package locally: Node runtime static preflight failed/);
      assert.equal(readFileSync(join(target, "old-install.txt"), "utf8"), "keep me\n");
    });
  });
});

test("pack accepts an explicit package directory without signing", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir);
    execFileSync(process.execPath, [cli, "pack", dir], {
      cwd: tmpdir(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    assert.ok(existsSync(join(dir, "manifest.hashes.json")));
    assert.ok(existsSync(join(dir, "dist-bundles", "com.example.package-1.0.0.brlp")));
  });
});

test("pack and installable staging exclude environment files and private signing keys", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir);
    writeTextEntry(dir, ".env", "SECRET=one\n");
    writeTextEntry(dir, ".env.local", "SECRET=two\n");
    writeTextEntry(dir, "secrets/bakingrl-signing-key.json", '{"privateKeyPem":"secret"}\n');
    writeTextEntry(dir, "secrets/id_ed25519", "private key\n");

    execFileSync(process.execPath, [cli, "pack", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    const hashes = readJson(join(dir, "manifest.hashes.json"));
    assert.equal(Object.hasOwn(hashes.files, ".env"), false);
    assert.equal(Object.hasOwn(hashes.files, ".env.local"), false);
    assert.equal(Object.hasOwn(hashes.files, "secrets/bakingrl-signing-key.json"), false);
    assert.equal(Object.hasOwn(hashes.files, "secrets/id_ed25519"), false);

    const bundlePath = join(dir, "dist-bundles/com.example.package-1.0.0.brlp");
    const entries = readZipEntryNames(bundlePath);
    assert.equal(entries.includes(".env"), false);
    assert.equal(entries.includes(".env.local"), false);
    assert.equal(entries.includes("secrets/bakingrl-signing-key.json"), false);
    assert.equal(entries.includes("secrets/id_ed25519"), false);
    assert.equal(entries.includes("manifest.hashes.json"), true);
    assert.equal(entries.includes("signature.ed25519"), false);
  });
});

test("pack enforces host extraction size limits before staging file contents", () => {
  withPackage(baseManifest(), (dir) => {
    const oversizedPath = join(dir, "assets/oversized.bin");
    writeTextEntry(dir, "assets/oversized.bin", "");
    truncateSync(oversizedPath, 25 * 1024 * 1024 + 1);
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /file exceeds 26214400 bytes: assets\/oversized\.bin/);
  });

  withPackage(baseManifest(), (dir) => {
    for (let index = 0; index < 6; index += 1) {
      const relativePath = `assets/chunk-${index}.bin`;
      writeTextEntry(dir, relativePath, "");
      truncateSync(join(dir, relativePath), 25 * 1024 * 1024 - 1024);
    }
    writeTextEntry(dir, "assets/overflow.bin", "");
    truncateSync(join(dir, "assets/overflow.bin"), 8192);
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /package exceeds 157286400 uncompressed bytes/);
  });
});

test("pack archives the validated staging snapshot when the source changes concurrently", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bakingrl-sdk-snapshot-"));
  const originalEntry = "export function activate() { return 'staged'; }\n";
  const mutatedEntry = "export function activate() { return 'mutated'; }\n";
  const markerName = "zzzz-snapshot-copy-complete.marker";
  let child;
  try {
    writeJsonEntry(dir, "bakingrl.plugin.json", nodeRuntimeManifest());
    writeNodePackage(dir, originalEntry);
    writeTextEntry(dir, markerName, "snapshot marker\n");
    const previousStagingDirs = new Set(
      readdirSync(tmpdir()).filter((entry) => entry.startsWith("bakingrl-plugin-pack-"))
    );

    child = spawn(process.execPath, [cli, "pack", dir], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    await waitForValue(() => {
      for (const entry of readdirSync(tmpdir())) {
        if (!entry.startsWith("bakingrl-plugin-pack-") || previousStagingDirs.has(entry)) continue;
        const candidate = join(tmpdir(), entry);
        if (existsSync(join(candidate, markerName))) return candidate;
      }
      return null;
    });
    writeTextEntry(dir, "dist/extension/index.js", mutatedEntry);

    const result = await waitForChild(child);
    assert.equal(result.code, 0, `${stdout}\n${stderr}`);
    const hashes = readJson(join(dir, "manifest.hashes.json"));
    const originalHash = createHash("sha256").update(originalEntry).digest("hex");
    assert.equal(hashes.files["dist/extension/index.js"], originalHash);
    const bundlePath = join(dir, "dist-bundles/com.example.package-1.0.0.brlp");
    assert.equal(readZipEntry(bundlePath, "dist/extension/index.js").toString("utf8"), originalEntry);
  } finally {
    if (child?.exitCode === null) child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pack replaces generated hash artifacts on repeated runs", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, "export function activate() { return 1; }\n");
    execFileSync(process.execPath, [cli, "pack", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const firstHashes = readFileSync(join(dir, "manifest.hashes.json"), "utf8");
    writeTextEntry(dir, "dist/extension/index.js", "export function activate() { return 2; }\n");
    execFileSync(process.execPath, [cli, "pack", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    assert.notEqual(readFileSync(join(dir, "manifest.hashes.json"), "utf8"), firstHashes);
  });
});

test("pack rolls back generated artifacts when atomic bundle publication fails", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir, "export function activate() { return 1; }\n");
    execFileSync(process.execPath, [cli, "pack", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const previousHashes = readFileSync(join(dir, "manifest.hashes.json"));
    const bundlePath = join(dir, "dist-bundles/com.example.package-1.0.0.brlp");
    rmSync(bundlePath, { force: true });
    mkdirSync(bundlePath);
    writeTextEntry(dir, "dist/extension/index.js", "export function activate() { return 2; }\n");

    runCliFailure(["pack", dir]);
    assert.deepEqual(readFileSync(join(dir, "manifest.hashes.json")), previousHashes);
    assert.equal(readdirSync(join(dir, "dist-bundles")).some((name) => name.includes(".tmp-")), false);
  });
});

test("sign and signed pack publish staged artifacts without including the private key", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir);
    const keyPath = join(dir, "bakingrl-signing-key.json");
    execFileSync(process.execPath, [cli, "keygen", keyPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    execFileSync(process.execPath, [cli, "sign", "--key", keyPath, dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    assert.ok(existsSync(join(dir, "manifest.hashes.json")));
    assert.ok(existsSync(join(dir, "signature.ed25519")));
    assert.equal(Object.hasOwn(readJson(join(dir, "manifest.hashes.json")).files, "bakingrl-signing-key.json"), false);

    execFileSync(process.execPath, [cli, "pack", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const entries = readZipEntryNames(join(dir, "dist-bundles/com.example.package-1.0.0.brlp"));
    assert.equal(entries.includes("bakingrl-signing-key.json"), false);
    assert.equal(entries.includes("manifest.hashes.json"), true);
    assert.equal(entries.includes("signature.ed25519"), true);
  });
});

test("unsigned pack rejects a stale existing signature", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir);
    const keyPath = join(dir, "bakingrl-signing-key.json");
    execFileSync(process.execPath, [cli, "keygen", keyPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    execFileSync(process.execPath, [cli, "sign", "--key", keyPath, dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    writeTextEntry(dir, "dist/extension/index.js", "export function activate() { return 'changed'; }\n");
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /does not match package hashes.*re-sign the package or delete the signature/);
    assert.equal(existsSync(join(dir, "dist-bundles/com.example.package-1.0.0.brlp")), false);
  });
});

test("signed pack rejects a public key that does not match the private key", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir);
    const firstKeyPath = join(dir, "first-signing-key.json");
    const secondKeyPath = join(dir, "second-signing-key.json");
    execFileSync(process.execPath, [cli, "keygen", firstKeyPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    execFileSync(process.execPath, [cli, "keygen", secondKeyPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const firstKey = readJson(firstKeyPath);
    const secondKey = readJson(secondKeyPath);
    const mixedKeyPath = join(dir, "mixed-signing-key.json");
    writeJsonEntry(dir, "mixed-signing-key.json", {
      ...firstKey,
      privateKeyPem: secondKey.privateKeyPem
    });

    const output = runCliFailure(["pack", dir, "--sign", mixedKeyPath]);
    assert.match(output, /publicKey does not match privateKeyPem/);
    assert.equal(existsSync(join(dir, "manifest.hashes.json")), false);
    assert.equal(existsSync(join(dir, "signature.ed25519")), false);
    assert.equal(existsSync(join(dir, "dist-bundles/com.example.package-1.0.0.brlp")), false);
  });
});

test("installable staging excludes reserved directories regardless of case", () => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir);
    writeTextEntry(dir, "Node_Modules/private-dependency/index.js", "export const secret = true;\n");
    writeTextEntry(dir, ".GiT/config", "credential = must-not-ship\n");
    writeTextEntry(dir, "Dist-Bundles/old.brlp", "nested bundle\n");
    execFileSync(process.execPath, [cli, "pack", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const entries = readZipEntryNames(join(dir, "dist-bundles/com.example.package-1.0.0.brlp"));
    assert.equal(entries.some((entry) => entry.toLowerCase().startsWith("node_modules/")), false);
    assert.equal(entries.some((entry) => entry.toLowerCase().startsWith(".git/")), false);
    assert.equal(entries.some((entry) => entry.toLowerCase().startsWith("dist-bundles/")), false);
  });
});

test("pack rejects installable paths that collide under Windows case folding", (t) => {
  withPackage(nodeRuntimeManifest({
    runtime: {
      node: {
        entry: "dist/extension/Index.js"
      }
    }
  }), (dir) => {
    writeJsonEntry(dir, "package.json", { type: "module" });
    writeTextEntry(dir, "dist/extension/Index.js", "export function activate() { return 'validated'; }\n");
    writeTextEntry(dir, "dist/extension/index.js", "export function activate() { return 'overwrite'; }\n");
    const names = readdirSync(join(dir, "dist/extension"));
    if (names.length < 2) {
      t.skip("Filesystem is case-insensitive and cannot represent the collision fixture");
      return;
    }
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /paths collide on Windows.*Index\.js.*index\.js/);
    assert.equal(existsSync(join(dir, "manifest.hashes.json")), false);
    assert.equal(existsSync(join(dir, "dist-bundles/com.example.package-1.0.0.brlp")), false);
  });
});

test("pack uses Windows uppercase folding for Unicode path collisions", (t) => {
  let representedFixtures = 0;
  for (const [first, second] of [["σ.js", "ς.js"], ["É.js", "é.js"]]) {
    withPackage(baseManifest(), (dir) => {
      writeTextEntry(dir, `assets/${first}`, "first\n");
      writeTextEntry(dir, `assets/${second}`, "second\n");
      if (readdirSync(join(dir, "assets")).length < 2) return;
      representedFixtures += 1;
      const output = runCliFailure(["pack", dir]);
      assert.match(output, /paths collide on Windows/);
    });
  }
  if (representedFixtures === 0) t.skip("Filesystem cannot represent Unicode case-fold collision fixtures");
});

test("pack rejects non-canonical casing for reserved package artifacts", () => {
  for (const artifact of ["Manifest.Hashes.json", "Signature.Ed25519"]) {
    withPackage(nodeRuntimeManifest(), (dir) => {
      writeNodePackage(dir);
      writeTextEntry(dir, artifact, "reserved artifact variant\n");
      const output = runCliFailure(["pack", dir]);
      assert.match(output, /artifact must use canonical casing/);
      assert.match(output, new RegExp(artifact.toLowerCase().replaceAll(".", "\\.")));
    });
  }
});

test("pack rejects Windows device names including superscript COM and LPT variants", (t) => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir);
    try {
      writeTextEntry(dir, "assets/COM¹.txt", "reserved Windows device path\n");
    } catch (error) {
      if (["EACCES", "EINVAL", "EPERM"].includes(error?.code)) {
        t.skip(`Filesystem cannot represent the Windows device fixture: ${error.code}`);
        return;
      }
      throw error;
    }
    const output = runCliFailure(["pack", dir]);
    assert.match(output, /path is not Windows-portable: 'assets\/COM¹\.txt'/);
  });
});

test("package commands reject manifest and package metadata symlinks before reading their targets", (t) => {
  withTempDir((root) => {
    const packagesDir = join(root, "installed-packages");
    const invalidTarget = join(root, "external-invalid.json");
    writeFileSync(invalidTarget, "not valid JSON\n");
    const commands = ["validate", "doctor", "pack", "install-local"];

    const manifestLinkPackage = join(root, "manifest-link-package");
    mkdirSync(manifestLinkPackage, { recursive: true });
    writeNodePackage(manifestLinkPackage);
    try {
      symlinkSync(invalidTarget, join(manifestLinkPackage, "bakingrl.plugin.json"), "file");
    } catch (error) {
      if (["EACCES", "EPERM", "ENOTSUP"].includes(error?.code)) {
        t.skip(`Symbolic links are not permitted on this platform: ${error.code}`);
        return;
      }
      throw error;
    }
    for (const command of commands) {
      const output = runCliFailure([command, manifestLinkPackage], {
        env: { ...process.env, BAKINGRL_PACKAGES_DIR: packagesDir }
      });
      assert.match(output, /symbolic links: bakingrl\.plugin\.json/);
      assert.doesNotMatch(output, /Unable to read valid JSON/);
    }

    const packageJsonLinkPackage = join(root, "package-json-link-package");
    mkdirSync(packageJsonLinkPackage, { recursive: true });
    writeJsonEntry(packageJsonLinkPackage, "bakingrl.plugin.json", nodeRuntimeManifest());
    writeTextEntry(packageJsonLinkPackage, "dist/extension/index.js", "export function activate() {}\n");
    symlinkSync(invalidTarget, join(packageJsonLinkPackage, "package.json"), "file");
    for (const command of commands) {
      const output = runCliFailure([command, packageJsonLinkPackage], {
        env: { ...process.env, BAKINGRL_PACKAGES_DIR: packagesDir }
      });
      assert.match(output, /symbolic links: package\.json/);
      assert.doesNotMatch(output, /Unable to read valid JSON/);
    }
  });
});

test("validator rejects a symbolic-link package root", (t) => {
  withTempDir((root) => {
    const packageDir = join(root, "real-package");
    mkdirSync(packageDir, { recursive: true });
    writeJsonEntry(packageDir, "bakingrl.plugin.json", nodeRuntimeManifest());
    writeNodePackage(packageDir);
    const linkedPackageDir = join(root, "linked-package");
    try {
      symlinkSync(packageDir, linkedPackageDir, "dir");
    } catch (error) {
      if (["EACCES", "EPERM", "ENOTSUP"].includes(error?.code)) {
        t.skip(`Symbolic links are not permitted on this platform: ${error.code}`);
        return;
      }
      throw error;
    }
    const output = runCliFailure(["validate", linkedPackageDir]);
    assert.match(output, /Package directory must not be a symbolic link/);
  });
});

test("pack excludes an explicitly passed signing key with different path casing", (t) => {
  withPackage(nodeRuntimeManifest(), (dir) => {
    writeNodePackage(dir);
    const actualKeyPath = join(dir, "SigningMaterial.JSON");
    execFileSync(process.execPath, [cli, "keygen", actualKeyPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const differentlyCasedKeyPath = join(dir, "signingmaterial.json");
    if (!existsSync(differentlyCasedKeyPath)) {
      t.skip("Filesystem is case-sensitive and cannot resolve the alternate key casing");
      return;
    }
    execFileSync(process.execPath, [cli, "pack", dir, "--sign", differentlyCasedKeyPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const entries = readZipEntryNames(join(dir, "dist-bundles/com.example.package-1.0.0.brlp"));
    assert.equal(entries.some((entry) => entry.toLowerCase() === "signingmaterial.json"), false);
    const hashes = readJson(join(dir, "manifest.hashes.json"));
    assert.equal(Object.keys(hashes.files).some((entry) => entry.toLowerCase() === "signingmaterial.json"), false);
  });
});

test("pack rejects package symlinks without reading or archiving their external targets", (t) => {
  withTempDir((root) => {
    const packageDir = join(root, "plugin");
    mkdirSync(packageDir, { recursive: true });
    writeJsonEntry(packageDir, "bakingrl.plugin.json", nodeRuntimeManifest());
    writeNodePackage(packageDir);
    const externalSecret = join(root, "external-secret.txt");
    writeFileSync(externalSecret, "must stay outside the package\n");
    try {
      symlinkSync(externalSecret, join(packageDir, "linked-secret.txt"), "file");
    } catch (error) {
      if (["EACCES", "EPERM", "ENOTSUP"].includes(error?.code)) {
        t.skip(`Symbolic links are not permitted on this platform: ${error.code}`);
        return;
      }
      throw error;
    }

    const output = runCliFailure(["pack", packageDir]);
    assert.match(output, /must not contain symbolic links: linked-secret\.txt/);
    assert.equal(existsSync(join(packageDir, "manifest.hashes.json")), false);
    assert.equal(existsSync(join(packageDir, "dist-bundles/com.example.package-1.0.0.brlp")), false);
    assert.equal(readFileSync(externalSecret, "utf8"), "must stay outside the package\n");
  });
});

test("scaffolder creates valid runtime 2.3 package templates", () => {
  withTempDir((root) => {
    const extension = scaffoldPackage(root, "extension-template", "extension-plugin");
    writeGeneratedEntry(extension, "dist/extension/index.js");
    writeGeneratedEntry(extension, "dist/webviews/home.js");
    validateGeneratedPackage(extension);
    const extensionManifest = assertGeneratedV4Manifest(extension, expectedIdForScaffold("extension-template"));
    assert.equal(extensionManifest.runtime.node.entry, "dist/extension/index.js");
    assert.equal(extensionManifest.runtime.sidecars.length, 0);
    assert.equal(extensionManifest.contributes.services[0].runtime, "node");
    assert.equal(extensionManifest.contributes.webviews[0].kind, "tool");

    const native = scaffoldPackage(root, "native-template", "native-sidecar-plugin");
    writeGeneratedEntry(native, "dist/extension/index.js");
    writeGeneratedEntry(native, "sidecars/native-helper/target/release/native-template-sidecar");
    validateGeneratedPackage(native);
    const nativeManifest = assertGeneratedV4Manifest(native, expectedIdForScaffold("native-template"));
    assert.equal(nativeManifest.runtime.sidecars[0].id, "native-helper");
    assert.equal(nativeManifest.runtime.sidecars[0].protocol, "jsonrpc-stdio");
    assert.equal(nativeManifest.runtime.sidecars[0].healthCheck.method, "ping");
    assert.equal(nativeManifest.contributes.services[0].runtime, "sidecar:native-helper");

    const platform = scaffoldPackage(root, "platform-template", "platform-plugin");
    writeGeneratedEntry(platform, "dist/extension/index.js");
    writeGeneratedEntry(platform, "dist/webviews/home.js");
    validateGeneratedPackage(platform);
    const platformManifest = assertGeneratedV4Manifest(platform, expectedIdForScaffold("platform-template"));
    assert.equal(platformManifest.contributes.services[0].runtime, "node");
    assert.equal(platformManifest.contributes.extensionPoints[0].service, "platform");
    assert.equal(platformManifest.contributes.webviews[0].kind, "tool");
    assert.equal(platformManifest.contributes.resources[0].visibility, "public");

    const contributor = scaffoldPackage(root, "contributor-template", "contributor-plugin");
    writeGeneratedEntry(contributor, "dist/extension/index.js");
    validateGeneratedPackage(contributor);
    const contributorManifest = assertGeneratedV4Manifest(contributor, expectedIdForScaffold("contributor-template"));
    assert.equal(contributorManifest.dependencies[0].packageId, "com.example.platform");
    assert.equal(contributorManifest.contributes.contributions[0].target, "com.example.platform/items");
    assert.deepEqual(contributorManifest.contributes.contributions[0].resources, ["contributionData"]);

    const content = scaffoldPackage(root, "content-template", "content-pack-plugin");
    validateGeneratedPackage(content);
    const contentManifest = assertGeneratedV4Manifest(content, expectedIdForScaffold("content-template"));
    assert.equal(contentManifest.runtime, undefined);
    assert.equal(contentManifest.contributes.resources.length, 2);
    assert.equal(contentManifest.contributes.contributions[0].target, "com.example.contributor/content");
    assert.ok(existsSync(join(content, "resources", "badges", "blue.svg")));
  });
});

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readZipEntryNames(path) {
  const archive = readFileSync(path);
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const entries = [];
  let offset = archive.indexOf(signature);
  while (offset !== -1) {
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    entries.push(archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset = archive.indexOf(signature, offset + 46 + nameLength + extraLength + commentLength);
  }
  return entries;
}

function readZipEntry(path, expectedName) {
  const archive = readFileSync(path);
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = archive.indexOf(signature);
  while (offset !== -1) {
    const compressedSize = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === expectedName) {
      const localOffset = archive.readUInt32LE(offset + 42);
      const localNameLength = archive.readUInt16LE(localOffset + 26);
      const localExtraLength = archive.readUInt16LE(localOffset + 28);
      const contentsOffset = localOffset + 30 + localNameLength + localExtraLength;
      return inflateRawSync(archive.subarray(contentsOffset, contentsOffset + compressedSize));
    }
    offset = archive.indexOf(signature, offset + 46 + nameLength + extraLength + commentLength);
  }
  throw new Error(`Missing ZIP entry: ${expectedName}`);
}

function markZipEntryAsUnixSymlink(path, expectedName) {
  const archive = readFileSync(path);
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = archive.indexOf(signature);
  while (offset !== -1) {
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === expectedName) {
      archive.writeUInt16LE((3 << 8) | 20, offset + 4);
      archive.writeUInt32LE((0o120777 << 16) >>> 0, offset + 38);
      writeFileSync(path, archive);
      return;
    }
    offset = archive.indexOf(signature, offset + 46 + nameLength + extraLength + commentLength);
  }
  throw new Error(`Missing ZIP entry: ${expectedName}`);
}

function renameZipEntrySameLength(path, expectedName, replacementName) {
  const expected = Buffer.from(expectedName, "utf8");
  const replacement = Buffer.from(replacementName, "utf8");
  assert.equal(replacement.length, expected.length, "ZIP fixture names must have the same encoded length");
  const archive = readFileSync(path);
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = archive.indexOf(signature);
  while (offset !== -1) {
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength);
    if (name.equals(expected)) {
      const localOffset = archive.readUInt32LE(offset + 42);
      replacement.copy(archive, offset + 46);
      replacement.copy(archive, localOffset + 30);
      writeFileSync(path, archive);
      return;
    }
    offset = archive.indexOf(signature, offset + 46 + nameLength + extraLength + commentLength);
  }
  throw new Error(`Missing ZIP entry: ${expectedName}`);
}
