# Output Events

All events emitted by Claude Code on stdout via `--output-format stream-json`.

## `system/init`

Emitted once at session start.

```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "sess-abc123",
  "model": "claude-sonnet-4-6",
  "tools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
}
```

## `assistant`

Model output. Contains a cumulative content array (see [Gotchas](/protocol/gotchas)).

```json
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      { "type": "thinking", "thinking": "Let me analyze..." },
      { "type": "text", "text": "Here's what I found:" },
      { "type": "tool_use", "id": "toolu_1", "name": "Read", "input": { "file_path": "main.ts" } }
    ]
  }
}
```

Content block types: `thinking`, `text`, `tool_use`.

## `user`

Tool execution results, sent by the Claude Code harness.

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_1",
        "content": "const x = 1;\n",
        "is_error": false
      }
    ]
  }
}
```

## `result/success`

Turn completed successfully. Contains cost, tokens, and timing.

```json
{
  "type": "result",
  "subtype": "success",
  "session_id": "sess-abc123",
  "result": "\"The answer is 42.\"",
  "is_error": false,
  "total_cost_usd": 0.018,
  "duration_ms": 8500,
  "duration_api_ms": 6200,
  "num_turns": 3,
  "modelUsage": {
    "claude-sonnet-4-6": {
      "inputTokens": 500,
      "outputTokens": 120,
      "cacheReadInputTokens": 3000,
      "cacheCreationInputTokens": 0,
      "contextWindow": 200000
    }
  }
}
```

Note: the `result` field is double-encoded JSON (see [Gotchas](/protocol/gotchas)).

## `result/error`

Turn ended with an error.

```json
{
  "type": "result",
  "subtype": "error",
  "session_id": "sess-abc123",
  "result": "\"Something went wrong\"",
  "is_error": true,
  "total_cost_usd": 0.005
}
```

## `system/result` (legacy)

An older format for turn completion. Has the same semantics as `result` but no `modelUsage` data. It can carry cost fields:

```json
{
  "type": "system",
  "subtype": "result",
  "session_id": "sess-abc123",
  "total_cost_usd": 0.005,
  "duration_ms": 3200,
  "is_error": false
}
```

claude-wire handles both formats transparently and passes through `total_cost_usd` and `duration_ms` from `system/result` events when present.

## Ignored Events

These event types are emitted but carry no useful data for SDK consumers:

- `progress` - internal progress indicators
- `rate_limit_event` - rate limit notifications
