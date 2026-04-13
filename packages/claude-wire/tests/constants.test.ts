import { describe, expect, test } from "bun:test";
import { BINARY, LIMITS, TIMEOUTS } from "@/constants.js";

describe("TIMEOUTS", () => {
  test("all values are positive numbers", () => {
    for (const [, value] of Object.entries(TIMEOUTS)) {
      expect(typeof value).toBe("number");
      expect(value).toBeGreaterThan(0);
    }
  });
});

describe("LIMITS", () => {
  test("all values are positive numbers", () => {
    for (const [, value] of Object.entries(LIMITS)) {
      expect(typeof value).toBe("number");
      expect(value).toBeGreaterThan(0);
    }
  });
});

describe("BINARY", () => {
  test("name is 'claude'", () => {
    expect(BINARY.name).toBe("claude");
  });

  test("commonPaths is a non-empty array of strings", () => {
    expect(BINARY.commonPaths.length).toBeGreaterThan(0);
    for (const p of BINARY.commonPaths) {
      expect(typeof p).toBe("string");
    }
  });
});
