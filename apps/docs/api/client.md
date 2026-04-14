# Client

The default `claude` export is a pre-configured client ready to use. For custom defaults, create your own with `createClient()`.

## `claude.ask(prompt, options?)`

Send a one-shot prompt and get the complete result.

```ts
const result = await claude.ask("Fix the bug in main.ts", {
  cwd: "/path/to/project",
  model: "haiku",
});
```

**Returns:** `Promise<TAskResult>`

```ts
type TAskResult = {
  text: string;                        // concatenated text output
  costUsd: number;                     // total cost in USD
  tokens: { input: number; output: number };
  duration: number;                    // ms
  sessionId?: string;
  events: TRelayEvent[];               // all events
};
```

## `claude.stream(prompt, options?)`

Returns an `IClaudeStream` - an async iterable that yields events as they arrive.

```ts
const stream = claude.stream("Explain this code");

// Option A: iterate events
for await (const event of stream) { /* ... */ }

// Option B: convenience methods (consumes the stream)
const text = await stream.text();
const cost = await stream.cost();
const result = await stream.result();
```

::: warning
Iteration and convenience methods are mutually exclusive. If you start iterating with `for await`, calling `.text()` / `.result()` will throw. Pick one approach.
:::

## `claude.session(options?)`

Create a persistent multi-turn session. See [Session](/api/session).

```ts
const session = claude.session({ cwd: ".", model: "opus" });
```

## `claude.create(defaults)`

Create a new client with preset defaults. All options are merged with per-call overrides.

```ts
const myClient = claude.create({
  cwd: "/my/project",
  model: "haiku",
  maxCostUsd: 1.00,
});

const result = await myClient.ask("What does this do?");
```

## `IClaudeOptions`

All methods accept these options:

| Option | Type | Description |
|--------|------|-------------|
| `cwd` | `string` | Working directory for the Claude process |
| `model` | `"opus" \| "sonnet" \| "haiku" \| string` | Model to use |
| `systemPrompt` | `string` | Override system prompt |
| `appendSystemPrompt` | `string` | Append to default system prompt |
| `allowedTools` | `string[]` | Tools to allow (CLI-level). Pass `[]` to disable all tools including MCP servers. |
| `tools` | `IToolHandler` | Runtime tool control (approve/deny/intercept) |
| `maxCostUsd` | `number` | SDK-side budget limit. Checked after each turn, throws `BudgetExceededError` and kills the process |
| `maxBudgetUsd` | `number` | Claude Code native budget via `--max-budget-usd`. Enforced by the CLI itself |
| `disallowedTools` | `string[]` | Tools to deny at CLI level |
| `addDirs` | `string[]` | Additional directories for tool access |
| `effort` | `"low" \| "medium" \| "high" \| "max"` | Effort level |
| `includeHookEvents` | `boolean` | Include hook lifecycle events in output |
| `includePartialMessages` | `boolean` | Include partial message chunks for real-time streaming |
| `bare` | `boolean` | Minimal mode, no hooks |
| `jsonSchema` | `string` | JSON schema for structured output validation |
| `forkSession` | `boolean` | When resuming, create a new session ID instead of reusing the original |
| `noSessionPersistence` | `boolean` | Don't save session to disk |
| `sessionId` | `string` | Use a specific UUID for the session |
| `onCostUpdate` | `(cost: TCostSnapshot) => void` | Called after each turn with cost data |
| `signal` | `AbortSignal` | Abort signal for cancellation |
| `resume` | `string` | Session ID to resume |
| `verbose` | `boolean` | Enable verbose output (default: true) |
| `mcpConfig` | `string` | Path to MCP server config JSON |
| `continueSession` | `boolean` | Continue the most recent session |
| `permissionMode` | `string` | Permission mode: `"default"`, `"plan"`, `"auto"`, `"bypassPermissions"`, `"acceptEdits"`, `"dontAsk"` |
| `configDir` | `string` | Override `CLAUDE_CONFIG_DIR` for the spawned process |
| `env` | `Record<string, string>` | Custom environment variables for the spawned process |
| `settingSources` | `string` | Pass `""` to skip loading CLAUDE.md, settings.json, and project instructions |
| `disableSlashCommands` | `boolean` | Disable slash command loading for faster startup |

::: tip Lightweight / Headless Mode
For fast startup (~1.5s instead of ~35s), disable tools, settings, and slash commands:
```ts
claude.ask("Classify this text", {
  model: "haiku",
  allowedTools: [],
  settingSources: "",
  disableSlashCommands: true,
});
```
:::

::: info Dual Budget System
`maxCostUsd` is SDK-level budget enforcement (throws `BudgetExceededError`). `maxBudgetUsd` is CLI-level enforcement (passed as `--max-budget-usd` flag). They operate independently.

**Which should I use?**
- For most SDK consumers, prefer `maxCostUsd` — you get a catchable `BudgetExceededError` in JavaScript and a `onCostUpdate` hook for live monitoring.
- Use `maxBudgetUsd` when you need the CLI to enforce the ceiling itself (e.g. the process is also accessible outside the SDK).
- Setting both is fine; whichever fires first wins.
:::
