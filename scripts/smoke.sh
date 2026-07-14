#!/usr/bin/env bash
# Smoke test for plumbline: exercises the real CLI end to end against the
# bundled example configs and freshly written temp files. No network,
# idempotent, runs from a clean checkout (after `npm install`).
# Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents the surface.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in check clients explain --client --fail-on --format "Exit codes"; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Usage errors exit 2 (distinct from lint findings' 1).
set +e
$CLI --frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown flag should exit 2"; }
$CLI check "$WORKDIR/nope.json" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing file should exit 2"; }
$CLI check - --client zed </dev/null >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown client should exit 2"; }
set -e
echo "[smoke] error handling ok (exit 2)"

# 4. The broken Claude Desktop example fails with the seeded findings.
set +e
CLAUDE_OUT="$($CLI check examples/claude_desktop_config.json)"; CLAUDE_CODE=$?
set -e
[ "$CLAUDE_CODE" -eq 1 ] || fail "claude example should exit 1, got $CLAUDE_CODE"
echo "$CLAUDE_OUT" | grep -q '5 server(s) — 5 error(s), 5 warning(s), 0 info' || fail "claude example counts wrong"
echo "$CLAUDE_OUT" | grep -q 'auto-detected: file is named claude_desktop_config.json' || fail "claude detection missing"
for needle in E130 W206 W208 W207 W211 E126 E120 E125 E123 W210; do
  echo "$CLAUDE_OUT" | grep -q "$needle" || fail "claude report missing $needle"
done
echo "$CLAUDE_OUT" | grep -q 'no shell splits' || fail "missing embedded-args message"
echo "$CLAUDE_OUT" | grep -q 'mcp-remote' || fail "missing stdio-bridge fix for the url server"
echo "[smoke] claude example ok (5 errors, 5 warnings)"

# 5. The clean example passes with zero findings.
$CLI check examples/clean-claude.json >/dev/null || fail "clean example should exit 0"
$CLI check examples/clean-claude.json | grep -q 'plumbline: OK — 0 error(s), 0 warning(s), 0 info' \
  || fail "clean example should have zero findings"
echo "[smoke] clean example ok (exit 0)"

# 6. Cursor dialect: strict JSON + duplicate names + cleartext http.
set +e
CURSOR_OUT="$($CLI check --client cursor examples/cursor-mcp.json)"; CURSOR_CODE=$?
set -e
[ "$CURSOR_CODE" -eq 1 ] || fail "cursor example should exit 1"
echo "$CURSOR_OUT" | grep -q '3 error(s), 2 warning(s), 0 info' || fail "cursor example counts wrong"
for needle in E102 E103 E104 W213 W210; do
  echo "$CURSOR_OUT" | grep -q "$needle" || fail "cursor report missing $needle"
done
echo "[smoke] cursor example ok"

# 7. VS Code dialect: JSONC allowed, inputs/type checked, shape-detected.
set +e
VS_OUT="$($CLI check examples/vscode-mcp.json)"; VS_CODE_EXIT=$?
set -e
[ "$VS_CODE_EXIT" -eq 1 ] || fail "vscode example should exit 1"
echo "$VS_OUT" | grep -q 'VS Code (auto-detected' || fail "vscode shape detection missing"
echo "$VS_OUT" | grep -q 'E131' || fail "vscode report missing E131"
echo "$VS_OUT" | grep -q 'E127' || fail "vscode report missing E127"
! echo "$VS_OUT" | grep -q 'E102' || fail "comments must not be E102 in VS Code"
echo "$VS_OUT" | grep -q 'I301' || fail "vscode report missing the I301 portability note"
echo "[smoke] vscode example ok"

# 8. --fail-on moves the gate without changing the findings.
set +e
$CLI check examples/claude_desktop_config.json --fail-on never >/dev/null 2>&1
[ $? -eq 0 ] || { set -e; fail "--fail-on never should exit 0"; }
$CLI check examples/vscode-mcp.json --fail-on error >/dev/null 2>&1
[ $? -eq 1 ] || { set -e; fail "vscode example has errors; --fail-on error should exit 1"; }
set -e
echo "[smoke] --fail-on ok"

# 9. JSON output is valid JSON with stable fields.
set +e
JSON_OUT="$($CLI check examples/claude_desktop_config.json --format json)"; JSON_CODE=$?
set -e
[ "$JSON_CODE" -eq 1 ] || fail "json run should exit 1"
echo "$JSON_OUT" | grep -q '"code": "E130"' || fail "JSON output missing E130"
echo "$JSON_OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s))" \
  || fail "--format json is not valid JSON"
echo "[smoke] JSON output ok"

# 10. stdin plus the cross-client killer: a VS Code file linted as Claude.
printf '{"servers": {"a": {"command": "npx", "args": ["-y", "x"]}}}' > "$WORKDIR/vs-style.json"
set +e
STDIN_OUT="$($CLI check - --client claude < "$WORKDIR/vs-style.json")"; STDIN_CODE=$?
set -e
[ "$STDIN_CODE" -eq 1 ] || fail "wrong-container config should exit 1"
echo "$STDIN_OUT" | grep -q 'E110' || fail "stdin report missing E110"
echo "$STDIN_OUT" | grep -q '<stdin> — Claude Desktop (--client)' || fail "stdin header wrong"
echo "[smoke] stdin + wrong-container ok"

# 11. Path detection: the same bytes grade differently under .cursor/.
mkdir -p "$WORKDIR/proj/.cursor"
cp "$WORKDIR/vs-style.json" "$WORKDIR/proj/.cursor/mcp.json"
set +e
DETECT_OUT="$($CLI check "$WORKDIR/proj/.cursor/mcp.json")"; DETECT_CODE=$?
set -e
[ "$DETECT_CODE" -eq 1 ] || fail "cursor-path detection run should exit 1"
echo "$DETECT_OUT" | grep -q 'Cursor (auto-detected: file lives under .cursor/)' || fail "path detection missing"
echo "[smoke] path detection ok"

# 12. clients matrix and explain answer offline.
$CLI clients | grep -q 'servers + inputs' || fail "clients table missing vscode key"
$CLI clients | grep -q 'strict JSON' || fail "clients table missing dialect row"
$CLI explain E110 | grep -q 'cross-client mistake' || fail "explain E110 failed"
$CLI explain W206 | grep -q 'install prompt' || fail "explain W206 failed"
$CLI explain vscode | grep -q 'JSONC' || fail "explain vscode failed"
set +e
$CLI explain frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown explain topic should exit 2"; }
set -e
echo "[smoke] clients + explain ok"

# 13. Determinism: two runs over the same input are byte-identical.
$CLI check examples/cursor-mcp.json --client cursor > "$WORKDIR/run1.txt" 2>/dev/null || true
$CLI check examples/cursor-mcp.json --client cursor > "$WORKDIR/run2.txt" 2>/dev/null || true
cmp -s "$WORKDIR/run1.txt" "$WORKDIR/run2.txt" || fail "repeat runs differ"
echo "[smoke] determinism ok"

echo "SMOKE OK"
