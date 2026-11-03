# Hacer compatible con la nube lo que el repo ya tiene

De menos a más invasivo. Prueba cada nivel antes de pasar al siguiente, y propón al usuario el
cambio exacto: en `configure` se aplica solo lo aprobado; en `verify` solo se tocan los archivos
de la preparación y el resto queda propuesto en el PR.

## Principios

- **Los tests no se cambian.** En la nube corre el mismo comando que en local y en la CI, y
  comprueba lo mismo. Si la suite entera tarda, se corre entera igual (en segundo plano).
- **Lo distinto va en lo que prepara o lanza**, nunca en lo que el test comprueba: el setup,
  los servicios, las imágenes de Docker, cómo se abre la app.
- **Un arreglo que sirve en todas partes se hace sin condición.** Por ejemplo, que el servidor
  de los tests escuche en `127.0.0.1` (en la nube no hay IPv6): se cambia para todos, no solo
  para la nube.
- **Detecta la capacidad antes que el lugar.** Sin pantalla (`DISPLAY` vacío), `xvfb-run`; eso
  sirve también en una CI de Linux. `CLAUDE_CODE_REMOTE=true` queda para lo que solo pasa en
  la nube: la CA del proxy en un `docker build`, Docker apagado al empezar.
- **Un script solo para la nube se niega a correr fuera de ella**, con un mensaje que diga qué
  usar en local (p. ej. `cloud:services`: "solo corre en la nube; en local, `npm run dev`").
- **La suite de scripts del repo se prueba igual en la nube.** Si un script se bifurca por
  `CLAUDE_CODE_REMOTE`, sus tests empiezan con `unset CLAUDE_CODE_REMOTE` y los casos de la
  nube lo ponen a mano; si no, en una sesión en la nube los casos "locales" corren la rama de
  la nube.
- **Los tests no dependen de los scripts de desarrollo.** Si los tests levantan su propio
  Docker, no necesitan `cloud:services`; ese script es para desarrollar en la sesión.

## 1. Adaptar la preparación

Todo va en `.claude/cloud.json`; no toca código ni tests.

| Lo que usa el repo | Qué hacer |
| --- | --- |
| Dependencias de npm, pnpm, Yarn o Bun | En `setup`, con el lockfile congelado: `npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable`, `bun install --frozen-lockfile`. Node y el gestor fijados los instala el paquete. |
| Servicios de Docker compose (base de datos, cola) | `docker.pull: "auto"` baja las imágenes en el setup. Levántalos en el comando que corre los tests (`agent-cloud-kit docker && docker compose up -d --wait db`) o, si son rápidos, en `session` (2 min como máximo) con ese mismo comando. `agent-cloud-kit session` arranca `dockerd` en segundo plano sin esperar a que responda; `agent-cloud-kit docker` lo arranca si hace falta y espera hasta 60 s a que `docker info` responda (sale con error si no). Para comprobarlo a mano: `docker info`. |
| Testcontainers | Necesita Docker respondiendo: corre `agent-cloud-kit docker` antes de los tests (`agent-cloud-kit session` lo arranca pero no espera) y que la imagen esté en el setup: lístala en `docker.pull` si no está en un compose. Si construye imágenes, el CA del proxy entra con `CLOUD_PROXY_CA` como secreto. |
| `docker build` dentro de los tests o del e2e | El build no confía en la CA del proxy (`SELF_SIGNED_CERT_IN_CHAIN` al instalar dependencias en la imagen). Ver "Docker build en la nube", abajo. Es un cambio de script y de `Dockerfile`: necesita aprobación. |
| Playwright | Los navegadores de la versión exacta del repo en `setup`: `npx -y "playwright@$(node -p 'require("./package.json").devDependencies["@playwright/test"]')" install --with-deps chromium` (desde la carpeta que declara `@playwright/test`). Pide `cdn.playwright.dev` y `playwright.download.prss.microsoft.com` en `domains`; baja a `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH` ya apunta ahí). `--with-deps` usa apt: después de los pasos de apt, nunca a la vez. La imagen ya trae navegadores en `/opt/pw-browsers`: si la versión coincide, alcanza con eso. Corre contra el servidor local de la sesión. |
| `localhost` en URLs de tests o servicios | No hay IPv6. El servidor escucha en `127.0.0.1`. La URL del navegador puede quedar en `localhost` (Chromium cae a `127.0.0.1` si `::1` no responde), y debe quedar así si el framework reescribe el host: Next cambia `127.0.0.1` por `localhost` en las redirecciones y se pierden las cookies. Un buscador de puertos libres pide el `0` en `127.0.0.1` y prueba el mismo en `::1`; trata como "sin IPv6" un error sin `code` (Bun), `EADDRNOTAVAIL` o `EAFNOSUPPORT` (Node). |
| Variables secretas (API keys de prueba) | Nombres en `requiredEnv`; el usuario pone los valores en el entorno de claude.ai. Recuerda que las lee cualquiera que use el entorno. |
| Hosts externos que el setup o los tests necesitan | En `domains`; el manual los lista para la red del entorno. |
| Electron | Ver "Electron", abajo: el binario necesita un mirror y la app, Xvfb. |
| Expo o React Native | Ver "Expo y React Native", abajo: casi todo menos el simulador corre. |
| Instalar herramientas en el setup | Lo que viene de releases de GitHub falla. Node: de `nodejs.org`. Bun, pnpm, Yarn: de npm (lo hace el paquete). Un CLI cuyo paquete npm baja de releases: el repo apt del proveedor (`aptRepos`). Dentro de una imagen, no `curl … \| sh` de GitHub: copia el binario de la imagen oficial fijada por digest (`COPY --from=oven/bun:<v>@sha256:<d> /usr/local/bin/bun /usr/local/bin/bun`). |
| Instalación pesada (dependencias en frío, navegadores) | En `setup`, no en `session` (cada paso de `session` se corta a los 2 min, con SIGKILL al grupo: no corren los `trap`). Lo independiente va en paralelo en un script del repo llamado desde `setup` (`cmd1 & cmd2 &`, `wait` de cada uno, sale con 1 si alguno falló). Si `session` reinstala, con `timeout` y una marca (`touch node_modules/.instalado`) que solo se escribe si terminó bien. |
| Hook SessionStart propio del repo | Nunca hace fallar el inicio (`set -uo pipefail` sin `-e`, cada paso `\|\| aviso`, `exit 0` al final), avisa por stdout (stderr no llega a Claude), revisa lo que dejaron los pasos de `session` (la marca de instalación) y exporta variables en `$CLAUDE_ENV_FILE` solo si el comando que las generó terminó bien (p. ej. un `direnv export` fallido imprime `unset …` y borraría variables). En `.claude/settings.json` con `"timeout": 600`. |
| Corridas largas (más de 2 min) | En segundo plano con la salida a un log, o `BASH_DEFAULT_TIMEOUT_MS` y `BASH_MAX_TIMEOUT_MS` en las variables del entorno. Anota en `notes` cuánto tardan. Ver "Corridas largas", abajo, si pasan de ~25 min. |

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
- iOS (simulador o build local): necesita macOS. El emulador de Android, salvo que haya `/dev/kvm`.

Antes de dejar fuera una app gráfica (Electron, Expo, un navegador), mira las secciones de abajo:
casi siempre hay algo que sí corre, y eso va en `notes` con ✅.
- Recursos de dominios externos cargados por Playwright (bug abierto, ver `knowledge.md`).

## Docker build en la nube

La CA del proxy entra al build como secreto, solo en la nube; el mismo `Dockerfile` sigue
funcionando en local y en la CI.

1. **Dónde está la CA:** el primero que exista de `CLOUD_PROXY_CA` (lo exporta
   `agent-cloud-kit session`), `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS` y
   `/root/.ccr/ca-bundle.crt`. Una sesión reanudada puede no tener `CLOUD_PROXY_CA`: por eso
   el orden.
2. **El script que construye**, solo con `CLAUDE_CODE_REMOTE=true`:

   ```bash
   secret=(); [ -n "$ca" ] && secret=(--secret "id=proxy_ca,src=$ca")
   docker buildx build ${secret[@]+"${secret[@]}"} --load -t "$ref" .
   ```

3. **El `Dockerfile`**, en cada `RUN` que baja algo (no solo el primero):

   ```dockerfile
   RUN --mount=type=secret,id=proxy_ca,required=false \
       if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi \
    && npm ci
   ```

   `required=false` hace que sin el secreto (local, CI) el build siga igual.
4. **Red:** una imagen basada en Debian necesita `deb.debian.org` y `security.debian.org` en
   `domains`. Nada que se baje de releases de GitHub dentro de la imagen.

## Corridas largas

Una suite de ~35 min corre entera en la nube (~4 vCPU). Cómo seguirla sin que se corte:

- **Lanzarla suelta:** un proceso aparte, en su propio grupo, con la salida a un log, que
  vuelve enseguida (p. ej. `setsid nohup <comando> > log 2>&1 &`, o un lanzador de Node con
  `detached: true` y `unref()`). Un candado por nombre evita dos corridas a la vez.
- **Seguirla:** con la herramienta Monitor sobre un comando que imprime una línea de avance
  por minuto y termina antes de los 30 min (el límite de Monitor); si sigue corriendo, se
  relanza. Decide por la última línea del log, no por el código de salida del `watch`.
- **Pararla:** SIGINT al grupo (como Ctrl-C), para que corran los `trap` que bajan Docker.
  Nunca `kill -9`. Como una corrida cortada deja contenedores, cada runner hace
  `docker compose down -v --remove-orphans` antes del `up`.
- **No cargar la máquina:** los tests de integración y e2e usan tiempos reales; mientras
  corren, nada pesado en paralelo (ni otros agentes).

## Electron

Sin pantalla, pero con Xvfb corre. Cada paso se prueba en `verify`; los hechos están en
`knowledge.md` ("Apps de escritorio y móviles"), casi todos por verificar.

1. **El binario:** la instalación lo baja de releases de GitHub y el proxy lo bloquea. En
   `setup`, antes de instalar, `export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
   y `npmmirror.com` y `cdn.npmmirror.com` en `domains`. Si el repo instala Electron aparte
   (p. ej. un script `install-electron`), ese paso necesita la misma variable.
2. **La pantalla:** en `apt`, `xvfb` y las librerías de Chromium (`libnss3`, `libgtk-3-0`,
   `libgbm1`, `libasound2t64`, `libxss1`, `libatk-bridge2.0-0`).
3. **Correrlo:** `xvfb-run -a <comando de Electron> --no-sandbox`. Para ver que arranca: que el
   proceso siga vivo unos segundos sin errores, o una captura (`import -window root` de
   ImageMagick, o Playwright).
4. **Tests e2e:** Playwright con `_electron.launch({ args: [".", "--no-sandbox"] })` bajo
   `xvfb-run`. Si el repo no los tiene, no los crees: propónlos.

Si `--no-sandbox` o el mirror requieren cambiar un script del repo, es una variante para la nube
(nivel 2) y necesita aprobación.

## Expo y React Native

| Qué | En la nube |
| --- | --- |
| Tests de componentes (`jest-expo`, Testing Library) | Corren tal cual. |
| `npx expo-doctor`, `npx expo prebuild --no-install`, `npx expo export --platform android` (o `ios`) | Corren: comprueban la config y que Metro compila el bundle, sin simulador. Con `EXPO_OFFLINE=1` si no hay red a `api.expo.dev`. |
| Expo web (`react-native-web`) | `npx expo export --platform web` y Playwright contra el resultado servido en `127.0.0.1`, o `npx expo start --web`. Los módulos solo de iOS pueden romper la versión web: anótalo. |
| Build de Android | Necesita el Android SDK en `setup` (`dl.google.com` en `domains`); suele pasar los ~5 min. Mejor fuera, o en EAS. |
| Emulador de Android | Solo con `/dev/kvm` (`ls /dev/kvm`); si no está, fuera. |
| iOS (simulador, `expo run:ios`, build) | Fuera: necesita macOS. Alternativa: build remoto en EAS con `EXPO_TOKEN`. |

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
