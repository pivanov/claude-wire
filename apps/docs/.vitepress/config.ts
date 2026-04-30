import { defineConfig } from "vitepress";

export default defineConfig({
  title: "claude-wire",
  description: "TypeScript SDK for Claude Code - spawn, stream, control",
  base: "/claude-wire/",

  head: [["meta", { name: "keywords", content: "claude code, sdk, typescript, streaming, ndjson, anthropic, agent" }]],

  markdown: {
    theme: {
      light: "one-dark-pro",
      dark: "one-dark-pro",
    },
  },

  themeConfig: {
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "API", link: "/api/client" },
      { text: "Protocol", link: "/protocol/overview" },
      { text: "Claude Skill", link: "/guides/claude-code-skill" },
      { text: "npm", link: "https://www.npmjs.com/package/@pivanov/claude-wire" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Why claude-wire", link: "/why" },
          { text: "Getting Started", link: "/getting-started" },
        ],
      },
      {
        text: "API Reference",
        items: [
          { text: "Client", link: "/api/client" },
          { text: "Session", link: "/api/session" },
          { text: "Stream", link: "/api/stream" },
          { text: "Events", link: "/api/events" },
          { text: "JSON (askJson)", link: "/api/json" },
          { text: "Errors", link: "/api/errors" },
          { text: "Subpath Exports", link: "/api/subpaths" },
          { text: "Testing", link: "/api/testing" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Stateless Classifier", link: "/guides/classifier" },
          { text: "Tool Handling", link: "/guides/tool-handling" },
          { text: "Cost Tracking", link: "/guides/cost-tracking" },
          { text: "Examples", link: "/guides/examples" },
        ],
      },
      {
        text: "Integrations",
        items: [{ text: "Claude Code Skill (/ask-json)", link: "/guides/claude-code-skill" }],
      },
      {
        text: "Protocol Reference",
        items: [
          { text: "Overview", link: "/protocol/overview" },
          { text: "Output Events", link: "/protocol/output-events" },
          { text: "Input Messages", link: "/protocol/input-messages" },
          { text: "Gotchas", link: "/protocol/gotchas" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/pivanov/claude-wire" }],

    search: {
      provider: "local",
    },

    footer: {
      message: 'Not affiliated with or endorsed by Anthropic. Supported by <a href="https://logicstar.ai/">LogicStar AI</a>.',
      copyright: "MIT License | Made by Pavel Ivanov",
    },
  },
});
