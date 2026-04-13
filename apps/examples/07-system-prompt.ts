import { claude } from "claude-wire";
import { answer, dim, divider, gap, info, label, prompt, stats } from "./format.js";
import { createSpinner } from "./spinner.js";

export const meta = {
  name: "System prompt",
  description: "Override Claude's behavior with a custom system prompt",
};

const PROMPT = "What is the best programming language?";
const SYSTEM = "You are a pirate. Answer everything in pirate speak. Keep it to 2 sentences.";

export const run = async () => {
  gap();
  label("Model", "haiku");
  label("System", dim(`"${SYSTEM}"`));
  label("Options", "model=haiku");
  divider();
  prompt(PROMPT);

  const spinner = createSpinner("Waiting for Claude...");
  spinner.start();
  const r = await claude.ask(PROMPT, { model: "haiku", systemPrompt: SYSTEM });
  spinner.stop();

  answer(r.text);
  gap();
  stats(r);
  divider();
  info("Code: claude.ask(prompt, { systemPrompt: '...' })");
};

if (import.meta.main) {
  run();
}
