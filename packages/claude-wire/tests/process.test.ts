import { describe, expect, test } from "bun:test";
import { isKnownError } from "@/errors.js";
import { buildArgs, buildSpawnEnv, spawnClaude } from "@/process.js";

describe("buildArgs", () => {
  const binary = "/usr/local/bin/claude";

  test("builds base args with mandatory flags", () => {
    const args = buildArgs({}, binary);
    expect(args).toContain(binary);
    expect(args).toContain("-p");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--input-format");
    expect(args).toContain("--verbose");
  });

  test("omits --verbose when verbose is false", () => {
    const args = buildArgs({ verbose: false }, binary);
    expect(args).not.toContain("--verbose");
  });

  test("includes --model", () => {
    const args = buildArgs({ model: "opus" }, binary);
    const idx = args.indexOf("--model");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("opus");
  });

  test("includes --system-prompt", () => {
    const args = buildArgs({ systemPrompt: "Be a pirate" }, binary);
    const idx = args.indexOf("--system-prompt");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("Be a pirate");
  });

  test("includes --append-system-prompt", () => {
    const args = buildArgs({ appendSystemPrompt: "Be concise" }, binary);
    const idx = args.indexOf("--append-system-prompt");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("Be concise");
  });

  test("includes --allowedTools with comma-joined list", () => {
    const args = buildArgs({ allowedTools: ["Read", "Write"] }, binary);
    const idx = args.indexOf("--allowedTools");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("Read,Write");
  });

  test("includes --tools empty when allowedTools is empty array", () => {
    const args = buildArgs({ allowedTools: [] }, binary);
    const idx = args.indexOf("--tools");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("");
  });

  test("includes --disallowedTools", () => {
    const args = buildArgs({ disallowedTools: ["Bash"] }, binary);
    const idx = args.indexOf("--disallowedTools");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("Bash");
  });

  test("includes --max-budget-usd", () => {
    const args = buildArgs({ maxBudgetUsd: 2.5 }, binary);
    const idx = args.indexOf("--max-budget-usd");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("2.5");
  });

  test("includes --resume", () => {
    const args = buildArgs({ resume: "sess-123" }, binary);
    const idx = args.indexOf("--resume");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("sess-123");
  });

  test("includes --mcp-config", () => {
    const args = buildArgs({ mcpConfig: "/path/mcp.json" }, binary);
    expect(args).toContain("--mcp-config");
  });

  test("includes --continue", () => {
    const args = buildArgs({ continueSession: true }, binary);
    expect(args).toContain("--continue");
  });

  test("includes --permission-mode", () => {
    const args = buildArgs({ permissionMode: "auto" }, binary);
    const idx = args.indexOf("--permission-mode");
    expect(args[idx + 1]).toBe("auto");
  });

  test("includes --add-dir for each directory", () => {
    const args = buildArgs({ addDirs: ["/a", "/b"] }, binary);
    const indices: number[] = [];
    args.forEach((a, i) => {
      if (a === "--add-dir") {
        indices.push(i);
      }
    });
    expect(indices).toHaveLength(2);
    expect(args[indices[0]! + 1]).toBe("/a");
    expect(args[indices[1]! + 1]).toBe("/b");
  });

  test("includes --effort", () => {
    const args = buildArgs({ effort: "max" }, binary);
    expect(args).toContain("--effort");
  });

  test("includes boolean flags", () => {
    const args = buildArgs(
      {
        includeHookEvents: true,
        includePartialMessages: true,
        bare: true,
        forkSession: true,
        noSessionPersistence: true,
        disableSlashCommands: true,
      },
      binary,
    );
    expect(args).toContain("--include-hook-events");
    expect(args).toContain("--include-partial-messages");
    expect(args).toContain("--bare");
    expect(args).toContain("--fork-session");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--disable-slash-commands");
  });

  test("includes --json-schema", () => {
    const args = buildArgs({ jsonSchema: '{"type":"object"}' }, binary);
    expect(args).toContain("--json-schema");
  });

  test("includes --session-id", () => {
    const args = buildArgs({ sessionId: "uuid-123" }, binary);
    const idx = args.indexOf("--session-id");
    expect(args[idx + 1]).toBe("uuid-123");
  });

  test("includes --setting-sources", () => {
    const args = buildArgs({ settingSources: "" }, binary);
    const idx = args.indexOf("--setting-sources");
    expect(args[idx + 1]).toBe("");
  });

  test("does not include flags for undefined options", () => {
    const args = buildArgs({}, binary);
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--resume");
    expect(args).not.toContain("--continue");
    expect(args).not.toContain("--bare");
    expect(args).not.toContain("--setting-sources");
  });
});

describe("buildSpawnEnv", () => {
  test("returns undefined when nothing overrides the parent env", () => {
    expect(buildSpawnEnv({ PATH: "/usr/bin" }, undefined, {})).toBeUndefined();
  });

  test("alias-detected CLAUDE_CONFIG_DIR wins over parent env", () => {
    const env = buildSpawnEnv({ CLAUDE_CONFIG_DIR: "/from-parent" }, "/from-alias", {});
    expect(env?.CLAUDE_CONFIG_DIR).toBe("/from-alias");
  });

  test("options.env CLAUDE_CONFIG_DIR wins over alias", () => {
    const env = buildSpawnEnv({}, "/from-alias", { env: { CLAUDE_CONFIG_DIR: "/from-options-env" } });
    expect(env?.CLAUDE_CONFIG_DIR).toBe("/from-options-env");
  });

  test("options.configDir wins over options.env and alias", () => {
    const env = buildSpawnEnv({}, "/from-alias", {
      env: { CLAUDE_CONFIG_DIR: "/from-options-env" },
      configDir: "/from-options-config-dir",
    });
    expect(env?.CLAUDE_CONFIG_DIR).toBe("/from-options-config-dir");
  });

  test("full 4-way precedence: parent < alias < options.env < options.configDir", () => {
    const env = buildSpawnEnv({ CLAUDE_CONFIG_DIR: "/parent", PATH: "/bin" }, "/alias", {
      env: { CLAUDE_CONFIG_DIR: "/user-env", EXTRA: "yes" },
      configDir: "/winner",
    });
    expect(env?.CLAUDE_CONFIG_DIR).toBe("/winner");
    expect(env?.PATH).toBe("/bin");
    expect(env?.EXTRA).toBe("yes");
  });

  test("preserves non-CONFIG_DIR values from options.env", () => {
    const env = buildSpawnEnv({}, undefined, {
      env: { ANTHROPIC_API_KEY: "sk-test", DEBUG: "1" },
    });
    expect(env?.ANTHROPIC_API_KEY).toBe("sk-test");
    expect(env?.DEBUG).toBe("1");
  });
});

describe("spawnClaude validation", () => {
  test("rejects conflicting resume + continueSession with KnownError('invalid-options')", () => {
    try {
      spawnClaude({ resume: "sess-1", continueSession: true });
      throw new Error("expected spawnClaude to throw");
    } catch (err) {
      expect(isKnownError(err)).toBe(true);
      expect((err as { code: string }).code).toBe("invalid-options");
    }
  });
});
