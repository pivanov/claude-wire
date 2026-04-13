import { LIMITS, TIMEOUTS } from "./constants.js";
import { createCostTracker } from "./cost.js";
import { AbortError, ClaudeError, ProcessError, TimeoutError } from "./errors.js";
import { parseLine } from "./parser/ndjson.js";
import { createTranslator } from "./parser/translator.js";
import { buildResult, dispatchToolDecision, extractText } from "./pipeline.js";
import { spawnClaude } from "./process.js";
import { createToolHandler } from "./tools/handler.js";
import type { TRelayEvent, TSessionMetaEvent } from "./types/events.js";
import type { IClaudeOptions } from "./types/options.js";
import type { TAskResult, TCostSnapshot } from "./types/results.js";
import { writer } from "./writer.js";

export interface IClaudeStream extends AsyncIterable<TRelayEvent> {
  text: () => Promise<string>;
  cost: () => Promise<TCostSnapshot>;
  result: () => Promise<TAskResult>;
}

type TStderrDrain = { chunks: string[]; done: Promise<void> };

const drainStderr = (proc: { stderr: ReadableStream<Uint8Array> }): TStderrDrain => {
  const chunks: string[] = [];
  const stderrReader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  const done = (async () => {
    try {
      while (true) {
        const { done: isDone, value } = await stderrReader.read();
        if (isDone) {
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
  return { chunks, done };
};

export const createStream = (prompt: string, options: IClaudeOptions = {}): IClaudeStream => {
  const proc = spawnClaude({ prompt, ...options });
  const stderr = drainStderr(proc);
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

  let cachedGenerator: AsyncGenerator<TRelayEvent> | undefined;

  const generate = async function* (): AsyncGenerator<TRelayEvent> {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
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

        if (turnComplete) {
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

      if (!turnComplete && !aborted) {
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          let errorMessage = `Claude process exited with code ${exitCode}`;
          await stderr.done;
          const stderrText = stderr.chunks.join("").trim();
          if (stderrText) {
            errorMessage = stderrText;
          }
          throw new ProcessError(errorMessage, exitCode);
        }
        throw new ProcessError("Process exited without completing the turn");
      }
    } finally {
      clearTimeout(timeoutId);
      reader.releaseLock();
      options.signal?.removeEventListener("abort", abortProcess);
      proc.kill();
    }
  };

  const bufferedEvents: TRelayEvent[] = [];
  let consumePromise: Promise<void> | undefined;

  const ensureConsumed = (): Promise<void> => {
    if (!consumePromise) {
      if (cachedGenerator) {
        throw new ClaudeError("Cannot call text()/cost()/result() after iterating with for-await. Use one or the other.");
      }
      consumePromise = (async () => {
        cachedGenerator = generate();
        for await (const event of { [Symbol.asyncIterator]: () => cachedGenerator as AsyncGenerator<TRelayEvent> }) {
          bufferedEvents.push(event);
        }
      })();
    }
    return consumePromise;
  };

  const text = async (): Promise<string> => {
    await ensureConsumed();
    return extractText(bufferedEvents);
  };

  const cost = async (): Promise<TCostSnapshot> => {
    await ensureConsumed();
    return costTracker.snapshot();
  };

  const result = async (): Promise<TAskResult> => {
    await ensureConsumed();
    const sessionId = bufferedEvents.find((e): e is TSessionMetaEvent => e.type === "session_meta")?.sessionId;
    return buildResult(bufferedEvents, costTracker, sessionId);
  };

  return {
    [Symbol.asyncIterator]: () => {
      if (consumePromise) {
        throw new ClaudeError("Cannot iterate after calling text()/cost()/result(). Use one or the other.");
      }
      cachedGenerator ??= generate();
      return cachedGenerator;
    },
    text,
    cost,
    result,
  };
};
