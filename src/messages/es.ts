/**
 * @file The Spanish messages. Its shape is the shape of every catalog: `en.ts` must match it.
 * Each message is a string or a function that builds one. Only what the terminal shows lives
 * here: what is written in the repo (commit message, hook command, `docs/agent-cloud.md` outside
 * the environment section) and the prompts for Claude stay where they are.
 */

/** Command that continues a prepare run. */
const RESUME = "npx agent-cloud-kit prepare --resume";

/** Command that launches the cloud verification. */
const VERIFY = "npx agent-cloud-kit verify";

export const es = {
  help: `agent-cloud-kit: prepara repos para las sesiones cloud de Claude Code.

Uso: agent-cloud-kit <comando> [--lang es|en]

Comandos:
  setup [--repo <path>]  prepara la máquina para cada repo del directorio home (o solo <path>)
  session                informa el estado de la máquina y conecta las herramientas a la sesión
  docker                 inicia el demonio de Docker y espera a que responda
  doctor                 revisa los dominios permitidos, las herramientas, Docker y el estado de la máquina
  init                   crea .claude/cloud.json y registra el hook SessionStart
  manual                 escribe docs/agent-cloud.md a partir de .claude/cloud.json
  prepare [--pr|--here|--resume]
                         corre en local: deja el repo listo para la nube, en un PR nuevo (--pr) o en la
                         rama actual sin commit (--here); sin opción, pregunta dónde
  verify                 corre en local: lanza una sesión cloud que verifica la rama actual (ya subida)

Opciones:
  --lang es|en           idioma de los mensajes (español por defecto; AGENT_CLOUD_KIT_LANG=es|en lo fija)
  --help                 muestra esta ayuda
  --version              muestra la versión del paquete
`,
  lang: {
    invalid: (source: string, value: string) => `${source} espera es o en: ${value}`,
  },
  cli: {
    versionMismatch: (running: string, file: string, pinned: string) => `corriendo la versión ${running}, aunque ${file} pide la ${pinned}`,
    setupSummary: (repo: string, steps: number, failed: number, names: string[]) =>
      `setup ${repo}: ${steps} pasos, ${failed} fallaron${names.length ? ` (${names.join(", ")})` : ""}`,
    skip: (repo: string, reason: string) => `se omite ${repo}: ${reason}`,
    relaunching: (version: string, repo: string) => `relanzando con la versión ${version} para ${repo}`,
    relaunchFailed: (version: string, repo: string, error: string) => `falló el relanzamiento con la versión ${version} para ${repo}: ${error}`,
    repoNeedsPath: (option: string) => `${option} necesita una ruta`,
    noRepos: (home: string) => `no se encontraron repos en ${home}`,
    setupErrorFor: (repo: string, error: string) => `error en setup de ${repo}: ${error}`,
    setupError: (error: string) => `error en setup: ${error}`,
    sessionDelegateFailed: (version: string, error: string) => `falló session con la versión ${version}: ${error}`,
    manualWritten: (file: string) => `se escribió ${file}`,
    unknownOption: (command: string, options: string) => `opción desconocida para ${command}: ${options}`,
    onlyOne: (options: string) => `usa solo una de ${options}`,
  },
  config: {
    dockerNotObject: '"docker" debe ser un objeto',
    unknownField: (key: string) => `campo desconocido "${key}"`,
    badPull: '"docker.pull" debe ser "auto", false o un arreglo de strings',
    notStringList: (key: string) => `"${key}" debe ser un arreglo de strings`,
    badHost: (host: string) => `"domains" tiene un host inválido: ${host}`,
    badVersion: '"version" debe ser un semver exacto, como "1.0.0"',
    notesNotString: '"notes" debe ser un string',
    unreadable: (reason: string) => `no se pudo leer el archivo: ${reason}`,
    notObject: "debe contener un objeto JSON",
    missing: (file: string) => `no hay ${file}`,
  },
  run: {
    timedOut: (cmd: string, ms: number) => `${cmd} superó el límite de ${ms}ms`,
    exitCode: (cmd: string, code: number) => `${cmd} terminó con el código ${code}`,
    exitSignal: (cmd: string, signal: string) => `${cmd} terminó con la señal ${signal}`,
  },
  docker: {
    missing: "dockerd no está instalado",
    didNotStart: (log: string) => `dockerd no arrancó; revisa ${log}`,
  },
  doctor: {
    domain: (host: string, ok: boolean) => `red ${host}: ${ok ? "ok" : "bloqueado"}`,
    toolInvalid: (tool: string, version: string) => `herramienta ${tool} ${version}: versión inválida`,
    toolUnresolved: (tool: string, version: string) => `herramienta ${tool} ${version}: sin resolver (setup no la instaló)`,
    tool: (tool: string, version: string, present: boolean) => `herramienta ${tool} ${version}: ${present ? "ok" : "falta"}`,
    fileMissing: (file: string) => `${file}: falta`,
    stateMissing: "estado: falta (setup no corrió)",
    fingerprint: (same: boolean) => `huella: ${same ? "ok" : "distinta"}`,
    step: (name: string, ok: boolean, seconds: string) => `paso ${name}: ${ok ? "ok" : "falló"} (${seconds}s)`,
    docker: (ok: boolean) => `docker: ${ok ? "ok" : "falta"}`,
    plugin: (name: string) => `aviso: el plugin ${name} está activado pero no está en el repo; no llegará a la nube (copia sus skills con skills-manager)`,
    skill: (dir: string, installed: string, version: string) =>
      `aviso: ${dir} está en ${installed} y el paquete en ${version}; corre npx agent-cloud-kit@${version} init`,
    groupError: (group: string, error: string) => `${group}: error: ${error}`,
    groups: { network: "red", tools: "herramientas", docker: "docker", state: "estado", plugins: "plugins", skill: "skill" },
    allOk: "Todo en orden",
    someFailed: (failed: number, total: number) => (failed === 1 ? `Falló 1 de ${total} revisiones` : `Fallaron ${failed} de ${total} revisiones`),
    warnings: (count: number) => (count === 1 ? "1 aviso" : `${count} avisos`),
    failedHint: "revisa las líneas con falta, bloqueado o falló",
  },
  session: {
    genericNote:
      "estás en una sesión cloud de Claude Code. No hay puertos abiertos ni previews: prueba contra localhost. gh pr y gh issue fallan (el proxy de GitHub bloquea GraphQL): usa gh api (REST).",
    setupNotRun: (repo: string, spec: string) =>
      `el setup del entorno no corrió para ${repo}. Pon como script de setup del entorno en claude.ai: npx -y ${spec} setup`,
    setupFailed: (names: string[]) => `falló el setup: ${names.join(", ")}. Corre agent-cloud-kit doctor.`,
    otherConfig:
      "la máquina se preparó con otra configuración. Edita el campo del script de setup en claude.ai (cualquier cambio) para que se reconstruya.",
    slow: (time: string) => `el setup tardó ${time}, cerca del límite de ~5 minutos.`,
    envFileFailed: (variable: string, file: string, error: string) => `no se pudo escribir ${variable} (${file}): ${error}`,
    stepTimedOut: (command: string) => `el paso de sesión superó el tiempo límite: ${command}`,
    stepFailed: (command: string) => `falló el paso de sesión: ${command}`,
    missingEnv: (names: string[]) => `faltan variables de entorno: ${names.join(", ")}`,
    dockerFailed: (problem: string) => `no se pudo iniciar dockerd: ${problem}`,
    error: (error: string) => `error en session: ${error}`,
  },
  setup: {
    aptRepoHttps: (prefix: string) => `el repo de apt debe ser una URL ${prefix}`,
    badDebianName: "nombre de paquete Debian inválido",
    badImage: "referencia de imagen inválida",
    packageMismatch: (source: string, found: string | undefined, version: string) => `el paquete en ${source} es ${found ?? "desconocido"}, no ${version}`,
    noConfig: "sin configuración",
  },
  /** Names of the setup steps, built from the name stored in the state (which never changes). */
  steps: {
    aptRepo: (url: string) => `repo de apt ${url}`,
    aptPackage: (name: string) => `paquete de apt ${name}`,
    selfInstall: (version: string) => `autoinstalación ${version}`,
    writeState: "guardar el estado",
    lane: (index: string) => `grupo ${index}`,
    config: "configuración",
  },
  installers: {
    notInShasums: (file: string, shasums: string) => `${file} no aparece en ${shasums}`,
    unsupportedArch: (arch: string) => `arquitectura no soportada para node: ${arch}`,
    invalidVersion: (tool: string, version: string) => `versión inválida para ${tool}: ${version}`,
    indexNotList: "el índice de versiones de node no es una lista",
    noNodeMatch: (requested: string) => `ninguna versión de node coincide con ${requested}`,
    nodeMustResolve: (version: string) => `node ${version} debe resolverse primero a una versión exacta`,
  },
  init: {
    byHand: (file: string, reason: string, entry: string) => `${file} ${reason}; no se tocó. Agrega esta entrada a hooks.SessionStart a mano: ${entry}`,
    notJson: "no es JSON válido",
    notObject: "no es un objeto JSON",
    hooksNotObject: 'tiene un "hooks" que no es un objeto',
    sessionStartNotArray: 'tiene un "hooks.SessionStart" que no es un arreglo',
    configExists: (file: string) => `${file} ya existe; se dejó como estaba`,
    configCreated: (file: string) => `se creó ${file}`,
    hookExists: (file: string) => `${file} ya tiene el hook SessionStart`,
    hookAdded: (file: string) => `se agregó el hook SessionStart a ${file}`,
  },
  skill: {
    current: (dir: string, version: string) => `${dir} ya está en ${version}`,
    missing: (path: string, root: string) => `no se encontró ${path}/SKILL.md en ${root}`,
    installed: (dir: string, version: string) => `se instaló ${dir} ${version}`,
    updated: (dir: string, from: string, to: string) => `se actualizó ${dir} de ${from} a ${to}`,
    linked: (link: string, dir: string) => `se enlazó ${link} a ${dir}`,
  },
  manual: {
    noConfig: (file: string) => `no existe ${file}; corre init primero`,
  },
  /** The "configure the environment" section, shown by `prepare` (the manual keeps it in Spanish). */
  environment: {
    title: "## Configurar el entorno en claude.ai",
    intro: "Elige el entorno con `/remote-env` y edítalo en claude.ai/code:",
    network: (hosts: string) =>
      `- **Acceso a la red:** Limitado (Custom) con "Permitir administradores de paquetes" encendido ("Also include default list of common package managers"). Dominios extra: ${hosts}.`,
    variables: (names: string) => `- **Variables:** ${names}.`,
    namesOnly: (names: string) => `${names} (solo los nombres; los valores los pones tú)`,
    none: "ninguno",
    noneVariables: "ninguna",
    githubApp: "- **Claude GitHub App:** instalado en el repo, o la sesión no puede pushear.",
    setupScript: "- **Setup script:**",
    variablesWarning: "> ⚠️ Quien use el entorno puede leer las variables, y no llegan al setup script (solo a la sesión).",
  },
  menu: {
    cancelled: "Cancelado",
  },
  preflight: {
    noTty: (command: string) => `${command} necesita una terminal interactiva (corre el comando directamente en tu terminal)`,
    noGit: (command: string) => `esto no es un repositorio git; corre ${command} dentro del repo`,
    noOrigin: (command: string) => `el repositorio no tiene el remoto 'origin'; ${command} necesita subir una rama a GitHub`,
    noClaude: (command: string) => `claude no está instalado o no está en el PATH; instala Claude Code y vuelve a correr ${command}`,
    noCloud: (command: string) => `tu versión de claude no soporta --cloud; actualiza Claude Code y vuelve a correr ${command}`,
  },
  banner: {
    title: "Ahora se abre Claude Code",
    subtitle: "con la skill cloud-ready",
    step1: "Claude revisa el repo y te propone cómo prepararlo para la nube",
    step2: "Responde sus preguntas",
    step3: (done: string, exit: string, after: string) => `Cuando diga ${done}, sal con ${exit} ${after}`,
    configureDone: "configure terminó",
    afterPr: "→ prepare hace commit, push y PR",
    afterHere: "→ quedan los cambios sin commit",
    free: (script: string) => `Se abre con ${script} (sin sandbox ni preguntas de permisos): el repo usa claude-repo-guard`,
    enter: "abre Claude Code",
    cancel: "· Ctrl+C cancela",
    continue: "cuando hayas configurado el entorno en claude.ai",
    continueHint: "· abre la sesión cloud que lo verifica",
  },
  prepare: {
    interrupted: "interrumpido",
    resume: (reason: string, worktree: string) => `${reason}; el worktree está en ${worktree}; corre ${RESUME} ahí para continuar`,
    noConfig: (file: string) => `no existe ${file}`,
    noNotes: (file: string) => `no existe el archivo de notas ${file}`,
    worktreeExists: (worktree: string) => `${worktree} ya existe; bórralo (git worktree remove ${worktree}) o continúa ahí con ${RESUME}`,
    branchExists: (branch: string) => `la rama ${branch} ya existe; bórrala (git branch -D ${branch}) o corre prepare otro día`,
    worktreeCreated: (worktree: string, branch: string) => `se creó el worktree ${worktree} en la rama ${branch}`,
    worktreeFailed: (error: string) => `no se pudo crear el worktree: ${error}`,
    agentStopped: "el agente local se detuvo",
    prepareStopped: "prepare se detuvo",
    configureUnfinished: (problem: string) => `configure no terminó: ${problem}`,
    otherChanges: "el agente local también cambió:",
    includeQuestion: "¿Incluir estos cambios en el commit? [s/N]",
    leftUncommitted: (worktree: string) => `quedó sin commitear en ${worktree}`,
    nothingToCommit: "no hay nada nuevo que commitear",
    pushed: (branch: string) => `se subió la rama ${branch}`,
    pushFailed: (error: string, worktree: string) => `no se pudo hacer commit y push: ${error}; corrígelo en ${worktree} y corre ${RESUME} ahí`,
    prReused: (pr: string) => `se reutiliza el PR abierto #${pr}`,
    prDraft: (url: string) => `PR en borrador: ${url}`,
    prByHand: (link: string | undefined, branch: string) => `no se pudo abrir el PR con gh; ábrelo a mano${link ? `: ${link}` : ` desde la rama ${branch}`}`,
    interruptedHere: "interrumpido; lo que alcanzó a cambiar quedó sin commit en tu rama",
    interruptedNothing: "interrumpido; no se creó nada",
    nothingToResume: (suffix: string, prefix: string) => `no hay nada que reanudar: corre prepare --resume en el worktree *${suffix}, sobre una rama ${prefix}*`,
    resumeUnfinished: (worktree: string, problem: string) =>
      `configure no terminó en ${worktree}: ${problem}; corre claude "/cloud-ready configure" ahí primero y luego ${RESUME}`,
    nothingChanged: "no se cambió nada",
    cloudFailedResume: (error: string, worktree: string) => `falló claude --cloud: ${error}; corre ${RESUME} en ${worktree} para reintentar`,
    placeQuestion: "¿Dónde preparo el repo?",
    placePr: "En un PR nuevo",
    placePrHint: (base: string) => `recomendado · parte de origin/${base}, no toca tu rama ni tus archivos`,
    placeHere: "En la rama actual, sin commit",
    placeHereHint: `los revisas con git diff, haces commit y push, y luego corres ${VERIFY}`,
    stoppedHere: "prepare se detuvo; lo que alcanzó a cambiar quedó sin commit en tu rama",
    hereUnfinished: (problem: string) => `configure no terminó: ${problem}; corre claude "/cloud-ready configure" y luego prepare otra vez`,
    manualFailed: (file: string, error: string) => `no se pudo escribir ${file}: ${error}`,
    hereTitle: "Listo, sin commit",
    hereSteps: (manual: string) => ["Revisa los cambios con git diff", "Haz commit y push", `Configura el entorno en claude.ai (${manual})`, `Corre ${VERIFY}`],
    noBranch: "no estás en una rama; cámbiate a la rama que quieres verificar",
    notPrepared: (problem: string) => `el repo no está preparado (${problem}); corre npx agent-cloud-kit prepare primero`,
    dirty: "hay cambios sin commit en la preparación; haz commit y push: la nube solo ve lo que está en origin",
    notPushed: (branch: string) => `la rama ${branch} no está subida o tiene commits sin subir; haz git push y vuelve a correr verify`,
    cloudFailed: (error: string) => `falló claude --cloud: ${error}`,
    cloudStarted: "La sesión cloud está en marcha",
    cloudWillReport: (branch: string, pr: boolean) => `la sesión cloud avisará con un push a ${branch}${pr ? " y un comentario en el PR" : ""}`,
    rowBranch: "Rama",
    rowPr: "PR",
  },
};

/** The shape every catalog has. */
export type Messages = typeof es;
