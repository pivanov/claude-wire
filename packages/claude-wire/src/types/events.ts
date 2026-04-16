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
  contextWindow?: number;
  durationMs?: number;
};

export type TErrorEvent = {
  type: "error";
  message: string;
  sessionId?: string;
};

export type TRelayEvent = TTextEvent | TThinkingEvent | TToolUseEvent | TToolResultEvent | TSessionMetaEvent | TTurnCompleteEvent | TErrorEvent;
