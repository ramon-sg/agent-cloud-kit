/**
 * @file The `init` command: scaffolds `.claude/cloud.json`, registers the SessionStart hook in
 * `.claude/settings.json` without touching anything else, and installs the `cloud-ready` skill.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RUNNER_FILE, RunnerFileError, chooseRunner, effectiveRunner, readRunnerConfig, setTool, toolCommandText, writeRunnerConfig } from "@ramon-sg/runner";
import type { Runner, RunnerConfig } from "@ramon-sg/runner";
import { CONFIG_FILE, OUTPUT_PREFIX, PACKAGE } from "./constants.ts";
import { t } from "./messages/index.ts";
import { installSkill, linkSkill } from "./skill.ts";

/** Path of the Claude Code settings file, relative to the repo root. */
const SETTINGS_FILE = ".claude/settings.json";

/** Text that marks a SessionStart hook as ours. */
export const HOOK_MARKER = "agent-cloud-kit session";

/** Timeout of the hook, in seconds. */
const HOOK_TIMEOUT_SECONDS = 600;

/** Indentation of the files written. */
const JSON_INDENT = 2;

/** Script of the hook (the installed link, fast and offline); the help text after it carries the pinned version. */
const HOOK_SCRIPT = "[ \"$CLAUDE_CODE_REMOTE\" = true ] || exit 0; /opt/agent-cloud-kit/bin/agent-cloud-kit session";

/**
 * Command of the SessionStart hook: does nothing outside cloud sessions. It runs the installed
 * link; the pinned version only appears in the help text, which `checkToolPins` verifies.
 *
 * @param runner - Runner of the repo.
 * @param version - Version of agent-cloud-kit pinned in `.agents/runner.json`.
 * @returns The command line.
 * @example
 * hookCommand("bun", "1.0.0"); // "... || echo '... bunx --bun agent-cloud-kit@1.0.0 doctor'"
 */
export function hookCommand(runner: Runner, version: string): string {
  return `${HOOK_SCRIPT} || echo 'el setup del entorno no corrió; revisa con ${toolCommandText(runner, PACKAGE, version, ["doctor"])}'`;
}

/**
 * The hook `init` registers.
 *
 * @param command - Command of the hook.
 * @returns The hook entry.
 */
function hookEntry(command: string): { type: string; command: string; timeout: number } {
  return { type: "command", command, timeout: HOOK_TIMEOUT_SECONDS };
}

/** What one line of `init` says: something done, something already there, or a problem. */
export type InitKind = "ok" | "same" | "warn";

/** One line of `init`, without prefix. */
export interface InitEntry {
  kind: InitKind;
  text: string;
}

/** Result of `init`. */
export interface InitResult {
  /** Prefixed lines describing what was done. */
  lines: string[];
  /** The same lines without prefix, each with its kind. */
  entries: InitEntry[];
  /** False when settings.json could not be updated because of its contents. */
  ok: boolean;
}

/**
 * Tells whether a value is a plain JSON object.
 *
 * @param value - Any parsed JSON value.
 * @returns True for non-null, non-array objects.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Builds the outcome for a settings file that cannot be updated safely: it is left untouched and
 * the user gets the hook to add by hand.
 *
 * @param reason - What is wrong with the file.
 * @returns The failed outcome.
 */
function addByHand(reason: string, command: string): { entry: InitEntry; ok: boolean } {
  const hook = JSON.stringify({ hooks: [hookEntry(command)] });
  return { entry: { kind: "warn", text: t().init.byHand(SETTINGS_FILE, reason, hook) }, ok: false };
}

/**
 * Writes a JSON file with a trailing newline, creating its folder.
 *
 * @param file - Absolute path.
 * @param value - Value to serialize.
 */
function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, JSON_INDENT)}\n`);
}

/**
 * Finds the hook of ours inside the SessionStart entries.
 *
 * @param entries - The `hooks.SessionStart` array.
 * @returns The hook object whose command contains the marker, or undefined.
 */
function findHook(entries: unknown[]): Record<string, unknown> | undefined {
  for (const entry of entries) {
    const hooks = (entry as { hooks?: unknown } | null)?.hooks;
    if (!Array.isArray(hooks)) continue;
    const found = hooks.find((h) => isRecord(h) && String(h.command ?? "").includes(HOOK_MARKER));
    if (found) return found as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Creates `.claude/cloud.json` unless it exists.
 *
 * @param repo - Repo root.
 * @param packageVersion - Version of this package.
 * @returns A line describing the outcome.
 */
function scaffoldConfig(repo: string, packageVersion: string): InitEntry {
  const file = join(repo, CONFIG_FILE);
  if (existsSync(file)) return { kind: "same", text: t().init.configExists(CONFIG_FILE) };
  writeJson(file, {
    $schema: `https://unpkg.com/${PACKAGE}@${packageVersion}/schema.json`,
    aptRepos: [],
    apt: [],
    docker: { pull: "auto" },
    setup: [],
    session: [],
    requiredEnv: [],
    domains: [],
  });
  return { kind: "ok", text: t().init.configCreated(CONFIG_FILE) };
}

/**
 * Adds the SessionStart hook to `.claude/settings.json`, or rewrites its command when it differs;
 * everything else is kept.
 *
 * @param repo - Repo root.
 * @param command - Command the hook must have.
 * @returns The outcome line and whether it succeeded.
 */
function registerHook(repo: string, command: string): { entry: InitEntry; ok: boolean } {
  const file = join(repo, SETTINGS_FILE);
  let settings: unknown = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return addByHand(t().init.notJson, command);
    }
  }
  if (!isRecord(settings)) return addByHand(t().init.notObject, command);
  const hooks = settings.hooks ?? {};
  if (!isRecord(hooks)) return addByHand(t().init.hooksNotObject, command);
  const entries = hooks.SessionStart ?? [];
  if (!Array.isArray(entries)) return addByHand(t().init.sessionStartNotArray, command);
  const current = findHook(entries);
  if (current?.command === command) return { entry: { kind: "same", text: t().init.hookExists(SETTINGS_FILE) }, ok: true };
  if (current) {
    current.command = command;
    writeJson(file, settings);
    return { entry: { kind: "ok", text: t().init.hookUpdated(SETTINGS_FILE) }, ok: true };
  }
  writeJson(file, { ...settings, hooks: { ...hooks, SessionStart: [...entries, { hooks: [hookEntry(command)] }] } });
  return { entry: { kind: "ok", text: t().init.hookAdded(SETTINGS_FILE) }, ok: true };
}

/** Outcome of `ensureRunnerFile`: the line, and the runner and version the hook must use (absent when the file is invalid). */
interface RunnerOutcome {
  entries: InitEntry[];
  pin?: { runner: Runner; version: string };
}

/**
 * Makes sure `.agents/runner.json` pins this package, creating the file when missing. Never lowers
 * a version and keeps what other tools wrote; an invalid file is left untouched.
 *
 * @param repo - Repo root.
 * @param packageVersion - Version of this package.
 * @param choose - Picks the runner for a new file; `chooseRunner` of `@ramon-sg/runner` by default.
 * @returns The lines, and the pin the hook must use.
 * @example
 * await ensureRunnerFile("/home/u/app", "1.0.0", chooseRunner); // { entries: [...], pin: { runner: "bun", version: "1.0.0" } }
 */
async function ensureRunnerFile(repo: string, packageVersion: string, choose: typeof chooseRunner): Promise<RunnerOutcome> {
  let config: RunnerConfig | null;
  try {
    config = readRunnerConfig(repo);
  } catch (err) {
    if (!(err instanceof RunnerFileError)) throw err;
    return { entries: [{ kind: "warn", text: t().init.runnerInvalid(err.message) }] };
  }
  const entries: InitEntry[] = [];
  let base: RunnerConfig;
  if (config) base = config;
  else {
    const picked = await choose({});
    if (picked?.warning) entries.push({ kind: "warn", text: t().init.noBun(RUNNER_FILE) });
    base = { runner: picked?.runner ?? "node", tools: {}, extra: {} };
  }
  const { config: next, changed } = setTool(base, PACKAGE, packageVersion);
  const version = next.tools[PACKAGE];
  if (config && !changed) entries.push({ kind: "same", text: t().init.runnerExists(RUNNER_FILE, version) });
  else {
    writeRunnerConfig(repo, next);
    entries.push({ kind: "ok", text: config ? t().init.runnerUpdated(RUNNER_FILE, version) : t().init.runnerCreated(RUNNER_FILE, next.runner ?? "bun") });
  }
  return { entries, pin: { runner: effectiveRunner(next), version } };
}

/**
 * Sets a repo up for agent-cloud-kit; safe to run again. It is the only place that copies the
 * `cloud-ready` skill into the repo (and links it for Claude Code).
 *
 * @param repo - Repo root.
 * @param packageVersion - Version of this package, pinned in `.agents/runner.json` and written into the skill.
 * @param packageRoot - Root of this package, which holds `skills/cloud-ready`.
 * @param choose - Picks the runner when `.agents/runner.json` does not exist; `chooseRunner` by default.
 * @returns What it did, and whether `.agents/runner.json` and settings.json could be updated.
 * @throws When the skill cannot be copied.
 * @example
 * (await init("/home/user/app", "1.0.0", "/usr/lib/node_modules/agent-cloud-kit")).lines.forEach((l) => console.log(l));
 */
export async function init(repo: string, packageVersion: string, packageRoot: string, choose: typeof chooseRunner = chooseRunner): Promise<InitResult> {
  const runnerFile = await ensureRunnerFile(repo, packageVersion, choose);
  const config = scaffoldConfig(repo, packageVersion);
  const hook = runnerFile.pin ? registerHook(repo, hookCommand(runnerFile.pin.runner, runnerFile.pin.version)) : undefined;
  const skill = installSkill(repo, packageRoot, packageVersion);
  const link = linkSkill(repo);
  const entries: InitEntry[] = [
    ...runnerFile.entries,
    config,
    ...(hook ? [hook.entry] : []),
    skill,
    ...(link ? [{ kind: "ok" as const, text: link }] : []),
  ];
  return { lines: entries.map((e) => OUTPUT_PREFIX + e.text), entries, ok: Boolean(hook?.ok) };
}
