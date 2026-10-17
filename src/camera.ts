import { interpolateZoom } from "d3-interpolate";

/** Screen = graph * k + (x, y). */
export interface Transform {
  x: number;
  y: number;
  k: number;
}

/** A rectangle in screen pixels: the part of the map not covered by the detail panel. */
export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Owns the pan/zoom state and its animations. Knows nothing about the graph. */
export class Camera {
  t: Transform = { x: 0, y: 0, k: 1 };
  private frame = 0;
  private readonly onChange: (t: Transform) => void;

  constructor(onChange: (t: Transform) => void) {
    this.onChange = onChange;
  }

  set(t: Transform): void {
    this.t = { x: t.x, y: t.y, k: clamp(t.k, MIN_ZOOM, MAX_ZOOM) };
    this.onChange(this.t);
  }

  panBy(dx: number, dy: number): void {
    this.set({ ...this.t, x: this.t.x + dx, y: this.t.y + dy });
  }

  /** Zoom to scale `k`, keeping the screen point (sx, sy) fixed under the cursor. */
  zoomTo(k: number, sx: number, sy: number): void {
    const next = clamp(k, MIN_ZOOM, MAX_ZOOM);
    const f = next / this.t.k;
    this.set({ k: next, x: sx - (sx - this.t.x) * f, y: sy - (sy - this.t.y) * f });
  }

  toGraph(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.t.x) / this.t.k, y: (sy - this.t.y) / this.t.k };
  }

  toScreen(gx: number, gy: number): { x: number; y: number } {
    return { x: gx * this.t.k + this.t.x, y: gy * this.t.k + this.t.y };
  }

  /** Smoothly zooms out-then-in (van Wijk & Nuij) so graph point (gx, gy) lands in the middle of `area` at scale `k`. */
  flyTo(gx: number, gy: number, k: number, area: Area): void {
    this.stop();
    const target = clamp(k, MIN_ZOOM, MAX_ZOOM);
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const place = (view: [number, number, number]) => {
      const kk = area.w / view[2];
      this.set({ k: kk, x: cx - view[0] * kk, y: cy - view[1] * kk });
    };

    const here = this.toGraph(cx, cy);
    const zoom = interpolateZoom([here.x, here.y, area.w / this.t.k], [gx, gy, area.w / target]);
    if (reducedMotion.matches) return place(zoom(1));

    const duration = clamp(zoom.duration * 0.8, 350, 1300);
    const start = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - start) / duration);
      place(zoom(easeInOut(u)));
      this.frame = u < 1 ? requestAnimationFrame(step) : 0;
    };
    this.frame = requestAnimationFrame(step);
  }

  /** Animated zoom by `factor` around the centre of `area`. */
  zoomBy(factor: number, area: Area): void {
    const c = this.toGraph(area.x + area.w / 2, area.y + area.h / 2);
    this.flyTo(c.x, c.y, this.t.k * factor, area);
  }

  /** Cancels any running animation (e.g. the user grabbed the map mid-flight). */
  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}
