/* ==========================================================================
   The camera: screen = world·k + (x, y).
   Modes: direct 1:1 input, eased mouse-wheel pan, spring zoom, inertial
   glide, spring moves, and van Wijk flights with progress marks. Every
   mode can be interrupted; velocity carries over as a short decaying offset.
   ========================================================================== */

import { interpolateZoom } from "d3-interpolate";
import { clamp, easeInOutCubic, easeOutCubic, springStep, type Progress } from "./anim";
import type { Area } from "./geometry";
import type { Rect } from "./layout";
import { MOTION } from "./tokens";

export interface View {
  x: number;
  y: number;
  k: number;
}

export interface Bounds {
  /** World rectangle that must stay partly visible. */
  rect: Rect;
  free: Area;
  minK: number;
  maxK: number;
  /** Zooming out past minK is allowed (with resistance) and can trigger an exit. */
  exitable: boolean;
}

interface Mark {
  u: number;
  fn: () => void;
  fired: boolean;
}

class FlightProgress implements Progress {
  u = 0;
  done = false;
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export class Camera {
  view: View = { x: 0, y: 0, k: 1 };
  bounds: Bounds | null = null;
  /** True while the user is panning/zooming directly (labels update less often). */
  userMoving = false;
  onExitGesture: () => void = () => {};
  onOvershoot: (amount: number) => void = () => {};
  /**
   * The user's scroll, pinch, key or button interrupted a navigation move and the camera has come to rest.
   * Returns true if it handled that (e.g. by re-fitting because the destination ended up off screen).
   */
  onInterruptSettled: () => boolean = () => false;
  /** Where the current destination (open brand, focused category) is on screen, to zoom around. */
  focusPoint: () => { x: number; y: number } | null = () => null;
  /** A navigation move was interrupted by input that isn't a grab (see onInterruptSettled). */
  private interrupted = false;
  /** Net zoom (ln k) the user applied since the last interruption: a deliberate zoom-in is kept. */
  userZoomLn = 0;

  private flight: {
    interp: ReturnType<typeof interpolateZoom>;
    area: Area;
    start: number;
    ms: number;
    ease: (t: number) => number;
    marks: Mark[];
    progress: FlightProgress;
  } | null = null;
  private vspring: { cx: number; cy: number; lw: number; vcx: number; vcy: number; vlw: number; tcx: number; tcy: number; tlw: number; area: Area } | null = null;
  private zspring: { lk: number; v: number; target: number; wx: number; wy: number; sx: number; sy: number } | null = null;
  private wheelPan = { x: 0, y: 0 };
  private glide: { vx: number; vy: number; t0: number; sx: number; sy: number } | null = null;
  /** Momentum left by an interrupted move: world units/s of the point under the free-area centre, and ln k/s. */
  private decay = { vx: 0, vy: 0, vlk: 0 };
  private lastView: View = { x: 0, y: 0, k: 1 };
  private velocity = { vx: 0, vy: 0, vlk: 0 };
  private overshoot = 0;
  /** Unresisted ln k while the user pulls past the minimum zoom. */
  private virtualLk: number | null = null;
  /** The rubber band is measured from where this gesture began (never from a destination the camera hasn't reached). */
  private gestureFloorLk: number | null = null;
  /** When a mouse-wheel zoom-out last hit the minimum (a second hit soon after leaves the level). */
  private floorHitAt = 0;

  get flying(): boolean {
    return !!this.flight;
  }

  /** A flight or spring move started by navigation (not by the user). */
  get programmatic(): boolean {
    return !!(this.flight || this.vspring);
  }

  /** The zoom the camera is heading to (the end of the current move, or the current zoom). */
  get targetK(): number {
    if (this.vspring) return this.vspring.area.w / Math.exp(this.vspring.tlw);
    if (this.flight) {
      const [, , w] = this.flight.interp(1);
      return this.flight.area.w / w;
    }
    if (this.zspring) return Math.exp(this.zspring.target);
    return this.view.k;
  }

  get moving(): boolean {
    return !!(this.flight || this.vspring || this.zspring || this.glide || this.wheelPan.x || this.wheelPan.y || this.decay.vx || this.decay.vy || this.decay.vlk);
  }

  toScreen(wx: number, wy: number) {
    return { x: wx * this.view.k + this.view.x, y: wy * this.view.k + this.view.y };
  }

  toWorld(sx: number, sy: number) {
    return { x: (sx - this.view.x) / this.view.k, y: (sy - this.view.y) / this.view.k };
  }

  /** Jump straight to a fit (deep links, resize). */
  setFit(cx: number, cy: number, k: number, area: Area) {
    this.dropFlight(false);
    this.stop();
    this.interrupted = false;
    this.view = { k, x: area.x + area.w / 2 - cx * k, y: area.y + area.h / 2 - cy * k };
  }

  /** Hard stop: the user grabbed the map (which also cancels any pending recovery: a grab is never undone). */
  stop() {
    this.interrupted = false;
    this.dropFlight(true);
    this.vspring = null;
    this.zspring = null;
    this.glide = null;
    this.wheelPan = { x: 0, y: 0 };
    this.decay = { vx: 0, vy: 0, vlk: 0 };
  }

  /**
   * Ends the current flight. When the user interrupts it, its unfired marks run now
   * (e.g. a brand's products still fan out even if the user grabbed the map mid-flight).
   */
  private dropFlight(fireMarks: boolean) {
    const f = this.flight;
    if (!f) return;
    this.flight = null;
    f.progress.done = true;
    if (fireMarks) {
      for (const m of f.marks) {
        if (!m.fired) {
          m.fired = true;
          m.fn();
        }
      }
    }
  }

  /** Programmatic motion is interrupted by user input: keep the current velocity as a short decaying offset. */
  private interrupt() {
    if (this.flight || this.vspring) {
      this.dropFlight(true);
      this.vspring = null;
      if (!reducedMotion.matches) this.decay = { ...this.velocity };
      this.resetGesture();
      this.interrupted = true;
      this.userZoomLn = 0;
    }
    this.glide = null;
  }

  /** Forget any zoom-out pull in progress (a new navigation makes it meaningless). */
  resetGesture() {
    this.overshoot = 0;
    this.virtualLk = null;
    this.gestureFloorLk = null;
    this.onOvershoot(0);
  }

  // --- Direct user input -----------------------------------------------------

  panBy(dx: number, dy: number) {
    this.interrupt();
    this.zspring = null;
    this.view.x += dx;
    this.view.y += dy;
    this.clampPan();
  }

  /** Immediate zoom around a screen point (trackpad pinch, touch pinch, Safari gestures). */
  zoomAt(lnDelta: number, sx: number, sy: number) {
    this.interrupt();
    this.decay.vlk = 0;
    this.userZoomLn += lnDelta;
    this.zspring = null;
    this.applyZoom(lnDelta, sx, sy, true);
  }

  /**
   * Spring zoom toward a target around a screen point (mouse ⌘-wheel, buttons, keys, double-click).
   * A zoom-out that's already at the minimum leaves the level, like pulling out past it with a pinch:
   * at once for keys and buttons (`exit: "now"`), on the second notch in a row for a mouse wheel.
   */
  zoomSpring(lnDelta: number, sx: number, sy: number, exit: "now" | "repeat" | "never" = "never") {
    // Mid-flight (or while a cut-short move is still settling) the zoom never leaves the level: it's an adjustment.
    const settled = !this.programmatic && !this.interrupted;
    this.interrupt();
    this.decay.vlk = 0;
    this.userZoomLn += lnDelta;
    const base = this.zspring ? this.zspring.target : Math.log(this.view.k);
    const b = this.bounds;
    if (lnDelta < 0 && b?.exitable && exit !== "never" && settled && base <= Math.log(b.minK) + 1e-3) {
      const now = performance.now();
      if (exit === "now" || now - this.floorHitAt < 700) {
        this.floorHitAt = 0;
        this.onExitGesture();
        return;
      }
      this.floorHitAt = now;
    }
    const w = this.toWorld(sx, sy);
    const lk = Math.log(this.view.k);
    this.zspring = { lk, v: this.zspring?.v ?? 0, target: this.clampLnK(base + lnDelta), wx: w.x, wy: w.y, sx, sy };
  }

  /** Eased pan for notched mouse wheels. */
  wheelPanBy(dx: number, dy: number) {
    this.interrupt();
    this.wheelPan.x += dx;
    this.wheelPan.y += dy;
  }

  glideFrom(vx: number, vy: number) {
    if (reducedMotion.matches) return;
    const speed = Math.hypot(vx, vy);
    if (speed < MOTION.glideMinSpeed) return;
    const s = Math.min(1, MOTION.glideMaxSpeed / speed);
    this.glide = { vx: vx * s, vy: vy * s, t0: performance.now(), sx: 0, sy: 0 };
  }

  /** Called when a wheel/pinch/drag gesture ends: decides the zoom-out exit or springs back from the overshoot. */
  gestureEnd() {
    this.userMoving = false;
    this.gestureFloorLk = null;
    // Navigation owns the camera while it flies; a stale gesture end must not exit or spring.
    if (this.flight || this.vspring) {
      this.resetGesture();
      return;
    }
    if (this.overshoot >= 0.2 && this.bounds?.exitable) {
      this.resetGesture();
      this.onExitGesture();
      return;
    }
    this.virtualLk = null;
    // Below the minimum after a rubber band: spring back. (After an interrupted flight, the
    // settle check in step() decides instead, since the destination may be off screen.)
    if (!this.interrupted) this.springToMinK();
    this.overshoot = 0;
    this.onOvershoot(0);
  }

  private springToMinK() {
    if (!this.bounds || this.view.k >= this.bounds.minK * 0.999) return;
    const a = this.bounds.free;
    const p = this.focusPoint() ?? { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const x = clamp(p.x, a.x, a.x + a.w);
    const y = clamp(p.y, a.y, a.y + a.h);
    this.zspring = { lk: Math.log(this.view.k), v: 0, target: Math.log(this.bounds.minK), ...this.anchorAt(x, y) };
  }

  // --- Programmatic motion ---------------------------------------------------

  /** Van Wijk flight to a fit. Returns progress that linked animations follow. */
  flyTo(cx: number, cy: number, k: number, area: Area, opts: { delayMs?: number; marks?: { u: number; fn: () => void }[] } = {}): Progress {
    const progress = new FlightProgress();
    const wasFlying = this.flight && this.flight.progress.u < 0.85;
    this.dropFlight(false);
    this.interrupted = false;
    this.vspring = null;
    this.zspring = null;
    this.glide = null;
    const ax = area.x + area.w / 2;
    const ay = area.y + area.h / 2;
    const k0 = this.view.k;
    const p0: [number, number, number] = [(ax - this.view.x) / k0, (ay - this.view.y) / k0, area.w / k0];
    const p1: [number, number, number] = [cx, cy, area.w / k];
    // d3-interpolate has .rho() at runtime; its type definitions don't declare it.
    const zoom = interpolateZoom as unknown as { rho(r: number): typeof interpolateZoom };
    const interp = zoom.rho(MOTION.flightRho)(p0, p1);
    const ms = reducedMotion.matches ? 0 : clamp(interp.duration * 0.6, MOTION.flightMinMs, MOTION.flightMaxMs);
    this.flight = {
      interp,
      area,
      start: performance.now() + (opts.delayMs ?? 0),
      ms,
      ease: wasFlying ? easeOutCubic : easeInOutCubic,
      marks: (opts.marks ?? []).map((m) => ({ ...m, fired: false })),
      progress,
    };
    this.decay = { vx: 0, vy: 0, vlk: 0 };
    return progress;
  }

  /** Short spring move to a fit (small changes: brand open, refit). */
  springTo(cx: number, cy: number, k: number, area: Area) {
    this.dropFlight(false);
    this.interrupted = false;
    this.zspring = null;
    this.glide = null;
    const ax = area.x + area.w / 2;
    const ay = area.y + area.h / 2;
    const k0 = this.view.k;
    const prev = this.vspring;
    this.vspring = {
      cx: (ax - this.view.x) / k0,
      cy: (ay - this.view.y) / k0,
      lw: Math.log(area.w / k0),
      vcx: prev?.vcx ?? 0,
      vcy: prev?.vcy ?? 0,
      vlw: prev?.vlw ?? 0,
      tcx: cx,
      tcy: cy,
      tlw: Math.log(area.w / k),
      area,
    };
    if (reducedMotion.matches) {
      this.view = { k, x: ax - cx * k, y: ay - cy * k };
      this.vspring = null;
    }
  }

  // --- Per frame -------------------------------------------------------------

  step(dt: number, now: number): boolean {
    const before = { ...this.view };

    if (this.flight) {
      const f = this.flight;
      const t = f.ms ? clamp((now - f.start) / f.ms, 0, 1) : 1;
      const u = f.ease(t);
      f.progress.u = u;
      const [cx, cy, w] = f.interp(u);
      const k = f.area.w / w;
      this.view = { k, x: f.area.x + f.area.w / 2 - cx * k, y: f.area.y + f.area.h / 2 - cy * k };
      for (const m of f.marks) {
        if (!m.fired && u >= m.u) {
          m.fired = true;
          m.fn();
        }
      }
      if (t >= 1) {
        f.progress.u = 1;
        f.progress.done = true;
        this.flight = null;
      }
    }

    if (this.vspring) {
      const s = this.vspring;
      const h = MOTION.cameraH;
      [s.cx, s.vcx] = springStep(s.cx, s.vcx, s.tcx, h, dt);
      [s.cy, s.vcy] = springStep(s.cy, s.vcy, s.tcy, h, dt);
      [s.lw, s.vlw] = springStep(s.lw, s.vlw, s.tlw, h, dt);
      const k = s.area.w / Math.exp(s.lw);
      this.view = { k, x: s.area.x + s.area.w / 2 - s.cx * k, y: s.area.y + s.area.h / 2 - s.cy * k };
      if (Math.abs(s.cx - s.tcx) < 0.05 && Math.abs(s.cy - s.tcy) < 0.05 && Math.abs(s.lw - s.tlw) < 1e-4) {
        const kk = s.area.w / Math.exp(s.tlw);
        this.view = { k: kk, x: s.area.x + s.area.w / 2 - s.tcx * kk, y: s.area.y + s.area.h / 2 - s.tcy * kk };
        this.vspring = null;
      }
      this.clampPan();
    }

    if (this.zspring) {
      const z = this.zspring;
      [z.lk, z.v] = springStep(z.lk, z.v, z.target, MOTION.wheelZoomH, dt);
      const k = Math.exp(z.lk);
      this.view = { k, x: z.sx - z.wx * k, y: z.sy - z.wy * k };
      if (Math.abs(z.lk - z.target) < 1e-4) {
        this.zspring = null;
      }
      this.clampPan();
    }

    if (this.wheelPan.x || this.wheelPan.y) {
      const f = 1 - Math.exp(-(dt * 1000) / MOTION.wheelPanTauMs);
      let dx = this.wheelPan.x * f;
      let dy = this.wheelPan.y * f;
      if (Math.abs(this.wheelPan.x) < 0.3) dx = this.wheelPan.x;
      if (Math.abs(this.wheelPan.y) < 0.3) dy = this.wheelPan.y;
      this.wheelPan.x -= dx;
      this.wheelPan.y -= dy;
      this.view.x += dx;
      this.view.y += dy;
      this.clampPan();
    }

    if (this.glide) {
      const g = this.glide;
      const t = now - g.t0;
      const tau = MOTION.glideTauMs;
      const ox = g.vx * tau * (1 - Math.exp(-t / tau));
      const oy = g.vy * tau * (1 - Math.exp(-t / tau));
      const stepX = ox - g.sx;
      const stepY = oy - g.sy;
      g.sx = ox;
      g.sy = oy;
      this.view.x += stepX;
      this.view.y += stepY;
      this.clampPan();
      if (Math.hypot(stepX, stepY) < 0.3 && t > 32) this.glide = null;
    }

    if (this.decay.vx || this.decay.vy || this.decay.vlk) {
      const d = this.decay;
      const { x: ax, y: ay } = this.anchor();
      const c = this.toWorld(ax, ay);
      if (d.vlk) this.applyZoom(d.vlk * dt, ax, ay, false);
      const k = this.view.k;
      const cx = c.x + d.vx * dt;
      const cy = c.y + d.vy * dt;
      this.view.x = ax - cx * k;
      this.view.y = ay - cy * k;
      const e = Math.exp(-(dt * 1000) / 120);
      d.vx *= e;
      d.vy *= e;
      d.vlk *= e;
      if (Math.abs(d.vx) * k < 5 && Math.abs(d.vy) * k < 5 && Math.abs(d.vlk) < 0.01) this.decay = { vx: 0, vy: 0, vlk: 0 };
      this.clampPan();
    }

    if (dt > 0) {
      const { x: ax, y: ay } = this.anchor();
      const c0x = (ax - before.x) / before.k;
      const c0y = (ay - before.y) / before.k;
      const c1 = this.toWorld(ax, ay);
      this.velocity = {
        vx: (c1.x - c0x) / dt,
        vy: (c1.y - c0y) / dt,
        vlk: (Math.log(this.view.k) - Math.log(before.k)) / dt,
      };
    }
    const changed = this.view.x !== this.lastView.x || this.view.y !== this.lastView.y || this.view.k !== this.lastView.k;
    this.lastView = { ...this.view };
    if (this.interrupted && !this.moving && !this.userMoving) {
      this.interrupted = false;
      if (!this.onInterruptSettled()) this.springToMinK();
    }
    return this.moving || changed;
  }

  // --- Bounds -------------------------------------------------------------------

  /** The screen point momentum and default zooms are measured around: the free area's centre. */
  private anchor() {
    const a = this.bounds?.free;
    return a ? { x: a.x + a.w / 2, y: a.y + a.h / 2 } : { x: 0, y: 0 };
  }

  private anchorAt(sx: number, sy: number) {
    const w = this.toWorld(sx, sy);
    return { wx: w.x, wy: w.y, sx, sy };
  }

  private clampLnK(lk: number): number {
    const b = this.bounds;
    if (!b) return lk;
    return clamp(lk, Math.log(Math.min(b.minK, this.view.k)), Math.log(b.maxK));
  }

  /**
   * Zoom by lnDelta around a screen point. A user zoom-out past the minimum is rubber-banded
   * (resistance 0.35) and reported as overshoot, measured from the gesture's starting floor;
   * zoom-ins and carried-over momentum apply 1:1.
   */
  private applyZoom(lnDelta: number, sx: number, sy: number, user: boolean) {
    const b = this.bounds;
    const lk = Math.log(this.view.k);
    let target = lk + lnDelta;
    if (b) {
      const lo = Math.log(b.minK);
      const hi = Math.log(b.maxK);
      if (user && this.gestureFloorLk === null) this.gestureFloorLk = Math.min(lo, lk);
      const floor = user ? this.gestureFloorLk! : Math.min(lo, lk);
      if (lnDelta > 0 || !user) {
        // Zooming in (or momentum): 1:1, and any pull-out is released.
        this.virtualLk = null;
        target = Math.min(hi, Math.max(floor, lk + lnDelta));
        this.overshoot = 0;
      } else {
        const want = (this.virtualLk ?? lk) + lnDelta;
        if (want >= floor) {
          target = want;
          this.virtualLk = null;
          this.overshoot = 0;
        } else if (b.exitable) {
          this.virtualLk = Math.max(want, floor - 1);
          target = floor - 0.35 * (floor - this.virtualLk);
          this.overshoot = 1 - Math.exp(this.virtualLk - floor);
        } else {
          target = floor;
          this.virtualLk = null;
          this.overshoot = 0;
        }
      }
      this.onOvershoot(this.overshoot);
    }
    const w = this.toWorld(sx, sy);
    const k = Math.exp(target);
    this.view = { k, x: sx - w.x * k, y: sy - w.y * k };
    this.clampPan();
  }

  /** Keep the content rectangle covering at least 30% of the free area's smaller side. */
  private clampPan() {
    const b = this.bounds;
    if (!b) return;
    const { k } = this.view;
    const r = b.rect;
    const f = b.free;
    const sx0 = r.x0 * k + this.view.x;
    const sx1 = r.x1 * k + this.view.x;
    const sy0 = r.y0 * k + this.view.y;
    const sy1 = r.y1 * k + this.view.y;
    const m = Math.min(0.3 * Math.min(f.w, f.h), 0.5 * (sx1 - sx0), 0.5 * (sy1 - sy0));
    if (sx1 < f.x + m) this.view.x += f.x + m - sx1;
    if (sx0 > f.x + f.w - m) this.view.x -= sx0 - (f.x + f.w - m);
    if (sy1 < f.y + m) this.view.y += f.y + m - sy1;
    if (sy0 > f.y + f.h - m) this.view.y -= sy0 - (f.y + f.h - m);
  }
}
