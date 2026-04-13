import { describe, expect, test } from "bun:test";
import { BUILT_IN_TOOLS, isBuiltInTool } from "@/tools/registry.js";

describe("BUILT_IN_TOOLS", () => {
  test("contains core tools", () => {
    expect(BUILT_IN_TOOLS.has("Read")).toBe(true);
    expect(BUILT_IN_TOOLS.has("Write")).toBe(true);
    expect(BUILT_IN_TOOLS.has("Edit")).toBe(true);
    expect(BUILT_IN_TOOLS.has("Bash")).toBe(true);
    expect(BUILT_IN_TOOLS.has("Glob")).toBe(true);
    expect(BUILT_IN_TOOLS.has("Grep")).toBe(true);
    expect(BUILT_IN_TOOLS.has("Agent")).toBe(true);
  });

  test("is a non-empty Set", () => {
    expect(BUILT_IN_TOOLS.size).toBeGreaterThan(0);
  });
});

describe("isBuiltInTool", () => {
  test("returns true for known tools", () => {
    expect(isBuiltInTool("Read")).toBe(true);
    expect(isBuiltInTool("Bash")).toBe(true);
    expect(isBuiltInTool("Agent")).toBe(true);
  });

  test("returns false for unknown tools", () => {
    expect(isBuiltInTool("my-mcp-tool")).toBe(false);
    expect(isBuiltInTool("")).toBe(false);
    expect(isBuiltInTool("read")).toBe(false);
  });
});
