import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { createMockProcess, createMultiTurnMockProcess, loadFixtureLines, type TMockProcess } from "./helpers/mock-process.js";
import { realProcessModule } from "./helpers/real-process.js";

const FIXTURE_DIR = join(import.meta.dir, "fixtures");
const singleTurnLines = loadFixtureLines(join(FIXTURE_DIR, "single-turn.ndjson"));

let mockProc: TMockProcess;

beforeEach(() => {
  mockProc = createMockProcess(singleTurnLines);
  mock.module("@/process.js", () => ({
    ...realProcessModule,
    spawnClaude: () => mockProc,
  }));
});

afterAll(() => {
  mock.module("@/process.js", () => realProcessModule);
});

// Dynamic import so the mocked module is picked up
const loadCreateStream = async () => {
  const mod = await import("@/stream.js");
  return mod.createStream;
};

describe("createStream", () => {
  test("for-await yields correct events from fixture data", async () => {
    const createStream = await loadCreateStream();
    const stream = createStream("fix the bug", { maxBudgetUsd: 1 });
    const events: import("@/types/events.js").TRelayEvent[] = [];

    for await (const event of stream) {
      events.push(event);
    }

    // Fixture has: session_meta, thinking, text, tool_use, tool_result, text, tool_use, tool_result, text, turn_complete
    expect(events.length).toBeGreaterThan(0);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("session_meta");
    expect(types[types.length - 1]).toBe("turn_complete");
    expect(types).toContain("text");
    expect(types).toContain("thinking");
  });

  test("text() returns concatenated text events", async () => {
    const createStream = await loadCreateStream();
    const stream = createStream("fix the bug", { maxBudgetUsd: 1 });

    const text = await stream.text();

    // Fixture has several text blocks - verify they are concatenated
    expect(text).toContain("I'll read the file and investigate.");
    expect(text).toContain("I found the bug. Let me fix it.");
    expect(text).toContain("Fixed! The bug was an undefined variable reference.");
  });

  test("cost() returns cost snapshot after completion", async () => {
    const createStream = await loadCreateStream();
    const stream = createStream("fix the bug", { maxBudgetUsd: 1 });

    const cost = await stream.cost();

    // Fixture total_cost_usd = 0.018
    expect(cost.totalUsd).toBe(0.018);
    // tokens.input = 500 + 3000 (cacheRead) = 3500
    expect(cost.tokens.input).toBe(3500);
    // tokens.output = 120
    expect(cost.tokens.output).toBe(120);
  });

  test("result() returns full TAskResult", async () => {
    const createStream = await loadCreateStream();
    const stream = createStream("fix the bug", { maxBudgetUsd: 1 });

    const result = await stream.result();

    expect(result.text).toContain("Fixed!");
    expect(result.costUsd).toBe(0.018);
    expect(result.tokens.input).toBe(3500);
    expect(result.tokens.output).toBe(120);
    expect(result.duration).toBe(8500);
    expect(result.sessionId).toBe("sess-1");
    expect(result.events.length).toBeGreaterThan(0);
  });

  test("throws when for-await then text() are mixed", async () => {
    const createStream = await loadCreateStream();
    const stream = createStream("fix the bug", { maxBudgetUsd: 1 });

    // Consume via iteration first
    for await (const _ of stream) {
      // drain
    }

    // Now text() should throw (synchronously in ensureConsumed)
    await expect(stream.text()).rejects.toThrow(/Cannot mix for-await iteration/);
  });

  test("throws when text() then for-await are mixed", async () => {
    const createStream = await loadCreateStream();
    const stream = createStream("fix the bug", { maxBudgetUsd: 1 });

    // Consume via text() first
    await stream.text();

    // Now iteration should throw
    expect(() => {
      const iter = stream[Symbol.asyncIterator]();
      return iter;
    }).toThrow(/Cannot mix for-await iteration/);
  });

  test("tool dispatch writes approve to stdin for approved tools", async () => {
    mockProc = createMockProcess(singleTurnLines);
    mock.module("@/process.js", () => ({
      ...realProcessModule,
      spawnClaude: () => mockProc,
    }));

    const createStream = await loadCreateStream();
    const stream = createStream("fix the bug", {
      maxBudgetUsd: 1,
      toolHandler: {
        allowed: ["Read", "Edit"],
      },
    });

    // Drain all events
    for await (const _ of stream) {
      // process events
    }

    // The fixture has tool_use events for Read (toolu_1) and Edit (toolu_2)
    // With tools.allowed = ["Read", "Edit"], both should be approved
    const mockProcess = mockProc as TMockProcess & { readonly _writes: string[] };
    const approveWrites = mockProcess._writes.filter((w: string) => {
      try {
        const parsed = JSON.parse(w);
        return parsed.type === "approve";
      } catch {
        return false;
      }
    });
    expect(approveWrites.length).toBe(2);

    // Verify the approve messages reference the right tool IDs
    const toolIds = approveWrites.map((w: string) => JSON.parse(w).tool_use_id);
    expect(toolIds).toContain("toolu_1");
    expect(toolIds).toContain("toolu_2");
  });

  test("tool dispatch writes deny to stdin for blocked tools", async () => {
    mockProc = createMockProcess(singleTurnLines);
    mock.module("@/process.js", () => ({
      ...realProcessModule,
      spawnClaude: () => mockProc,
    }));

    const createStream = await loadCreateStream();
    const stream = createStream("fix the bug", {
      maxBudgetUsd: 1,
      toolHandler: {
        blocked: ["Edit"],
        allowed: ["Read"],
      },
    });

    for await (const _ of stream) {
      // process events
    }

    const mockProcess = mockProc as TMockProcess & { readonly _writes: string[] };
    const denyWrites = mockProcess._writes.filter((w: string) => {
      try {
        return JSON.parse(w).type === "deny";
      } catch {
        return false;
      }
    });
    const approveWrites = mockProcess._writes.filter((w: string) => {
      try {
        return JSON.parse(w).type === "approve";
      } catch {
        return false;
      }
    });

    // Edit is blocked, so toolu_2 should be denied
    expect(denyWrites.length).toBeGreaterThanOrEqual(1);
    const denyIds = denyWrites.map((w: string) => JSON.parse(w).tool_use_id);
    expect(denyIds).toContain("toolu_2");

    // Read is allowed, so toolu_1 should be approved
    expect(approveWrites.length).toBeGreaterThanOrEqual(1);
    const approveIds = approveWrites.map((w: string) => JSON.parse(w).tool_use_id);
    expect(approveIds).toContain("toolu_1");
  });

  test("process is killed on completion", async () => {
    mockProc = createMockProcess(singleTurnLines);
    mock.module("@/process.js", () => ({
      ...realProcessModule,
      spawnClaude: () => mockProc,
    }));

    const createStream = await loadCreateStream();
    const stream = createStream("fix the bug", { maxBudgetUsd: 1 });

    for await (const _ of stream) {
      // drain
    }

    const mockProcess = mockProc as TMockProcess & { readonly _killed: boolean };
    expect(mockProcess._killed).toBe(true);
  });

  test("multiple calls to text() return same result (idempotent)", async () => {
    const createStream = await loadCreateStream();
    const stream = createStream("fix the bug", { maxBudgetUsd: 1 });

    const text1 = await stream.text();
    const text2 = await stream.text();
    expect(text1).toBe(text2);
  });

  test("result() and cost() can be called on same stream", async () => {
    const createStream = await loadCreateStream();
    const stream = createStream("fix the bug", { maxBudgetUsd: 1 });

    const result = await stream.result();
    const cost = await stream.cost();

    expect(result.costUsd).toBe(cost.totalUsd);
  });

  test("abort signal fired mid-loop throws AbortError", async () => {
    const firstEvent = '{"type":"system","subtype":"init","session_id":"sess-abort","model":"claude-sonnet-4-6","tools":[]}';

    const multiProc = createMultiTurnMockProcess();
    multiProc.emitLines([firstEvent]);

    mock.module("@/process.js", () => ({
      ...realProcessModule,
      spawnClaude: () => multiProc,
    }));

    const createStream = await loadCreateStream();
    const controller = new AbortController();
    const stream = createStream("fix the bug", { maxBudgetUsd: 1, signal: controller.signal });

    const seen: string[] = [];
    const iterate = (async () => {
      for await (const event of stream) {
        seen.push(event.type);
        if (event.type === "session_meta") {
          controller.abort();
        }
      }
    })();

    await expect(iterate).rejects.toThrow(/aborted/i);
    expect(seen[0]).toBe("session_meta");
  });

  test("re-iterating the stream yields nothing (generator is cached, already consumed)", async () => {
    const createStream = await loadCreateStream();
    const stream = createStream("fix the bug", { maxBudgetUsd: 1 });

    const first: string[] = [];
    for await (const event of stream) {
      first.push(event.type);
    }

    const second: string[] = [];
    for await (const event of stream) {
      second.push(event.type);
    }

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
  });

  test("streams multi-agent fixture data correctly", async () => {
    const multiAgentLines = loadFixtureLines(join(FIXTURE_DIR, "multi-agent.ndjson"));
    mockProc = createMockProcess(multiAgentLines);
    mock.module("@/process.js", () => ({
      ...realProcessModule,
      spawnClaude: () => mockProc,
    }));

    const createStream = await loadCreateStream();
    const stream = createStream("dispatch agents", { maxBudgetUsd: 1 });
    const result = await stream.result();

    expect(result.sessionId).toBe("sess-multi");
    expect(result.costUsd).toBe(0.042);
    expect(result.text).toContain("Both agents completed");
  });
});
