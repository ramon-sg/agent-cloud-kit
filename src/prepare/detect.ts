/**
 * @file Pure parts of `prepare`: preflight checks.
 */
/** Flag `claude` must advertise in its help to launch cloud sessions. */
const CLOUD_FLAG = "--cloud";

/** What `prepare` knows about the environment before starting. */
export interface Probe {
  /** Whether stdin and stdout are interactive terminals. */
  isTty: boolean;
  /** Root of the git repo, if the current directory is inside one. */
  gitRoot?: string;
  /** Whether the repo has an `origin` remote. */
  hasOrigin: boolean;
  /** Output of `claude --help`; undefined when `claude` could not be run. */
  claudeHelp?: string;
}

/**
 * Checks that `prepare` can run.
 *
 * @param probe What was observed about the environment.
 * @returns Problems in Spanish, in a fixed order; empty when everything is fine.
 * @example
 * preflight({ isTty: false, hasOrigin: true }); // ["prepare necesita una terminal interactiva", ...]
 */
export function preflight(probe: Probe): string[] {
  const problems: string[] = [];
  if (!probe.isTty) problems.push("prepare necesita una terminal interactiva (corre el comando directamente en tu terminal)");
  if (probe.gitRoot === undefined) problems.push("esto no es un repositorio git; corre prepare dentro del repo que quieres preparar");
  if (!probe.hasOrigin) problems.push("el repositorio no tiene el remoto 'origin'; prepare necesita subir una rama y abrir un PR en GitHub");
  if (probe.claudeHelp === undefined) problems.push("claude no está instalado o no está en el PATH; instala Claude Code y vuelve a correr prepare");
  else if (!probe.claudeHelp.includes(CLOUD_FLAG)) problems.push("tu versión de claude no soporta --cloud; actualiza Claude Code y vuelve a correr prepare");
  return problems;
}
