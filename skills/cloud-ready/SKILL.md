---
name: cloud-ready
description: Prepara o verifica un repo Node/TypeScript para las sesiones en la nube de Claude Code (claude.ai/code). Usa `configure` en local, con el usuario, para escribir `.claude/cloud.json` y decidir qué corre en la nube; usa `verify` dentro de una sesión en la nube para comprobar la preparación, arreglarla y reportar en el PR.
argument-hint: "configure | verify"
metadata:
  version: "1.0.0"
---

# cloud-ready

Deja el repo listo para la nube de Claude Code y lo comprueba en la nube real. No impone una
forma de testear: se respeta lo que el repo ya hace. Un repo sin tests solo necesita la máquina
preparada.

- **Modo:** el primer argumento. `configure` corre en local con el usuario; `verify`, en la nube.
  Sin argumento: `verify` si `CLAUDE_CODE_REMOTE=true`, si no `configure`.
- **Antes de empezar:** lee `reference/knowledge.md` (lo que se sabe de la nube) y, si el repo
  tiene tests, `reference/compat.md` (cómo hacerlos compatibles).
- **El archivo de `notes`:** el que diga `notes` en `.claude/cloud.json`; si no hay, usa
  `.claude/cloud-notes.md` y pon `"notes": ".claude/cloud-notes.md"` en la config. Se muestra al
  empezar cada sesión en la nube y se copia en `docs/agent-cloud.md`: que sea corto.
- **La CLI:** `agent-cloud-kit <comando>`. Si no está en el `PATH`, usa `npx -y agent-cloud-kit <comando>`.

## Archivos de la preparación

Son los únicos que `verify` puede cambiar:

- `.claude/cloud.json`
- el archivo de `notes`
- `docs/agent-cloud.md` (lo regenera `agent-cloud-kit manual`; a mano solo la sección "Hallazgos")
- `.agents/skills/test-audit/project.md` (solo su sección "Nube", y solo si el archivo existe)

## `configure` (local, con el usuario)

Si `CLAUDE_CODE_REMOTE=true`, detente: este modo necesita al usuario en una terminal local.
No le pidas al usuario una lista de variables secretas ni de dominios: anota en `requiredEnv` y
`domains` solo lo que veas que el repo necesita en la nube; lo que falte lo detecta `verify` (ver
"Dominios y variables nuevos").

1. **Lee qué usa el repo:** `package.json` (scripts, `packageManager`, `engines`), el lockfile,
   `.tool-versions`, `mise.toml`, `.nvmrc`, archivos de Docker compose, `Dockerfile`,
   `.env.example`, la CI (`.github/workflows/`) y el README. Lee `.claude/cloud.json` si existe.
2. **Escribe la preparación en `.claude/cloud.json`** (no toques `version` ni `$schema`):
   - `setup`: la instalación de dependencias con el gestor del repo y el lockfile congelado
     (`npm ci`, `pnpm install --frozen-lockfile`, `bun install --frozen-lockfile`…), más lo que
     haga falta una sola vez (p. ej. navegadores de Playwright). Node y los gestores fijados en
     `.tool-versions`, `mise.toml`, `.nvmrc` o `packageManager` los instala el paquete solo: no
     los agregues. Cada paso tiene 180 s y el setup entero debe quedar bajo ~5 min.
   - `apt` y `aptRepos`: solo lo que el repo necesite y la imagen no traiga.
   - `session`: comandos rápidos de cada sesión (2 min como máximo cada uno, sin depender de la red).
   - `domains`: los hosts que el setup o los tests necesitan y que no están en la lista por
     defecto de gestores de paquetes.
   - `requiredEnv`: solo los nombres de las variables secretas que de verdad hacen falta en la nube.
   - `notes`: la ruta del archivo de `notes`.
3. **Busca los tests del repo:** scripts `test*` y `e2e*` de `package.json`, configuración de
   runners (`vitest.config.*`, `jest.config.*`, `playwright.config.*`, `.mocharc*`),
   Testcontainers en las dependencias, compose de tests y los jobs de la CI que corren tests.
4. **Sin tests:** díselo al usuario y no hagas nada más con tests. Anota en `notes` que el repo
   no tiene tests y que en la nube solo se prepara la máquina. Sigue en el paso 7.
5. **Con tests:** agrúpalos (p. ej. unitarios, con base de datos, de navegador) y, para cada
   grupo, di si correría en la nube tal cual. Si no, propón, en este orden
   (`reference/compat.md`):
   1. Adaptar la preparación: `setup`, `session`, `domains`, `requiredEnv`.
   2. Solo si eso no basta, una variante para la nube: un script aparte (p. ej. `cloud:services`)
      o una rama por `CLAUDE_CODE_REMOTE` en un script existente.
   3. Si nada de eso alcanza, déjalo fuera de la nube y explica por qué.

   Muestra cada propuesta con el cambio exacto (archivo y contenido).
6. **Pregunta y aplica solo lo aprobado.** Un cambio fuera de la config (scripts, compose,
   configuración de tests) necesita un sí explícito del usuario. Nunca cambies lo que un test
   comprueba ni crees scripts de tests nuevos sin aprobación.
7. **Escribe el archivo de `notes`:** qué correr en la nube (el comando tal como lo corre el
   repo, lo que hay que levantar antes, cuánto tarda y si va en segundo plano), qué no y por qué.
   Va dentro de `docs/agent-cloud.md`, así que sé breve: una viñeta por cosa, con su emoji, sin
   párrafos. Por ejemplo:

   ```markdown
   - ✅ `npm test` (~1 min)
   - ⏳ Antes de `npm run test:db`: `docker compose up -d db` (~3 min, en segundo plano)
   - ❌ `npm run test:e2e:prod`: pega a una API externa que el entorno no permite
   ```

   Sin tests: `- ℹ️ El repo no tiene tests; en la nube solo se prepara la máquina.`

8. **Si existe `.agents/skills/test-audit/project.md`:** escribe o actualiza su sección "Nube"
   con el mismo resumen; no toques el resto del archivo.
9. **Corre `agent-cloud-kit manual`** y muéstrale al usuario la sección "Configurar el entorno en
   claude.ai" de `docs/agent-cloud.md` (setup script, dominios, variables). Dile que ese
   documento se irá actualizando: si la skill, en local o en la nube, detecta que hace falta un
   dominio o una variable nueva, lo agrega ahí y se lo dice.
10. **No hagas commit:** `agent-cloud-kit prepare` lo hace al salir. Si te invocaron fuera de
    `prepare`, pregunta al usuario.
11. **Termina diciéndole al usuario que salga:** dile al usuario, con estas palabras o parecidas,
    "configure terminó: sal de claude con `/exit` y `prepare` sigue". Si te
    invocaron fuera de `prepare`, omite este paso.

## `verify` (en la nube)

Solo con `CLAUDE_CODE_REMOTE=true`; si no, detente y dilo. El prompt trae la rama de `prepare`
(`chore/cloud-ready-…`) y puede traer el número del PR. La sesión trabaja en su propia rama
`claude/…`: no la cambies; al final empujas a la rama de `prepare`.

1. **Contexto:** lee `.claude/cloud.json`, el archivo de `notes` y `docs/agent-cloud.md`. Anota
   las líneas `agent-cloud-kit:` de falla que mostró el inicio de la sesión ("el setup del entorno no corrió",
   "falló el setup: …", "la máquina se preparó con otra configuración", "faltan variables de entorno").
2. **Corre `agent-cloud-kit doctor`** y guarda la salida. Si `agent-cloud-kit` no está en el
   `PATH`, el setup no corrió: usa `npx -y agent-cloud-kit doctor` y repórtalo.
3. **Comprueba la preparación:** dependencias instaladas (p. ej. `node_modules` existe), las
   versiones fijadas (`node -v` y los demás gestores contra `.tool-versions`, `mise.toml`,
   `.nvmrc` o `packageManager`), las variables de `requiredEnv` presentes (solo nombres; nunca
   imprimas valores) y Docker, si el repo lo usa.
4. **Tests, solo si las `notes` dicen qué correr en la nube.** Córrelos tal como el repo los
   corre, con lo que haya que levantar antes. Las corridas largas van en segundo plano, con la
   salida a un log que sigues hasta que terminen. Si las `notes` no dicen qué correr, no corras
   tests y dilo en el reporte.
5. **Si algo falla,** diagnostica con `reference/knowledge.md` y `reference/compat.md`, y
   clasifica:
   - **Se arregla en la preparación:** cambia solo los archivos de la preparación y vuelve a
     comprobar. Un cambio de `setup` no se re-ejecuta en esta sesión (el setup ya corrió): corre
     el comando a mano para probarlo y anota que la máquina guardada se rehará en una sesión nueva.
   - **Falta un dominio o una variable:** sigue "Dominios y variables nuevos" y deja de intentar
     arreglos que dependan de eso.
   - **Solo se cambia en claude.ai** (entorno por defecto con `/remote-env`, rehacer la máquina
     editando el setup script, el Claude GitHub App): no lo intentes; deja la instrucción exacta
     para el reporte y deja de intentar arreglos.
   - **Requiere cambiar código, tests o scripts:** no lo cambies; deja el cambio propuesto
     (archivo y diff) para el comentario del PR.

   Hasta **3 intentos** de arreglo en total. Tras el tercero, detente y reporta lo que queda.
6. **Hallazgos:** ver "Hallazgos", abajo.
7. **Corre `agent-cloud-kit manual`.**
8. **Antes del commit,** revisa `git diff --name-only HEAD` y `git status --porcelain`. Todo lo
   que no sea un archivo de la preparación se revierte con `git checkout -- <archivo>` (si está
   versionado) o se borra (si es nuevo y lo creaste tú). Un cambio necesario al código, tests o
   scripts queda como propuesta en el comentario del PR.
9. **Commit y push:** agrega solo los archivos de la preparación que cambiaron, por nombre
   (`git add -- .claude/cloud.json <archivo de notes> docs/agent-cloud.md`, más
   `.agents/skills/test-audit/project.md` si lo tocaste); si hay algo en stage,
   `git commit -m "chore(cloud): verify cloud-ready"`. Luego
   `git push origin HEAD:<rama de prepare>`. Si el push se rechaza, `git fetch origin <rama de
   prepare>`, `git rebase FETCH_HEAD` (el clon es parcial: `origin/<rama>` puede no existir) y
   reintenta una vez.
10. **Comentario en el PR,** por REST con `gh api` (`gh pr …` usa GraphQL y está bloqueado;
    `gh auth status` dice que el token es inválido, pero `gh api` funciona):
    - `owner` y `repo`: de `git remote get-url origin` (las dos últimas partes de la ruta, sin `.git`).
    - Número del PR: el del prompt; si no viene,
      `gh api "repos/{owner}/{repo}/pulls?head={owner}:{rama de prepare}&state=open" --jq '.[0].number'`.
    - Comentario: escribe el cuerpo en un archivo temporal y
      `gh api repos/{owner}/{repo}/issues/{n}/comments -f body="$(cat <archivo>)"`.
    - Si no hay PR, el resultado queda solo en `docs/agent-cloud.md` y en tu resumen final.
    - No saques el PR de draft: lo decide el usuario.
11. **Resumen final** en la sesión, con lo mismo que el comentario.

### El comentario del PR

```markdown
## cloud-ready verify

**Comprobado:** `agent-cloud-kit doctor` (salida 0 / qué falló), dependencias, versiones, variables.
**Corrió:** cada comando, su resultado y cuánto tardó.
**No corrió:** qué y por qué.
**Cambiar en claude.ai:** la instrucción exacta (dónde y qué), o "nada".
**Cambios propuestos al código o los tests:** archivo y diff, o "ninguno".
**Arreglado en la preparación:** archivos y por qué. Intentos: n de 3.
**Hallazgos:** los nuevos, o "ninguno".
```

## Dominios y variables nuevos

En ambos modos, cuando algo falla porque falta un dominio en la red del entorno (el proxy
rechaza la conexión, `403` o `CONNECT` fallido hacia un host) o una variable de entorno (el
inicio de la sesión la marca como faltante, o el error nombra una variable vacía):

1. Agrega el host a `domains` o el nombre a `requiredEnv` en `.claude/cloud.json` (solo el
   nombre; nunca un valor).
2. Corre `agent-cloud-kit manual`: `docs/agent-cloud.md` queda con lo nuevo.
3. **Díselo al usuario en la sesión, en ese momento**, sin esperar al final: qué falta, por qué
   (el comando y el error) y qué hacer, con estas palabras o parecidas: "Falta `<X>` en el entorno
   de claude.ai. Agrégalo en <Network access / Variables de entorno> (está en
   `docs/agent-cloud.md`) y vuelve a verificar: en tu terminal, en la rama `<rama>` actualizada
   (`git pull`), corre `npx agent-cloud-kit verify`".
4. En `verify`, ponlo también en "Cambiar en claude.ai" del comentario del PR.

Un dominio que ya está en `domains`, o una variable que ya está en `requiredEnv`, no se agrega
de nuevo: si sigue faltando, el usuario aún no actualizó el entorno; recuérdaselo.

## Hallazgos

En ambos modos: todo hecho nuevo sobre la nube (algo que no está en `reference/knowledge.md`,
o que lo contradice) va a la sección `## Hallazgos` de `docs/agent-cloud.md`, fuera de las
marcas de `agent-cloud-kit` (`manual` la conserva). Una línea por hallazgo, marcada
"proponer al paquete":

```markdown
- (proponer al paquete) `docker compose` necesita `--wait` para que la base acepte conexiones.
  Visto en `verify`, 2026-11-02, con `docker compose up -d db`.
```

No edites `reference/knowledge.md` del repo: se reemplaza al actualizar el paquete.

## Límites

- `verify` nunca cambia código, tests ni scripts; `configure`, solo con aprobación del usuario.
- Nunca imprimas ni escribas el valor de una variable secreta; solo su nombre.
- Nada de `gh pr` ni `gh issue` en la nube: usa `gh api` (REST).
- No configures claude.ai: da la instrucción exacta y que la haga el usuario.
