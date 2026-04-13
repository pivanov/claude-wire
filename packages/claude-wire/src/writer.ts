import { ClaudeError } from "./errors.js";

const ABORT_LINE = `${JSON.stringify({ type: "abort" })}\n`;

const requireNonEmpty = (value: string, name: string): void => {
  if (!value) {
    throw new ClaudeError(`${name} must be a non-empty string`);
  }
};

export const writer = {
  user: (content: string): string => {
    requireNonEmpty(content, "content");
    return `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;
  },

  approve: (toolUseId: string): string => {
    requireNonEmpty(toolUseId, "toolUseId");
    return `${JSON.stringify({ type: "approve", tool_use_id: toolUseId })}\n`;
  },

  deny: (toolUseId: string): string => {
    requireNonEmpty(toolUseId, "toolUseId");
    return `${JSON.stringify({ type: "deny", tool_use_id: toolUseId })}\n`;
  },

  toolResult: (toolUseId: string, content: string): string => {
    requireNonEmpty(toolUseId, "toolUseId");
    return `${JSON.stringify({ type: "tool_result", tool_use_id: toolUseId, content })}\n`;
  },

  abort: (): string => ABORT_LINE,
};
