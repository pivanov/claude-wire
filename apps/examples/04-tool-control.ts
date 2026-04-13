import { claude } from "claude-wire";
import { answer, cyan, dim, divider, gap, info, label, prompt, stats, yellow } from "./format.js";
import { createSpinner } from "./spinner.js";

export const meta = {
  name: "Tool control",
  description: "Allow/block tools and intercept executions with a custom handler",
};

const PROMPT = "Read the package.json in the current directory and tell me the project name.";

export const run = async () => {
  gap();
  label("Model", "haiku");
  label("Allowed", "Read, Glob");
  label("Blocked", "Bash, Write, Edit");
  label("Handler", "onToolUse logs each request");
  divider();
  prompt(PROMPT);

  const spinner = createSpinner("Waiting for Claude...");
  spinner.start();

  const r = await claude.ask(PROMPT, {
    model: "haiku",
    cwd: process.cwd(),
    tools: {
      allowed: ["Read", "Glob"],
      blocked: ["Bash", "Write", "Edit"],
      onToolUse: async (tool) => {
        spinner.stop();
        console.log(`  ${yellow("\u2192")} ${cyan(tool.toolName)} ${dim(tool.input.slice(0, 60))}`);
        spinner.start("Waiting for Claude...");
        return "approve";
      },
    },
  });

  spinner.stop();
  answer(r.text);
  gap();
  stats(r);
  divider();
  info("Code: claude.ask(prompt, { tools: { allowed, blocked, onToolUse } })");
};

if (import.meta.main) {
  run();
}
