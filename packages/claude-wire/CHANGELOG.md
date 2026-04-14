# @pivanov/claude-wire

## 0.0.3

### Patch Changes

- 95b22dc: **New APIs**

  - `IToolHandler.onError(err, tool)` — recover from `onToolUse` throws; return a decision or rethrow to fall through to deny.
  - Exported `TKnownErrorCode` and `KNOWN_ERROR_CODES` so callers can narrow on `err.code`.

  **Fixes**

  - No longer leaks a spawned child process when a stream is created but never iterated.
  - Session `ask()`/`close()` race: queued asks now reject cleanly with `Session is closed` after `close()` runs.
  - Session respawn budget now spans a whole `ask()` (up to 3 retries) instead of giving up after one.
  - Fatal errors (`KnownError`, `BudgetExceededError`) mark the session closed so subsequent asks don't re-throw stale errors.
  - Session now propagates process exit code so `SIGKILL` (137), `SIGPIPE` (141), and `SIGTERM` (143) trigger the transient-error retry path.
  - Bounded `await proc.exited` and `close()`'s `await inFlight` with `gracefulExitMs` — no indefinite hangs on zombie children or stuck reads.
  - `AbortSignal` now interrupts a pending `reader.read()` even without a live process reference.
  - `nodeReadableToWeb` honors backpressure; replaced the manual polyfill with `Readable.toWeb()`.
  - Shared `drainStderr` helper (was duplicated across `stream.ts` and `session.ts`); flushes trailing partial multibyte on stream close.
  - `ALIAS_PATTERN` now captures nested config paths (`$HOME/.config/claude/work`) and skips commented-out rc lines.
  - Env priority fixed: user's `options.env` outranks shell-alias heuristic (alias < `options.env` < `options.configDir`).
  - `onCostUpdate` callback errors now log via `console.warn` instead of silent swallow.
  - `maxCostUsd: 0` is now valid — useful for test-mode "disallow any spend".
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
