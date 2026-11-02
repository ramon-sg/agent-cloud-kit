/**
 * @file The `cloud-ready` skill that `init` copies into the repo.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Repo-relative directory of the `cloud-ready` skill. */
export const SKILL_DIR = ".agents/skills/cloud-ready";

/** Matches the `metadata:` block of the frontmatter, up to the next top-level key or the end. */
const METADATA_BLOCK = /^metadata:[ \t]*\n((?:[ \t]+.*(?:\n|$))*)/m;

/** Matches an indented `version:` line inside the metadata block; the value may be quoted. */
const VERSION_LINE = /^\s+version:\s*"?([^"\n]+)"?$/m;

/**
 * Reads `metadata.version` from the frontmatter of the installed skill.
 *
 * @param repo - Repo root.
 * @returns The version, or undefined when the skill or its version is missing.
 * @example
 * skillVersion("/home/user/app"); // "1.0.0"
 */
export function skillVersion(repo: string): string | undefined {
  const file = join(repo, SKILL_DIR, "SKILL.md");
  if (!existsSync(file)) return undefined;
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, "utf8"))?.[1] ?? "";
  const block = METADATA_BLOCK.exec(frontmatter)?.[1] ?? "";
  return VERSION_LINE.exec(block)?.[1]?.trim();
}
