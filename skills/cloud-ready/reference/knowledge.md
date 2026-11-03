# Lo que se sabe de la nube de Claude Code

Cada hecho lleva su estado: `verificado` (alguien lo vio, con la fuente) o `por verificar`. Si
en una sesión ves algo que no está aquí o que lo contradice, va a "Hallazgos" de
`docs/agent-cloud.md`, marcado "proponer al paquete" (ver `SKILL.md`). "README" es el README del
paquete `agent-cloud-kit`; "prueba en la nube, 2026-11-02" son sesiones de prueba del paquete en
claude.ai/code.

## Máquina y setup

| Hecho | Estado | Fuente |
| --- | --- | --- |
| El setup script del entorno corre como root desde `/home/user` (no desde el repo), antes de que empiece Claude; si falla, no avisa. El repo queda en `/home/user/<repo>`. | verificado | README ("What it solves"); Prueba en la nube, 2026-11-02 |
| Un setup de más de ~5 min no deja máquina guardada: cada sesión arranca de cero. Cada paso de `setup` del paquete tiene 180 s. | verificado | README ("What it solves") |
| La máquina guardada se rehace cada ~7 días o al editar el setup script o la red. Cambiar `.claude/cloud.json` no la rehace; para forzarla, edita el setup script (p. ej. un comentario con la fecha). | verificado | README ("Machine fingerprint") |
| Una sesión reanudada no vuelve a correr el setup; los cambios del entorno se prueban con una sesión nueva. | verificado | README ("What it does not do") |
| Las variables del panel del entorno llegan a la sesión, pero no al setup script. | por verificar | Sin comprobar en la prueba en la nube, 2026-11-02 (hace falta editar un entorno en claude.ai) |
| El `node_modules` que instala el setup sigue ahí en la sesión: el `bun install` o `npm ci` en frío va en el setup, no en `session`. | verificado | Medido en una sesión en la nube, 2026-10 |
| Las variables del entorno las puede leer cualquiera que use ese entorno. | verificado | README ("What it does not do") |
| La imagen trae Node 22 por defecto (`/opt/node22`), también `/opt/node24`, y navegadores de Playwright en `/opt/pw-browsers`. | verificado (prueba en la nube, 2026-11-02) | Prueba en la nube, 2026-11-02 |
| `dockerd` viene apagado y el clon es parcial (sin historial completo ni `origin/<rama por defecto>`); `agent-cloud-kit session` prende Docker y completa el clon. Docker funciona dentro de la sesión. | verificado | README ("What it solves") |
| La VM es Ubuntu 24.04 x86_64 con ~4 vCPU, 16 GB de RAM y 30 GB de disco; el setup corre como root, así que `apt install` funciona. | verificado | Documentación de Claude Code ("Configure cloud environments"), 2026-11-03 |
| La imagen trae Chrome for Testing (`/usr/bin/google-chrome`, `CHROME_PATH`), OpenJDK 21 con Maven y Gradle, PostgreSQL 16 y Redis 7. No trae Android SDK, emulador ni Xvfb. | verificado | Documentación de Claude Code ("Configure cloud environments"), 2026-11-03 |
| No hay pantalla (`DISPLAY` vacío): una app gráfica necesita Xvfb (`apt install xvfb`, `xvfb-run -a …`). | por verificar | Ubuntu sin escritorio; no probado en la nube |
| La documentación advierte que Bun tiene problemas con el proxy. Bun 1.4.0 o más nuevo codifica bien las credenciales del proxy, y `bun install --frozen-lockfile` con Bun 1.4.2 funcionó en el setup: el problema es de versiones anteriores. En repos grandes `bun install` puede colgarse (`anthropics/claude-code#14926`): ponle `timeout`. | verificado | Documentación de Claude Code, 2026-11-03; Sesión en la nube, 2026-10 |
| Un setup script con una ruta relativa falla con salida 127 y la sesión arranca igual, sin aviso. El campo no debe llevar rutas del repo: `npx -y agent-cloud-kit@<versión> setup` lee la config de cada repo en `/home/user`. | verificado | Sesión en la nube, 2026-10 |
| Tiempos medidos: setup con todo en paralelo (Node, Bun, apt, imágenes de Docker, Playwright) 37–77 s; con un `bun install` en frío, ~1,5 min. Un hook SessionStart que instala, completa el clon y trae `origin/<rama por defecto>`, ~18 s. | verificado | Sesión en la nube, 2026-10 |
| La máquina guardada es una copia del disco: lo que el setup escribe (también bajo `/opt`) queda; los procesos que dejó corriendo, no. | verificado | Documentación de Claude Code, 2026-11-03 |
| La CA del proxy está en `/root/.ccr/ca-bundle.crt` cuando `SSL_CERT_FILE` y `NODE_EXTRA_CA_CERTS` no están. | por verificar | Usado como respaldo en un repo en la nube, 2026-10 |
| Una sesión reanudada puede no tener lo que un hook anterior exportó en `$CLAUDE_ENV_FILE` (p. ej. `CLOUD_PROXY_CA`): los scripts deben volver a buscarlo. | por verificar | Sesión en la nube, 2026-10 |
| Las imágenes de Docker basadas en Debian necesitan `deb.debian.org` y `security.debian.org` en `domains`: la lista por defecto solo trae los mirrors de Ubuntu. | verificado | Sesión en la nube, 2026-10 |
| Dos `apt` a la vez chocan en el lock de dpkg. | verificado | README ("What it solves") |
| `CLAUDE_CODE_SYNC_SKILLS=1` y `CLAUDE_CODE_SYNC_PLUGINS=1` están definidas; qué sincronizan no se sabe. | por verificar | Variables vistas en la prueba en la nube, 2026-11-02 |

## Red

| Hecho | Estado | Fuente |
| --- | --- | --- |
| La red *Custom* sin la casilla "Also include default list of common package managers" bloquea npm (DNS o `CONNECT 403`). | verificado | README ("Set up claude.ai"); sesión en la nube, 2026-10 |
| El proxy bloquea los releases de GitHub y la API GraphQL; la API REST (`api.github.com`) pasa. | verificado (prueba en la nube, 2026-11-02) | Prueba en la nube, 2026-11-02 |
| El tráfico a GitHub pasa por un proxy propio, no por la lista de red: sirve solo los repos de la sesión. Una descarga de otro repo (releases, `archive/`, `codeload`) da 403 aunque `github.com` esté en la lista por defecto. Por eso fallan los binarios que se bajan de releases de GitHub (Electron, Bun desde `bun.sh/install`, algunos CLIs). Los archivos de repos públicos sí pasan por `raw.githubusercontent.com`, y jsDelivr (`cdn.jsdelivr.net`, `data.jsdelivr.com`, agregándolos) sirve de mirror; jsDelivr quita la `v` de los tags (`v7.0.0` es `7.0.0`). | verificado | Documentación de Claude Code ("Configure cloud environments"), 2026-11-03; prueba en la nube, 2026-11-02 |
| Un host propio (también detrás de Cloudflare) responde desde la nube en cuanto se agrega a `domains`. | verificado | Sesión en la nube, 2026-10 |
| Los "network secrets" del entorno solo agregan cabeceras a los pedidos: una credencial que va en el cuerpo (p. ej. el login de un CLI de secretos) tiene que ser una variable de entorno. Cambiar variables pide una sesión nueva. | verificado | Documentación de Claude Code, 2026-11-03 |
| El proxy reemplaza el TLS: `HTTPS_PROXY`, `NO_PROXY`, `SSL_CERT_FILE` y `NODE_EXTRA_CA_CERTS` vienen definidas. `docker build` no confía en su CA: pásala como secreto con `CLOUD_PROXY_CA` (lo exporta `agent-cloud-kit session`). | verificado (prueba en la nube, 2026-11-02) | Prueba en la nube, 2026-11-02; README ("The proxy CA") |
| No hay IPv6. | verificado | README ("What it solves") |
| En tests, `127.0.0.1` es más seguro que `localhost` (que puede resolver a `::1`): sin IPv6, la búsqueda de puertos libres de Bun falló en un e2e. | verificado | Visto en una sesión en la nube, 2026-10 |
| No hay puertos abiertos ni vista previa: la app no se ve en un navegador externo. Playwright sí corre dentro de la sesión, contra `localhost`. | verificado | README ("What it does not do"); sesión en la nube, 2026-10 |
| Playwright no carga recursos de dominios externos en la página. | verificado | Bug abierto `anthropics/claude-code#11791` |

## GitHub

| Hecho | Estado | Fuente |
| --- | --- | --- |
| `gh` 2.89 está instalado. `gh auth status` dice que `GH_TOKEN` es inválido (`GH_TOKEN=proxy-…`), pero `gh api` REST funciona: el proxy pone la credencial. | verificado (prueba en la nube, 2026-11-02) | Prueba en la nube, 2026-11-02 |
| `gh pr …` y `gh issue …` fallan con 403 porque usan GraphQL: usa `gh api` (REST). | verificado (prueba en la nube, 2026-11-02) | Prueba en la nube, 2026-11-02 |
| `gh pr ready` no funciona (GraphQL). Para draft/ready y auto-merge habría rutas REST: `POST /repos/{o}/{r}/pulls/{n}/ccr/ready_for_review`, `…/ccr/convert_to_draft`, `PUT\|DELETE …/ccr/auto_merge`, `GET …/ccr/review_threads`. | por verificar | Mensaje del 403 de GraphQL en la nube (2026-11), ruta no probada |
| El 403 de GraphQL dice `GitHub GraphQL is not available from Claude Code sessions`; también bloquea `gh api graphql`. | verificado | Sesión en la nube, 2026-10 |
| El `origin` del clon es el proxy local de git: `http://local_proxy@127.0.0.1:<puerto>/git/<owner>/<repo>`. Lo que espera una URL de github.com se rompe; tomar las dos últimas partes de la ruta funciona. | verificado | Sesión en la nube, 2026-10 |
| Por REST funcionan: crear un PR (`POST repos/{o}/{r}/pulls` con `-F draft=true`), editarlo (`PATCH pulls/{n}`), comentar, asignar (`POST issues/{n}/assignees`). Salen con la cuenta del usuario. | verificado | Sesión en la nube, 2026-10 |
| `gh api user` (y `@me`) puede fallar porque no es una ruta de un repo: avisa y sigue. `gh extension install <owner/repo>` falla (otro repo); una herramienta así va como paquete npm. | por verificar | Sesión en la nube, 2026-10 |
| El clon trae solo la rama de la sesión: `git fetch origin <rama>` no crea `origin/<rama>`. Pasa el refspec: `git fetch -q origin <rama>:refs/remotes/origin/<rama>` (o `'+refs/heads/*:refs/remotes/origin/*'` para todas). También es superficial: lo que mira el historial (p. ej. un escáner de secretos en los tests) ve todo como agregado en el primer commit hasta un `git fetch --unshallow` (lo hace `agent-cloud-kit session`). | verificado | Sesión en la nube, 2026-10 |
| La sesión trabaja en su propia rama `claude/<slug>`, parte del commit de la rama local desde la que se lanzó (`CLAUDE_CODE_BASE_REF`) y puede empujar a otra rama: `git push origin HEAD:<rama>`. | verificado (prueba en la nube, 2026-11-02) | Prueba en la nube, 2026-11-02 |
| Sin el Claude GitHub App instalado en el repo, `claude --cloud` sube una copia local y la sesión no puede empujar. | verificado | Visto en una sesión en la nube, 2026-10 |

## Claude Code

| Hecho | Estado | Fuente |
| --- | --- | --- |
| Claude Code no descubre `.agents/skills/`, ni en local ni en la nube. Hace falta el symlink `.claude/skills/<nombre> -> ../../.agents/skills/<nombre>` (lo crea `agent-cloud-kit init`). | verificado (prueba en la nube, 2026-11-02) | Prueba en la nube, 2026-11-02 |
| Los plugins de la máquina local no llegan a la nube. Se pueden instalar en el setup (un marketplace local y `claude plugin install <p>@<mkt> --scope user`): skills y comandos funcionan, pero los hooks de plugins nunca corren en la nube, solo los del repo. Copiar las skills al repo es más simple y no depende de la red. | verificado | README ("What it does not do"); Sesión en la nube, 2026-10 |
| El hook SessionStart corre al empezar y al reanudar (el setup, solo en sesiones nuevas). Lo que imprime en stdout entra al contexto de Claude; stderr no llega. Un hook del repo con `"timeout": 600` alcanza para preparar la sesión. | verificado | Sesión en la nube, 2026-10 |
| Los comandos de Bash de Claude corren en shells no interactivos: los hooks de shell (p. ej. direnv) no se disparan. Lo que deban ver se exporta en `$CLAUDE_ENV_FILE` desde el hook SessionStart. | verificado | Sesión en la nube, 2026-10 |
| Un hook SessionStart de una rama corre sin pedir confianza: abrir una sesión en la rama de otro ejecuta su código. Para revisar PRs ajenos: `claude --settings '{"disableAllHooks": true}'`. | verificado | Funcionamiento de los hooks |
| `/code-review` choca con una skill integrada del mismo nombre: en la nube gana la integrada. Una skill copiada al repo no debería llamarse igual que una integrada. | verificado | Sesión en la nube, 2026-10 |
| `CLAUDE_CODE_REMOTE_SESSION_ID` vale `cse_<id>`; el enlace es `https://claude.ai/code/session_<id>` (mismo sufijo). `claude --teleport session_<id>` la retoma desde otra máquina. | verificado | Sesión en la nube, 2026-10 |
| `/remote-env` guarda el entorno en `remote.defaultEnvironmentId` de la configuración del usuario. Los entornos self-hosted piden plan Team o Enterprise. | verificado | Documentación de Claude Code, 2026-11-03 |
| `claude --cloud` usa el entorno elegido con `/remote-env` (queda en la configuración del usuario). | verificado | Visto en una sesión en la nube, 2026-10 |
| `--environment` de `claude --cloud` solo acepta entornos self-hosted (`ccpool_…`). | verificado (prueba en la nube, 2026-11-02) | `claude --help` |
| `claude --cloud <prompt>` exige una terminal interactiva (con la salida a un pipe se niega; corre en primer plano); toma el texto como primer mensaje (un `/skill args` funciona), imprime la URL de la sesión y el comando `claude --teleport`, y vuelve. No tiene opción de rama: clona la rama en la que está el checkout local. | verificado (prueba en la nube, 2026-11-02) | Prueba en la nube, 2026-11-02 |
| Una suite de ~35 min corre entera en la nube, en segundo plano y seguida por su log. | verificado | Medido en una sesión en la nube, 2026-10 |
| El teleport es de ida: pide el árbol limpio y la misma cuenta; lo hecho en local no vuelve a la sesión en la nube. Desde la terminal no se ve la conversación: solo se manda un mensaje con `claude -p "<mensaje>" --cloud <id>`. | verificado | Documentación de Claude Code, 2026-11-03 |
| La herramienta Monitor se corta a los 30 min: una corrida más larga se sigue en tramos (p. ej. `watch` de 25 min que se relanza). En la nube, mejor eso que un `run_in_background` largo. | por verificar | Sesión en la nube, 2026-10 |
| La sesión se pausa tras unos minutos sin actividad y la VM se apaga sola; no se sabe si un proceso en segundo plano cuenta como actividad. | por verificar | Documentación de Claude Code, 2026-11-03 |
| Un comando de la herramienta Bash se corta a los 2 min por defecto (10 como máximo). Para corridas largas: en segundo plano, o subir `BASH_DEFAULT_TIMEOUT_MS` y `BASH_MAX_TIMEOUT_MS` en las variables del entorno (p. ej. `3600000`). | verificado | Documentación de Claude Code (configuración); sesión en la nube, 2026-10 (suite de ~35 min) |

## Apps de escritorio y móviles

"No hay pantalla" no significa "no corre": casi siempre se puede probar algo. Cómo, en
`compat.md` ("Electron" y "Expo y React Native").

| Hecho | Estado | Fuente |
| --- | --- | --- |
| Electron corre sin pantalla con Xvfb: `xvfb-run -a electron . --no-sandbox` (`--no-sandbox` porque la sesión es root). Playwright lo controla con `_electron.launch` y saca capturas. | por verificar | Guías de CI de Electron con Playwright (Linux); no probado en la nube |
| El binario de Electron se baja de releases de GitHub al instalar (`electron/install.js`): falla por el proxy de GitHub. Salidas: `ELECTRON_MIRROR` a un mirror fuera de GitHub (p. ej. `https://npmmirror.com/mirrors/electron/`, con `npmmirror.com` y `cdn.npmmirror.com` en `domains`), o `ELECTRON_SKIP_BINARY_DOWNLOAD=1` si los tests no abren Electron. | por verificar | Documentación de Electron ("Advanced Installation"); proxy de GitHub (arriba) |
| Expo: `jest-expo`, `expo-doctor`, `expo export` (web, o el bundle de Android/iOS sin compilar) y `expo prebuild` no necesitan simulador. `EXPO_OFFLINE=1` evita que el CLI consulte `api.expo.dev`. | por verificar | Documentación de Expo; no probado en la nube |
| Expo web (si el repo usa `react-native-web`) se prueba con Playwright y el Chrome de la imagen, contra `localhost`. Los módulos solo de iOS (p. ej. `expo-symbols`, `expo-glass-effect`, `@expo/ui`) pueden no tener versión web. | por verificar | Documentación de Expo; no probado en la nube |
| iOS (simulador o build) nunca corre en la nube: necesita macOS y Xcode. Se puede lanzar un build remoto en EAS con `EXPO_TOKEN` en `requiredEnv` y `expo.dev` en `domains`. | verificado (iOS), por verificar (EAS) | Requisito de Xcode; documentación de EAS |
| El emulador de Android necesita `/dev/kvm` (virtualización anidada); sin eso es inusable. Compilar el APK necesita el Android SDK (`dl.google.com` en `domains`) y suele pasar los ~5 min del setup. Compruébalo con `ls /dev/kvm`. | por verificar | Guías de CI de Android; no probado en la nube |

