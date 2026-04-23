# @pivanov/claude-wire

## 0.1.4

### Patch Changes

- 5d9c00b: Add `claude-wire` CLI binary with an `ask-json` subcommand. Supports `--prompt`, `--schema`/`--schema-file`, `--model`, `--max-budget-usd`, and `--system-prompt`. Reads prompt from stdin when `--prompt` is omitted. Emits a single JSON line on stdout and structured JSON errors on stderr with distinct exit codes for validation (1), process (2), budget (3), and argument (4) failures. Additive: no changes to the JS API.

## 0.1.3

### Patch Changes

- 371867d: **Observability**

  - `ISessionOptions.onRecycle(reason)` fires when a session voluntarily recycles its backing process (today: `"turn-limit"`). Emit metrics, warm a replacement pool, or log the transition -- thrown errors are swallowed.
  - `IAskOptions.onCostUpdate(cost)` composes with the session-level observer so multi-tenant callers can attach request-scoped metadata (request id, tenant, trace span) without reaching outside the callback.
  - `drainStderr` now emits an `onWarning` once per drain when stderr exceeds the 1 MB cap and subsequent output is dropped. Silent by default -- only fires when the caller supplied `onWarning`.

  **Results**

  - `TAskResult.thinking` concatenates emitted `thinking` events so evals/debug consumers don't need to filter `events` by hand. Empty string when the run produced no thinking blocks.

  **Errors**

  - Conflicting `resume` + `continueSession` options now throw `KnownError("invalid-options")` instead of a generic `ClaudeError`, matching the typed pattern-matching surface of the other upfront validation errors.

  **Docs**

  - `api/session.md`: documents the new `onRecycle` hook and per-ask `onCostUpdate`.
  - `api/client.md`: `TAskResult` shape updated with `thinking`.
  - `api/errors.md`: `invalid-options` added to the `TKnownErrorCode` list.
  - JSDoc added for CLI-passthrough options (`permissionMode`, `bare`, `includeHookEvents`, `includePartialMessages`, `jsonSchema`, `forkSession`, `noSessionPersistence`, `sessionId`, `settingSources`, `disableSlashCommands`).

  **Tests (+12, 267 → 279)**

  - New `drainStderr` coverage for the truncation warning (fires once, respects cap, swallows observer throws).
  - `extractThinking` + empty-thinking coverage on `buildResult`.
  - Per-ask `onCostUpdate` composition + observer-error swallow.
  - `onRecycle` happy path + observer-error swallow.
  - `spawnClaude` conflicting-option validation.

## 0.1.2

### Patch Changes

- **Fixes**

  - Node.js signal-killed processes now resolve with `128+signum` exit codes (matching Bun). Previously all signal kills resolved as exit code `1`, bypassing `TRANSIENT_EXIT_CODES` (137/141/143) and preventing auto-retry on Node for SIGKILL/SIGTERM/SIGPIPE.
  - `consecutiveCrashes` is reset at the start of each `ask()`. Previously, an abort or timeout mid-retry leaked the crash counter into the next `ask()`, shrinking its retry budget.
  - `stream.ts` exit-code-0-without-turn-complete now passes the exit code to `processExitedEarly`, so the error carries the actual code instead of `undefined`.
  - `dispatchToolDecision` invalid-decision warning now includes the actual decision value for debuggability.
  - `stream[Symbol.asyncDispose]` now awaits process exit (capped at `gracefulExitMs`) instead of fire-and-forget SIGTERM. Prevents child process accumulation in tight create/dispose loops.
  - `drainStderr` caps accumulated chunks at 1MB to prevent unbounded memory growth on verbose CLI builds.
  - `spawnClaude` rejects conflicting `resume` + `continueSession` options early instead of passing undefined flag combinations to the CLI.
  - `--tools ""` vs `--allowedTools` flag asymmetry documented inline.

  **Docs**

  - `TAskResult.duration` corrected to `number | undefined` in `api/client.md`.
  - Stream second-iteration behavior clarified: throws `ClaudeError` after `.text()`/`.result()`, not silent no-op.
  - `writer.toolResult` signature updated with `options?: { isError?: boolean }` third parameter.
  - `TSessionMetaEvent` documented as re-emitted on session process respawn.
  - New `askJson` example (09-ask-json.ts) added to example runner.
  - Supported by LogicStar AI attribution in README and docs footer.

  **Tests (+36, 231 -> 267)**

  - New test files: `async.test.ts` (withTimeout), `warnings.test.ts` (createWarn observer isolation), `validation.test.ts` (assertPositiveNumber, requireNonEmpty).
  - `processExitedEarly`, `errorMessage`, `BudgetExceededError` fields now tested.
  - `dispatchToolDecision` approve, custom result, isError, and invalid-decision-value paths covered.
  - Translator edge cases: malformed tool_use, unknown block types, empty text/thinking, null input.

## 0.1.1

### Patch Changes

- 2c568aa: **New features**

  - Split token reporting -- `TTokens` gains optional `cacheRead` and `cacheCreation` fields so consumers can measure prompt-cache effectiveness without re-deriving from `modelUsage`. `TTurnCompleteEvent` carries matching `cacheReadTokens`/`cacheCreationTokens`. `input` continues to include the cache portions (no accounting break). `ICostTracker.update` accepts the new fields; `TCostSnapshot.tokens` exposes them through the existing surface.
  - Stateless Classifier guide (`/guides/classifier`) covering when to use `claude.askJson()` vs `claude.session()`, recommended spawn options for one-shot work, and how to verify prompt caching is hitting. Callouts added to `api/session.md` and `getting-started.md`.

  **Fixes**

  - `composeSignals` (session `signal` + per-ask `signal`) leaked event listeners on the signal that never fired. Replaced with `AbortSignal.any([a, b])`, which owns listener lifetime. Node 20.3+/Bun; within the existing engines floor.
  - `spawnClaude` abort listener was registered with `{ once: true }` but never removed when the process exited normally. Long-lived AbortControllers reused across many spawns accumulated dead listeners. Now cleaned up via `rawProc.exited.finally`.
  - Async Standard Schema validators (e.g. Valibot `pipeAsync`) previously bypassed validation silently -- the SDK treated the returned Promise as a sync result. `IStandardSchema.validate` return type is widened to `Result<T> | Promise<Result<T>>` and `parseAndValidate` awaits it. **Breaking (types):** `parseAndValidate` is now async and returns `Promise<T>`; callers that imported it directly must `await`. `claude.askJson` / `session.askJson` are unchanged.
  - Malformed NDJSON lines are now surfaced through `onWarning` instead of being silently dropped. Integrations can distinguish "no data" from "corrupted data" without log archaeology. Snippet truncated to 120 chars.
  - `TAskResult.duration` is now `number | undefined` -- previously coerced to `0` when `turn_complete` was missing, which was indistinguishable from a legitimately measured 0ms turn. **Breaking (types):** consumers that read `duration` unconditionally now need an `undefined` check.

  **Internal**

  - `setStderrClassifier` injection wiring removed. The former circular-import concern doesn't apply -- `stderr.ts` only has a type-only import from `errors.ts` -- so `processExitedEarly` imports `classifyStderr` directly. No runtime behavior change.
  - `IStandardSchema.validate` return-type change above also lets implementations return sync or async uniformly.

  **Tooling**

  - Root `package.json` declares `engines.node: ">=22"`.
  - `biome.json` now lints test files (with `noNonNullAssertion` and `noExplicitAny` relaxed in tests).
  - `knip.json` adds `src/index.ts` as an entry so package exports are tracked as used.
  - The `as ReadableStreamDefaultReader<Uint8Array>` cast in `pipeline.ts` is now documented inline as load-bearing for the Node/Bun stream-type unification in `runtime.ts` (Node's `stream/web` reader is a structural superset of Bun's).
  - `TWarn` is re-exported from the package root for consumers that want to type `onWarning` callbacks.

## 0.1.0

### Minor Changes

- 01580fd: **Breaking changes**

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

## 0.0.4

### Patch Changes

- afa438e: **New APIs**

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

## 0.0.3

### Patch Changes

- 95b22dc: **New APIs**

  - `IToolHandler.onError(err, tool)` -- recover from `onToolUse` throws; return a decision or rethrow to fall through to deny.
  - Exported `TKnownErrorCode` and `KNOWN_ERROR_CODES` so callers can narrow on `err.code`.

  **Fixes**

  - No longer leaks a spawned child process when a stream is created but never iterated.
  - Session `ask()`/`close()` race: queued asks now reject cleanly with `Session is closed` after `close()` runs.
  - Session respawn budget now spans a whole `ask()` (up to 3 retries) instead of giving up after one.
  - Fatal errors (`KnownError`, `BudgetExceededError`) mark the session closed so subsequent asks don't re-throw stale errors.
  - Session now propagates process exit code so `SIGKILL` (137), `SIGPIPE` (141), and `SIGTERM` (143) trigger the transient-error retry path.
  - Bounded `await proc.exited` and `close()`'s `await inFlight` with `gracefulExitMs` -- no indefinite hangs on zombie children or stuck reads.
  - `AbortSignal` now interrupts a pending `reader.read()` even without a live process reference.
  - `nodeReadableToWeb` honors backpressure; replaced the manual polyfill with `Readable.toWeb()`.
  - Shared `drainStderr` helper (was duplicated across `stream.ts` and `session.ts`); flushes trailing partial multibyte on stream close.
  - `ALIAS_PATTERN` now captures nested config paths (`$HOME/.config/claude/work`) and skips commented-out rc lines.
  - Env priority fixed: user's `options.env` outranks shell-alias heuristic (alias < `options.env` < `options.configDir`).
  - `onCostUpdate` callback errors now log via `console.warn` instead of silent swallow.
  - `maxCostUsd: 0` is now valid -- useful for test-mode "disallow any spend".
  - `tool_use` events missing a `name` are dropped (previously bypassed allow/block lists).

  **Internal**

  - Single resettable read timeout (was a fresh `Promise` + `setTimeout` per iteration).
  - Reused `TToolDecision` type in `pipeline.ts`; refactored `buildArgs`, `mergeOptions`, `fileExists`.
  - Added 37 tests (reader, runtime, alias, session retry, handler errors, and more). Total: 184 passing.

  **Docs**

  - Tool-handling guide documents `onError`.
  - Dual-budget section in `api/client.md` recommends when to use `maxCostUsd` vs `maxBudgetUsd`.
  - Cost-tracking guide documents `maxCostUsd: 0` test mode.
  - Size label updated to `16.2 kB`.

## 0.0.2

### Patch Changes

- 364bf7f: ### Added

  - Node.js >= 22 runtime support via `child_process.spawn` fallback (Bun remains primary)
  - `readNdjsonEvents()` shared async generator - single source of truth for NDJSON parsing
  - `buildArgs()` exported as pure function for testing CLI arg construction
  - `settingSources` and `disableSlashCommands` options for lightweight/headless mode (~1.5s startup vs ~35s)
  - `allowedTools: []` now emits `--tools ""` to disable all tools including MCP servers
  - `Symbol.asyncDispose` on both `IClaudeSession` and `IClaudeStream`
  - Session ask() queue - concurrent calls are serialized instead of rejected
  - Session auto-respawn with `--resume` to preserve conversation context
  - 147 real tests (was 106 pass + 24 skipped stubs)

  ### Fixed

  - Process leak when stream is created but never consumed
  - Process leak when initial prompt write fails
  - Session permanently stuck after AbortError (only KnownError/BudgetExceededError block recovery now)
  - Session abort race - correctly throws AbortError instead of ProcessError
  - Stderr pipe buffer deadlock - both stream and session drain stderr on spawn
  - Cost tracking lost on session respawn (offset preservation)
  - Node.js ENOENT produces unhandled rejection instead of KnownError
  - `onCostUpdate` callback crash propagates and kills stream/session
  - Tool handler errors silently drop tool decisions
  - Tool decisions with invalid return values silently drop
  - `tool_use` events with missing `block.id` crash the writer
  - `parseDoubleEncoded` returns `[object Object]` for object results
  - Timeout promise leak per read chunk (tracked + cleared)
  - Double `proc.kill()` in recycle and close paths
  - `gracefulKill` timer leak if `proc.exited` rejects
  - Shell injection vector in `whichSync` (`execSync` -> `execFileSync`)
  - `nodeReadableToWeb` double-close crash on error+end race
  - Missing trailing buffer processing in session (final NDJSON line without `\n`)
  - Stale error messages - session now captures stderr for diagnostics

  ### Changed

  - `ISpawnOptions` extends `IClaudeOptions` (was duplicated fields)
  - Extracted shared NDJSON reader from stream.ts and session.ts into reader.ts
  - Extracted `killProc()` and `gracefulKill()` helpers in session
  - `gracefulKill` sends second kill (SIGKILL) after timeout
  - `TRANSIENT_PATTERN` tightened (`network` -> `network error|network timeout`)
  - Exit code 139 (SIGSEGV) removed from transient codes
  - `ndjsonMaxLineBytes` renamed to `ndjsonMaxLineChars`
  - `sessionMaxIdleTurns` renamed to `sessionMaxTurnsBeforeRecycle`
  - `consecutiveCrashes` counter incremented on failure, not on spawn
  - `TModelUsageEntry.cacheReadInputTokens` and `cacheCreationInputTokens` now optional
