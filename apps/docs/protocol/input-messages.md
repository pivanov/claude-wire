# Input Messages

Messages sent to Claude Code via stdin when using `--input-format stream-json`. Each message is a single JSON line (NDJSON).

claude-wire's `writer` module constructs these automatically. You only need to know this if you're working with the protocol directly.

## `user`

Send a follow-up prompt in a multi-turn session.

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "What was my previous question?"
  }
}
```

```ts
import { writer } from "claude-wire";
process.stdout.write(writer.user("What was my previous question?"));
```

## `approve`

Approve a pending tool execution.

```json
{
  "type": "approve",
  "tool_use_id": "toolu_abc123"
}
```

```ts
writer.approve("toolu_abc123");
```

## `deny`

Deny a pending tool execution.

```json
{
  "type": "deny",
  "tool_use_id": "toolu_abc123"
}
```

```ts
writer.deny("toolu_abc123");
```

## `tool_result`

Provide a custom result for a tool instead of letting it execute.

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_abc123",
  "content": "mocked file contents"
}
```

```ts
writer.toolResult("toolu_abc123", "mocked file contents");
```

## `abort`

Abort the current operation.

```json
{
  "type": "abort"
}
```

```ts
writer.abort();
```
