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

::: tip Test mode
`maxCostUsd: 0` is valid and means "disallow any spend" -- the first turn that reports any cost will throw `BudgetExceededError`. Useful for integration tests that should never hit the API.
:::

## Cost Callbacks

Track spending in real time with `onCostUpdate`:

```ts
const result = await claude.ask("Complex task", {
  onCostUpdate: (cost) => {
    console.log(`$${cost.totalUsd.toFixed(4)} spent`);
    console.log(`${cost.tokens.input} input, ${cost.tokens.output} output tokens`);
  },
});
```

The callback fires after each `turn_complete` event.

## `TCostSnapshot`

```ts
type TCostSnapshot = {
  totalUsd: number;
  tokens: {
    input: number;            // total input tokens (base + cache read + cache creation)
    output: number;
    cacheRead?: number;       // tokens read from prompt cache (~10% billing rate)
    cacheCreation?: number;   // tokens written to prompt cache (~125% billing rate)
  };
};
```

The cost tracker uses assignment semantics, not accumulation. All values come from the wire protocol as running totals -- the cost tracker stores the latest snapshot. `totalUsd` is assigned from Claude Code's `total_cost_usd`, and token counts are assigned from the cumulative values reported by the wire protocol.

`cacheRead` and `cacheCreation` are present when the CLI reports prompt cache data. Use `cacheRead` to verify that prompt caching is working -- if it's non-zero, your system prompt is being served from cache.

In sessions, cost survives process respawns via an internal offset mechanism.

## Handling Budget Errors

```ts
import { claude, BudgetExceededError } from "@pivanov/claude-wire";

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
import { createCostTracker } from "@pivanov/claude-wire";

const tracker = createCostTracker({
  maxCostUsd: 1.00,
  onCostUpdate: (snap) => console.log(snap),
});

tracker.update(0.05, 1000, 50);           // totalCostUsd, totalInputTokens, totalOutputTokens
tracker.update(0.08, 2000, 100, 500, 0); // ...optional cacheReadTokens, cacheCreationTokens
tracker.checkBudget();                     // throws if over limit
console.log(tracker.snapshot());           // { totalUsd, tokens: { input, output, cacheRead?, cacheCreation? } }
tracker.reset();                    // zero everything
```

## Budget Projection

The cost tracker exposes raw primitives for caller-side budget projection. No trend analysis or EMA -- the SDK provides the inputs and the caller owns the math.

```ts
const tracker = createCostTracker({ maxCostUsd: 5.00 });

// After several turns...
console.log(tracker.turnCount);       // number of turns processed
console.log(tracker.averagePerTurn);  // totalUsd / turnCount

// Project future spend based on average cost per turn
const projection = tracker.project(10);  // 10 more turns
console.log(projection.projectedUsd);    // totalUsd + (averagePerTurn * 10)
```

These are also available on the `ICostTracker` interface:

| Property | Type | Description |
|----------|------|-------------|
| `turnCount` | `number` | Number of turns processed so far |
| `averagePerTurn` | `number` | `totalUsd / turnCount` (0 if no turns) |
| `project(remainingTurns)` | `(n: number) => { projectedUsd: number }` | Current spend plus projected spend for `n` more turns |
