/**
 * Build script: writes apps/docs/public/hero-code.svg with cycling
 * multi-line code samples covering claude-wire's four primary surfaces:
 * ask, askJson, session, stream.
 *
 * Run: bun apps/docs/scripts/build-hero-code-svg.ts
 *
 * Each variant starts with the import line so a reader landing mid-cycle
 * can still copy a working snippet. Every variant is hand-tuned to
 * VARIANT_LINES so the panel size feels intentional and doesn't shift
 * to fit one outlier; build asserts this so future edits can't drift.
 *
 * One snippet visible per step via SMIL opacity keyframes; step boundary
 * is a discrete cut so stacked tspans don't crossfade and ghost. Cycle
 * period = numSteps * STEP_SEC.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "../public/hero-code.svg");

const W = 680;
const STEP_SEC = 3.5;
const TIMELINE_SAMPLES = 240;
const VARIANT_LINES = 13;

const COL_BG_TOP = "#1e1e2e";
const COL_BG_BOTTOM = "#181825";
const COL_BORDER = "#313244";
const COL_TITLEBAR = "#11111b";
const COL_DOT_RED = "#ff5f57";
const COL_DOT_YEL = "#febc2e";
const COL_DOT_GRN = "#28c840";
const COL_TITLE_FG = "#a6adc8";
const COL_RULE = "#45475a";
const COL_TEXT = "#cdd6f4";
const COL_KEYWORD = "#cba6f7";
const COL_BINDING = "#94e2d5";
const COL_FN = "#89dceb";
const COL_STR = "#a6e3a1";
const COL_COMMENT = "#9399b2";

const MONO = "ui-monospace,SFMono-Regular,Menlo,Monaco,monospace";
const SANS = "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const CODE_X = 24;
const INDENT_2 = 44;
const INDENT_4 = 64;
const TITLE_BAR_HEIGHT = 36;
const TITLE_BASELINE = 22;
const RULE_Y = 36.5;
const CODE_TOP_Y = 68;
const BOTTOM_PAD = 20;
const RADIUS = 14;

interface ITspan {
  readonly text: string;
  readonly fill?: string;
}

interface ICodeLine {
  readonly tspans: readonly ITspan[];
  readonly x?: number;
}

interface IVariant {
  readonly filename: string;
  readonly lines: readonly ICodeLine[];
}

const ln = (...tspans: ITspan[]): ICodeLine => ({ tspans });
const ind2 = (...tspans: ITspan[]): ICodeLine => ({ tspans, x: INDENT_2 });
const ind4 = (...tspans: ITspan[]): ICodeLine => ({ tspans, x: INDENT_4 });
const blank = (): ICodeLine => ({ tspans: [{ text: "" }] });

const importLine: ICodeLine = ln(
  { text: "import", fill: COL_KEYWORD },
  { text: " { " },
  { text: "claude", fill: COL_BINDING },
  { text: " } " },
  { text: "from", fill: COL_KEYWORD },
  { text: " " },
  { text: '"@pivanov/claude-wire"', fill: COL_STR },
  { text: ";" },
);

const importZodLine: ICodeLine = ln(
  { text: "import", fill: COL_KEYWORD },
  { text: " { " },
  { text: "z", fill: COL_BINDING },
  { text: " } " },
  { text: "from", fill: COL_KEYWORD },
  { text: " " },
  { text: '"zod"', fill: COL_STR },
  { text: ";" },
);

const consoleLog = (...rest: readonly ITspan[]): ICodeLine =>
  ln({ text: "console", fill: COL_KEYWORD }, { text: "." }, { text: "log", fill: COL_FN }, { text: "(" }, ...rest, { text: ");" });

const VARIANTS: readonly IVariant[] = [
  {
    filename: "ask.ts",
    lines: [
      importLine,
      blank(),
      ln(
        { text: "const", fill: COL_KEYWORD },
        { text: " result = " },
        { text: "await", fill: COL_KEYWORD },
        { text: " " },
        { text: "claude", fill: COL_BINDING },
        { text: "." },
        { text: "ask", fill: COL_FN },
        { text: "(" },
      ),
      ind2({ text: '"What is 2 + 2?"', fill: COL_STR }, { text: "," }),
      ind2({ text: "{" }),
      ind4({ text: "model: " }, { text: '"haiku"', fill: COL_STR }, { text: "," }),
      ind2({ text: "}" }),
      ln({ text: ");" }),
      blank(),
      consoleLog({ text: "result." }, { text: "text", fill: COL_FN }, { text: ");       " }, { text: '// "4"', fill: COL_COMMENT }),
      consoleLog({ text: "result." }, { text: "costUsd", fill: COL_FN }, { text: ");    " }, { text: "// 0.0012", fill: COL_COMMENT }),
      consoleLog({ text: "result." }, { text: "tokensIn", fill: COL_FN }, { text: ");   " }, { text: "// 42", fill: COL_COMMENT }),
      consoleLog({ text: "result." }, { text: "tokensOut", fill: COL_FN }, { text: ");  " }, { text: "// 8", fill: COL_COMMENT }),
    ],
  },
  {
    filename: "ask-json.ts",
    lines: [
      importLine,
      importZodLine,
      blank(),
      ln(
        { text: "const", fill: COL_KEYWORD },
        { text: " Schema = " },
        { text: "z", fill: COL_BINDING },
        { text: "." },
        { text: "object", fill: COL_FN },
        { text: "({" },
      ),
      ind2({ text: "answer: " }, { text: "z", fill: COL_BINDING }, { text: "." }, { text: "number", fill: COL_FN }, { text: "()," }),
      ln({ text: "});" }),
      blank(),
      ln(
        { text: "const", fill: COL_KEYWORD },
        { text: " { data } = " },
        { text: "await", fill: COL_KEYWORD },
        { text: " " },
        { text: "claude", fill: COL_BINDING },
        { text: "." },
        { text: "askJson", fill: COL_FN },
        { text: "(" },
      ),
      ind2({ text: '"What is 2 + 2? Return JSON."', fill: COL_STR }, { text: "," }),
      ind2({ text: "Schema," }),
      ln({ text: ");" }),
      blank(),
      consoleLog({ text: "data." }, { text: "answer", fill: COL_FN }, { text: ");  " }, { text: "// 4", fill: COL_COMMENT }),
    ],
  },
  {
    filename: "session.ts",
    lines: [
      importLine,
      blank(),
      ln(
        { text: "const", fill: COL_KEYWORD },
        { text: " session = " },
        { text: "claude", fill: COL_BINDING },
        { text: "." },
        { text: "session", fill: COL_FN },
        { text: "(" },
      ),
      ind2({ text: "{" }),
      ind4({ text: "systemPrompt: " }, { text: '"You analyze code."', fill: COL_STR }, { text: "," }),
      ind4({ text: "jsonSchema," }),
      ind2({ text: "}" }),
      ln({ text: ");" }),
      blank(),
      ln(
        { text: "const", fill: COL_KEYWORD },
        { text: " r1 = " },
        { text: "await", fill: COL_KEYWORD },
        { text: " session" },
        { text: "." },
        { text: "askJson", fill: COL_FN },
        { text: "(p1, Schema);" },
      ),
      ln(
        { text: "const", fill: COL_KEYWORD },
        { text: " r2 = " },
        { text: "await", fill: COL_KEYWORD },
        { text: " session" },
        { text: "." },
        { text: "askJson", fill: COL_FN },
        { text: "(p2, Schema);" },
      ),
      blank(),
      ln({ text: "await", fill: COL_KEYWORD }, { text: " session" }, { text: "." }, { text: "close", fill: COL_FN }, { text: "();" }),
    ],
  },
  {
    filename: "stream.ts",
    lines: [
      importLine,
      blank(),
      ln(
        { text: "const", fill: COL_KEYWORD },
        { text: " stream = " },
        { text: "claude", fill: COL_BINDING },
        { text: "." },
        { text: "stream", fill: COL_FN },
        { text: "(" },
      ),
      ind2({ text: '"Refactor src/auth.ts"', fill: COL_STR }, { text: "," }),
      ind2({ text: "{" }),
      ind4({ text: "model: " }, { text: '"sonnet"', fill: COL_STR }, { text: "," }),
      ind2({ text: "}" }),
      ln({ text: ");" }),
      blank(),
      ln(
        { text: "for", fill: COL_KEYWORD },
        { text: " " },
        { text: "await", fill: COL_KEYWORD },
        { text: " (" },
        { text: "const", fill: COL_KEYWORD },
        { text: " ev " },
        { text: "of", fill: COL_KEYWORD },
        { text: " stream" },
        { text: "." },
        { text: "events", fill: COL_FN },
        { text: "()) {" },
      ),
      ind2({ text: "if", fill: COL_KEYWORD }, { text: " (ev.type === " }, { text: '"text"', fill: COL_STR }, { text: ") write(ev.content);" }),
      ln({ text: "}" }),
      ln(
        { text: "const", fill: COL_KEYWORD },
        { text: " final = " },
        { text: "await", fill: COL_KEYWORD },
        { text: " stream" },
        { text: "." },
        { text: "result", fill: COL_FN },
        { text: "();" },
      ),
    ],
  },
];

for (const v of VARIANTS) {
  if (v.lines.length !== VARIANT_LINES) {
    throw new Error(`variant ${v.filename} has ${v.lines.length} lines, expected ${VARIANT_LINES}`);
  }
}

const NUM_STEPS = VARIANTS.length;
const H = CODE_TOP_Y + (VARIANT_LINES - 1) * LINE_HEIGHT + BOTTOM_PAD;
const CYCLE_DUR = NUM_STEPS * STEP_SEC;

const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const stepOpacity = (u: number, slot: number, n: number): number => {
  const slice = 1 / n;
  const uSafe = Math.min(1 - 1e-12, Math.max(0, u));
  const i = Math.min(n - 1, Math.floor(uSafe / slice + 1e-12));
  return slot === i ? 1 : 0;
};

const compressKeyframes = (samples: readonly number[]): { values: string; keyTimes: string } => {
  const lastIdx = samples.length - 1;
  const ktOut: number[] = [];
  const valOut: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const v = Math.round((samples[i] ?? 0) * 1000) / 1000;
    const t = lastIdx === 0 ? 1 : i / lastIdx;
    if (i === 0 || i === lastIdx || valOut[valOut.length - 1] !== v) {
      ktOut.push(t);
      valOut.push(v);
    }
  }
  return {
    values: valOut.join(";"),
    keyTimes: ktOut.map((x) => x.toFixed(5)).join(";"),
  };
};

const buildOpacityAnimate = (slot: number, n: number, durSec: number): string => {
  const samples: number[] = [];
  for (let i = 0; i <= TIMELINE_SAMPLES; i++) {
    samples.push(stepOpacity(i / TIMELINE_SAMPLES, slot, n));
  }
  const { values, keyTimes } = compressKeyframes(samples);
  return `<animate attributeName="opacity" dur="${durSec.toFixed(2)}s" repeatCount="indefinite" calcMode="discrete" values="${values}" keyTimes="${keyTimes}"/>`;
};

const renderTspan = (t: ITspan): string => {
  const fillAttr = t.fill ? ` fill="${t.fill}"` : "";
  return `<tspan${fillAttr}>${escapeXml(t.text)}</tspan>`;
};

const renderLine = (line: ICodeLine, lineIdx: number): string => {
  const x = line.x ?? CODE_X;
  const y = CODE_TOP_Y + lineIdx * LINE_HEIGHT;
  const inner = line.tspans.map(renderTspan).join("");
  return `      <tspan x="${x}" y="${y}">${inner}</tspan>`;
};

const renderVariant = (variant: IVariant, slot: number): string => {
  const anim = buildOpacityAnimate(slot, NUM_STEPS, CYCLE_DUR);
  const lines = variant.lines.map(renderLine).join("\n");
  const initialOpacity = slot === 0 ? "1" : "0";
  const titleText = `claude-wire ~ ${variant.filename}`;
  return [
    `  <g opacity="${initialOpacity}">`,
    `    ${anim}`,
    `    <text x="${W / 2}" y="${TITLE_BASELINE}" font-family="${SANS}" font-size="11.5" font-weight="600" fill="${COL_TITLE_FG}" text-anchor="middle">${escapeXml(titleText)}</text>`,
    `    <text x="${W - 26}" y="${TITLE_BASELINE}" font-family="${SANS}" font-size="11.5" font-weight="600" fill="${COL_TITLE_FG}" text-anchor="end">ts</text>`,
    `    <text font-family="${MONO}" font-size="${FONT_SIZE}" fill="${COL_TEXT}">`,
    lines,
    `    </text>`,
    `  </g>`,
  ].join("\n");
};

const variantGroups = VARIANTS.map((v, i) => renderVariant(v, i)).join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${COL_BG_TOP}"/>
      <stop offset="1" stop-color="${COL_BG_BOTTOM}"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" rx="${RADIUS}" fill="url(#bg)" stroke="${COL_BORDER}" stroke-width="1"/>

  <rect width="${W}" height="${TITLE_BAR_HEIGHT}" rx="${RADIUS}" fill="${COL_TITLEBAR}"/>
  <rect y="${RADIUS + 8}" width="${W}" height="${TITLE_BAR_HEIGHT - RADIUS - 8}" fill="${COL_TITLEBAR}"/>
  <circle cx="20" cy="18" r="6" fill="${COL_DOT_RED}"/>
  <circle cx="40" cy="18" r="6" fill="${COL_DOT_YEL}"/>
  <circle cx="60" cy="18" r="6" fill="${COL_DOT_GRN}"/>

  <line x1="0" y1="${RULE_Y}" x2="${W}" y2="${RULE_Y}" stroke="${COL_RULE}" stroke-width="1"/>

${variantGroups}
</svg>
`;

writeFileSync(OUT_PATH, svg);
console.log(`hero-code.svg written: ${NUM_STEPS} variants × ${VARIANT_LINES} lines, ${W}x${H}, cycle ${CYCLE_DUR}s`);
