import type { TRelayEvent, TTurnCompleteEvent } from "../types/events.js";
import type { TClaudeContent, TClaudeEvent, TModelUsageEntry } from "../types/protocol.js";
import { blockFingerprint, extractContent, parseDoubleEncoded } from "./content.js";

const extractTokens = (modelUsage?: Record<string, TModelUsageEntry>) => {
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cacheReadTokens: number | undefined;
  let cacheCreationTokens: number | undefined;
  let contextWindow: number | undefined;

  if (modelUsage) {
    for (const entry of Object.values(modelUsage)) {
      inputTokens = (inputTokens ?? 0) + entry.inputTokens + (entry.cacheReadInputTokens ?? 0) + (entry.cacheCreationInputTokens ?? 0);
      outputTokens = (outputTokens ?? 0) + entry.outputTokens;
      if (entry.cacheReadInputTokens !== undefined) {
        cacheReadTokens = (cacheReadTokens ?? 0) + entry.cacheReadInputTokens;
      }
      if (entry.cacheCreationInputTokens !== undefined) {
        cacheCreationTokens = (cacheCreationTokens ?? 0) + entry.cacheCreationInputTokens;
      }
      // Multi-model turns (e.g. sub-agent fan-out) report distinct windows
      // per model. Take max so consumers see the widest context available,
      // not whichever model happened to iterate last.
      if (entry.contextWindow !== undefined && (contextWindow === undefined || entry.contextWindow > contextWindow)) {
        contextWindow = entry.contextWindow;
      }
    }
  }

  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, contextWindow };
};

const buildTurnComplete = (raw: TClaudeEvent): TTurnCompleteEvent => {
  const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, contextWindow } = extractTokens(raw.modelUsage);
  return {
    type: "turn_complete",
    sessionId: raw.session_id,
    costUsd: raw.total_cost_usd,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    contextWindow,
    durationMs: raw.duration_ms,
  };
};

export interface ITranslator {
  translate: (raw: TClaudeEvent) => TRelayEvent[];
  reset: () => void;
}

export const createTranslator = (): ITranslator => {
  let lastContentIndex = 0;
  let lastMessageKey: string | undefined;
  // Tracks whether a StructuredOutput tool_use already produced a synthetic
  // structured_output event for this turn. When set, the result handler's
  // raw.structured_output fallback skips emission so consumers don't see
  // duplicate structured_output events. Reset on turn end alongside the
  // dedup state below.
  let synthesizedStructuredOutput = false;

  const reset = () => {
    lastContentIndex = 0;
    lastMessageKey = undefined;
    synthesizedStructuredOutput = false;
  };

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
        // Claude Code CLI emits a synthetic `StructuredOutput` tool_use when
        // --json-schema is set: the schema-constrained JSON arrives inside
        // `input`. Surface as a `structured_output` relay event (not text),
        // so `raw.text` stays honest about model commentary (Stop-hook nag
        // messages, partial output) while the structured value gets its own
        // unambiguous channel via `raw.structuredOutput`. We also flip a
        // dedup flag so the result-event fallback below skips itself when
        // we've already captured the value here.
        if (block.name === "StructuredOutput") {
          if (block.input === undefined) {
            return undefined;
          }
          synthesizedStructuredOutput = true;
          return { type: "structured_output", value: block.input };
        }
        // Drop malformed tool_use events entirely. An empty toolName would
        // otherwise bypass allow/block lists by matching nothing.
        if (!block.id || !block.name) {
          return undefined;
        }
        return {
          type: "tool_use",
          toolUseId: block.id,
          toolName: block.name,
          input: block.input ?? {},
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

      // Result-event fallback for `--json-schema` constrained turns. The
      // synthetic StructuredOutput tool_use route inside an assistant
      // message can be unreliable when the CLI streams blocks with
      // undefined `input` mid-turn; the terminal result event always
      // carries the canonical `structured_output`. Skip when the block
      // route already emitted to keep one structured_output per turn.
      if (!synthesizedStructuredOutput && raw.structured_output !== undefined) {
        events.push({ type: "structured_output", value: raw.structured_output });
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
          // Prefer the message id when the CLI provides it; fall back to a first-block fingerprint for older transports that omit ids.
          const key = raw.message.id ?? blockFingerprint(firstBlock);
          if (lastMessageKey !== undefined && key !== lastMessageKey) {
            lastContentIndex = 0;
          }
          lastMessageKey = key;
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
