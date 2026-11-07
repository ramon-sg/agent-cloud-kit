/**
 * @file The `manual` command: generates `docs/agent-cloud.md` (in Spanish) from the repo's cloud config
 * keeping everything a person or agent wrote outside the generated block.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readConfig } from "./config.ts";
import type { CloudConfig } from "./config.ts";
import { CONFIG_FILE, PACKAGE, packageSpec } from "./constants.ts";
import { es, t } from "./messages/index.ts";
import type { Messages } from "./messages/index.ts";

/** Path of the manual, relative to the repo. */
export const MANUAL_FILE = "docs/agent-cloud.md";

/** Marker that opens the generated block. */
export const BEGIN = "<!-- agent-cloud-kit:begin -->";

/** Marker that closes the generated block. */
export const END = "<!-- agent-cloud-kit:end -->";

/** Text of a new manual after the generated block, where findings are kept. */
const FINDINGS = "## Hallazgos\n\n_Lo que el agente descubra de la nube va aquí._\n";

/** Prefix of an https URL. */
const HTTPS_PREFIX = "https://";

/**
 * Setup script the environment must run, for a `bash` block.
 *
 * @param packageVersion - Version of the running package.
 * @returns The script.
 * @example
 * setupScript("1.2.0"); // "#!/bin/bash\nnpx -y agent-cloud-kit@1 setup"
 */
function setupScript(packageVersion: string): string {
  return `#!/bin/bash\nnpx -y ${packageSpec(packageVersion)} setup`;
}

/** Note at the top: the document grows when the skill finds something new. */
const UPDATES_NOTE = `> Se actualiza solo cuando la skill \`cloud-ready\` detecta un dominio o una variable nueva. Si cambia, aplícalo en claude.ai y corre \`npx ${PACKAGE} verify\`.`;

/**
 * Extracts the host of an apt repo URL.
 *
 * @param url - Apt repo entry of the config.
 * @returns The host, or undefined when it is not a parseable https URL.
 * @example
 * repoHost("https://apt.example.com/repo"); // "apt.example.com"
 */
function repoHost(url: string): string | undefined {
  if (!url.startsWith(HTTPS_PREFIX)) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lists the hosts the cloud environment must allow: `domains` plus the apt repo hosts.
 *
 * @param config - Repo config.
 * @returns Sorted hosts without duplicates.
 * @example
 * allowedHosts({ ...config, domains: ["b.com"], aptRepos: ["https://a.com/x"] }); // ["a.com", "b.com"]
 */
function allowedHosts(config: CloudConfig): string[] {
  const hosts = config.aptRepos.map(repoHost).filter((host): host is string => host !== undefined);
  return [...new Set([...config.domains, ...hosts])].sort();
}

/**
 * Renders the "Configurar el entorno en claude.ai" section: in Spanish for the manual, in the
 * language of the terminal when `prepare` shows it.
 *
 * @param config - Repo config.
 * @param packageVersion - Version of the running package, for the setup script.
 * @param text - Texts of the section; Spanish when omitted.
 * @returns The section, without a trailing newline.
 * @example
 * renderEnvironmentSection(config, "1.0.0").startsWith("## Configurar el entorno en claude.ai"); // true
 */
export function renderEnvironmentSection(config: CloudConfig, packageVersion: string, text: Messages["environment"] = es.environment): string {
  const hosts = allowedHosts(config);
  const code = (items: string[]): string => items.map((item) => `\`${item}\``).join(", ");
  const lines = [
    text.title,
    "",
    text.intro,
    "",
    text.network(hosts.length ? code(hosts) : text.none),
    text.variables(config.requiredEnv.length ? text.namesOnly(code(config.requiredEnv)) : text.noneVariables),
    text.githubApp,
    text.githubConnector(CONNECTOR_GUIDE),
    text.setupScript,
    "",
    "```bash",
    setupScript(packageVersion),
    "```",
  ];
  if (config.requiredEnv.length) lines.push("", text.variablesWarning);
  return lines.join("\n");
}

/** What to do when the tests change, one line. */
const TESTS_CHANGE_SECTION = [
  "## Si cambian los tests",
  "",
  `Si agregas tests (p. ej. de Electron) o cambias cómo se corren, corre \`npx ${PACKAGE} prepare\`: la skill \`cloud-ready\` los adapta a la nube sin cambiar lo que comprueban y actualiza este documento.`,
].join("\n");

/** Guide to set up the GitHub connector in claude.ai, once per account. */
export const CONNECTOR_GUIDE = "https://github.com/ramon-sg/github-rest/blob/main/docs/projects-connector.md";

/** Example of a GitHub Action that writes in a project when an issue is closed. */
export const PROJECT_ACTION_GUIDE =
  "https://github.com/ramon-sg/agent-cloud-kit/blob/main/skills/cloud-ready/reference/project-action.md";

/** What of GitHub works in the cloud and what to do with the rest. */
const GITHUB_SECTION = [
  "## GitHub en la nube",
  "",
  "- ✅ `gh api repos/{owner}/{repo}/…` (REST) de los repos de la sesión, `gh api user` y `git push`.",
  "- ❌ GraphQL (`gh pr`, `gh issue`, `gh project`) y lo que no es del repo (Projects v2, `search/…`, `user/repos`, otros repos): 403 del proxy, `This GitHub API path is not available: sessions are bound to their configured repositories`. Un `GH_TOKEN` propio no cambia nada.",
  `- ⏳ Para eso, el conector de GitHub de claude.ai, una vez por cuenta ([guía](${CONNECTOR_GUIDE})). Pon sus herramientas en "permitir siempre" en claude.ai → Configuración → Conectores → GitHub: una regla \`permissions.allow\` en \`.claude/settings.json\` no evita el aviso en cada llamada.`,
  `- 🔁 Lo que pasa al cerrar una issue o al hacer merge (p. ej. escribir un campo del proyecto) va en una GitHub Action, no en el agente: corre en GitHub, fuera del proxy, aunque no haya ninguna sesión. \`GITHUB_TOKEN\` no llega a Projects v2: hace falta un secret con un token classic con \`project\` (y \`repo\` si el repo es privado) ([ejemplo](${PROJECT_ACTION_GUIDE})).`,
].join("\n");

/** The "how to verify" section, one line. */
const VERIFY_SECTION = [
  "## Verificar",
  "",
  `Corre \`npx ${PACKAGE} verify\` desde la rama subida: abre una sesión en la nube que revisa \`${PACKAGE} doctor\`, las dependencias, las versiones y las variables, y lo reporta en el PR.`,
].join("\n");

/**
 * Resolves the `notes` of the config: the content of the file when it is a relative path to an
 * existing file inside the repo, else the text as is. Absolute paths and escapes are plain text.
 *
 * @param repo - Repo root.
 * @param notes - Value of `notes` in the config, if any.
 * @returns The notes text to show, if any.
 * @example
 * resolveNotes("/home/user/app", ".claude/cloud-notes.md"); // content of that file
 * resolveNotes("/home/user/app", "Sin GPU."); // "Sin GPU."
 */
export function resolveNotes(repo: string, notes: string | undefined): string | undefined {
  if (!notes || isAbsolute(notes)) return notes;
  const file = resolve(repo, notes);
  const inside = (path: string, root: string): boolean => {
    const rel = relative(root, path);
    return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  try {
    if (!inside(file, repo) || !statSync(file).isFile()) return notes;
    if (!inside(realpathSync(file), realpathSync(repo))) return notes;
    return readFileSync(file, "utf8");
  } catch {
    return notes;
  }
}

/**
 * Renders the generated block of the manual, markers included.
 *
 * @param input - Config, package version and optional notes text (default: `config.notes`).
 * @returns The block.
 * @example
 * renderManual({ config, packageVersion: "1.0.0" }).startsWith(BEGIN); // true
 */
export function renderManual(input: { config: CloudConfig; packageVersion: string; notes?: string }): string {
  const notes = input.notes ?? input.config.notes;
  const parts = [
    BEGIN,
    `<!-- Generado por ${PACKAGE} ${input.packageVersion}. No edites entre las marcas. -->`,
    "# Claude Code en la nube",
    UPDATES_NOTE,
    renderEnvironmentSection(input.config, input.packageVersion),
    VERIFY_SECTION,
    GITHUB_SECTION,
    `## Qué corre en la nube\n\n${notes?.trim() ? notes.trim() : "Nada anotado."}`,
    TESTS_CHANGE_SECTION,
    END,
  ];
  return parts.join("\n\n");
}

/**
 * Puts the generated block into the manual text: replaces what is between the markers, or prepends
 * the block when there are none; everything else stays untouched.
 *
 * @param existing - Current file content, if any.
 * @param block - Output of `renderManual`.
 * @returns The new file content.
 * @example
 * mergeManual(undefined, block); // block + "\n\n## Hallazgos ..."
 */
export function mergeManual(existing: string | undefined, block: string): string {
  if (existing === undefined) return `${block}\n\n${FINDINGS}`;
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END, start + 1);
  if (start >= 0 && end >= 0) return existing.slice(0, start) + block + existing.slice(end + END.length);
  return `${block}\n\n${existing}`;
}

/**
 * Writes `docs/agent-cloud.md` for a repo, atomically.
 *
 * @param repo - Repo root.
 * @param packageVersion - Version of this package.
 * @returns The path written.
 * @throws When `.claude/cloud.json` is missing or invalid.
 * @example
 * writeManual("/home/user/app", "1.0.0"); // "/home/user/app/docs/agent-cloud.md"
 */
export function writeManual(repo: string, packageVersion: string): string {
  const { config, errors } = readConfig(repo);
  if (!config) throw new Error(errors[0] ?? t().manual.noConfig(CONFIG_FILE));
  const file = join(repo, MANUAL_FILE);
  const existing = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  const block = renderManual({ config, packageVersion, notes: resolveNotes(repo, config.notes) });
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, mergeManual(existing, block));
    renameSync(temp, file);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
  return file;
}
