// CLI integration: the compiled binary, spawned for real, with temp
// files in a per-run directory. Exit codes are the contract under test.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { VERSION } from "../dist/index.js";

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "dist", "cli.js");
const WORKDIR = mkdtempSync(join(tmpdir(), "plumbline-test-"));
after(() => rmSync(WORKDIR, { recursive: true, force: true }));

/** Run the CLI; never throws — returns { code, stdout, stderr }. */
function run(args, stdin = "") {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf8",
      input: stdin,
      cwd: ROOT,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("--version prints the package version; --help documents the surface", () => {
  assert.equal(run(["--version"]).stdout.trim(), VERSION);
  const help = run(["--help"]).stdout;
  for (const needle of ["check", "clients", "explain", "--client", "--fail-on", "--format", "Exit codes"]) {
    assert.ok(help.includes(needle), needle);
  }
});

test("usage errors exit 2, distinct from lint findings' exit 1", () => {
  assert.equal(run(["check", "x.json", "--frobnicate"]).code, 2);
  assert.equal(run(["frobnicate"]).code, 2);
  assert.equal(run(["check"]).code, 2); // no files
  assert.equal(run(["check", join(WORKDIR, "missing.json")]).code, 2);
  assert.equal(run(["check", "x.json", "--client", "zed"]).code, 2);
  assert.equal(run(["check", "x.json", "--fail-on", "sometimes"]).code, 2);
  assert.equal(run(["check", "x.json", "--quiet=yes"]).code, 2); // boolean flags take no value
});

test("the broken Claude Desktop example fails with the seeded findings", () => {
  const result = run(["check", "examples/claude_desktop_config.json"]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Claude Desktop \(auto-detected: file is named claude_desktop_config\.json\)/);
  assert.match(result.stdout, /5 server\(s\) — 5 error\(s\), 5 warning\(s\), 0 info/);
  for (const code of ["E130", "W210", "W206", "W208", "W207", "W211", "E126", "E120", "E125", "E123"]) {
    assert.ok(result.stdout.includes(code), code);
  }
});

test("the clean example exits 0 with zero findings", () => {
  const result = run(["check", "examples/clean-claude.json"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /0 error\(s\), 0 warning\(s\), 0 info/);
  assert.match(result.stdout, /plumbline: OK/);
});

test("--fail-on moves the gate without changing the findings", () => {
  const strict = run(["check", "examples/cursor-mcp.json", "--client", "cursor"]);
  assert.equal(strict.code, 1);
  const relaxed = run(["check", "examples/cursor-mcp.json", "--client", "cursor", "--fail-on", "never"]);
  assert.equal(relaxed.code, 0);
  assert.equal(
    (relaxed.stdout.match(/error E\d+/g) ?? []).length,
    (strict.stdout.match(/error E\d+/g) ?? []).length,
  );
});

test("--format json emits valid JSON with the same verdict", () => {
  const result = run(["check", "examples/vscode-mcp.json", "--format", "json"]);
  assert.equal(result.code, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.files[0].client, "vscode");
  assert.ok(parsed.files[0].findings.some((f) => f.code === "E131"));
});

test("stdin (-) works and respects --client", () => {
  const config = '{"mcpServers": {"a": {"command": "npx", "args": ["-y", "x"]}}}';
  const ok = run(["check", "-", "--client", "cursor"], config);
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /<stdin> — Cursor \(--client\)/);
});

test("multiple files aggregate into one summary and one exit code", () => {
  const good = join(WORKDIR, "good.json");
  writeFileSync(good, '{"mcpServers": {"a": {"command": "npx", "args": ["-y", "x"]}}}');
  const result = run(["check", good, "examples/claude_desktop_config.json", "--quiet"]);
  assert.equal(result.code, 1);
  const headers = result.stdout.split("\n").filter((line) => line.includes(" server(s) — "));
  assert.equal(headers.length, 2);
  assert.match(result.stdout, /plumbline: FAIL — 5 error\(s\), 5 warning\(s\), 0 info/);
});

test("a config that another client would pass fails as the detected one", () => {
  // VS Code layout inside .cursor/: path detection wins, E110 fires.
  const cursorDir = join(WORKDIR, ".cursor");
  mkdirSync(cursorDir, { recursive: true });
  const file = join(cursorDir, "mcp.json");
  writeFileSync(file, '{"servers": {"a": {"command": "npx", "args": ["-y", "x"]}}}');
  const result = run(["check", file]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Cursor \(auto-detected/);
  assert.match(result.stdout, /E110/);
});

test("explain answers rules and clients; unknown topics exit 2 with a hint", () => {
  assert.match(run(["explain", "E110"]).stdout, /cross-client mistake/);
  assert.match(run(["explain", "cursor"]).stdout, /\.cursor\/mcp\.json/);
  const unknown = run(["explain", "cluade"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /did you mean "claude"\?/);
});

test("the clients table prints all three columns and the key facts", () => {
  const result = run(["clients"]);
  assert.equal(result.code, 0);
  for (const needle of ["Claude Desktop", "Cursor", "VS Code", "mcpServers", "servers + inputs", "strict JSON", "JSONC"]) {
    assert.ok(result.stdout.includes(needle), needle);
  }
});

test("repeat runs over the same input are byte-identical", () => {
  const one = run(["check", "examples/claude_desktop_config.json"]);
  const two = run(["check", "examples/claude_desktop_config.json"]);
  assert.equal(one.stdout, two.stdout);
});
