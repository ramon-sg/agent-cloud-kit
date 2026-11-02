/**
 * @file Tests for reading the version of the cloud-ready skill.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { SKILL_DIR, skillVersion } from "../src/skill.ts";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "cc-skill-"));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const write = (text: string): void => {
  mkdirSync(join(repo, SKILL_DIR), { recursive: true });
  writeFileSync(join(repo, SKILL_DIR, "SKILL.md"), text);
};

test("skillVersion reads metadata.version", () => {
  write('---\nname: cloud-ready\ndescription: x\nmetadata:\n  version: "1.2.3"\n---\nbody\n');
  assert.equal(skillVersion(repo), "1.2.3");
  write("---\nname: cloud-ready\nmetadata:\n  version: 0.9.0\n---\n");
  assert.equal(skillVersion(repo), "0.9.0");
});

test("skillVersion ignores a top-level version and a missing file", () => {
  assert.equal(skillVersion(repo), undefined);
  write("---\nname: cloud-ready\nversion: 3.0.0\n---\n");
  assert.equal(skillVersion(repo), undefined);
});
