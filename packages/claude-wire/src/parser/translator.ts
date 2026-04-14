import type { TRelayEvent, TTurnCompleteEvent } from "../types/events.js";
import type { TClaudeContent, TClaudeEvent, TModelUsageEntry } from "../types/protocol.js";
import { blockFingerprint, extractContent, parseDoubleEncoded } from "./content.js";

const extractTokens = (modelUsage?: Record<string, TModelUsageEntry>) => {
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let contextWindow: number | undefined;

  if (modelUsage) {
    for (const entry of Object.values(modelUsage)) {
      inputTokens = (inputTokens ?? 0) + entry.inputTokens + (entry.cacheReadInputTokens ?? 0) + (entry.cacheCreationInputTokens ?? 0);
      outputTokens = (outputTokens ?? 0) + entry.outputTokens;
      contextWindow = entry.contextWindow;
    }
  }

  return { inputTokens, outputTokens, contextWindow };
};

const buildTurnComplete = (raw: TClaudeEvent): TTurnCompleteEvent => {
  const { inputTokens, outputTokens, contextWindow } = extractTokens(raw.modelUsage);
  return {
    type: "turn_complete",
    sessionId: raw.session_id,
    costUsd: raw.total_cost_usd,
    inputTokens,
    outputTokens,
    contextWindow,
    durationMs: raw.duration_ms,
  };
};

export interface ITranslator {
  translate: (raw: TClaudeEvent) => TRelayEvent[];
  reset: () => void;
}

const translateContentBlock = (block: TClaudeContent): TRelayEvent | undefined => {
  switch (block.type) {
    case "thinking": {
      const content = block.thinking ?? block.text ?? "";
      if (content) {
        return { type: "thinking", content };
      }
      return undefined;
    }
    case "text": {
      const content = block.text ?? "";
      if (content) {
        return { type: "text", content };
      }
      return undefined;
    }
    case "tool_use": {
      // Drop malformed tool_use events entirely. An empty toolName would
      // otherwise bypass allow/block lists by matching nothing.
      if (!block.id || !block.name) {
        return undefined;
      }
      return {
        type: "tool_use",
        toolUseId: block.id,
        toolName: block.name,
        input: typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {}),
      };
    }
    case "tool_result": {
      return {
        type: "tool_result",
        toolUseId: block.tool_use_id ?? "",
        output: extractContent(block.content),
        isError: block.is_error ?? false,
      };
    }
    default:
      return undefined;
  }
};

export const createTranslator = (): ITranslator => {
  let lastContentIndex = 0;
  let lastFirstBlockKey: string | undefined;

  const reset = () => {
    lastContentIndex = 0;
    lastFirstBlockKey = undefined;
  };

  const translate = (raw: TClaudeEvent): TRelayEvent[] => {
    const events: TRelayEvent[] = [];

    if (raw.type === "system" && raw.subtype === "init") {
      events.push({
        type: "session_meta",
        sessionId: raw.session_id ?? "",
        model: raw.model ?? "",
        tools: raw.tools ?? [],
      });
      return events;
    }

    if (raw.type === "result" || (raw.type === "system" && raw.subtype === "result")) {
      if (raw.is_error) {
        const text = parseDoubleEncoded(raw.result);
        events.push({ type: "error", message: text, sessionId: raw.session_id });
      }

      events.push(buildTurnComplete(raw));
      reset();
      return events;
    }

    if (raw.type === "assistant" && raw.message?.content) {
      const content = raw.message.content;

      if (content.length > 0) {
        const firstBlock = content[0];
        if (firstBlock) {
          const key = blockFingerprint(firstBlock);
          if (lastFirstBlockKey !== undefined && key !== lastFirstBlockKey) {
            lastContentIndex = 0;
          }
          lastFirstBlockKey = key;
        }
      }

      const newBlocks = content.slice(lastContentIndex);
      lastContentIndex = content.length;

      for (const block of newBlocks) {
        const event = translateContentBlock(block);
        if (event) {
          events.push(event);
        }
      }

      return events;
    }

    if (raw.type === "user" && raw.message?.content) {
      for (const block of raw.message.content) {
        const event = translateContentBlock(block);
        if (event) {
          events.push(event);
        }
      }
      return events;
    }

    return events;
  };

  return { translate, reset };
};
