// Client detection: path beats shape, shape beats the default, and an
// explicit flag beats everything. A wrong guess here would grade a file
// against the wrong dialect, so the reasons are part of the contract.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { detectClient, detectFromPath, detectFromShape, parseJsonc } from "../dist/index.js";

test("the Claude Desktop file name is recognized anywhere it lives", () => {
  for (const path of [
    "/home/dev/backups/claude_desktop_config.json",
    "C:\\Users\\dev\\AppData\\Roaming\\Claude\\claude_desktop_config.json",
  ]) {
    assert.equal(detectFromPath(path)?.client, "claude", path);
  }
});

test(".cursor/ and .vscode/ directories identify their clients", () => {
  assert.equal(detectFromPath("/home/dev/project/.cursor/mcp.json")?.client, "cursor");
  assert.equal(detectFromPath(".vscode/mcp.json")?.client, "vscode");
  assert.equal(detectFromPath("C:\\proj\\.vscode\\mcp.json")?.client, "vscode");
  assert.equal(detectFromPath("/home/dev/notes/mcp.json"), null); // says nothing
});

test("top-level servers/inputs shape means VS Code", () => {
  const root = parseJsonc('{"servers": {}}').root;
  assert.equal(detectFromShape(root)?.client, "vscode");
  const inputsOnly = parseJsonc('{"inputs": []}').root;
  assert.equal(detectFromShape(inputsOnly)?.client, "vscode");
});

test("mcpServers with a url server means Cursor, stdio-only means Claude", () => {
  const withUrl = parseJsonc('{"mcpServers": {"a": {"url": "https://example.test/mcp"}}}').root;
  assert.equal(detectFromShape(withUrl)?.client, "cursor");
  const stdio = parseJsonc('{"mcpServers": {"a": {"command": "npx"}}}').root;
  assert.equal(detectFromShape(stdio)?.client, "claude");
});

test("an explicit client wins over both path and shape", () => {
  const root = parseJsonc('{"servers": {}}').root;
  const detection = detectClient("/x/.cursor/mcp.json", root, "vscode");
  assert.deepEqual([detection.client, detection.source], ["vscode", "flag"]);
});

test("path wins over shape; with neither, the default is Claude Desktop", () => {
  // A VS Code-shaped file inside .cursor/ is judged as a Cursor config —
  // that is exactly the E110 wrong-container case we must not paper over.
  const root = parseJsonc('{"servers": {}}').root;
  assert.equal(detectClient("/p/.cursor/mcp.json", root).client, "cursor");
  const fallback = detectClient(null, parseJsonc('{"other": 1}').root);
  assert.deepEqual([fallback.client, fallback.source], ["claude", "default"]);
});
