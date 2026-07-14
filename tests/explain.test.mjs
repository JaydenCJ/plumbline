// The offline manual: every rule, client and concept must render, and
// unknown topics must produce a useful did-you-mean.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { explainSuggestion, explainTopic, explainTopics, ruleCodes, RULES } from "../dist/index.js";

test("every rule code renders its title, severity and detail", () => {
  for (const info of RULES) {
    const text = explainTopic(info.code);
    assert.ok(text, info.code);
    assert.ok(text.includes(info.code));
    assert.ok(text.includes(info.severity));
    assert.ok(text.includes(info.title));
  }
  // Lookup is case-insensitive.
  assert.equal(explainTopic("e110"), explainTopic("E110"));
});

test("client topics render the per-client cheat sheet", () => {
  const claude = explainTopic("claude");
  assert.match(claude, /Claude Desktop/);
  assert.match(claude, /mcpServers/);
  assert.match(claude, /strict JSON/);
  const vscode = explainTopic("vscode");
  assert.match(vscode, /servers \+ inputs/);
  assert.match(vscode, /JSONC/);
});

test("the rules index and every concept topic render", () => {
  const index = explainTopic("rules");
  for (const code of ruleCodes()) assert.ok(index.includes(code), code);
  for (const topic of ["strict-json", "detection", "variables", "inputs", "secrets", "remote", "exit-codes", "clients"]) {
    assert.ok(explainTopic(topic), topic);
  }
});

test("unknown topics return null plus a did-you-mean", () => {
  assert.equal(explainTopic("frobnicate"), null);
  assert.equal(explainSuggestion("E13O"), "E130"); // letter O for zero
  assert.equal(explainSuggestion("cluade"), "claude");
  assert.ok(explainTopics().includes("E110"));
});
