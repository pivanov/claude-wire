import { describe, expect, spyOn, test } from "bun:test";
import { createWarn } from "@/warnings.js";

describe("createWarn", () => {
  test("defaults to console.warn with prefix", () => {
    const spy = spyOn(console, "warn").mockImplementation(() => {});
    const warn = createWarn();
    warn("test message");
    expect(spy).toHaveBeenCalledWith("[claude-wire] test message");
    spy.mockRestore();
  });

  test("passes cause to console.warn when provided", () => {
    const spy = spyOn(console, "warn").mockImplementation(() => {});
    const warn = createWarn();
    const err = new Error("boom");
    warn("test message", err);
    expect(spy).toHaveBeenCalledWith("[claude-wire] test message", err);
    spy.mockRestore();
  });

  test("routes to custom onWarning when provided", () => {
    const calls: Array<{ message: string; cause?: unknown }> = [];
    const warn = createWarn((message, cause) => calls.push({ message, cause }));
    warn("custom warning", 42);
    expect(calls).toEqual([{ message: "custom warning", cause: 42 }]);
  });

  test("falls back to console.warn when onWarning throws", () => {
    const spy = spyOn(console, "warn").mockImplementation(() => {});
    const warn = createWarn(() => {
      throw new Error("observer exploded");
    });
    warn("should not crash");
    expect(spy).toHaveBeenCalledWith("[claude-wire] should not crash");
    spy.mockRestore();
  });
});
