import { createCostTracker } from "./cost.js";
import { AbortError, ClaudeError, ProcessError } from "./errors.js";
import { createTranslator } from "./parser/translator.js";
import { buildResult, extractText } from "./pipeline.js";
import { spawnClaude } from "./process.js";
import { readNdjsonEvents } from "./reader.js";
import { createToolHandler } from "./tools/handler.js";
import type { TRelayEvent, TSessionMetaEvent } from "./types/events.js";
import type { IClaudeOptions } from "./types/options.js";
import type { TAskResult, TCostSnapshot } from "./types/results.js";

export interface IClaudeStream extends AsyncIterable<TRelayEvent>, AsyncDisposable {
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
  if (options.signal?.aborted) {
    throw new AbortError();
  }

  const proc = spawnClaude({ prompt, ...options });
  const stderr = drainStderr(proc);
  const translator = createTranslator();
  const toolHandler = options.tools ? createToolHandler(options.tools) : undefined;
  const costTracker = createCostTracker({
    maxCostUsd: options.maxCostUsd,
    onCostUpdate: options.onCostUpdate,
  });

  let cachedGenerator: AsyncGenerator<TRelayEvent> | undefined;

  const generate = async function* (): AsyncGenerator<TRelayEvent> {
    const stdoutReader = proc.stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    let turnComplete = false;

    try {
      for await (const event of readNdjsonEvents({
        reader: stdoutReader,
        translator,
        toolHandler,
        proc,
        signal: options.signal,
      })) {
        if (event.type === "turn_complete") {
          costTracker.update(event.costUsd ?? 0, event.inputTokens ?? 0, event.outputTokens ?? 0);
          costTracker.checkBudget();
          turnComplete = true;
        }

        yield event;
      }

      if (!turnComplete) {
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
      stdoutReader.releaseLock();
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

  const cleanup = () => {
    if (!cachedGenerator) {
      proc.kill();
    }
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
    [Symbol.asyncDispose]: async () => {
      cleanup();
    },
  };
};
