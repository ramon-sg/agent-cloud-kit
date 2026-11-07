/**
 * @file The block of the final messages, like issue-flow's: a title with a status mark, a few
 * aligned rows and free lines, with Kuro (the mascot) beside it. It is drawn only in a terminal;
 * logs, pipes and Claude's context keep the plain `agent-cloud-kit: ` lines.
 */

/** How the block feels: done, failed, waiting for an answer, or about to go on. */
export type Mood = "ok" | "error" | "question" | "next";

/** What a final message says. */
export interface Block {
  /** Picks the mark and the color of the title. */
  mood: Mood;
  /** First line, next to Kuro's head. */
  title: string;
  /** Label and value pairs, aligned in a column. */
  rows?: Array<[label: string, value: string]>;
  /** Free lines after the rows. */
  lines?: string[];
}

/** Kuro, the drawing of issue-flow, without trailing spaces. */
export const KURO: readonly string[] = ["    ▄█████▄", " ≋≋██▀▀▀▀▀██", "    █ ▄  ▄ █   ╱", "    ▀█▄▄▄▄█▀  ╱"];

/** Column where the text begins, after Kuro. */
const TEXT_COLUMN = 26;

/** Indent of the text without Kuro. */
const INDENT = 2;

/** ASCII mark of each mood. */
const MARKS: Record<Mood, string> = { ok: "[ok]", error: "[!]", question: "[?]", next: "[>]" };

/** SGR color of each mood. */
const MOOD_COLOR: Record<Mood, string> = { ok: "32", error: "31", question: "33", next: "36" };

/**
 * Wraps a text in an SGR code when color is on.
 *
 * @param on - Whether color is on.
 * @param code - SGR code.
 * @param text - Text.
 * @returns The text, colored or not.
 * @example
 * paint(false, "1", "x"); // "x"
 */
function paint(on: boolean, code: string, text: string): string {
  return on ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/**
 * Visible width of a text: characters, without ANSI codes.
 *
 * @param text - Text.
 * @returns The width.
 * @example
 * width("\x1b[1mab\x1b[0m"); // 2
 */
function width(text: string): number {
  return [...text.replace(/\x1b\[[0-9;]*m/g, "")].length;
}

/**
 * Renders a block. Values are never cut or wrapped: a command to copy must stay whole.
 *
 * @param block - What to say.
 * @param opts - Whether to draw Kuro and whether to color.
 * @returns The lines, with a blank line before and after.
 * @example
 * renderBlock({ mood: "ok", title: "Listo" }, { art: false, color: false }); // ["", "  [ok] Listo", ""]
 */
export function renderBlock(block: Block, opts: { art: boolean; color: boolean }): string[] {
  const code = MOOD_COLOR[block.mood];
  const text = [`${paint(opts.color, code, MARKS[block.mood])} ${paint(opts.color, `1;${code}`, block.title)}`];
  if (block.rows?.length) {
    const column = Math.max(...block.rows.map(([label]) => width(label))) + 2;
    text.push("");
    for (const [label, value] of block.rows) text.push(`${paint(opts.color, "2", label)}${" ".repeat(column - width(label))}${value}`);
  }
  if (block.lines?.length) text.push("", ...block.lines);
  const out: string[] = [];
  if (opts.art) {
    // NOTE: Kuro takes rows 0-3 and the text starts on row 1, next to the head.
    const total = Math.max(KURO.length, text.length + 1);
    for (let row = 0; row < total; row++) {
      const left = KURO[row] ?? "";
      const drawn = left ? paint(opts.color, "35", left) : "";
      const right = text[row - 1];
      out.push(right === undefined || right === "" ? drawn : `${drawn}${" ".repeat(TEXT_COLUMN - width(left))}${right}`);
    }
  } else {
    for (const line of text) out.push(line === "" ? "" : `${" ".repeat(INDENT)}${line}`);
  }
  return ["", ...out.map((line) => line.trimEnd()), ""];
}
