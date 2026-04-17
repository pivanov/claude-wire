import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseLine } from "@/parser/ndjson.js";
import { createTranslator } from "@/parser/translator.js";
import type { TRelayEvent } from "@/types/events.js";

const loadFixture = (name: string): string[] => {
  const path = resolve(import.meta.dir, "../fixtures", name);
  return readFileSync(path, "utf-8").split("\n").filter(Boolean);
};

const translateFixture = (name: string): TRelayEvent[] => {
  const lines = loadFixture(name);
  const translator = createTranslator();
  const events: TRelayEvent[] = [];

  for (const line of lines) {
    const raw = parseLine(line);
    if (raw) {
      events.push(...translator.translate(raw));
    }
  }

  return events;
};

describe("createTranslator", () => {
  describe("system init", () => {
    test("emits session_meta event", () => {
      const translator = createTranslator();
      const events = translator.translate({
        type: "system",
        subtype: "init",
        session_id: "sess-1",
        model: "claude-sonnet-4-6",
        tools: ["Read", "Write"],
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "session_meta",
        sessionId: "sess-1",
        model: "claude-sonnet-4-6",
        tools: ["Read", "Write"],
      });
    });
  });

  describe("deduplication", () => {
    test("deduplicates cumulative content arrays", () => {
      const translator = createTranslator();

      const e1 = translator.translate({
        type: "assistant",
        message: {
          content: [{ type: "thinking", thinking: "Let me think..." }],
        },
      });
      expect(e1).toHaveLength(1);
      expect(e1[0]?.type).toBe("thinking");

      const e2 = translator.translate({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "Let me think..." },
            { type: "text", text: "Hello" },
          ],
        },
      });
      expect(e2).toHaveLength(1);
      expect(e2[0]).toEqual({ type: "text", content: "Hello" });

      const e3 = translator.translate({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "Let me think..." },
            { type: "text", text: "Hello" },
            { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "main.ts" } },
          ],
        },
      });
      expect(e3).toHaveLength(1);
      expect(e3[0]?.type).toBe("tool_use");
    });
  });

  describe("multi-agent context switch", () => {
    test("resets dedup index on first-block fingerprint change", () => {
      const translator = createTranslator();

      translator.translate({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Searching the codebase..." }],
        },
      });

      translator.translate({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Searching the codebase..." },
            { type: "tool_use", id: "toolu_grep1", name: "Grep", input: {} },
          ],
        },
      });

      const e3 = translator.translate({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Running test suite..." }],
        },
      });

      expect(e3).toHaveLength(1);
      expect(e3[0]).toEqual({ type: "text", content: "Running test suite..." });
    });
  });

  describe("result events", () => {
    test("emits turn_complete with cost and token data", () => {
      const translator = createTranslator();
      const events = translator.translate({
        type: "result",
        subtype: "success",
        session_id: "sess-1",
        result: '"Done"',
        is_error: false,
        total_cost_usd: 0.018,
        duration_ms: 8500,
        modelUsage: {
          "claude-sonnet-4-6": {
            inputTokens: 500,
            outputTokens: 120,
            cacheReadInputTokens: 3000,
            cacheCreationInputTokens: 0,
            contextWindow: 200000,
          },
        },
      });

      expect(events).toHaveLength(1);
      const tc = events[0];
      expect(tc?.type).toBe("turn_complete");
      if (tc?.type === "turn_complete") {
        expect(tc.sessionId).toBe("sess-1");
        expect(tc.costUsd).toBe(0.018);
        expect(tc.inputTokens).toBe(3500);
        expect(tc.outputTokens).toBe(120);
        expect(tc.cacheReadTokens).toBe(3000);
        expect(tc.cacheCreationTokens).toBe(0);
        expect(tc.contextWindow).toBe(200000);
        expect(tc.durationMs).toBe(8500);
      }
    });

    test("omits cache fields when wire protocol has no cache data", () => {
      const translator = createTranslator();
      const events = translator.translate({
        type: "result",
        subtype: "success",
        session_id: "sess-1",
        result: '"Done"',
        is_error: false,
        total_cost_usd: 0.01,
        modelUsage: {
          "claude-sonnet-4-6": {
            inputTokens: 500,
            outputTokens: 100,
          },
        },
      });

      const tc = events[0];
      if (tc?.type === "turn_complete") {
        expect(tc.inputTokens).toBe(500);
        expect(tc.cacheReadTokens).toBeUndefined();
        expect(tc.cacheCreationTokens).toBeUndefined();
      }
    });

    test("aggregates cache tokens across multi-model usage", () => {
      const translator = createTranslator();
      const events = translator.translate({
        type: "result",
        subtype: "success",
        session_id: "sess-1",
        result: '"Done"',
        is_error: false,
        total_cost_usd: 0.03,
        modelUsage: {
          "claude-sonnet-4-6": {
            inputTokens: 500,
            outputTokens: 100,
            cacheReadInputTokens: 3000,
            cacheCreationInputTokens: 200,
            contextWindow: 200000,
          },
          "claude-haiku-4-5": {
            inputTokens: 300,
            outputTokens: 50,
            cacheReadInputTokens: 1000,
            contextWindow: 200000,
          },
        },
      });

      const tc = events[0];
      if (tc?.type === "turn_complete") {
        expect(tc.inputTokens).toBe(500 + 3000 + 200 + 300 + 1000);
        expect(tc.cacheReadTokens).toBe(4000);
        expect(tc.cacheCreationTokens).toBe(200);
      }
    });

    test("emits error event before turn_complete on error results", () => {
      const translator = createTranslator();
      const events = translator.translate({
        type: "result",
        subtype: "error",
        session_id: "sess-1",
        result: '"Something went wrong"',
        is_error: true,
        total_cost_usd: 0.005,
      });

      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe("error");
      if (events[0]?.type === "error") {
        expect(events[0].message).toBe("Something went wrong");
      }
      expect(events[1]?.type).toBe("turn_complete");
    });
  });

  describe("tool_result events from user messages", () => {
    test("extracts string content from tool results", () => {
      const translator = createTranslator();
      const events = translator.translate({
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file content here", is_error: false }],
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_result",
        toolUseId: "toolu_1",
        output: "file content here",
        isError: false,
      });
    });

    test("extracts array content from tool results", () => {
      const translator = createTranslator();
      const events = translator.translate({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_2",
              content: [{ type: "text", text: "File edited successfully" }],
              is_error: false,
            },
          ],
        },
      });

      expect(events).toHaveLength(1);
      if (events[0]?.type === "tool_result") {
        expect(events[0].output).toBe("File edited successfully");
      }
    });
  });

  describe("reset", () => {
    test("resets dedup state", () => {
      const translator = createTranslator();

      translator.translate({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello" }],
        },
      });

      translator.reset();

      const events = translator.translate({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello" }],
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "text", content: "Hello" });
    });
  });

  describe("single-turn fixture", () => {
    test("produces correct event sequence", () => {
      const events = translateFixture("single-turn.ndjson");

      const types = events.map((e) => e.type);
      expect(types).toEqual([
        "session_meta",
        "thinking",
        "text",
        "tool_use",
        "tool_result",
        "text",
        "tool_use",
        "tool_result",
        "text",
        "turn_complete",
      ]);
    });

    test("session_meta has correct data", () => {
      const events = translateFixture("single-turn.ndjson");
      const meta = events.find((e) => e.type === "session_meta");
      expect(meta).toBeDefined();
      expect(meta?.type).toBe("session_meta");
      if (meta?.type === "session_meta") {
        expect(meta.sessionId).toBe("sess-1");
        expect(meta.model).toBe("claude-sonnet-4-6");
        expect(meta.tools).toEqual(["Read", "Write", "Edit", "Bash"]);
      }
    });

    test("turn_complete has cost data", () => {
      const events = translateFixture("single-turn.ndjson");
      const tc = events.find((e) => e.type === "turn_complete");
      expect(tc).toBeDefined();
      expect(tc?.type).toBe("turn_complete");
      if (tc?.type === "turn_complete") {
        expect(tc.costUsd).toBe(0.018);
        expect(tc.durationMs).toBe(8500);
      }
    });
  });

  describe("reset on result", () => {
    test("resets dedup state after result event for multi-turn sessions", () => {
      const translator = createTranslator();

      translator.translate({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "First turn response" }],
        },
      });

      translator.translate({
        type: "result",
        subtype: "success",
        session_id: "sess-1",
        result: '"First turn response"',
        is_error: false,
        total_cost_usd: 0.01,
      });

      const events = translator.translate({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Second turn response" }],
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "text", content: "Second turn response" });
    });
  });

  describe("legacy system/result events", () => {
    test("emits turn_complete for system/result", () => {
      const translator = createTranslator();
      const events = translator.translate({
        type: "system",
        subtype: "result",
        session_id: "sess-1",
        is_error: false,
      });

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("turn_complete");
      if (events[0]?.type === "turn_complete") {
        expect(events[0].sessionId).toBe("sess-1");
      }
    });

    test("emits error before turn_complete for system/result with is_error", () => {
      const translator = createTranslator();
      const events = translator.translate({
        type: "system",
        subtype: "result",
        session_id: "sess-1",
        result: '"Something failed"',
        is_error: true,
      });

      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe("error");
      if (events[0]?.type === "error") {
        expect(events[0].message).toBe("Something failed");
      }
      expect(events[1]?.type).toBe("turn_complete");
    });

    test("resets dedup state after system/result", () => {
      const translator = createTranslator();

      translator.translate({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Before" }],
        },
      });

      translator.translate({
        type: "system",
        subtype: "result",
        session_id: "sess-1",
        is_error: false,
      });

      const events = translator.translate({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "After" }],
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "text", content: "After" });
    });
  });

  describe("multi-agent fixture", () => {
    test("produces events from interleaved agents", () => {
      const events = translateFixture("multi-agent.ndjson");
      const types = events.map((e) => e.type);

      expect(types).toContain("session_meta");
      expect(types).toContain("thinking");
      expect(types).toContain("text");
      expect(types).toContain("tool_use");
      expect(types).toContain("tool_result");
      expect(types).toContain("turn_complete");
    });

    test("detects context switches between agents", () => {
      const events = translateFixture("multi-agent.ndjson");
      const textEvents = events.filter((e) => e.type === "text");
      const textContents = textEvents.map((e) => (e.type === "text" ? e.content : ""));

      expect(textContents).toContain("Searching the codebase...");
      expect(textContents).toContain("Running test suite...");
    });
  });
});
