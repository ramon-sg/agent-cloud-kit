/**
 * @file Tests for the block of the final messages, with and without Kuro.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { KURO, renderBlock } from "../src/block.ts";

test("Kuro is the drawing of issue-flow, byte for byte", () => {
  assert.deepEqual(KURO, ["    ▄█████▄", " ≋≋██▀▀▀▀▀██", "    █ ▄  ▄ █   ╱", "    ▀█▄▄▄▄█▀  ╱"]);
});

test("without Kuro the block is indented, with its mark and aligned rows", () => {
  const lines = renderBlock({ mood: "ok", title: "Listo", rows: [["Rama", "main"], ["PR", "#7"]], lines: ["avisará"] }, { art: false, color: false });
  assert.deepEqual(lines, ["", "  [ok] Listo", "", "  Rama  main", "  PR    #7", "", "  avisará", ""]);
});

test("with Kuro the title sits next to the head and the text keeps one column", () => {
  const lines = renderBlock({ mood: "error", title: "Falló", lines: ["a", "b", "c", "d"] }, { art: true, color: false });
  assert.equal(lines[1], KURO[0]);
  assert.equal(lines[2], `${KURO[1]}${" ".repeat(26 - [...(KURO[1] as string)].length)}[!] Falló`);
  assert.equal(lines.at(-2), `${" ".repeat(26)}d`);
  assert.ok(lines.every((line) => line === line.trimEnd()));
});

test("color paints the mark, the title and Kuro; without it there are no codes", () => {
  const colored = renderBlock({ mood: "question", title: "¿Seguro?" }, { art: true, color: true }).join("\n");
  assert.match(colored, /\x1b\[33m\[\?\]/);
  assert.match(colored, /\x1b\[35m/);
  assert.doesNotMatch(renderBlock({ mood: "next", title: "x" }, { art: true, color: false }).join("\n"), /\x1b\[/);
});
