# Why claude-wire

Claude Code speaks an undocumented NDJSON protocol on stdin/stdout. claude-wire wraps that protocol into a typed TypeScript SDK with process management, tool control, cost tracking, and streaming built in.

## What it gives you

- Spawn and manage Claude Code processes programmatically
- Stream typed events as they arrive
- Control which tools Claude can use at runtime
- Set cost budgets that auto-abort on overspend
- Run multi-turn sessions with persistent context
- Handle AbortSignal cancellation
- Auto-detect Claude CLI aliases and config directories

## Use Cases

### Agent Orchestration

Use Claude Code as one agent in a larger local workflow. Spawn multiple sessions, coordinate their output, pipe results between them.

```ts
const analyzer = claude.session({ systemPrompt: "You analyze code for bugs." });
const fixer = claude.session({ systemPrompt: "You fix bugs." });

const analysis = await analyzer.ask("Find bugs in src/auth.ts");
const fix = await fixer.ask(`Fix these bugs:\n${analysis.text}`);

await analyzer.close();
await fixer.close();
```

### Tool Approval Workflows

Build approval gates where humans or other systems decide whether Claude can use certain tools. Log every tool call for audit trails.

```ts
const result = await claude.ask("Deploy the new version", {
  toolHandler: {
    onToolUse: async (tool) => {
      await slackNotify(`Claude wants to run: ${tool.toolName}`);
      const approved = await waitForApproval(tool.toolUseId);
      return approved ? "approve" : "deny";
    },
  },
});
```

### Stateless Classification

Use `claude.askJson()` for one-shot tasks like intent classification, content extraction, or routing -- each call is isolated with no conversation history. See the [Stateless Classifier Pattern](/guides/classifier) guide for details.

```ts
import { claude } from "@pivanov/claude-wire";
import { z } from "zod";

const { data } = await claude.askJson(
  userMessage,
  z.object({ intent: z.enum(["question", "command", "feedback"]) }),
  { model: "haiku", allowedTools: [], settingSources: "" },
);
```

### Cost Tracking

Set per-request budgets and monitor your own spending to prevent runaway costs during development.

```ts
const result = await claude.ask("Refactor the auth module", {
  maxCostUsd: 0.50,
  onCostUpdate: (cost) => {
    console.log(`$${cost.totalUsd.toFixed(4)} spent so far`);
    if (cost.tokens.cacheRead) {
      console.log(`${cost.tokens.cacheRead} tokens served from cache`);
    }
  },
});
```

### Log Parsing and Analysis

Parse saved NDJSON logs from Claude Code sessions. Extract tool calls, costs, and decisions for post-hoc analysis. This works without spawning any process.

```ts
import { parseLine, createTranslator } from "@pivanov/claude-wire";
import { readFileSync } from "node:fs";

const translator = createTranslator();
const lines = readFileSync("session.ndjson", "utf-8").split("\n");

for (const line of lines) {
  const raw = parseLine(line);
  if (!raw) { continue; }

  const events = translator.translate(raw);
  for (const event of events) {
    if (event.type === "tool_use") {
      console.log(`Tool: ${event.toolName}, Input: ${JSON.stringify(event.input)}`);
    }
  }
}
```

### Testing and Mocking

Use the tool handler to mock Claude Code's tool results in tests. No real file system access needed.

```ts
const result = await claude.ask("Read config.json and validate it", {
  toolHandler: {
    onToolUse: async (tool) => {
      if (tool.toolName === "Read") {
        return { result: '{"valid": true}' };
      }
      return "deny";
    },
  },
});
```
