/**
 * @file Tests for leaving the repo runner ready in the cloud.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureRunner } from "../src/bun.ts";
import type { Run } from "../src/run.ts";

type Call = { cmd: string; args: string[]; opts: unknown };

/**
 * Builds a fake runner that records its calls.
 *
 * @param fail - Makes every call reject.
 * @returns The fake and its call log.
 */
function fakeRun(fail = false): { run: Run; calls: Call[] } {
  const calls: Call[] = [];
  const run: Run = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (fail) throw new Error("npm exited with code 1");
  };
  return { run, calls };
}

test("node needs nothing", async () => {
  const { run, calls } = fakeRun();
  await ensureRunner("node", run, {}, () => false);
  assert.deepEqual(calls, []);
});

test("bun that is already available is not installed", async () => {
  const { run, calls } = fakeRun();
  await ensureRunner("bun", run, {}, () => true);
  assert.deepEqual(calls, []);
});

test("missing bun is installed with npm and a timeout", async () => {
  const { run, calls } = fakeRun();
  const env = { A: "1" };
  let installed = false;
  const available = () => installed;
  const installing: Run = async (cmd, args, opts) => {
    await run(cmd, args, opts);
    installed = true;
  };
  await ensureRunner("bun", installing, env, available);
  assert.deepEqual(calls, [{ cmd: "npm", args: ["install", "-g", "bun"], opts: { env, timeoutMs: 120_000 } }]);
});

test("a failed npm asks for the node runner", async () => {
  const { run } = fakeRun(true);
  await assert.rejects(ensureRunner("bun", run, {}, () => false), (err: Error) => {
    assert.ok(err.message.includes('"runner": "node"'), err.message);
    assert.ok(err.message.includes(".agents/runner.json"), err.message);
    return true;
  });
});

test("bun still missing after npm asks for the node runner", async () => {
  const { run } = fakeRun();
  await assert.rejects(ensureRunner("bun", run, {}, () => false), /\.agents\/runner\.json/);
});
