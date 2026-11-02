/**
 * @file Tests for the `manual` command and its generated docs/agent-cloud.md.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { main } from "../src/cli.ts";
import type { CliDeps } from "../src/cli.ts";
import type { CloudConfig } from "../src/config.ts";
import { BEGIN, END, MANUAL_FILE, mergeManual, renderEnvironmentSection, renderManual, writeManual } from "../src/manual.ts";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "cc-manual-"));
  mkdirSync(join(repo, ".claude"), { recursive: true });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const base: CloudConfig = {
  version: "1.0.0",
  aptRepos: [],
  apt: [],
  docker: { pull: "auto" },
  setup: [],
  session: [],
  requiredEnv: [],
  domains: [],
};

test("renders domains from config and apt repos, sorted and unique", () => {
  const config = { ...base, domains: ["zeta.example.com", "api.example.com"], aptRepos: ["https://apt.example.com/repo", "https://api.example.com/x", "ftp://nope.example.com", "not a url"] };
  const out = renderManual({ config, packageVersion: "1.2.3" });
  const list = ["- api.example.com", "- apt.example.com", "- zeta.example.com"].join("\n");
  assert.ok(out.includes(list));
  assert.equal(out.split("api.example.com").length, 2);
  assert.ok(!out.includes("nope.example.com"));
  assert.ok(renderManual({ config: base, packageVersion: "1.2.3" }).includes("ninguno extra"));
});

test("renders the exact setup script", () => {
  const out = renderEnvironmentSection(base);
  assert.ok(out.includes("```bash\n#!/bin/bash\nnpx -y agent-cloud-kit@1 setup\n```"));
  assert.ok(out.startsWith("## Configurar el entorno en claude.ai"));
  assert.ok(out.includes("Also include default list of common package managers"));
  assert.ok(out.includes("por defecto"));
  assert.ok(renderManual({ config: base, packageVersion: "1.2.3" }).includes(out));
});

test("lists requiredEnv names with the warnings", () => {
  const out = renderManual({ config: { ...base, requiredEnv: ["API_TOKEN", "DB_URL"] }, packageVersion: "1.2.3" });
  assert.ok(out.includes("- `API_TOKEN`"));
  assert.ok(out.includes("- `DB_URL`"));
  assert.ok(out.includes("quien use el entorno puede leerlas"));
  assert.ok(out.includes("no llegan al setup script"));
});

test("keeps Hallazgos byte for byte", () => {
  const tail = "\n\n## Hallazgos\n- algo\n";
  const existing = `intro\n${BEGIN}\nviejo\n${END}${tail}`;
  const block = renderManual({ config: base, packageVersion: "1.2.3" });
  const merged = mergeManual(existing, block);
  assert.ok(merged.startsWith(`intro\n${block}`));
  assert.ok(merged.endsWith(tail));
  assert.ok(!merged.includes("viejo"));
});

test("prepends the block to a file without markers", () => {
  const block = renderManual({ config: base, packageVersion: "1.2.3" });
  const merged = mergeManual("# Mi doc\n\ntexto\n", block);
  assert.ok(merged.startsWith(block));
  assert.ok(merged.endsWith("# Mi doc\n\ntexto\n"));
  const fresh = mergeManual(undefined, block);
  assert.equal(fresh, `${block}\n\n## Hallazgos\n\n_Lo que el agente descubra de la nube va aquí._\n`);
});

test("the manual has no test sections", () => {
  const out = renderManual({ config: base, packageVersion: "1.2.3" });
  assert.ok(!out.includes("--level"));
  assert.ok(!out.includes("Último resultado"));
  assert.ok(!out.includes("cloud-tests.json"));
  assert.ok(!out.includes("Correr los tests"));
});

test("the manual tells how to verify the environment", () => {
  const out = renderManual({ config: base, packageVersion: "1.2.3" });
  assert.ok(out.includes("## Verificar el entorno"));
  assert.ok(out.includes("agent-cloud-kit doctor"));
  assert.ok(out.includes("node_modules"));
  assert.ok(out.includes(".tool-versions"));
  assert.ok(out.includes("## Qué corre en la nube"));
  assert.ok(out.includes("Nada anotado."));
  assert.ok(renderManual({ config: { ...base, notes: "No hay GPU." }, packageVersion: "1.2.3" }).includes("No hay GPU."));
});

test("environment section mentions /remote-env and the GitHub App", () => {
  const out = renderEnvironmentSection(base);
  assert.ok(out.includes("/remote-env"));
  assert.ok(out.includes("Claude GitHub App"));
});

test("notes from a file path are inlined", () => {
  writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify({ version: "1.0.0", notes: ".claude/cloud-notes.md" }));
  writeFileSync(join(repo, ".claude/cloud-notes.md"), "Sin GPU en la nube.\n");
  const path = writeManual(repo, "1.2.3");
  const out = readFileSync(path, "utf8");
  assert.ok(out.includes("Sin GPU en la nube."));
  assert.ok(!out.includes("cloud-notes.md"));
});

test("notes that are absolute, escaping or missing paths stay as plain text", () => {
  writeFileSync(join(repo, "outside.md"), "SECRETO");
  for (const notes of [join(repo, "outside.md"), "../outside.md", "missing.md", "Texto libre."]) {
    writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify({ version: "1.0.0", notes }));
    const out = readFileSync(writeManual(repo, "1.2.3"), "utf8");
    assert.ok(out.includes(notes));
    assert.ok(!out.includes("SECRETO"));
  }
});

test("agent-cloud-kit test is an unknown command", async () => {
  const lines: string[] = [];
  const deps = { env: {}, packageVersion: "1.2.3", print: (l: string) => lines.push(l), cwd: repo } as unknown as CliDeps;
  assert.equal(await main(["test"], deps), 1);
  assert.ok(!lines.join("\n").includes("--level"));
});

test("writeManual writes the file, keeps findings and fails without a config", () => {
  assert.throws(() => writeManual(repo, "1.2.3"), /cloud\.json/);
  writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify({ version: "1.0.0" }));
  const path = writeManual(repo, "1.2.3");
  assert.equal(path, join(repo, MANUAL_FILE));
  writeFileSync(path, `${readFileSync(path, "utf8")}- mi hallazgo\n`);
  writeManual(repo, "1.2.3");
  assert.ok(readFileSync(path, "utf8").endsWith("- mi hallazgo\n"));
});

test("manual command prints the result and exits 1 without a config", async () => {
  const lines: string[] = [];
  const deps = { env: { CLAUDE_PROJECT_DIR: repo }, packageVersion: "1.2.3", print: (l: string) => lines.push(l), cwd: repo } as unknown as CliDeps;
  assert.equal(await main(["manual"], deps), 1);
  writeFileSync(join(repo, ".claude/cloud.json"), JSON.stringify({ version: "1.0.0" }));
  assert.equal(await main(["manual"], deps), 0);
  assert.equal(lines[lines.length - 1], "agent-cloud-kit: wrote docs/agent-cloud.md");
  assert.ok(existsSync(join(repo, "docs/agent-cloud.md")));
});
