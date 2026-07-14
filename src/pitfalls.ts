/**
 * Launch-time pitfall heuristics for stdio servers: the mistakes that
 * pass every JSON schema check and still leave the server dead or leaky.
 * All checks operate on the "effective" invocation — the command string
 * split on whitespace plus the declared args — so `"command": "npx -y x"`
 * is judged the same way as the properly split form.
 */

import type { ClientProfile } from "./clients.js";
import { asObject, asString, lastEntry, type JsonEntry, type JsonObject, type JsonNode } from "./jsonc.js";
import type { Finding } from "./types.js";

export interface ServerContext {
  profile: ClientProfile;
  serverName: string;
  /** Path prefix for findings, e.g. "mcpServers.github". */
  pathPrefix: string;
  entry: JsonObject;
  /** True when the config shows Windows-style paths anywhere. */
  windowsEvidence: boolean;
}

/** Programs people write with flags glued into `command`. */
const LAUNCHERS = new Set([
  "node", "npx", "npm", "pnpm", "yarn", "bun", "bunx", "deno",
  "python", "python3", "py", "uv", "uvx", "pip", "pipx",
  "docker", "podman", "java", "dotnet", "ruby", "go", "cargo",
  "sh", "bash", "zsh", "cmd", "powershell", "pwsh",
]);

/** Windows shims that CreateProcess cannot exec without cmd /c. */
const CMD_SHIMS = new Set(["npx", "npm", "pnpm", "yarn", "corepack"]);

/** Env/header names that suggest the value is a credential. */
const SECRET_NAME = /(token|secret|passw(or)?d|api[-_]?key|apikey|credential|auth)/i;

/** Values that are clearly placeholders, not live secrets. */
const PLACEHOLDER = /(your[-_ ]|<|>|\bxxx|\.\.\.|changeme|change-me|example|placeholder|todo|fixme|\*\*\*)/i;

/** Program basename: strip directories and a .exe/.cmd suffix, lowercase. */
export function programBasename(command: string): string {
  const last = command.split(/[\\/]/).pop() ?? command;
  return last.replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
}

interface EffectiveInvocation {
  /** The program actually asked of the OS (first token of `command`). */
  program: string;
  /** Tokens embedded in `command` after the program, if any. */
  embedded: string[];
  /** Declared string args, with their nodes for positions. */
  declaredArgs: Array<{ value: string; node: JsonNode }>;
  /** embedded + declared, the argv the user *meant*. */
  allArgs: string[];
  commandNode: JsonNode;
}

function effectiveInvocation(entry: JsonObject): EffectiveInvocation | null {
  const commandEntry = lastEntry(entry, "command");
  const command = asString(commandEntry?.value);
  if (!commandEntry || command === null || command.trim() === "") return null;
  const tokens = command.trim().split(/\s+/);
  const program = tokens[0] ?? "";
  const embedded = tokens.slice(1);
  const declaredArgs: Array<{ value: string; node: JsonNode }> = [];
  const argsNode = lastEntry(entry, "args")?.value;
  if (argsNode && argsNode.kind === "array") {
    for (const item of argsNode.items) {
      const text = asString(item);
      if (text !== null) declaredArgs.push({ value: text, node: item });
    }
  }
  return {
    program,
    embedded,
    declaredArgs,
    allArgs: [...embedded, ...declaredArgs.map((arg) => arg.value)],
    commandNode: commandEntry.value,
  };
}

function finding(
  code: string,
  severity: Finding["severity"],
  ctx: ServerContext,
  suffix: string,
  message: string,
  fix: string,
  node?: JsonNode | null,
): Finding {
  return {
    code,
    severity,
    path: suffix ? `${ctx.pathPrefix}.${suffix}` : ctx.pathPrefix,
    server: ctx.serverName,
    message,
    fix,
    ...(node ? { line: node.pos.line, column: node.pos.column } : {}),
  };
}

/** Quote a JSON string for display inside messages/fixes. */
function q(value: string): string {
  return JSON.stringify(value);
}

/** E130: `command` embeds its arguments — no shell will split them. */
function checkEmbeddedArgs(ctx: ServerContext, inv: EffectiveInvocation): Finding[] {
  if (inv.embedded.length === 0) return [];
  const launcher = LAUNCHERS.has(programBasename(inv.program));
  const hasFlag = inv.embedded.some((token) => token.startsWith("-"));
  if (!launcher && !hasFlag) return []; // could be a path with spaces; leave it alone
  const args = [...inv.embedded, ...inv.declaredArgs.map((arg) => arg.value)];
  return [
    finding(
      "E130",
      "error",
      ctx,
      "command",
      `${ctx.profile.label} execs the command directly — no shell splits ${q(
        [inv.program, ...inv.embedded].join(" "),
      )} into a program plus flags, so the OS looks for a program with that literal name`,
      `"command": ${q(inv.program)}, "args": [${args.map(q).join(", ")}]`,
      inv.commandNode,
    ),
  ];
}

/** W206: npx/bunx without -y hangs on the install prompt inside a client. */
function checkNpxYes(ctx: ServerContext, inv: EffectiveInvocation): Finding[] {
  const base = programBasename(inv.program);
  if (base !== "npx" && base !== "bunx") return [];
  if (inv.allArgs.some((arg) => arg === "-y" || arg === "--yes")) return [];
  return [
    finding(
      "W206",
      "warning",
      ctx,
      "args",
      `${base} without -y stops at the install prompt on first run — inside ${ctx.profile.label} there is no terminal to answer it, so the server times out`,
      `add "-y" as the first element of "args"`,
      inv.commandNode,
    ),
  ];
}

/** W207: relative paths break because the client's cwd is undefined. */
function checkRelativePaths(ctx: ServerContext, inv: EffectiveInvocation): Finding[] {
  const findings: Finding[] = [];
  const isDotRelative = (value: string) => /^\.\.?[/\\]/.test(value);
  const isBareScript = (value: string) =>
    /^[^/\\~$@%-]/.test(value) &&
    !value.includes("://") &&
    !/^[A-Za-z]:[/\\]/.test(value) &&
    /[/\\][^/\\]+\.(m?js|cjs|ts|py|jar|sh|rb)$/.test(value);
  if (isDotRelative(inv.program)) {
    findings.push(
      finding(
        "W207",
        "warning",
        ctx,
        "command",
        `${q(inv.program)} is relative, but ${ctx.profile.label} launches servers from an undefined working directory — the path resolves somewhere else or nowhere`,
        "use an absolute path to the executable",
        inv.commandNode,
      ),
    );
  }
  for (const arg of inv.declaredArgs) {
    if (isDotRelative(arg.value) || isBareScript(arg.value)) {
      findings.push(
        finding(
          "W207",
          "warning",
          ctx,
          "args",
          `${q(arg.value)} is a relative path, but ${ctx.profile.label} launches servers from an undefined working directory`,
          "use an absolute path",
          arg.node,
        ),
      );
    }
  }
  return findings;
}

/** W208: nothing expands ~ — there is no shell in the launch path. */
function checkTilde(ctx: ServerContext, inv: EffectiveInvocation | null): Finding[] {
  const findings: Finding[] = [];
  const tilded = (value: string) => value === "~" || value.startsWith("~/") || value.startsWith("~\\");
  if (inv) {
    if (tilded(inv.program)) {
      findings.push(
        finding(
          "W208",
          "warning",
          ctx,
          "command",
          `~ is a shell feature and there is no shell here — the OS looks for a directory literally named "~"`,
          "write the home directory out in full",
          inv.commandNode,
        ),
      );
    }
    for (const arg of inv.declaredArgs) {
      if (tilded(arg.value)) {
        findings.push(
          finding(
            "W208",
            "warning",
            ctx,
            "args",
            `${q(arg.value)} will not be expanded — tilde expansion is a shell feature and clients launch servers without a shell`,
            "write the home directory out in full",
            arg.node,
          ),
        );
      }
    }
  }
  const env = asObject(lastEntry(ctx.entry, "env")?.value);
  if (env) {
    for (const pair of env.entries) {
      const value = asString(pair.value);
      if (value !== null && tilded(value)) {
        findings.push(
          finding(
            "W208",
            "warning",
            ctx,
            `env.${pair.key}`,
            `${q(value)} will reach the server unexpanded — the ~ is passed through literally`,
            "write the home directory out in full",
            pair.value,
          ),
        );
      }
    }
  }
  return findings;
}

/** W209: on Windows, npx & friends are .cmd shims that need cmd /c. */
function checkWindowsShim(ctx: ServerContext, inv: EffectiveInvocation): Finding[] {
  if (!ctx.windowsEvidence) return [];
  const base = programBasename(inv.program);
  if (!CMD_SHIMS.has(base) || /\.(exe)$/i.test(inv.program)) return [];
  const args = [...inv.embedded, ...inv.declaredArgs.map((arg) => arg.value)];
  return [
    finding(
      "W209",
      "warning",
      ctx,
      "command",
      `this config uses Windows paths, and on Windows ${q(base)} is a .cmd shim that CreateProcess cannot exec directly — the server fails to spawn`,
      `"command": "cmd", "args": ["/c", ${[base, ...args].map(q).join(", ")}]`,
      inv.commandNode,
    ),
  ];
}

/** W210: a live-looking secret sitting in the config file. */
function checkSecrets(ctx: ServerContext): Finding[] {
  const findings: Finding[] = [];
  const advise =
    ctx.profile.supportsInputs
      ? 'prompt for it with an `inputs` entry and reference it as "${input:...}"'
      : "keep it out of the file: read it from the environment via a wrapper script, or rotate it if this file was ever committed";
  const scan = (container: JsonObject | null, prefix: string, nameMatches: (key: string) => boolean) => {
    if (!container) return;
    for (const pair of container.entries) {
      const value = asString(pair.value);
      if (value === null || value.length < 8) continue;
      if (value.includes("${")) continue; // a variable reference, not a literal
      if (PLACEHOLDER.test(value)) continue; // template value, nothing leaked yet
      if (!nameMatches(pair.key)) continue;
      findings.push(
        finding(
          "W210",
          "warning",
          ctx,
          `${prefix}.${pair.key}`,
          `${pair.key} looks like a live credential stored in plain text — this file is easy to commit or sync`,
          advise,
          pair.value,
        ),
      );
    }
  };
  scan(asObject(lastEntry(ctx.entry, "env")?.value), "env", (key) => SECRET_NAME.test(key));
  scan(
    asObject(lastEntry(ctx.entry, "headers")?.value),
    "headers",
    (key) => key.toLowerCase() === "authorization" || SECRET_NAME.test(key),
  );
  return findings;
}

/** W211: node pointed at a .py file (or python at .js) — a copy-paste. */
function checkInterpreterMismatch(ctx: ServerContext, inv: EffectiveInvocation): Finding[] {
  const base = programBasename(inv.program);
  const family: "node" | "python" | null =
    base === "node" ? "node" : base === "python" || base === "python3" || base === "py" ? "python" : null;
  if (!family) return [];
  const script = inv.declaredArgs.find((arg) => /\.(m?js|cjs|py)$/i.test(arg.value));
  if (!script) return [];
  const isPy = /\.py$/i.test(script.value);
  if ((family === "node" && isPy) || (family === "python" && !isPy)) {
    const right = isPy ? "python" : "node";
    return [
      finding(
        "W211",
        "warning",
        ctx,
        "args",
        `${q(inv.program)} is asked to run ${q(script.value)} — the interpreter will exit with a syntax error the client swallows (usually a copy-paste between server blocks)`,
        `run it with ${q(right)}, or point at the right script`,
        script.node,
      ),
    ];
  }
  return [];
}

/** Run every pitfall check that applies to this server entry. */
export function checkPitfalls(ctx: ServerContext): Finding[] {
  const findings: Finding[] = [];
  const inv = effectiveInvocation(ctx.entry);
  if (inv) {
    findings.push(...checkEmbeddedArgs(ctx, inv));
    findings.push(...checkNpxYes(ctx, inv));
    findings.push(...checkRelativePaths(ctx, inv));
    findings.push(...checkWindowsShim(ctx, inv));
    findings.push(...checkInterpreterMismatch(ctx, inv));
  }
  findings.push(...checkTilde(ctx, inv));
  findings.push(...checkSecrets(ctx));
  return findings;
}
