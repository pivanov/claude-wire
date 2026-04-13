import { BudgetExceededError, claude } from "claude-wire";
import { answer, cyan, divider, gap, green, info, label, prompt, stats, warn } from "./format.js";
import { createSpinner } from "./spinner.js";

export const meta = {
  name: "Cost budget",
  description: "Set a spending limit with real-time cost tracking",
};

const PROMPT = "List 5 interesting facts about TypeScript.";
const BUDGET = 0.5;

export const run = async () => {
  gap();
  label("Model", "haiku");
  label("Budget", `$${BUDGET.toFixed(2)}`);
  label("Options", "model=haiku");
  divider();
  prompt(PROMPT);

  const spinner = createSpinner("Waiting for Claude...");
  spinner.start();

  try {
    const r = await claude.ask(PROMPT, {
      model: "haiku",
      maxCostUsd: BUDGET,
      onCostUpdate: (cost) => {
        spinner.stop();
        const pct = Math.min(cost.totalUsd / BUDGET, 1);
        const filled = Math.floor(pct * 20);
        const bar = `${green("\u2588".repeat(filled))}${"\u2591".repeat(20 - filled)}`;
        console.log(`  ${cyan("budget")} [${bar}] $${cost.totalUsd.toFixed(4)} / $${BUDGET.toFixed(2)}`);
      },
    });

    answer(r.text);
    gap();
    stats(r);
  } catch (error) {
    spinner.stop();
    if (error instanceof BudgetExceededError) {
      gap();
      warn(`Budget exceeded! Spent $${error.spent.toFixed(4)} of $${error.budget.toFixed(4)} limit.`);
    } else {
      throw error;
    }
  }

  divider();
  info("Code: claude.ask(prompt, { maxCostUsd: 0.50, onCostUpdate })");
};

if (import.meta.main) {
  run();
}
