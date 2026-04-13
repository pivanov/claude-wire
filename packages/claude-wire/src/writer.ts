export const writer = {
  user: (content: string): string => {
    return `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;
  },

  approve: (toolUseId: string): string => {
    return `${JSON.stringify({ type: "approve", tool_use_id: toolUseId })}\n`;
  },

  deny: (toolUseId: string): string => {
    return `${JSON.stringify({ type: "deny", tool_use_id: toolUseId })}\n`;
  },

  toolResult: (toolUseId: string, content: string): string => {
    return `${JSON.stringify({ type: "tool_result", tool_use_id: toolUseId, content })}\n`;
  },

  abort: (): string => {
    return `${JSON.stringify({ type: "abort" })}\n`;
  },
};
