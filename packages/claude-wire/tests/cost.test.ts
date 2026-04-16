import { describe, expect, test } from "bun:test";
import { createCostTracker } from "@/cost.js";
import { BudgetExceededError } from "@/errors.js";

describe("createCostTracker", () => {
  test("starts with zero costs", () => {
    const tracker = createCostTracker();
    expect(tracker.snapshot()).toEqual({ totalUsd: 0, tokens: { input: 0, output: 0 } });
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
    expect(snap.tokens.input).toBe(2000);
    expect(snap.tokens.output).toBe(100);
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

  test("reset zeroes all costs and turnCount", () => {
    const tracker = createCostTracker();
    tracker.update(0.05, 3000, 100);
    tracker.reset();
    expect(tracker.snapshot()).toEqual({ totalUsd: 0, tokens: { input: 0, output: 0 } });
    expect(tracker.turnCount).toBe(0);
  });

  test("turnCount increments on each update", () => {
    const tracker = createCostTracker();
    expect(tracker.turnCount).toBe(0);
    tracker.update(0.01, 100, 10);
    expect(tracker.turnCount).toBe(1);
    tracker.update(0.02, 200, 20);
    expect(tracker.turnCount).toBe(2);
  });

  test("averagePerTurn returns 0 before any updates", () => {
    const tracker = createCostTracker();
    expect(tracker.averagePerTurn).toBe(0);
  });

  test("averagePerTurn is totalUsd / turnCount", () => {
    const tracker = createCostTracker();
    tracker.update(0.10, 100, 10);
    tracker.update(0.30, 200, 20);
    expect(tracker.averagePerTurn).toBeCloseTo(0.15);
  });

  test("project estimates remaining spend", () => {
    const tracker = createCostTracker();
    tracker.update(0.10, 100, 10);
    tracker.update(0.20, 200, 20);
    // avg = 0.10, project 5 more turns = 0.20 + 0.10 * 5 = 0.70
    const p = tracker.project(5);
    expect(p.projectedUsd).toBeCloseTo(0.70);
  });

  test("project returns current total when 0 remaining turns", () => {
    const tracker = createCostTracker();
    tracker.update(0.50, 100, 10);
    expect(tracker.project(0).projectedUsd).toBe(0.50);
  });

  test("project returns 0 when no turns have happened", () => {
    const tracker = createCostTracker();
    expect(tracker.project(10).projectedUsd).toBe(0);
  });
});
