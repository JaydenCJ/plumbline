// The client knowledge base: the profile facts every rule leans on.
// If one of these changes upstream, this file is where the update lands.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CLIENT_IDS, CLIENTS, clientMatrix, resolveClientId } from "../dist/index.js";

test("resolveClientId accepts the spellings people actually type", () => {
  assert.equal(resolveClientId("claude"), "claude");
  assert.equal(resolveClientId("Claude Desktop"), "claude");
  assert.equal(resolveClientId("claude-desktop"), "claude");
  assert.equal(resolveClientId("CURSOR"), "cursor");
  assert.equal(resolveClientId("vscode"), "vscode");
  assert.equal(resolveClientId("VS Code"), "vscode");
  assert.equal(resolveClientId("code"), "vscode");
  assert.equal(resolveClientId("zed"), null);
});

test("profile invariants hold for every client", () => {
  for (const id of CLIENT_IDS) {
    const profile = CLIENTS[id];
    assert.equal(profile.id, id);
    assert.ok(profile.topLevelKeys.includes(profile.configKey), id);
    assert.ok(!profile.wrongConfigKeys.includes(profile.configKey), id);
    assert.ok(profile.transports.includes("stdio"), id);
    assert.ok(profile.serverKeys.includes("command"), id);
    assert.ok(profile.serverKeys.includes("env"), id);
  }
});

test("the load-bearing per-client facts", () => {
  // These are the facts E102/E110/E113/E126/E129/E132 are built on.
  assert.equal(CLIENTS.claude.configKey, "mcpServers");
  assert.equal(CLIENTS.cursor.configKey, "mcpServers");
  assert.equal(CLIENTS.vscode.configKey, "servers");
  assert.deepEqual([...CLIENTS.claude.transports], ["stdio"]);
  assert.equal(CLIENTS.claude.allowsJsonc, false);
  assert.equal(CLIENTS.cursor.allowsJsonc, false);
  assert.equal(CLIENTS.vscode.allowsJsonc, true);
  assert.equal(CLIENTS.vscode.supportsInputs, true);
  assert.equal(CLIENTS.vscode.supportsEnvFile, true);
  assert.equal(CLIENTS.cursor.supportsVariables, false);
});

test("the clients matrix covers all three clients on every row", () => {
  const rows = clientMatrix();
  assert.ok(rows.length >= 8);
  for (const row of rows) {
    for (const id of CLIENT_IDS) {
      assert.equal(typeof row.values[id], "string", `${row.axis}/${id}`);
      assert.ok(row.values[id].length > 0, `${row.axis}/${id}`);
    }
  }
  const keyRow = rows.find((row) => row.axis === "top-level key");
  assert.equal(keyRow.values.claude, "mcpServers");
  assert.equal(keyRow.values.vscode, "servers + inputs");
});
