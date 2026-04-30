// Public barrel for `@pivanov/claude-wire/testing`. In-process IClaudeProcess
// fakes for unit tests. Keeping this behind a subpath means production
// installs never pull it -- bundlers can drop it cleanly.
export type { IMockProcess, IMockProcessOptions, IMultiTurnMockProcess } from "./mock-process.js";
export { createMockProcess, createMultiTurnMockProcess } from "./mock-process.js";
