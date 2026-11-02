/**
 * @file Tests for the prompts `prepare` hands to Claude.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { configurePrompt, verifyPrompt } from "../src/prepare/prompts.ts";

test("configurePrompt starts with the skill call and lists the answers", () => {
  const p = configurePrompt({ secrets: ["A", "B"], domains: ["x.com"] });
  assert.ok(p.startsWith("/cloud-ready configure"));
  assert.match(p, /- Variables secretas: A, B/);
  assert.match(p, /- Dominios extra: x\.com/);
});

test("configurePrompt says ninguno for empty lists", () => {
  const p = configurePrompt({ secrets: [], domains: [] });
  assert.match(p, /- Variables secretas: ninguna/);
  assert.match(p, /- Dominios extra: ninguno/);
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
