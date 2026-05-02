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
  id?: string;
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
  // Set on the terminal `result` event when the CLI was launched with
  // --json-schema. Carries the schema-constrained value as a parsed object.
  // The translator surfaces it as a `structured_output` relay event and
  // exposes it on `TAskResult.structuredOutput` so `askJson` can read the
  // canonical JSON without scraping `raw.text` (which can be polluted by
  // hook-nag messages or unrelated model commentary in the same turn).
  structured_output?: unknown;
};
