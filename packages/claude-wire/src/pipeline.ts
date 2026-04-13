import type { ICostTracker } from "./cost.js";
import type { IClaudeProcess } from "./process.js";
import type { IToolHandlerInstance } from "./tools/handler.js";
import type { TRelayEvent, TTextEvent, TToolUseEvent } from "./types/events.js";
import type { TAskResult } from "./types/results.js";
import { writer } from "./writer.js";

export const dispatchToolDecision = async (proc: IClaudeProcess, toolHandler: IToolHandlerInstance, event: TToolUseEvent): Promise<void> => {
  let decision: "approve" | "deny" | { result: string };
  try {
    decision = await toolHandler.decide(event);
  } catch {
    decision = "deny";
  }
  if (decision === "approve") {
    proc.write(writer.approve(event.toolUseId));
  } else if (decision === "deny") {
    proc.write(writer.deny(event.toolUseId));
  } else {
    proc.write(writer.toolResult(event.toolUseId, decision.result));
  }
};

export const buildResult = (events: TRelayEvent[], costTracker: ICostTracker, sessionId: string | undefined): TAskResult => {
  const textParts = events.filter((e): e is TTextEvent => e.type === "text").map((e) => e.content);
  const tc = events.findLast((e) => e.type === "turn_complete");
  const snap = costTracker.snapshot();

  return {
    text: textParts.join(""),
    costUsd: snap.totalUsd,
    tokens: { input: snap.inputTokens, output: snap.outputTokens },
    duration: tc?.type === "turn_complete" ? (tc.durationMs ?? 0) : 0,
    sessionId,
    events,
  };
};
