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

### CI/CD Automation

Run Claude Code in CI pipelines with strict cost budgets and tool restrictions. Generate changelogs, fix lint errors, write tests, then parse the structured output.

```ts
const result = await claude.ask("Fix all TypeScript errors in src/", {
  cwd: process.env.GITHUB_WORKSPACE,
  maxCostUsd: 0.50,
  tools: { blocked: ["Bash"] },
});

if (result.text.includes("Fixed")) {
  await commitChanges();
}
```

### Agent Orchestration

Use Claude Code as one agent in a larger system. Spawn multiple sessions, coordinate their output, pipe results between them.

```ts
const analyzer = claude.session({ systemPrompt: "You analyze code for bugs." });
const fixer = claude.session({ systemPrompt: "You fix bugs." });

const analysis = await analyzer.ask("Find bugs in src/auth.ts");
const fix = await fixer.ask(`Fix these bugs:\n${analysis.text}`);

await analyzer.close();
await fixer.close();
```

### Server-Side Backends

Build a backend that uses claude-wire to handle requests, then serve results to a web or desktop frontend. claude-wire runs on the server (Node.js/Bun) and spawns Claude Code processes locally.

```ts
// Server-side: Bun/Node.js
import { claude } from "claude-wire";

app.post("/api/ask", async (req, res) => {
  const stream = claude.stream(req.body.prompt, { model: "haiku" });

  for await (const event of stream) {
    res.write(JSON.stringify(event) + "\n");
  }
  res.end();
});
```

### Tool Approval Workflows

Build approval gates where humans or other systems decide whether Claude can use certain tools. Log every tool call for audit trails.

```ts
const result = await claude.ask("Deploy the new version", {
  tools: {
    onToolUse: async (tool) => {
      await slackNotify(`Claude wants to run: ${tool.toolName}`);
      const approved = await waitForApproval(tool.toolUseId);
      return approved ? "approve" : "deny";
    },
  },
});
```

### Cost Monitoring

Track spending across teams, projects, or users. Set per-request budgets to prevent runaway costs.

```ts
const result = await claude.ask(userPrompt, {
  maxCostUsd: getUserBudget(userId),
  onCostUpdate: (cost) => {
    metrics.record("claude_cost_usd", cost.totalUsd, { userId });
  },
});

await db.insert("usage", {
  userId,
  costUsd: result.costUsd,
  tokens: result.tokens,
});
```

### Log Parsing and Analysis

Parse saved NDJSON logs from Claude Code sessions. Extract tool calls, costs, and decisions for post-hoc analysis. This works without spawning any process.

```ts
import { parseLine, createTranslator } from "claude-wire";
import { readFileSync } from "node:fs";

const translator = createTranslator();
const lines = readFileSync("session.ndjson", "utf-8").split("\n");

for (const line of lines) {
  const raw = parseLine(line);
  if (!raw) { continue; }

  const events = translator.translate(raw);
  for (const event of events) {
    if (event.type === "tool_use") {
      console.log(`Tool: ${event.toolName}, Input: ${event.input}`);
    }
  }
}
```

### Testing and Mocking

Use the tool handler to mock Claude Code's tool results in tests. No real file system access needed.

```ts
const result = await claude.ask("Read config.json and validate it", {
  tools: {
    onToolUse: async (tool) => {
      if (tool.toolName === "Read") {
        return { result: '{"valid": true}' };
      }
      return "deny";
    },
  },
});
```
