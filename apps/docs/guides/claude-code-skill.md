# Claude Code Skill (`/ask-json`)

`claude-wire` ships with a companion [Claude Code](https://claude.ai/download) skill, [`ask-json`](https://github.com/pivanov/ai-skills/tree/main/skills/ask-json), that teaches the main Claude agent to delegate "give me typed JSON" work to the CLI as a cheap sub-agent.

When the main Claude is about to call `Agent` / `Task` and then regex-parse JSON out of a prose response, the skill redirects it to `npx @pivanov/claude-wire@^0.1.6 ask-json` instead. The call returns schema-validated JSON that main Claude can `JSON.parse` and act on immediately -- no prompt-engineering the output format, no prose parsing.

## Installation

The skill is published to [skills.sh](https://skills.sh) via the [`pivanov/ai-skills`](https://github.com/pivanov/ai-skills) repo.

```bash
npx skills add pivanov/ai-skills --skill ask-json
```

That's it. skills.sh drops a single `SKILL.md` into your Claude Code config. No npm packages are installed -- the skill invokes `claude-wire` through `npx` on demand, and `npx` caches after the first call.

::: tip Heavy use
For tight loops (e.g. running `/ask-json` dozens of times in a sweep), install `claude-wire` globally once to skip the `npx` lookup:

```bash
bun add -g @pivanov/claude-wire
```

The skill auto-detects a global install and uses it when present.
:::

## How main Claude uses it

You don't call the skill directly. Once installed, it auto-activates when main Claude's internal reasoning matches triggers like "classify", "extract structured", "triage", "routing decision", "typed output", "parse to schema", or similar. The skill then runs the CLI for you and threads the validated result back.

Typical triggers:

- "Classify this ticket into `bug | feature | chore`"
- "Extract API endpoints from this controller"
- "Rank these PRs by review urgency, with a score and reason each"
- "Decide whether this should be routed to refund or support"

## Example (what main Claude does under the hood)

When you ask main Claude to "label these issues as `p0 | p1 | p2` with a reason", the skill translates that into:

```bash
cat > /tmp/triage.json <<'EOF'
{
  "type": "object",
  "properties": {
    "ranked": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "priority": { "enum": ["p0", "p1", "p2"] },
          "reason": { "type": "string" }
        },
        "required": ["id", "priority", "reason"]
      }
    }
  },
  "required": ["ranked"]
}
EOF

npx @pivanov/claude-wire@^0.1.6 ask-json \
  --model sonnet \
  --prompt "Triage these incidents: $INCIDENTS" \
  --schema-file /tmp/triage.json
```

stdout is a single JSON line:

```json
{ "data": { "ranked": [...] }, "costUsd": 0.0018, "tokens": { "input": 412, "output": 87 }, "durationMs": 1640 }
```

Main Claude reads `.data` and continues. The `.costUsd` / `.tokens` values are surfaced back to you only when relevant.

## Default model

The skill invokes the CLI with `--model sonnet`. The CLI's own default is `haiku` -- intended for script/CI users who know their workload is stable enough -- but `haiku`'s `--json-schema` compliance is best-effort, and it frequently returns prose on ad-hoc "classify X" prompts. Starting at `sonnet` trades a ~10× cost bump (still cents per call) for reliable schema adherence; main Claude picks up typed data on the first try instead of paying for a haiku flake + a sonnet retry. Opus is almost never the right answer here -- if the task genuinely needs Opus-class reasoning, the skill yields to the native `Agent` tool instead.

Power users running dozens-to-hundreds of near-identical extractions can override with `--model haiku` once they've verified haiku is reliable for their specific schema.

## Version pinning

The skill pins `@pivanov/claude-wire@^0.1.6`, which carries both the symlink-safe CLI entry guard and the JSON-only-output system prompt default that makes `askJson` reliable across model versions. Patches and minors flow through automatically; a future `1.0.0` with a breaking CLI would require a skill update. The CLI surface (flag names, output shape, exit codes) is treated as a stable public contract -- see the [CLI section of the README](https://github.com/pivanov/claude-wire#cli) for the contract.

## Troubleshooting

- **"Spawn failed" / exit code 2**: the Claude Code CLI itself (`claude`) isn't installed or isn't authenticated. Run `claude` once interactively to confirm. `claude-wire` wraps the CLI and cannot work without it.
- **Validation errors / exit code 1**: the model returned JSON that didn't fit the schema. Simplify the schema, escalate to `--model sonnet`, or tighten the prompt.
- **Budget exceeded / exit code 3**: the request hit `--max-budget-usd`. Either raise the budget or shrink the prompt / schema.

## Links

- Skill source: [`pivanov/ai-skills` / `skills/ask-json`](https://github.com/pivanov/ai-skills/tree/main/skills/ask-json)
- CLI contract: [`README.md#cli`](https://github.com/pivanov/claude-wire#cli)
- Skill registry: [skills.sh](https://skills.sh)
