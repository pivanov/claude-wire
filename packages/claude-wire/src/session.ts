import { LIMITS, TIMEOUTS } from "./constants.js";
import { createCostTracker } from "./cost.js";
import { AbortError, BudgetExceededError, ClaudeError, isTransientError, KnownError, ProcessError, TimeoutError } from "./errors.js";
import { createTranslator } from "./parser/translator.js";
import { buildResult } from "./pipeline.js";
import type { IClaudeProcess } from "./process.js";
import { spawnClaude } from "./process.js";
import { readNdjsonEvents } from "./reader.js";
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

  const drainStderr = (p: IClaudeProcess) => {
    const chunks: string[] = [];
    lastStderrChunks = chunks;
    const stderrReader = p.stderr.getReader();
    const decoder = new TextDecoder();
    (async () => {
      try {
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) {
            break;
          }
          chunks.push(decoder.decode(value, { stream: true }));
        }
      } catch {
        // process exited
      } finally {
        stderrReader.releaseLock();
      }
    })().catch(() => {});
  };

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
    drainStderr(proc);
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
      const stderrMsg = getStderrText();
      throw new ProcessError(stderrMsg || "Process exited without completing the turn");
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

    let events: TRelayEvent[];
    try {
      events = await readUntilTurnComplete(options.signal);
    } catch (error) {
      if (error instanceof AbortError || error instanceof TimeoutError) {
        killProc();
        throw error;
      }
      if (isTransientError(error) && consecutiveCrashes < LIMITS.maxRespawnAttempts) {
        consecutiveCrashes++;
        spawnFresh(prompt, currentSessionId);
        try {
          events = await readUntilTurnComplete(options.signal);
        } catch (retryError) {
          killProc();
          translator.reset();
          throw retryError;
        }
      } else {
        killProc();
        translator.reset();
        throw error;
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
      .catch((prevError: unknown) => {
        if (prevError instanceof KnownError || prevError instanceof BudgetExceededError) {
          throw prevError;
        }
      })
      .then(() => doAsk(prompt));
    inFlight = run;
    return run;
  };

  const close = async (): Promise<void> => {
    closed = true;
    if (inFlight) {
      await inFlight.catch(() => {});
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
