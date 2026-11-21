/**
 * @file Leaves the repo runner ready in the cloud: Bun is installed with npm when the repo asks for it and it is missing.
 */
import { RUNNER_FILE, runnerAvailable } from "@ramon-sg/runner";
import type { Runner } from "@ramon-sg/runner";
import { TOOL_INSTALL_TIMEOUT_MS } from "./constants.ts";
import { t } from "./messages/index.ts";
import type { Run } from "./run.ts";

/** Arguments of npm that install Bun globally; its version is not pinned. */
const BUN_INSTALL_ARGS = ["install", "-g", "bun"];

/**
 * Leaves the runner ready: `node` needs nothing; `bun` is installed with `npm install -g bun` when missing.
 *
 * @param runner - Runner the repo asks for.
 * @param run - Process runner.
 * @param env - Environment for npm.
 * @param available - Tells whether a runner is installed (`runnerAvailable`).
 * @returns Resolves when the runner is ready.
 * @throws With a message that asks for `"runner": "node"` when npm fails or Bun is still missing.
 * @example
 * await ensureRunner("bun", runProcess, process.env);
 */
export async function ensureRunner(
  runner: Runner,
  run: Run,
  env: NodeJS.ProcessEnv,
  available: (r: Runner) => boolean = runnerAvailable,
): Promise<void> {
  if (runner !== "bun" || available("bun")) return;
  try {
    await run("npm", BUN_INSTALL_ARGS, { env, timeoutMs: TOOL_INSTALL_TIMEOUT_MS });
  } catch (err) {
    throw new Error(t().runner.bunFailed(RUNNER_FILE, err instanceof Error ? err.message : String(err)));
  }
  if (!available("bun")) throw new Error(t().runner.bunFailed(RUNNER_FILE, "bunx"));
}
