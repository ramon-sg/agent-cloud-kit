/**
 * @file Fixed values shared by the agent-cloud-kit modules, each in a documented constant.
 */
import { fileURLToPath } from "node:url";

/** Prefix of every line the CLI prints. */
export const OUTPUT_PREFIX = "agent-cloud-kit: ";

/** Path of the repo config file, relative to the repo root. */
export const CONFIG_FILE = ".claude/cloud.json";

/** Root of the running package: the folder above `dist/` (or `src/` in tests), which holds `skills/`. */
export const RUNNING_PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Name of this package on npm. */
export const PACKAGE = "agent-cloud-kit";

/**
 * The npm spec the setup script installs: the major (`agent-cloud-kit@1`) for a stable version,
 * the exact version for a prerelease, which a major range does not match.
 *
 * @param packageVersion - Version of the running package.
 * @returns The spec.
 * @example
 * packageSpec("1.2.0"); // "agent-cloud-kit@1"
 * packageSpec("1.0.0-rc.1"); // "agent-cloud-kit@1.0.0-rc.1"
 */
export function packageSpec(packageVersion: string): string {
  if (packageVersion.includes("-")) return `${PACKAGE}@${packageVersion}`;
  return `${PACKAGE}@${packageVersion.split(".")[0]}`;
}

/** Default root directory that holds the installed tools and the state files. */
export const TOOLS_DIR = "/opt/agent-cloud-kit";

/** Environment variable that overrides `TOOLS_DIR` (used by tests). */
export const TOOLS_DIR_ENV = "AGENT_CLOUD_KIT_DIR";

/** Default directory whose first-level folders are the cloned repos. */
export const HOME_DIR = "/home/user";

/** Environment variable that overrides `HOME_DIR` (used by tests). */
export const HOME_DIR_ENV = "AGENT_CLOUD_KIT_HOME";

/** Number of Docker images pulled at the same time. */
export const PULL_JOBS = 4;

/** Log file of the detached Docker daemon. */
export const DOCKERD_LOG = "/var/log/agent-cloud-kit-dockerd.log";

/** Seconds to wait for the Docker daemon to answer. */
export const DOCKER_WAIT_SECONDS = 60;

/** Total step time, in milliseconds, above which setup is reported as slow. */
export const SETUP_SLOW_MS = 240_000;

/** Time limit of one tool install step (a download or an install), in milliseconds. */
export const TOOL_INSTALL_TIMEOUT_MS = 120_000;

/** Time limit of one apt step (repo script, update or install), in milliseconds. */
export const APT_STEP_TIMEOUT_MS = 180_000;

/** Time limit of one `docker pull`, in milliseconds. */
export const DOCKER_PULL_TIMEOUT_MS = 180_000;

/** Time limit of one repo setup command, in milliseconds. */
export const SETUP_STEP_TIMEOUT_MS = 180_000;

/** Time limit of one `git fetch` at session start, in milliseconds. */
export const GIT_FETCH_TIMEOUT_MS = 60_000;

/** Default location of the cloud proxy CA bundle. */
export const PROXY_CA_DEFAULT = "/root/.ccr/ca-bundle.crt";

/**
 * Resolves the tools directory, honoring the `AGENT_CLOUD_KIT_DIR` override.
 *
 * @param env - Process environment.
 * @returns The override when set and non-empty, otherwise `TOOLS_DIR`.
 * @example
 * toolsDir({ AGENT_CLOUD_KIT_DIR: "/tmp/x" }); // "/tmp/x"
 */
export function toolsDir(env: NodeJS.ProcessEnv): string {
  return env[TOOLS_DIR_ENV] || TOOLS_DIR;
}

/**
 * Resolves the directory that holds the cloned repos, honoring the `AGENT_CLOUD_KIT_HOME` override.
 *
 * @param env - Process environment.
 * @returns The override when set and non-empty, otherwise `HOME_DIR`.
 * @example
 * homeDir({ AGENT_CLOUD_KIT_HOME: "/tmp/home" }); // "/tmp/home"
 */
export function homeDir(env: NodeJS.ProcessEnv): string {
  return env[HOME_DIR_ENV] || HOME_DIR;
}
