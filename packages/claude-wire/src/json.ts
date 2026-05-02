import { ClaudeError } from "./errors.js";

// Standard Schema protocol -- any library (Zod, Valibot, ArkType) that
// implements this shape is accepted. We don't depend on @standard-schema/spec
// at runtime; just match the interface.
// The spec permits `validate` to return the result directly OR a Promise of
// it (async refinements, e.g. Valibot's `pipeAsync`). The SDK awaits either
// shape uniformly so async schemas don't silently bypass validation.
export interface IStandardSchema<T = unknown> {
  "~standard": {
    version: 1;
    vendor: string;
    validate: (value: unknown) => IStandardResult<T> | Promise<IStandardResult<T>>;
  };
}

interface IStandardResult<T> {
  value?: T;
  issues?: ReadonlyArray<{ message?: string; path?: ReadonlyArray<string | number> }>;
}

export class JsonValidationError extends ClaudeError {
  constructor(
    message: string,
    public readonly rawText: string,
    public readonly issues: ReadonlyArray<{ message?: string; path?: ReadonlyArray<string | number> }>,
  ) {
    super(message);
    this.name = "JsonValidationError";
  }
}

export interface IJsonResult<T> {
  data: T;
  raw: import("./types/results.js").TAskResult;
}

// Injected as the default system prompt by `askJson` when the caller didn't
// set one. `--json-schema` at the CLI layer is a hint, not a hard constraint,
// so sonnet/haiku both frequently wrap JSON in prose or return pure prose on
// short "classify X" prompts. A system-prompt-level instruction is the most
// portable way to force JSON-only output across model versions.
export const DEFAULT_JSON_SYSTEM_PROMPT =
  "You MUST respond with ONLY valid JSON matching the provided schema. No prose. No markdown fences. No explanatory text before or after. Your entire response must be directly parseable by JSON.parse().";

// Strip common fences: ```json ... ```, ``` ... ```, or bare JSON.
const FENCE_RE = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/;

export const stripFences = (text: string): string => {
  const match = text.match(FENCE_RE);
  return match?.[1] ?? text.trim();
};

// Overloaded: Standard Schema for typed validation, or raw JSON Schema string
// forwarded to --json-schema (parse-only, no TS inference).
export type TSchemaInput<T> = IStandardSchema<T> | string;

const isStandardSchema = <T>(schema: TSchemaInput<T>): schema is IStandardSchema<T> => {
  return typeof schema === "object" && schema !== null && "~standard" in schema;
};

/**
 * Try to derive a JSON Schema string from a Standard Schema object so the
 * caller can forward it to the CLI via the `jsonSchema` option for native
 * output constraint. Detects the vendor via `schema['~standard'].vendor`
 * and dispatches to that library's converter:
 *
 *   - `zod`: requires Zod 4+ (`z.toJSONSchema(schema)`).
 *   - `valibot`: requires the separate `@valibot/to-json-schema` package.
 *   - `arktype`: schemas expose `.toJsonSchema()` on the schema itself.
 *
 * Returns `undefined` when the vendor is unknown, the converter package is
 * not installed, or the converter throws. Caller decides whether to warn
 * or fall back to prompt-engineering only.
 *
 * Without this, `askJson(prompt, zodSchema)` only validates client-side;
 * the CLI runs unconstrained and Haiku in particular can emit thinking
 * blocks with no text content on trivial prompts. With this, `askJson`
 * forwards a derived schema to `--json-schema` so the model is forced to
 * emit valid constrained JSON in a text block.
 */
// Indirection so TypeScript skips static module resolution: zod and
// @valibot/to-json-schema are optional peer deps that may or may not be
// installed in the consumer's project. A literal `import("zod")` would
// error at typecheck time on installs without zod. Going through a
// variable keeps the behavior at runtime (dynamic resolution) and lets
// the compiler treat the result as `unknown`.
const dynImport = (name: string): Promise<unknown> => import(name);

export const standardSchemaToJsonSchema = async <T>(schema: IStandardSchema<T>): Promise<string | undefined> => {
  const vendor = schema["~standard"].vendor;
  try {
    if (vendor === "zod") {
      // Zod 4 added `toJSONSchema` as a top-level export. Older Zod doesn't
      // have it; we detect at runtime and bail when the function is missing.
      const zod = (await dynImport("zod")) as { toJSONSchema?: (s: unknown) => unknown };
      if (typeof zod.toJSONSchema === "function") {
        return JSON.stringify(zod.toJSONSchema(schema));
      }
      return undefined;
    }
    if (vendor === "valibot") {
      // Valibot ships JSON Schema conversion in a separate optional package.
      const mod = (await dynImport("@valibot/to-json-schema")) as { toJsonSchema?: (s: unknown) => unknown };
      if (typeof mod.toJsonSchema === "function") {
        return JSON.stringify(mod.toJsonSchema(schema));
      }
      return undefined;
    }
    if (vendor === "arktype") {
      // ArkType schemas carry their own toJsonSchema method directly.
      const ark = schema as unknown as { toJsonSchema?: () => unknown };
      if (typeof ark.toJsonSchema === "function") {
        return JSON.stringify(ark.toJsonSchema());
      }
      return undefined;
    }
  } catch {
    // import failed (peer not installed) or converter threw -- fall through
    // and return undefined. The caller's prompt-engineering path still runs.
  }
  return undefined;
};

export const parseAndValidate = async <T>(text: string, schema: TSchemaInput<T>): Promise<T> => {
  const stripped = stripFences(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new JsonValidationError(`Failed to parse JSON from Claude response: ${err instanceof Error ? err.message : String(err)}`, text, [
      { message: "Invalid JSON" },
    ]);
  }

  if (isStandardSchema(schema)) {
    // Standard Schema v1 permits validate() to return the result or a
    // Promise of it. Await unconditionally -- awaiting a non-Promise is
    // a no-op and keeps the sync/async paths unified.
    const result = await schema["~standard"].validate(parsed);
    if (result.issues && result.issues.length > 0) {
      const summary = result.issues.map((i) => i.message ?? "validation error").join("; ");
      throw new JsonValidationError(`Schema validation failed: ${summary}`, text, result.issues);
    }
    return (result as { value: T }).value;
  }

  // Raw JSON Schema string -- no runtime validation, just parse. The CLI's
  // --json-schema constrains the model output, so we trust it here.
  return parsed as T;
};
