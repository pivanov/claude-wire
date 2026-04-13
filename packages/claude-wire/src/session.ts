import { LIMITS, TIMEOUTS } from "./constants.js";
import { createCostTracker } from "./cost.js";
import { AbortError, ClaudeError, isTransientError, ProcessError, TimeoutError } from "./errors.js";
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

export interface IClaudeSession {
  ask: (prompt: string) => Promise<TAskResult>;
  close: () => Promise<void>;
  sessionId: string | undefined;
}

export const createSession = (options: ISessionOptions = {}): IClaudeSession => {
  let proc: IClaudeProcess | undefined;
  let currentSessionId: string | undefined;
  let respawnCount = 0;
  let turnCount = 0;
  let costOffset = 0;
  let tokenInputOffset = 0;
  let tokenOutputOffset = 0;
  const translator = createTranslator();
  const costTracker = createCostTracker({
    maxCostUsd: options.maxCostUsd,
    onCostUpdate: options.onCostUpdate,
  });
  const toolHandler = options.tools ? createToolHandler(options.tools) : undefined;
  let askInProgress = false;

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

  const spawnFresh = (prompt?: string) => {
    if (respawnCount >= LIMITS.maxRespawnAttempts) {
      throw new ProcessError(`Process crashed ${respawnCount} times, giving up`);
    }
    const snap = costTracker.snapshot();
    costOffset = snap.totalUsd;
    tokenInputOffset = snap.inputTokens;
    tokenOutputOffset = snap.outputTokens;
    if (proc) {
      proc.kill();
    }
    cleanupProcess();
    translator.reset();
    proc = spawnClaude({ prompt, ...options });
    reader = proc.stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    respawnCount++;
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
          throw new ClaudeError(`NDJSON buffer exceeded ${LIMITS.ndjsonMaxLineChars} bytes`);
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

            if (event.type === "turn_complete") {
              costTracker.update(
                costOffset + (event.costUsd ?? 0),
                tokenInputOffset + (event.inputTokens ?? 0),
                tokenOutputOffset + (event.outputTokens ?? 0),
              );
              costTracker.checkBudget();
            }

            events.push(event);

            if (event.type === "turn_complete") {
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

    return events;
  };

  const buildTurnResult = (events: TRelayEvent[]): TAskResult => {
    return buildResult(events, costTracker, currentSessionId);
  };

  const ask = async (prompt: string): Promise<TAskResult> => {
    if (askInProgress) {
      throw new ClaudeError("Session is busy; await the previous ask() before calling again");
    }
    askInProgress = true;

    try {
      if (!proc) {
        spawnFresh(prompt);
      } else {
        try {
          proc.write(writer.user(prompt));
        } catch {
          translator.reset();
          spawnFresh(prompt);
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
        if (isTransientError(error) && respawnCount < LIMITS.maxRespawnAttempts) {
          spawnFresh(prompt);
          events = await readUntilTurnComplete(options.signal);
        } else {
          translator.reset();
          throw error;
        }
      }

      respawnCount = 0;
      turnCount++;

      if (turnCount >= LIMITS.sessionMaxTurnsBeforeRecycle) {
        if (proc) {
          proc.kill();
          await proc.exited;
        }
        proc = undefined;
        cleanupProcess();
        turnCount = 0;
      }

      return buildTurnResult(events);
    } finally {
      askInProgress = false;
    }
  };

  const close = async (): Promise<void> => {
    if (askInProgress) {
      throw new ClaudeError("Cannot close session while ask() is in progress");
    }
    if (proc) {
      try {
        proc.write(writer.abort());
      } catch {
        // stdin may already be closed
      }
      proc.kill();
      await proc.exited;
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
  };
};
