# Structured JSON (`askJson`)

Get typed, validated JSON from Claude in a single call. Available on both the client and sessions.

## `claude.askJson(prompt, schema, options?)`

```ts
import { claude } from "@pivanov/claude-wire";
import { z } from "zod";

const schema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
});

const { data, raw } = await claude.askJson(
  "Analyze sentiment: 'This library is great!'",
  schema,
);

console.log(data.sentiment);  // "positive"
console.log(data.confidence); // 0.95
console.log(raw.costUsd);     // 0.001
```

## `session.askJson(prompt, schema, options?)`

Same API, but within a persistent session:

```ts
const session = claude.session({ model: "sonnet" });

const { data } = await session.askJson(
  "List the exports of src/index.ts as JSON",
  z.object({ exports: z.array(z.string()) }),
);

console.log(data.exports);
await session.close();
```

## Schema Input

`askJson` accepts two kinds of schema:

### Standard Schema objects (recommended)

Any object that implements the [Standard Schema](https://github.com/standard-schema/standard-schema) protocol -- Zod, Valibot, ArkType, and others. Provides full TypeScript inference and runtime validation.

```ts
import { z } from "zod";

// Zod
const { data } = await claude.askJson("...", z.object({ name: z.string() }));
//    ^? { name: string }
```

### Raw JSON Schema strings

A JSON Schema string forwarded to Claude Code via `--json-schema`. The CLI constrains the model output to match the schema. No runtime validation is performed SDK-side -- the model's compliance is trusted.

```ts
const schema = JSON.stringify({
  type: "object",
  properties: { name: { type: "string" } },
  required: ["name"],
});

const { data } = await claude.askJson<{ name: string }>("...", schema);
```

## Return Type

```ts
interface IJsonResult<T> {
  data: T;            // parsed and validated result
  raw: TAskResult;    // full result with text, cost, tokens, events
}
```

## Error Handling

Throws `JsonValidationError` when parsing or validation fails:

```ts
import { JsonValidationError } from "@pivanov/claude-wire";

try {
  const { data } = await claude.askJson("...", schema);
} catch (error) {
  if (error instanceof JsonValidationError) {
    console.error("Raw response:", error.rawText);
    console.error("Issues:", error.issues);
    // issues: [{ message: "Expected string, received number", path: ["name"] }]
  }
}
```

**`JsonValidationError` properties:**
- `rawText: string` -- the raw text that failed to parse or validate
- `issues: ReadonlyArray<{ message?: string; path?: ReadonlyArray<string | number> }>` -- structured validation issues

## Fence Stripping

Claude sometimes wraps JSON in markdown fences (`` ```json ... ``` ``). `askJson` automatically strips these before parsing, so you don't need to handle that case.

## Options

`askJson` accepts all the same options as `ask()` -- `model`, `cwd`, `maxCostUsd`, `signal`, etc. See [Client options](./client.md#iclaudeoptions).
