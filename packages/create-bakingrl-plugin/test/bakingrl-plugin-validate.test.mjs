import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const cli = new URL("../lib/bakingrl-plugin.mjs", import.meta.url);
const createCli = new URL("../bin/create-bakingrl-plugin.mjs", import.meta.url);
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
    execFileSync(process.execPath, [cli.pathname, "validate", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  });
}

function validatePackageFailure(manifest, setupPackage) {
  return withPackage(manifest, (dir) => {
    setupPackage?.(dir);
    try {
      execFileSync(process.execPath, [cli.pathname, "validate", dir], {
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
  execFileSync(process.execPath, [createCli.pathname, name, "--template", template], {
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
    execFileSync(process.execPath, [cli.pathname, "validate-listing", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  });
});

test("submission command emits review input without catalogue approval fields", () => {
  const permissions = emptyPermissions();
  withPackage(baseManifest({ permissions }), (dir) => {
    writeAuthorListing(dir);
    writeGeneratedEntry(dir, "dist-bundles/com.example.package-1.0.0.brlp");
    writeJsonEntry(dir, "signature.ed25519", {
      algorithm: "ed25519",
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      signature: "test",
      signedFile: "manifest.hashes.json"
    });
    const outputPath = join(dir, "submission.json");
    execFileSync(process.execPath, [
      cli.pathname,
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

test("pack accepts an explicit package directory without signing", () => {
  withPackage(baseManifest({
    runtime: {
      node: {
        entry: "dist/extension/index.js"
      }
    }
  }), (dir) => {
    writeGeneratedEntry(dir, "dist/extension/index.js");
    execFileSync(process.execPath, [cli.pathname, "pack", dir], {
      cwd: tmpdir(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    assert.ok(existsSync(join(dir, "manifest.hashes.json")));
    assert.ok(existsSync(join(dir, "dist-bundles", "com.example.package-1.0.0.brlp")));
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
