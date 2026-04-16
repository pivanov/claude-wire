// One-line library-warning emitter. Consumers set `onWarning` on
// IClaudeOptions to route warnings anywhere; when unset we fall back to
// `console.warn` so behavior is unchanged for casual users.

export type TWarn = (message: string, cause?: unknown) => void;

const DEFAULT: TWarn = (message, cause) => {
  if (cause === undefined) {
    console.warn(`[claude-wire] ${message}`);
  } else {
    console.warn(`[claude-wire] ${message}`, cause);
  }
};

export const createWarn = (onWarning?: TWarn): TWarn => {
  return onWarning
    ? (message, cause) => {
        try {
          onWarning(message, cause);
        } catch {
          // A user hook that itself throws shouldn't take down the stream.
          DEFAULT(message, cause);
        }
      }
    : DEFAULT;
};
