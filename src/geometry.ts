/* ==========================================================================
   Screen-dependent geometry: free areas, camera fits, the category stretch,
   product fan slots, edge-chip slots and signpost choice. Pure functions.
   ========================================================================== */

import { clamp } from "./anim";
import type { Island, Rect } from "./layout";
import type { MNode } from "./model";
import { SIZE } from "./tokens";

export type LayoutMode = "wide" | "narrow";
export type Level = "overview" | "category" | "brand";

export interface Viewport {
  w: number;
  h: number;
  mode: LayoutMode;
  coarse: boolean;
}

export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Fit {
  cx: number;
  cy: number;
  k: number;
}

export const layoutMode = (w: number, h: number): LayoutMode => (w >= SIZE.wideMinW && h >= SIZE.wideMinH ? "wide" : "narrow");

/** The part of the screen the map may use in each state (excludes top bar, card, chip bands, legend). */
export function freeArea(level: Level, vp: Viewport): Area {
  const { w: W, h: H } = vp;
  const box = (x0: number, y0: number, x1: number, y1: number): Area => ({ x: x0, y: y0, w: Math.max(80, x1 - x0), h: Math.max(80, y1 - y0) });
  if (vp.mode === "wide") {
    if (level === "overview") return box(16, 64, W - 16, H - 56);
    if (level === "category") return box(176, 96, W - 16 - SIZE.cardW - 16, H - 56);
    return box(16, 64, W - 16 - SIZE.cardW - 16, H - 56);
  }
  // Narrow: below the top bar (48), the category strip (44) and the Key / Show all row (to 144).
  if (level === "overview") return box(8, 100, W - 8, H - 56);
  if (level === "category") return box(8, 144, W - 8, H - 104);
  // On a short (landscape) phone the lens may use the band between the Key and Show all buttons.
  return box(8, H < 520 ? 96 : 144, W - 8, H - 0.4 * H - 8);
}

/** Screen radius of a world radius r at zoom k: linear when zoomed out, √k when zoomed in so gaps open up. */
export const screenRadius = (r: number, k: number) => Math.min(SIZE.badgeMax, k <= 1 ? r * k : r * Math.sqrt(k));

export function fitRect(b: Rect, free: Area, maxK = 4): Fit {
  const k = Math.min(maxK, free.w / (b.x1 - b.x0), free.h / (b.y1 - b.y0));
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, k };
}

// ---------------------------------------------------------------------------
// Category focus: per-axis stretch of unit centres so the island matches the
// free area's shape. |S·v| ≥ |v| for every v, so it can't create overlaps or
// crossings while the units themselves stay rigid.
// ---------------------------------------------------------------------------

export interface Stretch {
  sx: number;
  sy: number;
}

export type UnitOffset = (i: number) => { x: number; y: number };

/**
 * Bounding box of an island's units (relative to its hub) under a stretch. With `groups`, the stretch also
 * reaches inside the groups (phones), which then span their footprint times the stretch.
 */
export function focusBox(is: Island, at: UnitOffset, s: Stretch, groups = false): Rect {
  const b: Rect = { x0: -40, y0: -40, x1: 40, y1: 40 };
  is.units.forEach((u, i) => {
    const p = at(i);
    const x = p.x * s.sx;
    const y = p.y * s.sy;
    const fx = groups && u.isGroup ? u.F * s.sx : u.F;
    const fy = groups && u.isGroup ? u.F * s.sy : u.F;
    b.x0 = Math.min(b.x0, x - fx);
    b.y0 = Math.min(b.y0, y - fy);
    b.x1 = Math.max(b.x1, x + fx);
    b.y1 = Math.max(b.y1, y + fy);
  });
  return b;
}

const K_FOCUS_MIN = 0.55;
const K_FOCUS_MAX = 1.5;

/**
 * Stretch for a focused island: per-axis (σ ≤ 1.6, more on phones) to match the free area's shape, then — for
 * small islands that would hit the zoom cap — a uniform spread so they still fill the screen.
 * Unit sizes never change, so a stretch with σ ≥ 1 can't create overlaps or crossings.
 */
export function stretchFor(is: Island, at: UnitOffset, free: Area, maxStretch = 1.6, groups = false): Stretch {
  const b = focusBox(is, at, { sx: 1, sy: 1 });
  const a = free.w / free.h;
  const e = (b.x1 - b.x0) / (b.y1 - b.y0);
  let s: Stretch = a > e ? { sx: Math.min(maxStretch, a / e), sy: 1 } : { sx: 1, sy: Math.min(maxStretch, e / a) };
  for (let i = 0; i < 8; i++) {
    const bb = focusBox(is, at, s, groups);
    const k = Math.min((free.w * 0.96) / (bb.x1 - bb.x0), (free.h * 0.96) / (bb.y1 - bb.y0));
    if (k <= K_FOCUS_MAX * 1.02) break;
    // At the cap the island would fill less than it could: spread the unit centres out
    // (unit sizes don't scale, so this converges over a few rounds).
    const spread = Math.min(1.8, k / K_FOCUS_MAX);
    s = { sx: s.sx * spread, sy: s.sy * spread };
  }
  return s;
}

/**
 * Camera zoom and centre (offset from the hub) for a focused island. If the island still overflows at the
 * zoom floor, the centre shifts so its best-known brands (the category's heroes) stay on screen.
 */
export function focusFit(is: Island, at: UnitOffset, s: Stretch, free: Area, kMin = K_FOCUS_MIN, groups = false): { k: number; dx: number; dy: number; box: Rect } {
  const b = focusBox(is, at, s, groups);
  const k = clamp(Math.min((free.w * 0.96) / (b.x1 - b.x0), (free.h * 0.96) / (b.y1 - b.y0)), kMin, K_FOCUS_MAX);
  let dx = (b.x0 + b.x1) / 2;
  let dy = (b.y0 + b.y1) / 2;
  const w = free.w / k;
  const h = free.h / k;
  if (b.x1 - b.x0 > w || b.y1 - b.y0 > h) {
    const hb: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    is.units.forEach((u, i) => {
      const brands = u.isGroup ? u.members.map((m) => m.node) : [u.node];
      if (!brands.some((n) => n.hero < 5)) return;
      const p = at(i);
      const fx = groups && u.isGroup ? u.F * s.sx : u.F;
      const fy = groups && u.isGroup ? u.F * s.sy : u.F;
      hb.x0 = Math.min(hb.x0, p.x * s.sx - fx);
      hb.y0 = Math.min(hb.y0, p.y * s.sy - fy);
      hb.x1 = Math.max(hb.x1, p.x * s.sx + fx);
      hb.y1 = Math.max(hb.y1, p.y * s.sy + fy);
    });
    if (hb.x1 - hb.x0 <= w) dx = clamp(dx, hb.x1 - w / 2, hb.x0 + w / 2);
    if (hb.y1 - hb.y0 <= h) dy = clamp(dy, hb.y1 - h / 2, hb.y0 + h / 2);
  }
  return { k, dx, dy, box: b };
}

// ---------------------------------------------------------------------------
// Product fan (screen space, relative to the open brand's centre).
// ---------------------------------------------------------------------------

export interface FanSlot {
  /** Angle shared by the tucked, peek and open states. */
  theta: number;
  /** Open position, screen px from the brand centre. */
  x: number;
  y: number;
  right: boolean;
}

export interface Fan {
  slots: FanSlot[];
  /** Product rows shown (when truncated, the last row is "+N more"). */
  shown: number;
  more: number;
  rho: number;
  row: number;
  cols: 1 | 2;
  labelX: number;
  /** Width available for a product name (plus its status suffix). */
  labelMax: number;
  /** Bounding box of dots + labels, relative to the brand centre. */
  box: Rect;
}

/**
 * Product fan for a brand with `count` products whose longest name (with suffix) measures `labelW` px.
 * Two columns when they fit (never on narrow screens), otherwise one column to the right.
 */
export function fanGeometry(count: number, vp: Viewport, free: Area, labelW = 150): Fan {
  const row = vp.coarse ? SIZE.productRowCoarse : SIZE.productRow;
  const sOpen = vp.mode === "wide" ? SIZE.openBadge : SIZE.openBadgeNarrow;
  if (count === 0) {
    // Nothing to fan out: the lens just hugs the badge.
    return { slots: [], shown: 0, more: 0, rho: 0, row, cols: 1, labelX: 0, labelMax: 0, box: { x0: -Math.max(sOpen + 10, 70), x1: Math.max(sOpen + 10, 70), y0: -(sOpen + 18), y1: sOpen + 28 } };
  }
  // Rows that fit the free height (at least two: one product and "+N more", e.g. on a landscape phone).
  const cap = Math.max(2, Math.floor((free.h - 64) / row));
  const rhoFor = (rowsPerCol: number) => Math.max(sOpen + 30, (((rowsPerCol - 1) / 2) * row) / Math.sin((62 * Math.PI) / 180));
  // Names get the room they need, up to a generous cap; the lens grows with them.
  const want = Math.min(labelW, 240);

  let cols: 1 | 2 = 2;
  let shown = Math.min(count, cap * 2);
  let rho = rhoFor(Math.ceil(shown / 2));
  if (vp.mode === "narrow" || count <= 2 || 2 * (rho + 12 + want) + 32 > free.w - 16) {
    cols = 1;
    shown = Math.min(count, cap);
    rho = rhoFor(shown);
  }
  const more = count > shown ? count - (shown - 1) : 0;
  const rightCount = cols === 2 ? Math.ceil(shown / 2) : shown;
  const slots: FanSlot[] = [];
  for (let j = 0; j < shown; j++) {
    const right = j < rightCount;
    const cnt = right ? rightCount : shown - rightCount;
    const idx = right ? j : j - rightCount;
    const y = (idx - (cnt - 1) / 2) * row;
    const x = Math.sqrt(Math.max(0, rho * rho - y * y)) * (right ? 1 : -1);
    slots.push({ theta: Math.atan2(y, x), x, y, right });
  }
  const labelX = rho + 12;
  const room = cols === 2 ? (free.w - 32) / 2 - labelX : free.w - 32 - (sOpen + 10) - labelX;
  const labelMax = Math.max(60, Math.min(want, room));
  const halfH = (Math.max(rightCount, shown - rightCount) / 2) * row + 8;
  const box: Rect = {
    x0: cols === 2 ? -(labelX + labelMax) : -(sOpen + 10),
    x1: labelX + labelMax,
    y0: -Math.max(halfH, sOpen + 18),
    y1: Math.max(halfH, sOpen + 8),
  };
  return { slots, shown, more, rho, row, cols, labelX, labelMax, box };
}

// ---------------------------------------------------------------------------
// Edge chips (wide layout): every other category sits at the screen edge,
// in the direction where its island really lies.
// ---------------------------------------------------------------------------

export interface ChipSlot {
  x: number; // left edge of the chip (screen px)
  y: number; // vertical centre
  w: number;
}

export function chipSlots(
  bearings: number[],
  widths: number[],
  vp: Viewport,
  avoid: { cardBottom: number; legendRight: number; controlsLeft: number },
): ChipSlot[] {
  const H = vp.h;
  const W = vp.w;
  const gap = 8;
  const top = 78;
  const bottom = H - 34;
  const left = 16;
  const right = W - 16;
  const free = freeArea("category", vp);
  const cx = free.x + free.w / 2;
  const cy = free.y + free.h / 2;

  type Edge = "left" | "top" | "right" | "bottom";
  const items = bearings.map((b, i) => {
    const dx = Math.cos(b);
    const dy = Math.sin(b);
    // Ray from the free-area centre to the chip ring.
    const tx = dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity;
    const ty = dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
    let edge: Edge;
    let along: number;
    if (tx < ty) {
      edge = dx > 0 ? "right" : "left";
      along = cy + dy * tx;
    } else {
      edge = dy > 0 ? "bottom" : "top";
      along = cx + dx * ty;
    }
    return { i, edge, along, w: widths[i] };
  });

  const out: ChipSlot[] = new Array(bearings.length);
  const ranges: Record<Edge, [number, number]> = {
    left: [top + 32, bottom - 40],
    right: [Math.max(top + 32, avoid.cardBottom + 26), bottom - 40],
    top: [left + 160, right - SIZE.cardW - 32],
    bottom: [avoid.legendRight + 12, avoid.controlsLeft - 12],
  };
  type Item = (typeof items)[number];
  const vertical = (e: Edge) => e === "left" || e === "right";
  const size = (it: Item, e: Edge) => (vertical(e) ? SIZE.chipH : it.w);
  const listOf = (e: Edge) => items.filter((it) => it.edge === e).sort((a, b) => a.along - b.along);
  const need = (e: Edge) => listOf(e).reduce((sum, it) => sum + size(it, e) + gap, -gap);
  const room = (e: Edge) => ranges[e][1] - ranges[e][0];

  // Overflow: move chips off a crowded edge to the corner it shares with a neighbouring edge that has room,
  // so a chip never ends up on the far side of the screen from its island.
  const corner: Record<Edge, { first: [Edge, number]; last: [Edge, number] }> = {
    // [edge to spill to, along-position on that edge (−∞ = its start, +∞ = its end)]
    top: { first: ["left", -Infinity], last: ["right", -Infinity] },
    bottom: { first: ["left", Infinity], last: ["right", Infinity] },
    left: { first: ["top", -Infinity], last: ["bottom", -Infinity] },
    right: { first: ["top", Infinity], last: ["bottom", Infinity] },
  };
  for (let guard = 0; guard < 40; guard++) {
    const crowded = (["top", "right", "bottom", "left"] as Edge[]).find((e) => listOf(e).length > 1 && need(e) > room(e));
    if (!crowded) break;
    const list = listOf(crowded);
    const opts = [
      { it: list[0], to: corner[crowded].first },
      { it: list[list.length - 1], to: corner[crowded].last },
    ];
    // Prefer the neighbour with the most spare room.
    opts.sort((a, b) => room(b.to[0]) - need(b.to[0]) - (room(a.to[0]) - need(a.to[0])));
    const pickOpt = opts[0];
    pickOpt.it.edge = pickOpt.to[0];
    pickOpt.it.along = pickOpt.to[1];
  }

  for (const edge of ["top", "right", "bottom", "left"] as Edge[]) {
    const list = listOf(edge);
    if (!list.length) continue;
    const [lo, hi] = ranges[edge];
    const sz = (it: Item) => size(it, edge);
    // Start each chip centred on its bearing, then relax so neighbours keep at least `gap` apart.
    const pos = list.map((it) => clamp((Number.isFinite(it.along) ? it.along : it.along < 0 ? lo : hi) - sz(it) / 2, lo, hi - sz(it)));
    for (let rep = 0; rep < 20; rep++) {
      for (let j = 1; j < pos.length; j++) {
        const want = pos[j - 1] + sz(list[j - 1]) + gap;
        if (pos[j] < want) {
          const push = (want - pos[j]) / 2;
          pos[j - 1] -= push;
          pos[j] += push;
        }
      }
      for (let j = 0; j < pos.length; j++) pos[j] = clamp(pos[j], lo, hi - sz(list[j]));
    }
    // Two sweeps guarantee no overlaps when the row fits.
    for (let j = 1; j < pos.length; j++) pos[j] = Math.max(pos[j], pos[j - 1] + sz(list[j - 1]) + gap);
    const n = pos.length;
    pos[n - 1] = Math.min(pos[n - 1], hi - sz(list[n - 1]));
    for (let j = n - 2; j >= 0; j--) pos[j] = Math.min(pos[j], pos[j + 1] - sz(list[j]) - gap);
    list.forEach((it, j) => {
      if (vertical(edge)) out[it.i] = { x: edge === "left" ? left : right - it.w, y: pos[j] + SIZE.chipH / 2, w: it.w };
      else out[it.i] = { x: pos[j], y: edge === "top" ? top : bottom, w: it.w };
    });
  }
  // Anything that spilled twice lands on the bottom-left fallback.
  for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = { x: left, y: bottom - (i + 1) * (SIZE.chipH + gap), w: widths[i] };
  return out;
}

// ---------------------------------------------------------------------------
// Signposts: at the overview, each island shows a few real logos at a readable
// size, chosen from its hand-picked heroes (then: has a logo, most products).
// ---------------------------------------------------------------------------

export interface SignpostInput {
  brands: MNode[];
  /** Screen position of each brand (same order). */
  pos: { x: number; y: number }[];
  /** Island centre and radius on screen. */
  cx: number;
  cy: number;
  R: number;
  available: (n: MNode) => boolean;
}

export function pickSignposts(inp: SignpostInput, narrow: boolean): Set<MNode> {
  const S = narrow ? SIZE.signpostNarrow : SIZE.signpost;
  const D = 2 * inp.R;
  const quota = narrow ? Math.min(2, Math.max(1, Math.floor(D / 56))) : clamp(Math.floor(D / 56), 1, 4);
  const order = inp.brands
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => inp.available(b) && (b.hero < 999 || b.e.logo))
    .sort((a, b) => a.b.hero - b.b.hero || Number(!!b.b.e.logo) - Number(!!a.b.e.logo) || b.b.products.length - a.b.products.length || a.b.i - b.b.i);
  const chosen: { x: number; y: number }[] = [];
  const out = new Set<MNode>();
  for (const { b, i } of order) {
    if (out.size >= quota) break;
    const p = inp.pos[i];
    // Inside the island; on small islands a signpost may overlap the rim a little.
    if (Math.hypot(p.x - inp.cx, p.y - inp.cy) + Math.min(S, 0.25 * inp.R) > Math.max(inp.R, 22) + 4) continue;
    if (chosen.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 2 * S + 4)) continue;
    chosen.push(p);
    out.add(b);
  }
  return out;
}
