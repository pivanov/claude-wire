---
"@pivanov/claude-wire": patch
---

**New: subpath exports, configurable inactivity watchdog, error `_tag` discriminants, public testing module, parser fuzz coverage**

### Subpath exports

The package now exposes four entry points instead of one. The main entry is unchanged; the three new subpaths give narrower surfaces for tooling, error-only catch handlers, and bundle-isolated test helpers. `package.json` is also exported for tooling.

| Subpath | Purpose |
|---------|---------|
| `@pivanov/claude-wire` | Full public API (unchanged). |
| `@pivanov/claude-wire/errors` | Error classes only. |
| `@pivanov/claude-wire/parser` | `parseLine`, `createTranslator`, `extractContent`, `blockFingerprint`, `parseDoubleEncoded`. |
| `@pivanov/claude-wire/testing` | In-process `IClaudeProcess` mocks. |
| `@pivanov/claude-wire/package.json` | Manifest access for tooling. |

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
  case "AgentInactivityError": /* ... */ break;
  case "BudgetExceededError":  /* ... */ break;
  case "KnownError":           /* ... */ break;
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
