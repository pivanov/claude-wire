import { describe, expect, test, spyOn } from "bun:test";
import { buildResult, dispatchToolDecision, extractText } from "@/pipeline.js";
import { createCostTracker } from "@/cost.js";
import type { IClaudeProcess } from "@/process.js";
import type { IToolHandlerInstance } from "@/tools/handler.js";
import type { TRelayEvent, TToolUseEvent } from "@/types/events.js";

describe("extractText", () => {
  test("joins text events", () => {
    const events: TRelayEvent[] = [
      { type: "thinking", content: "hmm" },
      { type: "text", content: "Hello " },
      { type: "text", content: "world" },
      { type: "turn_complete" },
    ];
    expect(extractText(events)).toBe("Hello world");
  });

  test("returns empty string for no text events", () => {
    const events: TRelayEvent[] = [{ type: "thinking", content: "hmm" }];
    expect(extractText(events)).toBe("");
  });

  test("returns empty string for empty array", () => {
    expect(extractText([])).toBe("");
  });
});

describe("buildResult", () => {
  test("builds TAskResult from events", () => {
    const events: TRelayEvent[] = [
      { type: "text", content: "answer" },
      { type: "turn_complete", costUsd: 0.01, inputTokens: 100, outputTokens: 20, durationMs: 500 },
    ];
    const tracker = createCostTracker();
    tracker.update(0.01, 100, 20);

    const result = buildResult(events, tracker, "sess-1");
    expect(result.text).toBe("answer");
    expect(result.costUsd).toBe(0.01);
    expect(result.tokens).toEqual({ input: 100, output: 20 });
    expect(result.duration).toBe(500);
    expect(result.sessionId).toBe("sess-1");
    expect(result.events).toHaveLength(2);
  });

  test("handles missing turn_complete gracefully", () => {
    const events: TRelayEvent[] = [{ type: "text", content: "partial" }];
    const tracker = createCostTracker();
    const result = buildResult(events, tracker, undefined);
    expect(result.duration).toBe(0);
    expect(result.sessionId).toBeUndefined();
  });
});

describe("dispatchToolDecision", () => {
  const makeToolEvent = (): TToolUseEvent => ({
    type: "tool_use",
    toolUseId: "toolu_x",
    toolName: "Read",
    input: "{}",
  });

  const makeProc = () => {
    const writes: string[] = [];
    const proc = {
      write: (msg: string) => {
        writes.push(msg);
      },
      kill: () => {},
      exited: Promise.resolve(0),
      stdout: new ReadableStream<Uint8Array>(),
      stderr: new ReadableStream<Uint8Array>(),
      pid: 0,
    } as unknown as IClaudeProcess;
    return { proc, writes };
  };

  test("throwing handler defaults to deny and logs a warning", async () => {
    const { proc, writes } = makeProc();
    const handler: IToolHandlerInstance = {
      decide: async () => {
        throw new Error("handler exploded");
      },
    };
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    await dispatchToolDecision(proc, handler, makeToolEvent());

    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!)).toEqual({ type: "deny", tool_use_id: "toolu_x" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("malformed decision object defaults to deny", async () => {
    const { proc, writes } = makeProc();
    const handler: IToolHandlerInstance = {
      // @ts-expect-error -- intentionally invalid shape to exercise the guard
      decide: async () => ({ bogus: true }),
    };
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    await dispatchToolDecision(proc, handler, makeToolEvent());

    expect(JSON.parse(writes[0]!)).toEqual({ type: "deny", tool_use_id: "toolu_x" });
    warn.mockRestore();
  });
});
