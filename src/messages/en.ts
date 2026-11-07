/**
 * @file The English messages, with the same shape as `es.ts`.
 */
import type { Messages } from "./es.ts";

/** Command that continues a prepare run. */
const RESUME = "npx agent-cloud-kit prepare --resume";

/** Command that launches the cloud verification. */
const VERIFY = "npx agent-cloud-kit verify";

export const en: Messages = {
  help: `agent-cloud-kit: prepares repos for Claude Code cloud sessions.

Usage: agent-cloud-kit <command> [--lang es|en]

Commands:
  setup [--repo <path>]  prepares the machine for every repo in the home dir (or only <path>)
  session                reports the machine state and wires the tools into the session
  docker                 starts the Docker daemon and waits until it answers
  doctor                 checks the allowed domains, the tools, Docker and the machine state
  init                   creates .claude/cloud.json and registers the SessionStart hook
  manual                 writes docs/agent-cloud.md from .claude/cloud.json
  prepare [--pr|--here|--resume]
                         runs locally: gets the repo ready for the cloud, in a new PR (--pr) or on the
                         current branch without committing (--here); with no option, it asks where
  verify                 runs locally: starts a cloud session that verifies the current branch (already pushed)

Options:
  --lang es|en           language of the messages (Spanish by default; AGENT_CLOUD_KIT_LANG=es|en sets it)
  --help                 shows this help
  --version              shows the package version
`,
  lang: {
    invalid: (source, value) => `${source} expects es or en: ${value}`,
  },
  cli: {
    versionMismatch: (running, file, pinned) => `running version ${running}, although ${file} asks for ${pinned}`,
    setupSummary: (repo, steps, failed, names) => `setup ${repo}: ${steps} steps, ${failed} failed${names.length ? ` (${names.join(", ")})` : ""}`,
    skip: (repo, reason) => `skipping ${repo}: ${reason}`,
    relaunching: (version, repo) => `relaunching with version ${version} for ${repo}`,
    relaunchFailed: (version, repo, error) => `relaunching with version ${version} for ${repo} failed: ${error}`,
    repoNeedsPath: (option) => `${option} needs a path`,
    noRepos: (home) => `no repos found in ${home}`,
    setupErrorFor: (repo, error) => `setup error in ${repo}: ${error}`,
    setupError: (error) => `setup error: ${error}`,
    sessionDelegateFailed: (version, error) => `session with version ${version} failed: ${error}`,
    manualWritten: (file) => `wrote ${file}`,
    unknownOption: (command, options) => `unknown option for ${command}: ${options}`,
    onlyOne: (options) => `use only one of ${options}`,
  },
  config: {
    dockerNotObject: '"docker" must be an object',
    unknownField: (key) => `unknown field "${key}"`,
    badPull: '"docker.pull" must be "auto", false or an array of strings',
    notStringList: (key) => `"${key}" must be an array of strings`,
    badHost: (host) => `"domains" has an invalid host: ${host}`,
    badVersion: '"version" must be an exact semver, like "1.0.0"',
    notesNotString: '"notes" must be a string',
    unreadable: (reason) => `could not read the file: ${reason}`,
    notObject: "must contain a JSON object",
    missing: (file) => `no ${file}`,
  },
  run: {
    timedOut: (cmd, ms) => `${cmd} went over the ${ms}ms limit`,
    exitCode: (cmd, code) => `${cmd} exited with code ${code}`,
    exitSignal: (cmd, signal) => `${cmd} was ended by signal ${signal}`,
  },
  docker: {
    missing: "dockerd is not installed",
    didNotStart: (log) => `dockerd did not start; check ${log}`,
  },
  doctor: {
    domain: (host, ok) => `network ${host}: ${ok ? "ok" : "blocked"}`,
    toolInvalid: (tool, version) => `tool ${tool} ${version}: invalid version`,
    toolUnresolved: (tool, version) => `tool ${tool} ${version}: unresolved (setup did not install it)`,
    tool: (tool, version, present) => `tool ${tool} ${version}: ${present ? "ok" : "missing"}`,
    fileMissing: (file) => `${file}: missing`,
    stateMissing: "state: missing (setup did not run)",
    fingerprint: (same) => `fingerprint: ${same ? "ok" : "different"}`,
    step: (name, ok, seconds) => `step ${name}: ${ok ? "ok" : "failed"} (${seconds}s)`,
    docker: (ok) => `docker: ${ok ? "ok" : "missing"}`,
    plugin: (name) => `warning: the plugin ${name} is enabled but is not in the repo; it will not reach the cloud (copy its skills with skills-manager)`,
    skill: (dir, installed, version) => `warning: ${dir} is at ${installed} and the package at ${version}; run npx agent-cloud-kit@${version} init`,
    groupError: (group, error) => `${group}: error: ${error}`,
    groups: { network: "network", tools: "tools", docker: "docker", state: "state", plugins: "plugins", skill: "skill" },
    allOk: "All good",
    someFailed: (failed, total) => (failed === 1 ? `1 of ${total} checks failed` : `${failed} of ${total} checks failed`),
    warnings: (count) => (count === 1 ? "1 warning" : `${count} warnings`),
    failedHint: "look at the lines with missing, blocked or failed",
  },
  session: {
    genericNote:
      "you are in a Claude Code cloud session. There are no open ports or previews: test against localhost. gh pr and gh issue fail (the GitHub proxy blocks GraphQL): use gh api (REST).",
    setupNotRun: (repo, spec) => `the environment setup did not run for ${repo}. Set this as the environment setup script in claude.ai: npx -y ${spec} setup`,
    setupFailed: (names) => `setup failed: ${names.join(", ")}. Run agent-cloud-kit doctor.`,
    otherConfig: "the machine was prepared with another configuration. Edit the setup script field in claude.ai (any change) so it is rebuilt.",
    slow: (time) => `setup took ${time}, close to the ~5 minute limit.`,
    envFileFailed: (variable, file, error) => `could not write ${variable} (${file}): ${error}`,
    stepTimedOut: (command) => `the session step went over the time limit: ${command}`,
    stepFailed: (command) => `the session step failed: ${command}`,
    missingEnv: (names) => `missing environment variables: ${names.join(", ")}`,
    dockerFailed: (problem) => `could not start dockerd: ${problem}`,
    error: (error) => `session error: ${error}`,
  },
  setup: {
    aptRepoHttps: (prefix) => `the apt repo must be an ${prefix} URL`,
    badDebianName: "invalid Debian package name",
    badImage: "invalid image reference",
    packageMismatch: (source, found, version) => `the package in ${source} is ${found ?? "unknown"}, not ${version}`,
    noConfig: "no configuration",
  },
  steps: {
    aptRepo: (url) => `apt repo ${url}`,
    aptPackage: (name) => `apt package ${name}`,
    selfInstall: (version) => `self install ${version}`,
    writeState: "write state",
    lane: (index) => `lane ${index}`,
    config: "config",
  },
  installers: {
    notInShasums: (file, shasums) => `${file} is not in ${shasums}`,
    unsupportedArch: (arch) => `unsupported architecture for node: ${arch}`,
    invalidVersion: (tool, version) => `invalid version for ${tool}: ${version}`,
    indexNotList: "the node version index is not a list",
    noNodeMatch: (requested) => `no node version matches ${requested}`,
    nodeMustResolve: (version) => `node ${version} must first resolve to an exact version`,
  },
  init: {
    byHand: (file, reason, entry) => `${file} ${reason}; it was left untouched. Add this entry to hooks.SessionStart by hand: ${entry}`,
    notJson: "is not valid JSON",
    notObject: "is not a JSON object",
    hooksNotObject: 'has a "hooks" that is not an object',
    sessionStartNotArray: 'has a "hooks.SessionStart" that is not an array',
    configExists: (file) => `${file} already exists; left as it was`,
    configCreated: (file) => `created ${file}`,
    hookExists: (file) => `${file} already has the SessionStart hook`,
    hookAdded: (file) => `added the SessionStart hook to ${file}`,
  },
  skill: {
    current: (dir, version) => `${dir} is already at ${version}`,
    missing: (path, root) => `${path}/SKILL.md not found in ${root}`,
    installed: (dir, version) => `installed ${dir} ${version}`,
    updated: (dir, from, to) => `updated ${dir} from ${from} to ${to}`,
    linked: (link, dir) => `linked ${link} to ${dir}`,
  },
  manual: {
    noConfig: (file) => `${file} does not exist; run init first`,
  },
  environment: {
    title: "## Configure the environment in claude.ai",
    intro: "Pick the environment with `/remote-env` and edit it in claude.ai/code:",
    network: (hosts) =>
      `- **Network access:** Limited (Custom) with "Also include default list of common package managers" turned on. Extra domains: ${hosts}.`,
    variables: (names) => `- **Variables:** ${names}.`,
    namesOnly: (names) => `${names} (only the names; you fill in the values)`,
    none: "none",
    noneVariables: "none",
    githubApp: "- **Claude GitHub App:** installed on the repo, or the session cannot push.",
    githubConnector: (guide) =>
      `- **GitHub connector** (only if the repo uses Projects, search or other GitHub repos): add it once per account and set its tools to "always allow" ([guide](${guide})).`,
    setupScript: "- **Setup script:**",
    variablesWarning: "> ⚠️ Anyone who uses the environment can read the variables, and they do not reach the setup script (only the session).",
  },
  menu: {
    cancelled: "Cancelled",
  },
  preflight: {
    noTty: (command) => `${command} needs an interactive terminal (run the command directly in your terminal)`,
    noGit: (command) => `this is not a git repository; run ${command} inside the repo`,
    noOrigin: (command) => `the repository has no 'origin' remote; ${command} needs to push a branch to GitHub`,
    noClaude: (command) => `claude is not installed or not on the PATH; install Claude Code and run ${command} again`,
    noCloud: (command) => `your claude version does not support --cloud; update Claude Code and run ${command} again`,
  },
  banner: {
    title: "Claude Code opens now",
    subtitle: "with the cloud-ready skill",
    step1: "Claude reviews the repo and proposes how to get it ready for the cloud",
    step2: "Answer its questions",
    step3: (done, exit, after) => `When it says ${done}, leave with ${exit} ${after}`,
    configureDone: "configure finished",
    afterPr: "→ prepare commits, pushes and opens a PR",
    afterHere: "→ the changes stay uncommitted",
    free: (script) => `It opens with ${script} (no sandbox nor permission prompts): the repo uses claude-repo-guard`,
    enter: "opens Claude Code",
    cancel: "· Ctrl+C cancels",
    continue: "once you have configured the environment in claude.ai",
    continueHint: "· opens the cloud session that verifies it",
  },
  prepare: {
    interrupted: "interrupted",
    resume: (reason, worktree) => `${reason}; the worktree is at ${worktree}; run ${RESUME} there to continue`,
    noConfig: (file) => `${file} does not exist`,
    noNotes: (file) => `the notes file ${file} does not exist`,
    worktreeExists: (worktree) => `${worktree} already exists; remove it (git worktree remove ${worktree}) or continue there with ${RESUME}`,
    branchExists: (branch) => `the branch ${branch} already exists; delete it (git branch -D ${branch}) or run prepare another day`,
    worktreeCreated: (worktree, branch) => `created the worktree ${worktree} on the branch ${branch}`,
    worktreeFailed: (error) => `could not create the worktree: ${error}`,
    agentStopped: "the local agent stopped",
    prepareStopped: "prepare stopped",
    configureUnfinished: (problem) => `configure did not finish: ${problem}`,
    otherChanges: "the local agent also changed:",
    includeQuestion: "Include these changes in the commit? [y/N]",
    leftUncommitted: (worktree) => `left uncommitted in ${worktree}`,
    nothingToCommit: "nothing new to commit",
    pushed: (branch) => `pushed the branch ${branch}`,
    pushFailed: (error, worktree) => `could not commit and push: ${error}; fix it in ${worktree} and run ${RESUME} there`,
    prReused: (pr) => `reusing the open PR #${pr}`,
    prDraft: (url) => `draft PR: ${url}`,
    prByHand: (link, branch) => `could not open the PR with gh; open it by hand${link ? `: ${link}` : ` from the branch ${branch}`}`,
    interruptedHere: "interrupted; whatever changed is left uncommitted on your branch",
    interruptedNothing: "interrupted; nothing was created",
    nothingToResume: (suffix, prefix) => `nothing to resume: run prepare --resume in the *${suffix} worktree, on a ${prefix}* branch`,
    resumeUnfinished: (worktree, problem) => `configure did not finish in ${worktree}: ${problem}; run claude "/cloud-ready configure" there first and then ${RESUME}`,
    nothingChanged: "nothing was changed",
    cloudFailedResume: (error, worktree) => `claude --cloud failed: ${error}; run ${RESUME} in ${worktree} to try again`,
    placeQuestion: "Where do I prepare the repo?",
    placePr: "In a new PR",
    placePrHint: (base) => `recommended · starts from origin/${base}, does not touch your branch or your files`,
    placeHere: "On the current branch, without committing",
    placeHereHint: `you review them with git diff, commit and push, and then run ${VERIFY}`,
    stoppedHere: "prepare stopped; whatever changed is left uncommitted on your branch",
    hereUnfinished: (problem) => `configure did not finish: ${problem}; run claude "/cloud-ready configure" and then prepare again`,
    manualFailed: (file, error) => `could not write ${file}: ${error}`,
    hereTitle: "Done, without committing",
    hereSteps: (manual) => ["Review the changes with git diff", "Commit and push", `Configure the environment in claude.ai (${manual})`, `Run ${VERIFY}`],
    noBranch: "you are not on a branch; switch to the branch you want to verify",
    notPrepared: (problem) => `the repo is not prepared (${problem}); run npx agent-cloud-kit prepare first`,
    dirty: "the preparation has uncommitted changes; commit and push: the cloud only sees what is on origin",
    notPushed: (branch) => `the branch ${branch} is not pushed or has unpushed commits; run git push and run verify again`,
    cloudFailed: (error) => `claude --cloud failed: ${error}`,
    cloudStarted: "The cloud session is running",
    cloudWillReport: (branch, pr) => `the cloud session will report with a push to ${branch}${pr ? " and a comment on the PR" : ""}`,
    rowBranch: "Branch",
    rowPr: "PR",
  },
};
