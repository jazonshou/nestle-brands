/* ==========================================================================
   Motion primitives. Exact, frame-rate independent, and retargetable:
   a value can be redirected mid-flight and continues from where it is,
   with the velocity it has.
   ========================================================================== */

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** One step of a critically damped spring with the given halflife (seconds). Holden's closed form. */
export function springStep(x: number, v: number, target: number, halflife: number, dt: number): [number, number] {
  if (halflife <= 0) return [target, 0];
  const y = (4 * Math.LN2) / halflife / 2;
  const j0 = x - target;
  const j1 = v + j0 * y;
  const e = Math.exp(-y * dt);
  return [target + (j0 + j1 * dt) * e, (v - j1 * y * dt) * e];
}

/** One step of an underdamped spring with damping ratio zeta and response period T (seconds), exact. */
export function springStepUD(x: number, v: number, target: number, zeta: number, T: number, dt: number): [number, number] {
  if (zeta >= 1) return springStep(x, v, target, (T * Math.LN2) / (2 * Math.PI) * 2, dt);
  const w0 = (2 * Math.PI) / T;
  const a = zeta * w0;
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const j0 = x - target;
  const c = (v + a * j0) / wd;
  const e = Math.exp(-a * dt);
  const cos = Math.cos(wd * dt);
  const sin = Math.sin(wd * dt);
  const nx = target + e * (j0 * cos + c * sin);
  const nv = e * (-a * (j0 * cos + c * sin) + wd * (-j0 * sin + c * cos));
  return [nx, nv];
}

/** Anything the frame loop can advance. */
export interface Stepper {
  /** Returns true while still moving. */
  step(dt: number, now: number): boolean;
}

/** A flight's progress (0–1, eased) for values that ride along with the camera. */
export interface Progress {
  readonly u: number;
  readonly done: boolean;
}

type Mode =
  | { kind: "rest" }
  | { kind: "spring"; h: number }
  | { kind: "ud"; zeta: number; T: number }
  | { kind: "tween"; from: number; start: number; ms: number; ease: (t: number) => number }
  | { kind: "linked"; flight: Progress; from: number; map: (u: number) => number };

const active = new Set<AnimValue>();
let clock = 0;

/** A single animated scalar. Everything that moves on the map is one of these. */
export class AnimValue {
  x: number;
  v = 0;
  target: number;
  private mode: Mode = { kind: "rest" };
  private delayUntil = 0;
  private pending: (() => void) | null = null;

  constructor(x = 0) {
    this.x = x;
    this.target = x;
  }

  get moving(): boolean {
    return active.has(this);
  }

  /** Jump straight to a value. */
  snap(x: number): this {
    this.x = this.target = x;
    this.v = 0;
    this.mode = { kind: "rest" };
    this.pending = null;
    active.delete(this);
    return this;
  }

  spring(target: number, halflife: number, delayMs = 0): this {
    return this.start(() => {
      this.target = target;
      this.mode = { kind: "spring", h: halflife };
    }, delayMs);
  }

  springUD(target: number, zeta: number, T: number, delayMs = 0): this {
    return this.start(() => {
      this.target = target;
      this.mode = { kind: "ud", zeta, T };
    }, delayMs);
  }

  tween(target: number, ms: number, ease: (t: number) => number = easeInOutCubic, delayMs = 0): this {
    return this.start(() => {
      this.target = target;
      this.v = 0;
      this.mode = { kind: "tween", from: this.x, start: performance.now(), ms, ease };
    }, delayMs);
  }

  /** Follow a flight: value = lerp(current, target, map(u)). Switches to a spring if the flight is interrupted. */
  link(flight: Progress, target: number, map: (u: number) => number = (u) => u): this {
    this.target = target;
    this.pending = null;
    this.mode = { kind: "linked", flight, from: this.x, map };
    active.add(this);
    return this;
  }

  private start(apply: () => void, delayMs: number): this {
    if (delayMs > 0) {
      this.pending = apply;
      this.delayUntil = performance.now() + delayMs;
    } else {
      this.pending = null;
      apply();
    }
    active.add(this);
    return this;
  }

  step(dt: number): boolean {
    if (this.pending) {
      if (clock < this.delayUntil) return true;
      const apply = this.pending;
      this.pending = null;
      apply();
    }
    const m = this.mode;
    switch (m.kind) {
      case "rest":
        return false;
      case "spring":
        [this.x, this.v] = springStep(this.x, this.v, this.target, m.h, dt);
        break;
      case "ud":
        [this.x, this.v] = springStepUD(this.x, this.v, this.target, m.zeta, m.T, dt);
        break;
      case "tween": {
        const t = clamp((clock - m.start) / m.ms, 0, 1);
        this.x = lerp(m.from, this.target, m.ease(t));
        if (t >= 1) return this.settle();
        return true;
      }
      case "linked": {
        if (m.flight.done) {
          // Flight finished or was interrupted: catch up on a short spring from wherever we are.
          this.mode = { kind: "spring", h: 0.08 };
          return true;
        }
        this.x = lerp(m.from, this.target, clamp(m.map(m.flight.u), 0, 1));
        return true;
      }
    }
    if (Math.abs(this.x - this.target) < 1e-4 && Math.abs(this.v) < 1e-3) return this.settle();
    return true;
  }

  private settle(): boolean {
    this.x = this.target;
    this.v = 0;
    this.mode = { kind: "rest" };
    return false;
  }
}

/** Advances every moving AnimValue. Returns true if any is still moving. */
export function stepAll(dt: number, now: number): boolean {
  clock = now;
  for (const a of active) if (!a.step(dt)) active.delete(a);
  return active.size > 0;
}

export function setClock(now: number) {
  clock = now;
}

export const anyAnimating = () => active.size > 0;
