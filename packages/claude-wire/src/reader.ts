import { LIMITS, TIMEOUTS } from "./constants.js";
import { AbortError, ClaudeError, TimeoutError } from "./errors.js";
import { parseLine } from "./parser/ndjson.js";
import type { ITranslator } from "./parser/translator.js";
import { dispatchToolDecision } from "./pipeline.js";
import type { IClaudeProcess } from "./process.js";
import type { IToolHandlerInstance } from "./tools/handler.js";
import type { TRelayEvent } from "./types/events.js";

export interface IReaderOptions {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  translator: ITranslator;
  toolHandler?: IToolHandlerInstance;
  proc?: IClaudeProcess;
  signal?: AbortSignal;
}

export async function* readNdjsonEvents(opts: IReaderOptions): AsyncGenerator<TRelayEvent> {
  const { reader, translator, signal } = opts;
  const decoder = new TextDecoder();
  let buffer = "";
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let turnComplete = false;

  const abortHandler = signal
    ? () => {
        if (opts.proc) {
          try {
            opts.proc.write('{"type":"abort"}\n');
          } catch {
            // stdin closed
          }
          opts.proc.kill();
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

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new TimeoutError(`No data received within ${TIMEOUTS.defaultAbortMs}ms`));
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
          if (event.type === "tool_use" && opts.toolHandler && opts.proc) {
            await dispatchToolDecision(opts.proc, opts.toolHandler, event);
          }
          yield event;
          if (event.type === "turn_complete") {
            turnComplete = true;
          }
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
          if (event.type === "tool_use" && opts.toolHandler && opts.proc && !turnComplete) {
            await dispatchToolDecision(opts.proc, opts.toolHandler, event);
          }
          yield event;
          if (event.type === "turn_complete") {
            turnComplete = true;
          }
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

export type { TRelayEvent };
