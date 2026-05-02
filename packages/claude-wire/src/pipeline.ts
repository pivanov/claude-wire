import type { ICostTracker } from "./cost.js";
import type { IClaudeProcess, ISpawnOptions } from "./process.js";
import { safeWrite, spawnClaude } from "./process.js";
import { drainStderr, type IStderrDrain } from "./reader.js";
import type { IToolHandlerInstance, TToolDecision } from "./tools/handler.js";
import type { TRelayEvent, TStructuredOutputEvent, TTextEvent, TThinkingEvent, TToolUseEvent, TTurnCompleteEvent } from "./types/events.js";
import type { TAskResult, TCostSnapshot } from "./types/results.js";
import type { TWarn } from "./warnings.js";
import { createWarn } from "./warnings.js";
import { writer } from "./writer.js";

// Return type of startPipeline. Not exported -- consumers get the shape
// via inference on startPipeline's signature, which is the idiomatic
// path for "internal struct, public function" pairs.
interface IPipeline {
  proc: IClaudeProcess;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  stderr: IStderrDrain;
}

// Shared process-boot: spawn the CLI, lock the stdout reader, drain
// stderr. session.ts and stream.ts both need this exact trio; keeping
// the order in one place prevents the "one forgot to drain stderr and
// the other swallows exits silently" class of bug.
export const startPipeline = (options: ISpawnOptions): IPipeline => {
  const proc = spawnClaude(options);
  // Cast is load-bearing: Node's stream/web ReadableStreamDefaultReader is
  // structurally a superset of Bun's (it adds a `readMany` method), so
  // without this the dual-runtime abstraction in runtime.ts fails to unify.
  const reader = proc.stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const stderr = drainStderr(proc, options.onWarning);
  return { proc, reader, stderr };
};

export const dispatchToolDecision = async (
  proc: IClaudeProcess,
  toolHandler: IToolHandlerInstance,
  event: TToolUseEvent,
  onWarning?: TWarn,
): Promise<void> => {
  const warn = createWarn(onWarning);
  let decision: TToolDecision;
  try {
    decision = await toolHandler.decide(event);
  } catch (error) {
    warn("Tool handler threw, defaulting to deny", error);
    decision = "deny";
  }
  if (decision === "approve") {
    safeWrite(proc, writer.approve(event.toolUseId));
  } else if (decision === "deny") {
    safeWrite(proc, writer.deny(event.toolUseId));
  } else if (typeof decision === "object" && decision !== null && typeof decision.result === "string") {
    const isError = "isError" in decision ? decision.isError : undefined;
    safeWrite(proc, writer.toolResult(event.toolUseId, decision.result, isError ? { isError: true } : undefined));
  } else {
    warn("Invalid tool decision, defaulting to deny", decision);
    safeWrite(proc, writer.deny(event.toolUseId));
  }
};

// Applies a turn_complete event's cumulative totals to the cost tracker
// and enforces the budget. `offsets` covers session's respawn case where
// the new process starts its cumulative count from zero but the session
// wants to carry forward what previous processes already spent -- stream
// has no such concept and passes it undefined.
export const applyTurnComplete = (event: TTurnCompleteEvent, costTracker: ICostTracker, offsets?: TCostSnapshot): void => {
  const base = offsets ?? { totalUsd: 0, tokens: { input: 0, output: 0 } };
  const cacheRead = event.cacheReadTokens !== undefined ? (base.tokens.cacheRead ?? 0) + event.cacheReadTokens : base.tokens.cacheRead;
  const cacheCreation =
    event.cacheCreationTokens !== undefined ? (base.tokens.cacheCreation ?? 0) + event.cacheCreationTokens : base.tokens.cacheCreation;
  costTracker.update(
    base.totalUsd + (event.costUsd ?? 0),
    base.tokens.input + (event.inputTokens ?? 0),
    base.tokens.output + (event.outputTokens ?? 0),
    cacheRead,
    cacheCreation,
  );
  costTracker.checkBudget();
};

export const extractText = (events: TRelayEvent[]): string => {
  return events
    .filter((e): e is TTextEvent => e.type === "text")
    .map((e) => e.content)
    .join("");
};

export const extractThinking = (events: TRelayEvent[]): string => {
  return events
    .filter((e): e is TThinkingEvent => e.type === "thinking")
    .map((e) => e.content)
    .join("");
};

export const buildResult = (events: TRelayEvent[], costTracker: ICostTracker, sessionId: string | undefined): TAskResult => {
  const tc = events.findLast((e): e is TTurnCompleteEvent => e.type === "turn_complete");
  // Take the last structured_output event in the turn. The translator emits
  // at most one (dedup between block-route and result-route), so first/last
  // collapse to the same value in practice; using findLast keeps us robust
  // to a future protocol that might legitimately stream multiple updates.
  const so = events.findLast((e): e is TStructuredOutputEvent => e.type === "structured_output");
  const snap = costTracker.snapshot();

  return {
    text: extractText(events),
    thinking: extractThinking(events),
    structuredOutput: so?.value,
    costUsd: snap.totalUsd,
    tokens: snap.tokens,
    duration: tc?.durationMs,
    sessionId,
    events,
  };
};
