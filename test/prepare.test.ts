/**
 * @file Tests for `prepare`: the orchestration from an unprepared repo to a cloud session. Git runs
 * for real against a temp repo with a local bare `origin`; `claude`, `gh` and `git push` are fakes.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { continueLine, enterLine } from "../src/prepare/banner.ts";
import { InterruptedError, branchDay, prepare, verifyBranch } from "../src/prepare/index.ts";
import type { PrepareDeps } from "../src/prepare/index.ts";
import { captureProcess } from "../src/run.ts";
import type { Capture, Run } from "../src/run.ts";
import { fakePackage } from "./fake-package.ts";

/** Day used for the branch name. */
const TODAY = "20261102";

/** Branch `prepare` creates. */
const BRANCH = `chore/cloud-ready-${TODAY}`;

/** URL the fake `gh` prints. */
const PR_URL = "https://github.com/acme/app/pull/7";

/** Origin URL the fake `git remote get-url origin` reports. */
const ORIGIN_URL = "git@github.com:acme/app.git";

let root: string;
let repo: string;
let worktree: string;
let pkg: string;
let calls: Array<{ cmd: string; args: string[]; cwd?: string }>;
let printed: string[];
let asked: string[];
let waited: string[];

/** Behaviour of the fakes, set per test. */
let agent: (cwd: string) => void;
let agentFails: boolean;
let ghFails: boolean;
let existingPr: string | undefined;
let includeAnswer: string;

/**
 * Runs git for real in a folder.
 *
 * @param cwd - Folder.
 * @param args - Git arguments.
 * @returns Trimmed stdout.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/**
 * What a finished `configure` leaves: notes named in the config and the notes file.
 *
 * @param cwd - Worktree.
 */
function finishConfigure(cwd: string): void {
  const file = join(cwd, ".claude/cloud.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...config, notes: ".claude/cloud-notes.md", requiredEnv: ["API_TOKEN"] }, null, 2));
  writeFileSync(join(cwd, ".claude/cloud-notes.md"), "Corre todo.\n");
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "cc-prepare-")));
  const seed = join(root, "seed");
  mkdirSync(seed);
  git(seed, ["-c", "init.defaultBranch=main", "init", "-q"]);
  writeFileSync(join(seed, "README.md"), "app\n");
  writeFileSync(join(seed, ".env.example"), "API_TOKEN=\n");
  git(seed, ["add", "."]);
  git(seed, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"]);
  execFileSync("git", ["clone", "-q", "--bare", seed, join(root, "origin.git")]);
  execFileSync("git", ["clone", "-q", join(root, "origin.git"), join(root, "app")]);
  repo = join(root, "app");
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["config", "user.email", "t@t"]);
  worktree = join(root, "app-cloud-ready");
  pkg = fakePackage(join(root, "pkg"), "1.0.0");
  calls = [];
  printed = [];
  asked = [];
  waited = [];
  agent = finishConfigure;
  agentFails = false;
  ghFails = false;
  existingPr = undefined;
  includeAnswer = "";
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run: Run = async (cmd, args, opts) => {
  calls.push({ cmd, args, cwd: opts?.cwd });
  if (cmd === "git" && args[0] === "push") return;
  if (cmd === "git") {
    await captureProcess(cmd, args, opts);
    return;
  }
  if ((cmd === "claude" && args[0] !== "--cloud") || (cmd === "npm" && args[1] === "claude:free")) {
    if (agentFails) throw new Error("claude exited with code 1");
    agent(opts?.cwd ?? "");
  }
};

const capture: Capture = async (cmd, args, opts) => {
  calls.push({ cmd, args, cwd: opts?.cwd });
  if (cmd === "claude" && args[0] === "--help") return "Usage: claude [options]\n  --cloud  start a cloud session\n";
  if (cmd === "gh") {
    if (ghFails) throw new Error("gh: command not found");
    if (args[1] === "view") {
      if (existingPr === undefined) throw new Error("no pull requests found");
      return `${existingPr}\n`;
    }
    return `${PR_URL}\n`;
  }
  if (cmd === "git" && args.join(" ") === "remote get-url origin") return `${ORIGIN_URL}\n`;
  if (cmd === "git") return captureProcess(cmd, args, opts);
  throw new Error(`unexpected capture ${cmd}`);
};

const deps = (overrides: Partial<PrepareDeps> = {}): PrepareDeps => ({
  run,
  capture,
  choose: async (_message, _choices, initial) => initial,
  ask: async (question, suggestion) => {
    asked.push(question);
    return question.startsWith("¿Incluir estos cambios") ? includeAnswer : suggestion;
  },
  waitEnter: async (text) => {
    waited.push(text);
  },
  print: (line) => printed.push(line),
  packageVersion: "1.0.0",
  packageRoot: pkg,
  today: TODAY,
  isTty: true,
  ...overrides,
});

/** Argv of each recorded call, as one string. */
const argvs = (): string[] => calls.map((c) => [c.cmd, ...c.args].join(" "));

/** Files of the last commit in the worktree. */
const committed = (): string[] => git(worktree, ["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean);

test("runs the steps in order with the expected argv", async () => {
  const code = await prepare(repo, deps());
  assert.equal(code, 0, printed.join("\n"));
  const configure = calls.find((c) => c.cmd === "claude" && c.args[0]?.startsWith("/cloud-ready configure"));
  const cloud = calls.find((c) => c.cmd === "claude" && c.args[0] === "--cloud");
  assert.deepEqual(argvs(), [
    "git rev-parse --show-toplevel",
    "git remote get-url origin",
    "claude --help",
    `git rev-parse --verify --quiet refs/heads/${BRANCH}`,
    "git fetch -q origin",
    `git worktree add -b ${BRANCH} ${worktree} origin/main`,
    ["claude", configure?.args[0]].join(" "),
    "git add -- .claude/cloud.json .claude/settings.json .agents/skills/cloud-ready .claude/skills/cloud-ready docs/agent-cloud.md .claude/cloud-notes.md",
    "git status --porcelain=v1 -z --untracked-files=all",
    "git diff --cached --name-only",
    "git commit -m chore: prepara el repo para la nube de Claude Code",
    `git push -u origin ${BRANCH}`,
    `gh pr view ${BRANCH} --json number --jq .number`,
    "gh pr create --draft --fill",
    `claude --cloud /cloud-ready verify\n\n- Rama de prepare: ${BRANCH}\n- PR: #7`,
  ]);
  assert.equal(configure?.cwd, worktree);
  assert.equal(cloud?.cwd, worktree);
  assert.equal(calls.find((c) => c.args[0] === "push")?.cwd, worktree);
  assert.equal(asked.length, 0);
  assert.deepEqual(waited, [enterLine(false), continueLine(false)]);
  const out = printed.join("\n");
  assert.match(out, /## Configurar el entorno en claude\.ai/);
  assert.match(out, /API_TOKEN/);
  assert.ok(out.indexOf("Configurar el entorno") < out.lastIndexOf("push"));
  assert.match(printed.at(-1) ?? "", /push a chore\/cloud-ready-20261102 y un comentario en el PR/);
  assert.equal(git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]), BRANCH);
  assert.ok(committed().includes("docs/agent-cloud.md"));
  assert.ok(committed().includes(".claude/skills/cloud-ready"));
  assert.equal(git(repo, ["status", "--porcelain"]), "");
});

test("a failing local agent keeps the worktree and says how to resume", async () => {
  agentFails = true;
  const code = await prepare(repo, deps());
  assert.equal(code, 1);
  assert.ok(existsSync(worktree));
  assert.equal(git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]), BRANCH);
  assert.ok(printed.includes(`agent-cloud-kit: el agente local se detuvo; el worktree está en ${worktree}; corre npx agent-cloud-kit prepare --resume ahí para continuar`));
  assert.ok(!argvs().some((a) => a.startsWith("git commit") || a.startsWith("git push") || a.startsWith("claude --cloud")));
});

test("an agent that exits 0 without the notes file: prepare says why it stopped and how to resume", async () => {
  agent = () => undefined;
  const code = await prepare(repo, deps());
  assert.equal(code, 1);
  const why = printed.indexOf("agent-cloud-kit: configure no terminó: no existe el archivo de notas .claude/cloud-notes.md");
  const resume = printed.indexOf(`agent-cloud-kit: prepare se detuvo; el worktree está en ${worktree}; corre npx agent-cloud-kit prepare --resume ahí para continuar`);
  assert.ok(why >= 0 && resume > why, printed.join("\n"));
  assert.ok(!argvs().some((a) => a.startsWith("git commit")));
});

test("an agent that exits 0 with an invalid config: prepare prints the config error", async () => {
  agent = (cwd) => {
    finishConfigure(cwd);
    const file = join(cwd, ".claude/cloud.json");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), domains: ["https://bad"] }));
  };
  assert.equal(await prepare(repo, deps()), 1);
  assert.ok(printed.some((l) => l.startsWith("agent-cloud-kit: configure no terminó: ") && l.includes("https://bad")), printed.join("\n"));
  assert.ok(printed.includes(`agent-cloud-kit: prepare se detuvo; el worktree está en ${worktree}; corre npx agent-cloud-kit prepare --resume ahí para continuar`));
});

test("before Claude opens, prepare shows what will happen and waits for Enter", async () => {
  let before: string[] = [];
  let waitedBefore: string[] = [];
  agent = (cwd) => {
    before = [...printed];
    waitedBefore = [...waited];
    finishConfigure(cwd);
  };
  assert.equal(await prepare(repo, deps()), 0, printed.join("\n"));
  const screen = before.join("\n");
  assert.match(screen, /Ahora se abre Claude Code/);
  assert.match(screen, /sal con \/exit → prepare hace commit, push y PR/);
  assert.deepEqual(waitedBefore, [enterLine(false)]);
});

test("Ctrl+C at the Enter line before Claude keeps the worktree and opens nothing", async () => {
  const waitEnter = async (): Promise<void> => {
    throw new InterruptedError();
  };
  assert.equal(await prepare(repo, deps({ waitEnter })), 130);
  assert.ok(!calls.some((c) => c.cmd === "claude" && c.args[0] !== "--help"));
  assert.ok(printed.some((l) => l.startsWith("agent-cloud-kit: interrumpido; el worktree está en ")));
});

test("with claude-repo-guard's claude:free script, Claude opens through it", async () => {
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { "claude:free": "claude --dangerously-skip-permissions" } }));
  mkdirSync(join(repo, ".claude"));
  writeFileSync(join(repo, ".claude/repo-guard.config.json"), "{}");
  git(repo, ["add", "package.json", ".claude/repo-guard.config.json"]);
  git(repo, ["commit", "-q", "-m", "guard"]);
  git(repo, ["push", "-q", "origin", "HEAD:main"]);
  const code = await prepare(repo, deps());
  assert.equal(code, 0, printed.join("\n"));
  assert.ok(calls.some((c) => c.cmd === "npm" && c.args.join(" ") === "run claude:free -- /cloud-ready configure" && c.cwd === worktree));
  assert.match(printed.join("\n"), /Se abre con claude:free/);
});

test("every resume hint is an npx command", async () => {
  mkdirSync(worktree);
  assert.equal(await prepare(repo, deps()), 1);
  assert.ok(printed.some((l) => l.includes("continúa ahí con npx agent-cloud-kit prepare --resume")), printed.join("\n"));
});

test("--resume with configure unfinished says to finish it, then resume with npx", async () => {
  agentFails = true;
  assert.equal(await prepare(repo, deps()), 1);
  printed = [];
  assert.equal(await prepare(worktree, deps(), { resume: true }), 1);
  assert.ok(printed.some((l) => l.includes("configure no terminó") && l.includes("npx agent-cloud-kit prepare --resume")), printed.join("\n"));
});

test("other changes are listed and committed only on yes", async () => {
  agent = (cwd) => {
    finishConfigure(cwd);
    writeFileSync(join(cwd, "scratch.txt"), "x\n");
  };
  includeAnswer = "n";
  assert.equal(await prepare(repo, deps()), 0, printed.join("\n"));
  assert.ok(printed.some((l) => l.includes("scratch.txt")));
  assert.ok(asked.includes("¿Incluir estos cambios en el commit? [s/N]"));
  assert.ok(!committed().includes("scratch.txt"));
  assert.ok(existsSync(join(worktree, "scratch.txt")));
  assert.match(git(worktree, ["status", "--porcelain"]), /\?\? scratch\.txt/);
});

test("other changes are committed on yes", async () => {
  agent = (cwd) => {
    finishConfigure(cwd);
    writeFileSync(join(cwd, "scratch.txt"), "x\n");
  };
  includeAnswer = "Sí";
  assert.equal(await prepare(repo, deps()), 0, printed.join("\n"));
  assert.ok(committed().includes("scratch.txt"));
  assert.ok(argvs().includes("git add -- scratch.txt"));
});

test("an existing worktree dir stops before creating anything", async () => {
  mkdirSync(worktree);
  const code = await prepare(repo, deps());
  assert.equal(code, 1);
  assert.ok(printed.some((l) => l.includes(worktree) && /bórralo/.test(l)));
  assert.ok(!argvs().some((a) => a.startsWith("git fetch") || a.startsWith("git worktree")));
  assert.equal(asked.length, 0);
});

test("a working tree with uncommitted changes does not stop prepare", async () => {
  writeFileSync(join(repo, "README.md"), "changed\n");
  writeFileSync(join(repo, "untracked.txt"), "x\n");
  assert.equal(await prepare(repo, deps()), 0, printed.join("\n"));
  assert.ok(existsSync(worktree));
  assert.ok(!argvs().some((a) => a.startsWith("git status --porcelain ") || a === "git status --porcelain"));
  assert.equal(git(repo, ["status", "--porcelain"]).split("\n").length, 2);
});

test("an existing branch stops and says what to delete", async () => {
  git(repo, ["branch", BRANCH]);
  const code = await prepare(repo, deps());
  assert.equal(code, 1);
  assert.ok(printed.some((l) => l.includes(`git branch -D ${BRANCH}`)));
  assert.ok(!existsSync(worktree));
});

test("gh missing prints the compare link and continues to --cloud", async () => {
  ghFails = true;
  assert.equal(await prepare(repo, deps()), 0, printed.join("\n"));
  assert.ok(printed.some((l) => l.includes(`https://github.com/acme/app/compare/${BRANCH}?expand=1`)));
  const cloud = calls.find((c) => c.cmd === "claude" && c.args[0] === "--cloud");
  assert.equal(cloud?.args[1], `/cloud-ready verify\n\n- Rama de prepare: ${BRANCH}`);
});

test("--resume skips questions, worktree and the local agent", async () => {
  agentFails = true;
  assert.equal(await prepare(repo, deps()), 1);
  finishConfigure(worktree);
  calls = [];
  asked = [];
  const code = await prepare(worktree, deps(), { resume: true });
  assert.equal(code, 0, printed.join("\n"));
  assert.equal(asked.length, 0);
  const all = argvs();
  assert.ok(!all.some((a) => a.startsWith("git worktree") || a.startsWith("git fetch") || a.startsWith("claude /cloud-ready")));
  assert.ok(all.includes(`git push -u origin ${BRANCH}`));
  assert.ok(all.some((a) => a.startsWith("claude --cloud")));
  assert.ok(committed().includes(".claude/cloud.json"));
});

test("--resume outside a prepare worktree says there is nothing to resume", async () => {
  const code = await prepare(repo, deps(), { resume: true });
  assert.equal(code, 1);
  assert.ok(printed.some((l) => l.includes("no hay nada que reanudar")));
});

test("no tty exits 1 with the preflight message", async () => {
  const code = await prepare(repo, deps({ isTty: false }));
  assert.equal(code, 1);
  assert.ok(printed.some((l) => l.includes("prepare necesita una terminal interactiva")));
  assert.ok(!argvs().some((a) => a.startsWith("git fetch")));
});

test("the branch day is the local YYYYMMDD", () => {
  assert.equal(branchDay(new Date(2026, 10, 2, 23, 30)), "20261102");
  assert.equal(branchDay(new Date(2026, 0, 9)), "20260109");
});

test("--resume reuses the open PR instead of creating one", async () => {
  agentFails = true;
  assert.equal(await prepare(repo, deps()), 1);
  finishConfigure(worktree);
  existingPr = "12";
  calls = [];
  assert.equal(await prepare(worktree, deps(), { resume: true }), 0, printed.join("\n"));
  const all = argvs();
  assert.ok(all.includes(`gh pr view ${BRANCH} --json number --jq .number`));
  assert.ok(!all.includes("gh pr create --draft --fill"));
  assert.equal(calls.find((c) => c.args[0] === "--cloud")?.args[1], `/cloud-ready verify\n\n- Rama de prepare: ${BRANCH}\n- PR: #12`);
  assert.ok(!printed.some((l) => l.includes("/compare/")));
});

test("Ctrl+C at a question after the worktree exists keeps it and says how to resume", async () => {
  agent = (cwd) => {
    finishConfigure(cwd);
    writeFileSync(join(cwd, "scratch.txt"), "x\n");
  };
  const ask: PrepareDeps["ask"] = async (question, suggestion) => {
    if (question.startsWith("¿Incluir")) throw new InterruptedError();
    return suggestion;
  };
  const code = await prepare(repo, deps({ ask }));
  assert.equal(code, 130);
  assert.ok(existsSync(worktree));
  assert.equal(git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]), BRANCH);
  assert.ok(printed.includes(`agent-cloud-kit: interrumpido; el worktree está en ${worktree}; corre npx agent-cloud-kit prepare --resume ahí para continuar`));
  assert.ok(!argvs().some((a) => a.startsWith("git commit") || a.startsWith("git push")));
});

test("Ctrl+C while waiting for Enter keeps the pushed worktree and says how to resume", async () => {
  const waitEnter = async (): Promise<void> => {
    throw new InterruptedError();
  };
  assert.equal(await prepare(repo, deps({ waitEnter })), 130);
  assert.ok(printed.includes(`agent-cloud-kit: interrumpido; el worktree está en ${worktree}; corre npx agent-cloud-kit prepare --resume ahí para continuar`));
  assert.ok(!argvs().some((a) => a.startsWith("claude --cloud")));
});


test("a Ctrl+C while a child runs prints the resume line through onInterrupt, which is removed at the end", async () => {
  let handler: (() => void) | undefined;
  let removed = false;
  const onInterrupt = (h: () => boolean): (() => void) => {
    handler = h;
    return () => {
      removed = true;
    };
  };
  const pushRun: Run = async (cmd, args, opts) => {
    if (cmd === "git" && args[0] === "push") assert.equal(handler?.(), true);
    return run(cmd, args, opts);
  };
  assert.equal(await prepare(repo, deps({ onInterrupt, run: pushRun })), 0, printed.join("\n"));
  assert.ok(printed.includes(`agent-cloud-kit: interrumpido; el worktree está en ${worktree}; corre npx agent-cloud-kit prepare --resume ahí para continuar`));
  assert.equal(removed, true);
});

test("the test-audit project file is committed and agent deletions go through the question", async () => {
  agent = (cwd) => {
    finishConfigure(cwd);
    mkdirSync(join(cwd, ".agents/skills/test-audit"), { recursive: true });
    writeFileSync(join(cwd, ".agents/skills/test-audit/project.md"), "tests\n");
    rmSync(join(cwd, "README.md"));
  };
  includeAnswer = "y";
  assert.equal(await prepare(repo, deps()), 0, printed.join("\n"));
  assert.ok(argvs().some((a) => a.startsWith("git add -- ") && a.endsWith(".claude/cloud-notes.md .agents/skills/test-audit/project.md")));
  assert.ok(argvs().includes("git add -- README.md"));
  const status = git(worktree, ["show", "--name-status", "--format=", "HEAD"]);
  assert.match(status, /^D\tREADME\.md$/m);
  assert.match(status, /^A\t\.agents\/skills\/test-audit\/project\.md$/m);
});

test("a rename staged by the agent is listed with both paths and unstaged on no", async () => {
  agent = (cwd) => {
    finishConfigure(cwd);
    git(cwd, ["mv", "README.md", "DOCS.md"]);
  };
  includeAnswer = "n";
  assert.equal(await prepare(repo, deps()), 0, printed.join("\n"));
  assert.ok(printed.includes("    DOCS.md") && printed.includes("    README.md"));
  assert.ok(argvs().includes("git reset -q -- DOCS.md README.md"));
  assert.ok(!committed().includes("README.md") && !committed().includes("DOCS.md"));
  assert.ok(existsSync(join(worktree, "DOCS.md")));
});

test("a Ctrl+C inside the interactive claude does not end prepare", async () => {
  let handler: (() => boolean) | undefined;
  const results: boolean[] = [];
  const onInterrupt = (h: () => boolean): (() => void) => {
    handler = h;
    return () => undefined;
  };
  const claudeRun: Run = async (cmd, args, opts) => {
    if (cmd === "claude") results.push(handler?.() ?? true);
    return run(cmd, args, opts);
  };
  assert.equal(await prepare(repo, deps({ onInterrupt, run: claudeRun })), 0, printed.join("\n"));
  assert.deepEqual(results, [false, false]);
  assert.ok(!printed.some((l) => l.startsWith("agent-cloud-kit: interrumpido")));
  assert.equal(handler?.(), true);
});

test("a Ctrl+C inside an agent that then stops still leads to the notes check", async () => {
  let handler: (() => boolean) | undefined;
  const onInterrupt = (h: () => boolean): (() => void) => {
    handler = h;
    return () => undefined;
  };
  agent = () => {
    assert.equal(handler?.(), false);
  };
  assert.equal(await prepare(repo, deps({ onInterrupt })), 1);
  assert.ok(printed.includes(`agent-cloud-kit: prepare se detuvo; el worktree está en ${worktree}; corre npx agent-cloud-kit prepare --resume ahí para continuar`));
  assert.ok(!printed.some((l) => l.startsWith("agent-cloud-kit: interrumpido")));
});

test("the place menu offers a new PR (default) and the current branch", async () => {
  let shown: { message: string; values: string[]; initial: string } | undefined;
  const choose: PrepareDeps["choose"] = async (message, choices, initial) => {
    shown = { message, values: choices.map((c) => c.value), initial };
    return initial;
  };
  assert.equal(await prepare(repo, deps({ choose })), 0, printed.join("\n"));
  assert.deepEqual(shown, { message: "¿Dónde preparo el repo?", values: ["pr", "here"], initial: "pr" });
});

test("cancelling the place menu changes nothing", async () => {
  const choose: PrepareDeps["choose"] = async () => null;
  assert.equal(await prepare(repo, deps({ choose })), 1);
  assert.ok(printed.includes("agent-cloud-kit: no se cambió nada"));
  assert.ok(!existsSync(worktree));
  assert.ok(!existsSync(join(repo, ".claude/cloud.json")));
});

test("a dirty working tree does not matter for a new PR", async () => {
  writeFileSync(join(repo, "wip.txt"), "x\n");
  assert.equal(await prepare(repo, deps()), 0, printed.join("\n"));
  assert.ok(existsSync(join(repo, "wip.txt")));
});

test("the current branch: prepares the checkout without committing, pushing or a cloud session", async () => {
  writeFileSync(join(repo, "wip.txt"), "x\n");
  const head = git(repo, ["rev-parse", "HEAD"]);
  const code = await prepare(repo, deps({ choose: async <T extends string>() => "here" as T }));
  assert.equal(code, 0, printed.join("\n"));
  assert.ok(!existsSync(worktree));
  assert.equal(git(repo, ["rev-parse", "HEAD"]), head);
  for (const file of [".claude/cloud.json", ".claude/cloud-notes.md", "docs/agent-cloud.md"]) assert.ok(existsSync(join(repo, file)), file);
  const configure = calls.find((c) => c.cmd === "claude" && c.args[0] === "/cloud-ready configure");
  assert.equal(configure?.cwd, repo);
  assert.ok(!calls.some((c) => c.args[0] === "commit" || c.args[0] === "push" || c.args[0] === "--cloud" || c.cmd === "gh"));
  assert.deepEqual(waited, [enterLine(false)]);
  assert.match(printed.join("\n"), /Listo, sin commit\. 1\) Revisa los cambios con git diff;.*4\) Corre npx agent-cloud-kit verify/);
});

test("--here skips the menu", async () => {
  const choose: PrepareDeps["choose"] = async () => {
    throw new Error("menu shown");
  };
  assert.equal(await prepare(repo, deps({ choose }), { place: "here" }), 0, printed.join("\n"));
  assert.ok(!existsSync(worktree));
});

test("the current branch: an unfinished configure says how to continue", async () => {
  agent = () => {};
  assert.equal(await prepare(repo, deps(), { place: "here" }), 1);
  assert.ok(printed.some((l) => l.startsWith("agent-cloud-kit: configure no terminó: ")));
});

/**
 * Leaves the repo prepared on main, committed and pushed to the bare origin.
 */
async function preparedAndPushed(): Promise<void> {
  assert.equal(await prepare(repo, deps(), { place: "here" }), 0, printed.join("\n"));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "chore: nube"]);
  git(repo, ["push", "-q", "origin", "main"]);
  calls = [];
  printed = [];
}

test("verify launches the cloud session on the pushed current branch", async () => {
  await preparedAndPushed();
  existingPr = "9";
  assert.equal(await verifyBranch(repo, deps()), 0, printed.join("\n"));
  const cloud = calls.find((c) => c.cmd === "claude" && c.args[0] === "--cloud");
  assert.equal(cloud?.args[1], "/cloud-ready verify\n\n- Rama de prepare: main\n- PR: #9");
  assert.equal(cloud?.cwd, repo);
  assert.ok(printed.includes("agent-cloud-kit: la sesión cloud avisará con un push a main y un comentario en el PR"));
});

test("verify refuses a branch with commits not pushed", async () => {
  await preparedAndPushed();
  git(repo, ["commit", "-q", "--allow-empty", "-m", "local"]);
  assert.equal(await verifyBranch(repo, deps()), 1);
  assert.ok(printed.some((l) => l.includes("no está subida o tiene commits sin subir")));
  assert.ok(!calls.some((c) => c.args[0] === "--cloud"));
});

test("verify refuses uncommitted changes in the preparation, but not elsewhere", async () => {
  await preparedAndPushed();
  writeFileSync(join(repo, "wip.txt"), "x\n");
  assert.equal(await verifyBranch(repo, deps()), 0, printed.join("\n"));
  writeFileSync(join(repo, ".claude/cloud-notes.md"), "Otra cosa.\n");
  printed = [];
  assert.equal(await verifyBranch(repo, deps()), 1);
  assert.ok(printed.some((l) => l.includes("hay cambios sin commit en la preparación")));
});

test("verify in an unprepared repo points to prepare", async () => {
  assert.equal(await verifyBranch(repo, deps()), 1);
  assert.ok(printed.some((l) => l.includes("el repo no está preparado") && l.includes("npx agent-cloud-kit prepare")));
});
