# Qué hace `claude --cloud` (verificado)

Fecha: 2026-11-02. Claude Code local 2.1.316; en la nube 2.1.42x. Repo de prueba privado
`ramon-sg/cloud-spike`, dos sesiones (`session_01L3JBJq1fcpXPoyda7b8ZnM`,
`session_01L3JBJrVagTygbzCWZe4yXE`).

## Ayuda

```
--cloud [description|session_id|url]  Create a cloud session with the given description, or attach
                                      to an existing one by session ID or claude.ai/code URL
--environment <environment_id>        Create a new cloud session that runs on the given self-hosted
                                      environment (ccpool_...).
--teleport [session]                  Resume a teleport session, optionally specify session ID
```

## Respuestas

1. **¿Prompt o descripción?** Prompt. La sesión ejecutó el texto como primer mensaje; el título lo
   genera Claude a partir de él.
2. **¿Qué repo y rama?** El `origin` del directorio actual. La sesión parte del commit de la rama
   local actual (`CLAUDE_CODE_BASE_REF=<rama>`), que debe estar pusheada, y trabaja en una rama
   propia `claude/<slug>`. No hay flag para elegir rama: se elige haciendo checkout antes.
3. **¿Qué entorno?** El entorno por defecto de la terminal, que se elige con `/remote-env` en
   `claude` y queda en la configuración del usuario (fuente: `docs/guides/claude-cloud.md` de
   Abastio). `--environment` solo acepta entornos self-hosted (`ccpool_...`). El entorno usado en
   la prueba no tenía setup script. Sin el Claude GitHub App en el repo, `claude --cloud` sube una
   copia local y la sesión no puede pushear (misma fuente).
4. **¿Bloquea?** No. Exige una terminal interactiva (`--cloud requires an interactive terminal`;
   sin TTY sale 1), puede mostrar el diálogo de confianza de carpeta, crea la sesión, imprime
   `View: https://claude.ai/code/session_…` y `Resume with: claude --teleport session_…`, y vuelve.
5. **¿Puede pushear a la rama existente?** Sí: `git push origin HEAD:spike/branch-a` y a una rama
   nueva arbitraria funcionaron.
6. **¿Descubre `.agents/skills/`?** No, ni en local ni en la nube (`Unknown skill: spike-bare`).
   Sí descubre una skill enlazada con un symlink `.claude/skills/<nombre> -> ../../.agents/skills/<nombre>`
   (en la nube: `Successfully loaded skill`).
7. **¿Variables del panel en el setup script?** Por verificar: necesita editar un entorno en
   claude.ai.
8. **¿`node_modules` del setup script sigue en la sesión?** Por verificar (misma razón).
9. **¿`gh` en la nube?** `gh` 2.89 instalado. `gh auth status` dice que `GH_TOKEN` es inválido
   (`GH_TOKEN=proxy-…`), pero `gh api` REST funciona (el proxy pone la credencial). GraphQL
   (`gh pr list`) da 403 con este texto: usar REST; para draft/ready y auto-merge hay rutas
   `POST /repos/{o}/{r}/pulls/{n}/ccr/ready_for_review`, `…/ccr/convert_to_draft`,
   `PUT|DELETE …/ccr/auto_merge`, `GET …/ccr/review_threads`.
10. **¿El `claude` local encuentra `/cloud-ready` en `.agents/skills/`?** No. Igual que en 6:
    hace falta el symlink en `.claude/skills/`.

Otros datos vistos: repo en `/home/user/<repo>`; Node 22 por defecto (`/opt/node22`), también
`/opt/node24` y navegadores de Playwright en `/opt/pw-browsers`; `HTTPS_PROXY`, `NO_PROXY`,
`SSL_CERT_FILE` y `NODE_EXTRA_CA_CERTS` definidos; `CLAUDE_CODE_SYNC_SKILLS=1` y
`CLAUDE_CODE_SYNC_PLUGINS=1` presentes (qué sincronizan: por verificar).

## Ajustes a las Tareas 9–11

- **Tarea 9:** `init` crea el symlink `.claude/skills/cloud-ready -> ../../.agents/skills/cloud-ready`,
  salvo que `.claude/skills` ya apunte a `.agents/skills` (como kaname) o que ya exista. `prepare`
  commitea también `.claude/skills/cloud-ready`. `knowledge.md`: GraphQL bloqueado pero hay rutas
  REST `ccr` para draft/ready; `gh auth status` engaña, `gh api` funciona.
- **Tarea 11, paso 8:** `claude --cloud <verifyPrompt>` se lanza en el worktree (con la rama de
  `prepare` ya pusheada y en checkout) con stdio heredado; Claude imprime la URL y el comando de
  teleport, `prepare` no los parsea. Sin TTY, `prepare` ya falla en `preflight`.
- **Skill `verify`:** trabaja en su rama `claude/...` y al final hace
  `git push origin HEAD:<rama de prepare>` (la rama va en el prompt).
- **Manual:** el entorno a configurar es el que se elige con `/remote-env`; el Claude GitHub App debe estar instalado en el repo.
