# Protocol Overview

Claude Code's `--output-format stream-json` flag produces a stream of newline-delimited JSON (NDJSON) on stdout. Each line is a self-contained JSON object with a `type` field.

## NDJSON Format

Each line is one self-contained JSON object. No framing, no length prefixes. Parse each line independently.

```json
{ "type": "system", "subtype": "init", "session_id": "sess-1", "model": "claude-sonnet-4-6" }
{ "type": "assistant", "message": { "role": "assistant", "content": [...] } }
{ "type": "result", "subtype": "success", "total_cost_usd": 0.018 }
```

## Event Lifecycle

A typical turn follows this sequence:

1. **`system/init`** - session metadata (model, tools, session ID)
2. **`assistant`** - model output (one or more, cumulative)
3. **`user`** - tool results (if tools were used)
4. **`result`** - turn completion with cost/token data

Steps 2-3 repeat for each tool use cycle within a turn.

## The Cumulative Snapshot Problem

In `--verbose` mode, each `assistant` event contains the **full cumulative content array**, not just new blocks:

```
event 1: content = [thinking]
event 2: content = [thinking, text]           // thinking repeated
event 3: content = [thinking, text, tool_use] // both repeated
```

claude-wire's translator tracks the last seen index and only emits new blocks. This is handled automatically - you always get deduplicated events.

## Multi-Agent Interleaving

When Claude Code spawns sub-agents (via the `Agent` tool), their events interleave on the same stdout. claude-wire detects context switches by fingerprinting the first content block in each `assistant` event:

- `tool_use` blocks use their unique ID: `"tool_use:toolu_abc"`
- `text`/`thinking` blocks use the first 64 chars: `"text:Let me search..."`

When the fingerprint changes, the dedup index resets to capture the new agent's output from the beginning.

## Input Format

To send messages to Claude Code's stdin, use `--input-format stream-json`. See [Input Messages](/protocol/input-messages).
