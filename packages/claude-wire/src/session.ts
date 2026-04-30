import { withTimeout } from "./async.js";
import { LIMITS, MAX_BACKOFF_INDEX, RESPAWN_BACKOFF_MS, TIMEOUTS } from "./constants.js";
import { createCostTracker } from "./cost.js";
import { AbortError, BudgetExceededError, ClaudeError, isTransientError, KnownError, processExitedEarly, TimeoutError } from "./errors.js";
import { type IJsonResult, parseAndValidate, type TSchemaInput } from "./json.js";
import { createTranslator } from "./parser/translator.js";
import { applyTurnComplete, buildResult, startPipeline } from "./pipeline.js";
import type { IClaudeProcess } from "./process.js";
import { safeKill, safeWrite } from "./process.js";
import { type IStderrDrain, readNdjsonEvents } from "./reader.js";
import { createToolHandler } from "./tools/handler.js";
import type { TRelayEvent } from "./types/events.js";
import type { IAskOptions, ISessionOptions } from "./types/options.js";
import type { TAskResult } from "./types/results.js";
import { writer } from "./writer.js";

export interface IClaudeSession extends AsyncDisposable {
  ask: (prompt: string, options?: IAskOptions) => Promise<TAskResult>;
  askJson: <T>(prompt: string, schema: import("./json.js").TSchemaInput<T>, options?: IAskOptions) => Promise<import("./json.js").IJsonResult<T>>;
  close: () => Promise<void>;
  sessionId: string | undefined;
}

// Compose two optional AbortSignals into one. If either fires, the
// returned signal aborts. Returns undefined when both inputs are undefined.
// Uses the platform `AbortSignal.any`, which owns listener lifetime --
// the manual two-addEventListener version leaked listeners on the signal
// that never fired. Available on Node 20.3+ / Bun, both within engines.
const composeSignals = (...signals: Array<AbortSignal | undefined>): AbortSignal | undefined => {
  const present = signals.filter((s): s is AbortSignal => s !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  if (present.length === 1) {
    return present[0];
  }
  return AbortSignal.any(present);
};

// Fire both session-level and per-ask onRetry, swallowing throws from either.
const fireRetry = (
  attempt: number,
  error: unknown,
  sessionLevel?: (attempt: number, error: unknown) => void,
  askLevel?: (attempt: number, error: unknown) => void,
): void => {
  try {
    sessionLevel?.(attempt, error);
  } catch {
    // observer threw -- retry still happens
  }
  try {
    askLevel?.(attempt, error);
  } catch {
    // observer threw -- retry still happens
  }
};

// Two-stage termination: SIGTERM first, escalate to SIGKILL after the
// graceful-exit timeout. A stuck child (e.g. blocked on a syscall that
// ignores SIGTERM) would otherwise survive the "graceful" path and leak.
// The sentinel value distinguishes "exited on time" from "timeout fired"
// without a side-channel boolean.
const KILL_TIMED_OUT = Symbol("kill-timed-out");

const gracefulKill = async (p: IClaudeProcess): Promise<void> => {
  safeKill(p, "SIGTERM");
  const outcome = await withTimeout(p.exited, TIMEOUTS.gracefulExitMs, () => KILL_TIMED_OUT);
  if (outcome === KILL_TIMED_OUT) {
    safeKill(p, "SIGKILL");
  }
};

/**
 * Creates a multi-turn Claude session backed by a single long-lived CLI
 * process. Each `ask()` sends a user prompt and resolves with `TAskResult`
 * for that turn. Calls are serialized -- a second `ask()` waits for the
 * first to complete. Use `close()` (or `await using`) to free the process.
 *
 * ### Retry behavior
 * Each `ask()` automatically retries transient failures -- process crashes
 * matching SIGKILL/SIGTERM/SIGPIPE exit codes, `ECONNRESET`, `ECONNREFUSED`,
 * `ETIMEDOUT`, `EHOSTUNREACH`, `ENETUNREACH`, `EAI_AGAIN`, Anthropic
 * `overloaded_error` / 529s, broken-pipe / "socket hang up" messages, etc.
 * (see `isTransientError`). Backoff is `500ms → 1s → 2s`; the budget is
 * `LIMITS.maxRespawnAttempts` (currently 3) and is shared across a single
 * `ask()`. When the budget is exhausted the session throws
 * `KnownError("retry-exhausted")` and marks itself closed.
 *
 * Fatal errors -- `KnownError` and `BudgetExceededError` -- also close the
 * session. Any subsequent `ask()` on a closed session rejects with
 * `ClaudeError("Session is closed")`. All other errors (abort, timeout,
 * non-transient `ProcessError`) propagate without closing, and the caller
 * may decide whether to retry at a higher level.
 *
 * ### Observability
 * - `onCostUpdate(snapshot)` -- fires after every `turn_complete`.
 * - `onRetry(attempt, error)` -- fires each time a transient failure triggers
 *   a respawn inside one `ask()`. Attempt is 1-indexed.
 * - `onWarning(message, cause)` -- routes all library-emitted warnings.
 */
export const createSession = (options: ISessionOptions = {}): IClaudeSession => {
  let proc: IClaudeProcess | undefined;
  let currentSessionId: string | undefined;
  let consecutiveCrashes = 0;
  let turnCount = 0;
  let costOffsets = { totalUsd: 0, tokens: { input: 0, output: 0 } };
  const translator = createTranslator();
  const costTracker = createCostTracker({
    maxCostUsd: options.maxCostUsd,
    onCostUpdate: options.onCostUpdate,
    onWarning: options.onWarning,
  });
  const toolHandler = options.toolHandler ? createToolHandler(options.toolHandler) : undefined;
  let inFlight: Promise<TAskResult> | undefined;

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  const cleanupProcess = () => {
    if (reader) {
      try {
        reader.releaseLock();
      } catch {
        // already released
      }
    }
    reader = undefined;
  };

  // Drain handle from the most recent spawn. Stored as a whole so we
  // can call `.text()` (shared helper on IStderrDrain) instead of
  // reimplementing chunks.join/trim at every use site.
  let lastStderrDrain: IStderrDrain | undefined;
  const getStderrText = (): string => lastStderrDrain?.text() ?? "";

  const killProc = () => {
    if (proc) {
      proc.kill();
      proc.exited.catch(() => {});
    }
    proc = undefined;
    cleanupProcess();
  };

  const spawnFresh = (prompt?: string, resumeId?: string) => {
    if (consecutiveCrashes >= LIMITS.maxRespawnAttempts) {
      killProc();
      // Typed code so consumers can pattern-match on
      // `KnownError && err.code === "retry-exhausted"` without parsing strings.
      throw new KnownError("retry-exhausted", `Process crashed ${consecutiveCrashes} times, giving up`);
    }
    costOffsets = costTracker.snapshot();
    killProc();
    translator.reset();
    // Respawn always overrides caller-supplied options.resume with the live
    // session id when one is available: mid-session recovery must resume the
    // same conversation, not whatever static id was passed at construction.
    const spawnOpts = resumeId ? { prompt, ...options, resume: resumeId } : { prompt, ...options };
    const pipeline = startPipeline(spawnOpts);
    proc = pipeline.proc;
    reader = pipeline.reader;
    lastStderrDrain = pipeline.stderr;
  };

  const respawnBackoff = async (): Promise<void> => {
    // consecutiveCrashes starts at 1 for the first retry; idx points
    // into RESPAWN_BACKOFF_MS and clamps to the last defined entry for
    // any crash count beyond the table length.
    const idx = Math.min(consecutiveCrashes, MAX_BACKOFF_INDEX) - 1;
    const delay = idx >= 0 ? RESPAWN_BACKOFF_MS[idx] : 0;
    if (delay) {
      await new Promise((r) => setTimeout(r, delay));
    }
  };

  const readUntilTurnComplete = async (signal?: AbortSignal): Promise<TRelayEvent[]> => {
    if (!proc || !reader) {
      throw new ClaudeError("Session not started");
    }

    const events: TRelayEvent[] = [];
    let gotTurnComplete = false;

    for await (const event of readNdjsonEvents({
      reader,
      translator,
      toolHandler,
      proc,
      signal,
      onWarning: options.onWarning,
      inactivityTimeoutMs: options.inactivityTimeoutMs,
    })) {
      if (event.type === "session_meta") {
        currentSessionId = event.sessionId;
      }

      events.push(event);

      if (event.type === "turn_complete") {
        applyTurnComplete(event, costTracker, costOffsets);
        gotTurnComplete = true;
        break;
      }
    }

    if (!gotTurnComplete) {
      if (signal?.aborted) {
        throw new AbortError();
      }
      // stdout closed → process is dying. Wait briefly for exited so we
      // can attach an exit code to the error; if it doesn't resolve in
      // time, force-kill and leave exitCode undefined (→ non-transient).
      let exitCode: number | undefined;
      if (proc) {
        const live = proc;
        exitCode = await withTimeout<number, undefined>(live.exited, TIMEOUTS.gracefulExitMs);
        if (exitCode === undefined) {
          live.kill();
        }
      }
      if (lastStderrDrain) {
        await withTimeout(lastStderrDrain.done, TIMEOUTS.stderrDrainGraceMs);
      }
      throw processExitedEarly(getStderrText(), exitCode);
    }

    return events;
  };

  const doAsk = async (prompt: string, askOpts?: IAskOptions): Promise<TAskResult> => {
    // Reset per-ask so a prior abort/timeout doesn't bleed crash budget
    // into the next ask. The budget is per-ask, not per-session.
    consecutiveCrashes = 0;

    if (!proc) {
      spawnFresh(prompt, currentSessionId);
    } else if (!safeWrite(proc, writer.user(prompt))) {
      // stdin write failed -- process probably died. Try to respawn.
      // spawnFresh can itself throw ProcessError synchronously when the
      // respawn cap is already hit; surface as an Error like the retry
      // loop below would, instead of a raw synchronous throw.
      consecutiveCrashes++;
      translator.reset();
      try {
        spawnFresh(prompt, currentSessionId);
      } catch (respawnError) {
        killProc();
        throw respawnError;
      }
    }

    // Compose per-ask signal with session-level signal: either firing aborts.
    const effectiveSignal = composeSignals(options.signal, askOpts?.signal, closeController.signal);

    let events: TRelayEvent[] | undefined;
    while (true) {
      try {
        events = await readUntilTurnComplete(effectiveSignal);
        break;
      } catch (error) {
        if (error instanceof AbortError || error instanceof TimeoutError) {
          killProc();
          throw error;
        }
        if (!isTransientError(error) || consecutiveCrashes >= LIMITS.maxRespawnAttempts) {
          killProc();
          translator.reset();
          throw error;
        }
        consecutiveCrashes++;
        // Fire both session-level and per-ask onRetry. Both are safe-invoked
        // so a throwing observer doesn't prevent the retry.
        fireRetry(consecutiveCrashes, error, options.onRetry, askOpts?.onRetry);
        await respawnBackoff();
        spawnFresh(prompt, currentSessionId);
        // Loop to retry; stops when budget exhausted or turn completes.
      }
    }

    consecutiveCrashes = 0;
    turnCount++;

    if (askOpts?.onCostUpdate) {
      try {
        askOpts.onCostUpdate(costTracker.snapshot());
      } catch {
        // observer threw -- ask still returns normally
      }
    }

    if (turnCount >= LIMITS.sessionMaxTurnsBeforeRecycle) {
      if (proc) {
        await gracefulKill(proc);
      }
      proc = undefined;
      cleanupProcess();
      turnCount = 0;
      consecutiveCrashes = 0;
      if (options.onRecycle) {
        try {
          options.onRecycle("turn-limit");
        } catch {
          // observer threw -- recycle already happened, ignore
        }
      }
    }

    return buildResult(events, costTracker, currentSessionId);
  };

  let closed = false;
  // Fires on close() so a mid-flight ask blocked in reader.read() bails out instead of waiting on gracefulExitMs.
  const closeController = new AbortController();

  const ask = (prompt: string, askOpts?: IAskOptions): Promise<TAskResult> => {
    if (closed) {
      return Promise.reject(new ClaudeError("Session is closed"));
    }
    const prev = inFlight ?? Promise.resolve();
    const run = prev
      .catch(() => {
        // Prior ask failure shouldn't prevent this one from running. Fatal
        // errors (KnownError/BudgetExceededError) set `closed` in the .catch
        // below, which the sync check above picks up on the NEXT ask.
      })
      .then(() => {
        if (closed) {
          throw new ClaudeError("Session is closed");
        }
        return doAsk(prompt, askOpts);
      })
      .catch((error: unknown) => {
        if (error instanceof KnownError || error instanceof BudgetExceededError) {
          closed = true;
        }
        throw error;
      });
    inFlight = run;
    return run;
  };

  const close = async (): Promise<void> => {
    closed = true;
    closeController.abort();
    if (inFlight) {
      // Cap the wait: a stuck reader.read() inside the queued ask would
      // otherwise hang close() forever before gracefulKill gets a chance.
      await withTimeout(
        inFlight.catch(() => {}),
        TIMEOUTS.gracefulExitMs,
      );
      inFlight = undefined;
    }
    if (proc) {
      safeWrite(proc, writer.abort());
      await gracefulKill(proc);
      proc = undefined;
    }
    cleanupProcess();
  };

  const askJson = async <T>(prompt: string, schema: TSchemaInput<T>, askOpts?: IAskOptions): Promise<IJsonResult<T>> => {
    const raw = await ask(prompt, askOpts);
    const data = await parseAndValidate(raw.text, schema);
    return { data, raw };
  };

  return {
    ask,
    askJson,
    close,
    get sessionId() {
      return currentSessionId;
    },
    [Symbol.asyncDispose]: close,
  };
};
