import { beforeAll, describe, expect, mock, test } from "bun:test";
import { isKnownError } from "@/errors.js";
import { realProcessModule } from "./helpers/real-process.js";

// Sibling test files (client/cli/session/stream) install global mock.module
// overrides for "@/process.js" that bun does not auto-restore between files.
// Force the real module back before binding any exports so this file is
// independent of test ordering on CI.
let buildArgs: typeof import("@/process.js").buildArgs;
let buildSpawnEnv: typeof import("@/process.js").buildSpawnEnv;
let spawnClaude: typeof import("@/process.js").spawnClaude;

beforeAll(async () => {
  mock.module("@/process.js", () => ({ ...realProcessModule }));
  const real = await import("@/process.js");
  buildArgs = real.buildArgs;
  buildSpawnEnv = real.buildSpawnEnv;
  spawnClaude = real.spawnClaude;
});

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

  test("uses strict --tools StructuredOutput when jsonSchema is set with empty allowedTools", () => {
    // --tools "" would disable every tool including the synthetic
    // StructuredOutput channel; --allowedTools is additive and would
    // leak user-settings tools that let the model bypass the constraint.
    // Strict whitelist via --tools is the only path that both enables
    // StructuredOutput and forces it as the only available channel.
    const args = buildArgs({ allowedTools: [], jsonSchema: '{"type":"object"}' }, binary);
    expect(args.indexOf("--allowedTools")).toBe(-1);
    const idx = args.indexOf("--tools");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("StructuredOutput");
  });

  test("appends StructuredOutput to --tools when jsonSchema is set with a non-empty list", () => {
    const args = buildArgs({ allowedTools: ["Read", "Write"], jsonSchema: '{"type":"object"}' }, binary);
    expect(args.indexOf("--allowedTools")).toBe(-1);
    const idx = args.indexOf("--tools");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("Read,Write,StructuredOutput");
  });

  test("does not duplicate StructuredOutput when caller already listed it under jsonSchema", () => {
    const args = buildArgs({ allowedTools: ["Read", "StructuredOutput"], jsonSchema: '{"type":"object"}' }, binary);
    const idx = args.indexOf("--tools");
    expect(args[idx + 1]).toBe("Read,StructuredOutput");
  });

  test("leaves allowedTools alone when jsonSchema is unset (no schema, no override)", () => {
    const args = buildArgs({ allowedTools: ["Read"] }, binary);
    const idx = args.indexOf("--allowedTools");
    expect(args[idx + 1]).toBe("Read");
  });

  test("forces --tools StructuredOutput when jsonSchema is set and allowedTools is undefined", () => {
    // Most common caller pattern: claude.askJson(prompt, schema) with
    // model + jsonSchema and no tool restriction. Without --tools the
    // model has the user's full settings.json tool surface and can pick
    // plain text instead of calling StructuredOutput.
    const args = buildArgs({ jsonSchema: '{"type":"object"}' }, binary);
    expect(args.indexOf("--allowedTools")).toBe(-1);
    const idx = args.indexOf("--tools");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("StructuredOutput");
  });

  test("emits no tool flag when neither jsonSchema nor allowedTools is set", () => {
    const args = buildArgs({}, binary);
    expect(args.indexOf("--allowedTools")).toBe(-1);
    expect(args.indexOf("--tools")).toBe(-1);
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

  test("strips top-level $schema from jsonSchema before forwarding (CLI quirk)", () => {
    // Zod 4's `z.toJSONSchema` emits a `$schema` URL by default; the CLI
    // silently rejects schemas carrying it and falls back to plain text.
    // Strip it transparently so callers can pass converter output verbatim.
    const raw = '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"x":{"type":"number"}},"required":["x"]}';
    const args = buildArgs({ jsonSchema: raw }, binary);
    const idx = args.indexOf("--json-schema");
    expect(idx).toBeGreaterThan(-1);
    const value = args[idx + 1] ?? "";
    expect(value).not.toContain("$schema");
    const parsed = JSON.parse(value);
    expect(parsed).toEqual({ type: "object", properties: { x: { type: "number" } }, required: ["x"] });
  });

  test("leaves jsonSchema unchanged when no top-level $schema is present", () => {
    const raw = '{"type":"object","properties":{"x":{"type":"number"}}}';
    const args = buildArgs({ jsonSchema: raw }, binary);
    const idx = args.indexOf("--json-schema");
    expect(args[idx + 1]).toBe(raw);
  });

  test("preserves nested $schema occurrences (only top-level is stripped)", () => {
    // Defensive: a $schema key inside a sub-schema is part of the user's
    // intent (e.g. an embedded Draft-07 hint). Only the top-level field
    // breaks the CLI; nested occurrences should pass through unchanged.
    const raw = '{"type":"object","properties":{"meta":{"type":"object","properties":{"$schema":{"type":"string"}}}}}';
    const args = buildArgs({ jsonSchema: raw }, binary);
    const idx = args.indexOf("--json-schema");
    expect(args[idx + 1]).toBe(raw);
  });

  test("malformed jsonSchema string passes through for the CLI to surface its own error", () => {
    const raw = "not-json-at-all";
    const args = buildArgs({ jsonSchema: raw }, binary);
    const idx = args.indexOf("--json-schema");
    expect(args[idx + 1]).toBe(raw);
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
