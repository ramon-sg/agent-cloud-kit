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
import { readPin } from "./pin.ts";
import type { Run } from "./run.ts";

/** Directory, inside the tools dir, that holds one installed copy of this package per version. */
const PKG_DIR = "pkg";

/** Name of the CLI executable. */
const BIN_NAME = "agent-cloud-kit";

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
      return { repo, action: "skip", runner, reason: reasons.length ? reasons.join("; ") : t().config.missing(RUNNER_FILE) };
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
