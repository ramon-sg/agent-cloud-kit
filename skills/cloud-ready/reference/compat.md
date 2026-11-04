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
| Playwright | En `setup`, después de instalar las dependencias: `npx playwright install --with-deps chromium` desde la carpeta que declara `@playwright/test` (así usa la versión instalada; el rango de `package.json` no es la versión exacta). Chromium baja de `cdn.playwright.dev`; los otros navegadores pueden usar `playwright.download.prss.microsoft.com`: los dos en `domains`. Baja a `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH` ya apunta ahí). La imagen trae los de Playwright 1.63: con otra versión, o se agregan los dominios y se instala, o se usa el Chrome de la imagen (`launchOptions: { executablePath: process.env.CHROME_PATH }`, que no necesita red; es un cambio de config: con aprobación). `--with-deps` usa apt: después de los pasos de apt, nunca a la vez. Corre contra el servidor local de la sesión. |
| `localhost` en URLs de tests o servicios | No hay IPv6. El servidor escucha en `127.0.0.1`. La URL del navegador puede quedar en `localhost` (Chromium prueba `::1` y luego `127.0.0.1`; así pasó un e2e en la nube), y debe quedar así si el framework reescribe el host: Next (`NextURL`) cambia `127.0.0.1` por `localhost` en las redirecciones, el origen cambia y se pierden las cookies. Un buscador de puertos libres pide el `0` en `127.0.0.1` y prueba el mismo en `::1`; trata como "sin IPv6" un error sin `code` (Bun), `EADDRNOTAVAIL` o `EAFNOSUPPORT` (Node). |
| Variables secretas (API keys de prueba) | Nombres en `requiredEnv`; el usuario pone los valores en el entorno de claude.ai. Recuerda que las lee cualquiera que use el entorno. |
| Hosts externos que el setup o los tests necesitan | En `domains`; el manual los lista para la red del entorno. |
| Electron | Ver "Electron", abajo: corre con `xvfb-run -a … --no-sandbox`; la imagen ya trae Xvfb. |
| Expo o React Native | Ver "Expo y React Native", abajo: casi todo menos el simulador corre. |
| Instalar herramientas en el setup | Los releases públicos de GitHub se bajan; lo que da 403 es la API, `archive/` y `codeload` de otros repos. Node: de `nodejs.org`. Bun, pnpm, Yarn: de npm (lo hace el paquete). Un CLI cuyo paquete npm baja de releases: el repo apt del proveedor (`aptRepos`). Dentro de una imagen, no `curl … \| sh` de GitHub: copia el binario de la imagen oficial fijada por digest (`COPY --from=oven/bun:<v>@sha256:<d> /usr/local/bin/bun /usr/local/bin/bun`; `bunx` es un symlink y no viene, y para musl va la etiqueta `-alpine`). |
| Instalación pesada (dependencias en frío, navegadores) | En `setup`, no en `session` (cada paso de `session` se corta a los 2 min, con SIGKILL al grupo: no corren los `trap`). Lo independiente va en paralelo en un script del repo llamado desde `setup` (`cmd1 & cmd2 &`, `wait` de cada uno, sale con 1 si alguno falló). Si `session` reinstala, con `timeout` (manda SIGTERM, a diferencia del corte del paquete) y una marca (`touch node_modules/.instalado`) que solo se escribe si terminó bien. |
| Hook SessionStart propio del repo | Nunca hace fallar el inicio (`set -uo pipefail` sin `-e`, cada paso `\|\| aviso`, `exit 0` al final), avisa por stdout (stderr no llega a Claude), revisa lo que dejaron los pasos de `session` (la marca de instalación) y exporta variables en `$CLAUDE_ENV_FILE` solo si el comando que las generó terminó bien (p. ej. un `direnv export` fallido imprime `unset …` y borraría variables). Su `timeout` por defecto ya es 600 s. |
| Corridas largas (más de 2 min) | En segundo plano con la salida a un log. En la nube, un comando en segundo plano tiene 30 min por defecto (hasta 2 h con `timeout`); `BASH_DEFAULT_TIMEOUT_MS` y `BASH_MAX_TIMEOUT_MS` en las variables del entorno lo cambian. Anota en `notes` cuánto tardan. Ver "Corridas largas", abajo, si pasan de ~25 min. |

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
- iOS (simulador o build local): necesita macOS. El emulador de Android: la VM no tiene `/dev/kvm`.
- Sitios HTTPS externos abiertos con Playwright (bug abierto, ver `knowledge.md`).

Antes de dejar fuera una app gráfica (Electron, Expo, un navegador), mira las secciones de abajo:
casi siempre hay algo que sí corre, y eso va en `notes` con ✅.

## Docker build en la nube

La CA del proxy entra al build como secreto, solo en la nube; el mismo `Dockerfile` sigue
funcionando en local y en la CI.

1. **Dónde está la CA:** el primero que exista de `CLOUD_PROXY_CA` (lo exporta
   `agent-cloud-kit session`), `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS` y
   `/root/.ccr/ca-bundle.crt` (a donde apunta `SSL_CERT_FILE`). Por si una sesión reanudada
   no tiene `CLOUD_PROXY_CA`, se busca en ese orden.
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

   Sin el secreto (local, CI) el build sigue igual: `required=false` es el valor por defecto y
   se deja explícito por claridad. Las dos variables hacen falta: Node y npm leen
   `NODE_EXTRA_CA_CERTS` (no `SSL_CERT_FILE`); Bun lee `SSL_CERT_FILE`.
4. **Red:** una imagen basada en Debian funcionó con `deb.debian.org` y `security.debian.org`
   en `domains` (la lista por defecto no trae los mirrors de Debian).

## Corridas largas

Una suite de ~35 min corre entera en la nube (~4 vCPU). Cómo seguirla sin que se corte (la
técnica está diseñada, pero todavía no se probó entera en la nube):

- **Lanzarla suelta:** un proceso aparte, en su propio grupo, con la salida a un log, que
  vuelve enseguida (p. ej. `setsid nohup <comando> > log 2>&1 &`, o un lanzador de Node con
  `detached: true` y `unref()`). Un candado por nombre evita dos corridas a la vez. Si eso la
  saca del límite de 30 min de los comandos en segundo plano de Claude no está comprobado.
- **Seguirla:** con la herramienta Monitor sobre un comando que imprime una línea de avance
  por minuto y termina antes de los 30 min (el límite de Monitor); si sigue corriendo, se
  relanza. Decide por la última línea del log, no por el código de salida del `watch`.
- **Pararla:** SIGTERM al grupo (`kill -TERM -- -<pgid>`), con `trap … INT TERM` en el runner
  para que bajen Docker. Un proceso lanzado con `&` desde una shell no interactiva (la de
  Claude) ignora SIGINT y su `trap INT` no corre; SIGINT solo sirve si lo lanzó un lanzador de
  Node. Nunca `kill -9`. Como una corrida cortada deja contenedores, cada runner hace
  `docker compose down -v --remove-orphans` antes del `up`.
- **No cargar la máquina:** los tests de integración y e2e usan tiempos reales; mientras
  corren, nada pesado en paralelo (ni otros agentes).

## Electron

Probado en la nube el 2026-11-03 con Electron 45 (`knowledge.md`, "Apps de escritorio y
móviles"). La imagen ya trae Xvfb y las librerías de Chromium: no hace falta `apt`.

1. **El binario:** se baja de releases de GitHub sin nada especial. Desde Electron 42 se baja
   al primer uso: en `setup`, después de instalar las dependencias,
   `node node_modules/electron/install.js`, para que la sesión ya lo tenga. Si el repo tiene su
   propio paso (p. ej. un script que corre `install-electron`), sirve ese. Solo si GitHub
   fallara: `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`, con `npmmirror.com` y
   `cdn.npmmirror.com` en `domains`.
2. **Correrlo:** `xvfb-run -a <comando de Electron> --no-sandbox`. Sin `--no-sandbox` se cae
   (la sesión es root); sin Xvfb, `Missing X server or $DISPLAY`. Los errores de `dbus` y el
   aviso de `--use-openssl-ca` del log son ruido.
3. **Ver que arranca:** una captura con Playwright (`page.screenshot`) o `import -window root`
   dentro del mismo `xvfb-run` (fuera no hay `DISPLAY`):
   `xvfb-run -a sh -c '<app> --no-sandbox & sleep 5; import -window root captura.png'`.
   `webContents.capturePage()` no sirve (`UnknownVizError`).
4. **Tests e2e:** Playwright con
   `_electron.launch({ args: ["<main>", "--no-sandbox"] })` bajo `xvfb-run -a` (no necesita
   navegadores de Playwright). Si el repo no los tiene, no los crees: propónlos.

`--no-sandbox` y `xvfb-run` van en el comando que lanza Electron en la nube. Si eso cambia un
script del repo, que sea según la capacidad (sin `DISPLAY`, `xvfb-run`; como root,
`--no-sandbox`) y con aprobación.

## Expo y React Native

| Qué | En la nube |
| --- | --- |
| Tests de componentes (`jest-expo`, Testing Library) | Corren tal cual, sin red extra. |
| `npx expo export --platform android` (o `ios`, o `web`), `npx expo prebuild --no-install` | Corren sin simulador ni red extra (~30 s cada export): comprueban que Metro compila el bundle y que la config genera los proyectos nativos. `EXPO_OFFLINE=1` en el export evita llamadas a Expo. `prebuild` escribe `android/` e `ios/` y cambia `app.json` y `package.json`: no lo dejes en el árbol si el repo no lo versiona. |
| `npx expo-doctor` | Sin red a Expo sale con 1, aun con `EXPO_OFFLINE=1` o `EXPO_DOCTOR_WARN_ON_NETWORK_ERRORS=1`. Necesita `exp.host`, `api.expo.dev` y `reactnative.directory` en `domains` (con ellos no se probó): si el repo lo corre en sus tests, agrégalos o anótalo en `notes` con ⏳. |
| Expo web (`react-native-web`) | `npx expo export --platform web` y Playwright contra el resultado servido en `127.0.0.1` (o `npx expo start --web`, que sirve en `:8081`). Con el Chrome de la imagen no necesita red. En web, `GlassView` es un `View` común; `SymbolView` con nombre para web dibuja el ícono (la fuente viene en el bundle) y con solo un nombre de SF Symbols, su `fallback`. Las APIs `@expo/ui/swift-ui` y Compose no tienen web. |
| Build de Android | Hoy no corre: Gradle falla resolviendo plugins porque Maven Central responde 429 a lo que no tiene (IP compartida) y `maven.google.com` redirige a `dl.google.com`, que no viene en la lista por defecto. Con solo agregar `dl.google.com`, el 429 seguiría (no probado). Déjalo fuera, o en EAS, y anótalo en `notes`. |
| Emulador de Android | Fuera: la VM no tiene `/dev/kvm`. |
| iOS (simulador, `expo run:ios`, build) | Fuera: necesita macOS. Alternativa: build remoto en EAS con `EXPO_TOKEN` en `requiredEnv` y `expo.dev` y `api.expo.dev` en `domains`. |

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
