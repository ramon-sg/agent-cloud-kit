/**
 * @file The screen `prepare` shows before opening Claude Code: a small cloud, what will happen and
 * what the user has to do, in a few colored lines.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Script of claude-repo-guard that opens Claude without sandbox nor permission prompts. */
export const FREE_SCRIPT = "claude:free";

/** What changes the banner. */
export interface BannerInput {
  /** Where `prepare` works: a new PR, or the current branch without committing. */
  place: "pr" | "here";
  /** Whether Claude opens with the repo's `claude:free` script. */
  free: boolean;
  /** Whether to use ANSI colors. */
  color: boolean;
}

/**
 * Wraps a text in an ANSI code when color is on.
 *
 * @param on - Whether color is on.
 * @param code - SGR code, like `36` for cyan.
 * @param text - Text.
 * @returns The text, colored or not.
 * @example
 * paint(false, "36", "a"); // "a"
 */
function paint(on: boolean, code: string, text: string): string {
  return on ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/**
 * Renders the screen shown before opening Claude Code (without the Enter line, which the caller
 * asks).
 *
 * @param input - Place, mode and color.
 * @returns The lines.
 * @example
 * renderBanner({ place: "pr", free: false, color: false })[2]; // "     .-(    ).     Ahora se abre Claude Code"
 */
export function renderBanner(input: BannerInput): string[] {
  const c = (code: string, text: string): string => paint(input.color, code, text);
  const cloud = (text: string): string => c("36", text);
  const step = (n: number, text: string): string => `   ${c("1;35", String(n))}  ${text}`;
  const after = input.place === "pr" ? "prepare hace commit, push y PR" : "quedan los cambios sin commit";
  const lines = [
    "",
    cloud("        .--."),
    `${cloud("     .-(    ).")}     ${c("1", "Ahora se abre Claude Code")}`,
    `${cloud("    (___.__)__)")}    ${c("2", "con la skill cloud-ready")}`,
    "",
    step(1, "Claude revisa el repo y te propone cómo prepararlo para la nube"),
    step(2, "Responde sus preguntas"),
    step(3, `Cuando diga ${c("1", "configure terminó")}, sal con ${c("1;33", "/exit")} ${c("2", `→ ${after}`)}`),
  ];
  if (input.free) lines.push("", c("2", `   Se abre con ${FREE_SCRIPT} (sin sandbox ni preguntas de permisos): el repo usa claude-repo-guard`));
  lines.push("");
  return lines;
}

/**
 * The line asked after the banner.
 *
 * @param color - Whether to use ANSI colors.
 * @returns The text.
 * @example
 * enterLine(false); // "   ⏎ Enter abre Claude Code · Ctrl+C cancela "
 */
export function enterLine(color: boolean): string {
  return `   ${paint(color, "1;32", "⏎ Enter")} abre Claude Code ${paint(color, "2", "· Ctrl+C cancela")} `;
}

/** Config file claude-repo-guard installs; the free mode is used only when it is there. */
const GUARD_CONFIG = ".claude/repo-guard.config.json";

/**
 * Tells whether the repo uses claude-repo-guard and has its `claude:free` script. Both are
 * required: the free mode drops the sandbox and the permission prompts, so a script with that
 * name alone is not enough.
 *
 * @param repo - Repo root.
 * @returns True when the guard config exists and `package.json` has the script.
 * @example
 * hasFreeScript("/home/u/app"); // true
 */
export function hasFreeScript(repo: string): boolean {
  const file = join(repo, "package.json");
  if (!existsSync(file) || !existsSync(join(repo, GUARD_CONFIG))) return false;
  try {
    const scripts = (JSON.parse(readFileSync(file, "utf8")) as { scripts?: Record<string, unknown> }).scripts;
    return typeof scripts?.[FREE_SCRIPT] === "string";
  } catch {
    return false;
  }
}

/**
 * The command that opens Claude with a prompt: the repo's `claude:free` script through its package
 * manager, or `claude` itself.
 *
 * @param repo - Repo root.
 * @param prompt - First prompt.
 * @returns Command and arguments.
 * @example
 * claudeCommand("/home/u/app", "/cloud-ready configure"); // { cmd: "npm", args: ["run", "claude:free", "--", "/cloud-ready configure"] }
 */
export function claudeCommand(repo: string, prompt: string): { cmd: string; args: string[] } {
  if (!hasFreeScript(repo)) return { cmd: "claude", args: [prompt] };
  const manager = packageManager(repo);
  if (manager === "npm") return { cmd: "npm", args: ["run", FREE_SCRIPT, "--", prompt] };
  return { cmd: manager, args: ["run", FREE_SCRIPT, prompt] };
}

/** Lockfiles that tell the package manager, checked in order. */
const LOCKFILES: Array<[string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["yarn.lock", "yarn"],
];

/**
 * The repo's package manager: `packageManager` in `package.json`, else the lockfile, else npm.
 *
 * @param repo - Repo root.
 * @returns `npm`, `pnpm`, `yarn` or `bun`.
 * @example
 * packageManager("/home/u/app"); // "pnpm"
 */
function packageManager(repo: string): string {
  try {
    const field = (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { packageManager?: unknown }).packageManager;
    const name = typeof field === "string" ? field.split("@")[0] : undefined;
    if (name === "npm" || name === "pnpm" || name === "yarn" || name === "bun") return name;
  } catch {
    // NOTE: no readable package.json; fall back to the lockfile.
  }
  return LOCKFILES.find(([file]) => existsSync(join(repo, file)))?.[1] ?? "npm";
}
