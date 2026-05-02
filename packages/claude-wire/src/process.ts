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

// CLI quirk: `--json-schema` silently rejects any schema with a top-level
// `$schema` URL (e.g. "https://json-schema.org/draft/2020-12/schema") and
// falls back to plain text -- the StructuredOutput tool never fires.
// Zod 4's `z.toJSONSchema` emits `$schema` by default and many other
// converters do too, so callers passing converter output verbatim hit
// this dead end. Strip the field transparently before forwarding so the
// caller never has to know about the CLI's parser limitation. Malformed
// JSON passes through unchanged; the CLI surfaces its own parse error.
export const sanitizeJsonSchemaForCli = (raw: string): string => {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "$schema" in parsed) {
      const { $schema: _strip, ...rest } = parsed as Record<string, unknown>;
      void _strip;
      return JSON.stringify(rest);
    }
  } catch {
    // malformed input -- let the CLI surface its own error rather than
    // hide it behind a parse exception thrown in our build phase.
  }
  return raw;
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

  // Tool surface resolution. The CLI exposes two flags with different
  // semantics:
  //   `--allowedTools <list>` is additive: tools listed here are added to
  //     whatever `~/.claude/settings.json` and project settings already
  //     enabled. Used historically by claude-wire for non-empty lists,
  //     preserved for back-compat in the no-schema branch below.
  //   `--tools <list>` is a strict whitelist: ONLY the listed tools are
  //     available, regardless of user/project settings. `--tools ""`
  //     disables every tool (including MCP).
  //
  // When `--json-schema` is set, the CLI delivers the constrained value
  // through a synthetic `StructuredOutput` tool. Two failure modes:
  //   (1) The default tool set does not include StructuredOutput, so
  //       without an explicit allow flag the model can't emit it.
  //   (2) `--allowedTools StructuredOutput` is additive: user settings
  //       still expose Bash/Edit/Read/MCP/etc., giving the model an
  //       escape hatch back to plain text. The constraint must be
  //       strict, so the schema branch always uses `--tools`.
  //
  // Result: every schema-bearing turn gets `--tools <list,StructuredOutput>`
  // regardless of how the caller restricted the rest of the surface.
  if (options.jsonSchema) {
    const base = options.allowedTools ?? [];
    const list = base.includes("StructuredOutput") ? base : [...base, "StructuredOutput"];
    args.push("--tools", list.join(","));
  } else if (options.allowedTools !== undefined) {
    if (options.allowedTools.length === 0) {
      // Caller said "no tools" with no schema in play.
      args.push("--tools", "");
    } else {
      // Existing additive-permission semantics for non-schema callers.
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
  if (options.jsonSchema) {
    args.push("--json-schema", sanitizeJsonSchemaForCli(options.jsonSchema));
  }
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

  // Catch mutually exclusive session flags early. The CLI's behavior with
  // conflicting combinations is undefined and version-dependent.
  if (options.resume && options.continueSession) {
    throw new KnownError("invalid-options", "Cannot set both 'resume' and 'continueSession' -- use one or the other");
  }
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
    // could fire between the check and listener attach. On exit (normal
    // or killed), remove the listener so reused long-lived AbortControllers
    // don't accumulate dead entries across many spawns. `once: true` alone
    // doesn't cover the no-abort path.
    if (options.signal) {
      const signal = options.signal;
      const onAbort = () => {
        safeKill(rawProc);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      rawProc.exited.finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
      if (signal.aborted) {
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
        safeKill(rawProc);
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
