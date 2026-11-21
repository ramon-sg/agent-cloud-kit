/**
 * @file Tests for the version and runner a repo asks for.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { readPin } from "../src/pin.ts";

const tmpDirs: string[] = [];

/**
 * Creates a temporary repo with optional `.agents/runner.json` and `.claude/cloud.json` contents.
 *
 * @param files - Raw contents; undefined means no file.
 * @returns Absolute path of the temporary repo.
 */
function makeRepo(files: { runner?: string; cloud?: string }): string {
  const repo = mkdtempSync(join(tmpdir(), "agent-cloud-kit-pin-"));
  tmpDirs.push(repo);
  if (files.runner !== undefined) {
    mkdirSync(join(repo, ".agents"));
    writeFileSync(join(repo, ".agents", "runner.json"), files.runner);
  }
  if (files.cloud !== undefined) {
    mkdirSync(join(repo, ".claude"));
    writeFileSync(join(repo, ".claude", "cloud.json"), files.cloud);
  }
  return repo;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readPin", () => {
  it("reads version and runner from runner.json", () => {
    const runner = JSON.stringify({ runner: "node", tools: { "agent-cloud-kit": "1.2.0" } });
    assert.deepEqual(readPin(makeRepo({ runner })), {
      version: "1.2.0",
      runner: "node",
      source: "runner",
      errors: [],
      warnings: [],
    });
  });

  it("defaults the runner to bun", () => {
    const runner = JSON.stringify({ tools: { "agent-cloud-kit": "1.2.0" } });
    assert.equal(readPin(makeRepo({ runner })).runner, "bun");
  });

  it("falls back to cloud.json with a warning", () => {
    const pin = readPin(makeRepo({ cloud: JSON.stringify({ version: "1.0.0-rc.9" }) }));
    assert.equal(pin.version, "1.0.0-rc.9");
    assert.equal(pin.source, "cloud");
    assert.equal(pin.runner, "bun");
    assert.equal(pin.warnings.length, 1);
    assert.match(pin.warnings[0]!, /\.agents\/runner\.json/);
  });

  it("takes the runner from runner.json and the version from cloud.json", () => {
    const pin = readPin(makeRepo({ runner: JSON.stringify({ runner: "node" }), cloud: JSON.stringify({ version: "1.0.0" }) }));
    assert.equal(pin.runner, "node");
    assert.equal(pin.version, "1.0.0");
    assert.equal(pin.source, "cloud");
  });

  it("prefers runner.json and warns about the old cloud.json version", () => {
    const pin = readPin(
      makeRepo({
        runner: JSON.stringify({ tools: { "agent-cloud-kit": "1.2.0" } }),
        cloud: JSON.stringify({ version: "1.0.0" }),
      }),
    );
    assert.equal(pin.version, "1.2.0");
    assert.equal(pin.source, "runner");
    assert.equal(pin.warnings.length, 1);
    assert.match(pin.warnings[0]!, /\.claude\/cloud\.json/);
  });

  it("reports an invalid runner.json as an error", () => {
    const pin = readPin(makeRepo({ runner: "{" }));
    assert.equal(pin.version, undefined);
    assert.equal(pin.errors.length, 1);
    assert.match(pin.errors[0]!, /\.agents\/runner\.json/);
    assert.equal(pin.errors[0]!.split(".agents/runner.json").length, 2, "path appears once");
  });

  it("returns nothing when neither file exists", () => {
    const pin = readPin(makeRepo({}));
    assert.equal(pin.version, undefined);
    assert.deepEqual(pin.errors, []);
  });
});
