# Errors

All errors extend `ClaudeError`, which extends the native `Error`. You can catch them specifically or broadly.

## `_tag` Discriminants

Every error class carries a `_tag` literal so consumers can pattern-match without `instanceof`:

```ts
import type { TClaudeErrorTag } from "@pivanov/claude-wire";

try {
  await claude.ask("...");
} catch (error) {
  if (!(error instanceof Error)) throw error;
  switch ((error as { _tag?: TClaudeErrorTag })._tag) {
    case "AgentInactivityError": /* handle hung process */ break;
    case "BudgetExceededError":  /* handle budget */ break;
    case "AbortError":           /* handle cancel */ break;
    case "ProcessError":         /* handle exit */ break;
    case "KnownError":           /* handle classified */ break;
    default:                     /* fall through */
  }
}
```

The full union is `"ClaudeError" | "BudgetExceededError" | "AbortError" | "TimeoutError" | "AgentInactivityError" | "ProcessError" | "KnownError"`.

`instanceof` checks still work and remain the recommended pattern for most code; `_tag` is for places where you want exhaustive `switch` coverage or are comparing across realms (e.g. structured-clone boundaries) where `instanceof` is unreliable.

## `ClaudeError`

Base error class for all claude-wire errors.

```ts
import { ClaudeError } from "@pivanov/claude-wire";

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
import { BudgetExceededError } from "@pivanov/claude-wire";

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
import { AbortError } from "@pivanov/claude-wire";

try {
  await claude.ask("...", { signal: AbortSignal.timeout(5000) });
} catch (error) {
  if (error instanceof AbortError) {
    console.error("Request was cancelled");
  }
}
```

## `TimeoutError`

Thrown when an operation times out. Distinct from `AbortError` for cases where the SDK itself enforces a timeout. Parent class of `AgentInactivityError`, so `instanceof TimeoutError` catches both.

## `AgentInactivityError`

Thrown by the SDK's inactivity watchdog when the CLI goes silent past `inactivityTimeoutMs` (default `TIMEOUTS.defaultAbortMs`, 5 minutes). The watchdog timer resets on every stdout chunk, so a chatty stream stays alive indefinitely.

```ts
import { AgentInactivityError } from "@pivanov/claude-wire";

try {
  await claude.ask("...", { inactivityTimeoutMs: 30_000 });
} catch (error) {
  if (error instanceof AgentInactivityError) {
    console.error(`Agent silent for ${error.inactivityMs}ms, killed`);
  }
}
```

**Properties:**
- `inactivityMs: number` -- the configured timeout that fired.

Extends `TimeoutError`, so legacy `instanceof TimeoutError` checks keep working. Pass `Infinity` to disable the watchdog entirely.

## `ProcessError`

Thrown when the Claude Code process exits with a non-zero exit code or fails to spawn.

```ts
import { ProcessError } from "@pivanov/claude-wire";

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
import { KnownError, isKnownError } from "@pivanov/claude-wire";

try {
  await claude.ask("...");
} catch (error) {
  if (isKnownError(error)) {
    console.error(`Known error [${error.code}]: ${error.message}`);
  }
}
```

**Properties:**
- `code: TKnownErrorCode` - one of: `"not-authenticated"`, `"binary-not-found"`, `"permission-denied"`, `"retry-exhausted"`, `"invalid-options"`, `"rate-limit"`, `"overloaded"`, `"context-length-exceeded"`, `"invalid-json-schema"`, `"mcp-error"`

The last five codes are auto-classified from stderr by `classifyStderr()` -- when a `ProcessError` is about to be thrown and stderr matches a known pattern, it is promoted to a `KnownError` with the appropriate code instead.

The `retry-exhausted` code is thrown by `session.ask()` when the respawn budget (`LIMITS.maxRespawnAttempts`, currently 3) has been used up by consecutive transient failures. The session is marked closed and any further `ask()` call rejects with `ClaudeError("Session is closed")`.

The `invalid-options` code is thrown synchronously by `spawnClaude()` when caller options conflict -- currently when both `resume` and `continueSession` are set. No process is spawned; the error surfaces before any CLI work happens.

```ts
import { isKnownError } from "@pivanov/claude-wire";

try {
  await session.ask("...");
} catch (error) {
  if (isKnownError(error) && error.code === "retry-exhausted") {
    // Session is dead -- create a new one before calling ask() again.
  }
}
```

## `classifyStderr(stderr, exitCode?)`

Attempts to classify an opaque stderr string into a typed `TKnownErrorCode`. Returns `undefined` when no pattern matches.

```ts
import { classifyStderr } from "@pivanov/claude-wire";

const code = classifyStderr("Error: rate limit exceeded (429)");
console.log(code); // "rate-limit"

const unknown = classifyStderr("something unexpected");
console.log(unknown); // undefined
```

Recognized patterns:

| Code | Matches |
|------|---------|
| `rate-limit` | `rate[_ -]?limit`, `429`, `too many requests` |
| `overloaded` | `overloaded`, `529`, `temporarily unavailable` |
| `context-length-exceeded` | `context[_ -]?length`, `context[_ -]?window`, `too long`, `maximum.*tokens` |
| `invalid-json-schema` | `invalid.*json[_ -]?schema`, `schema.*invalid`, `json.*schema.*error` |
| `mcp-error` | `mcp.*error`, `mcp.*fail`, `mcp.*server` |
| `not-authenticated` | `not authenticated`, `authentication failed`, `invalid api key`, `unauthorized`, `\b401\b` |
| `permission-denied` | `permission denied`, `forbidden`, `403` |
| `binary-not-found` | `binary.*not found`, `command not found`, `ENOENT.*claude` |

This function is wired into the error factory at module load -- `ProcessError` instances are automatically promoted to `KnownError` when stderr matches. You typically don't need to call it directly unless you're doing custom stderr analysis.

## `JsonValidationError`

Thrown by `askJson()` when the response cannot be parsed as valid JSON or fails schema validation.

```ts
import { JsonValidationError } from "@pivanov/claude-wire";

try {
  await claude.askJson("...", schema);
} catch (error) {
  if (error instanceof JsonValidationError) {
    console.error("Raw text:", error.rawText);
    console.error("Issues:", error.issues);
  }
}
```

**Properties:**
- `rawText: string` -- the raw text that failed to parse or validate
- `issues: ReadonlyArray<{ message?: string; path?: ReadonlyArray<string | number> }>` -- validation issues from the schema library

## `isTransientError(error)`

Detects transient errors that may succeed on retry (network issues, signal kills). Returns `false` for `AbortError` and `BudgetExceededError` (those are intentional, not transient). `createSession()` uses this classifier internally to decide which failures trigger auto-respawn.

```ts
import { isTransientError } from "@pivanov/claude-wire";

if (isTransientError(error)) {
  // safe to retry
}
```

Detection works differently depending on error type:

- **`ProcessError`** -- only the exit code is checked against `137` (SIGKILL/OOM), `141` (SIGPIPE), `143` (SIGTERM). The error message is not tested.
- **All other errors** -- only the message is tested against these patterns: `ECONNREFUSED`, `ECONNRESET`, `ECONNABORTED`, `ETIMEDOUT`, `ENETUNREACH`, `EHOSTUNREACH`, `EAI_AGAIN`, `network error`, `network timeout`, `fetch failed`, `socket hang up`, `EPIPE`, `SIGPIPE`, `broken pipe`, `overloaded_error`.
- **Never transient:** `AbortError`, `BudgetExceededError`.
