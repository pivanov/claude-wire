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

`claude.askJson` (the stateless path) auto-derives a JSON Schema string from the Standard Schema object and forwards it to the CLI via `--json-schema` so the model is natively constrained to produce matching JSON. Auto-derivation is currently wired for these vendors:

| Vendor | Requires |
|--------|----------|
| `zod` | Zod 4+ (`z.toJSONSchema` is a top-level export). |
| `valibot` | The optional `@valibot/to-json-schema` package installed alongside `valibot`. |
| `arktype` | No extra package; ArkType schemas carry `.toJsonSchema()` natively. |

Without native CLI constraint, recent Claude Code CLI builds with `--output-format stream-json` can emit thinking-only turns on trivial prompts (the model satisfies a "respond JSON" instruction inside its reasoning block and never produces a text block). Forwarding `--json-schema` makes the CLI emit the constrained value through one of two channels:

1. A synthetic `StructuredOutput` tool_use block whose `input` is the parsed JSON.
2. A `structured_output` field on the terminal `result` event.

The SDK's translator handles both, dedupes them per turn, and surfaces the value on `raw.structuredOutput` (typed `unknown` on `TAskResult`). `askJson` reads this channel preferentially over `raw.text`. This matters because in constrained-output turns `raw.text` can contain Stop-hook nag messages (e.g. `"You MUST call the StructuredOutput tool to complete this request."`) or partial assistant commentary, which would corrupt a naive `parseAndValidate(raw.text)`. The synthetic StructuredOutput block is not surfaced as a `tool_use` relay event, so consumers iterating stream events don't see a phantom tool fire.

Streaming consumers can also observe the channel directly via the new `structured_output` relay event in the discriminated union.

If your vendor isn't listed, or you're on older Zod, the schema still validates SDK-side but the CLI runs unconstrained. Pass a JSON Schema string explicitly via `options.jsonSchema` to opt in:

```ts
const { data } = await claude.askJson("...", myZodSchema, {
  jsonSchema: JSON.stringify(z.toJSONSchema(myZodSchema)),
});
```

You can also call the helper directly:

```ts
import { standardSchemaToJsonSchema } from "@pivanov/claude-wire";

const derived = await standardSchemaToJsonSchema(myZodSchema);
// derived: '{"type":"object","properties":{...}}' or undefined
```

::: warning Sessions cannot auto-derive per call
`session.askJson()` reads the session's existing CLI process; the `--json-schema` flag is fixed at session creation. Pass the schema as a string to `jsonSchema` on `claude.session({ jsonSchema: ... })` if you need native constraint, or use stateless `claude.askJson()` per call when each call has a different schema.
:::

::: tip `allowedTools` and `StructuredOutput`
The CLI delivers `--json-schema`-constrained output through a synthetic `StructuredOutput` tool. Whenever `jsonSchema` is set, the SDK forwards a strict `--tools` whitelist that always includes `StructuredOutput`, regardless of what the caller passed in `allowedTools`:

| Caller `allowedTools` | Forwarded flag |
|---|---|
| not set | `--tools StructuredOutput` |
| `[]` | `--tools StructuredOutput` |
| `["Read"]` | `--tools Read,StructuredOutput` |
| `["Read", "StructuredOutput"]` | `--tools Read,StructuredOutput` (no duplication) |

The strict `--tools` flag is used (instead of the additive `--allowedTools`) so user-level `~/.claude/settings.json` can't leak in extra tools that would let the model bypass the StructuredOutput channel and emit plain text. The SDK also strips a top-level `$schema` URL from your JSON Schema before forwarding (Zod 4's `z.toJSONSchema` emits this by default; the CLI silently rejects schemas carrying it). You don't need to handle either concern yourself.
:::

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

### Empty text with thinking content

When the CLI emits a thinking block but no text block, both `claude.askJson` and `session.askJson` throw `JsonValidationError` with an actionable message naming the missing native constraint, instead of the misleading `"Unexpected end of JSON input"` from `JSON.parse("")`. The fix is to pass a `jsonSchema` string in options (stateless) or at session creation, or use a Standard Schema vendor that supports auto-derivation.

## Fence Stripping

Claude sometimes wraps JSON in markdown fences (`` ```json ... ``` ``). `askJson` automatically strips these before parsing, so you don't need to handle that case.

## Options

`askJson` accepts all the same options as `ask()` -- `model`, `cwd`, `maxCostUsd`, `signal`, etc. See [Client options](./client.md#iclaudeoptions).
