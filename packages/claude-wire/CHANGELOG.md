# @pivanov/claude-wire

## 0.0.2

### Patch Changes

- 364bf7f: ### Added

  - Node.js >= 22 runtime support via `child_process.spawn` fallback (Bun remains primary)
  - `readNdjsonEvents()` shared async generator - single source of truth for NDJSON parsing
  - `buildArgs()` exported as pure function for testing CLI arg construction
  - `settingSources` and `disableSlashCommands` options for lightweight/headless mode (~1.5s startup vs ~35s)
  - `allowedTools: []` now emits `--tools ""` to disable all tools including MCP servers
  - `Symbol.asyncDispose` on both `IClaudeSession` and `IClaudeStream`
  - Session ask() queue - concurrent calls are serialized instead of rejected
  - Session auto-respawn with `--resume` to preserve conversation context
  - 147 real tests (was 106 pass + 24 skipped stubs)

  ### Fixed

  - Process leak when stream is created but never consumed
  - Process leak when initial prompt write fails
  - Session permanently stuck after AbortError (only KnownError/BudgetExceededError block recovery now)
  - Session abort race - correctly throws AbortError instead of ProcessError
  - Stderr pipe buffer deadlock - both stream and session drain stderr on spawn
  - Cost tracking lost on session respawn (offset preservation)
  - Node.js ENOENT produces unhandled rejection instead of KnownError
  - `onCostUpdate` callback crash propagates and kills stream/session
  - Tool handler errors silently drop tool decisions
  - Tool decisions with invalid return values silently drop
  - `tool_use` events with missing `block.id` crash the writer
  - `parseDoubleEncoded` returns `[object Object]` for object results
  - Timeout promise leak per read chunk (tracked + cleared)
  - Double `proc.kill()` in recycle and close paths
  - `gracefulKill` timer leak if `proc.exited` rejects
  - Shell injection vector in `whichSync` (`execSync` -> `execFileSync`)
  - `nodeReadableToWeb` double-close crash on error+end race
  - Missing trailing buffer processing in session (final NDJSON line without `\n`)
  - Stale error messages - session now captures stderr for diagnostics

  ### Changed

  - `ISpawnOptions` extends `IClaudeOptions` (was duplicated fields)
  - Extracted shared NDJSON reader from stream.ts and session.ts into reader.ts
  - Extracted `killProc()` and `gracefulKill()` helpers in session
  - `gracefulKill` sends second kill (SIGKILL) after timeout
  - `TRANSIENT_PATTERN` tightened (`network` -> `network error|network timeout`)
  - Exit code 139 (SIGSEGV) removed from transient codes
  - `ndjsonMaxLineBytes` renamed to `ndjsonMaxLineChars`
  - `sessionMaxIdleTurns` renamed to `sessionMaxTurnsBeforeRecycle`
  - `consecutiveCrashes` counter incremented on failure, not on spawn
  - `TModelUsageEntry.cacheReadInputTokens` and `cacheCreationInputTokens` now optional
