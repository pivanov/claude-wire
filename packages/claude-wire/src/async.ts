// Small async helpers shared between session.ts and stream.ts. Kept in
// their own file because both consumers care about the *shape* of the
// timeout pattern, not its underlying mechanics -- drop a single
// withTimeout() next to whatever else needs it rather than carrying the
// Promise.race idiom inline at every site.

/**
 * Races `promise` against a timeout. When the timer fires first, resolves
 * with `onTimeout()` (or `undefined` if omitted). The caller decides
 * whether that's an acceptable fallback or a signal to kill/retry.
 *
 * Intentionally does NOT reject on timeout -- callers usually have a
 * specific action to take (kill the process, bail early with undefined)
 * that a thrown error would force into a catch branch for no reason.
 */
export const withTimeout = <T, F = undefined>(promise: Promise<T>, ms: number, onTimeout?: () => F): Promise<T | F> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<F>((resolve) => {
    timer = setTimeout(() => {
      resolve(onTimeout ? onTimeout() : (undefined as F));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
};
