/**
 * @file Finds the cloned repos, decides per repo whether this version runs setup or relaunches the
 * version the repo pins, and builds the paths and commands for that relaunch and for delegation.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RUNNER_FILE, toolCommand } from "@ramon-sg/runner";
import type { Runner } from "@ramon-sg/runner";
import { readConfig } from "./config.ts";
import { PACKAGE } from "./constants.ts";
import { t } from "./messages/index.ts";
import { TOOL_NAME, readPin } from "./pin.ts";
import type { Run } from "./run.ts";

/** Directory, inside the tools dir, that holds one installed copy of this package per version. */
const PKG_DIR = "pkg";

/** Name of the CLI executable. */
const BIN_NAME = "agent-cloud-kit";

/** Exact semver without build metadata; groups: major, minor, patch, prerelease. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** A numeric prerelease identifier. */
const NUMERIC = /^\d+$/;

/** What setup does with one repo. */
export interface SetupPlanItem {
  /** Repo root. */
  repo: string;
  /** Run here, relaunch with another version, or skip. */
  action: "run" | "relaunch" | "skip";
  /** Version the repo asks for, when known. */
  version?: string;
  /** Runner the repo asks for (`"bun"` unless its runner.json says otherwise). */
  runner: Runner;
  /** Why the repo is skipped. */
  reason?: string;
}

/**
 * Tells whether a path is a directory, following symlinks; never throws.
 *
 * @param path - Path to check.
 * @returns True for a directory.
 */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Lists the first-level folders of a home directory that are git repos.
 *
 * @param home - Directory holding the clones.
 * @returns Sorted absolute paths; empty when the directory cannot be read.
 * @example
 * findRepos("/home/user"); // ["/home/user/app"]
 */
export function findRepos(home: string): string[] {
  let names: string[];
  try {
    names = readdirSync(home);
  } catch {
    return [];
  }
  return names
    .map((name) => join(home, name))
    .filter((path) => isDirectory(path) && existsSync(join(path, ".git")))
    .sort();
}

/**
 * Decides, for each repo, whether to run setup here, relaunch another version or skip it.
 *
 * @param repos - Repo roots.
 * @param current - Version of this package.
 * @param pin - Pin reader (`readPin`).
 * @returns One item per repo, in the same order.
 * @example
 * planSetup(["/home/user/app"], "1.0.0"); // [{ repo: "/home/user/app", action: "run", version: "1.0.0", runner: "bun" }]
 */
export function planSetup(repos: string[], current: string, pin: typeof readPin = readPin): SetupPlanItem[] {
  return repos.map((repo): SetupPlanItem => {
    const { version, runner, errors } = pin(repo);
    if (!version) {
      const reasons = errors.length ? errors : readConfig(repo).errors;
      const missing = existsSync(join(repo, RUNNER_FILE)) ? t().pin.noEntry(RUNNER_FILE, TOOL_NAME) : t().config.missing(RUNNER_FILE);
      return { repo, action: "skip", runner, reason: reasons.length ? reasons.join("; ") : missing };
    }
    if (version === current) return { repo, action: "run", version: current, runner };
    return { repo, action: "relaunch", version, runner };
  });
}

/**
 * Runs setup for one repo with the exact version it pins, through the repo runner (bunx or npx).
 * The version is already validated as exact semver and travels as one argv element.
 *
 * @param repo - Repo root.
 * @param version - Exact version from the repo pin.
 * @param runner - Runner the repo asks for.
 * @param run - Process runner.
 * @param env - Environment for the runner.
 * @returns Resolves when the relaunched setup exits with 0.
 * @throws When the runner cannot run or exits with a non-zero code.
 * @example
 * await relaunch("/home/user/app", "1.2.0", "bun", runProcess, process.env);
 */
export function relaunch(repo: string, version: string, runner: Runner, run: Run, env: NodeJS.ProcessEnv): Promise<void> {
  const { file, args } = toolCommand(runner, PACKAGE, version, ["setup", "--repo", repo]);
  return run(file, args, { env });
}

/**
 * Locates the directory where setup installs a given version of this package.
 *
 * @param toolsDir - Tools directory.
 * @param version - Package version.
 * @returns `<toolsDir>/pkg/<version>`.
 * @example
 * packageDir("/opt/agent-cloud-kit", "1.0.0"); // "/opt/agent-cloud-kit/pkg/1.0.0"
 */
export function packageDir(toolsDir: string, version: string): string {
  return join(toolsDir, PKG_DIR, version);
}

/**
 * Locates the CLI executable of an installed version of this package.
 *
 * @param toolsDir - Tools directory.
 * @param version - Package version.
 * @returns `<toolsDir>/pkg/<version>/node_modules/.bin/agent-cloud-kit`.
 * @example
 * packageBin("/opt/agent-cloud-kit", "1.0.0"); // "/opt/agent-cloud-kit/pkg/1.0.0/node_modules/.bin/agent-cloud-kit"
 */
export function packageBin(toolsDir: string, version: string): string {
  return join(packageDir(toolsDir, version), "node_modules", ".bin", BIN_NAME);
}

/**
 * Locates the copy of this package installed for a version.
 *
 * @param toolsDir - Tools directory.
 * @param version - Package version.
 * @returns `<toolsDir>/pkg/<version>/node_modules/agent-cloud-kit`.
 * @example
 * packageInstallDir("/opt/agent-cloud-kit", "1.0.0"); // "/opt/agent-cloud-kit/pkg/1.0.0/node_modules/agent-cloud-kit"
 */
export function packageInstallDir(toolsDir: string, version: string): string {
  return join(packageDir(toolsDir, version), "node_modules", ...PACKAGE.split("/"));
}

/**
 * Locates the directory of the stable link, which `session` puts on PATH.
 *
 * @param toolsDir - Tools directory.
 * @returns `<toolsDir>/bin`.
 * @example
 * linkDir("/opt/agent-cloud-kit"); // "/opt/agent-cloud-kit/bin"
 */
export function linkDir(toolsDir: string): string {
  return join(toolsDir, "bin");
}

/**
 * Locates the stable link that the repo hook calls.
 *
 * @param toolsDir - Tools directory.
 * @returns `<toolsDir>/bin/agent-cloud-kit`.
 * @example
 * linkPath("/opt/agent-cloud-kit"); // "/opt/agent-cloud-kit/bin/agent-cloud-kit"
 */
export function linkPath(toolsDir: string): string {
  return join(linkDir(toolsDir), BIN_NAME);
}

/**
 * Compares two exact versions by semver precedence, prereleases included (a release is newer
 * than its prereleases; numeric identifiers compare as numbers and are older than text ones).
 *
 * @param a - First version.
 * @param b - Second version.
 * @returns A positive number when `a` is newer, negative when older, 0 when equal.
 * @example
 * compareVersions("1.0.0", "1.0.0-rc.9") > 0; // true
 */
export function compareVersions(a: string, b: string): number {
  const [left, right] = [SEMVER.exec(a), SEMVER.exec(b)];
  for (let i = 1; i <= 3; i++) {
    const diff = Number(left?.[i] ?? 0) - Number(right?.[i] ?? 0);
    if (diff) return diff;
  }
  const [preA, preB] = [left?.[4], right?.[4]];
  if (preA === preB) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  const [x, y] = [preA.split("."), preB.split(".")];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const [p, q] = [x[i] as string, y[i] as string];
    if (p === q) continue;
    const [pNum, qNum] = [NUMERIC.test(p), NUMERIC.test(q)];
    if (pNum && qNum) return Number(p) - Number(q);
    if (pNum !== qNum) return pNum ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return x.length - y.length;
}

/**
 * Finds the newest version of this package installed under the tools dir, counting only
 * versions whose binary exists; never throws.
 *
 * @param toolsDir - Tools directory.
 * @returns The newest installed version, or undefined when there is none.
 * @example
 * newestInstalled("/opt/agent-cloud-kit"); // "1.0.0"
 */
export function newestInstalled(toolsDir: string): string | undefined {
  let names: string[];
  try {
    names = readdirSync(join(toolsDir, PKG_DIR));
  } catch {
    return undefined;
  }
  return names
    .filter((name) => SEMVER.test(name) && existsSync(packageBin(toolsDir, name)))
    .reduce<string | undefined>((best, name) => (!best || compareVersions(name, best) > 0 ? name : best), undefined);
}
