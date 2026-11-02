/**
 * @file Tests for the prompts `prepare` hands to Claude.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { configurePrompt, verifyPrompt } from "../src/prepare/prompts.ts";

test("configurePrompt only calls the skill: prepare asks nothing first", () => {
  assert.equal(configurePrompt(), "/cloud-ready configure");
});

test("verifyPrompt carries the branch and, when known, the PR", () => {
  const p = verifyPrompt({ branch: "chore/cloud-ready-1", pr: "42" });
  assert.ok(p.startsWith("/cloud-ready verify"));
  assert.match(p, /chore\/cloud-ready-1/);
  assert.match(p, /PR: #42/);
});

test("verifyPrompt without PR does not mention a number", () => {
  const p = verifyPrompt({ branch: "chore/cloud-ready-1" });
  assert.doesNotMatch(p, /#\d/);
  assert.match(p, /chore\/cloud-ready-1/);
});
