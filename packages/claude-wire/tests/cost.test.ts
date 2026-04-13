import { describe, expect, test } from "bun:test";
import { createCostTracker } from "@/cost.js";
import { BudgetExceededError } from "@/errors.js";

describe("createCostTracker", () => {
  test("starts with zero costs", () => {
    const tracker = createCostTracker();
    expect(tracker.snapshot()).toEqual({ totalUsd: 0, inputTokens: 0, outputTokens: 0 });
  });

  test("updates total cost", () => {
    const tracker = createCostTracker();
    tracker.update(0.018, 3500, 120);
    expect(tracker.snapshot().totalUsd).toBe(0.018);
  });

  test("assigns cumulative totals (not deltas)", () => {
    const tracker = createCostTracker();
    tracker.update(0.01, 1000, 50);
    tracker.update(0.02, 2000, 100);

    const snap = tracker.snapshot();
    expect(snap.totalUsd).toBe(0.02);
    expect(snap.inputTokens).toBe(2000);
    expect(snap.outputTokens).toBe(100);
  });

  test("calls onCostUpdate callback", () => {
    const updates: number[] = [];
    const tracker = createCostTracker({
      onCostUpdate: (cost) => updates.push(cost.totalUsd),
    });

    tracker.update(0.01, 1000, 50);
    tracker.update(0.02, 2000, 100);

    expect(updates).toEqual([0.01, 0.02]);
  });

  test("checkBudget throws when budget exceeded", () => {
    const tracker = createCostTracker({ maxCostUsd: 0.05 });
    tracker.update(0.06, 5000, 200);

    expect(() => tracker.checkBudget()).toThrow(BudgetExceededError);
  });

  test("checkBudget does not throw within budget", () => {
    const tracker = createCostTracker({ maxCostUsd: 0.10 });
    tracker.update(0.05, 3000, 100);

    expect(() => tracker.checkBudget()).not.toThrow();
  });

  test("checkBudget is no-op without maxCostUsd", () => {
    const tracker = createCostTracker();
    tracker.update(999, 0, 0);
    expect(() => tracker.checkBudget()).not.toThrow();
  });

  test("reset zeroes all costs", () => {
    const tracker = createCostTracker();
    tracker.update(0.05, 3000, 100);
    tracker.reset();
    expect(tracker.snapshot()).toEqual({ totalUsd: 0, inputTokens: 0, outputTokens: 0 });
  });
});
