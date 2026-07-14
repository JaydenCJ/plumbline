/**
 * The per-client knowledge base. Everything plumbline knows about how
 * Claude Desktop, Cursor and VS Code read their MCP config lives here as
 * data — the analyzer consults these profiles instead of hard-coding
 * client names, so adding a client is (mostly) adding a profile.
 */

import type { ClientId } from "./types.js";

export interface ClientProfile {
  id: ClientId;
  /** Human label used in reports, e.g. "Claude Desktop". */
  label: string;
  /** The key the server map lives under: "mcpServers" or "servers". */
  configKey: "mcpServers" | "servers";
  /** The other clients' container key, reported by E110 when present. */
  wrongConfigKeys: string[];
  /** True when the client's parser accepts comments + trailing commas. */
  allowsJsonc: boolean;
  /** Transports the client can drive from this file. */
  transports: ReadonlyArray<"stdio" | "sse" | "http">;
  /** Whether the client supports a top-level `inputs` prompt array. */
  supportsInputs: boolean;
  /** Whether ${...} variables are substituted in values. */
  supportsVariables: boolean;
  /** Whether a per-server `envFile` is understood. */
  supportsEnvFile: boolean;
  /** Keys a server entry may carry in this client. */
  serverKeys: ReadonlyArray<string>;
  /** Top-level keys that are valid in this file. */
  topLevelKeys: ReadonlyArray<string>;
  /**
   * False when the file is a general settings file that legally carries
   * unrelated keys (Claude Desktop) — unknown top-level keys are then
   * left alone instead of warned about.
   */
  strictTopLevel: boolean;
  /** Where the file lives, for reports and `plumbline clients`. */
  paths: { macos: string; windows: string; linux: string; project: string };
}

const CLAUDE: ClientProfile = {
  id: "claude",
  label: "Claude Desktop",
  configKey: "mcpServers",
  wrongConfigKeys: ["servers"],
  allowsJsonc: false,
  transports: ["stdio"],
  supportsInputs: false,
  supportsVariables: false,
  supportsEnvFile: false,
  serverKeys: ["command", "args", "env"],
  topLevelKeys: ["mcpServers"],
  strictTopLevel: false, // claude_desktop_config.json also stores app settings
  paths: {
    macos: "~/Library/Application Support/Claude/claude_desktop_config.json",
    windows: "%APPDATA%\\Claude\\claude_desktop_config.json",
    linux: "~/.config/Claude/claude_desktop_config.json",
    project: "(none — global config only)",
  },
};

const CURSOR: ClientProfile = {
  id: "cursor",
  label: "Cursor",
  configKey: "mcpServers",
  wrongConfigKeys: ["servers"],
  allowsJsonc: false,
  transports: ["stdio", "sse", "http"],
  supportsInputs: false,
  supportsVariables: false,
  supportsEnvFile: false,
  serverKeys: ["command", "args", "env", "url", "headers"],
  topLevelKeys: ["mcpServers"],
  strictTopLevel: true,
  paths: {
    macos: "~/.cursor/mcp.json",
    windows: "%USERPROFILE%\\.cursor\\mcp.json",
    linux: "~/.cursor/mcp.json",
    project: "<project>/.cursor/mcp.json",
  },
};

const VSCODE: ClientProfile = {
  id: "vscode",
  label: "VS Code",
  configKey: "servers",
  wrongConfigKeys: ["mcpServers"],
  allowsJsonc: true,
  transports: ["stdio", "sse", "http"],
  supportsInputs: true,
  supportsVariables: true,
  supportsEnvFile: true,
  serverKeys: ["type", "command", "args", "env", "envFile", "url", "headers", "dev"],
  topLevelKeys: ["servers", "inputs"],
  strictTopLevel: true,
  paths: {
    macos: "<project>/.vscode/mcp.json (or the user-profile mcp.json)",
    windows: "<project>\\.vscode\\mcp.json (or the user-profile mcp.json)",
    linux: "<project>/.vscode/mcp.json (or the user-profile mcp.json)",
    project: "<project>/.vscode/mcp.json",
  },
};

export const CLIENTS: Record<ClientId, ClientProfile> = {
  claude: CLAUDE,
  cursor: CURSOR,
  vscode: VSCODE,
};

export const CLIENT_IDS: ReadonlyArray<ClientId> = ["claude", "cursor", "vscode"];

/** Resolve a user-supplied client name; returns null when unknown. */
export function resolveClientId(raw: string): ClientId | null {
  const lowered = raw.toLowerCase().replace(/[\s_-]/g, "");
  if (lowered === "claude" || lowered === "claudedesktop") return "claude";
  if (lowered === "cursor") return "cursor";
  if (lowered === "vscode" || lowered === "code" || lowered === "visualstudiocode") {
    return "vscode";
  }
  return null;
}

/** Rows for `plumbline clients`, kept as data so tests can assert them. */
export function clientMatrix(): Array<{ axis: string; values: Record<ClientId, string> }> {
  const row = (axis: string, pick: (p: ClientProfile) => string) => ({
    axis,
    values: {
      claude: pick(CLAUDE),
      cursor: pick(CURSOR),
      vscode: pick(VSCODE),
    } as Record<ClientId, string>,
  });
  return [
    row("config file (macOS)", (p) => p.paths.macos),
    row("config file (Windows)", (p) => p.paths.windows),
    row("config file (Linux)", (p) => p.paths.linux),
    row("per-project file", (p) => p.paths.project),
    row("top-level key", (p) => p.topLevelKeys.join(" + ")),
    row("transports", (p) => p.transports.join(", ")),
    row("comments / trailing commas", (p) => (p.allowsJsonc ? "yes (JSONC)" : "no (strict JSON)")),
    row("${...} variables", (p) => (p.supportsVariables ? "yes" : "no")),
    row("inputs (secret prompts)", (p) => (p.supportsInputs ? "yes" : "no")),
    row("envFile", (p) => (p.supportsEnvFile ? "yes" : "no")),
  ];
}
