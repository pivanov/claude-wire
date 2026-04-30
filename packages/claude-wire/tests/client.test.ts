import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_JSON_SYSTEM_PROMPT } from "@/json.js";
import { createMockProcess, type IMockProcess } from "@/testing/index.js";
import { realProcessModule } from "./helpers/real-process.js";

const jsonLines = [
  '{"type":"system","subtype":"init","session_id":"sess-1","model":"claude-sonnet-4-6","tools":[]}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"{\\"label\\":\\"feature\\"}"}]}}',
  '{"type":"result","subtype":"success","session_id":"sess-1","result":"{\\"label\\":\\"feature\\"}","is_error":false,"total_cost_usd":0.002,"duration_ms":1200,"duration_api_ms":900,"num_turns":1,"modelUsage":{"claude-sonnet-4-6":{"inputTokens":120,"outputTokens":20,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"contextWindow":200000}}}',
];

let mockProc: IMockProcess;
let spawnedWith: { options: unknown } | undefined;

beforeEach(() => {
  mockProc = createMockProcess(jsonLines);
  spawnedWith = undefined;
  mock.module("@/process.js", () => ({
    ...realProcessModule,
    spawnClaude: (options: unknown) => {
      spawnedWith = { options };
      return mockProc;
    },
    buildArgs: () => [],
  }));
});

afterAll(() => {
  mock.module("@/process.js", () => realProcessModule);
});

const loadClient = async () => {
  const mod = await import("@/client.js");
  return mod.createClient;
};

describe("createClient.askJson", () => {
  test("injects DEFAULT_JSON_SYSTEM_PROMPT when caller passes no systemPrompt", async () => {
    const createClient = await loadClient();
    const client = createClient();

    await client.askJson("Classify this", '{"type":"object"}');

    const opts = spawnedWith?.options as { systemPrompt?: string } | undefined;
    expect(opts?.systemPrompt).toBe(DEFAULT_JSON_SYSTEM_PROMPT);
  });

  test("caller-provided systemPrompt wins over the default", async () => {
    const createClient = await loadClient();
    const client = createClient();

    await client.askJson("Classify this", '{"type":"object"}', {
      systemPrompt: "You are an intent classifier. Return JSON only.",
    });

    const opts = spawnedWith?.options as { systemPrompt?: string } | undefined;
    expect(opts?.systemPrompt).toBe("You are an intent classifier. Return JSON only.");
    expect(opts?.systemPrompt).not.toBe(DEFAULT_JSON_SYSTEM_PROMPT);
  });

  test("client-level defaults with systemPrompt are preserved", async () => {
    const createClient = await loadClient();
    const client = createClient({ systemPrompt: "Default system prompt from client." });

    await client.askJson("Classify this", '{"type":"object"}');

    const opts = spawnedWith?.options as { systemPrompt?: string } | undefined;
    expect(opts?.systemPrompt).toBe("Default system prompt from client.");
  });

  test("ask (non-JSON) is not touched by the default", async () => {
    const createClient = await loadClient();
    const client = createClient();

    await client.ask("Just a regular prompt");

    const opts = spawnedWith?.options as { systemPrompt?: string } | undefined;
    expect(opts?.systemPrompt).toBeUndefined();
  });

  test("DEFAULT_JSON_SYSTEM_PROMPT mentions JSON-only constraints", () => {
    expect(DEFAULT_JSON_SYSTEM_PROMPT).toMatch(/json/i);
    expect(DEFAULT_JSON_SYSTEM_PROMPT).toMatch(/only/i);
    expect(DEFAULT_JSON_SYSTEM_PROMPT.length).toBeGreaterThan(50);
  });
});
