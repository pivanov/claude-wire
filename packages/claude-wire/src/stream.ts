import { createCostTracker } from "./cost.js";
import { AbortError, ClaudeError, ProcessError } from "./errors.js";
import { createTranslator } from "./parser/translator.js";
import { buildResult, extractText } from "./pipeline.js";
import type { IClaudeProcess } from "./process.js";
import { spawnClaude } from "./process.js";
import { drainStderr, type IStderrDrain, readNdjsonEvents } from "./reader.js";
import { createToolHandler } from "./tools/handler.js";
import type { TRelayEvent, TSessionMetaEvent } from "./types/events.js";
import type { IClaudeOptions } from "./types/options.js";
import type { TAskResult, TCostSnapshot } from "./types/results.js";

export interface IClaudeStream extends AsyncIterable<TRelayEvent>, AsyncDisposable {
  text: () => Promise<string>;
  cost: () => Promise<TCostSnapshot>;
  result: () => Promise<TAskResult>;
}

export const createStream = (prompt: string, options: IClaudeOptions = {}): IClaudeStream => {
  if (options.signal?.aborted) {
    throw new AbortError();
  }

  const translator = createTranslator();
  const toolHandler = options.tools ? createToolHandler(options.tools) : undefined;
  const costTracker = createCostTracker({
    maxCostUsd: options.maxCostUsd,
    onCostUpdate: options.onCostUpdate,
  });

  let proc: IClaudeProcess | undefined;
  let stderr: IStderrDrain | undefined;
  let cachedGenerator: AsyncGenerator<TRelayEvent> | undefined;

  const ensureSpawned = (): IClaudeProcess => {
    if (!proc) {
      if (options.signal?.aborted) {
        throw new AbortError();
      }
      proc = spawnClaude({ prompt, ...options });
      stderr = drainStderr(proc);
    }
    return proc;
  };

  const generate = async function* (): AsyncGenerator<TRelayEvent> {
    const p = ensureSpawned();
    const stdoutReader = p.stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    let turnComplete = false;

    try {
      for await (const event of readNdjsonEvents({
        reader: stdoutReader,
        translator,
        toolHandler,
        proc: p,
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
        const exitCode = await p.exited;
        if (exitCode !== 0) {
          if (stderr) {
            await stderr.done;
          }
          const stderrText = stderr ? stderr.chunks.join("").trim() : "";
          const exitMsg = stderrText || `Claude process exited with code ${exitCode}`;
          throw new ProcessError(exitMsg, exitCode);
        }
        throw new ProcessError("Process exited without completing the turn");
      }
    } finally {
      stdoutReader.releaseLock();
      p.kill();
    }
  };

  const bufferedEvents: TRelayEvent[] = [];
  let consumePromise: Promise<void> | undefined;

  const ensureConsumed = (): Promise<void> => {
    if (!consumePromise) {
      if (cachedGenerator) {
        throw new ClaudeError("Cannot call text()/cost()/result() after iterating with for-await. Use one or the other.");
      }
      const gen = generate();
      cachedGenerator = gen;
      consumePromise = (async () => {
        for await (const event of gen) {
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
    // Always kill if a proc was ever spawned — the generator's finally may not
    // have run yet (e.g., iterator created but never ticked). Redundant kill
    // on an already-exited process is a harmless ESRCH.
    if (proc) {
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
