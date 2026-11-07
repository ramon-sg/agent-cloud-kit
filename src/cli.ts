#!/usr/bin/env node
/**
 * @file Command line entry point of agent-cloud-kit: wires `setup`, `session`, `docker`, `doctor`,
 * `init`, `manual`, `prepare` and `verify` to their modules, relaunching or delegating to the version each
 * repo pins. It picks the language of the terminal once (`--lang`, then `AGENT_CLOUD_KIT_LANG`).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { renderBlock } from "./block.ts";
import { readConfig } from "./config.ts";
import { CONFIG_FILE, DOCKERD_LOG, OUTPUT_PREFIX, RUNNING_PACKAGE_ROOT, homeDir, toolsDir } from "./constants.ts";
import { doctor, doctorBlock } from "./doctor.ts";
import { dockerResponds, realDocker } from "./docker.ts";
import type { DockerOps } from "./docker.ts";
import { init } from "./init.ts";
import { LANG_ENV, LangError, resolveLang, splitLang } from "./lang.ts";
import type { Lang } from "./lang.ts";
import { findRepos, packageBin, planSetup, relaunch } from "./launcher.ts";
import type { SetupPlanItem } from "./launcher.ts";
import { MANUAL_FILE, writeManual } from "./manual.ts";
import { stepLabel, t, useLang } from "./messages/index.ts";
import { EXIT_INTERRUPTED, InterruptedError, branchDay, prepare, verifyBranch } from "./prepare/index.ts";
import type { InterruptHandler, Place, PrepareDeps } from "./prepare/index.ts";
import type { Ask } from "./prepare/questions.ts";
import { captureProcess, runProcess } from "./run.ts";
import type { Capture, Run } from "./run.ts";
import { chooseTerminal } from "./select.ts";
import type { Choose } from "./select.ts";
import { session } from "./session.ts";
import { setupRepo } from "./setup.ts";

/** Environment variable with the project dir that Claude Code passes to hooks. */
const PROJECT_DIR_VAR = "CLAUDE_PROJECT_DIR";

/** Environment marker set on a delegated `session`, so it never delegates again. */
export const DELEGATED_ENV = "AGENT_CLOUD_KIT_DELEGATED";

/** Value of `DELEGATED_ENV` that marks a delegated run. */
const DELEGATED_VALUE = "1";

/** Option that limits setup to one repo. */
const REPO_OPTION = "--repo";

/** Timeout of the git call that finds the repo root, in milliseconds. */
const GIT_TIMEOUT_MS = 10_000;

/** Option of `prepare` that continues in an existing prepare worktree. */
const RESUME_OPTION = "--resume";

/** Option of `prepare`: work in a new worktree that ends in a PR, without asking. */
const PR_OPTION = "--pr";

/** Option of `prepare`: work in the current checkout, without committing and without asking. */
const HERE_OPTION = "--here";

/** Exit code for success. */
const EXIT_OK = 0;

/** Exit code for failure or wrong usage. */
const EXIT_FAIL = 1;

/** Everything the CLI needs from the outside, so tests can inject fakes. */
export interface CliDeps {
  /** Process environment. */
  env: NodeJS.ProcessEnv;
  /** Process runner. */
  run: Run;
  /** Docker operations. */
  docker: DockerOps;
  /** Version of this package. */
  packageVersion: string;
  /** Prints one line on stdout. */
  print: (line: string) => void;
  /** Output capture used by `doctor` to run curl; the real one when omitted. */
  capture?: Capture;
  /** Docker probe used by `doctor`; `docker info` when omitted. */
  dockerInfo?: () => boolean;
  /** Working directory, used to find the repo when `CLAUDE_PROJECT_DIR` is not set. */
  cwd: string;
  /** Root of the package that setup copies into the tools dir and init copies the skill from; the running package when omitted. */
  packageRoot?: string;
  /** Asks one question for `prepare`; reads stdin when omitted. */
  ask?: Ask;
  /** Shows a menu for `prepare`; uses the terminal when omitted. */
  choose?: Choose;
  /** Waits for Enter for `prepare`; reads stdin when omitted. */
  waitEnter?: (text: string) => Promise<void>;
  /** Whether stdin and stdout are terminals; taken from the process when omitted. */
  isTty?: boolean;
  /** Whether stdout is a terminal, where final messages come with Kuro; taken from the process when omitted. */
  stdoutTty?: boolean;
  /** Today as `YYYYMMDD`; the current local day when omitted. */
  today?: string;
  /** Registers a Ctrl+C handler for `prepare`; the process one (exiting 130) when omitted. */
  onInterrupt?: (handler: InterruptHandler) => () => void;
}

/**
 * Reads the package version from the package.json next to `src/` or `dist/`.
 *
 * @returns The version string.
 * @throws When package.json cannot be read or parsed.
 */
function readVersion(): string {
  const file = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(file, "utf8")) as { version: string };
  return pkg.version;
}

/**
 * Turns an unknown error into its message.
 *
 * @param err - Anything thrown.
 * @returns The message.
 */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs setup for one repo with this version and prints its summary.
 *
 * @param repo - Repo root.
 * @param deps - CLI dependencies.
 */
async function runOne(repo: string, deps: CliDeps): Promise<void> {
  const { config, errors } = readConfig(repo);
  for (const error of errors) deps.print(`${OUTPUT_PREFIX}${repo}: ${error}`);
  if (config && config.version !== deps.packageVersion) {
    deps.print(OUTPUT_PREFIX + t().cli.versionMismatch(deps.packageVersion, CONFIG_FILE, config.version));
  }
  const state = await setupRepo(repo, {
    toolsDir: toolsDir(deps.env),
    run: deps.run,
    packageVersion: deps.packageVersion,
    env: deps.env,
    docker: deps.docker,
    packageRoot: deps.packageRoot,
  });
  const failed = state.steps.filter((s) => !s.ok).map((s) => stepLabel(s.name));
  deps.print(OUTPUT_PREFIX + t().cli.setupSummary(repo, state.steps.length, failed.length, failed));
}

/**
 * Carries out one item of the setup plan; may throw, the caller reports it and moves on.
 *
 * @param item - Plan item.
 * @param deps - CLI dependencies.
 */
async function runPlanItem(item: SetupPlanItem, deps: CliDeps): Promise<void> {
  if (item.action === "skip") {
    deps.print(OUTPUT_PREFIX + t().cli.skip(item.repo, item.reason ?? ""));
    return;
  }
  if (item.action === "run" || !item.version) {
    await runOne(item.repo, deps);
    return;
  }
  deps.print(OUTPUT_PREFIX + t().cli.relaunching(item.version, item.repo));
  try {
    await relaunch(item.repo, item.version, deps.run, langEnv(deps.env));
  } catch (err) {
    deps.print(OUTPUT_PREFIX + t().cli.relaunchFailed(item.version, item.repo, message(err)));
  }
}

/**
 * Runs `setup`: one repo with `--repo`, otherwise every repo of the home dir in series (apt
 * cannot run twice at once). Always exits 0: a failure is reported, never fatal.
 *
 * @param args - Arguments after `setup`.
 * @param deps - CLI dependencies.
 * @returns Exit code 0.
 */
async function setupCommand(args: string[], deps: CliDeps): Promise<number> {
  try {
    const at = args.indexOf(REPO_OPTION);
    if (at >= 0) {
      const value = args[at + 1];
      if (!value || value.startsWith("-")) deps.print(OUTPUT_PREFIX + t().cli.repoNeedsPath(REPO_OPTION));
      else await runOne(resolve(deps.cwd, value), deps);
      return EXIT_OK;
    }
    const repos = findRepos(homeDir(deps.env));
    if (!repos.length) deps.print(OUTPUT_PREFIX + t().cli.noRepos(homeDir(deps.env)));
    for (const item of planSetup(repos, deps.packageVersion, readConfig)) {
      try {
        await runPlanItem(item, deps);
      } catch (err) {
        deps.print(OUTPUT_PREFIX + t().cli.setupErrorFor(item.repo, message(err)));
      }
    }
  } catch (err) {
    deps.print(OUTPUT_PREFIX + t().cli.setupError(message(err)));
  }
  return EXIT_OK;
}

/**
 * Finds the repo of the session: `CLAUDE_PROJECT_DIR`, else the git toplevel, else the cwd.
 *
 * @param deps - CLI dependencies.
 * @returns The repo root.
 */
function sessionRepo(deps: CliDeps): string {
  const fromEnv = deps.env[PROJECT_DIR_VAR];
  if (fromEnv) return fromEnv;
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: deps.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
    }).trim();
  } catch {
    return deps.cwd;
  }
}

/**
 * Runs `session`, delegating to the installed version the repo pins when it differs from this
 * one. A delegated run carries `DELEGATED_ENV` and never delegates again, so two versions can
 * not bounce between each other. Always exits 0 so the session start is never blocked.
 *
 * @param deps - CLI dependencies.
 * @returns Exit code 0.
 */
async function sessionCommand(deps: CliDeps): Promise<number> {
  const repo = sessionRepo(deps);
  const tools = toolsDir(deps.env);
  const wanted = readConfig(repo).config?.version;
  const delegated = deps.env[DELEGATED_ENV] === DELEGATED_VALUE;
  if (!delegated && wanted && wanted !== deps.packageVersion && existsSync(packageBin(tools, wanted))) {
    try {
      await deps.run(packageBin(tools, wanted), ["session"], { env: { ...langEnv(deps.env), [DELEGATED_ENV]: DELEGATED_VALUE } });
    } catch (err) {
      deps.print(OUTPUT_PREFIX + t().cli.sessionDelegateFailed(wanted, message(err)));
    }
    return EXIT_OK;
  }
  const lines = await session(repo, { env: deps.env, toolsDir: tools, run: deps.run, packageVersion: deps.packageVersion, docker: deps.docker });
  for (const line of lines) deps.print(line);
  return EXIT_OK;
}

/**
 * Runs `docker`: starts the daemon and waits for it.
 *
 * @param deps - CLI dependencies.
 * @returns 0 when Docker answers, 1 otherwise.
 */
async function dockerCommand(deps: CliDeps): Promise<number> {
  if (await deps.docker.ensure().catch(() => false)) return EXIT_OK;
  deps.print(OUTPUT_PREFIX + t().docker.didNotStart(DOCKERD_LOG));
  return EXIT_FAIL;
}

/**
 * Runs `doctor` for the session repo.
 *
 * @param deps - CLI dependencies.
 * @returns 0 when every check passes, 1 otherwise.
 */
async function doctorCommand(deps: CliDeps): Promise<number> {
  const result = await doctor(sessionRepo(deps), {
    capture: deps.capture ?? captureProcess,
    toolsDir: toolsDir(deps.env),
    packageVersion: deps.packageVersion,
    dockerInfo: deps.dockerInfo ?? dockerResponds,
  });
  for (const line of result.lines) deps.print(line);
  const art = deps.stdoutTty ?? process.stdout.isTTY === true;
  if (art) for (const line of renderBlock(doctorBlock(result.counts), { art, color: !deps.env.NO_COLOR })) deps.print(line);
  return result.ok ? EXIT_OK : EXIT_FAIL;
}

/**
 * Runs `init` for the session repo, copying the skill from `deps.packageRoot`.
 *
 * @param deps - CLI dependencies.
 * @returns 0, or 1 when settings.json is not valid JSON or the skill cannot be copied.
 */
function initCommand(deps: CliDeps): number {
  let result: ReturnType<typeof init>;
  try {
    result = init(sessionRepo(deps), deps.packageVersion, deps.packageRoot ?? RUNNING_PACKAGE_ROOT);
  } catch (err) {
    deps.print(`${OUTPUT_PREFIX}${message(err)}`);
    return EXIT_FAIL;
  }
  for (const line of result.lines) deps.print(line);
  return result.ok ? EXIT_OK : EXIT_FAIL;
}

/**
 * Runs `manual`: writes `docs/agent-cloud.md` for the session repo.
 *
 * @param deps - CLI dependencies.
 * @returns 0 on success, 1 when there is no usable config.
 */
function manualCommand(deps: CliDeps): number {
  try {
    writeManual(sessionRepo(deps), deps.packageVersion);
  } catch (err) {
    deps.print(`${OUTPUT_PREFIX}${message(err)}`);
    return EXIT_FAIL;
  }
  deps.print(OUTPUT_PREFIX + t().cli.manualWritten(MANUAL_FILE));
  return EXIT_OK;
}

/**
 * Asks one question on the terminal, showing the suggestion in brackets. The interface is closed
 * after each answer so child processes (claude) get stdin back. Ctrl+C (which readline catches,
 * so no process SIGINT arrives) rejects with `InterruptedError`.
 *
 * @param question - Question text.
 * @param suggestion - Suggested answer, shown when not empty.
 * @returns The raw answer.
 * @throws InterruptedError on Ctrl+C.
 * @example
 * await askTerminal("¿Incluir estos cambios en el commit? [s/N]", ""); // "y"
 */
const askTerminal: Ask = async (question, suggestion) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>((resolveAnswer, reject) => {
      rl.on("SIGINT", () => reject(new InterruptedError()));
      rl.question(`${question}${suggestion ? ` [${suggestion}]` : ""}: `).then(resolveAnswer, reject);
    });
  } finally {
    rl.close();
  }
};

/**
 * Registers a process SIGINT listener (Ctrl+C while a child runs). Being registered, it replaces
 * Node's default exit for every Ctrl+C; it exits 130 only when the handler says so, so a Ctrl+C
 * meant for an interactive `claude` (same process group) does not end `prepare`.
 *
 * @param handler - Prints where the worktree is and says whether to exit.
 * @returns Removes the listener.
 * @example
 * const stop = onProcessInterrupt(() => true); stop();
 */
function onProcessInterrupt(handler: InterruptHandler): () => void {
  const listener = (): void => {
    if (handler()) process.exit(EXIT_INTERRUPTED);
  };
  process.on("SIGINT", listener);
  return () => process.off("SIGINT", listener);
}

/**
 * Shows a text on the terminal and waits for Enter. Ctrl+C rejects with `InterruptedError`.
 *
 * @param text - Text to show, printed as is.
 * @throws InterruptedError on Ctrl+C.
 * @example
 * await waitTerminal("Presiona Enter ");
 */
async function waitTerminal(text: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await new Promise<string>((resolveAnswer, reject) => {
      rl.on("SIGINT", () => reject(new InterruptedError()));
      rl.question(text).then(resolveAnswer, reject);
    });
  } finally {
    rl.close();
  }
}
/**
 * Runs `prepare` in the working directory.
 *
 * @param args - Arguments after `prepare`.
 * @param deps - CLI dependencies.
 * @returns 0 when the cloud session was started, 130 after Ctrl+C, 1 otherwise.
 */
async function prepareCommand(args: string[], deps: CliDeps): Promise<number> {
  const known = [RESUME_OPTION, PR_OPTION, HERE_OPTION];
  const unknown = args.filter((arg) => !known.includes(arg));
  if (unknown.length) {
    deps.print(OUTPUT_PREFIX + t().cli.unknownOption("prepare", unknown.join(" ")));
    return EXIT_FAIL;
  }
  if (args.filter((arg) => known.includes(arg)).length > 1) {
    deps.print(OUTPUT_PREFIX + t().cli.onlyOne(known.join(", ")));
    return EXIT_FAIL;
  }
  const place: Place | undefined = args.includes(PR_OPTION) ? "pr" : args.includes(HERE_OPTION) ? "here" : undefined;
  return prepare(deps.cwd, prepareDeps(deps), { resume: args.includes(RESUME_OPTION), place });
}

/**
 * Runs `verify`: launches the cloud verification of the current branch.
 *
 * @param args - Arguments after `verify` (none allowed).
 * @param deps - CLI dependencies.
 * @returns 0 when the cloud session was started, 1 otherwise.
 */
async function verifyCommand(args: string[], deps: CliDeps): Promise<number> {
  if (args.length) {
    deps.print(OUTPUT_PREFIX + t().cli.unknownOption("verify", args.join(" ")));
    return EXIT_FAIL;
  }
  return verifyBranch(deps.cwd, prepareDeps(deps));
}

/**
 * Builds the dependencies of `prepare` and `verify` from the CLI ones, with terminal defaults.
 *
 * @param deps - CLI dependencies.
 * @returns The dependencies.
 */
function prepareDeps(deps: CliDeps): PrepareDeps {
  return {
    run: deps.run,
    capture: deps.capture ?? captureProcess,
    ask: deps.ask ?? askTerminal,
    choose: deps.choose ?? chooseTerminal,
    waitEnter: deps.waitEnter ?? waitTerminal,
    print: deps.print,
    packageVersion: deps.packageVersion,
    packageRoot: deps.packageRoot ?? RUNNING_PACKAGE_ROOT,
    today: deps.today ?? branchDay(new Date()),
    isTty: deps.isTty ?? (process.stdin.isTTY === true && process.stdout.isTTY === true),
    color: prepareArt(deps) && !deps.env.NO_COLOR,
    art: prepareArt(deps),
    onInterrupt: deps.onInterrupt ?? onProcessInterrupt,
  };
}

/** Language of this run, set by `main`. */
let currentLang: Lang = "es";

/**
 * The environment for another version of this package: the same, with the language of this run,
 * so a `--lang` given here reaches the relaunched setup or the delegated session.
 *
 * @param env - Process environment.
 * @returns A new environment.
 * @example
 * langEnv({}); // { AGENT_CLOUD_KIT_LANG: "es" }
 */
function langEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, [LANG_ENV]: currentLang };
}

/**
 * Whether `prepare` and `verify` draw Kuro: stdout is a terminal (and no test said otherwise).
 *
 * @param deps - CLI dependencies.
 * @returns True in a terminal.
 */
function prepareArt(deps: CliDeps): boolean {
  return deps.stdoutTty ?? (deps.isTty === undefined && process.stdout.isTTY === true);
}

/**
 * Runs the CLI.
 *
 * @param argv - Arguments after the executable name.
 * @param deps - Dependencies; tests inject fakes.
 * @returns The process exit code.
 * @example
 * process.exitCode = await main(["setup"], realDeps());
 */
export async function main(argv: string[], deps: CliDeps): Promise<number> {
  const { args, flag } = splitLang(argv);
  try {
    currentLang = resolveLang(flag, deps.env);
  } catch (err) {
    if (!(err instanceof LangError)) throw err;
    currentLang = "es";
    useLang(currentLang);
    deps.print(OUTPUT_PREFIX + t().lang.invalid(err.source, err.value));
    return EXIT_FAIL;
  }
  useLang(currentLang);
  const [command, ...rest] = args;
  if (command === "setup") return setupCommand(rest, deps);
  if (command === "session") return sessionCommand(deps);
  if (command === "docker") return dockerCommand(deps);
  if (command === "doctor") return doctorCommand(deps);
  if (command === "init") return initCommand(deps);
  if (command === "manual") return manualCommand(deps);
  if (command === "prepare") return prepareCommand(rest, deps);
  if (command === "verify") return verifyCommand(rest, deps);
  if (command === "--version") {
    deps.print(deps.packageVersion);
    return EXIT_OK;
  }
  deps.print(t().help);
  return command === undefined || command === "--help" ? EXIT_OK : EXIT_FAIL;
}

/**
 * Builds the real dependencies of the CLI.
 *
 * @returns Dependencies backed by the process, the real runner and the real Docker.
 */
function realDeps(): CliDeps {
  return {
    env: process.env,
    run: runProcess,
    docker: realDocker,
    packageVersion: readVersion(),
    print: (line) => console.log(line),
    cwd: process.cwd(),
  };
}

/**
 * Tells whether this module is the process entry point (also when started through a symlink).
 *
 * @returns True when run as the CLI rather than imported.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2), realDeps());
}
