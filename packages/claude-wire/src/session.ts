import { LIMITS, RESPAWN_BACKOFF_MS, TIMEOUTS } from "./constants.js";
import { createCostTracker } from "./cost.js";
import { AbortError, BudgetExceededError, ClaudeError, isTransientError, KnownError, ProcessError, TimeoutError } from "./errors.js";
import { createTranslator } from "./parser/translator.js";
import { buildResult } from "./pipeline.js";
import type { IClaudeProcess } from "./process.js";
import { spawnClaude } from "./process.js";
import { drainStderr, readNdjsonEvents } from "./reader.js";
import { createToolHandler } from "./tools/handler.js";
import type { TRelayEvent } from "./types/events.js";
import type { ISessionOptions } from "./types/options.js";
import type { TAskResult } from "./types/results.js";
import { writer } from "./writer.js";

export interface IClaudeSession extends AsyncDisposable {
  ask: (prompt: string) => Promise<TAskResult>;
  close: () => Promise<void>;
  sessionId: string | undefined;
}

const gracefulKill = async (p: IClaudeProcess): Promise<void> => {
  p.kill();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    await Promise.race([
      p.exited,
      new Promise<void>((r) => {
        timer = setTimeout(() => {
          timedOut = true;
          r();
        }, TIMEOUTS.gracefulExitMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
  if (timedOut) {
    try {
      p.kill();
    } catch {
      // already dead
    }
  }
};

export const createSession = (options: ISessionOptions = {}): IClaudeSession => {
  let proc: IClaudeProcess | undefined;
  let currentSessionId: string | undefined;
  let consecutiveCrashes = 0;
  let turnCount = 0;
  let costOffsets = { totalUsd: 0, inputTokens: 0, outputTokens: 0 };
  const translator = createTranslator();
  const costTracker = createCostTracker({
    maxCostUsd: options.maxCostUsd,
    onCostUpdate: options.onCostUpdate,
  });
  const toolHandler = options.tools ? createToolHandler(options.tools) : undefined;
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

  let lastStderrChunks: string[] = [];
  let lastDrainDone: Promise<void> | undefined;

  const getStderrText = (): string => lastStderrChunks.join("").trim();

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
      throw new ProcessError(`Process crashed ${consecutiveCrashes} times, giving up`);
    }
    costOffsets = costTracker.snapshot();
    killProc();
    translator.reset();
    const spawnOpts = resumeId ? { prompt, ...options, resume: resumeId } : { prompt, ...options };
    proc = spawnClaude(spawnOpts);
    reader = proc.stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const drain = drainStderr(proc);
    lastStderrChunks = drain.chunks;
    lastDrainDone = drain.done;
  };

  const respawnBackoff = async (): Promise<void> => {
    const idx = Math.min(consecutiveCrashes, RESPAWN_BACKOFF_MS.length) - 1;
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
    })) {
      if (event.type === "session_meta") {
        currentSessionId = event.sessionId;
      }

      events.push(event);

      if (event.type === "turn_complete") {
        costTracker.update(
          costOffsets.totalUsd + (event.costUsd ?? 0),
          costOffsets.inputTokens + (event.inputTokens ?? 0),
          costOffsets.outputTokens + (event.outputTokens ?? 0),
        );
        costTracker.checkBudget();
        gotTurnComplete = true;
        break;
      }
    }

    if (!gotTurnComplete) {
      if (signal?.aborted) {
        throw new AbortError();
      }
      // stdout closed → process is dying. Race `exited` against a short
      // timeout so a zombie/unreaped child doesn't hang us. If exited doesn't
      // resolve in time we leave exitCode undefined (→ non-transient).
      let exitCode: number | undefined;
      if (proc) {
        const live = proc;
        exitCode = await Promise.race([live.exited, new Promise<undefined>((r) => setTimeout(() => r(undefined), TIMEOUTS.gracefulExitMs))]);
        if (exitCode === undefined) {
          live.kill();
        }
      }
      if (lastDrainDone) {
        await Promise.race([lastDrainDone, new Promise<void>((r) => setTimeout(r, 500))]);
      }
      const stderrMsg = getStderrText();
      throw new ProcessError(stderrMsg || "Process exited without completing the turn", exitCode);
    }

    return events;
  };

  const doAsk = async (prompt: string): Promise<TAskResult> => {
    if (!proc) {
      spawnFresh(prompt, currentSessionId);
    } else {
      try {
        proc.write(writer.user(prompt));
      } catch {
        consecutiveCrashes++;
        translator.reset();
        spawnFresh(prompt, currentSessionId);
      }
    }

    let events: TRelayEvent[] | undefined;
    while (true) {
      try {
        events = await readUntilTurnComplete(options.signal);
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
        await respawnBackoff();
        spawnFresh(prompt, currentSessionId);
        // Loop to retry; stops when budget exhausted or turn completes.
      }
    }

    consecutiveCrashes = 0;
    turnCount++;

    if (turnCount >= LIMITS.sessionMaxTurnsBeforeRecycle) {
      if (proc) {
        await gracefulKill(proc);
      }
      proc = undefined;
      cleanupProcess();
      turnCount = 0;
      consecutiveCrashes = 0;
    }

    return buildResult(events, costTracker, currentSessionId);
  };

  let closed = false;

  const ask = (prompt: string): Promise<TAskResult> => {
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
        return doAsk(prompt);
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
    if (inFlight) {
      // Cap the wait: a stuck reader.read() inside the queued ask would
      // otherwise hang close() forever before gracefulKill gets a chance.
      await Promise.race([inFlight.catch(() => {}), new Promise<void>((r) => setTimeout(r, TIMEOUTS.gracefulExitMs))]);
      inFlight = undefined;
    }
    if (proc) {
      try {
        proc.write(writer.abort());
      } catch {
        // stdin may already be closed
      }
      await gracefulKill(proc);
      proc = undefined;
    }
    cleanupProcess();
  };

  return {
    ask,
    close,
    get sessionId() {
      return currentSessionId;
    },
    [Symbol.asyncDispose]: close,
  };
};
