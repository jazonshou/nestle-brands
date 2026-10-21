/* ==========================================================================
   Canvas renderer. One draw per frame, in fixed passes, in CSS px with the
   device-pixel ratio applied once. Records a hit list as it draws, so what
   can be clicked always matches what is on screen.
   ========================================================================== */

import { clamp, lerp, smoothstep } from "./anim";
import type { Atlas } from "./atlas";
import type { Fan } from "./geometry";
import type { ArcLabel } from "./labeling";
import type { Placed } from "./labels";
import type { Island, Rect } from "./layout";
import { statusTag, type MNode, type Model } from "./model";
import type { Scene } from "./scene";
import { COLORS, FONT, LOD, MOTION } from "./tokens";

export type HitKind = "fanRow" | "more" | "open" | "chip" | "label" | "brand" | "group" | "hub" | "nestle" | "island";

export interface Hit {
  kind: HitKind;
  node: MNode;
  prio: number;
  // circle (an ellipse when aspect ≠ 1: r is the horizontal semi-axis, r·aspect the vertical)
  x: number;
  y: number;
  r: number;
  aspect: number;
  // rect (when w > 0)
  rx: number;
  ry: number;
  w: number;
  h: number;
}

const PRIO: Record<HitKind, number> = { fanRow: 9, more: 9, open: 8, chip: 7, label: 6, brand: 5, group: 4, hub: 3, nestle: 3, island: 1 };

export interface RenderState {
  focused: MNode | null;
  open: MNode | null;
  selectedProduct: MNode | null;
  hoverIsland: MNode | null;
  coarse: boolean;
  dip: number;
  /** Category names along the island rims (overview). */
  arcs: ArcLabel[];
}

const mixCache = new Map<string, string>();
function mix(hex: string, amount: number): string {
  const key = `${hex}|${amount}`;
  let v = mixCache.get(key);
  if (!v) {
    const a = hexRgb(COLORS.bg);
    const b = hexRgb(hex);
    v = `rgb(${Math.round(a[0] + (b[0] - a[0]) * amount)},${Math.round(a[1] + (b[1] - a[1]) * amount)},${Math.round(a[2] + (b[2] - a[2]) * amount)})`;
    mixCache.set(key, v);
  }
  return v;
}
function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  hits: Hit[] = [];
  private dpr = 1;
  private w = 0;
  private h = 0;
  private shadow: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.shadow = makeShadowSprite();
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  /** A circle hit; `aspect` (height / width) makes it an ellipse with horizontal semi-axis r. */
  private hit(kind: HitKind, node: MNode, x: number, y: number, r: number, aspect = 1) {
    this.hits.push({ kind, node, prio: PRIO[kind], x, y, r, aspect, rx: 0, ry: 0, w: 0, h: 0 });
  }

  private hitRect(kind: HitKind, node: MNode, r: Rect) {
    this.hits.push({ kind, node, prio: PRIO[kind], x: 0, y: 0, r: 0, aspect: 1, rx: r.x0, ry: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 });
  }

  draw(scene: Scene, model: Model, atlas: Atlas, labels: Placed[], st: RenderState, now: number) {
    const ctx = this.ctx;
    const F = scene.frame;
    this.hits.length = 0;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 1. Background, with a soft vignette and a tint toward the focused category.
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    const vg = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.35, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    vg.addColorStop(0, "rgba(241,233,221,0)");
    vg.addColorStop(1, "rgba(241,233,221,1)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.w, this.h);
    if (st.focused) {
      const f = scene.focus.get(st.focused)!.x;
      if (f > 0) {
        ctx.fillStyle = rgba(st.focused.color, 0.05 * f);
        ctx.fillRect(0, 0, this.w, this.h);
      }
    }

    const islands = scene.layout.islands;
    const root = model.root;
    const nFade = scene.nestleFade.x;

    // 2. Spokes from Nestlé's rim to each island's rim.
    if (nFade > 0.01) {
      for (let j = 0; j < islands.length; j++) {
        const is = islands[j];
        const c = scene.collapse.get(is.node)!.x;
        const a = 0.45 * (1 - c) * nFade * F.islandA[j];
        if (a < 0.01) continue;
        const x0 = F.sx[root.i];
        const y0 = F.sy[root.i];
        const x1 = F.islandX[j];
        const y1 = F.islandY[j];
        const d = Math.hypot(x1 - x0, y1 - y0) || 1;
        const r0 = F.s[root.i] + 2;
        const r1 = F.islandR[j] + 2;
        if (d <= r0 + r1) continue;
        const hover = st.hoverIsland === is.node;
        ctx.beginPath();
        ctx.moveTo(x0 + ((x1 - x0) / d) * r0, y0 + ((y1 - y0) / d) * r0);
        ctx.lineTo(x1 - ((x1 - x0) / d) * r1, y1 - ((y1 - y0) / d) * r1);
        const spoke = is.node.meta?.spoke;
        ctx.setLineDash(spoke === "partial" ? [6, 5] : spoke === "former" ? [1.5, 5] : []);
        ctx.lineCap = spoke === "former" ? "round" : "butt";
        ctx.lineWidth = hover ? 3 : spoke === "former" ? 2.5 : 2;
        ctx.strokeStyle = rgba(spoke === "former" ? COLORS.former : is.node.color, hover ? 0.9 * nFade : a);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineCap = "butt";
    }

    // On touch screens, brands on small unfocused islands are too small to tap: the tap opens the island instead.
    const tiny = new Set<MNode>();
    if (st.coarse) {
      for (let j = 0; j < islands.length; j++) {
        if (2 * F.islandR[j] < 100 && scene.focus.get(islands[j].node)!.x < 0.5) tiny.add(islands[j].node);
      }
    }
    const tappable = (b: MNode) =>
      (F.s[b.i] >= LOD.interactiveFrom || scene.signpost.get(b)!.x > 0.5) && !(b.category && tiny.has(b.category));

    // 3. Island discs.
    for (let j = 0; j < islands.length; j++) {
      const is = islands[j];
      const R = F.islandR[j];
      const x = F.islandX[j];
      const y = F.islandY[j];
      if (x + R < -40 || x - R > this.w + 40 || y + R < -40 || y - R > this.h + 40) continue;
      const c = scene.collapse.get(is.node)!.x;
      if (c >= 0.999) continue;
      const f = scene.focus.get(is.node)!.x;
      const tint = (1 - f) * (1 - smoothstep(0.7, 1, c));
      const former = is.node.meta?.spoke === "former";
      ctx.beginPath();
      ctx.arc(x, y, R, 0, Math.PI * 2);
      if (tint > 0.01) {
        ctx.globalAlpha = tint;
        ctx.fillStyle = mix(is.node.color, former ? 0.06 : 0.09);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      const hover = st.hoverIsland === is.node;
      const borderA = (hover ? 0.85 : 0.4) * Math.max(tint, c > 0 ? 1 : 0) * (f > 0 ? 1 - f : 1);
      if (borderA > 0.01) {
        ctx.lineWidth = hover ? 1.5 : 1;
        ctx.setLineDash(is.node.meta?.border === "dashed" ? [5, 4] : []);
        ctx.strokeStyle = rgba(is.node.color, borderA);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (f < 0.5) this.hit("island", is.node, x, y, Math.max(R, 22) + 6);
    }

    // 4. Group discs.
    for (const is of islands) {
      const j = islands.indexOf(is);
      const ia = F.islandA[j];
      if (ia < 0.01) continue;
      const islandD = 2 * F.islandR[j];
      const f = scene.focus.get(is.node)!.x;
      if (islandD < LOD.groupFillFrom && f < 0.3) continue;
      for (const u of is.units) {
        if (!u.isGroup) continue;
        const g = u.node;
        if (!F.vis[g.i]) continue;
        ctx.globalAlpha = F.alpha[g.i] * Math.max(smoothstep(LOD.groupFillFrom, LOD.groupFillFrom + 60, islandD), f);
        ctx.beginPath();
        ctx.ellipse(F.sx[g.i], F.sy[g.i], F.rx[g.i], F.ry[g.i], 0, 0, Math.PI * 2);
        ctx.fillStyle = rgba(is.node.color, 0.07);
        ctx.fill();
        if (f > 0.3) {
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = rgba(is.node.color, 0.22);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.globalAlpha = 1;
        if (f > 0.5) this.hit("group", g, F.sx[g.i], F.sy[g.i], F.rx[g.i], F.ry[g.i] / F.rx[g.i]);
      }
    }

    // 5. Hub → brand, hub → group gate, group hub → member lines.
    for (let j = 0; j < islands.length; j++) {
      const is = islands[j];
      const ia = F.islandA[j];
      if (ia < 0.01) continue;
      const f = scene.focus.get(is.node)!.x;
      const D = 2 * F.islandR[j];
      const lineA = Math.max(0.28 * smoothstep(0.6, 1, f), 0.16 * smoothstep(LOD.islandLabelsFrom, 600, D));
      if (lineA < 0.01) continue;
      this.drawHubLines(is, scene, lineA * ia);
    }

    // 6. Lineage of the hovered or selected node.
    const lineageNode = scene.hovered && scene.hovered.kind !== "category" ? scene.hovered : st.open;
    if (lineageNode && !scene.dragged) this.drawLineage(lineageNode, scene, model);

    // 7. Status dots (brands that aren't badges yet).
    for (const b of model.brands) {
      const i = b.i;
      if (!F.vis[i]) continue;
      const beta = F.beta[i];
      if (beta >= 0.999) continue;
      const a = F.alpha[i] * (1 - beta);
      if (a < 0.01) continue;
      const r = Math.max(1.6, 0.55 * F.s[i]);
      this.drawDot(F.sx[i], F.sy[i], r, b, a);
      if (tappable(b)) this.hit("brand", b, F.sx[i], F.sy[i], F.s[i]);
    }

    // 8. Product moons and peek dots (not the open brand's fan, which is drawn on the lens).
    for (const b of model.brands) {
      if (!b.products.length || !F.vis[b.i] || b === st.open) continue;
      for (const p of b.products) {
        if (!F.vis[p.i]) continue;
        const o = scene.orbit.get(p)!.x;
        const a = F.alpha[p.i] * (o > 0.02 ? 1 : F.mu[b.i]);
        if (a < 0.01) continue;
        this.drawDot(F.sx[p.i], F.sy[p.i], F.s[p.i], p, a, true);
        if (o > 0.6) this.hit("fanRow", p, F.sx[p.i], F.sy[p.i], 8);
      }
    }

    // 9. Badges.
    const drawLast: MNode[] = [];
    for (const b of model.brands) {
      const i = b.i;
      if (!F.vis[i] || F.beta[i] <= 0.001) continue;
      if (b === scene.hovered || b === scene.dragged || b === st.open) {
        drawLast.push(b);
        continue;
      }
      this.drawBadge(b, scene, atlas, F.sx[i], F.sy[i], F.s[i], F.alpha[i] * F.beta[i], false);
      if (tappable(b)) this.hit("brand", b, F.sx[i], F.sy[i], F.s[i]);
    }

    // 10. Category hubs and Nestlé.
    for (let j = 0; j < islands.length; j++) {
      const cat = islands[j].node;
      if (!F.vis[cat.i]) continue;
      const f = scene.focus.get(cat)!.x;
      const x = F.sx[cat.i];
      const y = F.sy[cat.i];
      ctx.globalAlpha = F.alpha[cat.i];
      const cell = f > 0.5 && cat.e.logo ? atlas.cell(cat) : null;
      if (cell) {
        const r = 18;
        this.drawShadow(x, y, r, 0.18);
        ctx.drawImage(atlas.canvas, cell.x, cell.y, cell.size, cell.size, x - r, y - r, 2 * r, 2 * r);
        ctx.lineWidth = 2;
        ctx.strokeStyle = cat.color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        this.hit("hub", cat, x, y, r + 4);
      } else {
        const r = F.s[cat.i];
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = cat.color;
        ctx.fill();
        if (f > 0.3) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#fff";
          ctx.stroke();
        }
        if (f > 0.5) this.hit("hub", cat, x, y, Math.max(r, 10) + 4);
      }
      ctx.globalAlpha = 1;
    }
    if (F.vis[root.i]) {
      const x = F.sx[root.i];
      const y = F.sy[root.i];
      const r = F.s[root.i];
      ctx.globalAlpha = F.alpha[root.i];
      this.drawShadow(x, y, r, 0.22);
      const cell = atlas.cell(root);
      if (cell) ctx.drawImage(atlas.canvas, cell.x, cell.y, cell.size, cell.size, x - r, y - r, 2 * r, 2 * r);
      else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.card;
        ctx.fill();
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLORS.root;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      this.hit("nestle", root, x, y, r + 4);
    }

    // 10b. Category names along the island rims (overview).
    for (const arc of st.arcs) this.drawArc(arc);

    // 11. Lens with the open brand's product fan.
    if (st.open && scene.lens.x > 0.01 && scene.fan && F.vis[st.open.i]) this.drawLens(st.open, scene, atlas, scene.fan, st);

    // 12. Hovered or dragged node on top.
    for (const b of drawLast) {
      if (b === st.open && scene.lens.x > 0.01) continue;
      const i = b.i;
      if (b === scene.dragged) this.drawShadow(F.sx[i], F.sy[i], F.s[i], 0.22);
      this.drawBadge(b, scene, atlas, F.sx[i], F.sy[i], F.s[i], F.alpha[i] * F.beta[i], true);
      this.hit("brand", b, F.sx[i], F.sy[i], Math.max(F.s[i], 6));
    }

    // 13. Labels and pills.
    for (const l of labels) this.drawLabel(l);

    // 15. Selection ring, keyboard focus ring, search pulse.
    if (st.selectedProduct && F.vis[st.selectedProduct.i]) {
      const p = st.selectedProduct;
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.ink;
      ctx.beginPath();
      ctx.arc(F.sx[p.i], F.sy[p.i], F.s[p.i] + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (scene.keyFocus && (scene.keyFocus.kind === "category" || F.vis[scene.keyFocus.i])) {
      const n = scene.keyFocus;
      const r = (n.kind === "category" ? F.islandR[islands.findIndex((is) => is.node === n)] : F.s[n.i]) + 4;
      ctx.lineWidth = 4;
      ctx.strokeStyle = COLORS.card;
      ctx.beginPath();
      ctx.arc(F.sx[n.i], F.sy[n.i], r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.focus;
      ctx.stroke();
    }
    if (scene.pulse && now >= scene.pulse.start && F.vis[scene.pulse.node.i]) {
      const { node, start } = scene.pulse;
      const t = Math.min(1, Math.max(0, (now - start) / MOTION.pulseMs));
      const e = 1 - (1 - t) ** 3;
      const s = F.s[node.i];
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(COLORS.ink, 0.8 * (1 - e));
      ctx.beginPath();
      ctx.arc(F.sx[node.i], F.sy[node.i], Math.max(0, lerp(s + 4, s + 22, e)), 0, Math.PI * 2);
      ctx.stroke();
    }

    // 16. Reduced-motion "dip to cream".
    if (st.dip > 0.001) {
      ctx.fillStyle = rgba(COLORS.bg, st.dip);
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  // --- Pieces ------------------------------------------------------------------

  private drawDot(x: number, y: number, r: number, n: MNode, alpha: number, product = false) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (n.status === "former") {
      ctx.fillStyle = COLORS.card;
      ctx.fill();
      ctx.lineWidth = Math.max(1, Math.min(1.4, r * 0.5));
      ctx.strokeStyle = COLORS.former;
      ctx.stroke();
    } else if (n.status === "partial") {
      ctx.fillStyle = COLORS.card;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, true);
      ctx.closePath();
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(0.8, Math.min(1.2, r * 0.4));
      ctx.strokeStyle = n.color;
      ctx.stroke();
    } else {
      ctx.fillStyle = n.status === "uncertain" && product ? COLORS.inkFaint : n.color;
      ctx.fill();
      if (product && r >= 3) {
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawShadow(x: number, y: number, r: number, a: number) {
    const ctx = this.ctx;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * a * 4;
    const s = r * 2.6;
    ctx.drawImage(this.shadow, x - s / 2, y - s / 2 + r * 0.12, s, s);
    ctx.globalAlpha = prev;
  }

  private drawBadge(b: MNode, scene: Scene, atlas: Atlas, x: number, y: number, s: number, alpha: number, top: boolean) {
    if (alpha < 0.01) return;
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    if (s >= 14 || top) this.drawShadow(x, y, s, 0.16);
    const cell = atlas.cell(b);
    const logoA = scene.logoA.get(b)!.x;
    // White disc first, then the logo fades in over it once decoded.
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fillStyle = b.e.logoDark && cell ? COLORS.logoDark : COLORS.card;
    ctx.fill();
    if (cell) {
      ctx.globalAlpha = alpha * logoA;
      ctx.drawImage(atlas.canvas, cell.x, cell.y, cell.size, cell.size, x - s, y - s, 2 * s, 2 * s);
      ctx.globalAlpha = alpha;
    }
    this.drawRing(b, x, y, s);
    if (s >= LOD.tagFrom) this.drawTag(b, x, y, s);
    ctx.globalAlpha = 1;
  }

  private drawRing(b: MNode, x: number, y: number, s: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    if (b.status === "partial") {
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.track;
      ctx.stroke();
      ctx.beginPath();
      const f = b.e.stake ?? 0.5;
      ctx.arc(x, y, s, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.strokeStyle = b.color;
      ctx.stroke();
      ctx.lineCap = "butt";
    } else if (b.status === "former") {
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.former;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const prev = ctx.globalAlpha;
      if (b.status === "uncertain") ctx.globalAlpha = prev * 0.5;
      ctx.lineWidth = 2;
      ctx.strokeStyle = b.color;
      ctx.stroke();
      ctx.globalAlpha = prev;
    }
  }

  private drawTag(b: MNode, x: number, y: number, s: number) {
    const tag = statusTag(b);
    if (!tag) return;
    const ctx = this.ctx;
    ctx.font = `700 9px ${FONT.sans}`;
    const w = Math.max(14, ctx.measureText(tag).width + 8);
    const cx = x + s * Math.SQRT1_2;
    const cy = y + s * Math.SQRT1_2;
    const amber = b.status === "transition";
    roundRect(ctx, cx - w / 2, cy - 7, w, 14, 7);
    ctx.fillStyle = amber ? COLORS.amber : COLORS.card;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = amber ? COLORS.amber : COLORS.line;
    ctx.stroke();
    ctx.fillStyle = amber ? "#fff" : COLORS.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(tag, cx, cy + 0.5);
  }

  private lineStyle(n: MNode) {
    const ctx = this.ctx;
    if (n.status === "partial") ctx.setLineDash([5, 4]);
    else if (n.status === "former") {
      ctx.setLineDash([1.5, 4]);
      ctx.lineCap = "round";
    } else ctx.setLineDash([]);
  }

  private drawHubLines(is: Island, scene: Scene, alpha: number) {
    const ctx = this.ctx;
    const F = scene.frame;
    const cat = is.node;
    const hx = F.sx[cat.i];
    const hy = F.sy[cat.i];
    const hubR = Math.max(F.s[cat.i], 10) + 2;
    const seg = (x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) => {
      const d = Math.hypot(x1 - x0, y1 - y0);
      if (d <= r0 + r1 + 1) return;
      const ux = (x1 - x0) / d;
      const uy = (y1 - y0) / d;
      ctx.moveTo(x0 + ux * r0, y0 + uy * r0);
      ctx.lineTo(x1 - ux * r1, y1 - uy * r1);
    };
    for (const style of ["owned", "partial", "former"] as const) {
      ctx.beginPath();
      let any = false;
      for (const u of is.units) {
        const n = u.node;
        const lineStatus = n.kind === "brand" ? (n.status === "partial" || n.status === "former" ? n.status : "owned") : "owned";
        if (lineStatus !== style) continue;
        if (u.isGroup) continue;
        if (!F.vis[n.i] || F.alpha[n.i] < 0.05) continue;
        seg(hx, hy, hubR, F.sx[n.i], F.sy[n.i], F.s[n.i] + 2);
        any = true;
      }
      if (!any) continue;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1;
      ctx.strokeStyle = style === "former" ? COLORS.former : cat.color;
      ctx.setLineDash(style === "partial" ? [5, 4] : style === "former" ? [1.5, 4] : []);
      ctx.lineCap = style === "former" ? "round" : "butt";
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineCap = "butt";
    // Groups: hub → gate (1.5 px), gate dot, group hub → members.
    for (const u of is.units) {
      if (!u.isGroup) continue;
      const g = u.node;
      if (!F.vis[g.i]) continue;
      const gx = F.sx[g.i];
      const gy = F.sy[g.i];
      // The gate: where the line from the hub meets the group's rim (an ellipse when stretched).
      const d = Math.hypot(gx - hx, gy - hy) || 1;
      const ux = (gx - hx) / d;
      const uy = (gy - hy) / d;
      const R = 1 / Math.hypot(ux / F.rx[g.i], uy / F.ry[g.i]);
      const gateX = gx - ux * R;
      const gateY = gy - uy * R;
      ctx.globalAlpha = alpha * 1.6 * F.alpha[g.i];
      ctx.beginPath();
      seg(hx, hy, hubR, gateX, gateY, 0);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = cat.color;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(gateX, gateY, 3, 0, Math.PI * 2);
      ctx.fillStyle = cat.color;
      ctx.fill();
      // group hub
      const ghx = F.hubX[g.i];
      const ghy = F.hubY[g.i];
      ctx.beginPath();
      ctx.arc(ghx, ghy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      seg(gateX, gateY, 0, ghx, ghy, 3.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      for (const style of ["owned", "partial", "former"] as const) {
        ctx.beginPath();
        let any = false;
        for (const m of u.members) {
          const n = m.node;
          const lineStatus = n.status === "partial" || n.status === "former" ? n.status : "owned";
          if (lineStatus !== style || !F.vis[n.i] || F.alpha[n.i] < 0.05) continue;
          seg(ghx, ghy, 3.5, F.sx[n.i], F.sy[n.i], F.s[n.i] + 2);
          any = true;
        }
        if (!any) continue;
        ctx.globalAlpha = alpha * 1.1 * F.alpha[g.i];
        ctx.lineWidth = 1;
        ctx.strokeStyle = style === "former" ? COLORS.former : cat.color;
        ctx.setLineDash(style === "partial" ? [5, 4] : style === "former" ? [1.5, 4] : []);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  private drawLineage(n: MNode, scene: Scene, model: Model) {
    const ctx = this.ctx;
    const F = scene.frame;
    const brand = n.kind === "product" ? n.brand : n.kind === "brand" ? n : null;
    const cat = n.category;
    if (!cat) return;
    const j = scene.layout.islands.findIndex((is) => is.node === cat);
    if (j < 0 || F.islandA[j] < 0.05) return;
    const pts: [number, number][] = [];
    const f = scene.focus.get(cat)!.x;
    if (f < 0.5 && scene.nestleFade.x > 0.5) pts.push([F.sx[model.root.i], F.sy[model.root.i]]);
    pts.push([F.sx[cat.i], F.sy[cat.i]]);
    const g = brand?.group ?? (n.kind === "group" ? n : null);
    if (g && F.vis[g.i]) {
      pts.push([F.hubX[g.i], F.hubY[g.i]]);
    }
    if (brand && F.vis[brand.i]) pts.push([F.sx[brand.i], F.sy[brand.i]]);
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(cat.color, 0.9 * F.islandA[j]);
    if (brand) this.lineStyle(brand);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = "butt";
  }

  private drawLens(b: MNode, scene: Scene, atlas: Atlas, fan: Fan, st: RenderState) {
    const ctx = this.ctx;
    const F = scene.frame;
    const a = scene.lens.x;
    const bx = F.sx[b.i];
    const by = F.sy[b.i];
    const sc = 0.94 + 0.06 * a;
    const box = fan.box;
    const x0 = bx + box.x0 * sc - 16;
    const y0 = by + box.y0 * sc - 16;
    const w = (box.x1 - box.x0) * sc + 32;
    const h = (box.y1 - box.y0) * sc + 32;
    ctx.globalAlpha = a;
    roundRect(ctx, x0, y0 + 4, w, h, Math.min(h / 2, 36));
    ctx.fillStyle = "rgba(70,45,25,0.06)";
    ctx.fill();
    roundRect(ctx, x0, y0, w, h, Math.min(h / 2, 36));
    ctx.fillStyle = rgba(COLORS.card, 0.96);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(b.color, 0.25);
    ctx.stroke();
    this.hitRect("open", b, { x0, y0, x1: x0 + w, y1: y0 + h });

    // Title on the top edge, kept inside the lens.
    ctx.font = `600 13px ${FONT.sans}`;
    const title = this.fitText(b.name, w - 40);
    const tw = ctx.measureText(title).width + 16;
    const tx = clamp(bx, x0 + 12 + tw / 2, x0 + w - 12 - tw / 2);
    roundRect(ctx, tx - tw / 2, y0 - 11, tw, 22, 11);
    ctx.fillStyle = COLORS.card;
    ctx.fill();
    ctx.strokeStyle = rgba(b.color, 0.35);
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, tx, y0 + 0.5);
    if (!b.products.length && box.y1 - box.y0 > 2 * F.s[b.i] + 30) {
      ctx.font = `400 12px ${FONT.sans}`;
      ctx.fillStyle = COLORS.inkSoft;
      ctx.fillText("No products listed", bx, by + F.s[b.i] + 16);
    }

    // Fan spokes, dots, leaders and labels.
    const s = F.s[b.i];
    const font = `400 12.5px ${FONT.sans}`;
    ctx.font = font;
    const rowH = fan.row;
    const shown = fan.slots.length;
    for (let j = 0; j < b.products.length && j < shown; j++) {
      const p = b.products[j];
      const isMore = fan.more > 0 && j === shown - 1;
      const slot = fan.slots[j];
      const o = scene.orbit.get(p)!.x;
      const px = F.sx[p.i];
      const py = F.sy[p.i];
      const la = scene.productLabel.get(p)!.x * a;
      const fa = scene.filterA.get(p)!.x;
      if (isMore) {
        if (la > 0.01) {
          ctx.globalAlpha = la;
          ctx.fillStyle = COLORS.inkSoft;
          ctx.font = `600 12.5px ${FONT.sans}`;
          ctx.textAlign = slot.right ? "left" : "right";
          const lx = bx + (slot.right ? fan.labelX : -fan.labelX);
          const text = this.fitText(`+${fan.more} more products`, fan.labelMax);
          ctx.fillText(text, lx, by + slot.y);
          const tw2 = ctx.measureText(text).width;
          this.hitRect("more", b, { x0: slot.right ? lx - 12 : lx - tw2, y0: by + slot.y - rowH / 2, x1: slot.right ? lx + tw2 : lx + 12, y1: by + slot.y + rowH / 2 });
          ctx.font = font;
        }
        continue;
      }
      // spoke from badge rim to dot
      const d = Math.hypot(px - bx, py - by) || 1;
      ctx.globalAlpha = a * fa * 0.35 * Math.min(1, o);
      ctx.beginPath();
      ctx.moveTo(bx + ((px - bx) / d) * (s + 2), by + ((py - by) / d) * (s + 2));
      ctx.lineTo(px, py);
      ctx.lineWidth = 1;
      ctx.strokeStyle = p.status === "former" ? COLORS.former : b.color;
      this.lineStyle(p);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = "butt";
      this.drawDot(px, py, F.s[p.i], p, a * fa, true);
      if (la > 0.01) {
        const lx = bx + (slot.right ? fan.labelX : -fan.labelX);
        const ly = by + slot.y;
        // leader
        ctx.globalAlpha = la * 0.3 * fa;
        ctx.beginPath();
        ctx.moveTo(px + (slot.right ? 6 : -6), py);
        ctx.lineTo(lx + (slot.right ? -4 : 4), ly);
        ctx.strokeStyle = COLORS.ink;
        ctx.stroke();
        ctx.globalAlpha = la * fa;
        // Selected and hovered rows read the same: bold.
        const selected = st.selectedProduct === p || scene.hovered === p;
        ctx.font = selected ? `600 12.5px ${FONT.sans}` : font;
        ctx.fillStyle = p.status === "former" ? COLORS.inkSoft : COLORS.ink;
        ctx.textAlign = slot.right ? "left" : "right";
        ctx.textBaseline = "middle";
        const suffix = p.status !== b.status ? ` ${statusSuffix(p)}` : "";
        const nameFont = ctx.font;
        ctx.font = `400 11px ${FONT.sans}`;
        const sw = suffix ? ctx.measureText(suffix).width : 0;
        ctx.font = nameFont;
        const text = this.fitText(p.label, fan.labelMax - sw);
        const tw2 = ctx.measureText(text).width;
        // Right column: name, then suffix. Left column: the pair ends at the label line.
        const nx = slot.right ? lx : lx - sw;
        ctx.fillText(text, nx, ly);
        if (suffix) {
          ctx.font = `400 11px ${FONT.sans}`;
          ctx.fillStyle = COLORS.inkSoft;
          ctx.textAlign = "left";
          ctx.fillText(suffix, slot.right ? lx + tw2 : lx - sw, ly);
          ctx.font = font;
        }
        const rowRect = slot.right
          ? { x0: px - 8, y0: ly - rowH / 2, x1: lx + tw2 + sw + 30, y1: ly + rowH / 2 }
          : { x0: lx - sw - tw2 - 30, y0: ly - rowH / 2, x1: px + 8, y1: ly + rowH / 2 };
        if (fa > 0.5) this.hitRect("fanRow", p, rowRect);
      }
    }
    // The open badge itself, sharp if available.
    ctx.globalAlpha = a;
    this.drawShadow(bx, by, s, 0.2);
    const sharp = atlas.sharp(b);
    ctx.beginPath();
    ctx.arc(bx, by, s, 0, Math.PI * 2);
    ctx.fillStyle = b.e.logoDark ? COLORS.logoDark : COLORS.card;
    ctx.fill();
    if (sharp) ctx.drawImage(sharp, bx - s, by - s, 2 * s, 2 * s);
    else {
      const cell = atlas.cell(b);
      if (cell) ctx.drawImage(atlas.canvas, cell.x, cell.y, cell.size, cell.size, bx - s, by - s, 2 * s, 2 * s);
    }
    this.drawRing(b, bx, by, s);
    this.drawTag(b, bx, by, s);
    ctx.globalAlpha = 1;
    this.hit("open", b, bx, by, s + 4);
  }

  /** A category name set along its island's rim: each glyph rotated to the curve, with a soft halo. */
  private drawArc(arc: ArcLabel) {
    const ctx = this.ctx;
    ctx.globalAlpha = arc.alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    const halo = arc.outside ? COLORS.bg : mix(arc.node.color, 0.09);
    for (const g of arc.glyphs) {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.rot);
      ctx.font = g.font;
      ctx.strokeStyle = halo;
      ctx.strokeText(g.ch, 0, 0);
      ctx.fillStyle = g.soft ? COLORS.inkSoft : arc.hover ? arc.node.color : COLORS.ink;
      ctx.fillText(g.ch, 0, 0);
      ctx.restore();
      // A name outside the rim is still part of the island.
      if (arc.outside) this.hit("island", arc.node, g.x, g.y, g.size * 0.7);
    }
    ctx.globalAlpha = 1;
  }

  /** Shortens text with an ellipsis to fit maxW in the current font. */
  private fitText(text: string, maxW: number): string {
    const ctx = this.ctx;
    if (ctx.measureText(text).width <= maxW) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(`${text.slice(0, mid).trimEnd()}…`).width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return `${text.slice(0, lo).trimEnd()}…`;
  }

  private drawLabel(l: Placed) {
    const ctx = this.ctx;
    const d = l.data as LabelData | undefined;
    const r = l.rect;
    ctx.globalAlpha = l.alpha * (d?.alpha ?? 1);
    if (d?.type === "pill" || d?.type === "chip") {
      const h = r.y1 - r.y0;
      roundRect(ctx, r.x0, r.y0, r.x1 - r.x0, h, h / 2);
      ctx.fillStyle = COLORS.card;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = d.hover ? rgba(d.node.color, 0.6) : COLORS.line;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r.x0 + 13, (r.y0 + r.y1) / 2, 5, 0, Math.PI * 2);
      ctx.fillStyle = d.node.color;
      ctx.fill();
      ctx.font = l.font;
      ctx.fillStyle = COLORS.ink;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(l.text, r.x0 + 24, (r.y0 + r.y1) / 2 + 0.5);
      const tw = ctx.measureText(l.text).width;
      if (d.count) {
        ctx.font = `400 ${d.small ? 11.5 : 13}px ${FONT.sans}`;
        ctx.fillStyle = COLORS.inkSoft;
        ctx.fillText(d.count, r.x0 + 24 + tw + 6, (r.y0 + r.y1) / 2 + 0.5);
      }
      if (d.tag) {
        const cw = ctx.measureText(d.count ?? "").width;
        ctx.font = `400 12px ${FONT.sans}`;
        ctx.fillStyle = COLORS.inkSoft;
        ctx.fillText(`· ${d.tag}`, r.x0 + 24 + tw + 6 + cw + 6, (r.y0 + r.y1) / 2 + 0.5);
      }
      if (ctx.globalAlpha >= 0.5) this.hitRect(d.type === "chip" ? "chip" : "label", d.node, r);
    } else {
      ctx.font = l.font;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const x = Math.round(r.x0);
      const y = Math.round(r.y0 + 1);
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLORS.bg;
      ctx.strokeText(l.text, x, y);
      ctx.fillStyle = d?.soft ? COLORS.inkSoft : COLORS.ink;
      ctx.fillText(l.text, x, y);
      if (d?.node && ctx.globalAlpha >= 0.5) this.hitRect("label", d.node, r);
    }
    ctx.globalAlpha = 1;
  }

}

export interface LabelData {
  type: "pill" | "chip" | "brand" | "group" | "nestle";
  node: MNode;
  count?: string;
  tag?: string;
  soft?: boolean;
  hover?: boolean;
  small?: boolean;
  alpha?: number;
}

function statusSuffix(p: MNode): string {
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

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

function makeShadowSprite(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 10, 32, 32, 32);
  grad.addColorStop(0, "rgba(70,45,25,0.25)");
  grad.addColorStop(1, "rgba(70,45,25,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

/** Picks the topmost hit under (x, y): highest priority first, then the nearest edge. */
export function pick(hits: Hit[], x: number, y: number, coarse: boolean): Hit | null {
  let best: Hit | null = null;
  let bestScore = Infinity;
  const extra = coarse ? 6 : 4;
  const minR = coarse ? 22 : 12;
  for (const h of hits) {
    let d: number;
    if (h.w > 0) {
      const dx = Math.max(h.rx - x, 0, x - (h.rx + h.w));
      const dy = Math.max(h.ry - y, 0, y - (h.ry + h.h));
      d = Math.hypot(dx, dy);
      if (d > (coarse ? 6 : 0)) continue;
    } else {
      const dist = Math.hypot(x - h.x, (y - h.y) / h.aspect);
      const reach = h.kind === "island" ? h.r : Math.max(h.r + extra, h.kind === "fanRow" ? 12 : h.kind === "brand" ? minR : h.r);
      if (dist > reach) continue;
      d = Math.max(0, dist - h.r);
    }
    const score = -h.prio * 1000 + d;
    if (score < bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}
