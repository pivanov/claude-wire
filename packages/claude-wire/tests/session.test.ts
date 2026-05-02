import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { createMockProcess, createMultiTurnMockProcess, type IMockProcess, type IMultiTurnMockProcess } from "@/testing/index.js";
import { loadFixtureLines } from "./helpers/fixtures.js";
import { realProcessModule } from "./helpers/real-process.js";

const FIXTURE_DIR = join(import.meta.dir, "fixtures");
const singleTurnLines = loadFixtureLines(join(FIXTURE_DIR, "single-turn.ndjson"));

let spawnCount: number;
let lastMockProc: IMockProcess | IMultiTurnMockProcess;
let procFactory: () => IMockProcess | IMultiTurnMockProcess;

beforeEach(() => {
  spawnCount = 0;
  procFactory = () => createMockProcess(singleTurnLines);

  mock.module("@/process.js", () => ({
    ...realProcessModule,
    spawnClaude: () => {
      spawnCount++;
      lastMockProc = procFactory();
      return lastMockProc;
    },
    buildArgs: () => [],
  }));
});

afterAll(() => {
  mock.module("@/process.js", () => realProcessModule);
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
    const userWrites = multiProc.writes.filter((w) => {
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

    const procRef = lastMockProc;

    await session.close();

    expect(procRef.killed).toBe(true);
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

  test("queued ask() runs after a prior ask() rejects", async () => {
    const failLines = [
      '{"type":"system","subtype":"init","session_id":"sess-fail","model":"claude-sonnet-4-6","tools":[]}',
      '{"type":"result","subtype":"error","session_id":"sess-fail","result":"\\"kaboom\\"","is_error":true,"total_cost_usd":0,"duration_ms":10,"modelUsage":{}}',
    ];

    let call = 0;
    procFactory = () => {
      call++;
      if (call === 1) {
        // First spawn: emits an error turn_complete; translator surfaces an "error" event
        // and a turn_complete, so doAsk resolves (no throw). Force a real throw by omitting
        // turn_complete entirely and closing the stream.
        return createMockProcess([failLines[0]!]);
      }
      return createMockProcess(singleTurnLines);
    };

    const createSession = await loadCreateSession();
    const session = createSession({ maxBudgetUsd: 5 });

    const p1 = session.ask("first");
    const p2 = session.ask("second");

    await expect(p1).rejects.toThrow();
    const r2 = await p2;
    expect(r2.text).toContain("Fixed!");
    expect(spawnCount).toBe(2);

    await session.close();
  });

  test("retries until maxRespawnAttempts is exhausted within a single ask()", async () => {
    let spawnIdx = 0;
    procFactory = () => {
      spawnIdx++;
      if (spawnIdx <= 2) {
        // SIGKILL-like exit: no turn_complete, exit code 137 → transient.
        return createMockProcess([], 137);
      }
      return createMockProcess(singleTurnLines);
    };

    const createSession = await loadCreateSession();
    const session = createSession({ maxBudgetUsd: 1 });

    const result = await session.ask("fix the bug");
    expect(result.text).toContain("Fixed!");
    expect(spawnCount).toBe(3);

    await session.close();
  });

  test("BudgetExceededError marks session closed so subsequent asks reject cleanly", async () => {
    const budgetBusterLines = [
      '{"type":"system","subtype":"init","session_id":"sess-budget","model":"claude-sonnet-4-6","tools":[]}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}',
      '{"type":"result","subtype":"success","session_id":"sess-budget","result":"\\"ok\\"","is_error":false,"total_cost_usd":5,"duration_ms":10,"modelUsage":{"claude-sonnet-4-6":{"inputTokens":1,"outputTokens":1,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"contextWindow":200000}}}',
    ];

    procFactory = () => createMockProcess(budgetBusterLines);

    const createSession = await loadCreateSession();
    const session = createSession({ maxCostUsd: 0.01 });

    await expect(session.ask("first")).rejects.toThrow(/Budget exceeded/);
    await expect(session.ask("second")).rejects.toThrow("Session is closed");

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

  test("contract: accepts the exact option shape ls-prove passes", async () => {
    // Mirrors the call in ls-prove/src/agent/haiku.ts verbatim. If this
    // shape ever breaks, so does the consumer.
    const createSession = await loadCreateSession();
    const session = createSession({
      model: "haiku",
      systemPrompt: "you are a helpful assistant",
      allowedTools: [],
      settingSources: "",
      disableSlashCommands: true,
      permissionMode: "bypassPermissions",
      maxBudgetUsd: 1,
    });

    const result = await session.ask("ping");

    // Fields ls-prove reads off TAskResult:
    expect(typeof result.text).toBe("string");
    expect(typeof result.costUsd).toBe("number");
    expect(typeof result.tokens.input).toBe("number");
    expect(typeof result.tokens.output).toBe("number");
    expect(session.sessionId).toBeDefined();

    await session.close();
  });

  test("asyncDisposable support via Symbol.asyncDispose", async () => {
    const createSession = await loadCreateSession();
    const session = createSession({ maxBudgetUsd: 1 });

    expect(session[Symbol.asyncDispose]).toBeFunction();

    await session.ask("fix the bug");

    await session[Symbol.asyncDispose]();

    await expect(session.ask("another")).rejects.toThrow("Session is closed");
  });

  test("per-ask onCostUpdate fires alongside session-level observer", async () => {
    const sessionLevel: import("@/types/results.js").TCostSnapshot[] = [];
    const perAsk: import("@/types/results.js").TCostSnapshot[] = [];

    const createSession = await loadCreateSession();
    const session = createSession({
      maxBudgetUsd: 5,
      onCostUpdate: (cost) => sessionLevel.push({ ...cost }),
    });

    await session.ask("fix the bug", {
      onCostUpdate: (cost) => perAsk.push({ ...cost }),
    });

    // Both observers fire exactly once per turn_complete for a single-turn ask.
    expect(sessionLevel.length).toBe(1);
    expect(perAsk.length).toBe(1);
    // Both see the same cumulative snapshot at turn-complete time.
    expect(perAsk[0]!.totalUsd).toBe(sessionLevel[0]!.totalUsd);

    await session.close();
  });

  test("per-ask onCostUpdate swallows observer errors", async () => {
    const createSession = await loadCreateSession();
    const session = createSession({ maxBudgetUsd: 5 });

    const result = await session.ask("fix the bug", {
      onCostUpdate: () => {
        throw new Error("observer boom");
      },
    });

    // Ask still resolves normally -- observer throw must not reach the caller.
    expect(result.text).toContain("Fixed!");

    await session.close();
  });

  test("onRecycle fires with 'turn-limit' reason when the turn counter hits the threshold", async () => {
    const { LIMITS, TIMEOUTS } = await import("@/constants.js");
    const originalLimit = LIMITS.sessionMaxTurnsBeforeRecycle;
    const originalGrace = TIMEOUTS.gracefulExitMs;
    (LIMITS as { sessionMaxTurnsBeforeRecycle: number }).sessionMaxTurnsBeforeRecycle = 1;
    (TIMEOUTS as { gracefulExitMs: number }).gracefulExitMs = 50;

    try {
      const recycleReasons: string[] = [];
      const createSession = await loadCreateSession();
      const session = createSession({
        maxBudgetUsd: 5,
        onRecycle: (reason) => recycleReasons.push(reason),
      });

      await session.ask("fix the bug");

      expect(recycleReasons).toEqual(["turn-limit"]);

      await session.close();
    } finally {
      (LIMITS as { sessionMaxTurnsBeforeRecycle: number }).sessionMaxTurnsBeforeRecycle = originalLimit;
      (TIMEOUTS as { gracefulExitMs: number }).gracefulExitMs = originalGrace;
    }
  });

  test("onRecycle swallows observer errors", async () => {
    const { LIMITS, TIMEOUTS } = await import("@/constants.js");
    const originalLimit = LIMITS.sessionMaxTurnsBeforeRecycle;
    const originalGrace = TIMEOUTS.gracefulExitMs;
    (LIMITS as { sessionMaxTurnsBeforeRecycle: number }).sessionMaxTurnsBeforeRecycle = 1;
    (TIMEOUTS as { gracefulExitMs: number }).gracefulExitMs = 50;

    try {
      const createSession = await loadCreateSession();
      const session = createSession({
        maxBudgetUsd: 5,
        onRecycle: () => {
          throw new Error("recycle boom");
        },
      });

      const result = await session.ask("fix the bug");
      expect(result.text).toContain("Fixed!");

      await session.close();
    } finally {
      (LIMITS as { sessionMaxTurnsBeforeRecycle: number }).sessionMaxTurnsBeforeRecycle = originalLimit;
      (TIMEOUTS as { gracefulExitMs: number }).gracefulExitMs = originalGrace;
    }
  });

  test("askJson throws clear error when model emits thinking but no text", async () => {
    const { JsonValidationError } = await import("@/json.js");
    const thinkingOnlyLines = [
      '{"type":"system","subtype":"init","session_id":"s1","model":"haiku","tools":[]}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"User wants JSON. I should produce {\\"x\\":1}."}]}}',
      '{"type":"result","subtype":"success","session_id":"s1","result":"","is_error":false,"total_cost_usd":0.001,"duration_ms":300,"num_turns":1,"modelUsage":{}}',
    ];
    procFactory = () => createMockProcess(thinkingOnlyLines);

    const createSession = await loadCreateSession();
    const session = createSession();

    try {
      await session.askJson("classify", '{"type":"object"}');
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(JsonValidationError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/thinking/i);
      expect(msg).toMatch(/no text/i);
      // Session-specific guidance: hints at jsonSchema-at-creation OR stateless askJson.
      expect(msg).toMatch(/session/i);
    } finally {
      await session.close();
    }
  });
});
