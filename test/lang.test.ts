/**
 * @file Tests for the language of the terminal: how it is chosen, that both catalogs have the same
 * keys, and that a command speaks only the chosen language.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { KURO } from "../src/block.ts";
import { main } from "../src/cli.ts";
import type { CliDeps } from "../src/cli.ts";
import { resolveLang, splitLang } from "../src/lang.ts";
import { messages, stepLabel, useLang } from "../src/messages/index.ts";
import { fakePackage } from "./fake-package.ts";

/** Words and letters that only Spanish output has. */
const SPANISH = /[áéíóúñ¿¡]|\b(falta|bloqueado|herramienta|estado|huella|paso|aviso|corre|se creó|se agregó|ya existe|ya tiene|revisiones|orden)\b/i;

/** Removes ANSI color codes. */
const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");

let root: string;
let repo: string;
let printed: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cc-lang-"));
  repo = join(root, "app");
  mkdirSync(join(repo, ".git"), { recursive: true });
  printed = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  useLang("es");
});

/**
 * Dependencies of a CLI run in the temp repo, with every check of doctor answering.
 *
 * @param env - Extra environment.
 * @param overrides - Other dependencies.
 * @returns The dependencies.
 */
function deps(env: NodeJS.ProcessEnv = {}, overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    env: { AGENT_CLOUD_KIT_DIR: join(root, "tools"), AGENT_CLOUD_KIT_HOME: root, CLAUDE_PROJECT_DIR: repo, ...env },
    run: async () => {},
    docker: { start: () => undefined, ensure: async () => true },
    packageVersion: "1.0.0",
    print: (line) => printed.push(line),
    cwd: repo,
    packageRoot: fakePackage(root, "1.0.0"),
    capture: async () => "200",
    dockerInfo: () => true,
    stdoutTty: false,
    ...overrides,
  };
}

/**
 * Every path of a catalog with the kind of its leaf.
 *
 * @param value - Catalog or part of it.
 * @param path - Path so far.
 * @returns Lines like `.doctor.allOk: string`.
 */
function shape(value: unknown, path = ""): string[] {
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([key, item]) => shape(item, `${path}.${key}`));
  return [`${path}: ${typeof value}`];
}

test("the language is --lang, then AGENT_CLOUD_KIT_LANG, then Spanish; LANG is not read", () => {
  assert.equal(resolveLang(undefined, {}), "es");
  assert.equal(resolveLang(undefined, { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" }), "es");
  assert.equal(resolveLang(undefined, { AGENT_CLOUD_KIT_LANG: "en" }), "en");
  assert.equal(resolveLang("es", { AGENT_CLOUD_KIT_LANG: "en" }), "es");
  assert.equal(resolveLang(undefined, { AGENT_CLOUD_KIT_LANG: " " }), "es");
  assert.equal(resolveLang(" EN ", {}), "en");
  assert.throws(() => resolveLang("fr", {}), { source: "--lang", value: "fr" });
  assert.throws(() => resolveLang(undefined, { AGENT_CLOUD_KIT_LANG: "fr" }), { source: "AGENT_CLOUD_KIT_LANG", value: "fr" });
});

test("--lang is taken out of the arguments wherever it is", () => {
  assert.deepEqual(splitLang(["doctor", "--lang", "en"]), { args: ["doctor"], flag: "en" });
  assert.deepEqual(splitLang(["--lang=en", "setup", "--repo", "x"]), { args: ["setup", "--repo", "x"], flag: "en" });
  assert.deepEqual(splitLang(["prepare", "--lang", "--pr"]), { args: ["prepare", "--pr"], flag: "" });
  assert.deepEqual(splitLang(["doctor"]), { args: ["doctor"] });
});

test("the Spanish and English catalogs have the same keys, with the same kind of value", () => {
  assert.deepEqual(shape(messages("en")).sort(), shape(messages("es")).sort());
});

test("an unknown language exits 1 and names the two, in Spanish", async () => {
  assert.equal(await main(["doctor", "--lang", "fr"], deps()), 1);
  assert.deepEqual(printed, ["agent-cloud-kit: --lang espera es o en: fr"]);
  printed = [];
  assert.equal(await main(["doctor"], deps({ AGENT_CLOUD_KIT_LANG: "de" })), 1);
  assert.deepEqual(printed, ["agent-cloud-kit: AGENT_CLOUD_KIT_LANG espera es o en: de"]);
});

test("help is in Spanish by default and in English with --lang en; both name --lang", async () => {
  await main(["--help"], deps());
  const es = printed.join("\n");
  printed = [];
  await main(["--help", "--lang", "en"], deps());
  const en = printed.join("\n");
  assert.match(es, /^Uso: agent-cloud-kit/m);
  assert.match(en, /^Usage: agent-cloud-kit/m);
  assert.match(es, /--lang es\|en/);
  assert.match(en, /--lang es\|en/);
  assert.doesNotMatch(en, SPANISH);
});

test("init and doctor speak only English with --lang en, and only Spanish by default", async () => {
  assert.equal(await main(["init", "--lang", "en"], deps()), 0);
  assert.equal(await main(["doctor", "--lang", "en"], deps()), 1);
  const en = printed.join("\n");
  assert.match(en, /created \.claude\/cloud\.json/);
  assert.match(en, /network registry\.npmjs\.org: ok/);
  assert.match(en, /state: missing \(setup did not run\)/);
  assert.doesNotMatch(en, SPANISH);
  printed = [];
  assert.equal(await main(["doctor"], deps()), 1);
  assert.match(printed.join("\n"), /estado: falta \(setup no corrió\)/);
  assert.doesNotMatch(printed.join("\n"), /missing|network/);
});

test("AGENT_CLOUD_KIT_LANG=en is enough, and --lang es wins over it", async () => {
  await main(["doctor"], deps({ AGENT_CLOUD_KIT_LANG: "en" }));
  assert.ok(printed.some((l) => l.includes("network registry.npmjs.org: ok")));
  printed = [];
  await main(["doctor", "--lang", "es"], deps({ AGENT_CLOUD_KIT_LANG: "en" }));
  assert.ok(printed.some((l) => l.includes("red registry.npmjs.org: ok")));
});

test("in a terminal doctor ends with Kuro and a colored block; NO_COLOR keeps Kuro without color", async () => {
  await main(["doctor"], deps({}, { stdoutTty: true }));
  const colored = printed.join("\n");
  assert.match(colored, /\x1b\[/);
  assert.ok(plain(colored).includes(KURO[0] as string));
  assert.match(plain(colored), /\[!\] Fall(ó|aron) \d+ de \d+ revisiones/);
  printed = [];
  await main(["doctor", "--lang", "en"], deps({ NO_COLOR: "1" }, { stdoutTty: true }));
  const bare = printed.join("\n");
  assert.doesNotMatch(bare, /\x1b\[/);
  assert.ok(bare.includes(KURO[1] as string));
  assert.match(bare, /\[!\] \d+ of \d+ checks failed/);
});

test("outside a terminal doctor prints only its prefixed lines, without Kuro", async () => {
  await main(["doctor"], deps());
  assert.ok(printed.every((l) => l.startsWith("agent-cloud-kit: ")), printed.join("\n"));
});

test("a relaunched setup gets the language of this run", async () => {
  const envs: Array<NodeJS.ProcessEnv | undefined> = [];
  const other = join(root, "other");
  mkdirSync(join(other, ".claude"), { recursive: true });
  mkdirSync(join(other, ".git"));
  writeFileSync(join(other, ".claude/cloud.json"), JSON.stringify({ version: "1.2.0" }));
  await main(["setup", "--lang", "en"], deps({}, { run: async (_cmd, _args, opts) => void envs.push(opts?.env) }));
  assert.equal(envs.at(-1)?.AGENT_CLOUD_KIT_LANG, "en");
  assert.ok(printed.some((l) => l.includes("relaunching with version 1.2.0")), printed.join("\n"));
});

test("step names read in the language of the terminal, whatever language wrote the state", () => {
  assert.equal(stepLabel("self install 1.0.0"), "autoinstalación 1.0.0");
  assert.equal(stepLabel("write state"), "guardar el estado");
  assert.equal(stepLabel("apt repo https://a.com/x"), "repo de apt https://a.com/x");
  assert.equal(stepLabel("docker pull redis:7"), "docker pull redis:7");
  assert.equal(stepLabel("setup: npm ci"), "setup: npm ci");
  useLang("en");
  assert.equal(stepLabel("self install 1.0.0"), "self install 1.0.0");
  assert.equal(stepLabel("lane 2"), "lane 2");
});
