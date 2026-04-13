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

const KNOWN_ERROR_CODES = ["not-authenticated", "binary-not-found", "session-expired", "permission-denied", "invalid-model"] as const;

type TKnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

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

const TRANSIENT_PATTERN = /fetch failed|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network error|network timeout|EPIPE|SIGPIPE|broken pipe/i;

export const isTransientError = (error: unknown): boolean => {
  if (error instanceof AbortError || error instanceof BudgetExceededError) {
    return false;
  }
  if (error instanceof ProcessError) {
    const transientCodes = [137, 143];
    return error.exitCode !== undefined && transientCodes.includes(error.exitCode);
  }
  const message = errorMessage(error);
  return TRANSIENT_PATTERN.test(message);
};

export const errorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

export const assertPositiveNumber = (value: number | undefined, name: string): void => {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new ClaudeError(`${name} must be a finite positive number`);
  }
};
