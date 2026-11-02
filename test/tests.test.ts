/**
 * @file Tests for running the repo's cloud test levels and recording the result.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { main } from "../src/cli.ts";
import type { CliDeps } from "../src/cli.ts";
import type { Run } from "../src/run.ts";
import { readTestRecord, runTests, writeTestRecord } from "../src/tests.ts";

let root: string;
let repo: string;
let tools: string;
let seen: Array<{ cmd: string; args: string[]; cwd?: string; path?: string; timeoutMs?: number; stdio?: string }>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cc-tests-"));
  repo = join(root, "app");
  tools = join(root, "tools");
  mkdirSync(join(repo, ".claude"), { recursive: true });
  seen = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/**
 * Writes the repo's cloud.json.
 *
 * @param tests - The `tests` object.
 */
function config(tests: unknown): void {
  writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify({ version: "1.0.0", tests }));
}

const run: Run = async (cmd, args, opts) => {
  seen.push({ cmd, args, cwd: opts?.cwd, path: opts?.env?.PATH, timeoutMs: opts?.timeoutMs, stdio: opts?.stdio });
  if (args[1] === "bad") throw new Error("exit 1");
};

test("full runs minimum then full and keeps going after a failure", async () => {
  config({ minimum: "bad", full: "good" });
  const results = await runTests(repo, "full", { run, env: { PATH: "/usr/bin" }, toolsDir: tools });
  assert.deepEqual(results.map((r) => [r.level, r.command, r.ok]), [["minimum", "bad", false], ["full", "good", true]]);
  assert.deepEqual(seen.map((s) => [s.cmd, s.args[0], s.args[1], s.cwd, s.timeoutMs]), [
    ["bash", "-c", "bad", repo, undefined],
    ["bash", "-c", "good", repo, undefined],
  ]);
  assert.ok(results.every((r) => r.ms >= 0));
});

test("minimum runs only minimum", async () => {
  config({ minimum: "good", full: "good2" });
  const results = await runTests(repo, "minimum", { run, env: {}, toolsDir: tools });
  assert.equal(results.length, 1);
});

test("the tools dir is first on PATH", async () => {
  config({ minimum: "good" });
  writeFileSync(join(repo, ".nvmrc"), "22.0.0\n");
  mkdirSync(join(tools, "state"), { recursive: true });
  writeFileSync(
    join(tools, "state/app.json"),
    JSON.stringify({ fingerprint: "f", packageVersion: "1.0.0", finishedAt: "x", steps: [], resolved: { node: "22.0.0" } }),
  );
  await runTests(repo, "minimum", { run, env: { PATH: "/usr/bin" }, toolsDir: tools });
  assert.ok(seen[0]?.path?.startsWith(join(tools, "node-22.0.0", "bin")), seen[0]?.path);
  assert.ok(seen[0]?.path?.endsWith("/usr/bin"));
});

test("works locally with no state", async () => {
  config({ minimum: "good" });
  await runTests(repo, "minimum", { run, env: { PATH: "/usr/bin" }, toolsDir: tools });
  assert.ok(seen[0]?.path?.endsWith("/usr/bin"));
});

test("record round trip, and unreadable records give undefined", () => {
  assert.equal(readTestRecord(repo), undefined);
  const record = { level: "full" as const, results: [{ level: "full" as const, command: "x", ok: true, ms: 5 }], finishedAt: "2026-01-01T00:00:00.000Z", commit: "abc", remote: false };
  writeTestRecord(repo, record);
  assert.deepEqual(readTestRecord(repo), record);
  assert.ok(readFileSync(join(repo, ".claude/cloud-tests.json"), "utf8").endsWith("}\n"));
  writeFileSync(join(repo, ".claude/cloud-tests.json"), "{nope");
  assert.equal(readTestRecord(repo), undefined);
});

/**
 * Builds CLI deps for the repo.
 *
 * @param env - Extra environment.
 * @param printed - Collector of printed lines.
 * @returns The deps.
 */
function deps(env: NodeJS.ProcessEnv, printed: string[]): CliDeps {
  return {
    env: { AGENT_CLOUD_KIT_DIR: tools, ...env },
    run,
    docker: { start: () => undefined, ensure: async () => true },
    packageVersion: "1.0.0",
    print: (l) => printed.push(l),
    cwd: repo,
    capture: async (cmd, args, opts) => execFileSync(cmd, args, { cwd: opts?.cwd, encoding: "utf8" }),
  };
}

test("--record writes cloud-tests.json with remote from CLAUDE_CODE_REMOTE", async () => {
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "i"], { cwd: repo });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  config({ minimum: "good", full: "good" });
  const printed: string[] = [];
  assert.equal(await main(["test", "--level", "minimum", "--record"], deps({ CLAUDE_CODE_REMOTE: "true", CLAUDE_PROJECT_DIR: repo }, printed)), 0);
  const record = readTestRecord(repo);
  assert.equal(record?.commit, head);
  assert.equal(record?.remote, true);
  assert.equal(record?.level, "minimum");
  assert.equal(record?.results.length, 1);
  assert.match(printed[0] ?? "", /^agent-cloud-kit: ✓ minimum: good \(\d+\.\ds\)$/);
  await main(["test", "--record"], deps({ CLAUDE_PROJECT_DIR: repo }, printed));
  assert.equal(readTestRecord(repo)?.remote, false);
  assert.equal(readTestRecord(repo)?.level, "full");
});

test("a failing result exits 1", async () => {
  config({ minimum: "bad" });
  const printed: string[] = [];
  assert.equal(await main(["test", "--level", "minimum"], deps({ CLAUDE_PROJECT_DIR: repo }, printed)), 1);
  assert.match(printed[0] ?? "", /✗ minimum: bad/);
});

test("a missing level exits 1 with the message", async () => {
  config({ minimum: "good" });
  const printed: string[] = [];
  assert.equal(await main(["test"], deps({ CLAUDE_PROJECT_DIR: repo }, printed)), 1);
  assert.deepEqual(printed, ["agent-cloud-kit: no tests.full in .claude/cloud.json"]);
  assert.equal(seen.length, 0);
});

test("an unknown level exits 1", async () => {
  config({ minimum: "good" });
  const printed: string[] = [];
  assert.equal(await main(["test", "--level", "huge"], deps({ CLAUDE_PROJECT_DIR: repo }, printed)), 1);
  assert.match(printed.join("\n"), /--level/);
  assert.equal(seen.length, 0);
});

test("help lists test", async () => {
  const printed: string[] = [];
  await main(["--help"], deps({}, printed));
  assert.ok(printed.join("\n").includes("test [--level"));
});
