import { describe, expect, spyOn, test } from "bun:test";
import { createCostTracker } from "@/cost.js";
import { applyTurnComplete, buildResult, dispatchToolDecision, extractText } from "@/pipeline.js";
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
    // Undefined (not 0) so consumers can tell "measurement unavailable"
    // apart from a genuinely fast turn.
    expect(result.duration).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
  });
});

describe("applyTurnComplete", () => {
  test("threads cache tokens into cost tracker", () => {
    const tracker = createCostTracker();
    applyTurnComplete(
      { type: "turn_complete", costUsd: 0.01, inputTokens: 3500, outputTokens: 120, cacheReadTokens: 3000, cacheCreationTokens: 200 },
      tracker,
    );
    const snap = tracker.snapshot();
    expect(snap.tokens.cacheRead).toBe(3000);
    expect(snap.tokens.cacheCreation).toBe(200);
  });

  test("adds offsets to cache tokens", () => {
    const tracker = createCostTracker();
    applyTurnComplete({ type: "turn_complete", costUsd: 0.01, inputTokens: 1000, outputTokens: 50, cacheReadTokens: 500 }, tracker, {
      totalUsd: 0.005,
      tokens: { input: 2000, output: 100, cacheRead: 1000, cacheCreation: 100 },
    });
    const snap = tracker.snapshot();
    expect(snap.tokens.input).toBe(3000);
    expect(snap.tokens.cacheRead).toBe(1500);
    expect(snap.tokens.cacheCreation).toBe(100);
  });

  test("preserves offset cache tokens when event has none", () => {
    const tracker = createCostTracker();
    applyTurnComplete({ type: "turn_complete", costUsd: 0.01, inputTokens: 1000, outputTokens: 50 }, tracker, {
      totalUsd: 0.005,
      tokens: { input: 2000, output: 100, cacheRead: 1000 },
    });
    const snap = tracker.snapshot();
    expect(snap.tokens.cacheRead).toBe(1000);
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

  test("approve decision writes approve message", async () => {
    const { proc, writes } = makeProc();
    const handler: IToolHandlerInstance = {
      decide: async () => "approve",
    };

    await dispatchToolDecision(proc, handler, makeToolEvent());

    expect(JSON.parse(writes[0]!)).toEqual({ type: "approve", tool_use_id: "toolu_x" });
  });

  test("custom result decision writes tool_result message", async () => {
    const { proc, writes } = makeProc();
    const handler: IToolHandlerInstance = {
      decide: async () => ({ result: "mocked content" }),
    };

    await dispatchToolDecision(proc, handler, makeToolEvent());

    const parsed = JSON.parse(writes[0]!);
    expect(parsed.type).toBe("tool_result");
    expect(parsed.tool_use_id).toBe("toolu_x");
    expect(parsed.content).toBe("mocked content");
    expect(parsed.is_error).toBeUndefined();
  });

  test("custom result with isError writes tool_result with is_error", async () => {
    const { proc, writes } = makeProc();
    const handler: IToolHandlerInstance = {
      decide: async () => ({ result: "error output", isError: true }),
    };

    await dispatchToolDecision(proc, handler, makeToolEvent());

    const parsed = JSON.parse(writes[0]!);
    expect(parsed.type).toBe("tool_result");
    expect(parsed.is_error).toBe(true);
  });

  test("invalid decision warning includes the decision value", async () => {
    const { proc } = makeProc();
    const handler: IToolHandlerInstance = {
      // @ts-expect-error -- intentionally invalid
      decide: async () => 42,
    };
    const warnings: unknown[] = [];
    const onWarning = (_msg: string, cause?: unknown) => warnings.push(cause);

    await dispatchToolDecision(proc, handler, makeToolEvent(), onWarning);

    expect(warnings).toEqual([42]);
  });
});
