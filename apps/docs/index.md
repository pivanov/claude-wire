---
layout: home
hero:
  name: "@pivanov/claude-wire"
  text: Run Claude Code programmatically
  tagline: "Typed SDK for spawning, streaming, and controlling the CLI. \nZero dependencies."
  image:
    light: /hero-code.svg
    dark: /hero-code.svg
    alt: Code example
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: API Reference
      link: /api/client
features:
  - title: Simple API
    details: "claude.ask() returns a typed result. claude.stream() yields events via AsyncIterable. That's it."
  - title: Structured JSON
    details: "claude.askJson(prompt, schema) returns validated, typed data. Zod, Valibot, ArkType via Standard Schema -- or raw JSON Schema."
  - title: Tool Control
    details: "Allow, block, or intercept any tool at runtime. Approve, deny, or mock responses."
  - title: Multi-Turn Sessions
    details: "Keep a process alive across prompts. Conversation context preserved between calls."
  - title: Full Agent Power
    details: "File access, git, shell commands, sub-agents. Everything Claude Code can do, from your code."
  - title: Fully Typed
    details: "Discriminated union events. Typed options and results. Full IntelliSense in your editor."
  - title: CLI Binary
    details: "npx @pivanov/claude-wire ask-json -- schema-validated JSON from the shell. Perfect for CI pipes, one-off extraction, and automation."
    link: /guides/claude-code-skill
    linkText: Learn more
  - title: Claude Code Skill
    details: "Install /ask-json via skills.sh and Claude Code auto-routes structured-output tasks to a cheap haiku sub-agent."
    link: /guides/claude-code-skill
    linkText: Install the skill
  - title: Zero Dependencies
    details: "No runtime deps. Works with Bun and Node.js 22+. Just install and go."
---
