# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- The terminal speaks Spanish by default and English with `--lang en` or
  `AGENT_CLOUD_KIT_LANG=en` (`LANG` is not read). The texts live in one catalog per language
  (`src/messages/`), and a test checks that both have the same keys.
- In a terminal, the final messages of `doctor`, `prepare` and `verify` come in a block with Kuro,
  the mascot of issue-flow and agent-kitchen. `NO_COLOR` removes the color.

### Changed

- The screen before Claude opens shows Kuro instead of the small cloud.
- Step names that were in English (`self install`, `write state`) read in the chosen language.

## 1.0.0-rc.7

### Added

- `docs/agent-cloud.md` has a "Si cambian los tests" section: run `npx agent-cloud-kit prepare`
  again after adding tests (e.g. Electron) or changing how they run.
- The `cloud-ready` skill ends `configure` with a fixed summary: tests in the cloud, adaptations,
  tests and scripts touched, what stays out, files.
- Electron, Expo and Android knowledge, verified in cloud sessions: Electron runs with
  `xvfb-run -a … --no-sandbox` (Xvfb and the Chromium libraries come in the image) and Playwright
  `_electron` works; Expo's `jest-expo`, `expo export`, `prebuild`, web with Playwright and
  `expo-doctor` (with the Expo domains); the Android build works with `dl.google.com`, Google's
  Maven Central mirror, Java 17 from apt and the SDK licence files.
- Test-adaptation principles in `compat.md`: tests stay as they are, differences go in what
  prepares or launches them, detect the capability before the location.

### Changed

- The cloud knowledge was fact-checked against the docs and real sessions; wrong or overstated
  claims were corrected or marked "por verificar" (e.g. public GitHub releases do download).
- The network instructions use the app's Spanish names: Limitado and "Permitir administradores
  de paquetes".

## 1.0.0-rc.6

### Changed

- `docs/agent-cloud.md` keeps emoji only where they mean something: ⚠️ on the variables
  warning and ✅, ⏳ or ❌ on each note of "Qué corre en la nube". Headings and bullets have none.

## 1.0.0-rc.5

### Changed

- `docs/agent-cloud.md` is shorter and easier to scan: an emoji per key point, the environment
  setup as four bullets (network, variables, GitHub App, setup script), one line to verify, and
  the variables warning only when there are variables.
- The `cloud-ready` skill writes "Qué corre en la nube" as short bullets marked ✅, ⏳ or ❌.

## 1.0.0-rc.4

### Changed

- `prepare` and `verify` show each line with an icon and a color in a terminal (✔ done,
  ● already there, ▲ warning, ✖ error) and keep the `agent-cloud-kit:` prefix otherwise.
- New progress lines: the worktree created and the branch pushed.
- The "Configurar el entorno en claude.ai" section is styled for the terminal instead of raw
  Markdown, and the current-branch mode ends with numbered next steps.

## 1.0.0-rc.3

### Changed

- Before opening Claude Code, `prepare` shows a short colored screen (what will happen, what to
  do, how to exit) and waits for Enter; Ctrl+C cancels without opening Claude.
- When the repo uses claude-repo-guard (`.claude/repo-guard.config.json`) and has its
  `claude:free` script, Claude opens through that script with the repo's package manager, so the
  skill can write the files the guard otherwise blocks.

## 1.0.0-rc.2

### Changed

- Every message, question and help text of the CLI is in Spanish.
- `prepare` no longer requires a clean working tree: it works in a new worktree from origin.
- `prepare` asks where to work with agent-kitchen's menu (arrow keys): in a new PR (default) or
  in the current branch without committing. `--pr` and `--here` skip the menu.

### Added

- `agent-cloud-kit verify`: launches the cloud verification of the current branch once it is
  prepared and pushed; also used to verify again after changing the environment.

## 1.0.0-rc.1

### Changed

- `prepare` asks nothing up front: no secret names, no extra domains. The `cloud-ready` skill
  notes what it sees the repo needs and, when something fails for a missing domain or variable,
  adds it to `.claude/cloud.json`, regenerates `docs/agent-cloud.md` and tells the user in the
  session right away (and in the PR comment in `verify`).
- `docs/agent-cloud.md` says it keeps being updated as the skill finds new domains or variables.

### Fixed

- The setup script in `docs/agent-cloud.md` and the "setup did not run" warning name the exact
  version for a release candidate; `agent-cloud-kit@1` does not match `1.0.0-rc.N`.

## 1.0.0-rc.0

Continues `@ramon-sg/claude-cloud` 1.0.0. There is no automatic migration.

### Changed

- Renamed from `@ramon-sg/claude-cloud` to `agent-cloud-kit` (binary, state folder
  `/opt/agent-cloud-kit`, environment variables `AGENT_CLOUD_KIT_*`, output prefix).

### Added

- `agent-cloud-kit prepare [--resume]`: sets a repo up for the cloud on a dated branch in a
  worktree, opens a draft PR and verifies it in a real `claude --cloud` session.
- `agent-cloud-kit manual`: writes `docs/agent-cloud.md` (setup script, domains, variables).
- `cloud-ready` skill (`configure` and `verify`), copied by `init` to `.agents/skills/cloud-ready`
  and linked from `.claude/skills/cloud-ready`. It respects the repo's own tests.
- `domains` field in `.claude/cloud.json`.
- GitHub Actions pinned by commit SHA.
- Atomic tool installs: each tool is unpacked into a temporary folder and renamed into place only
  when the install succeeds, so a failed or interrupted install never leaves a half-installed tool.
- The Node download is checked against the release's `SHASUMS256.txt` before it is installed.
- Time limits for setup steps (tool installs 2 min; apt steps, `docker pull` and each repo `setup`
  command 3 min) and for the `git fetch` at session start (1 min); a step over its limit is
  stopped instead of hanging the setup or the session start.
- `doctor` warnings that do not fail it: plugins enabled in the project settings (they do not
  reach the cloud) and a `cloud-ready` skill of another version than the package.
- `agent-cloud-kit setup [--repo <path>]`: prepares the machine for every repo cloned in the home
  directory, relaunching the exact version each repo pins in `.claude/cloud.json`.
- `agent-cloud-kit session`: reports the state of the machine, wires the pinned tools into the session
  through `$CLAUDE_ENV_FILE`, starts Docker, completes a partial clone and runs the repo's session steps.
- `agent-cloud-kit docker`, `agent-cloud-kit doctor` and `agent-cloud-kit init`.
- Tool installers whose sources pass the cloud egress proxy: Node (nodejs.org), Bun, Deno, pnpm and
  Yarn (npm) and uv (PyPI), installed side by side under `/opt/agent-cloud-kit`.
- Non-exact Node versions (`22`, `22.1`, `lts/<name>`, `lts/*`, `node`) resolved through the
  Node.js release index and recorded in the machine state.
- Version detection from `.tool-versions`, `mise.toml`, `.nvmrc` and `package.json#packageManager`;
  Docker image detection from compose files and pinned `FROM` lines.
- `.claude/cloud.json` configuration with a JSON schema (`schema.json`).
- Machine fingerprint that warns when the stored machine was prepared with another configuration.
- Support for the cloud proxy CA bundle (`CLOUD_PROXY_CA`).
- Container walkthrough test behind a proxy that blocks GitHub.
