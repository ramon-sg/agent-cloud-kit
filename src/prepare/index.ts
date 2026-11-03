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
import { MANUAL_FILE, renderEnvironmentSection, writeManual } from "../manual.ts";
import type { Capture, Run } from "../run.ts";
import type { Choose } from "../select.ts";
import { claudeCommand, continueLine, enterLine, hasFreeScript, renderBanner } from "./banner.ts";
import { preflight } from "./detect.ts";
import { formatLine, initKind, nextSteps, styleMarkdown, unprefixed } from "./ui.ts";
import type { Kind } from "./ui.ts";
import { configurePrompt, verifyPrompt } from "./prompts.ts";
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
const COMMIT_MESSAGE = "chore: prepara el repo para la nube de Claude Code";

/** Question asked before committing changes outside the known files. */
const INCLUDE_QUESTION = "¿Incluir estos cambios en el commit? [s/N]";

/** Answers to `INCLUDE_QUESTION` that mean yes. */
const YES_ANSWER = /^(s|si|sí|y|yes)$/i;

/** Text shown while the user configures the environment in claude.ai. */

/** Matches a GitHub remote URL (https or ssh) and captures `owner/repo`. */
const GITHUB_REMOTE = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/;

/** Matches a pull request URL and captures its number. */
const PR_URL = /\/pull\/(\d+)/;

/** Command that continues a prepare run; `npx` because a first-time user does not have the binary on PATH. */
const RESUME_COMMAND = `npx ${PACKAGE} prepare --resume`;


/** Question of the place menu. */
const PLACE_QUESTION = "¿Dónde preparo el repo?";

/** Command that launches the cloud verification of the current branch. */
const VERIFY_COMMAND = `npx ${PACKAGE} verify`;

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
    super("interrumpido");
    this.name = "InterruptedError";
  }
}

/** What `prepare` has created so far; read by the interrupt handler. */
interface Progress {
  /** Worktree folder, once it exists. */
  worktree?: string;
  /** True while an interactive `claude` owns the terminal: Ctrl+C is for it, not for `prepare`. */
  childOwnsTerminal?: boolean;
  /** True once `prepare` started changing the current checkout (the "current branch" place). */
  here?: boolean;
}

/** Where `prepare` works: a new worktree that ends in a PR, or the current checkout. */
export type Place = "pr" | "here";

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
  /** Shows a menu and returns the picked value, or null when cancelled. */
  choose: Choose;
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
  /** Whether to print ANSI colors (the screen before Claude opens). */
  color?: boolean;
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
  /** Continue in an existing prepare worktree: skip creating the worktree and the local agent. */
  resume?: boolean;
  /** Where to work, skipping the menu. */
  place?: Place;
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
 * Prints one line with the icon and color of its kind (or the plain prefix without color).
 *
 * @param deps - Dependencies (`print`, `color`).
 * @param kind - Kind of line.
 * @param text - Text, without prefix.
 * @example
 * say(deps, "ok", "PR en borrador: https://github.com/acme/app/pull/7");
 */
function say(deps: PrepareDeps, kind: Kind, text: string): void {
  deps.print(formatLine(kind, text, deps.color ?? false));
}

/**
 * Says where the worktree is and how to continue there.
 *
 * @param reason - What happened, e.g. "the local agent stopped".
 * @param worktree - Worktree folder.
 * @returns The line to print.
 * @example
 * resumeLine("interrumpido", "/home/u/app-cloud-ready"); // "interrumpido; el worktree está en ...; corre ... --resume ahí para continuar"
 */
function resumeLine(reason: string, worktree: string): string {
  return `${reason}; el worktree está en ${worktree}; corre ${RESUME_COMMAND} ahí para continuar`;
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
  if (!config || errors.length) return errors[0] ?? `no existe ${CONFIG_FILE}`;
  const notes = config.notes ?? DEFAULT_NOTES_FILE;
  const rel = relative(worktree, join(worktree, notes));
  const inside = !isAbsolute(notes) && rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`);
  try {
    if (inside && statSync(join(worktree, notes)).isFile()) return undefined;
  } catch {
    // NOTE: a missing file is reported below.
  }
  return `no existe el archivo de notas ${notes}`;
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
 * Steps 2–5: creates the worktree, installs the kit and runs the local agent.
 *
 * @param repo - Git root of the repo.
 * @param branch - Branch to create.
 * @param worktree - Worktree folder to create.
 * @param deps - Dependencies.
 * @param progress - Gets the worktree once it exists.
 * @returns True when the worktree is ready to commit.
 * @example
 * await createAndConfigure("/home/u/app", "chore/cloud-ready-20261102", "/home/u/app-cloud-ready", deps, {});
 */
async function createAndConfigure(repo: string, branch: string, worktree: string, deps: PrepareDeps, progress: Progress): Promise<boolean> {
  if (existsSync(worktree)) {
    say(deps, "fail", `${worktree} ya existe; bórralo (git worktree remove ${worktree}) o continúa ahí con ${RESUME_COMMAND}`);
    return false;
  }
  if ((await tryCapture(deps, "git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repo)) !== undefined) {
    say(deps, "fail", `la rama ${branch} ya existe; bórrala (git branch -D ${branch}) o corre prepare otro día`);
    return false;
  }
  const base = `origin/${defaultBranch(repo)}`;
  try {
    await deps.run("git", ["fetch", "-q", "origin"], { cwd: repo });
    await deps.run("git", ["worktree", "add", "-b", branch, worktree, base], { cwd: repo });
    progress.worktree = worktree;
    say(deps, "ok", `se creó el worktree ${worktree} en la rama ${branch}`);
  } catch (err) {
    say(deps, "fail", `no se pudo crear el worktree: ${message(err)}`);
    return false;
  }
  const stopped = resumeLine("el agente local se detuvo", worktree);
  try {
    const result = init(worktree, deps.packageVersion, deps.packageRoot);
    for (const line of result.lines) say(deps, initKind(line), unprefixed(line));
    if (!result.ok) {
      say(deps, "warn", stopped);
      return false;
    }
  } catch (err) {
    say(deps, "fail", `${message(err)}`);
    say(deps, "warn", stopped);
    return false;
  }
  try {
    await runConfigure(deps, progress, "pr", worktree);
  } catch (err) {
    if (err instanceof InterruptedError) throw err;
    say(deps, "warn", stopped);
    return false;
  }
  const problem = configureProblem(worktree);
  if (problem !== undefined) {
    say(deps, "fail", `configure no terminó: ${problem}`);
    say(deps, "warn", resumeLine("prepare se detuvo", worktree));
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
      say(deps, "warn", `el agente local también cambió:`);
      for (const path of others) deps.print(`    ${path}`);
      if (YES_ANSWER.test((await deps.ask(INCLUDE_QUESTION, "")).trim())) {
        await deps.run("git", ["add", "--", ...others], { cwd: worktree });
      } else {
        await deps.run("git", ["reset", "-q", "--", ...others], { cwd: worktree });
        say(deps, "warn", `quedó sin commitear en ${worktree}`);
      }
    }
    const staged = await deps.capture("git", ["diff", "--cached", "--name-only"], { cwd: worktree });
    if (staged.trim()) await deps.run("git", ["commit", "-m", COMMIT_MESSAGE], { cwd: worktree });
    else say(deps, "same", `no hay nada nuevo que commitear`);
    await deps.run("git", ["push", "-u", "origin", branch], { cwd: worktree });
    say(deps, "ok", `se subió la rama ${branch}`);
  } catch (err) {
    if (err instanceof InterruptedError) throw err;
    say(deps, "fail", `no se pudo hacer commit y push: ${message(err)}; corrígelo en ${worktree} y corre ${RESUME_COMMAND} ahí`);
    return false;
  }
  const existing = await tryCapture(deps, "gh", ["pr", "view", branch, "--json", "number", "--jq", ".number"], worktree);
  if (existing !== undefined && PR_NUMBER.test(existing)) {
    say(deps, "ok", `se reutiliza el PR abierto #${existing}`);
    return { pr: existing };
  }
  try {
    const url = await deps.capture("gh", ["pr", "create", "--draft", "--fill"], { cwd: worktree });
    say(deps, "ok", `PR en borrador: ${url.trim()}`);
    return { pr: PR_URL.exec(url)?.[1] };
  } catch {
    const origin = await tryCapture(deps, "git", ["remote", "get-url", "origin"], worktree);
    const link = compareLink(origin, branch);
    say(deps, "warn", `no se pudo abrir el PR con gh; ábrelo a mano${link ? `: ${link}` : ` desde la rama ${branch}`}`);
    return {};
  }
}

/**
 * Prepares a repo for Claude Code cloud sessions: checks, asks where to work (a new PR or the
 * current branch, see `prepareHere`), creates a worktree on a new branch, runs the local agent with the `cloud-ready` skill, commits, pushes, opens a draft PR,
 * waits while the user configures the environment and starts a cloud session that verifies it.
 *
 * @param repo - Folder where the user runs `prepare` (inside the repo, or the worktree with resume).
 * @param deps - Dependencies.
 * @param options - `resume` continues in an existing prepare worktree.
 * @returns 0 when the cloud session was started (or, in the current branch, when it is prepared),
 *   130 after Ctrl+C at a question, 1 otherwise.
 * @example
 * process.exitCode = await prepare(process.cwd(), deps);
 */
export async function prepare(repo: string, deps: PrepareDeps, options: PrepareOptions = {}): Promise<number> {
  const gitRoot = await tryCapture(deps, "git", ["rev-parse", "--show-toplevel"], repo);
  const cwd = gitRoot ?? repo;
  const hasOrigin = (await tryCapture(deps, "git", ["remote", "get-url", "origin"], cwd)) !== undefined;
  const claudeHelp = await tryCapture(deps, "claude", ["--help"], cwd);
  const problems = preflight({ isTty: deps.isTty, gitRoot, hasOrigin, claudeHelp });
  if (problems.length || gitRoot === undefined) {
    for (const problem of problems) say(deps, "fail", `${problem}`);
    return EXIT_FAIL;
  }
  const progress: Progress = {};
  const stop = deps.onInterrupt?.(() => {
    if (progress.childOwnsTerminal) return false;
    say(deps, "warn", interruptedLine(progress));
    return true;
  });
  try {
    return await prepareSteps(gitRoot, deps, options, progress);
  } catch (err) {
    if (!(err instanceof InterruptedError)) throw err;
    say(deps, "warn", interruptedLine(progress));
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
 * @param command - Command and arguments that open Claude.
 * @param cwd - Worktree.
 * @returns Resolves when `claude` exits 0.
 * @throws When `claude` exits non-zero.
 * @example
 * await runInteractive(deps, progress, { cmd: "claude", args: ["--cloud", prompt] }, "/home/u/app-cloud-ready");
 */
async function runInteractive(deps: PrepareDeps, progress: Progress, command: { cmd: string; args: string[] }, cwd: string): Promise<void> {
  progress.childOwnsTerminal = true;
  try {
    await deps.run(command.cmd, command.args, { cwd });
  } finally {
    progress.childOwnsTerminal = false;
  }
}

/**
 * Shows the screen before Claude Code opens, waits for Enter, and runs the local agent with
 * `cloud-ready configure` (through the repo's `claude:free` script when it has one).
 *
 * @param deps - Dependencies.
 * @param progress - Marks the child as owning the terminal.
 * @param place - Where `prepare` works.
 * @param cwd - Folder where Claude runs.
 * @returns Resolves when Claude exits 0.
 * @throws InterruptedError on Ctrl+C at the Enter line; an error when Claude exits non-zero.
 * @example
 * await runConfigure(deps, progress, "pr", "/home/u/app-cloud-ready");
 */
async function runConfigure(deps: PrepareDeps, progress: Progress, place: Place, cwd: string): Promise<void> {
  const color = deps.color ?? false;
  for (const line of renderBanner({ place, free: hasFreeScript(cwd), color })) deps.print(line);
  await deps.waitEnter(enterLine(color));
  await runInteractive(deps, progress, claudeCommand(cwd, configurePrompt()), cwd);
}

/**
 * The line printed on Ctrl+C: where the worktree is, when it exists.
 *
 * @param progress - What exists so far.
 * @returns The line.
 * @example
 * interruptedLine({}); // "interrumpido; no se creó nada"
 */
function interruptedLine(progress: Progress): string {
  if (progress.here) return "interrumpido; lo que alcanzó a cambiar quedó sin commit en tu rama";
  return progress.worktree === undefined ? "interrumpido; no se creó nada" : resumeLine("interrumpido", progress.worktree);
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
      say(deps, "fail", `no hay nada que reanudar: corre prepare --resume en el worktree *${WORKTREE_SUFFIX}, sobre una rama ${BRANCH_PREFIX}*`);
      return EXIT_FAIL;
    }
    ({ worktree, branch } = found);
    progress.worktree = worktree;
    const problem = configureProblem(worktree);
    if (problem) {
      say(deps, "fail", `configure no terminó en ${worktree}: ${problem}; corre claude "/cloud-ready configure" ahí primero y luego ${RESUME_COMMAND}`);
      return EXIT_FAIL;
    }
  } else {
    const place = options.place ?? (await askPlace(gitRoot, deps));
    if (place === null) {
      say(deps, "same", `no se cambió nada`);
      return EXIT_FAIL;
    }
    if (place === "here") return prepareHere(gitRoot, deps, progress);
    branch = `${BRANCH_PREFIX}${deps.today}`;
    worktree = worktreePath(gitRoot);
    if (!(await createAndConfigure(gitRoot, branch, worktree, deps, progress))) return EXIT_FAIL;
  }
  const pushed = await commitAndPush(worktree, branch, deps);
  if (!pushed) return EXIT_FAIL;
  const config = readConfig(worktree).config;
  if (config) for (const line of styleMarkdown(renderEnvironmentSection(config, deps.packageVersion), deps.color ?? false)) deps.print(line);
  await deps.waitEnter(continueLine(deps.color ?? false));
  try {
    await runInteractive(deps, progress, { cmd: "claude", args: ["--cloud", verifyPrompt({ branch, pr: pushed.pr })] }, worktree);
  } catch (err) {
    say(deps, "fail", `falló claude --cloud: ${message(err)}; corre ${RESUME_COMMAND} en ${worktree} para reintentar`);
    return EXIT_FAIL;
  }
  say(deps, "ok", `la sesión cloud avisará con un push a ${branch} y un comentario en el PR`);
  return EXIT_OK;
}

/**
 * Asks where to work, with the same options as agent-kitchen.
 *
 * @param gitRoot - Git root.
 * @param deps - Dependencies.
 * @returns The place, or null when cancelled.
 * @example
 * await askPlace("/home/u/app", deps); // "pr"
 */
async function askPlace(gitRoot: string, deps: PrepareDeps): Promise<Place | null> {
  return deps.choose<Place>(
    PLACE_QUESTION,
    [
      { value: "pr", label: "En un PR nuevo", hint: `recomendado · parte de origin/${defaultBranch(gitRoot)}, no toca tu rama ni tus archivos` },
      { value: "here", label: "En la rama actual, sin commit", hint: `los revisas con git diff, haces commit y push, y luego corres ${VERIFY_COMMAND}` },
    ],
    "pr",
  );
}

/**
 * The "current branch" place: installs the kit, runs the local agent and writes the manual in the
 * checkout, without committing. The cloud verification comes later, with `verify`, once pushed.
 *
 * @param gitRoot - Git root (the current checkout).
 * @param deps - Dependencies.
 * @param progress - Marks the checkout as changed.
 * @returns The exit code.
 * @example
 * await prepareHere("/home/u/app", deps, {}); // 0
 */
async function prepareHere(gitRoot: string, deps: PrepareDeps, progress: Progress): Promise<number> {
  progress.here = true;
  const stopped = `prepare se detuvo; lo que alcanzó a cambiar quedó sin commit en tu rama`;
  try {
    const result = init(gitRoot, deps.packageVersion, deps.packageRoot);
    for (const line of result.lines) say(deps, initKind(line), unprefixed(line));
    if (!result.ok) {
      say(deps, "warn", stopped);
      return EXIT_FAIL;
    }
  } catch (err) {
    say(deps, "fail", `${message(err)}`);
    say(deps, "warn", stopped);
    return EXIT_FAIL;
  }
  try {
    await runConfigure(deps, progress, "here", gitRoot);
  } catch (err) {
    if (err instanceof InterruptedError) throw err;
    say(deps, "warn", stopped);
    return EXIT_FAIL;
  }
  const problem = configureProblem(gitRoot);
  if (problem !== undefined) {
    say(deps, "fail", `configure no terminó: ${problem}; corre claude "/cloud-ready configure" y luego prepare otra vez`);
    return EXIT_FAIL;
  }
  try {
    writeManual(gitRoot, deps.packageVersion);
  } catch (err) {
    say(deps, "fail", `no se pudo escribir ${MANUAL_FILE}: ${message(err)}`);
    return EXIT_FAIL;
  }
  const config = readConfig(gitRoot).config;
  if (config) for (const line of styleMarkdown(renderEnvironmentSection(config, deps.packageVersion), deps.color ?? false)) deps.print(line);
  const steps = ["Revisa los cambios con git diff", "Haz commit y push", `Configura el entorno en claude.ai (${MANUAL_FILE})`, `Corre ${VERIFY_COMMAND}`];
  for (const line of nextSteps("Listo, sin commit", steps, deps.color ?? false)) deps.print(line);
  return EXIT_OK;
}

/**
 * Launches the cloud verification of the current branch: checks that the preparation is there
 * and pushed (the cloud only sees origin), then starts `claude --cloud` with `cloud-ready verify`.
 *
 * @param repo - Folder where the user runs `verify`.
 * @param deps - Dependencies (`ask`, `choose`, `waitEnter` and `today` are not used).
 * @returns 0 when the cloud session was started, 1 otherwise.
 * @example
 * process.exitCode = await verifyBranch(process.cwd(), deps);
 */
export async function verifyBranch(repo: string, deps: PrepareDeps): Promise<number> {
  const gitRoot = await tryCapture(deps, "git", ["rev-parse", "--show-toplevel"], repo);
  const cwd = gitRoot ?? repo;
  const hasOrigin = (await tryCapture(deps, "git", ["remote", "get-url", "origin"], cwd)) !== undefined;
  const claudeHelp = await tryCapture(deps, "claude", ["--help"], cwd);
  const problems = preflight({ isTty: deps.isTty, gitRoot, hasOrigin, claudeHelp }, "verify");
  if (problems.length || gitRoot === undefined) {
    for (const problem of problems) say(deps, "fail", `${problem}`);
    return EXIT_FAIL;
  }
  const branch = await tryCapture(deps, "git", ["rev-parse", "--abbrev-ref", "HEAD"], gitRoot);
  if (branch === undefined || branch === "HEAD") {
    say(deps, "fail", `no estás en una rama; cámbiate a la rama que quieres verificar`);
    return EXIT_FAIL;
  }
  const problem = configureProblem(gitRoot);
  if (problem !== undefined) {
    say(deps, "fail", `el repo no está preparado (${problem}); corre npx ${PACKAGE} prepare primero`);
    return EXIT_FAIL;
  }
  const notes = readConfig(gitRoot).config?.notes ?? DEFAULT_NOTES_FILE;
  const files = [CONFIG_FILE, MANUAL_FILE, notes].filter((path) => entryExists(join(gitRoot, path)));
  const dirty = await tryCapture(deps, "git", ["status", "--porcelain", "--", ...files], gitRoot);
  if (dirty) {
    say(deps, "fail", `hay cambios sin commit en la preparación; haz commit y push: la nube solo ve lo que está en origin`);
    return EXIT_FAIL;
  }
  const head = await tryCapture(deps, "git", ["rev-parse", "HEAD"], gitRoot);
  const remote = (await tryCapture(deps, "git", ["ls-remote", "origin", `refs/heads/${branch}`], gitRoot))?.split(/\s/)[0];
  if (!head || remote !== head) {
    say(deps, "fail", `la rama ${branch} no está subida o tiene commits sin subir; haz git push y vuelve a correr verify`);
    return EXIT_FAIL;
  }
  const found = await tryCapture(deps, "gh", ["pr", "view", branch, "--json", "number", "--jq", ".number"], gitRoot);
  const pr = found !== undefined && PR_NUMBER.test(found) ? found : undefined;
  const progress: Progress = {};
  const stop = deps.onInterrupt?.(() => !progress.childOwnsTerminal);
  try {
    await runInteractive(deps, progress, { cmd: "claude", args: ["--cloud", verifyPrompt({ branch, pr })] }, gitRoot);
  } catch (err) {
    say(deps, "fail", `falló claude --cloud: ${message(err)}`);
    return EXIT_FAIL;
  } finally {
    stop?.();
  }
  say(deps, "ok", `la sesión cloud avisará con un push a ${branch}${pr ? " y un comentario en el PR" : ""}`);
  return EXIT_OK;
}
