import { describe, expect, test } from "bun:test";
import { blockFingerprint, extractContent, parseDoubleEncoded } from "@/parser/content.js";

describe("blockFingerprint", () => {
  test("uses tool_use id for tool_use blocks", () => {
    expect(blockFingerprint({ type: "tool_use", id: "toolu_123" })).toBe("tool_use:toolu_123");
  });

  test("uses type:text prefix for text blocks", () => {
    expect(blockFingerprint({ type: "text", text: "Hello world" })).toBe("text:Hello world");
  });

  test("uses thinking field for thinking blocks", () => {
    expect(blockFingerprint({ type: "thinking", thinking: "Let me think" })).toBe("thinking:Let me think");
  });

  test("falls back to text field for thinking blocks without thinking", () => {
    expect(blockFingerprint({ type: "thinking", text: "Fallback text" })).toBe("thinking:Fallback text");
  });

  test("truncates fingerprint text to 64 chars", () => {
    const longText = "a".repeat(100);
    const result = blockFingerprint({ type: "text", text: longText });
    expect(result).toBe(`text:${"a".repeat(64)}`);
  });

  test("falls back to tool_use_id for unknown block types", () => {
    expect(blockFingerprint({ type: "tool_result", tool_use_id: "toolu_456" })).toBe("tool_result:toolu_456");
  });

  test("uses 'unknown' when no identifiers available", () => {
    expect(blockFingerprint({ type: "other" })).toBe("other:unknown");
  });
});

describe("extractContent", () => {
  test("returns empty string for null", () => {
    expect(extractContent(null)).toBe("");
  });

  test("returns empty string for undefined", () => {
    expect(extractContent(undefined)).toBe("");
  });

  test("returns string as-is", () => {
    expect(extractContent("hello")).toBe("hello");
  });

  test("joins array of text blocks with newline", () => {
    const blocks = [
      { type: "text", text: "line 1" },
      { type: "text", text: "line 2" },
    ];
    expect(extractContent(blocks)).toBe("line 1\nline 2");
  });

  test("filters out non-text blocks in array", () => {
    const blocks = [{ type: "text", text: "hello" }, { type: "image" }, { type: "text", text: "world" }];
    expect(extractContent(blocks)).toBe("hello\nworld");
  });

  test("returns empty string for empty array", () => {
    expect(extractContent([])).toBe("");
  });

  test("returns empty string for non-string non-array values", () => {
    expect(extractContent(42)).toBe("");
    expect(extractContent({})).toBe("");
    expect(extractContent(true)).toBe("");
  });
});

describe("parseDoubleEncoded", () => {
  test("decodes double-encoded JSON string", () => {
    expect(parseDoubleEncoded('"Hello world"')).toBe("Hello world");
  });

  test("returns original string if not double-encoded", () => {
    expect(parseDoubleEncoded("just a plain string")).toBe("just a plain string");
  });

  test("returns original string if JSON parses to non-string", () => {
    expect(parseDoubleEncoded("[1,2,3]")).toBe("[1,2,3]");
  });

  test("handles null input", () => {
    expect(parseDoubleEncoded(null)).toBe("");
  });

  test("handles undefined input", () => {
    expect(parseDoubleEncoded(undefined)).toBe("");
  });

  test("converts number input to string", () => {
    expect(parseDoubleEncoded(42)).toBe("42");
  });

  test("decodes escaped content", () => {
    expect(parseDoubleEncoded('"Fixed! The bug was an undefined variable reference."')).toBe(
      "Fixed! The bug was an undefined variable reference.",
    );
  });
});
