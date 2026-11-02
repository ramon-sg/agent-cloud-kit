# Hacer compatible con la nube lo que el repo ya tiene

De menos a más invasivo. Prueba cada nivel antes de pasar al siguiente, y propón al usuario el
cambio exacto: en `configure` se aplica solo lo aprobado; en `verify` solo se tocan los archivos
de la preparación y el resto queda propuesto en el PR.

## 1. Adaptar la preparación

Todo va en `.claude/cloud.json`; no toca código ni tests.

| Lo que usa el repo | Qué hacer |
| --- | --- |
| Dependencias de npm, pnpm, Yarn o Bun | En `setup`, con el lockfile congelado: `npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable`, `bun install --frozen-lockfile`. Node y el gestor fijados los instala el paquete. |
| Servicios de Docker compose (base de datos, cola) | `docker.pull: "auto"` baja las imágenes en el setup. Levántalos en el comando que corre los tests (`agent-cloud-kit docker && docker compose up -d --wait db`) o, si son rápidos, en `session` (2 min como máximo) con ese mismo comando. `agent-cloud-kit session` arranca `dockerd` en segundo plano sin esperar a que responda; `agent-cloud-kit docker` lo arranca si hace falta y espera hasta 60 s a que `docker info` responda (sale con error si no). Para comprobarlo a mano: `docker info`. |
| Testcontainers | Necesita Docker respondiendo: corre `agent-cloud-kit docker` antes de los tests (`agent-cloud-kit session` lo arranca pero no espera) y que la imagen esté en el setup: lístala en `docker.pull` si no está en un compose. Si construye imágenes, el CA del proxy entra con `CLOUD_PROXY_CA` como secreto. |
| Playwright | Los navegadores de la versión del repo en `setup` (`npx playwright install --with-deps chromium`); suma tiempo al setup (límite ~5 min) y puede pedir `domains` (`cdn.playwright.dev`, `playwright.download.prss.microsoft.com`). La imagen ya trae navegadores en `/opt/pw-browsers`: si la versión coincide, alcanza con eso. Corre contra el servidor local de la sesión. |
| `localhost` en URLs de tests o servicios | No hay IPv6: si algo resuelve `localhost` a `::1` y falla, usa `127.0.0.1` (en la config del test, por variable de entorno si el repo lo permite). |
| Variables secretas (API keys de prueba) | Nombres en `requiredEnv`; el usuario pone los valores en el entorno de claude.ai. Recuerda que las lee cualquiera que use el entorno. |
| Hosts externos que el setup o los tests necesitan | En `domains`; el manual los lista para la red del entorno. |
| Corridas largas (más de 2 min) | En segundo plano con la salida a un log, o `BASH_DEFAULT_TIMEOUT_MS` y `BASH_MAX_TIMEOUT_MS` en las variables del entorno. Anota en `notes` cuánto tardan. |

## 2. Bifurcar una variante para la nube

Solo si adaptar la preparación no basta, y con aprobación del usuario.

- **Script aparte:** p. ej. `cloud:services` en `package.json`, que prende Docker
  (`agent-cloud-kit docker`) y levanta lo que los tests necesitan. El script de tests del repo
  no cambia.
- **Rama por `CLAUDE_CODE_REMOTE`:** dentro de un script existente,
  `if [ "$CLAUDE_CODE_REMOTE" = true ]; then …; fi`, para lo que en la nube se hace distinto
  (p. ej. no abrir un navegador, usar `127.0.0.1`). Que en local se comporte igual que antes.

## 3. Lo que no corre en la nube

Déjalo fuera y anótalo en `notes` con el porqué:

- APIs externas que el entorno no permite o que no deben recibir tráfico de pruebas.
- Secretos que el entorno no tiene (o que no deben estar en un entorno compartido).
- Lo que necesita abrir puertos hacia fuera o una vista previa (no existen).
- Recursos de dominios externos cargados por Playwright (bug abierto, ver `knowledge.md`).

## Ejemplo: vitest, Postgres en compose y Playwright

El repo usa npm, `vitest` para unitarios (`npm test`), `vitest` con Postgres de
`compose.yml` para integración (`npm run test:db`, espera `DATABASE_URL`) y Playwright para e2e
(`npm run test:e2e`, levanta el servidor con `webServer`). Una prueba e2e de pagos llama a la
sandbox de un proveedor externo.

Propuesta: unitarios tal cual; integración adaptando la preparación (la imagen se baja en el
setup y la base se levanta antes de los tests); e2e con los navegadores en el setup; la prueba
de pagos fuera (necesita una API externa y su secreto).

`.claude/cloud.json`:

```json
{
  "$schema": "https://unpkg.com/agent-cloud-kit@1.0.0/schema.json",
  "version": "1.0.0",
  "aptRepos": [],
  "apt": [],
  "docker": { "pull": "auto" },
  "setup": ["npm ci", "npx playwright install --with-deps chromium"],
  "session": [],
  "requiredEnv": [],
  "domains": ["cdn.playwright.dev", "playwright.download.prss.microsoft.com"],
  "notes": ".claude/cloud-notes.md"
}
```

`.claude/cloud-notes.md`:

```markdown
En la nube corren:
- `npm test` (unitarios, ~1 min).
- `npm run test:db`, antes `docker compose up -d --wait db` y
  `DATABASE_URL=postgres://app:app@127.0.0.1:5432/app` (~3 min, en segundo plano).
- `npm run test:e2e -- --grep-invert @payments` (Playwright contra el servidor local, ~6 min,
  en segundo plano).

No corre `@payments`: llama a la sandbox del proveedor de pagos, que el entorno no permite y
cuyo secreto no está en el entorno.
```

## Ejemplo: repo sin tests

Solo se prepara la máquina; nada de tests.

`.claude/cloud.json`:

```json
{
  "$schema": "https://unpkg.com/agent-cloud-kit@1.0.0/schema.json",
  "version": "1.0.0",
  "aptRepos": [],
  "apt": [],
  "docker": { "pull": false },
  "setup": ["pnpm install --frozen-lockfile"],
  "session": [],
  "requiredEnv": [],
  "domains": [],
  "notes": ".claude/cloud-notes.md"
}
```

`.claude/cloud-notes.md`:

```markdown
El repo no tiene tests: en la nube solo se prepara la máquina (pnpm y dependencias). `verify`
comprueba `agent-cloud-kit doctor`, `node_modules` y las versiones fijadas.
```
