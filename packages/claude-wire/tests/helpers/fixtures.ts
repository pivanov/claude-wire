import { readFileSync } from "node:fs";

// fs-backed fixture loading lives in tests/ rather than src/testing/ so the
// published `@pivanov/claude-wire/testing` module stays free of node-specific
// imports. Bun and Node both supply node:fs, so this helper is fine for tests.
export const loadFixtureLines = (fixturePath: string): string[] => {
  const text = readFileSync(fixturePath, "utf-8");
  return text.split("\n").filter((line) => line.trim() !== "");
};
