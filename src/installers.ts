/**
 * @file Tool installers whose download sources pass the Claude cloud egress proxy
 * (nodejs.org, npm and PyPI; GitHub releases are blocked).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_INSTALL_TIMEOUT_MS } from "./constants.ts";
import { TOOLS } from "./detect.ts";
import type { Tool } from "./detect.ts";
import type { Run } from "./run.ts";
import { t } from "./messages/index.ts";
import { step } from "./steps.ts";
import type { StepResult } from "./steps.ts";

/** Pinned versions by tool. */
export type Versions = Partial<Record<Tool, string>>;

/** Base URL of the Node.js distribution. */
const NODE_DIST_URL = "https://nodejs.org/dist";

/** Node.js archive architectures by `process.arch`. */
const NODE_ARCHS: Readonly<Record<string, string>> = { x64: "x64", arm64: "arm64" };

/** Executable name checked for each tool to decide whether it is installed. */
const EXECUTABLES: Readonly<Record<Tool, string>> = {
  node: "node",
  bun: "bun",
  deno: "deno",
  pnpm: "pnpm",
  yarn: "yarn",
  uv: "uv",
};

/** npm package name for yarn 2 and later. */
const YARN_BERRY_PACKAGE = "@yarnpkg/cli-dist";

/** npm package that provides each npm-installed tool (yarn is resolved by version). */
const NPM_PACKAGES: Readonly<Record<"bun" | "deno" | "pnpm", string>> = {
  bun: "bun",
  deno: "deno",
  pnpm: "pnpm",
};

/** Strict shape of an accepted version: no leading `-` or `/`, no shell metacharacters. */
const VERSION_PATTERN = /^\d+(\.\d+){0,2}([-+][0-9A-Za-z.]+)?$/;

/** An exact Node.js version (`x.y.z`, optionally with a suffix): installed as is, no lookup. */
const NODE_EXACT = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.]+)?$/;

/** Node.js aliases resolved through the release index: `lts/<name>`, `lts/*` and `node`. */
const NODE_ALIAS = /^(lts\/(\*|[A-Za-z]+)|node)$/;

/** Alias for the newest Node.js release. */
const NODE_LATEST = "node";

/** Alias for the newest Node.js LTS release. */
const NODE_LTS_ANY = "lts/*";

/** Prefix of a named Node.js LTS alias. */
const NODE_LTS_PREFIX = "lts/";

/** Index of every Node.js release, newest first. */
const NODE_INDEX_URL = `${NODE_DIST_URL}/index.json`;

/** Time limit of the index download, in seconds. */
const NODE_INDEX_TIMEOUT_SECONDS = "60";

/** File name of the downloaded index inside its temp directory. */
const NODE_INDEX_FILE = "index.json";

/** File name of the downloaded checksum list inside its temp directory. */
const NODE_SHASUMS_FILE = "SHASUMS256.txt";

/** File name of the downloaded tarball inside its temp directory. */
const NODE_TARBALL_FILE = "node.tar.xz";

/** Prefix of the temp download directories of the node installer. */
const NODE_DOWNLOAD_PREFIX = "agent-cloud-kit-node-";

/** Suffix of a temp install directory (after the pid), renamed to the final one on success. */
const TEMP_SUFFIX = "tmp";

/** A line of SHASUMS256.txt: a 64-digit hex hash, two spaces (or ` *`) and the file name. */
const SHASUMS_LINE = /^([0-9a-f]{64}) [ *](.+)$/;

/**
 * Script that downloads (`$1`) into a file (`$3`), checks it against the expected sha256 (`$4`)
 * and extracts it into a directory (`$2`); fails if curl, the checksum or tar fails.
 */
const NODE_INSTALL_SCRIPT =
  'set -eo pipefail; curl -fsSL -o "$3" -- "$1"; echo "$4  $3" | sha256sum -c -; tar -xJ -f "$3" -C "$2" --strip-components=1';

/** Placeholder for `$0` in the node install script. */
const SCRIPT_NAME = "_";

/** Describes how one tool is installed and where its executables end up. */
export interface Installer {
  /**
   * Directory the tool version is installed into.
   *
   * @param toolsDir - Root directory holding all tools.
   * @param version - Tool version.
   * @returns The install directory.
   */
  dir(toolsDir: string, version: string): string;
  /**
   * Directory holding the tool's executables.
   *
   * @param toolsDir - Root directory holding all tools.
   * @param version - Tool version.
   * @returns The bin directory.
   */
  binDir(toolsDir: string, version: string): string;
  /**
   * Installs the tool version.
   *
   * @param toolsDir - Root directory holding all tools.
   * @param version - Tool version.
   * @param run - Process runner.
   * @param env - Environment for child processes.
   * @returns Resolves when installed.
   * @throws When the installation fails.
   */
  install(toolsDir: string, version: string, run: Run, env: NodeJS.ProcessEnv): Promise<void>;
}

/**
 * Finds the sha256 of a file in the text of a SHASUMS256.txt.
 *
 * @param text - Content of SHASUMS256.txt.
 * @param file - File name, such as `node-v24.14.1-linux-x64.tar.xz`.
 * @returns The lowercase hex hash, or undefined when the file is not listed.
 * @example
 * parseShasums(`${"a".repeat(64)}  node-v24.14.1-linux-x64.tar.xz`, "node-v24.14.1-linux-x64.tar.xz"); // "aaaa..."
 */
export function parseShasums(text: string, file: string): string | undefined {
  for (const line of text.split("\n")) {
    const match = SHASUMS_LINE.exec(line.trimEnd());
    if (match && match[2] === file) return match[1];
  }
  return undefined;
}

/**
 * Installs into `<target>.<pid>.tmp` and renames it to `target` only when `work` succeeds, so a
 * half-extracted install never leaves `target` behind (an existing `target` would be skipped).
 *
 * @param target - Final install directory.
 * @param work - Installs into the temp directory it receives.
 * @returns Resolves when `target` is in place.
 * @throws What `work` throws, after removing the temp directory.
 * @example
 * await installAtomically("/opt/agent-cloud-kit/uv-0.5.0", async (temp) => { await install(temp); });
 */
export async function installAtomically(target: string, work: (temp: string) => Promise<void>): Promise<void> {
  const temp = `${target}.${process.pid}.${TEMP_SUFFIX}`;
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(temp, { recursive: true });
  try {
    await work(temp);
    rmSync(target, { recursive: true, force: true });
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Downloads the checksum list of a Node.js release with curl and finds the hash of one archive.
 *
 * @param run - Process runner.
 * @param env - Environment for curl.
 * @param dir - Directory for the downloaded list.
 * @param version - Exact Node.js version.
 * @param file - Archive name to look up.
 * @returns The expected sha256.
 * @throws When the list does not name the archive.
 */
async function nodeExpectedHash(run: Run, env: NodeJS.ProcessEnv, dir: string, version: string, file: string): Promise<string> {
  const path = join(dir, NODE_SHASUMS_FILE);
  const url = `${NODE_DIST_URL}/v${version}/${NODE_SHASUMS_FILE}`;
  await run("curl", ["-fsSL", "-o", path, "--", url], { env, timeoutMs: TOOL_INSTALL_TIMEOUT_MS });
  const hash = parseShasums(readFileSync(path, "utf8"), file);
  if (!hash) throw new Error(t().installers.notInShasums(file, NODE_SHASUMS_FILE));
  return hash;
}

/**
 * Maps a Node.js `process.arch` to the name used in its release archives.
 *
 * @param arch - Value of `process.arch`.
 * @returns The archive architecture.
 * @throws When the architecture has no Linux build we support.
 * @example
 * nodeArch("x64"); // "x64"
 */
export function nodeArch(arch: string): string {
  const mapped = NODE_ARCHS[arch];
  if (!mapped) throw new Error(t().installers.unsupportedArch(arch));
  return mapped;
}

/**
 * Checks that a version is safe to use in paths and command arguments.
 *
 * @param tool - Tool name, for the error message.
 * @param version - Version taken from an untrusted file.
 * @returns Nothing when valid.
 * @throws When the version does not match the strict pattern.
 * @example
 * assertVersion("node", "24.14.1"); // ok
 */
export function assertVersion(tool: string, version: string): void {
  if (!VERSION_PATTERN.test(version)) throw new Error(t().installers.invalidVersion(tool, version));
}

/**
 * Tells whether a version is safe to use.
 *
 * @param version - Version taken from an untrusted file.
 * @returns True when it matches the strict pattern.
 */
function isValidVersion(version: string): boolean {
  return VERSION_PATTERN.test(version);
}

/**
 * Tells whether a requested version is accepted for a tool: the strict pattern, plus the
 * `lts/<name>`, `lts/*` and `node` aliases for node only. Aliases never become path segments.
 *
 * @param tool - Tool name.
 * @param version - Version taken from an untrusted file.
 * @returns True when it can be installed (possibly after resolving it).
 * @example
 * isValidRequest("node", "lts/iron"); // true
 */
export function isValidRequest(tool: Tool, version: string): boolean {
  return isValidVersion(version) || (tool === "node" && NODE_ALIAS.test(version));
}

/** One entry of the Node.js release index. */
export interface NodeRelease {
  /** Version with a leading `v`, such as `v22.12.0`. */
  version: string;
  /** LTS codename, or false for a non-LTS release. */
  lts: string | false;
}

/** Downloads the Node.js release index. */
export type NodeIndexFetcher = () => Promise<NodeRelease[]>;

/**
 * Compares two exact `x.y.z` versions numerically.
 *
 * @param a - First version.
 * @param b - Second version.
 * @returns A positive number when `a` is newer, negative when older, 0 when equal.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).slice(0, 3).map(Number);
  const pb = b.split(/[.+-]/).slice(0, 3).map(Number);
  for (let i = 0; i < pa.length; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * Tells whether an exact version satisfies a requested node version.
 *
 * @param requested - Version as written in the repo (`22`, `22.1`, `lts/iron`, `node`...).
 * @param exact - Exact version without `v`.
 * @param lts - LTS codename of the exact version, when known; `undefined` skips the alias check.
 * @returns True when it matches the numeric prefix, or the alias.
 * @example
 * nodeMatches("22.1", "22.1.5"); // true
 */
export function nodeMatches(requested: string, exact: string, lts?: string | false): boolean {
  if (NODE_ALIAS.test(requested)) {
    if (lts === undefined || requested === NODE_LATEST) return true;
    if (requested === NODE_LTS_ANY) return lts !== false;
    return lts !== false && lts.toLowerCase() === requested.slice(NODE_LTS_PREFIX.length).toLowerCase();
  }
  const want = requested.split(".");
  const have = exact.split(".");
  return want.every((part, i) => part === have[i]);
}

/**
 * Picks the newest release of the index that satisfies a requested node version.
 *
 * @param requested - Non-exact version (`22`, `22.1`, `lts/iron`, `lts/*` or `node`).
 * @param index - Release index.
 * @returns The exact version without `v`, or undefined when nothing matches.
 * @example
 * resolveNodeVersion("lts/iron", [{ version: "v20.18.1", lts: "Iron" }]); // "20.18.1"
 */
export function resolveNodeVersion(requested: string, index: NodeRelease[]): string | undefined {
  let best: string | undefined;
  for (const release of index) {
    const exact = release.version.replace(/^v/, "");
    if (!NODE_EXACT.test(exact) || !nodeMatches(requested, exact, release.lts)) continue;
    if (!best || compareVersions(exact, best) > 0) best = exact;
  }
  return best;
}

/**
 * Builds a fetcher that downloads the Node.js release index with curl into a temp file. The URL
 * and the file travel as argv, and curl honors the proxy environment.
 *
 * @param run - Process runner.
 * @param env - Environment for curl.
 * @returns The fetcher.
 * @example
 * const index = await curlNodeIndex(runProcess, process.env)();
 */
export function curlNodeIndex(run: Run, env: NodeJS.ProcessEnv): NodeIndexFetcher {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-cloud-kit-node-index-"));
    try {
      const file = join(dir, NODE_INDEX_FILE);
      await run("curl", ["-fsSL", "--max-time", NODE_INDEX_TIMEOUT_SECONDS, "-o", file, "--", NODE_INDEX_URL], { env });
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!Array.isArray(parsed)) throw new Error(t().installers.indexNotList);
      return parsed.filter(
        (r): r is NodeRelease =>
          typeof r === "object" && r !== null && typeof r.version === "string" && (r.lts === false || typeof r.lts === "string"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

/**
 * Turns the requested versions into installable ones: a non-exact node version is resolved to an
 * exact one through the release index; every other tool is kept as requested.
 *
 * @param versions - Requested versions by tool.
 * @param fetchIndex - Downloads the release index; called only when node needs resolving.
 * @returns The installable versions (node left out when it cannot be resolved) and one failed
 *   result when the resolution failed.
 * @example
 * await resolveVersions({ node: "22" }, curlNodeIndex(runProcess, process.env)); // { resolved: { node: "22.12.0" }, results: [] }
 */
export async function resolveVersions(
  versions: Versions,
  fetchIndex: NodeIndexFetcher,
): Promise<{ resolved: Versions; results: StepResult[] }> {
  const resolved: Versions = { ...versions };
  const requested = versions.node;
  if (!requested || NODE_EXACT.test(requested) || !isValidRequest("node", requested)) return { resolved, results: [] };
  delete resolved.node;
  let exact: string | undefined;
  const result = await step(`node ${requested}`, async () => {
    exact = resolveNodeVersion(requested, await fetchIndex());
    if (!exact) throw new Error(t().installers.noNodeMatch(requested));
  });
  if (!exact) return { resolved, results: [result] };
  resolved.node = exact;
  return { resolved, results: [] };
}

/**
 * Finds the version whose directory holds a tool: the requested one, or for a non-exact node
 * version the exact one setup resolved it to.
 *
 * @param tool - Tool name.
 * @param requested - Version as written in the repo.
 * @param resolved - Versions setup installed (from the machine state).
 * @returns The version used in the install path, or undefined when there is none.
 */
function installedVersion(tool: Tool, requested: string, resolved: Versions): string | undefined {
  if (tool !== "node") return isValidVersion(requested) ? requested : undefined;
  if (NODE_EXACT.test(requested)) return requested;
  const exact = resolved.node;
  if (!exact || !NODE_EXACT.test(exact) || !isValidRequest("node", requested)) return undefined;
  return nodeMatches(requested, exact) ? exact : undefined;
}

/**
 * Builds the default directory layout for a tool.
 *
 * @param tool - Tool name.
 * @param binSubdir - Path of the bin directory inside the install directory.
 * @returns The `dir` and `binDir` functions.
 */
function layout(tool: Tool, binSubdir: string): Pick<Installer, "dir" | "binDir"> {
  const dir = (toolsDir: string, version: string): string => {
    assertVersion(tool, version);
    return join(toolsDir, `${tool}-${version}`);
  };
  return { dir, binDir: (toolsDir, version) => join(dir(toolsDir, version), binSubdir) };
}

/**
 * Creates an installer that runs `npm install` into the tool's own prefix.
 *
 * @param tool - Tool name.
 * @param packageFor - Resolves the npm package name for a version.
 * @returns The installer.
 */
function npmInstaller(tool: Tool, packageFor: (version: string) => string): Installer {
  const base = layout(tool, join("node_modules", ".bin"));
  return {
    ...base,
    install: (toolsDir, version, run, env) =>
      installAtomically(base.dir(toolsDir, version), (temp) =>
        run(
          "npm",
          ["install", "--prefix", temp, "--no-save", "--no-audit", "--no-fund", `${packageFor(version)}@${version}`],
          { env, timeoutMs: TOOL_INSTALL_TIMEOUT_MS },
        ),
      ),
  };
}

const nodeLayout = layout("node", "bin");
const uvLayout = layout("uv", "bin");

/** Installers by tool. */
export const INSTALLERS: Record<Tool, Installer> = {
  node: {
    ...nodeLayout,
    install: (toolsDir, version, run, env) =>
      installAtomically(nodeLayout.dir(toolsDir, version), async (temp) => {
        const file = `node-v${version}-linux-${nodeArch(process.arch)}.tar.xz`;
        const downloads = mkdtempSync(join(tmpdir(), NODE_DOWNLOAD_PREFIX));
        try {
          const hash = await nodeExpectedHash(run, env, downloads, version, file);
          const url = `${NODE_DIST_URL}/v${version}/${file}`;
          await run("bash", ["-c", NODE_INSTALL_SCRIPT, SCRIPT_NAME, url, temp, join(downloads, NODE_TARBALL_FILE), hash], {
            env,
            timeoutMs: TOOL_INSTALL_TIMEOUT_MS,
          });
        } finally {
          rmSync(downloads, { recursive: true, force: true });
        }
      }),
  },
  bun: npmInstaller("bun", () => NPM_PACKAGES.bun),
  deno: npmInstaller("deno", () => NPM_PACKAGES.deno),
  pnpm: npmInstaller("pnpm", () => NPM_PACKAGES.pnpm),
  yarn: npmInstaller("yarn", (version) => (version.split(".")[0] === "1" ? "yarn" : YARN_BERRY_PACKAGE)),
  uv: {
    ...uvLayout,
    install: (toolsDir, version, run, env) =>
      installAtomically(uvLayout.dir(toolsDir, version), (temp) =>
        run("python3", ["-m", "pip", "install", "--target", temp, `uv==${version}`], { env, timeoutMs: TOOL_INSTALL_TIMEOUT_MS }),
      ),
  },
};

/**
 * Prepends a directory to a PATH value.
 *
 * @param dir - Directory to put first.
 * @param path - Existing PATH, if any.
 * @returns The new PATH.
 */
function prependPath(dir: string, path: string | undefined): string {
  return path ? `${dir}:${path}` : dir;
}

/**
 * Installs the pinned tools: node first, then the rest in series. A non-exact node version must
 * be resolved first (`resolveVersions`).
 *
 * @param versions - Installable versions by tool.
 * @param toolsDir - Root directory holding all tools.
 * @param run - Process runner.
 * @param env - Environment for child processes.
 * @returns One result per tool that needed installing; tools already present are skipped.
 * @example
 * await installTools({ node: "24.14.1" }, "/opt/agent-cloud-kit", runProcess, process.env);
 */
export async function installTools(
  versions: Versions,
  toolsDir: string,
  run: Run,
  env: NodeJS.ProcessEnv,
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  let childEnv = env;
  for (const tool of TOOLS) {
    const version = versions[tool];
    if (!version) continue;
    if (!isValidVersion(version)) {
      results.push(await step(`${tool} ${version}`, async () => assertVersion(tool, version)));
      continue;
    }
    if (tool === "node" && !NODE_EXACT.test(version)) {
      results.push(await step(`${tool} ${version}`, async () => {
        throw new Error(t().installers.nodeMustResolve(version));
      }));
      continue;
    }
    const installer = INSTALLERS[tool];
    const binDir = installer.binDir(toolsDir, version);
    if (!existsSync(join(binDir, EXECUTABLES[tool]))) {
      results.push(await step(`${tool} ${version}`, () => installer.install(toolsDir, version, run, childEnv)));
    }
    if (tool === "node") childEnv = { ...env, PATH: prependPath(binDir, env.PATH) };
  }
  return results;
}

/**
 * Lists the bin directories of the pinned tools, in `TOOLS` order. A non-exact node version maps
 * to the exact version setup resolved it to; invalid or unresolved versions are skipped.
 *
 * @param versions - Requested versions by tool.
 * @param toolsDir - Root directory holding all tools.
 * @param resolved - Versions setup installed (`MachineState.resolved`); empty when unknown.
 * @returns The bin directories to put on PATH.
 * @example
 * toolBinDirs({ node: "22" }, "/opt/agent-cloud-kit", { node: "22.12.0" }); // ["/opt/agent-cloud-kit/node-22.12.0/bin"]
 */
export function toolBinDirs(versions: Versions, toolsDir: string, resolved: Versions = {}): string[] {
  return TOOLS.flatMap((tool) => {
    const requested = versions[tool];
    const version = requested ? installedVersion(tool, requested, resolved) : undefined;
    return version ? [INSTALLERS[tool].binDir(toolsDir, version)] : [];
  });
}

/**
 * Finds the bin directory that holds a pinned tool's executable.
 *
 * @param tool - Tool name.
 * @param requested - Version as written in the repo.
 * @param toolsDir - Root directory holding all tools.
 * @param resolved - Versions setup installed (`MachineState.resolved`).
 * @returns The executable path, or undefined when the version is invalid or not resolved.
 * @example
 * toolExecutable("node", "24.14.1", "/opt/agent-cloud-kit", {}); // "/opt/agent-cloud-kit/node-24.14.1/bin/node"
 */
export function toolExecutable(tool: Tool, requested: string, toolsDir: string, resolved: Versions): string | undefined {
  const version = installedVersion(tool, requested, resolved);
  return version ? join(INSTALLERS[tool].binDir(toolsDir, version), EXECUTABLES[tool]) : undefined;
}

/**
 * Builds the shell line that puts directories first on PATH.
 *
 * @param dirs - Directories, in order.
 * @returns An `export PATH=...` line with a literal `$PATH`, or an empty string when there are none.
 * @example
 * pathLine(["/opt/agent-cloud-kit/node-24.14.1/bin"]); // export PATH="/opt/agent-cloud-kit/node-24.14.1/bin:$PATH"
 */
export function pathLine(dirs: string[]): string {
  return dirs.length ? `export PATH="${dirs.join(":")}:$PATH"` : "";
}
