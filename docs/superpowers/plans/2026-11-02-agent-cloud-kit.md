# agent-cloud-kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir `@ramon-sg/claude-cloud` 1.0.0 en `agent-cloud-kit` 2.0.0: la CLI de siempre, renombrada y más fiable, más una skill `cloud-ready`, los comandos `test`, `manual` y `prepare` que dejan un repo Node/TS probado de verdad en la nube de Claude Code, y la migración de issue-flow y agent-kitchen.

**Architecture:** La CLI determinista (`setup`, `session`, `docker`, `doctor`, `init`) sigue siendo la base y gana compatibilidad con el paquete viejo. Encima, una skill que viaja en el paquete (conocimiento de la nube + procedimiento de tests) y un comando local `prepare` que pregunta, trabaja en un worktree, lanza `claude` con la skill y termina lanzando una sesión real con `claude --cloud` que verifica y arregla la config.

**Tech Stack:** TypeScript 7 compilado con `tsc`, Node `>=20`, cero dependencias en runtime, tests con `node --test` sobre `.ts` (Node 24 local, `.tool-versions`: `nodejs 24.14.1`).

**Spec:** `docs/superpowers/specs/2026-11-02-agent-cloud-kit-design.md` (léelo entero antes de empezar; este plan argumenta desde ahí).

## Contexto para quien empieza en limpio

- Este repo es una copia local (con historial) de `../claude-cloud`, **sin remoto**. Crear `github.com/ramon-sg/agent-cloud-kit` es un paso del usuario (Tarea 18).
- Además se toca `../claude-cloud` (Tarea 15: su última versión 1.1.0, que delega en este paquete).
- Repos hermanos que el plan toca al final: `../issue-flow` (su hook `SessionStart` ejecuta `/opt/claude-cloud/bin/claude-cloud session` y usa el texto `claude-cloud session` como marca, ver `src/commands/session.ts` y `src/settings-hooks.ts`) y `../agent-kitchen` (pieza `src/pieces/cloud.ts`).
- Estilo del código: cada constante con nombre y TSDoc, funciones con TSDoc y `@example`, dependencias inyectadas (`Run`, `Capture`, `DockerOps`) para testear sin procesos reales. Sigue el estilo de los archivos vecinos.
- Comandos: `npm test`, `npm run typecheck`, `npm run build`, e2e `bash test/e2e/run.sh` (necesita Docker).
- Idioma: código, salida de la CLI y README en inglés; skill y manual generado en español.

## Global Constraints

- Paquete npm `agent-cloud-kit`, bin `agent-cloud-kit`, versión `2.0.0`, sin scope.
- Sin "claude" en nombres propios del paquete; sí en variables de la plataforma (`CLAUDE_CODE_REMOTE`, `CLAUDE_ENV_FILE`, `CLAUDE_PROJECT_DIR`) y en las constantes legacy de `src/legacy.ts`.
- Prefijo de salida `agent-cloud-kit: `. Dir de herramientas `/opt/agent-cloud-kit`. Variables propias `AGENT_CLOUD_KIT_DIR`, `AGENT_CLOUD_KIT_HOME`, `AGENT_CLOUD_KIT_DELEGATED`.
- Paquete viejo: `@ramon-sg/claude-cloud`; bin viejo `/opt/claude-cloud/bin/claude-cloud`; marca vieja `claude-cloud session`. Un `version` < `2.0.0` en `.claude/cloud.json` es del paquete viejo.
- Config sigue en `.claude/cloud.json`. `$schema`: `https://unpkg.com/agent-cloud-kit@<versión>/schema.json`.
- Setup script para claude.ai: `#!/bin/bash` + `npx -y agent-cloud-kit@2 setup`.
- Timeouts: instalación de herramienta 120 000 ms; paso apt 180 000 ms; `docker pull` 180 000 ms; paso `setup` del repo 180 000 ms; `git fetch` en `session` 60 000 ms.
- Cero dependencias runtime; `setup` y `session` siempre salen 0; valores del repo siempre como argv.
- README con aviso: "Not affiliated with or endorsed by Anthropic. Works with Claude Code on the web."
- Skill en `.agents/skills/cloud-ready/`; manual en `docs/agent-cloud.md`; resultados en `.claude/cloud-tests.json`.
- Límites del agente de la nube (`verify`): solo `.claude/cloud.json`, `docs/agent-cloud.md`, la sección `## Nube` de `.agents/skills/test-audit/project.md`, y claves dentro de `"scripts"` de `package.json`; máximo 3 intentos.
- Acciones externas (crear repo GitHub, `npm publish` inicial, `npm deprecate`, configurar claude.ai, lanzar sesiones `--cloud`) solo con confirmación explícita del usuario.

## Review Focus

- Repo con issue-flow viejo (hook con `claude-cloud session`) al correr el `init` nuevo: no debe quedar un segundo hook `SessionStart`. Test en Tarea 3.
- Máquina guardada con varios repos, uno fijado a `1.0.0` y otro a `2.0.0`: cada uno corre su paquete y ninguno rompe al otro. Test en Tarea 3.
- Descarga de Node cortada a la mitad: el siguiente `setup` debe reinstalar, no saltarse. Test en Tarea 4.
- `prepare` interrumpido (Ctrl+C o el agente local sale con error) después de crear el worktree: no debe borrar nada y debe decir dónde quedó el worktree y cómo seguir. Test en Tarea 12.
- `manual` sobre un `docs/agent-cloud.md` con "Hallazgos" escritos por el agente: se conservan byte a byte. Test en Tarea 9.

---

## Fase 0: confirmar lo que no sabemos

### Task 1: Spike de `claude --cloud` y de la nube (con el usuario)

Throwaway: no produce código del paquete, produce `docs/cloud-cli.md` con respuestas y evidencia. **Pide confirmación al usuario antes de lanzar cualquier sesión en la nube** (consume su cuenta).

**Files:**
- Create: `docs/cloud-cli.md`

- [ ] **Step 1:** `claude --help` y `claude --cloud --help` (si existe); anotar versión de Claude Code y el texto exacto de `--cloud`, `--teleport`, `--environment`.
- [ ] **Step 2:** Con permiso del usuario, en un repo de prueba con `origin` en GitHub y una rama pusheada, lanzar `claude --cloud "di hola y corre git branch --show-current"` y responder en `docs/cloud-cli.md`:
  1. ¿Acepta el texto como prompt inicial o solo como descripción?
  2. ¿Qué repo y qué rama usa la sesión? ¿Hay que pushear antes? ¿Se puede elegir rama?
  3. ¿Qué entorno de claude.ai usa (el por defecto)? ¿Se puede elegir uno no self-hosted?
  4. ¿Bloquea la terminal o devuelve una URL/ID? ¿Cómo se obtiene la URL?
  5. ¿La sesión puede hacer push a esa misma rama existente o solo a ramas `claude/...`?
  6. ¿La sesión descubre las skills en `.agents/skills/` del repo? (poner una skill de prueba)
  7. ¿Las variables del panel del entorno llegan al setup script? (setup script que haga `env | sort > /tmp/setup-env` y comprobar en la sesión)
  8. ¿El `node_modules` instalado por el setup script en `/home/user/<repo>` sigue ahí al empezar la sesión?
- [ ] **Step 3:** Para cada respuesta que contradiga el spec, escribir en `docs/cloud-cli.md` el ajuste que aplica a las Tareas 10–12 (por ejemplo: si no se puede pushear a la rama de `prepare`, `verify` pushea a su rama `claude/...` y abre un PR contra la rama de `prepare`).
- [ ] **Step 4:** Commit: `git add docs/cloud-cli.md && git commit -m "docs: what claude --cloud does, verified"`

---

## Fase 1: renombre y compatibilidad

### Task 2: Renombrar a agent-cloud-kit 2.0.0

**Files:**
- Modify: `package.json` (name `agent-cloud-kit`, version `2.0.0`, bin `{"agent-cloud-kit": "dist/cli.js"}`, description, repository/homepage/bugs a `github.com/ramon-sg/agent-cloud-kit`, keywords sin `claude`, `files` añade `"skills"`), `package-lock.json` (`npm install` lo regenera)
- Modify: `src/constants.ts` (`OUTPUT_PREFIX`, `PACKAGE = "agent-cloud-kit"`, `TOOLS_DIR = "/opt/agent-cloud-kit"`, `TOOLS_DIR_ENV = "AGENT_CLOUD_KIT_DIR"`, `HOME_DIR_ENV = "AGENT_CLOUD_KIT_HOME"`, `DOCKERD_LOG = "/var/log/agent-cloud-kit-dockerd.log"`)
- Modify: `src/cli.ts` (`HELP`, `DELEGATED_ENV = "AGENT_CLOUD_KIT_DELEGATED"`), `src/launcher.ts` (`BIN_NAME`), `src/init.ts` (`HOOK_COMMAND` con `/opt/agent-cloud-kit/bin/agent-cloud-kit session` y el mensaje `npx agent-cloud-kit doctor`; `HOOK_MARKER = "agent-cloud-kit session"`), `src/session.ts` (`machineWarnings` usa `npx -y ${PACKAGE}@2 setup`), `schema.json` (title, descriptions)
- Modify: todos los tests que esperan los textos viejos; `test/fake-package.ts` (name)
- Create: `test/naming.test.ts`

**Interfaces:**
- Produces: constantes renombradas que usan todas las tareas siguientes.

- [ ] **Step 1: Test que falla** — `test/naming.test.ts`: `"src has no claude-cloud outside src/legacy.ts"`: recorre `src/` (como `test/no-project-names.test.ts`) y afirma que ningún archivo salvo `src/legacy.ts` contiene `/claude-cloud|CLAUDE_CLOUD/`. Y `"package.json is agent-cloud-kit 2.0.0"`: `name === "agent-cloud-kit"`, `version === "2.0.0"`, `bin["agent-cloud-kit"] === "dist/cli.js"`.
- [ ] **Step 2:** `npm test` → FAIL en `naming.test.ts`.
- [ ] **Step 3:** Hacer los cambios listados. Actualizar las expectativas de los tests existentes a los nuevos textos (ej. `init.test.ts`: `$schema` `https://unpkg.com/agent-cloud-kit@1.2.3/schema.json`, comando con `agent-cloud-kit session`).
- [ ] **Step 4:** `npm test && npm run typecheck && npm run build && node dist/cli.js --help` → todo pasa; la ayuda empieza por `agent-cloud-kit: `.
- [ ] **Step 5:** Commit `feat!: rename to agent-cloud-kit 2.0.0`.

### Task 3: Compatibilidad con el paquete viejo

**Files:**
- Create: `src/legacy.ts`
- Modify: `src/launcher.ts`, `src/cli.ts` (`runPlanItem`), `src/setup.ts` (`selfInstall`), `src/init.ts`
- Test: `test/legacy.test.ts`, `test/launcher.test.ts`, `test/init.test.ts`, `test/setup.test.ts`

**Interfaces:**
- Produces (`src/legacy.ts`):
  - `export const LEGACY_PACKAGE = "@ramon-sg/claude-cloud"`
  - `export const LEGACY_BIN = "/opt/claude-cloud/bin/claude-cloud"`
  - `export const LEGACY_MARKER = "claude-cloud session"`
  - `export const FIRST_VERSION = "2.0.0"`
  - `export function isLegacyVersion(version: string): boolean` — major < 2.
  - `export function isLegacyConfig(raw: Record<string, unknown>): boolean` — `version` legacy o `$schema` contiene `@ramon-sg/claude-cloud`.
- Changes: `SetupPlanItem.action` gana `"relaunch-legacy"`. `relaunch(repo, version, run, env, pkg = PACKAGE)`.

- [ ] **Step 1: Tests que fallan:**
  - `legacy.test.ts`: `isLegacyVersion("1.0.0") === true`, `isLegacyVersion("2.0.0") === false`, `isLegacyVersion("10.0.0") === false`; `isLegacyConfig({ version: "2.1.0", $schema: "https://unpkg.com/@ramon-sg/claude-cloud@1.0.0/schema.json" }) === true`.
  - `launcher.test.ts` `"planSetup sends a 1.x pin to the old package"`: repos con `1.0.0` y `2.0.0`, current `2.0.0` → `[{action:"relaunch-legacy", version:"1.0.0"}, {action:"run"}]`; y `"relaunch-legacy runs npx -y @ramon-sg/claude-cloud@1.0.0 setup --repo <repo>"` con un `Run` falso que registra argv.
  - `setup.test.ts` `"self install links the legacy bin only when it is free"`: con `LEGACY_BIN` inyectable (añadir `legacyBin?: string` a `SetupContext`), primera corrida crea el link al bin nuevo; si ya existe un archivo ahí, no lo toca.
  - `init.test.ts`:
    - `"an issue-flow hook with claude-cloud session counts as present"`: settings con un hook cuyo comando contiene `claude-cloud session` y no es el viejo propio → `init` no añade otro; `SessionStart.length === 1`.
    - `"the old claude-cloud hook is replaced by the new one"`: settings con el `HOOK_COMMAND` exacto de 1.0.0 → queda uno solo, con `agent-cloud-kit session`.
    - `"a legacy cloud.json is migrated"`: `{ "$schema": ".../@ramon-sg/claude-cloud@1.0.0/schema.json", "version": "1.0.0", "apt": ["jq"] }` → `{ "$schema": "https://unpkg.com/agent-cloud-kit@2.0.0/schema.json", "version": "2.0.0", "apt": ["jq"] }` y una línea `migrated .claude/cloud.json from @ramon-sg/claude-cloud 1.0.0`.
- [ ] **Step 2:** `npm test` → FAIL en esos tests.
- [ ] **Step 3:** Implementar. `planSetup` usa `isLegacyVersion`. `runPlanItem` imprime `relaunching with @ramon-sg/claude-cloud <v> for <repo>; migrate with npx agent-cloud-kit init` y llama a `relaunch(..., LEGACY_PACKAGE)`. `selfInstall` llama a `replaceLink(legacyBin, bin)` solo si `!existsSync(legacyBin)` (y nunca falla el paso por esto: error → se ignora). `init` guarda el comando exacto viejo en `src/legacy.ts` como `LEGACY_HOOK_COMMAND` (copiar de `src/init.ts` de 1.0.0).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: run and migrate repos pinned to @ramon-sg/claude-cloud`.

---

## Fase 2: fiabilidad

### Task 4: Instalación atómica y checksum de Node

**Files:**
- Modify: `src/installers.ts`
- Test: `test/installers.test.ts`

**Interfaces:**
- Produces: `export function parseShasums(text: string, file: string): string | undefined` (hash hex de esa línea). `Installer.install` instala en `<dir>.<pid>.tmp` y renombra a `<dir>`; en error borra el temporal y relanza.
- `NODE_INSTALL_SCRIPT` pasa a: descargar a un archivo (`curl -fsSL --max-time 120 -o "$3" -- "$1"`), comprobar con `sha256sum -c` contra la línea de `SHASUMS256.txt` (descargado con curl a otro archivo), y extraer en `$2`. Mantener argv posicional, nada interpolado.

- [ ] **Step 1: Tests que fallan:**
  - `"parseShasums finds the hash of the linux tarball"`: texto con dos líneas `"<64 hex>  node-v24.14.1-linux-x64.tar.xz"` → devuelve el hash correcto; archivo ausente → `undefined`.
  - `"a failed node install leaves no install dir"`: `Run` falso que crea `<tmp>/bin/node` y luego rechaza → `existsSync(INSTALLERS.node.dir(toolsDir, "24.14.1")) === false` y no queda `*.tmp`.
  - `"a successful install renames the temp dir"`: `Run` falso que crea `bin/node` en el dir recibido como `$2` y resuelve → existe `node-24.14.1/bin/node`.
  - Igual para un instalador npm (`pnpm`): el `--prefix` que recibe npm termina en `.tmp`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementar con un helper `installAtomically(target: string, work: (temp: string) => Promise<void>): Promise<void>` en `src/installers.ts`.
- [ ] **Step 4:** `npm test` → PASS. Correr `bash test/e2e/run.sh` (instala Node real detrás del proxy) → PASS.
- [ ] **Step 5:** Commit `fix: install tools atomically and verify node against SHASUMS256`.

### Task 5: Timeouts

**Files:**
- Modify: `src/constants.ts` (`TOOL_INSTALL_TIMEOUT_MS = 120_000`, `APT_STEP_TIMEOUT_MS = 180_000`, `DOCKER_PULL_TIMEOUT_MS = 180_000`, `SETUP_STEP_TIMEOUT_MS = 180_000`, `GIT_FETCH_TIMEOUT_MS = 60_000`), `src/installers.ts`, `src/setup.ts`, `src/session.ts`
- Test: `test/setup.test.ts`, `test/session.test.ts`, `test/installers.test.ts`

- [ ] **Step 1: Tests que fallan:** con un `Run` falso que registra `opts.timeoutMs`: `"setup passes a time limit to every step"` (apt update/install, docker pull, cada comando de `setup`, cada instalación de herramienta reciben el valor de su constante) y `"session limits each git fetch"` (`--unshallow` y el fetch de la rama reciben `GIT_FETCH_TIMEOUT_MS`). Y `"a timed out setup step is recorded and the next one still runs"`: el primer comando rechaza con `RunTimeoutError` → `steps[0].ok === false`, `steps[0].error` contiene `timed out`, el segundo corre.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Pasar `timeoutMs` en cada llamada. El `Run` ya mata el grupo de procesos (`src/run.ts`).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `fix: time limits for every setup step and session fetch`.

---

## Fase 3: config y comandos nuevos

### Task 6: `domains` y `tests` en la config; `doctor` prueba los dominios

**Files:**
- Modify: `src/config.ts`, `schema.json`, `src/doctor.ts`, `src/init.ts` (`scaffoldConfig` añade `domains: []` y `tests: {}`)
- Test: `test/config.test.ts`, `test/doctor.test.ts`, `test/state.test.ts`

**Interfaces:**
- Produces: `CloudConfig.domains: string[]`, `CloudConfig.tests: { minimum?: string; full?: string }`. `CONFIG_KEYS` incluye `"domains"`, `"tests"`.
- Validación: cada dominio cumple `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i`; los inválidos se reportan y se descartan. `tests` objeto con solo `minimum`/`full` string; otra cosa se reporta.

- [ ] **Step 1: Tests que fallan:** `config.test.ts`: lee `domains` y `tests`; reporta `"domains" has an invalid host: "https://x"`; reporta `unknown field "tests.e2e"`. `state.test.ts`: `"domains and tests do not change the fingerprint"`. `doctor.test.ts`: con `domains: ["api.example.com"]`, `capture` falso recibe `https://api.example.com/` y el resultado incluye `network api.example.com: ok`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (el fingerprint no cambia porque `fingerprint()` ya elige campos). **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: domains and tests in .claude/cloud.json`.

### Task 7: Avisos de `doctor` (plugins y versión de la skill)

**Files:**
- Modify: `src/doctor.ts`
- Test: `test/doctor.test.ts`

**Interfaces:**
- `Check` gana `level: "ok" | "fail" | "warn"` (reemplaza `ok: boolean` internamente; `DoctorResult.ok` es `true` si ningún `fail`). Línea de aviso: `agent-cloud-kit: warn: <texto>`.
- `DoctorContext.packageVersion` ya existe; añadir lectura de `.agents/skills/cloud-ready/SKILL.md` (`metadata.version` en el frontmatter, regex `/^\s+version:\s*"?([^"\n]+)"?$/m` dentro del bloque `metadata:`).

- [ ] **Step 1: Tests que fallan:**
  - `"an enabled plugin is a warning that does not fail doctor"`: `.claude/settings.json` con `{"enabledPlugins": {"x@m": true, "y@m": false}}` → hay una línea `warn: plugin x@m is enabled but is not in the repo; it will not reach the cloud (copy its skills with skills-manager)`, ninguna para `y@m`, y `ok` no cambia por eso.
  - `"a cloud-ready skill of another version is a warning"`: skill con `version: "1.9.0"` y paquete `2.0.0` → `warn: .agents/skills/cloud-ready is 1.9.0, the package is 2.0.0; run npx agent-cloud-kit@2.0.0 init`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: doctor warns about plugins and a stale cloud-ready skill`.

### Task 8: Comando `test`

**Files:**
- Create: `src/tests.ts`
- Modify: `src/cli.ts` (subcomando `test`, ayuda)
- Test: `test/tests.test.ts`, `test/cli.test.ts`

**Interfaces:**
- Produces:
  - `export type TestLevel = "minimum" | "full"`
  - `export interface TestResult { level: TestLevel; command: string; ok: boolean; ms: number }`
  - `export interface TestRecord { level: TestLevel; results: TestResult[]; finishedAt: string; commit: string; remote: boolean }`
  - `export async function runTests(repo: string, level: TestLevel, ctx: { run: Run; env: NodeJS.ProcessEnv; toolsDir: string }): Promise<TestResult[]>` — `minimum` corre `tests.minimum`; `full` corre `tests.minimum` y luego `tests.full` (sigue aunque `minimum` falle). Entorno: `toolsEnv(pathDirs(...), env, findProxyCa(...))` como en `session`. Salida al stdout heredado. Sin timeout.
  - `export function writeTestRecord(repo: string, record: TestRecord): void` — `.claude/cloud-tests.json`, atómico, indentado a 2.
  - `export function readTestRecord(repo: string): TestRecord | undefined`
- CLI: `agent-cloud-kit test [--level minimum|full] [--record]`, `--level` por defecto `full`. Una línea por resultado: `agent-cloud-kit: ✓ minimum: <cmd> (12.3s)` / `✗`. Si el nivel pedido no tiene comando: `agent-cloud-kit: no tests.<level> in .claude/cloud.json` y sale 1. Sale 1 si algún resultado falla.

- [ ] **Step 1: Tests que fallan:** `"full runs minimum then full and keeps going after a failure"`, `"the tools dir is first on PATH"` (el `Run` falso ve `env.PATH` empezando por el bin de node fijado), `"--record writes cloud-tests.json with remote from CLAUDE_CODE_REMOTE"` (commit de `git rev-parse HEAD` en un repo temporal), `"a missing level exits 1 with the message"`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: agent-cloud-kit test runs the repo's cloud test levels`.

### Task 9: Comando `manual`

**Files:**
- Create: `src/manual.ts`
- Modify: `src/cli.ts`
- Test: `test/manual.test.ts`

**Interfaces:**
- Produces:
  - `export const MANUAL_FILE = "docs/agent-cloud.md"`
  - `export const BEGIN = "<!-- agent-cloud-kit:begin -->"`, `export const END = "<!-- agent-cloud-kit:end -->"`
  - `export function renderManual(input: { config: CloudConfig; record?: TestRecord; packageVersion: string; notes?: string }): string` — solo el bloque entre marcas (incluidas).
  - `export function mergeManual(existing: string | undefined, block: string): string` — sin archivo: bloque + `\n\n## Hallazgos\n\n_Lo que el agente descubra de la nube va aquí._\n`; con marcas: reemplaza solo entre marcas; sin marcas: antepone el bloque y conserva todo lo demás.
  - `export function writeManual(repo: string, packageVersion: string): string` — devuelve la ruta escrita.
- Contenido del bloque (español, en este orden de encabezados): `# Nube de Claude Code`, `## Cómo funciona` (5 líneas: agent-kitchen instala, `prepare` configura, tú configuras claude.ai, la nube verifica, el PR guarda el resultado), `## Configurar el entorno en claude.ai` (Network access: Custom + "Also include default list of common package managers" + lista de dominios = `domains` ∪ hosts de `aptRepos`, ordenada, sin duplicados; o "ninguno extra"; el setup script en un bloque `bash` exacto `#!/bin/bash\nnpx -y agent-cloud-kit@2 setup`; variables = `requiredEnv` solo nombres, con la advertencia "quien use el entorno puede leerlas" y "no llegan al setup script"), `## Correr los tests` (`agent-cloud-kit test --level full` y los comandos de cada nivel), `## Último resultado` (de `record`: fecha, nube o local, commit corto, ✓/✗ por comando; o "todavía no se corrió"), `## Qué no corre en la nube` (contenido de `notes` si existe).

- [ ] **Step 1: Tests que fallan:** `"renders domains from config and apt repos, sorted and unique"`, `"renders the exact setup script"`, `"lists requiredEnv names with the warnings"`, `"keeps Hallazgos byte for byte"` (archivo con marcas + `## Hallazgos\n- algo\n` → tras `mergeManual` el texto fuera de marcas es idéntico), `"prepends the block to a file without markers"`, `"shows the last record"`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: agent-cloud-kit manual writes docs/agent-cloud.md`.

---

## Fase 4: la skill

### Task 10: Skill `cloud-ready` y su copia en `init`

**Files:**
- Create: `skills/cloud-ready/SKILL.md`, `skills/cloud-ready/reference/knowledge.md`, `skills/cloud-ready/reference/tests.md`
- Create: `src/skill.ts`
- Modify: `src/init.ts` (llama a `installSkill`), `test/fake-package.ts` (incluye `skills/cloud-ready/SKILL.md`)
- Test: `test/skill.test.ts`, `test/init.test.ts`

**Interfaces:**
- Produces (`src/skill.ts`):
  - `export const SKILL_DIR = ".agents/skills/cloud-ready"`
  - `export function installSkill(repo: string, packageRoot: string, packageVersion: string): string` — copia `skills/cloud-ready/**` a `SKILL_DIR`, reescribe `metadata.version` del frontmatter a `packageVersion`; si ya está en esa versión, no toca nada. Devuelve la línea para el usuario. Atómico (temp + rename).
  - `export function skillVersion(repo: string): string | undefined` (la usa `doctor` de la Tarea 7; mover allí la regex).
- `SKILL.md` (español): frontmatter `name: cloud-ready`, `description` (cuándo usarla: preparar o verificar el repo para la nube de Claude Code; modos `configure` y `verify`), `argument-hint: "configure [respuestas] | verify"`, `metadata.version`. Cuerpo, siguiendo el spec sección 3 al pie de la letra: pasos de `configure`, pasos de `verify` con los límites de archivos y los 3 intentos, cómo comentar el PR con `gh api repos/{owner}/{repo}/issues/{n}/comments -f body=...`, qué hacer con lo que solo se cambia en claude.ai, y la regla de "Hallazgos". Ajustar con lo que dejó `docs/cloud-cli.md` (Tarea 1).
- `reference/knowledge.md`: tabla `| Hecho | Estado | Fuente |` con la semilla del spec; los puntos que la Tarea 1 verificó van como `verificado (Tarea 1, 2026-11)`.
- `reference/tests.md`: la clasificación del spec, con un ejemplo de `.claude/cloud.json` para un repo vitest + Postgres en compose + Playwright.

- [ ] **Step 1: Tests que fallan:** `"init copies the skill with the package version"`, `"a second init at the same version leaves the skill untouched"` (mtime igual), `"init at a new version replaces the skill"`, `"skillVersion reads metadata.version"`, y en `test/skill-content.test.ts`: `SKILL.md` tiene `name: cloud-ready`, menciona `configure`, `verify`, `agent-cloud-kit test --level full --record`, `agent-cloud-kit manual`, los cuatro archivos permitidos y `3` intentos; `knowledge.md` tiene la columna `Estado` y al menos 12 filas.
- [ ] **Step 2:** FAIL. **Step 3:** escribir la skill e implementar. **Step 4:** PASS; `npm pack --dry-run` lista `skills/cloud-ready/SKILL.md`.
- [ ] **Step 5:** Commit `feat: cloud-ready skill, copied by init`.

---

## Fase 5: `prepare`

### Task 11: `prepare`, parte pura: comprobaciones, detección y preguntas

**Files:**
- Create: `src/prepare/detect.ts`, `src/prepare/questions.ts`, `src/prepare/prompts.ts`
- Test: `test/prepare-detect.test.ts`, `test/prepare-questions.test.ts`, `test/prepare-prompts.test.ts`

**Interfaces:**
- Produces:
  - `export interface Answers { testScripts: string[]; services: string[]; secrets: string[]; domains: string[]; level: TestLevel }`
  - `export function suggestTestScripts(pkg: Record<string, unknown>): string[]` — claves de `scripts` que empiezan por `test`, `typecheck` o `lint`, en orden de aparición.
  - `export function suggestServices(repo: string): string[]` — nombres de servicios de `compose.yml|compose.yaml|docker-compose.yml|docker-compose.yaml` en la raíz (parseo línea a línea de la sección `services:` con indentación de 2 espacios; sin dependencia YAML).
  - `export interface Ask { (question: string, suggestion: string): Promise<string> }`
  - `export async function askAll(ask: Ask, suggestions: { testScripts: string[]; services: string[] }): Promise<Answers>` — listas separadas por comas; vacío acepta la sugerencia; `level` acepta `full|minimum` (otro valor → se repregunta una vez y luego `full`).
  - `export function configurePrompt(answers: Answers): string` y `export function verifyPrompt(input: { branch: string; pr?: string }): string` — texto en español que empieza por `/cloud-ready configure` o `/cloud-ready verify` y lleva las respuestas como lista.
  - `export function preflight(probe: { isTty: boolean; gitRoot?: string; hasOrigin: boolean; clean: boolean; claudeHelp?: string }): string[]` — problemas en inglés; vacío si todo bien. `claudeHelp` sin `--cloud` → `claude does not support --cloud; update Claude Code`.

- [ ] **Step 1: Tests que fallan:** cada función con casos concretos (ej. `suggestTestScripts({scripts:{build:"",test:"",“test:e2e”:"",lint:""}})` → `["test","test:e2e","lint"]`; compose con `services:\n  db:\n    image: postgres\n  redis:\n` → `["db","redis"]`; `askAll` con respuestas `["", "db", "API_TOKEN, OTHER", "", "x", "minimum"]` → `{testScripts: sugeridos, services:["db"], secrets:["API_TOKEN","OTHER"], domains:[], level:"minimum"}`; `preflight` con cada problema).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: prepare questions, detection and prompts`.

### Task 12: `prepare`, orquestación

**Files:**
- Create: `src/prepare/index.ts`
- Modify: `src/cli.ts` (subcomando `prepare`, ayuda)
- Test: `test/prepare.test.ts`

**Interfaces:**
- Consumes: Tareas 8, 9, 10, 11; `init` de `src/init.ts`; `defaultBranch` de `src/detect.ts`.
- Produces: `export async function prepare(repo: string, deps: { run: Run; capture: Capture; ask: Ask; waitEnter: (text: string) => Promise<void>; print: (line: string) => void; packageVersion: string; packageRoot: string; today: string; isTty: boolean }): Promise<number>`
- Secuencia (cada comando como argv por `deps.run`/`deps.capture`):
  1. `preflight` → si hay problemas, imprimirlos y devolver 1.
  2. `askAll`.
  3. `git fetch -q origin`; `git worktree add -b chore/cloud-ready-<today> <dirname(repo)>/<basename(repo)>-cloud-ready origin/<defaultBranch>`. Si la carpeta o la rama ya existen → mensaje con qué borrar y devolver 1.
  4. `init(worktree, packageVersion)` + `installSkill(worktree, packageRoot, packageVersion)`.
  5. `claude <configurePrompt(answers)>` con `cwd: worktree`, stdio heredado. Si sale ≠ 0: imprimir `the local agent stopped; the worktree is at <path>; run agent-cloud-kit prepare --resume there` y devolver 1. (`--resume`: salta pasos 2–5 si el worktree ya existe y está en la rama `chore/cloud-ready-*`.)
  6. `writeManual(worktree, packageVersion)`; `git add -A`; `git commit -m "chore: prepare the repo for the Claude Code cloud"`; `git push -u origin <rama>`; `gh pr create --draft --fill` (si `gh` falla: imprimir el link de comparación `https://github.com/<owner>/<repo>/compare/<rama>?expand=1` y seguir).
  7. Imprimir el bloque "Configurar el entorno en claude.ai" del manual y `waitEnter("Configure the environment in claude.ai, then press Enter")`.
  8. `claude --cloud <verifyPrompt({branch, pr})>` según lo que fijó la Tarea 1 (si la rama se elige de otra forma, aplicarla aquí). Imprimir la URL/ID devuelta y `claude --teleport <id>`.
  9. Devolver 0.
- Nunca borra el worktree ni la rama.

- [ ] **Step 1: Tests que fallan** (con `Run`/`Capture` falsos que registran argv y un repo git temporal con un `origin` local bare):
  - `"runs the steps in order with the expected argv"` — compara la lista de argv contra la secuencia de arriba.
  - `"a failing local agent keeps the worktree and says how to resume"` (Review Focus).
  - `"an existing worktree dir stops before touching git"`.
  - `"gh missing prints the compare link and continues to --cloud"`.
  - `"--resume skips questions, worktree and the local agent"`.
  - `"no tty exits 1 with the preflight message"`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar; `ask` y `waitEnter` reales con `node:readline/promises` en `cli.ts`. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: agent-cloud-kit prepare`.

---

## Fase 6: paquete, e2e y documentación

### Task 13: e2e, CI, README y CHANGELOG

**Files:**
- Modify: `test/e2e/run.sh`, `test/e2e/Dockerfile`, `test/e2e/compose.yml`, `test/e2e/fixture/.claude/cloud.json` (version `2.0.0`, `tests.minimum: "node --version"`), `.github/workflows/*.yml`, `README.md`, `CHANGELOG.md`
- [ ] **Step 1:** e2e: rutas nuevas (`/opt/agent-cloud-kit`, bin nuevo), y al final `agent-cloud-kit test --level minimum --record` en la caja → sale 0 y `.claude/cloud-tests.json` tiene `ok: true`. Y que `/opt/claude-cloud/bin/claude-cloud` existe y apunta al bin nuevo.
- [ ] **Step 2:** `bash test/e2e/run.sh` → PASS.
- [ ] **Step 3:** CI: fijar `actions/checkout` y `actions/setup-node` por SHA de commit (con el tag en comentario) en los tres workflows.
- [ ] **Step 4:** README reescrito: qué es; aviso de no afiliación; el flujo (agent-kitchen → `prepare` → claude.ai → verificación en la nube); comandos (`setup`, `session`, `docker`, `doctor`, `init`, `test`, `manual`, `prepare`); `.claude/cloud.json` con `domains` y `tests`; la skill; migración desde `@ramon-sg/claude-cloud` (qué hace `init`, el link legacy, cambiar el setup script a `agent-cloud-kit@2`); lo que no hace; releasing (igual que hoy con el nombre nuevo). CHANGELOG `## 2.0.0` con Added/Changed/Migration.
- [ ] **Step 5:** `npm test && npm run typecheck && npm run build && npm pack --dry-run` → PASS; commit `docs: README and changelog for 2.0.0; ci: pin actions; test: e2e for the new paths`.

---

## Fase 7: prueba real (con el usuario)

### Task 14: Dogfooding en un repo Node/TS real

- [ ] **Step 1:** Pedir al usuario qué repo usar (uno con tests reales; idealmente con Docker o Playwright) y confirmación para crear el worktree, el PR en draft y la sesión en la nube.
- [ ] **Step 2:** Desde ese repo: `node /Users/ramon/Projects/ramon-sg/agent-cloud-kit/dist/cli.js prepare` (el paquete aún no está en npm: el setup script de prueba en claude.ai usa `npx -y github:ramon-sg/agent-cloud-kit#<rama> setup` si el repo GitHub ya existe, o se publica antes una `2.0.0-rc.0`; decidir con el usuario).
- [ ] **Step 3:** Seguir el flujo completo hasta el comentario del PR. Anotar cada fricción.
- [ ] **Step 4:** Pasar los hallazgos del repo de prueba a `skills/cloud-ready/reference/knowledge.md` (estado `verificado`) y corregir lo que haya fallado en el paquete con su test.
- [ ] **Step 5:** Commit `docs: knowledge verified on <repo>`.

---

## Fase 8: ecosistema

### Task 15: Última versión del paquete viejo (`../claude-cloud` 1.1.0)

Sin esto, un entorno de claude.ai con `npx -y @ramon-sg/claude-cloud@1 setup` intenta relanzar `@ramon-sg/claude-cloud@2.0.0` (no existe) en cuanto un repo migra.

**Files (en `../claude-cloud`):**
- Modify: `src/launcher.ts` (`relaunch` elige paquete), `src/cli.ts` (mensaje), `package.json` (`1.1.0`), `CHANGELOG.md`, `README.md` (aviso "Moved to agent-cloud-kit" arriba)
- Test: `test/launcher.test.ts`

- [ ] **Step 1: Test que falla:** `"a pin of 2.0.0 or newer is handed to agent-cloud-kit"`: `relaunch("/home/user/app", "2.0.0", run, env)` → argv `["-y", "agent-cloud-kit@2.0.0", "setup", "--repo", "/home/user/app"]`; con `"1.0.0"` sigue `@ramon-sg/claude-cloud@1.0.0`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (major >= 2 → `agent-cloud-kit`). **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit en una rama `feat/hand-off-to-agent-cloud-kit` de claude-cloud; no publicar sin el usuario (se publica antes que issue-flow y agent-kitchen, Tarea 18).

### Task 16: issue-flow (`../issue-flow`)

**Files:**
- Modify: `src/commands/session.ts`, `src/settings-hooks.ts`, `README.md`, `docs/flujos/nube.md`, `src/usage.ts`, `src/commands/apply.ts` (comentarios), tests (`test/apply.test.mjs` y los de session/hooks), `package.json` (versión menor siguiente), CHANGELOG si existe.
- [ ] **Step 1: Tests que fallan:**
  - session: con `AGENT_CLOUD_KIT_BIN` apuntando a un ejecutable falso, se ejecuta ese; sin él pero con `CLAUDE_CLOUD_BIN` (legacy) existente, se ejecuta el legacy; sin ninguno, el mensaje dice `npx -y agent-cloud-kit@2 setup`.
  - hooks: la nota del `SessionStart` pasa a ` # runs agent-cloud-kit session in the cloud`; `registerHooks` quita hooks ajenos que contengan `agent-cloud-kit session` **o** `claude-cloud session`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (`AGENT_CLOUD_KIT_BIN = "/opt/agent-cloud-kit/bin/agent-cloud-kit"`, se prueba primero; luego el legacy). **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit en una rama `feat/agent-cloud-kit` de issue-flow; no publicar sin el usuario.

### Task 17: agent-kitchen (`../agent-kitchen`)

**Files:**
- Modify: `src/pieces/cloud.ts`, `src/texts/es.ts`, `src/texts/step-text.ts`, `src/decisions.ts`, `src/commands/sync.ts` (comentarios, `--skip` alias), `src/tools.ts` (ejemplos), `README.md`, `docs/README.md`, `docs/agent-guide.md`, tests (`test/helpers.mjs` NPM fake con `"agent-cloud-kit": "2.0.0"`, `sync`, `labels`, `decisions`, `apply-pr`, `flow-apply`, `github-rest`), `package.json` (0.10.0), CHANGELOG si existe.

**Interfaces:**
- `NAME = "agent-cloud-kit"`, `PACKAGE = "agent-cloud-kit"`, `LEGACY_NAME = "claude-cloud"`, `LEGACY_PACKAGE = "@ramon-sg/claude-cloud"`.
- Nuevo `StepText` `{ kind: "cloud-migrate"; from: MaybeVersion; to: string }` (menú: `Migrar claude-cloud ${from} → agent-cloud-kit ${to}`).
- Decisiones: al leer `.agents/kitchen.json`, la clave `claude-cloud` vale para `agent-cloud-kit` (y al escribir se usa la nueva). `--skip claude-cloud` se acepta como alias.

- [ ] **Step 1: Tests que fallan:**
  - `"a repo pinned to @ramon-sg/claude-cloud is offered the migration"`: `.claude/cloud.json` `{version:"1.0.0", $schema:".../@ramon-sg/claude-cloud@1.0.0/..."}` → paso `cloud-migrate` marcado; al correrlo, `npx agent-cloud-kit@2.0.0 init` en las llamadas registradas.
  - `"a fresh repo installs agent-cloud-kit"`: `["agent-cloud-kit@2.0.0", "init"]`.
  - `"updating moves version and $schema of agent-cloud-kit"` (adaptar el test actual de `$schema`).
  - `"kitchen.json with claude-cloud: false keeps the piece out"`.
  - `"--skip claude-cloud is accepted"`.
  - `"after apply with the piece installed, the next step is printed"`: la salida termina con `Siguiente paso para la nube: npx agent-cloud-kit prepare`.
  - doctor: pin legacy → `info` `"usa @ramon-sg/claude-cloud <v>: corre npx agent-kitchen apply para migrar a agent-cloud-kit"`.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** implementar y actualizar docs (tabla de piezas, agent-guide: archivos `.agents/skills/cloud-ready/`, `docs/agent-cloud.md`, `.claude/cloud-tests.json`; sección "En la nube de Claude": `agent-cloud-kit session`, `prepare`). **Step 4:** PASS.
- [ ] **Step 5:** Commit en una rama `feat/agent-cloud-kit` de agent-kitchen; no publicar sin el usuario.

### Task 18: Publicación y retiro del paquete viejo (lo hace el usuario; el agente prepara y guía)

- [ ] **Step 1:** El usuario crea `github.com/ramon-sg/agent-cloud-kit`; el agente añade el remoto y pushea `main` cuando el usuario lo confirme.
- [ ] **Step 2:** Primera publicación a mano (README → Releasing): `npm publish --provenance=false` por el usuario; luego trusted publisher en npmjs.com; luego tag `v2.0.0` sin release.
- [ ] **Step 3:** Publicar en este orden: agent-cloud-kit 2.0.0 → `@ramon-sg/claude-cloud` 1.1.0 (Tarea 15) → issue-flow → agent-kitchen 0.10.0.
- [ ] **Step 4:** Después de publicar 1.1.0, por el usuario: `npm deprecate @ramon-sg/claude-cloud "Moved to agent-cloud-kit; run npx agent-cloud-kit init"`.
- [ ] **Step 5:** El usuario cambia el setup script de sus entornos en claude.ai a `npx -y agent-cloud-kit@2 setup`.

---

## Orden y dependencias

1 → 2 → 3 → (4, 5 en cualquier orden) → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → (15, 16 en cualquier orden) → 17 → 18.
La Tarea 1 puede cambiar detalles de 10–12. Si `claude --cloud` no acepta prompt o rama, aplicar el respaldo del spec en la Tarea 12 (paso 8): imprimir los pasos para abrir la sesión en claude.ai y el prompt de `verify` listo para pegar, y añadir el test `"without --cloud support prints the verify prompt to paste"`. Si contradice el spec en algo más de fondo, parar y preguntar al usuario.
