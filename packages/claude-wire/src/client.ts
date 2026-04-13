import type { IClaudeSession } from "./session.js";
import { createSession } from "./session.js";
import type { IClaudeStream } from "./stream.js";
import { createStream } from "./stream.js";
import type { IClaudeOptions, ISessionOptions } from "./types/options.js";
import type { TAskResult } from "./types/results.js";

export interface IClaudeClient {
  ask: (prompt: string, options?: IClaudeOptions) => Promise<TAskResult>;
  stream: (prompt: string, options?: IClaudeOptions) => IClaudeStream;
  session: (options?: ISessionOptions) => IClaudeSession;
  create: (defaults: IClaudeOptions) => IClaudeClient;
}

const mergeOptions = (defaults: IClaudeOptions, overrides?: IClaudeOptions): IClaudeOptions => ({
  ...defaults,
  ...overrides,
  tools: overrides?.tools || defaults.tools ? { ...defaults.tools, ...overrides?.tools } : undefined,
  env: overrides?.env || defaults.env ? { ...defaults.env, ...overrides?.env } : undefined,
});

export const createClient = (defaults: IClaudeOptions = {}): IClaudeClient => {
  const ask = async (prompt: string, options?: IClaudeOptions): Promise<TAskResult> => {
    const merged = mergeOptions(defaults, options);
    const stream = createStream(prompt, merged);
    return stream.result();
  };

  const stream = (prompt: string, options?: IClaudeOptions): IClaudeStream => {
    const merged = mergeOptions(defaults, options);
    return createStream(prompt, merged);
  };

  const session = (options?: ISessionOptions): IClaudeSession => {
    const merged = mergeOptions(defaults, options) as ISessionOptions;
    return createSession(merged);
  };

  const create = (newDefaults: IClaudeOptions): IClaudeClient => {
    const merged = mergeOptions(defaults, newDefaults);
    return createClient(merged);
  };

  return { ask, stream, session, create };
};
