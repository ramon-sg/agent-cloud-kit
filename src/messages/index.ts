/**
 * @file The message catalogs and the language of this run. `main` picks the language once with
 * `useLang`; every module then reads its texts with `t()`, so no module reads the environment.
 */
import type { Lang } from "../lang.ts";
import { en } from "./en.ts";
import { es } from "./es.ts";
import type { Messages } from "./es.ts";

export type { Messages };
export { es };

/** Catalog of the current run; Spanish until `useLang` says otherwise. */
let current: Messages = es;

/**
 * The catalog of a language.
 *
 * @param lang - The language.
 * @returns Its messages.
 * @example
 * messages("en").docker.missing; // "dockerd is not installed"
 */
export function messages(lang: Lang): Messages {
  return lang === "en" ? en : es;
}

/**
 * Sets the language of this run.
 *
 * @param lang - The language.
 * @example
 * useLang("en");
 */
export function useLang(lang: Lang): void {
  current = messages(lang);
}

/**
 * The messages of the current language.
 *
 * @returns The catalog.
 * @example
 * t().menu.cancelled; // "Cancelado"
 */
export function t(): Messages {
  return current;
}

/**
 * Turns the name of a setup step, as the state stores it, into the current language. The stored
 * name never changes, so a state written in one language reads well in the other.
 *
 * @param name - Stored step name, like `self install 1.0.0` or `docker pull redis:7`.
 * @returns The name to show.
 * @example
 * stepLabel("write state"); // "guardar el estado" in Spanish
 */
export function stepLabel(name: string): string {
  const m = current.steps;
  const rest = (prefix: string): string | undefined => (name.startsWith(prefix) ? name.slice(prefix.length) : undefined);
  const aptRepo = rest(STEP.aptRepo);
  if (aptRepo !== undefined) return m.aptRepo(aptRepo);
  const aptPackage = rest(STEP.aptPackage);
  if (aptPackage !== undefined) return m.aptPackage(aptPackage);
  const selfInstall = rest(STEP.selfInstall);
  if (selfInstall !== undefined) return m.selfInstall(selfInstall);
  const lane = rest(STEP.lane);
  if (lane !== undefined && /^\d+$/.test(lane)) return m.lane(lane);
  if (name === STEP.writeState) return m.writeState;
  if (name === STEP.config) return m.config;
  return name;
}

/** Stored names (or name prefixes) of the setup steps that have words in them. */
export const STEP = {
  aptRepo: "apt repo ",
  aptPackage: "apt package ",
  selfInstall: "self install ",
  lane: "lane ",
  writeState: "write state",
  config: "config",
} as const;
