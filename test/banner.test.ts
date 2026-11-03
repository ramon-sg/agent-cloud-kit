/**
 * @file Tests for the screen shown before Claude opens and for how Claude is launched.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claudeCommand, enterLine, renderBanner } from "../src/prepare/banner.ts";

test("the banner is short and says what to do", () => {
  const lines = renderBanner({ place: "pr", free: false, color: false });
  assert.ok(lines.length <= 10, `${lines.length} lines`);
  const text = lines.join("\n");
  assert.match(text, /Ahora se abre Claude Code/);
  assert.match(text, /Responde sus preguntas/);
  assert.match(text, /sal con \/exit → prepare hace commit, push y PR/);
  assert.doesNotMatch(text, /claude:free/);
  assert.doesNotMatch(text, /\x1b\[/);
});

test("in the current branch it says the changes stay uncommitted; with the guard it names claude:free", () => {
  const text = renderBanner({ place: "here", free: true, color: false }).join("\n");
  assert.match(text, /quedan los cambios sin commit/);
  assert.match(text, /Se abre con claude:free/);
});

test("color adds ANSI codes; the Enter line too", () => {
  assert.match(renderBanner({ place: "pr", free: false, color: true }).join("\n"), /\x1b\[36m/);
  assert.equal(enterLine(false), "   ⏎ Enter abre Claude Code · Ctrl+C cancela ");
  assert.match(enterLine(true), /\x1b\[1;32m⏎ Enter/);
});

test("claudeCommand uses claude, or claude:free through the repo's package manager", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-banner-"));
  try {
    assert.deepEqual(claudeCommand(dir, "p"), { cmd: "claude", args: ["p"] });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { "claude:free": "claude" } }));
    assert.deepEqual(claudeCommand(dir, "p"), { cmd: "claude", args: ["p"] }, "the script alone is not enough");
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude/repo-guard.config.json"), "{}");
    assert.deepEqual(claudeCommand(dir, "p"), { cmd: "npm", args: ["run", "claude:free", "--", "p"] });
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    assert.deepEqual(claudeCommand(dir, "p"), { cmd: "pnpm", args: ["run", "claude:free", "p"] });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "bun@1.2.0", scripts: { "claude:free": "claude" } }));
    assert.deepEqual(claudeCommand(dir, "p"), { cmd: "bun", args: ["run", "claude:free", "p"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
