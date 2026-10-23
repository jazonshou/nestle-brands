/* ==========================================================================
   Drag physics: a small force simulation that runs only while something is
   dragged (and until it settles afterwards).
   - Everything has mass and momentum, with speed and acceleration capped and
     enough friction that motion eases to a stop rather than bouncing. The
     dragged bubble follows the pointer through a stiff spring (a hint of
     weight).
   - Spacing is soft: bubbles are nudged apart near their usual spacing,
     pushed firmly only when really close, and never overlap.
   - At the overview each spoke keeps its island at the offset from Nestlé it
     started at, give or take some slack (a little different per island): a
     short drag moves only the bubble; past the slack, Nestlé and the islands
     pull each other along in parallel, so the map keeps its shape instead of
     bunching up.
   - While the drag is on, everything is drawn weakly back to where it was;
     after release that pull fades, so things rest where the drag left them.
     What you drop (or throw) stays where it lands.
   - Stiffness and friction vary a little from bubble to bubble, so they don't
     move in lockstep. Where everything comes to rest becomes its new home.
   ========================================================================== */

import { clamp, springStep } from "./anim";
import type { Island, Rect, Unit } from "./layout";
import type { MNode } from "./model";
import type { Drop, Scene } from "./scene";
import { LAYOUT, MOTION } from "./tokens";

type Kind = "archipelago" | "unit" | "member";

interface Body {
  node: MNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Home: where the weak spring draws it back to (and, once it settles, where it stays). */
  ax: number;
  ay: number;
  /** Hard radius: two bodies never get closer than the sum plus a small gap. */
  r: number;
  /** Comfort radius: two bodies push apart softly once closer than the sum (the layout's spacing). */
  c: number;
  /** Radius used for the containment limit (the body's layout radius). */
  rLim: number;
  /** Mass: heavier bodies accelerate less (bigger islands, Nestlé, groups). */
  m: number;
  /** Per-body variation of stiffness and friction (about ±18%), so bodies don't move in lockstep. */
  stiff: number;
  damp: number;
  /** Follows the pointer (while dragged). */
  kinematic: boolean;
  /** Thrown on release: glides with friction and no pull home, then stays where it stops. */
  thrown: boolean;
  /** Released somewhere it can't stay (outside its island, on a hub, off screen): moving to its home. */
  returning: boolean;
  /** Stays put: a hub, or the body that was dropped (once it has arrived). */
  fixed: boolean;
  pinned: boolean;
  /** Where it was when the session started. */
  x0: number;
  y0: number;
  /** Writes the body's position back into the scene's drops. */
  write: (x: number, y: number) => void;
}

type Limit = (x: number, y: number, r: number) => { x: number; y: number; over: number };

/** Force constants. Springs and repulsion are in 1/s² (per unit mass), friction in 1/s, caps in screen px. */
interface Tune {
  home: number;
  spoke: number;
  repel: number;
  friction: number;
  vMaxPx: number;
  aMaxPx: number;
  /** Smallest gap ever allowed between two bodies, on screen. */
  hardGapPx: number;
  /**
   * After release, the pull home fades out over this long (ms); 0 keeps it. Things resist being moved while
   * the drag is on, then rest where it left them: a neighbour pushed aside by a drop stays beside it instead of
   * leaning back into it, and nothing creeps for seconds afterwards.
   */
  homeFadeMs: number;
  /**
   * Neighbours (pairs starting within this many screen px of their usual spacing) resist getting any closer
   * than they started, so the layout's shape is kept: the map shifts and stretches instead of bunching up.
   */
  keepPx: number;
}

// Friction is high enough that motion is overdamped: things ease to a stop rather than bouncing back.
// Spacing is soft: bubbles are nudged apart near their usual spacing and only pushed hard when really close.
const TUNE: Record<Kind, Tune> = {
  // Islands: heavy, and only weakly drawn home, so the map gives a little like a loose net.
  archipelago: { home: 14, spoke: 45, repel: 150, friction: 15, vMaxPx: 1100, aMaxPx: 5000, hardGapPx: 4, keepPx: 0, homeFadeMs: 250 },
  // Brands inside a category: lighter and quicker to return to their spots.
  unit: { home: 70, spoke: 0, repel: 220, friction: 18, vMaxPx: 1000, aMaxPx: 7000, hardGapPx: 4, keepPx: 0, homeFadeMs: 350 },
  member: { home: 70, spoke: 0, repel: 220, friction: 18, vMaxPx: 1000, aMaxPx: 7000, hardGapPx: 3, keepPx: 0, homeFadeMs: 350 },
};

/** Repulsion eases in over the first this-many screen px inside the comfortable distance (soft, not a wall). */
const SOFT_PX = 28;

interface Session {
  kind: Kind;
  tune: Tune;
  bodies: Body[];
  grabbed: Body;
  grab: { x: number; y: number };
  /** Where the pointer wants the grabbed body (session frame). */
  target: { x: number; y: number };
  /** Converts a world point into the session frame. */
  toFrame: (wx: number, wy: number) => { x: number; y: number };
  /** Containment (island hull or group disc), or null for the archipelago. */
  limit: Limit | null;
  k: number;
  /** Per pair (i * n + j): the hard minimum distance and the comfortable distance. */
  hard: Float64Array;
  comfort: Float64Array;
  /**
   * Overview spokes (Nestlé to each island). Each keeps the island at the offset from Nestlé it had when the
   * drag began, give or take `slack`; past that it pulls them back towards it. So pulling Nestlé drags the
   * islands along in parallel (the map keeps its shape) instead of reeling them all in to one point.
   */
  ropes: { a: Body; b: Body; ox: number; oy: number; slack: number }[];
  slack: number;
  quietMs: number;
  /** Simulated time since release (ms), for the settle backstop. */
  sinceRelease: number;
  /** What's on screen (session frame): islands are kept at least half in view. */
  visible: Rect | null;
}

const H = 1 / 120;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export class Physics {
  private scene: Scene;
  private session: Session | null = null;
  private acc = 0;
  private tidy: Map<Drop, { vx: number; vy: number }> | null = null;
  /** Called the first time anything is dropped somewhere new (and again after Tidy up). */
  onFirstDrop: () => void = () => {};
  private dropped = false;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  get active(): boolean {
    return !!this.session || !!this.tidy;
  }

  get dragging(): MNode | null {
    return this.session?.grabbed.kinematic ? this.session.grabbed.node : null;
  }

  /**
   * Start dragging `node` (an island's category, Nestlé, a group, or a brand).
   * (wx, wy) is the pointer in world coordinates.
   */
  start(node: MNode, wx: number, wy: number, k: number, visible: Rect | null = null): boolean {
    this.tidy = null;
    if (this.session) this.settleNow();
    const sc = this.scene;
    const L = sc.layout;
    let s: Session | null = null;

    if (node.kind === "category" || node.kind === "root") {
      // Islands keep at least the layout's gap between them (and never less than ~18 px on screen).
      const half = Math.max(LAYOUT.wheelGap / 2, 9 / k);
      const meanR = L.islands.reduce((t, is) => t + is.R, 0) / L.islands.length;
      const bodies: Body[] = L.islands.map((is, j) => {
        const c = sc.islandCentre(is);
        const d = drop(sc.islandDrop, is.node);
        // As big as it's drawn (phones draw small islands larger than their layout size).
        const R = Math.max(is.R, (sc.frame.islandR[j] || 0) / k);
        return body(is.node, c.x, c.y, R, R + half, is.R, clamp((is.R / meanR) ** 1.2, 0.6, 2.2), (x, y) => {
          d.x = x - is.x;
          d.y = y - is.y;
        });
      });
      const nestleR = Math.max(LAYOUT.nestleR, (sc.frame.s[sc.model.root.i] || 0) / k);
      bodies.push(
        body(sc.model.root, sc.nestleDrop.x, sc.nestleDrop.y, nestleR, nestleR + half, LAYOUT.nestleR, 2.4, (x, y) => {
          sc.nestleDrop.x = x;
          sc.nestleDrop.y = y;
        }),
      );
      const grabbed = bodies.find((b) => b.node === node)!;
      s = this.session$("archipelago", bodies, grabbed, (x, y) => ({ x, y }), null, k);
      s.visible = visible;
      // Spokes: a short drag moves only the bubble; past the slack, its spoke pulls on Nestlé (or the islands).
      const nestle = bodies[bodies.length - 1];
      s.slack = 80 / k;
      // Each spoke's slack differs a little, so islands start following at different moments and the map
      // gives organically rather than moving as one sheet.
      for (const b of bodies) {
        if (b !== nestle) s.ropes.push({ a: nestle, b, ox: b.x - nestle.x, oy: b.y - nestle.y, slack: s.slack * (0.7 + 0.6 * hash01(b.node.id, 3)) });
      }
    } else {
      const brand = node.kind === "product" ? node.brand! : node;
      const cat = brand.category;
      if (!cat) return false;
      const is = L.islandOf.get(cat)!;
      const unit = L.unitOf.get(brand)!;
      const member = node.kind === "brand" ? L.memberOf.get(brand) : undefined;
      if (member && unit.isGroup) s = this.memberSession(is, unit, brand, k);
      else s = this.unitSession(is, node.kind === "group" ? L.unitOf.get(node)! : unit, k);
    }
    if (!s) return false;
    const p = s.toFrame(wx, wy);
    s.grab = { x: p.x - s.grabbed.x, y: p.y - s.grabbed.y };
    s.target = { x: s.grabbed.x, y: s.grabbed.y };
    s.grabbed.kinematic = true;
    this.session = s;
    this.scene.dragged = s.grabbed.node;
    return true;
  }

  private session$(kind: Kind, bodies: Body[], grabbed: Body, toFrame: Session["toFrame"], limit: Limit | null, k: number): Session {
    const tune = TUNE[kind];
    const n = bodies.length;
    const hard = new Float64Array(n * n);
    const comfort = new Float64Array(n * n);
    // Pairs that start closer than their usual spacing keep their starting distance: nothing jumps when grabbed.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const p = bodies[i];
        const q = bodies[j];
        const d0 = Math.hypot(q.x - p.x, q.y - p.y);
        const h = Math.min(p.r + q.r + tune.hardGapPx / k, d0);
        hard[i * n + j] = h;
        // Comfortable at their usual spacing; neighbours also at the distance they started at.
        comfort[i * n + j] = Math.max(h, Math.min(p.c + q.c + tune.keepPx / k, d0));
      }
    }
    for (const b of bodies) {
      b.ax = b.x0 = b.x;
      b.ay = b.y0 = b.y;
    }
    return { kind, tune, bodies, grabbed, grab: { x: 0, y: 0 }, target: { x: 0, y: 0 }, toFrame, limit, k, hard, comfort, ropes: [], slack: 0, quietMs: 0, sinceRelease: 0, visible: null };
  }

  private unitSession(is: Island, grabbedUnit: Unit, k: number): Session {
    const sc = this.scene;
    const S = sc.stretchOf(is);
    const centre = sc.islandCentre(is);
    const bodies = is.units.map((u) => {
      const o = sc.unitOffset(u);
      const d = drop(sc.unitDrop, u.node);
      // Soft spacing at the layout footprint (the disc plus room for its name); hard limit at the disc.
      return body(u.node, o.x * S.sx, o.y * S.sy, u.R, u.F, u.R, u.isGroup ? 2 : clamp(u.R / 22, 0.7, 1.6), (x, y) => {
        d.x = x / S.sx - u.ax;
        d.y = y / S.sy - u.ay;
      });
    });
    const grabbed = bodies.find((b) => b.node === grabbedUnit.node)!;
    // The category hub (drawn as an 18 px logo when focused) can't be covered.
    const cat = is.node;
    const hubPx = sc.focused === cat && cat.e.logo ? 18 : Math.max(sc.frame.s[cat.i] || 0, 6);
    bodies.push(fixedBody(cat, 0, 0, hubPx / k + 4 / k));
    const rx = is.R * S.sx;
    const ry = is.R * S.sy;
    return this.session$("unit", bodies, grabbed, (wx, wy) => ({ x: wx - centre.x, y: wy - centre.y }), (x, y, r) => ellipseLimit(x, y, rx - r, ry - r), k);
  }

  private memberSession(is: Island, unit: Unit, brand: MNode, k: number): Session {
    const sc = this.scene;
    const g = sc.unitWorld(is, unit);
    // Members live in the group's stretched frame (phones); drops are kept unstretched.
    const M = sc.memberStretchOf(is);
    const bodies = unit.members.map((m) => {
      const d = drop(sc.memberDrop, m.node);
      return body(m.node, (m.lx + d.x) * M.sx, (m.ly + d.y) * M.sy, m.node.r, m.node.f, m.node.r, 1, (x, y) => {
        d.x = x / M.sx - m.lx;
        d.y = y / M.sy - m.ly;
      });
    });
    const grabbed = bodies.find((b) => b.node === brand)!;
    bodies.push(fixedBody(unit.node, unit.hx * M.sx, unit.hy * M.sy, LAYOUT.groupHubR));
    return this.session$("member", bodies, grabbed, (wx, wy) => ({ x: wx - g.x, y: wy - g.y }), (x, y, r) => ellipseLimit(x, y, unit.R * M.sx - r, unit.R * M.sy - r), k);
  }

  /** Pointer moved (world coordinates): sets where the grabbed body is heading. */
  move(wx: number, wy: number) {
    const s = this.session;
    if (!s || !s.grabbed.kinematic) return;
    const b = s.grabbed;
    const p = s.toFrame(wx, wy);
    let x = p.x - s.grab.x;
    let y = p.y - s.grab.y;
    if (s.limit) {
      const l = s.limit(x, y, b.rLim);
      if (l.over > 0) {
        // Rubber band past the limit.
        x = l.x + (x - l.x) * 0.35;
        y = l.y + (y - l.y) * 0.35;
      }
    }
    s.target = { x, y };
  }

  /** Release with a throw velocity in screen px/ms (0 if the pointer paused). */
  release(vx: number, vy: number) {
    const s = this.session;
    if (!s) return;
    const b = s.grabbed;
    b.kinematic = false;
    s.sinceRelease = 0;
    s.quietMs = 0;
    // Where it was let go: the pointer's spot (the body may still be catching up with it).
    const at = s.target;
    const cap = s.kind === "archipelago" ? 1.2 : 1.0;
    const speed = Math.hypot(vx, vy);
    const scale = speed > cap ? cap / speed : 1;
    const outside = !!s.limit && s.limit(at.x, at.y, b.rLim).over > 0;
    if (!reducedMotion.matches && speed >= 0.05 && !outside) {
      // px/ms on screen → world units per second. It glides on with friction and stays where it stops.
      b.vx = ((vx * scale) / s.k) * 1000;
      b.vy = ((vy * scale) / s.k) * 1000;
      b.thrown = true;
      // A thrown island glides about v·τ; aim it so at least half of it lands on screen.
      const v = s.visible;
      if (v) {
        const tau = 1 / (s.tune.friction * b.damp);
        const m = Math.min(b.rLim * 0.5, (v.x1 - v.x0) / 2, (v.y1 - v.y0) / 2);
        b.vx = (clamp(b.x + b.vx * tau, v.x0 + m, v.x1 - m) - b.x) / tau;
        b.vy = (clamp(b.y + b.vy * tau, v.y0 + m, v.y1 - m) - b.y) / tau;
      }
    } else {
      // Home is where it was let go: inside the limit if it was rubber-banding, off any hub, and (for
      // islands) at least half on screen. It moves there with the same inertia as everything else.
      let home = s.limit ? s.limit(at.x, at.y, b.rLim) : this.onScreen(s, b, at.x, at.y);
      for (const f of s.bodies) {
        if (!f.fixed) continue;
        const need = b.r + f.r + s.tune.hardGapPx / s.k;
        let dx = home.x - f.x;
        let dy = home.y - f.y;
        let d = Math.hypot(dx, dy);
        if (d >= need) continue;
        if (d < 1e-6) {
          dx = b.x0 - f.x;
          dy = b.y0 - f.y;
          d = Math.hypot(dx, dy) || 1;
        }
        home = { x: f.x + (dx / d) * need, y: f.y + (dy / d) * need, over: 1 };
      }
      // It finishes moving there the way it followed the pointer, then stays.
      b.ax = home.x;
      b.ay = home.y;
      s.target = { x: home.x, y: home.y };
      b.returning = true;
    }
    // A placed island stops pulling on Nestlé (its spoke relaxes where it was put), so letting go doesn't
    // set the whole map sliding towards it. (Islands pulled along by Nestlé still catch up with it.)
    for (const r of s.ropes) {
      if (r.b !== b) continue;
      r.ox = (b.thrown ? b.x : b.ax) - r.a.x;
      r.oy = (b.thrown ? b.y : b.ay) - r.a.y;
    }
    this.scene.dragged = null;
    if (!this.dropped) {
      this.dropped = true;
      this.onFirstDrop();
    }
  }

  /** Abandon a drag (pointercancel, second finger): no throw. */
  cancel() {
    if (this.session) this.release(0, 0);
  }

  /** End any session now, leaving everything where it is (a navigation is starting). */
  settleNow() {
    const s = this.session;
    if (!s) return;
    if (s.grabbed.kinematic) this.scene.dragged = null;
    this.finish(s);
  }

  /** For island sessions, a position moved so that at least half of the island is on screen. */
  private onScreen(s: Session, b: Body, x: number, y: number): { x: number; y: number; over: number } {
    const v = s.visible;
    if (s.kind !== "archipelago" || !v) return { x, y, over: 0 };
    const m = Math.min(b.rLim * 0.5, (v.x1 - v.x0) / 2, (v.y1 - v.y0) / 2);
    const cx = clamp(x, v.x0 + m, v.x1 - m);
    const cy = clamp(y, v.y0 + m, v.y1 - m);
    return { x: cx, y: cy, over: cx !== x || cy !== y ? 1 : 0 };
  }

  /** Spring every drop back to the original layout. */
  tidyUp() {
    if (this.session) this.scene.dragged = null;
    this.session = null;
    this.dropped = false;
    const map = new Map<Drop, { vx: number; vy: number }>();
    const sc = this.scene;
    for (const m of [sc.islandDrop, sc.unitDrop, sc.memberDrop]) for (const d of m.values()) map.set(d, { vx: 0, vy: 0 });
    map.set(sc.nestleDrop, { vx: 0, vy: 0 });
    this.tidy = map;
  }

  step(dt: number): boolean {
    if (this.tidy) {
      let busy = false;
      for (const [d, v] of this.tidy) {
        [d.x, v.vx] = springStep(d.x, v.vx, 0, MOTION.islandH, dt);
        [d.y, v.vy] = springStep(d.y, v.vy, 0, MOTION.islandH, dt);
        if (Math.abs(d.x) > 0.05 || Math.abs(d.y) > 0.05) busy = true;
        else d.x = d.y = 0;
      }
      if (!busy) this.tidy = null;
      return busy;
    }
    const s = this.session;
    if (!s) return false;
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= H && steps < 12) {
      this.substep(s);
      this.acc -= H;
      steps++;
    }
    if (steps === 12) this.acc = 0;
    for (const b of s.bodies) b.write(b.x, b.y);
    return this.checkSleep(s, dt);
  }

  /** Bodies that don't respond to forces right now (hubs, and the dragged or dropped body, which is placed). */
  private still(s: Session, b: Body): boolean {
    return b.fixed || b.pinned || (b === s.grabbed && (b.kinematic || b.returning));
  }

  private substep(s: Session) {
    const T = s.tune;
    const B = s.bodies;
    const n = B.length;
    const k = s.k;
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);

    // The grabbed body chases the pointer on a stiff, critically damped spring: direct, with a hint of weight.
    // After a plain release it goes on to where it was let go the same way.
    const g = s.grabbed;
    if (g.kinematic || g.returning) {
      [g.x, g.vx] = springStep(g.x, g.vx, s.target.x, 0.035, H);
      [g.y, g.vy] = springStep(g.y, g.vy, s.target.y, 0.035, H);
      const v = Math.hypot(g.vx, g.vy);
      const vMax = 2600 / k;
      if (v > vMax) {
        g.vx *= vMax / v;
        g.vy *= vMax / v;
      }
    }

    // Weak springs home (forces per unit mass, so scaled by mass below), fading after release where set.
    const homeK = g.kinematic || !T.homeFadeMs ? T.home : T.home * Math.max(0, 1 - s.sinceRelease / T.homeFadeMs);
    for (let i = 0; i < n; i++) {
      const b = B[i];
      if (this.still(s, b) || b.thrown) continue;
      // The dropped body still heads to its own spot.
      const kh = b === g ? T.home : homeK;
      fx[i] -= kh * b.stiff * b.m * (b.x - b.ax);
      fy[i] -= kh * b.stiff * b.m * (b.y - b.ay);
    }

    // Spokes: once an island's offset from Nestlé has changed by more than the slack, they're pulled back
    // towards it (both ways). A thrown body goes where it was thrown, so spokes don't tug it.
    const pulled = new Uint8Array(n);
    if (T.spoke) {
      for (const r of s.ropes) {
        // A thrown body is gliding where it was sent: its spoke neither tugs it nor pulls on the other end.
        if (r.a.thrown || r.b.thrown) continue;
        const ex = r.b.x - r.a.x - r.ox;
        const ey = r.b.y - r.a.y - r.oy;
        const e = Math.hypot(ex, ey);
        if (e <= r.slack) continue;
        const f = (T.spoke * (e - r.slack) * Math.sqrt(r.a.stiff * r.b.stiff)) / e;
        const ia = B.indexOf(r.a);
        const ib = B.indexOf(r.b);
        pulled[ia] = pulled[ib] = 1;
        fx[ia] += f * ex;
        fy[ia] += f * ey;
        fx[ib] -= f * ex;
        fy[ib] -= f * ey;
      }
    }

    // Soft repulsion inside the comfortable distance: barely felt at first, firmer the closer they get.
    const soft = SOFT_PX / k;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const p = B[i];
        const q = B[j];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const over = s.comfort[i * n + j] - d;
        if (over <= 0) continue;
        const f = T.repel * over * Math.min(1, over / soft) * Math.sqrt(p.stiff * q.stiff);
        fx[i] -= (f * dx) / d;
        fy[i] -= (f * dy) / d;
        fx[j] += (f * dx) / d;
        fy[j] += (f * dy) / d;
      }
    }

    // Islands that are shoved stay at least half on screen (a soft wall at the edges). Islands being pulled
    // along with the map go where it goes: a wall there would just pile them up against the edge.
    const v = s.visible;
    if (s.kind === "archipelago" && v) {
      for (let i = 0; i < n; i++) {
        const b = B[i];
        if (this.still(s, b) || pulled[i]) continue;
        const m = Math.min(b.rLim * 0.5, (v.x1 - v.x0) / 2, (v.y1 - v.y0) / 2);
        const cx = clamp(b.x, v.x0 + m, v.x1 - m);
        const cy = clamp(b.y, v.y0 + m, v.y1 - m);
        fx[i] += T.repel * b.m * (cx - b.x);
        fy[i] += T.repel * b.m * (cy - b.y);
      }
    }

    // Integrate (semi-implicit Euler) with friction and capped acceleration and speed: inertia.
    const aMax = T.aMaxPx / k;
    const vMax = T.vMaxPx / k;
    for (let i = 0; i < n; i++) {
      const b = B[i];
      if (this.still(s, b)) continue;
      const fr = T.friction * b.damp;
      let ax = fx[i] / b.m - fr * b.vx;
      let ay = fy[i] / b.m - fr * b.vy;
      const a = Math.hypot(ax, ay);
      if (a > aMax) {
        ax *= aMax / a;
        ay *= aMax / a;
      }
      b.vx += ax * H;
      b.vy += ay * H;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > vMax) {
        b.vx *= vMax / sp;
        b.vy *= vMax / sp;
      }
      b.x += b.vx * H;
      b.y += b.vy * H;
    }

    // Hard minimum gaps: position correction, and approaching speed along the contact is dropped.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const p = B[i];
          const q = B[j];
          let dx = q.x - p.x;
          let dy = q.y - p.y;
          let d = Math.hypot(dx, dy);
          const need = s.hard[i * n + j];
          if (d >= need) continue;
          if (d < 1e-6) {
            dx = 1;
            dy = 0;
            d = 1e-6;
          }
          const ip = this.still(s, p) ? 0 : 1 / p.m;
          const iq = this.still(s, q) ? 0 : 1 / q.m;
          const sum = ip + iq;
          if (!sum) continue;
          const nx = dx / d;
          const ny = dy / d;
          const over = need - d;
          p.x -= nx * over * (ip / sum);
          p.y -= ny * over * (ip / sum);
          q.x += nx * over * (iq / sum);
          q.y += ny * over * (iq / sum);
          const vn = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
          if (vn < 0) {
            p.vx += nx * vn * (ip / sum);
            p.vy += ny * vn * (ip / sum);
            q.vx -= nx * vn * (iq / sum);
            q.vy -= ny * vn * (iq / sum);
          }
        }
      }
    }

    // Containment (inside the island or group): a body that's outside is moved back in and stops moving out.
    if (s.limit) {
      for (const b of B) {
        if (this.still(s, b)) continue;
        const l = s.limit(b.x, b.y, b.rLim);
        if (l.over <= 0) continue;
        if (b.returning) continue;
        const nx = b.x - l.x;
        const ny = b.y - l.y;
        const d = Math.hypot(nx, ny) || 1e-6;
        b.x = l.x;
        b.y = l.y;
        const vn = (b.vx * nx + b.vy * ny) / d;
        if (vn > 0) {
          b.vx -= (vn * nx) / d;
          b.vy -= (vn * ny) / d;
        }
      }
    }

    // The dropped body: a throw ends where friction stops it; a placed body stays once it has arrived.
    if (!g.kinematic && !g.pinned) {
      const sp = Math.hypot(g.vx, g.vy) * k;
      if (g.thrown) {
        g.ax = g.x;
        g.ay = g.y;
        if (sp < 30) {
          this.pin(g);
          // Where a thrown island stops, its spoke relaxes (like a placed one).
          for (const r of s.ropes) {
            if (r.b === g) {
              r.ox = g.x - r.a.x;
              r.oy = g.y - r.a.y;
            }
          }
        }
      } else if (g.returning && Math.hypot(g.x - s.target.x, g.y - s.target.y) * k < 0.5 && sp < 20) {
        g.x = g.ax = s.target.x;
        g.y = g.ay = s.target.y;
        this.pin(g);
      }
    }
  }

  private pin(b: Body) {
    b.thrown = b.returning = false;
    b.pinned = true;
    b.vx = b.vy = 0;
  }

  private checkSleep(s: Session, dt: number): boolean {
    if (s.grabbed.kinematic) return true;
    s.sinceRelease += dt * 1000;
    let fastest = 0;
    // (Includes the dropped body while it's still on its way to where it was let go.)
    for (const b of s.bodies) if (!b.fixed && !b.pinned) fastest = Math.max(fastest, Math.hypot(b.vx, b.vy) * s.k);
    s.quietMs = fastest < 10 ? s.quietMs + dt * 1000 : 0;
    // At rest (or after a few seconds regardless): where everything is becomes its home.
    if (s.quietMs > 220 || s.sinceRelease > 4000) return this.finish(s);
    return true;
  }

  private finish(s: Session): boolean {
    for (const b of s.bodies) {
      if (s.limit && !b.fixed) {
        const l = s.limit(b.x, b.y, b.rLim);
        b.x = l.x;
        b.y = l.y;
      }
      b.ax = b.x;
      b.ay = b.y;
      b.vx = b.vy = 0;
      b.write(b.x, b.y);
    }
    this.session = null;
    return false;
  }
}

function drop(map: Map<MNode, Drop>, n: MNode): Drop {
  let d = map.get(n);
  if (!d) map.set(n, (d = { x: 0, y: 0 }));
  return d;
}

/** A small, stable per-node number in [0, 1) (so each bubble's variation is the same every time). */
function hash01(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

function body(node: MNode, x: number, y: number, r: number, c: number, rLim: number, m: number, write: (x: number, y: number) => void): Body {
  return {
    node,
    x,
    y,
    vx: 0,
    vy: 0,
    ax: x,
    ay: y,
    r,
    c,
    rLim,
    m,
    stiff: 0.82 + 0.36 * hash01(node.id, 1),
    damp: 0.85 + 0.3 * hash01(node.id, 2),
    kinematic: false,
    thrown: false,
    returning: false,
    fixed: false,
    pinned: false,
    x0: x,
    y0: y,
    write,
  };
}

/** A hub: it never moves, and everything (even a dropped body) is pushed off it. */
function fixedBody(node: MNode, x: number, y: number, r: number): Body {
  return { ...body(node, x, y, r, r, r, 1, () => {}), fixed: true };
}

function ellipseLimit(x: number, y: number, rx: number, ry: number) {
  rx = Math.max(1, rx);
  ry = Math.max(1, ry);
  const t = (x / rx) ** 2 + (y / ry) ** 2;
  if (t <= 1) return { x, y, over: 0 };
  const f = 1 / Math.sqrt(t);
  return { x: x * f, y: y * f, over: Math.sqrt(t) - 1 };
}
