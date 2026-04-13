import { AbortError, claude } from "@pivanov/claude-wire";
import { answer, divider, gap, info, label, prompt, stats, warn } from "./format.js";
import { createSpinner } from "./spinner.js";

export const meta = {
  name: "Abort with timeout",
  description: "Cancel a request after a timeout using AbortSignal",
};

const PROMPT = "What is 2 + 2? Reply in one word.";
const TIMEOUT_MS = 15_000;

export const run = async () => {
  gap();
  label("Model", "haiku");
  label("Timeout", `${TIMEOUT_MS / 1000}s`);
  label("Options", "model=haiku");
  divider();
  prompt(PROMPT);

  const spinner = createSpinner(`Asking with ${TIMEOUT_MS / 1000}s timeout...`);
  spinner.start();

  try {
    const r = await claude.ask(PROMPT, {
      model: "haiku",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    spinner.stop();
    answer(r.text);
    gap();
    stats(r);
  } catch (error) {
    spinner.stop();
    if (error instanceof AbortError) {
      gap();
      warn(`Request aborted after ${TIMEOUT_MS / 1000}s timeout.`);
    } else {
      throw error;
    }
  }

  divider();
  info("Code: claude.ask(prompt, { signal: AbortSignal.timeout(15000) })");
};

if (import.meta.main) {
  run();
}
