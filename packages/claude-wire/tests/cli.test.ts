import { beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockProcess, type TMockProcess } from "./helpers/mock-process.js";

const jsonAnswer = '{"ok":true,"answer":"hello"}';
const jsonFixtureLines = [
  '{"type":"system","subtype":"init","session_id":"sess-json","model":"claude-haiku","tools":[]}',
  `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":${JSON.stringify(jsonAnswer)}}]}}`,
  `{"type":"result","subtype":"success","session_id":"sess-json","result":${JSON.stringify(jsonAnswer)},"is_error":false,"total_cost_usd":0.012,"duration_ms":1800,"duration_api_ms":1500,"num_turns":1,"modelUsage":{"claude-haiku":{"inputTokens":500,"outputTokens":56,"cacheReadInputTokens":734,"cacheCreationInputTokens":0,"contextWindow":200000}}}`,
];

let mockProc: TMockProcess;

beforeEach(() => {
  mockProc = createMockProcess(jsonFixtureLines);
  mock.module("@/process.js", () => ({
    spawnClaude: () => mockProc,
    safeKill: () => {},
    safeWrite: (proc: { write: (msg: string) => void }, line: string) => {
      try {
        proc.write(line);
        return true;
      } catch {
        return false;
      }
    },
    buildArgs: () => [],
    buildSpawnEnv: () => ({}),
    resetResolvedEnvCache: () => {},
  }));
});

const loadCli = async () => {
  const mod = await import("@/cli.js");
  return { runCli: mod.runCli, CliExit: mod.CliExit };
};

interface ICapture {
  stdout: string;
  stderr: string;
}

const makeIo = (opts: { stdinIsTTY?: boolean; stdin?: string } = {}) => {
  const capture: ICapture = { stdout: "", stderr: "" };
  const io = {
    stdout: (text: string) => {
      capture.stdout += text;
    },
    stderr: (text: string) => {
      capture.stderr += text;
    },
    readStdin: async () => opts.stdin ?? "",
    stdinIsTTY: opts.stdinIsTTY ?? false,
  };
  return { io, capture };
};

describe("cli runCli", () => {
  test("mutually-exclusive --schema + --schema-file exits 4", async () => {
    const { runCli, CliExit } = await loadCli();
    const { io, capture } = makeIo();

    try {
      await runCli(["ask-json", "--schema", "{}", "--schema-file", "/tmp/nope.json", "--prompt", "hi"], io);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliExit);
      expect((err as InstanceType<typeof CliExit>).code).toBe(4);
      const parsed = JSON.parse(capture.stderr.trim());
      expect(parsed.code).toBe("invalid-args");
      expect(parsed.error).toContain("mutually exclusive");
    }
  });

  test("missing both schema flags exits 4", async () => {
    const { runCli, CliExit } = await loadCli();
    const { io, capture } = makeIo();

    try {
      await runCli(["ask-json", "--prompt", "hi"], io);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliExit);
      expect((err as InstanceType<typeof CliExit>).code).toBe(4);
      const parsed = JSON.parse(capture.stderr.trim());
      expect(parsed.code).toBe("invalid-args");
      expect(parsed.error).toContain("Missing schema");
    }
  });

  test("--version prints version from package.json and exits 0", async () => {
    const { runCli, CliExit } = await loadCli();
    const { io, capture } = makeIo();

    try {
      await runCli(["--version"], io);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliExit);
      expect((err as InstanceType<typeof CliExit>).code).toBe(0);
    }

    const pkg = await import("../package.json", { with: { type: "json" } });
    expect(capture.stdout.trim()).toBe(pkg.default.version);
  });

  test("--help exits 0 with usage text", async () => {
    const { runCli, CliExit } = await loadCli();
    const { io, capture } = makeIo();

    try {
      await runCli(["--help"], io);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliExit);
      expect((err as InstanceType<typeof CliExit>).code).toBe(0);
    }

    expect(capture.stdout).toContain("ask-json");
    expect(capture.stdout).toContain("--prompt");
    expect(capture.stdout).toContain("--schema-file");
  });

  test("stdin TTY with no --prompt exits 4", async () => {
    const { runCli, CliExit } = await loadCli();
    const { io, capture } = makeIo({ stdinIsTTY: true });

    try {
      await runCli(["ask-json", "--schema", '{"type":"object"}'], io);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliExit);
      expect((err as InstanceType<typeof CliExit>).code).toBe(4);
      const parsed = JSON.parse(capture.stderr.trim());
      expect(parsed.error).toContain("Missing prompt");
    }
  });

  test("unknown command exits 4", async () => {
    const { runCli, CliExit } = await loadCli();
    const { io, capture } = makeIo();

    try {
      await runCli(["do-something-else"], io);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliExit);
      expect((err as InstanceType<typeof CliExit>).code).toBe(4);
      expect(JSON.parse(capture.stderr.trim()).error).toContain("Unknown command");
    }
  });

  test("successful ask-json prints a single JSON line to stdout", async () => {
    const { runCli, CliExit } = await loadCli();
    const { io, capture } = makeIo();

    try {
      await runCli(["ask-json", "--prompt", "anything", "--schema", '{"type":"object"}'], io);
    } catch (err) {
      if (err instanceof CliExit && err.code !== 0) {
        throw new Error(`unexpected exit ${err.code}: ${capture.stderr}`);
      }
      if (!(err instanceof CliExit)) {
        throw err;
      }
    }

    const lines = capture.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);

    const payload = JSON.parse(lines[0] ?? "");
    expect(payload.data).toEqual({ ok: true, answer: "hello" });
    expect(payload).toHaveProperty("costUsd", 0.012);
    expect(payload.tokens.input).toBeGreaterThan(0);
    expect(payload.durationMs).toBe(1800);
    expect(payload.sessionId).toBe("sess-json");
  });

  test("--schema-file happy path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-test-"));
    const schemaPath = join(dir, "schema.json");
    writeFileSync(schemaPath, '{"type":"object","properties":{"ok":{"type":"boolean"}}}');

    try {
      const { runCli, CliExit } = await loadCli();
      const { io, capture } = makeIo();

      try {
        await runCli(["ask-json", "--prompt", "go", "--schema-file", schemaPath], io);
      } catch (err) {
        if (err instanceof CliExit && err.code !== 0) {
          throw new Error(`unexpected exit ${err.code}: ${capture.stderr}`);
        }
        if (!(err instanceof CliExit)) {
          throw err;
        }
      }

      const payload = JSON.parse(capture.stdout.trim());
      expect(payload.data).toEqual({ ok: true, answer: "hello" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--schema-file with non-existent path exits 4", async () => {
    const { runCli, CliExit } = await loadCli();
    const { io, capture } = makeIo();

    try {
      await runCli(["ask-json", "--prompt", "hi", "--schema-file", "/nonexistent/definitely/not-here.json"], io);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CliExit);
      expect((err as InstanceType<typeof CliExit>).code).toBe(4);
      expect(JSON.parse(capture.stderr.trim()).error).toContain("Failed to read --schema-file");
    }
  });

  test("--schema-file with invalid JSON exits 4", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-test-"));
    const schemaPath = join(dir, "bad.json");
    writeFileSync(schemaPath, "not json at all");

    try {
      const { runCli, CliExit } = await loadCli();
      const { io, capture } = makeIo();

      try {
        await runCli(["ask-json", "--prompt", "hi", "--schema-file", schemaPath], io);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CliExit);
        expect((err as InstanceType<typeof CliExit>).code).toBe(4);
        expect(JSON.parse(capture.stderr.trim()).error).toContain("not valid JSON");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reads prompt from stdin when --prompt is omitted and stdin is piped", async () => {
    const { runCli, CliExit } = await loadCli();
    const { io, capture } = makeIo({ stdin: "prompt from stdin" });

    try {
      await runCli(["ask-json", "--schema", '{"type":"object"}'], io);
    } catch (err) {
      if (err instanceof CliExit && err.code !== 0) {
        throw new Error(`unexpected exit ${err.code}: ${capture.stderr}`);
      }
      if (!(err instanceof CliExit)) {
        throw err;
      }
    }

    const payload = JSON.parse(capture.stdout.trim());
    expect(payload).toHaveProperty("data");
  });
});
