/**
 * The lint engine. Takes raw config text, picks (or is told) the client,
 * and runs three layers of checks:
 *
 *   1. file level   — parse errors, BOM, comments/trailing commas per
 *                     client dialect, duplicate keys;
 *   2. top level    — the right container key for the client, typos,
 *                     inputs support, shapes;
 *   3. server level — per-client key allowlists, transports, value
 *                     types, then the launch pitfalls (pitfalls.ts).
 *
 * Everything returns plain Finding values; nothing here touches the
 * filesystem, so the whole engine is unit-testable with strings.
 */

import { CLIENTS, type ClientProfile } from "./clients.js";
import { detectClient } from "./detect.js";
import {
  asObject,
  asString,
  keysOf,
  lastEntry,
  parseJsonc,
  shadowedEntries,
  typeName,
  type JsonEntry,
  type JsonNode,
  type JsonObject,
} from "./jsonc.js";
import { nearest } from "./nearest.js";
import { checkPitfalls } from "./pitfalls.js";
import type { ClientId, Detection, FileResult, Finding, Position, Severity } from "./types.js";

export interface AnalyzeOptions {
  /** Force a client instead of auto-detecting. */
  client?: ClientId;
  /** The on-disk path, used for detection. */
  filePath?: string | null;
  /** Display name in reports; defaults to filePath or "<stdin>". */
  fileLabel?: string;
}

/** Fields every server entry may never carry twice, per finding. */
interface Ctx {
  profile: ClientProfile;
  findings: Finding[];
}

function push(
  ctx: Ctx,
  code: string,
  severity: Severity,
  path: string,
  message: string,
  fix: string,
  pos?: Position,
  server?: string,
): void {
  ctx.findings.push({
    code,
    severity,
    path,
    message,
    fix,
    ...(server !== undefined ? { server } : {}),
    ...(pos ? { line: pos.line, column: pos.column } : {}),
  });
}

function q(value: string): string {
  return JSON.stringify(value);
}

/** Walk all string scalars under a node, with their dotted paths. */
function walkStrings(
  node: JsonNode,
  path: string,
  visit: (value: string, path: string, pos: Position) => void,
): void {
  if (node.kind === "scalar") {
    if (typeof node.value === "string") visit(node.value, path, node.pos);
    return;
  }
  if (node.kind === "array") {
    node.items.forEach((item, index) => walkStrings(item, `${path}[${index}]`, visit));
    return;
  }
  for (const entry of node.entries) {
    walkStrings(entry.value, path ? `${path}.${entry.key}` : entry.key, visit);
  }
}

/** True when any string in the document looks like a Windows path. */
function hasWindowsEvidence(root: JsonNode, filePath: string | null): boolean {
  if (filePath && (/^[A-Za-z]:\\/.test(filePath) || /appdata/i.test(filePath))) return true;
  let found = false;
  walkStrings(root, "", (value) => {
    if (/^[A-Za-z]:\\/.test(value) || /^\\\\[^\\]/.test(value)) found = true;
  });
  return found;
}

/** File-level dialect checks: BOM, comments, trailing commas. */
function checkDialect(
  ctx: Ctx,
  parsed: ReturnType<typeof parseJsonc>,
): void {
  if (parsed.hasBom) {
    push(
      ctx,
      "W201",
      "warning",
      "(file)",
      "the file starts with a UTF-8 byte-order mark — JSON.parse (what Electron-based clients use) throws on it, so the whole config is unreadable",
      "re-save the file as UTF-8 without BOM",
      { offset: 0, line: 1, column: 1 },
    );
  }
  if (ctx.profile.allowsJsonc) {
    if (parsed.comments.length > 0 || parsed.trailingCommas.length > 0) {
      const bits: string[] = [];
      if (parsed.comments.length > 0) bits.push(`${parsed.comments.length} comment(s)`);
      if (parsed.trailingCommas.length > 0) {
        bits.push(`${parsed.trailingCommas.length} trailing comma(s)`);
      }
      const firstPos = parsed.comments[0]?.pos ?? parsed.trailingCommas[0];
      push(
        ctx,
        "I301",
        "info",
        "(file)",
        `${bits.join(" and ")} — fine in ${ctx.profile.label}'s JSONC, but this file will not paste into Claude Desktop or Cursor, whose parsers are strict JSON`,
        "nothing to do unless you share this file across clients",
        firstPos,
      );
    }
    return;
  }
  for (const comment of parsed.comments) {
    push(
      ctx,
      "E102",
      "error",
      "(file)",
      `a ${comment.style === "line" ? "//" : "/* */"} comment — ${ctx.profile.label} parses this file as strict JSON, so one comment makes every server vanish`,
      "delete the comment (only VS Code's mcp.json accepts comments)",
      comment.pos,
    );
  }
  for (const commaPos of parsed.trailingCommas) {
    push(
      ctx,
      "E103",
      "error",
      "(file)",
      `a trailing comma — valid in VS Code's JSONC, a hard parse error in ${ctx.profile.label}`,
      "remove the comma before the closing brace/bracket",
      commaPos,
    );
  }
}

/** Top-level checks. Returns the server container object, if usable. */
function checkTopLevel(
  ctx: Ctx,
  root: JsonObject,
): { container: JsonObject | null; containerPath: string; inputIds: Map<string, Position> } {
  const profile = ctx.profile;
  let effectiveRoot = root;
  let containerPath: string = profile.configKey;

  // Older VS Code layout: servers wrapped in a settings.json "mcp" object.
  if (profile.id === "vscode" && !lastEntry(root, "servers")) {
    const wrapper = asObject(lastEntry(root, "mcp")?.value);
    if (wrapper && lastEntry(wrapper, "servers")) {
      push(
        ctx,
        "I303",
        "info",
        "mcp",
        "servers live under a top-level `mcp` object — the older settings.json layout; current VS Code prefers .vscode/mcp.json with a top-level `servers` key",
        "move the contents of `mcp` into .vscode/mcp.json",
        lastEntry(root, "mcp")?.keyPos,
      );
      effectiveRoot = wrapper;
      containerPath = "mcp.servers";
    }
  }

  // The other clients' container key present → the #1 cross-client bug.
  for (const wrongKey of profile.wrongConfigKeys) {
    const wrong = lastEntry(effectiveRoot, wrongKey);
    if (!wrong) continue;
    const rightPresent = lastEntry(effectiveRoot, profile.configKey) !== null;
    push(
      ctx,
      "E110",
      "error",
      wrongKey,
      rightPresent
        ? `\`${wrongKey}\` sits next to \`${profile.configKey}\` — ${profile.label} reads only \`${profile.configKey}\` and silently ignores this block`
        : `\`${wrongKey}\` is another client's container key — ${profile.label} reads \`${profile.configKey}\`, so every server in this file is silently ignored`,
      `rename the key to "${profile.configKey}"${
        profile.configKey === "servers" ? " (the VS Code mcp.json layout)" : ""
      }`,
      wrong.keyPos,
    );
  }

  // Typos of the container / other unknown top-level keys.
  for (const entry of effectiveRoot.entries) {
    const key = entry.key;
    if (profile.topLevelKeys.includes(key)) continue;
    if (profile.wrongConfigKeys.includes(key)) continue; // E110 above
    if (key === "mcp" && profile.id === "vscode") continue; // settings.json wrapper, handled above
    if (key === "inputs" && !profile.supportsInputs) {
      push(
        ctx,
        "E113",
        "error",
        "inputs",
        `\`inputs\` is a VS Code feature — ${profile.label} ignores it, and any \${input:...} reference stays a literal string`,
        "hard-code the values for this client, or keep this file for VS Code only",
        entry.keyPos,
      );
      continue;
    }
    const candidates = [...profile.topLevelKeys];
    const close = nearest(key, candidates, 3);
    if (close && key.toLowerCase() !== close.toLowerCase()) {
      push(
        ctx,
        "E111",
        "error",
        key,
        `\`${key}\` looks like a typo of \`${close}\` — ${profile.label} ignores unknown keys, so this whole block does nothing`,
        `rename the key to "${close}"`,
        entry.keyPos,
      );
      continue;
    }
    if (close && key !== close) {
      // Same letters, wrong case: JSON keys are case-sensitive.
      push(
        ctx,
        "E111",
        "error",
        key,
        `\`${key}\` has the wrong casing — JSON keys are case-sensitive and ${profile.label} reads \`${close}\``,
        `rename the key to "${close}"`,
        entry.keyPos,
      );
      continue;
    }
    if (profile.strictTopLevel) {
      push(
        ctx,
        "W204",
        "warning",
        key,
        `\`${key}\` is not part of ${profile.label}'s config surface and is ignored`,
        "remove it, or check `plumbline clients` if it belongs to another client",
        entry.keyPos,
      );
    }
    // Claude Desktop's file doubles as app settings: unknown keys are fine.
  }

  // Duplicate top-level keys (e.g. two mcpServers blocks after a merge).
  for (const shadowed of shadowedEntries(effectiveRoot)) {
    push(
      ctx,
      "W202",
      "warning",
      shadowed.key,
      `\`${shadowed.key}\` appears more than once at the top level — only the last occurrence is read`,
      "merge the duplicate blocks into one",
      shadowed.keyPos,
    );
  }

  // Collect VS Code inputs (also validates their shape).
  const inputIds = new Map<string, Position>();
  const inputsEntry = lastEntry(effectiveRoot, "inputs");
  if (inputsEntry && profile.supportsInputs) {
    if (inputsEntry.value.kind !== "array") {
      push(
        ctx,
        "E112",
        "error",
        "inputs",
        `\`inputs\` must be an array of prompt definitions, not ${typeName(inputsEntry.value)}`,
        `write: "inputs": [{ "type": "promptString", "id": "...", "password": true }]`,
        inputsEntry.keyPos,
      );
    } else {
      inputsEntry.value.items.forEach((item, index) => {
        const obj = asObject(item);
        const id = obj ? asString(lastEntry(obj, "id")?.value) : null;
        if (!obj || !id) {
          push(
            ctx,
            "E112",
            "error",
            `inputs[${index}]`,
            "an `inputs` entry needs at least a string `id` (plus `type`, usually \"promptString\")",
            `write: { "type": "promptString", "id": "api-token", "password": true }`,
            item.pos,
          );
          return;
        }
        inputIds.set(id, item.pos);
      });
    }
  }

  // Resolve the server container.
  const containerEntry = lastEntry(effectiveRoot, profile.configKey);
  if (!containerEntry) {
    const hasSubstitute =
      profile.wrongConfigKeys.some((key) => lastEntry(effectiveRoot, key)) ||
      effectiveRoot.entries.some(
        (entry) => !profile.topLevelKeys.includes(entry.key) && nearest(entry.key, [...profile.topLevelKeys], 3),
      );
    if (!hasSubstitute) {
      push(
        ctx,
        "W203",
        "warning",
        profile.configKey,
        `no \`${profile.configKey}\` key — ${profile.label} finds zero MCP servers in this file`,
        `add: "${profile.configKey}": { "<name>": { ... } }`,
        effectiveRoot.pos,
      );
    }
    return { container: null, containerPath, inputIds };
  }
  const container = asObject(containerEntry.value);
  if (!container) {
    push(
      ctx,
      "E112",
      "error",
      containerPath,
      `\`${profile.configKey}\` must be an object mapping server names to entries, not ${typeName(containerEntry.value)}`,
      `write: "${profile.configKey}": { "my-server": { "command": "..." } }`,
      containerEntry.keyPos,
    );
    return { container: null, containerPath, inputIds };
  }
  if (container.entries.length === 0) {
    push(
      ctx,
      "W203",
      "warning",
      containerPath,
      `\`${profile.configKey}\` is empty — the file loads and configures nothing`,
      "add a server entry, or delete the file to avoid confusion",
      containerEntry.keyPos,
    );
  }
  // Duplicate server names: the earlier definition silently loses.
  for (const shadowed of shadowedEntries(container)) {
    push(
      ctx,
      "E104",
      "error",
      `${containerPath}.${shadowed.key}`,
      `server ${q(shadowed.key)} is defined more than once — JSON keeps the last entry and this one is silently dropped`,
      "rename one of the entries, or delete the leftover",
      shadowed.keyPos,
      shadowed.key,
    );
  }
  return { container, containerPath, inputIds };
}

/**
 * Common wrong names for server keys, seen in the wild. Only applied
 * when the target key is valid for the client being linted.
 */
const KEY_ALIASES: Record<string, string> = {
  cmd: "command",
  exec: "command",
  executable: "command",
  bin: "command",
  binary: "command",
  program: "command",
  arguments: "args",
  argv: "args",
  params: "args",
  parameters: "args",
  environment: "env",
  envs: "env",
  vars: "env",
  variables: "env",
  endpoint: "url",
  uri: "url",
  address: "url",
};

/** Keys → the client that actually owns them, for W205 messages. */
function ownedElsewhere(key: string, profile: ClientProfile): string | null {
  for (const other of Object.values(CLIENTS)) {
    if (other.id === profile.id) continue;
    if (other.serverKeys.includes(key)) return other.label;
  }
  return null;
}

/** Schema + transport checks for one server entry. */
function checkServer(
  ctx: Ctx,
  serverName: string,
  entry: JsonEntry,
  containerPath: string,
): void {
  const profile = ctx.profile;
  const pathPrefix = `${containerPath}.${serverName}`;

  if (!/^[A-Za-z0-9_.-]+$/.test(serverName)) {
    push(
      ctx,
      "W212",
      "warning",
      pathPrefix,
      serverName.trim() === ""
        ? "the server name is empty or whitespace"
        : `server name ${q(serverName)} contains characters outside [A-Za-z0-9_.-] — clients prefix tool names with it, and some models and UIs handle the result badly`,
      "use letters, digits, dash, underscore and dot",
      entry.keyPos,
      serverName,
    );
  }

  const server = asObject(entry.value);
  if (!server) {
    push(
      ctx,
      "E112",
      "error",
      pathPrefix,
      `a server entry must be an object, not ${typeName(entry.value)}`,
      `write: ${q(serverName)}: { "command": "...", "args": [...] }`,
      entry.keyPos,
      serverName,
    );
    return;
  }

  for (const shadowed of shadowedEntries(server)) {
    push(
      ctx,
      "W202",
      "warning",
      `${pathPrefix}.${shadowed.key}`,
      `\`${shadowed.key}\` appears twice in this entry — only the last occurrence is read`,
      "delete the duplicate",
      shadowed.keyPos,
      serverName,
    );
  }

  const commandEntry = lastEntry(server, "command");
  const urlEntry = lastEntry(server, "url");
  const typeEntry = lastEntry(server, "type");
  const headersEntry = lastEntry(server, "headers");

  // Per-client key allowlist with did-you-mean.
  for (const key of keysOf(server)) {
    if (profile.serverKeys.includes(key)) continue;
    if (key === "url" && profile.id === "claude") continue; // E126 below
    if (key === "envFile" && !profile.supportsEnvFile) {
      push(
        ctx,
        "E129",
        "error",
        `${pathPrefix}.envFile`,
        `\`envFile\` is a VS Code feature — ${profile.label} ignores it and the server starts without those variables, usually failing auth much later`,
        'inline the variables under "env" for this client',
        lastEntry(server, key)?.keyPos,
        serverName,
      );
      continue;
    }
    // An exact match for another client's documented key beats a fuzzy
    // did-you-mean: `dev` in a Cursor config is a VS Code field, not a
    // typo of `env`.
    const owner = ownedElsewhere(key, profile);
    if (owner) {
      push(
        ctx,
        "W205",
        "warning",
        `${pathPrefix}.${key}`,
        `\`${key}\` is a ${owner} field — ${profile.label} does not read it`,
        "remove it, or check the per-client matrix with `plumbline clients`",
        lastEntry(server, key)?.keyPos,
        serverName,
      );
      continue;
    }
    const alias = KEY_ALIASES[key.toLowerCase()];
    const close =
      alias && profile.serverKeys.includes(alias) ? alias : nearest(key, profile.serverKeys, 2);
    if (close) {
      const casing = key.toLowerCase() === close.toLowerCase();
      push(
        ctx,
        "E125",
        "error",
        `${pathPrefix}.${key}`,
        casing
          ? `\`${key}\` has the wrong casing — JSON keys are case-sensitive and ${profile.label} reads \`${close}\`, so this value is silently ignored`
          : `\`${key}\` is not a key ${profile.label} reads — it is silently ignored (did you mean \`${close}\`?)`,
        `rename the key to "${close}"`,
        lastEntry(server, key)?.keyPos,
        serverName,
      );
      continue;
    }
    push(
      ctx,
      "W205",
      "warning",
      `${pathPrefix}.${key}`,
      `\`${key}\` is not part of ${profile.label}'s documented server schema and is ignored`,
      "remove it, or check the per-client matrix with `plumbline clients`",
      lastEntry(server, key)?.keyPos,
      serverName,
    );
  }

  // Transport selection.
  if (!commandEntry && !urlEntry) {
    push(
      ctx,
      "E120",
      "error",
      pathPrefix,
      profile.transports.includes("http")
        ? "the entry has neither `command` (stdio) nor `url` (remote) — there is no way to reach this server"
        : "the entry has no `command` — there is no way to launch this server",
      profile.transports.includes("http")
        ? 'add "command" for a local server or "url" for a remote one'
        : 'add "command" (plus "args"/"env" as needed)',
      entry.keyPos,
      serverName,
    );
    // Fall through: args/env checks below still apply to the dead entry.
  }
  if (commandEntry && urlEntry) {
    push(
      ctx,
      "E121",
      "error",
      pathPrefix,
      `both \`command\` and \`url\` are set — they are two different transports and ${profile.label} will silently pick one and ignore the other`,
      "split this into two entries, or delete the leftover field",
      urlEntry.keyPos,
      serverName,
    );
  }
  if (urlEntry && profile.id === "claude" && !commandEntry) {
    push(
      ctx,
      "E126",
      "error",
      `${pathPrefix}.url`,
      "Claude Desktop cannot launch remote servers from this file — claude_desktop_config.json only describes stdio servers, so this entry is ignored",
      `bridge it through a stdio proxy: "command": "npx", "args": ["-y", "mcp-remote", ${q(
        asString(urlEntry.value) ?? "<url>",
      )}] — or add it in the app's Connectors UI`,
      urlEntry.keyPos,
      serverName,
    );
  }

  // command / args / env value types.
  if (commandEntry) {
    const command = asString(commandEntry.value);
    if (command === null || command.trim() === "") {
      push(
        ctx,
        "E122",
        "error",
        `${pathPrefix}.command`,
        command === null
          ? `\`command\` must be a string, not ${typeName(commandEntry.value)}`
          : "`command` is empty — there is nothing to launch",
        `write: "command": "npx" (the program only; flags go in "args")`,
        commandEntry.value.pos,
        serverName,
      );
    }
  }
  const argsEntry = lastEntry(server, "args");
  if (argsEntry) {
    if (argsEntry.value.kind !== "array") {
      push(
        ctx,
        "E123",
        "error",
        `${pathPrefix}.args`,
        `\`args\` must be an array of strings, not ${typeName(argsEntry.value)}`,
        `write: "args": ["-y", "some-package"]`,
        argsEntry.value.pos,
        serverName,
      );
    } else {
      argsEntry.value.items.forEach((item, index) => {
        if (asString(item) === null) {
          const rendered = item.kind === "scalar" ? JSON.stringify(item.value) : typeName(item);
          push(
            ctx,
            "E123",
            "error",
            `${pathPrefix}.args[${index}]`,
            `args[${index}] is ${rendered} — every element must be a string; clients fail schema validation on anything else`,
            `quote it: ${q(item.kind === "scalar" ? String(item.value) : "...")}`,
            item.pos,
            serverName,
          );
        }
      });
    }
  }
  const envEntry = lastEntry(server, "env");
  if (envEntry) {
    const env = asObject(envEntry.value);
    if (!env) {
      push(
        ctx,
        "E124",
        "error",
        `${pathPrefix}.env`,
        `\`env\` must be an object of string values, not ${typeName(envEntry.value)}`,
        `write: "env": { "NAME": "value" }`,
        envEntry.value.pos,
        serverName,
      );
    } else {
      for (const pair of env.entries) {
        if (asString(pair.value) === null) {
          const rendered = pair.value.kind === "scalar" ? JSON.stringify(pair.value.value) : typeName(pair.value);
          push(
            ctx,
            "E124",
            "error",
            `${pathPrefix}.env.${pair.key}`,
            `env.${pair.key} is ${rendered} — environment variables are strings by definition and clients reject anything else`,
            `quote it: "${pair.key}": ${q(pair.value.kind === "scalar" ? String(pair.value.value) : "...")}`,
            pair.value.pos,
            serverName,
          );
        }
      }
    }
  }

  // url validity + cleartext check.
  if (urlEntry && profile.id !== "claude") {
    const url = asString(urlEntry.value);
    if (url === null) {
      push(
        ctx,
        "E128",
        "error",
        `${pathPrefix}.url`,
        `\`url\` must be a string, not ${typeName(urlEntry.value)}`,
        `write: "url": "https://example.test/mcp"`,
        urlEntry.value.pos,
        serverName,
      );
    } else {
      let parsedUrl: URL | null = null;
      try {
        parsedUrl = new URL(url);
      } catch {
        parsedUrl = null;
      }
      if (!parsedUrl || (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:")) {
        push(
          ctx,
          "E128",
          "error",
          `${pathPrefix}.url`,
          parsedUrl
            ? `${q(url)} uses ${parsedUrl.protocol}// — remote MCP servers are reached over http(s) only`
            : `${q(url)} is not a parseable URL`,
          `write a full URL, e.g. "https://example.test/mcp"`,
          urlEntry.value.pos,
          serverName,
        );
      } else if (
        parsedUrl.protocol === "http:" &&
        !["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsedUrl.hostname)
      ) {
        push(
          ctx,
          "W213",
          "warning",
          `${pathPrefix}.url`,
          `plain http to ${parsedUrl.hostname} — headers (often an Authorization token) travel in cleartext`,
          "use https://, or keep http for 127.0.0.1/localhost only",
          urlEntry.value.pos,
          serverName,
        );
      }
    }
  }

  // VS Code `type` consistency; `headers` needs a url everywhere.
  if (typeEntry && profile.id === "vscode") {
    const type = asString(typeEntry.value);
    if (type === null || !["stdio", "sse", "http"].includes(type)) {
      push(
        ctx,
        "E127",
        "error",
        `${pathPrefix}.type`,
        `\`type\` must be "stdio", "sse" or "http"${type === null ? `, not ${typeName(typeEntry.value)}` : ` — got ${q(type)}`}`,
        `pick one: "stdio" for command-based servers, "http" or "sse" for url-based ones`,
        typeEntry.value.pos,
        serverName,
      );
    } else if (type === "stdio" && urlEntry && !commandEntry) {
      push(
        ctx,
        "E127",
        "error",
        `${pathPrefix}.type`,
        '`type: "stdio"` contradicts the `url` field — stdio servers are launched with `command`',
        'change type to "http"/"sse", or replace `url` with `command`',
        typeEntry.value.pos,
        serverName,
      );
    } else if ((type === "sse" || type === "http") && commandEntry && !urlEntry) {
      push(
        ctx,
        "E127",
        "error",
        `${pathPrefix}.type`,
        `\`type: ${q(type)}\` contradicts the \`command\` field — remote servers are reached with \`url\``,
        'change type to "stdio", or replace `command` with `url`',
        typeEntry.value.pos,
        serverName,
      );
    }
  }
  if (headersEntry && !urlEntry) {
    push(
      ctx,
      "E127",
      "error",
      `${pathPrefix}.headers`,
      "`headers` only applies to url-based servers — a stdio server has no HTTP requests to attach them to",
      "delete `headers`, or turn this into a url-based entry",
      headersEntry.keyPos,
      serverName,
    );
  }
}

/** ${...} variable checks over the whole container. */
function checkVariables(
  ctx: Ctx,
  container: JsonObject,
  containerPath: string,
  inputIds: Map<string, Position>,
): void {
  const profile = ctx.profile;
  const referenced = new Set<string>();
  walkStrings(container, containerPath, (value, path, pos) => {
      const matches = value.matchAll(/\$\{([^}]*)\}/g);
      for (const match of matches) {
        const inner = match[1] ?? "";
        if (!profile.supportsVariables) {
          push(
            ctx,
            "E132",
            "error",
            path,
            `\${${inner}} is not substituted by ${profile.label} — the server receives the literal text`,
            "hard-code the value for this client, or launch through a wrapper script that expands it",
            pos,
          );
          continue;
        }
        if (inner.startsWith("input:")) {
          const id = inner.slice("input:".length);
          referenced.add(id);
          if (!inputIds.has(id)) {
            push(
              ctx,
              "E131",
              "error",
              path,
              `\${input:${id}} has no matching entry in \`inputs\` — VS Code leaves it unresolved and the server receives the literal string`,
              `add: { "type": "promptString", "id": ${q(id)}, "password": true } to the top-level "inputs" array`,
              pos,
            );
          }
        }
      }
    },
  );
  if (profile.supportsVariables) {
    for (const [id, pos] of inputIds) {
      if (!referenced.has(id)) {
        push(
          ctx,
          "I302",
          "info",
          `inputs.${id}`,
          `input ${q(id)} is defined but nothing references \${input:${id}} — usually a leftover after removing a server`,
          "delete the unused input, or wire it into a server",
          pos,
        );
      }
    }
  }
}

/** Sort findings top-to-bottom, then by code for full determinism. */
function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const lineA = a.line ?? 0;
    const lineB = b.line ?? 0;
    if (lineA !== lineB) return lineA - lineB;
    const colA = a.column ?? 0;
    const colB = b.column ?? 0;
    if (colA !== colB) return colA - colB;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
}

/** Lint one config document. Pure: text in, findings out. */
export function analyzeConfig(text: string, options: AnalyzeOptions = {}): FileResult {
  const filePath = options.filePath ?? null;
  const file = options.fileLabel ?? filePath ?? "<stdin>";
  const parsed = parseJsonc(text);
  const detection: Detection = detectClient(filePath, parsed.root, options.client);
  const profile = CLIENTS[detection.client];
  const ctx: Ctx = { profile, findings: [] };

  checkDialect(ctx, parsed);

  if (parsed.error) {
    push(
      ctx,
      "E101",
      "error",
      "(file)",
      `not parseable JSON: ${parsed.error.message} — ${profile.label} will load nothing from this file`,
      "fix the syntax at the reported position; every check below depends on it",
      parsed.error.pos,
    );
    return {
      file,
      client: profile.id,
      detection,
      serverCount: 0,
      findings: sortFindings(ctx.findings),
      fatal: true,
    };
  }

  const root = asObject(parsed.root);
  if (!root) {
    push(
      ctx,
      "E112",
      "error",
      "(file)",
      `the top level must be a JSON object, not ${parsed.root ? typeName(parsed.root) : "nothing"}`,
      `start from: { "${profile.configKey}": { } }`,
      parsed.root?.pos,
    );
    return {
      file,
      client: profile.id,
      detection,
      serverCount: 0,
      findings: sortFindings(ctx.findings),
      fatal: true,
    };
  }

  const { container, containerPath, inputIds } = checkTopLevel(ctx, root);
  let serverCount = 0;
  if (container) {
    const windowsEvidence = hasWindowsEvidence(root, filePath);
    const names = keysOf(container);
    serverCount = names.length;
    for (const name of names) {
      const entry = lastEntry(container, name);
      if (!entry) continue;
      checkServer(ctx, name, entry, containerPath);
      const server = asObject(entry.value);
      if (server) {
        ctx.findings.push(
          ...checkPitfalls({
            profile,
            serverName: name,
            pathPrefix: `${containerPath}.${name}`,
            entry: server,
            windowsEvidence,
          }),
        );
      }
    }
    checkVariables(ctx, container, containerPath, inputIds);
  }

  return {
    file,
    client: profile.id,
    detection,
    serverCount,
    findings: sortFindings(ctx.findings),
    fatal: false,
  };
}
