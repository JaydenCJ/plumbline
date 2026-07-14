# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- `plumbline check`: lints MCP client config files against the dialect
  of the client that will read them — Claude Desktop, Cursor or VS Code —
  with auto-detection from the file path (claude_desktop_config.json,
  `.cursor/`, `.vscode/`) and the document shape, always surfaced in the
  report header and overridable with `--client`.
- A position-tracking JSONC parser built for linting: keeps duplicate
  object entries (E104/W202 instead of silent last-wins), records every
  comment and trailing comma so they can be graded per client
  (fatal E102/E103 for Claude Desktop and Cursor, advisory I301 for
  VS Code), detects the JSON.parse-killing UTF-8 BOM (W201), and gives
  every finding a line number.
- Per-client schema knowledge as data: the right top-level container key
  (`mcpServers` vs `servers`, E110 in both directions), per-client server
  key allowlists with three-tier unknown-key grading (another client's
  key → W205 naming it, near-miss/alias/casing → E125 did-you-mean),
  transports (E126 remote-in-Claude with a stdio-bridge fix, E127 type
  mismatches), VS Code `inputs`/`${...}` variables (E113, E131, E132,
  I302) and `envFile` (E129).
- Launch-pitfall heuristics judged on the effective invocation:
  arguments embedded in `command` (E130 with the exact split as the
  fix), `npx` without `-y` (W206), relative paths from an undefined cwd
  (W207), unexpanded `~` (W208), Windows `.cmd` shims needing `cmd /c`
  (W209, only with Windows-path evidence), plaintext credentials with
  per-client advice (W210), interpreter/script mismatches (W211), and
  cleartext http to non-loopback hosts (W213).
- `plumbline clients`: the per-client cheat sheet (paths, top-level key,
  transports, dialect, variables, inputs, envFile) as a terminal table.
- `plumbline explain`: offline documentation for every rule code, client
  and concept (strict-json, detection, variables, inputs, secrets,
  remote, exit-codes), with did-you-mean on unknown topics.
- CI-ready surface: `--fail-on error|warning|info|never` (default
  warning), `--format json` with a stable shape, `--quiet`, stdin via
  `-`, multiple files per run, and exit codes 0 (clean) / 1 (findings) /
  2 (usage error).
- Public programmatic API (`analyzeConfig`, `parseJsonc`, `detectClient`,
  `renderText`, `renderJson`, `RULES`, `CLIENTS`, ...) with type
  declarations.
- Test suite: 89 node:test tests (unit + CLI integration in fresh temp
  dirs) and an end-to-end `scripts/smoke.sh` against the bundled broken
  Claude Desktop / Cursor / VS Code example configs and a clean twin.

[0.1.0]: https://github.com/JaydenCJ/plumbline/releases/tag/v0.1.0
