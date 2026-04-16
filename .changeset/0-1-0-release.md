---
"@pivanov/claude-wire": minor
---

**Breaking changes**

- `tools` option renamed to `toolHandler` -- disambiguates from CLI-level `allowedTools`/`disallowedTools`.
- `TToolUseEvent.input` is now `unknown` instead of a pre-serialized `string`. Consumers get structured data directly; use `JSON.stringify(event.input)` if you need the string form.
- `TCostSnapshot` shape unified with `TAskResult.tokens`: `{ totalUsd, tokens: { input, output } }` replaces `{ totalUsd, inputTokens, outputTokens }`.
- `assertPositiveNumber` / `requireNonEmpty` removed from public exports (internal).
- `resetBinaryCache` renamed to `resetResolvedEnvCache`.
- `KNOWN_ERROR_CODES` drops `"session-expired"` and `"invalid-model"` (never actually thrown).

**New features**

- `claude.askJson(prompt, schema)` / `session.askJson(prompt, schema, options?)` -- parse and validate Claude's response as typed JSON. Accepts Standard Schema objects (Zod, Valibot, ArkType) for full type inference, or raw JSON Schema strings forwarded to `--json-schema`. Returns `{ data: T, raw: TAskResult }`. Throws `JsonValidationError` with `{ rawText, issues }` on failure. Strips markdown fences automatically.
- Structured stderr parsing -- `classifyStderr(stderr, exitCode?)` auto-promotes `ProcessError` to `KnownError` with typed codes: `rate-limit`, `overloaded`, `context-length-exceeded`, `invalid-json-schema`, `mcp-error`.
- Budget projection primitives on `ICostTracker`: `turnCount`, `averagePerTurn`, `project(remainingTurns) => { projectedUsd }`.
- `IClaudeOptions.onWarning(message, cause?)` -- route all library `console.warn` calls through your hook.
- `ISessionOptions.onRetry(attempt, error)` -- observe transient respawns.
- `session.ask(prompt, options?)` -- per-ask `IAskOptions` with `onRetry` (request-scoped correlation) and `signal` (per-ask abort without killing the session).
- `KnownError("retry-exhausted")` -- typed error when the respawn budget is used up.
- `writer.toolResult(id, content, { isError? })` + `TToolDecision` extended to `{ result, isError? }`.
- Exported: `TBuiltInToolName`, `TToolName`, `IAskOptions`, `TKnownErrorCode`, `KNOWN_ERROR_CODES`, `TTokens`, `IJsonResult`, `IStandardSchema`, `TSchemaInput`, `ICostProjection`, `JsonValidationError`, `classifyStderr`, `parseAndValidate`, `stripFences`.
- `allowedTools`/`disallowedTools` and `IToolHandler.allowed`/`blocked` accept `TToolName` for IDE completion.
- `settingSources` narrowed to known CLI values with `(string & {})` escape hatch.

**Fixes**

- Retry budget now spans a full `ask()` (up to 3 respawns with 500ms/1s/2s backoff; was 1 retry).
- Session awaits process exit code on no-turn-complete so SIGKILL/SIGPIPE/SIGTERM classify as transient.
- Lazy spawn in `createStream` -- no leaked child process when the stream is created but never iterated.
- `cleanup()` always kills proc (was a no-op once the iterator was requested but never ticked).
- `spawnClaude` abort-signal race closed: listener registered before the `aborted` re-check.
- `AbortSignal` now interrupts a pending `reader.read()` even without a live process reference.
- Single resettable read timeout (was a fresh `Promise` + `setTimeout` per iteration).
- `close()` bounds `await inFlight` to `gracefulExitMs` so a stuck read can't hang it.
- Fatal errors (`KnownError`, `BudgetExceededError`) mark the session closed automatically.
- `TRANSIENT_PATTERN` extended: `ECONNABORTED`, `ENETUNREACH`, `EHOSTUNREACH`, `socket hang up`, `overloaded_error`; exit code 141 is transient.
- `ALIAS_PATTERN` captures nested config paths and skips commented-out rc lines.
- Env priority fixed: `process.env < alias < options.env < options.configDir`.
- Node runtime: `Readable.toWeb()` instead of manual polyfill; throws if pid undefined; stdin writes throw on destroyed.
- `extractTokens` takes `max(contextWindow)` across model entries (was last-wins).
- `TModelUsageEntry.contextWindow` now optional (matches wire protocol).
- `extractContent` type guard verifies `text` is a string.
- Drop `tool_use` events missing a `name` (were bypassing allow/block lists).
- `maxCostUsd: 0` is now valid ("disallow any spend" test mode).

**Internal**

- New modules: `json.ts`, `stderr.ts`, `async.ts`, `validation.ts`, `warnings.ts`.
- Shared helpers: `startPipeline`, `applyTurnComplete`, `processExitedEarly`, `safeKill`, `safeWrite`, `buildSpawnEnv`, `composeSignals`, `fireRetry`, `processRaw`, `IStderrDrain.text()`.
- 217 tests (+70 from 0.0.3). knip clean. Zero em dashes.
