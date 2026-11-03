/**
 * @file Tests for the proxy-safe tool installers, using a recording `Run`.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  INSTALLERS,
  curlNodeIndex,
  installTools,
  isValidRequest,
  nodeArch,
  parseShasums,
  pathLine,
  resolveNodeVersion,
  resolveVersions,
  toolBinDirs,
} from "../src/installers.ts";
import type { NodeRelease } from "../src/installers.ts";
import { TOOL_INSTALL_TIMEOUT_MS } from "../src/constants.ts";

/** One recorded process call. */
interface Call {
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/**
 * Builds a `Run` that records calls instead of spawning.
 *
 * @returns The recorder and its calls.
 */
function recorder(): { calls: Call[]; run: (cmd: string, args: string[], opts?: { env?: NodeJS.ProcessEnv; timeoutMs?: number }) => Promise<void> } {
  const calls: Call[] = [];
  return {
    calls,
    run: async (cmd, args, opts) => {
      calls.push({ cmd, args, env: opts?.env, timeoutMs: opts?.timeoutMs });
      if (cmd === "curl") {
        const version = /\/v([^/]+)\/SHASUMS256/.exec(args.at(-1) ?? "")?.[1] ?? "24.14.1";
        writeFileSync(args[args.indexOf("-o") + 1] as string, shasumsFor(`node-v${version}-linux-${ARCH}.tar.xz`));
      }
    },
  };
}

/** Hash used for the fake node tarball. */
const HASH = "ab".repeat(32);

/**
 * Builds a SHASUMS256.txt that lists the linux tarball of this machine.
 *
 * @param file - Archive name to list.
 * @returns The file content.
 */
function shasums(file = `node-v24.14.1-linux-${ARCH}.tar.xz`): string {
  return shasumsFor(file);
}

/**
 * Builds the SHASUMS256.txt text for any archive name.
 *
 * @param file - Archive name to list.
 * @returns The file content.
 */
function shasumsFor(file: string): string {
  return `${"cd".repeat(32)}  node-v24.14.1-darwin-x64.tar.gz\n${HASH}  ${file}\n`;
}

/**
 * Creates an empty temp tools directory.
 *
 * @returns Its path.
 */
function toolsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "installers-"));
  created.push(dir);
  return dir;
}

/** Archive architecture of this machine. */
const ARCH = process.arch === "arm64" ? "arm64" : "x64";

/** Temp directories to remove when the tests finish. */
const created: string[] = [];

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** The node install script, as the installer passes it to bash. */
const NODE_SCRIPT =
  'set -eo pipefail; curl -fsSL -o "$3" -- "$1"; echo "$4  $3" | sha256sum -c -; tar -xJ -f "$3" -C "$2" --strip-components=1';

test("node installs from nodejs.org through bash", async () => {
  const dir = toolsDir();
  const { calls, run } = recorder();
  const results = await installTools({ node: "24.14.1" }, dir, run, { PATH: "/usr/bin" });
  const target = join(dir, "node-24.14.1");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.name, "node 24.14.1");
  assert.equal(results[0]?.ok, true);
  const [curl, install] = calls;
  assert.equal(curl?.cmd, "curl");
  assert.equal(curl?.args.at(-1), "https://nodejs.org/dist/v24.14.1/SHASUMS256.txt");
  assert.equal(install?.cmd, "bash");
  assert.equal(install?.args[1], NODE_SCRIPT);
  assert.equal(install?.args[2], "_");
  assert.equal(install?.args[3], `https://nodejs.org/dist/v24.14.1/node-v24.14.1-linux-${ARCH}.tar.xz`);
  assert.equal(install?.args[4], `${target}.${process.pid}.tmp`);
  assert.equal(install?.args[6], HASH);
  assert.equal(existsSync(install?.args[5] as string), false);
});

test("nodeArch maps x64 and arm64 and rejects the rest", () => {
  assert.equal(nodeArch("x64"), "x64");
  assert.equal(nodeArch("arm64"), "arm64");
  assert.throws(() => nodeArch("ia32"), /arquitectura no soportada/);
});

test("bun uses the pinned node npm at the front of PATH", async () => {
  const dir = toolsDir();
  const { calls, run } = recorder();
  const results = await installTools({ node: "24.14.1", bun: "1.4.2" }, dir, run, { PATH: "/usr/bin" });
  assert.deepEqual(results.map((r) => r.name), ["node 24.14.1", "bun 1.4.2"]);
  const bun = calls[2];
  const prefix = `${join(dir, "bun-1.4.2")}.${process.pid}.tmp`;
  assert.equal(bun?.cmd, "npm");
  assert.deepEqual(bun?.args, ["install", "--prefix", prefix, "--no-save", "--no-audit", "--no-fund", "bun@1.4.2"]);
  assert.equal(bun?.env?.PATH, `${join(dir, "node-24.14.1", "bin")}:/usr/bin`);
});

test("bun without pinned node uses the npm already on PATH", async () => {
  const dir = toolsDir();
  const { calls, run } = recorder();
  await installTools({ bun: "1.4.2" }, dir, run, { PATH: "/usr/bin" });
  assert.equal(calls[0]?.env?.PATH, "/usr/bin");
});

test("an installed tool is skipped and produces no result", async () => {
  const dir = toolsDir();
  const bin = INSTALLERS.bun.binDir(dir, "1.4.2");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "bun"), "");
  const { calls, run } = recorder();
  const results = await installTools({ bun: "1.4.2" }, dir, run, { PATH: "/usr/bin" });
  assert.deepEqual(calls, []);
  assert.deepEqual(results, []);
});

test("yarn 4 installs @yarnpkg/cli-dist and yarn 1 installs yarn", async () => {
  const dir = toolsDir();
  const four = recorder();
  await installTools({ yarn: "4.1.0" }, dir, four.run, { PATH: "/usr/bin" });
  assert.equal(four.calls[0]?.args.at(-1), "@yarnpkg/cli-dist@4.1.0");
  const one = recorder();
  await installTools({ yarn: "1.22.22" }, dir, one.run, { PATH: "/usr/bin" });
  assert.equal(one.calls[0]?.args.at(-1), "yarn@1.22.22");
});

test("uv installs with pip into its directory", async () => {
  const dir = toolsDir();
  const { calls, run } = recorder();
  await installTools({ uv: "0.5.0" }, dir, run, { PATH: "/usr/bin" });
  assert.equal(calls[0]?.cmd, "python3");
  assert.deepEqual(calls[0]?.args, ["-m", "pip", "install", "--target", `${join(dir, "uv-0.5.0")}.${process.pid}.tmp`, "uv==0.5.0"]);
  assert.equal(INSTALLERS.uv.binDir(dir, "0.5.0"), join(dir, "uv-0.5.0", "bin"));
});

test("a failing install becomes a failed result, not a rejection", async () => {
  const dir = toolsDir();
  const results = await installTools({ deno: "2.0.0" }, dir, async () => {
    throw new Error("network down");
  }, { PATH: "/usr/bin" });
  assert.equal(results[0]?.ok, false);
  assert.equal(results[0]?.error, "network down");
});

test("pathLine lists bin dirs in tool order with a literal $PATH", () => {
  assert.equal(
    pathLine(toolBinDirs({ bun: "1.4.2", node: "24.14.1" }, "/t")),
    'export PATH="/t/node-24.14.1/bin:/t/bun-1.4.2/node_modules/.bin:$PATH"',
  );
  assert.equal(pathLine([]), "");
});

test("invalid versions fail without running anything or creating directories", async () => {
  for (const versions of [{ node: "1; rm -rf /" }, { node: "24.1$(id)" }, { bun: "-g" }, { uv: "../x" }]) {
    const dir = toolsDir();
    const { calls, run } = recorder();
    const results = await installTools(versions, dir, run, { PATH: "/usr/bin" });
    const [tool, version] = Object.entries(versions)[0] ?? [];
    assert.deepEqual(calls, []);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.ok, false);
    assert.equal(results[0]?.error, `versión inválida para ${tool}: ${version}`);
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(existsSync(join(dir, "..", "x")), false);
  }
});

test("the layout refuses a bad version instead of building a path", () => {
  assert.throws(() => INSTALLERS.uv.dir("/t", "../x"), /versión inválida para uv/);
  assert.throws(() => INSTALLERS.bun.binDir("/t", "-g"), /versión inválida para bun/);
});

test("toolBinDirs skips invalid versions", () => {
  assert.deepEqual(toolBinDirs({ node: "24.1; curl evil|sh", bun: "1.4.2" }, "/t"), ["/t/bun-1.4.2/node_modules/.bin"]);
  assert.deepEqual(toolBinDirs({ node: "$(id)" }, "/t"), []);
});

/** Fake Node.js release index, newest first like the real one, with one entry out of order. */
const INDEX: NodeRelease[] = [
  { version: "v25.1.0", lts: false },
  { version: "v24.14.1", lts: "Krypton" },
  { version: "v22.12.0", lts: "Jod" },
  { version: "v22.1.5", lts: false },
  { version: "v22.1.0", lts: false },
  { version: "v20.18.1", lts: "Iron" },
  { version: "v20.19.0", lts: "Iron" },
  { version: "v20.3.0", lts: false },
];

test("resolveNodeVersion picks the newest match for prefixes and aliases", () => {
  assert.equal(resolveNodeVersion("22", INDEX), "22.12.0");
  assert.equal(resolveNodeVersion("22.1", INDEX), "22.1.5");
  assert.equal(resolveNodeVersion("20", INDEX), "20.19.0");
  assert.equal(resolveNodeVersion("lts/iron", INDEX), "20.19.0");
  assert.equal(resolveNodeVersion("lts/Jod", INDEX), "22.12.0");
  assert.equal(resolveNodeVersion("lts/*", INDEX), "24.14.1");
  assert.equal(resolveNodeVersion("node", INDEX), "25.1.0");
  assert.equal(resolveNodeVersion("2", INDEX), undefined);
  assert.equal(resolveNodeVersion("lts/argon", INDEX), undefined);
});

test("node aliases are accepted for node only", () => {
  for (const alias of ["lts/iron", "lts/*", "node"]) assert.ok(isValidRequest("node", alias), alias);
  assert.ok(!isValidRequest("bun", "lts/iron"));
  assert.ok(!isValidRequest("node", "lts/../x"));
  assert.ok(!isValidRequest("node", "lts/"));
  assert.throws(() => INSTALLERS.node.dir("/t", "lts/iron"), /versión inválida para node/);
});

/**
 * Builds a `Run` that serves a release index to curl's `-o` file and records the calls.
 *
 * @param index - Index to write, or undefined to fail like a blocked download.
 * @returns The recorder and its calls.
 */
function indexServer(index: NodeRelease[] | undefined): { calls: Call[]; run: (cmd: string, args: string[], opts?: { env?: NodeJS.ProcessEnv; timeoutMs?: number }) => Promise<void> } {
  const calls: Call[] = [];
  return {
    calls,
    run: async (cmd, args, opts) => {
      calls.push({ cmd, args, env: opts?.env, timeoutMs: opts?.timeoutMs });
      if (cmd !== "curl") return;
      if (!index) throw new Error("curl exited with code 56");
      writeFileSync(args[args.indexOf("-o") + 1] ?? "", JSON.stringify(index));
    },
  };
}

test("resolveVersions downloads the index with curl argv and resolves a partial node", async () => {
  const { calls, run } = indexServer(INDEX);
  const env = { HTTPS_PROXY: "http://proxy:3128" };
  const { resolved, results } = await resolveVersions({ node: "22", bun: "1.4.2" }, curlNodeIndex(run, env));
  assert.deepEqual(resolved, { node: "22.12.0", bun: "1.4.2" });
  assert.deepEqual(results, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.cmd, "curl");
  assert.equal(calls[0]?.args.at(-1), "https://nodejs.org/dist/index.json");
  assert.equal(calls[0]?.env, env);
  const file = calls[0]?.args[(calls[0]?.args.indexOf("-o") ?? 0) + 1] ?? "";
  assert.equal(existsSync(file), false);
});

test("resolveVersions skips the download for exact versions", async () => {
  const { calls, run } = indexServer(INDEX);
  const { resolved } = await resolveVersions({ node: "24.14.1" }, curlNodeIndex(run, {}));
  assert.deepEqual(resolved, { node: "24.14.1" });
  assert.deepEqual(calls, []);
});

test("an unresolvable node is one failed step and is left out", async () => {
  for (const [requested, index, error] of [
    ["lts/argon", INDEX, "ninguna versión de node coincide con lts/argon"],
    ["22", undefined, "curl exited with code 56"],
  ] as const) {
    const { run } = indexServer(index);
    const { resolved, results } = await resolveVersions({ node: requested, pnpm: "9.0.0" }, curlNodeIndex(run, {}));
    assert.deepEqual(resolved, { pnpm: "9.0.0" });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.name, `node ${requested}`);
    assert.equal(results[0]?.ok, false);
    assert.equal(results[0]?.error, error);
  }
});

test("a resolved partial node installs into node-<exact> and toolBinDirs maps to it", async () => {
  const dir = toolsDir();
  const server = indexServer(INDEX);
  const { resolved } = await resolveVersions({ node: "lts/iron" }, curlNodeIndex(server.run, {}));
  const { calls, run } = recorder();
  const results = await installTools(resolved, dir, run, { PATH: "/usr/bin" });
  assert.equal(results[0]?.name, "node 20.19.0");
  assert.equal(calls[1]?.args[4], `${join(dir, "node-20.19.0")}.${process.pid}.tmp`);
  assert.deepEqual(toolBinDirs({ node: "lts/iron" }, dir, resolved), [join(dir, "node-20.19.0", "bin")]);
  assert.deepEqual(toolBinDirs({ node: "lts/iron" }, dir), []);
  assert.deepEqual(toolBinDirs({ node: "22" }, dir, { node: "20.19.0" }), [], "a stale resolution is not used");
});

test("installTools refuses a node version that was not resolved", async () => {
  const dir = toolsDir();
  const { calls, run } = recorder();
  const results = await installTools({ node: "22" }, dir, run, { PATH: "/usr/bin" });
  assert.deepEqual(calls, []);
  assert.equal(results[0]?.ok, false);
  assert.deepEqual(readdirSync(dir), []);
});

test("parseShasums finds the hash of the linux tarball", () => {
  const text = `${"11".repeat(32)}  node-v24.14.1-linux-arm64.tar.xz\n${"22".repeat(32)}  node-v24.14.1-linux-x64.tar.xz\n`;
  assert.equal(parseShasums(text, "node-v24.14.1-linux-x64.tar.xz"), "22".repeat(32));
  assert.equal(parseShasums(text, "node-v24.14.1-linux-ppc64le.tar.xz"), undefined);
});

test("a failed node install leaves no install dir", async () => {
  const dir = toolsDir();
  const base = recorder();
  const results = await installTools({ node: "24.14.1" }, dir, async (cmd, args, opts) => {
    await base.run(cmd, args, opts);
    if (cmd === "bash") {
      mkdirSync(join(args[4] as string, "bin"), { recursive: true });
      writeFileSync(join(args[4] as string, "bin", "node"), "");
      throw new Error("tar failed");
    }
  }, { PATH: "/usr/bin" });
  assert.equal(results[0]?.ok, false);
  assert.equal(existsSync(INSTALLERS.node.dir(dir, "24.14.1")), false);
  assert.deepEqual(readdirSync(dir), []);
});

test("a missing hash in SHASUMS256 fails before downloading the tarball", async () => {
  const dir = toolsDir();
  const calls: string[] = [];
  const results = await installTools({ node: "24.14.1" }, dir, async (cmd, args) => {
    calls.push(cmd);
    if (cmd === "curl") writeFileSync(args[args.indexOf("-o") + 1] as string, shasums("other.tar.xz"));
  }, { PATH: "/usr/bin" });
  assert.equal(results[0]?.ok, false);
  assert.match(results[0]?.error ?? "", /no aparece/);
  assert.deepEqual(calls, ["curl"]);
  assert.deepEqual(readdirSync(dir), []);
});

test("the node script gets the expected hash as $4", async () => {
  const dir = toolsDir();
  const { calls, run } = recorder();
  await installTools({ node: "24.14.1" }, dir, run, { PATH: "/usr/bin" });
  const bash = calls.find((c) => c.cmd === "bash");
  assert.equal(bash?.args[6], parseShasums(shasums(), `node-v24.14.1-linux-${ARCH}.tar.xz`));
});

test("a successful install renames the temp dir", async () => {
  const dir = toolsDir();
  const base = recorder();
  const results = await installTools({ node: "24.14.1" }, dir, async (cmd, args, opts) => {
    await base.run(cmd, args, opts);
    if (cmd === "bash") {
      mkdirSync(join(args[4] as string, "bin"), { recursive: true });
      writeFileSync(join(args[4] as string, "bin", "node"), "");
    }
  }, { PATH: "/usr/bin" });
  assert.equal(results[0]?.ok, true);
  assert.equal(existsSync(join(dir, "node-24.14.1", "bin", "node")), true);
  assert.deepEqual(readdirSync(dir), ["node-24.14.1"]);
});

test("an npm installer installs into a temp prefix and renames it", async () => {
  const dir = toolsDir();
  let prefix = "";
  const results = await installTools({ pnpm: "9.0.0" }, dir, async (_cmd, args) => {
    prefix = args[args.indexOf("--prefix") + 1] as string;
    assert.match(prefix, /\.tmp$/);
    mkdirSync(join(prefix, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(prefix, "node_modules", ".bin", "pnpm"), "");
  }, { PATH: "/usr/bin" });
  assert.equal(results[0]?.ok, true);
  assert.equal(existsSync(prefix), false);
  assert.equal(existsSync(join(dir, "pnpm-9.0.0", "node_modules", ".bin", "pnpm")), true);
});

test("every tool install step gets the tool install time limit, with no curl --max-time", async () => {
  const dir = toolsDir();
  const { calls, run } = recorder();
  await installTools({ node: "24.14.1", bun: "1.4.2", uv: "0.5.0" }, dir, run, { PATH: "/usr/bin" });
  assert.equal(calls.length, 4);
  for (const call of calls) assert.equal(call.timeoutMs, TOOL_INSTALL_TIMEOUT_MS, `${call.cmd} ${call.args.join(" ")}`);
  assert.ok(!calls.some((c) => c.args.includes("--max-time") && c.args.includes("SHASUMS256.txt")));
  assert.ok(!calls[0]?.args.includes("--max-time"));
});
