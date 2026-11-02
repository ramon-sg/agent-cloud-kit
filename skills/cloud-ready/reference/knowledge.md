# Lo que se sabe de la nube de Claude Code

Cada hecho lleva su estado: `verificado` (alguien lo vio, con la fuente) o `por verificar`. Si
en una sesión ves algo que no está aquí o que lo contradice, va a "Hallazgos" de
`docs/agent-cloud.md`, marcado "proponer al paquete" (ver `SKILL.md`). Las fuentes que nombran
`README` o `docs/cloud-cli.md` son del paquete `agent-cloud-kit`.

## Máquina y setup

| Hecho | Estado | Fuente |
| --- | --- | --- |
| El setup script del entorno corre como root desde `/home/user` (no desde el repo), antes de que empiece Claude; si falla, no avisa. El repo queda en `/home/user/<repo>`. | verificado | README ("What it solves"); `docs/cloud-cli.md` |
| Un setup de más de ~5 min no deja máquina guardada: cada sesión arranca de cero. Cada paso de `setup` del paquete tiene 180 s. | verificado | README ("What it solves") |
| La máquina guardada se rehace cada ~7 días o al editar el setup script o la red. Cambiar `.claude/cloud.json` no la rehace; para forzarla, edita el setup script (p. ej. un comentario con la fecha). | verificado | README ("Machine fingerprint") |
| Una sesión reanudada no vuelve a correr el setup; los cambios del entorno se prueban con una sesión nueva. | verificado | README ("What it does not do") |
| Las variables del panel del entorno llegan a la sesión, pero no al setup script. | por verificar | `docs/cloud-cli.md` (pregunta 7: hace falta editar un entorno en claude.ai) |
| El `node_modules` que instala el setup sigue ahí en la sesión. | por verificar | `docs/cloud-cli.md` (pregunta 8); un repo en uso lo midió en 2026-10 |
| Las variables del entorno las puede leer cualquiera que use ese entorno. | verificado | README ("What it does not do") |
| La imagen trae Node 22 por defecto (`/opt/node22`), también `/opt/node24`, y navegadores de Playwright en `/opt/pw-browsers`. | verificado (Tarea 1, 2026-11) | `docs/cloud-cli.md` |
| `dockerd` viene apagado y el clon es parcial (sin historial completo ni `origin/<rama por defecto>`); `agent-cloud-kit session` prende Docker y completa el clon. Docker funciona dentro de la sesión. | verificado | README ("What it solves") |
| Dos `apt` a la vez chocan en el lock de dpkg. | verificado | README ("What it solves") |
| `CLAUDE_CODE_SYNC_SKILLS=1` y `CLAUDE_CODE_SYNC_PLUGINS=1` están definidas; qué sincronizan no se sabe. | por verificar | `docs/cloud-cli.md` |

## Red

| Hecho | Estado | Fuente |
| --- | --- | --- |
| La red *Custom* sin la casilla "Also include default list of common package managers" bloquea npm (DNS o `CONNECT 403`). | verificado | README ("Set up claude.ai"); un repo en uso, 2026-10 |
| El proxy bloquea los releases de GitHub y la API GraphQL; la API REST (`api.github.com`) pasa. | verificado (Tarea 1, 2026-11) | `docs/cloud-cli.md` (pregunta 9) |
| El proxy reemplaza el TLS: `HTTPS_PROXY`, `NO_PROXY`, `SSL_CERT_FILE` y `NODE_EXTRA_CA_CERTS` vienen definidas. `docker build` no confía en su CA: pásala como secreto con `CLOUD_PROXY_CA` (lo exporta `agent-cloud-kit session`). | verificado (Tarea 1, 2026-11) | `docs/cloud-cli.md`; README ("The proxy CA") |
| No hay IPv6. | verificado | README ("What it solves") |
| En tests, `127.0.0.1` es más seguro que `localhost` (que puede resolver a `::1`). | por verificar | Consecuencia de no tener IPv6 |
| No hay puertos abiertos ni vista previa: la app no se ve en un navegador externo. Playwright sí corre dentro de la sesión, contra `localhost`. | verificado | README ("What it does not do"); un repo en uso, 2026-10 |
| Playwright no carga recursos de dominios externos en la página. | verificado | Bug abierto `anthropics/claude-code#11791` |

## GitHub

| Hecho | Estado | Fuente |
| --- | --- | --- |
| `gh` 2.89 está instalado. `gh auth status` dice que `GH_TOKEN` es inválido (`GH_TOKEN=proxy-…`), pero `gh api` REST funciona: el proxy pone la credencial. | verificado (Tarea 1, 2026-11) | `docs/cloud-cli.md` (pregunta 9) |
| `gh pr …` y `gh issue …` fallan con 403 porque usan GraphQL: usa `gh api` (REST). | verificado (Tarea 1, 2026-11) | `docs/cloud-cli.md` (pregunta 9) |
| `gh pr ready` no funciona. Para draft/ready y auto-merge hay rutas REST: `POST /repos/{o}/{r}/pulls/{n}/ccr/ready_for_review`, `…/ccr/convert_to_draft`, `PUT\|DELETE …/ccr/auto_merge`, `GET …/ccr/review_threads`. | verificado (Tarea 1, 2026-11) | `docs/cloud-cli.md` (pregunta 9) |
| La sesión trabaja en su propia rama `claude/<slug>`, parte del commit de la rama local desde la que se lanzó (`CLAUDE_CODE_BASE_REF`) y puede empujar a otra rama: `git push origin HEAD:<rama>`. | verificado (Tarea 1, 2026-11) | `docs/cloud-cli.md` (preguntas 2 y 5) |
| Sin el Claude GitHub App instalado en el repo, `claude --cloud` sube una copia local y la sesión no puede empujar. | verificado | `docs/cloud-cli.md` (pregunta 3) |

## Claude Code

| Hecho | Estado | Fuente |
| --- | --- | --- |
| Claude Code no descubre `.agents/skills/`, ni en local ni en la nube. Hace falta el symlink `.claude/skills/<nombre> -> ../../.agents/skills/<nombre>` (lo crea `agent-cloud-kit init`). | verificado (Tarea 1, 2026-11) | `docs/cloud-cli.md` (preguntas 6 y 10) |
| Los plugins de la máquina local no llegan a la nube, ni sus hooks: las skills deben estar copiadas en el repo. | verificado | README ("What it does not do") |
| `claude --cloud` usa el entorno elegido con `/remote-env` (queda en la configuración del usuario); `--environment` solo acepta entornos self-hosted (`ccpool_…`). | verificado (Tarea 1, 2026-11) | `docs/cloud-cli.md` (pregunta 3) |
| `claude --cloud <prompt>` exige una terminal interactiva; toma el texto como primer mensaje, imprime la URL de la sesión y el comando `claude --teleport`, y vuelve. | verificado (Tarea 1, 2026-11) | `docs/cloud-cli.md` (preguntas 1 y 4) |
| Un comando de la herramienta Bash se corta a los 2 min por defecto (10 como máximo). Para corridas largas: en segundo plano, o subir `BASH_DEFAULT_TIMEOUT_MS` y `BASH_MAX_TIMEOUT_MS` en las variables del entorno (p. ej. `3600000`). | verificado | Un repo en uso, 2026-10 (suite de ~35 min) |
