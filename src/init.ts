/**
 * @file The `init` command: scaffolds `.claude/cloud.json`, registers the SessionStart hook in
 * `.claude/settings.json` without touching anything else, and installs the `cloud-ready` skill.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_FILE, OUTPUT_PREFIX, PACKAGE } from "./constants.ts";
import { installSkill, linkSkill } from "./skill.ts";

/** Path of the Claude Code settings file, relative to the repo root. */
const SETTINGS_FILE = ".claude/settings.json";

/** Text that marks a SessionStart hook as ours. */
const HOOK_MARKER = "agent-cloud-kit session";

/** Timeout of the hook, in seconds. */
const HOOK_TIMEOUT_SECONDS = 600;

/** Indentation of the files written. */
const JSON_INDENT = 2;

/** Command of the SessionStart hook: does nothing outside cloud sessions. */
const HOOK_COMMAND =
  "[ \"$CLAUDE_CODE_REMOTE\" = true ] || exit 0; /opt/agent-cloud-kit/bin/agent-cloud-kit session || echo 'agent-cloud-kit: the environment setup did not run; see npx agent-cloud-kit doctor'";

/** The hook `init` registers. */
const HOOK = { type: "command", command: HOOK_COMMAND, timeout: HOOK_TIMEOUT_SECONDS };

/** Result of `init`. */
export interface InitResult {
  /** Prefixed lines describing what was done. */
  lines: string[];
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
function addByHand(reason: string): { line: string; ok: boolean } {
  const entry = JSON.stringify({ hooks: [HOOK] });
  return { line: `${SETTINGS_FILE} ${reason}, left untouched; add this entry to hooks.SessionStart by hand: ${entry}`, ok: false };
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
 * Tells whether some SessionStart entry already runs `agent-cloud-kit session`.
 *
 * @param entries - The `hooks.SessionStart` array.
 * @returns True when any hook command contains the marker.
 */
function hasHook(entries: unknown[]): boolean {
  return entries.some((entry) => {
    const hooks = (entry as { hooks?: unknown } | null)?.hooks;
    return Array.isArray(hooks) && hooks.some((h) => String((h as { command?: unknown } | null)?.command ?? "").includes(HOOK_MARKER));
  });
}

/**
 * Creates `.claude/cloud.json` unless it exists.
 *
 * @param repo - Repo root.
 * @param packageVersion - Version of this package.
 * @returns A line describing the outcome.
 */
function scaffoldConfig(repo: string, packageVersion: string): string {
  const file = join(repo, CONFIG_FILE);
  if (existsSync(file)) return `${CONFIG_FILE} already exists, left as is`;
  writeJson(file, {
    $schema: `https://unpkg.com/${PACKAGE}@${packageVersion}/schema.json`,
    version: packageVersion,
    aptRepos: [],
    apt: [],
    docker: { pull: "auto" },
    setup: [],
    session: [],
    requiredEnv: [],
    domains: [],
  });
  return `created ${CONFIG_FILE}`;
}

/**
 * Adds the SessionStart hook to `.claude/settings.json`, keeping everything else.
 *
 * @param repo - Repo root.
 * @returns The outcome line and whether it succeeded.
 */
function registerHook(repo: string): { line: string; ok: boolean } {
  const file = join(repo, SETTINGS_FILE);
  let settings: unknown = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return addByHand("is not valid JSON");
    }
  }
  if (!isRecord(settings)) return addByHand("is not a JSON object");
  const hooks = settings.hooks ?? {};
  if (!isRecord(hooks)) return addByHand('has a "hooks" that is not an object');
  const entries = hooks.SessionStart ?? [];
  if (!Array.isArray(entries)) return addByHand('has a "hooks.SessionStart" that is not an array');
  if (hasHook(entries)) return { line: `${SETTINGS_FILE} already has the SessionStart hook`, ok: true };
  writeJson(file, { ...settings, hooks: { ...hooks, SessionStart: [...entries, { hooks: [HOOK] }] } });
  return { line: `added the SessionStart hook to ${SETTINGS_FILE}`, ok: true };
}

/**
 * Sets a repo up for agent-cloud-kit; safe to run again. It is the only place that copies the
 * `cloud-ready` skill into the repo (and links it for Claude Code).
 *
 * @param repo - Repo root.
 * @param packageVersion - Version of this package, written into the config and the skill.
 * @param packageRoot - Root of this package, which holds `skills/cloud-ready`.
 * @returns What it did, and whether settings.json could be updated.
 * @throws When the skill cannot be copied.
 * @example
 * init("/home/user/app", "1.0.0", "/usr/lib/node_modules/agent-cloud-kit").lines.forEach((l) => console.log(l));
 */
export function init(repo: string, packageVersion: string, packageRoot: string): InitResult {
  const config = scaffoldConfig(repo, packageVersion);
  const hook = registerHook(repo);
  const skill = installSkill(repo, packageRoot, packageVersion);
  const link = linkSkill(repo);
  const lines = [config, hook.line, skill, ...(link ? [link] : [])];
  return { lines: lines.map((l) => OUTPUT_PREFIX + l), ok: hook.ok };
}
