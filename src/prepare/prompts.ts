/**
 * @file Prompts `prepare` hands to Claude, in Spanish: they invoke the `cloud-ready` skill.
 */
import type { Answers } from "./questions.ts";

/**
 * Formats a list for a prompt line.
 *
 * @param items Items.
 * @param none Text when there are no items.
 * @returns The items joined by commas, or `none`.
 * @example
 * list(["A", "B"], "ninguna"); // "A, B"
 */
function list(items: string[], none: string): string {
  return items.length > 0 ? items.join(", ") : none;
}

/**
 * Prompt for the local session: `configure` mode with the user's answers.
 *
 * @param answers What the user answered.
 * @returns The prompt.
 * @example
 * configurePrompt({ secrets: ["A"], domains: [] }).startsWith("/cloud-ready configure"); // true
 */
export function configurePrompt(answers: Answers): string {
  return [
    "/cloud-ready configure",
    "",
    "Respuestas del usuario (no las vuelvas a preguntar):",
    `- Variables secretas: ${list(answers.secrets, "ninguna")}`,
    `- Dominios extra: ${list(answers.domains, "ninguno")}`,
  ].join("\n");
}

/**
 * Prompt for the cloud session: `verify` mode with the prepare branch and, when known, the PR.
 *
 * @param input Branch of `prepare` and optional PR number.
 * @returns The prompt.
 * @example
 * verifyPrompt({ branch: "chore/cloud-ready-1", pr: "42" }); // "/cloud-ready verify\n\n- Rama de prepare: ..."
 */
export function verifyPrompt(input: { branch: string; pr?: string }): string {
  const lines = ["/cloud-ready verify", "", `- Rama de prepare: ${input.branch}`];
  if (input.pr !== undefined) lines.push(`- PR: #${input.pr}`);
  return lines.join("\n");
}
