# claude-wire

Full-featured, zero-dependency TypeScript SDK for programmatically controlling Claude Code CLI via its `--output-format stream-json` NDJSON protocol.

## Packages

- **[packages/claude-wire](./packages/claude-wire/)** - the npm package
- **[apps/docs](./apps/docs/)** - VitePress documentation site

## Quick Start

```ts
import { claude } from "claude-wire";

const result = await claude.ask("Fix the bug in main.ts", {
  cwd: "/path/to/project",
});

console.log(result.text);
```

## Development

```bash
bun install
bun run test
bun run typecheck
bun run lint
bun run docs:dev
```

## License

MIT
