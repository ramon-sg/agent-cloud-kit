# Escribir en un proyecto al cerrar una issue

Lo que tiene que pasar en un proyecto de GitHub (Projects v2) cuando se cierra una issue o se hace
merge de un PR, por ejemplo escribir las horas reales o la fecha de cierre, va en una GitHub
Action del repo, no en el agente:

- Una issue casi nunca la cierra el agente: se cierra con el merge de un PR con `Closes #n`, o la
  cierra una persona en GitHub. En ese momento no hay ninguna sesión corriendo.
- En la nube, el proxy de GitHub da 403 a Projects v2, y el conector de claude.ai puede pedir
  aprobación en cada llamada (una tarea programada se queda esperando).
- La Action corre en GitHub, fuera del proxy: funciona igual si el trabajo se hizo en local o en
  la nube. Se dispara con el evento, es determinista y queda en el repo, revisable.

El agente o el conector, solo para lo que se decide durante la sesión.

## El token

El `GITHUB_TOKEN` de Actions no llega a Projects v2 de un usuario ni de una organización. Hace
falta un secret del repo (p. ej. `PROJECT_TOKEN`, en Settings → Secrets and variables → Actions)
con un token classic con `project` (y `repo` si el repo es privado), o una GitHub App con
permiso sobre el proyecto.

## Ejemplo mínimo

`.github/workflows/project-on-close.yml`: al cerrar una issue, escribe la fecha de cierre en el
campo `Cerrada` (tipo fecha) del proyecto.

```yaml
name: Proyecto al cerrar una issue

on:
  issues:
    types: [closed]

jobs:
  project:
    runs-on: ubuntu-latest
    steps:
      - name: Escribir la fecha de cierre
        env:
          GH_TOKEN: ${{ secrets.PROJECT_TOKEN }}
          GH_REPO: ${{ github.repository }}
          PROJECT_OWNER: tu-usuario # o la organización
          PROJECT_NUMBER: "1" # el de github.com/users/<owner>/projects/<n>
          ISSUE: ${{ github.event.issue.number }}
          CLOSED_AT: ${{ github.event.issue.closed_at }}
        run: |
          npx -y @ramon-sg/github-rest@0.5.0 project set "$PROJECT_OWNER" "$PROJECT_NUMBER" \
            --issue "$ISSUE" --field Cerrada --value "${CLOSED_AT%%T*}"
```

- `project set` busca el item de la issue (la agrega al proyecto si no está) y escribe campos
  number, text, date (`YYYY-MM-DD`) y single select. Usa `gh`, que ya viene en los runners, con
  `GH_TOKEN` y `GH_REPO`; no hace falta `actions/checkout`.
- Los datos del evento pasan por `env`, no dentro de `run:` con `${{ }}`: así un título o un
  texto de la issue no se puede colar como comando.
- Un campo number como `Real` toma el valor de donde el repo lo guarde (un label, un comentario,
  el cuerpo de la issue): la Action lo lee del evento o con `gh api` antes de `project set`.
- Para escribir solo si la issue se completó, agrega
  `if: github.event.issue.state_reason == 'completed'` al job.
- El merge de un PR con `Closes #n` cierra la issue y dispara `issues: closed`. Si lo que importa
  es el PR, usa `pull_request: types: [closed]` con `if: github.event.pull_request.merged`. Un
  cierre o un merge hecho por otra Action con `GITHUB_TOKEN` no dispara workflows.
- Para cosas simples, Projects tiene workflows integrados sin código (p. ej. "Item closed" →
  Status = Done). Solo cubren el estado: los demás campos necesitan la Action.
