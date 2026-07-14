# Per-client config cheat sheet

Everything plumbline knows about how each client reads its MCP config
lives in `src/clients.ts` as a data profile; this page is the human
version. `plumbline clients` prints the same matrix in the terminal.

## Where the file lives

| | Claude Desktop | Cursor | VS Code |
|---|---|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` | `~/.cursor/mcp.json` | `<project>/.vscode/mcp.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` | `%USERPROFILE%\.cursor\mcp.json` | `<project>\.vscode\mcp.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` | `~/.cursor/mcp.json` | `<project>/.vscode/mcp.json` |
| per-project | none — global only | `<project>/.cursor/mcp.json` | `<project>/.vscode/mcp.json` |

VS Code also supports a user-profile `mcp.json` and, historically, a
`"mcp": { "servers": ... }` block inside settings.json (plumbline
unwraps that layout and notes it as I303).

## Dialect differences that break configs

| | Claude Desktop | Cursor | VS Code |
|---|---|---|---|
| top-level key | `mcpServers` | `mcpServers` | `servers` (+ `inputs`) |
| parser | strict JSON | strict JSON | JSONC |
| comments / trailing commas | fatal (E102/E103) | fatal (E102/E103) | fine (I301 notes portability) |
| transports | stdio only | stdio, sse, http | stdio, sse, http |
| `url` servers | no — E126, bridge via a stdio proxy | yes | yes |
| `type` field | not read | not read | `stdio` / `sse` / `http` |
| `${...}` variables | passed through literally (E132) | passed through literally (E132) | substituted |
| `inputs` prompts | ignored (E113) | ignored (E113) | supported |
| `envFile` | ignored (E129) | ignored (E129) | supported |
| unrelated top-level keys | legal — it is the app settings file | flagged W204 | flagged W204 |

## Server-entry keys each client reads

| | keys |
|---|---|
| Claude Desktop | `command`, `args`, `env` |
| Cursor | `command`, `args`, `env`, `url`, `headers` |
| VS Code | `type`, `command`, `args`, `env`, `envFile`, `url`, `headers`, `dev` |

Anything else is ignored by the client. plumbline grades unknown keys in
three tiers: an exact match for *another* client's key is W205 naming
that client; a near-miss of a valid key (`cmd`, `arguments`, `agrs`,
wrong casing) is E125 with a did-you-mean; the rest is a generic W205.

## The launch environment (why so many pitfalls exist)

Clients spawn stdio servers with `exec`-style process creation:

- **No shell.** Nothing splits `"npx -y pkg"` (E130), expands `~` (W208)
  or resolves `$HOME`. On Windows, `.cmd` shims like npx cannot be
  exec'd at all without `cmd /c` (W209).
- **Undefined working directory.** Claude Desktop launches servers from
  a directory you do not control; relative paths resolve nowhere (W207).
- **No terminal.** npx's first-run install prompt has nobody to answer
  it; the client times out and reports the server dead (W206).
- **A restricted PATH.** GUI apps on macOS do not inherit your shell's
  PATH — another reason absolute commands are safer.
