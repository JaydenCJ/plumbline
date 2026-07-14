// Per-server schema and transport checks: what each client accepts in a
// server entry, and how value-type mistakes are reported.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { byCode, findings, mcpServers, stdioServer } from "./helpers.mjs";

test("neither command nor url is E120, both at once is E121", () => {
  const dead = mcpServers({ dead: { env: { A: "1" } } });
  const [claude] = byCode(findings(dead, { client: "claude" }), "E120");
  assert.match(claude.message, /no `command`/);
  const [cursor] = byCode(findings(dead, { client: "cursor" }), "E120");
  assert.match(cursor.message, /neither `command` \(stdio\) nor `url` \(remote\)/);
  const both = mcpServers({ a: { command: "npx", url: "https://example.test/mcp" } });
  const [e121] = byCode(findings(both, { client: "cursor" }), "E121");
  assert.match(e121.message, /two different transports/);
});

test("command must be a non-empty string (E122)", () => {
  const asArray = mcpServers({ a: { command: ["npx", "-y", "x"] } });
  const [e122a] = byCode(findings(asArray, { client: "claude" }), "E122");
  assert.match(e122a.message, /not array/);
  const empty = mcpServers({ a: { command: "  " } });
  const [e122b] = byCode(findings(empty, { client: "claude" }), "E122");
  assert.match(e122b.message, /empty/);
});

test("args must be an array of strings; each bad element is its own E123", () => {
  const notArray = mcpServers({ a: { command: "npx", args: "-y x" } });
  assert.equal(byCode(findings(notArray, { client: "claude" }), "E123").length, 1);
  const badItems = mcpServers({ a: { command: "node", args: ["/srv/s.js", 8080, true] } });
  const list = byCode(findings(badItems, { client: "claude" }), "E123");
  assert.deepEqual(list.map((f) => f.path), ["mcpServers.a.args[1]", "mcpServers.a.args[2]"]);
  assert.match(list[0].fix, /"8080"/);
});

test("env values must be strings; numbers and booleans are E124 with a quoting fix", () => {
  const config = mcpServers({ a: stdioServer({ env: { PORT: 8080, DEBUG: true, OK: "yes" } }) });
  const list = byCode(findings(config, { client: "claude" }), "E124");
  assert.equal(list.length, 2);
  assert.match(list[0].fix, /"PORT": "8080"/);
});

test("common wrong key names get E125 with the real key (aliases + edit distance)", () => {
  for (const [wrong, right] of [
    ["cmd", "command"],
    ["arguments", "args"],
    ["environment", "env"],
    ["agrs", "args"],
  ]) {
    const config = mcpServers({ a: { command: "npx", [wrong]: "x" } });
    const list = byCode(findings(config, { client: "claude" }), "E125");
    const hit = list.find((f) => f.path.endsWith(`.${wrong}`));
    assert.ok(hit, wrong);
    assert.match(hit.fix, new RegExp(`"${right}"`));
  }
});

test("right key, wrong case is E125 calling out case-sensitivity", () => {
  const config = mcpServers({ a: { Command: "npx" } });
  const list = findings(config, { client: "claude" });
  const [e125] = byCode(list, "E125");
  assert.match(e125.message, /case-sensitive/);
  assert.equal(byCode(list, "E120").length, 1); // and the entry is still dead
});

test("a key another client owns is W205 naming that client", () => {
  const config = mcpServers({ a: stdioServer({ dev: { watch: "src" } }) });
  const [w205] = byCode(findings(config, { client: "cursor" }), "W205");
  assert.ok(w205);
  assert.match(w205.message, /VS Code field/);
});

test("a url server in Claude Desktop is E126 with the stdio-bridge fix", () => {
  const config = mcpServers({ tickets: { url: "https://mcp.example.test/sse" } });
  const [e126] = byCode(findings(config, { client: "claude" }), "E126");
  assert.ok(e126);
  assert.match(e126.fix, /mcp-remote/);
  assert.match(e126.fix, /https:\/\/mcp\.example\.test\/sse/);
});

test("VS Code type mismatches are E127 in all three shapes", () => {
  const badValue = { servers: { a: { type: "websocket", url: "https://example.test/mcp" } } };
  assert.match(byCode(findings(badValue, { client: "vscode" }), "E127")[0].message, /"stdio", "sse" or "http"/);
  const stdioWithUrl = { servers: { a: { type: "stdio", url: "https://example.test/mcp" } } };
  assert.match(byCode(findings(stdioWithUrl, { client: "vscode" }), "E127")[0].message, /contradicts the `url`/);
  const sseWithCommand = { servers: { a: { type: "sse", command: "npx", args: ["-y", "x"] } } };
  assert.match(byCode(findings(sseWithCommand, { client: "vscode" }), "E127")[0].message, /contradicts the `command`/);
});

test("headers without a url is E127 everywhere headers exist", () => {
  const config = mcpServers({ a: stdioServer({ headers: { "X-Api-Version": "1" } }) });
  const [e127] = byCode(findings(config, { client: "cursor" }), "E127");
  assert.match(e127.message, /no HTTP requests/);
});

test("bad urls are E128; plain http is W213 for remote hosts, fine for loopback", () => {
  const bare = mcpServers({ a: { url: "example.test/mcp" } });
  assert.match(byCode(findings(bare, { client: "cursor" }), "E128")[0].message, /not a parseable URL/);
  const ws = mcpServers({ a: { url: "ws://example.test/mcp" } });
  assert.match(byCode(findings(ws, { client: "cursor" }), "E128")[0].message, /ws:/);
  const remote = mcpServers({ a: { url: "http://mcp.example.test/sse" } });
  assert.equal(byCode(findings(remote, { client: "cursor" }), "W213").length, 1);
  for (const host of ["127.0.0.1:3845", "localhost:3845"]) {
    const loopback = mcpServers({ a: { url: `http://${host}/mcp` } });
    assert.equal(byCode(findings(loopback, { client: "cursor" }), "W213").length, 0, host);
  }
});

test("envFile outside VS Code is E129; inside VS Code it is fine", () => {
  const config = { a: stdioServer({ envFile: "/srv/mcp/.env" }) };
  const [e129] = byCode(findings(mcpServers(config), { client: "cursor" }), "E129");
  assert.ok(e129);
  assert.match(e129.message, /VS Code feature/);
  const vs = findings({ servers: config }, { client: "vscode" });
  assert.equal(byCode(vs, "E129").length, 0);
});

test("server names with spaces or exotic characters are W212", () => {
  const config = mcpServers({ "my tools!": stdioServer() });
  const [w212] = byCode(findings(config, { client: "claude" }), "W212");
  assert.ok(w212);
  assert.equal(w212.server, "my tools!");
  const fine = mcpServers({ "web-search_v2.1": stdioServer() });
  assert.equal(byCode(findings(fine, { client: "claude" }), "W212").length, 0);
});
