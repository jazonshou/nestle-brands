/* ==========================================================================
   Scene: every animated value on the map, and the per-frame resolution of
   positions, sizes and level of detail into a FrameCache that the label
   placer, renderer and hit tester read. Positions are derived, never tweened:

     islandCentre = wheel + drop
     unitPos      = islandCentre + S(f)·(unit offset + drop)     S = stretch
     memberPos    = unitPos + member offset + drop
     product      = brand (screen) + orbit/fan offset (screen)
   ========================================================================== */

import { AnimValue, clamp, easeInOutCubic, lerp, smoothstep } from "./anim";
import type { View } from "./camera";
import { fanGeometry, freeArea, screenRadius, type Fan, type Stretch, type Viewport } from "./geometry";
import type { Island, Layout, Unit } from "./layout";
import type { MNode, Model } from "./model";
import { LOD, MOTION, SIZE } from "./tokens";
import type { Status } from "./types";

export interface Drop {
  x: number;
  y: number;
}

export interface ChipSlotState {
  x: AnimValue;
  y: AnimValue;
  /** Fades a chip in after it jumps to a new slot (so it never sits on top of the chip just clicked). */
  a: AnimValue;
  /** Dims a chip that's over brand badges (after a pan), so the badges show and take the clicks. */
  cover: AnimValue;
  w: number;
  /** Canvas chip (wide) vs. DOM strip pill (narrow). */
  canvas: boolean;
}

export interface ChipFrame {
  island: Island;
  x: number;
  y: number;
  w: number;
  alpha: number;
}

/** Per-frame resolved values, indexed by MNode.i. */
export class FrameCache {
  sx: Float32Array;
  sy: Float32Array;
  /** Drawn screen radius. */
  s: Float32Array;
  alpha: Float32Array;
  /** Dot → badge cross-fade (0 = dot, 1 = badge). */
  beta: Float32Array;
  /** Visibility of tucked moons. */
  mu: Float32Array;
  vis: Uint8Array;
  /** Islands: screen centre/radius (after collapse) in island order. */
  islandX: Float32Array;
  islandY: Float32Array;
  islandR: Float32Array;
  /** Content alpha of each island (fades as it collapses). */
  islandA: Float32Array;
  chips: ChipFrame[] = [];
  view: View = { x: 0, y: 0, k: 1 };
  /** Group hubs and gates (screen), by group MNode.i. */
  hubX: Float32Array;
  hubY: Float32Array;
  /** Group discs' screen semi-axes (they're ellipses when the island's stretch reaches its groups); s is the smaller. */
  rx: Float32Array;
  ry: Float32Array;
  constructor(n: number, islands: number) {
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.s = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.beta = new Float32Array(n);
    this.mu = new Float32Array(n);
    this.vis = new Uint8Array(n);
    this.hubX = new Float32Array(n);
    this.hubY = new Float32Array(n);
    this.rx = new Float32Array(n);
    this.ry = new Float32Array(n);
    this.islandX = new Float32Array(islands);
    this.islandY = new Float32Array(islands);
    this.islandR = new Float32Array(islands);
    this.islandA = new Float32Array(islands);
  }
}

const ease = easeInOutCubic;

export class Scene {
  readonly model: Model;
  layout: Layout;
  vp: Viewport;
  frame: FrameCache;

  // Island-level
  readonly collapse = new Map<MNode, AnimValue>();
  readonly focus = new Map<MNode, AnimValue>();
  readonly stretch = new Map<MNode, Stretch>();
  /** Screen slots for chips (wide) or the strip (narrow) of every other island while a category is focused. Positions ease. */
  chipSlots = new Map<MNode, ChipSlotState>();
  readonly chipsVisible = new AnimValue(0);
  readonly nestleFade = new AnimValue(1);

  // Drops (session-long), in each body's natural frame (units: unstretched).
  readonly islandDrop = new Map<MNode, Drop>();
  readonly unitDrop = new Map<MNode, Drop>();
  readonly memberDrop = new Map<MNode, Drop>();
  readonly nestleDrop: Drop = { x: 0, y: 0 };

  // Node-level
  readonly lift = new Map<MNode, AnimValue>();
  /** Products: 0 = tucked on the rim, 1 = peek ring, 2 = open fan slot. */
  readonly orbit = new Map<MNode, AnimValue>();
  readonly productLabel = new Map<MNode, AnimValue>();
  readonly filterA = new Map<MNode, AnimValue>();
  readonly signpost = new Map<MNode, AnimValue>();
  readonly logoA = new Map<MNode, AnimValue>();

  // Brand open
  open: MNode | null = null;
  readonly lens = new AnimValue(0);
  readonly dimOthers = new AnimValue(0);
  fan: Fan | null = null;
  selectedProduct: MNode | null = null;

  // Highlights (legend hover, live search)
  highlightSet: Set<MNode> | null = null;
  readonly highlight = new AnimValue(0);
  hiddenStatuses = new Set<Status>();

  // Feedback
  hovered: MNode | null = null;
  dragged: MNode | null = null;
  keyFocus: MNode | null = null;
  pulse: { node: MNode; start: number } | null = null;
  focused: MNode | null = null; // focused category
  focusedGroup: MNode | null = null;

  /** Signpost threshold: keyed to the largest brand at fit-all so the overview is all dots. */
  b0 = 9;
  kFitAll = 0.25;
  private fans = new Map<MNode, Fan>();
  /** Text measurement (set by main once the canvas exists). */
  measure: (text: string, font: string) => number = (t) => t.length * 6.9;

  constructor(model: Model, layout: Layout, vp: Viewport) {
    this.model = model;
    this.layout = layout;
    this.vp = vp;
    this.frame = new FrameCache(model.nodes.length, layout.islands.length);
    for (const c of model.categories) {
      this.collapse.set(c, new AnimValue(0));
      this.focus.set(c, new AnimValue(0));
    }
    for (const n of model.nodes) {
      if (n.kind === "brand" || n.kind === "category" || n.kind === "root" || n.kind === "group") this.lift.set(n, new AnimValue(1));
      if (n.kind === "brand") {
        this.filterA.set(n, new AnimValue(1));
        this.signpost.set(n, new AnimValue(0));
        this.logoA.set(n, new AnimValue(0));
      }
      if (n.kind === "product") {
        this.orbit.set(n, new AnimValue(0));
        this.productLabel.set(n, new AnimValue(0));
        this.filterA.set(n, new AnimValue(1));
      }
    }
  }

  setLayout(layout: Layout) {
    this.layout = layout;
  }

  setViewport(vp: Viewport) {
    this.vp = vp;
    this.fans.clear();
    if (this.open) this.fan = this.fanFor(this.open);
  }

  /** Fan geometry for a brand at the current viewport (also gives the tucked/peek angles). */
  fanFor(b: MNode): Fan {
    let f = this.fans.get(b);
    if (!f) {
      // Measured bold, since hovered and selected rows are drawn bold and must fit too.
      const font = `600 12.5px "DM Sans", sans-serif`;
      const small = `400 11px "DM Sans", sans-serif`;
      let labelW = 0;
      for (const p of b.products) {
        const suffix = p.status !== b.status ? productSuffix(p) : "";
        labelW = Math.max(labelW, this.measure(p.label, font) + (suffix ? this.measure(` ${suffix}`, small) : 0));
      }
      f = fanGeometry(b.products.length, this.vp, freeArea("brand", this.vp), labelW + 4);
      this.fans.set(b, f);
    }
    return f;
  }

  // --- Positions (world) ---------------------------------------------------

  islandCentre(is: Island) {
    const d = this.islandDrop.get(is.node);
    return { x: is.x + (d?.x ?? 0), y: is.y + (d?.y ?? 0) };
  }

  /** The stretch currently applied to an island's unit centres. */
  stretchOf(is: Island): Stretch {
    const s = this.stretch.get(is.node);
    const f = this.focus.get(is.node)!.x;
    return s ? { sx: lerp(1, s.sx, f), sy: lerp(1, s.sy, f) } : { sx: 1, sy: 1 };
  }

  /**
   * The stretch applied to member offsets inside an island's groups. On phones the whole island takes the
   * stretch (groups become ellipses), so packed groups open up as much as the gaps between units do. It is
   * still one linear map of the layout with rigid badges, so it can't create overlaps or crossings either.
   */
  memberStretchOf(is: Island): Stretch {
    return this.vp.mode === "narrow" ? this.stretchOf(is) : { sx: 1, sy: 1 };
  }

  unitOffset(u: Unit) {
    const d = this.unitDrop.get(u.node);
    return { x: u.ax + (d?.x ?? 0), y: u.ay + (d?.y ?? 0) };
  }

  unitWorld(is: Island, u: Unit) {
    const c = this.islandCentre(is);
    const s = this.stretchOf(is);
    const o = this.unitOffset(u);
    return { x: c.x + o.x * s.sx, y: c.y + o.y * s.sy };
  }

  /** World position of any placed node (brand, group, category, Nestlé). */
  worldOf(n: MNode): { x: number; y: number } {
    if (n.kind === "root") return { ...this.nestleDrop };
    if (n.kind === "category") return this.islandCentre(this.layout.islandOf.get(n)!);
    const brand = n.kind === "product" ? n.brand! : n;
    const is = this.layout.islandOf.get(brand.category!)!;
    const u = this.layout.unitOf.get(brand)!;
    const up = this.unitWorld(is, u);
    if (brand.kind === "group" || !u.isGroup) return up;
    const m = this.layout.memberOf.get(brand)!;
    const d = this.memberDrop.get(brand);
    const M = this.memberStretchOf(is);
    return { x: up.x + (m.lx + (d?.x ?? 0)) * M.sx, y: up.y + (m.ly + (d?.y ?? 0)) * M.sy };
  }

  // --- Per frame -------------------------------------------------------------

  resolve(view: View, now: number) {
    const F = this.frame;
    F.view = view;
    const k = view.k;
    const W = this.vp.w;
    const H = this.vp.h;
    const narrow = this.vp.mode === "narrow";
    const margin = 64;
    const sMin = narrow ? SIZE.focusMinBadgeNarrow : SIZE.focusMinBadge;
    const S_sign = narrow ? SIZE.signpostNarrow : SIZE.signpost;
    const sOpen = narrow ? SIZE.openBadgeNarrow : SIZE.openBadge;
    const hl = this.highlight.x;
    const dim = this.dimOthers.x;
    const lineage = this.open ? lineageOf(this.open) : null;
    F.vis.fill(0);

    // Nestlé
    const root = this.model.root;
    const nx = this.nestleDrop.x * k + view.x;
    const ny = this.nestleDrop.y * k + view.y;
    F.sx[root.i] = nx;
    F.sy[root.i] = ny;
    F.s[root.i] = Math.max(SIZE.nestleMin * (narrow ? 24 / 28 : 1), 64 * Math.min(k, 1.2)) * this.lift.get(root)!.x;
    F.alpha[root.i] = this.nestleFade.x * (lineage && !lineage.has(root) ? lerp(1, 0.25, dim) : 1);
    F.vis[root.i] = F.alpha[root.i] > 0.01 ? 1 : 0;

    F.chips.length = 0;
    this.layout.islands.forEach((is, j) => {
      const cat = is.node;
      const c = this.collapse.get(cat)!.x;
      const f = this.focus.get(cat)!.x;
      const centre = this.islandCentre(is);
      const liveX = centre.x * k + view.x;
      const liveY = centre.y * k + view.y;
      const liveR = Math.max(is.R * k, narrow ? 22 : 0);
      const slot = this.chipSlots.get(cat);
      const e = ease(clamp(c, 0, 1));
      const slotX = slot ? slot.x.x + (slot.canvas ? 13 : 0) : 0;
      const slotY = slot ? slot.y.x : 0;
      const px = slot ? lerp(liveX, slotX, e) : liveX;
      const py = slot ? lerp(liveY, slotY, e) : liveY;
      const pr = lerp(liveR, 5, e);
      F.islandX[j] = px;
      F.islandY[j] = py;
      F.islandR[j] = pr;
      const contentA = (1 - smoothstep(0, 0.4, c)) * (lineage && cat !== this.open?.category ? lerp(1, 0.25, dim) : 1);
      F.islandA[j] = contentA;
      const chipA = slot && slot.canvas ? smoothstep(0.6, 1, c) * this.chipsVisible.x * slot.a.x : 0;
      if (slot && chipA > 0.02) F.chips.push({ island: is, x: slot.x.x, y: slot.y.x, w: slot.w, alpha: chipA });

      // Category hub
      F.sx[cat.i] = px;
      F.sy[cat.i] = py;
      F.s[cat.i] = (f > 0.01 ? lerp(Math.max(3.5, 10 * k), 10, f) : Math.max(3.5, 10 * k) * Math.min(1, pr / Math.max(liveR, 1))) * this.lift.get(cat)!.x;
      F.alpha[cat.i] = contentA;
      // Culling uses the island's stretched extent (a focused island reaches well past its disc), and never
      // skips the focused island or the open brand's, whose contents must stay current.
      const St = this.stretchOf(is);
      const reach = pr * Math.max(St.sx, St.sy) + SIZE.badgeMax;
      const keep = cat === this.focused || cat === this.open?.category;
      const onScreen = keep || (px + reach > -margin && px - reach < W + margin && py + reach > -margin && py - reach < H + margin);
      F.vis[cat.i] = onScreen && contentA > 0.01 ? 1 : 0;
      if (!onScreen || contentA <= 0.01) return;

      // Contents shrink into the collapsing disc.
      const scale = liveR > 0 ? pr / liveR : 1;
      const S = this.stretchOf(is);
      const M = this.memberStretchOf(is);
      for (const u of is.units) {
        const o = this.unitOffset(u);
        const ux = centre.x + o.x * S.sx;
        const uy = centre.y + o.y * S.sy;
        const usx = px + (ux * k + view.x - liveX) * scale;
        const usy = py + (uy * k + view.y - liveY) * scale;
        if (u.isGroup) {
          const g = u.node;
          F.sx[g.i] = usx;
          F.sy[g.i] = usy;
          F.rx[g.i] = u.R * k * scale * M.sx;
          F.ry[g.i] = u.R * k * scale * M.sy;
          F.s[g.i] = Math.min(F.rx[g.i], F.ry[g.i]);
          F.hubX[g.i] = usx + u.hx * k * scale * M.sx;
          F.hubY[g.i] = usy + u.hy * k * scale * M.sy;
          F.alpha[g.i] = contentA * (lineage && !lineage.has(g) ? lerp(1, 0.25, dim) : 1);
          F.vis[g.i] = F.s[g.i] > LOD.skip && inView(usx, usy, Math.max(F.rx[g.i], F.ry[g.i]), W, H, margin) ? 1 : 0;
          for (const m of u.members) {
            const d = this.memberDrop.get(m.node);
            const mx = usx + (m.lx + (d?.x ?? 0)) * k * scale * M.sx;
            const my = usy + (m.ly + (d?.y ?? 0)) * k * scale * M.sy;
            this.resolveBrand(m.node, mx, my, k, scale, f, sMin, S_sign, sOpen, contentA, hl, dim, lineage, W, H, margin);
          }
        } else {
          this.resolveBrand(u.node, usx, usy, k, scale, f, sMin, S_sign, sOpen, contentA, hl, dim, lineage, W, H, margin);
        }
      }
    });

    // Products ride on their brand, in screen space.
    for (const b of this.model.brands) {
      if (!b.products.length) continue;
      const bi = b.i;
      const visible = F.vis[bi] === 1;
      const fan = this.fanFor(b);
      const s = F.s[bi];
      const isOpen = this.open === b;
      for (let j = 0; j < b.products.length; j++) {
        const p = b.products[j];
        const o = this.orbit.get(p)!.x;
        const fa = this.filterA.get(p)!.x;
        const slot = fan.slots[Math.min(j, fan.slots.length - 1)];
        const hasSlot = j < fan.slots.length && !(fan.more > 0 && j >= fan.slots.length - 1);
        const theta = slot ? (hasSlot ? slot.theta : slot.theta) : 0;
        const tucked = s + 4.5;
        const peek = s + 14;
        let x: number;
        let y: number;
        if (o <= 1 || !hasSlot) {
          const r = lerp(tucked, peek, Math.min(1, o));
          x = Math.cos(theta) * r;
          y = Math.sin(theta) * r;
        } else {
          const t = o - 1;
          x = lerp(Math.cos(theta) * peek, slot.x, t);
          y = lerp(Math.sin(theta) * peek, slot.y, t);
        }
        F.sx[p.i] = F.sx[bi] + x;
        F.sy[p.i] = F.sy[bi] + y;
        F.s[p.i] = o <= 1 ? lerp(j < 24 ? 2.2 : 0, 3.5, Math.min(1, o)) : lerp(3.5, 4.5, o - 1);
        const showTucked = F.mu[bi];
        const a = o > 0.02 ? 1 : showTucked * (j < 24 ? 1 : 0);
        F.alpha[p.i] = a * F.alpha[bi] * fa * (isOpen || o > 1 ? 1 : 1);
        F.vis[p.i] = visible && F.alpha[p.i] > 0.01 && (hasSlot || o <= 1) ? 1 : 0;
      }
    }

    // Pulse expiry
    if (this.pulse && now > this.pulse.start + MOTION.pulseMs) this.pulse = null;
  }

  private resolveBrand(
    b: MNode, x: number, y: number, k: number, scale: number, f: number, sMin: number, S_sign: number, sOpen: number,
    contentA: number, hl: number, dim: number, lineage: Set<MNode> | null, W: number, H: number, margin: number,
  ) {
    const F = this.frame;
    const i = b.i;
    F.sx[i] = x;
    F.sy[i] = y;
    let s = screenRadius(b.r, k);
    if (f > 0) s = Math.max(s, sMin * smoothstep(0.5, 1, f));
    // Moons follow the brand's natural size, not its signpost enlargement.
    const natural = s * scale;
    const sign = this.signpost.get(b)!.x;
    if (sign > 0) s = lerp(s, Math.max(s, S_sign), sign);
    if (this.open === b) s = lerp(s, sOpen, this.lens.x);
    s *= scale * this.lift.get(b)!.x;
    F.s[i] = s;
    const beta = Math.max(smoothstep(this.b0, this.b0 + LOD.badgeSpan, s), sign, this.open === b ? 1 : 0);
    F.beta[i] = beta;
    F.mu[i] = smoothstep(LOD.moonsFrom, LOD.moonsTo, natural);
    let a = contentA * this.filterA.get(b)!.x;
    if (this.highlightSet && !this.highlightSet.has(b)) a *= lerp(1, 0.35, hl);
    if (lineage && !lineage.has(b)) a *= lerp(1, 0.25, dim);
    F.alpha[i] = a;
    F.vis[i] = s > LOD.skip && a > 0.01 && inView(x, y, s, W, H, margin) ? 1 : 0;
  }

  /** Can this brand's name be placed now? */
  brandLabelEligible(b: MNode): boolean {
    const F = this.frame;
    if (!F.vis[b.i]) return false;
    const is = this.layout.islandOf.get(b.category!)!;
    const f = this.focus.get(is.node)!.x;
    const islandD = 2 * is.R * F.view.k;
    return F.s[b.i] >= LOD.labelOn && (f > 0.5 || islandD >= LOD.islandLabelsFrom);
  }

  isFiltered(n: MNode): boolean {
    if (n.kind === "brand") return this.hiddenStatuses.has(n.status);
    if (n.kind === "product") return this.hiddenStatuses.has(n.status) || (!!n.brand && this.hiddenStatuses.has(n.brand.status));
    return false;
  }
}

function inView(x: number, y: number, r: number, W: number, H: number, m: number) {
  return x + r > -m && x - r < W + m && y + r > -m && y - r < H + m;
}

/** A node plus everything above it, and (for brands) its products. */
export function lineageOf(n: MNode): Set<MNode> {
  const out = new Set<MNode>();
  for (let p: MNode | null = n; p; p = p.parent) out.add(p);
  if (n.kind === "brand") for (const p of n.products) out.add(p);
  if (n.kind === "product" && n.brand) {
    for (const p of n.brand.products) out.add(p);
    out.add(n.brand);
  }
  return out;
}

/** Short status note shown after a product name when it differs from its brand. */
export function productSuffix(p: MNode): string {
  switch (p.status) {
    case "former":
      return "sold";
    case "licensed":
      return "licensed";
    case "partial":
      return "JV";
    case "transition":
      return "being sold";
    case "uncertain":
      return "?";
    default:
      return "";
  }
}
