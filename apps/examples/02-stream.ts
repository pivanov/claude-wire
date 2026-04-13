import { claude } from "@pivanov/claude-wire";
import { bold, cyan, dim, divider, gap, green, info, label, prompt, yellow } from "./format.js";

export const meta = {
  name: "Event streaming",
  description: "Stream typed events as they arrive from the wire protocol",
};

const PROMPT = "Explain what TypeScript generics are in 3 sentences.";

export const run = async () => {
  gap();
  label("Model", "haiku");
  divider();
  prompt(PROMPT);
  gap();

  const events: string[] = [];
  const start = Date.now();

  for await (const event of claude.stream(PROMPT, { model: "haiku" })) {
    const elapsed = `${((Date.now() - start) / 1000).toFixed(1)}s`;

    switch (event.type) {
      case "session_meta": {
        events.push("session_meta");
        console.log(dim(`  ${elapsed}  session started (${event.model})`));
        break;
      }
      case "thinking": {
        events.push("thinking");
        console.log(dim(`  ${elapsed}  thinking...`));
        break;
      }
      case "text": {
        events.push("text");
        console.log(dim(`  ${elapsed}  text received (${event.content.length} chars)`));
        gap();
        console.log(`  ${event.content}`);
        gap();
        break;
      }
      case "tool_use": {
        events.push("tool_use");
        console.log(`  ${elapsed}  ${yellow("tool")} ${bold(event.toolName)}`);
        break;
      }
      case "tool_result": {
        events.push("tool_result");
        const status = event.isError ? yellow("error") : green("ok");
        console.log(dim(`  ${elapsed}  tool result (${status}) ${event.output.length} chars`));
        break;
      }
      case "turn_complete": {
        events.push("turn_complete");
        const cost = `$${event.costUsd?.toFixed(4)}`;
        const tokens = `${event.inputTokens ?? 0} in / ${event.outputTokens ?? 0} out`;
        console.log(`  ${green("\u2714")} ${cyan("Done")} ${cost} | ${tokens} | ${event.durationMs ?? 0}ms`);
        break;
      }
      case "error": {
        events.push("error");
        console.log(`  ${yellow("\u26A0")} ${event.message}`);
        break;
      }
    }
  }

  divider();
  info(`Events: ${events.join(" -> ")}`);
  info("Code: for await (const event of claude.stream(prompt, opts)) { ... }");
};

if (import.meta.main) {
  run();
}
