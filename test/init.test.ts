/**
 * @file Tests for `init`: scaffolds cloud.json, registers the SessionStart hook once and installs
 * the cloud-ready skill.
 */
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { init } from "../src/init.ts";
import { SKILL_DIR, skillVersion } from "../src/skill.ts";
import { fakePackage } from "./fake-package.ts";

let repo: string;
let packages: string;
let pkg: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "cc-init-"));
  packages = mkdtempSync(join(tmpdir(), "cc-init-pkg-"));
  pkg = fakePackage(packages, "1.0.0");
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(packages, { recursive: true, force: true });
});

const settings = (): { hooks: { SessionStart: Array<{ hooks: Array<{ command: string; timeout: number; type: string }> }> } } =>
  JSON.parse(readFileSync(join(repo, ".claude/settings.json"), "utf8"));

test("creates cloud.json and the hook; a second run changes nothing", () => {
  const first = init(repo, "1.2.3", pkg);
  assert.equal(first.ok, true);
  const config = JSON.parse(readFileSync(join(repo, ".claude/cloud.json"), "utf8"));
  assert.equal(config.$schema, "https://unpkg.com/agent-cloud-kit@1.2.3/schema.json");
  assert.equal(config.version, "1.2.3");
  assert.deepEqual(config.docker, { pull: "auto" });
  assert.ok(readFileSync(join(repo, ".claude/cloud.json"), "utf8").endsWith("}\n"));
  const entry = settings().hooks.SessionStart[0]?.hooks[0];
  assert.equal(entry?.timeout, 600);
  assert.equal(entry?.type, "command");
  assert.ok(entry?.command.includes("agent-cloud-kit session"));
  const second = init(repo, "1.2.3", pkg);
  assert.equal(settings().hooks.SessionStart.length, 1);
  assert.ok(second.lines.length > 0);
});

test("does not overwrite an existing cloud.json", () => {
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, ".claude/cloud.json"), '{"version":"0.0.1"}');
  init(repo, "1.0.0", pkg);
  assert.equal(readFileSync(join(repo, ".claude/cloud.json"), "utf8"), '{"version":"0.0.1"}');
});

test("keeps other settings and other SessionStart hooks", () => {
  mkdirSync(join(repo, ".claude"));
  writeFileSync(
    join(repo, ".claude/settings.json"),
    JSON.stringify({ permissions: { allow: ["Bash"] }, hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }], Stop: [] } }),
  );
  init(repo, "1.0.0", pkg);
  const s = settings() as unknown as Record<string, unknown> & ReturnType<typeof settings>;
  assert.equal(s.hooks.SessionStart.length, 2);
  assert.equal(s.hooks.SessionStart[0]?.hooks[0]?.command, "echo hi");
  assert.deepEqual(s.permissions, { allow: ["Bash"] });
  assert.ok("Stop" in s.hooks);
});

test("leaves an invalid settings.json untouched and reports it", () => {
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, ".claude/settings.json"), "{ nope");
  const result = init(repo, "1.0.0", pkg);
  assert.equal(result.ok, false);
  assert.equal(readFileSync(join(repo, ".claude/settings.json"), "utf8"), "{ nope");
  assert.ok(existsSync(join(repo, ".claude/cloud.json")));
});

test("settings.json values that are not the expected shape are left untouched", () => {
  for (const text of ["null", '"x"', '{"hooks":"x"}', '{"hooks":{"SessionStart":{}}}']) {
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(join(repo, ".claude/settings.json"), text);
    const result = init(repo, "1.0.0", pkg);
    assert.equal(result.ok, false, text);
    assert.equal(readFileSync(join(repo, ".claude/settings.json"), "utf8"), text);
    const line = result.lines.find((l) => l.includes("settings.json")) ?? "";
    assert.ok(line.includes("by hand"), line);
    assert.ok(line.includes("agent-cloud-kit session") && line.includes('"timeout":600'), line);
  }
});

test("a hook that already runs agent-cloud-kit session counts as present", () => {
  mkdirSync(join(repo, ".claude"));
  const existing = {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: "/opt/agent-cloud-kit/bin/agent-cloud-kit session # issue-flow", timeout: 30 }] }],
    },
  };
  writeFileSync(join(repo, ".claude/settings.json"), JSON.stringify(existing));
  init(repo, "1.0.0", pkg);
  assert.equal(settings().hooks.SessionStart.length, 1);
});

/** Path of the link Claude Code discovers the skill through. */
const LINK = ".claude/skills/cloud-ready";

test("init copies the skill with the package version", () => {
  const result = init(repo, "1.2.3", pkg);
  assert.equal(skillVersion(repo), "1.2.3");
  assert.equal(readFileSync(join(repo, SKILL_DIR, "reference/knowledge.md"), "utf8"), "knowledge 1.0.0\n");
  assert.ok(readFileSync(join(repo, SKILL_DIR, "SKILL.md"), "utf8").includes("name: cloud-ready"));
  assert.ok(result.lines.some((l) => l.includes(SKILL_DIR) && l.includes("1.2.3")), result.lines.join("\n"));
});

test("a second init at the same version leaves the skill untouched", () => {
  init(repo, "1.2.3", pkg);
  const file = join(repo, SKILL_DIR, "SKILL.md");
  const before = statSync(file).mtimeMs;
  const dirBefore = statSync(join(repo, SKILL_DIR)).ino;
  const result = init(repo, "1.2.3", fakePackage(packages, "9.9.9"));
  assert.equal(statSync(file).mtimeMs, before);
  assert.equal(statSync(join(repo, SKILL_DIR)).ino, dirBefore);
  assert.equal(readFileSync(join(repo, SKILL_DIR, "reference/knowledge.md"), "utf8"), "knowledge 1.0.0\n");
  assert.ok(result.lines.some((l) => l.includes("already")), result.lines.join("\n"));
});

test("init at a new version replaces the skill", () => {
  init(repo, "1.0.0", pkg);
  writeFileSync(join(repo, SKILL_DIR, "stale.md"), "old");
  init(repo, "2.0.0", fakePackage(packages, "2.0.0"));
  assert.equal(skillVersion(repo), "2.0.0");
  assert.equal(readFileSync(join(repo, SKILL_DIR, "reference/knowledge.md"), "utf8"), "knowledge 2.0.0\n");
  assert.equal(existsSync(join(repo, SKILL_DIR, "stale.md")), false);
  assert.deepEqual(
    readdirSync(join(repo, ".agents/skills")).sort(),
    ["cloud-ready"],
  );
});

test("init links .claude/skills/cloud-ready", () => {
  const result = init(repo, "1.0.0", pkg);
  assert.equal(lstatSync(join(repo, LINK)).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(repo, LINK)), "../../.agents/skills/cloud-ready");
  assert.ok(existsSync(join(repo, LINK, "SKILL.md")));
  assert.ok(result.lines.some((l) => l.includes(LINK)), result.lines.join("\n"));
  const again = init(repo, "1.0.0", pkg);
  assert.equal(again.lines.some((l) => l.includes(LINK)), false);
});

test("init leaves a .claude/skills symlink to .agents/skills alone", () => {
  mkdirSync(join(repo, ".agents/skills"), { recursive: true });
  mkdirSync(join(repo, ".claude"));
  symlinkSync("../.agents/skills", join(repo, ".claude/skills"));
  init(repo, "1.0.0", pkg);
  assert.equal(readlinkSync(join(repo, ".claude/skills")), "../.agents/skills");
  assert.equal(lstatSync(join(repo, ".agents/skills/cloud-ready")).isSymbolicLink(), false);
  assert.equal(realpathSync(join(repo, LINK)), realpathSync(join(repo, SKILL_DIR)));
});

test("init leaves an existing .claude/skills/cloud-ready alone", () => {
  mkdirSync(join(repo, LINK), { recursive: true });
  writeFileSync(join(repo, LINK, "SKILL.md"), "mine");
  init(repo, "1.0.0", pkg);
  assert.equal(lstatSync(join(repo, LINK)).isSymbolicLink(), false);
  assert.equal(readFileSync(join(repo, LINK, "SKILL.md"), "utf8"), "mine");
});
