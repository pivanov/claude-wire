<script setup lang="ts">
import { withBase } from "vitepress";

const year = new Date().getFullYear();
const faviconHref = withBase("/favicon.svg");
</script>

<template>
  <footer class="cw-foot">
    <div class="cw-foot-grid">
      <div class="cw-foot-brand">
        <div class="cw-foot-logo">
          <img :src="faviconHref" alt="" width="32" height="32" />
          <span class="cw-foot-name">claude-wire</span>
        </div>
        <p class="cw-foot-tag">
          Run Claude Code programmatically from TypeScript. Strict JSON, sessions, streaming.
        </p>
        <div class="cw-foot-badges">
          <a
            href="https://www.npmjs.com/package/@pivanov/claude-wire"
            target="_blank"
            rel="noreferrer"
            class="cw-foot-badge"
          >
            <span class="cw-foot-badge-k">npm</span>
            <span class="cw-foot-badge-v">@pivanov/claude-wire</span>
          </a>
          <a
            href="https://github.com/pivanov/claude-wire"
            target="_blank"
            rel="noreferrer"
            class="cw-foot-badge"
          >
            <span class="cw-foot-badge-k">repo</span>
            <span class="cw-foot-badge-v">pivanov/claude-wire</span>
          </a>
        </div>
      </div>

      <div class="cw-foot-col">
        <h4>Docs</h4>
        <ul>
          <li><a href="/claude-wire/why">Why claude-wire</a></li>
          <li><a href="/claude-wire/getting-started">Getting Started</a></li>
          <li><a href="/claude-wire/guides/classifier">Classifier Guide</a></li>
          <li><a href="/claude-wire/guides/cost-tracking">Cost Tracking</a></li>
          <li><a href="/claude-wire/guides/claude-code-skill">Claude Skill</a></li>
        </ul>
      </div>

      <div class="cw-foot-col">
        <h4>API</h4>
        <ul>
          <li><a href="/claude-wire/api/client">Client</a></li>
          <li><a href="/claude-wire/api/session">Session</a></li>
          <li><a href="/claude-wire/api/stream">Stream</a></li>
          <li><a href="/claude-wire/api/json">JSON (askJson)</a></li>
          <li><a href="/claude-wire/protocol/overview">Protocol</a></li>
        </ul>
      </div>

      <div class="cw-foot-col">
        <h4>Community</h4>
        <ul>
          <li><a href="https://github.com/pivanov/claude-wire" target="_blank" rel="noreferrer">GitHub</a></li>
          <li><a href="https://github.com/pivanov/claude-wire/issues" target="_blank" rel="noreferrer">Issues</a></li>
          <li><a href="https://github.com/pivanov/claude-wire/discussions" target="_blank" rel="noreferrer">Discussions</a></li>
          <li><a href="https://www.npmjs.com/package/@pivanov/claude-wire" target="_blank" rel="noreferrer">npm</a></li>
        </ul>
      </div>
    </div>

    <div class="cw-foot-base">
      <div class="cw-foot-meta">
        <span>© {{ year }} claude-wire</span>
        <span class="cw-foot-dot">·</span>
        <span>MIT License</span>
        <span class="cw-foot-dot">·</span>
        <span>
          Made by
          <a href="https://github.com/pivanov" target="_blank" rel="noreferrer">@pivanov</a>
        </span>
        <span class="cw-foot-dot">·</span>
        <span>Not affiliated with or endorsed by Anthropic.</span>
      </div>
      <div class="cw-foot-supported">
        Supported by
        <a href="https://logicstar.ai/" target="_blank" rel="noreferrer">LogicStar AI</a>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.cw-foot {
  margin-top: 64px;
  padding: 40px 0 16px;
  border-top: 1px solid var(--vp-c-divider);
  font-size: 14px;
  color: var(--vp-c-text-2);
}

.cw-foot-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr 1fr;
  gap: 40px;
  align-items: start;
}

@media (max-width: 768px) {
  .cw-foot-grid {
    grid-template-columns: 1fr 1fr;
    gap: 28px;
  }
  .cw-foot-brand {
    grid-column: 1 / -1;
  }
}

@media (max-width: 480px) {
  .cw-foot-grid {
    grid-template-columns: 1fr;
  }
}

.cw-foot-logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cw-foot-logo img {
  display: block;
}

.cw-foot-name {
  font-weight: 700;
  font-size: 16px;
  color: var(--vp-c-text-1);
  letter-spacing: -0.01em;
}

.cw-foot-tag {
  margin: 12px 0 16px;
  max-width: 320px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.cw-foot-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cw-foot-badge {
  display: inline-flex;
  align-items: stretch;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  border-radius: 6px;
  overflow: hidden;
  text-decoration: none;
  border: 1px solid var(--vp-c-divider);
  transition: border-color 0.15s ease;
}

.cw-foot-badge:hover {
  border-color: var(--vp-c-brand-1);
}

.cw-foot-badge-k {
  padding: 3px 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  border-right: 1px solid var(--vp-c-divider);
}

.cw-foot-badge-v {
  padding: 3px 8px;
  color: var(--vp-c-text-1);
}

.cw-foot-col h4 {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vp-c-text-1);
}

.cw-foot-col ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cw-foot-col a {
  color: var(--vp-c-text-2);
  text-decoration: none;
  font-size: 13px;
  transition: color 0.15s ease;
}

.cw-foot-col a:hover {
  color: var(--vp-c-brand-1);
}

.cw-foot-base {
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px solid var(--vp-c-divider);
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.cw-foot-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.cw-foot-dot {
  color: var(--vp-c-text-3);
  opacity: 0.6;
}

.cw-foot-meta a,
.cw-foot-supported a {
  color: var(--vp-c-text-2);
  text-decoration: none;
}

.cw-foot-meta a:hover,
.cw-foot-supported a:hover {
  color: var(--vp-c-brand-1);
}
</style>
