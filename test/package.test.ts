/**
 * @file Tests for the package manifest: no runtime dependencies, bundled build.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("the published package has no runtime dependencies", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies["@ramon-sg/runner"], "1.0.0");
  assert.match(pkg.devDependencies.esbuild, /^\d+\.\d+\.\d+$/);
});
