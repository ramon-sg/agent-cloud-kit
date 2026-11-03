/**
 * @file Tests for the doctor diagnostics, with a fake curl capture and a fake Docker probe.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { doctor } from "../src/doctor.ts";
import type { DoctorContext } from "../src/doctor.ts";
import { configImages } from "../src/detect.ts";
import { readConfig } from "../src/config.ts";
import type { Capture } from "../src/run.ts";
import { fingerprint, statePath, writeState } from "../src/state.ts";

let root: string;
let repo: string;
let tools: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cc-doctor-"));
  repo = join(root, "app");
  tools = join(root, "tools");
  mkdirSync(join(repo, ".claude"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const STATUS: Record<string, string> = {
  "registry.npmjs.org": "200",
  "api.github.com": "403",
  "registry-1.docker.io": "401",
  "nodejs.org": "000",
};

/** Hosts curl was asked about, with the arguments it got. */
let probes: string[][] = [];

const fakeCapture: Capture = async (cmd, args) => {
  assert.equal(cmd, "curl");
  probes.push(args);
  const host = new URL(args.at(-1) ?? "").hostname;
  if (host === "pypi.org") throw new Error("curl exited with code 56");
  return STATUS[host] ?? "200";
};

beforeEach(() => {
  probes = [];
});

const ctx = (docker = true): DoctorContext => ({ capture: fakeCapture, toolsDir: tools, packageVersion: "1.0.0", dockerInfo: () => docker });

test("reports each domain as ok or blocked and fails when any is blocked", async () => {
  writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify({ version: "1.0.0" }));
  const { lines, ok } = await doctor(repo, ctx());
  const has = (text: string): boolean => lines.some((l) => l.startsWith("agent-cloud-kit: ") && l.includes(text));
  assert.ok(has("registry.npmjs.org: ok"));
  assert.ok(has("registry-1.docker.io: ok"));
  assert.ok(has("api.github.com: bloqueado"));
  assert.ok(has("pypi.org: bloqueado"));
  assert.ok(has("nodejs.org: bloqueado"));
  assert.equal(ok, false);
  assert.deepEqual(probes.find((a) => a.at(-1) === "https://registry.npmjs.org/"), [
    "-sS", "-o", "/dev/null", "-w", "%{http_code}", "-I", "--max-time", "5", "https://registry.npmjs.org/",
  ]);
});

test("probes the configured domains after the fixed ones, skipping duplicates", async () => {
  writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify({ version: "1.0.0", domains: ["api.example.com", "pypi.org"] }));
  const { lines } = await doctor(repo, ctx());
  assert.ok(probes.some((a) => a.at(-1) === "https://api.example.com/"));
  assert.ok(lines.includes("agent-cloud-kit: red api.example.com: ok"), lines.join("\n"));
  assert.equal(probes.filter((a) => a.at(-1) === "https://pypi.org/").length, 1);
  const net = lines.filter((l) => l.includes("red "));
  assert.ok(net.findIndex((l) => l.includes("api.example.com")) > net.findIndex((l) => l.includes("api.github.com")));
});

test("invalid and unresolved versions are failed lines, not exceptions", async () => {
  writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify({ version: "1.0.0" }));
  writeFileSync(join(repo, ".nvmrc"), "lts/iron\n");
  writeFileSync(join(repo, ".tool-versions"), "pnpm $(id)\n");
  const { lines, ok } = await doctor(repo, ctx());
  assert.equal(ok, false);
  assert.ok(lines.some((l) => l.includes("herramienta node lts/iron: sin resolver")), lines.join("\n"));
  assert.ok(lines.some((l) => l.includes("herramienta pnpm $(id): versión inválida")), lines.join("\n"));
});

test("a resolved partial node version is checked in its exact directory", async () => {
  writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify({ version: "1.0.0" }));
  writeFileSync(join(repo, ".nvmrc"), "22\n");
  writeState(tools, repo, { fingerprint: "x", packageVersion: "1.0.0", finishedAt: "now", steps: [], resolved: { node: "22.12.0" } });
  mkdirSync(join(tools, "node-22.12.0/bin"), { recursive: true });
  writeFileSync(join(tools, "node-22.12.0/bin/node"), "");
  const { lines } = await doctor(repo, ctx());
  assert.ok(lines.some((l) => l.includes("herramienta node 22: ok")), lines.join("\n"));
});

test("a malformed state or a throwing probe never makes doctor throw", async () => {
  writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify({ version: "1.0.0" }));
  mkdirSync(join(tools, "state"), { recursive: true });
  writeFileSync(statePath(tools, repo), JSON.stringify({ fingerprint: "x", packageVersion: "1", finishedAt: "now", steps: [{ name: "a" }] }));
  const throwing: DoctorContext = {
    ...ctx(),
    capture: () => {
      throw new Error("spawn failed");
    },
    dockerInfo: () => {
      throw new Error("docker probe broke");
    },
  };
  const { lines, ok } = await doctor(repo, throwing);
  assert.equal(ok, false);
  assert.ok(lines.some((l) => l.includes("estado: falta")), lines.join("\n"));
  assert.ok(lines.some((l) => l.includes("docker: error: docker probe broke")), lines.join("\n"));
  assert.ok(lines.some((l) => l.includes("red registry.npmjs.org: bloqueado")), lines.join("\n"));
});

test("a repo without cloud.json is a failed check, not an exception", async () => {
  const { lines, ok } = await doctor(repo, ctx());
  assert.equal(ok, false);
  assert.ok(lines.some((l) => l.includes("cloud.json") && l.includes("falta")));
});

test("checks tools, docker, fingerprint and step durations", async () => {
  writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify({ version: "1.0.0" }));
  writeFileSync(join(repo, ".tool-versions"), "nodejs 24.14.1\n");
  const config = readConfig(repo).config!;
  const fp = fingerprint(config, { node: "24.14.1" }, configImages(config, repo), "1.0.0");
  writeState(tools, repo, {
    fingerprint: fp,
    packageVersion: "1.0.0",
    finishedAt: "2026-01-01T00:00:00.000Z",
    steps: [{ name: "apt", ok: true, ms: 1500 }, { name: "pull", ok: false, ms: 20, error: "x" }],
    resolved: { node: "24.14.1" },
  });
  let result = await doctor(repo, ctx(false));
  assert.ok(result.lines.some((l) => l.includes("node 24.14.1: falta")));
  assert.ok(result.lines.some((l) => l.includes("docker: falta")));
  assert.ok(result.lines.some((l) => l.includes("huella: ok")));
  assert.ok(result.lines.some((l) => l.includes("paso apt: ok") && l.includes("1.5s")));
  assert.ok(result.lines.some((l) => l.includes("paso pull: falló")));
  mkdirSync(join(tools, "node-24.14.1/bin"), { recursive: true });
  writeFileSync(join(tools, "node-24.14.1/bin/node"), "");
  result = await doctor(repo, ctx(true));
  assert.ok(result.lines.some((l) => l.includes("node 24.14.1: ok")));
  assert.ok(result.lines.some((l) => l.includes("docker: ok")));
  writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify({ version: "1.0.0", apt: ["jq"] }));
  result = await doctor(repo, ctx());
  assert.ok(result.lines.some((l) => l.includes("huella: distinta")));
});

const warnings = (lines: string[]): string[] => lines.filter((l) => l.startsWith("agent-cloud-kit: aviso: "));

test("an enabled plugin is a warning that does not fail doctor", async () => {
  const before = (await doctor(repo, ctx())).ok;
  writeFileSync(join(repo, ".claude/settings.json"), JSON.stringify({ enabledPlugins: { "x@m": true, "y@m": false } }));
  const { lines, ok } = await doctor(repo, ctx());
  assert.deepEqual(warnings(lines), [
    "agent-cloud-kit: aviso: el plugin x@m está activado pero no está en el repo; no llegará a la nube (copia sus skills con skills-manager)",
  ]);
  assert.equal(ok, before);
});

test("a malformed settings.json gives no plugin warning", async () => {
  writeFileSync(join(repo, ".claude/settings.json"), "{ nope");
  assert.deepEqual(warnings((await doctor(repo, ctx())).lines), []);
});

test("a cloud-ready skill of another version is a warning", async () => {
  mkdirSync(join(repo, ".agents/skills/cloud-ready"), { recursive: true });
  writeFileSync(join(repo, ".agents/skills/cloud-ready/SKILL.md"), '---\nname: cloud-ready\nmetadata:\n  version: "0.9.0"\n---\n');
  const { lines } = await doctor(repo, ctx());
  assert.deepEqual(warnings(lines), [
    "agent-cloud-kit: aviso: .agents/skills/cloud-ready está en 0.9.0 y el paquete en 1.0.0; corre npx agent-cloud-kit@1.0.0 init",
  ]);
});
