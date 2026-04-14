---
"@pivanov/claude-wire": patch
---

**New APIs**

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
