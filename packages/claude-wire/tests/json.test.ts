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
  test("parses bare JSON with a raw schema string", async () => {
    const result = await parseAndValidate<{ name: string }>('{"name":"test"}', '{"type":"object"}');
    expect(result).toEqual({ name: "test" });
  });

  test("parses fenced JSON with a raw schema string", async () => {
    const result = await parseAndValidate<{ x: number }>('```json\n{"x":42}\n```', "{}");
    expect(result).toEqual({ x: 42 });
  });

  test("throws JsonValidationError on invalid JSON", async () => {
    await expect(parseAndValidate("not json at all", "{}")).rejects.toBeInstanceOf(JsonValidationError);
    try {
      await parseAndValidate("not json", "{}");
    } catch (err) {
      expect(err).toBeInstanceOf(JsonValidationError);
      const e = err as JsonValidationError;
      expect(e.rawText).toBe("not json");
      expect(e.issues).toHaveLength(1);
    }
  });

  test("validates with a Standard Schema object", async () => {
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

    const result = await parseAndValidate('{"action":"fix"}', schema);
    expect(result).toEqual({ action: "fix" });
  });

  test("validates with an async Standard Schema object", async () => {
    const schema = {
      "~standard": {
        version: 1 as const,
        vendor: "test-async",
        validate: async (value: unknown) => {
          // Simulate an async refinement (e.g. Valibot pipeAsync).
          await Promise.resolve();
          if (typeof value === "object" && value !== null && "n" in value && typeof (value as { n: unknown }).n === "number") {
            return { value: value as { n: number } };
          }
          return { issues: [{ message: "n must be a number" }] };
        },
      },
    };

    const result = await parseAndValidate('{"n":7}', schema);
    expect(result).toEqual({ n: 7 });

    try {
      await parseAndValidate('{"n":"oops"}', schema);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(JsonValidationError);
      expect((err as JsonValidationError).message).toContain("n must be a number");
    }
  });

  test("throws JsonValidationError when Standard Schema validation fails", async () => {
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
      await parseAndValidate('{"field": 123}', schema);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(JsonValidationError);
      const e = err as JsonValidationError;
      expect(e.message).toContain("bad type");
      expect(e.issues[0]?.path).toEqual(["field"]);
    }
  });
});
