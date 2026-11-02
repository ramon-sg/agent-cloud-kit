/**
 * @file The questions `prepare` asks: only secret names and extra domains (tests are handled by
 * the skill with the user).
 */

/** What the user answered. */
export interface Answers {
  /** Names of the secret environment variables needed in the cloud. */
  secrets: string[];
  /** Extra network domains the setup or tests need. */
  domains: string[];
}

/** Asks one question, showing a suggestion; resolves to the raw answer. */
export interface Ask {
  (question: string, suggestion: string): Promise<string>;
}

/** Answer that leaves a list empty. */
const EMPTY_LIST_ANSWER = "-";

/**
 * Turns a raw answer into a list.
 *
 * @param answer Raw answer: comma-separated, empty to accept, `-` for none.
 * @param suggestion Suggested items, used when the answer is empty.
 * @returns The items.
 * @example
 * parseList("a, b", []); // ["a", "b"]
 */
function parseList(answer: string, suggestion: string[]): string[] {
  const text = answer.trim();
  if (text === "") return suggestion;
  if (text === EMPTY_LIST_ANSWER) return [];
  return text.split(",").map((item) => item.trim()).filter((item) => item !== "");
}

/**
 * Asks every question.
 *
 * @param ask Function that asks one question.
 * @param suggestions Suggested items.
 * @returns The answers.
 * @example
 * await askAll(ask, { secrets: ["API_TOKEN"] }); // { secrets: ["API_TOKEN"], domains: [] }
 */
export async function askAll(ask: Ask, suggestions: { secrets: string[] }): Promise<Answers> {
  const secrets = parseList(
    await ask("Secret environment variables needed in the cloud (comma-separated, - for none)", suggestions.secrets.join(", ")),
    suggestions.secrets,
  );
  const domains = parseList(await ask("Extra domains the setup or tests need (comma-separated, - for none)", ""), []);
  return { secrets, domains };
}
