import { BudgetExceededError } from "./errors.js";
import type { TCostSnapshot } from "./types/results.js";
import { assertPositiveNumber } from "./validation.js";
import type { TWarn } from "./warnings.js";
import { createWarn } from "./warnings.js";

export interface ICostTracker {
  // All values are REPLACEMENTS, not deltas. The wire protocol's total_cost_usd
  // is already cumulative. Session.ts handles offsets when respawning processes.
  update: (totalCostUsd: number, totalInputTokens: number, totalOutputTokens: number) => void;
  snapshot: () => TCostSnapshot;
  checkBudget: () => void;
  reset: () => void;
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
  let inputTokens = 0;
  let outputTokens = 0;

  const snapshot = (): TCostSnapshot => ({
    totalUsd,
    inputTokens,
    outputTokens,
  });

  const update = (totalCostUsd: number, totalInputToks: number, totalOutputToks: number) => {
    totalUsd = totalCostUsd;
    inputTokens = totalInputToks;
    outputTokens = totalOutputToks;

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
    inputTokens = 0;
    outputTokens = 0;
  };

  return { update, snapshot, checkBudget, reset };
};
