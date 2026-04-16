import { describe, expect, test } from "bun:test";
import { classifyStderr } from "@/stderr.js";

describe("classifyStderr", () => {
  test("classifies rate limit errors", () => {
    expect(classifyStderr("Error: rate limit exceeded")).toBe("rate-limit");
    expect(classifyStderr("HTTP 429 Too Many Requests")).toBe("rate-limit");
    expect(classifyStderr("too many requests, please retry")).toBe("rate-limit");
  });

  test("classifies overloaded errors", () => {
    expect(classifyStderr("overloaded_error: service temporarily unavailable")).toBe("overloaded");
    expect(classifyStderr("529 temporarily unavailable")).toBe("overloaded");
  });

  test("classifies context length exceeded", () => {
    expect(classifyStderr("context length exceeded: maximum 200000 tokens")).toBe("context-length-exceeded");
    expect(classifyStderr("Error: context window overflow")).toBe("context-length-exceeded");
    expect(classifyStderr("prompt is too long for this model")).toBe("context-length-exceeded");
  });

  test("classifies JSON schema errors", () => {
    expect(classifyStderr("invalid json schema provided")).toBe("invalid-json-schema");
    expect(classifyStderr('Error: schema invalid at path "items"')).toBe("invalid-json-schema");
    expect(classifyStderr("json schema error: unexpected type")).toBe("invalid-json-schema");
  });

  test("classifies MCP errors", () => {
    expect(classifyStderr("MCP server failed to start")).toBe("mcp-error");
    expect(classifyStderr("Error: mcp error during tool call")).toBe("mcp-error");
  });

  test("classifies auth errors", () => {
    expect(classifyStderr("not authenticated, please run claude auth")).toBe("not-authenticated");
    expect(classifyStderr("Error: 401 Unauthorized")).toBe("not-authenticated");
  });

  test("classifies permission errors", () => {
    expect(classifyStderr("permission denied")).toBe("permission-denied");
    expect(classifyStderr("HTTP 403 Forbidden")).toBe("permission-denied");
  });

  test("classifies binary not found", () => {
    expect(classifyStderr("binary not found: claude")).toBe("binary-not-found");
    expect(classifyStderr("ENOENT: claude command not found")).toBe("binary-not-found");
  });

  test("returns undefined for unrecognized errors", () => {
    expect(classifyStderr("something went wrong")).toBeUndefined();
    expect(classifyStderr("generic error")).toBeUndefined();
    expect(classifyStderr("")).toBeUndefined();
  });
});
