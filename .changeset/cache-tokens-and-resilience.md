---
"@pivanov/claude-wire": patch
---

**New features**

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
- Removed redundant `as ReadableStreamDefaultReader<Uint8Array>` cast -- wait, kept with a comment explaining it's load-bearing for the Node/Bun stream-type unification in `runtime.ts`.
- `TWarn` is re-exported from the package root for consumers that want to type `onWarning` callbacks.
