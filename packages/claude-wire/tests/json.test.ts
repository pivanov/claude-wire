import { describe, expect, test } from "bun:test";
import { JsonValidationError, parseAndValidate, stripFences } from "@/json.js";

describe("stripFences", () => {
  test("strips ```json ... ``` fences", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test("strips bare ``` ... ``` fences", () => {
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test("passes through bare JSON", () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });

  test("trims whitespace around bare JSON", () => {
    expect(stripFences('  {"a":1}  ')).toBe('{"a":1}');
  });

  test("handles fences with extra whitespace", () => {
    expect(stripFences('  ```json\n  {"a":1}\n  ```  ')).toBe('{"a":1}');
  });
});

describe("parseAndValidate", () => {
  test("parses bare JSON with a raw schema string", () => {
    const result = parseAndValidate<{ name: string }>('{"name":"test"}', '{"type":"object"}');
    expect(result).toEqual({ name: "test" });
  });

  test("parses fenced JSON with a raw schema string", () => {
    const result = parseAndValidate<{ x: number }>('```json\n{"x":42}\n```', "{}");
    expect(result).toEqual({ x: 42 });
  });

  test("throws JsonValidationError on invalid JSON", () => {
    expect(() => parseAndValidate("not json at all", "{}")).toThrow(JsonValidationError);
    try {
      parseAndValidate("not json", "{}");
    } catch (err) {
      expect(err).toBeInstanceOf(JsonValidationError);
      const e = err as JsonValidationError;
      expect(e.rawText).toBe("not json");
      expect(e.issues).toHaveLength(1);
    }
  });

  test("validates with a Standard Schema object", () => {
    // Minimal Standard Schema implementation for testing
    const schema = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: (value: unknown) => {
          if (typeof value === "object" && value !== null && "action" in value) {
            return { value: value as { action: string } };
          }
          return { issues: [{ message: "missing action field" }] };
        },
      },
    };

    const result = parseAndValidate('{"action":"fix"}', schema);
    expect(result).toEqual({ action: "fix" });
  });

  test("throws JsonValidationError when Standard Schema validation fails", () => {
    const schema = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: (_: unknown) => ({
          issues: [{ message: "bad type", path: ["field"] }],
        }),
      },
    };

    try {
      parseAndValidate('{"field": 123}', schema);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(JsonValidationError);
      const e = err as JsonValidationError;
      expect(e.message).toContain("bad type");
      expect(e.issues[0]?.path).toEqual(["field"]);
    }
  });
});
