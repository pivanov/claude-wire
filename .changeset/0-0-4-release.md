---
"@pivanov/claude-wire": patch
---

**New APIs**

- `IClaudeOptions.onWarning(message, cause?)` -- route all library `console.warn` calls through your hook, or silence with `() => {}`.
- `ISessionOptions.onRetry(attempt, error)` -- observe transient respawns inside `ask()`.
- `session.ask(prompt, options?)` -- per-ask `IAskOptions` with `onRetry` (request-scoped correlation) and `signal` (per-ask abort without killing the session). Both compose with session-level equivalents.
- `KnownError("retry-exhausted")` -- typed error when the respawn budget (3 attempts) is used up. Consumers can `isKnownError(err) && err.code === "retry-exhausted"` instead of string-matching.
- `writer.toolResult(id, content, { isError? })` + `TToolDecision` extended to `{ result, isError? }` so `onToolUse` handlers can flag tool-side errors the model should react to.
- Exported `TBuiltInToolName`, `TToolName`, `IAskOptions`, `TKnownErrorCode`, `KNOWN_ERROR_CODES`.
- `allowedTools`/`disallowedTools` and `IToolHandler.allowed`/`blocked` accept `TToolName` for IDE completion while still allowing arbitrary strings.
- `settingSources` narrowed to known CLI values with `(string & {})` escape hatch.

**Fixes**

- Retry budget now spans a full `ask()` (up to 3 respawns with 500ms/1s/2s backoff; was 1 retry).
- Session awaits process exit code on no-turn-complete so SIGKILL (137), SIGPIPE (141), SIGTERM (143) classify as transient and trigger auto-retry.
- Lazy spawn in `createStream` -- no leaked child process when the stream is created but never iterated.
- `cleanup()` always kills proc (was a no-op once the iterator was requested but never ticked).
- `spawnClaude` abort-signal race closed: listener registered before the `aborted` re-check.
- `AbortSignal` now interrupts a pending `reader.read()` even without a live process reference.
- Single resettable read timeout (was a fresh `Promise` + `setTimeout` per iteration).
- `close()` bounds `await inFlight` to `gracefulExitMs` so a stuck read can't hang it.
- Fatal errors (`KnownError`, `BudgetExceededError`) mark the session closed; subsequent `ask()` rejects with `ClaudeError("Session is closed")`.
- `TRANSIENT_PATTERN` extended: `ECONNABORTED`, `ENETUNREACH`, `EHOSTUNREACH`, `socket hang up`, Anthropic `overloaded_error`.
- `ALIAS_PATTERN` captures nested config paths and skips commented-out rc lines.
- Env priority fixed: `process.env < alias < options.env < options.configDir`.
- Node runtime: replaced manual `nodeReadableToWeb` with `Readable.toWeb()`; throw `ProcessError` if pid is undefined; stdin writes throw on destroyed stream.
- `extractTokens` takes `max(contextWindow)` across model entries (was last-wins).
- `TModelUsageEntry.contextWindow` now optional (matches wire protocol reality).
- `extractContent` type guard verifies `text` is a string.
- Drop `tool_use` events missing a `name` (were bypassing allow/block lists).
- `maxCostUsd: 0` is now valid ("disallow any spend" test mode).

**Breaking (acceptable in 0.0.x)**

- `resetBinaryCache` renamed to `resetResolvedEnvCache`.
- `KNOWN_ERROR_CODES` drops `"session-expired"` and `"invalid-model"` (never actually thrown).
- `assertPositiveNumber` / `requireNonEmpty` removed from public exports (internal).

**Internal**

- New modules: `async.ts` (`withTimeout`), `validation.ts`, `warnings.ts` (`createWarn`).
- Shared helpers: `startPipeline`, `applyTurnComplete`, `processExitedEarly`, `safeKill`, `safeWrite`, `buildSpawnEnv`, `composeSignals`, `fireRetry`, `processRaw`, `IStderrDrain.text()`.
- `MAX_BACKOFF_INDEX` co-located with `RESPAWN_BACKOFF_MS` in `constants.ts`.
- Full retry-contract JSDoc on `createSession`.
- 192 tests (+45 new). knip clean. Zero em dashes.

**Docs**

- Session: per-ask options section, rewritten retry/error-handling sections.
- Errors: updated `KNOWN_ERROR_CODES` list and `isTransientError` match reference.
- Client: `onWarning`, `onRetry`, `IAskOptions` tables.
- Tool handling: `{ result, isError }` example.
- Cost tracking: `maxCostUsd: 0` test-mode tip.
- README: POSIX-only platform note, test count updated to 192.
