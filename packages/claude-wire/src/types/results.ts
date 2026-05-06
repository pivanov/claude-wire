import type { TRelayEvent } from "./events.js";

export type TCostSnapshot = {
  totalUsd: number;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheCreation: number;
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
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheCreation: number;
  // Undefined when the CLI closed stdout without sending a `turn_complete`
  // (aborted/partial runs). Previously coerced to 0, which looked like a
  // legitimately-measured 0ms turn.
  duration: number | undefined;
  sessionId?: string;
  events: TRelayEvent[];
};
