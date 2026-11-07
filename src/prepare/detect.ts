/**
 * @file Pure parts of `prepare`: preflight checks.
 */
import { t } from "../messages/index.ts";

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
  /** Output of `claude --help`; undefined when `claude` could not be run. */
  claudeHelp?: string;
}

/**
 * Checks that `prepare` (or `verify`) can run.
 *
 * @param probe What was observed about the environment.
 * @param command Command named in the messages.
 * @returns Problems in the language of the terminal, in a fixed order; empty when everything is fine.
 * @example
 * preflight({ isTty: false, hasOrigin: true }); // ["prepare necesita una terminal interactiva", ...]
 */
export function preflight(probe: Probe, command = "prepare"): string[] {
  const m = t().preflight;
  const problems: string[] = [];
  if (!probe.isTty) problems.push(m.noTty(command));
  if (probe.gitRoot === undefined) problems.push(m.noGit(command));
  if (!probe.hasOrigin) problems.push(m.noOrigin(command));
  if (probe.claudeHelp === undefined) problems.push(m.noClaude(command));
  else if (!probe.claudeHelp.includes(CLOUD_FLAG)) problems.push(m.noCloud(command));
  return problems;
}
