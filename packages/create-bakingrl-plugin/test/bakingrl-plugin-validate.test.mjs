import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const cli = new URL("../lib/bakingrl-plugin.mjs", import.meta.url);
const createCli = new URL("../bin/create-bakingrl-plugin.mjs", import.meta.url);
const sidecarBin = "sidecars/native-helper/bin";

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

function validateGeneratedPackage(packageDir) {
  execFileSync(process.execPath, [join(packageDir, "scripts", "bakingrl-plugin.mjs"), "validate", packageDir], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function baseManifest(overrides = {}) {
  return {
    schemaVersion: "bakingrl.plugin/4",
    bakingrlApi: "2.2.0",
    id: "com.example.package",
    name: "Example Package",
    version: "1.0.0",
    ...overrides
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

test("validator accepts runtime API 2.2.x manifests", () => {
  validatePackage(baseManifest({ bakingrlApi: "2.2.0" }));
  validatePackage(baseManifest({ bakingrlApi: "2.2.99" }));
});

test("validator rejects runtime APIs outside 2.2.x", () => {
  const legacyOutput = validatePackageFailure(baseManifest({ bakingrlApi: "2.1.99" }));
  assert.match(legacyOutput, /target host runtime API 2\.2\.x/);
  const output = validatePackageFailure(baseManifest({ bakingrlApi: "2.3.0" }));
  assert.match(output, /target host runtime API 2\.2\.x/);
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
  assert.match(output, /contributes\.visuals is not supported in runtime API 2\.2/);
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
  assert.match(output, /contributions\[0\]\.visual is not supported in runtime API 2\.2/);
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

test("scaffolder creates valid platform contributor and content pack templates", () => {
  withTempDir((root) => {
    const platform = scaffoldPackage(root, "platform-template", "platform-plugin");
    writeGeneratedEntry(platform, "dist/extension/index.js");
    writeGeneratedEntry(platform, "dist/webviews/home.js");
    validateGeneratedPackage(platform);
    assert.equal(readJson(join(platform, "bakingrl.plugin.json")).contributes.extensionPoints[0].service, "platform");

    const contributor = scaffoldPackage(root, "contributor-template", "contributor-plugin");
    writeGeneratedEntry(contributor, "dist/extension/index.js");
    validateGeneratedPackage(contributor);
    assert.equal(readJson(join(contributor, "bakingrl.plugin.json")).dependencies[0].packageId, "com.example.platform");

    const content = scaffoldPackage(root, "content-template", "content-pack-plugin");
    validateGeneratedPackage(content);
    const contentManifest = readJson(join(content, "bakingrl.plugin.json"));
    assert.equal(contentManifest.runtime, undefined);
    assert.equal(contentManifest.contributes.resources.length, 2);
    assert.ok(existsSync(join(content, "resources", "badges", "blue.svg")));
  });
});

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
