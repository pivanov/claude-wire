import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BINARY } from "./constants.js";
import { errorMessage, KnownError, ProcessError } from "./errors.js";
import { isExecutableNonEmpty, spawnProcess, whichSync } from "./runtime.js";
import type { IClaudeOptions } from "./types/options.js";
import { assertPositiveNumber } from "./validation.js";
import { writer } from "./writer.js";

export interface IClaudeProcess {
  write: (message: string) => void;
  // Signal defaults to SIGTERM. Pass "SIGKILL" for forced termination
  // (used by gracefulKill as the escalation after SIGTERM times out).
  kill: (signal?: NodeJS.Signals | number) => void;
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  pid: number;
}

export interface ISpawnOptions extends IClaudeOptions {
  prompt?: string;
}

// Swallow ESRCH/EPIPE-style throws from kill()/write() when the child is
// already gone. Every call site had the same try/catch -- keeping it in one
// place stops future adders from forgetting the guard.
export const safeKill = (proc: Pick<IClaudeProcess, "kill">, signal?: NodeJS.Signals | number): void => {
  try {
    proc.kill(signal);
  } catch {
    // already dead
  }
};

export const safeWrite = (proc: Pick<IClaudeProcess, "write">, line: string): boolean => {
  try {
    proc.write(line);
    return true;
  } catch {
    // stdin closed / process died -- caller surfaces the error via the read path
    return false;
  }
};

// Resolves the `claude` CLI binary path. POSIX-only today: uses `which` and
// `$HOME`-rooted common install paths. Windows users running under WSL get
// the Linux layout, which works; native Windows is not supported yet.
const resolveBinaryPath = (): string => {
  const found = whichSync("claude");
  if (found) {
    return found;
  }

  for (const p of BINARY.commonPaths) {
    if (isExecutableNonEmpty(p)) {
      return p;
    }
  }

  return BINARY.name;
};

// Rejects lines whose first non-whitespace char is `#` so commented-out
// aliases/exports don't silently apply. /m anchors to each line in rc files.
export const ALIAS_PATTERN =
  /^(?!\s*#).*?(?:alias\s+claude\s*=|export\s+).*CLAUDE_CONFIG_DIR=["']?\$?(?:HOME|\{HOME\}|~)\/?([^\s"']+?)["']?(?:\s|$)/m;

const resolveConfigDirFromAlias = (): string | undefined => {
  const home = homedir();
  // .zshenv is the one file zsh sources for NON-interactive shells, so
  // users who export CLAUDE_CONFIG_DIR for cron/CI-like contexts often
  // put it there. Include it alongside the interactive-shell rc files.
  const rcFiles = [".zshenv", ".zshrc", ".bashrc", ".zprofile", ".bash_profile", ".aliases"];

  for (const rcFile of rcFiles) {
    try {
      const content = readFileSync(join(home, rcFile), "utf-8");
      const match = content.match(ALIAS_PATTERN);
      if (match?.[1]) {
        return join(home, match[1]);
      }
    } catch {
      // file doesn't exist or can't be read
    }
  }

  return undefined;
};

type TResolvedEnv = {
  binaryPath: string;
  aliasConfigDir: string | undefined;
};

let cached: TResolvedEnv | undefined;

/**
 * Clears the cached resolved environment (binary path + alias-detected
 * `CLAUDE_CONFIG_DIR`). Call this when either has changed mid-process -- for
 * example after installing the Claude CLI during a test run, or when a long-
 * running daemon updates the user's shell rc file. The next `spawnClaude()`
 * will re-resolve from scratch.
 *
 * Normal applications should never need this; the cache is populated once at
 * first use and kept for the process lifetime.
 */
export const resetResolvedEnvCache = (): void => {
  cached = undefined;
};

const resolve = (): TResolvedEnv => {
  if (!cached) {
    cached = {
      binaryPath: resolveBinaryPath(),
      aliasConfigDir: resolveConfigDirFromAlias(),
    };
  }
  return cached;
};

export const buildArgs = (options: ISpawnOptions, binaryPath: string): string[] => {
  const args: string[] = [binaryPath, "-p", "--output-format", "stream-json", "--input-format", "stream-json"];

  const flag = (cond: unknown, name: string) => {
    if (cond) {
      args.push(name);
    }
  };
  const kv = (value: string | undefined, name: string) => {
    if (value) {
      args.push(name, value);
    }
  };

  // Default ON: the translator's block-dedup relies on --verbose emitting
  // cumulative assistant content. Consumers must explicitly pass `false`
  // to opt out (`undefined` still yields --verbose).
  flag(options.verbose !== false, "--verbose");
  kv(options.model, "--model");
  kv(options.systemPrompt, "--system-prompt");
  kv(options.appendSystemPrompt, "--append-system-prompt");

  if (options.allowedTools) {
    if (options.allowedTools.length === 0) {
      args.push("--tools", "");
    } else {
      args.push("--allowedTools", options.allowedTools.join(","));
    }
  }

  if (options.disallowedTools && options.disallowedTools.length > 0) {
    args.push("--disallowedTools", options.disallowedTools.join(","));
  }

  if (options.maxBudgetUsd !== undefined) {
    args.push("--max-budget-usd", String(options.maxBudgetUsd));
  }

  kv(options.resume, "--resume");
  kv(options.mcpConfig, "--mcp-config");
  flag(options.continueSession, "--continue");
  kv(options.permissionMode, "--permission-mode");

  if (options.addDirs && options.addDirs.length > 0) {
    for (const dir of options.addDirs) {
      args.push("--add-dir", dir);
    }
  }

  kv(options.effort, "--effort");
  flag(options.includeHookEvents, "--include-hook-events");
  flag(options.includePartialMessages, "--include-partial-messages");
  flag(options.bare, "--bare");
  kv(options.jsonSchema, "--json-schema");
  flag(options.forkSession, "--fork-session");
  flag(options.noSessionPersistence, "--no-session-persistence");
  kv(options.sessionId, "--session-id");

  if (options.settingSources !== undefined) {
    args.push("--setting-sources", options.settingSources);
  }

  flag(options.disableSlashCommands, "--disable-slash-commands");

  return args;
};

// Priority (lowest → highest): baseEnv < alias-detected config <
// user's explicit `options.env` < explicit `options.configDir`. User
// input always outranks the alias heuristic. Returns undefined when no
// override is needed, so spawnProcess can pass the parent env through.
export const buildSpawnEnv = (
  baseEnv: Record<string, string | undefined>,
  aliasConfigDir: string | undefined,
  options: Pick<ISpawnOptions, "configDir" | "env">,
): Record<string, string | undefined> | undefined => {
  const needsEnv = aliasConfigDir || options.configDir || options.env;
  if (!needsEnv) {
    return undefined;
  }
  const spawnEnv: Record<string, string | undefined> = { ...baseEnv };
  if (aliasConfigDir) {
    spawnEnv.CLAUDE_CONFIG_DIR = aliasConfigDir;
  }
  if (options.env) {
    Object.assign(spawnEnv, options.env);
  }
  if (options.configDir) {
    spawnEnv.CLAUDE_CONFIG_DIR = options.configDir;
  }
  return spawnEnv;
};

export const spawnClaude = (options: ISpawnOptions): IClaudeProcess => {
  assertPositiveNumber(options.maxBudgetUsd, "maxBudgetUsd");
  const resolved = resolve();
  const args = buildArgs(options, resolved.binaryPath);

  try {
    const spawnEnv = buildSpawnEnv(process.env, resolved.aliasConfigDir, options);

    const rawProc = spawnProcess(args, { cwd: options.cwd, env: spawnEnv });

    rawProc.exited.catch(() => {});

    // Tear the child down when the caller's signal aborts. Without this,
    // a signal that fires BEFORE stdout emits anything leaves the reader
    // loop to eventually notice -- the child keeps running in the meantime.
    // Register FIRST, then re-check `aborted`: closes the gap where abort
    // could fire between the check and listener attach. `once: true` lets
    // the listener be GC'd after firing.
    if (options.signal) {
      const onAbort = () => {
        safeKill(rawProc);
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      if (options.signal.aborted) {
        safeKill(rawProc);
      }
    }

    const claudeProc: IClaudeProcess = {
      write: (msg: string) => {
        rawProc.stdin.write(msg);
      },
      kill: (signal) => {
        rawProc.kill(signal);
      },
      exited: rawProc.exited,
      stdout: rawProc.stdout,
      stderr: rawProc.stderr,
      pid: rawProc.pid,
    };

    if (options.prompt) {
      try {
        rawProc.stdin.write(writer.user(options.prompt));
      } catch {
        rawProc.kill();
        throw new ProcessError("Failed to write initial prompt to process");
      }
    }

    return claudeProc;
  } catch (error) {
    const msg = errorMessage(error);
    if (msg.includes("ENOENT") || msg.includes("not found")) {
      throw new KnownError("binary-not-found", "Claude CLI not found. Install it from https://claude.ai/download");
    }
    throw new ProcessError(`Failed to spawn claude: ${msg}`);
  }
};
