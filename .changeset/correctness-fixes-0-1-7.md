---
"@pivanov/claude-wire": patch
---

**Correctness & robustness fixes**

- **reader**: recreate the timeout promise per read. The previous shared promise stayed permanently rejected after the first fire and poisoned subsequent reads with a stale `TimeoutError` whenever a consumer paused longer than `defaultAbortMs` between pulls (slow per-event handlers, awaited tool dispatch, UI rendering — all hit it deterministically).
- **runtime (Node)**: attach an early no-op `'error'` listener after `child_process.spawn`. Async spawn failures (`ENOENT`/`EACCES`) emit `'error'` on next tick; without the listener attached before the synchronous pid check, the unhandled event would crash the host process via EventEmitter semantics. Bun was unaffected.
- **session**: thread a close-owned `AbortController` into the active ask. `close()` previously waited the full `gracefulExitMs` whenever the in-flight ask was blocked in `reader.read()`; the close-signal now unblocks the read loop immediately.
- **process**: use `safeKill` in the prompt-write failure path so a `kill()` error can't mask the original write error.
- **cli**: cap `readStdin` at 50MB and throw a clean `ClaudeError` instead of OOMing when a large file is accidentally piped in.
- **stderr**: tighten the `not-authenticated` classifier regex. The bare word `authentication` matched unrelated lines like "two-factor authentication enabled" and "authentication token refreshed"; it now requires `authentication failed`, `invalid api key`, or word-boundary `401`.
- **translator**: prefer `raw.message.id` for assistant-message dedup. Falls back to the existing first-block fingerprint when the CLI omits ids. Closes a small class of in-turn dedup ambiguity when consecutive messages opened with identical first blocks.

**Behavioral notes (non-breaking, observable)**

- A user-supplied `onWarning` hook that itself throws is now silently swallowed instead of falling back to `console.warn`. Falling back polluted the channel users had explicitly routed away from. If you relied on the fallback for visibility into a buggy hook, fix the hook.

**Tests**

- Updated `tests/warnings.test.ts` to assert the new silent-swallow contract. 296/296 pass.
