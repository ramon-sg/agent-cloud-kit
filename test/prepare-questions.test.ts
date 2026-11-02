/**
 * @file Tests for the `prepare` questions.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { askAll } from "../src/prepare/questions.ts";

/** Builds an `ask` that returns canned answers and records the suggestions it was given. */
function script(answers: string[]) {
  const suggestions: string[] = [];
  const ask = async (_q: string, suggestion: string) => {
    suggestions.push(suggestion);
    return answers.shift() ?? "";
  };
  return { ask, suggestions };
}

test("empty answer accepts the suggestion; domains are split by commas", async () => {
  const { ask, suggestions } = script(["", "api.example.com, b.example.com"]);
  const got = await askAll(ask, { secrets: ["A", "B"] });
  assert.deepEqual(got, { secrets: ["A", "B"], domains: ["api.example.com", "b.example.com"] });
  assert.deepEqual(suggestions, ["A, B", ""]);
});

test("a dash leaves the list empty", async () => {
  const { ask } = script(["-", ""]);
  assert.deepEqual(await askAll(ask, { secrets: ["A"] }), { secrets: [], domains: [] });
});

test("typed secrets replace the suggestion; blanks are dropped", async () => {
  const { ask } = script(["X, ,Y", "-"]);
  assert.deepEqual(await askAll(ask, { secrets: ["A"] }), { secrets: ["X", "Y"], domains: [] });
});
