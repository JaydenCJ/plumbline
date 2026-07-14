/**
 * Public programmatic API. Everything the CLI does is available as pure
 * functions over plain data:
 *
 *   const result = analyzeConfig(text, { filePath: ".cursor/mcp.json" });
 *   const report = renderText([result], { failOn: "warning" });
 */
export { analyzeConfig } from "./analyze.js";
export type { AnalyzeOptions } from "./analyze.js";
export { CLIENT_IDS, CLIENTS, clientMatrix, resolveClientId } from "./clients.js";
export type { ClientProfile } from "./clients.js";
export { detectClient, detectFromPath, detectFromShape } from "./detect.js";
export { explainSuggestion, explainTopic, explainTopics } from "./explain.js";
export {
  asObject,
  asString,
  keysOf,
  lastEntry,
  parseJsonc,
  shadowedEntries,
  typeName,
} from "./jsonc.js";
export type {
  CommentToken,
  JsonArray,
  JsonEntry,
  JsonNode,
  JsonObject,
  JsonScalar,
  JsonSyntaxError,
  ParseResult,
} from "./jsonc.js";
export { editDistance, nearest } from "./nearest.js";
export { checkPitfalls, programBasename } from "./pitfalls.js";
export type { ServerContext } from "./pitfalls.js";
export { renderJson, renderText, runOk, totalsOf } from "./report.js";
export type { RenderOptions } from "./report.js";
export { RULES, ruleByCode, ruleCodes } from "./rules.js";
export type { RuleInfo } from "./rules.js";
export { failsAt, tally } from "./types.js";
export type {
  ClientId,
  Detection,
  FailOn,
  FileResult,
  Finding,
  Position,
  Severity,
  Totals,
} from "./types.js";
export { VERSION } from "./version.js";
