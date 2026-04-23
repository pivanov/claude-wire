import type { TToolDecision } from "../tools/handler.js";
import type { TBuiltInToolName } from "../tools/registry.js";
import type { TWarn } from "../warnings.js";
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
  toolHandler?: IToolHandler;
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
  /** CLI `--permission-mode`. Controls how the CLI handles tool approval prompts (plan-only, auto-approve edits, skip prompts, etc.). */
  permissionMode?: "default" | "plan" | "auto" | "bypassPermissions" | "acceptEdits" | "dontAsk" | (string & {});
  configDir?: string;
  env?: Record<string, string>;
  addDirs?: string[];
  effort?: "low" | "medium" | "high" | "max";
  /** CLI `--include-hook-events`. When true, the CLI emits hook lifecycle events alongside normal output for debugging/telemetry. */
  includeHookEvents?: boolean;
  /** CLI `--include-partial-messages`. When true, the CLI streams incremental content blocks instead of waiting for complete messages. */
  includePartialMessages?: boolean;
  /** CLI `--bare`. Disables system/project instruction injection -- the model sees only the prompt. */
  bare?: boolean;
  /** CLI `--json-schema`. Raw JSON Schema string that constrains model output to valid JSON matching the schema. `askJson()` sets this automatically when passed a schema string. */
  jsonSchema?: string;
  /** CLI `--fork-session`. Used with `resume` to create a divergent session branch off the resumed turn instead of appending. */
  forkSession?: boolean;
  /** CLI `--no-session-persistence`. Prevents the CLI from writing the session to its transcript store. */
  noSessionPersistence?: boolean;
  /** CLI `--session-id`. Pins a specific session identifier for the spawned process. Useful for resumable-by-id workflows. */
  sessionId?: string;
  /**
   * CLI `--setting-sources`. Comma-separated list of which setting layers the CLI should load (e.g. `"project,user"`). Enum widened with
   * `(string & {})` so IDEs autocomplete the documented values without rejecting compound strings.
   */
  settingSources?: "project" | "user" | "local" | "all" | "" | (string & {});
  /** CLI `--disable-slash-commands`. Treats `/`-prefixed prompts as literal text instead of invoking slash commands. */
  disableSlashCommands?: boolean;
  /**
   * Called for every library-emitted warning (user-callback threw, malformed
   * tool decision, etc.). Set this to route warnings to your telemetry or
   * silence them with `() => {}`. When omitted, warnings go to `console.warn`
   * prefixed with `[claude-wire]`.
   */
  onWarning?: TWarn;
}

/**
 * Reasons the session runtime may recycle (kill + discard) its backing
 * process. Exposed on {@link ISessionOptions.onRecycle} so callers can
 * pattern-match on future values without a breaking change. Today only
 * `"turn-limit"` is emitted (triggered by `LIMITS.sessionMaxTurnsBeforeRecycle`);
 * additional reasons may be added in later minor versions.
 */
export type TRecycleReason = "turn-limit" | (string & {});

// Session-specific superset of IClaudeOptions: same spawn/config surface
// plus observability hooks that only make sense for a multi-turn flow.
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
  /**
   * Fires when the session voluntarily recycles its backing process -- for
   * example when `LIMITS.sessionMaxTurnsBeforeRecycle` is reached. The next
   * `ask()` will spawn a fresh process (resuming by `sessionId` when one is
   * known). Use this to emit metrics, warm a replacement pool, or log the
   * transition. Thrown errors from the callback are swallowed.
   */
  onRecycle?: (reason: TRecycleReason) => void;
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
   * Per-ask cost observer. Fires once after this ask's `turn_complete` with
   * the session's cumulative snapshot. Runs alongside the session-level
   * `onCostUpdate` (both fire if both are set), so callers can attach
   * request-scoped metadata (request id, tenant, trace span) without
   * reaching outside the callback. Thrown errors are swallowed.
   */
  onCostUpdate?: (cost: TCostSnapshot) => void;
  /**
   * Per-ask abort signal. Aborts this ask only (the session stays alive).
   * Composes with the session-level `signal` -- either firing aborts the ask.
   */
  signal?: AbortSignal;
}
