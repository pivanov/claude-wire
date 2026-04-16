import type { TToolDecision } from "../tools/handler.js";
import type { TBuiltInToolName } from "../tools/registry.js";
import type { TToolUseEvent } from "./events.js";
import type { TCostSnapshot } from "./results.js";

// Tool-name slots accept the documented built-in names (for IDE completion)
// while still allowing arbitrary strings (MCP tools, future additions).
// Same `(string & {})` trick used for `model` and `permissionMode`.
export type TToolName = TBuiltInToolName | (string & {});

export interface IToolHandler {
  allowed?: TToolName[];
  blocked?: TToolName[];
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
  allowedTools?: TToolName[];
  disallowedTools?: TToolName[];
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
  // Comma-separated list per CLI spec; enum widened with `(string & {})` so
  // IDEs autocomplete the documented values without rejecting compound
  // strings like "project,user".
  settingSources?: "project" | "user" | "local" | "all" | "" | (string & {});
  disableSlashCommands?: boolean;
  /**
   * Called for every library-emitted warning (user-callback threw, malformed
   * tool decision, etc.). Set this to route warnings to your telemetry or
   * silence them with `() => {}`. When omitted, warnings go to `console.warn`
   * prefixed with `[claude-wire]`.
   */
  onWarning?: (message: string, cause?: unknown) => void;
}

// createSession takes the same options as createClient/createStream. Kept
// as a named alias so the session API has a documentable option type
// without duplicating the field list.
export interface ISessionOptions extends IClaudeOptions {
  /**
   * Fires each time a transient failure triggers a respawn inside a single
   * `ask()`. `attempt` is 1-indexed. The error is the one that caused the
   * retry (e.g. `ProcessError` with a SIGKILL exit code). Use this to
   * surface retry activity in UI/telemetry; the SDK still handles the retry.
   *
   * Can also be passed per-ask via `session.ask(prompt, { onRetry })` for
   * request-scoped correlation. Both fire if both are set.
   */
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Per-ask options passed to `session.ask(prompt, options?)`. Override or
 * supplement session-level callbacks for a single call -- useful for
 * request-scoped logging/correlation in daemon-style consumers.
 */
export interface IAskOptions {
  /**
   * Per-ask retry observer. Fires alongside the session-level `onRetry` when
   * both are set, so callers can attach request-scoped context (request id,
   * trace span, user id) without reaching outside the callback.
   */
  onRetry?: (attempt: number, error: unknown) => void;
  /**
   * Per-ask abort signal. Aborts this ask only (the session stays alive).
   * Composes with the session-level `signal` -- either firing aborts the ask.
   */
  signal?: AbortSignal;
}
