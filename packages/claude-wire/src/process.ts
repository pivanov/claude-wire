import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BINARY } from "./constants.js";
import { KnownError, ProcessError } from "./errors.js";
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
  try {
    const result = Bun.spawnSync(["which", "claude"], { stdout: "pipe", stderr: "pipe" });
    const path = new TextDecoder().decode(result.stdout).trim();
    if (path) {
      return path;
    }
  } catch {
    // fall through
  }

  for (const p of BINARY.commonPaths) {
    try {
      const stat = Bun.file(p);
      if (stat.size > 0) {
        return p;
      }
    } catch {
      // continue
    }
  }

  return BINARY.name;
};

const ALIAS_PATTERN = /alias\s+claude\s*=\s*.*CLAUDE_CONFIG_DIR=\$?(?:HOME|\{HOME\}|~)\/(\S+?)(?:\s|\/|$)/;

const resolveConfigDirFromAlias = (): string | undefined => {
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

export const spawnClaude = (options: ISpawnOptions): IClaudeProcess => {
  if (options.maxBudgetUsd !== undefined && (Number.isNaN(options.maxBudgetUsd) || options.maxBudgetUsd <= 0)) {
    throw new ProcessError("maxBudgetUsd must be a positive number");
  }
  if (options.maxCostUsd !== undefined && (Number.isNaN(options.maxCostUsd) || options.maxCostUsd <= 0)) {
    throw new ProcessError("maxCostUsd must be a positive number");
  }

  const resolved = resolve();
  const args: string[] = [resolved.binaryPath, "-p", "--output-format", "stream-json", "--input-format", "stream-json"];

  if (options.verbose !== false) {
    args.push("--verbose");
  }

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.systemPrompt) {
    args.push("--system-prompt", options.systemPrompt);
  }

  if (options.appendSystemPrompt) {
    args.push("--append-system-prompt", options.appendSystemPrompt);
  }

  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }

  if (options.disallowedTools && options.disallowedTools.length > 0) {
    args.push("--disallowedTools", options.disallowedTools.join(","));
  }

  if (options.maxBudgetUsd !== undefined) {
    args.push("--max-budget-usd", String(options.maxBudgetUsd));
  }

  if (options.resume) {
    args.push("--resume", options.resume);
  }

  if (options.mcpConfig) {
    args.push("--mcp-config", options.mcpConfig);
  }

  if (options.continueSession) {
    args.push("--continue");
  }

  if (options.permissionMode) {
    args.push("--permission-mode", options.permissionMode);
  }

  if (options.addDirs && options.addDirs.length > 0) {
    for (const dir of options.addDirs) {
      args.push("--add-dir", dir);
    }
  }

  if (options.effort) {
    args.push("--effort", options.effort);
  }

  if (options.includeHookEvents) {
    args.push("--include-hook-events");
  }

  if (options.includePartialMessages) {
    args.push("--include-partial-messages");
  }

  if (options.bare) {
    args.push("--bare");
  }

  if (options.jsonSchema) {
    args.push("--json-schema", options.jsonSchema);
  }

  if (options.forkSession) {
    args.push("--fork-session");
  }

  if (options.noSessionPersistence) {
    args.push("--no-session-persistence");
  }

  if (options.sessionId) {
    args.push("--session-id", options.sessionId);
  }

  try {
    const spawnEnv: Record<string, string | undefined> = { ...process.env };

    if (resolved.aliasConfigDir) {
      spawnEnv.CLAUDE_CONFIG_DIR = resolved.aliasConfigDir;
    }

    if (options.configDir) {
      spawnEnv.CLAUDE_CONFIG_DIR = options.configDir;
    }

    if (options.env) {
      Object.assign(spawnEnv, options.env);
    }

    const proc = Bun.spawn(args, {
      cwd: options.cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });

    if (options.prompt) {
      proc.stdin.write(writer.user(options.prompt));
    }

    return {
      write: (msg: string) => {
        proc.stdin.write(msg);
      },
      kill: () => {
        proc.kill();
      },
      exited: proc.exited,
      stdout: proc.stdout as ReadableStream<Uint8Array>,
      stderr: proc.stderr as ReadableStream<Uint8Array>,
      pid: proc.pid,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("ENOENT") || msg.includes("not found")) {
      throw new KnownError("binary-not-found", "Claude CLI not found. Install it from https://claude.ai/download");
    }
    throw new ProcessError(`Failed to spawn claude: ${msg}`);
  }
};
