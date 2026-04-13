import { claude } from "claude-wire";
import { cyan, divider, gap, green, info, label, stats } from "./format.js";
import { createSpinner } from "./spinner.js";

export const meta = {
  name: "Multi-turn session",
  description: "Keep the process alive between questions for context continuity",
};

const PROMPT_1 = "What is a closure in JavaScript? One sentence.";
const PROMPT_2 = "Give me a one-line code example of that.";

export const run = async () => {
  gap();
  label("Model", "haiku");
  label("Options", "model=haiku");
  label("Turn 1", `"${PROMPT_1}"`);
  label("Turn 2", `"${PROMPT_2}"`);
  divider();

  const session = claude.session({ model: "haiku" });

  try {
    const s1 = createSpinner("Turn 1...");
    s1.start();
    const r1 = await session.ask(PROMPT_1);
    s1.stop();
    console.log(`  ${green("1")} ${r1.text}`);
    console.log(`    ${cyan("cost")} $${r1.costUsd.toFixed(4)}`);
    gap();

    const s2 = createSpinner("Turn 2...");
    s2.start();
    const r2 = await session.ask(PROMPT_2);
    s2.stop();
    console.log(`  ${green("2")} ${r2.text}`);
    gap();

    stats(r2);
  } finally {
    await session.close();
    info("Session closed.");
  }

  divider();
  info("Code: const s = claude.session(opts); await s.ask(prompt);");
};

if (import.meta.main) {
  run();
}
