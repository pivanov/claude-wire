// Integration test - requires claude CLI
import { describe, test } from "bun:test";

describe("createSession", () => {
  test.skip("sends first prompt and returns result", () => {});
  test.skip("sends follow-up prompts to existing process", () => {});
  test.skip("tracks session ID across turns", () => {});
  test.skip("accumulates cost across turns", () => {});
  test.skip("handles tool approval in session", () => {});
  test.skip("close() kills the process", () => {});
  test.skip("respawns on process crash", () => {});
  test.skip("gives up after max respawn attempts", () => {});
  test.skip("resets respawn counter on successful turn", () => {});
  test.skip("respawns after max turns to prevent context overflow", () => {});
});
