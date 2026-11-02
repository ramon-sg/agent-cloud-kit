# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0

### Added

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
