# Testing

The `@pivanov/claude-wire/testing` subpath ships in-process `IClaudeProcess` fakes you can swap in for the real `spawnClaude()` during unit tests. Living behind a subpath means production installs that never import from `/testing` skip the module entirely.

## When to Use

- Tests that exercise SDK behavior (parsing, sessions, retries, tool dispatch) without spawning the real `claude` binary.
- CI environments where the binary is unavailable or authentication isn't set up.
- Deterministic regression tests that pin a specific NDJSON transcript.

For end-to-end coverage against the real CLI, spawn `claude` normally and consume `claude.ask()` as usual.

## `createMockProcess(options)`

One-shot mock. Pre-supply the NDJSON lines the mock should emit; the stream emits them in order, closes stdout, and resolves `exited` with the configured exit code.

```ts
import { createMockProcess } from "@pivanov/claude-wire/testing";

const proc = createMockProcess({
  lines: [
    '{"type":"system","subtype":"init","session_id":"s1","model":"haiku","tools":[]}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}',
    '{"type":"result","subtype":"success","session_id":"s1","result":"hi","is_error":false,"total_cost_usd":0.001,"duration_ms":100,"modelUsage":{}}',
  ],
  exitCode: 0,
});

// Inspect what the SDK wrote to stdin:
console.log(proc.writes);
console.log(proc.killed);
```

A positional overload is also accepted for ergonomics: `createMockProcess(lines, exitCode?)`.

### `IMockProcess`

Extends `IClaudeProcess` with two read-only inspection fields:

| Field | Type | Description |
|-------|------|-------------|
| `writes` | `readonly string[]` | Every line written to stdin via `write()`, in order. |
| `killed` | `boolean` | True after `kill()` has been called at least once. |

## `createMultiTurnMockProcess()`

Long-lived mock for tests that need to react to SDK input. The stdout stream stays open until `closeStdout()` or `kill()`. Push events with `emitLines()` (raw NDJSON) or `emitEvent()` (typed `TClaudeEvent`).

```ts
import { createMultiTurnMockProcess } from "@pivanov/claude-wire/testing";

const proc = createMultiTurnMockProcess();

// First turn:
proc.emitEvent({ type: "system", subtype: "init", session_id: "s1", model: "haiku", tools: [] });
proc.emitEvent({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "first" }] } });
proc.emitEvent({ type: "result", subtype: "success", session_id: "s1", result: "first", is_error: false, total_cost_usd: 0.001 });

// React to a stdin write before emitting the next turn:
await waitFor(() => proc.writes.some((w) => w.includes("follow-up")));
proc.emitEvent({ type: "result", subtype: "success", session_id: "s1", result: "second", is_error: false, total_cost_usd: 0.002 });

proc.kill();
```

### `IMultiTurnMockProcess`

Extends `IMockProcess` with three control methods:

| Method | Description |
|--------|-------------|
| `emitLines(lines: string[])` | Push raw NDJSON lines into stdout. Each gets a trailing `\n`. |
| `emitEvent(event: TClaudeEvent)` | JSON-stringify a typed event and emit it as one line. |
| `closeStdout()` | Close the stdout stream so the reader sees EOF. Idempotent. |

## Wiring Into Bun Tests

Use `mock.module` to redirect `spawnClaude` at the module boundary:

```ts
import { beforeEach, mock, test, expect } from "bun:test";
import { createMockProcess, type IMockProcess } from "@pivanov/claude-wire/testing";

let mockProc: IMockProcess;

beforeEach(() => {
  mockProc = createMockProcess({
    lines: [/* fixture lines */],
    exitCode: 0,
  });
  mock.module("@pivanov/claude-wire", async () => {
    const real = await import("@pivanov/claude-wire");
    return { ...real, spawnClaude: () => mockProc };
  });
});

test("session reads a turn from the mock", async () => {
  const { createSession } = await import("@pivanov/claude-wire");
  const session = createSession();
  const result = await session.ask("hi");
  expect(result.text).toBe("hi");
});
```

For Vitest, Jest, or other runners, use the equivalent module-mock primitive (`vi.mock`, `jest.mock`).

## Fuzz Testing the Parser

The `@pivanov/claude-wire/parser` subpath exposes `parseLine` and `createTranslator`, both deterministic given the same input. The internal test suite ships a seeded fuzz harness over these; if you build adapters or alternative pipelines, the same harness pattern works for your translator. See `tests/parser/translator.fuzz.test.ts` in the repo for a reference implementation.
