/**
 * @file The `manual` command: generates `docs/agent-cloud.md` (in Spanish) from the repo's cloud config
 * and last test record, keeping everything a person or agent wrote outside the generated block.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readConfig } from "./config.ts";
import type { CloudConfig } from "./config.ts";
import { CONFIG_FILE, PACKAGE } from "./constants.ts";
import { readTestRecord } from "./tests.ts";
import type { TestRecord } from "./tests.ts";

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

/** Length of the short commit hash shown in the manual. */
const SHORT_COMMIT_LENGTH = 7;

/** Setup script the environment must run, in a `bash` block. */
const SETUP_SCRIPT = `#!/bin/bash\nnpx -y ${PACKAGE}@1 setup`;

/** The "how it works" section, five lines. */
const HOW_IT_WORKS = [
  "## Cómo funciona",
  "",
  "1. agent-kitchen instala las herramientas y los ganchos en el repo.",
  `2. \`${PACKAGE} prepare\` configura el repo y prepara la lista de dominios y variables.`,
  "3. Tú configuras el entorno por defecto en claude.ai con lo que indica la siguiente sección.",
  "4. La nube verifica: corre `setup` al iniciar y después los tests.",
  "5. El PR guarda el resultado en `.claude/cloud-tests.json`.",
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
 * @returns The section, without a trailing newline.
 * @example
 * renderEnvironmentSection(config).startsWith("## Configurar el entorno en claude.ai"); // true
 */
export function renderEnvironmentSection(config: CloudConfig): string {
  const hosts = allowedHosts(config);
  const lines = [
    "## Configurar el entorno en claude.ai",
    "",
    "`claude --cloud` usa el entorno de nube por defecto de tu cuenta. Configura ese entorno (sus ajustes en claude.ai/code):",
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
    SETUP_SCRIPT,
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
  return lines.join("\n");
}

/**
 * Renders the "Correr los tests" section.
 *
 * @param config - Repo config.
 * @returns The section.
 */
function renderTestsSection(config: CloudConfig): string {
  const lines = ["## Correr los tests", "", "```bash", `${PACKAGE} test --level full`, "```", ""];
  if (config.tests.minimum) lines.push(`- minimum: \`${config.tests.minimum}\``);
  if (config.tests.full) lines.push(`- full: \`${config.tests.full}\``);
  if (!config.tests.minimum && !config.tests.full) lines.push("Todavía no hay tests en `.claude/cloud.json`.");
  return lines.join("\n");
}

/**
 * Renders the "Último resultado" section.
 *
 * @param record - Last test record, if any.
 * @returns The section.
 */
function renderRecordSection(record: TestRecord | undefined): string {
  const lines = ["## Último resultado", ""];
  if (!record) return [...lines, "Sin registro: todavía no se corrió."].join("\n");
  const where = record.remote ? "nube" : "local";
  lines.push(`Nivel alcanzado: ${record.level}`, `${record.finishedAt} (${where}), commit ${record.commit.slice(0, SHORT_COMMIT_LENGTH)}`, "");
  for (const r of record.results) lines.push(`- ${r.ok ? "✓" : "✗"} \`${r.command}\``);
  return lines.join("\n");
}

/**
 * Renders the generated block of the manual, markers included.
 *
 * @param input - Config, last record, package version and optional notes (default: `config.notes`).
 * @returns The block.
 * @example
 * renderManual({ config, packageVersion: "1.0.0" }).startsWith(BEGIN); // true
 */
export function renderManual(input: { config: CloudConfig; record?: TestRecord; packageVersion: string; notes?: string }): string {
  const notes = input.notes ?? input.config.notes;
  const parts = [
    BEGIN,
    `<!-- Generado por ${PACKAGE} ${input.packageVersion}. No edites entre las marcas. -->`,
    "# Nube de Claude Code",
    HOW_IT_WORKS,
    renderEnvironmentSection(input.config),
    renderTestsSection(input.config),
    renderRecordSection(input.record),
    `## Qué no corre en la nube\n\n${notes?.trim() ? notes.trim() : "Nada anotado."}`,
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
  if (!config) throw new Error(errors[0] ?? `${CONFIG_FILE} not found; run init first`);
  const file = join(repo, MANUAL_FILE);
  const existing = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  const block = renderManual({ config, record: readTestRecord(repo), packageVersion });
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
