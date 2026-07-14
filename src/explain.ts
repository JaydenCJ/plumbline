/**
 * `plumbline explain <topic>` — the offline manual. Topics are rule
 * codes (E130), client names (claude, cursor, vscode) and a handful of
 * concepts (strict-json, variables, exit-codes, ...). Unknown topics get
 * a did-you-mean and exit code 2 upstream.
 */

import { CLIENT_IDS, CLIENTS, clientMatrix } from "./clients.js";
import { nearest } from "./nearest.js";
import { ruleByCode, ruleCodes, RULES } from "./rules.js";

const CONCEPTS: Record<string, { title: string; body: string }> = {
  "strict-json": {
    title: "Which clients parse strictly, and why it bites",
    body: [
      "Claude Desktop and Cursor read their config with a strict JSON parser:",
      "one comment, one trailing comma or a UTF-8 BOM makes the whole file",
      "unreadable, and most versions fail silently — the servers just vanish.",
      "VS Code's mcp.json is JSONC and accepts comments and trailing commas.",
      "plumbline grades these per client: E102/E103 where they break, I301",
      "(portability advisory) where they are legal.",
    ].join("\n"),
  },
  detection: {
    title: "How plumbline picks the client dialect",
    body: [
      "Order of trust: --client beats everything; then the file path",
      "(claude_desktop_config.json, .cursor/, .vscode/); then the document",
      "shape (`servers`/`inputs` means VS Code; `mcpServers` with a url",
      "server means Cursor; otherwise Claude Desktop, the strictest dialect).",
      "The report header always says which client was used and why.",
    ].join("\n"),
  },
  variables: {
    title: "${...} substitution support",
    body: [
      "VS Code substitutes ${input:id}, ${workspaceFolder} and friends in",
      "mcp.json values. Claude Desktop and Cursor substitute nothing: the",
      "literal text reaches the server (E132). In VS Code, a ${input:id}",
      "without a matching `inputs` entry stays unresolved too (E131).",
    ].join("\n"),
  },
  inputs: {
    title: "VS Code inputs: prompting instead of hard-coding",
    body: [
      'The top-level `inputs` array defines prompts: { "type": "promptString",',
      '"id": "api-token", "password": true }. Servers reference them as',
      '"${input:api-token}" and VS Code asks once, storing the value outside',
      "the config file. Other clients ignore `inputs` entirely (E113), which",
      "is why plumbline flags plaintext secrets everywhere (W210).",
    ].join("\n"),
  },
  secrets: {
    title: "Why W210 flags tokens in config files",
    body: [
      "Project-scoped configs (.cursor/mcp.json, .vscode/mcp.json) live in",
      "the repository, and the global ones get synced in dotfiles. plumbline",
      "flags env/header values whose names look credential-like and whose",
      "values look live (placeholders like <YOUR-TOKEN> are skipped). Use",
      "VS Code inputs, or a wrapper script that reads the environment.",
    ].join("\n"),
  },
  "exit-codes": {
    title: "Exit codes",
    body: [
      "0  no findings at or above --fail-on (default: warning)",
      "1  findings at or above --fail-on",
      "2  usage or input error (unknown flag, unreadable file, bad topic)",
      "So a pipeline can tell a broken config from a broken invocation.",
    ].join("\n"),
  },
  remote: {
    title: "Remote (url) servers per client",
    body: [
      "Cursor and VS Code can talk to remote MCP servers over SSE or",
      "streamable HTTP with a `url` field. Claude Desktop cannot launch",
      "remotes from claude_desktop_config.json (E126): bridge them through a",
      "stdio proxy (for example `npx -y mcp-remote <url>`) or use the app's",
      "Connectors UI. plumbline also checks the URL itself (E128) and flags",
      "plain http to non-loopback hosts (W213).",
    ].join("\n"),
  },
};

function renderClient(id: (typeof CLIENT_IDS)[number]): string {
  const profile = CLIENTS[id];
  const lines = [
    `${profile.label} (${profile.id})`,
    "",
    `  top-level key:   ${profile.topLevelKeys.join(" + ")}`,
    `  transports:      ${profile.transports.join(", ")}`,
    `  dialect:         ${profile.allowsJsonc ? "JSONC (comments ok)" : "strict JSON"}`,
    `  server keys:     ${profile.serverKeys.join(", ")}`,
    `  variables:       ${profile.supportsVariables ? "yes" : "no"}`,
    `  inputs:          ${profile.supportsInputs ? "yes" : "no"}`,
    `  envFile:         ${profile.supportsEnvFile ? "yes" : "no"}`,
    "",
    `  config (macOS):  ${profile.paths.macos}`,
    `  config (Win):    ${profile.paths.windows}`,
    `  config (Linux):  ${profile.paths.linux}`,
    `  per-project:     ${profile.paths.project}`,
  ];
  return lines.join("\n");
}

/** All valid explain topics (for --help and did-you-mean). */
export function explainTopics(): string[] {
  return [...ruleCodes(), ...CLIENT_IDS, ...Object.keys(CONCEPTS), "rules"];
}

/** Render a topic, or null when unknown. */
export function explainTopic(rawTopic: string): string | null {
  const topic = rawTopic.trim();
  const rule = ruleByCode(topic);
  if (rule) {
    return [
      `${rule.code} (${rule.severity}) — ${rule.title}`,
      "",
      rule.detail,
    ].join("\n");
  }
  const lowered = topic.toLowerCase();
  if (lowered === "claude" || lowered === "cursor" || lowered === "vscode") {
    return renderClient(lowered);
  }
  if (lowered === "rules") {
    return RULES.map((info) => `${info.code}  ${info.severity.padEnd(7)}  ${info.title}`).join("\n");
  }
  if (lowered === "clients") {
    const rows = clientMatrix();
    const width = Math.max(...rows.map((row) => row.axis.length));
    return rows
      .map((row) =>
        `${row.axis.padEnd(width)}  claude: ${row.values.claude} | cursor: ${row.values.cursor} | vscode: ${row.values.vscode}`,
      )
      .join("\n");
  }
  const concept = CONCEPTS[lowered];
  if (concept) return [concept.title, "", concept.body].join("\n");
  return null;
}

/** Did-you-mean for unknown topics. */
export function explainSuggestion(rawTopic: string): string | null {
  return nearest(rawTopic.trim(), explainTopics(), 3);
}
