import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_JSON_SYSTEM_PROMPT, type IStandardSchema, JsonValidationError, standardSchemaToJsonSchema } from "@/json.js";
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

  test("auto-derives jsonSchema from an arktype-vendor Standard Schema", async () => {
    // arktype is the vendor we can fake without mocking a peer module: the
    // converter is a `.toJsonSchema` method on the schema object itself.
    const arkSchema = {
      "~standard": {
        version: 1 as const,
        vendor: "arktype",
        validate: (v: unknown) => ({ value: v as { label: string } }),
      },
      toJsonSchema: () => ({ type: "object", properties: { label: { type: "string" } } }),
    } as IStandardSchema<{ label: string }> & { toJsonSchema: () => unknown };

    const createClient = await loadClient();
    const client = createClient();

    await client.askJson("classify", arkSchema);

    const opts = spawnedWith?.options as { jsonSchema?: string } | undefined;
    expect(opts?.jsonSchema).toBeDefined();
    const parsed = JSON.parse(opts?.jsonSchema ?? "{}");
    expect(parsed.type).toBe("object");
    expect(parsed.properties.label.type).toBe("string");
  });

  test("explicit jsonSchema option is preserved over auto-derive", async () => {
    const arkSchema = {
      "~standard": {
        version: 1 as const,
        vendor: "arktype",
        validate: (v: unknown) => ({ value: v as { label: string } }),
      },
      toJsonSchema: () => ({ type: "object", auto: true }),
    } as IStandardSchema<{ label: string }> & { toJsonSchema: () => unknown };

    const createClient = await loadClient();
    const client = createClient();

    await client.askJson("classify", arkSchema, {
      jsonSchema: '{"type":"object","explicit":true}',
    });

    const opts = spawnedWith?.options as { jsonSchema?: string } | undefined;
    expect(opts?.jsonSchema).toBe('{"type":"object","explicit":true}');
  });

  test("unknown Standard Schema vendor leaves jsonSchema unset", async () => {
    const unknownSchema = {
      "~standard": {
        version: 1 as const,
        vendor: "made-up-library",
        validate: (v: unknown) => ({ value: v as { x: number } }),
      },
    } as IStandardSchema<{ x: number }>;

    const createClient = await loadClient();
    const client = createClient();

    await client.askJson("get", unknownSchema);

    const opts = spawnedWith?.options as { jsonSchema?: string } | undefined;
    expect(opts?.jsonSchema).toBeUndefined();
  });

  test("askJson reads structured JSON from a StructuredOutput tool_use block", async () => {
    // When --json-schema is set, recent Claude Code CLI builds deliver the
    // schema-constrained value via a synthetic tool_use named StructuredOutput.
    // The translator emits a structured_output relay event; buildResult
    // surfaces it as raw.structuredOutput; askJson reads that channel
    // preferentially over raw.text (which can carry hook nag messages).
    mockProc = createMockProcess([
      '{"type":"system","subtype":"init","session_id":"sess-1","model":"haiku","tools":[]}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"StructuredOutput","input":{"greeting":"hello"}}]}}',
      '{"type":"result","subtype":"success","session_id":"sess-1","result":"Hello!","is_error":false,"total_cost_usd":0.001,"duration_ms":300,"num_turns":1,"modelUsage":{}}',
    ]);

    const createClient = await loadClient();
    const client = createClient();

    const { data, raw } = await client.askJson<{ greeting: string }>("Reply with greeting hello", '{"type":"object"}');
    expect(data).toEqual({ greeting: "hello" });
    expect(raw.structuredOutput).toEqual({ greeting: "hello" });
  });

  test("askJson falls back to result.structured_output when block route is missing", async () => {
    // Reproduces the wiki/logicstar case: the StructuredOutput tool_use
    // block arrived with undefined input (CLI streaming partial), so the
    // translator dropped it; raw.text only contains the Stop-hook nag.
    // Without this fallback parseAndValidate sees the nag and fails.
    mockProc = createMockProcess([
      '{"type":"system","subtype":"init","session_id":"sess-1","model":"haiku","tools":[]}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Stop hook feedback:\\nYou MUST call the StructuredOutput tool to complete this request."}]}}',
      '{"type":"result","subtype":"success","session_id":"sess-1","result":"Hello!","is_error":false,"total_cost_usd":0.001,"duration_ms":300,"num_turns":1,"modelUsage":{},"structured_output":{"greeting":"hello"}}',
    ]);

    const createClient = await loadClient();
    const client = createClient();

    const { data, raw } = await client.askJson<{ greeting: string }>("Reply with greeting hello", '{"type":"object"}');
    expect(data).toEqual({ greeting: "hello" });
    expect(raw.structuredOutput).toEqual({ greeting: "hello" });
    // raw.text retains the hook nag; we don't rewrite it. The structured
    // value lives in its own field so parseAndValidate sees only JSON.
    expect(raw.text).toContain("Stop hook feedback");
  });

  test("throws clear error when model emits thinking but no text", async () => {
    // Override mockProc with a transcript that has thinking and turn_complete
    // but no text block. parseAndValidate("") would otherwise throw a
    // confusing "Unexpected EOF" from JSON.parse.
    mockProc = createMockProcess([
      '{"type":"system","subtype":"init","session_id":"s1","model":"haiku","tools":[]}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"User wants JSON. I should produce {\\"x\\":1}."}]}}',
      '{"type":"result","subtype":"success","session_id":"s1","result":"","is_error":false,"total_cost_usd":0.001,"duration_ms":300,"num_turns":1,"modelUsage":{}}',
    ]);

    const createClient = await loadClient();
    const client = createClient();

    try {
      await client.askJson("classify", '{"type":"object"}');
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(JsonValidationError);
      const e = err as JsonValidationError;
      expect(e.message).toMatch(/thinking/i);
      expect(e.message).toMatch(/no text/i);
      expect(e.rawText).toBe("");
    }
  });
});

describe("standardSchemaToJsonSchema", () => {
  test("derives via arktype's toJsonSchema method on the schema object", async () => {
    const ark = {
      "~standard": {
        version: 1 as const,
        vendor: "arktype",
        validate: (v: unknown) => ({ value: v }),
      },
      toJsonSchema: () => ({ type: "object", properties: { id: { type: "number" } } }),
    } as IStandardSchema<{ id: number }> & { toJsonSchema: () => unknown };

    const result = await standardSchemaToJsonSchema(ark);
    expect(result).toBe('{"type":"object","properties":{"id":{"type":"number"}}}');
  });

  test("returns undefined for unknown vendor", async () => {
    const schema: IStandardSchema<unknown> = {
      "~standard": {
        version: 1 as const,
        vendor: "future-lib",
        validate: (v: unknown) => ({ value: v }),
      },
    };
    expect(await standardSchemaToJsonSchema(schema)).toBeUndefined();
  });

  test("returns undefined when arktype schema lacks the method", async () => {
    const schema: IStandardSchema<unknown> = {
      "~standard": {
        version: 1 as const,
        vendor: "arktype",
        validate: (v: unknown) => ({ value: v }),
      },
    };
    expect(await standardSchemaToJsonSchema(schema)).toBeUndefined();
  });
});
