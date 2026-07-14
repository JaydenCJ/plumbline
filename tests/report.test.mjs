// Reporters: deterministic text, a stable JSON shape, and the fail-on
// gate that decides the exit code.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { renderJson, renderText, runOk } from "../dist/index.js";
import { lint, mcpServers, stdioServer } from "./helpers.mjs";

const BROKEN = mcpServers({
  github: { command: "npx -y server-github", env: { API_TOKEN: "AAAAAAAAAAAAAAAAAAAA" } },
});

test("the text report carries client, detection, counts and the › path", () => {
  const result = lint(BROKEN, { client: "claude", fileLabel: "cfg.json" });
  const text = renderText([result], { failOn: "warning" });
  assert.match(text, /^cfg\.json — Claude Desktop \(--client\): 1 server\(s\) — 1 error\(s\), 1 warning\(s\), 0 info/);
  assert.match(text, /error E130 github › command {2}\[line \d+\]/);
  assert.match(text, /fix: "command": "npx"/);
  assert.match(text, /plumbline: FAIL — 1 error\(s\), 1 warning\(s\), 0 info \(fail-on: warning\)/);
});

test("quiet mode keeps the header and summary lines only", () => {
  const result = lint(BROKEN, { client: "claude", fileLabel: "cfg.json" });
  const text = renderText([result], { failOn: "warning", quiet: true });
  assert.equal(text.split("\n").filter((line) => line.trim() !== "").length, 2);
});

test("rendering is byte-identical across runs", () => {
  const once = renderText([lint(BROKEN, { client: "claude" })], { failOn: "warning" });
  const twice = renderText([lint(BROKEN, { client: "claude" })], { failOn: "warning" });
  assert.equal(once, twice);
});

test("the JSON report is valid JSON with the stable top-level fields", () => {
  const result = lint(BROKEN, { client: "claude", fileLabel: "cfg.json" });
  const parsed = JSON.parse(renderJson([result], { failOn: "warning" }));
  assert.deepEqual(Object.keys(parsed), ["plumbline", "failOn", "ok", "totals", "files"]);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.totals.error, 1);
  assert.equal(parsed.files[0].client, "claude");
  const finding = parsed.files[0].findings.find((f) => f.code === "E130");
  assert.deepEqual(
    Object.keys(finding).sort(),
    ["code", "column", "fix", "line", "message", "path", "server", "severity"],
  );
});

test("runOk honors every fail-on level", () => {
  const warnOnly = lint(mcpServers({ a: { command: "npx", args: ["pkg"] } }), { client: "claude" });
  assert.equal(warnOnly.findings.every((f) => f.severity === "warning"), true);
  assert.equal(runOk([warnOnly], "error"), true);
  assert.equal(runOk([warnOnly], "warning"), false);
  assert.equal(runOk([warnOnly], "info"), false);
  assert.equal(runOk([warnOnly], "never"), true);
  const clean = lint(mcpServers({ a: stdioServer() }), { client: "claude" });
  assert.equal(runOk([clean, warnOnly], "warning"), false);
  assert.equal(runOk([clean], "info"), true);
});

test("findings are ordered by position, so the report reads top to bottom", () => {
  const text =
    '{\n  "mcpServers": {\n    "b": { "command": "npx", "args": ["pkg"] },\n    "a": { "command": "node", "args": ["./x.py"] }\n  }\n}';
  const result = lint(text, { client: "claude" });
  const lines = result.findings.map((f) => f.line);
  assert.deepEqual([...lines].sort((x, y) => x - y), lines);
});
