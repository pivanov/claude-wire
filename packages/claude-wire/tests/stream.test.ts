// Integration test - requires claude CLI
import { describe, test } from "bun:test";

describe("createStream", () => {
  test.skip("streams events from claude process", () => {});
  test.skip("text() returns concatenated text events", () => {});
  test.skip("cost() returns cost snapshot after completion", () => {});
  test.skip("result() returns full TAskResult", () => {});
  test.skip("handles tool approval via handler", () => {});
  test.skip("aborts on signal", () => {});
  test.skip("throws BudgetExceededError when over limit", () => {});
  test.skip("throws error if for-await and result() are mixed", () => {});
});
