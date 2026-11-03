/**
 * @file The `manual` command: generates `docs/agent-cloud.md` (in Spanish) from the repo's cloud config
 * keeping everything a person or agent wrote outside the generated block.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readConfig } from "./config.ts";
import type { CloudConfig } from "./config.ts";
import { CONFIG_FILE, OUTPUT_PREFIX, PACKAGE, packageSpec } from "./constants.ts";

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

/** The "how it works" section, five lines. */
const HOW_IT_WORKS = [
  "## Cómo funciona",
  "",
  "1. agent-kitchen instala las herramientas y los ganchos en el repo.",
  `2. \`${PACKAGE} prepare\` configura el repo con la skill y genera este documento.`,
  "3. Tú configuras el entorno en claude.ai con lo que indica la siguiente sección.",
  "4. Una sesión en la nube verifica que el entorno quedó bien.",
  "5. El PR guarda el resultado.",
  "",
  "Este documento se va actualizando. Cuando la skill `cloud-ready`, en local o en la nube, detecta que hace falta un dominio o una variable de entorno nueva, la agrega a `.claude/cloud.json`, regenera este archivo y te lo dice en la sesión. Cuando cambie la sección \"Configurar el entorno en claude.ai\", aplica lo nuevo en claude.ai y vuelve a verificar con `npx agent-cloud-kit verify` desde la rama.",
].join("\n");

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
 * Renders the "Configurar el entorno en claude.ai" section.
 *
 * @param config - Repo config.
 * @param packageVersion - Version of the running package, for the setup script.
 * @returns The section, without a trailing newline.
 * @example
 * renderEnvironmentSection(config, "1.0.0").startsWith("## Configurar el entorno en claude.ai"); // true
 */
export function renderEnvironmentSection(config: CloudConfig, packageVersion: string): string {
  const hosts = allowedHosts(config);
  const lines = [
    "## Configurar el entorno en claude.ai",
    "",
    "`claude --cloud` usa el entorno que elijas con `/remote-env` en una terminal (queda en tu configuración de usuario). Configura ese entorno en claude.ai/code:",
    "",
    "### Network access",
    "",
    'Elige **Custom**, marca "Also include default list of common package managers" y agrega estos dominios:',
    "",
    ...(hosts.length ? hosts.map((host) => `- ${host}`) : ["ninguno extra"]),
    "",
    "### Setup script",
    "",
    "```bash",
    setupScript(packageVersion),
    "```",
    "",
    "### Variables de entorno",
    "",
  ];
  if (config.requiredEnv.length) {
    lines.push(...config.requiredEnv.map((name) => `- \`${name}\``));
    lines.push("", "Solo los nombres; los valores los pones tú en el entorno. Ojo: quien use el entorno puede leerlas, y no llegan al setup script (solo a la sesión).");
  } else {
    lines.push("Ninguna.");
  }
  lines.push(
    "",
    "### Claude GitHub App",
    "",
    "El Claude GitHub App debe estar instalado en el repo. Sin él, la sesión no puede pushear.",
  );
  return lines.join("\n");
}

/** The "how to verify" section: what a fresh cloud session checks. */
const VERIFY_SECTION = [
  "## Verificar el entorno",
  "",
  "En una sesión nueva en la nube, revisa esto:",
  "",
  `1. \`${PACKAGE} doctor\` muestra todo en \`ok\` y termina con salida 0.`,
  "2. `node_modules` existe.",
  "3. Las versiones de `.tool-versions` son las que están instaladas.",
  `4. Al empezar la sesión no hay líneas \`${OUTPUT_PREFIX.trim()}\` de falla.`,
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
    "# Nube de Claude Code",
    HOW_IT_WORKS,
    renderEnvironmentSection(input.config, input.packageVersion),
    VERIFY_SECTION,
    `## Qué corre en la nube\n\n${notes?.trim() ? notes.trim() : "Nada anotado."}`,
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
  if (!config) throw new Error(errors[0] ?? `no existe ${CONFIG_FILE}; corre init primero`);
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
