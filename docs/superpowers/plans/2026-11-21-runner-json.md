# `.agents/runner.json` en agent-cloud-kit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `agent-cloud-kit` lea su versión y el ejecutor (`bun`/`node`) de `.agents/runner.json`, instale Bun en la nube cuando el repo lo pide, relance y escriba su hook con el comando del ejecutor, y se publique como 1.0.0 con sus dependencias adentro (issue #7).

**Architecture:** Un módulo nuevo (`src/pin.ts`) junta en un solo lugar "qué versión y qué ejecutor pide este repo", leyendo `.agents/runner.json` con `@ramon-sg/runner` y, solo como compatibilidad, el `version` viejo de `.claude/cloud.json`. `launcher`, `cli`, `setup`, `session`, `init` y `doctor` dejan de leer `config.version` y usan ese módulo. Otro módulo (`src/bun.ts`) asegura el ejecutor en la nube (`npm i -g bun`). El build pasa de `tsc` a un bundle de esbuild, así el paquete publicado no tiene `dependencies`.

**Tech Stack:** TypeScript 7 (`tsc` solo para tipos), esbuild (bundle), `@ramon-sg/runner` 1.0.0 (adentro del bundle), `node --test` sobre `.ts`, Node 24 local (`.tool-versions`), GitHub Actions con Node y Bun.

**Spec:** issue #7 (`gh issue view 7`) + diseño `../agent-kitchen/docs/superpowers/specs/2026-11-20-bunx-runner-design.md` (secciones "El archivo", "Quién escribe qué", "Las herramientas se publican con sus dependencias adentro", paso 6 de "Orden entre repos") + spike `../runner/docs/spike-2026-11-20.md`. API real de la biblioteca: `../runner/src/index.ts`.

## Contexto para quien empieza en limpio

- Estilo: cada constante con nombre y TSDoc; funciones con TSDoc y `@example`; dependencias inyectadas (`Run`, `Capture`, `DockerOps`, y ahora `available: (r: Runner) => boolean`) para testear sin procesos reales. Sigue los archivos vecinos.
- Toda salida de la CLI va por los catálogos `src/messages/es.ts` y `src/messages/en.ts` (español por defecto, inglés con `--lang en`). Las cadenas en inglés que devuelve `@ramon-sg/runner` (`Check.detail`, `NO_BUN_WARNING`) **no** se imprimen tal cual: se usa su `status` y un texto propio del catálogo.
- Comandos: `npm test`, `npm run typecheck`, `npm run build`, e2e `bash test/e2e/run.sh` (Docker).
- El repo no impone tests nuevos más allá de los suyos: los tests de este plan siguen el patrón de `test/*.test.ts` existente.

## Global Constraints

- Archivo: `.agents/runner.json` (`RUNNER_FILE` de `@ramon-sg/runner`). Entrada propia: `tools["agent-cloud-kit"]`, versión exacta.
- `runner`: `"bun"` o `"node"`; si falta, `"bun"` (`effectiveRunner`).
- Comando de una herramienta: `bun` → `bunx --bun <paquete>@<versión> <args>`; `node` → `npx --yes <paquete>@<versión> <args>`. Siempre con `toolCommand` / `toolCommandText` de `@ramon-sg/runner`, nunca armado a mano.
- Cada herramienta escribe solo su entrada y nunca baja una versión existente (`setTool` sin `allowLower`).
- Bun en la nube: `npm install -g bun`, límite `TOOL_INSTALL_TIMEOUT_MS` (120 000 ms). Si falla: mensaje que pide poner `"runner": "node"` en `.agents/runner.json`. No se fija la versión de Bun.
- Los tests nunca corren `npx`/`bunx` reales contra la red (se cuelgan sin red): todo va por `Run` inyectado o `available` inyectado.
- Solo macOS/Linux.
- Paquete publicado sin `dependencies`; `@ramon-sg/runner` y `esbuild` en `devDependencies` con versión exacta (`@ramon-sg/runner` `1.0.0`).
- Se queda `npx` en el **script de setup del entorno de claude.ai** (`npx -y agent-cloud-kit@1 setup`, `src/manual.ts`): corre antes de que exista Bun y no pertenece a un repo. Se quedan también los comandos de arranque local de `prepare`/README (`npx agent-cloud-kit prepare|verify`), que se corren antes de que el repo tenga `runner.json`; el README muestra además la forma con `bunx --bun`.
- Compatibilidad (decisión de este plan, corregible por el usuario): `version` de `.claude/cloud.json` deja de ser obligatorio y `init` deja de escribirlo. Si `runner.json` no tiene la entrada de `agent-cloud-kit`, se usa el `version` viejo con un aviso; si están los dos, gana `runner.json` y `doctor` avisa que hay que quitar el viejo.
- Versión final: `1.0.0` (hoy `1.0.0-rc.9`).

## Review Focus

1. `runner.json` con JSON roto o un `runner` desconocido: `setup` salta ese repo con el error del archivo y sigue con los demás; `session` y `doctor` no se caen. → test en Task 2 y Task 4.
2. Bun no se puede instalar (registro bloqueado, `npm` sale con ≠0): ese repo queda sin relanzar y con el mensaje de `"runner": "node"`; los demás repos siguen. → test en Task 3.
3. `.claude/settings.json` con el hook viejo de una rc (`revisa con npx agent-cloud-kit doctor`): `init` lo reemplaza, no agrega un segundo. → test en Task 5.
4. `runner.json` ya pide una versión de `agent-cloud-kit` más nueva que la que corre `init`: no la baja, y el hook usa la del archivo. → test en Task 5.
5. Repo sin migrar (sin `runner.json`, con `version` en `cloud.json`): sigue funcionando como antes con ejecutor `bun` por defecto y un aviso. → test en Task 2.

---

### Task 1: Dependencias y bundle (paquete sin `dependencies`, CI con Bun)

**Files:**
- Modify: `package.json` (scripts `build`, `devDependencies`)
- Modify: `.github/workflows/ci.yml`
- Create: `test/package.test.ts`

**Interfaces:**
- Produces: `@ramon-sg/runner` importable desde `src/` (`import { readRunnerConfig, ... } from "@ramon-sg/runner"`); `dist/cli.js` como un solo archivo ESM con shebang.

- [ ] **Step 1: Test que falla**

```ts
test("the published package has no runtime dependencies", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies["@ramon-sg/runner"], "1.0.0");
  assert.match(pkg.devDependencies.esbuild, /^\d+\.\d+\.\d+$/);
});
```

- [ ] **Step 2:** `node --test test/package.test.ts` → FAIL (falta `@ramon-sg/runner`).
- [ ] **Step 3:** `npm install --save-dev --save-exact @ramon-sg/runner@1.0.0 esbuild`. Scripts:
  - `"build": "tsc -p tsconfig.json --noEmit && esbuild src/cli.ts --bundle --platform=node --format=esm --target=node20 --outfile=dist/cli.js"`
  - Borrar `dist/` antes (`rm -rf dist &&` al inicio) para que no queden `.js` viejos de `tsc`.
  - Verificar que `RUNNING_PACKAGE_ROOT` (`new URL("..", import.meta.url)`) y `readVersion()` (`../package.json`) siguen resolviendo desde `dist/cli.js` (sí: mismo nivel). Si `tsconfig.json` tiene `outDir`/emit, dejarlo; `--noEmit` lo anula.
- [ ] **Step 4:** `npm test && npm run build && node dist/cli.js --version && ls dist` → PASS, `dist/` tiene solo `cli.js`.
- [ ] **Step 5: CI.** En `ci.yml` agregar job `bun`: checkout, `actions/setup-node` (24, como los otros), `oven-sh/setup-bun` fijado por SHA (buscar el SHA del tag `v2` actual, igual que los demás `uses:`), `npm ci`, `npm run build`, y:
  ```bash
  bun --bun dist/cli.js --help
  tgz="$(npm pack --silent | tail -n1)"; dir="$(mktemp -d)"; cd "$dir"
  bun add "$GITHUB_WORKSPACE/$tgz" && bun x --bun agent-cloud-kit --version
  npx --yes -p "$GITHUB_WORKSPACE/$tgz" agent-cloud-kit --version
  ```
  (forma de `npx -p <tgz>` según el spike, paso 6). El job `build-node20` sigue igual.
- [ ] **Step 6: Commit** `build: bundle with esbuild and @ramon-sg/runner inside; CI with Bun`.

---

### Task 2: `src/pin.ts` — versión y ejecutor que pide un repo

**Files:**
- Create: `src/pin.ts`, `test/pin.test.ts`
- Modify: `src/config.ts` (`version` opcional), `schema.json` (`version` fuera de `required`, `"deprecated": true` y descripción "usa .agents/runner.json"), `src/messages/es.ts`, `src/messages/en.ts`, `test/config.test.ts`

**Interfaces:**
- Consumes: `readRunnerConfig`, `effectiveRunner`, `RunnerFileError`, `RUNNER_FILE`, `type Runner` de `@ramon-sg/runner`; `readConfig` de `src/config.ts`.
- Produces:
  ```ts
  export interface RepoPin {
    /** Versión de agent-cloud-kit que pide el repo; undefined si ningún archivo la dice o runner.json es inválido. */
    version?: string;
    /** Ejecutor efectivo (el de runner.json, o "bun"). */
    runner: Runner;
    /** De dónde salió `version`. */
    source?: "runner" | "cloud";
    /** Problemas que impiden usar el repo (runner.json inválido), ya traducidos. */
    errors: string[];
    /** Avisos (version vieja en cloud.json), ya traducidos. */
    warnings: string[];
  }
  export function readPin(repo: string, read?: typeof readConfig): RepoPin;
  ```
  `CloudConfig.version` pasa a `version?: string` (sigue validado como semver exacto si viene).

- [ ] **Step 1: Tests que fallan** (`test/pin.test.ts`, repos temporales como en `test/config.test.ts`):
  - `runner.json` `{ runner: "node", tools: { "agent-cloud-kit": "1.2.0" } }` → `{ version: "1.2.0", runner: "node", source: "runner", errors: [], warnings: [] }`.
  - `runner.json` sin `runner` → `runner === "bun"`.
  - Sin `runner.json`, `cloud.json` con `version: "1.0.0-rc.9"` → `version: "1.0.0-rc.9"`, `source: "cloud"`, `runner: "bun"`, un warning que menciona `.agents/runner.json`.
  - Los dos, distintos → `version` de `runner.json`, un warning que menciona `.claude/cloud.json`.
  - `runner.json` con `{` → `version === undefined`, `errors.length === 1`, el error menciona `.agents/runner.json`.
  - Ni uno ni otro → `version === undefined`, `errors` vacío.
  - En `config.test.ts`: un `cloud.json` sin `version` es válido (`config` definido, sin errores).
- [ ] **Step 2:** `node --test test/pin.test.ts test/config.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `readPin` (captura `RunnerFileError` → `t().pin.invalid(file, message)`), `t().pin.legacyOnly(CONFIG_FILE, RUNNER_FILE)`, `t().pin.legacyBoth(CONFIG_FILE)`, y `version` opcional en `parseConfig` (`badVersion` solo si viene y no es exacto). Mensajes en `es.ts` y `en.ts`.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS (ajustar los tests existentes que esperaban `version` obligatorio).
- [ ] **Step 5: Commit** `feat: read agent-cloud-kit version and runner from .agents/runner.json`.

---

### Task 3: Bun en la nube y relanzamiento con el ejecutor

**Files:**
- Create: `src/bun.ts`, `test/bun.test.ts`
- Modify: `src/launcher.ts` (`planSetup`, `relaunch`), `src/cli.ts` (`runOne`, `runPlanItem`, `sessionCommand`), `src/messages/*.ts`, `src/steps.ts`/`STEP` si hace falta el nombre `runner `, `test/launcher.test.ts`, `test/cli.test.ts`

**Interfaces:**
- Consumes: `readPin`, `RepoPin` (Task 2); `toolCommand`, `runnerAvailable`, `RUNNER_FILE`, `type Runner`.
- Produces:
  ```ts
  // src/bun.ts
  /** Deja el ejecutor listo: node no hace nada; bun instala `npm install -g bun` si `available("bun")` es false. */
  export function ensureRunner(runner: Runner, run: Run, env: NodeJS.ProcessEnv, available?: (r: Runner) => boolean): Promise<void>;
  // lanza Error(t().runner.bunFailed(RUNNER_FILE, reason)) si npm falla o bun sigue sin estar.

  // src/launcher.ts
  export function planSetup(repos: string[], current: string, pin?: typeof readPin): SetupPlanItem[];
  // SetupPlanItem gana `runner: Runner`.
  export function relaunch(repo: string, version: string, runner: Runner, run: Run, env: NodeJS.ProcessEnv): Promise<void>;
  ```
  `CliDeps` gana `available?: (r: Runner) => boolean` (por defecto `runnerAvailable`).

- [ ] **Step 1: Tests que fallan**
  - `bun.test.ts`: con `runner "node"` no llama a `run`; con `bun` y `available` true no llama a `run`; con `available` false llama `run("npm", ["install", "-g", "bun"], { env, timeoutMs: 120_000 })` y resuelve si luego `available` da true; si `run` rechaza, rechaza con un mensaje que contiene `"runner": "node"` y `.agents/runner.json`; si `run` resuelve pero `available` sigue false, mismo rechazo.
  - `launcher.test.ts`: `relaunch(repo, "1.2.0", "bun", run, env)` llama `run("bunx", ["--bun", "agent-cloud-kit@1.2.0", "setup", "--repo", repo], { env })`; con `"node"` → `run("npx", ["--yes", "agent-cloud-kit@1.2.0", "setup", "--repo", repo], …)`. `planSetup` con un pin con `errors` → `action: "skip"` y `reason` con el error; sin versión ni errores → `skip` con `t().config.missing(RUNNER_FILE)`.
  - `cli.test.ts`: setup de dos repos, el primero con `runner: "bun"` y otra versión, `available` siempre false y `run` que rechaza para `npm` → se imprime el mensaje de `"runner": "node"` para el primero, no se llama `bunx`, y el segundo repo se procesa. `sessionCommand` delega con la versión de `runner.json`.
- [ ] **Step 2:** `node --test test/bun.test.ts test/launcher.test.ts test/cli.test.ts` → FAIL.
- [ ] **Step 3:** Implementar. En `runPlanItem`, antes de `relaunch`: `await ensureRunner(item.runner, …)`; si lanza, imprimir `t().cli.relaunchFailed(...)` con ese mensaje y seguir. `runOne` usa `readPin` para `versionMismatch` (con `RUNNER_FILE` en el texto si `source === "runner"`) e imprime `pin.warnings`. `sessionCommand`: `wanted = readPin(repo).version`.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: install Bun in the cloud and relaunch setup with the repo runner`.

---

### Task 4: `setup` y `session` con el ejecutor (paso de estado y huella)

**Files:**
- Modify: `src/setup.ts` (`runPhases`), `src/state.ts` (`fingerprint`), `src/session.ts` (`expectedFingerprint`, `sessionBody`), `src/messages/index.ts` (`STEP.runner`), `test/setup.test.ts`, `test/state.test.ts`, `test/session.test.ts`, `test/doctor.test.ts`

**Interfaces:**
- Consumes: `ensureRunner` (Task 3), `readPin` (Task 2).
- Produces: `fingerprint(config, versions, images, packageVersion, runner: Runner): string` — sin `config.version` en la huella, con `runner`. `SetupContext` gana `available?`.

- [ ] **Step 1: Tests que fallan**
  - `state.test.ts`: misma config con `runner` `"bun"` y `"node"` → huellas distintas; dos configs que solo difieren en `version` → misma huella.
  - `setup.test.ts`: repo con `runner.json` `runner: "bun"` y `available` false → hay un paso `runner bun` y `run` recibió `npm install -g bun`; con `runner: "node"` → paso `runner node` ok sin llamar `npm`. Si `ensureRunner` falla, el paso queda `ok: false` y los demás pasos corren igual.
  - `session.test.ts`: `runner.json` inválido → la salida incluye el error del archivo y la sesión sigue (no lanza, sigue escribiendo el PATH).
- [ ] **Step 2:** `node --test test/state.test.ts test/setup.test.ts test/session.test.ts` → FAIL.
- [ ] **Step 3:** En `runPhases`, `readPin(repo).runner` y un lane más en `lanes(...)`: `async () => [await step(STEP.runner + runner, () => ensureRunner(runner, ctx.run, env, ctx.available))]`. Pasar `runner` a `fingerprint` en `setup.ts`, `session.ts` y `doctor.ts`. En `sessionBody`, imprimir `pin.errors` y `pin.warnings`. Ajustar los tests existentes que llaman `fingerprint` con 4 argumentos.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: setup ensures the repo runner and records it in the state`.

---

### Task 5: `init` escribe `runner.json` y el hook con la versión fijada

**Files:**
- Modify: `src/init.ts`, `src/cli.ts` (`initCommand` pasa a `async`), `src/prepare/index.ts` (las dos llamadas a `init` con `await`), `src/messages/*.ts`, `test/init.test.ts`, `test/prepare.test.ts`

**Interfaces:**
- Consumes: `readRunnerConfig`, `writeRunnerConfig`, `setTool`, `chooseRunner`, `toolCommandText`, `checkToolPins`, `RUNNER_FILE`.
- Produces:
  ```ts
  export function hookCommand(runner: Runner, version: string): string;
  export function init(repo: string, packageVersion: string, packageRoot: string, choose?: typeof chooseRunner): Promise<InitResult>;
  ```
  `hookCommand` = `[ "$CLAUDE_CODE_REMOTE" = true ] || exit 0; /opt/agent-cloud-kit/bin/agent-cloud-kit session || echo 'el setup del entorno no corrió; revisa con <toolCommandText(runner, "agent-cloud-kit", version, ["doctor"])>'`. El hook sigue llamando al link instalado (rápido y sin red); la versión fijada va en el texto de ayuda, que es lo que revisa `checkToolPins`. El texto del `echo` **no** lleva el prefijo `agent-cloud-kit:` (sería una mención sin versión y `checkToolPins` fallaría).

- [ ] **Step 1: Tests que fallan** (`init.test.ts`, `choose` falso que devuelve `{ runner: "node", warning: "x" }`):
  - Repo vacío → crea `.agents/runner.json` con `runner: "node"` y `tools["agent-cloud-kit"] === packageVersion`; `cloud.json` creado **sin** `version`; una línea `warn` con el aviso traducido de "Bun no está instalado".
  - `checkToolPins(repo, "agent-cloud-kit", [hook de settings.json])` → todos `status: "ok"`.
  - `runner.json` existente con `runner: "bun"` y `agent-cloud-kit: "9.0.0"` → no se baja, `choose` no se llama, el hook dice `bunx --bun agent-cloud-kit@9.0.0 doctor`.
  - `runner.json` de otra herramienta (`{ tools: { "@ramon-sg/issue-flow": "0.6.0" } }`) → la conserva y agrega la suya.
  - `settings.json` con el hook viejo (`HOOK_COMMAND` de hoy, con `npx agent-cloud-kit doctor`) → queda **un** hook nuestro, con el comando nuevo, y la línea dice "actualizado".
  - Correr `init` dos veces → la segunda dice "ya estaba" para `runner.json` y el hook.
  - `runner.json` inválido → `init` no lo pisa, devuelve una línea `warn` y `ok: false`.
- [ ] **Step 2:** `node --test test/init.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `ensureRunnerFile(repo, packageVersion, choose)` → `{ entry, runner, version }`; `registerHook(repo, command)` que reemplaza el comando de la entrada que contiene `HOOK_MARKER` si difiere. Quitar `version` de `scaffoldConfig`. Hacer `init` async y propagar `await` en `cli.ts` y `prepare/index.ts`.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: init writes .agents/runner.json and pins its hook`.

---

### Task 6: `doctor` revisa el ejecutor, la versión fijada y el hook

**Files:**
- Modify: `src/doctor.ts`, `src/messages/*.ts` (grupo `runner`), `test/doctor.test.ts`

**Interfaces:**
- Consumes: `readPin` (Task 2), `checkToolPins`, `HOOK_MARKER` (exportarlo desde `src/init.ts`).
- Produces: `DoctorContext` gana `available?: (r: Runner) => boolean`. Grupo nuevo `runner` en `t().doctor.groups`.

- [ ] **Step 1: Tests que fallan** — líneas y niveles:
  - `runner.json` válido, `available` true → `ok` "ejecutor bun: ok".
  - `available` false con `bun` → `fail` con un texto que nombra Bun y `"runner": "node"`.
  - `runner.json` inválido → `fail` con el error de `pin.errors`.
  - Sin `runner.json`, con `version` en `cloud.json` → `warn` (el de `pin.warnings`).
  - Hook de `settings.json` con otra versión que `runner.json` → `fail` "el hook de SessionStart no dice agent-cloud-kit@<versión>"; igual → `ok`. Sin hook nuestro → sin línea de pin (eso ya lo cubre la revisión del hook existente, si la hay).
  - El mensaje de la skill vieja (`t().doctor.skill`) usa `toolCommandText(runner, "agent-cloud-kit", version, ["init"])` en lugar de `npx agent-cloud-kit@<v> init`.
- [ ] **Step 2:** `node --test test/doctor.test.ts` → FAIL.
- [ ] **Step 3:** Implementar con `status` de `checkToolPins` y texto propio del catálogo.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: doctor checks the runner, the pinned version and the hook`.

---

### Task 7: Textos — skill y README sin `npx` fijo

**Files:**
- Modify: `skills/cloud-ready/SKILL.md` (líneas 22 y 129), `README.md` (sección del hook, l. ~201, e instalación), `test/skill-content.test.ts`

- [ ] **Step 1: Test que falla** en `skill-content.test.ts`: `SKILL.md` no contiene `npx -y agent-cloud-kit` ni `npx agent-cloud-kit doctor`, y sí contiene `.agents/runner.json` y `bunx --bun agent-cloud-kit@`.
- [ ] **Step 2:** `node --test test/skill-content.test.ts` → FAIL.
- [ ] **Step 3:** En la skill: "La CLI: `agent-cloud-kit <comando>`. Si no está en el `PATH`, córrela con el ejecutor y la versión de `.agents/runner.json`: `bun` → `bunx --bun agent-cloud-kit@<versión> <comando>`; `node` → `npx --yes agent-cloud-kit@<versión> <comando>`." (y lo mismo en la l. 129 para `doctor`). Las líneas 111 y 203 (`prepare`, `verify`, comandos locales del usuario) quedan. README: nueva sección "`.agents/runner.json`" (qué es, ejemplo con `runner` y `tools`, Bun en la nube por `npm i -g bun`, cómo pasar a `node`); el hook de ejemplo con el comando nuevo; los comandos de arranque muestran `npx agent-cloud-kit …` y `bunx --bun agent-cloud-kit …`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `docs: skill and README run agent-cloud-kit with the runner of .agents/runner.json`.

---

### Task 8: e2e con `runner: "bun"`

**Files:**
- Modify: `test/e2e/run.sh`, `test/e2e/fixture/.claude/cloud.json` (sin `version`)
- Create: `test/e2e/fixture/.agents/runner.json` (`{ "runner": "bun", "tools": { "agent-cloud-kit": "0.0.0" } }`; el script lo reescribe con `$VERSION`)

- [ ] **Step 1:** En `run.sh`, reemplazar el bloque que escribe `c.version` por uno que escribe `tools["agent-cloud-kit"] = '$VERSION'` en `.agents/runner.json`. Agregar aserciones después de `setup`:
  - `in_box 'command -v bunx'` → existe (instalado globalmente, no el de `/opt/agent-cloud-kit/bun-1.4.2`).
  - El estado tiene un paso `runner bun` ok (en el bloque "state has no failed steps" ya entra; agregar `expect_output` que busque `s.steps.some(x => x.name === "runner bun" && x.ok)`).
  - `doctor` imprime la línea `ok` del ejecutor bun.
- [ ] **Step 2:** `bash test/e2e/run.sh` → `PASS: container walkthrough`. Si `npm install -g bun` no pasa por el proxy del e2e (`squid.conf`), agregar el host que pida al allowlist y anotarlo en `skills/cloud-ready/reference/knowledge.md` como "por verificar en la nube".
- [ ] **Step 3: Commit** `test: e2e setup with runner bun installs Bun`.

---

### Task 9: Release 1.0.0 y aviso a agent-kitchen

**Files:**
- Modify: `package.json` / `package-lock.json` (`version` → `1.0.0`), `CHANGELOG.md`

- [ ] **Step 1:** `npm version 1.0.0 --no-git-tag-version`; entrada en `CHANGELOG.md` (mismo formato que las rc): `.agents/runner.json`, Bun en la nube, hook con versión fijada, `version` de `cloud.json` obsoleto, paquete sin `dependencies`.
- [ ] **Step 2:** `npm test && npm run typecheck && npm run build` → PASS.
- [ ] **Step 3: Commit** `chore: release 1.0.0`.
- [ ] **Step 4 (usuario):** merge del PR, crear la release `v1.0.0` en GitHub (dispara `publish.yml`). Luego probar en una sesión real de la nube un repo con `runner: "bun"` (criterio "arranca con Bun instalado") y otro con `runner: "node"`.
- [ ] **Step 5:** Comentar en agent-kitchen (issue/PR del runner, ramon-sg/agent-kitchen#52) que `agent-cloud-kit` 1.0.0 lee `.agents/runner.json`. Solo con el OK del usuario.
