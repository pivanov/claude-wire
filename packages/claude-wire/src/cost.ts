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
  update: (totalCostUsd: number, totalInputTokens: number, totalOutputTokens: number, cacheReadTokens?: number, cacheCreationTokens?: number) => void;
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
  let cacheRead = 0;
  let cacheCreation = 0;
  let turns = 0;

  const snapshot = (): TCostSnapshot => ({
    totalUsd,
    tokensIn: input,
    tokensOut: output,
    tokensCacheRead: cacheRead,
    tokensCacheCreation: cacheCreation,
  });

  const update = (totalCostUsd: number, totalInputToks: number, totalOutputToks: number, cacheReadToks?: number, cacheCreationToks?: number) => {
    totalUsd = totalCostUsd;
    input = totalInputToks;
    output = totalOutputToks;
    // Preserve last-known cache values when the turn doesn't report them
    // (e.g. the CLI omits modelUsage). Keeping the previous value avoids
    // showing 0 for a metric the consumer has already been shown.
    if (cacheReadToks !== undefined) {
      cacheRead = cacheReadToks;
    }
    if (cacheCreationToks !== undefined) {
      cacheCreation = cacheCreationToks;
    }
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
    cacheRead = 0;
    cacheCreation = 0;
    turns = 0;
  };

  const avg = () => (turns > 0 ? totalUsd / turns : 0);

  const project = (remainingTurns: number): ICostProjection => ({
    projectedUsd: totalUsd + avg() * remainingTurns,
  });

  return {
    update,
    snapshot,
    checkBudget,
    reset,
    get turnCount() {
      return turns;
    },
    get averagePerTurn() {
      return avg();
    },
    project,
  };
};
