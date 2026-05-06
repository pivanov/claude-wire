# @pivanov/claude-wire

## 0.2.0

### Minor Changes

- BREAKING: flatten token usage shape; `session.askJson` now requires `jsonSchema` at `createSession`

  ## 1. Token shape flatten

  ### What changed

  The nested `tokens: { input, output, cacheRead?, cacheCreation? }` object that appeared on `TAskResult` and `TCostSnapshot` has been replaced with flat top-level fields. The `TTokens` type has been removed entirely.

  **Before:**

  ```ts
  const result = await claude.ask(prompt);
  console.log(result.tokens.input); // total input tokens
  console.log(result.tokens.output); // output tokens
  console.log(result.tokens.cacheRead); // cache read tokens (was optional, could be undefined)
  console.log(result.tokens.cacheCreation); // cache creation tokens (was optional, could be undefined)

  const snap: TCostSnapshot = costTracker.snapshot();
  console.log(snap.tokens.input);
  console.log(snap.tokens.cacheRead ?? 0); // callers had to null-coalesce
  ```

  **After:**

  ```ts
  const result = await claude.ask(prompt);
  console.log(result.tokensIn); // total input tokens
  console.log(result.tokensOut); // output tokens
  console.log(result.tokensCacheRead); // cache read tokens (now always a number, defaults to 0)
  console.log(result.tokensCacheCreation); // cache creation tokens (now always a number, defaults to 0)

  const snap: TCostSnapshot = costTracker.snapshot();
  console.log(snap.tokensIn);
  console.log(snap.tokensCacheRead); // no ?? 0 needed
  ```

  ### Affected types and surfaces

  - **`TAskResult`**: fields `tokens` removed; `tokensIn`, `tokensOut`, `tokensCacheRead`, `tokensCacheCreation` added.
  - **`IJsonResult<T>`**: `result.raw` is `TAskResult`, so `result.raw.tokens.*` becomes `result.raw.tokensIn` / `result.raw.tokensOut` / etc.
  - **`TCostSnapshot`**: same rename; the snapshot is what `onCostUpdate` callbacks receive, what `stream.cost()` resolves with, and what `costTracker.snapshot()` returns.
  - **`TTokens`** type removed from public exports; inline the fields directly if you were importing it.
  - Any streaming final-result type (`IClaudeStream.result()`) returns `TAskResult` and is affected.

  ### Why `tokensCacheCreation` not `tokensCacheWrite`

  The field name `tokensCacheCreation` matches Anthropic's own `cache_creation_input_tokens` field in the API response. This makes invoice reconciliation straightforward: the SDK field and the billing line item share the same concept name.

  ### Optionality removed

  `cacheRead` and `cacheCreation` were previously `number | undefined`. The flat replacements `tokensCacheRead` and `tokensCacheCreation` are always `number` and default to `0` when the CLI did not report cache activity for that turn. Callers no longer need `?? 0` guards when logging or summing these fields.

  ### Migration

  Find/replace in your codebase:

  | Old                     | New                            |
  | ----------------------- | ------------------------------ |
  | `.tokens.input`         | `.tokensIn`                    |
  | `.tokens.output`        | `.tokensOut`                   |
  | `.tokens.cacheRead`     | `.tokensCacheRead`             |
  | `.tokens.cacheCreation` | `.tokensCacheCreation`         |
  | `snap.tokens.input`     | `snap.tokensIn`                |
  | `TTokens` import        | remove (no replacement needed) |

  ## 2. `session.askJson` now fails loud without `jsonSchema`

  Previously, calling `session.askJson(prompt, schema)` on a session created without `jsonSchema` silently degraded to prompt-forced JSON + JS validation: no `--json-schema` flag, no `--tools StructuredOutput`. The model output was unconstrained at the CLI layer; only the JS validator caught violations after the fact. This was a foot-gun: callers thought they were on the strict path because the API name says "json".

  Now it throws `JsonValidationError` up front, before spawning the turn:

  ```ts
  // Before (0.1.x): silently soft-mode
  const session = createSession({ systemPrompt: "..." });
  await session.askJson(prompt, schema); // worked, but no native constraint

  // After (0.2.0): throws JsonValidationError
  const session = createSession({ systemPrompt: "..." });
  await session.askJson(prompt, schema); // ❌ "session.askJson() requires jsonSchema..."

  // Correct strict-mode usage:
  const session = createSession({
    systemPrompt: "...",
    jsonSchema: schemaJsonString,
  });
  await session.askJson(prompt, schema); // ✓ uses --json-schema + --tools StructuredOutput
  ```

  For per-call schemas without a session, use stateless `claude.askJson(prompt, schema)`, which auto-derives the JSON Schema from Standard Schema vendors (Zod 4+, Valibot, ArkType) and engages the strict path on every call.

  ## 3. CLI stdout JSON shape flattened to match SDK

  The `claude-wire ask-json` binary's stdout payload now uses the same flat shape as the SDK and additionally surfaces cache token counts.

  **Before:**

  ```json
  { "data": ..., "costUsd": 0.012, "tokens": { "input": 412, "output": 88 }, "durationMs": 1800, "sessionId": "..." }
  ```

  **After:**

  ```json
  { "data": ..., "costUsd": 0.012, "tokensIn": 412, "tokensOut": 88, "tokensCacheRead": 0, "tokensCacheCreation": 0, "durationMs": 1800, "sessionId": "..." }
  ```

  Shell consumers using `jq '.tokens.input'` should switch to `jq '.tokensIn'`. Cache tokens are now visible to CLI consumers for cache-hit verification.

### Patch Changes

- 448ad75: **Correctness & robustness fixes**

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

- b4bb761: **New: subpath exports, configurable inactivity watchdog, error `_tag` discriminants, public testing module, parser fuzz coverage**

  ### Subpath exports

  The package now exposes four entry points instead of one. The main entry is unchanged; the three new subpaths give narrower surfaces for tooling, error-only catch handlers, and bundle-isolated test helpers. `package.json` is also exported for tooling.

  | Subpath                             | Purpose                                                                                      |
  | ----------------------------------- | -------------------------------------------------------------------------------------------- |
  | `@pivanov/claude-wire`              | Full public API (unchanged).                                                                 |
  | `@pivanov/claude-wire/errors`       | Error classes only.                                                                          |
  | `@pivanov/claude-wire/parser`       | `parseLine`, `createTranslator`, `extractContent`, `blockFingerprint`, `parseDoubleEncoded`. |
  | `@pivanov/claude-wire/testing`      | In-process `IClaudeProcess` mocks.                                                           |
  | `@pivanov/claude-wire/package.json` | Manifest access for tooling.                                                                 |

  ### Configurable inactivity watchdog

  `IClaudeOptions` now accepts `inactivityTimeoutMs?: number`, plumbed through `createSession()`, `createStream()`, and `readNdjsonEvents()`. The watchdog resets on every stdout chunk, so chatty streams stay alive indefinitely. Defaults to `TIMEOUTS.defaultAbortMs` (5 minutes). Pass `Infinity` to disable. When the watchdog fires it now throws the new `AgentInactivityError` with the configured `inactivityMs` exposed as a property.

  ```ts
  const session = claude.session({ inactivityTimeoutMs: 30_000 });
  ```

  `AgentInactivityError extends TimeoutError`, so existing `instanceof TimeoutError` catches still fire. No back-compat break.

  ### Error `_tag` discriminants

  Every error class carries a literal `_tag` field. Consumers can now pattern-match exhaustively without `instanceof`, and the discriminant survives structured-clone / cross-realm boundaries where `instanceof` is unreliable.

  ```ts
  import type { TClaudeErrorTag } from "@pivanov/claude-wire";

  switch ((err as { _tag?: TClaudeErrorTag })._tag) {
    case "AgentInactivityError":
      /* ... */ break;
    case "BudgetExceededError":
      /* ... */ break;
    case "KnownError":
      /* ... */ break;
    // ...
  }
  ```

  The full union is `"ClaudeError" | "BudgetExceededError" | "AbortError" | "TimeoutError" | "AgentInactivityError" | "ProcessError" | "KnownError"`. `instanceof` still works and remains the recommended path for most code.

  ### Public testing module

  `@pivanov/claude-wire/testing` exposes the in-process process mocks the SDK's own test suite uses:

  - `createMockProcess({ lines, exitCode? })` for one-shot transcripts
  - `createMultiTurnMockProcess()` for long-lived streams with `emitLines`, the new `emitEvent(TClaudeEvent)`, and `closeStdout()`
  - `IMockProcess` and `IMultiTurnMockProcess` interfaces with public `writes` and `killed` inspection fields (previously `_writes` / `_killed` test internals)

  Bundlers drop the testing module entirely from production builds because it lives behind a subpath that production code never reaches.

  ### Parser fuzz coverage

  New `tests/parser/translator.fuzz.test.ts` runs a seeded `mulberry32` generator across 2000 randomized `TClaudeEvent` shapes plus 2000 byte-fuzzed NDJSON lines. Asserts the translator never throws, every emitted relay event is well-formed, and `parseLine` round-trips well-formed JSON.

  ### Bug fix surfaced by fuzz

  `parseLine` previously returned non-object JSON values (numbers, booleans, arrays, strings) cast as `TClaudeEvent`, violating its own return type. Inputs like `"42"`, `"true"`, `"[1]"`, or `"\"x\""` now resolve to `undefined` and route through `onWarning` like other malformed lines.

  ### Other

  - Bundle measurement on the README updated to reflect current reality (`~8 kB minified+gzipped` main entry, `~37 kB npm tarball`). Previous figure was stale.
  - Docs site adds two new pages (`/api/subpaths`, `/api/testing`) plus updates to `/api/errors`, `/api/session`, `/api/stream`.
  - Test suite: 296 -> 301 passing.

- a24a0a7: **Fix: `askJson` reliability when the model emits thinking-only turns**

  ### What was broken

  Recent Claude Code CLI builds (with `--output-format stream-json`) can emit responses entirely inside thinking content blocks on trivial prompts, producing zero text content. `claude.askJson(prompt, zodSchema)` then failed inside `JSON.parse("")` with the misleading message `"Unexpected end of JSON input"`. The CLI's `--json-schema` flag prevents this by forcing a constrained text block to exist, but claude-wire only forwarded that flag when the caller passed a raw JSON Schema string. Standard Schema objects (Zod, Valibot, ArkType) silently fell through to prompt-engineering-only.

  ### What changed

  **`claude.askJson` auto-derives `--json-schema` from Standard Schema objects.** When the vendor is supported, the SDK runs the vendor's converter, JSON-stringifies the result, and forwards it as `--json-schema` to the CLI alongside the existing `DEFAULT_JSON_SYSTEM_PROMPT`:

  | Vendor    | Requires                                        |
  | --------- | ----------------------------------------------- |
  | `zod`     | Zod 4+ (`z.toJSONSchema` top-level export).     |
  | `valibot` | The optional `@valibot/to-json-schema` package. |
  | `arktype` | Built-in (`schema.toJsonSchema()`).             |

  Converter packages are loaded via dynamic `import()` and stay optional peer deps; consumers only need them installed when they pass that vendor's schemas.

  Explicit `options.jsonSchema` always wins over auto-derivation, so callers who already convert their schemas keep working.

  **Top-level `$schema` is stripped from JSON Schema strings before forwarding to `--json-schema`.** The CLI silently rejects any JSON Schema that carries a top-level `$schema` URL (e.g. `"https://json-schema.org/draft/2020-12/schema"`) and falls back to plain text without firing `StructuredOutput`. Zod 4's `z.toJSONSchema` emits this field by default and many other converters do too, so callers passing converter output verbatim hit the dead end. `buildArgs` now sanitizes the schema string at the lowest layer (right before the CLI flag is appended), so every entry path is protected: auto-derived schemas, caller-supplied JSON Schema strings, and any future code path that ends up writing `--json-schema`. Nested `$schema` occurrences inside sub-schemas are preserved; only the top-level field is removed. Malformed JSON passes through unchanged so the CLI can surface its own parse error. The sanitizer is internal to `buildArgs` and not part of the public API; callers don't need to think about it.

  **`StructuredOutput` is force-enabled via strict `--tools` whitelist whenever `jsonSchema` is set.** The CLI delivers schema-constrained output through a synthetic `StructuredOutput` tool. Two CLI flags interact here:

  - `--allowedTools <list>` is **additive**: tools listed are added on top of `~/.claude/settings.json` and project-level allow lists.
  - `--tools <list>` is a **strict whitelist**: only listed tools are available, regardless of user/project settings.

  Previously every common caller setup either disabled the channel, never enabled it, or used the additive flag (which leaks user-settings tools and lets the model pick plain text instead of calling StructuredOutput):

  | Caller setup                                                | Old args                                         | New args                                                        |
  | ----------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
  | `jsonSchema` only (no `allowedTools`)                       | no flag (default set excludes it)                | `--tools StructuredOutput`                                      |
  | `jsonSchema` + `allowedTools: []`                           | `--tools ""` (strips it)                         | `--tools StructuredOutput`                                      |
  | `jsonSchema` + `allowedTools: ["Read"]`                     | `--allowedTools Read` (additive, leaks defaults) | `--tools Read,StructuredOutput` (strict)                        |
  | `jsonSchema` + `allowedTools: ["Read", "StructuredOutput"]` | additive, leaks defaults                         | `--tools Read,StructuredOutput` (no duplication, strict)        |
  | `allowedTools: []` (no `jsonSchema`)                        | `--tools ""`                                     | unchanged                                                       |
  | `allowedTools: ["Read"]` (no `jsonSchema`)                  | `--allowedTools Read`                            | unchanged (additive semantics preserved for non-schema callers) |
  | neither set                                                 | no flag                                          | unchanged                                                       |

  The schema branch in `buildArgs` always uses `--tools` so the constrained turn is genuinely constrained. The non-schema branch keeps its existing `--allowedTools` (additive) behavior so non-JSON callers see no behavior change. This is the root-cause fix; the changes below are defense-in-depth on top of it.

  **`StructuredOutput` is exposed as `raw.structuredOutput` with two source paths and dedup.** When `--json-schema` is set, recent Claude Code CLI builds deliver the constrained JSON either via a synthetic `tool_use` block named `StructuredOutput` (with the parsed JSON in its `input` field), or via the terminal `result` event's `structured_output` field, or both. The translator emits a single new `structured_output` relay event from whichever source fires first per turn (block route preferred, result-event fallback used when the block had `undefined` input from CLI streaming partials). `buildResult` surfaces the value on a new `raw.structuredOutput` field on `TAskResult`. Both `claude.askJson` and `session.askJson` read `raw.structuredOutput` preferentially over `raw.text` because `raw.text` in constrained-output turns can carry Stop-hook nag messages ("You MUST call the StructuredOutput tool") or partial commentary that would corrupt `parseAndValidate`. The synthetic block is not surfaced as a `tool_use` relay event so consumers don't see a phantom tool fire.

  **New public API surface.** `TStructuredOutputEvent` is added to the `TRelayEvent` discriminated union. `TAskResult.structuredOutput?: unknown` is added. `TClaudeEvent.structured_output?: unknown` is added on the protocol type for the result-event fallback. All additions are optional; existing consumers see no behavior change unless they pass `--json-schema`.

  **Empty-text turns surface as a typed error.** Both `claude.askJson` and `session.askJson` detect `raw.text === "" && raw.thinking !== ""` after the structured-output check and throw `JsonValidationError` with an actionable message. The session variant additionally explains that `--json-schema` is bound to the long-lived process and must be set at session creation (or the caller should switch to stateless `claude.askJson` for per-call schemas). With both StructuredOutput routes in place, this error fires only when `--json-schema` was not forwarded at all (unsupported vendor or stateless caller didn't pass a schema).

  **New public helper `standardSchemaToJsonSchema(schema)`.** Exported from the main `@pivanov/claude-wire` entry. Callers who want explicit control over the conversion (or who need a JSON Schema string for use outside `askJson`) can call it directly:

  ```ts
  import { standardSchemaToJsonSchema } from "@pivanov/claude-wire";

  const derived = await standardSchemaToJsonSchema(myZodSchema);
  // '{"type":"object",...}' or undefined when the vendor isn't supported
  ```

  ### Practical impact

  For the `wiki`-style use case (one stateless call per schema), no caller changes are needed: `claude.askJson(prompt, zodSchema)` now constrains the CLI natively when Zod 4+ is in the project. Previously this path was non-deterministically broken on Haiku.

  For session-per-schema setups (ls-prove style), behavior is unchanged: continue passing `jsonSchema` (string) at session creation as before. The only new behavior is the typed empty-text error if you accidentally start a session without a schema.

  ### Tests

  301 -> 330 passing. New coverage:

  - `buildArgs` force-enables `StructuredOutput` when `jsonSchema` is set across all six caller permutations: undefined `allowedTools`, empty `allowedTools`, non-empty `allowedTools` without it, non-empty already including it, and the two no-schema cases for regression coverage.
  - `buildArgs` strips top-level `$schema` from `--json-schema` and leaves nested occurrences alone; malformed strings pass through unchanged.
  - Translator routes `StructuredOutput` tool_use to a `structured_output` event.
  - Variants covered: with/without id, undefined input (dropped as partial-block guard), null input, regular user tools unaffected.
  - Result-event fallback emits `structured_output` when the block route did not fire.
  - Dedup: result-event fallback skipped when block route already emitted the value.
  - Dedup state resets across turns (block route in turn 1 doesn't suppress fallback in turn 2).
  - End-to-end: `claude.askJson` returns structured data via `raw.structuredOutput` from a StructuredOutput tool_use block.
  - End-to-end: `claude.askJson` falls back to `result.structured_output` when the block route is missing and `raw.text` only contains a Stop-hook nag message.
  - Auto-derive sets `merged.jsonSchema` for arktype-vendor schemas.
  - Explicit `options.jsonSchema` wins over auto-derive.
  - Unknown vendors leave `jsonSchema` unset (validation-only path).
  - `standardSchemaToJsonSchema` returns `undefined` for unknown vendors and missing methods.
  - Empty-text-with-thinking throws `JsonValidationError` with vendor-specific guidance in both `client.askJson` and `session.askJson`.
  - Fuzz harness updated for the new relay event variant in the exhaustive switch.

## 0.1.6

### Patch Changes

- aa0c9f1: **Fixes**

  - `claude.askJson()` now injects a default `systemPrompt` instructing the model to return JSON-only output (no prose, no fences) whenever the caller hasn't set one. `--json-schema` at the CLI layer is a hint Claude Code doesn't hard-enforce, so both sonnet and haiku regularly wrapped JSON in prose ("Here is the JSON: {...}") or responded in pure prose on short "classify X" prompts, producing confusing `json-validation` exit-1 errors. A system-prompt-level instruction is the most portable way to force reliable JSON across model versions. Explicit caller `systemPrompt` still wins. Affects both `claude.askJson()` and the `claude-wire ask-json` CLI.
  - `0.1.5` has been unpublished from npm; use `0.1.6` instead. (`0.1.4` was also unpublished earlier for a symlink-guard bug fixed in `0.1.5`.)

  **Tests (+5, 291 → 296)**

  - New `tests/client.test.ts`: asserts the default system prompt is injected on `askJson`, caller systemPrompt overrides it, client-level defaults propagate, and `ask` (non-JSON) is unaffected.

## 0.1.5

### Patch Changes

- 073701f: **Fixes**

  - `claude-wire` CLI now runs when invoked through the symlink created by npm/bun at `node_modules/.bin/claude-wire` (the path every real user hits via `npx`/`bunx`). Previous `import.meta.url === file://${process.argv[1]}` entry guard silently no-op'd under symlink invocation because `argv[1]` was the symlink path while `import.meta.url` was the resolved target. Replaced with a `realpathSync`-based comparison that collapses both to the canonical path. `0.1.4` is affected and has been unpublished; use `0.1.5` instead.

  **Docs**

  - New `guides/claude-code-skill.md` covering the `/ask-json` Claude Code skill (install via skills.sh, how main Claude routes structured-output tasks, examples).
  - Homepage gains "Structured JSON", "CLI Binary", and "Claude Code Skill" feature tiles.

  **Tests (+1, 290 → 291)**

  - Regression test spawns the CLI source through a temporary symlink and asserts that `--version` prints a valid semver, so this class of bug cannot silently reappear.

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
