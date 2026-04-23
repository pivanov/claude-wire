#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "./client.js";
import { BudgetExceededError, ClaudeError, errorMessage, isKnownError } from "./errors.js";
import { JsonValidationError } from "./json.js";
import type { IClaudeOptions } from "./types/options.js";

const readPackageVersion = (): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, "../package.json"), resolve(here, "../../package.json")];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === "@pivanov/claude-wire" && typeof parsed.version === "string") {
        return parsed.version;
      }
    } catch {
      // keep looking
    }
  }
  return "0.0.0";
};

const PKG_VERSION = readPackageVersion();

const USAGE = `claude-wire <command> [options]

Commands:
  ask-json              Ask Claude for a JSON response validated against a schema.

ask-json options:
  --prompt <str>        User prompt. Reads stdin to EOF when omitted.
  --schema <json>       Raw JSON Schema string (forwarded to --json-schema).
  --schema-file <path>  Path to a JSON Schema file. Mutually exclusive with --schema.
  --model <name>        haiku | sonnet | opus or any model string. Default: haiku.
  --max-budget-usd <n>  CLI-level budget cap (USD).
  --system-prompt <str> Optional system prompt.

Other:
  -h, --help            Show this help and exit.
  -v, --version         Print version and exit.

Output (stdout, single JSON line):
  { "data": <validated>, "costUsd": <n>, "tokens": { "input": n, "output": n },
    "durationMs": <n>, "sessionId": "..." }

Exit codes:
  0 success  1 json-validation  2 process-error  3 budget-exceeded  4 invalid-args
`;

export class CliExit extends ClaudeError {
  constructor(
    public readonly code: number,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(stderr || stdout || `exit ${code}`);
    this.name = "CliExit";
  }
}

export interface ICliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => Promise<string>;
  stdinIsTTY: boolean;
}

const defaultIo = (): ICliIo => ({
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf-8");
  },
  stdinIsTTY: Boolean(process.stdin.isTTY),
});

const emitErrorLine = (io: ICliIo, code: string, message: string, extra?: Record<string, unknown>): void => {
  const payload = extra ? { error: message, code, ...extra } : { error: message, code };
  io.stderr(`${JSON.stringify(payload)}\n`);
};

const fail = (io: ICliIo, exit: number, code: string, message: string, extra?: Record<string, unknown>): never => {
  emitErrorLine(io, code, message, extra);
  throw new CliExit(exit, "", message);
};

const readSchemaFile = (io: ICliIo, path: string): string => {
  const raw = ((): string => {
    try {
      return readFileSync(path, "utf-8");
    } catch (err) {
      return fail(io, 4, "invalid-args", `Failed to read --schema-file "${path}": ${errorMessage(err)}`);
    }
  })();

  try {
    JSON.parse(raw);
  } catch (err) {
    fail(io, 4, "invalid-args", `--schema-file "${path}" is not valid JSON: ${errorMessage(err)}`);
  }
  return raw;
};

interface IAskJsonArgs {
  prompt: string | undefined;
  schema: string | undefined;
  schemaFile: string | undefined;
  model: string | undefined;
  maxBudgetUsd: string | undefined;
  systemPrompt: string | undefined;
}

const runAskJson = async (io: ICliIo, args: IAskJsonArgs): Promise<void> => {
  if (args.schema && args.schemaFile) {
    fail(io, 4, "invalid-args", "--schema and --schema-file are mutually exclusive");
  }

  if (!args.schema && !args.schemaFile) {
    fail(io, 4, "invalid-args", "Missing schema: pass --schema <json> or --schema-file <path>");
  }

  const schema = args.schema ?? readSchemaFile(io, args.schemaFile as string);

  let prompt = args.prompt;
  if (prompt === undefined) {
    if (io.stdinIsTTY) {
      fail(io, 4, "invalid-args", "Missing prompt: pass --prompt <str> or pipe via stdin");
    }
    prompt = await io.readStdin();
  }

  if (prompt.trim().length === 0) {
    fail(io, 4, "invalid-args", "Prompt is empty");
  }

  const options: IClaudeOptions = { model: args.model ?? "haiku" };
  if (args.systemPrompt !== undefined) {
    options.systemPrompt = args.systemPrompt;
  }
  if (args.maxBudgetUsd !== undefined) {
    const n = Number(args.maxBudgetUsd);
    if (!Number.isFinite(n) || n < 0) {
      fail(io, 4, "invalid-args", `--max-budget-usd must be a non-negative number, got "${args.maxBudgetUsd}"`);
    }
    options.maxBudgetUsd = n;
  }

  const client = createClient();
  const result = await client.askJson(prompt, schema, options);

  io.stdout(
    `${JSON.stringify({
      data: result.data,
      costUsd: result.raw.costUsd,
      tokens: { input: result.raw.tokens.input, output: result.raw.tokens.output },
      durationMs: result.raw.duration,
      sessionId: result.raw.sessionId,
    })}\n`,
  );
};

const translateError = (io: ICliIo, err: unknown): never => {
  if (err instanceof CliExit) {
    throw err;
  }

  if (err instanceof JsonValidationError) {
    emitErrorLine(io, "json-validation", err.message, { issues: err.issues });
    throw new CliExit(1, "", err.message);
  }

  if (err instanceof BudgetExceededError) {
    emitErrorLine(io, "budget-exceeded", err.message);
    throw new CliExit(3, "", err.message);
  }

  let code = "error";
  if (isKnownError(err)) {
    code = err.code;
  } else if (err instanceof Error) {
    code = err.name;
  }
  emitErrorLine(io, code, errorMessage(err));
  throw new CliExit(2, "", errorMessage(err));
};

export const runCli = async (argv: string[], io: ICliIo = defaultIo()): Promise<void> => {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    io.stdout(USAGE);
    throw new CliExit(0, USAGE, "");
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    const text = `${PKG_VERSION}\n`;
    io.stdout(text);
    throw new CliExit(0, text, "");
  }

  const command = argv[0];
  const rest = argv.slice(1);

  if (command !== "ask-json") {
    fail(io, 4, "invalid-args", `Unknown command "${command}". Run --help for usage.`);
  }

  const parsed = ((): ReturnType<typeof parseArgs> => {
    try {
      return parseArgs({
        args: rest,
        options: {
          prompt: { type: "string" },
          schema: { type: "string" },
          "schema-file": { type: "string" },
          model: { type: "string" },
          "max-budget-usd": { type: "string" },
          "system-prompt": { type: "string" },
          help: { type: "boolean", short: "h" },
          version: { type: "boolean", short: "v" },
        },
        strict: true,
        allowPositionals: false,
      });
    } catch (err) {
      return fail(io, 4, "invalid-args", errorMessage(err));
    }
  })();

  if (parsed.values.help) {
    io.stdout(USAGE);
    throw new CliExit(0, USAGE, "");
  }

  if (parsed.values.version) {
    const text = `${PKG_VERSION}\n`;
    io.stdout(text);
    throw new CliExit(0, text, "");
  }

  try {
    await runAskJson(io, {
      prompt: parsed.values.prompt as string | undefined,
      schema: parsed.values.schema as string | undefined,
      schemaFile: parsed.values["schema-file"] as string | undefined,
      model: parsed.values.model as string | undefined,
      maxBudgetUsd: parsed.values["max-budget-usd"] as string | undefined,
      systemPrompt: parsed.values["system-prompt"] as string | undefined,
    });
  } catch (err) {
    translateError(io, err);
  }
};

const runAndExit = async (): Promise<void> => {
  try {
    await runCli(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliExit) {
      process.exit(err.code);
    }
    process.stderr.write(`${JSON.stringify({ error: errorMessage(err), code: "error" })}\n`);
    process.exit(2);
  }
};

// Symlink-safe entry detection. argv[1] is the symlink path created by npm/bun
// in `node_modules/.bin/claude-wire`; import.meta.url is the real target. A
// naive equality check misses that case. `realpathSync` collapses both to the
// same canonical path so the guard fires whether the user runs the binary
// directly, through the bin symlink, or via npx/bunx. `import.meta.main` would
// also work but only on Node >= 20.11 / >= 22, and we don't want the CLI to
// silently no-op on older Node installs.
const entry = process.argv[1];
if (entry) {
  try {
    if (realpathSync(entry) === fileURLToPath(import.meta.url)) {
      void runAndExit();
    }
  } catch {
    // argv[1] points to a path that doesn't exist -- skip auto-run.
  }
}
