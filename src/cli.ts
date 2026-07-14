#!/usr/bin/env node
/**
 * CLI entry point. The only module that touches process, stdin or the
 * filesystem — everything else is pure and unit-tested directly.
 */

import { readFileSync } from "node:fs";
import { analyzeConfig } from "./analyze.js";
import { HELP_TEXT, parseArgs } from "./cliargs.js";
import { clientMatrix, CLIENTS } from "./clients.js";
import { explainSuggestion, explainTopic } from "./explain.js";
import { renderJson, renderText, runOk } from "./report.js";
import type { FileResult } from "./types.js";
import { VERSION } from "./version.js";

function renderClientsTable(): string {
  const rows = clientMatrix();
  const headers = ["", CLIENTS.claude.label, CLIENTS.cursor.label, CLIENTS.vscode.label];
  const table: string[][] = [
    headers,
    ...rows.map((row) => [row.axis, row.values.claude, row.values.cursor, row.values.vscode]),
  ];
  const widths = [0, 1, 2, 3].map((col) =>
    Math.max(...table.map((cells) => (cells[col] ?? "").length)),
  );
  return table
    .map((cells) => cells.map((cell, col) => cell.padEnd(widths[col] ?? 0)).join("  ").trimEnd())
    .join("\n");
}

export function main(argv: string[]): number {
  const command = parseArgs(argv);

  if (command.kind === "error") {
    process.stderr.write(`plumbline: ${command.message}\n`);
    return 2;
  }
  if (command.kind === "help") {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (command.kind === "version") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (command.kind === "clients") {
    process.stdout.write(renderClientsTable() + "\n");
    return 0;
  }
  if (command.kind === "explain") {
    const text = explainTopic(command.topic);
    if (text === null) {
      const suggestion = explainSuggestion(command.topic);
      process.stderr.write(
        `plumbline: unknown topic ${JSON.stringify(command.topic)}` +
          (suggestion ? ` — did you mean ${JSON.stringify(suggestion)}?` : "") +
          "\n",
      );
      return 2;
    }
    process.stdout.write(text + "\n");
    return 0;
  }

  // check
  const results: FileResult[] = [];
  for (const file of command.files) {
    let text: string;
    try {
      text = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write(`plumbline: cannot read ${file === "-" ? "stdin" : file}: ${reason}\n`);
      return 2;
    }
    results.push(
      analyzeConfig(text, {
        ...(command.client ? { client: command.client } : {}),
        filePath: file === "-" ? null : file,
        fileLabel: file === "-" ? "<stdin>" : file,
      }),
    );
  }
  const options = { failOn: command.failOn, quiet: command.quiet };
  process.stdout.write(
    command.format === "json" ? renderJson(results, options) : renderText(results, options),
  );
  return runOk(results, command.failOn) ? 0 : 1;
}

// Set exitCode instead of calling process.exit(): exit() can truncate a
// piped stdout mid-write (large --format json reports), while exitCode
// lets Node flush everything and exit naturally.
process.exitCode = main(process.argv.slice(2));
