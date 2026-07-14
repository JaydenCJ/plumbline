/**
 * Client auto-detection. Order of trust: an explicit --client flag (the
 * caller handles that), then the file path (config files live in
 * well-known places), then the document shape (`servers` vs `mcpServers`,
 * url-based entries). Detection is always surfaced in the report so a
 * wrong guess is visible and overridable.
 */

import { asObject, lastEntry, type JsonNode } from "./jsonc.js";
import type { ClientId, Detection } from "./types.js";

/** Normalize a path for matching: lowercase, forward slashes. */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").toLowerCase();
}

/** Detect from the file path alone; null when the path says nothing. */
export function detectFromPath(filePath: string): Detection | null {
  const normalized = normalizePath(filePath);
  const base = normalized.split("/").pop() ?? "";
  if (base === "claude_desktop_config.json") {
    return {
      client: "claude",
      source: "path",
      reason: "file is named claude_desktop_config.json",
    };
  }
  if (normalized.includes("/.cursor/") || normalized.startsWith(".cursor/")) {
    return { client: "cursor", source: "path", reason: "file lives under .cursor/" };
  }
  if (normalized.includes("/.vscode/") || normalized.startsWith(".vscode/")) {
    return { client: "vscode", source: "path", reason: "file lives under .vscode/" };
  }
  return null;
}

/** Detect from the parsed document shape; null when unparseable. */
export function detectFromShape(root: JsonNode | null): Detection | null {
  const obj = asObject(root);
  if (!obj) return null;

  if (lastEntry(obj, "servers") || lastEntry(obj, "inputs")) {
    return {
      client: "vscode",
      source: "shape",
      reason: "top-level `servers`/`inputs` is the VS Code layout",
    };
  }
  const mcpWrapper = asObject(lastEntry(obj, "mcp")?.value);
  if (mcpWrapper && lastEntry(mcpWrapper, "servers")) {
    return {
      client: "vscode",
      source: "shape",
      reason: "a `mcp.servers` wrapper is the older VS Code settings.json layout",
    };
  }

  const serversEntry = lastEntry(obj, "mcpServers");
  const servers = asObject(serversEntry?.value);
  if (servers) {
    for (const entry of servers.entries) {
      const server = asObject(entry.value);
      if (server && lastEntry(server, "url")) {
        return {
          client: "cursor",
          source: "shape",
          reason:
            "`mcpServers` with a url-based server — Claude Desktop cannot launch those, Cursor can",
        };
      }
    }
    return {
      client: "claude",
      source: "shape",
      reason: "`mcpServers` with stdio servers only — linting as Claude Desktop, the strictest dialect",
    };
  }
  return null;
}

/**
 * Full detection for one file. `forced` wins outright; otherwise path,
 * then shape, then the Claude Desktop default (the strictest dialect, so
 * a wrong default over-reports rather than under-reports).
 */
export function detectClient(
  filePath: string | null,
  root: JsonNode | null,
  forced?: ClientId,
): Detection {
  if (forced) {
    return { client: forced, source: "flag", reason: "set with --client" };
  }
  if (filePath) {
    const byPath = detectFromPath(filePath);
    if (byPath) return byPath;
  }
  const byShape = detectFromShape(root);
  if (byShape) return byShape;
  return {
    client: "claude",
    source: "default",
    reason: "no path or shape signal — defaulting to Claude Desktop; use --client to override",
  };
}
