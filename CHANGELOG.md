# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
