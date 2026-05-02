import type { TRelayEvent } from "./events.js";

// Unified token shape shared between TAskResult and TCostSnapshot.
// Previously TCostSnapshot used { inputTokens, outputTokens } while
// TAskResult used { tokens: { input, output } } -- two names for the
// same concept. Consolidated to the shorter form everywhere.
//
// `input` is the total of all input tokens (base + cache read + cache creation).
// `cacheRead` and `cacheCreation` break out the cached portions so callers
// can verify prompt caching is working and compute accurate billing.
export type TTokens = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheCreation?: number;
};

export type TCostSnapshot = {
  totalUsd: number;
  tokens: TTokens;
};

export type TAskResult = {
  text: string;
  // Empty string when no thinking blocks were emitted (effort/model dependent),
  // not undefined, so callers can concatenate without null-checks.
  thinking: string;
  // Set when the CLI was given --json-schema and produced a constrained
  // value (either via the synthetic StructuredOutput tool_use block or via
  // the terminal result event's structured_output field). `askJson` reads
  // this preferentially over `text` because `text` can contain unrelated
  // commentary (Stop-hook nag messages, partial assistant text) that breaks
  // a naive parseAndValidate. Undefined when --json-schema wasn't set or
  // the model didn't produce a structured value.
  structuredOutput?: unknown;
  costUsd: number;
  tokens: TTokens;
  // Undefined when the CLI closed stdout without sending a `turn_complete`
  // (aborted/partial runs). Previously coerced to 0, which looked like a
  // legitimately-measured 0ms turn.
  duration: number | undefined;
  sessionId?: string;
  events: TRelayEvent[];
};
