import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const cli = new URL("../lib/bakingrl-plugin.mjs", import.meta.url);

function withPackage(manifest, callback) {
  const dir = mkdtempSync(join(tmpdir(), "bakingrl-sdk-validate-"));
  try {
    writeFileSync(join(dir, "bakingrl.plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function validatePackage(manifest) {
  return withPackage(manifest, (dir) => {
    execFileSync(process.execPath, [cli.pathname, "validate", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  });
}

function validatePackageFailure(manifest) {
  return withPackage(manifest, (dir) => {
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

function baseManifest(overrides = {}) {
  return {
    schemaVersion: "bakingrl.plugin/4",
    bakingrlApi: "2.1.0",
    id: "com.example.package",
    name: "Example Package",
    version: "1.0.0",
    ...overrides
  };
}

test("validator accepts runtime API 2.0.x and 2.1.x manifests", () => {
  validatePackage(baseManifest({ bakingrlApi: "2.0.0" }));
  validatePackage(baseManifest({ bakingrlApi: "2.1.99" }));
});

test("validator rejects runtime API 2.2.0 and newer as requiring a newer host", () => {
  const output = validatePackageFailure(baseManifest({ bakingrlApi: "2.2.0" }));
  assert.match(output, /compatible with host runtime API >=2\.0\.0 <=2\.1\.x/);
});

test("validator rejects external contributions without a declared dependency", () => {
  const output = validatePackageFailure(baseManifest({
    id: "com.example.contributor",
    contributes: {
      contributions: [
        {
          id: "scorebug",
          target: "com.example.host/visuals"
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
          target: "com.example.host/visuals"
        }
      ]
    }
  }));
});
