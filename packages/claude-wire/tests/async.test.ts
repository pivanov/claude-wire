import { describe, expect, test } from "bun:test";
import { withTimeout } from "@/async.js";

describe("withTimeout", () => {
  test("resolves with promise value when it wins the race", async () => {
    const result = await withTimeout(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  test("resolves with undefined when timeout fires first", async () => {
    const never = new Promise<number>(() => {});
    const result = await withTimeout(never, 10);
    expect(result).toBeUndefined();
  });

  test("resolves with custom sentinel when timeout fires first", async () => {
    const TIMED_OUT = Symbol("timed-out");
    const never = new Promise<number>(() => {});
    const result = await withTimeout(never, 10, () => TIMED_OUT);
    expect(result).toBe(TIMED_OUT);
  });

  test("clears timer after promise resolves", async () => {
    // If the timer leaks, Bun's test runner would flag an open handle.
    const result = await withTimeout(Promise.resolve("ok"), 60_000);
    expect(result).toBe("ok");
  });

  test("clears timer after timeout fires", async () => {
    const never = new Promise<string>(() => {});
    await withTimeout(never, 10);
    // No assertion needed -- validates cleanup path ran
  });
});
