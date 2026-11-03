/**
 * @file The `doctor` command: checks the network allowlist, the pinned tools, Docker and the
 * recorded machine state, and reports one line per check.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readConfig } from "./config.ts";
import { CONFIG_FILE, OUTPUT_PREFIX } from "./constants.ts";
import { TOOLS, readToolVersions } from "./detect.ts";
import { isValidRequest, toolExecutable } from "./installers.ts";
import type { Capture } from "./run.ts";
import { expectedFingerprint } from "./session.ts";
import { SKILL_DIR, skillVersion } from "./skill.ts";
import { readState } from "./state.ts";
import type { MachineState } from "./state.ts";

/** Hosts the setup needs to reach through the cloud proxy. */
export const DOMAINS = ["registry.npmjs.org", "nodejs.org", "registry-1.docker.io", "pypi.org", "api.github.com"];

/** Time limit of each HEAD request, in seconds, as a curl argument. */
const PROBE_TIMEOUT_SECONDS = "5";

/** HTTP status the proxy answers with when a host is not on the allowlist. */
const BLOCKED_STATUS = "403";

/** Status curl prints when it got no HTTP answer at all. */
const NO_ANSWER_STATUS = "000";

/** Milliseconds in a second. */
const MS_PER_SECOND = 1000;

/** Decimals shown in step durations. */
const DURATION_DECIMALS = 1;

/** Everything `doctor` needs from the outside, so tests can inject fakes. */
export interface DoctorContext {
  /** Runs curl and returns its stdout; curl, unlike Node's fetch, honors `HTTPS_PROXY`. */
  capture: Capture;
  /** Tools directory. */
  toolsDir: string;
  /** Version of this package. */
  packageVersion: string;
  /** Tells whether `docker info` succeeds. */
  dockerInfo: () => boolean;
}

/** Result of `doctor`. */
export interface DoctorResult {
  /** One prefixed line per check. */
  lines: string[];
  /** False when any check failed; warnings do not count. */
  ok: boolean;
}

/** One check outcome before formatting. */
interface Check {
  /** Description of what was checked, with its verdict. */
  text: string;
  /** Verdict: a failure makes `doctor` fail, a warning only informs. */
  level: "ok" | "fail" | "warn";
}

/** Repo-relative Claude Code project settings. */
const SETTINGS_FILE = ".claude/settings.json";

/**
 * Maps a pass/fail boolean to a check level.
 *
 * @param passed - Whether the check passed.
 * @returns `"ok"` or `"fail"`.
 * @example
 * verdict(false); // "fail"
 */
function verdict(passed: boolean): "ok" | "fail" {
  return passed ? "ok" : "fail";
}

/**
 * Checks that a host answers through the proxy with a curl HEAD request: a 403 or a curl failure
 * counts as blocked, any other status as reachable.
 *
 * @param host - Host name.
 * @param capture - Runs curl and returns its stdout.
 * @returns The check outcome.
 */
async function checkDomain(host: string, capture: Capture): Promise<Check> {
  const args = ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "-I", "--max-time", PROBE_TIMEOUT_SECONDS, `https://${host}/`];
  try {
    const status = (await capture("curl", args)).trim();
    const ok = status !== BLOCKED_STATUS && status !== NO_ANSWER_STATUS;
    return { text: `red ${host}: ${ok ? "ok" : "bloqueado"}`, level: verdict(ok) };
  } catch {
    return { text: `red ${host}: bloqueado`, level: "fail" };
  }
}

/**
 * Lists the hosts to probe: the fixed ones, then the configured ones that are not repeated.
 *
 * @param repo - Repo root.
 * @returns Host names without duplicates.
 * @example
 * domainsToProbe("/home/user/app"); // ["registry.npmjs.org", ..., "api.example.com"]
 */
function domainsToProbe(repo: string): string[] {
  return [...new Set([...DOMAINS, ...(readConfig(repo).config?.domains ?? [])])];
}

/**
 * Checks that every pinned tool has its executable installed; an invalid version or a node
 * version setup never resolved is a failed check, not an exception.
 *
 * @param repo - Repo root.
 * @param toolsDir - Tools directory.
 * @param state - Recorded state, for the versions setup resolved.
 * @returns One check per pinned tool.
 */
function checkTools(repo: string, toolsDir: string, state: MachineState | undefined): Check[] {
  const versions = readToolVersions(repo);
  return TOOLS.flatMap((tool): Check[] => {
    const version = versions[tool];
    if (!version) return [];
    if (!isValidRequest(tool, version)) return [{ text: `herramienta ${tool} ${version}: versión inválida`, level: "fail" }];
    const executable = toolExecutable(tool, version, toolsDir, state?.resolved ?? {});
    if (!executable) return [{ text: `herramienta ${tool} ${version}: sin resolver (setup no la instaló)`, level: "fail" }];
    const present = existsSync(executable);
    return [{ text: `herramienta ${tool} ${version}: ${present ? "ok" : "falta"}`, level: verdict(present) }];
  });
}

/**
 * Checks the repo config, the recorded state, its fingerprint and the step durations.
 *
 * @param repo - Repo root.
 * @param ctx - Dependencies.
 * @returns The checks, in order.
 */
function checkState(repo: string, ctx: DoctorContext): Check[] {
  if (!existsSync(join(repo, CONFIG_FILE))) return [{ text: `${CONFIG_FILE}: falta`, level: "fail" }];
  const { config, errors } = readConfig(repo);
  const out: Check[] = errors.map((text) => ({ text: `${CONFIG_FILE}: ${text}`, level: "fail" }));
  if (!config) return out;
  const state = readState(ctx.toolsDir, repo);
  if (!state) return [...out, { text: "estado: falta (setup no corrió)", level: "fail" }];
  const same = expectedFingerprint(repo, config, state) === state.fingerprint;
  out.push({ text: `huella: ${same ? "ok" : "distinta"}`, level: verdict(same) });
  for (const s of state.steps) {
    const seconds = (s.ms / MS_PER_SECOND).toFixed(DURATION_DECIMALS);
    out.push({ text: `paso ${s.name}: ${s.ok ? "ok" : "falló"} (${seconds}s)`, level: verdict(s.ok) });
  }
  return out;
}

/**
 * Warns about each plugin enabled in the project settings: plugins do not reach cloud sessions.
 * Missing or malformed settings give no warnings.
 *
 * @param repo - Repo root.
 * @returns One warning per enabled plugin.
 * @example
 * checkPlugins("/home/user/app"); // [{ text: "aviso: el plugin x@m está activado pero ...", level: "warn" }]
 */
function checkPlugins(repo: string): Check[] {
  try {
    const settings: unknown = JSON.parse(readFileSync(join(repo, SETTINGS_FILE), "utf8"));
    const plugins = (settings as { enabledPlugins?: unknown } | null)?.enabledPlugins;
    if (typeof plugins !== "object" || plugins === null) return [];
    return Object.entries(plugins)
      .filter(([, enabled]) => enabled === true)
      .map(([name]) => ({
        text: `aviso: el plugin ${name} está activado pero no está en el repo; no llegará a la nube (copia sus skills con skills-manager)`,
        level: "warn",
      }));
  } catch {
    return [];
  }
}

/**
 * Warns when the installed `cloud-ready` skill is of another version than the package.
 *
 * @param repo - Repo root.
 * @param packageVersion - Version of this package.
 * @returns A warning, or nothing when there is no skill or the versions match.
 * @example
 * checkSkill("/home/user/app", "1.0.0"); // [{ text: "aviso: .agents/skills/cloud-ready está en 0.9.0, ...", level: "warn" }]
 */
function checkSkill(repo: string, packageVersion: string): Check[] {
  const installed = skillVersion(repo);
  if (installed === undefined || installed === packageVersion) return [];
  return [
    {
      text: `aviso: ${SKILL_DIR} está en ${installed} y el paquete en ${packageVersion}; corre npx agent-cloud-kit@${packageVersion} init`,
      level: "warn",
    },
  ];
}

/**
 * Runs one group of checks, turning anything it throws into a failed check.
 *
 * @param name - Group name, for the failed line.
 * @param fn - Produces the checks.
 * @returns The checks, or one failed check with the error.
 */
async function guarded(name: string, fn: () => Check[] | Promise<Check[]>): Promise<Check[]> {
  try {
    return await fn();
  } catch (err) {
    return [{ text: `${name}: error: ${err instanceof Error ? err.message : String(err)}`, level: "fail" }];
  }
}

/**
 * Runs every diagnostic for a repo; never throws.
 *
 * @param repo - Repo root.
 * @param ctx - Dependencies (curl capture, tools dir, package version, Docker probe).
 * @returns The report lines and whether everything passed.
 * @example
 * const { lines, ok } = await doctor("/home/user/app", { capture: captureProcess, toolsDir, packageVersion: "1.0.0", dockerInfo });
 */
export async function doctor(repo: string, ctx: DoctorContext): Promise<DoctorResult> {
  const checks: Check[] = [];
  checks.push(...(await guarded("red", async () => Promise.all(domainsToProbe(repo).map((host) => checkDomain(host, ctx.capture))))));
  checks.push(...(await guarded("herramientas", () => checkTools(repo, ctx.toolsDir, readState(ctx.toolsDir, repo)))));
  checks.push(
    ...(await guarded("docker", () => {
      const docker = ctx.dockerInfo();
      return [{ text: `docker: ${docker ? "ok" : "falta"}`, level: verdict(docker) }];
    })),
  );
  checks.push(...(await guarded("estado", () => checkState(repo, ctx))));
  checks.push(...(await guarded("plugins", () => checkPlugins(repo))));
  checks.push(...(await guarded("skill", () => checkSkill(repo, ctx.packageVersion))));
  return { lines: checks.map((c) => OUTPUT_PREFIX + c.text), ok: checks.every((c) => c.level !== "fail") };
}
