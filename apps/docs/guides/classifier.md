# Stateless Classifier Pattern

Use `claude.askJson()` for one-shot classification, extraction, or routing tasks where each call is independent and prior conversation context is noise.

::: warning Don't use sessions for stateless work
`session.askJson()` keeps the full conversation in context -- every turn sees all prior turns. Input tokens grow with each call, and prior messages add noise to classification. For independent prompts, use the top-level `claude.askJson()` instead.
:::

## Pattern

```ts
import { claude, JsonValidationError } from "@pivanov/claude-wire";
import { z } from "zod";

const IntentSchema = z.object({
  intent: z.enum(["question", "command", "feedback", "other"]),
  confidence: z.number().min(0).max(1),
});

const CLASSIFIER_OPTIONS = {
  model: "haiku" as const,
  systemPrompt: "You are an intent classifier. Return JSON only.",
  allowedTools: [],
  settingSources: "",
  disableSlashCommands: true,
  permissionMode: "bypassPermissions" as const,
};

export const classify = async (text: string) => {
  const { data, raw } = await claude.askJson(text, IntentSchema, {
    ...CLASSIFIER_OPTIONS,
    signal: AbortSignal.timeout(25_000),
  });
  return { data, raw };
};
```

Each `claude.askJson()` call spawns a fresh process -- no history carry-over, no serialization needed, full isolation between calls.

## Why not a session?

| | `claude.askJson()` | `session.askJson()` |
|---|---|---|
| History | None -- each call is isolated | Accumulates every prior turn |
| Input tokens | Constant (system prompt + user message) | Grows with each call |
| Concurrency | Safe -- independent processes | Serialized via internal queue |
| Process lifetime | One per call | Long-lived, reused |

## Recommended options

| Option | Value | Why |
|--------|-------|-----|
| `allowedTools: []` | Disable all tools | Classifiers don't need file access or shell |
| `settingSources: ""` | Skip CLAUDE.md loading | Faster startup, no project instructions injected |
| `disableSlashCommands: true` | Skip slash command loading | Faster startup |
| `bare: true` | Minimal mode | No hooks or plugins |
| `permissionMode: "bypassPermissions"` | No permission prompts | Required for non-interactive use |

## Verifying prompt caching

Check `raw.tokens.cacheRead` to confirm the system prompt is being cached across calls:

```ts
const { data, raw } = await claude.askJson(text, Schema, options);

console.log(raw.tokens.input);         // total input tokens (includes cached)
console.log(raw.tokens.cacheRead);     // tokens read from cache (billed at ~10%)
console.log(raw.tokens.cacheCreation); // tokens written to cache (billed at ~125%)
```

If `cacheRead` is non-zero, the system prompt is being served from Anthropic's prompt cache. For a static 5k-token system prompt on repeated calls, cache hits cut input billing significantly.

## Cold start trade-off

Each `claude.askJson()` call spawns a new CLI process. With the recommended options above, expect ~1-2s cold start. This is the right trade-off for correctness-first classifiers.

If cold start latency is a problem for your QPS requirements, [open an issue](https://github.com/pivanov/claude-wire/issues) -- a warm subprocess pool is planned for a future release.
