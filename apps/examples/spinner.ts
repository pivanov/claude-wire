const FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];

export const createSpinner = (initialText: string) => {
  let frame = 0;
  let text = initialText;
  let timer: ReturnType<typeof setInterval> | undefined;

  const start = (newText?: string) => {
    if (newText) {
      text = newText;
    }
    if (timer) {
      return;
    }
    process.stdout.write("\x1b[?25l");
    timer = setInterval(() => {
      const spinner = FRAMES[frame % FRAMES.length];
      process.stdout.write(`\r\x1b[2K  \x1b[36m${spinner}\x1b[0m \x1b[90m${text}\x1b[0m`);
      frame++;
    }, 80);
  };

  const stop = (finalText?: string) => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    process.stdout.write("\r\x1b[2K");
    if (finalText) {
      console.log(`  \x1b[32m\u2714\x1b[0m ${finalText}`);
    }
    process.stdout.write("\x1b[?25h");
  };

  return { start, stop };
};
