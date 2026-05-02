# Events

All events are part of the `TRelayEvent` discriminated union. Switch on `event.type` to handle each one.

```ts
type TRelayEvent =
  | TTextEvent
  | TThinkingEvent
  | TToolUseEvent
  | TToolResultEvent
  | TSessionMetaEvent
  | TTurnCompleteEvent
  | TErrorEvent
  | TStructuredOutputEvent;
```

## `TTextEvent`

Text content from the assistant.

```ts
{
  type: "text",
  content: "Here's the answer..."
}
```

## `TThinkingEvent`

Internal reasoning (extended thinking / chain of thought).

```ts
{
  type: "thinking",
  content: "Let me analyze the code..."
}
```

## `TToolUseEvent`

Claude wants to use a tool. If you have a tool handler configured, it will be called automatically.

```ts
{
  type: "tool_use",
  toolUseId: "toolu_abc123",
  toolName: "Read",
  input: { file_path: "main.ts" }
}
```

The `input` field is `unknown` -- it is the parsed JSON object from the wire protocol, passed through as-is. Use `JSON.stringify(event.input)` if you need the string form.

## `TToolResultEvent`

Result of a tool execution, emitted from `user` messages in the wire protocol.

```ts
{
  type: "tool_result",
  toolUseId: "toolu_abc123",
  output: "const x = 1;\n",
  isError: false
}
```

## `TSessionMetaEvent`

Emitted once at the start of a session with metadata.

```ts
{
  type: "session_meta",
  sessionId: "sess-abc123",
  model: "claude-sonnet-4-6",
  tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
}
```

::: info Session mode: re-emitted on respawn
In session mode, `session_meta` is re-emitted after each process respawn -- for example, on auto-retry after a transient failure or after a turn-limit recycle. It is not emitted exactly once per logical session; treat each emission as the start of a new underlying process within the same session.
:::

## `TTurnCompleteEvent`

Emitted at the end of each turn with cost, token, and timing data.

```ts
{
  type: "turn_complete",
  sessionId: "sess-abc123",
  costUsd: 0.018,
  inputTokens: 3500,          // total input (base + cache read + cache creation)
  outputTokens: 120,
  cacheReadTokens: 3000,      // tokens read from prompt cache (~10% billing rate)
  cacheCreationTokens: 0,     // tokens written to prompt cache (~125% billing rate)
  contextWindow: 200000,
  durationMs: 8500
}
```

All fields except `type` are optional -- they may be absent on legacy `system/result` events or when the CLI omits `modelUsage`.

## `TErrorEvent`

An error from the session.

```ts
{
  type: "error",
  message: "Something went wrong",
  sessionId: "sess-abc123"
}
```

## `TStructuredOutputEvent`

Emitted once per turn when the CLI was launched with `--json-schema` and produced a constrained value. The translator surfaces whichever channel fires first: a synthetic `StructuredOutput` `tool_use` block (preferred), or the terminal `result` event's `structured_output` field (fallback). Dedup ensures a single event per turn.

```ts
{
  type: "structured_output",
  value: { greeting: "hello" }   // parsed JSON object, not a string
}
```

`buildResult` exposes the value on `TAskResult.structuredOutput` for one-shot consumers; streaming consumers can read it from this event directly. `claude.askJson` and `session.askJson` read `raw.structuredOutput` preferentially over `raw.text` so Stop-hook nag messages or other commentary in the same turn don't corrupt validation. See [JSON: Standard Schema route](./json.md#standard-schema-objects-recommended) for caller-facing usage.
