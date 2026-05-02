---
"@pivanov/claude-wire": patch
---

**Fix: `askJson` reliability when the model emits thinking-only turns**

### What was broken

Recent Claude Code CLI builds (with `--output-format stream-json`) can emit responses entirely inside thinking content blocks on trivial prompts, producing zero text content. `claude.askJson(prompt, zodSchema)` then failed inside `JSON.parse("")` with the misleading message `"Unexpected end of JSON input"`. The CLI's `--json-schema` flag prevents this by forcing a constrained text block to exist, but claude-wire only forwarded that flag when the caller passed a raw JSON Schema string. Standard Schema objects (Zod, Valibot, ArkType) silently fell through to prompt-engineering-only.

### What changed

**`claude.askJson` auto-derives `--json-schema` from Standard Schema objects.** When the vendor is supported, the SDK runs the vendor's converter, JSON-stringifies the result, and forwards it as `--json-schema` to the CLI alongside the existing `DEFAULT_JSON_SYSTEM_PROMPT`:

| Vendor | Requires |
|--------|----------|
| `zod` | Zod 4+ (`z.toJSONSchema` top-level export). |
| `valibot` | The optional `@valibot/to-json-schema` package. |
| `arktype` | Built-in (`schema.toJsonSchema()`). |

Converter packages are loaded via dynamic `import()` and stay optional peer deps; consumers only need them installed when they pass that vendor's schemas.

Explicit `options.jsonSchema` always wins over auto-derivation, so callers who already convert their schemas keep working.

**Top-level `$schema` is stripped from JSON Schema strings before forwarding to `--json-schema`.** The CLI silently rejects any JSON Schema that carries a top-level `$schema` URL (e.g. `"https://json-schema.org/draft/2020-12/schema"`) and falls back to plain text without firing `StructuredOutput`. Zod 4's `z.toJSONSchema` emits this field by default and many other converters do too, so callers passing converter output verbatim hit the dead end. `buildArgs` now sanitizes the schema string at the lowest layer (right before the CLI flag is appended), so every entry path is protected: auto-derived schemas, caller-supplied JSON Schema strings, and any future code path that ends up writing `--json-schema`. Nested `$schema` occurrences inside sub-schemas are preserved; only the top-level field is removed. Malformed JSON passes through unchanged so the CLI can surface its own parse error. The sanitizer is internal to `buildArgs` and not part of the public API; callers don't need to think about it.

**`StructuredOutput` is force-enabled via strict `--tools` whitelist whenever `jsonSchema` is set.** The CLI delivers schema-constrained output through a synthetic `StructuredOutput` tool. Two CLI flags interact here:

- `--allowedTools <list>` is **additive**: tools listed are added on top of `~/.claude/settings.json` and project-level allow lists.
- `--tools <list>` is a **strict whitelist**: only listed tools are available, regardless of user/project settings.

Previously every common caller setup either disabled the channel, never enabled it, or used the additive flag (which leaks user-settings tools and lets the model pick plain text instead of calling StructuredOutput):

| Caller setup | Old args | New args |
|---|---|---|
| `jsonSchema` only (no `allowedTools`) | no flag (default set excludes it) | `--tools StructuredOutput` |
| `jsonSchema` + `allowedTools: []` | `--tools ""` (strips it) | `--tools StructuredOutput` |
| `jsonSchema` + `allowedTools: ["Read"]` | `--allowedTools Read` (additive, leaks defaults) | `--tools Read,StructuredOutput` (strict) |
| `jsonSchema` + `allowedTools: ["Read", "StructuredOutput"]` | additive, leaks defaults | `--tools Read,StructuredOutput` (no duplication, strict) |
| `allowedTools: []` (no `jsonSchema`) | `--tools ""` | unchanged |
| `allowedTools: ["Read"]` (no `jsonSchema`) | `--allowedTools Read` | unchanged (additive semantics preserved for non-schema callers) |
| neither set | no flag | unchanged |

The schema branch in `buildArgs` always uses `--tools` so the constrained turn is genuinely constrained. The non-schema branch keeps its existing `--allowedTools` (additive) behavior so non-JSON callers see no behavior change. This is the root-cause fix; the changes below are defense-in-depth on top of it.

**`StructuredOutput` is exposed as `raw.structuredOutput` with two source paths and dedup.** When `--json-schema` is set, recent Claude Code CLI builds deliver the constrained JSON either via a synthetic `tool_use` block named `StructuredOutput` (with the parsed JSON in its `input` field), or via the terminal `result` event's `structured_output` field, or both. The translator emits a single new `structured_output` relay event from whichever source fires first per turn (block route preferred, result-event fallback used when the block had `undefined` input from CLI streaming partials). `buildResult` surfaces the value on a new `raw.structuredOutput` field on `TAskResult`. Both `claude.askJson` and `session.askJson` read `raw.structuredOutput` preferentially over `raw.text` because `raw.text` in constrained-output turns can carry Stop-hook nag messages ("You MUST call the StructuredOutput tool") or partial commentary that would corrupt `parseAndValidate`. The synthetic block is not surfaced as a `tool_use` relay event so consumers don't see a phantom tool fire.

**New public API surface.** `TStructuredOutputEvent` is added to the `TRelayEvent` discriminated union. `TAskResult.structuredOutput?: unknown` is added. `TClaudeEvent.structured_output?: unknown` is added on the protocol type for the result-event fallback. All additions are optional; existing consumers see no behavior change unless they pass `--json-schema`.

**Empty-text turns surface as a typed error.** Both `claude.askJson` and `session.askJson` detect `raw.text === "" && raw.thinking !== ""` after the structured-output check and throw `JsonValidationError` with an actionable message. The session variant additionally explains that `--json-schema` is bound to the long-lived process and must be set at session creation (or the caller should switch to stateless `claude.askJson` for per-call schemas). With both StructuredOutput routes in place, this error fires only when `--json-schema` was not forwarded at all (unsupported vendor or stateless caller didn't pass a schema).

**New public helper `standardSchemaToJsonSchema(schema)`.** Exported from the main `@pivanov/claude-wire` entry. Callers who want explicit control over the conversion (or who need a JSON Schema string for use outside `askJson`) can call it directly:

```ts
import { standardSchemaToJsonSchema } from "@pivanov/claude-wire";

const derived = await standardSchemaToJsonSchema(myZodSchema);
// '{"type":"object",...}' or undefined when the vendor isn't supported
```

### Practical impact

For the `wiki`-style use case (one stateless call per schema), no caller changes are needed: `claude.askJson(prompt, zodSchema)` now constrains the CLI natively when Zod 4+ is in the project. Previously this path was non-deterministically broken on Haiku.

For session-per-schema setups (ls-prove style), behavior is unchanged: continue passing `jsonSchema` (string) at session creation as before. The only new behavior is the typed empty-text error if you accidentally start a session without a schema.

### Tests

301 -> 330 passing. New coverage:
- `buildArgs` force-enables `StructuredOutput` when `jsonSchema` is set across all six caller permutations: undefined `allowedTools`, empty `allowedTools`, non-empty `allowedTools` without it, non-empty already including it, and the two no-schema cases for regression coverage.
- `buildArgs` strips top-level `$schema` from `--json-schema` and leaves nested occurrences alone; malformed strings pass through unchanged.
- Translator routes `StructuredOutput` tool_use to a `structured_output` event.
- Variants covered: with/without id, undefined input (dropped as partial-block guard), null input, regular user tools unaffected.
- Result-event fallback emits `structured_output` when the block route did not fire.
- Dedup: result-event fallback skipped when block route already emitted the value.
- Dedup state resets across turns (block route in turn 1 doesn't suppress fallback in turn 2).
- End-to-end: `claude.askJson` returns structured data via `raw.structuredOutput` from a StructuredOutput tool_use block.
- End-to-end: `claude.askJson` falls back to `result.structured_output` when the block route is missing and `raw.text` only contains a Stop-hook nag message.
- Auto-derive sets `merged.jsonSchema` for arktype-vendor schemas.
- Explicit `options.jsonSchema` wins over auto-derive.
- Unknown vendors leave `jsonSchema` unset (validation-only path).
- `standardSchemaToJsonSchema` returns `undefined` for unknown vendors and missing methods.
- Empty-text-with-thinking throws `JsonValidationError` with vendor-specific guidance in both `client.askJson` and `session.askJson`.
- Fuzz harness updated for the new relay event variant in the exhaustive switch.
