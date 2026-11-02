/**
 * @file The `test` command: runs the repo's cloud test levels and records the outcome.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findProxyCa } from "./ca.ts";
import { readConfig } from "./config.ts";
import { readToolVersions } from "./detect.ts";
import type { Run } from "./run.ts";
import { pathDirs, toolsEnv } from "./session.ts";
import { readState } from "./state.ts";

/** Path of the test record, relative to the repo. */
export const TEST_RECORD_FILE = ".claude/cloud-tests.json";

/** Indentation of the test record. */
const JSON_INDENT = 2;

/** Test levels, from the quickest to the most complete. */
export type TestLevel = "minimum" | "full";

/** Outcome of one test command. */
export interface TestResult {
  /** Level the command belongs to. */
  level: TestLevel;
  /** Shell command that ran. */
  command: string;
  /** True when it exited with code 0. */
  ok: boolean;
  /** Duration in milliseconds. */
  ms: number;
}

/** What `test --record` stores. */
export interface TestRecord {
  /** Level that was requested. */
  level: TestLevel;
  /** Outcome of each command. */
  results: TestResult[];
  /** ISO timestamp of when the run finished. */
  finishedAt: string;
  /** Commit that was tested. */
  commit: string;
  /** True when it ran in a Claude Code cloud session. */
  remote: boolean;
}

/** Everything `runTests` needs from the outside, so tests can inject fakes. */
export interface TestContext {
  /** Process runner. */
  run: Run;
  /** Process environment. */
  env: NodeJS.ProcessEnv;
  /** Tools directory. */
  toolsDir: string;
}

/**
 * Runs the test commands of a level, with the same PATH and CA as the session steps. `full` runs
 * `tests.minimum` and then `tests.full`, and keeps going after a failure. Output is inherited and
 * there is no time limit.
 *
 * @param repo - Repo root.
 * @param level - Level to run.
 * @param ctx - Dependencies.
 * @returns One result per command that exists in the config.
 * @example
 * await runTests("/home/user/app", "full", { run: runProcess, env: process.env, toolsDir: "/opt/agent-cloud-kit" });
 */
export async function runTests(repo: string, level: TestLevel, ctx: TestContext): Promise<TestResult[]> {
  const tests = readConfig(repo).config?.tests ?? {};
  const state = readState(ctx.toolsDir, repo);
  const dirs = pathDirs(readToolVersions(repo), ctx.toolsDir, state?.resolved ?? {});
  const env = toolsEnv(dirs, ctx.env, findProxyCa(ctx.env, existsSync));
  const levels: TestLevel[] = level === "full" ? ["minimum", "full"] : ["minimum"];
  const results: TestResult[] = [];
  for (const name of levels) {
    const command = tests[name];
    if (command === undefined) continue;
    const start = Date.now();
    const ok = await ctx.run("bash", ["-c", command], { cwd: repo, env }).then(
      () => true,
      () => false,
    );
    results.push({ level: name, command, ok, ms: Date.now() - start });
  }
  return results;
}

/**
 * Writes the test record atomically (temp file, then rename).
 *
 * @param repo - Repo root.
 * @param record - Record to store.
 * @example
 * writeTestRecord("/home/user/app", record);
 */
export function writeTestRecord(repo: string, record: TestRecord): void {
  const file = join(repo, TEST_RECORD_FILE);
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record, null, JSON_INDENT)}\n`);
  renameSync(temp, file);
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
 * Tells whether a value is a test level.
 *
 * @param value - Any value.
 * @returns True for `"minimum"` and `"full"`.
 */
function isLevel(value: unknown): value is TestLevel {
  return value === "minimum" || value === "full";
}

/**
 * Tells whether a parsed value has the shape of a `TestResult`.
 *
 * @param value - Any parsed JSON value.
 * @returns True when all fields are present with the right types.
 */
function isResult(value: unknown): value is TestResult {
  return (
    isRecord(value) &&
    isLevel(value.level) &&
    typeof value.command === "string" &&
    typeof value.ok === "boolean" &&
    typeof value.ms === "number"
  );
}

/**
 * Reads the test record; never throws.
 *
 * @param repo - Repo root.
 * @returns The record, or undefined when missing, unreadable or malformed.
 * @example
 * readTestRecord("/home/user/app")?.commit;
 */
export function readTestRecord(repo: string): TestRecord | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(join(repo, TEST_RECORD_FILE), "utf8"));
    if (
      isRecord(value) &&
      isLevel(value.level) &&
      Array.isArray(value.results) &&
      value.results.every(isResult) &&
      typeof value.finishedAt === "string" &&
      typeof value.commit === "string" &&
      typeof value.remote === "boolean"
    ) {
      return value as unknown as TestRecord;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
