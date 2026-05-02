export type TTextEvent = {
  type: "text";
  content: string;
};

export type TThinkingEvent = {
  type: "thinking";
  content: string;
};

export type TToolUseEvent = {
  type: "tool_use";
  toolUseId: string;
  toolName: string;
  // Structured tool input as parsed from the protocol. Previously
  // pre-serialized to a string; now passed through as-is so consumers
  // don't have to re-parse. Use JSON.stringify(event.input) if you need
  // the string form.
  input: unknown;
};

export type TToolResultEvent = {
  type: "tool_result";
  toolUseId: string;
  output: string;
  isError: boolean;
};

export type TSessionMetaEvent = {
  type: "session_meta";
  sessionId: string;
  model: string;
  tools: string[];
};

export type TTurnCompleteEvent = {
  type: "turn_complete";
  sessionId?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  contextWindow?: number;
  durationMs?: number;
};

export type TErrorEvent = {
  type: "error";
  message: string;
  sessionId?: string;
};

// Emitted when the CLI was given --json-schema and produced a constrained
// value via the synthetic StructuredOutput tool_use block, OR via the
// terminal result event's structured_output field. The value is the parsed
// JSON object directly (not a string). Only one structured_output event is
// emitted per turn; the translator dedupes between the two source paths.
export type TStructuredOutputEvent = {
  type: "structured_output";
  value: unknown;
};

export type TRelayEvent =
  | TTextEvent
  | TThinkingEvent
  | TToolUseEvent
  | TToolResultEvent
  | TSessionMetaEvent
  | TTurnCompleteEvent
  | TErrorEvent
  | TStructuredOutputEvent;
