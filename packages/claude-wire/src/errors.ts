export class ClaudeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeError";
  }
}

export class BudgetExceededError extends ClaudeError {
  constructor(
    public readonly spent: number,
    public readonly budget: number,
  ) {
    super(`Budget exceeded: $${spent.toFixed(4)} spent, $${budget.toFixed(4)} limit`);
    this.name = "BudgetExceededError";
  }
}

export class AbortError extends ClaudeError {
  constructor(message = "Operation aborted") {
    super(message);
    this.name = "AbortError";
  }
}

export class TimeoutError extends ClaudeError {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export class ProcessError extends ClaudeError {
  constructor(
    message: string,
    public readonly exitCode?: number,
  ) {
    super(message);
    this.name = "ProcessError";
  }
}

// Only codes the SDK actually constructs are listed. Add a new code here
// alongside the throw site that needs it -- aspirational entries give
// consumers false confidence that they can pattern-match on them.
export const KNOWN_ERROR_CODES = [
  "not-authenticated",
  "binary-not-found",
  "permission-denied",
  "retry-exhausted",
  // Classified from stderr by classifyStderr (src/stderr.ts):
  "rate-limit",
  "overloaded",
  "context-length-exceeded",
  "invalid-json-schema",
  "mcp-error",
] as const;

export type TKnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

export class KnownError extends ClaudeError {
  constructor(
    public readonly code: TKnownErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "KnownError";
  }
}

export const isKnownError = (error: unknown): error is KnownError => {
  return error instanceof KnownError;
};

// Network-level transients (ECONNRESET/REFUSED/ABORTED, ENETUNREACH, EHOSTUNREACH),
// DNS transients (EAI_AGAIN), pipe resets (EPIPE/SIGPIPE, broken pipe), fetch
// errors, ad-hoc "socket hang up" messages from node, and Anthropic
// overloaded_error which the CLI bubbles up verbatim for 529 responses.
const TRANSIENT_PATTERN =
  /fetch failed|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ECONNABORTED|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|network error|network timeout|EPIPE|SIGPIPE|broken pipe|socket hang up|overloaded_error/i;

// Exit codes we treat as transient: 137 = SIGKILL (OOM), 141 = SIGPIPE,
// 143 = SIGTERM. Non-zero normal exits (e.g. 1) stay non-transient.
const TRANSIENT_EXIT_CODES = new Set([137, 141, 143]);

export const isTransientError = (error: unknown): boolean => {
  if (error instanceof AbortError || error instanceof BudgetExceededError) {
    return false;
  }
  if (error instanceof ProcessError) {
    return error.exitCode !== undefined && TRANSIENT_EXIT_CODES.has(error.exitCode);
  }
  const message = errorMessage(error);
  return TRANSIENT_PATTERN.test(message);
};

export const errorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

// Shared error factory for the "process died before emitting turn_complete"
// case. session.ts + stream.ts both need this; the string used to be
// duplicated verbatim, which drifted at least once. Prefix stderr when
// available because CLI error output is the most actionable signal.
// Auto-promotes to KnownError when stderr matches a classifiable pattern.
// stderr.ts only has a type-only import from this file, so the direct
// runtime import below is NOT a circular dependency at runtime.
import { classifyStderr } from "./stderr.js";

export const processExitedEarly = (stderr: string, exitCode?: number): ProcessError | KnownError => {
  if (stderr) {
    const code = classifyStderr(stderr, exitCode);
    if (code) {
      return new KnownError(code, stderr);
    }
  }
  return new ProcessError(stderr || "Process exited without completing the turn", exitCode);
};
