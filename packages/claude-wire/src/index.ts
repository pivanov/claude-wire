import { createClient } from "./client.js";

export type { IClaudeClient } from "./client.js";
export { createClient } from "./client.js";
export { BINARY, LIMITS, TIMEOUTS } from "./constants.js";
export type { ICostProjection, ICostTracker, ICostTrackerOptions } from "./cost.js";
export { createCostTracker } from "./cost.js";
export type { TKnownErrorCode } from "./errors.js";
export {
  AbortError,
  BudgetExceededError,
  ClaudeError,
  errorMessage,
  isKnownError,
  isTransientError,
  KNOWN_ERROR_CODES,
  KnownError,
  ProcessError,
  TimeoutError,
} from "./errors.js";
export type { IJsonResult, IStandardSchema, TSchemaInput } from "./json.js";
export { JsonValidationError, parseAndValidate, stripFences } from "./json.js";
export { blockFingerprint, extractContent, parseDoubleEncoded } from "./parser/content.js";
export { parseLine } from "./parser/ndjson.js";
export type { ITranslator } from "./parser/translator.js";
export { createTranslator } from "./parser/translator.js";
export type { IClaudeProcess, ISpawnOptions } from "./process.js";
export { buildArgs, resetResolvedEnvCache, spawnClaude } from "./process.js";
export type { IReaderOptions } from "./reader.js";
export { readNdjsonEvents } from "./reader.js";
export type { IClaudeSession } from "./session.js";
export { createSession } from "./session.js";
export { classifyStderr } from "./stderr.js";
export type { IClaudeStream } from "./stream.js";
export { createStream } from "./stream.js";
export type { IToolHandlerInstance, TToolDecision } from "./tools/handler.js";
export { createToolHandler } from "./tools/handler.js";
export type { TBuiltInToolName } from "./tools/registry.js";
export { BUILT_IN_TOOL_NAMES, BUILT_IN_TOOLS, isBuiltInTool } from "./tools/registry.js";
export type {
  TErrorEvent,
  TRelayEvent,
  TSessionMetaEvent,
  TTextEvent,
  TThinkingEvent,
  TToolResultEvent,
  TToolUseEvent,
  TTurnCompleteEvent,
} from "./types/events.js";
export type { IAskOptions, IClaudeOptions, ISessionOptions, IToolHandler } from "./types/options.js";
export type { TClaudeContent, TClaudeContentType, TClaudeEvent, TClaudeEventType, TClaudeMessage, TModelUsageEntry } from "./types/protocol.js";
export type { TAskResult, TCostSnapshot, TTokens } from "./types/results.js";
export { writer } from "./writer.js";

// Wire the stderr classifier into the error factory at module load so
// processExitedEarly can auto-promote ProcessError -> KnownError.
import { setStderrClassifier } from "./errors.js";
import { classifyStderr as _classifyStderr } from "./stderr.js";

setStderrClassifier(_classifyStderr);

export const claude = createClient();
