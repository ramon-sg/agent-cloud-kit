/**
 * @file The `init` command: scaffolds `.claude/cloud.json`, registers the SessionStart hook in
 * `.claude/settings.json` without touching anything else, and installs the `cloud-ready` skill.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_FILE, OUTPUT_PREFIX, PACKAGE } from "./constants.ts";
import { t } from "./messages/index.ts";
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
  "[ \"$CLAUDE_CODE_REMOTE\" = true ] || exit 0; /opt/agent-cloud-kit/bin/agent-cloud-kit session || echo 'agent-cloud-kit: el setup del entorno no corrió; revisa con npx agent-cloud-kit doctor'";

/** The hook `init` registers. */
const HOOK = { type: "command", command: HOOK_COMMAND, timeout: HOOK_TIMEOUT_SECONDS };

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
function addByHand(reason: string): { entry: InitEntry; ok: boolean } {
  const hook = JSON.stringify({ hooks: [HOOK] });
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
function scaffoldConfig(repo: string, packageVersion: string): InitEntry {
  const file = join(repo, CONFIG_FILE);
  if (existsSync(file)) return { kind: "same", text: t().init.configExists(CONFIG_FILE) };
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
  return { kind: "ok", text: t().init.configCreated(CONFIG_FILE) };
}

/**
 * Adds the SessionStart hook to `.claude/settings.json`, keeping everything else.
 *
 * @param repo - Repo root.
 * @returns The outcome line and whether it succeeded.
 */
function registerHook(repo: string): { entry: InitEntry; ok: boolean } {
  const file = join(repo, SETTINGS_FILE);
  let settings: unknown = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return addByHand(t().init.notJson);
    }
  }
  if (!isRecord(settings)) return addByHand(t().init.notObject);
  const hooks = settings.hooks ?? {};
  if (!isRecord(hooks)) return addByHand(t().init.hooksNotObject);
  const entries = hooks.SessionStart ?? [];
  if (!Array.isArray(entries)) return addByHand(t().init.sessionStartNotArray);
  if (hasHook(entries)) return { entry: { kind: "same", text: t().init.hookExists(SETTINGS_FILE) }, ok: true };
  writeJson(file, { ...settings, hooks: { ...hooks, SessionStart: [...entries, { hooks: [HOOK] }] } });
  return { entry: { kind: "ok", text: t().init.hookAdded(SETTINGS_FILE) }, ok: true };
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
  const entries: InitEntry[] = [config, hook.entry, skill, ...(link ? [{ kind: "ok" as const, text: link }] : [])];
  return { lines: entries.map((e) => OUTPUT_PREFIX + e.text), entries, ok: hook.ok };
}
