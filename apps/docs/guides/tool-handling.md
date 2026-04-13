# Tool Handling

Control which tools Claude can use and intercept tool executions at runtime.

## Allow List

Only permit specific tools:

```ts
const result = await claude.ask("Analyze the codebase", {
  tools: {
    allowed: ["Read", "Glob", "Grep"],
  },
});
```

Any tool not in the list is automatically denied.

## Block List

Block specific tools while allowing everything else:

```ts
const result = await claude.ask("Refactor utils", {
  tools: {
    blocked: ["Bash", "Write"],
  },
});
```

## Custom Handler

Intercept each tool use with a callback:

```ts
const result = await claude.ask("Fix the bug", {
  tools: {
    onToolUse: async (tool) => {
      console.log(`Claude wants to use ${tool.toolName}`);

      if (tool.toolName === "Edit") {
        return "approve";
      }

      if (tool.toolName === "Bash") {
        return "deny";
      }

      // Provide a custom result instead of running the tool
      return { result: "mocked file contents" };
    },
  },
});
```

The handler receives a `TToolUseEvent` and must return one of:
- `"approve"` - let the tool execute
- `"deny"` - block the tool
- `{ result: string }` - skip execution, send this as the tool result

## Precedence

When multiple options are set, they're evaluated in this order:

1. **`blocked`** - if the tool is blocked, deny immediately
2. **`allowed`** - if an allow list exists and the tool isn't in it, deny
3. **`onToolUse`** - call the custom handler
4. **Default** - approve

## Built-in Tools

claude-wire exports a set of known built-in Claude Code tools:

```ts
import { BUILT_IN_TOOLS, isBuiltInTool } from "@pivanov/claude-wire";

console.log(BUILT_IN_TOOLS); // Set { "Read", "Write", "Edit", "Bash", ... }
console.log(isBuiltInTool("Read")); // true
console.log(isBuiltInTool("my-mcp-tool")); // false
```

::: warning
`BUILT_IN_TOOLS` is a best-effort snapshot and may not include tools added in newer Claude Code versions. For the authoritative list, check the `tools` array in the `session_meta` event from a live session.
:::
