/**
 * @file Checks the content of the shipped `cloud-ready` skill: the steps, limits and commands the
 * spec fixes, and the size of the knowledge table.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Reads a file of the shipped skill. */
const read = (path: string): string => readFileSync(new URL(`../skills/cloud-ready/${path}`, import.meta.url), "utf8");

/** Files the cloud agent may change in `verify`. */
const ALLOWED_FILES = [".claude/cloud.json", "docs/agent-cloud.md", ".agents/skills/test-audit/project.md"];

test("SKILL.md has the frontmatter the package relies on", () => {
  const skill = read("SKILL.md");
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
  assert.match(frontmatter, /^name: cloud-ready$/m);
  assert.match(frontmatter, /^description: .*configure.*verify/m);
  assert.match(frontmatter, /^argument-hint: "configure \[respuestas\] \| verify"$/m);
  assert.match(frontmatter, /^metadata:\n {2}version: "\d+\.\d+\.\d+"$/m);
});

test("SKILL.md covers both modes, the limits and the PR", () => {
  const skill = read("SKILL.md");
  for (const text of [
    "configure",
    "verify",
    "git diff --name-only",
    "git status --porcelain",
    "pulls?head=",
    "issues/{n}/comments",
    "agent-cloud-kit doctor",
    "agent-cloud-kit manual",
    "CLAUDE_CODE_REMOTE",
    "git push origin HEAD:",
    "## Hallazgos",
    "proponer al paquete",
    "reference/knowledge.md",
    "reference/compat.md",
    ...ALLOWED_FILES,
  ]) {
    assert.ok(skill.includes(text), `SKILL.md lacks ${text}`);
  }
  assert.match(skill, /\b3 intentos\b/);
  assert.match(skill, /notes/);
  assert.equal(skill.includes("--level"), false);
});

test("configure ends by telling the user to exit claude so prepare continues", () => {
  const skill = read("SKILL.md");
  const configure = skill.slice(skill.indexOf("## `configure`"), skill.indexOf("## `verify`"));
  assert.ok(configure.includes("`/exit`"), "configure does not mention /exit");
  assert.match(configure, /dile al usuario/i);
});

test("knowledge.md is a table with a status column and at least 12 rows", () => {
  const lines = read("reference/knowledge.md").split("\n");
  assert.ok(lines.includes("| Hecho | Estado | Fuente |"));
  const rows = lines.filter((l) => /^\| /.test(l) && !l.startsWith("| Hecho") && !/^\|[\s|:-]+\|$/.test(l));
  assert.ok(rows.length >= 12, `${rows.length} rows`);
  for (const row of rows) assert.match(row, /\| (verificado|por verificar)[^|]*\|/, row);
  assert.ok(rows.some((r) => r.includes("verificado (prueba en la nube, 2026-11-02)")));
  assert.ok(rows.some((r) => r.includes("/ccr/ready_for_review") && r.includes("| por verificar |")));
});

test("the skill cites only sources a reader of the target repo can place", () => {
  for (const path of ["SKILL.md", "reference/knowledge.md", "reference/compat.md"]) {
    const text = read(path);
    assert.equal(/Tarea \d|cloud-cli\.md/.test(text), false, path);
  }
});

test("verify stages the preparation files and rebases the push retry on FETCH_HEAD", () => {
  const skill = read("SKILL.md");
  assert.ok(skill.includes("git add --"), "no explicit git add");
  assert.ok(skill.includes("git rebase FETCH_HEAD"));
  assert.equal(skill.includes("git rebase origin/"), false);
});

test("compat.md has the example repos, from least to most invasive", () => {
  const compat = read("reference/compat.md");
  for (const text of ["vitest", "Playwright", "compose", "sin tests", "CLAUDE_CODE_REMOTE", "BASH_MAX_TIMEOUT_MS", "127.0.0.1"]) {
    assert.ok(compat.includes(text), `compat.md lacks ${text}`);
  }
  assert.ok(compat.indexOf("Adaptar") < compat.indexOf("Bifurcar"));
});
