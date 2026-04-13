import { describe, expect, test } from "bun:test";
import { createToolHandler } from "@/tools/handler.js";
import type { TToolUseEvent } from "@/types/events.js";

const makeTool = (name: string): TToolUseEvent => ({
  type: "tool_use",
  toolUseId: "toolu_test",
  toolName: name,
  input: "{}",
});

describe("createToolHandler", () => {
  test("approves all tools by default", async () => {
    const handler = createToolHandler();
    expect(await handler.decide(makeTool("Read"))).toBe("approve");
    expect(await handler.decide(makeTool("Bash"))).toBe("approve");
  });

  test("denies blocked tools", async () => {
    const handler = createToolHandler({ blocked: ["Bash", "Write"] });
    expect(await handler.decide(makeTool("Bash"))).toBe("deny");
    expect(await handler.decide(makeTool("Write"))).toBe("deny");
    expect(await handler.decide(makeTool("Read"))).toBe("approve");
  });

  test("only allows listed tools when allowed is set", async () => {
    const handler = createToolHandler({ allowed: ["Read", "Grep"] });
    expect(await handler.decide(makeTool("Read"))).toBe("approve");
    expect(await handler.decide(makeTool("Grep"))).toBe("approve");
    expect(await handler.decide(makeTool("Bash"))).toBe("deny");
  });

  test("blocked takes precedence over allowed", async () => {
    const handler = createToolHandler({
      allowed: ["Read", "Bash"],
      blocked: ["Bash"],
    });
    expect(await handler.decide(makeTool("Read"))).toBe("approve");
    expect(await handler.decide(makeTool("Bash"))).toBe("deny");
  });

  test("calls onToolUse for custom decisions", async () => {
    const handler = createToolHandler({
      onToolUse: async (tool) => {
        if (tool.toolName === "Edit") {
          return { result: "mocked result" };
        }
        return "approve";
      },
    });

    expect(await handler.decide(makeTool("Edit"))).toEqual({ result: "mocked result" });
    expect(await handler.decide(makeTool("Read"))).toBe("approve");
  });

  test("blocked check runs before onToolUse", async () => {
    let called = false;
    const handler = createToolHandler({
      blocked: ["Bash"],
      onToolUse: async () => {
        called = true;
        return "approve";
      },
    });

    expect(await handler.decide(makeTool("Bash"))).toBe("deny");
    expect(called).toBe(false);
  });
});
