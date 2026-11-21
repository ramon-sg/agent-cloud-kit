/**
 * @file Version of agent-cloud-kit and runner that a repo asks for, from `.agents/runner.json` or the legacy `.claude/cloud.json`.
 */
import { RUNNER_FILE, RunnerFileError, effectiveRunner, readRunnerConfig } from "@ramon-sg/runner";
import type { Runner, RunnerConfig } from "@ramon-sg/runner";
import { readConfig } from "./config.ts";
import { CONFIG_FILE } from "./constants.ts";
import { t } from "./messages/index.ts";

/** Key of this tool inside `tools` in `.agents/runner.json`. */
export const TOOL_NAME = "agent-cloud-kit";

/** What a repo asks for: the version, the runner and the problems found reading it. */
export interface RepoPin {
  /** Versión de agent-cloud-kit que pide el repo; undefined si ningún archivo la dice o runner.json es inválido. */
  version?: string;
  /** Ejecutor efectivo (el de runner.json, o "bun"). */
  runner: Runner;
  /** De dónde salió `version`. */
  source?: "runner" | "cloud";
  /** Problemas que impiden usar el repo (runner.json inválido), ya traducidos. */
  errors: string[];
  /** Avisos (version vieja en cloud.json), ya traducidos. */
  warnings: string[];
}

/**
 * Reads the version and runner a repo asks for, without ever throwing.
 *
 * `.agents/runner.json` wins; `.claude/cloud.json` is a deprecated fallback that adds a warning.
 *
 * Problems in `.claude/cloud.json` itself (including an invalid `version`) are not repeated here: callers
 * already call `readConfig` and print its errors, so an invalid cloud.json `version` just yields no pin.
 * The detail of an invalid `runner.json` is the runner library's text with its file prefix removed.
 *
 * @param repo - Path of the repo root.
 * @param read - Cloud config reader (`readConfig`).
 * @returns The pin, with translated errors and warnings.
 * @example
 * readPin("/home/user/app"); // { version: "1.2.0", runner: "bun", source: "runner", errors: [], warnings: [] }
 */
export function readPin(repo: string, read: typeof readConfig = readConfig): RepoPin {
  let runnerConfig: RunnerConfig | null;
  try {
    runnerConfig = readRunnerConfig(repo);
  } catch (error) {
    if (!(error instanceof RunnerFileError)) throw error;
    return { runner: "bun", errors: [t().pin.invalid(RUNNER_FILE, error.message.slice(`${error.file}: `.length))], warnings: [] };
  }
  const runner = effectiveRunner(runnerConfig);
  const fromRunner = runnerConfig?.tools[TOOL_NAME];
  const legacy = read(repo).config?.version;
  if (fromRunner !== undefined) {
    const warnings = legacy !== undefined ? [t().pin.legacyBoth(CONFIG_FILE)] : [];
    return { version: fromRunner, runner, source: "runner", errors: [], warnings };
  }
  if (legacy !== undefined) {
    return { version: legacy, runner, source: "cloud", errors: [], warnings: [t().pin.legacyOnly(CONFIG_FILE, RUNNER_FILE)] };
  }
  return { runner, errors: [], warnings: [] };
}
