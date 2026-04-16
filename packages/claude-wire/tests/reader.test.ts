import { describe, expect, test } from "bun:test";
import { LIMITS } from "@/constants.js";
import { AbortError, ClaudeError, TimeoutError } from "@/errors.js";
import { createTranslator } from "@/parser/translator.js";
import { drainStderr, readNdjsonEvents } from "@/reader.js";
import type { TRelayEvent } from "@/types/events.js";

const makeReader = (lines: string[]): ReadableStreamDefaultReader<Uint8Array> => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n"));
      }
      controller.close();
    },
  });
  return stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;
};

const makeStdout = (lines: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n"));
      }
      controller.close();
    },
  });
};

const drainEvents = async (gen: AsyncGenerator<TRelayEvent>): Promise<TRelayEvent[]> => {
  const out: TRelayEvent[] = [];
  for await (const event of gen) {
    out.push(event);
  }
  return out;
};

describe("readNdjsonEvents", () => {
  test("yields translated events and stops on turn_complete", async () => {
    const reader = makeReader([
      '{"type":"system","subtype":"init","session_id":"s1","model":"claude-sonnet-4-6","tools":[]}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}',
      '{"type":"result","subtype":"success","session_id":"s1","result":"\\"hi\\"","is_error":false,"total_cost_usd":0.001,"duration_ms":10,"modelUsage":{}}',
    ]);
    const events = await drainEvents(readNdjsonEvents({ reader, translator: createTranslator() }));

    expect(events.map((e) => e.type)).toEqual(["session_meta", "text", "turn_complete"]);
  });

  test("skips malformed JSON lines", async () => {
    const reader = makeReader([
      "garbage {",
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}',
      '{"type":"result","subtype":"success","session_id":"s1","total_cost_usd":0,"duration_ms":1,"modelUsage":{}}',
    ]);
    const events = await drainEvents(readNdjsonEvents({ reader, translator: createTranslator() }));

    expect(events.map((e) => e.type)).toEqual(["text", "turn_complete"]);
  });

  test("throws when buffered content exceeds ndjsonMaxLineChars", async () => {
    const encoder = new TextEncoder();
    // One giant line, never newline-terminated, > LIMITS.ndjsonMaxLineChars.
    const big = "x".repeat(LIMITS.ndjsonMaxLineChars + 1);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(big));
        controller.close();
      },
    });
    const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;

    await expect(drainEvents(readNdjsonEvents({ reader, translator: createTranslator() }))).rejects.toThrow(ClaudeError);
  });

  test("throws AbortError when signal is already aborted", async () => {
    const reader = makeReader(['{"type":"assistant","message":{"role":"assistant","content":[]}}']);
    const controller = new AbortController();
    controller.abort();

    await expect(drainEvents(readNdjsonEvents({ reader, translator: createTranslator(), signal: controller.signal }))).rejects.toThrow(AbortError);
  });

  test("processes a trailing partial line when the stream ends mid-buffer", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Complete line + partial (no trailing newline) that closes cleanly.
        controller.enqueue(encoder.encode('{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"first"}]}}\n'));
        controller.enqueue(
          encoder.encode(
            '{"type":"result","subtype":"success","session_id":"s1","result":"\\"done\\"","is_error":false,"total_cost_usd":0,"duration_ms":1,"modelUsage":{}}',
          ),
        );
        controller.close();
      },
    });
    const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const events = await drainEvents(readNdjsonEvents({ reader, translator: createTranslator() }));

    // Partial trailing line must still be parsed: we should see text AND turn_complete.
    expect(events.map((e) => e.type)).toEqual(["text", "turn_complete"]);
  });

  test("aborts quickly when signal fires while waiting for data", async () => {
    const reader = new ReadableStream<Uint8Array>({
      start() {
        // never enqueues, never closes
      },
    }).getReader() as ReadableStreamDefaultReader<Uint8Array>;

    // The default timeout is 300s; we fire abort ourselves after 50ms.
    const signal = AbortSignal.timeout(50);
    await expect(drainEvents(readNdjsonEvents({ reader, translator: createTranslator(), signal }))).rejects.toThrow(/abort|timed out/i);
  });
});

describe("drainStderr", () => {
  test("collects chunks until stream closes", async () => {
    const encoder = new TextEncoder();
    const stderr = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("hello "));
        controller.enqueue(encoder.encode("world"));
        controller.close();
      },
    });

    const drain = drainStderr({ stderr });
    await drain.done;
    expect(drain.chunks.join("")).toBe("hello world");
  });

  test("resolves even when the stream errors", async () => {
    const stderr = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("boom"));
      },
    });

    const drain = drainStderr({ stderr });
    await drain.done;
    expect(drain.chunks).toEqual([]);
  });
});

// Light smoke test to document intent -- a timeout-only test would take ~300s.
describe("readNdjsonEvents shape", () => {
  test("accepts proc + toolHandler for tool dispatch path", async () => {
    const stdout = makeStdout([
      '{"type":"system","subtype":"init","session_id":"s1","model":"m","tools":[]}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{}}]}}',
      '{"type":"result","subtype":"success","session_id":"s1","total_cost_usd":0,"duration_ms":1,"modelUsage":{}}',
    ]);
    const writes: string[] = [];
    const proc = {
      write: (m: string) => {
        writes.push(m);
      },
      kill: () => {},
      exited: Promise.resolve(0),
      stdout,
      stderr: new ReadableStream<Uint8Array>(),
      pid: 0,
    };
    const toolHandler = { decide: async () => "approve" as const };
    const events = await drainEvents(
      // biome-ignore lint/suspicious/noExplicitAny: test-only cast for minimal process mock
      readNdjsonEvents({
        reader: stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>,
        translator: createTranslator(),
        toolHandler,
        proc: proc as any,
      }),
    );

    expect(events.some((e) => e.type === "tool_use")).toBe(true);
    expect(JSON.parse(writes[0]!)).toEqual({ type: "approve", tool_use_id: "toolu_1" });
    expect(TimeoutError).toBeDefined();
  });
});
