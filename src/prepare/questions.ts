/**
 * @file The questions `prepare` asks: only secret names and extra domains (tests are handled by
 * the skill with the user).
 */
import { isHostName } from "../config.ts";
import { OUTPUT_PREFIX } from "../constants.ts";

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

/** Example host shown when a typed domain is not a host name. */
const HOST_EXAMPLE = "api.example.com";

/**
 * Keeps the typed domains that are host names (the rule of `domains` in the config). Each invalid
 * entry is asked again once; if it is still not a host name it is dropped with a printed note.
 *
 * @param ask Function that asks one question.
 * @param typed Domains as typed.
 * @param print Prints one line.
 * @returns The valid domains.
 * @example
 * await validDomains(ask, ["api.example.com"], console.log); // ["api.example.com"]
 */
async function validDomains(ask: Ask, typed: string[], print: (line: string) => void): Promise<string[]> {
  const domains: string[] = [];
  for (const entry of typed) {
    if (isHostName(entry)) {
      domains.push(entry);
      continue;
    }
    const retry = (await ask(`${JSON.stringify(entry)} is not a host name (like ${HOST_EXAMPLE}); type it again, or ${EMPTY_LIST_ANSWER} to drop it`, "")).trim();
    if (isHostName(retry)) {
      domains.push(retry);
      continue;
    }
    const dropped = retry === "" || retry === EMPTY_LIST_ANSWER ? entry : retry;
    print(`${OUTPUT_PREFIX}dropped ${JSON.stringify(dropped)}: not a host name like ${HOST_EXAMPLE}`);
  }
  return domains;
}

/**
 * Asks every question.
 *
 * @param ask Function that asks one question.
 * @param suggestions Suggested items.
 * @param print Prints one line (notes about dropped domains).
 * @returns The answers.
 * @example
 * await askAll(ask, { secrets: ["API_TOKEN"] }, console.log); // { secrets: ["API_TOKEN"], domains: [] }
 */
export async function askAll(ask: Ask, suggestions: { secrets: string[] }, print: (line: string) => void): Promise<Answers> {
  const secrets = parseList(
    await ask("Secret environment variables needed in the cloud (comma-separated, - for none)", suggestions.secrets.join(", ")),
    suggestions.secrets,
  );
  const typed = parseList(await ask("Extra domains the setup or tests need (comma-separated, - for none)", ""), []);
  return { secrets, domains: await validDomains(ask, typed, print) };
}
