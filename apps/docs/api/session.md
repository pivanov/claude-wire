# Session

A session keeps a single Claude Code process alive across multiple `ask()` calls, preserving conversation context.

::: warning One-shot classifiers don't belong in a session
Sessions keep the full conversation in context -- every turn sees all prior turns. For stateless one-shot work (classifiers, extractors, routers), use `claude.askJson()` instead. See [Stateless Classifier Pattern](/guides/classifier).
:::

## Creating a Session

```ts
import { claude } from "@pivanov/claude-wire";

const session = claude.session({
  cwd: "/my/project",
  model: "sonnet",
  maxCostUsd: 1.00,
});
```

## `session.ask(prompt, options?)`

Send a message and wait for the complete response. Each call reads events until it hits a `turn_complete`, then stops - leaving the process alive for the next call.

```ts
const r1 = await session.ask("Read package.json and summarize it");
console.log(r1.text);

const r2 = await session.ask("Now add a lint script");
console.log(r2.text);
```

**Returns:** `Promise<TAskResult>` with the same shape as `claude.ask()`.

### Per-ask options (`IAskOptions`)

Pass a second argument to override session-level callbacks for a single call -- useful for request-scoped logging in daemon-style consumers:

```ts
async function handleRequest(req) {
  return session.ask(req.prompt, {
    onRetry: (attempt, error) => {
      logger.warn(`req ${req.id} retry ${attempt}`, error);
    },
    signal: AbortSignal.timeout(30_000),  // per-request timeout
  });
}
```

| Option | Type | Description |
|--------|------|-------------|
| `onRetry` | `(attempt: number, error: unknown) => void` | Per-ask retry observer. Fires alongside the session-level `onRetry` when both are set. |
| `onCostUpdate` | `(cost: TCostSnapshot) => void` | Per-ask cost observer. Fires once after `turn_complete` with the session's cumulative snapshot. Composes with the session-level `onCostUpdate`; use this for request-scoped metadata (request id, tenant, trace span). |
| `signal` | `AbortSignal` | Per-ask abort. Aborts this ask only (session stays alive). Composes with the session-level signal -- either firing aborts the ask. |

## `session.askJson(prompt, schema, options?)`

Same SDK-side validation as `claude.askJson()` but within a session. The response is parsed and validated against the schema, and the session's conversation context is preserved.

```ts
import { z } from "zod";
import { standardSchemaToJsonSchema } from "@pivanov/claude-wire";

const Files = z.object({ files: z.array(z.object({ name: z.string(), bytes: z.number() })) });
const jsonSchema = await standardSchemaToJsonSchema(Files);

const session = claude.session({ model: "sonnet", jsonSchema });

const { data } = await session.askJson(
  "What are the top 3 files by size? Return JSON: { files: { name: string, bytes: number }[] }",
  Files,
);

console.log(data.files);

await session.close();
```

Accepts the same schema inputs as `claude.askJson()` -- Standard Schema objects or raw JSON Schema strings. Throws `JsonValidationError` on parse/validation failure.

::: warning `session.askJson()` requires `jsonSchema` at session creation
The CLI's `--json-schema` flag is bound to the long-lived process spawned at session creation, so the strict-output path is only available when `jsonSchema` was set. **Calling `session.askJson()` on a session created without `jsonSchema` throws `JsonValidationError` up front** -- we don't silently fall back to prompt-forced JSON, because the API name promises strict validation.

- **One schema per session:** pass `jsonSchema: '{"type":"object",...}'` (a JSON Schema string) at session creation. Use `standardSchemaToJsonSchema()` to derive it from a Standard Schema object.
- **Many schemas:** use stateless `claude.askJson()` per call (auto-derives) or pool one session per schema.
:::

**Returns:** `Promise<IJsonResult<T>>`

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

`ask()` can reject with several error types:

- **`ProcessError`** -- the CLI exited without completing the turn (non-transient exit code, stderr attached when available).
- **`AbortError`** -- an `AbortSignal` fired during the turn.
- **`BudgetExceededError`** -- `maxCostUsd` was exceeded. The session is marked closed.
- **`KnownError("retry-exhausted")`** -- auto-respawn budget was used up by consecutive transient failures. The session is marked closed.
- **`ClaudeError("Session is closed")`** -- a prior fatal error already closed the session, or `close()` was called.

Only `KnownError` and `BudgetExceededError` close the session. All other errors leave it usable; the caller may decide whether to retry at a higher level.

## Resilience -- Auto-Respawn

Transient failures (SIGKILL/SIGTERM/SIGPIPE, `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `ENETUNREACH`, `EHOSTUNREACH`, Anthropic `overloaded_error`, broken pipes, etc. -- see [`isTransientError`](./errors.md#istransienterrorerror)) trigger an automatic respawn inside a single `ask()` call.

- **Budget:** up to `LIMITS.maxRespawnAttempts` (currently `3`) respawns per `ask()`.
- **Backoff:** `500ms → 1s → 2s` between retries.
- **Cost preservation:** a cost offset is snapshotted before each respawn so cumulative totals and `maxCostUsd` enforcement survive the new process.
- **Budget exhaustion:** when the cap is reached the session throws `KnownError("retry-exhausted")` and closes itself.
- **Reset on success:** `consecutiveCrashes` resets to `0` after any turn that completes.

### Observing retries

Pass `onRetry` to see every respawn in progress (does not affect retry behavior):

```ts
const session = claude.session({
  model: "sonnet",
  maxCostUsd: 1.00,
  onRetry: (attempt, error) => {
    console.warn(`respawn ${attempt}:`, error);
  },
});
```

Use `onWarning` from `IClaudeOptions` to route library-emitted warnings (user callback threw, invalid tool decision, etc.) through your telemetry instead of the default `console.warn`.

## Turn Limits

After 100 turns, the session pre-emptively kills and respawns the process to prevent context window overflow. This is transparent to the caller -- the next `ask()` spawns a fresh process and resumes by `sessionId` when one is known.

Pass `onRecycle` on `ISessionOptions` to observe the transition (emit metrics, warm a replacement pool, log the event):

```ts
const session = claude.session({
  onRecycle: (reason) => {
    metrics.increment("claude_wire.session.recycle", { reason });
  },
});
```

Today only `"turn-limit"` is emitted; the type is widened with `(string & {})` so future reasons (e.g. budget-triggered respawn) can be added without a breaking change.

## AbortSignal Support

Sessions respect the `signal` option from `IClaudeOptions`:

```ts
const session = claude.session({ signal: AbortSignal.timeout(60_000) });
```

## Timeouts and Inactivity Watchdog

Each read operation has a configurable inactivity timeout, defaulting to `TIMEOUTS.defaultAbortMs` (5 minutes). If no data arrives within this window the SDK throws `AgentInactivityError`, kills the process, and surfaces the error to the caller. The timer resets on every stdout chunk, so a turn that keeps streaming data can run indefinitely.

```ts
const session = claude.session({
  model: "sonnet",
  inactivityTimeoutMs: 30_000,  // fail fast in production paths
});

// Disable the watchdog for batch jobs that may legitimately stall:
const longRunning = claude.session({ inactivityTimeoutMs: Infinity });
```

`AgentInactivityError` extends `TimeoutError`, so existing `instanceof TimeoutError` catches still fire. See [Errors](./errors.md#agentinactivityerror) for the full type signature.
