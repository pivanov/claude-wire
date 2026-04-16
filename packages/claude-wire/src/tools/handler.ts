import type { TToolUseEvent } from "../types/events.js";
import type { IToolHandler } from "../types/options.js";

// A decision on how the SDK should respond to a tool-use request from the
// CLI. Returning `{ result }` lets the handler short-circuit the tool and
// hand back a custom value; set `isError: true` when that value represents
// a tool-side failure the model should react to (retry, fall back, etc.)
// rather than a silent success.
export type TToolDecision = "approve" | "deny" | { result: string; isError?: boolean };

export interface IToolHandlerInstance {
  decide: (tool: TToolUseEvent) => Promise<TToolDecision>;
}

export const createToolHandler = (options: IToolHandler = {}): IToolHandlerInstance => {
  const { allowed, blocked, onToolUse, onError } = options;

  const allowedSet = allowed ? new Set(allowed) : undefined;
  const blockedSet = blocked ? new Set(blocked) : undefined;

  const decide = async (tool: TToolUseEvent): Promise<TToolDecision> => {
    if (blockedSet?.has(tool.toolName)) {
      return "deny";
    }

    if (allowedSet && !allowedSet.has(tool.toolName)) {
      return "deny";
    }

    if (!onToolUse) {
      return "approve";
    }

    try {
      return await onToolUse(tool);
    } catch (error) {
      if (!onError) {
        throw error;
      }
      return onError(error, tool);
    }
  };

  return { decide };
};
