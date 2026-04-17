import { LIMITS, TIMEOUTS } from "./constants.js";
import { AbortError, ClaudeError, TimeoutError } from "./errors.js";
import { parseLine } from "./parser/ndjson.js";
import type { ITranslator } from "./parser/translator.js";
import { dispatchToolDecision } from "./pipeline.js";
import type { IClaudeProcess } from "./process.js";
import { safeKill, safeWrite } from "./process.js";
import type { IToolHandlerInstance } from "./tools/handler.js";
import type { TRelayEvent } from "./types/events.js";
import type { TClaudeEvent } from "./types/protocol.js";
import type { TWarn } from "./warnings.js";
import { writer } from "./writer.js";

export interface IReaderOptions {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  translator: ITranslator;
  toolHandler?: IToolHandlerInstance;
  proc?: IClaudeProcess;
  signal?: AbortSignal;
  onWarning?: TWarn;
}

export interface IStderrDrain {
  chunks: string[];
  done: Promise<void>;
  // Accumulated stderr text, trimmed. Shared helper so session.ts and
  // stream.ts don't each reimplement `chunks.join("").trim()` -- keeps
  // behavior consistent if we ever need to cap length or sanitize.
  text: () => string;
}

export const drainStderr = (proc: { stderr: ReadableStream<Uint8Array> }): IStderrDrain => {
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
      // Flush any trailing partial multibyte sequence.
      const tail = decoder.decode();
      if (tail) {
        chunks.push(tail);
      }
      stderrReader.releaseLock();
    }
  })().catch(() => {});
  return {
    chunks,
    done,
    text: () => chunks.join("").trim(),
  };
};

export async function* readNdjsonEvents(opts: IReaderOptions): AsyncGenerator<TRelayEvent> {
  const { reader, translator, signal } = opts;
  const decoder = new TextDecoder();
  let buffer = "";
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let turnComplete = false;

  let abortReject: ((err: Error) => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortReject = reject;
  });
  // Swallow unhandled rejection if nothing ever races against this promise.
  abortPromise.catch(() => {});

  // Single resettable timeout shared across all iterations -- avoids leaking
  // a new Promise + setTimeout per read loop.
  let timeoutReject: ((err: Error) => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutReject = reject;
  });
  timeoutPromise.catch(() => {});
  // Shared per-raw-event dispatch. Used by both the main read loop and the
  // trailing-buffer flush so the translate → tool-dispatch → yield sequence
  // lives in one place. `!turnComplete` guards dispatch so we don't approve
  // or deny a tool call the CLI emits after it already said it's done.
  const processRaw = async function* (raw: TClaudeEvent): AsyncGenerator<TRelayEvent> {
    const translated = translator.translate(raw);
    for (const event of translated) {
      if (event.type === "tool_use" && !turnComplete && opts.toolHandler && opts.proc) {
        await dispatchToolDecision(opts.proc, opts.toolHandler, event, opts.onWarning);
      }
      yield event;
      if (event.type === "turn_complete") {
        turnComplete = true;
      }
    }
  };

  const resetReadTimeout = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      timeoutReject?.(new TimeoutError(`No data received within ${TIMEOUTS.defaultAbortMs}ms`));
    }, TIMEOUTS.defaultAbortMs);
  };

  const abortHandler = signal
    ? () => {
        abortReject?.(new AbortError());
        if (opts.proc) {
          safeWrite(opts.proc, writer.abort());
          safeKill(opts.proc);
        }
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

      resetReadTimeout();
      const readResult = await Promise.race([reader.read(), timeoutPromise, abortPromise]);

      const { done, value } = readResult;
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // The limit applies to the accumulated buffer (which contains at most
      // one in-progress line plus any already-split lines being held), so
      // a single oversize line trips the same guard. Name is legacy -- the
      // check is effectively "no NDJSON message may grow past this size".
      if (buffer.length > LIMITS.ndjsonMaxLineChars) {
        throw new ClaudeError(`NDJSON buffer exceeded ${LIMITS.ndjsonMaxLineChars} chars (single line or accumulated pending lines)`);
      }

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const raw = parseLine(line, opts.onWarning);
        if (!raw) {
          continue;
        }
        yield* processRaw(raw);
      }

      if (turnComplete) {
        break;
      }
    }

    if (buffer.trim()) {
      const raw = parseLine(buffer, opts.onWarning);
      if (raw) {
        yield* processRaw(raw);
      }
    }
  } finally {
    clearTimeout(timeoutId);
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}
