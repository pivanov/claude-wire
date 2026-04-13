# Cost Tracking

Monitor and limit API spending per request or session.

## Budget Limits

Set `maxCostUsd` to automatically abort when spending exceeds the limit:

```ts
const result = await claude.ask("Analyze this monorepo", {
  maxCostUsd: 0.50,
});
```

If the budget is exceeded, a `BudgetExceededError` is thrown and the process is killed.

## Cost Callbacks

Track spending in real time with `onCostUpdate`:

```ts
const result = await claude.ask("Complex task", {
  onCostUpdate: (cost) => {
    console.log(`$${cost.totalUsd.toFixed(4)} spent`);
    console.log(`${cost.inputTokens} input, ${cost.outputTokens} output tokens`);
  },
});
```

The callback fires after each `turn_complete` event.

## `TCostSnapshot`

```ts
type TCostSnapshot = {
  totalUsd: number;       // assigned from wire protocol's cumulative total_cost_usd
  inputTokens: number;    // assigned from wire protocol's cumulative token counts
  outputTokens: number;   // assigned from wire protocol's cumulative token counts
};
```

The cost tracker uses assignment semantics, not accumulation. All values come from the wire protocol as running totals - the cost tracker stores the latest snapshot. `totalUsd` is assigned from Claude Code's `total_cost_usd`, and token counts are assigned from the cumulative values reported by the wire protocol.

In sessions, cost survives process respawns via an internal offset mechanism.

## Handling Budget Errors

```ts
import { claude, BudgetExceededError } from "claude-wire";

try {
  await claude.ask("...", { maxCostUsd: 0.10 });
} catch (error) {
  if (error instanceof BudgetExceededError) {
    console.log(`Spent: $${error.spent.toFixed(4)}`);
    console.log(`Budget: $${error.budget.toFixed(4)}`);
  }
}
```

## Dual Budget System

claude-wire offers two independent budget mechanisms:

- `maxCostUsd` - SDK-level enforcement. Checked after each `turn_complete` event. Throws `BudgetExceededError` and kills the process when exceeded.
- `maxBudgetUsd` - CLI-level enforcement. Passed as `--max-budget-usd` flag to Claude Code, which enforces the limit itself.

They operate independently and can be used together for layered budget control.

## Advanced: `createCostTracker()`

For custom cost tracking logic, use the tracker directly:

```ts
import { createCostTracker } from "claude-wire";

const tracker = createCostTracker({
  maxCostUsd: 1.00,
  onCostUpdate: (snap) => console.log(snap),
});

tracker.update(0.05, 1000, 50);   // costUsd, inputTokens, outputTokens
tracker.checkBudget();              // throws if over limit
console.log(tracker.snapshot());    // { totalUsd, inputTokens, outputTokens }
tracker.reset();                    // zero everything
```
