/* ==========================================================================
   Builds the label requests for the placer each frame: island pills (or
   edge chips in focus), Nestlé's name, group captions and brand names, with
   the obstacles they must avoid (badges, the lens, the chrome).
   ========================================================================== */

import type { LabelSpec } from "./labels";
import type { Rect } from "./layout";
import { countBrands, truncateWidth, type MNode, type Model } from "./model";
import type { LabelData } from "./render";
import type { Scene } from "./scene";
import { FONT, LOD, SIZE } from "./tokens";

export interface LabelContext {
  model: Model;
  scene: Scene;
  /** Labels that must show (hovered, selected, dragged, keyboard focus, search hit). */
  forced: Set<MNode>;
  hoverIsland: MNode | null;
  chrome: Rect[];
  narrow: boolean;
  /** Counts shown on pills ("32 of 50" when filtered). */
  pillCount: (c: MNode) => string;
  /** Only pills and forced labels (during programmatic flights). */
  minimal: boolean;
}

const chipFont = `600 12.5px ${FONT.sans}`;
const brandFont = (narrow: boolean, selected: boolean) => `${selected ? 600 : 500} ${narrow ? 11.5 : 12.5}px ${FONT.sans}`;
const brandFontFormer = (narrow: boolean) => `italic 500 ${narrow ? 11.5 : 12.5}px ${FONT.sans}`;
const groupFont = `700 11px ${FONT.sans}`;
const nestleFont = `600 18px ${FONT.serif}`;

/** Width of everything after the pill's name: count and tag. */
export function pillExtra(measure: (t: string, f: string) => number, count: string, tag: string | undefined, narrow: boolean): number {
  let w = measure(count, `400 ${narrow ? 11.5 : 13}px ${FONT.sans}`) + 6;
  if (tag && !narrow) w += measure(`· ${tag}`, `400 12px ${FONT.sans}`) + 6;
  return w;
}

export function buildLabels(ctx: LabelContext, measure: (t: string, f: string) => number): { specs: LabelSpec[]; obstacles: Rect[]; hard: Rect[]; arcs: ArcLabel[] } {
  const { scene, model } = ctx;
  const F = scene.frame;
  const specs: LabelSpec[] = [];
  const obstacles: Rect[] = [];
  const hard: Rect[] = [...ctx.chrome];
  const narrow = ctx.narrow;
  const focused = scene.focused;

  // Badges are obstacles for every label. Also noted: each island's furthest badge corner (signposts can
  // poke past the rim) and every badge's centre, for the "closer to a neighbour than to its own" check.
  const islandIndex = new Map(scene.layout.islands.map((is, j) => [is.node, j]));
  const islandBadges: Rect[][] = scene.layout.islands.map(() => []);
  const badges: { n: MNode; x: number; y: number; s: number }[] = [];
  for (const b of model.brands) {
    if (!F.vis[b.i] || F.beta[b.i] < 0.5) continue;
    const s = F.s[b.i];
    obstacles.push({ x0: F.sx[b.i] - s, y0: F.sy[b.i] - s, x1: F.sx[b.i] + s, y1: F.sy[b.i] + s });
    badges.push({ n: b, x: F.sx[b.i], y: F.sy[b.i], s });
    const j = b.category ? islandIndex.get(b.category) : undefined;
    if (j !== undefined) islandBadges[j].push(obstacles[obstacles.length - 1]);
  }
  if (F.vis[model.root.i] && F.alpha[model.root.i] > 0.3) {
    // Nestlé's disc and name are never covered.
    const s = F.s[model.root.i];
    const x = F.sx[model.root.i];
    const y = F.sy[model.root.i];
    hard.push({ x0: x - s, y0: y - s, x1: x + s, y1: y + s + 28 });
  }
  // The open brand's lens.
  if (scene.open && scene.fan && scene.lens.x > 0.2) {
    const b = scene.open;
    const box = scene.fan.box;
    obstacles.push({ x0: F.sx[b.i] + box.x0 - 16, y0: F.sy[b.i] + box.y0 - 28, x1: F.sx[b.i] + box.x1 + 16, y1: F.sy[b.i] + box.y1 + 16 });
  }

  // Nestlé
  if (F.vis[model.root.i] && F.alpha[model.root.i] > 0.3) {
    const x = F.sx[model.root.i];
    const y = F.sy[model.root.i];
    const s = F.s[model.root.i];
    specs.push({
      key: "nestle",
      text: "Nestlé",
      font: nestleFont,
      h: 22,
      prio: 95,
      forced: true,
      candidates: (w) => [{ x0: x - w / 2, y0: y + s + 6, x1: x + w / 2, y1: y + s + 28 }],
      data: { type: "nestle", node: model.root, alpha: F.alpha[model.root.i] } satisfies LabelData,
    });
  }

  // Category names (overview): set along the inside of each island's rim, curving with it, where they
  // cover the fewest logos (the top preferred). An island too small for its name gets it just outside.
  const islands = scene.layout.islands;
  const arcs: ArcLabel[] = [];
  const W = scene.vp.w;
  const H = scene.vp.h;
  islands.forEach((is, j) => {
    const cat = is.node;
    const c = scene.collapse.get(cat)!.x;
    const f = scene.focus.get(cat)!.x;
    if (c >= 0.6 || f >= 0.5) return;
    const a = (1 - smooth(0, 0.6, c)) * F.islandA[j];
    if (a < 0.02) return;
    const x = F.islandX[j];
    const y = F.islandY[j];
    const R = F.islandR[j];
    if (x + R < 0 || x - R > W || y + R < 0 || y - R > H) return;
    const others = islands.flatMap((_, o) => (o !== j && F.islandA[o] > 0.3 ? [{ x: F.islandX[o], y: F.islandY[o], r: F.islandR[o] }] : []));
    const arc = arcLabel({ x, y, R, name: cat.short, count: ctx.pillCount(cat), tag: narrow ? undefined : cat.meta?.tag, narrow, badges: islandBadges[j], others, avoid: hard, W, H, measure });
    if (!arc) return;
    arcs.push({ node: cat, alpha: a, hover: ctx.hoverIsland === cat, ...arc });
    // Other labels keep clear of the name.
    for (const g of arc.glyphs) obstacles.push({ x0: g.x - g.size * 0.55, y0: g.y - g.size * 0.55, x1: g.x + g.size * 0.55, y1: g.y + g.size * 0.55 });
  });
  for (const chip of F.chips) {
    const cat = chip.island.node;
    const count = ctx.pillCount(cat);
    const rect = { x0: chip.x, y0: chip.y - SIZE.chipH / 2, x1: chip.x + chip.w, y1: chip.y + SIZE.chipH / 2 };
    // A chip over a brand badge (after panning) steps back: faint, and clicks go to the brand. It eases
    // between the two, with a few px of hysteresis so a slow pan doesn't make it flicker.
    const slot = scene.chipSlots.get(cat);
    const m = slot && slot.cover.target < 1 ? 4 : 0;
    const overBadge = obstacles.some((o) => o.x0 < rect.x1 + m && o.x1 > rect.x0 - m && o.y0 < rect.y1 + m && o.y1 > rect.y0 - m);
    const want = overBadge ? 0.3 : 1;
    if (slot && slot.cover.target !== want) slot.cover.tween(want, 140, (u) => u);
    const cover = slot ? slot.cover.x : 1;
    specs.push({
      key: `chip:${cat.id}`,
      text: cat.short,
      font: chipFont,
      h: SIZE.chipH,
      prio: 92,
      // Always placed while shown (clicks are only taken once it's at least half visible).
      forced: true,
      candidates: () => [rect],
      data: { type: "chip", node: cat, count, small: true, alpha: chip.alpha * cover } satisfies LabelData,
    });
  }

  // The focused category's hub: nothing may cover it, and it gets its own caption (only while the hub
  // itself is on screen; the caption never detaches from it).
  const hubOn = focused && F.sx[focused.i] >= 0 && F.sx[focused.i] <= scene.vp.w && F.sy[focused.i] >= 0 && F.sy[focused.i] <= scene.vp.h;
  if (focused && hubOn && scene.focus.get(focused)!.x > 0.5 && F.vis[focused.i]) {
    const hx = F.sx[focused.i];
    const hy = F.sy[focused.i];
    const hr = (focused.e.logo ? 18 : Math.max(F.s[focused.i], 10) + 2) + 6;
    hard.push({ x0: hx - hr, y0: hy - hr, x1: hx + hr, y1: hy + hr });
    specs.push({
      key: `hub:${focused.id}`,
      text: focused.short.toUpperCase(),
      font: groupFont,
      h: 14,
      prio: 85,
      // Below the hub's keep-clear square; dropped (not moved) if the card or other chrome is in the way.
      candidates: (w) => [{ x0: hx - w / 2, y0: hy + hr + 4, x1: hx + w / 2, y1: hy + hr + 18 }],
      data: { type: "group", node: focused, soft: true, alpha: smooth(0.6, 1, scene.focus.get(focused)!.x) } satisfies LabelData,
    });
  }

  // Group captions (in focus, when the group is big enough).
  if (focused && !ctx.minimal) {
    const is = scene.layout.islandOf.get(focused)!;
    const f = scene.focus.get(focused)!.x;
    for (const u of is.units) {
      if (!u.isGroup) continue;
      const g = u.node;
      if (!F.vis[g.i] || 2 * F.s[g.i] < LOD.groupCaptionFrom * 0.5) continue;
      const x = F.sx[g.i];
      const yTop = F.sy[g.i] - F.ry[g.i];
      const text = g.label.toUpperCase();
      specs.push({
        key: `group:${g.id}`,
        text,
        texts: g.name.toUpperCase() !== text ? [g.name.toUpperCase(), text] : undefined,
        font: groupFont,
        h: 14,
        prio: narrow ? 30 : 60,
        candidates: (w) => [
          { x0: x - w / 2, y0: yTop + 4, x1: x + w / 2, y1: yTop + 18 },
          { x0: x - w / 2, y0: yTop - 16, x1: x + w / 2, y1: yTop - 2 },
        ],
        data: { type: "group", node: g, soft: true, alpha: smooth(0.7, 1, f) * F.alpha[g.i] } satisfies LabelData,
      });
    }
  }

  // Brand names.
  for (const b of model.brands) {
    const forced = ctx.forced.has(b);
    if (!forced && (ctx.minimal || !scene.brandLabelEligible(b))) continue;
    if (!F.vis[b.i] || F.alpha[b.i] < 0.05) continue;
    if (scene.open === b && scene.lens.x > 0.2) continue;
    const x = F.sx[b.i];
    const y = F.sy[b.i];
    const s = F.s[b.i];
    const m = b.products.length && F.mu[b.i] > 0.5 ? 8 : 3;
    const former = b.status === "former";
    const font = former ? brandFontFormer(narrow) : brandFont(narrow, forced);
    const lh = narrow ? 15 : 16;
    const prio = 40 + (b.e.logo ? 0 : narrow ? 30 : 10) + 3 * Math.sqrt(b.products.length) + 5 * scene.signpost.get(b)!.x + (forced ? 100 : 0);
    // Full name if it fits, the map label otherwise; a badge showing only initials may go shorter still,
    // since a cut name beats no name.
    const texts = [b.name, b.label];
    if (!b.e.logo && narrow) texts.push(truncateWidth(b.name, 84), truncateWidth(b.name, 62));
    const unique = [...new Set(texts)];
    const d = s * 0.72 + m;
    // A label that's closer to another badge than to its own reads as that badge's name.
    const near = badges.filter((o) => o.n !== b && Math.abs(o.x - x) < 220 && Math.abs(o.y - y) < 80);
    const accept = (r: Rect) => {
      const own = rectDist(r, x, y) - s;
      return near.every((o) => rectDist(r, o.x, o.y) - o.s >= own + 3);
    };
    specs.push({
      key: `brand:${b.id}`,
      accept,
      text: b.label,
      texts: unique.length > 1 ? unique : undefined,
      font,
      h: lh,
      prio,
      forced,
      candidates: (w) => {
        const out: Rect[] = [
          { x0: x - w / 2, y0: y + s + m, x1: x + w / 2, y1: y + s + m + lh },
          { x0: x + s + m, y0: y - lh / 2, x1: x + s + m + w, y1: y + lh / 2 },
          { x0: x - s - m - w, y0: y - lh / 2, x1: x - s - m, y1: y + lh / 2 },
          { x0: x - w / 2, y0: y - s - m - lh, x1: x + w / 2, y1: y - s - m },
          // Corners, for crowded spots.
          { x0: x + d, y0: y + d, x1: x + d + w, y1: y + d + lh },
          { x0: x + d, y0: y - d - lh, x1: x + d + w, y1: y - d },
          { x0: x - d - w, y0: y + d, x1: x - d, y1: y + d + lh },
          { x0: x - d - w, y0: y - d - lh, x1: x - d, y1: y - d },
        ];
        // Phones: below or above, slid sideways so the name hangs off one edge of the badge.
        const k = w / 2 - s;
        if (narrow && k > 0) {
          for (const dy of [y + s + m, y - s - m - lh]) for (const dx of [k, -k]) out.push({ x0: x - w / 2 + dx, y0: dy, x1: x + w / 2 + dx, y1: dy + lh });
        }
        return out;
      },
      data: { type: "brand", node: b, soft: former || b.status === "uncertain", alpha: F.alpha[b.i] } satisfies LabelData,
    });
  }

  void countBrands;
  return { specs, obstacles, hard, arcs };
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Distance from a point to a rectangle (0 if inside). */
function rectDist(r: Rect, x: number, y: number) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dy = Math.max(r.y0 - y, 0, y - r.y1);
  return Math.hypot(dx, dy);
}

/** A category name set along its island's rim at the overview, one positioned glyph at a time. */
export interface ArcLabel {
  node: MNode;
  alpha: number;
  hover: boolean;
  /** Set just outside the rim (the island is too small to hold the name inside). */
  outside: boolean;
  glyphs: { ch: string; x: number; y: number; rot: number; font: string; size: number; soft: boolean }[];
}

/** Per-character advances for a text in a font (prefix widths, so kerning is kept), measured once. */
const advanceCache = new Map<string, { chars: string[]; adv: number[]; total: number }>();
function advances(text: string, font: string, measure: (t: string, f: string) => number) {
  const key = `${font}|${text}`;
  let a = advanceCache.get(key);
  if (!a) {
    const chars = Array.from(text);
    const adv: number[] = [];
    let prev = 0;
    for (let i = 0; i < chars.length; i++) {
      const w = measure(chars.slice(0, i + 1).join(""), font);
      adv.push(w - prev);
      prev = w;
    }
    a = { chars, adv, total: prev };
    advanceCache.set(key, a);
  }
  return a;
}

/** Candidate centres for a name: near the top or the bottom only (text turned towards the vertical is hard to read). */
const ARC_MIDS = [-90, -72, -108, -55, -125, 90, 72, 108, 55, 125].map((d) => (d * Math.PI) / 180);

/**
 * Lays a category name (and its brand count) along a circle: inside the rim when it fits, trying the top
 * first and then other angles, at a smaller size or without the count if needed; otherwise just outside.
 * Each placement is scored by the logos it covers, glyphs off screen or under chrome and, outside, the
 * neighbouring islands it touches. Runs every frame, so sizes snap to half pixels (fonts and their
 * measurements repeat) and candidates are scored without building anything until one wins.
 */
function arcLabel(o: {
  x: number;
  y: number;
  R: number;
  name: string;
  count: string;
  tag?: string;
  narrow: boolean;
  badges: Rect[];
  others: { x: number; y: number; r: number }[];
  avoid: Rect[];
  W: number;
  H: number;
  measure: (t: string, f: string) => number;
}): Omit<ArcLabel, "node" | "alpha" | "hover"> | null {
  const { x, y, R } = o;
  const half = (v: number) => Math.round(v * 2) / 2;
  const base = half(Math.min(o.narrow ? 12.5 : 15, Math.max(o.narrow ? 10.5 : 13, R * 0.12)));
  const sizes = [...new Set([base, half(Math.max(o.narrow ? 9.5 : 10.5, base - 1.5))])];
  const extras = [...new Set([o.tag ? `${o.count} · ${o.tag}` : o.count, o.count, ""])];

  type Plan = { size: number; outside: boolean; r: number; span: number; glyphs: { ch: string; at: number; font: string; soft: boolean }[] };
  const plan = (extra: string, size: number, outside: boolean): Plan | null => {
    const r = outside ? R + 3 + size * 0.55 : R - 4 - size * 0.62;
    if (r < 8) return null;
    const runs = [{ text: o.name, font: `600 ${size}px ${FONT.sans}`, soft: false }];
    if (extra) runs.push({ text: ` ${extra}`, font: `400 ${half(size * 0.9)}px ${FONT.sans}`, soft: true });
    const glyphs: Plan["glyphs"] = [];
    let acc = 0;
    for (const run of runs) {
      const a = advances(run.text, run.font, o.measure);
      a.chars.forEach((ch, i) => {
        if (ch !== " ") glyphs.push({ ch, at: acc + a.adv[i] / 2, font: run.font, soft: run.soft });
        acc += a.adv[i];
      });
    }
    const span = acc / r;
    if (span > (outside ? 2.4 : 2.6)) return null;
    return { size, outside, r, span, glyphs };
  };
  // Where glyph g sits for a name centred at angle `mid`. The upper half reads clockwise and the lower half
  // anticlockwise, so letters are always upright.
  const angle = (p: Plan, mid: number, at: number) => {
    const top = Math.sin(mid) <= 0;
    return top ? mid - p.span / 2 + at / p.r : mid + p.span / 2 - at / p.r;
  };
  const score = (p: Plan, mid: number) => {
    // Upright at the top is best; every degree of tilt costs a little, and the bottom a little more.
    let sc = Math.min(Math.abs(mid + Math.PI / 2), Math.abs(mid - Math.PI / 2)) * 25 + (Math.sin(mid) <= 0 ? 0 : 8);
    const h = p.size * 0.5;
    for (const g of p.glyphs) {
      const th = angle(p, mid, g.at);
      const gx = x + p.r * Math.cos(th);
      const gy = y + p.r * Math.sin(th);
      for (const b of o.badges) if (gx + h > b.x0 && gx - h < b.x1 && gy + h > b.y0 && gy - h < b.y1) sc += 100;
      for (const b of o.avoid) if (gx + h > b.x0 && gx - h < b.x1 && gy + h > b.y0 && gy - h < b.y1) sc += 60;
      if (gx < 2 || gx > o.W - 2 || gy < 2 || gy > o.H - 2) sc += 30;
      if (p.outside) for (const n of o.others) if (Math.hypot(gx - n.x, gy - n.y) < n.r + h) sc += 100;
    }
    return sc;
  };
  const build = (p: Plan, mid: number): Omit<ArcLabel, "node" | "alpha" | "hover"> => {
    const top = Math.sin(mid) <= 0;
    return {
      outside: p.outside,
      glyphs: p.glyphs.map((g) => {
        const th = angle(p, mid, g.at);
        return { ch: g.ch, x: x + p.r * Math.cos(th), y: y + p.r * Math.sin(th), rot: top ? th + Math.PI / 2 : th - Math.PI / 2, font: g.font, size: p.size, soft: g.soft };
      }),
    };
  };

  let fallback: { score: number; p: Plan; mid: number } | null = null;
  for (const outside of [false, true]) {
    for (const extra of extras) {
      for (const size of sizes) {
        const p = plan(extra, size, outside);
        if (!p) continue;
        let best = Infinity;
        let bestMid = ARC_MIDS[0];
        for (const mid of ARC_MIDS) {
          const sc = score(p, mid);
          if (sc < best) {
            best = sc;
            bestMid = mid;
          }
        }
        // Good enough: covers no logo, nothing off screen or under chrome.
        if (best < 30) return build(p, bestMid);
        // Otherwise remember it, preferring earlier (richer, larger, inside) layouts on near-ties.
        if (!fallback || best < fallback.score - 20) fallback = { score: best, p, mid: bestMid };
      }
    }
  }
  return fallback ? build(fallback.p, fallback.mid) : null;
}
