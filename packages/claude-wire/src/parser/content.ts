import { LIMITS } from "../constants.js";
import type { TClaudeContent } from "../types/protocol.js";

export const blockFingerprint = (block: TClaudeContent): string => {
  if (block.type === "tool_use" && block.id) {
    return `tool_use:${block.id}`;
  }

  const text = block.type === "thinking" ? (block.thinking ?? block.text ?? "") : (block.text ?? "");
  if (text) {
    return `${block.type}:${text.slice(0, LIMITS.fingerprintTextLen)}`;
  }

  return `${block.type}:${block.tool_use_id ?? "unknown"}`;
};

export const extractContent = (content: unknown): string => {
  if (content === null || content === undefined) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: string; text: string } =>
          typeof block === "object" && block !== null && "text" in block && typeof (block as { text: unknown }).text === "string",
      )
      .map((block) => block.text)
      .join("\n");
  }

  return "";
};

export const parseDoubleEncoded = (value: unknown): string => {
  if (typeof value !== "string") {
    if (typeof value === "object" && value !== null) {
      return JSON.stringify(value);
    }
    return String(value ?? "");
  }

  if (!value.startsWith('"')) {
    return value;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "string") {
      return parsed;
    }
    return value;
  } catch {
    return value;
  }
};
