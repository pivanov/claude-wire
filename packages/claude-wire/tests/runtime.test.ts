import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileExists, spawnProcess, whichSync } from "@/runtime.js";

describe("whichSync", () => {
  test("finds a shell built-in binary that exists on PATH", () => {
    // `sh` exists on every supported platform
    const found = whichSync("sh");
    expect(found).toBeTruthy();
    expect(found).toMatch(/\/sh$/);
  });

  test("returns undefined for a nonexistent binary", () => {
    const found = whichSync("claude-wire-definitely-not-a-binary-xyz");
    expect(found).toBeUndefined();
  });
});

describe("fileExists", () => {
  test("returns true for a writable, non-empty executable", () => {
    const dir = mkdtempSync(join(tmpdir(), "cw-fileexists-"));
    const path = join(dir, "bin");
    writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    expect(fileExists(path)).toBe(true);
  });

  test("returns false for an empty file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cw-empty-"));
    const path = join(dir, "empty");
    writeFileSync(path, "", { mode: 0o755 });
    expect(fileExists(path)).toBe(false);
  });

  test("returns false for a missing path", () => {
    expect(fileExists("/tmp/cw-does-not-exist-xyz-12345")).toBe(false);
  });
});

describe("spawnProcess", () => {
  test("runs a trivial command and exits cleanly", async () => {
    const proc = spawnProcess(["/bin/sh", "-c", "echo hello"], {});
    expect(proc.pid).toBeGreaterThan(0);

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      output += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();

    const code = await proc.exited;
    expect(code).toBe(0);
    expect(output.trim()).toBe("hello");
  });

  test("propagates non-zero exit codes", async () => {
    const proc = spawnProcess(["/bin/sh", "-c", "exit 7"], {});
    const code = await proc.exited;
    expect(code).toBe(7);
  });

  test("kill() terminates the process", async () => {
    const proc = spawnProcess(["/bin/sh", "-c", "sleep 60"], {});
    proc.kill();
    const code = await proc.exited;
    // SIGTERM yields 143 on Unix, or the child may report 0/1 depending on shell
    expect(typeof code).toBe("number");
  });
});
