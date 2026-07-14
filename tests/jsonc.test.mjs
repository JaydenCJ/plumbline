// The JSONC parser: positions, duplicate preservation, comment and
// trailing-comma capture — the facts every dialect check depends on.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  asObject,
  asString,
  keysOf,
  lastEntry,
  parseJsonc,
  shadowedEntries,
  typeName,
} from "../dist/index.js";

test("parses nested structure with correct scalar values", () => {
  const result = parseJsonc('{"a": {"b": [1, "two", true, null, -3.5e2]}}');
  assert.equal(result.error, null);
  const a = asObject(lastEntry(asObject(result.root), "a").value);
  const list = lastEntry(a, "b").value;
  assert.equal(list.kind, "array");
  assert.deepEqual(
    list.items.map((item) => item.value),
    [1, "two", true, null, -350],
  );
});

test("tracks 1-based line and column for keys and values", () => {
  const text = '{\n  "name": {\n    "command": "npx"\n  }\n}';
  const result = parseJsonc(text);
  const name = lastEntry(asObject(result.root), "name");
  assert.deepEqual({ line: name.keyPos.line, column: name.keyPos.column }, { line: 2, column: 3 });
  const command = lastEntry(asObject(name.value), "command");
  assert.equal(command.keyPos.line, 3);
  assert.equal(command.value.pos.line, 3);
});

test("records line and block comments with their positions", () => {
  const result = parseJsonc('{\n  // one\n  "a": 1 /* two */\n}');
  assert.equal(result.error, null);
  assert.deepEqual(
    result.comments.map((c) => [c.style, c.pos.line]),
    [
      ["line", 2],
      ["block", 3],
    ],
  );
});

test("records trailing commas in both objects and arrays", () => {
  const result = parseJsonc('{"a": [1, 2,], "b": {"c": 1,},}');
  assert.equal(result.error, null);
  assert.equal(result.trailingCommas.length, 3);
  // Positions point at the commas themselves.
  assert.equal(result.trailingCommas[0].column, '{"a": [1, 2'.length + 1);
});

test("preserves duplicate object entries; lastEntry wins like JSON.parse", () => {
  const result = parseJsonc('{"x": 1, "x": 2, "y": 3}');
  const root = asObject(result.root);
  assert.equal(root.entries.length, 3);
  assert.equal(lastEntry(root, "x").value.value, 2); // same answer as JSON.parse
  assert.deepEqual(
    shadowedEntries(root).map((entry) => [entry.key, entry.value.value]),
    [["x", 1]],
  );
});

test("keysOf dedupes while preserving first-appearance order", () => {
  const root = asObject(parseJsonc('{"b": 1, "a": 2, "b": 3}').root);
  assert.deepEqual(keysOf(root), ["b", "a"]);
});

test("decodes string escapes including \\u sequences", () => {
  const result = parseJsonc('{"s": "a\\n\\t\\"\\\\ \\u0041"}');
  assert.equal(asString(lastEntry(asObject(result.root), "s").value), 'a\n\t"\\ A');
});

test("hard syntax errors carry targeted messages and positions", () => {
  const badEscape = parseJsonc('{"s": "bad \\q escape"}');
  assert.match(badEscape.error.message, /invalid escape/);
  assert.equal(badEscape.error.pos.line, 1);
  // Single quotes get their own message, as key and as value.
  assert.match(parseJsonc("{'command': 'npx'}").error.message, /double-quoted object key/);
  assert.match(parseJsonc('{"command": \'npx\'}').error.message, /double quotes, not single quotes/);
  // A missing comma points at the line where the next member starts.
  const missingComma = parseJsonc('{\n  "a": 1\n  "b": 2\n}');
  assert.match(missingComma.error.message, /expected ',' or '}'/);
  assert.equal(missingComma.error.pos.line, 3);
  assert.match(parseJsonc('{"a": "oops}').error.message, /unterminated string/);
  assert.match(parseJsonc('{"a": 1} extra').error.message, /after the end/);
  assert.match(parseJsonc("").error.message, /empty/);
});

test("strips a UTF-8 BOM and reports it", () => {
  const result = parseJsonc('﻿{"a": 1}');
  assert.equal(result.hasBom, true);
  assert.equal(result.error, null);
  assert.equal(lastEntry(asObject(result.root), "a").value.value, 1);
  assert.equal(parseJsonc('{"a": 1}').hasBom, false);
});

test("typeName labels every node kind", () => {
  const root = asObject(parseJsonc('{"o": {}, "l": [], "s": "x", "n": 1, "b": true, "z": null}').root);
  const label = (key) => typeName(lastEntry(root, key).value);
  assert.deepEqual(
    ["o", "l", "s", "n", "b", "z"].map(label),
    ["object", "array", "string", "number", "boolean", "null"],
  );
});
