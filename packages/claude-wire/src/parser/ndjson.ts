import type { TClaudeEvent } from "../types/protocol.js";
import type { TWarn } from "../warnings.js";

// Truncation cap for the snippet we echo back in warnings. Long JSON
// payloads would otherwise flood consumer logs; 120 chars is enough to
// see the start of a malformed event without bloating the output.
const WARN_SNIPPET_MAX = 120;

export const parseLine = (line: string, onWarning?: TWarn): TClaudeEvent | undefined => {
  const trimmed = line.trim();
  if (trimmed === "") {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as TClaudeEvent;
  } catch (error) {
    // A malformed NDJSON line means either a CLI bug or stderr leaking
    // into stdout. Surface it through onWarning so integrations can
    // distinguish "no data" from "corrupted data" instead of swallowing
    // the line silently. The snippet is truncated to avoid spamming logs.
    if (onWarning) {
      const snippet = trimmed.length > WARN_SNIPPET_MAX ? `${trimmed.slice(0, WARN_SNIPPET_MAX)}…` : trimmed;
      onWarning(`Skipped malformed NDJSON line: ${snippet}`, error);
    }
    return undefined;
  }
};
