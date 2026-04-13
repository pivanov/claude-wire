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
  | TErrorEvent;
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
  input: "{\"file_path\":\"main.ts\"}"
}
```

The `input` field is always a JSON string.

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

## `TTurnCompleteEvent`

Emitted at the end of each turn with cost, token, and timing data.

```ts
{
  type: "turn_complete",
  sessionId: "sess-abc123",
  costUsd: 0.018,
  inputTokens: 3500,
  outputTokens: 120,
  contextWindow: 200000,
  durationMs: 8500
}
```

All fields except `type` are optional - they may be absent on legacy `system/result` events.

## `TErrorEvent`

An error from the session.

```ts
{
  type: "error",
  message: "Something went wrong",
  sessionId: "sess-abc123"
}
```
