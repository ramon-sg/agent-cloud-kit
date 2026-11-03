# agent-cloud-kit: diseño

Fecha: 2026-11-02. Parte de `@ramon-sg/claude-cloud` 1.0.0 (este repo es su copia con historial).

## Para qué

Dejar un repo Node/TypeScript listo para trabajar en las sesiones en la nube de Claude Code
(claude.ai/code) y **comprobarlo ahí de verdad**. El paquete no impone una forma de testear:
se mantiene lo que el repo ya hace. Un repo puede no tener tests; entonces solo se prepara la
máquina. Si los tiene, la skill los busca y propone cómo hacerlos compatibles con la nube
(adaptar la preparación o, si no hay otra, bifurcar una variante para la nube), y el usuario
decide. Queda escrito qué corre en la nube, qué no y por qué.

Hoy `claude-cloud` resuelve la parte mecánica (herramientas fijadas, Docker, clone completo,
avisos). Falta la parte que requiere criterio: mirar qué usa el repo (y sus tests, si tiene), decidir qué puede
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
- **`prepare` es un paso aparte**, después de agent-kitchen y cuando se quiera: no pregunta nada en
  la terminal, trabaja en un worktree, lanza un agente local con la skill, genera un manual y
  termina con una **prueba real en la nube** (no simulada).
- **Manual `.md`** que explica el flujo y cómo configurar el entorno en claude.ai: setup script,
  variables de entorno, URLs/dominios de red.
- **Skills:** no se descargan en la nube. Las copia agent-kitchen con skills-manager dentro del
  repo. Este paquete solo avisa (en `doctor`) de lo que no llegará a la nube.
- **Compatible con agent-kitchen** (y por arrastre con issue-flow, cuyo hook llama a este
  paquete): al terminar, actualizar agent-kitchen.

## Decisiones del autor del diseño (revisables)

- **No se imponen tests.** Sin campo de tests en la config, sin niveles, sin comando `test`.
  Qué correr en la nube lo decide el usuario con la skill en `configure` y queda escrito en el
  archivo de `notes` (texto libre, como `.claude/cloud-notes.md` en Abastio).
- **Adaptar antes que bifurcar.** Para que un test del repo corra en la nube, primero se
  adapta la preparación (`setup`, `session`, `domains`, `requiredEnv`); solo si eso no basta se
  propone una variante para la nube (un script aparte, p. ej. `cloud:services`, o una rama por
  `CLAUDE_CODE_REMOTE`). Cada cambio fuera de la config se propone y el usuario lo aprueba en
  `configure` (local, interactivo).
- **Si falla en la nube, se arregla en la nube** solo dentro de la preparación: el agente de la
  nube toca `.claude/cloud.json`, el archivo de `notes`, `docs/agent-cloud.md` y la sección
  "Nube" de `.agents/skills/test-audit/project.md`. Nunca código, tests ni scripts: eso lo deja
  propuesto en el comentario del PR. Máximo 3 intentos. Lo que solo se cambia en claude.ai
  (dominios, variables, entorno por defecto, rehacer la máquina) lo reporta con la instrucción
  exacta y se detiene.
- **Versión inicial 1.0.0** del paquete nuevo. **Sin migración ni compatibilidad** con `@ramon-sg/claude-cloud`: solo kaname lo usa (junto con agent-kitchen) y el usuario lo actualiza a mano al final.
- **Se mantiene `.claude/cloud.json`** como archivo de config (agent-kitchen lo lee y "cloud" es
  genérico).
- **Idioma:** código, CLI y README en inglés (como hoy). La skill y el manual generado en
  español (como `agent-skills` y los textos de agent-kitchen).
- **La skill se llama `cloud-ready`** y vive en `.agents/skills/cloud-ready/` (la carpeta que ya
  usa skills-manager; como el lock no la conoce, es "skill propia del repo" y `check` no la marca).
- **Manual en `docs/agent-cloud.md`**, generado por la CLI de forma determinista.
- **Worktree hermano:** `../<repo>-cloud-ready`, rama `chore/cloud-ready-<AAAAMMDD>`.
- **issue-flow también se actualiza:** su hook pasa a `/opt/agent-cloud-kit/bin/agent-cloud-kit`,
  su mensaje apunta a `agent-cloud-kit@1` y su marca a `agent-cloud-kit session`. Sin respaldo al bin viejo.
- **La pieza de agent-kitchen** pasa a llamarse `agent-cloud-kit`. Instala con
  `npx agent-cloud-kit@<última> init` (que también copia la skill), al actualizar sigue moviendo
  `version` y `$schema` y además corre `init` de la versión nueva (para actualizar la skill), y al terminar `apply` sugiere `npx agent-cloud-kit prepare`. Sin alias
  ni migración del nombre viejo.
- **Si `claude --cloud` no acepta prompt o rama**, `prepare` no se rinde: imprime los pasos exactos
  para abrir la sesión en claude.ai y el prompt de `verify` para pegarlo.

## Piezas

### 1. CLI (lo que ya existe, renombrado y más fiable)

`setup`, `session`, `docker`, `doctor`, `init` siguen con el mismo contrato. Cambios:

- Nombres: paquete y bin `agent-cloud-kit`; prefijo de salida `agent-cloud-kit: `; dir de
  herramientas `/opt/agent-cloud-kit`; variables `AGENT_CLOUD_KIT_DIR`, `AGENT_CLOUD_KIT_HOME`,
  `AGENT_CLOUD_KIT_DELEGATED`. Las variables de la plataforma (`CLAUDE_CODE_REMOTE`,
  `CLAUDE_ENV_FILE`, `CLAUDE_PROJECT_DIR`) no cambian.
- **Fiabilidad:**
  - Instalación atómica: Node y los instaladores npm/pip escriben en `<dir>.<pid>.tmp` y
    renombran al terminar; un fallo borra el temporal.
  - Node se verifica contra `SHASUMS256.txt` de la misma versión en nodejs.org.
  - Timeouts: cada instalación de herramienta 120 s, cada paso apt 180 s, cada `docker pull`
    180 s, cada paso `setup` del repo 180 s, cada `git fetch` de `session` 60 s.
- **Config nueva** (en `.claude/cloud.json` y `schema.json`):
  - `domains: string[]`: hosts extra que el entorno debe permitir. `doctor` los prueba; el
    manual los lista. No entran en el fingerprint.
- **`doctor`** suma: prueba de `domains`; aviso (no falla) por cada plugin con `true` en
  `enabledPlugins` de `.claude/settings.json` ("no llegará a la nube; cópialo con
  skills-manager"); aviso si la skill `cloud-ready` del repo es de otra versión que el paquete.
  Los avisos no cambian el código de salida.

### 2. Comandos nuevos

- **`agent-cloud-kit manual`**: (re)escribe `docs/agent-cloud.md` desde `.claude/cloud.json`
  (y el archivo de `notes`) y la versión del paquete. Todo lo generado va entre
  `<!-- agent-cloud-kit:begin -->` y `<!-- agent-cloud-kit:end -->`; lo de fuera (la sección
  "Hallazgos" que escribe el agente) se conserva.
- **`agent-cloud-kit prepare`** (local, solo en una terminal): ver "Flujo".

### 3. Skill `cloud-ready`

Viaja en el paquete (`skills/cloud-ready/`) y `init` la copia a `.agents/skills/cloud-ready/`
(sobrescribe si la versión copiada es otra; la versión va en el frontmatter como
`metadata.version`). Contenido:

- `SKILL.md`: dos modos por argumento.
  - `configure` (local, con el usuario): lee qué usa el repo (`package.json`, `.tool-versions`,
    compose, `.env.example`, CI) y escribe la preparación en `.claude/cloud.json` (`setup` con
    la instalación de dependencias, `session`, `domains`, `requiredEnv`, `notes`). Busca si el
    repo tiene tests (scripts, runner, CI, Playwright, Testcontainers, compose de tests). Si no
    tiene, lo dice y no hace más con tests. Si tiene, para cada grupo dice si correría en la nube
    tal cual y, si no, propone primero adaptar la preparación y solo si no basta una variante
    para la nube (ver `reference/compat.md`); aplica solo lo que el usuario apruebe. Escribe en
    el archivo de `notes` (por defecto `.claude/cloud-notes.md`) qué correr en la nube, qué no y
    por qué, la sección "Nube" de `test-audit/project.md` si existe, y corre
    `agent-cloud-kit manual`.
  - `verify`: solo con `CLAUDE_CODE_REMOTE=true`. Corre `agent-cloud-kit doctor` y comprueba
    que la preparación quedó (dependencias instaladas, versiones fijadas). Si las `notes` dicen
    qué correr en la nube, lo corre tal como el repo lo corre (corridas largas, en segundo
    plano); si no, no corre tests. Si algo falla, diagnostica con `reference/knowledge.md` y
    arregla dentro de los límites (ver arriba), hasta 3 intentos. Termina con
    `agent-cloud-kit manual`, commit, push y un comentario en el PR (vía `gh api`, REST) con
    qué se comprobó, qué corrió, qué no y por qué, lo que hay que cambiar en claude.ai y los
    cambios propuestos al código o los tests, si hay.
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
- `reference/compat.md`: cómo hacer compatible con la nube lo que el repo ya tiene, de menos a
  más invasivo. Adaptar la preparación: dependencias en `setup`; servicios de Docker compose en
  `session` o en el propio comando; Testcontainers (Docker y el CA del proxy); navegadores de
  Playwright en `setup` (dominios y tiempo); `127.0.0.1` en vez de `localhost`; corridas largas
  y `BASH_MAX_TIMEOUT_MS`. Bifurcar solo si no basta: script aparte para la nube o rama por
  `CLAUDE_CODE_REMOTE`. Lo que no corre: APIs externas no permitidas, secretos que el entorno
  no tiene, puertos o vista previa.

### 4. Manual `docs/agent-cloud.md` (generado, en español)

Secciones: qué es y el flujo en 5 líneas, más el aviso de que el documento se va actualizando
cuando la skill detecta un dominio o una variable nueva; cómo configurar el entorno en claude.ai (el entorno
que usa `claude --cloud` es el elegido con `/remote-env`; el Claude GitHub App instalado en el
repo; Network access: *Custom* + "Also include default list…" + la lista de dominios =
`domains` más los hosts de `aptRepos`; el setup script exacto
`#!/bin/bash\nnpx -y agent-cloud-kit@1 setup` (con la versión exacta si el paquete es una `rc`); las variables de `requiredEnv`, solo nombres,
con la advertencia de que el entorno es legible por quien lo use y que no llegan al setup
script); cómo verificar el entorno en una sesión nueva (`agent-cloud-kit doctor`,
`node_modules` presente, versiones fijadas); qué corre en la nube y qué no (el archivo de
`notes`, si existe).

## Flujo de `prepare`

1. Comprueba: terminal interactiva, repo git con `origin`, árbol limpio, `claude` en `PATH` y
   que `claude --help` mencione `--cloud`. Si falta algo, dice qué y sale 1.
2. Menú "¿Dónde preparo el repo?" como el de agent-kitchen (flechas; `--pr`/`--here` lo saltan):
   "En un PR nuevo" (por defecto, sigue en el paso 3; los cambios sin commitear no importan) o
   "En la rama actual, sin commit" (init, configure y manual en el checkout; termina pidiendo
   commit, push y `agent-cloud-kit verify`, que lanza la verificación en la nube de la rama actual
   ya subida). Sin preguntas sobre secretos ni dominios: las variables secretas y los dominios no se piden por adelantado. La skill
   anota los que ve necesarios y, cuando algo falla en la nube por un dominio o una variable que
   falta, lo agrega a `.claude/cloud.json`, regenera `docs/agent-cloud.md` y se lo dice al
   usuario en la sesión en ese momento (y en el comentario del PR).
3. Worktree `../<repo>-cloud-ready` en `chore/cloud-ready-<AAAAMMDD>` desde
   `origin/<rama por defecto>`.
4. `agent-cloud-kit init` en el worktree (config, hook, skill).
5. Lanza `claude` interactivo en el worktree con un prompt que invoca `cloud-ready configure`. Al salir el agente, `prepare` sigue.
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
  `setup` y `session`, que son del repo por diseño).
- `setup` y `session` nunca fallan la sesión (sale 0, registra fallos).
- Nada de acciones externas sin el usuario: crear el repo en GitHub, el primer `npm publish`,
  `npm deprecate` del paquete viejo, actualizar kaname y configurar claude.ai son pasos del usuario.

## Fuera de alcance

Migración automática desde `@ramon-sg/claude-cloud`. Otros lenguajes; descargar skills; simular la nube como prueba final (el e2e con proxy sigue
como test del paquete, no como verificación del usuario); configurar claude.ai
automáticamente.

## Queda al constructor

Textos exactos de la CLI, estructura interna de módulos nuevos, redacción de la skill dentro
de lo que fija este documento, y cualquier valor no fijado aquí.
