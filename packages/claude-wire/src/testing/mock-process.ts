import type { IClaudeProcess } from "../process.js";
import type { TClaudeEvent } from "../types/protocol.js";

// In-process IClaudeProcess implementations for unit tests. Live under
// `@pivanov/claude-wire/testing` so production installs that never reach
// the testing subpath don't pull this module into their bundle.
//
// Two shapes:
//   - createMockProcess: one-shot. Pre-supply a list of NDJSON lines; the
//     mock emits them, closes stdout, resolves `exited`. Good for "given
//     this CLI transcript, does the SDK do X" tests.
//   - createMultiTurnMockProcess: long-lived. stdout stays open until
//     `closeStdout()` or `kill()`. Use `emitLines()` / `emitEvent()` to push
//     data mid-stream. Good for testing tool decisions, mid-turn aborts,
//     respawn flows, anything that depends on timing between chunks.

export interface IMockProcess extends IClaudeProcess {
  /** Every line written to stdin via `write()`, in order. */
  readonly writes: readonly string[];
  /** True after `kill()` has been called at least once. */
  readonly killed: boolean;
}

export interface IMockProcessOptions {
  /** NDJSON lines (without trailing newlines) the mock emits then closes. */
  lines: string[];
  /** Exit code the `exited` promise resolves with after stdout closes. Defaults to 0. */
  exitCode?: number;
}

export const createMockProcess = (linesOrOptions: string[] | IMockProcessOptions, exitCodeArg = 0): IMockProcess => {
  const opts: IMockProcessOptions = Array.isArray(linesOrOptions) ? { lines: linesOrOptions, exitCode: exitCodeArg } : linesOrOptions;
  const lines = opts.lines;
  const exitCode = opts.exitCode ?? 0;

  const writes: string[] = [];
  let killed = false;

  let resolveExited!: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    resolveExited = resolve;
  });

  const encoder = new TextEncoder();

  const stdout = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`));
        // Yield to microtask queue so the reader can process each chunk
        // independently, surfacing any per-chunk timing bugs.
        await new Promise((r) => setTimeout(r, 0));
      }
      controller.close();
      resolveExited(exitCode);
    },
  });

  const stderr = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });

  return {
    write: (message: string) => {
      writes.push(message);
    },
    kill: () => {
      killed = true;
    },
    exited,
    stdout,
    stderr,
    pid: 0,
    get writes() {
      return writes;
    },
    get killed() {
      return killed;
    },
  };
};

export interface IMultiTurnMockProcess extends IMockProcess {
  /** Push raw NDJSON lines into stdout. Each gets a trailing `\n`. */
  emitLines: (lines: string[]) => void;
  /** Convenience: JSON-stringify a TClaudeEvent and emit it as one line. */
  emitEvent: (event: TClaudeEvent) => void;
  /** Closes the stdout stream so the reader sees EOF. */
  closeStdout: () => void;
}

export const createMultiTurnMockProcess = (): IMultiTurnMockProcess => {
  const writes: string[] = [];
  let killed = false;
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let stdoutClosed = false;

  const stdout = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
  });

  const stderr = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.close();
    },
  });

  let resolveExited!: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    resolveExited = resolve;
  });

  const closeStdout = () => {
    if (stdoutClosed) {
      return;
    }
    stdoutClosed = true;
    try {
      controller.close();
    } catch {
      // already closed
    }
  };

  const emitLines = (lines: string[]) => {
    if (stdoutClosed) {
      return;
    }
    for (const line of lines) {
      controller.enqueue(encoder.encode(`${line}\n`));
    }
  };

  const emitEvent = (event: TClaudeEvent) => {
    emitLines([JSON.stringify(event)]);
  };

  return {
    write: (message: string) => {
      writes.push(message);
    },
    kill: () => {
      killed = true;
      closeStdout();
      resolveExited(0);
    },
    exited,
    stdout,
    stderr,
    pid: 0,
    get writes() {
      return writes;
    },
    get killed() {
      return killed;
    },
    emitLines,
    emitEvent,
    closeStdout,
  };
};
