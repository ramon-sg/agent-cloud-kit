/**
 * @file Guards the package naming: no leftover old name in src/, and the published identity.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SRC_DIR = new URL("../src", import.meta.url).pathname;
const PACKAGE_JSON = new URL("../package.json", import.meta.url).pathname;
const OLD_NAME = /claude-cloud|CLAUDE_CLOUD/;

/**
 * Lists every file under a directory, recursively.
 *
 * @param dir - Directory to walk.
 * @returns Absolute file paths.
 */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("naming", () => {
  it("src has no claude-cloud", () => {
    const offenders = listFiles(SRC_DIR).filter((file) => OLD_NAME.test(readFileSync(file, "utf8")));
    assert.deepEqual(offenders, []);
  });

  it("package.json is agent-cloud-kit 1.x", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as { name: string; version: string; bin: Record<string, string> };
    assert.equal(pkg.name, "agent-cloud-kit");
    assert.match(pkg.version, /^1\.\d+\.\d+(-rc\.\d+)?$/);
    assert.equal(pkg.bin["agent-cloud-kit"], "dist/cli.js");
  });
});
