import type { Camera } from "./camera";

export interface InputHandlers<N> {
  /** The node under a pointer, if any. */
  nodeAt(target: EventTarget | null): N | null;
  onNodeClick(node: N): void;
  onNodeDragStart(node: N): void;
  onNodeDrag(node: N, gx: number, gy: number): void;
  onNodeDragEnd(node: N): void;
  onBackgroundClick(): void;
  /** Called on any pan or zoom the user makes. */
  onNavigate(): void;
  /** Wheel/pinch over these elements is left to the browser (e.g. the scrolling detail panel). */
  ignoreWheel(target: EventTarget | null): boolean;
}

/** Safari's trackpad pinch events (not in lib.dom). */
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

type Gesture<N> =
  | { kind: "pan"; id: number; button: number; startX: number; startY: number; lastX: number; lastY: number; moved: boolean }
  | { kind: "node"; id: number; startX: number; startY: number; moved: boolean; node: N };

const DRAG_THRESHOLD = 4; // px of travel before a press becomes a drag instead of a click
const WHEEL_ZOOM_SPEED = 0.01;

/**
 * Navigation:
 *  - two-finger scroll / mouse wheel → pan in any direction (Shift+wheel pans sideways)
 *  - pinch, or ⌘/Ctrl + scroll → zoom around the cursor
 *  - right-, middle- or left-drag on empty space → pan
 *  - left-drag on a circle → move it; left-click → select it
 *  - touch: one finger pans, two fingers pinch
 */
export function attachInput<N>(svg: SVGSVGElement, camera: Camera, h: InputHandlers<N>): void {
  let gesture: Gesture<N> | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { dist0: number; k0: number; mid: { x: number; y: number } } | null = null;
  let safariPinch: { k0: number } | null = null;

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // --- Wheel: listened for on the whole window so scrolling over the floating
  // cards still moves the map, except where something needs to scroll itself.
  window.addEventListener(
    "wheel",
    (e) => {
      if (h.ignoreWheel(e.target)) return;
      e.preventDefault();
      camera.stop();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? svg.clientHeight : 1;
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;

      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch arrives as ctrl+wheel in Chrome/Firefox/Edge.
        if (safariPinch) return;
        const p = local(e);
        const d = Math.max(-50, Math.min(50, dy));
        camera.zoomTo(camera.t.k * Math.exp(-d * WHEEL_ZOOM_SPEED), p.x, p.y);
      } else {
        if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
        camera.panBy(-dx, -dy);
      }
      h.onNavigate();
    },
    { passive: false },
  );

  // --- Safari pinch.
  window.addEventListener("gesturestart", (e) => {
    e.preventDefault();
    if (h.ignoreWheel(e.target)) return;
    safariPinch = { k0: camera.t.k };
  });
  window.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    if (!safariPinch) return;
    const g = e as GestureEvent;
    const p = local(g);
    camera.zoomTo(safariPinch.k0 * g.scale, p.x, p.y);
    h.onNavigate();
  });
  window.addEventListener("gestureend", (e) => {
    e.preventDefault();
    safariPinch = null;
  });

  // --- Pointers.
  svg.addEventListener("contextmenu", (e) => e.preventDefault());

  const pinchState = () => {
    const [a, b] = [...touches.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const startPan = (id: number, button: number, x: number, y: number, moved = false) => {
    gesture = { kind: "pan", id, button, startX: x, startY: y, lastX: x, lastY: y, moved };
    if (moved) svg.classList.add("is-panning");
  };

  svg.addEventListener("pointerdown", (e) => {
    const p = local(e);
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, p);
      if (touches.size === 2) {
        if (gesture?.kind === "node" && gesture.moved) h.onNodeDragEnd(gesture.node);
        gesture = null;
        const s = pinchState();
        pinch = { dist0: s.dist, k0: camera.t.k, mid: s.mid };
        svg.setPointerCapture(e.pointerId);
        return;
      }
      if (touches.size > 2) return;
    }
    if (e.button > 2) return;

    camera.stop();
    const node = e.button === 0 ? h.nodeAt(e.target) : null;
    if (node) gesture = { kind: "node", id: e.pointerId, startX: p.x, startY: p.y, moved: false, node };
    else startPan(e.pointerId, e.button, p.x, p.y);
    svg.setPointerCapture(e.pointerId);
    if (e.button === 1) e.preventDefault(); // no autoscroll widget
  });

  svg.addEventListener("pointermove", (e) => {
    const p = local(e);
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, p);
      if (pinch && touches.size === 2) {
        const s = pinchState();
        camera.panBy(s.mid.x - pinch.mid.x, s.mid.y - pinch.mid.y);
        camera.zoomTo((pinch.k0 * s.dist) / pinch.dist0, s.mid.x, s.mid.y);
        pinch.mid = s.mid;
        h.onNavigate();
        return;
      }
    }
    if (!gesture || e.pointerId !== gesture.id) return;

    if (!gesture.moved) {
      if (Math.hypot(p.x - gesture.startX, p.y - gesture.startY) < DRAG_THRESHOLD) return;
      gesture.moved = true;
      if (gesture.kind === "node") h.onNodeDragStart(gesture.node);
      else svg.classList.add("is-panning");
    }

    if (gesture.kind === "pan") {
      camera.panBy(p.x - gesture.lastX, p.y - gesture.lastY);
      gesture.lastX = p.x;
      gesture.lastY = p.y;
      h.onNavigate();
    } else {
      const g = camera.toGraph(p.x, p.y);
      h.onNodeDrag(gesture.node, g.x, g.y);
    }
  });

  const end = (e: PointerEvent) => {
    if (touches.delete(e.pointerId) && pinch && touches.size < 2) {
      pinch = null;
      // Keep panning with whichever finger is still down.
      const [id, rest] = [...touches.entries()][0] ?? [];
      if (id !== undefined && rest) startPan(id, 0, rest.x, rest.y, true);
      return;
    }
    if (!gesture || e.pointerId !== gesture.id) return;
    const cancelled = e.type === "pointercancel";

    if (gesture.kind === "node") {
      if (gesture.moved) h.onNodeDragEnd(gesture.node);
      else if (!cancelled) h.onNodeClick(gesture.node);
    } else {
      svg.classList.remove("is-panning");
      if (!gesture.moved && gesture.button === 0 && !cancelled) h.onBackgroundClick();
    }
    gesture = null;
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
}
