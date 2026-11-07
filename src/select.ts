/**
 * @file A small arrow-key menu for the terminal, with the look of agent-kitchen's (`@clack/prompts`)
 * and no dependencies: ↑/↓ move, Enter picks, Esc or Ctrl+C cancels.
 */
import { emitKeypressEvents } from "node:readline";
import { t } from "./messages/index.ts";

/** One option of the menu. */
export interface Choice<T extends string> {
  /** Value returned when picked. */
  value: T;
  /** Text of the option. */
  label: string;
  /** Gray text shown next to the active option. */
  hint?: string;
}

/** Asks the user to pick one option; resolves to its value, or null when cancelled. */
export interface Choose {
  <T extends string>(message: string, choices: Choice<T>[], initial: T): Promise<T | null>;
}

/** Key as `readline` reports it. */
export interface Key {
  name?: string;
  ctrl?: boolean;
}

/** Where the menu is after a key. */
export type MenuState = { active: number; done?: "picked" | "cancelled" };

/** ANSI codes used by the menu. */
const ANSI = {
  dim: (text: string) => `\x1b[2m${text}\x1b[22m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[39m`,
  green: (text: string) => `\x1b[32m${text}\x1b[39m`,
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  up: (lines: number) => (lines > 0 ? `\x1b[${lines}A` : ""),
  clearDown: "\r\x1b[J",
};

/**
 * Applies one key to the menu.
 *
 * @param state - Current state.
 * @param key - Key pressed.
 * @param count - Number of options.
 * @returns The new state.
 * @example
 * menuKey({ active: 0 }, { name: "down" }, 2); // { active: 1 }
 */
export function menuKey(state: MenuState, key: Key, count: number): MenuState {
  if (key.ctrl && key.name === "c") return { ...state, done: "cancelled" };
  if (key.name === "escape") return { ...state, done: "cancelled" };
  if (key.name === "return" || key.name === "enter") return { ...state, done: "picked" };
  if (key.name === "up" || key.name === "k") return { active: (state.active - 1 + count) % count };
  if (key.name === "down" || key.name === "j") return { active: (state.active + 1) % count };
  return state;
}

/**
 * Draws the menu: the question, the options (hint only on the active one) and, once done, the
 * picked option or "Cancelado" (in the language of the terminal).
 *
 * @param message - Question.
 * @param choices - Options.
 * @param state - Current state.
 * @returns The lines to print.
 * @example
 * renderMenu("¿Dónde?", [{ value: "a", label: "A" }], { active: 0 })[0]; // "◆  ¿Dónde?" (with color)
 */
export function renderMenu<T extends string>(message: string, choices: Choice<T>[], state: MenuState): string[] {
  const bar = ANSI.dim("│");
  if (state.done === "picked") return [`${ANSI.green("◇")}  ${message}`, `${bar}  ${ANSI.dim(choices[state.active]?.label ?? "")}`, bar];
  if (state.done === "cancelled") return [`${ANSI.dim("■")}  ${message}`, `${bar}  ${ANSI.dim(t().menu.cancelled)}`, bar];
  const lines = [`${ANSI.cyan("◆")}  ${message}`];
  choices.forEach((choice, index) => {
    if (index === state.active) {
      const hint = choice.hint ? ` ${ANSI.dim(`(${choice.hint})`)}` : "";
      lines.push(`${ANSI.cyan("│")}  ${ANSI.green("●")} ${choice.label}${hint}`);
    } else {
      lines.push(`${ANSI.cyan("│")}  ${ANSI.dim(`○ ${choice.label}`)}`);
    }
  });
  lines.push(ANSI.cyan("└"));
  return lines;
}

/**
 * Shows the menu on the process terminal. Raw mode is on only while it is open, so a later
 * `readline` question or a child process gets a normal terminal.
 *
 * @param message - Question.
 * @param choices - Options.
 * @param initial - Value active at the start.
 * @returns The picked value, or null on Esc or Ctrl+C.
 * @example
 * await chooseTerminal("¿Dónde preparo el repo?", [{ value: "pr", label: "En un PR nuevo" }], "pr"); // "pr"
 */
export const chooseTerminal: Choose = async (message, choices, initial) => {
  const { stdin, stdout } = process;
  let state: MenuState = { active: Math.max(0, choices.findIndex((c) => c.value === initial)) };
  let drawn = 0;
  const draw = (): void => {
    const lines = renderMenu(message, choices, state);
    stdout.write(`${ANSI.up(drawn)}${ANSI.clearDown}${lines.join("\n")}\n`);
    drawn = lines.length;
  };
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write(ANSI.hideCursor);
  draw();
  try {
    return await new Promise((resolvePick) => {
      const onKey = (_text: string, key: Key = {}): void => {
        state = menuKey(state, key, choices.length);
        draw();
        if (state.done === undefined) return;
        stdin.off("keypress", onKey);
        resolvePick(state.done === "picked" ? (choices[state.active]?.value ?? null) : null);
      };
      stdin.on("keypress", onKey);
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write(ANSI.showCursor);
  }
};
