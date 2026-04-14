import type { ICostTracker } from "./cost.js";
import type { IClaudeProcess } from "./process.js";
import type { IToolHandlerInstance, TToolDecision } from "./tools/handler.js";
import type { TRelayEvent, TTextEvent, TToolUseEvent, TTurnCompleteEvent } from "./types/events.js";
import type { TAskResult } from "./types/results.js";
import { writer } from "./writer.js";

export const dispatchToolDecision = async (proc: IClaudeProcess, toolHandler: IToolHandlerInstance, event: TToolUseEvent): Promise<void> => {
  let decision: TToolDecision;
  try {
    decision = await toolHandler.decide(event);
  } catch (error) {
    console.warn(`[claude-wire] Tool handler threw, defaulting to deny: ${error instanceof Error ? error.message : String(error)}`);
    decision = "deny";
  }
  try {
    if (decision === "approve") {
      proc.write(writer.approve(event.toolUseId));
    } else if (decision === "deny") {
      proc.write(writer.deny(event.toolUseId));
    } else if (typeof decision === "object" && decision !== null && typeof decision.result === "string") {
      proc.write(writer.toolResult(event.toolUseId, decision.result));
    } else {
      console.warn("[claude-wire] Invalid tool decision, defaulting to deny");
      proc.write(writer.deny(event.toolUseId));
    }
  } catch {
    // stdin closed - process died, error will surface through read path
  }
};

export const extractText = (events: TRelayEvent[]): string => {
  return events
    .filter((e): e is TTextEvent => e.type === "text")
    .map((e) => e.content)
    .join("");
};

export const buildResult = (events: TRelayEvent[], costTracker: ICostTracker, sessionId: string | undefined): TAskResult => {
  const tc = events.findLast((e): e is TTurnCompleteEvent => e.type === "turn_complete");
  const snap = costTracker.snapshot();

  return {
    text: extractText(events),
    costUsd: snap.totalUsd,
    tokens: { input: snap.inputTokens, output: snap.outputTokens },
    duration: tc?.durationMs ?? 0,
    sessionId,
    events,
  };
};
