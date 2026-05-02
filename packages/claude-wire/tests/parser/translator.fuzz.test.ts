import { describe, expect, test } from "bun:test";
import { parseLine } from "@/parser/ndjson.js";
import { createTranslator } from "@/parser/translator.js";
import type { TRelayEvent } from "@/types/events.js";
import type { TClaudeContent, TClaudeEvent } from "@/types/protocol.js";

// Seeded mulberry32 PRNG. Deterministic across Node/Bun/CI so a failure
// can be reproduced bit-for-bit by re-running with the same seed. Failures
// log the seed, the iteration, and the offending raw event.
const mulberry32 = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const RELAY_TYPES = new Set(["text", "thinking", "tool_use", "tool_result", "session_meta", "turn_complete", "error", "structured_output"]);

const RAW_EVENT_TYPES = ["system", "assistant", "user", "result", "progress", "rate_limit_event", "unknown_future_type"] as const;
const SUBTYPES = ["init", "result", "success", undefined, "weird_subtype"] as const;
const CONTENT_TYPES = ["text", "thinking", "tool_use", "tool_result", "image", "future_block_type", undefined] as const;

const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T;

const randomString = (rng: () => number, maxLen = 16): string => {
  const len = Math.floor(rng() * maxLen);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += String.fromCharCode(32 + Math.floor(rng() * 95));
  }
  return out;
};

// Sometimes returns undefined to exercise field-omission paths in the translator.
const maybe = <T>(rng: () => number, value: T): T | undefined => (rng() < 0.7 ? value : undefined);

const randomContentBlock = (rng: () => number): TClaudeContent => {
  const type = pick(rng, CONTENT_TYPES);
  return {
    // Cast through unknown so the fuzzer can produce blocks the static type
    // forbids (undefined type, future block names) -- we want to prove the
    // translator survives them, not that TypeScript prevents them.
    type: type as TClaudeContent["type"],
    text: maybe(rng, randomString(rng, 32)),
    thinking: maybe(rng, randomString(rng, 32)),
    id: maybe(rng, randomString(rng, 12)),
    name: maybe(rng, randomString(rng, 12)),
    input: maybe(rng, { foo: randomString(rng, 8), n: Math.floor(rng() * 100) }),
    content: maybe(rng, randomString(rng, 32)),
    tool_use_id: maybe(rng, randomString(rng, 12)),
    is_error: maybe(rng, rng() < 0.5),
  };
};

const randomRawEvent = (rng: () => number): TClaudeEvent => {
  const blockCount = Math.floor(rng() * 6);
  const blocks: TClaudeContent[] = [];
  for (let i = 0; i < blockCount; i++) {
    blocks.push(randomContentBlock(rng));
  }
  const modelUsageEntries: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; contextWindow?: number }> = {};
  if (rng() < 0.4) {
    const modelCount = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < modelCount; i++) {
      modelUsageEntries[`model-${i}`] = {
        inputTokens: Math.floor(rng() * 10000),
        outputTokens: Math.floor(rng() * 10000),
        cacheReadInputTokens: maybe(rng, Math.floor(rng() * 5000)),
        contextWindow: maybe(rng, 100000 + Math.floor(rng() * 100000)),
      };
    }
  }
  return {
    type: pick(rng, RAW_EVENT_TYPES),
    subtype: pick(rng, SUBTYPES),
    session_id: maybe(rng, randomString(rng, 8)),
    model: maybe(rng, pick(rng, ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"])),
    tools: maybe(rng, ["Read", "Write", "Bash"].slice(0, 1 + Math.floor(rng() * 3))),
    message: rng() < 0.7 ? { id: maybe(rng, randomString(rng, 8)), content: blocks, role: maybe(rng, "assistant") } : undefined,
    result: maybe(rng, randomString(rng, 64)),
    duration_ms: maybe(rng, Math.floor(rng() * 60000)),
    total_cost_usd: maybe(rng, rng() * 5),
    is_error: maybe(rng, rng() < 0.3),
    modelUsage: Object.keys(modelUsageEntries).length > 0 ? modelUsageEntries : undefined,
  };
};

const assertWellFormed = (event: TRelayEvent, raw: TClaudeEvent) => {
  expect(RELAY_TYPES.has(event.type)).toBe(true);
  switch (event.type) {
    case "text":
    case "thinking":
      expect(typeof event.content).toBe("string");
      // Translator drops empty content -- if we emitted, content must be non-empty.
      expect(event.content.length).toBeGreaterThan(0);
      break;
    case "tool_use":
      expect(typeof event.toolUseId).toBe("string");
      expect(event.toolUseId.length).toBeGreaterThan(0);
      expect(typeof event.toolName).toBe("string");
      expect(event.toolName.length).toBeGreaterThan(0);
      break;
    case "tool_result":
      expect(typeof event.toolUseId).toBe("string");
      expect(typeof event.output).toBe("string");
      expect(typeof event.isError).toBe("boolean");
      break;
    case "session_meta":
      expect(typeof event.sessionId).toBe("string");
      expect(typeof event.model).toBe("string");
      expect(Array.isArray(event.tools)).toBe(true);
      break;
    case "turn_complete":
      // All numeric fields optional; if present, must be finite.
      for (const k of ["costUsd", "inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens", "contextWindow", "durationMs"] as const) {
        const v = event[k];
        if (v !== undefined) {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
      break;
    case "error":
      expect(typeof event.message).toBe("string");
      break;
    case "structured_output":
      // value can be any JSON-shaped runtime value (object, array, scalar,
      // null). All we assert is presence; downstream consumers handle shape.
      expect("value" in event).toBe(true);
      break;
    default: {
      // Forces a compile-time error if a new TRelayEvent variant ships
      // without coverage here. The cast through never is intentional.
      const _exhaustive: never = event;
      throw new Error(`unhandled relay event in fuzz assertions: ${JSON.stringify(_exhaustive)} (raw: ${JSON.stringify(raw)})`);
    }
  }
};

describe("translator fuzz", () => {
  test("never throws across 2000 random events (seeded)", () => {
    const seed = 0xc0ffee;
    const rng = mulberry32(seed);
    const translator = createTranslator();

    for (let i = 0; i < 2000; i++) {
      const raw = randomRawEvent(rng);
      let events: TRelayEvent[] = [];
      try {
        events = translator.translate(raw);
      } catch (err) {
        // Surface seed + iteration + raw payload so the failure is reproducible.
        throw new Error(`translator threw at seed=${seed} iter=${i} raw=${JSON.stringify(raw)}: ${(err as Error).message}`);
      }
      for (const event of events) {
        try {
          assertWellFormed(event, raw);
        } catch (err) {
          throw new Error(
            `malformed event at seed=${seed} iter=${i} raw=${JSON.stringify(raw)} event=${JSON.stringify(event)}: ${(err as Error).message}`,
          );
        }
      }
    }
  });

  test("reset() clears block-dedup state across reused translators", () => {
    const rng = mulberry32(0xdeadbeef);
    const translator = createTranslator();
    for (let i = 0; i < 200; i++) {
      const raw = randomRawEvent(rng);
      translator.translate(raw);
      if (rng() < 0.3) {
        translator.reset();
      }
    }
    // No assertion beyond "didn't throw" -- reset() is a state mutation, not
    // an output. The contract is that any raw event accepted before reset()
    // must be safe to feed again after reset().
  });

  test("idempotent under repeated identical input (assistant block dedup)", () => {
    const rng = mulberry32(0xfeedface);
    const translator = createTranslator();
    const raw: TClaudeEvent = {
      type: "assistant",
      message: {
        id: "msg-1",
        content: [
          { type: "text", text: "hello" },
          { type: "tool_use", id: "t1", name: "Read", input: { path: "/foo" } },
        ],
      },
    };
    // First translate emits both blocks; second emits zero (dedup via lastContentIndex).
    const first = translator.translate(raw);
    expect(first.length).toBe(2);
    const second = translator.translate(raw);
    expect(second.length).toBe(0);
    // After reset the same payload re-emits.
    translator.reset();
    const third = translator.translate(raw);
    expect(third.length).toBe(2);
    // Random-noise call afterward must not crash.
    translator.translate(randomRawEvent(rng));
  });
});

describe("parseLine fuzz", () => {
  test("never throws on random byte-ish input across 2000 lines (seeded)", () => {
    const seed = 0xbadf00d;
    const rng = mulberry32(seed);
    for (let i = 0; i < 2000; i++) {
      const len = Math.floor(rng() * 200);
      let line = "";
      for (let j = 0; j < len; j++) {
        // Lean into JSON-adjacent bytes to maximize "almost-valid-JSON" paths
        // through parseLine's try/catch.
        const c = rng();
        if (c < 0.3) {
          line += pick(rng, ['"', "{", "}", "[", "]", ":", ",", "\\"]);
        } else if (c < 0.5) {
          line += String.fromCharCode(48 + Math.floor(rng() * 10));
        } else {
          line += String.fromCharCode(32 + Math.floor(rng() * 95));
        }
      }
      // No assertion needed beyond "doesn't throw" -- parseLine guarantees
      // it returns either a parsed event or undefined and never escapes.
      const result = parseLine(line);
      if (result !== undefined) {
        expect(typeof result).toBe("object");
      }
    }
  });

  test("round-trips well-formed events via JSON.stringify", () => {
    const rng = mulberry32(0x1234abcd);
    for (let i = 0; i < 200; i++) {
      const raw = randomRawEvent(rng);
      const line = JSON.stringify(raw);
      const parsed = parseLine(line);
      expect(parsed).toBeDefined();
      // type is the only field guaranteed to round-trip identically.
      expect(parsed?.type).toBe(raw.type);
    }
  });
});
