/* ==========================================================================
   Drag physics: position-based, no simulation "heat".
   - The grabbed body follows the pointer exactly, in the same frame.
   - Whatever it carries (a brand's products, a group's brands, an island's
     contents) moves with it rigidly, because those positions are derived.
   - Neighbours are pushed by collisions and spring back to their anchors.
   - At the overview the spokes are slack ropes: a short drag moves only the
     bubble; past the slack, its spoke tugs Nestlé, which tugs the rest.
   - Release throws the body with the pointer's velocity; where it comes to
     rest becomes its new home. Everything then sleeps.
   ========================================================================== */

import { clamp, springStep, springStepUD } from "./anim";
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
  ax: number;
  ay: number;
  /** Collision radius (session frame units). */
  r: number;
  /** Radius used for the containment limit (the body's layout radius). */
  rLim: number;
  w: number;
  kinematic: boolean;
  thrown: boolean;
  /** Released outside its limit: springs back in on its own instead of being snapped to the rim. */
  returning: boolean;
  /** Never moves (a category or group hub): others are pushed off it, including the dropped body. */
  fixed: boolean;
  /** Where it was when the session started. */
  x0: number;
  y0: number;
  /** Pulled along by a taut spoke this session: it springs (with a little bounce) to where the spoke allows. */
  tugged: boolean;
  /** Writes the body's position back into the scene's drops. */
  write: (x: number, y: number) => void;
}

type Limit = (x: number, y: number, r: number) => { x: number; y: number; over: number };

interface Session {
  kind: Kind;
  bodies: Body[];
  grabbed: Body;
  grab: { x: number; y: number };
  /** Converts a world point into the session frame. */
  toFrame: (wx: number, wy: number) => { x: number; y: number };
  /** Containment (island hull or group disc), or null for the archipelago. */
  limit: Limit | null;
  k: number;
  /** Extra gap kept between bodies (world units). */
  pad: number;
  /** Pairs already closer than r + r + pad when the session started: keep their resting distance. */
  rest: Map<number, number>;
  quietMs: number;
  /** Simulated time since release (ms), for the settle backstop. */
  sinceRelease: number;
  /** What's on screen (session frame); a thrown island lands inside it. */
  visible: Rect | null;
  /** How many times islands pushed off screen were given extra time to glide back. */
  rescues: number;
  /**
   * Overview spokes (Nestlé to each island) as slack ropes: within `slack` of their starting length they do
   * nothing; past it they pull the far end along. Listed driver first, so a pull passes along the chain.
   */
  ropes: { driver: Body; follower: Body; len: number }[];
  slack: number;
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
      const bodies: Body[] = L.islands.map((is) => {
        const c = sc.islandCentre(is);
        const d = drop(sc.islandDrop, is.node);
        // Islands keep the layout's gap between them (half each), not just their discs apart.
        return body(is.node, c.x, c.y, is.R + LAYOUT.wheelGap / 2, is.R, 1, (x, y) => {
          d.x = x - is.x;
          d.y = y - is.y;
        });
      });
      bodies.push(
        body(sc.model.root, sc.nestleDrop.x, sc.nestleDrop.y, LAYOUT.nestleR + LAYOUT.wheelGap / 2, LAYOUT.nestleR, 3, (x, y) => {
          sc.nestleDrop.x = x;
          sc.nestleDrop.y = y;
        }),
      );
      const grabbed = bodies.find((b) => b.node === node)!;
      s = this.session$("archipelago", bodies, grabbed, (x, y) => ({ x, y }), null, k);
      s.visible = visible;
      // Spokes: move a bubble a little and only it moves; drag it further and its spoke tugs Nestlé
      // (or, from Nestlé, the islands), and Nestlé passes the pull on to the other islands.
      const nestle = bodies[bodies.length - 1];
      const len = (a: Body, b: Body) => Math.hypot(a.x - b.x, a.y - b.y);
      s.slack = 80 / k;
      if (grabbed !== nestle) s.ropes.push({ driver: grabbed, follower: nestle, len: len(grabbed, nestle) });
      for (const b of bodies) if (b !== nestle && b !== grabbed) s.ropes.push({ driver: nestle, follower: b, len: len(nestle, b) });
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
    s.grabbed.kinematic = true;
    this.session = s;
    this.scene.dragged = s.grabbed.node;
    return true;
  }

  private session$(kind: Kind, bodies: Body[], grabbed: Body, toFrame: Session["toFrame"], limit: Limit | null, k: number): Session {
    // The grabbed body uses its drawn (on-screen) size, capped near its layout size so a big
    // signpost at the overview doesn't shove its neighbours; neighbours use their layout size.
    grabbed.r = Math.max(grabbed.r, Math.min((this.scene.frame.s[grabbed.node.i] || 0) / k, grabbed.rLim + 4 / k));
    const pad = Math.min(2 / k, 4);
    // Pairs already closer than that keep their starting distance, so nothing moves until something approaches.
    const rest = new Map<number, number>();
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const p = bodies[i];
        const q = bodies[j];
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < p.r + q.r + pad) rest.set(i * 4096 + j, d);
      }
    }
    for (const b of bodies) {
      b.ax = b.x;
      b.ay = b.y;
      b.x0 = b.x;
      b.y0 = b.y;
    }
    return { kind, bodies, grabbed, grab: { x: 0, y: 0 }, toFrame, limit, k, pad, rest, quietMs: 0, sinceRelease: 0, visible: null, rescues: 0, ropes: [], slack: 0 };
  }

  private unitSession(is: Island, grabbedUnit: Unit, k: number): Session {
    const sc = this.scene;
    const S = sc.stretchOf(is);
    const centre = sc.islandCentre(is);
    const bodies = is.units.map((u) => {
      const o = sc.unitOffset(u);
      const d = drop(sc.unitDrop, u.node);
      // Collide at the layout footprint (the disc plus room for its name), as the layout spaces them.
      return body(u.node, o.x * S.sx, o.y * S.sy, u.F, u.R, u.isGroup ? 2 : 1, (x, y) => {
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
      return body(m.node, (m.lx + d.x) * M.sx, (m.ly + d.y) * M.sy, m.node.f, m.node.r, 1, (x, y) => {
        d.x = x / M.sx - m.lx;
        d.y = y / M.sy - m.ly;
      });
    });
    const grabbed = bodies.find((b) => b.node === brand)!;
    bodies.push(fixedBody(unit.node, unit.hx * M.sx, unit.hy * M.sy, LAYOUT.groupHubR));
    return this.session$("member", bodies, grabbed, (wx, wy) => ({ x: wx - g.x, y: wy - g.y }), (x, y, r) => ellipseLimit(x, y, unit.R * M.sx - r, unit.R * M.sy - r), k);
  }

  /** Pointer moved (world coordinates). The grabbed body is placed immediately, in this frame. */
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
    b.vx = (x - b.x) / H;
    b.vy = (y - b.y) / H;
    b.x = x;
    b.y = y;
    b.write(x, y);
  }

  /** Release with a throw velocity in screen px/ms (0 if the pointer paused). */
  release(vx: number, vy: number) {
    const s = this.session;
    if (!s) return;
    const b = s.grabbed;
    b.kinematic = false;
    s.sinceRelease = 0;
    const cap = s.kind === "archipelago" ? 1.2 : 1.0;
    const speed = Math.hypot(vx, vy);
    const scale = speed > cap ? cap / speed : 1;
    const outside = !!s.limit && s.limit(b.x, b.y, b.rLim).over > 0;
    b.returning = outside;
    if (reducedMotion.matches || speed < 0.05 || outside) {
      b.vx = b.vy = 0;
      b.thrown = false;
    } else {
      // px/ms on screen → world units per second
      b.vx = ((vx * scale) / s.k) * 1000;
      b.vy = ((vy * scale) / s.k) * 1000;
      b.thrown = true;
      // A thrown island glides about v·τ; aim it so at least half of it lands on screen.
      const v = s.visible;
      if (v) {
        const tau = MOTION.throwTauMs / 1000;
        const m = Math.min(b.rLim * 0.5, (v.x1 - v.x0) / 2, (v.y1 - v.y0) / 2);
        const ex = b.x + b.vx * tau;
        const ey = b.y + b.vy * tau;
        b.vx = (clamp(ex, v.x0 + m, v.x1 - m) - b.x) / tau;
        b.vy = (clamp(ey, v.y0 + m, v.y1 - m) - b.y) / tau;
      }
    }
    // Home is where it was let go, pulled back inside the limit if it was rubber-banding, off any hub,
    // and (for islands) at least half on screen. It springs there rather than jumping.
    let home = s.limit ? s.limit(b.x, b.y, b.rLim) : this.onScreen(s, b, b.x, b.y);
    for (const f of s.bodies) {
      if (!f.fixed) continue;
      const need = b.r + f.r + s.pad;
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
      b.returning = true;
      b.vx = b.vy = 0;
      b.thrown = false;
    }
    if (s.kind === "archipelago" && !b.thrown && (home.x !== b.x || home.y !== b.y)) b.returning = true;
    b.ax = home.x;
    b.ay = home.y;
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
    for (const b of s.bodies) this.homeHere(s, b);
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

  /** Makes a body's current spot its home, pulled inside the limit. */
  private homeHere(s: Session, b: Body) {
    const h = s.limit ? s.limit(b.x, b.y, b.rLim) : { x: b.x, y: b.y };
    b.ax = h.x;
    b.ay = h.y;
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
    while (this.acc >= H && steps < 8) {
      this.substep(s);
      this.acc -= H;
      steps++;
    }
    if (steps === 8) this.acc = 0;
    for (const b of s.bodies) b.write(b.x, b.y);
    return this.checkSleep(s, dt);
  }

  private substep(s: Session) {
    const hl = s.kind === "archipelago" ? MOTION.islandH : MOTION.neighbourH;
    const B = s.bodies;
    const px = B.map((b) => b.x);
    const py = B.map((b) => b.y);
    // Taut spokes move the far end's home to the end of the spoke; ropes never push.
    for (const r of s.ropes) {
      const f = r.follower;
      if (f.kinematic || f === s.grabbed) continue;
      const dx = f.ax - r.driver.x;
      const dy = f.ay - r.driver.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const max = r.len + s.slack;
      if (d <= max) continue;
      f.ax = r.driver.x + (dx / d) * max;
      f.ay = r.driver.y + (dy / d) * max;
      f.tugged = true;
    }
    for (const b of B) {
      if (b.kinematic) continue;
      if (b.thrown) {
        const e = Math.exp(-(H * 1000) / MOTION.throwTauMs);
        b.vx *= e;
        b.vy *= e;
        b.x += b.vx * H;
        b.y += b.vy * H;
        if (s.limit) {
          const l = s.limit(b.x, b.y, b.rLim);
          if (l.over > 0) {
            b.x = l.x;
            b.y = l.y;
            b.vx *= -0.2;
            b.vy *= -0.2;
          }
        }
        b.ax = b.x;
        b.ay = b.y;
        if (Math.hypot(b.vx, b.vy) * s.k < 20) b.thrown = false;
        continue;
      }
      if (b.tugged) {
        // A little bounce: elastic, not rigid.
        [b.x, b.vx] = springStepUD(b.x, b.vx, b.ax, 0.62, 0.42, H);
        [b.y, b.vy] = springStepUD(b.y, b.vy, b.ay, 0.62, 0.42, H);
      } else {
        [b.x, b.vx] = springStep(b.x, b.vx, b.ax, hl, H);
        [b.y, b.vy] = springStep(b.y, b.vy, b.ay, hl, H);
      }
    }
    const springSpeed = B.map((b) => Math.hypot(b.vx, b.vy));
    const sx = B.map((b) => b.x);
    const sy = B.map((b) => b.y);
    // Position-based collisions: two passes.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < B.length; i++) {
        for (let j = i + 1; j < B.length; j++) {
          const p = B[i];
          const q = B[j];
          let dx = q.x - p.x;
          let dy = q.y - p.y;
          let d = Math.hypot(dx, dy);
          const need = Math.min(p.r + q.r + s.pad, s.rest.get(i * 4096 + j) ?? Infinity);
          if (d >= need) continue;
          if (d < 1e-6) {
            dx = 1;
            dy = 0;
            d = 1e-6;
          }
          const over = need - d;
          const ip = p.kinematic || (p === s.grabbed && !q.fixed) ? 0 : 1 / p.w;
          const iq = q.kinematic || (q === s.grabbed && !p.fixed) ? 0 : 1 / q.w;
          const sum = ip + iq;
          if (!sum) continue;
          const nx = dx / d;
          const ny = dy / d;
          p.x -= nx * over * (ip / sum);
          p.y -= ny * over * (ip / sum);
          q.x += nx * over * (iq / sum);
          q.y += ny * over * (iq / sum);
        }
      }
    }
    // Containment, then velocity from where bodies actually ended up (so a blocked body has no phantom
    // speed), but never faster than the spring alone would move it: a push is a correction, not a launch.
    B.forEach((b, i) => {
      if (b.kinematic) return;
      if (s.limit) {
        const l = s.limit(b.x, b.y, b.rLim);
        if (b.returning) {
          if (l.over <= 0) b.returning = false;
        } else if (l.over > 0) {
          b.x = l.x;
          b.y = l.y;
        }
        const a = s.limit(b.ax, b.ay, b.rLim);
        if (a.over > 0) {
          b.ax = a.x;
          b.ay = a.y;
        }
      }
      // A body nothing pushed keeps its spring's own velocity (so elastic motion stays elastic).
      if (!b.thrown && (b.x !== sx[i] || b.y !== sy[i])) {
        let vx = (b.x - px[i]) / H;
        let vy = (b.y - py[i]) / H;
        const v = Math.hypot(vx, vy);
        if (v > springSpeed[i] && v > 0) {
          vx *= springSpeed[i] / v;
          vy *= springSpeed[i] / v;
        }
        b.vx = vx;
        b.vy = vy;
      }
    });
  }

  private checkSleep(s: Session, dt: number): boolean {
    if (s.grabbed.kinematic) return true;
    const tol = 0.1 / s.k;
    const slow = 2 / s.k;
    let quiet = true;
    let settled = true;
    for (const b of s.bodies) {
      if (Math.hypot(b.vx, b.vy) > slow || b.thrown) quiet = false;
      if (Math.hypot(b.x - b.ax, b.y - b.ay) > tol) settled = false;
    }
    if (quiet && settled && s.rescues < 3 && (this.spaceHomes(s) || this.bringOnScreen(s))) {
      s.rescues++;
      return true;
    }
    if (quiet && settled) return this.finish(s);
    s.quietMs = quiet ? s.quietMs + dt * 1000 : 0;
    s.sinceRelease += dt * 1000;
    // Bodies blocked from their anchors (or a session that just won't settle): their current spot becomes home.
    if (s.quietMs > 150 || s.sinceRelease > 1200) {
      for (const b of s.bodies) this.homeHere(s, b);
      // Homes that ended up crowded get spaced out again, and islands pushed off screen glide back (a few
      // times at most); after that everything settles where it is.
      if (s.rescues < 3 && (this.spaceHomes(s) || this.bringOnScreen(s))) {
        s.rescues++;
        s.quietMs = 0;
        s.sinceRelease = 600;
        return true;
      }
      return this.finish(s);
    }
    return true;
  }

  /**
   * Final homes keep the same spacing as collisions (the layout's gaps): crowded ones are pushed apart, the
   * dropped body and hubs staying put. Returns true if any home moved noticeably (the bodies then spring there).
   */
  private spaceHomes(s: Session): boolean {
    const B = s.bodies;
    const still = (b: Body) => b.fixed || b === s.grabbed;
    let moved = 0;
    for (let it = 0; it < 16; it++) {
      let any = false;
      for (let i = 0; i < B.length; i++) {
        for (let j = i + 1; j < B.length; j++) {
          const p = B[i];
          const q = B[j];
          const ip = still(p) ? 0 : 1 / p.w;
          const iq = still(q) ? 0 : 1 / q.w;
          if (!ip && !iq) continue;
          const need = Math.min(p.r + q.r + s.pad, s.rest.get(i * 4096 + j) ?? Infinity);
          let dx = q.ax - p.ax;
          let dy = q.ay - p.ay;
          let d = Math.hypot(dx, dy);
          if (d >= need - 0.25 / s.k) continue;
          if (d < 1e-6) {
            dx = 1;
            dy = 0;
            d = 1e-6;
          }
          const over = need - d;
          const nx = dx / d;
          const ny = dy / d;
          p.ax -= nx * over * (ip / (ip + iq));
          p.ay -= ny * over * (ip / (ip + iq));
          q.ax += nx * over * (iq / (ip + iq));
          q.ay += ny * over * (iq / (ip + iq));
          moved = Math.max(moved, over);
          any = true;
        }
      }
      // Spaced homes still stay inside the island or group.
      if (s.limit) {
        for (const b of B) {
          if (still(b)) continue;
          const l = s.limit(b.ax, b.ay, b.rLim);
          b.ax = l.x;
          b.ay = l.y;
        }
      }
      if (!any) break;
    }
    return moved * s.k > 1;
  }

  /** Islands that moved this session and ended mostly off screen get a new home in view. Returns true if any did. */
  private bringOnScreen(s: Session): boolean {
    if (s.kind !== "archipelago" || !s.visible) return false;
    let any = false;
    for (const b of s.bodies) {
      // (Islands a spoke pulled along went where the user led them.)
      if (b.kinematic || b.tugged || Math.hypot(b.x - b.x0, b.y - b.y0) < 1 / s.k) continue;
      const h = this.onScreen(s, b, b.ax, b.ay);
      if (h.over) {
        b.ax = h.x;
        b.ay = h.y;
        any = true;
      }
    }
    return any;
  }

  private finish(s: Session): boolean {
    for (const b of s.bodies) {
      b.x = b.ax;
      b.y = b.ay;
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

function body(node: MNode, x: number, y: number, r: number, rLim: number, w: number, write: (x: number, y: number) => void): Body {
  return { node, x, y, vx: 0, vy: 0, ax: x, ay: y, r, rLim, w, kinematic: false, thrown: false, returning: false, fixed: false, x0: x, y0: y, tugged: false, write };
}

/** A hub: it never moves, and everything (even a dropped body) is pushed off it. */
function fixedBody(node: MNode, x: number, y: number, r: number): Body {
  return { ...body(node, x, y, r, r, 1, () => {}), kinematic: true, fixed: true };
}

function ellipseLimit(x: number, y: number, rx: number, ry: number) {
  rx = Math.max(1, rx);
  ry = Math.max(1, ry);
  const t = (x / rx) ** 2 + (y / ry) ** 2;
  if (t <= 1) return { x, y, over: 0 };
  const f = 1 / Math.sqrt(t);
  return { x: x * f, y: y * f, over: Math.sqrt(t) - 1 };
}
