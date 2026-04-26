import type { TKnownErrorCode } from "./errors.js";

// Conservative pattern table for classifying CLI stderr into typed error
// codes. Intentionally small -- false classification is worse than no
// classification. Documented as "may drift across CLI versions."
//
// Each entry: [pattern to test against stderr text, resulting code].
const STDERR_PATTERNS: ReadonlyArray<[RegExp, TKnownErrorCode]> = [
  [/rate[_ -]?limit|429|too many requests/i, "rate-limit"],
  [/overloaded|529|temporarily unavailable/i, "overloaded"],
  [/context[_ -]?length|context[_ -]?window|too long|maximum.*tokens/i, "context-length-exceeded"],
  [/invalid.*json[_ -]?schema|schema.*invalid|json.*schema.*error/i, "invalid-json-schema"],
  [/mcp.*error|mcp.*fail|mcp.*server/i, "mcp-error"],
  [/not authenticated|authentication failed|invalid api key|unauthorized|\b401\b/i, "not-authenticated"],
  [/permission denied|forbidden|403/i, "permission-denied"],
  [/binary.*not found|command not found|ENOENT.*claude/i, "binary-not-found"],
];

/**
 * Attempts to classify an opaque stderr string into a typed `TKnownErrorCode`.
 * Returns `undefined` when no pattern matches -- the caller should keep the
 * original `ProcessError` as-is in that case.
 *
 * The exit code is accepted but not currently used (all classification is
 * text-based). Reserved for future exit-code-specific rules.
 */
export const classifyStderr = (stderr: string, _exitCode?: number): TKnownErrorCode | undefined => {
  for (const [pattern, code] of STDERR_PATTERNS) {
    if (pattern.test(stderr)) {
      return code;
    }
  }
  return undefined;
};
