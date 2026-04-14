import type { TToolDecision } from "../tools/handler.js";
import type { TToolUseEvent } from "./events.js";
import type { TCostSnapshot } from "./results.js";

export interface IToolHandler {
  allowed?: string[];
  blocked?: string[];
  onToolUse?: (tool: TToolUseEvent) => Promise<TToolDecision>;
  // Called when `onToolUse` throws. Return a decision to recover, or re-throw
  // to fall through to the default "deny" behavior. Useful for logging.
  onError?: (error: unknown, tool: TToolUseEvent) => TToolDecision | Promise<TToolDecision>;
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
  /**
   * SDK-side budget limit, evaluated after each turn. Throws `BudgetExceededError`
   * and kills the process when `total_cost_usd` exceeds this value. `0` means
   * "disallow any spend" (useful for tests).
   */
  maxCostUsd?: number;
  /**
   * CLI-level budget forwarded as `--max-budget-usd`. Enforced by the Claude
   * binary itself, independent of {@link IClaudeOptions.maxCostUsd}. Either
   * can fire first; set both for belt-and-suspenders.
   */
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
  settingSources?: string;
  disableSlashCommands?: boolean;
}

export interface ISessionOptions extends IClaudeOptions {}
