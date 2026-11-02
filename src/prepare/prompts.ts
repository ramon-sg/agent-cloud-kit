/**
 * @file Prompts `prepare` hands to Claude, in Spanish: they invoke the `cloud-ready` skill.
 */
/**
 * Prompt for the local session: `configure` mode. `prepare` asks nothing first; the skill detects
 * secrets and domains itself.
 *
 * @returns The prompt.
 * @example
 * configurePrompt(); // "/cloud-ready configure"
 */
export function configurePrompt(): string {
  return "/cloud-ready configure";
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
