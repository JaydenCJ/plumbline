// Top-level checks: the right container key per client, typo detection,
// and the per-client tolerance rules (Claude Desktop's file doubles as
// an app settings file; Cursor's and VS Code's do not).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { byCode, codes, findings, mcpServers, stdioServer, vsServers } from "./helpers.mjs";

test("the wrong container key is E110 in both directions — the #1 cross-client mistake", () => {
  for (const client of ["claude", "cursor"]) {
    const [e110] = byCode(findings(vsServers({ a: stdioServer() }), { client }), "E110");
    assert.ok(e110, client);
    assert.match(e110.fix, /"mcpServers"/);
  }
  const [other] = byCode(findings(mcpServers({ a: stdioServer() }), { client: "vscode" }), "E110");
  assert.ok(other);
  assert.match(other.fix, /"servers"/);
});

test("when both keys are present the message says the wrong one is ignored", () => {
  const config = { mcpServers: { a: stdioServer() }, servers: { b: stdioServer() } };
  const [e110] = byCode(findings(config, { client: "claude" }), "E110");
  assert.match(e110.message, /sits next to `mcpServers`/);
});

test("typos of the container key are E111 with a did-you-mean", () => {
  for (const typo of ["mcpervers", "mcp-servers", "mcpServer"]) {
    const [e111] = byCode(findings({ [typo]: { a: stdioServer() } }, { client: "claude" }), "E111");
    assert.ok(e111, typo);
    assert.match(e111.fix, /"mcpServers"/);
  }
});

test("right letters, wrong case is E111 calling out case-sensitivity", () => {
  const [e111] = byCode(findings({ mcpservers: { a: stdioServer() } }, { client: "cursor" }), "E111");
  assert.ok(e111);
  assert.match(e111.message, /case-sensitive/);
});

test("Claude Desktop tolerates unrelated top-level keys; Cursor flags them W204", () => {
  const config = { mcpServers: { a: stdioServer() }, globalShortcut: "Cmd+Shift+Space" };
  assert.deepEqual(codes(findings(config, { client: "claude" })), []);
  const [w204] = byCode(findings(config, { client: "cursor" }), "W204");
  assert.ok(w204);
  assert.equal(w204.path, "globalShortcut");
});

test("`inputs` outside VS Code is E113, not a generic unknown key", () => {
  const config = { mcpServers: { a: stdioServer() }, inputs: [] };
  const cursor = findings(config, { client: "cursor" });
  assert.equal(byCode(cursor, "E113").length, 1);
  assert.equal(byCode(cursor, "W204").length, 0);
});

test("an empty or missing container is W203", () => {
  const [empty] = byCode(findings(mcpServers({}), { client: "claude" }), "W203");
  assert.match(empty.message, /empty/);
  const [missing] = byCode(findings({ theme: "dark" }, { client: "claude" }), "W203");
  assert.match(missing.message, /no `mcpServers` key/);
});

test("a non-object container or server entry is E112", () => {
  const [container] = byCode(findings({ mcpServers: [] }, { client: "claude" }), "E112");
  assert.match(container.message, /not array/);
  const [entry] = byCode(findings(mcpServers({ a: "npx" }), { client: "claude" }), "E112");
  assert.match(entry.message, /server entry must be an object/);
});

test("the settings.json-style mcp wrapper is unwrapped for VS Code with I303", () => {
  const config = { mcp: { servers: { a: { command: "node", args: ["/srv/a.py"] } } } };
  const list = findings(config, { client: "vscode" });
  assert.equal(byCode(list, "I303").length, 1);
  // The wrapped servers are really linted: the interpreter mismatch shows.
  assert.equal(byCode(list, "W211").length, 1);
  assert.equal(byCode(list, "E110").length, 0);
});
