# claude-wire

Run [Claude Code](https://claude.ai/download) programmatically from TypeScript.

[![npm](https://img.shields.io/npm/v/@pivanov/claude-wire)](https://www.npmjs.com/package/@pivanov/claude-wire)
[![license](https://img.shields.io/npm/l/@pivanov/claude-wire)](./LICENSE)

```ts
import { claude } from "@pivanov/claude-wire";

const result = await claude.ask("Fix the bug in main.ts", {
  model: "haiku",
  maxCostUsd: 0.50,
});

console.log(result.text);     // "Fixed the undefined variable..."
console.log(result.costUsd);  // 0.0084
```

## Features

- **Simple API** - `claude.ask()` returns a typed result, `claude.stream()` yields events
- **Structured JSON** - `claude.askJson(prompt, schema)` with Standard Schema (Zod/Valibot/ArkType) validation
- **Tool control** - allow, block, or intercept any tool at runtime
- **Multi-turn sessions** - persistent process across multiple prompts
- **Cost tracking** - per-request budgets with auto-abort and projection primitives
- **Typed errors** - rate-limit, overload, context-length, retry-exhausted as `KnownError` codes
- **Fully typed** - discriminated union events, full IntelliSense
- **Resilient** - auto-respawn with backoff, transient error detection, AbortSignal
- **Zero dependencies** - ~22 kB gzipped (bundle), 32 kB npm tarball

## Install

```bash
bun add @pivanov/claude-wire
# or
npm install @pivanov/claude-wire
```

Requires [Claude Code CLI](https://claude.ai/download) installed and authenticated. Runs on [Bun](https://bun.sh) >= 1.0 or Node.js >= 22.

> **Platform:** POSIX only (macOS, Linux, WSL). Native Windows isn't supported yet -- binary resolution relies on `which` and POSIX path conventions.

> This SDK wraps Claude Code's `--output-format stream-json` protocol, which is not officially documented by Anthropic and may change between releases.

## Documentation

Full docs, API reference, and protocol guide at **[pivanov.github.io/claude-wire](https://pivanov.github.io/claude-wire/)**

## Try the Examples

```bash
git clone https://github.com/pivanov/claude-wire
cd claude-wire && bun install
bun run examples
```

Interactive menu with 9 runnable demos covering ask, askJson, streaming, sessions, tool control, cost budgets, abort, system prompts, and session resume.

## Project Structure

```
packages/claude-wire/   the npm package
apps/docs/              VitePress documentation site
apps/examples/          interactive example runner
```

## Development

```bash
bun install
bun run test        # 279 tests
bun run typecheck
bun run lint
bun run docs:dev    # local docs server
bun run examples    # try the examples
```

## Sponsors

Supported by [LogicStar AI](https://logicstar.ai/)

## License

MIT
