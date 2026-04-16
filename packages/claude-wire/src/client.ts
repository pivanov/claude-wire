import { type IJsonResult, isStandardSchema, parseAndValidate, type TSchemaInput } from "./json.js";
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
    // Forward the raw JSON Schema string to the CLI via --json-schema when
    // the caller passes a string. Standard Schema objects are validated
    // SDK-side after the response arrives.
    if (typeof schema === "string") {
      merged.jsonSchema = schema;
    } else if (isStandardSchema(schema)) {
      // Extract JSON Schema representation if available for CLI-side
      // constraint. Many Standard Schema libs expose this via toJsonSchema()
      // but it's not part of the protocol. We validate SDK-side regardless.
    }
    const raw = await ask(prompt, merged);
    const data = parseAndValidate(raw.text, schema);
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
