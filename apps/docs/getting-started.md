# Getting Started

## Prerequisites

- [Claude Code CLI](https://claude.ai/download) installed and authenticated
- [Bun](https://bun.sh) >= 1.0 or Node.js >= 22

## Installation

::: code-group
```bash [bun]
bun add @pivanov/claude-wire
```
```bash [npm]
npm install @pivanov/claude-wire
```
```bash [yarn]
yarn add @pivanov/claude-wire
```
```bash [pnpm]
pnpm add @pivanov/claude-wire
```
:::

## Your First Request

```ts
import { claude } from "@pivanov/claude-wire";

const result = await claude.ask("What is 2 + 2?", {
  model: "haiku",
});

console.log(result.text);       // "4"
console.log(result.costUsd);    // 0.0012
console.log(result.tokens);     // { input: 42, output: 8 }
console.log(result.duration);   // 1200
```

`claude.ask()` spawns a Claude Code process, sends the prompt, collects all events, and returns a typed `TAskResult`.

## Streaming Events

For real-time output, use `claude.stream()`:

```ts
for await (const event of claude.stream("Explain closures in JS")) {
  switch (event.type) {
    case "text":
      process.stdout.write(event.content);
      break;
    case "thinking":
      console.log("[think]", event.content);
      break;
    case "tool_use":
      console.log(`[tool] ${event.toolName}`);
      break;
    case "turn_complete":
      console.log(`\nDone - $${event.costUsd?.toFixed(4)}`);
      break;
  }
}
```

## Structured JSON Output

Use `askJson()` to get typed, validated JSON responses:

```ts
import { claude } from "@pivanov/claude-wire";
import { z } from "zod";

const schema = z.object({
  summary: z.string(),
  score: z.number().min(0).max(100),
});

const { data } = await claude.askJson(
  "Rate this code on a 0-100 scale and summarize it",
  schema,
  { model: "haiku" },
);

console.log(data.summary); // "Clean utility module..."
console.log(data.score);   // 82
```

`askJson()` accepts any [Standard Schema](https://github.com/standard-schema/standard-schema) object (Zod, Valibot, ArkType) or a raw JSON Schema string. It returns `{ data: T, raw: TAskResult }`. Throws `JsonValidationError` if parsing or validation fails.

Also available on sessions: `session.askJson(prompt, schema)`.

## Multi-Turn Sessions

Keep a process alive across multiple questions:

```ts
const session = claude.session({ model: "haiku" });

const r1 = await session.ask("What is a monad?");
const r2 = await session.ask("Give me a TypeScript example.");

await session.close();
```

## Runnable Examples

Clone the repo and try the interactive example runner:

```bash
git clone https://github.com/pivanov/claude-wire
cd claude-wire && bun install
bun run examples
```

See [Examples](/guides/examples) for the full list.
