import { describe, expect, test } from "bun:test";
import {
  AbortError,
  BudgetExceededError,
  errorMessage,
  isKnownError,
  isTransientError,
  KnownError,
  ProcessError,
  processExitedEarly,
} from "@/errors.js";

describe("isTransientError", () => {
  test("ECONNREFUSED matches", () => {
    expect(isTransientError(new Error("fetch failed: ECONNREFUSED"))).toBe(true);
  });

  test("ETIMEDOUT matches", () => {
    expect(isTransientError(new Error("ETIMEDOUT"))).toBe(true);
  });

  test("ECONNRESET matches", () => {
    expect(isTransientError(new Error("ECONNRESET"))).toBe(true);
  });

  test("broken pipe matches", () => {
    expect(isTransientError(new Error("broken pipe"))).toBe(true);
  });

  test("AbortError does not match (user-initiated)", () => {
    expect(isTransientError(new AbortError())).toBe(false);
  });

  test("ProcessError with code 137 (OOM kill) matches", () => {
    expect(isTransientError(new ProcessError("killed", 137))).toBe(true);
  });

  test("ProcessError with code 143 (SIGTERM) matches", () => {
    expect(isTransientError(new ProcessError("terminated", 143))).toBe(true);
  });

  test("ProcessError with code 1 does not match", () => {
    expect(isTransientError(new ProcessError("error", 1))).toBe(false);
  });

  test("BudgetExceededError does not match", () => {
    expect(isTransientError(new BudgetExceededError(0.5, 0.1))).toBe(false);
  });

  test("random Error does not match", () => {
    expect(isTransientError(new Error("something unexpected"))).toBe(false);
  });

  test("non-Error values use string conversion", () => {
    expect(isTransientError("fetch failed")).toBe(true);
    expect(isTransientError("nope")).toBe(false);
  });
});

describe("KnownError", () => {
  test("has correct code and message", () => {
    const err = new KnownError("binary-not-found", "Claude CLI not found");
    expect(err.code).toBe("binary-not-found");
    expect(err.message).toBe("Claude CLI not found");
    expect(err.name).toBe("KnownError");
  });

  test("uses code as message when no message provided", () => {
    const err = new KnownError("not-authenticated");
    expect(err.message).toBe("not-authenticated");
  });
});

describe("isKnownError", () => {
  test("returns true for KnownError", () => {
    expect(isKnownError(new KnownError("binary-not-found"))).toBe(true);
  });

  test("returns false for regular Error", () => {
    expect(isKnownError(new Error("nope"))).toBe(false);
  });

  test("returns false for ProcessError", () => {
    expect(isKnownError(new ProcessError("nope"))).toBe(false);
  });

  test("returns false for non-errors", () => {
    expect(isKnownError("string")).toBe(false);
    expect(isKnownError(null)).toBe(false);
  });
});

describe("processExitedEarly", () => {
  test("returns KnownError when stderr matches a classified pattern", () => {
    const err = processExitedEarly("rate limit exceeded 429", 1);
    expect(err).toBeInstanceOf(KnownError);
    if (err instanceof KnownError) {
      expect(err.code).toBe("rate-limit");
    }
  });

  test("returns ProcessError when stderr does not match any pattern", () => {
    const err = processExitedEarly("some random error", 1);
    expect(err).toBeInstanceOf(ProcessError);
    if (err instanceof ProcessError) {
      expect(err.exitCode).toBe(1);
    }
  });

  test("returns ProcessError with default message when stderr is empty", () => {
    const err = processExitedEarly("");
    expect(err).toBeInstanceOf(ProcessError);
    expect(err.message).toBe("Process exited without completing the turn");
  });

  test("passes exit code through to ProcessError", () => {
    const err = processExitedEarly("", 137);
    expect(err).toBeInstanceOf(ProcessError);
    if (err instanceof ProcessError) {
      expect(err.exitCode).toBe(137);
    }
  });

  test("classifies overloaded stderr", () => {
    const err = processExitedEarly("overloaded_error: service temporarily unavailable");
    expect(err).toBeInstanceOf(KnownError);
    if (err instanceof KnownError) {
      expect(err.code).toBe("overloaded");
    }
  });
});

describe("errorMessage", () => {
  test("extracts message from Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  test("stringifies non-Error values", () => {
    expect(errorMessage("string error")).toBe("string error");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
  });
});

describe("BudgetExceededError", () => {
  test("exposes spent and budget fields", () => {
    const err = new BudgetExceededError(0.5, 0.1);
    expect(err.spent).toBe(0.5);
    expect(err.budget).toBe(0.1);
    expect(err.message).toContain("0.5000");
    expect(err.message).toContain("0.1000");
  });
});
