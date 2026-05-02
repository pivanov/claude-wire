import {
  DEFAULT_JSON_SYSTEM_PROMPT,
  type IJsonResult,
  JsonValidationError,
  parseAndValidate,
  standardSchemaToJsonSchema,
  type TSchemaInput,
} from "./json.js";
import type { IClaudeSession } from "./session.js";
import { createSession } from "./session.js";
import type { IClaudeStream } from "./stream.js";
import { createStream } from "./stream.js";
import type { IClaudeOptions, ISessionOptions } from "./types/options.js";
import type { TAskResult } from "./types/results.js";

export interface IClaudeClient {
  ask: (prompt: string, options?: IClaudeOptions) => Promise<TAskResult>;
  askJson: <T>(prompt: string, schema: TSchemaInput<T>, options?: IClaudeOptions) => Promise<IJsonResult<T>>;
  stream: (prompt: string, options?: IClaudeOptions) => IClaudeStream;
  session: (options?: ISessionOptions) => IClaudeSession;
  create: (defaults: IClaudeOptions) => IClaudeClient;
}

const mergeOptions = (defaults: IClaudeOptions, overrides?: IClaudeOptions): IClaudeOptions => {
  const merged: IClaudeOptions = { ...defaults, ...overrides };

  if (overrides && "toolHandler" in overrides) {
    merged.toolHandler = overrides.toolHandler ? { ...defaults.toolHandler, ...overrides.toolHandler } : overrides.toolHandler;
  }

  if (overrides && "env" in overrides) {
    merged.env = overrides.env ? { ...defaults.env, ...overrides.env } : overrides.env;
  }

  return merged;
};

export const createClient = (defaults: IClaudeOptions = {}): IClaudeClient => {
  const ask = async (prompt: string, options?: IClaudeOptions): Promise<TAskResult> => {
    const merged = mergeOptions(defaults, options);
    const stream = createStream(prompt, merged);
    return stream.result();
  };

  const askJson = async <T>(prompt: string, schema: TSchemaInput<T>, options?: IClaudeOptions): Promise<IJsonResult<T>> => {
    const merged = mergeOptions(defaults, options);
    // Resolve the CLI-side JSON Schema. Priority:
    //   1. caller-supplied `merged.jsonSchema` (string) wins.
    //   2. raw schema string passed as the second arg becomes jsonSchema.
    //   3. Standard Schema objects auto-derive when the vendor supports it
    //      (Zod 4 / Valibot / ArkType). Failing that, we fall through to
    //      prompt-engineering only.
    //
    // Without a forwarded jsonSchema, recent Claude Code CLI builds (with
    // --output-format stream-json) can emit thinking-only turns on trivial
    // prompts -- the model satisfies the "respond JSON" instruction in its
    // reasoning block and never produces a text block. The CLI's own
    // --json-schema constraint forces a text block to exist.
    if (typeof schema === "string") {
      merged.jsonSchema = schema;
    } else if (merged.jsonSchema === undefined) {
      const derived = await standardSchemaToJsonSchema(schema);
      if (derived !== undefined) {
        merged.jsonSchema = derived;
      }
    }
    // Force JSON-only output at the prompt level. `--json-schema` is a hint
    // that Claude Code's CLI doesn't hard-enforce, so sonnet/haiku both
    // regularly wrap JSON in prose ("Here is the JSON: {...}") or respond in
    // pure prose on short "classify X" prompts. A system-prompt instruction
    // is the most portable way to get reliable JSON across model versions.
    // Explicit caller systemPrompt wins; we only fill in when it's unset.
    if (merged.systemPrompt === undefined) {
      merged.systemPrompt = DEFAULT_JSON_SYSTEM_PROMPT;
    }
    const raw = await ask(prompt, merged);
    // Prefer the canonical structured_output channel when --json-schema was
    // forwarded. raw.text in those turns can carry Stop-hook nag messages
    // ("You MUST call StructuredOutput") or partial commentary unrelated to
    // the JSON, which would corrupt parseAndValidate. raw.structuredOutput
    // is the parsed value the CLI produced under schema constraint; we
    // re-stringify so parseAndValidate's existing fence-strip + validate
    // path runs uniformly for both channels.
    if (raw.structuredOutput !== undefined) {
      const data = await parseAndValidate(JSON.stringify(raw.structuredOutput), schema);
      return { data, raw };
    }
    // Surface "model emitted only thinking, no text" as a typed error.
    // parseAndValidate("") would otherwise throw "Unexpected end of JSON
    // input" which doesn't tell the caller what to fix. This case happens
    // when there's no native CLI constraint and the model talked itself
    // out of producing output; the message points at the actionable knob.
    if (raw.text === "" && raw.thinking !== "") {
      throw new JsonValidationError(
        "Model produced a thinking block but no text content. The CLI was not given a JSON Schema to constrain output. Pass `jsonSchema` (string) in options, or use a Standard Schema vendor that supports auto-derivation (Zod 4+, Valibot via @valibot/to-json-schema, ArkType).",
        "",
        [{ message: "empty text response" }],
      );
    }
    const data = await parseAndValidate(raw.text, schema);
    return { data, raw };
  };

  const stream = (prompt: string, options?: IClaudeOptions): IClaudeStream => {
    const merged = mergeOptions(defaults, options);
    return createStream(prompt, merged);
  };

  const session = (options?: ISessionOptions): IClaudeSession => {
    const merged = mergeOptions(defaults, options);
    return createSession(merged);
  };

  const create = (newDefaults: IClaudeOptions): IClaudeClient => {
    const merged = mergeOptions(defaults, newDefaults);
    return createClient(merged);
  };

  return { ask, askJson, stream, session, create };
};
