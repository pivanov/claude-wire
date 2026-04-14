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

export const KNOWN_ERROR_CODES = ["not-authenticated", "binary-not-found", "session-expired", "permission-denied", "invalid-model"] as const;

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

const TRANSIENT_PATTERN =
  /fetch failed|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ECONNABORTED|ENETUNREACH|EAI_AGAIN|network error|network timeout|EPIPE|SIGPIPE|broken pipe/i;

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

export const assertPositiveNumber = (value: number | undefined, name: string): void => {
  // Allow 0 so callers can express "no spend permitted" (useful in tests).
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new ClaudeError(`${name} must be a finite non-negative number`);
  }
};
