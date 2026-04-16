# Examples

Interactive example runner with 8 demos covering every major feature.

## Setup

```bash
git clone https://github.com/pivanov/claude-wire
cd claude-wire
bun install
```

Requires Claude Code CLI installed and authenticated.

## Run

```bash
bun run examples
```

This opens an interactive menu where you pick which example to run. After each example, you can run another or exit.

## Available Examples

| # | Name | What it demonstrates |
|---|------|----------------------|
| 01 | One-shot ask | `claude.ask()` with typed result, cost, tokens, duration |
| 02 | Event streaming | `claude.stream()` with `for await` loop, event timeline |
| 03 | Multi-turn session | `claude.session()` with two turns, cumulative cost |
| 04 | Tool control | `toolHandler.allowed`, `toolHandler.blocked`, custom `onToolUse` handler |
| 05 | Cost budget | `maxCostUsd` limit with `onCostUpdate` callback |
| 06 | Abort with timeout | `AbortSignal.timeout()` cancellation |
| 07 | System prompt | Custom `systemPrompt` to change Claude's behavior |
| 08 | Resume session | Create a session, then resume it by ID |

All examples use `model: "haiku"` for fast, cheap responses.
