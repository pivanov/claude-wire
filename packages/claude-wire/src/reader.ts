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

// Cap accumulated stderr at 1MB to bound memory on verbose CLI builds.
export const STDERR_MAX_BYTES = 1024 * 1024;

export const drainStderr = (proc: { stderr: ReadableStream<Uint8Array> }, onWarning?: TWarn): IStderrDrain => {
  const chunks: string[] = [];
  let totalLen = 0;
  let truncationWarned = false;
  const stderrReader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  const done = (async () => {
    try {
      while (true) {
        const { done: isDone, value } = await stderrReader.read();
        if (isDone) {
          break;
        }
        const text = decoder.decode(value, { stream: true });
        totalLen += text.length;
        if (totalLen <= STDERR_MAX_BYTES) {
          chunks.push(text);
        } else if (!truncationWarned) {
          truncationWarned = true;
          // Skipping createWarn's console.warn default -- noisy CLI builds
          // would spam every drain. Opt-in only via explicit onWarning.
          if (onWarning) {
            try {
              onWarning(`stderr exceeded ${STDERR_MAX_BYTES} bytes; subsequent output dropped`);
            } catch {
              // observer threw -- drain must not die
            }
          }
        }
      }
    } catch {
      // process exited
    } finally {
      // Flush any trailing partial multibyte sequence.
      const tail = decoder.decode();
      if (tail && totalLen <= STDERR_MAX_BYTES) {
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
  let turnComplete = false;

  let abortReject: ((err: Error) => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortReject = reject;
  });
  // Swallow unhandled rejection if nothing ever races against this promise.
  abortPromise.catch(() => {});
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

  // Fresh promise per call -- a shared one stays rejected after the first fire and poisons subsequent reads when consumers pause > defaultAbortMs between pulls.
  const raceWithTimeout = <T>(p: Promise<T>): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new TimeoutError(`No data received within ${TIMEOUTS.defaultAbortMs}ms`));
      }, TIMEOUTS.defaultAbortMs);
    });
    timeoutPromise.catch(() => {});
    return Promise.race([p, timeoutPromise, abortPromise]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }) as Promise<T>;
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

      const readResult = await raceWithTimeout(reader.read());

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
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}
