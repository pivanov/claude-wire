# Stream

`claude.stream()` returns an `IClaudeStream` that yields typed events as they arrive from Claude Code.

## Iterating Events

```ts
for await (const event of claude.stream("Explain generics")) {
  switch (event.type) {
    case "text":
      process.stdout.write(event.content);
      break;
    case "thinking":
      console.log("[think]", event.content);
      break;
    case "tool_use":
      console.log(`[tool] ${event.toolName}(${event.input})`);
      break;
    case "tool_result":
      console.log(`[result] ${event.output}`);
      break;
    case "turn_complete":
      console.log(`Cost: $${event.costUsd?.toFixed(4)}`);
      break;
    case "error":
      console.error(event.message);
      break;
  }
}
```

## Convenience Methods

If you don't need real-time events, use the convenience methods instead:

### `.text()`

Consumes the stream and returns all text content concatenated.

```ts
const text = await claude.stream("Hello").text();
```

### `.cost()`

Consumes the stream and returns the final cost snapshot.

```ts
const cost = await claude.stream("Hello").cost();
console.log(cost.totalUsd, cost.inputTokens, cost.outputTokens);
```

### `.result()`

Consumes the stream and returns a full `TAskResult` - same as `claude.ask()`.

```ts
const result = await claude.stream("Hello").result();
```

## Single-Consumption Rule

A stream can only be consumed once. You must choose one approach:

- **Iterate** with `for await` - get real-time events
- **Call** `.text()`, `.cost()`, or `.result()` - get the final result

Mixing them throws an error:

```ts
const stream = claude.stream("Hello");

for await (const event of stream) { /* ... */ }

// This throws:
await stream.text(); // Error: Cannot call after iterating
```

Iterating a second time yields nothing (the generator is already exhausted):

```ts
const stream = claude.stream("Hello");
for await (const event of stream) { /* gets events */ }
for await (const event of stream) { /* silently yields nothing */ }
```

## Timeouts

Streams have a 5-minute timeout per read operation. If Claude doesn't respond within this window, a `TimeoutError` is thrown and the process is killed.

## Buffer Limits

The NDJSON buffer is capped at 10MB (`LIMITS.ndjsonMaxLineChars`). If the buffer exceeds this, a `ClaudeError` is thrown.

## Process Cleanup

The spawned process is always killed on any error (timeout, budget, parse error, etc.), preventing orphaned processes.

## Stderr Capture

If the process exits with a non-zero code before producing any events, stderr is captured and included in the `ProcessError` message. This gives clear errors for common failures like "not authenticated" or "rate limited".
