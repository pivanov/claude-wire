import type { TClaudeEvent } from "../types/protocol.js";

export const parseLine = (line: string): TClaudeEvent | undefined => {
  const trimmed = line.trim();
  if (trimmed === "") {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as TClaudeEvent;
  } catch {
    return undefined;
  }
};
