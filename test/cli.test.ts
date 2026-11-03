/**
 * @file Tests for the command line wiring of setup, session and docker.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { main } from "../src/cli.ts";
import type { CliDeps } from "../src/cli.ts";
import type { Run } from "../src/run.ts";
import { fakePackage } from "./fake-package.ts";

let root: string;
let home: string;
let tools: string;
let calls: Array<{ cmd: string; args: string[] }>;
let envs: Array<NodeJS.ProcessEnv | undefined>;
let printed: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cc-cli-"));
  home = join(root, "home");
  tools = join(root, "tools");
  mkdirSync(home);
  calls = [];
  envs = [];
  printed = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run: Run = async (cmd, args, opts) => {
  calls.push({ cmd, args });
  envs.push(opts?.env);
  if (args.includes("fail")) throw new Error("exit 1");
};

const deps = (up = true): CliDeps => ({
  env: { AGENT_CLOUD_KIT_DIR: tools, AGENT_CLOUD_KIT_HOME: home },
  run,
  docker: { start: () => undefined, ensure: async () => up },
  packageVersion: "1.0.0",
  print: (line) => printed.push(line),
  cwd: root,
  packageRoot: fakePackage(root, "1.0.0"),
});

/**
 * Creates a repo in the temp home.
 *
 * @param name - Folder name.
 * @param config - Raw cloud.json contents, or undefined for none.
 * @returns The repo path.
 */
function makeRepo(name: string, config?: unknown): string {
  const repo = join(home, name);
  mkdirSync(join(repo, ".git"), { recursive: true });
  if (config !== undefined) {
    mkdirSync(join(repo, ".claude"));
    writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify(config));
  }
  return repo;
}

test("setup --repo with another version runs anyway and warns, without relaunching", async () => {
  const repo = makeRepo("app", { version: "2.0.0", setup: ["echo hi"] });
  const code = await main(["setup", "--repo", repo], deps());
  assert.equal(code, 0);
  assert.ok(printed.includes("agent-cloud-kit: corriendo la versión 1.0.0, aunque .claude/cloud.json pide la 2.0.0"));
  assert.ok(!calls.some((c) => c.cmd === "npx"));
  assert.ok(calls.some((c) => c.cmd === "bash" && c.args[1] === "echo hi"));
  assert.ok(printed.includes(`agent-cloud-kit: setup ${repo}: 2 pasos, 0 fallaron`));
});

test("setup without --repo skips, runs and relaunches in series and exits 0", async () => {
  const none = makeRepo("a-none");
  const same = makeRepo("b-same", { version: "1.0.0", setup: ["fail"] });
  const other = makeRepo("c-other", { version: "1.2.0" });
  const code = await main(["setup"], deps());
  assert.equal(code, 0);
  assert.ok(printed.includes(`agent-cloud-kit: se omite ${none}: no hay .claude/cloud.json`));
  assert.ok(printed.includes(`agent-cloud-kit: setup ${same}: 2 pasos, 1 fallaron (setup: fail)`));
  assert.deepEqual(calls.at(-1), {
    cmd: "npx",
    args: ["-y", "agent-cloud-kit@1.2.0", "setup", "--repo", other],
  });
});

test("a failed relaunch is reported and setup still exits 0", async () => {
  makeRepo("app", { version: "9.9.9" });
  const failing: Run = async () => {
    throw new Error("npx exited with code 1");
  };
  const code = await main(["setup"], { ...deps(), run: failing });
  assert.equal(code, 0);
  assert.ok(printed.some((l) => l.includes("relanzamiento") && l.includes("npx exited with code 1")));
});

test("session delegates to the installed version the repo asks for", async () => {
  const repo = makeRepo("app", { version: "1.5.0" });
  const bin = join(tools, "pkg", "1.5.0", "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "agent-cloud-kit"), "");
  const code = await main(["session"], { ...deps(), env: { ...deps().env, CLAUDE_PROJECT_DIR: repo } });
  assert.equal(code, 0);
  assert.deepEqual(calls, [{ cmd: join(bin, "agent-cloud-kit"), args: ["session"] }]);
  assert.equal(envs[0]?.AGENT_CLOUD_KIT_DELEGATED, "1");
  assert.deepEqual(printed, []);
});

test("a delegated session never delegates again", async () => {
  const repo = makeRepo("app", { version: "1.5.0" });
  const bin = join(tools, "pkg", "1.5.0", "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "agent-cloud-kit"), "");
  const env = { ...deps().env, CLAUDE_PROJECT_DIR: repo, AGENT_CLOUD_KIT_DELEGATED: "1" };
  assert.equal(await main(["session"], { ...deps(), env }), 0);
  assert.ok(!calls.some((c) => c.cmd === join(bin, "agent-cloud-kit")));
  assert.ok(printed[0]?.startsWith("agent-cloud-kit: estás en una sesión cloud de Claude Code"));
});

test("session runs itself when the asked version is not installed", async () => {
  const repo = makeRepo("app", { version: "1.5.0" });
  const code = await main(["session"], { ...deps(), env: { ...deps().env, CLAUDE_PROJECT_DIR: repo } });
  assert.equal(code, 0);
  assert.ok(printed[0]?.startsWith("agent-cloud-kit: estás en una sesión cloud de Claude Code"));
});

test("docker exits 0 when it responds and 1 with the log path otherwise", async () => {
  assert.equal(await main(["docker"], deps()), 0);
  assert.equal(await main(["docker"], deps(false)), 1);
  assert.ok(printed.includes("agent-cloud-kit: dockerd no arrancó; revisa /var/log/agent-cloud-kit-dockerd.log"));
});

test("--version prints the package version and unknown commands exit 1", async () => {
  assert.equal(await main(["--version"], deps()), 0);
  assert.equal(printed[0], "1.0.0");
  assert.equal(await main(["bogus"], deps()), 1);
});

test("setup --repo without a value prints an error and runs nothing", async () => {
  makeRepo("app", { version: "1.0.0" });
  assert.equal(await main(["setup", "--repo"], deps()), 0);
  assert.equal(await main(["setup", "--repo", "--other"], deps()), 0);
  assert.deepEqual(printed, ["agent-cloud-kit: --repo necesita una ruta", "agent-cloud-kit: --repo necesita una ruta"]);
  assert.deepEqual(calls, []);
});

test("setup --repo resolves a relative path against the cwd", async () => {
  makeRepo("app", { version: "1.0.0" });
  assert.equal(await main(["setup", "--repo", "home/app"], deps()), 0);
  assert.ok(printed.includes(`agent-cloud-kit: setup ${join(home, "app")}: 1 pasos, 0 fallaron`));
});

test("a repo that throws does not stop the next ones", async () => {
  const first = makeRepo("a-first", { version: "1.0.0" });
  const second = makeRepo("b-second", { version: "1.2.0" });
  const throwing = (line: string): void => {
    if (line.includes(`setup ${first}:`)) throw new Error("boom");
    printed.push(line);
  };
  assert.equal(await main(["setup"], { ...deps(), print: throwing }), 0);
  assert.ok(printed.includes(`agent-cloud-kit: error en setup de ${first}: boom`));
  assert.deepEqual(calls.at(-1), { cmd: "npx", args: ["-y", "agent-cloud-kit@1.2.0", "setup", "--repo", second] });
});

test("init writes the config and hook, doctor exits 1 when a check fails", async () => {
  const repo = join(home, "fresh");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const base = { ...deps(), env: { AGENT_CLOUD_KIT_DIR: tools, AGENT_CLOUD_KIT_HOME: home, CLAUDE_PROJECT_DIR: repo } };
  assert.equal(await main(["init"], base), 0);
  assert.equal(await main(["doctor"], { ...base, capture: async () => "403", dockerInfo: () => true }), 1);
  assert.equal(await main(["doctor"], { ...base, capture: async () => "200", dockerInfo: () => true }), 1);
  assert.ok(printed.some((l) => l.includes("estado: falta")));
  assert.ok(printed.some((l) => l.includes("registry.npmjs.org: ok")));
});

test("help lists doctor and init", async () => {
  await main(["--help"], deps());
  assert.ok(printed.join("\n").includes("doctor"));
  assert.ok(printed.join("\n").includes("init"));
});

test("help lists prepare --resume", async () => {
  await main(["--help"], deps());
  assert.ok(printed.join("\n").includes("prepare [--resume]"));
});

test("prepare runs preflight and exits 1 without a terminal", async () => {
  const captured: string[] = [];
  const capture = async (cmd: string, args: string[]): Promise<string> => {
    captured.push([cmd, ...args].join(" "));
    throw new Error("not available");
  };
  assert.equal(await main(["prepare"], { ...deps(), capture, isTty: false }), 1);
  assert.ok(printed.includes("agent-cloud-kit: prepare necesita una terminal interactiva (corre el comando directamente en tu terminal)"));
  assert.ok(captured.includes("claude --help"));
  assert.ok(!calls.length);
});

test("prepare rejects unknown options", async () => {
  assert.equal(await main(["prepare", "--force"], deps()), 1);
  assert.ok(printed.some((l) => l.includes("opción desconocida para prepare: --force")));
});
