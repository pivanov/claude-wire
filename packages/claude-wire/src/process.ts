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

const ALIAS_PATTERN = /(?:alias\s+claude\s*=|export\s+).*CLAUDE_CONFIG_DIR=["']?\$?(?:HOME|\{HOME\}|~)\/?([^\s"']+?)["']?(?:\s|\/|$)/;

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

export const buildArgs = (options: ISpawnOptions, binaryPath: string): string[] => {
  const args: string[] = [binaryPath, "-p", "--output-format", "stream-json", "--input-format", "stream-json"];

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

  if (options.settingSources !== undefined) {
    args.push("--setting-sources", options.settingSources);
  }

  if (options.disableSlashCommands) {
    args.push("--disable-slash-commands");
  }

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
      spawnEnv = { ...process.env };
      if (options.env) {
        Object.assign(spawnEnv, options.env);
      }
      if (resolved.aliasConfigDir) {
        spawnEnv.CLAUDE_CONFIG_DIR = resolved.aliasConfigDir;
      }
      if (options.configDir) {
        spawnEnv.CLAUDE_CONFIG_DIR = options.configDir;
      }
    }

    const proc = spawnProcess(args, { cwd: options.cwd, env: spawnEnv });

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
      stdout: proc.stdout,
      stderr: proc.stderr,
      pid: proc.pid,
    };
  } catch (error) {
    const msg = errorMessage(error);
    if (msg.includes("ENOENT") || msg.includes("not found")) {
      throw new KnownError("binary-not-found", "Claude CLI not found. Install it from https://claude.ai/download");
    }
    throw new ProcessError(`Failed to spawn claude: ${msg}`);
  }
};
