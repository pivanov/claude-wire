import { execFileSync, spawn as nodeSpawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { Readable } from "node:stream";
import { ProcessError } from "./errors.js";

const isBun = typeof globalThis.Bun !== "undefined";

export interface IRawProcess {
  stdin: { write: (data: string) => void; end: () => void };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill: () => void;
  exited: Promise<number>;
  pid: number;
}

export interface ISpawnOpts {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export const spawnProcess = (args: string[], opts: ISpawnOpts): IRawProcess => {
  if (isBun) {
    return spawnBun(args, opts);
  }
  return spawnNode(args, opts);
};

export const whichSync = (name: string): string | undefined => {
  if (isBun) {
    try {
      const result = Bun.spawnSync(["which", name], { stdout: "pipe", stderr: "pipe" });
      const path = new TextDecoder().decode(result.stdout).trim();
      if (path) {
        return path;
      }
    } catch {
      // fall through
    }
    return undefined;
  }

  try {
    return execFileSync("which", [name], { encoding: "utf-8" }).trim() || undefined;
  } catch {
    return undefined;
  }
};

export const fileExists = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).size > 0;
  } catch {
    return false;
  }
};

const spawnBun = (args: string[], opts: ISpawnOpts): IRawProcess => {
  const proc = Bun.spawn(args, {
    cwd: opts.cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: opts.env,
  });

  return {
    stdin: {
      write: (data: string) => {
        proc.stdin.write(data);
      },
      end: () => {
        proc.stdin.end();
      },
    },
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stderr: proc.stderr as ReadableStream<Uint8Array>,
    kill: () => {
      proc.kill();
    },
    exited: proc.exited,
    pid: proc.pid,
  };
};

const toWeb = (readable: Readable): ReadableStream<Uint8Array> => Readable.toWeb(readable) as ReadableStream<Uint8Array>;

const spawnNode = (args: string[], opts: ISpawnOpts): IRawProcess => {
  const [cmd, ...rest] = args;
  if (!cmd) {
    throw new ProcessError("No command specified");
  }

  const child = nodeSpawn(cmd, rest, {
    cwd: opts.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: opts.env as NodeJS.ProcessEnv,
  });

  if (child.pid === undefined) {
    throw new ProcessError(`Failed to spawn ${cmd}: no PID assigned`);
  }

  const exited = new Promise<number>((resolve, reject) => {
    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
    child.on("error", reject);
  });

  return {
    stdin: {
      write: (data: string) => {
        if (!child.stdin || child.stdin.destroyed) {
          throw new ProcessError("Cannot write: stdin is not writable");
        }
        child.stdin.write(data);
      },
      end: () => {
        child.stdin?.end();
      },
    },
    stdout: child.stdout ? toWeb(child.stdout) : new ReadableStream(),
    stderr: child.stderr ? toWeb(child.stderr) : new ReadableStream(),
    kill: () => {
      child.kill();
    },
    exited,
    pid: child.pid,
  };
};
