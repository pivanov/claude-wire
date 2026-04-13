import { describe, expect, test } from "bun:test";
import { writer } from "@/writer.js";

describe("writer", () => {
  describe("user", () => {
    test("outputs valid JSON with trailing newline", () => {
      const line = writer.user("hello");
      expect(line.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(line)).not.toThrow();
    });

    test("has correct type and content", () => {
      const parsed = JSON.parse(writer.user("test prompt"));
      expect(parsed.type).toBe("user");
      expect(parsed.message.role).toBe("user");
      expect(parsed.message.content).toBe("test prompt");
    });
  });

  describe("approve", () => {
    test("outputs valid JSON with trailing newline", () => {
      const line = writer.approve("toolu_123");
      expect(line.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(line)).not.toThrow();
    });

    test("uses snake_case tool_use_id", () => {
      const parsed = JSON.parse(writer.approve("toolu_123"));
      expect(parsed.type).toBe("approve");
      expect(parsed.tool_use_id).toBe("toolu_123");
      expect(parsed.toolUseId).toBeUndefined();
    });
  });

  describe("deny", () => {
    test("outputs valid JSON with trailing newline", () => {
      const line = writer.deny("toolu_456");
      expect(line.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(line)).not.toThrow();
    });

    test("uses snake_case tool_use_id", () => {
      const parsed = JSON.parse(writer.deny("toolu_456"));
      expect(parsed.type).toBe("deny");
      expect(parsed.tool_use_id).toBe("toolu_456");
    });
  });

  describe("toolResult", () => {
    test("outputs valid JSON with trailing newline", () => {
      const line = writer.toolResult("toolu_789", "result content");
      expect(line.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(line)).not.toThrow();
    });

    test("uses snake_case tool_use_id and includes content", () => {
      const parsed = JSON.parse(writer.toolResult("toolu_789", "file contents here"));
      expect(parsed.type).toBe("tool_result");
      expect(parsed.tool_use_id).toBe("toolu_789");
      expect(parsed.content).toBe("file contents here");
    });
  });

  describe("abort", () => {
    test("outputs valid JSON with trailing newline", () => {
      const line = writer.abort();
      expect(line.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(line)).not.toThrow();
    });

    test("has correct type", () => {
      const parsed = JSON.parse(writer.abort());
      expect(parsed.type).toBe("abort");
    });
  });
});
