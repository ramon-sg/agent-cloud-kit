/**
 * @file Tests for how prepare shows its lines: icons and colors in a terminal, the prefix otherwise.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLine, initKind, nextSteps, styleMarkdown } from "../src/prepare/ui.ts";

/** Removes ANSI color codes. */
const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");

test("without color a line keeps the agent-cloud-kit prefix", () => {
  assert.equal(formatLine("ok", "se creó x", false), "agent-cloud-kit: se creó x");
});

test("with color each kind has its icon", () => {
  assert.equal(plain(formatLine("ok", "a", true)), "  ✔ a");
  assert.equal(plain(formatLine("same", "a", true)), "  ● a");
  assert.equal(plain(formatLine("info", "a", true)), "  › a");
  assert.equal(plain(formatLine("warn", "a", true)), "  ▲ a");
  assert.equal(plain(formatLine("fail", "a", true)), "  ✖ a");
  assert.match(formatLine("ok", "a", true), /\x1b\[32m✔/);
  assert.match(formatLine("fail", "a", true), /\x1b\[31m✖/);
});

test("init lines: done, already there, or a warning", () => {
  assert.equal(initKind("agent-cloud-kit: se creó .claude/cloud.json"), "ok");
  assert.equal(initKind("se instaló .agents/skills/cloud-ready 1.0.0"), "ok");
  assert.equal(initKind(".claude/settings.json ya tiene el hook SessionStart"), "same");
  assert.equal(initKind(".claude/cloud.json ya existe; se dejó como estaba"), "same");
  assert.equal(initKind("agrega el hook a mano: no es JSON válido"), "warn");
});

test("markdown sections lose their marks in a terminal and stay as is otherwise", () => {
  const md = "## Configurar\n\n### Setup script\n\n```bash\nnpx -y x setup\n```\n\n- `a.com`\nElige **Custom**";
  assert.deepEqual(styleMarkdown(md, false), md.split("\n"));
  assert.deepEqual(styleMarkdown(md, true).map(plain), ["", "  Configurar", "", "  Setup script", "", "      npx -y x setup", "", "    • a.com", "  Elige Custom"]);
});

test("next steps are numbered; without color they fit one prefixed line", () => {
  assert.deepEqual(nextSteps("Listo", ["a", "b"], false), ["agent-cloud-kit: Listo. 1) a; 2) b"]);
  assert.deepEqual(nextSteps("Listo", ["a", "b"], true).map(plain), ["", "  ✔ Listo", "", "   1  a", "   2  b", ""]);
});
