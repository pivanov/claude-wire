import { withTimeout } from "./async.js";
import { TIMEOUTS } from "./constants.js";
import { createCostTracker } from "./cost.js";
import { AbortError, ClaudeError, ProcessError, processExitedEarly } from "./errors.js";
import { createTranslator } from "./parser/translator.js";
import { applyTurnComplete, buildResult, extractText, startPipeline } from "./pipeline.js";
import type { IClaudeProcess } from "./process.js";
import type { IStderrDrain } from "./reader.js";
import { readNdjsonEvents } from "./reader.js";
import { createToolHandler } from "./tools/handler.js";
import type { TRelayEvent, TSessionMetaEvent } from "./types/events.js";
import type { IClaudeOptions } from "./types/options.js";
import type { TAskResult, TCostSnapshot } from "./types/results.js";

// Enforced exclusivity between iterating the stream and consuming via
// text()/cost()/result(). Sharing the base message keeps the two throw
// sites from drifting apart over time.
const MIX_ITER_CONSUME = "Cannot mix for-await iteration with text()/cost()/result() on the same stream -- use one or the other.";

export interface IClaudeStream extends AsyncIterable<TRelayEvent>, AsyncDisposable {
  text: () => Promise<string>;
  cost: () => Promise<TCostSnapshot>;
  result: () => Promise<TAskResult>;
}

export const createStream = (prompt: string, options: IClaudeOptions = {}): IClaudeStream => {
  // Abort check happens inside `ensureSpawned` -- at factory time we only
  // capture config. A pre-aborted signal surfaces on the first access
  // (iterate / text / cost / result), which is when spawn would happen.
  const translator = createTranslator();
  const toolHandler = options.toolHandler ? createToolHandler(options.toolHandler) : undefined;
  const costTracker = createCostTracker({
    maxCostUsd: options.maxCostUsd,
    onCostUpdate: options.onCostUpdate,
    onWarning: options.onWarning,
  });

  let proc: IClaudeProcess | undefined;
  let stderr: IStderrDrain | undefined;
  let stdoutReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cachedGenerator: AsyncGenerator<TRelayEvent> | undefined;

  const ensureSpawned = (): IClaudeProcess => {
    if (!proc) {
      if (options.signal?.aborted) {
        throw new AbortError();
      }
      // Shared boot: spawnClaude → getReader → drainStderr in one call.
      // Matches session.ts so future refactors can't let the two drift.
      const pipeline = startPipeline({ prompt, ...options });
      proc = pipeline.proc;
      stdoutReader = pipeline.reader;
      stderr = pipeline.stderr;
    }
    return proc;
  };

  const generate = async function* (): AsyncGenerator<TRelayEvent> {
    const p = ensureSpawned();
    // ensureSpawned always populates stdoutReader alongside proc. Typed
    // assertion so consumers can treat it as non-null below.
    const currentReader = stdoutReader as ReadableStreamDefaultReader<Uint8Array>;
    let turnComplete = false;

    try {
      for await (const event of readNdjsonEvents({
        reader: currentReader,
        translator,
        toolHandler,
        proc: p,
        signal: options.signal,
        onWarning: options.onWarning,
      })) {
        if (event.type === "turn_complete") {
          applyTurnComplete(event, costTracker);
          turnComplete = true;
        }

        yield event;
      }

      if (!turnComplete) {
        // Don't wait forever on p.exited -- a stuck child that never closes
        // stdout would hang the generator. Cap at gracefulExitMs, then
        // force-kill so cleanup() isn't left waiting too.
        const exitCode = await withTimeout<number, undefined>(p.exited, TIMEOUTS.gracefulExitMs);
        if (exitCode === undefined) {
          p.kill();
        }
        // Give stderr a brief chance to drain so the thrown error carries
        // the CLI's actual complaint instead of an empty string. Uniform
        // across all three branches below so users never get "no context".
        if (stderr) {
          await withTimeout(stderr.done, TIMEOUTS.stderrDrainGraceMs);
        }
        const stderrText = stderr ? stderr.text() : "";
        if (exitCode === undefined) {
          throw processExitedEarly(stderrText);
        }
        if (exitCode !== 0) {
          const exitMsg = stderrText || `Claude process exited with code ${exitCode}`;
          throw new ProcessError(exitMsg, exitCode);
        }
        throw processExitedEarly(stderrText);
      }
    } finally {
      currentReader.releaseLock();
      p.kill();
      // Let stderr catch up so any trailing lines aren't silently dropped --
      // session's error path does the same via withTimeout. Capped so a
      // stuck drain can't hold up consumer cleanup.
      if (stderr) {
        await withTimeout(stderr.done, TIMEOUTS.stderrDrainGraceMs);
      }
    }
  };

  const bufferedEvents: TRelayEvent[] = [];
  let consumePromise: Promise<void> | undefined;

  const ensureConsumed = (): Promise<void> => {
    if (!consumePromise) {
      if (cachedGenerator) {
        throw new ClaudeError(MIX_ITER_CONSUME);
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
    // One-shot kill: streams are single-turn, so unlike session.gracefulKill
    // there's no second ask() to worry about leaving the child stranded for.
    // SIGTERM is sufficient -- a stuck child would be the CLI's bug, and we
    // wouldn't gain anything by blocking cleanup() on a SIGKILL escalation.
    // Always kill if a proc was ever spawned -- the generator's finally may
    // not have run yet (e.g., iterator created but never ticked). Redundant
    // kill on an already-exited process is a harmless ESRCH.
    if (proc) {
      proc.kill();
    }
  };

  return {
    [Symbol.asyncIterator]: () => {
      if (consumePromise) {
        throw new ClaudeError(MIX_ITER_CONSUME);
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
