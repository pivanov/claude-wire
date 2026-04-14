import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BINARY } from "./constants.js";
import { assertPositiveNumber, errorMessage, KnownError, ProcessError } from "./errors.js";
import { fileExists, spawnProcess, whichSync } from "./runtime.js";
import type { IClaudeOptions } from "./types/options.js";
import { writer } from "./writer.js";

export interface IClaudeProcess {
  write: (message: string) => void;
  kill: () => void;
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  pid: number;
}

export interface ISpawnOptions extends IClaudeOptions {
  prompt?: string;
}

const resolveBinaryPath = (): string => {
  const found = whichSync("claude");
  if (found) {
    return found;
  }

  for (const p of BINARY.commonPaths) {
    if (fileExists(p)) {
      return p;
    }
  }

  return BINARY.name;
};

// Rejects lines whose first non-whitespace char is `#` so commented-out
// aliases/exports don't silently apply. /m anchors to each line in rc files.
export const ALIAS_PATTERN =
  /^(?!\s*#).*?(?:alias\s+claude\s*=|export\s+).*CLAUDE_CONFIG_DIR=["']?\$?(?:HOME|\{HOME\}|~)\/?([^\s"']+?)["']?(?:\s|$)/m;

export const resolveConfigDirFromAlias = (): string | undefined => {
  const home = homedir();
  const rcFiles = [".zshrc", ".bashrc", ".zprofile", ".bash_profile", ".aliases"];

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

export const resetBinaryCache = (): void => {
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

export const spawnClaude = (options: ISpawnOptions): IClaudeProcess => {
  assertPositiveNumber(options.maxBudgetUsd, "maxBudgetUsd");
  const resolved = resolve();
  const args = buildArgs(options, resolved.binaryPath);

  try {
    const needsEnv = resolved.aliasConfigDir || options.configDir || options.env;
    let spawnEnv: Record<string, string | undefined> | undefined;

    if (needsEnv) {
      // Priority (lowest → highest): process.env < alias-detected config <
      // user's explicit `options.env` < explicit `options.configDir`. User
      // input always outranks the alias heuristic.
      spawnEnv = { ...process.env };
      if (resolved.aliasConfigDir) {
        spawnEnv.CLAUDE_CONFIG_DIR = resolved.aliasConfigDir;
      }
      if (options.env) {
        Object.assign(spawnEnv, options.env);
      }
      if (options.configDir) {
        spawnEnv.CLAUDE_CONFIG_DIR = options.configDir;
      }
    }

    const rawProc = spawnProcess(args, { cwd: options.cwd, env: spawnEnv });

    rawProc.exited.catch(() => {});

    const claudeProc: IClaudeProcess = {
      write: (msg: string) => {
        rawProc.stdin.write(msg);
      },
      kill: () => {
        rawProc.kill();
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
