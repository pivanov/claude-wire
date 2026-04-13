import { describe, expect, test } from "bun:test";
import { parseLine } from "@/parser/ndjson.js";

describe("parseLine", () => {
  test("parses valid JSON line into TClaudeEvent", () => {
    const line = '{"type":"system","subtype":"init","session_id":"sess-1"}';
    const result = parseLine(line);
    expect(result).toEqual({
      type: "system",
      subtype: "init",
      session_id: "sess-1",
    });
  });

  test("returns undefined for empty string", () => {
    expect(parseLine("")).toBeUndefined();
  });

  test("returns undefined for whitespace-only string", () => {
    expect(parseLine("   \t  ")).toBeUndefined();
  });

  test("returns undefined for invalid JSON", () => {
    expect(parseLine("not json at all")).toBeUndefined();
  });

  test("returns undefined for partial JSON", () => {
    expect(parseLine('{"type":"system"')).toBeUndefined();
  });

  test("trims whitespace before parsing", () => {
    const line = '  {"type":"assistant"}  ';
    const result = parseLine(line);
    expect(result).toEqual({ type: "assistant" });
  });

  test("parses assistant event with message content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
      },
    });
    const result = parseLine(line);
    expect(result?.type).toBe("assistant");
    expect(result?.message?.content).toHaveLength(1);
    expect(result?.message?.content[0]?.text).toBe("Hello");
  });

  test("parses result event with double-encoded result", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      session_id: "sess-1",
      result: '"The actual text here"',
      is_error: false,
      total_cost_usd: 0.018,
    });
    const result = parseLine(line);
    expect(result?.type).toBe("result");
    expect(result?.total_cost_usd).toBe(0.018);
    expect(result?.result).toBe('"The actual text here"');
  });

  test("parses system init event with tools list", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-1",
      model: "claude-sonnet-4-6",
      tools: ["Read", "Write", "Edit", "Bash"],
    });
    const result = parseLine(line);
    expect(result?.tools).toEqual(["Read", "Write", "Edit", "Bash"]);
    expect(result?.model).toBe("claude-sonnet-4-6");
  });
});
