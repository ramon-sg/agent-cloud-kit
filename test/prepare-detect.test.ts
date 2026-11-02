/**
 * @file Tests for `prepare` secret suggestions and preflight checks.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { preflight, suggestSecrets } from "../src/prepare/detect.ts";

const OK = { isTty: true, gitRoot: "/r", hasOrigin: true, clean: true, claudeHelp: "Usage: claude --cloud" };

test("suggestSecrets reads KEY= lines of .env.example, skipping comments and blanks", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-prep-"));
  try {
    writeFileSync(join(dir, ".env.example"), "# c\nAPI_TOKEN=\n\nDB_URL=x\nAPI_TOKEN=y\n");
    assert.deepEqual(suggestSecrets(dir), ["API_TOKEN", "DB_URL"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("suggestSecrets returns [] without .env.example", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-prep-"));
  try {
    assert.deepEqual(suggestSecrets(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preflight is empty when everything is fine", () => {
  assert.deepEqual(preflight(OK), []);
});

test("preflight reports each problem", () => {
  assert.deepEqual(preflight({ ...OK, isTty: false }), ["prepare needs an interactive terminal"]);
  assert.deepEqual(preflight({ ...OK, gitRoot: undefined }), ["not inside a git repository"]);
  assert.deepEqual(preflight({ ...OK, hasOrigin: false }), ["the repository has no 'origin' remote"]);
  assert.deepEqual(preflight({ ...OK, clean: false }), ["the working tree has uncommitted changes; commit or stash them first"]);
  assert.deepEqual(preflight({ ...OK, claudeHelp: undefined }), ["claude is not installed or not on the PATH"]);
  assert.deepEqual(preflight({ ...OK, claudeHelp: "Usage: claude" }), ["claude does not support --cloud; update Claude Code"]);
});

test("preflight collects several problems in order", () => {
  assert.equal(preflight({ ...OK, isTty: false, hasOrigin: false }).length, 2);
});
