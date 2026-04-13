import { claude } from "claude-wire";
import { answer, divider, gap, info, label, prompt, stats } from "./format.js";
import { createSpinner } from "./spinner.js";

export const meta = {
  name: "One-shot ask",
  description: "Send a prompt, get a typed result with cost and token breakdown",
};

const PROMPT = "What is the capital of France? Reply in one sentence.";

export const run = async () => {
  gap();
  label("Model", "haiku");
  label("Options", "model=haiku");
  divider();
  prompt(PROMPT);

  const spinner = createSpinner("Waiting for Claude...");
  spinner.start();
  const r = await claude.ask(PROMPT, { model: "haiku" });
  spinner.stop();

  answer(r.text);
  gap();
  stats(r);
  divider();
  info("Code: claude.ask(prompt, { model: 'haiku' })");
};

if (import.meta.main) {
  run();
}
