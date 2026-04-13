export type { IClaudeClient } from "./client.js";
export { createClient } from "./client.js";
export { BINARY, LIMITS, TIMEOUTS } from "./constants.js";
export type { ICostTracker, ICostTrackerOptions } from "./cost.js";
export { createCostTracker } from "./cost.js";
export { AbortError, BudgetExceededError, ClaudeError, isKnownError, isTransientError, KnownError, ProcessError, TimeoutError } from "./errors.js";
export { blockFingerprint, extractContent, parseDoubleEncoded } from "./parser/content.js";
export { parseLine } from "./parser/ndjson.js";
export type { ITranslator } from "./parser/translator.js";
export { createTranslator } from "./parser/translator.js";
export type { IClaudeProcess, ISpawnOptions } from "./process.js";
export { resetBinaryCache, spawnClaude } from "./process.js";
export type { IClaudeSession } from "./session.js";
export { createSession } from "./session.js";
export type { IClaudeStream } from "./stream.js";
export { createStream } from "./stream.js";
export type { IToolHandlerInstance, TToolDecision } from "./tools/handler.js";
export { createToolHandler } from "./tools/handler.js";
export { BUILT_IN_TOOLS, isBuiltInTool } from "./tools/registry.js";
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
export type { IClaudeOptions, ISessionOptions, IToolHandler } from "./types/options.js";
export type { TClaudeContent, TClaudeContentType, TClaudeEvent, TClaudeEventType, TClaudeMessage, TModelUsageEntry } from "./types/protocol.js";
export type { TAskResult, TCostSnapshot } from "./types/results.js";
export { writer } from "./writer.js";

import { createClient } from "./client.js";

export const claude = createClient();
