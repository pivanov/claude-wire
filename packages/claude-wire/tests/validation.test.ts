import { describe, expect, test } from "bun:test";
import { ClaudeError } from "@/errors.js";
import { assertPositiveNumber, requireNonEmpty } from "@/validation.js";

describe("assertPositiveNumber", () => {
  test("allows undefined", () => {
    expect(() => assertPositiveNumber(undefined, "test")).not.toThrow();
  });

  test("allows zero", () => {
    expect(() => assertPositiveNumber(0, "test")).not.toThrow();
  });

  test("allows positive numbers", () => {
    expect(() => assertPositiveNumber(0.5, "test")).not.toThrow();
    expect(() => assertPositiveNumber(100, "test")).not.toThrow();
  });

  test("rejects negative numbers", () => {
    expect(() => assertPositiveNumber(-1, "test")).toThrow(ClaudeError);
    expect(() => assertPositiveNumber(-0.001, "test")).toThrow(ClaudeError);
  });

  test("rejects NaN", () => {
    expect(() => assertPositiveNumber(NaN, "test")).toThrow(ClaudeError);
  });

  test("rejects Infinity", () => {
    expect(() => assertPositiveNumber(Infinity, "test")).toThrow(ClaudeError);
    expect(() => assertPositiveNumber(-Infinity, "test")).toThrow(ClaudeError);
  });

  test("includes field name in error message", () => {
    expect(() => assertPositiveNumber(-1, "maxBudgetUsd")).toThrow("maxBudgetUsd");
  });
});

describe("requireNonEmpty", () => {
  test("allows non-empty strings", () => {
    expect(() => requireNonEmpty("hello", "test")).not.toThrow();
  });

  test("rejects empty strings", () => {
    expect(() => requireNonEmpty("", "test")).toThrow(ClaudeError);
  });

  test("includes field name in error message", () => {
    expect(() => requireNonEmpty("", "prompt")).toThrow("prompt");
  });
});
