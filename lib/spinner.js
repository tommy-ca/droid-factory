"use strict";

const SPIN_FRAMES = ['/', '-', '\\', '|'];

function start(label) {
  if (!process.stdout.isTTY) return null;
  let frame = 0;
  const timer = setInterval(() => {
    const glyph = SPIN_FRAMES[frame = (frame + 1) % SPIN_FRAMES.length];
    process.stdout.write(`\r${glyph} ${label}`);
  }, 80);
  return timer;
}

function stop(timer) {
  if (!timer) return;
  clearInterval(timer);
  if (process.stdout.isTTY) process.stdout.write('\r');
}

module.exports = { start, stop };
