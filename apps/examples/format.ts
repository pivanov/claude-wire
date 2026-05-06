const noColor = "NO_COLOR" in process.env;

const wrap = (code: string) => (s: string) => (noColor ? s : `\x1b[${code}m${s}\x1b[0m`);

const dim = wrap("90");
const cyan = wrap("36");
const green = wrap("32");
const yellow = wrap("33");
const bold = wrap("1");

export const label = (key: string, value: string) => {
  console.log(`  ${dim(key.padEnd(10))} ${value}`);
};

export const divider = () => {
  console.log(dim(`  ${"\u2500".repeat(48)}`));
};

export const prompt = (value: string) => {
  console.log(`  ${bold("Prompt:")} ${dim(`"${value}"`)}`);
};

export const answer = (value: string) => {
  console.log(`  ${bold("Answer")} ${value}`);
};

export const result = (key: string, value: string | number | Record<string, unknown>) => {
  const formatted = typeof value === "object" ? JSON.stringify(value) : String(value);
  console.log(`  ${green("\u2714")} ${cyan(key)} ${formatted}`);
};

export const stats = (r: { costUsd: number; tokensIn: number; tokensOut: number; duration: number; sessionId?: string }) => {
  result("Cost", `$${r.costUsd.toFixed(4)}`);
  result("Tokens", `${r.tokensIn} in / ${r.tokensOut} out`);
  result("Duration", `${r.duration}ms`);
  if (r.sessionId) {
    result("Session", r.sessionId);
  }
};

export const info = (msg: string) => {
  console.log(dim(`  ${msg}`));
};

export const warn = (msg: string) => {
  console.log(`  ${yellow("\u26A0")} ${msg}`);
};

export const gap = () => {
  console.log("");
};

export { bold, cyan, dim, green, yellow };
