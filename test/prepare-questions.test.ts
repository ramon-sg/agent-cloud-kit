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
  const got = await askAll(ask, { secrets: ["A", "B"] }, () => undefined);
  assert.deepEqual(got, { secrets: ["A", "B"], domains: ["api.example.com", "b.example.com"] });
  assert.deepEqual(suggestions, ["A, B", ""]);
});

test("a dash leaves the list empty", async () => {
  const { ask } = script(["-", ""]);
  assert.deepEqual(await askAll(ask, { secrets: ["A"] }, () => undefined), { secrets: [], domains: [] });
});

test("typed secrets replace the suggestion; blanks are dropped", async () => {
  const { ask } = script(["X, ,Y", "-"]);
  assert.deepEqual(await askAll(ask, { secrets: ["A"] }, () => undefined), { secrets: ["X", "Y"], domains: [] });
});

test("an invalid typed domain is re-asked once and the valid answer kept", async () => {
  const { ask } = script(["-", "api.example.com, https://bad.example.com/x", "bad.example.com"]);
  const notes: string[] = [];
  const got = await askAll(ask, { secrets: [] }, (line) => notes.push(line));
  assert.deepEqual(got, { secrets: [], domains: ["api.example.com", "bad.example.com"] });
  assert.deepEqual(notes, []);
});

test("an invalid domain that is still invalid the second time is dropped with a note", async () => {
  const questions: string[] = [];
  const answers = ["-", "ok.example.com, localhost", "still bad"];
  const ask = async (q: string): Promise<string> => {
    questions.push(q);
    return answers.shift() ?? "";
  };
  const notes: string[] = [];
  const got = await askAll(ask, { secrets: [] }, (line) => notes.push(line));
  assert.deepEqual(got, { secrets: [], domains: ["ok.example.com"] });
  assert.equal(questions.length, 3);
  assert.match(questions[2] ?? "", /"localhost" is not a host name/);
  assert.deepEqual(notes, ['agent-cloud-kit: dropped "still bad": not a host name like api.example.com']);
});

test("a re-asked domain answered with - or nothing is dropped with a note", async () => {
  const { ask } = script(["-", "nope", ""]);
  const notes: string[] = [];
  assert.deepEqual(await askAll(ask, { secrets: [] }, (line) => notes.push(line)), { secrets: [], domains: [] });
  assert.deepEqual(notes, ['agent-cloud-kit: dropped "nope": not a host name like api.example.com']);
});
