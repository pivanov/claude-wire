import { defineConfig, type HeadConfig } from "vitepress";

const SITE_URL = "https://pivanov.github.io/claude-wire";
const OG_IMAGE = `${SITE_URL}/og.png`;
const SITE_TITLE = "claude-wire";
const SITE_DESCRIPTION = "Run Claude Code programmatically from TypeScript. Strict JSON, sessions, streaming.";

export default defineConfig({
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  base: "/claude-wire/",

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/claude-wire/favicon.svg" }],
    ["link", { rel: "apple-touch-icon", href: "/claude-wire/favicon.svg" }],
    ["link", { rel: "mask-icon", href: "/claude-wire/favicon.svg", color: "#a855f7" }],
    ["meta", { name: "theme-color", content: "#181825" }],
    [
      "meta",
      {
        name: "keywords",
        content: "claude code, sdk, typescript, streaming, ndjson, anthropic, agent",
      },
    ],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: SITE_TITLE }],
    ["meta", { property: "og:description", content: SITE_DESCRIPTION }],
    ["meta", { property: "og:image", content: OG_IMAGE }],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", { property: "og:url", content: SITE_URL }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:title", content: SITE_TITLE }],
    ["meta", { name: "twitter:description", content: SITE_DESCRIPTION }],
    ["meta", { name: "twitter:image", content: OG_IMAGE }],
  ],

  transformPageData(pageData) {
    const title = pageData.title ? `${pageData.title} · ${SITE_TITLE}` : SITE_TITLE;
    const description = pageData.description || SITE_DESCRIPTION;
    pageData.frontmatter.head ??= [] as HeadConfig[];
    (pageData.frontmatter.head as HeadConfig[]).push(
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: description }],
    );
  },

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
  },
});
