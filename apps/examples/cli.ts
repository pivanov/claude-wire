import { select } from "@inquirer/prompts";
import { dim } from "./format.js";

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const preflight = () => {
  const result = Bun.spawnSync(["which", "claude"], { stdout: "pipe", stderr: "pipe" });
  const path = new TextDecoder().decode(result.stdout).trim();
  if (!path) {
    console.error(`\n  ${red("\u2718")} Claude Code CLI not found.`);
    console.error(dim("  Install it from https://claude.ai/download\n"));
    process.exit(1);
  }
};

const examples = [
  "./01-ask.js",
  "./02-stream.js",
  "./03-session.js",
  "./04-tool-control.js",
  "./05-cost-budget.js",
  "./06-abort.js",
  "./07-system-prompt.js",
  "./08-resume.js",
  "./09-ask-json.js",
];

const main = async () => {
  const loaded = await Promise.all(
    examples.map(async (file, i) => {
      const mod = await import(file);
      return {
        index: i,
        name: mod.meta.name as string,
        description: mod.meta.description as string,
        run: mod.run as () => Promise<void>,
      };
    }),
  );

  const choice = await select({
    message: "Select an example:",
    loop: false,
    choices: loaded.map((ex) => ({
      name: `${String(ex.index + 1).padStart(2, "0")}. ${ex.name}`,
      value: ex.index,
      description: ex.description,
    })),
  });

  const selected = loaded[choice];
  if (!selected) {
    return;
  }

  try {
    await selected.run();
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      process.exit(0);
    }
    console.error("\n  Example failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  console.log("");

  const again = await select({
    message: "What next?",
    loop: false,
    choices: [
      { name: "Run another example", value: "again" as const },
      { name: "Exit", value: "exit" as const },
    ],
  });

  if (again === "again") {
    await main();
  }
};

preflight();

main().catch((error) => {
  if (error instanceof Error && error.name === "ExitPromptError") {
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
});
