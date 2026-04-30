# Subpath Exports

The package exposes four entry points. The main entry re-exports the full public API; the subpaths give narrower surfaces for tooling, lazy-loaded modules, and tests that should not bundle into production builds.

| Subpath | Purpose |
|---------|---------|
| `@pivanov/claude-wire` | Main API: `claude`, `createSession`, `createStream`, `askJson`, errors, types, cost tracking. Use this for app code. |
| `@pivanov/claude-wire/errors` | Error classes only. Useful for catch handlers in parent apps that don't want to pull the client. |
| `@pivanov/claude-wire/parser` | Low-level NDJSON + translator helpers (`parseLine`, `createTranslator`, `extractContent`, `blockFingerprint`, `parseDoubleEncoded`). For protocol-level integrations. |
| `@pivanov/claude-wire/testing` | In-process `IClaudeProcess` mocks (`createMockProcess`, `createMultiTurnMockProcess`). See [Testing](./testing.md). |
| `@pivanov/claude-wire/package.json` | Direct access to the manifest (versions, repository metadata) for tooling. |

## Why Subpaths?

The package has zero runtime dependencies and ships with `"sideEffects": false`, so a tree-shaking bundler already drops unused code from the main entry. The subpaths add two extra guarantees:

1. **API hygiene.** The `exports` map is a whitelist. Code reaching into deep paths like `dist/parser/translator.js` is rejected by Node's resolver, so internal refactors stay safe.
2. **Bundle isolation for testing helpers.** Production code that imports only the main entry never reaches `dist/testing/`, so any future growth of the testing module (mock builders, scripted sequences) stays out of production bundles even if a bundler's tree-shaking is conservative.

## Examples

```ts
// App code: full API.
import { claude, createSession } from "@pivanov/claude-wire";

// Catch handler in a worker that just needs error types.
import { isKnownError, AgentInactivityError } from "@pivanov/claude-wire/errors";

// Custom protocol pipeline reusing the translator.
import { parseLine, createTranslator } from "@pivanov/claude-wire/parser";

// Test file: in-process mock, no real CLI spawn.
import { createMockProcess } from "@pivanov/claude-wire/testing";
```
