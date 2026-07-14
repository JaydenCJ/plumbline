// Launch pitfalls: the mistakes that pass schema validation and still
// leave a server dead. Each check has a negative twin so the heuristics
// stay precise, not just loud.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { byCode, findings, mcpServers, stdioServer } from "./helpers.mjs";

test("flags embedded in `command` are E130 with the exact split as the fix", () => {
  const config = mcpServers({ gh: { command: "npx -y @modelcontextprotocol/server-github" } });
  const [e130] = byCode(findings(config, { client: "claude" }), "E130");
  assert.ok(e130);
  assert.equal(e130.fix, '"command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"]');
});

test("E130's fix appends the declared args after the embedded ones", () => {
  const config = mcpServers({ a: { command: "uvx some-server", args: ["--db", "/srv/x.db"] } });
  const [e130] = byCode(findings(config, { client: "claude" }), "E130");
  assert.equal(e130.fix, '"command": "uvx", "args": ["some-server", "--db", "/srv/x.db"]');
});

test("a path containing spaces is NOT E130 — no flags, no known launcher", () => {
  const config = mcpServers({
    a: { command: "C:\\Program Files\\MCP Server\\server.exe", args: ["--port", "9"] },
  });
  assert.equal(byCode(findings(config, { client: "claude" }), "E130").length, 0);
});

test("npx without -y is W206; with -y (even embedded) it is quiet", () => {
  const bare = mcpServers({ a: { command: "npx", args: ["some-server"] } });
  assert.equal(byCode(findings(bare, { client: "claude" }), "W206").length, 1);
  const withYes = mcpServers({ a: { command: "npx", args: ["-y", "some-server"] } });
  assert.equal(byCode(findings(withYes, { client: "claude" }), "W206").length, 0);
  // -y hiding inside an embedded command string still counts.
  const embedded = mcpServers({ a: { command: "npx -y some-server" } });
  assert.equal(byCode(findings(embedded, { client: "claude" }), "W206").length, 0);
  const notNpx = mcpServers({ a: { command: "uvx", args: ["some-server"] } });
  assert.equal(byCode(findings(notNpx, { client: "claude" }), "W206").length, 0);
});

test("relative script paths are W207; absolute and package names are not", () => {
  const relative = mcpServers({ a: { command: "node", args: ["./build/index.js"] } });
  assert.equal(byCode(findings(relative, { client: "claude" }), "W207").length, 1);
  const bare = mcpServers({ a: { command: "node", args: ["dist/index.js"] } });
  assert.equal(byCode(findings(bare, { client: "claude" }), "W207").length, 1);
  const fine = mcpServers({
    a: { command: "npx", args: ["-y", "@scope/pkg", "/srv/docs"] },
    b: { command: "node", args: ["/opt/server/index.js"] },
  });
  assert.equal(byCode(findings(fine, { client: "claude" }), "W207").length, 0);
  // The command itself can be relative too.
  const relCommand = mcpServers({ a: { command: "./server", args: [] } });
  const [w207] = byCode(findings(relCommand, { client: "claude" }), "W207");
  assert.match(w207.path, /command$/);
});

test("~ in command, args or env values is W208", () => {
  const config = mcpServers({
    a: { command: "~/bin/server" },
    b: { command: "npx", args: ["-y", "x", "~/Documents"] },
    c: stdioServer({ env: { DATA_DIR: "~/data" } }),
  });
  const list = byCode(findings(config, { client: "claude" }), "W208");
  assert.equal(list.length, 3);
  assert.ok(list.some((f) => f.path.endsWith("env.DATA_DIR")));
});

test("npm-family shims get W209 only with Windows evidence, and only for shims", () => {
  const windows = mcpServers({
    a: { command: "npx", args: ["-y", "server-filesystem", "C:\\Users\\dev\\Documents"] },
  });
  const [w209] = byCode(findings(windows, { client: "claude" }), "W209");
  assert.ok(w209);
  assert.match(w209.fix, /"cmd", "args": \["\/c", "npx"/);
  const unix = mcpServers({
    a: { command: "npx", args: ["-y", "server-filesystem", "/home/dev/documents"] },
  });
  assert.equal(byCode(findings(unix, { client: "claude" }), "W209").length, 0);
  // node.exe execs fine — no shim, no warning, even on Windows.
  const realExe = mcpServers({ a: { command: "node", args: ["C:\\mcp\\server.js"] } });
  assert.equal(byCode(findings(realExe, { client: "claude" }), "W209").length, 0);
});

test("live-looking credentials in env are W210; placeholders and refs are not", () => {
  const live = mcpServers({ a: stdioServer({ env: { API_TOKEN: "AAAAAAAAAAAAAAAAAAAA" } }) });
  assert.equal(byCode(findings(live, { client: "claude" }), "W210").length, 1);
  const quiet = mcpServers({
    a: stdioServer({
      env: {
        API_TOKEN: "<YOUR-TOKEN>", // placeholder
        AUTH_KEY: "${input:key}", // variable reference
        TOKEN_TTL: "60s", // short value
        REGION: "eu-central-1-abcdef", // name not credential-like
      },
    }),
  });
  assert.equal(byCode(findings(quiet, { client: "vscode", filePath: null }), "W210").length, 0);
});

test("W210 covers Authorization headers too, and the advice is per-client", () => {
  const header = mcpServers({
    a: { url: "https://example.test/mcp", headers: { Authorization: "Bearer abcdef123456" } },
  });
  const [cur] = byCode(findings(header, { client: "cursor" }), "W210");
  assert.ok(cur);
  assert.match(cur.fix, /wrapper script/); // no inputs mechanism in Cursor
  const env = { servers: { a: stdioServer({ env: { API_TOKEN: "AAAAAAAAAAAAAAAAAAAA" } }) } };
  const [vs] = byCode(findings(env, { client: "vscode" }), "W210");
  assert.match(vs.fix, /\$\{input:/); // VS Code can prompt instead
});

test("interpreter/script mismatch is W211 in both directions, quiet when they agree", () => {
  const nodePy = mcpServers({ a: { command: "node", args: ["/srv/server.py"] } });
  assert.match(byCode(findings(nodePy, { client: "claude" }), "W211")[0].fix, /"python"/);
  const pyJs = mcpServers({ a: { command: "python3", args: ["/srv/server.js"] } });
  assert.match(byCode(findings(pyJs, { client: "claude" }), "W211")[0].fix, /"node"/);
  const agree = mcpServers({
    a: { command: "node", args: ["/srv/server.mjs"] },
    b: { command: "python", args: ["/srv/server.py"] },
  });
  assert.equal(byCode(findings(agree, { client: "claude" }), "W211").length, 0);
});
