# Rule catalog

Codes are stable API: they are never renumbered or repurposed, only
added. `plumbline explain <code>` prints the same text offline.

Severity policy:

- **E1xx (error)** — the config will not load, will not do what it says,
  or a server silently cannot start.
- **W2xx (warning)** — something is ignored, fragile or unsafe.
- **I3xx (info)** — advisory; nothing is broken for the linted client.

| Code | Severity | Flags |
|---|---|---|
| E101 | error | config is not parseable JSON |
| E102 | error | comment in a strict-JSON config |
| E103 | error | trailing comma in a strict-JSON config |
| E104 | error | duplicate server name |
| E110 | error | wrong top-level key for this client |
| E111 | error | top-level key looks like a typo of the server container |
| E112 | error | wrong JSON shape |
| E113 | error | `inputs` is only understood by VS Code |
| E120 | error | server has neither `command` nor `url` |
| E121 | error | server has both `command` and `url` |
| E122 | error | `command` must be a non-empty string |
| E123 | error | `args` must be an array of strings |
| E124 | error | `env` must be an object with string values |
| E125 | error | unknown server key that is a near-miss of a real one |
| E126 | error | Claude Desktop cannot launch remote (url) servers from this file |
| E127 | error | transport fields disagree |
| E128 | error | `url` is not a valid http(s) URL |
| E129 | error | `envFile` is only understood by VS Code |
| E130 | error | `command` embeds its arguments |
| E131 | error | ${input:...} has no matching entry in `inputs` |
| E132 | error | ${...} variables are not substituted by this client |
| W201 | warning | file starts with a UTF-8 BOM |
| W202 | warning | duplicate key inside an object |
| W203 | warning | no servers defined |
| W204 | warning | unknown top-level key |
| W205 | warning | unknown server key |
| W206 | warning | `npx` without -y |
| W207 | warning | relative path in command or args |
| W208 | warning | ~ is not expanded |
| W209 | warning | Windows: npm-family shims need cmd /c |
| W210 | warning | plaintext secret in the config |
| W211 | warning | interpreter does not match the script extension |
| W212 | warning | server name may confuse tool namespacing |
| W213 | warning | remote URL over plain http to a non-loopback host |
| I301 | info | JSONC niceties are fine here but not portable |
| I302 | info | input defined but never referenced |
| I303 | info | settings.json-style `mcp` wrapper |

## Details

### E101 — config is not parseable JSON (error)

The file failed to parse, so the client will load nothing from it — most clients fail silently and every server just disappears from the tool list. The finding points at the first offending line and column.

### E102 — comment in a strict-JSON config (error)

Claude Desktop and Cursor parse their config with a strict JSON parser: one // or /* */ comment makes the whole file unreadable and every server vanishes. Only VS Code's mcp.json is JSONC. Delete the comments, or keep notes in a separate file.

### E103 — trailing comma in a strict-JSON config (error)

A comma before a closing brace or bracket is fine in VS Code's JSONC but a hard parse error for Claude Desktop and Cursor. It is the most common survivor of copy-editing a config by hand.

### E104 — duplicate server name (error)

Two servers with the same name: JSON parsers keep the LAST entry and drop the earlier one without a word. If both were meant to run, rename one; if this is a leftover from editing, delete one.

### E110 — wrong top-level key for this client (error)

Claude Desktop and Cursor read `mcpServers`; VS Code's mcp.json reads `servers`. Each client ignores the other's key without an error, so a config pasted across clients loads cleanly and does nothing. This is the single most common cross-client mistake.

### E111 — top-level key looks like a typo of the server container (error)

A key like `mcpserver`, `mcp-servers` or `Servers` is close to the real container but is not it — the client ignores the whole block. The finding names the exact spelling the client expects.

### E112 — wrong JSON shape (error)

The server container must be an object mapping names to entries, and each entry must itself be an object. Arrays, strings and numbers in these positions make clients either error out or skip the entry.

### E113 — `inputs` is only understood by VS Code (error)

The top-level `inputs` array (prompt-for-secret definitions) is a VS Code feature. Claude Desktop and Cursor ignore it, and any ${input:...} references stay unresolved literal strings.

### E120 — server has neither `command` nor `url` (error)

An entry needs a way to reach the server: `command` for a local stdio process, `url` for a remote one (where the client supports remotes). Without either, the entry is dead weight.

### E121 — server has both `command` and `url` (error)

`command` and `url` are two different transports; clients pick one and silently ignore the other (which one wins differs by client and version). Split the entry or delete the leftover field.

### E122 — `command` must be a non-empty string (error)

The command is passed straight to process creation. An empty string, array or object here fails the client's schema check and the server never appears.

### E123 — `args` must be an array of strings (error)

Every element is handed to the OS as one argv entry, and clients validate the types: a bare string, or a number like 8080 in the list, fails validation — quote it ("8080").

### E124 — `env` must be an object with string values (error)

Environment variables are strings by definition. `"PORT": 8080` or `"DEBUG": true` fails client-side schema validation — write "8080" and "true".

### E125 — unknown server key that is a near-miss of a real one (error)

Keys like `arguments`, `cmd`, `environment` or `Command` read fine and do nothing — clients ignore unknown keys, so the intended args/env silently never reach the server. The finding names the key the client actually reads.

### E126 — Claude Desktop cannot launch remote (url) servers from this file (error)

claude_desktop_config.json only describes stdio servers (command/args/env). A `url` entry is ignored. Bridge a remote server through a stdio proxy (for example `npx -y mcp-remote <url>`) or add it through the app's Connectors UI instead.

### E127 — transport fields disagree (error)

`type: "stdio"` with a `url`, `type: "sse"`/`"http"` with a `command`, `headers` without a `url`, or a `type` value outside stdio/sse/http: the entry contradicts itself and the client will reject it or guess.

### E128 — `url` is not a valid http(s) URL (error)

Remote servers are reached over HTTP or HTTPS. A bare hostname, a ws:// or file:// scheme, or an unparseable value fails before any connection is attempted.

### E129 — `envFile` is only understood by VS Code (error)

Loading environment variables from a dotenv file is a VS Code mcp.json feature. Claude Desktop and Cursor ignore the key, and the server starts without those variables — usually failing auth much later. Inline the values under `env` for those clients.

### E130 — `command` embeds its arguments (error)

Clients exec the command directly — no shell splits the string. `"command": "npx -y some-server"` asks the OS for a program literally named `npx -y some-server`, which does not exist. Put the program in `command` and each flag in `args`.

### E131 — ${input:...} has no matching entry in `inputs` (error)

VS Code substitutes ${input:id} from the top-level `inputs` array. A reference without a definition is left unresolved and the server receives the literal string — auth then fails with a confusingly valid-looking token.

### E132 — ${...} variables are not substituted by this client (error)

Claude Desktop and Cursor do not substitute VS Code-style variables like ${workspaceFolder} or ${input:token}; the raw text is passed through to the server. Hard-code the value or use a wrapper script.

### W201 — file starts with a UTF-8 BOM (warning)

JSON.parse — which is what Electron-based clients use — throws on a byte-order mark, so the whole config is unreadable even though every editor shows valid JSON. Save the file as UTF-8 without BOM.

### W202 — duplicate key inside an object (warning)

The same key appears twice inside one server entry (or another object); the last one silently wins. Usually a merge artifact.

### W203 — no servers defined (warning)

The container is present but empty. The file loads and does nothing — fine if intentional, a smell if you expected tools to appear.

### W204 — unknown top-level key (warning)

This key is not part of the client's config surface and is ignored. (Claude Desktop's file doubles as an app settings file, so plumbline only checks near-misses there.)

### W205 — unknown server key (warning)

Not a key this client documents for server entries; it is ignored. If it came from another client's config, check the per-client matrix with `plumbline clients`.

### W206 — `npx` without -y (warning)

Inside an MCP client there is no terminal: the first run of an uncached package stops at npx's install prompt, the client times out, and the server is reported dead. Add -y (or --yes) before the package name.

### W207 — relative path in command or args (warning)

Clients launch servers from an undefined working directory (Claude Desktop effectively from /), so ./build/index.js resolves somewhere else or nowhere. Use an absolute path.

### W208 — ~ is not expanded (warning)

Tilde expansion is a shell feature and there is no shell here: the OS looks for a directory literally named `~`. Write the home directory out in full.

### W209 — Windows: npm-family shims need cmd /c (warning)

On Windows, npx/npm/pnpm/yarn are .cmd shims that CreateProcess cannot exec directly. Wrap them: `"command": "cmd", "args": ["/c", "npx", ...]`. Flagged only when the config shows Windows-style paths.

### W210 — plaintext secret in the config (warning)

A token/key/password value is sitting in a file that is easy to commit (.cursor/mcp.json and .vscode/mcp.json live in the repo) or sync. VS Code can prompt via `inputs`; for other clients keep the secret in the environment or a wrapper script.

### W211 — interpreter does not match the script extension (warning)

`node` pointed at a .py file (or `python` at a .js file) starts and immediately fails with a syntax error the client swallows. Usually a copy-paste between two server blocks.

### W212 — server name may confuse tool namespacing (warning)

Clients prefix tool names with the server name; spaces and exotic characters in it produce tool ids that some models and UIs handle badly. Stick to letters, digits, dash, underscore and dot.

### W213 — remote URL over plain http to a non-loopback host (warning)

Headers — often carrying an Authorization token — travel in cleartext. http:// is fine for 127.0.0.1/localhost; anything else should be https://.

### I301 — JSONC niceties are fine here but not portable (info)

VS Code's mcp.json accepts comments and trailing commas, so this file is valid — but pasting it into Claude Desktop or Cursor will fail their strict JSON parsers. Advisory only.

### I302 — input defined but never referenced (info)

An `inputs` entry exists that no ${input:...} uses. Harmless; usually a leftover after removing a server.

### I303 — settings.json-style `mcp` wrapper (info)

Servers were found under a top-level `mcp` object — the older VS Code settings.json layout. Current VS Code prefers .vscode/mcp.json with a top-level `servers` key; plumbline linted the wrapped content.

