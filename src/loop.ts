/* ==========================================================================
   The one requestAnimationFrame owner. Handlers record state and call
   invalidate(); a frame runs only when something changed, and the loop stops
   completely when nothing is moving. A "settle" callback fires once motion
   has been quiet for a moment (signposts, full label pass, hover re-check).
   ========================================================================== */

import { MOTION } from "./tokens";

export type FrameFn = (dt: number, now: number) => boolean;

let raf = 0;
let last = 0;
let frameFn: FrameFn = () => false;
let settleFn: () => void = () => {};
let settleTimer = 0;
let frames = 0;
let lastError = 0;
const frameMs: number[] = [];

export function setFrame(fn: FrameFn, onSettle: () => void) {
  frameFn = fn;
  settleFn = onSettle;
}

function frame(now: number) {
  raf = 0;
  const dt = Math.min(now - (last || now - 16.7), 100) / 1000;
  last = now;
  const t0 = performance.now();
  let busy = true;
  try {
    busy = frameFn(dt, now);
  } catch (err) {
    // A bad frame must never stop the map; log (at most once a second) and keep going.
    if (now - lastError > 1000) {
      lastError = now;
      console.error(err);
    }
  } finally {
    frames++;
    frameMs.push(performance.now() - t0);
    if (frameMs.length > 240) frameMs.shift();
    if (busy) invalidate();
    else {
      last = 0;
      clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settleFn, MOTION.settleMs);
    }
  }
}

export function invalidate() {
  if (!raf && document.visibilityState !== "hidden") raf = requestAnimationFrame(frame);
}

export const loopRunning = () => raf !== 0;

/** Test helper: run frames on timers for `ms` (works while the tab is hidden, when rAF is paused). */
export function pump(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const end = performance.now() + ms;
    const tick = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      frame(performance.now());
      if (performance.now() < end) setTimeout(tick, 16);
      else resolve();
    };
    tick();
  });
}

export function frameStats() {
  const sorted = [...frameMs].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  return { frames, p50: q(0.5), p95: q(0.95), max: sorted[sorted.length - 1] ?? 0 };
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  } else invalidate();
});
