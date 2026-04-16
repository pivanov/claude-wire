import { ClaudeError } from "./errors.js";

// Standard Schema protocol -- any library (Zod, Valibot, ArkType) that
// implements this shape is accepted. We don't depend on @standard-schema/spec
// at runtime; just match the interface.
export interface IStandardSchema<T = unknown> {
  "~standard": {
    version: 1;
    vendor: string;
    validate: (value: unknown) => IStandardResult<T>;
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

// Strip common fences: ```json ... ```, ``` ... ```, or bare JSON.
const FENCE_RE = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/;

export const stripFences = (text: string): string => {
  const match = text.match(FENCE_RE);
  return match?.[1] ?? text.trim();
};

// Overloaded: Standard Schema for typed validation, or raw JSON Schema string
// forwarded to --json-schema (parse-only, no TS inference).
export type TSchemaInput<T> = IStandardSchema<T> | string;

export const isStandardSchema = <T>(schema: TSchemaInput<T>): schema is IStandardSchema<T> => {
  return typeof schema === "object" && schema !== null && "~standard" in schema;
};

export const parseAndValidate = <T>(text: string, schema: TSchemaInput<T>): T => {
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
    const result = schema["~standard"].validate(parsed);
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
