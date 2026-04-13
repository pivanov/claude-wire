export type TModelUsageEntry = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  contextWindow: number;
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

export type TClaudeEvent = {
  type: TClaudeEventType;
  subtype?: string;
  message?: TClaudeMessage;
  result?: unknown;
  session_id?: string;
  model?: string;
  tools?: string[];
  duration_ms?: number;
  duration_api_ms?: number;
  cost_usd?: number;
  total_cost_usd?: number;
  is_error?: boolean;
  num_turns?: number;
  modelUsage?: Record<string, TModelUsageEntry>;
  usage?: unknown;
};
