import type { TRelayEvent } from "./events.js";

// Unified token shape shared between TAskResult and TCostSnapshot.
// Previously TCostSnapshot used { inputTokens, outputTokens } while
// TAskResult used { tokens: { input, output } } -- two names for the
// same concept. Consolidated to the shorter form everywhere.
export type TTokens = { input: number; output: number };

export type TCostSnapshot = {
  totalUsd: number;
  tokens: TTokens;
};

export type TAskResult = {
  text: string;
  costUsd: number;
  tokens: TTokens;
  duration: number;
  sessionId?: string;
  events: TRelayEvent[];
};
