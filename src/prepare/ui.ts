/**
 * @file How `prepare` and `verify` show their lines: an icon and a color per kind in a terminal,
 * or the plain `agent-cloud-kit: ` prefix otherwise (logs, pipes, tests).
 */
import { OUTPUT_PREFIX } from "../constants.ts";

/** Kind of a line, which picks its icon and color. */
export type Kind = "ok" | "same" | "info" | "warn" | "fail";

/** Icon and SGR color code of each kind. */
const STYLE: Record<Kind, { icon: string; code: string }> = {
  ok: { icon: "✔", code: "32" },
  same: { icon: "●", code: "2" },
  info: { icon: "›", code: "36" },
  warn: { icon: "▲", code: "33" },
  fail: { icon: "✖", code: "31" },
};

/**
 * Wraps a text in an SGR code when color is on.
 *
 * @param on - Whether color is on.
 * @param code - SGR code.
 * @param text - Text.
 * @returns The text, colored or not.
 * @example
 * paint(true, "1", "a"); // "\x1b[1ma\x1b[0m"
 */
export function paint(on: boolean, code: string, text: string): string {
  return on ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/**
 * Formats one line.
 *
 * @param kind - Kind of line.
 * @param text - Text, without prefix.
 * @param color - Whether the output is a color terminal.
 * @returns `  ✔ text` (icon colored; the text dimmed for `same`) or `agent-cloud-kit: text`.
 * @example
 * formatLine("ok", "se creó .claude/cloud.json", false); // "agent-cloud-kit: se creó .claude/cloud.json"
 */
export function formatLine(kind: Kind, text: string, color: boolean): string {
  if (!color) return `${OUTPUT_PREFIX}${text}`;
  const { icon, code } = STYLE[kind];
  return `  ${paint(true, code, icon)} ${kind === "same" ? paint(true, "2", text) : text}`;
}

/**
 * Styles a Markdown section for the terminal: headings in bold (and cyan for `##`), code fences
 * dropped and their lines indented, list items as bullets. Without color, the text is unchanged.
 *
 * @param markdown - Section text.
 * @param color - Whether the output is a color terminal.
 * @returns The lines.
 * @example
 * styleMarkdown("## A\n- b", true); // ["", "  \x1b[1;36mA\x1b[0m", "    • b"]
 */
export function styleMarkdown(markdown: string, color: boolean): string[] {
  if (!color) return markdown.split("\n");
  const out: string[] = [];
  let inCode = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) out.push(`      ${paint(true, "33", line)}`);
    else if (line.startsWith("### ")) out.push(`  ${paint(true, "1", line.slice(4))}`);
    else if (line.startsWith("## ")) out.push("", `  ${paint(true, "1;36", line.slice(3))}`);
    else if (line.startsWith("- ")) out.push(`    ${paint(true, "36", "•")} ${inline(line.slice(2))}`);
    else out.push(line === "" ? "" : `  ${inline(line)}`);
  }
  return out;
}

/**
 * Styles inline Markdown: `**bold**` in bold and `` `code` `` in yellow, without the marks.
 *
 * @param text - One line.
 * @returns The styled line.
 * @example
 * inline("Elige **Custom**"); // "Elige \x1b[1mCustom\x1b[0m"
 */
function inline(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, (_m, bold: string) => paint(true, "1", bold)).replace(/`([^`]+)`/g, (_m, code: string) => paint(true, "33", code));
}

/**
 * Renders a "what now" block: a title and numbered steps.
 *
 * @param title - Title.
 * @param steps - Steps, in order.
 * @param color - Whether the output is a color terminal.
 * @returns The lines (without color: one prefixed line with the steps joined).
 * @example
 * nextSteps("Listo", ["haz commit"], false); // ["agent-cloud-kit: Listo. 1) haz commit"]
 */
export function nextSteps(title: string, steps: string[], color: boolean): string[] {
  if (!color) return [`${OUTPUT_PREFIX}${title}. ${steps.map((s, i) => `${i + 1}) ${s}`).join("; ")}`];
  return ["", `  ${paint(true, "1;32", "✔")} ${paint(true, "1", title)}`, "", ...steps.map((s, i) => `   ${paint(true, "1;35", String(i + 1))}  ${s}`), ""];
}
