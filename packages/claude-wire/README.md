# claude-wire

Run [Claude Code](https://claude.ai/download) programmatically from TypeScript. Spawn processes, stream typed events, manage sessions, control tools, track costs.

[![npm](https://img.shields.io/npm/v/claude-wire)](https://www.npmjs.com/package/claude-wire)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/claude-wire)](https://bundlephobia.com/package/claude-wire)
[![license](https://img.shields.io/npm/l/claude-wire)](https://github.com/pivanov/claude-wire/blob/main/LICENSE)

## Features

- **Simple API** - `claude.ask()` and `claude.stream()`, nothing else to learn
- **Tool control** - allow, block, or intercept any tool at runtime
- **Multi-turn sessions** - keep a process alive across multiple prompts
- **Cost tracking** - per-request budgets with auto-abort on overspend
- **Fully typed** - discriminated union events, typed options, full IntelliSense
- **Resilient** - auto-respawn on crash, transient error detection, AbortSignal support
- **Zero dependencies** - 13 kB gzipped

## Install

```bash
bun add claude-wire
# or
npm install claude-wire
```

**Requires:** [Claude Code CLI](https://claude.ai/download) installed and authenticated. Node.js 22+ or Bun.

> **Note:** This SDK wraps Claude Code's `--output-format stream-json` protocol, which is not officially documented by Anthropic. The protocol may change between Claude Code releases.

## Quick Start

```ts
import { claude } from "claude-wire";

const result = await claude.ask("Fix the bug in main.ts", {
  model: "haiku",
  maxCostUsd: 0.50,
});

console.log(result.text);     // "Fixed the undefined variable..."
console.log(result.costUsd);  // 0.0084
console.log(result.tokens);   // { input: 31570, output: 205 }
```

## Streaming

```ts
for await (const event of claude.stream("Explain closures in JS")) {
  switch (event.type) {
    case "text":
      process.stdout.write(event.content);
      break;
    case "tool_use":
      console.log(`[tool] ${event.toolName}`);
      break;
    case "turn_complete":
      console.log(`Cost: $${event.costUsd?.toFixed(4)}`);
      break;
  }
}
```

## Multi-Turn Sessions

```ts
const session = claude.session({ model: "sonnet" });

try {
  const r1 = await session.ask("What is this codebase?");
  const r2 = await session.ask("Add tests for the auth module.");
} finally {
  await session.close();
}
```

## Tool Control

```ts
const result = await claude.ask("Refactor the utils folder", {
  tools: {
    allowed: ["Read", "Glob", "Grep"],
    blocked: ["Bash"],
    onToolUse: async (tool) => {
      console.log(`Claude wants to use: ${tool.toolName}`);
      return "approve"; // or "deny" or { result: "mocked" }
    },
  },
});
```

## Cost Budgets

```ts
const result = await claude.ask("Analyze this monorepo", {
  maxCostUsd: 0.50,
  onCostUpdate: (cost) => {
    console.log(`$${cost.totalUsd.toFixed(4)} spent`);
  },
});
```

## Abort

```ts
const result = await claude.ask("Deep analysis", {
  signal: AbortSignal.timeout(30_000),
});
```

## Examples

Clone the repo and try the interactive examples:

```bash
git clone https://github.com/pivanov/claude-wire
cd claude-wire && bun install
bun run examples
```

## Documentation

Full docs at [pivanov.github.io/claude-wire](https://pivanov.github.io/claude-wire/)

## License

MIT
