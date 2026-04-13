import type { TToolDecision } from "../tools/handler.js";
import type { TToolUseEvent } from "./events.js";
import type { TCostSnapshot } from "./results.js";

export interface IToolHandler {
  allowed?: string[];
  blocked?: string[];
  onToolUse?: (tool: TToolUseEvent) => Promise<TToolDecision>;
}

// NOTE: Claude Code CLI has no --max-turns flag. Do not add maxTurns here.
// Session turn limits are handled SDK-side via LIMITS.sessionMaxTurnsBeforeRecycle in constants.ts.
export interface IClaudeOptions {
  cwd?: string;
  model?: "opus" | "sonnet" | "haiku" | (string & {});
  systemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  tools?: IToolHandler;
  maxCostUsd?: number;
  maxBudgetUsd?: number;
  onCostUpdate?: (cost: TCostSnapshot) => void;
  signal?: AbortSignal;
  resume?: string;
  verbose?: boolean;
  mcpConfig?: string;
  continueSession?: boolean;
  permissionMode?: "default" | "plan" | "auto" | "bypassPermissions" | "acceptEdits" | "dontAsk" | (string & {});
  configDir?: string;
  env?: Record<string, string>;
  addDirs?: string[];
  effort?: "low" | "medium" | "high" | "max";
  includeHookEvents?: boolean;
  includePartialMessages?: boolean;
  bare?: boolean;
  jsonSchema?: string;
  forkSession?: boolean;
  noSessionPersistence?: boolean;
  sessionId?: string;
}

export interface ISessionOptions extends IClaudeOptions {}
