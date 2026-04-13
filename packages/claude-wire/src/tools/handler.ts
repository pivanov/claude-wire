import type { TToolUseEvent } from "../types/events.js";
import type { IToolHandler } from "../types/options.js";

export type TToolDecision = "approve" | "deny" | { result: string };

export interface IToolHandlerInstance {
  decide: (tool: TToolUseEvent) => Promise<TToolDecision>;
}

export const createToolHandler = (options: IToolHandler = {}): IToolHandlerInstance => {
  const { allowed, blocked, onToolUse } = options;

  const allowedSet = allowed ? new Set(allowed) : undefined;
  const blockedSet = blocked ? new Set(blocked) : undefined;

  const decide = async (tool: TToolUseEvent): Promise<TToolDecision> => {
    if (blockedSet?.has(tool.toolName)) {
      return "deny";
    }

    if (allowedSet && !allowedSet.has(tool.toolName)) {
      return "deny";
    }

    if (onToolUse) {
      return onToolUse(tool);
    }

    return "approve";
  };

  return { decide };
};
