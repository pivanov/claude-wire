import { describe, expect, test } from "bun:test";
import { buildResult, extractText } from "@/pipeline.js";
import { createCostTracker } from "@/cost.js";
import type { TRelayEvent } from "@/types/events.js";

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
