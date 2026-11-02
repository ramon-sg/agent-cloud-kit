/**
 * @file The `prepare` command: walks the user, in a local terminal, from an unprepared repo to a
 * pushed branch with the cloud setup and a cloud session that verifies it. It never deletes the
 * worktree or the branch it creates.
 */
import { existsSync, lstatSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { readConfig } from "../config.ts";
import { CONFIG_FILE, OUTPUT_PREFIX, PACKAGE } from "../constants.ts";
import { defaultBranch } from "../detect.ts";
import { init } from "../init.ts";
import { renderEnvironmentSection, writeManual } from "../manual.ts";
import type { Capture, Run } from "../run.ts";
import { preflight, suggestSecrets } from "./detect.ts";
import { configurePrompt, verifyPrompt } from "./prompts.ts";
import { askAll } from "./questions.ts";
import type { Ask } from "./questions.ts";

/** Prefix of the branch `prepare` creates; the day follows it. */
const BRANCH_PREFIX = "chore/cloud-ready-";

/** Suffix added to the repo folder name to name the worktree folder, next to the repo. */
const WORKTREE_SUFFIX = "-cloud-ready";

/** Notes file the skill writes when `notes` is not set in the config. */
const DEFAULT_NOTES_FILE = ".claude/cloud-notes.md";

/** Files `prepare` always commits when they exist, relative to the worktree. */
const KNOWN_PATHS = [
  CONFIG_FILE,
  ".claude/settings.json",
  ".agents/skills/cloud-ready",
  ".claude/skills/cloud-ready",
  "docs/agent-cloud.md",
] as const;

/** Project file of the test-audit skill, committed too when it exists. */
const TEST_AUDIT_PROJECT_FILE = ".agents/skills/test-audit/project.md";

/** Message of the commit `prepare` makes. */
const COMMIT_MESSAGE = "chore: prepare the repo for the Claude Code cloud";

/** Question asked before committing changes outside the known files. */
const INCLUDE_QUESTION = "Include these changes in the commit? [y/N]";

/** Answers to `INCLUDE_QUESTION` that mean yes. */
const YES_ANSWER = /^y(es)?$/i;

/** Text shown while the user configures the environment in claude.ai. */
const WAIT_TEXT = "Configure the environment in claude.ai, then press Enter";

/** Matches a GitHub remote URL (https or ssh) and captures `owner/repo`. */
const GITHUB_REMOTE = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/;

/** Matches a pull request URL and captures its number. */
const PR_URL = /\/pull\/(\d+)/;

/** Command that continues a prepare run; `npx` because a first-time user does not have the binary on PATH. */
const RESUME_COMMAND = `npx ${PACKAGE} prepare --resume`;

/** Printed just before the local agent starts: `prepare` continues only when `claude` exits. */
const EXIT_CLAUDE_HINT = `${OUTPUT_PREFIX}when the skill says configure is done, exit claude (/exit) and prepare will commit, push and open the PR`;

/** Exit code for success. */
const EXIT_OK = 0;

/** Exit code for failure. */
const EXIT_FAIL = 1;

/** Exit code after Ctrl+C (128 + SIGINT). */
export const EXIT_INTERRUPTED = 130;

/** Matches a PR number printed by `gh pr view --jq .number`. */
const PR_NUMBER = /^\d+$/;

/** Thrown by `ask` or `waitEnter` when the user presses Ctrl+C. */
export class InterruptedError extends Error {
  /** Builds the error. */
  constructor() {
    super("interrupted");
    this.name = "InterruptedError";
  }
}

/** What `prepare` has created so far; read by the interrupt handler. */
interface Progress {
  /** Worktree folder, once it exists. */
  worktree?: string;
  /** True while an interactive `claude` owns the terminal: Ctrl+C is for it, not for `prepare`. */
  childOwnsTerminal?: boolean;
}

/** Handler `prepare` registers for Ctrl+C; returns true when the process should exit. */
export type InterruptHandler = () => boolean;

/** Everything `prepare` needs from the outside, so tests can inject fakes. */
export interface PrepareDeps {
  /** Runs a command with inherited stdio. */
  run: Run;
  /** Runs a command and returns its stdout. */
  capture: Capture;
  /** Asks one question. */
  ask: Ask;
  /** Shows a text and waits for Enter. */
  waitEnter: (text: string) => Promise<void>;
  /** Prints one line. */
  print: (line: string) => void;
  /** Version of this package. */
  packageVersion: string;
  /** Root of this package, which holds the skill. */
  packageRoot: string;
  /** Today, as `YYYYMMDD` (see `branchDay`); names the branch. */
  today: string;
  /** Whether stdin and stdout are interactive terminals. */
  isTty: boolean;
  /**
   * Registers a handler for every Ctrl+C until the returned function removes it. While it is
   * registered the default exit must not happen: the caller exits with `EXIT_INTERRUPTED` only
   * when the handler returns true (it returns false while an interactive `claude` owns the
   * terminal). Nothing is registered when omitted.
   */
  onInterrupt?: (handler: InterruptHandler) => () => void;
}

/** Options of `prepare`. */
export interface PrepareOptions {
  /** Continue in an existing prepare worktree: skip the questions, the worktree and the local agent. */
  resume?: boolean;
}

/**
 * Formats a local date as the day of the branch name.
 *
 * @param date - Date, read in the local time zone.
 * @returns `YYYYMMDD`.
 * @example
 * branchDay(new Date(2026, 10, 2)); // "20261102"
 */
export function branchDay(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/**
 * Says where the worktree is and how to continue there.
 *
 * @param reason - What happened, e.g. "the local agent stopped".
 * @param worktree - Worktree folder.
 * @returns The line to print.
 * @example
 * resumeLine("interrupted", "/home/u/app-cloud-ready"); // "interrupted; the worktree is at ...; run ... --resume there"
 */
function resumeLine(reason: string, worktree: string): string {
  return `${reason}; the worktree is at ${worktree}; run ${RESUME_COMMAND} there`;
}

/**
 * Runs a capture and trims its output; never throws.
 *
 * @param deps - Dependencies.
 * @param cmd - Executable.
 * @param args - Arguments.
 * @param cwd - Working directory.
 * @returns Trimmed stdout, or undefined when the command failed.
 * @example
 * await tryCapture(deps, "git", ["rev-parse", "--show-toplevel"], "/repo"); // "/repo"
 */
async function tryCapture(deps: PrepareDeps, cmd: string, args: string[], cwd: string): Promise<string | undefined> {
  try {
    return (await deps.capture(cmd, args, { cwd })).trim();
  } catch {
    return undefined;
  }
}

/**
 * Turns an unknown error into its message.
 *
 * @param err - Anything thrown.
 * @returns The message.
 * @example
 * message(new Error("x")); // "x"
 */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Tells whether a path exists, without following a symlink (so a link counts even if broken).
 *
 * @param path - Absolute path.
 * @returns True when something is there.
 * @example
 * entryExists("/repo/.claude/skills/cloud-ready"); // true
 */
function entryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Names the worktree folder: next to the repo, with `WORKTREE_SUFFIX`.
 *
 * @param repo - Repo root.
 * @returns Absolute path of the worktree.
 * @example
 * worktreePath("/home/u/app"); // "/home/u/app-cloud-ready"
 */
function worktreePath(repo: string): string {
  return join(dirname(repo), `${basename(repo)}${WORKTREE_SUFFIX}`);
}

/**
 * Finds the notes file the config names, when `configure` finished.
 *
 * @param worktree - Worktree root.
 * @returns Undefined when the config reads without errors and its notes file exists; else why not.
 * @example
 * configureProblem("/home/u/app-cloud-ready"); // undefined
 */
function configureProblem(worktree: string): string | undefined {
  const { config, errors } = readConfig(worktree);
  if (!config || errors.length) return errors[0] ?? `${CONFIG_FILE} not found`;
  const notes = config.notes ?? DEFAULT_NOTES_FILE;
  const rel = relative(worktree, join(worktree, notes));
  const inside = !isAbsolute(notes) && rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`);
  try {
    if (inside && statSync(join(worktree, notes)).isFile()) return undefined;
  } catch {
    // NOTE: a missing file is reported below.
  }
  return `the notes file ${notes} does not exist`;
}

/**
 * Lists the paths of `git status --porcelain=v1 -z` output.
 *
 * @param output - Raw output (NUL-separated entries).
 * @returns Paths, renames giving both the new and the old path.
 * @example
 * statusPaths("?? a.txt\0"); // ["a.txt"]
 */
function statusPaths(output: string): string[] {
  const tokens = output.split("\0").filter((t) => t !== "");
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    const code = token.slice(0, 2);
    paths.push(token.slice(3));
    if (code.includes("R") || code.includes("C")) {
      const old = tokens[++i];
      if (old !== undefined) paths.push(old);
    }
  }
  return paths;
}

/**
 * Tells whether a path is one of the given paths or inside one of them.
 *
 * @param path - Repo-relative path.
 * @param roots - Repo-relative paths.
 * @returns True when covered.
 * @example
 * covered(".agents/skills/cloud-ready/SKILL.md", [".agents/skills/cloud-ready"]); // true
 */
function covered(path: string, roots: string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

/**
 * Builds the GitHub compare link for a branch from the origin URL.
 *
 * @param originUrl - URL of `origin`, if known.
 * @param branch - Branch to compare.
 * @returns The link, or undefined when origin is not on GitHub.
 * @example
 * compareLink("git@github.com:acme/app.git", "b"); // "https://github.com/acme/app/compare/b?expand=1"
 */
function compareLink(originUrl: string | undefined, branch: string): string | undefined {
  const slug = GITHUB_REMOTE.exec(originUrl ?? "")?.[1];
  return slug ? `https://github.com/${slug}/compare/${branch}?expand=1` : undefined;
}

/**
 * Finds the worktree and branch to resume.
 *
 * @param repo - Git root where `prepare --resume` runs: the worktree, or the repo next to it.
 * @param deps - Dependencies.
 * @returns The worktree and its branch, or undefined when there is none.
 * @example
 * await findResume("/home/u/app-cloud-ready", deps); // { worktree: "...", branch: "chore/cloud-ready-20261102" }
 */
async function findResume(repo: string, deps: PrepareDeps): Promise<{ worktree: string; branch: string } | undefined> {
  for (const worktree of [repo, worktreePath(repo)]) {
    if (!existsSync(worktree)) continue;
    const branch = await tryCapture(deps, "git", ["rev-parse", "--abbrev-ref", "HEAD"], worktree);
    if (branch?.startsWith(BRANCH_PREFIX)) return { worktree, branch };
  }
  return undefined;
}

/**
 * Steps 2–5: asks the questions, creates the worktree, installs the kit and runs the local agent.
 *
 * @param repo - Git root of the repo.
 * @param branch - Branch to create.
 * @param worktree - Worktree folder to create.
 * @param deps - Dependencies.
 * @param progress - Gets the worktree once it exists.
 * @returns True when the worktree is ready to commit.
 * @throws InterruptedError when the user presses Ctrl+C during the questions.
 * @example
 * await createAndConfigure("/home/u/app", "chore/cloud-ready-20261102", "/home/u/app-cloud-ready", deps, {});
 */
async function createAndConfigure(repo: string, branch: string, worktree: string, deps: PrepareDeps, progress: Progress): Promise<boolean> {
  if (existsSync(worktree)) {
    deps.print(`${OUTPUT_PREFIX}${worktree} already exists; remove it (git worktree remove ${worktree}) or continue there with ${RESUME_COMMAND}`);
    return false;
  }
  if ((await tryCapture(deps, "git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repo)) !== undefined) {
    deps.print(`${OUTPUT_PREFIX}branch ${branch} already exists; delete it (git branch -D ${branch}) or run prepare another day`);
    return false;
  }
  const answers = await askAll(deps.ask, { secrets: suggestSecrets(repo) }, deps.print);
  const base = `origin/${defaultBranch(repo)}`;
  try {
    await deps.run("git", ["fetch", "-q", "origin"], { cwd: repo });
    await deps.run("git", ["worktree", "add", "-b", branch, worktree, base], { cwd: repo });
    progress.worktree = worktree;
  } catch (err) {
    deps.print(`${OUTPUT_PREFIX}could not create the worktree: ${message(err)}`);
    return false;
  }
  const stopped = resumeLine("the local agent stopped", worktree);
  try {
    const result = init(worktree, deps.packageVersion, deps.packageRoot);
    for (const line of result.lines) deps.print(line);
    if (!result.ok) {
      deps.print(stopped);
      return false;
    }
  } catch (err) {
    deps.print(`${OUTPUT_PREFIX}${message(err)}`);
    deps.print(stopped);
    return false;
  }
  deps.print(EXIT_CLAUDE_HINT);
  try {
    await runInteractive(deps, progress, [configurePrompt(answers)], worktree);
  } catch {
    deps.print(stopped);
    return false;
  }
  const problem = configureProblem(worktree);
  if (problem !== undefined) {
    deps.print(`${OUTPUT_PREFIX}configure did not finish: ${problem}`);
    deps.print(resumeLine("prepare stopped", worktree));
    return false;
  }
  return true;
}

/**
 * Step 6: writes the manual, commits the setup (and, if the user says so, the other changes),
 * pushes the branch and opens a draft PR.
 *
 * @param worktree - Worktree root.
 * @param branch - Its branch.
 * @param deps - Dependencies.
 * @returns The PR number when known (an open PR for the branch is reused), or false when the
 *   branch could not be committed or pushed.
 * @throws InterruptedError when the user presses Ctrl+C at the question.
 * @example
 * await commitAndPush("/home/u/app-cloud-ready", "chore/cloud-ready-20261102", deps); // { pr: "7" }
 */
async function commitAndPush(worktree: string, branch: string, deps: PrepareDeps): Promise<{ pr?: string } | false> {
  try {
    writeManual(worktree, deps.packageVersion);
    const notes = readConfig(worktree).config?.notes ?? DEFAULT_NOTES_FILE;
    const known = [...KNOWN_PATHS, notes, TEST_AUDIT_PROJECT_FILE].filter((path) => entryExists(join(worktree, path)));
    await deps.run("git", ["add", "--", ...known], { cwd: worktree });
    const status = await deps.capture("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: worktree });
    const others = statusPaths(status).filter((path) => !covered(path, known));
    if (others.length) {
      deps.print(`${OUTPUT_PREFIX}the local agent also changed:`);
      for (const path of others) deps.print(`  ${path}`);
      if (YES_ANSWER.test((await deps.ask(INCLUDE_QUESTION, "")).trim())) {
        await deps.run("git", ["add", "--", ...others], { cwd: worktree });
      } else {
        await deps.run("git", ["reset", "-q", "--", ...others], { cwd: worktree });
        deps.print(`${OUTPUT_PREFIX}left uncommitted in ${worktree}`);
      }
    }
    const staged = await deps.capture("git", ["diff", "--cached", "--name-only"], { cwd: worktree });
    if (staged.trim()) await deps.run("git", ["commit", "-m", COMMIT_MESSAGE], { cwd: worktree });
    else deps.print(`${OUTPUT_PREFIX}nothing new to commit`);
    await deps.run("git", ["push", "-u", "origin", branch], { cwd: worktree });
  } catch (err) {
    if (err instanceof InterruptedError) throw err;
    deps.print(`${OUTPUT_PREFIX}could not commit and push: ${message(err)}; fix it in ${worktree} and run ${RESUME_COMMAND} there`);
    return false;
  }
  const existing = await tryCapture(deps, "gh", ["pr", "view", branch, "--json", "number", "--jq", ".number"], worktree);
  if (existing !== undefined && PR_NUMBER.test(existing)) {
    deps.print(`${OUTPUT_PREFIX}reusing the open PR #${existing}`);
    return { pr: existing };
  }
  try {
    const url = await deps.capture("gh", ["pr", "create", "--draft", "--fill"], { cwd: worktree });
    deps.print(`${OUTPUT_PREFIX}draft PR: ${url.trim()}`);
    return { pr: PR_URL.exec(url)?.[1] };
  } catch {
    const origin = await tryCapture(deps, "git", ["remote", "get-url", "origin"], worktree);
    const link = compareLink(origin, branch);
    deps.print(`${OUTPUT_PREFIX}could not open the PR with gh; open it by hand${link ? `: ${link}` : ` from branch ${branch}`}`);
    return {};
  }
}

/**
 * Prepares a repo for Claude Code cloud sessions: checks, asks, creates a worktree on a new
 * branch, runs the local agent with the `cloud-ready` skill, commits, pushes, opens a draft PR,
 * waits while the user configures the environment and starts a cloud session that verifies it.
 *
 * @param repo - Folder where the user runs `prepare` (inside the repo, or the worktree with resume).
 * @param deps - Dependencies.
 * @param options - `resume` continues in an existing prepare worktree.
 * @returns 0 when the cloud session was started, 130 after Ctrl+C at a question, 1 otherwise.
 * @example
 * process.exitCode = await prepare(process.cwd(), deps);
 */
export async function prepare(repo: string, deps: PrepareDeps, options: PrepareOptions = {}): Promise<number> {
  const gitRoot = await tryCapture(deps, "git", ["rev-parse", "--show-toplevel"], repo);
  const cwd = gitRoot ?? repo;
  const hasOrigin = (await tryCapture(deps, "git", ["remote", "get-url", "origin"], cwd)) !== undefined;
  const clean = options.resume ? true : (await tryCapture(deps, "git", ["status", "--porcelain"], cwd)) === "";
  const claudeHelp = await tryCapture(deps, "claude", ["--help"], cwd);
  const problems = preflight({ isTty: deps.isTty, gitRoot, hasOrigin, clean, claudeHelp });
  if (problems.length || gitRoot === undefined) {
    for (const problem of problems) deps.print(`${OUTPUT_PREFIX}${problem}`);
    return EXIT_FAIL;
  }
  const progress: Progress = {};
  const stop = deps.onInterrupt?.(() => {
    if (progress.childOwnsTerminal) return false;
    deps.print(interruptedLine(progress));
    return true;
  });
  try {
    return await prepareSteps(gitRoot, deps, options, progress);
  } catch (err) {
    if (!(err instanceof InterruptedError)) throw err;
    deps.print(interruptedLine(progress));
    return EXIT_INTERRUPTED;
  } finally {
    stop?.();
  }
}

/**
 * Runs an interactive `claude` that owns the terminal. Ctrl+C meanwhile belongs to Claude (it
 * interrupts the agent), so the interrupt handler ignores it until the child returns.
 *
 * @param deps - Dependencies.
 * @param progress - Marks the child as owning the terminal.
 * @param args - Arguments of `claude`.
 * @param cwd - Worktree.
 * @returns Resolves when `claude` exits 0.
 * @throws When `claude` exits non-zero.
 * @example
 * await runInteractive(deps, progress, ["--cloud", prompt], "/home/u/app-cloud-ready");
 */
async function runInteractive(deps: PrepareDeps, progress: Progress, args: string[], cwd: string): Promise<void> {
  progress.childOwnsTerminal = true;
  try {
    await deps.run("claude", args, { cwd });
  } finally {
    progress.childOwnsTerminal = false;
  }
}

/**
 * The line printed on Ctrl+C: where the worktree is, when it exists.
 *
 * @param progress - What exists so far.
 * @returns The line.
 * @example
 * interruptedLine({}); // "agent-cloud-kit: interrupted; nothing was created"
 */
function interruptedLine(progress: Progress): string {
  return progress.worktree === undefined ? `${OUTPUT_PREFIX}interrupted; nothing was created` : resumeLine("interrupted", progress.worktree);
}

/**
 * Everything after the preflight: resume or create the worktree, commit, wait, launch.
 *
 * @param gitRoot - Git root where `prepare` runs.
 * @param deps - Dependencies.
 * @param options - Options of `prepare`.
 * @param progress - Gets the worktree once it exists.
 * @returns The exit code.
 * @throws InterruptedError when the user presses Ctrl+C at a question.
 * @example
 * await prepareSteps("/home/u/app", deps, {}, {}); // 0
 */
async function prepareSteps(gitRoot: string, deps: PrepareDeps, options: PrepareOptions, progress: Progress): Promise<number> {
  let worktree: string;
  let branch: string;
  if (options.resume) {
    const found = await findResume(gitRoot, deps);
    if (!found) {
      deps.print(`${OUTPUT_PREFIX}nothing to resume: run it in the ${WORKTREE_SUFFIX} worktree on a ${BRANCH_PREFIX}* branch`);
      return EXIT_FAIL;
    }
    ({ worktree, branch } = found);
    progress.worktree = worktree;
    const problem = configureProblem(worktree);
    if (problem) {
      deps.print(`${OUTPUT_PREFIX}configure is not finished in ${worktree}: ${problem}; run claude "/cloud-ready configure" there first, then ${RESUME_COMMAND}`);
      return EXIT_FAIL;
    }
  } else {
    branch = `${BRANCH_PREFIX}${deps.today}`;
    worktree = worktreePath(gitRoot);
    if (!(await createAndConfigure(gitRoot, branch, worktree, deps, progress))) return EXIT_FAIL;
  }
  const pushed = await commitAndPush(worktree, branch, deps);
  if (!pushed) return EXIT_FAIL;
  const config = readConfig(worktree).config;
  if (config) deps.print(renderEnvironmentSection(config));
  await deps.waitEnter(WAIT_TEXT);
  try {
    await runInteractive(deps, progress, ["--cloud", verifyPrompt({ branch, pr: pushed.pr })], worktree);
  } catch (err) {
    deps.print(`${OUTPUT_PREFIX}claude --cloud failed: ${message(err)}; run ${RESUME_COMMAND} in ${worktree} to try again`);
    return EXIT_FAIL;
  }
  deps.print(`${OUTPUT_PREFIX}the cloud session will report back as a push to ${branch} and a comment on the PR`);
  return EXIT_OK;
}
