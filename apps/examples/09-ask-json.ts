import { claude } from "@pivanov/claude-wire";
import { z } from "zod";
import { answer, divider, gap, info, label, prompt, stats } from "./format.js";
import { createSpinner } from "./spinner.js";

export const meta = {
  name: "Ask JSON",
  description: "Use askJson() with a Zod schema to get typed, validated structured output",
};

const PROMPT = "List 3 programming languages as JSON: { languages: { name: string, year: number }[] }";

const schema = z.object({
  languages: z.array(
    z.object({
      name: z.string(),
      year: z.number(),
    }),
  ),
});

export const run = async () => {
  gap();
  label("Model", "haiku");
  label("Schema", "z.object({ languages: z.array(...) })");
  divider();
  prompt(PROMPT);

  const spinner = createSpinner("Waiting for Claude...");
  spinner.start();
  const { data, raw } = await claude.askJson(PROMPT, schema, { model: "haiku" });
  spinner.stop();

  answer(JSON.stringify(data, null, 2));
  gap();
  stats(raw);
  divider();
  info("Code: claude.askJson(prompt, schema, { model: 'haiku' })");
};

if (import.meta.main) {
  run();
}
