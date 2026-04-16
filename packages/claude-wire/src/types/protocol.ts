export type TModelUsageEntry = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  // Protocol doesn't always include this field (older CLI versions or
  // certain event subtypes omit it). Keep optional so consumers can detect
  // absence rather than get a garbage zero.
  contextWindow?: number;
};

export type TClaudeContentType = "text" | "thinking" | "tool_use" | "tool_result" | (string & {});

export type TClaudeContent = {
  type: TClaudeContentType;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
};

export type TClaudeMessage = {
  content: TClaudeContent[];
  role?: string;
  stop_reason?: string;
};

export type TClaudeEventType = "system" | "assistant" | "user" | "result" | "progress" | "rate_limit_event" | (string & {});

// Shape of a raw CLI event before the translator converts it to TRelayEvent.
// Trimmed to fields we actually read -- protocol-side extras (cost_usd,
// duration_api_ms, num_turns, usage) were speculatively declared but never
// consumed; if a future translator needs them, restore from the CLI wire docs.
export type TClaudeEvent = {
  type: TClaudeEventType;
  subtype?: string;
  message?: TClaudeMessage;
  result?: unknown;
  session_id?: string;
  model?: string;
  tools?: string[];
  duration_ms?: number;
  total_cost_usd?: number;
  is_error?: boolean;
  modelUsage?: Record<string, TModelUsageEntry>;
};
