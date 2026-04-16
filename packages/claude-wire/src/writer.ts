import { requireNonEmpty } from "./validation.js";

const ABORT_LINE = `${JSON.stringify({ type: "abort" })}\n`;

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

  /**
   * Send a tool result in response to a `tool_use` event. Pass
   * `{ isError: true }` to mark the result as a tool-side error -- the model
   * will see it as an error and can react (retry, apologize, pick another
   * tool) rather than treating it as success. The protocol supports the
   * flag natively; without it, results are assumed successful.
   */
  toolResult: (toolUseId: string, content: string, options?: { isError?: boolean }): string => {
    requireNonEmpty(toolUseId, "toolUseId");
    const payload: Record<string, unknown> = { type: "tool_result", tool_use_id: toolUseId, content };
    if (options?.isError) {
      payload.is_error = true;
    }
    return `${JSON.stringify(payload)}\n`;
  },

  abort: (): string => ABORT_LINE,
};
