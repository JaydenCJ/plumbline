/**
 * Renderers. Text mirrors the on-screen report; JSON is a stable shape
 * for CI. Both are pure string builders over FileResult values — no I/O,
 * no color codes, byte-identical across runs.
 */

import { CLIENTS } from "./clients.js";
import { failsAt, tally, type FailOn, type FileResult, type Finding, type Totals } from "./types.js";
import { VERSION } from "./version.js";

export interface RenderOptions {
  failOn: FailOn;
  /** Summary lines only. */
  quiet?: boolean;
}

/** Merge severity totals across files. */
export function totalsOf(results: FileResult[]): Totals {
  const totals: Totals = { error: 0, warning: 0, info: 0 };
  for (const result of results) {
    const t = tally(result.findings);
    totals.error += t.error;
    totals.warning += t.warning;
    totals.info += t.info;
  }
  return totals;
}

/** True when nothing at/above failOn was found. */
export function runOk(results: FileResult[], failOn: FailOn): boolean {
  return !results.some((result) => result.findings.some((f) => failsAt(f.severity, failOn)));
}

function detectionLabel(result: FileResult): string {
  const { source, reason } = result.detection;
  if (source === "flag") return "--client";
  if (source === "path") return `auto-detected: ${reason}`;
  if (source === "shape") return `auto-detected: ${reason}`;
  return reason;
}

function countsLine(totals: Totals): string {
  return `${totals.error} error(s), ${totals.warning} warning(s), ${totals.info} info`;
}

/** "mcpServers.github.command" → "github › command" for human eyes. */
function whereLabel(finding: Finding): string {
  let path = finding.path;
  for (const prefix of ["mcpServers.", "mcp.servers.", "servers."]) {
    if (path.startsWith(prefix)) {
      path = path.slice(prefix.length);
      break;
    }
  }
  if (path === "mcpServers" || path === "servers" || path === "mcp.servers") return "(top level)";
  return path.replace(/\./g, " › ");
}

function renderFinding(finding: Finding): string[] {
  const where = whereLabel(finding);
  const location = finding.line !== undefined ? `  [line ${finding.line}]` : "";
  return [
    `  ${finding.severity} ${finding.code} ${where}${location}`,
    `      ${finding.message}`,
    `      fix: ${finding.fix}`,
  ];
}

/** The human-readable report for one or more files. */
export function renderText(results: FileResult[], options: RenderOptions): string {
  const lines: string[] = [];
  for (const result of results) {
    const profile = CLIENTS[result.client];
    const totals = tally(result.findings);
    lines.push(
      `${result.file} — ${profile.label} (${detectionLabel(result)}): ` +
        `${result.serverCount} server(s) — ${countsLine(totals)}`,
    );
    if (!options.quiet && result.findings.length > 0) {
      lines.push("");
      for (const finding of result.findings) {
        lines.push(...renderFinding(finding));
        lines.push("");
      }
    } else {
      lines.push("");
    }
  }
  const totals = totalsOf(results);
  const ok = runOk(results, options.failOn);
  lines.push(
    `plumbline: ${ok ? "OK" : "FAIL"} — ${countsLine(totals)} (fail-on: ${options.failOn})`,
  );
  return lines.join("\n") + "\n";
}

/** The machine-readable report: a stable shape for CI. */
export function renderJson(results: FileResult[], options: RenderOptions): string {
  const totals = totalsOf(results);
  const payload = {
    plumbline: VERSION,
    failOn: options.failOn,
    ok: runOk(results, options.failOn),
    totals,
    files: results.map((result) => ({
      file: result.file,
      client: result.client,
      detection: result.detection,
      serverCount: result.serverCount,
      fatal: result.fatal,
      findings: result.findings,
    })),
  };
  return JSON.stringify(payload, null, 2) + "\n";
}
