/* ==========================================================================
   Input → intents. Handlers only record state and call invalidate(); the
   frame loop does the drawing.
     two-finger trackpad scroll → pan 1:1 (any direction)
     mouse wheel                → pan, eased (Shift = sideways)
     pinch / ⌘ or Ctrl + scroll → zoom around the cursor
     right / middle / Space+left / left on empty space → pan (with inertia)
     left drag on a circle      → drag it;  click → open it
     touch: one finger pans, two pinch, long-press picks a circle up
   ========================================================================== */

import type { Camera } from "./camera";
import type { Hit } from "./render";

export interface InputHooks {
  pick(x: number, y: number, coarse: boolean): Hit | null;
  /** Whether a hit can be dragged (brand, group caption, island, Nestlé). */
  draggable(hit: Hit): boolean;
  onHover(hit: Hit | null, x: number, y: number): void;
  /** Returns true if the click navigated or otherwise moved the view. */
  onClick(hit: Hit | null, x: number, y: number, coarse: boolean): boolean;
  /** A click interrupted a programmatic camera move and did nothing else: carry on with it. */
  resume(): void;
  /** Whether a press on this hit, made while a navigation move was running, just means "carry on" (e.g. the destination itself). */
  resumes(hit: Hit): boolean;
  onDoubleClick(hit: Hit | null, x: number, y: number, shift: boolean): void;
  onDragStart(hit: Hit, x: number, y: number): boolean;
  onDragMove(x: number, y: number): void;
  onDragEnd(vx: number, vy: number, cancelled: boolean): void;
  /** The user moved the camera themselves. */
  onUserCamera(): void;
  onFirstMouseWheel(): void;
  ignoreWheel(target: EventTarget | null): boolean;
  /** Free area edges, for auto-pan while dragging. */
  freeEdges(): { x0: number; y0: number; x1: number; y1: number };
  invalidate(): void;
}

/** Safari's trackpad pinch events (not in lib.dom). */
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

type Gesture =
  | { kind: "press"; id: number; x0: number; y0: number; hit: Hit | null; button: number; touch: boolean; t0: number; longPress: number; second: boolean; stopped: boolean }
  | { kind: "pan"; id: number; lastX: number; lastY: number }
  | { kind: "drag"; id: number }
  | { kind: "pinch"; d0: number; k0: number; mx: number; my: number };

const MOUSE_DRAG = 4;
const TOUCH_SLOP = 10;
const LONG_PRESS_MS = 350;

class Velocity {
  private samples: { t: number; x: number; y: number }[] = [];
  add(t: number, x: number, y: number) {
    this.samples.push({ t, x, y });
    while (this.samples.length > 2 && t - this.samples[0].t > 80) this.samples.shift();
  }
  reset() {
    this.samples = [];
  }
  /** px/ms; zero if there are too few samples or the pointer paused before release. */
  get(now: number): { vx: number; vy: number } {
    const s = this.samples;
    if (s.length < 2 || now - s[s.length - 1].t > 50) return { vx: 0, vy: 0 };
    const a = s[0];
    const b = s[s.length - 1];
    const dt = b.t - a.t;
    if (dt <= 0) return { vx: 0, vy: 0 };
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }
}

export class Input {
  space = false;
  /** Suppress hover reactions (during wheel motion and drags). */
  hoverSuppressedUntil = 0;
  private gesture: Gesture | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private velocity = new Velocity();
  private wheelEnd = 0;
  private wheelClass: "mouse" | "trackpad" = "trackpad";
  private lastWheelT = 0;
  private wheelGestureFirst = true;
  private shownMouseToast = false;
  private safariPinch: { k0: number; x: number; y: number } | null = null;
  private lastClick = { t: 0, x: 0, y: 0, hit: null as Hit | null, navigated: false };
  private pointer = { x: -1, y: -1, inside: false };
  private edge = { since: 0, dx: 0, dy: 0 };

  private el: HTMLElement;
  private camera: Camera;
  private h: InputHooks;

  constructor(el: HTMLElement, camera: Camera, hooks: InputHooks) {
    this.el = el;
    this.camera = camera;
    this.h = hooks;
    el.addEventListener("pointerdown", this.down);
    el.addEventListener("pointermove", this.move);
    el.addEventListener("pointerup", this.up);
    el.addEventListener("pointercancel", this.cancel);
    el.addEventListener("lostpointercapture", (e) => {
      if (this.gesture && "id" in this.gesture && this.gesture.id === e.pointerId) this.cancel(e);
    });
    el.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse" && !this.gesture) {
        this.pointer.inside = false;
        this.h.onHover(null, -1, -1);
      }
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("wheel", this.wheel, { passive: false });
    window.addEventListener("gesturestart", this.gstart as EventListener);
    window.addEventListener("gesturechange", this.gchange as EventListener);
    window.addEventListener("gestureend", this.gend as EventListener);
    window.addEventListener("blur", () => this.cancel());
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        this.space = true;
        if (!this.gesture) el.style.cursor = "grab";
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        this.space = false;
        el.style.cursor = "";
      }
    });
  }

  get dragging(): boolean {
    return this.gesture?.kind === "drag";
  }

  get busy(): boolean {
    return !!this.gesture && this.gesture.kind !== "press";
  }

  /** Called every frame: auto-pan near the edge while dragging. */
  tick(now: number): boolean {
    if (this.gesture?.kind !== "drag" || !this.pointer.inside) {
      this.edge.since = 0;
      return false;
    }
    const e = this.h.freeEdges();
    const p = this.pointer;
    const zone = 24;
    let dx = 0;
    let dy = 0;
    if (p.x < e.x0 + zone) dx = 1 - Math.max(0, p.x - e.x0) / zone;
    else if (p.x > e.x1 - zone) dx = -(1 - Math.max(0, e.x1 - p.x) / zone);
    if (p.y < e.y0 + zone) dy = 1 - Math.max(0, p.y - e.y0) / zone;
    else if (p.y > e.y1 - zone) dy = -(1 - Math.max(0, e.y1 - p.y) / zone);
    if (!dx && !dy) {
      this.edge.since = 0;
      return false;
    }
    if (!this.edge.since) this.edge.since = now;
    if (now - this.edge.since < 200) return true;
    const speed = 0.6 * 16;
    this.camera.panBy(Math.sign(dx) * speed * dx * dx, Math.sign(dy) * speed * dy * dy);
    this.h.onDragMove(p.x, p.y);
    return true;
  }

  private local(e: { clientX: number; clientY: number }) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private capture(id: number) {
    try {
      this.el.setPointerCapture(id);
    } catch {
      /* pointer already released */
    }
  }

  private down = (e: PointerEvent) => {
    const p = this.local(e);
    this.pointer = { x: p.x, y: p.y, inside: true };
    const touch = e.pointerType === "touch";
    this.camera.userMoving = false;
    if (touch) {
      this.touches.set(e.pointerId, p);
      if (this.touches.size === 2) {
        // Second finger: whatever was happening becomes a pinch.
        if (this.gesture?.kind === "drag") this.h.onDragEnd(0, 0, true);
        if (this.gesture?.kind === "press") clearTimeout(this.gesture.longPress);
        const [a, b] = [...this.touches.values()];
        this.gesture = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: this.camera.view.k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        this.camera.stop();
        this.capture(e.pointerId);
        return;
      }
      if (this.touches.size > 2) return;
    }
    if (!e.isPrimary && !touch) return;
    // A press ends any wheel gesture now; its pending end-of-gesture timer must not fire mid-grab.
    clearTimeout(this.wheelEnd);
    // A second press right after a click that navigated is part of a double-click:
    // don't let it stop the flight that click started.
    const lc = this.lastClick;
    const second = e.button === 0 && e.timeStamp - lc.t < 300 && Math.hypot(p.x - lc.x, p.y - lc.y) < 24 && lc.navigated;
    const stopped = !second && this.camera.programmatic;
    if (!second || e.button !== 0) this.camera.stop();
    this.velocity.reset();
    this.velocity.add(e.timeStamp, p.x, p.y);
    this.capture(e.pointerId);

    const panButton = e.button === 1 || e.button === 2 || (e.button === 0 && (this.space || (e.ctrlKey && navigator.platform.startsWith("Mac"))));
    if (panButton) {
      e.preventDefault();
      this.startPan(e.pointerId, p.x, p.y);
      return;
    }
    if (e.button !== 0) return;
    const hit = this.h.pick(p.x, p.y, touch || e.pointerType === "pen");
    const g: Gesture = { kind: "press", id: e.pointerId, x0: p.x, y0: p.y, hit, button: e.button, touch, t0: e.timeStamp, longPress: 0, second, stopped };
    if (touch && hit && this.h.draggable(hit)) {
      g.longPress = window.setTimeout(() => {
        if (this.gesture !== g) return;
        if (this.h.onDragStart(hit, this.pointer.x, this.pointer.y)) {
          navigator.vibrate?.(8);
          this.gesture = { kind: "drag", id: g.id };
          this.h.invalidate();
        }
      }, LONG_PRESS_MS);
    }
    this.gesture = g;
  };

  private startPan(id: number, x: number, y: number) {
    this.gesture = { kind: "pan", id, lastX: x, lastY: y };
    this.el.classList.add("is-panning");
    this.camera.userMoving = true;
    this.hoverSuppressedUntil = Infinity;
    this.h.onHover(null, x, y);
  }

  private move = (e: PointerEvent) => {
    const p = this.local(e);
    this.pointer = { x: p.x, y: p.y, inside: true };
    const touch = e.pointerType === "touch";
    if (touch && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) {
      if (e.pointerType === "mouse" && performance.now() > this.hoverSuppressedUntil) this.h.onHover(this.h.pick(p.x, p.y, false), p.x, p.y);
      return;
    }
    if (g.kind === "pinch") {
      if (this.touches.size < 2) return;
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.camera.panBy(mx - g.mx, my - g.my);
      this.camera.zoomAt(Math.log((g.k0 * d) / g.d0) - Math.log(this.camera.view.k), mx, my);
      g.mx = mx;
      g.my = my;
      this.camera.userMoving = true;
      this.h.onUserCamera();
      this.h.invalidate();
      return;
    }
    if ("id" in g && g.id !== e.pointerId) return;
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ce of events) {
      const cp = this.local(ce);
      this.velocity.add(ce.timeStamp, cp.x, cp.y);
    }
    if (g.kind === "press") {
      const dist = Math.hypot(p.x - g.x0, p.y - g.y0);
      if (dist < (g.touch ? TOUCH_SLOP : MOUSE_DRAG)) return;
      clearTimeout(g.longPress);
      if (g.second) this.camera.stop();
      if (!g.touch && g.hit && this.h.draggable(g.hit) && this.h.onDragStart(g.hit, g.x0, g.y0)) {
        this.gesture = { kind: "drag", id: g.id };
        this.el.classList.add("is-dragging");
        this.h.onDragMove(p.x, p.y);
      } else {
        this.startPan(g.id, g.x0, g.y0);
        this.move(e);
        return;
      }
      this.h.invalidate();
      return;
    }
    if (g.kind === "pan") {
      this.camera.panBy(p.x - g.lastX, p.y - g.lastY);
      g.lastX = p.x;
      g.lastY = p.y;
      this.h.onUserCamera();
    } else if (g.kind === "drag") this.h.onDragMove(p.x, p.y);
    this.h.invalidate();
  };

  private up = (e: PointerEvent) => {
    const p = this.local(e);
    const touch = e.pointerType === "touch";
    if (touch) {
      this.touches.delete(e.pointerId);
      if (this.gesture?.kind === "pinch") {
        if (this.touches.size === 1) {
          // Keep panning with the finger that's still down, from where it is now.
          const [id, rest] = [...this.touches.entries()][0];
          this.gesture = { kind: "pan", id, lastX: rest.x, lastY: rest.y };
        } else {
          this.gesture = null;
          this.camera.gestureEnd();
        }
        return;
      }
    }
    const g = this.gesture;
    if (!g || !("id" in g) || g.id !== e.pointerId) return;
    this.gesture = null;
    this.el.classList.remove("is-panning", "is-dragging");
    this.hoverSuppressedUntil = performance.now() + 64;
    const v = this.velocity.get(e.timeStamp);
    if (g.kind === "press") {
      clearTimeout(g.longPress);
      const now = e.timeStamp;
      const last = this.lastClick;
      const none = { t: 0, x: 0, y: 0, hit: null, navigated: false };
      if (g.second) {
        // Second half of a double-click on something that already navigated: ignore it.
        this.lastClick = none;
      } else if (now - last.t < 300 && Math.hypot(p.x - last.x, p.y - last.y) < 24 && !last.navigated) {
        // A real double-click (the first click did nothing): zoom.
        this.h.onDoubleClick(g.hit, p.x, p.y, e.shiftKey);
        this.lastClick = none;
      } else if (g.stopped && (!g.hit || this.h.resumes(g.hit))) {
        // A click on empty space that stopped a navigation move (an impatient second click):
        // finish the move rather than treating it as "go back".
        this.h.resume();
        this.lastClick = none;
      } else {
        const navigated = this.h.onClick(g.hit, p.x, p.y, touch);
        if (!navigated && g.stopped) this.h.resume();
        this.lastClick = { t: now, x: p.x, y: p.y, hit: g.hit, navigated };
      }
    } else if (g.kind === "pan") {
      this.camera.glideFrom(v.vx, v.vy);
      this.camera.gestureEnd();
      if (e.pointerType === "mouse") this.h.onHover(this.h.pick(p.x, p.y, false), p.x, p.y);
    } else if (g.kind === "drag") this.h.onDragEnd(v.vx, v.vy, false);
    this.h.invalidate();
  };

  private cancel = (e?: Event) => {
    const g = this.gesture;
    if (e instanceof PointerEvent && e.pointerType === "touch") this.touches.delete(e.pointerId);
    if (!g) return;
    if (g.kind === "press") clearTimeout(g.longPress);
    if (g.kind === "drag") this.h.onDragEnd(0, 0, true);
    this.gesture = null;
    this.el.classList.remove("is-panning", "is-dragging");
    this.camera.gestureEnd();
    this.h.invalidate();
  };

  // --- Wheel -----------------------------------------------------------------

  private classify(e: WheelEvent, v: number): "mouse" | "trackpad" {
    const now = e.timeStamp;
    const gap = now - this.lastWheelT;
    this.lastWheelT = now;
    if (gap > 400) this.wheelGestureFirst = true;
    else this.wheelGestureFirst = false;
    if (!this.wheelGestureFirst) return this.wheelClass;
    let c: "mouse" | "trackpad";
    if (e.deltaMode !== 0) c = "mouse";
    else if (v !== 0 && v % 4.000244140625 === 0) c = "mouse";
    else if (Math.abs(v) < 4) c = "trackpad";
    else if (Number.isInteger(Math.abs(v)) && Math.abs(v) >= 50 && e.deltaX === 0) c = "mouse";
    else c = "trackpad";
    this.wheelClass = c;
    return c;
  }

  private wheel = (e: WheelEvent) => {
    if (this.h.ignoreWheel(e.target)) return;
    e.preventDefault();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? this.el.clientHeight * 0.8 : 1;
    let dx = e.deltaX * unit;
    let dy = e.deltaY * unit;
    const cls = this.classify(e, e.deltaY || e.deltaX);
    this.camera.userMoving = true;
    this.hoverSuppressedUntil = performance.now() + 100;
    this.h.onHover(null, p.x, p.y);
    if (e.ctrlKey || e.metaKey) {
      if (this.safariPinch) return;
      if (cls === "trackpad") this.camera.zoomAt(-dy / 100, p.x, p.y);
      else this.camera.zoomSpring(Math.max(-Math.LN2, Math.min(Math.LN2, -dy / 450)), p.x, p.y, "repeat");
    } else if (cls === "trackpad") {
      this.camera.panBy(-dx, -dy);
    } else {
      if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
      this.camera.wheelPanBy(-dx, -dy);
      if (!this.shownMouseToast) {
        this.shownMouseToast = true;
        this.h.onFirstMouseWheel();
      }
    }
    this.h.onUserCamera();
    clearTimeout(this.wheelEnd);
    this.wheelEnd = window.setTimeout(() => {
      this.camera.gestureEnd();
      this.h.invalidate();
    }, 150);
    this.h.invalidate();
  };

  private gstart = (e: GestureEvent) => {
    e.preventDefault();
    if (this.touches.size || this.h.ignoreWheel(e.target)) return;
    const p = this.local(e);
    // Scale is applied step by step (not against the starting zoom), so a camera still moving from a
    // flight doesn't jump back when the first change arrives.
    this.safariPinch = { k0: 1, x: p.x, y: p.y };
  };

  private gchange = (e: GestureEvent) => {
    e.preventDefault();
    const s = this.safariPinch;
    if (!s) return;
    this.camera.zoomAt(Math.log(e.scale / s.k0), s.x, s.y);
    s.k0 = e.scale;
    this.camera.userMoving = true;
    this.h.onUserCamera();
    this.h.invalidate();
  };

  private gend = (e: GestureEvent) => {
    e.preventDefault();
    if (!this.safariPinch) return;
    this.safariPinch = null;
    this.camera.gestureEnd();
    this.h.invalidate();
  };
}
