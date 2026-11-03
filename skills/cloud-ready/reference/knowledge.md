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
| Bun tiene problemas conocidos con el proxy al bajar paquetes; si `bun install` falla en el setup, es eso. | verificado | Documentación de Claude Code ("Configure cloud environments"), 2026-11-03 |
| Dos `apt` a la vez chocan en el lock de dpkg. | verificado | README ("What it solves") |
| `CLAUDE_CODE_SYNC_SKILLS=1` y `CLAUDE_CODE_SYNC_PLUGINS=1` están definidas; qué sincronizan no se sabe. | por verificar | Variables vistas en la prueba en la nube, 2026-11-02 |

## Red

| Hecho | Estado | Fuente |
| --- | --- | --- |
| La red *Custom* sin la casilla "Also include default list of common package managers" bloquea npm (DNS o `CONNECT 403`). | verificado | README ("Set up claude.ai"); sesión en la nube, 2026-10 |
| El proxy bloquea los releases de GitHub y la API GraphQL; la API REST (`api.github.com`) pasa. | verificado (prueba en la nube, 2026-11-02) | Prueba en la nube, 2026-11-02 |
| El tráfico a GitHub pasa por un proxy propio, no por la lista de red: sirve solo los repos de la sesión. Una descarga de otro repo (releases, `archive/`, `codeload`) da 403 aunque `github.com` esté en la lista por defecto. Por eso fallan los binarios que se bajan de releases de GitHub (Electron, algunos CLIs). | verificado | Documentación de Claude Code ("Configure cloud environments"), 2026-11-03; prueba en la nube, 2026-11-02 |
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
| La sesión trabaja en su propia rama `claude/<slug>`, parte del commit de la rama local desde la que se lanzó (`CLAUDE_CODE_BASE_REF`) y puede empujar a otra rama: `git push origin HEAD:<rama>`. | verificado (prueba en la nube, 2026-11-02) | Prueba en la nube, 2026-11-02 |
| Sin el Claude GitHub App instalado en el repo, `claude --cloud` sube una copia local y la sesión no puede empujar. | verificado | Visto en una sesión en la nube, 2026-10 |

## Claude Code

| Hecho | Estado | Fuente |
| --- | --- | --- |
| Claude Code no descubre `.agents/skills/`, ni en local ni en la nube. Hace falta el symlink `.claude/skills/<nombre> -> ../../.agents/skills/<nombre>` (lo crea `agent-cloud-kit init`). | verificado (prueba en la nube, 2026-11-02) | Prueba en la nube, 2026-11-02 |
| Los plugins de la máquina local no llegan a la nube, ni sus hooks: las skills deben estar copiadas en el repo. | verificado | README ("What it does not do") |
| `claude --cloud` usa el entorno elegido con `/remote-env` (queda en la configuración del usuario). | verificado | Visto en una sesión en la nube, 2026-10 |
| `--environment` de `claude --cloud` solo acepta entornos self-hosted (`ccpool_…`). | verificado (prueba en la nube, 2026-11-02) | `claude --help` |
| `claude --cloud <prompt>` exige una terminal interactiva; toma el texto como primer mensaje, imprime la URL de la sesión y el comando `claude --teleport`, y vuelve. | verificado (prueba en la nube, 2026-11-02) | Prueba en la nube, 2026-11-02 |
| Una suite de ~35 min corre entera en la nube, en segundo plano y seguida por su log. | verificado | Medido en una sesión en la nube, 2026-10 |
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

