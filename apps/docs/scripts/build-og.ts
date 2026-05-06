/**
 * Build script: generates apps/docs/public/og.png (1200x630).
 * Run: bun apps/docs/scripts/build-og.ts (or `bun og:build` from apps/docs).
 *
 * OG previews render at thumbnail size in social feeds, so contrast is
 * non-negotiable. Every text element must read at 240px wide.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "../public/og.png");

const W = 1200;
const H = 630;

const SITE_HOST = "pivanov.github.io/claude-wire";

const HEART_PATH =
  "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z";

const FOOTER_X = 80;
const FOOTER_Y = H - 72;
const FOOTER_HEART_SCALE = 1.95;
const FOOTER_HEART_PIVOT_X = 21;
const FOOTER_LABEL_X = 54;
const FOOTER_LABEL_SIZE = 30;

const INNER_X = 32;
const INNER_Y = 32;
const INNER_W = W - 64;
const INNER_H = H - 64;

const COLOR_WORDMARK = "#ffffff";
const COLOR_EYEBROW = "#a5b4fc";
const COLOR_TAGLINE = "#e0e7ff";
const COLOR_SUBTAGLINE = "#c7d2fe";
const COLOR_API_FN = "#f0abfc";
const COLOR_API_DOT = "#94a3b8";
const COLOR_FOOTER_LABEL = "#e2e8f0";
const COLOR_HEART = "#f43f5e";

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";

const API_FNS = ["claude.ask", "claude.askJson", "claude.session", "claude.stream"] as const;
const API_LINE_Y = 470;
const API_LINE_X = 80;
const API_FONT_SIZE = 28;

const apiXml = (() => {
  const sep = "  ·  ";
  let out = `<text x="${API_LINE_X}" y="${API_LINE_Y}" font-family="${MONO}" font-size="${API_FONT_SIZE}" font-weight="500">`;
  API_FNS.forEach((fn, i) => {
    if (i > 0) {
      out += `<tspan fill="${COLOR_API_DOT}">${sep}</tspan>`;
    }
    out += `<tspan fill="${COLOR_API_FN}">${fn}</tspan>`;
  });
  out += `</text>`;
  return out;
})();

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bgBase" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0" stop-color="#020108"/>
      <stop offset="0.42" stop-color="#0d0a22"/>
      <stop offset="1" stop-color="#040217"/>
    </linearGradient>
    <radialGradient id="bgWashTL" cx="22%" cy="18%" r="58%">
      <stop offset="0" stop-color="#6366f1" stop-opacity="0.55"/>
      <stop offset="0.42" stop-color="#6366f1" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#6366f1" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bgWashBR" cx="88%" cy="82%" r="52%">
      <stop offset="0" stop-color="#d946ef" stop-opacity="0.34"/>
      <stop offset="0.52" stop-color="#c084fc" stop-opacity="0.1"/>
      <stop offset="1" stop-color="#c084fc" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bgVignette" cx="50%" cy="46%" r="74%">
      <stop offset="0.52" stop-color="#020617" stop-opacity="0"/>
      <stop offset="1" stop-color="#020617" stop-opacity="0.78"/>
    </radialGradient>

    <linearGradient id="frameStroke" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0" stop-color="#a78bfa"/>
      <stop offset="0.28" stop-color="#6366f1"/>
      <stop offset="0.62" stop-color="#7c3aed"/>
      <stop offset="1" stop-color="#d946ef"/>
    </linearGradient>

    <filter id="frameGlow" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="6"/>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bgBase)"/>
  <rect width="${W}" height="${H}" fill="url(#bgWashTL)"/>
  <rect width="${W}" height="${H}" fill="url(#bgWashBR)"/>
  <rect width="${W}" height="${H}" fill="url(#bgVignette)"/>

  <rect
    x="${INNER_X}"
    y="${INNER_Y}"
    width="${INNER_W}"
    height="${INNER_H}"
    rx="22"
    fill="none"
    stroke="url(#frameStroke)"
    stroke-width="6"
    stroke-opacity="0.35"
    filter="url(#frameGlow)"
  />

  <rect
    x="${INNER_X}"
    y="${INNER_Y}"
    width="${INNER_W}"
    height="${INNER_H}"
    rx="22"
    fill="none"
    stroke="url(#frameStroke)"
    stroke-width="2.25"
  />

  <text
    x="80"
    y="135"
    font-family="${SANS}"
    font-size="34"
    font-weight="600"
    letter-spacing="0.02em"
    fill="${COLOR_EYEBROW}"
  >${SITE_HOST}</text>

  <text
    x="80"
    y="265"
    font-family="${SANS}"
    font-size="96"
    font-weight="800"
    letter-spacing="-4"
    fill="${COLOR_WORDMARK}"
  >@pivanov/claude-wire</text>

  <text
    x="80"
    y="345"
    font-family="${SANS}"
    font-size="38"
    font-weight="500"
    fill="${COLOR_TAGLINE}"
    letter-spacing="0"
  >Run Claude Code programmatically from TypeScript.</text>

  <text
    x="80"
    y="400"
    font-family="${SANS}"
    font-size="30"
    font-weight="500"
    fill="${COLOR_SUBTAGLINE}"
    letter-spacing="0"
  >Strict JSON. Sessions. Streaming.</text>

  ${apiXml}

  <g transform="translate(${FOOTER_X}, ${FOOTER_Y})">
    <g transform="translate(${FOOTER_HEART_PIVOT_X}, 0) scale(${FOOTER_HEART_SCALE}) translate(-12, -12)">
      <path fill="${COLOR_HEART}" d="${HEART_PATH}"/>
    </g>
    <text
      x="${FOOTER_LABEL_X}"
      y="0"
      dominant-baseline="middle"
      font-family="${SANS}"
      font-size="${FOOTER_LABEL_SIZE}"
      font-weight="600"
      fill="${COLOR_FOOTER_LABEL}"
      letter-spacing="0.5"
    >Supported by LogicStar AI</text>
  </g>
</svg>`;

const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: W },
});

const pngRaw = resvg.render().asPng();
const pngBuffer = await sharp(Buffer.from(pngRaw)).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();

writeFileSync(OUT_PATH, pngBuffer);
console.log(`OG image written to ${OUT_PATH} (${pngBuffer.byteLength} bytes)`);
