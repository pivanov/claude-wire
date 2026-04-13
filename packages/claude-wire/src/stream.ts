import { LIMITS, TIMEOUTS } from "./constants.js";
import { createCostTracker } from "./cost.js";
import { AbortError, ClaudeError, ProcessError, TimeoutError } from "./errors.js";
import { parseLine } from "./parser/ndjson.js";
import { createTranslator } from "./parser/translator.js";
import { buildResult, dispatchToolDecision } from "./pipeline.js";
import { spawnClaude } from "./process.js";
import { createToolHandler } from "./tools/handler.js";
import type { TRelayEvent, TTextEvent } from "./types/events.js";
import type { IClaudeOptions } from "./types/options.js";
import type { TAskResult, TCostSnapshot } from "./types/results.js";
import { writer } from "./writer.js";

export interface IClaudeStream extends AsyncIterable<TRelayEvent> {
  text: () => Promise<string>;
  cost: () => Promise<TCostSnapshot>;
  result: () => Promise<TAskResult>;
}

export const createStream = (prompt: string, options: IClaudeOptions = {}): IClaudeStream => {
  const proc = spawnClaude({ prompt, ...options });
  const translator = createTranslator();
  const toolHandler = options.tools ? createToolHandler(options.tools) : undefined;
  const costTracker = createCostTracker({
    maxCostUsd: options.maxCostUsd,
    onCostUpdate: options.onCostUpdate,
  });

  let aborted = false;

  const abortProcess = () => {
    aborted = true;
    try {
      proc.write(writer.abort());
    } catch {
      // stdin may already be closed
    }
    proc.kill();
  };

  if (options.signal) {
    if (options.signal.aborted) {
      abortProcess();
    } else {
      options.signal.addEventListener("abort", abortProcess, { once: true });
    }
  }

  let generatorCreated = false;
  let cachedGenerator: AsyncGenerator<TRelayEvent> | undefined;

  const generate = async function* (): AsyncGenerator<TRelayEvent> {
    if (generatorCreated) {
      throw new ClaudeError("Stream can only be iterated once.");
    }
    generatorCreated = true;
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let receivedAnyEvents = false;
    let turnComplete = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      while (true) {
        if (aborted) {
          throw new AbortError();
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new TimeoutError(`No response within ${TIMEOUTS.defaultAbortMs}ms`));
          }, TIMEOUTS.defaultAbortMs);
        });
        const readResult = await Promise.race([reader.read(), timeoutPromise]);
        clearTimeout(timeoutId);
        const { done, value } = readResult;
        if (done) {
          break;
        }
        receivedAnyEvents = true;

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

          const events = translator.translate(raw);

          for (const event of events) {
            if (event.type === "tool_use" && toolHandler) {
              await dispatchToolDecision(proc, toolHandler, event);
            }

            if (event.type === "turn_complete") {
              costTracker.update(event.costUsd ?? 0, event.inputTokens ?? 0, event.outputTokens ?? 0);
              costTracker.checkBudget();
              turnComplete = true;
            }

            yield event;
          }
        }

        // With --input-format stream-json, the process stays alive waiting
        // for more stdin. Once we get turn_complete, the turn is done and
        // we should stop reading and kill the process.
        if (turnComplete) {
          proc.kill();
          break;
        }
      }

      if (buffer.trim()) {
        const raw = parseLine(buffer);
        if (raw) {
          const events = translator.translate(raw);
          for (const event of events) {
            if (event.type === "tool_use" && toolHandler && !turnComplete) {
              await dispatchToolDecision(proc, toolHandler, event);
            }
            if (event.type === "turn_complete") {
              costTracker.update(event.costUsd ?? 0, event.inputTokens ?? 0, event.outputTokens ?? 0);
              costTracker.checkBudget();
              turnComplete = true;
            }
            yield event;
          }
        }
      }

      // Only check exit code if we didn't kill the process ourselves
      if (!turnComplete && !aborted) {
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          let errorMessage = `Claude process exited with code ${exitCode}`;
          if (!receivedAnyEvents) {
            try {
              const stderrReader = proc.stderr.getReader();
              const stderrChunks: string[] = [];
              const stderrDecoder = new TextDecoder();
              while (true) {
                const { done: stderrDone, value: stderrValue } = await stderrReader.read();
                if (stderrDone) {
                  break;
                }
                stderrChunks.push(stderrDecoder.decode(stderrValue, { stream: true }));
              }
              stderrReader.releaseLock();
              const stderrText = stderrChunks.join("").trim();
              if (stderrText) {
                errorMessage = stderrText;
              }
            } catch {
              // stderr already consumed or unavailable
            }
          }
          throw new ProcessError(errorMessage, exitCode);
        }
      }
    } catch (error) {
      proc.kill();
      throw error;
    } finally {
      clearTimeout(timeoutId);
      reader.releaseLock();
      options.signal?.removeEventListener("abort", abortProcess);
    }
  };

  let consumed = false;
  const bufferedEvents: TRelayEvent[] = [];

  const ensureConsumed = async () => {
    if (consumed) {
      return;
    }
    if (generatorCreated) {
      throw new ClaudeError("Cannot call text()/cost()/result() after iterating with for-await. Use one or the other.");
    }
    consumed = true;
    cachedGenerator ??= generate();
    for await (const event of { [Symbol.asyncIterator]: () => cachedGenerator as AsyncGenerator<TRelayEvent> }) {
      bufferedEvents.push(event);
    }
  };

  const text = async (): Promise<string> => {
    await ensureConsumed();
    return bufferedEvents
      .filter((e): e is TTextEvent => e.type === "text")
      .map((e) => e.content)
      .join("");
  };

  const cost = async (): Promise<TCostSnapshot> => {
    await ensureConsumed();
    return costTracker.snapshot();
  };

  const result = async (): Promise<TAskResult> => {
    await ensureConsumed();
    const meta = bufferedEvents.find((e) => e.type === "session_meta");
    const sessionId = meta?.type === "session_meta" ? meta.sessionId : undefined;
    return buildResult([...bufferedEvents], costTracker, sessionId);
  };

  return {
    [Symbol.asyncIterator]: () => {
      cachedGenerator ??= generate();
      return cachedGenerator;
    },
    text,
    cost,
    result,
  };
};
