import { input, select } from "@inquirer/prompts";
import { claude } from "@pivanov/claude-wire";
import { answer, cyan, dim, divider, gap, info, label, prompt, stats, warn } from "./format.js";
import { createSpinner } from "./spinner.js";

export const meta = {
  name: "Resume session",
  description: "Resume a previous session by ID to continue the conversation",
};

const SEED_PROMPT = "What is your favorite color? Pick one and remember it.";
const RESUME_PROMPT = "What color did you pick? Reply in one word.";

export const run = async () => {
  const mode = await select({
    message: "How to get a session ID?",
    choices: [
      { name: "Create a new session first (recommended)", value: "create" as const },
      { name: "Enter an existing session ID", value: "manual" as const },
    ],
  });

  let sessionId: string;

  if (mode === "create") {
    gap();
    label("Step 1", "Create a session to resume later");
    divider();
    prompt(SEED_PROMPT);

    const s1 = createSpinner("Creating session...");
    s1.start();
    const seed = await claude.ask(SEED_PROMPT, { model: "haiku" });
    s1.stop();

    answer(seed.text);
    gap();
    info(`Session ID: ${cyan(seed.sessionId ?? "unknown")}`);

    sessionId = seed.sessionId ?? "";
    if (!sessionId) {
      warn("No session ID returned. Cannot resume.");
      return;
    }
  } else {
    sessionId = await input({
      message: "Session ID:",
      validate: (v) => {
        if (!v.trim()) {
          return "Session ID is required.";
        }
        return true;
      },
    });
  }

  gap();
  label("Step 2", "Resume the session");
  label("Model", "haiku");
  label("Resume", dim(sessionId));
  label("Options", "model=haiku");
  divider();
  prompt(RESUME_PROMPT);

  const s2 = createSpinner(`Resuming ${sessionId.slice(0, 12)}...`);
  s2.start();

  try {
    const r = await claude.ask(RESUME_PROMPT, { model: "haiku", resume: sessionId });
    s2.stop();

    answer(r.text);
    gap();
    stats(r);
  } catch (error) {
    s2.stop();
    gap();
    warn(`Failed to resume: ${error instanceof Error ? error.message : String(error)}`);
  }

  divider();
  info("Code: claude.ask(prompt, { resume: sessionId })");
};

if (import.meta.main) {
  run();
}
