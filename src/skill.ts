/**
 * @file The `cloud-ready` skill that `init` copies into the repo, and the link Claude Code needs
 * to discover it.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Repo-relative directory of the `cloud-ready` skill. */
export const SKILL_DIR = ".agents/skills/cloud-ready";

/** Directory of the skill inside this package. */
const PACKAGE_SKILL_DIR = "skills/cloud-ready";

/** Repo-relative folder of the skills that Claude Code discovers. */
const CLAUDE_SKILLS_DIR = ".claude/skills";

/** Repo-relative folder of the skills that skills-manager installs. */
const AGENTS_SKILLS_DIR = ".agents/skills";

/** Repo-relative path of the link to the skill that Claude Code discovers. */
const SKILL_LINK = `${CLAUDE_SKILLS_DIR}/cloud-ready`;

/** Target of `SKILL_LINK`, relative to the folder that holds it. */
const SKILL_LINK_TARGET = `../../${SKILL_DIR}`;

/** Matches the frontmatter at the start of a skill file; group 1 is its body. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

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
  const frontmatter = FRONTMATTER.exec(readFileSync(file, "utf8"))?.[1] ?? "";
  const block = METADATA_BLOCK.exec(frontmatter)?.[1] ?? "";
  return VERSION_LINE.exec(block)?.[1]?.trim();
}

/**
 * Sets `metadata.version` in the frontmatter of a skill file, adding the block when it is missing.
 *
 * @param text - Content of SKILL.md.
 * @param version - Version to write.
 * @returns The new content; unchanged when the file has no frontmatter.
 * @example
 * withVersion('---\nname: x\nmetadata:\n  version: "0.0.0"\n---\n', "1.0.0"); // version "1.0.0"
 */
function withVersion(text: string, version: string): string {
  const match = FRONTMATTER.exec(text);
  if (!match) return text;
  const frontmatter = match[1] ?? "";
  const line = `  version: "${version}"`;
  const block = METADATA_BLOCK.exec(frontmatter);
  let updated: string;
  if (!block) {
    updated = `${frontmatter}\nmetadata:\n${line}`;
  } else {
    const body = block[1] ?? "";
    const newBody = VERSION_LINE.test(body) ? body.replace(VERSION_LINE, line) : `${line}\n${body}`;
    const head = block[0].slice(0, block[0].length - body.length);
    updated = frontmatter.slice(0, block.index) + head + newBody + frontmatter.slice(block.index + block[0].length);
  }
  return `---\n${updated}\n---${text.slice(match[0].length)}`;
}

/**
 * Copies the `cloud-ready` skill of this package into the repo, with `metadata.version` set to the
 * package version. Leaves it untouched when it is already at that version; otherwise replaces the
 * whole folder atomically (copy to a temp folder, then rename).
 *
 * @param repo - Repo root.
 * @param packageRoot - Root of this package, which holds `skills/cloud-ready`.
 * @param packageVersion - Version of this package.
 * @returns A line describing the outcome.
 * @throws When the package has no skill or the copy fails (the installed skill is kept).
 * @example
 * installSkill("/home/user/app", "/usr/lib/node_modules/agent-cloud-kit", "1.0.0");
 * // "installed .agents/skills/cloud-ready 1.0.0"
 */
export function installSkill(repo: string, packageRoot: string, packageVersion: string): string {
  const current = skillVersion(repo);
  if (current === packageVersion) return `${SKILL_DIR} already at ${packageVersion}`;
  const source = join(packageRoot, PACKAGE_SKILL_DIR);
  if (!existsSync(join(source, "SKILL.md"))) throw new Error(`${PACKAGE_SKILL_DIR}/SKILL.md not found in ${packageRoot}`);
  const target = join(repo, SKILL_DIR);
  const temp = `${target}.${process.pid}.tmp`;
  const old = `${target}.${process.pid}.old`;
  mkdirSync(dirname(target), { recursive: true });
  try {
    rmSync(temp, { recursive: true, force: true });
    cpSync(source, temp, { recursive: true });
    const skillFile = join(temp, "SKILL.md");
    writeFileSync(skillFile, withVersion(readFileSync(skillFile, "utf8"), packageVersion));
    if (existsSync(target)) renameSync(target, old);
    renameSync(temp, target);
  } catch (err) {
    rmSync(temp, { recursive: true, force: true });
    if (existsSync(old) && !existsSync(target)) renameSync(old, target);
    throw err;
  }
  rmSync(old, { recursive: true, force: true });
  return current === undefined ? `installed ${SKILL_DIR} ${packageVersion}` : `updated ${SKILL_DIR} from ${current} to ${packageVersion}`;
}

/**
 * Tells whether a path exists, counting a broken symlink as existing.
 *
 * @param path - Absolute path.
 * @returns True when something is there.
 */
function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Links the skill where Claude Code discovers it: Claude Code does not read `.agents/skills/`, so
 * this creates the relative symlink `.claude/skills/cloud-ready -> ../../.agents/skills/cloud-ready`.
 * Does nothing when `.claude/skills` already resolves to `.agents/skills` or the entry exists.
 *
 * @param repo - Repo root.
 * @returns A line describing what was done, or undefined when nothing was needed.
 * @example
 * linkSkill("/home/user/app"); // "linked .claude/skills/cloud-ready to .agents/skills/cloud-ready"
 */
export function linkSkill(repo: string): string | undefined {
  const claudeSkills = join(repo, CLAUDE_SKILLS_DIR);
  const agentsSkills = join(repo, AGENTS_SKILLS_DIR);
  if (existsSync(claudeSkills) && existsSync(agentsSkills) && realpathSync(claudeSkills) === realpathSync(agentsSkills)) return undefined;
  const link = join(repo, SKILL_LINK);
  if (present(link)) return undefined;
  mkdirSync(claudeSkills, { recursive: true });
  symlinkSync(SKILL_LINK_TARGET, link);
  return `linked ${SKILL_LINK} to ${SKILL_DIR}`;
}
