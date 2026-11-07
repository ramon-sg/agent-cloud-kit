/**
 * @file The language of the terminal: `--lang`, then `AGENT_CLOUD_KIT_LANG`, then Spanish.
 * `LANG` and `LC_ALL` are not read: on macOS they are often `en_US.UTF-8` for Spanish speakers.
 */

/** A language the terminal speaks. */
export type Lang = "es" | "en";

/** Environment variable that fixes the language. */
export const LANG_ENV = "AGENT_CLOUD_KIT_LANG";

/** Option that picks the language for one run. */
export const LANG_OPTION = "--lang";

/** A `--lang` or `AGENT_CLOUD_KIT_LANG` value that is neither `es` nor `en`. */
export class LangError extends Error {
  /** Where the value came from: `--lang` or `AGENT_CLOUD_KIT_LANG`. */
  readonly source: string;
  /** The value. */
  readonly value: string;

  /**
   * Builds the error.
   *
   * @param source - Where the value came from.
   * @param value - The value.
   */
  constructor(source: string, value: string) {
    super(`${source}: ${value}`);
    this.name = "LangError";
    this.source = source;
    this.value = value;
  }
}

/**
 * Tells whether a value is a language.
 *
 * @param value - The value.
 * @returns True for `es` and `en`.
 */
function isLang(value: string): value is Lang {
  return value === "es" || value === "en";
}

/**
 * The language of the terminal.
 *
 * @param flag - The `--lang` value, or undefined.
 * @param env - The environment.
 * @returns The flag, else `AGENT_CLOUD_KIT_LANG` (empty counts as unset), else `es`.
 * @throws LangError when the value is neither `es` nor `en`.
 * @example
 * resolveLang(undefined, { AGENT_CLOUD_KIT_LANG: "en" }); // "en"
 */
export function resolveLang(flag: string | undefined, env: NodeJS.ProcessEnv): Lang {
  const fromEnv = env[LANG_ENV]?.trim() ? env[LANG_ENV] : undefined;
  const value = flag ?? fromEnv;
  if (value === undefined) return "es";
  const lang = value.trim().toLowerCase();
  if (!isLang(lang)) throw new LangError(flag !== undefined ? LANG_OPTION : LANG_ENV, value);
  return lang;
}

/**
 * Takes `--lang <x>` or `--lang=<x>` out of the arguments, wherever it is.
 *
 * @param argv - Arguments after the executable name.
 * @returns The other arguments and the value (empty string when `--lang` has no value).
 * @example
 * splitLang(["doctor", "--lang", "en"]); // { args: ["doctor"], flag: "en" }
 */
export function splitLang(argv: string[]): { args: string[]; flag?: string } {
  const args: string[] = [];
  let flag: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === LANG_OPTION) {
      const next = argv[i + 1];
      flag = next !== undefined && !next.startsWith("-") ? next : "";
      if (flag) i++;
    } else if (arg.startsWith(`${LANG_OPTION}=`)) {
      flag = arg.slice(LANG_OPTION.length + 1);
    } else {
      args.push(arg);
    }
  }
  return flag === undefined ? { args } : { args, flag };
}
