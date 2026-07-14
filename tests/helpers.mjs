// Shared factories for the test suite. Everything is deterministic and
// in-memory; only cli.test.mjs spawns a process, against its own temp dir.
import { analyzeConfig } from "../dist/index.js";

/** Analyze a config object (or raw string) as the given client. */
export function lint(config, options = {}) {
  const text = typeof config === "string" ? config : JSON.stringify(config, null, 2);
  return analyzeConfig(text, options);
}

/** Analyze and return just the findings. */
export function findings(config, options = {}) {
  return lint(config, options).findings;
}

/** The rule codes of a findings list, in report order. */
export function codes(list) {
  return list.map((finding) => finding.code);
}

/** Findings with a given code. */
export function byCode(list, code) {
  return list.filter((finding) => finding.code === code);
}

/** A minimal valid stdio server entry. */
export function stdioServer(overrides = {}) {
  return { command: "npx", args: ["-y", "example-server"], ...overrides };
}

/** Wrap servers in the Claude/Cursor container. */
export function mcpServers(servers) {
  return { mcpServers: servers };
}

/** Wrap servers in the VS Code container. */
export function vsServers(servers, inputs) {
  return inputs === undefined ? { servers } : { servers, inputs };
}
