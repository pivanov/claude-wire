import { homedir } from "node:os";

export const TIMEOUTS = {
  defaultAbortMs: 300_000,
  gracefulExitMs: 5_000,
  // Grace period for stderr drain to catch up before an error is thrown so
  // the error message carries the CLI's actual complaint instead of "".
  stderrDrainGraceMs: 500,
} as const;

export const LIMITS = {
  maxRespawnAttempts: 3,
  sessionMaxTurnsBeforeRecycle: 100,
  ndjsonMaxLineChars: 10 * 1024 * 1024,
  fingerprintTextLen: 64,
} as const;

// Respawn backoff in ms, indexed by consecutiveCrashes (1st=500ms, 2nd=1s, 3rd=2s).
export const RESPAWN_BACKOFF_MS = [500, 1000, 2000] as const;

// Highest index into RESPAWN_BACKOFF_MS[]. Used by respawnBackoff() to
// clamp the delay lookup to the last defined backoff when crashes exceed
// the table length -- keeps the table and its bound co-located.
export const MAX_BACKOFF_INDEX = RESPAWN_BACKOFF_MS.length;

const home = homedir();

export const BINARY = {
  name: "claude",
  commonPaths: [`${home}/.local/bin/claude`, `${home}/.claude/bin/claude`, "/usr/local/bin/claude", "/opt/homebrew/bin/claude"],
} as const;
