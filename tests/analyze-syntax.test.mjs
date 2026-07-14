// File-level dialect checks: what parses where. Claude Desktop and
// Cursor are strict JSON; VS Code is JSONC — the same byte sequence must
// grade differently per client.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { byCode, codes, findings, lint } from "./helpers.mjs";

test("broken JSON is E101 with the failing line, and marks the result fatal", () => {
  const result = lint('{\n  "mcpServers": {\n    "a": { "command": "npx" }\n', { client: "claude" });
  assert.equal(result.fatal, true);
  const [e101] = byCode(result.findings, "E101");
  assert.ok(e101);
  assert.equal(typeof e101.line, "number");
  assert.match(e101.message, /load nothing/);
});

test("comments and trailing commas are E102/E103 per occurrence in strict-JSON clients", () => {
  const commented = '{\n  // a\n  "mcpServers": { /* b */ }\n}';
  for (const client of ["claude", "cursor"]) {
    const list = byCode(findings(commented, { client }), "E102");
    assert.equal(list.length, 2, client);
    assert.deepEqual(list.map((f) => f.line), [2, 3]);
  }
  const trailing = '{\n  "mcpServers": {\n    "a": { "command": "npx" },\n  }\n}';
  const [e103] = byCode(findings(trailing, { client: "cursor" }), "E103");
  assert.ok(e103);
  assert.equal(e103.line, 3);
});

test("the same comment and trailing comma are a single I301 advisory in VS Code", () => {
  const text = '{\n  // a\n  "servers": {\n    "a": { "command": "npx" },\n  }\n}';
  const list = findings(text, { client: "vscode" });
  assert.deepEqual(codes(byCode(list, "E102")), []);
  assert.deepEqual(codes(byCode(list, "E103")), []);
  const i301 = byCode(list, "I301");
  assert.equal(i301.length, 1);
  assert.match(i301[0].message, /1 comment\(s\) and 1 trailing comma\(s\)/);
});

test("a UTF-8 BOM is W201 even when the JSON is otherwise perfect", () => {
  const clean = '{"mcpServers": {"a": {"command": "npx", "args": ["-y", "x"]}}}';
  assert.deepEqual(codes(findings(clean, { client: "claude" })), []);
  const [w201] = byCode(findings("﻿" + clean, { client: "claude" }), "W201");
  assert.ok(w201);
  assert.match(w201.message, /byte-order mark/);
});

test("duplicate server names are E104, pointing at the dropped entry", () => {
  const text =
    '{\n  "mcpServers": {\n    "db": { "command": "npx", "args": ["-y", "a"] },\n    "db": { "command": "npx", "args": ["-y", "b"] }\n  }\n}';
  const [e104] = byCode(findings(text, { client: "claude" }), "E104");
  assert.ok(e104);
  assert.equal(e104.line, 3); // the earlier, silently-dropped definition
  assert.equal(e104.server, "db");
});

test("a duplicated key inside one server entry is W202", () => {
  const text =
    '{\n  "mcpServers": {\n    "a": { "command": "npx", "args": ["-y", "x"], "command": "uvx" }\n  }\n}';
  const [w202] = byCode(findings(text, { client: "claude" }), "W202");
  assert.ok(w202);
  assert.match(w202.message, /`command` appears twice/);
});

test("a non-object top level is E112 and fatal", () => {
  const result = lint('["mcpServers"]', { client: "claude" });
  assert.equal(result.fatal, true);
  const [e112] = byCode(result.findings, "E112");
  assert.match(e112.message, /must be a JSON object, not array/);
});
