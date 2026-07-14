/**
 * Shared types for the lint pipeline. Everything is plain data: the
 * parser produces nodes, the analyzer produces findings, the reporters
 * turn findings into text or JSON. No class carries behavior across
 * module boundaries.
 */

/** The three MCP clients plumbline knows the config dialect of. */
export type ClientId = "claude" | "cursor" | "vscode";

/** Finding severity, ordered error > warning > info. */
export type Severity = "error" | "warning" | "info";

/** Where findings stop failing the run (--fail-on). */
export type FailOn = Severity | "never";

/** A location in the original config text (1-based line/column). */
export interface Position {
  offset: number;
  line: number;
  column: number;
}

/** One lint finding. `code` is stable API and never renumbered. */
export interface Finding {
  code: string;
  severity: Severity;
  /** Dotted path into the config, e.g. "mcpServers.github.command". */
  path: string;
  /** Server name, when the finding belongs to one server entry. */
  server?: string;
  /** What is wrong, in one sentence. */
  message: string;
  /** A concrete, copy-pasteable remediation. */
  fix: string;
  line?: number;
  column?: number;
}

/** How the client was chosen for a file. */
export interface Detection {
  client: ClientId;
  source: "flag" | "path" | "shape" | "default";
  reason: string;
}

/** The result of linting one config file. */
export interface FileResult {
  /** Display name: the path given on the command line, or "<stdin>". */
  file: string;
  client: ClientId;
  detection: Detection;
  /** Number of server entries seen (0 when the file failed to parse). */
  serverCount: number;
  findings: Finding[];
  /** True when parsing failed and no structural checks could run. */
  fatal: boolean;
}

/** Severity totals across one or more files. */
export interface Totals {
  error: number;
  warning: number;
  info: number;
}

const SEVERITY_RANK: Record<Severity, number> = { error: 3, warning: 2, info: 1 };

/** True when a finding at `severity` should fail a run gated at `failOn`. */
export function failsAt(severity: Severity, failOn: FailOn): boolean {
  if (failOn === "never") return false;
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[failOn];
}

/** Sum findings by severity. */
export function tally(findings: Finding[]): Totals {
  const totals: Totals = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) totals[finding.severity] += 1;
  return totals;
}
