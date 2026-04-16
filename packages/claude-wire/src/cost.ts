import { BudgetExceededError } from "./errors.js";
import type { TCostSnapshot } from "./types/results.js";
import { assertPositiveNumber } from "./validation.js";
import type { TWarn } from "./warnings.js";
import { createWarn } from "./warnings.js";

export interface ICostProjection {
  projectedUsd: number;
}

export interface ICostTracker {
  // All values are REPLACEMENTS, not deltas. The wire protocol's total_cost_usd
  // is already cumulative. Session.ts handles offsets when respawning processes.
  update: (totalCostUsd: number, totalInputTokens: number, totalOutputTokens: number) => void;
  snapshot: () => TCostSnapshot;
  checkBudget: () => void;
  reset: () => void;
  // Raw primitives for caller-side projection. No EMA, no trend analysis --
  // the SDK provides the inputs and the caller owns the math.
  turnCount: number;
  averagePerTurn: number;
  project: (remainingTurns: number) => ICostProjection;
}

export interface ICostTrackerOptions {
  maxCostUsd?: number;
  onCostUpdate?: (cost: TCostSnapshot) => void;
  onWarning?: TWarn;
}

export const createCostTracker = (options: ICostTrackerOptions = {}): ICostTracker => {
  assertPositiveNumber(options.maxCostUsd, "maxCostUsd");
  const warn = createWarn(options.onWarning);

  let totalUsd = 0;
  let input = 0;
  let output = 0;
  let turns = 0;

  const snapshot = (): TCostSnapshot => ({
    totalUsd,
    tokens: { input, output },
  });

  const update = (totalCostUsd: number, totalInputToks: number, totalOutputToks: number) => {
    totalUsd = totalCostUsd;
    input = totalInputToks;
    output = totalOutputToks;
    turns++;

    if (options.onCostUpdate) {
      try {
        options.onCostUpdate(snapshot());
      } catch (error) {
        warn("onCostUpdate callback threw", error);
      }
    }
  };

  const checkBudget = () => {
    if (options.maxCostUsd !== undefined && totalUsd > options.maxCostUsd) {
      throw new BudgetExceededError(totalUsd, options.maxCostUsd);
    }
  };

  const reset = () => {
    totalUsd = 0;
    input = 0;
    output = 0;
    turns = 0;
  };

  const project = (remainingTurns: number): ICostProjection => {
    const avg = turns > 0 ? totalUsd / turns : 0;
    return { projectedUsd: totalUsd + avg * remainingTurns };
  };

  return {
    update,
    snapshot,
    checkBudget,
    reset,
    get turnCount() {
      return turns;
    },
    get averagePerTurn() {
      return turns > 0 ? totalUsd / turns : 0;
    },
    project,
  };
};
