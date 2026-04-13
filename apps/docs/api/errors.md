# Errors

All errors extend `ClaudeError`, which extends the native `Error`. You can catch them specifically or broadly.

## `ClaudeError`

Base error class for all claude-wire errors.

```ts
import { ClaudeError } from "claude-wire";

try {
  await claude.ask("...");
} catch (error) {
  if (error instanceof ClaudeError) {
    console.error("claude-wire error:", error.message);
  }
}
```

## `BudgetExceededError`

Thrown when `maxCostUsd` is set and the cumulative cost exceeds the budget. The process is automatically killed.

```ts
import { BudgetExceededError } from "claude-wire";

try {
  await claude.ask("...", { maxCostUsd: 0.10 });
} catch (error) {
  if (error instanceof BudgetExceededError) {
    console.error(`Spent $${error.spent.toFixed(4)} of $${error.budget.toFixed(4)} limit`);
  }
}
```

**Properties:**
- `spent: number` - amount spent in USD
- `budget: number` - the limit that was exceeded

## `AbortError`

Thrown when the operation is cancelled via an `AbortSignal`.

```ts
import { AbortError } from "claude-wire";

try {
  await claude.ask("...", { signal: AbortSignal.timeout(5000) });
} catch (error) {
  if (error instanceof AbortError) {
    console.error("Request was cancelled");
  }
}
```

## `TimeoutError`

Thrown when an operation times out. Distinct from `AbortError` for cases where the SDK itself enforces a timeout.

## `ProcessError`

Thrown when the Claude Code process exits with a non-zero exit code or fails to spawn.

```ts
import { ProcessError } from "claude-wire";

try {
  await claude.ask("...");
} catch (error) {
  if (error instanceof ProcessError) {
    console.error(`Process exited with code ${error.exitCode}`);
  }
}
```

**Properties:**
- `exitCode?: number` - the process exit code, if available

## `KnownError`

For expected, user-facing errors with a machine-readable code. Extends `ClaudeError`.

```ts
import { KnownError, isKnownError } from "claude-wire";

try {
  await claude.ask("...");
} catch (error) {
  if (isKnownError(error)) {
    console.error(`Known error [${error.code}]: ${error.message}`);
  }
}
```

**Properties:**
- `code` - one of: `"not-authenticated"`, `"binary-not-found"`, `"session-expired"`, `"permission-denied"`, `"invalid-model"`

## `isTransientError(error)`

Detects transient errors that may succeed on retry (network issues, signal kills). Returns `false` for `AbortError` and `BudgetExceededError` (those are intentional, not transient).

```ts
import { isTransientError } from "claude-wire";

if (isTransientError(error)) {
  // safe to retry
}
```

Matches: `ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`, `EPIPE`, broken pipe, `ProcessError` with exit codes 137/139/143.
