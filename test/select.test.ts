/**
 * @file Tests for the terminal menu: keys and drawing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { menuKey, renderMenu } from "../src/select.ts";

/** Removes ANSI color codes. */
const plain = (lines: string[]): string[] => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));

const CHOICES = [
  { value: "pr", label: "En un PR nuevo", hint: "recomendado" },
  { value: "here", label: "En la rama actual, sin commit", hint: "git diff" },
];

test("arrows move and wrap, Enter picks, Esc and Ctrl+C cancel", () => {
  assert.deepEqual(menuKey({ active: 0 }, { name: "down" }, 2), { active: 1 });
  assert.deepEqual(menuKey({ active: 1 }, { name: "down" }, 2), { active: 0 });
  assert.deepEqual(menuKey({ active: 0 }, { name: "up" }, 2), { active: 1 });
  assert.deepEqual(menuKey({ active: 1 }, { name: "return" }, 2), { active: 1, done: "picked" });
  assert.deepEqual(menuKey({ active: 0 }, { name: "escape" }, 2), { active: 0, done: "cancelled" });
  assert.deepEqual(menuKey({ active: 0 }, { name: "c", ctrl: true }, 2), { active: 0, done: "cancelled" });
  assert.deepEqual(menuKey({ active: 0 }, { name: "x" }, 2), { active: 0 });
});

test("the open menu shows the hint only on the active option", () => {
  assert.deepEqual(plain(renderMenu("¿Dónde preparo el repo?", CHOICES, { active: 0 })), [
    "◆  ¿Dónde preparo el repo?",
    "│  ● En un PR nuevo (recomendado)",
    "│  ○ En la rama actual, sin commit",
    "└",
  ]);
});

test("a closed menu shows the pick, or Cancelado", () => {
  assert.deepEqual(plain(renderMenu("¿Dónde?", CHOICES, { active: 1, done: "picked" })), ["◇  ¿Dónde?", "│  En la rama actual, sin commit", "│"]);
  assert.deepEqual(plain(renderMenu("¿Dónde?", CHOICES, { active: 0, done: "cancelled" })), ["■  ¿Dónde?", "│  Cancelado", "│"]);
});
