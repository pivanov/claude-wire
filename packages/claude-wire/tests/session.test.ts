import { beforeEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import {
  createMockProcess,
  createMultiTurnMockProcess,
  loadFixtureLines,
  type TMockProcess,
  type TMultiTurnMockProcess,
} from "./helpers/mock-process.js";

const FIXTURE_DIR = join(import.meta.dir, "fixtures");
const singleTurnLines = loadFixtureLines(join(FIXTURE_DIR, "single-turn.ndjson"));

let spawnCount: number;
let lastMockProc: TMockProcess | TMultiTurnMockProcess;
let procFactory: () => TMockProcess | TMultiTurnMockProcess;

beforeEach(() => {
  spawnCount = 0;
  procFactory = () => createMockProcess(singleTurnLines);

  mock.module("@/process.js", () => ({
    spawnClaude: () => {
      spawnCount++;
      lastMockProc = procFactory();
      return lastMockProc;
    },
    buildArgs: () => [],
    resetBinaryCache: () => {},
  }));
});

const loadCreateSession = async () => {
  const mod = await import("@/session.js");
  return mod.createSession;
};

describe("createSession", () => {
  test("first ask() spawns a process and returns result", async () => {
    const createSession = await loadCreateSession();
    const session = createSession({ maxBudgetUsd: 1 });

    const result = await session.ask("fix the bug");

    expect(spawnCount).toBe(1);
    expect(result.text).toContain("Fixed!");
    expect(result.sessionId).toBe("sess-1");
    expect(result.costUsd).toBe(0.018);
    expect(result.events.length).toBeGreaterThan(0);

    await session.close();
  });

  test("second ask() writes to stdin (reuses process)", async () => {
    const turn2Lines = [
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Second answer."}]}}',
      '{"type":"result","subtype":"success","session_id":"sess-1","result":"\\"Second answer.\\"","is_error":false,"total_cost_usd":0.025,"duration_ms":3000,"modelUsage":{"claude-sonnet-4-6":{"inputTokens":700,"outputTokens":80,"cacheReadInputTokens":4000,"cacheCreationInputTokens":0,"contextWindow":200000}}}',
    ];

    const multiProc = createMultiTurnMockProcess();

    // Intercept writes to detect user messages and emit turn 2
    const origWrite = multiProc.write.bind(multiProc);
    Object.defineProperty(multiProc, "write", {
      value: (msg: string) => {
        origWrite(msg);
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === "user") {
            setTimeout(() => multiProc.emitLines(turn2Lines), 5);
          }
        } catch {
          // ignore
        }
      },
    });

    // Emit turn 1 data synchronously before the reader starts
    multiProc.emitLines(singleTurnLines);

    procFactory = () => multiProc;

    const createSession = await loadCreateSession();
    const session = createSession({ maxBudgetUsd: 1 });

    const result1 = await session.ask("first question");
    expect(result1.text).toContain("Fixed!");
    expect(spawnCount).toBe(1);

    const result2 = await session.ask("second question");
    expect(result2.text).toContain("Second answer.");
    expect(spawnCount).toBe(1);

    // Verify the user message was written to stdin
    const userWrites = multiProc._writes.filter((w) => {
      try {
        return JSON.parse(w).type === "user";
      } catch {
        return false;
      }
    });
    expect(userWrites.length).toBe(1);
    expect(JSON.parse(userWrites[0]!).message.content).toBe("second question");

    await session.close();
  });

  test("session ID tracked from session_meta event", async () => {
    const createSession = await loadCreateSession();
    const session = createSession({ maxBudgetUsd: 1 });

    expect(session.sessionId).toBeUndefined();

    await session.ask("fix the bug");

    expect(session.sessionId).toBe("sess-1");

    await session.close();
  });

  test("cost tracking across turns", async () => {
    const costUpdates: import("@/types/results.js").TCostSnapshot[] = [];

    const createSession = await loadCreateSession();
    const session = createSession({
      maxBudgetUsd: 5,
      onCostUpdate: (cost) => costUpdates.push({ ...cost }),
    });

    const result = await session.ask("fix the bug");

    expect(result.costUsd).toBe(0.018);
    expect(result.tokens.input).toBe(3500);
    expect(result.tokens.output).toBe(120);
    expect(costUpdates.length).toBeGreaterThan(0);
    expect(costUpdates[costUpdates.length - 1]!.totalUsd).toBe(0.018);

    await session.close();
  });

  test("close() kills the process", async () => {
    const createSession = await loadCreateSession();
    const session = createSession({ maxBudgetUsd: 1 });

    await session.ask("fix the bug");

    const procRef = lastMockProc as TMockProcess & { readonly _killed: boolean };

    await session.close();

    expect(procRef._killed).toBe(true);
  });

  test("concurrent ask() calls are queued (second waits for first)", async () => {
    const turn1Lines = [
      '{"type":"system","subtype":"init","session_id":"sess-q","model":"claude-sonnet-4-6","tools":[]}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"First."}]}}',
      '{"type":"result","subtype":"success","session_id":"sess-q","result":"\\"First.\\"","is_error":false,"total_cost_usd":0.01,"duration_ms":1000,"modelUsage":{"claude-sonnet-4-6":{"inputTokens":100,"outputTokens":10,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"contextWindow":200000}}}',
    ];
    const turn2Lines = [
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Second."}]}}',
      '{"type":"result","subtype":"success","session_id":"sess-q","result":"\\"Second.\\"","is_error":false,"total_cost_usd":0.02,"duration_ms":2000,"modelUsage":{"claude-sonnet-4-6":{"inputTokens":200,"outputTokens":20,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"contextWindow":200000}}}',
    ];

    const multiProc = createMultiTurnMockProcess();

    const origWrite = multiProc.write.bind(multiProc);
    Object.defineProperty(multiProc, "write", {
      value: (msg: string) => {
        origWrite(msg);
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === "user") {
            setTimeout(() => multiProc.emitLines(turn2Lines), 5);
          }
        } catch {
          // ignore
        }
      },
    });

    // Emit turn 1 data after a small delay so both asks get queued
    setTimeout(() => multiProc.emitLines(turn1Lines), 5);

    procFactory = () => multiProc;

    const createSession = await loadCreateSession();
    const session = createSession({ maxBudgetUsd: 5 });

    const order: string[] = [];

    const p1 = session.ask("first").then((r) => {
      order.push("first");
      return r;
    });
    const p2 = session.ask("second").then((r) => {
      order.push("second");
      return r;
    });

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(order).toEqual(["first", "second"]);
    expect(r1.text).toBe("First.");
    expect(r2.text).toBe("Second.");

    await session.close();
  });

  test("close() on closed session is idempotent", async () => {
    const createSession = await loadCreateSession();
    const session = createSession({ maxBudgetUsd: 1 });

    await session.ask("fix the bug");
    await session.close();

    // Second close should not throw
    await session.close();
  });

  test("ask() after close() rejects", async () => {
    const createSession = await loadCreateSession();
    const session = createSession({ maxBudgetUsd: 1 });

    await session.ask("fix the bug");
    await session.close();

    await expect(session.ask("another")).rejects.toThrow("Session is closed");
  });

  test("asyncDisposable support via Symbol.asyncDispose", async () => {
    const createSession = await loadCreateSession();
    const session = createSession({ maxBudgetUsd: 1 });

    expect(session[Symbol.asyncDispose]).toBeFunction();

    await session.ask("fix the bug");

    await session[Symbol.asyncDispose]();

    await expect(session.ask("another")).rejects.toThrow("Session is closed");
  });
});
