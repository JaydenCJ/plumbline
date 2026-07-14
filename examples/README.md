# Examples

Four configs you will recognize from real MCP setup debugging. Each file
seeds mistakes plumbline is built to catch; the test suite and
`scripts/smoke.sh` run against them, so the annotations below are
guaranteed to stay accurate.

## Try it

```bash
# from the repository root, after `npm install && npm run build`
node dist/cli.js check examples/claude_desktop_config.json    # exit 1: 5 errors, 5 warnings
node dist/cli.js check --client cursor examples/cursor-mcp.json  # exit 1: 3 errors, 2 warnings
node dist/cli.js check examples/vscode-mcp.json               # exit 1: 2 errors, 2 info
node dist/cli.js check examples/clean-claude.json             # exit 0: clean
```

## What the seeded mistakes demonstrate

### `claude_desktop_config.json` — the classic Claude Desktop five

| Mistake | Rule | Why it matters |
|---|---|---|
| `"command": "npx -y server-github"` | E130 | no shell splits it; the OS wants a program with that literal name |
| `npx` without `-y` | W206 | first run hangs on the install prompt; the client has no terminal |
| `"~/Documents"` in args | W208 | nothing expands `~` — there is no shell in the launch path |
| `python` running `./servers/sqlite.js` | W207 + W211 | relative path from an undefined cwd, and the wrong interpreter |
| `"url": ...` entry | E126 | Claude Desktop cannot launch remote servers from this file |
| `"cmd"` instead of `"command"` | E125 + E120 | unknown keys are silently ignored |
| `8080` unquoted in args | E123 | args must be strings; clients fail schema validation |
| a token in `env` | W210 | plaintext credential in a synced file |

### `cursor-mcp.json` — strict JSON strikes back

A `//` comment (E102) and a trailing comma (E103) that Cursor's strict
JSON parser chokes on, a duplicate server name where the first block
silently loses (E104), plain http to a non-loopback host with an
Authorization header (W213 + W210).

### `vscode-mcp.json` — VS Code's own footguns

`type: "sse"` contradicting a `command` field (E127), a
`${input:docs-token}` reference with no matching `inputs` entry (E131),
an input defined but never used (I302) — plus I301 noting the comment is
fine here but will not survive a paste into the other clients.

### `clean-claude.json` — what good looks like

Absolute paths, `-y` on npx, strings everywhere, no secrets. Exits 0.
