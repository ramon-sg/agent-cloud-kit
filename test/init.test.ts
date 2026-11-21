/**
 * @file Tests for `init`: scaffolds cloud.json, registers the SessionStart hook once and installs
 * the cloud-ready skill.
 */
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { checkToolPins } from "@ramon-sg/runner";
import type { chooseRunner } from "@ramon-sg/runner";
import { HOOK_MARKER, hookCommand, init as initWith } from "../src/init.ts";
import { SKILL_DIR, skillVersion } from "../src/skill.ts";
import { fakePackage } from "./fake-package.ts";

/** Fake `chooseRunner`: no Bun on this machine, so the repo gets Node; it counts its calls. */
let chosen = 0;
const noBun: typeof chooseRunner = async () => {
  chosen += 1;
  return { runner: "node", warning: "x" };
};

/** `init` with the fake runner picker, so no test spawns bunx or npx. */
const init = (repo: string, version: string, root: string) => initWith(repo, version, root, noBun);

let repo: string;
let packages: string;
let pkg: string;

beforeEach(() => {
  chosen = 0;
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

test("creates cloud.json and the hook; a second run changes nothing", async () => {
  const first = await init(repo, "1.2.3", pkg);
  assert.equal(first.ok, true);
  const config = JSON.parse(readFileSync(join(repo, ".claude/cloud.json"), "utf8"));
  assert.equal(config.$schema, "https://unpkg.com/agent-cloud-kit@1.2.3/schema.json");
  assert.equal("version" in config, false);
  assert.deepEqual(config.docker, { pull: "auto" });
  assert.ok(readFileSync(join(repo, ".claude/cloud.json"), "utf8").endsWith("}\n"));
  const entry = settings().hooks.SessionStart[0]?.hooks[0];
  assert.equal(entry?.timeout, 600);
  assert.equal(entry?.type, "command");
  assert.ok(entry?.command.includes(HOOK_MARKER));
  const second = await init(repo, "1.2.3", pkg);
  assert.equal(settings().hooks.SessionStart.length, 1);
  assert.ok(second.lines.length > 0);
});

test("does not overwrite an existing cloud.json", async () => {
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, ".claude/cloud.json"), '{"version":"0.0.1"}');
  await init(repo, "1.0.0", pkg);
  assert.equal(readFileSync(join(repo, ".claude/cloud.json"), "utf8"), '{"version":"0.0.1"}');
});

test("keeps other settings and other SessionStart hooks", async () => {
  mkdirSync(join(repo, ".claude"));
  writeFileSync(
    join(repo, ".claude/settings.json"),
    JSON.stringify({ permissions: { allow: ["Bash"] }, hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }], Stop: [] } }),
  );
  await init(repo, "1.0.0", pkg);
  const s = settings() as unknown as Record<string, unknown> & ReturnType<typeof settings>;
  assert.equal(s.hooks.SessionStart.length, 2);
  assert.equal(s.hooks.SessionStart[0]?.hooks[0]?.command, "echo hi");
  assert.deepEqual(s.permissions, { allow: ["Bash"] });
  assert.ok("Stop" in s.hooks);
});

test("leaves an invalid settings.json untouched and reports it", async () => {
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, ".claude/settings.json"), "{ nope");
  const result = await init(repo, "1.0.0", pkg);
  assert.equal(result.ok, false);
  assert.equal(readFileSync(join(repo, ".claude/settings.json"), "utf8"), "{ nope");
  assert.ok(existsSync(join(repo, ".claude/cloud.json")));
});

test("settings.json values that are not the expected shape are left untouched", async () => {
  for (const text of ["null", '"x"', '{"hooks":"x"}', '{"hooks":{"SessionStart":{}}}']) {
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(join(repo, ".claude/settings.json"), text);
    const result = await init(repo, "1.0.0", pkg);
    assert.equal(result.ok, false, text);
    assert.equal(readFileSync(join(repo, ".claude/settings.json"), "utf8"), text);
    const line = result.lines.find((l) => l.includes("settings.json")) ?? "";
    assert.ok(line.includes("a mano"), line);
    assert.ok(line.includes("agent-cloud-kit session") && line.includes('"timeout":600'), line);
  }
});

test("another tool's hook that runs agent-cloud-kit session counts as present and is left untouched", async () => {
  mkdirSync(join(repo, ".claude"));
  const foreign = "npx --yes @ramon-sg/issue-flow@0.6.0 session # runs agent-cloud-kit session in the cloud";
  const existing = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: foreign, timeout: 30 }] }] } };
  writeFileSync(join(repo, ".claude/settings.json"), JSON.stringify(existing));
  const result = await init(repo, "1.0.0", pkg);
  assert.equal(settings().hooks.SessionStart.length, 1);
  assert.deepEqual(settings().hooks.SessionStart[0]?.hooks, existing.hooks.SessionStart[0]?.hooks);
  assert.equal(settings().hooks.SessionStart[0]?.hooks[0]?.command, foreign);
  assert.ok(result.entries.some((e) => e.kind === "same" && e.text.includes("settings.json")));
});

/** Path of the link Claude Code discovers the skill through. */
const LINK = ".claude/skills/cloud-ready";

test("init copies the skill with the package version", async () => {
  const result = await init(repo, "1.2.3", pkg);
  assert.equal(skillVersion(repo), "1.2.3");
  assert.equal(readFileSync(join(repo, SKILL_DIR, "reference/knowledge.md"), "utf8"), "knowledge 1.0.0\n");
  assert.ok(readFileSync(join(repo, SKILL_DIR, "SKILL.md"), "utf8").includes("name: cloud-ready"));
  assert.ok(result.lines.some((l) => l.includes(SKILL_DIR) && l.includes("1.2.3")), result.lines.join("\n"));
});

test("a second init at the same version leaves the skill untouched", async () => {
  await init(repo, "1.2.3", pkg);
  const file = join(repo, SKILL_DIR, "SKILL.md");
  const before = statSync(file).mtimeMs;
  const dirBefore = statSync(join(repo, SKILL_DIR)).ino;
  const result = await init(repo, "1.2.3", fakePackage(packages, "9.9.9"));
  assert.equal(statSync(file).mtimeMs, before);
  assert.equal(statSync(join(repo, SKILL_DIR)).ino, dirBefore);
  assert.equal(readFileSync(join(repo, SKILL_DIR, "reference/knowledge.md"), "utf8"), "knowledge 1.0.0\n");
  assert.ok(result.lines.some((l) => l.includes("ya está en")), result.lines.join("\n"));
});

test("init at a new version replaces the skill", async () => {
  await init(repo, "1.0.0", pkg);
  writeFileSync(join(repo, SKILL_DIR, "stale.md"), "old");
  await init(repo, "2.0.0", fakePackage(packages, "2.0.0"));
  assert.equal(skillVersion(repo), "2.0.0");
  assert.equal(readFileSync(join(repo, SKILL_DIR, "reference/knowledge.md"), "utf8"), "knowledge 2.0.0\n");
  assert.equal(existsSync(join(repo, SKILL_DIR, "stale.md")), false);
  assert.deepEqual(
    readdirSync(join(repo, ".agents/skills")).sort(),
    ["cloud-ready"],
  );
});

test("init links .claude/skills/cloud-ready", async () => {
  const result = await init(repo, "1.0.0", pkg);
  assert.equal(lstatSync(join(repo, LINK)).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(repo, LINK)), "../../.agents/skills/cloud-ready");
  assert.ok(existsSync(join(repo, LINK, "SKILL.md")));
  assert.ok(result.lines.some((l) => l.includes(LINK)), result.lines.join("\n"));
  const again = await init(repo, "1.0.0", pkg);
  assert.equal(again.lines.some((l) => l.includes(LINK)), false);
});

test("init leaves a .claude/skills symlink to .agents/skills alone", async () => {
  mkdirSync(join(repo, ".agents/skills"), { recursive: true });
  mkdirSync(join(repo, ".claude"));
  symlinkSync("../.agents/skills", join(repo, ".claude/skills"));
  await init(repo, "1.0.0", pkg);
  assert.equal(readlinkSync(join(repo, ".claude/skills")), "../.agents/skills");
  assert.equal(lstatSync(join(repo, ".agents/skills/cloud-ready")).isSymbolicLink(), false);
  assert.equal(realpathSync(join(repo, LINK)), realpathSync(join(repo, SKILL_DIR)));
});

test("init leaves an existing .claude/skills/cloud-ready alone", async () => {
  mkdirSync(join(repo, LINK), { recursive: true });
  writeFileSync(join(repo, LINK, "SKILL.md"), "mine");
  await init(repo, "1.0.0", pkg);
  assert.equal(lstatSync(join(repo, LINK)).isSymbolicLink(), false);
  assert.equal(readFileSync(join(repo, LINK, "SKILL.md"), "utf8"), "mine");
});

/** Parsed `.agents/runner.json`. */
const runnerJson = (): { runner?: string; tools: Record<string, string> } =>
  JSON.parse(readFileSync(join(repo, ".agents/runner.json"), "utf8"));

/** Every command text of our hook in settings.json. */
const hookTexts = (): string[] => settings().hooks.SessionStart.flatMap((e) => e.hooks.map((h) => h.command));

test("an empty repo gets runner.json with the chosen runner, a pinned hook and a Bun warning", async () => {
  const result = await init(repo, "1.2.3", pkg);
  assert.equal(chosen, 1);
  assert.equal(runnerJson().runner, "node");
  assert.equal(runnerJson().tools["agent-cloud-kit"], "1.2.3");
  assert.equal("version" in JSON.parse(readFileSync(join(repo, ".claude/cloud.json"), "utf8")), false);
  assert.ok(result.entries.some((e) => e.kind === "warn" && e.text.includes("Bun no está instalado")), result.lines.join("\n"));
  assert.equal(result.ok, true);
  assert.ok(hookTexts()[0]?.includes("npx --yes agent-cloud-kit@1.2.3 doctor"));
  assert.ok(checkToolPins(repo, "agent-cloud-kit", hookTexts()).every((c) => c.status === "ok"));
  assert.equal(hookTexts()[0], hookCommand("node", "1.2.3"));
});

test("an existing newer pin is not lowered and choose is not called", async () => {
  mkdirSync(join(repo, ".agents"));
  writeFileSync(join(repo, ".agents/runner.json"), JSON.stringify({ runner: "bun", tools: { "agent-cloud-kit": "9.0.0" } }));
  const result = await init(repo, "1.2.3", pkg);
  assert.equal(chosen, 0);
  assert.equal(runnerJson().tools["agent-cloud-kit"], "9.0.0");
  assert.ok(hookTexts()[0]?.includes("bunx --bun agent-cloud-kit@9.0.0 doctor"));
  assert.ok(result.entries.some((e) => e.kind === "same" && e.text.includes("runner.json")));
});

test("a runner.json without runner means bun, and no runner key is written", async () => {
  mkdirSync(join(repo, ".agents"));
  writeFileSync(join(repo, ".agents/runner.json"), JSON.stringify({ tools: {} }));
  await init(repo, "1.2.3", pkg);
  assert.equal(chosen, 0);
  assert.equal(runnerJson().runner, undefined);
  assert.equal(runnerJson().tools["agent-cloud-kit"], "1.2.3");
  assert.ok(hookTexts()[0]?.includes("bunx --bun agent-cloud-kit@1.2.3 doctor"));
});

test("another tool's entry in runner.json is kept", async () => {
  mkdirSync(join(repo, ".agents"));
  writeFileSync(join(repo, ".agents/runner.json"), JSON.stringify({ runner: "node", tools: { "@ramon-sg/issue-flow": "0.6.0" } }));
  await init(repo, "1.2.3", pkg);
  assert.deepEqual(runnerJson().tools, { "@ramon-sg/issue-flow": "0.6.0", "agent-cloud-kit": "1.2.3" });
});

test("the old hook is replaced by the pinned one, once", async () => {
  mkdirSync(join(repo, ".claude"));
  const old =
    "[ \"$CLAUDE_CODE_REMOTE\" = true ] || exit 0; /opt/agent-cloud-kit/bin/agent-cloud-kit session || echo 'agent-cloud-kit: el setup del entorno no corrió; revisa con npx agent-cloud-kit doctor'";
  writeFileSync(join(repo, ".claude/settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: old, timeout: 600 }] }] } }));
  const result = await init(repo, "1.2.3", pkg);
  assert.equal(hookTexts().length, 1);
  assert.equal(hookTexts()[0], hookCommand("node", "1.2.3"));
  assert.ok(result.entries.some((e) => e.kind === "ok" && e.text.includes("actualizó el hook")), result.lines.join("\n"));
});

test("the hook fallback line carries the agent-cloud-kit label with the pinned version", async () => {
  await init(repo, "1.2.3", pkg);
  assert.ok(hookTexts()[0]?.includes("echo 'agent-cloud-kit@1.2.3: el setup del entorno no corrió; revisa con npx --yes agent-cloud-kit@1.2.3 doctor'"), hookTexts()[0]);
  assert.ok(checkToolPins(repo, "agent-cloud-kit", hookTexts()).every((c) => c.status === "ok"));
});

test("the 1.0.0 hook without the label is replaced by the labeled one", async () => {
  mkdirSync(join(repo, ".claude"));
  const unlabeled =
    "[ \"$CLAUDE_CODE_REMOTE\" = true ] || exit 0; /opt/agent-cloud-kit/bin/agent-cloud-kit session || echo 'el setup del entorno no corrió; revisa con npx --yes agent-cloud-kit@1.2.3 doctor'";
  writeFileSync(join(repo, ".claude/settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: unlabeled, timeout: 600 }] }] } }));
  await init(repo, "1.2.3", pkg);
  assert.deepEqual(hookTexts(), [hookCommand("node", "1.2.3")]);
});

test("a new runner.json keeps a higher version from the legacy cloud.json", async () => {
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify({ version: "1.5.0" }));
  await init(repo, "1.2.3", pkg);
  assert.equal(runnerJson().tools["agent-cloud-kit"], "1.5.0");
  assert.equal(hookTexts()[0], hookCommand("node", "1.5.0"));
});

test("a new runner.json takes this version over a lower legacy cloud.json version", async () => {
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify({ version: "1.0.0-rc.9" }));
  await init(repo, "1.2.3", pkg);
  assert.equal(runnerJson().tools["agent-cloud-kit"], "1.2.3");
});

test("a second init says runner.json and the hook were already there", async () => {
  await init(repo, "1.2.3", pkg);
  const again = await init(repo, "1.2.3", pkg);
  assert.ok(again.entries.some((e) => e.kind === "same" && e.text.includes("runner.json")), again.lines.join("\n"));
  assert.ok(again.entries.some((e) => e.kind === "same" && e.text.includes("settings.json")), again.lines.join("\n"));
  assert.equal(chosen, 1);
});

test("an invalid runner.json is not overwritten", async () => {
  mkdirSync(join(repo, ".agents"));
  writeFileSync(join(repo, ".agents/runner.json"), "{ nope");
  const result = await init(repo, "1.2.3", pkg);
  assert.equal(result.ok, false);
  assert.equal(readFileSync(join(repo, ".agents/runner.json"), "utf8"), "{ nope");
  assert.ok(result.entries.some((e) => e.kind === "warn" && e.text.includes("runner.json")));
  assert.equal(existsSync(join(repo, ".claude/settings.json")), false);
});
