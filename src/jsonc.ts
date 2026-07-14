/**
 * A tolerant JSON/JSONC parser with position tracking.
 *
 * plumbline cannot use JSON.parse: it throws away line numbers, silently
 * merges duplicate keys (exactly the bug we want to report), and rejects
 * the comments and trailing commas that VS Code's mcp.json legitimately
 * allows. This parser accepts the JSONC superset, keeps every duplicate
 * object entry, and records where each comment and trailing comma sits so
 * the analyzer can decide — per client — whether they are fine or fatal.
 */

import type { Position } from "./types.js";

/** A parsed scalar: string, number, boolean or null. */
export interface JsonScalar {
  kind: "scalar";
  pos: Position;
  value: string | number | boolean | null;
}

export interface JsonArray {
  kind: "array";
  pos: Position;
  items: JsonNode[];
}

/** One object member. Duplicates are preserved in order of appearance. */
export interface JsonEntry {
  key: string;
  keyPos: Position;
  value: JsonNode;
}

export interface JsonObject {
  kind: "object";
  pos: Position;
  entries: JsonEntry[];
}

export type JsonNode = JsonScalar | JsonArray | JsonObject;

export interface CommentToken {
  pos: Position;
  /** Comment style: "line" for double-slash, "block" for slash-star. */
  style: "line" | "block";
}

export interface JsonSyntaxError {
  message: string;
  pos: Position;
}

export interface ParseResult {
  /** null when a hard syntax error stopped the parse. */
  root: JsonNode | null;
  error: JsonSyntaxError | null;
  comments: CommentToken[];
  trailingCommas: Position[];
  /** True when the text began with a UTF-8 byte-order mark. */
  hasBom: boolean;
}

class ParseFailure extends Error {
  constructor(
    message: string,
    readonly pos: Position,
  ) {
    super(message);
  }
}

class Scanner {
  private index = 0;
  private line = 1;
  private column = 1;
  readonly comments: CommentToken[] = [];
  readonly trailingCommas: Position[] = [];

  constructor(private readonly text: string) {}

  position(): Position {
    return { offset: this.index, line: this.line, column: this.column };
  }

  atEnd(): boolean {
    return this.index >= this.text.length;
  }

  peek(): string {
    return this.text[this.index] ?? "";
  }

  private advance(): string {
    const ch = this.text[this.index] ?? "";
    this.index += 1;
    if (ch === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return ch;
  }

  fail(message: string, pos?: Position): never {
    throw new ParseFailure(message, pos ?? this.position());
  }

  /** Skip whitespace and comments, recording each comment's position. */
  skipTrivia(): void {
    for (;;) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.advance();
        continue;
      }
      if (ch === "/") {
        const next = this.text[this.index + 1];
        const pos = this.position();
        if (next === "/") {
          this.comments.push({ pos, style: "line" });
          while (!this.atEnd() && this.peek() !== "\n") this.advance();
          continue;
        }
        if (next === "*") {
          this.comments.push({ pos, style: "block" });
          this.advance();
          this.advance();
          for (;;) {
            if (this.atEnd()) this.fail("unterminated block comment", pos);
            if (this.peek() === "*" && this.text[this.index + 1] === "/") {
              this.advance();
              this.advance();
              break;
            }
            this.advance();
          }
          continue;
        }
        this.fail("unexpected character '/'");
      }
      return;
    }
  }

  parseValue(): JsonNode {
    this.skipTrivia();
    if (this.atEnd()) this.fail("unexpected end of input, expected a value");
    const ch = this.peek();
    if (ch === "{") return this.parseObject();
    if (ch === "[") return this.parseArray();
    if (ch === '"') return this.parseString();
    if (ch === "'") this.fail("strings must use double quotes, not single quotes");
    if (ch === "-" || (ch >= "0" && ch <= "9")) return this.parseNumber();
    if (ch === "t" || ch === "f" || ch === "n") return this.parseKeyword();
    this.fail(`unexpected character '${ch}', expected a value`);
  }

  private parseObject(): JsonObject {
    const pos = this.position();
    this.advance(); // consume {
    const entries: JsonEntry[] = [];
    this.skipTrivia();
    if (this.peek() === "}") {
      this.advance();
      return { kind: "object", pos, entries };
    }
    for (;;) {
      this.skipTrivia();
      if (this.peek() === "}") {
        // A comma directly before the brace got us here: trailing comma.
        this.advance();
        return { kind: "object", pos, entries };
      }
      if (this.peek() !== '"') {
        this.fail('expected a double-quoted object key');
      }
      const keyNode = this.parseString();
      this.skipTrivia();
      if (this.peek() !== ":") this.fail("expected ':' after object key");
      this.advance();
      const value = this.parseValue();
      entries.push({ key: String(keyNode.value), keyPos: keyNode.pos, value });
      this.skipTrivia();
      const next = this.peek();
      if (next === ",") {
        const commaPos = this.position();
        this.advance();
        this.skipTrivia();
        if (this.peek() === "}") {
          this.trailingCommas.push(commaPos);
          this.advance();
          return { kind: "object", pos, entries };
        }
        continue;
      }
      if (next === "}") {
        this.advance();
        return { kind: "object", pos, entries };
      }
      if (this.atEnd()) this.fail("unterminated object, expected '}'", pos);
      this.fail("expected ',' or '}' after object member");
    }
  }

  private parseArray(): JsonArray {
    const pos = this.position();
    this.advance(); // consume [
    const items: JsonNode[] = [];
    this.skipTrivia();
    if (this.peek() === "]") {
      this.advance();
      return { kind: "array", pos, items };
    }
    for (;;) {
      items.push(this.parseValue());
      this.skipTrivia();
      const next = this.peek();
      if (next === ",") {
        const commaPos = this.position();
        this.advance();
        this.skipTrivia();
        if (this.peek() === "]") {
          this.trailingCommas.push(commaPos);
          this.advance();
          return { kind: "array", pos, items };
        }
        continue;
      }
      if (next === "]") {
        this.advance();
        return { kind: "array", pos, items };
      }
      if (this.atEnd()) this.fail("unterminated array, expected ']'", pos);
      this.fail("expected ',' or ']' after array element");
    }
  }

  private parseString(): JsonScalar {
    const pos = this.position();
    this.advance(); // consume "
    let out = "";
    for (;;) {
      if (this.atEnd()) this.fail("unterminated string", pos);
      const ch = this.advance();
      if (ch === '"') return { kind: "scalar", pos, value: out };
      if (ch === "\n") this.fail("unterminated string (newline inside)", pos);
      if (ch === "\\") {
        const esc = this.advance();
        switch (esc) {
          case '"': out += '"'; break;
          case "\\": out += "\\"; break;
          case "/": out += "/"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "n": out += "\n"; break;
          case "r": out += "\r"; break;
          case "t": out += "\t"; break;
          case "u": {
            let hex = "";
            for (let i = 0; i < 4; i += 1) hex += this.advance();
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              this.fail(`invalid unicode escape '\\u${hex}'`);
            }
            out += String.fromCharCode(Number.parseInt(hex, 16));
            break;
          }
          default:
            this.fail(`invalid escape '\\${esc}'`);
        }
        continue;
      }
      out += ch;
    }
  }

  private parseNumber(): JsonScalar {
    const pos = this.position();
    let raw = "";
    if (this.peek() === "-") raw += this.advance();
    while (/[0-9]/.test(this.peek())) raw += this.advance();
    if (this.peek() === ".") {
      raw += this.advance();
      while (/[0-9]/.test(this.peek())) raw += this.advance();
    }
    if (this.peek() === "e" || this.peek() === "E") {
      raw += this.advance();
      if (this.peek() === "+" || this.peek() === "-") raw += this.advance();
      while (/[0-9]/.test(this.peek())) raw += this.advance();
    }
    const value = Number(raw);
    if (raw === "" || raw === "-" || Number.isNaN(value)) {
      this.fail(`invalid number '${raw}'`, pos);
    }
    return { kind: "scalar", pos, value };
  }

  private parseKeyword(): JsonScalar {
    const pos = this.position();
    for (const [word, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (this.text.startsWith(word, this.index)) {
        for (let i = 0; i < word.length; i += 1) this.advance();
        return { kind: "scalar", pos, value };
      }
    }
    this.fail("unexpected token, expected true, false or null");
  }
}

/** Parse JSONC text. Never throws; hard errors land in `result.error`. */
export function parseJsonc(rawText: string): ParseResult {
  const hasBom = rawText.charCodeAt(0) === 0xfeff;
  const text = hasBom ? rawText.slice(1) : rawText;
  const scanner = new Scanner(text);
  try {
    scanner.skipTrivia();
    if (scanner.atEnd()) {
      scanner.fail("the file is empty — not a JSON document");
    }
    const root = scanner.parseValue();
    scanner.skipTrivia();
    if (!scanner.atEnd()) {
      scanner.fail("unexpected content after the end of the JSON document");
    }
    return {
      root,
      error: null,
      comments: scanner.comments,
      trailingCommas: scanner.trailingCommas,
      hasBom,
    };
  } catch (failure) {
    if (failure instanceof ParseFailure) {
      return {
        root: null,
        error: { message: failure.message, pos: failure.pos },
        comments: scanner.comments,
        trailingCommas: scanner.trailingCommas,
        hasBom,
      };
    }
    throw failure;
  }
}

/** Narrow a node to an object, or null. */
export function asObject(node: JsonNode | null | undefined): JsonObject | null {
  return node && node.kind === "object" ? node : null;
}

/** Narrow a node to a string scalar's value, or null. */
export function asString(node: JsonNode | null | undefined): string | null {
  return node && node.kind === "scalar" && typeof node.value === "string" ? node.value : null;
}

/**
 * The entry that actually wins for `key` — the LAST one, matching what
 * JSON.parse (and therefore every client) does with duplicates.
 */
export function lastEntry(obj: JsonObject, key: string): JsonEntry | null {
  for (let i = obj.entries.length - 1; i >= 0; i -= 1) {
    const entry = obj.entries[i];
    if (entry && entry.key === key) return entry;
  }
  return null;
}

/** All entries whose key appears more than once: every loser, in order. */
export function shadowedEntries(obj: JsonObject): JsonEntry[] {
  const lastIndex = new Map<string, number>();
  obj.entries.forEach((entry, index) => lastIndex.set(entry.key, index));
  return obj.entries.filter((entry, index) => lastIndex.get(entry.key) !== index);
}

/** Distinct keys of an object, in first-appearance order. */
export function keysOf(obj: JsonObject): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const entry of obj.entries) {
    if (!seen.has(entry.key)) {
      seen.add(entry.key);
      keys.push(entry.key);
    }
  }
  return keys;
}

/** Human label for a node's JSON type, used in shape error messages. */
export function typeName(node: JsonNode): string {
  if (node.kind === "object") return "object";
  if (node.kind === "array") return "array";
  if (node.value === null) return "null";
  return typeof node.value;
}
