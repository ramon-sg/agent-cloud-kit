/**
 * @file Pure parts of `prepare`: preflight checks.
 */
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
