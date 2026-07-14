/**
 * Command-line parsing, kept pure so tests can drive it with arrays.
 * Grammar:
 *
 *   plumbline check [--client X] [--fail-on L] [--format F] [-q] <file...|->
 *   plumbline clients
 *   plumbline explain <topic>
 *   plumbline --help | --version
 */

import { resolveClientId } from "./clients.js";
import type { ClientId, FailOn } from "./types.js";

export interface CheckCommand {
  kind: "check";
  files: string[];
  client: ClientId | null;
  failOn: FailOn;
  format: "text" | "json";
  quiet: boolean;
}

export interface ExplainCommand {
  kind: "explain";
  topic: string;
}

export interface ClientsCommand {
  kind: "clients";
}

export interface HelpCommand {
  kind: "help";
}

export interface VersionCommand {
  kind: "version";
}

export interface UsageError {
  kind: "error";
  message: string;
}

export type CliCommand =
  | CheckCommand
  | ExplainCommand
  | ClientsCommand
  | HelpCommand
  | VersionCommand
  | UsageError;

const FAIL_LEVELS: ReadonlyArray<FailOn> = ["error", "warning", "info", "never"];

function usageError(message: string): UsageError {
  return { kind: "error", message: `${message} (see plumbline --help)` };
}

/** Read a flag's value, either "--flag value" or "--flag=value". */
function takeValue(
  argv: string[],
  index: number,
  flag: string,
): { value: string; next: number } | UsageError {
  const arg = argv[index] ?? "";
  const eq = arg.indexOf("=");
  if (eq !== -1) return { value: arg.slice(eq + 1), next: index + 1 };
  const value = argv[index + 1];
  if (value === undefined) return usageError(`${flag} needs a value`);
  return { value, next: index + 2 };
}

export function parseArgs(argv: string[]): CliCommand {
  if (argv.length === 0) return { kind: "help" };
  const first = argv[0] ?? "";
  if (first === "--help" || first === "-h" || first === "help") return { kind: "help" };
  if (first === "--version" || first === "-V" || first === "version") return { kind: "version" };
  if (first === "clients") {
    if (argv.length > 1) return usageError("`clients` takes no arguments");
    return { kind: "clients" };
  }
  if (first === "explain") {
    const topic = argv[1];
    if (topic === undefined || argv.length > 2) {
      return usageError("usage: plumbline explain <rule|client|concept>");
    }
    return { kind: "explain", topic };
  }
  if (first !== "check") {
    if (first.startsWith("-")) return usageError(`unknown flag ${first}`);
    return usageError(`unknown command ${JSON.stringify(first)}`);
  }

  const command: CheckCommand = {
    kind: "check",
    files: [],
    client: null,
    failOn: "warning",
    format: "text",
    quiet: false,
  };
  let index = 1;
  while (index < argv.length) {
    const arg = argv[index] ?? "";
    const flagName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (flagName === "--client") {
      const taken = takeValue(argv, index, "--client");
      if ("kind" in taken) return taken;
      const client = resolveClientId(taken.value);
      if (!client && taken.value.toLowerCase() !== "auto") {
        return usageError(`--client must be claude, cursor, vscode or auto — got ${JSON.stringify(taken.value)}`);
      }
      command.client = client; // "auto" resolves to null
      index = taken.next;
      continue;
    }
    if (flagName === "--fail-on") {
      const taken = takeValue(argv, index, "--fail-on");
      if ("kind" in taken) return taken;
      const level = taken.value.toLowerCase() as FailOn;
      if (!FAIL_LEVELS.includes(level)) {
        return usageError(`--fail-on must be error, warning, info or never — got ${JSON.stringify(taken.value)}`);
      }
      command.failOn = level;
      index = taken.next;
      continue;
    }
    if (flagName === "--format") {
      const taken = takeValue(argv, index, "--format");
      if ("kind" in taken) return taken;
      const format = taken.value.toLowerCase();
      if (format !== "text" && format !== "json") {
        return usageError(`--format must be text or json — got ${JSON.stringify(taken.value)}`);
      }
      command.format = format;
      index = taken.next;
      continue;
    }
    if (flagName === "--quiet" || flagName === "-q") {
      if (arg !== flagName) return usageError(`${flagName} does not take a value`);
      command.quiet = true;
      index += 1;
      continue;
    }
    if (arg === "-") {
      command.files.push("-");
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) return usageError(`unknown flag ${flagName}`);
    command.files.push(arg);
    index += 1;
  }
  if (command.files.length === 0) {
    return usageError("check needs at least one file (or - for stdin)");
  }
  if (command.files.filter((file) => file === "-").length > 1) {
    return usageError("stdin (-) can only be read once");
  }
  return command;
}

export const HELP_TEXT = `plumbline — lint MCP client config files (Claude Desktop, Cursor, VS Code)

Usage:
  plumbline check [options] <file...|->   lint one or more config files
  plumbline clients                       per-client config cheat sheet
  plumbline explain <topic>               rule codes, clients, concepts
  plumbline --help | --version

Options for check:
  --client <claude|cursor|vscode|auto>  which dialect to lint as (default: auto)
  --fail-on <error|warning|info|never>  gate for exit code 1 (default: warning)
  --format <text|json>                  report format (default: text)
  -q, --quiet                           summary lines only

Explain topics: rule codes (E110, W206, ...), client names (claude, cursor,
vscode), and: rules, clients, strict-json, detection, variables, inputs,
secrets, remote, exit-codes.

Exit codes: 0 clean, 1 findings at/above --fail-on, 2 usage or input error.
`;
