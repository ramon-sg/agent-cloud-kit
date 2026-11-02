/**
 * @file Tests for reading and installing the version of the cloud-ready skill.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { SKILL_DIR, installSkill, skillVersion } from "../src/skill.ts";

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

test("installSkill writes metadata.version when the packaged skill lacks it", () => {
  for (const text of ["---\nname: cloud-ready\n---\nbody\n", "---\nname: cloud-ready\nmetadata:\n  author: x\n---\nbody\n"]) {
    const pkg = mkdtempSync(join(tmpdir(), "cc-skill-pkg-"));
    mkdirSync(join(pkg, "skills/cloud-ready"), { recursive: true });
    writeFileSync(join(pkg, "skills/cloud-ready/SKILL.md"), text);
    rmSync(join(repo, SKILL_DIR), { recursive: true, force: true });
    installSkill(repo, pkg, "4.5.6");
    assert.equal(skillVersion(repo), "4.5.6", text);
    assert.ok(readFileSync(join(repo, SKILL_DIR, "SKILL.md"), "utf8").endsWith("---\nbody\n"));
    rmSync(pkg, { recursive: true, force: true });
  }
});

test("installSkill fails without touching the repo when the package has no skill", () => {
  assert.throws(() => installSkill(repo, join(repo, "nowhere"), "1.0.0"), /SKILL\.md not found/);
  assert.equal(skillVersion(repo), undefined);
});

test("a failed skill update keeps the installed skill", () => {
  const pkg = mkdtempSync(join(tmpdir(), "cc-skill-pkg-"));
  mkdirSync(join(pkg, "skills/cloud-ready"), { recursive: true });
  writeFileSync(join(pkg, "skills/cloud-ready/SKILL.md"), '---\nname: cloud-ready\nmetadata:\n  version: "0.0.0"\n---\n');
  installSkill(repo, pkg, "1.0.0");
  // A SKILL.md that is a folder copies fine but cannot be read to set the version.
  rmSync(join(pkg, "skills/cloud-ready/SKILL.md"));
  mkdirSync(join(pkg, "skills/cloud-ready/SKILL.md"));
  try {
    assert.throws(() => installSkill(repo, pkg, "2.0.0"));
  } finally {
    rmSync(pkg, { recursive: true, force: true });
  }
  assert.equal(skillVersion(repo), "1.0.0");
  assert.deepEqual(readdirSync(join(repo, ".agents/skills")), ["cloud-ready"]);
});
