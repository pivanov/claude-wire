import type { TRelayEvent } from "./events.js";

export type TCostSnapshot = {
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
};

export type TAskResult = {
  text: string;
  costUsd: number;
  tokens: { input: number; output: number };
  duration: number;
  sessionId?: string;
  events: TRelayEvent[];
};
