import { readFileSync } from "node:fs";
import type { IClaudeProcess } from "@/process.js";

export const createMockProcess = (ndjsonLines: string[], exitCode = 0): IClaudeProcess => {
  const writes: string[] = [];
  let killed = false;

  let resolveExited: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    resolveExited = resolve;
  });

  const encoder = new TextEncoder();

  const stdout = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const line of ndjsonLines) {
        controller.enqueue(encoder.encode(line + "\n"));
        // Yield to microtask queue so the reader can process each chunk
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
    // Expose for test assertions
    get _writes() {
      return writes;
    },
    get _killed() {
      return killed;
    },
  } as IClaudeProcess & { readonly _writes: string[]; readonly _killed: boolean };
};

export type TMockProcess = ReturnType<typeof createMockProcess>;

/**
 * Creates a mock process that supports multiple turns.
 * The stdout stream stays open. Turn data is emitted when the `emitTurn` method is called.
 */
export const createMultiTurnMockProcess = () => {
  const writes: string[] = [];
  let killed = false;
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;

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

  // Resolves when kill() is called, so gracefulKill doesn't wait 5s
  let resolveExited: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    resolveExited = resolve;
  });

  const emitLines = (lines: string[]) => {
    for (const line of lines) {
      controller.enqueue(encoder.encode(line + "\n"));
    }
  };

  const proc: IClaudeProcess & {
    readonly _writes: string[];
    readonly _killed: boolean;
    emitLines: (lines: string[]) => void;
  } = {
    write: (message: string) => {
      writes.push(message);
    },
    kill: () => {
      killed = true;
      resolveExited(0);
    },
    exited,
    stdout,
    stderr,
    pid: 0,
    get _writes() {
      return writes;
    },
    get _killed() {
      return killed;
    },
    emitLines,
  };

  return proc;
};

export type TMultiTurnMockProcess = ReturnType<typeof createMultiTurnMockProcess>;

export const loadFixtureLines = (fixturePath: string): string[] => {
  const text = readFileSync(fixturePath, "utf-8");
  return text.split("\n").filter((line) => line.trim() !== "");
};
