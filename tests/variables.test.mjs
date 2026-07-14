// ${...} substitution: a VS Code power feature and a silent trap in the
// other two clients — the literal text reaches the server.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { byCode, findings, mcpServers, stdioServer, vsServers } from "./helpers.mjs";

const INPUT = [{ type: "promptString", id: "api-token", password: true }];

test("${input:x} without a definition is E131; with one it is quiet", () => {
  const missing = vsServers({ a: stdioServer({ env: { KEY: "${input:api-token}" } }) });
  const [e131] = byCode(findings(missing, { client: "vscode" }), "E131");
  assert.ok(e131);
  assert.match(e131.fix, /"id": "api-token"/);
  const defined = vsServers({ a: stdioServer({ env: { KEY: "${input:api-token}" } }) }, INPUT);
  assert.equal(byCode(findings(defined, { client: "vscode" }), "E131").length, 0);
});

test("a defined but unreferenced input is I302", () => {
  const config = vsServers({ a: stdioServer() }, INPUT);
  const [i302] = byCode(findings(config, { client: "vscode" }), "I302");
  assert.ok(i302);
  assert.equal(i302.path, "inputs.api-token");
});

test("${workspaceFolder} is fine in VS Code, E132 in Claude Desktop and Cursor", () => {
  const vs = vsServers({ a: { command: "node", args: ["${workspaceFolder}/dist/index.js"] } });
  assert.equal(byCode(findings(vs, { client: "vscode" }), "E132").length, 0);
  const other = mcpServers({ a: { command: "node", args: ["${workspaceFolder}/dist/index.js"] } });
  for (const client of ["claude", "cursor"]) {
    const [e132] = byCode(findings(other, { client }), "E132");
    assert.ok(e132, client);
    assert.match(e132.message, /literal text/);
  }
});

test("E132 fires on variables hiding in env values too", () => {
  const config = mcpServers({ a: stdioServer({ env: { CONFIG: "${env:HOME}/mcp.toml" } }) });
  const [e132] = byCode(findings(config, { client: "cursor" }), "E132");
  assert.equal(e132.path, "mcpServers.a.env.CONFIG");
});

test("malformed inputs entries are E112 with the array index", () => {
  const config = vsServers({ a: stdioServer() }, ["not-an-object", { type: "promptString" }]);
  const list = byCode(findings(config, { client: "vscode" }), "E112");
  assert.deepEqual(list.map((f) => f.path), ["inputs[0]", "inputs[1]"]);
});
