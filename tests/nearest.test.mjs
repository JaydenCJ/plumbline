// The did-you-mean engine. Small, but E111/E125 quality depends on it.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { editDistance, nearest } from "../dist/index.js";

test("edit distance covers insert, delete, substitute", () => {
  assert.equal(editDistance("args", "args"), 0);
  assert.equal(editDistance("arg", "args"), 1);
  assert.equal(editDistance("argss", "args"), 1);
  assert.equal(editDistance("argz", "args"), 1);
  assert.equal(editDistance("command", "env"), 6);
});

test("adjacent transposition counts as a single edit", () => {
  assert.equal(editDistance("agrs", "args"), 1);
  assert.equal(editDistance("mcpsrevers", "mcpservers"), 1); // nearest() folds case first
});

test("nearest picks the closest candidate within the budget, else null", () => {
  const keys = ["command", "args", "env"];
  assert.equal(nearest("comand", keys), "command");
  assert.equal(nearest("agrs", keys), "args");
  assert.equal(nearest("Command", keys), "command"); // case-insensitive
  assert.equal(nearest("headers", keys), null); // distance > 2
  assert.equal(nearest("xyzzy", keys, 2), null);
});
