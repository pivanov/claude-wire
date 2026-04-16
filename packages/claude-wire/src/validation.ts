import { ClaudeError } from "./errors.js";

// Boundary validators -- throw ClaudeError with a stable message shape so
// callers (SDK tests, consumer apps) can pattern-match on field name.
// Both helpers are cheap; performance-sensitive paths should still prefer
// type-level guards, but runtime checks catch undeclared-undefined drift.

/**
 * Rejects non-finite values and negatives. Zero is intentionally allowed
 * so callers can express "disallow any spend" (useful in tests).
 */
export const assertPositiveNumber = (value: number | undefined, name: string): void => {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new ClaudeError(`${name} must be a finite non-negative number`);
  }
};

/**
 * Rejects empty strings. Used on writer payloads where an empty value
 * would produce a malformed JSON line on the CLI's stdin.
 */
export const requireNonEmpty = (value: string, name: string): void => {
  if (!value) {
    throw new ClaudeError(`${name} must be a non-empty string`);
  }
};
