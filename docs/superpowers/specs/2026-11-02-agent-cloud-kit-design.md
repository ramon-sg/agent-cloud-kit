# agent-cloud-kit: diseño

Fecha: 2026-11-02. Parte de `@ramon-sg/claude-cloud` 1.0.0 (este repo es su copia con historial).

## Para qué

Dejar un repo Node/TypeScript listo para programar en las sesiones en la nube de Claude Code
(claude.ai/code) y **probarlo ahí de verdad**: que en la nube corran todos los tests que se
puedan, y que quede escrito qué corre, qué no y por qué.

Hoy `claude-cloud` resuelve la parte mecánica (herramientas fijadas, Docker, clone completo,
avisos). Falta la parte que requiere criterio: mirar cómo se prueba el repo, decidir qué puede
correr en la nube, configurarlo, explicar cómo configurar el entorno en claude.ai y comprobarlo
en la nube real. Además, mucho de lo que se sabe de la nube no está escrito en ninguna parte; el
paquete debe juntarlo y hacerlo crecer.

## Decisiones del usuario

- **Nombre:** `agent-cloud-kit`, sin scope y sin "claude" (las guías de marca de Anthropic piden
  permiso para usar sus marcas y prohíben insinuar afiliación). El README puede decir
  "for Claude Code on the web" de forma descriptiva y lleva un aviso de no afiliación.
- **Solo Node y TypeScript** por ahora. Nada de Go, Python (salvo uv, que ya existe), Ruby, Java.
- **Separado de agent-kitchen:** `agent-kitchen apply` sigue liviano: instala la pieza (config,
  hook, skill) y al final sugiere el paso siguiente. No lanza agentes.
- **`prepare` es un paso aparte**, después de agent-kitchen y cuando se quiera: pregunta cosas en
  la terminal, trabaja en un worktree, lanza un agente local con la skill, genera un manual y
  termina con una **prueba real en la nube** (no simulada).
- **Manual `.md`** que explica el flujo y cómo configurar el entorno en claude.ai: setup script,
  variables de entorno, URLs/dominios de red.
- **Skills:** no se descargan en la nube. Las copia agent-kitchen con skills-manager dentro del
  repo. Este paquete solo avisa (en `doctor`) de lo que no llegará a la nube.
- **Compatible con agent-kitchen** (y por arrastre con issue-flow, cuyo hook llama a este
  paquete): al terminar, actualizar agent-kitchen.

## Decisiones del autor del diseño (revisables)

- **Si falla en la nube, se arregla en la nube**, con límites: el agente de la nube solo toca
  `.claude/cloud.json`, `docs/agent-cloud.md`, la sección "Nube" de
  `.agents/skills/test-audit/project.md` y entradas de `"scripts"` en `package.json`. Nunca
  código ni tests. Máximo 3 intentos. Lo que solo se cambia en claude.ai (dominios, variables,
  rehacer la máquina) lo reporta con la instrucción exacta y se detiene.
- **Versión inicial 2.0.0**, para que un `version` < 2.0.0 en `.claude/cloud.json` signifique
  sin ambigüedad "el paquete viejo `@ramon-sg/claude-cloud`".
- **Se mantiene `.claude/cloud.json`** como archivo de config (agent-kitchen lo lee y "cloud" es
  genérico).
- **Idioma:** código, CLI y README en inglés (como hoy). La skill y el manual generado en
  español (como `agent-skills` y los textos de agent-kitchen).
- **La skill se llama `cloud-ready`** y vive en `.agents/skills/cloud-ready/` (la carpeta que ya
  usa skills-manager; como el lock no la conoce, es "skill propia del repo" y `check` no la marca).
- **Manual en `docs/agent-cloud.md`**, generado por la CLI de forma determinista.
- **Worktree hermano:** `../<repo>-cloud-ready`, rama `chore/cloud-ready-<AAAAMMDD>`.
- **Última versión del paquete viejo, `@ramon-sg/claude-cloud` 1.1.0:** cuando un repo fija
  `version` >= 2.0.0, relanza `npx -y agent-cloud-kit@<v> setup --repo <repo>` en vez de
  `@ramon-sg/claude-cloud@<v>` (que no existe). Así un entorno de claude.ai con el setup script
  viejo (`@ramon-sg/claude-cloud@1`) sigue funcionando con repos ya migrados. Se publica antes que
  issue-flow y agent-kitchen.
- **issue-flow también se actualiza:** busca primero `/opt/agent-cloud-kit/bin/agent-cloud-kit` y
  luego el bin viejo, su mensaje apunta a `agent-cloud-kit@2`, y reconoce ambas marcas de hook.
- **La pieza de agent-kitchen** pasa a llamarse `agent-cloud-kit`. Instala y migra con
  `npx agent-cloud-kit@<última> init` (que también copia la skill), sigue moviendo `version` y
  `$schema` en las actualizaciones 2.x, acepta `claude-cloud` como alias en `--skip` y en
  `.agents/kitchen.json`, y al terminar `apply` sugiere `npx agent-cloud-kit prepare`.
- **Si `claude --cloud` no acepta prompt o rama**, `prepare` no se rinde: imprime los pasos exactos
  para abrir la sesión en claude.ai y el prompt de `verify` para pegarlo.

## Piezas

### 1. CLI (lo que ya existe, renombrado y más fiable)

`setup`, `session`, `docker`, `doctor`, `init` siguen con el mismo contrato. Cambios:

- Nombres: paquete y bin `agent-cloud-kit`; prefijo de salida `agent-cloud-kit: `; dir de
  herramientas `/opt/agent-cloud-kit`; variables `AGENT_CLOUD_KIT_DIR`, `AGENT_CLOUD_KIT_HOME`,
  `AGENT_CLOUD_KIT_DELEGATED`. Las variables de la plataforma (`CLAUDE_CODE_REMOTE`,
  `CLAUDE_ENV_FILE`, `CLAUDE_PROJECT_DIR`) no cambian.
- **Compatibilidad con el paquete viejo:**
  - `setup` con un repo que fija `version` < 2.0.0 relanza `npx -y @ramon-sg/claude-cloud@<v>
    setup --repo <repo>` y avisa que se migre con `npx agent-cloud-kit init`.
  - `setup` deja también `/opt/claude-cloud/bin/claude-cloud` apuntando al bin nuevo **solo si
    esa ruta no existe**, para que el hook de un issue-flow viejo siga funcionando.
  - `init` reconoce como hook ya presente tanto `agent-cloud-kit session` como
    `claude-cloud session`. Si encuentra el hook propio viejo de claude-cloud (su comando exacto),
    lo reemplaza por el nuevo. Si `.claude/cloud.json` fija < 2.0.0 o su `$schema` apunta a
    `@ramon-sg/claude-cloud`, lo migra: `version` y `$schema` a la versión actual.
- **Fiabilidad:**
  - Instalación atómica: Node y los instaladores npm/pip escriben en `<dir>.<pid>.tmp` y
    renombran al terminar; un fallo borra el temporal.
  - Node se verifica contra `SHASUMS256.txt` de la misma versión en nodejs.org.
  - Timeouts: cada instalación de herramienta 120 s, cada paso apt 180 s, cada `docker pull`
    180 s, cada paso `setup` del repo 180 s, cada `git fetch` de `session` 60 s.
- **Config nueva** (en `.claude/cloud.json` y `schema.json`):
  - `domains: string[]`: hosts extra que el entorno debe permitir. `doctor` los prueba; el
    manual los lista. No entran en el fingerprint.
  - `tests: { minimum?: string; full?: string }`: comandos de shell para cada nivel. No entran
    en el fingerprint.
- **`doctor`** suma: prueba de `domains`; aviso (no falla) por cada plugin con `true` en
  `enabledPlugins` de `.claude/settings.json` ("no llegará a la nube; cópialo con
  skills-manager"); aviso si la skill `cloud-ready` del repo es de otra versión que el paquete.
  Los avisos no cambian el código de salida.

### 2. Comandos nuevos

- **`agent-cloud-kit test [--level minimum|full] [--record]`**: corre `tests.minimum` y, con
  `full`, también `tests.full`, en el repo, con las herramientas fijadas primero en `PATH` y el
  CA del proxy (mismo entorno que los pasos de `session`). Sin timeout propio. Imprime una
  línea por nivel con ✓/✗ y la duración; sale 1 si alguno falla. Con `--record` escribe
  `.claude/cloud-tests.json` con `{ level, results: [{ level, command, ok, ms }], finishedAt,
  commit, remote }` donde `remote` es `CLAUDE_CODE_REMOTE === "true"`.
- **`agent-cloud-kit manual`**: (re)escribe `docs/agent-cloud.md` desde `.claude/cloud.json`,
  `.claude/cloud-tests.json` y la versión del paquete. Todo lo generado va entre
  `<!-- agent-cloud-kit:begin -->` y `<!-- agent-cloud-kit:end -->`; lo de fuera (la sección
  "Hallazgos" que escribe el agente) se conserva.
- **`agent-cloud-kit prepare`** (local, solo en una terminal): ver "Flujo".

### 3. Skill `cloud-ready`

Viaja en el paquete (`skills/cloud-ready/`) y `init` la copia a `.agents/skills/cloud-ready/`
(sobrescribe si la versión copiada es otra; la versión va en el frontmatter como
`metadata.version`). Contenido:

- `SKILL.md`: dos modos por argumento.
  - `configure`: lee el repo (scripts de `package.json`, runner de tests, Playwright, compose,
    Testcontainers, `.env.example`), clasifica cada tipo de test (ver `reference/tests.md`),
    escribe `.claude/cloud.json` (`setup` con la instalación de dependencias, `session`,
    `domains`, `requiredEnv`, `tests.minimum`, `tests.full`, `notes`), la sección "Nube" de
    `test-audit/project.md` si existe, y corre `agent-cloud-kit manual`. Usa las respuestas de
    `prepare` que le llegan en el prompt.
  - `verify`: solo con `CLAUDE_CODE_REMOTE=true`. Corre `agent-cloud-kit doctor`, luego
    `agent-cloud-kit test --level full --record` (si `full` falla, también `minimum` para saber
    hasta dónde llega). Si algo falla, diagnostica con `reference/knowledge.md` y arregla dentro
    de los límites (ver arriba), hasta 3 intentos. Termina con `agent-cloud-kit manual`, commit,
    push y un comentario en el PR (vía `gh api`, REST) con el nivel alcanzado, qué no corre y
    por qué, y lo que hay que cambiar en claude.ai.
  - En ambos modos: todo hallazgo nuevo sobre la nube va a la sección "Hallazgos" de
    `docs/agent-cloud.md`, marcado "proponer al paquete".
- `reference/knowledge.md`: lo que se sabe de la nube, cada punto con estado `verificado` o
  `por verificar` y su fuente. Semilla mínima: la sección "What it solves" y "What it does not
  do" del README actual; las variables del panel llegan a la sesión pero no al setup script (por
  verificar); setup como root en `/home/user`, ~5 min o no hay máquina guardada; máquina
  guardada se rehace ~7 días o al editar el setup script; sesión reanudada no corre setup; sin
  IPv6 (preferir `127.0.0.1` a `localhost` en tests, por verificar); proxy reemplaza TLS
  (`CLOUD_PROXY_CA`, secret en `docker build`); sin puertos ni previews; `gh pr`/`gh issue`
  fallan (GraphQL bloqueado), usar `gh api`; no se saca un PR de draft desde la nube; plugins
  de la máquina no llegan, las skills deben estar en el repo; la imagen trae Node 22.
- `reference/tests.md`: clasificación Node/TS. Mínimo: typecheck, lint, unitarios (vitest,
  jest, `node --test`). Completo: integración con servicios en Docker (compose levantado en el
  propio comando de test o en `session`), Testcontainers (necesita Docker y el CA), e2e con
  Playwright (navegadores: dominio y tiempo de instalación en `setup`). Fuera: tests que llaman
  APIs externas no permitidas o necesitan secretos que el entorno no tiene.

### 4. Manual `docs/agent-cloud.md` (generado, en español)

Secciones: qué es y el flujo en 5 líneas; cómo configurar el entorno en claude.ai (Network
access: *Custom* + "Also include default list…" + la lista de dominios = `domains` más los hosts
de `aptRepos`; el setup script exacto `#!/bin/bash\nnpx -y agent-cloud-kit@2 setup`; las
variables de `requiredEnv`, solo nombres, con la advertencia de que el entorno es legible por
quien lo use y que no llegan al setup script); cómo correr los tests (`agent-cloud-kit test
--level full`); último resultado (de `.claude/cloud-tests.json`: nivel, ✓/✗ por comando, fecha,
si fue en la nube); qué no corre en la nube (de `notes`, si existe).

## Flujo de `prepare`

1. Comprueba: terminal interactiva, repo git con `origin`, árbol limpio, `claude` en `PATH` y
   que `claude --help` mencione `--cloud`. Si falta algo, dice qué y sale 1.
2. Preguntas (con `node:readline/promises`, sin dependencias), con valores sugeridos detectados:
   qué scripts de `package.json` cuentan como tests (sugerencia: los que empiezan por `test`,
   `typecheck`, `lint`); qué servicios usan los tests (sugerencia: servicios de compose);
   nombres de variables secretas que necesitan; dominios extra; nivel objetivo (`full` o
   `minimum`).
3. Worktree `../<repo>-cloud-ready` en `chore/cloud-ready-<AAAAMMDD>` desde
   `origin/<rama por defecto>`.
4. `agent-cloud-kit init` en el worktree (config, hook, skill).
5. Lanza `claude` interactivo en el worktree con un prompt que invoca `cloud-ready configure` y
   lleva las respuestas. Al salir el agente, `prepare` sigue.
6. `agent-cloud-kit manual`, commit, push, PR en draft (`gh pr create --draft` local; si no hay
   `gh`, lo dice y sigue).
7. Muestra el resumen del manual (setup script, dominios, variables) y espera Enter: el usuario
   configura el entorno en claude.ai.
8. Lanza la sesión en la nube con `claude --cloud` y un prompt que invoca `cloud-ready verify`
   sobre esa rama. (Cómo se elige rama y entorno y si acepta prompt se confirma en la Tarea 1.)
9. Imprime la URL de la sesión, cómo traerla con `claude --teleport` y dónde quedará el
   resultado (el PR).

## Restricciones

- Cero dependencias en tiempo de ejecución; Node `>=20`; TypeScript compilado; tests con
  `node --test` como hoy.
- Todo valor del repo es no confiable: argv, nunca interpolado en shell (salvo los comandos de
  `setup`, `session` y `tests`, que son del repo por diseño).
- `setup` y `session` nunca fallan la sesión (sale 0, registra fallos).
- Nada de acciones externas sin el usuario: crear el repo en GitHub, el primer `npm publish`,
  `npm deprecate` del paquete viejo y configurar claude.ai son pasos del usuario.

## Fuera de alcance

Otros lenguajes; descargar skills; simular la nube como prueba final (el e2e con proxy sigue
como test del paquete, no como verificación del usuario); configurar claude.ai
automáticamente.

## Queda al constructor

Textos exactos de la CLI, estructura interna de módulos nuevos, redacción de la skill dentro
de lo que fija este documento, y cualquier valor no fijado aquí.
