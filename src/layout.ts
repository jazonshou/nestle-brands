/* ==========================================================================
   Layout, computed once and never re-laid out during interaction.
   - Each category is an island: groups become rigid sub-discs, brands are
     packed by label-aware footprints, then relaxed so that no hub line ever
     crosses a unit it doesn't belong to.
   - Islands sit on a wedge "wheel" around Nestlé so no spoke crosses an
     island. The wheel is recomputed only when the screen's aspect class changes.
   ========================================================================== */

import { packEnclose, packSiblings } from "d3-hierarchy";
import type { MNode, Model } from "./model";
import { LAYOUT } from "./tokens";

export interface Member {
  node: MNode;
  /** Offset from the group's centre. */
  lx: number;
  ly: number;
}

export interface Unit {
  node: MNode; // a group or an ungrouped brand
  isGroup: boolean;
  /** Offset of the unit's centre from the island hub (unstretched frame). */
  ax: number;
  ay: number;
  /** Drawn radius: the brand's radius, or the group disc's radius. */
  R: number;
  /** Footprint used for spacing. */
  F: number;
  /** Groups: hub offset from the group centre. */
  hx: number;
  hy: number;
  members: Member[];
}

export interface Island {
  node: MNode;
  R: number;
  units: Unit[];
  /** Wheel position (world). */
  x: number;
  y: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Layout {
  aspect: number;
  islands: Island[];
  islandOf: Map<MNode, Island>;
  /** Brand or group → its unit (brands inside groups map to the group's unit). */
  unitOf: Map<MNode, Unit>;
  /** Brand inside a group → its member record. */
  memberOf: Map<MNode, Member>;
  bounds: Rect;
}

interface Body {
  u: Unit;
  x: number;
  y: number;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const L2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return { d: Math.hypot(px - qx, py - qy), t, qx, qy };
}

/** Where the hub line to unit b ends: a brand's centre, or a group's "gate" on its rim nearest the hub. */
function lineEnd(b: Body): [number, number] {
  if (!b.u.isGroup) return [b.x, b.y];
  const L = Math.hypot(b.x, b.y) || 1;
  return [b.x - (b.x / L) * b.u.R, b.y - (b.y / L) * b.u.R];
}

function relaxIsland(bodies: Body[]) {
  /** Pushes overlapping footprints apart and out of the hub. Returns the deepest overlap found. */
  const collide = () => {
    let worst = 0;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const p = bodies[i];
        const q = bodies[j];
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const need = p.u.F + q.u.F;
        if (d >= need) continue;
        worst = Math.max(worst, need - d);
        const push = (need - d) / 2;
        dx /= d;
        dy /= d;
        const wp = p.u.isGroup ? 0.5 : 1;
        const wq = q.u.isGroup ? 0.5 : 1;
        p.x -= dx * push * wp;
        p.y -= dy * push * wp;
        q.x += dx * push * wq;
        q.y += dy * push * wq;
      }
    }
    for (const b of bodies) {
      const d = Math.hypot(b.x, b.y) || 1e-6;
      const need = LAYOUT.hubR + b.u.F;
      if (d < need) {
        b.x *= need / d;
        b.y *= need / d;
      }
    }
    return worst;
  };
  /** Keeps every hub line clear of the other units. Returns how far the worst line reaches into a unit. */
  const clearLines = () => {
    let worst = -Infinity;
    for (const p of bodies) {
      for (const q of bodies) {
        if (p === q) continue;
        const [ex, ey] = lineEnd(q);
        const s = segDist(p.x, p.y, 0, 0, ex, ey);
        if (s.t <= 0.001 || s.t >= 0.999) continue;
        worst = Math.max(worst, p.u.R - s.d);
        const need = p.u.R + 6;
        if (s.d >= need) continue;
        let nx = p.x - s.qx;
        let ny = p.y - s.qy;
        let d = Math.hypot(nx, ny);
        if (d < 1e-6) {
          const L = Math.hypot(ex, ey) || 1;
          nx = -ey / L;
          ny = ex / L;
          d = 1;
        }
        nx /= d;
        ny /= d;
        const push = need - s.d;
        const wp = p.u.isGroup ? 0.35 : 0.6;
        p.x += nx * push * wp;
        p.y += ny * push * wp;
        q.x -= nx * push * (1 - wp) * 0.6;
        q.y -= ny * push * (1 - wp) * 0.6;
      }
    }
    return worst;
  };

  const iters = LAYOUT.relaxIters;
  for (let it = 0; it < iters; it++) {
    const g = LAYOUT.gravity * (1 - it / iters);
    for (const b of bodies) {
      b.x -= b.x * g;
      b.y -= b.y * g;
    }
    collide();
    collide();
    clearLines();
  }
  // Without gravity, settle until no footprints overlap and every line keeps a few pixels' clearance.
  for (let k = 0; k < 120; k++) {
    const lines = clearLines();
    const overlap = collide();
    if (overlap < 0.01 && lines < -3) break;
  }
}

function packGroup(g: MNode): Unit {
  const brands = g.children.filter((c) => c.kind === "brand");
  const discs = [
    { r: LAYOUT.groupHubR, x: 0, y: 0, node: null as MNode | null },
    ...brands.map((b) => ({ r: b.f, x: 0, y: 0, node: b as MNode | null })).sort((a, b) => b.r - a.r),
  ];
  packSiblings(discs);
  const e = packEnclose(discs)!;
  const [hub, ...rest] = discs;
  return {
    node: g,
    isGroup: true,
    ax: 0,
    ay: 0,
    R: e.r + LAYOUT.groupPad - 5,
    F: e.r + LAYOUT.groupPad,
    hx: hub.x - e.x,
    hy: hub.y - e.y,
    members: rest.map((d) => ({ node: d.node!, lx: d.x - e.x, ly: d.y - e.y })),
  };
}

function packIsland(c: MNode): Omit<Island, "x" | "y"> {
  const units: Unit[] = [];
  for (const ch of c.children) {
    if (ch.kind === "group") units.push(packGroup(ch));
    else if (ch.kind === "brand") units.push({ node: ch, isGroup: false, ax: 0, ay: 0, R: ch.r, F: ch.f, hx: 0, hy: 0, members: [] });
  }
  const discs = [{ r: LAYOUT.hubR, x: 0, y: 0, u: null as Unit | null }, ...units.map((u) => ({ r: u.F, x: 0, y: 0, u: u as Unit | null })).sort((a, b) => b.r - a.r)];
  packSiblings(discs);
  const hub = discs[0];
  const bodies: Body[] = discs.slice(1).map((d) => ({ u: d.u!, x: d.x - hub.x, y: d.y - hub.y }));
  relaxIsland(bodies);
  for (const b of bodies) {
    b.u.ax = b.x;
    b.u.ay = b.y;
  }
  const R = units.length ? Math.max(...units.map((u) => Math.hypot(u.ax, u.ay) + u.F)) + LAYOUT.islandMargin : LAYOUT.hubR + 60;
  return { node: c, R, units };
}

/** Wedge wheel: islands around Nestlé on an ellipse with semi-axes (a, b). */
function placeWheel(islands: Omit<Island, "x" | "y">[], a: number, b: number) {
  let theta = LAYOUT.wheelStart;
  const out: { x: number; y: number }[] = [];
  for (const is of islands) {
    theta += is.node.meta?.gapBefore ?? 0;
    const R = is.R;
    let w = 0.3;
    const at = (c: number) => {
      const ux = Math.cos(c);
      const uy = Math.sin(c);
      const rho = (a * b) / Math.sqrt((b * ux) ** 2 + (a * uy) ** 2);
      return { ux, uy, d: Math.max(rho - R, LAYOUT.nestleR + LAYOUT.wheelGap + R) };
    };
    for (let it = 0; it < 60; it++) {
      const { d } = at(theta + w / 2);
      const nw = 2 * Math.asin(Math.min(1, (R + LAYOUT.wheelGap / 2) / d));
      if (Math.abs(nw - w) < 1e-9) break;
      w = nw;
    }
    const { ux, uy, d } = at(theta + w / 2);
    out.push({ x: ux * d, y: uy * d });
    theta += w;
  }
  return { total: theta - LAYOUT.wheelStart, out };
}

function wheel(islands: Omit<Island, "x" | "y">[], aspect: number) {
  const A = Math.max(0.5, Math.min(2, aspect));
  const axes = (m: number) => (A >= 1 ? [m, m / A] : [m * A, m]);
  let lo = 200;
  let hi = 8000;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    const [a, b] = axes(m);
    if (placeWheel(islands, a, b).total > Math.PI * 2) lo = m;
    else hi = m;
  }
  const [a, b] = axes(hi);
  return placeWheel(islands, a, b).out;
}

export function snapAspect(aspect: number): number {
  return LAYOUT.aspectClasses.reduce((best, c) => (Math.abs(Math.log(aspect / c)) < Math.abs(Math.log(aspect / best)) ? c : best));
}

export interface IslandPack {
  islands: Omit<Island, "x" | "y">[];
}

/** The expensive part (packing + relaxation). Independent of the screen. */
export function packIslands(model: Model): IslandPack {
  return { islands: model.categories.map(packIsland) };
}

/** Places the islands for an aspect class. Cheap; recomputed when the class changes. */
export function arrange(pack: IslandPack, aspect: number): Layout {
  const positions = wheel(pack.islands, aspect);
  const islands: Island[] = pack.islands.map((is, i) => ({ ...is, x: positions[i].x, y: positions[i].y }));
  const islandOf = new Map<MNode, Island>();
  const unitOf = new Map<MNode, Unit>();
  const memberOf = new Map<MNode, Member>();
  const n = LAYOUT.nestleR;
  const bounds: Rect = { x0: -n, y0: -n, x1: n, y1: n };
  for (const is of islands) {
    islandOf.set(is.node, is);
    for (const u of is.units) {
      unitOf.set(u.node, u);
      for (const m of u.members) {
        unitOf.set(m.node, u);
        memberOf.set(m.node, m);
      }
    }
    bounds.x0 = Math.min(bounds.x0, is.x - is.R);
    bounds.y0 = Math.min(bounds.y0, is.y - is.R);
    bounds.x1 = Math.max(bounds.x1, is.x + is.R);
    bounds.y1 = Math.max(bounds.y1, is.y + is.R);
  }
  return { aspect, islands, islandOf, unitOf, memberOf, bounds };
}

/** Diagnostics for tests and the debug overlay: overlaps and hub-line crossings. */
export function layoutReport(layout: Layout) {
  let overlaps = 0;
  let crossings = 0;
  for (const is of layout.islands) {
    const bodies = is.units.map((u) => ({ u, x: u.ax, y: u.ay }));
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        if (Math.hypot(bodies[i].x - bodies[j].x, bodies[i].y - bodies[j].y) < bodies[i].u.R + bodies[j].u.R) overlaps++;
      }
    }
    for (const p of bodies) {
      for (const q of bodies) {
        if (p === q) continue;
        const [ex, ey] = lineEnd(q);
        const s = segDist(p.x, p.y, 0, 0, ex, ey);
        if (s.t > 0.001 && s.t < 0.999 && s.d < p.u.R + 1) crossings++;
      }
    }
  }
  return { overlaps, crossings, radii: layout.islands.map((i) => [i.node.short, Math.round(i.R)]) };
}
