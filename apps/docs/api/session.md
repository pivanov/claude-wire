# Session

A session keeps a single Claude Code process alive across multiple `ask()` calls, preserving conversation context.

## Creating a Session

```ts
import { claude } from "@pivanov/claude-wire";

const session = claude.session({
  cwd: "/my/project",
  model: "sonnet",
  maxCostUsd: 1.00,
});
```

## `session.ask(prompt)`

Send a message and wait for the complete response. Each call reads events until it hits a `turn_complete`, then stops - leaving the process alive for the next call.

```ts
const r1 = await session.ask("Read package.json and summarize it");
console.log(r1.text);

const r2 = await session.ask("Now add a lint script");
console.log(r2.text);
```

**Returns:** `Promise<TAskResult>` with the same shape as `claude.ask()`.

## `session.close()`

Kill the underlying process and release resources. Always call this when done.

```ts
try {
  const r1 = await session.ask("First question");
  const r2 = await session.ask("Follow-up");
} finally {
  await session.close();
}
```

## `session.sessionId`

The session ID assigned by Claude Code after the first turn. Available after the first `ask()` call.

```ts
const r1 = await session.ask("Hello");
console.log(session.sessionId); // "sess-abc123..."
```

## Cost Accumulation

Cost tracks across all turns in the session. The `costUsd` in each `TAskResult` reflects the cumulative total, and `tokens` accumulate:

```ts
const r1 = await session.ask("First question");
console.log(r1.costUsd);  // 0.003

const r2 = await session.ask("Second question");
console.log(r2.costUsd);  // 0.007 (cumulative)
```

If `maxCostUsd` is set, a `BudgetExceededError` is thrown when the budget is exceeded, and the process is killed.

## Error Handling

If the Claude process exits unexpectedly, `ask()` throws a `ProcessError`. If the process is killed via `close()`, subsequent `ask()` calls throw a `ClaudeError`.

## Resilience - Auto-Respawn

If the Claude process crashes mid-session, the session automatically respawns (up to 3 attempts). The consecutive crash count resets on each successful turn. Cost tracking survives respawns - a cost offset is preserved before each respawn so budget enforcement remains accurate.

## Turn Limits

After 100 turns, the session pre-emptively kills and respawns the process to prevent context window overflow. This is transparent to the caller.

## AbortSignal Support

Sessions respect the `signal` option from `IClaudeOptions`:

```ts
const session = claude.session({ signal: AbortSignal.timeout(60_000) });
```

## Timeouts

Each read operation has a 5-minute inactivity timeout (`TIMEOUTS.defaultAbortMs`). If no data is received within this window, a `TimeoutError` is thrown. The timeout resets on every chunk, so a turn that keeps streaming data can run indefinitely.
