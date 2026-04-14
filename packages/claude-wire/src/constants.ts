import { homedir } from "node:os";

export const TIMEOUTS = {
  defaultAbortMs: 300_000,
  gracefulExitMs: 5_000,
} as const;

export const LIMITS = {
  maxRespawnAttempts: 3,
  sessionMaxTurnsBeforeRecycle: 100,
  ndjsonMaxLineChars: 10 * 1024 * 1024,
  fingerprintTextLen: 64,
} as const;

// Respawn backoff in ms, indexed by consecutiveCrashes (1st=500ms, 2nd=1s, 3rd=2s).
export const RESPAWN_BACKOFF_MS = [500, 1000, 2000] as const;

const home = homedir();

export const BINARY = {
  name: "claude",
  commonPaths: [`${home}/.local/bin/claude`, `${home}/.claude/bin/claude`, "/usr/local/bin/claude", "/opt/homebrew/bin/claude"],
} as const;
