/**
 * @file Pure parts of `prepare`: secret-name suggestions and preflight checks.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** File, in the repo root, whose keys are suggested as secret names. */
const ENV_EXAMPLE_FILE = ".env.example";

/** Matches a `KEY=value` line (optionally prefixed by `export`) and captures the key. */
const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** Flag `claude` must advertise in its help to launch cloud sessions. */
const CLOUD_FLAG = "--cloud";

/** What `prepare` knows about the environment before starting. */
export interface Probe {
  /** Whether stdin and stdout are interactive terminals. */
  isTty: boolean;
  /** Root of the git repo, if the current directory is inside one. */
  gitRoot?: string;
  /** Whether the repo has an `origin` remote. */
  hasOrigin: boolean;
  /** Whether the working tree has no uncommitted changes. */
  clean: boolean;
  /** Output of `claude --help`; undefined when `claude` could not be run. */
  claudeHelp?: string;
}

/**
 * Suggests secret names from the keys of `.env.example` in the repo root.
 *
 * @param repo Repo root.
 * @returns Keys in file order, without duplicates; empty when the file does not exist.
 * @example
 * suggestSecrets("/repo"); // ["API_TOKEN", "DB_URL"]
 */
export function suggestSecrets(repo: string): string[] {
  const file = join(repo, ENV_EXAMPLE_FILE);
  if (!existsSync(file)) return [];
  const keys: string[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const key = ENV_LINE.exec(line)?.[1];
    if (key !== undefined && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * Checks that `prepare` can run.
 *
 * @param probe What was observed about the environment.
 * @returns Problems in English, in a fixed order; empty when everything is fine.
 * @example
 * preflight({ isTty: false, hasOrigin: true, clean: true }); // ["prepare needs an interactive terminal", ...]
 */
export function preflight(probe: Probe): string[] {
  const problems: string[] = [];
  if (!probe.isTty) problems.push("prepare needs an interactive terminal");
  if (probe.gitRoot === undefined) problems.push("not inside a git repository");
  if (!probe.hasOrigin) problems.push("the repository has no 'origin' remote");
  if (!probe.clean) problems.push("the working tree has uncommitted changes; commit or stash them first");
  if (probe.claudeHelp === undefined) problems.push("claude is not installed or not on the PATH");
  else if (!probe.claudeHelp.includes(CLOUD_FLAG)) problems.push("claude does not support --cloud; update Claude Code");
  return problems;
}
