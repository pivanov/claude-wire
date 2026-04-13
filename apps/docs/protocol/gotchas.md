# Protocol Gotchas

Edge cases and quirks in the Claude Code NDJSON protocol that claude-wire handles for you.

## Double-Encoded Results

The `result` field in `result` events is JSON inside JSON:

```json
{
  "type": "result",
  "result": "\"The actual text here\""
}
```

The value `"\"The actual text here\""` is a JSON string containing another JSON string. You must parse twice:

```ts
const outer = JSON.parse(line);       // { result: "\"The actual text here\"" }
const text = JSON.parse(outer.result); // "The actual text here"
```

claude-wire's `parseDoubleEncoded()` handles this automatically, including fallbacks when the inner parse fails.

## Polymorphic `tool_result.content`

The `content` field in tool result blocks has three possible shapes:

```ts
// String
{
  "content": "file contents here"
}

// Array of text blocks
{
  "content": [
    { "type": "text", "text": "File edited successfully" }
  ]
}

// Null
{
  "content": null
}
```

claude-wire's `extractContent()` normalizes all three to a plain string.

## Thinking Field Name Varies

On `thinking` content blocks, the actual text can appear in two fields:

```json
{
  "type": "thinking",
  "thinking": "Let me analyze..."
}

{
  "type": "thinking",
  "text": "Let me analyze..."
}
```

Always check `block.thinking ?? block.text`.

## Cumulative Content Arrays

In verbose mode, each `assistant` event repeats all previous content blocks:

```
event 1: [thinking]
event 2: [thinking, text]           <- thinking is duplicated
event 3: [thinking, text, tool_use] <- both duplicated
```

The translator maintains a `lastContentIndex` counter and only emits blocks from that index onward. After a `result` event, the index resets for the next turn.

## Multi-Agent Fingerprinting

When Claude Code spawns sub-agents, their events interleave on stdout. The first content block's identity changes when a different agent starts emitting.

Fingerprint logic:
- `tool_use` blocks: `"tool_use:{id}"` (unique IDs make this reliable)
- `text`/`thinking` blocks: `"{type}:{first 64 chars}"`
- Fallback: `"{type}:{tool_use_id ?? 'unknown'}"`

When the fingerprint of the first block changes between consecutive `assistant` events, the dedup index resets to 0 so the new agent's full output is captured.
