import { LIMITS, TIMEOUTS } from "./constants.js";
import { createCostTracker } from "./cost.js";
import { AbortError, ClaudeError, isTransientError, KnownError, ProcessError, TimeoutError } from "./errors.js";
import { parseLine } from "./parser/ndjson.js";
import { createTranslator } from "./parser/translator.js";
import { buildResult, dispatchToolDecision } from "./pipeline.js";
import type { IClaudeProcess } from "./process.js";
import { spawnClaude } from "./process.js";
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
  await Promise.race([
    p.exited,
    new Promise<void>((r) => {
      timer = setTimeout(r, TIMEOUTS.gracefulExitMs);
    }),
  ]);
  if (timer) {
    clearTimeout(timer);
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
  let buffer = "";
  let decoder = new TextDecoder();

  const cleanupProcess = () => {
    if (reader) {
      try {
        reader.releaseLock();
      } catch {
        // already released
      }
    }
    reader = undefined;
    buffer = "";
    decoder = new TextDecoder();
  };

  const spawnFresh = (prompt?: string, resumeId?: string) => {
    if (consecutiveCrashes >= LIMITS.maxRespawnAttempts) {
      if (proc) {
        proc.kill();
        proc.exited.catch(() => {});
      }
      cleanupProcess();
      throw new ProcessError(`Process crashed ${consecutiveCrashes} times, giving up`);
    }
    costOffsets = costTracker.snapshot();
    if (proc) {
      proc.kill();
      proc.exited.catch(() => {});
    }
    cleanupProcess();
    translator.reset();
    const spawnOpts = resumeId ? { prompt, ...options, resume: resumeId } : { prompt, ...options };
    proc = spawnClaude(spawnOpts);
    reader = proc.stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    drainStderr(proc);
  };

  const drainStderr = (p: IClaudeProcess) => {
    const stderrReader = p.stderr.getReader();
    const pump = async () => {
      try {
        while (true) {
          const { done } = await stderrReader.read();
          if (done) {
            break;
          }
        }
      } catch {
        // process exited
      } finally {
        stderrReader.releaseLock();
      }
    };
    pump().catch(() => {});
  };

  const readUntilTurnComplete = async (signal?: AbortSignal): Promise<TRelayEvent[]> => {
    if (!proc || !reader) {
      throw new ClaudeError("Session not started");
    }

    const events: TRelayEvent[] = [];
    const timeoutMs = TIMEOUTS.defaultAbortMs;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const abortHandler = signal
      ? () => {
          proc?.kill();
        }
      : undefined;

    if (signal && abortHandler) {
      if (signal.aborted) {
        throw new AbortError();
      }
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    try {
      while (true) {
        if (signal?.aborted) {
          throw new AbortError();
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new TimeoutError(`No data received within ${timeoutMs}ms`));
          }, timeoutMs);
        });
        const readResult = await Promise.race([reader.read(), timeoutPromise]);
        clearTimeout(timeoutId);
        const { done, value } = readResult;
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        if (buffer.length > LIMITS.ndjsonMaxLineChars) {
          throw new ClaudeError(`NDJSON buffer exceeded ${LIMITS.ndjsonMaxLineChars} chars`);
        }

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const raw = parseLine(line);
          if (!raw) {
            continue;
          }

          const translated = translator.translate(raw);

          for (const event of translated) {
            if (event.type === "tool_use" && toolHandler && proc) {
              await dispatchToolDecision(proc, toolHandler, event);
            }

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
              return events;
            }
          }
        }
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }

    if (!events.some((e) => e.type === "turn_complete")) {
      throw new ProcessError("Process exited without completing the turn");
    }

    return events;
  };

  const buildTurnResult = (events: TRelayEvent[]): TAskResult => {
    return buildResult(events, costTracker, currentSessionId);
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
        if (proc) {
          proc.kill();
        }
        proc = undefined;
        cleanupProcess();
        throw error;
      }
      if (isTransientError(error) && consecutiveCrashes < LIMITS.maxRespawnAttempts) {
        consecutiveCrashes++;
        spawnFresh(prompt, currentSessionId);
        try {
          events = await readUntilTurnComplete(options.signal);
        } catch (retryError) {
          if (proc) {
            proc.kill();
          }
          proc = undefined;
          cleanupProcess();
          translator.reset();
          throw retryError;
        }
      } else {
        if (proc) {
          proc.kill();
        }
        proc = undefined;
        cleanupProcess();
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

    return buildTurnResult(events);
  };

  let closed = false;

  const ask = (prompt: string): Promise<TAskResult> => {
    if (closed) {
      return Promise.reject(new ClaudeError("Session is closed"));
    }
    const prev = inFlight ?? Promise.resolve();
    const run = prev
      .catch((prevError: unknown) => {
        if (prevError instanceof KnownError) {
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
