/* ==========================================================================
   Greedy screen-space label placement. Labels are placed in priority order;
   each tries a few candidate positions and is dropped if it would overlap a
   placed label or an obstacle. A uniform grid keeps it O(n). Labels are
   sticky (a placed label resists displacement) and fade in and out.
   ========================================================================== */

import type { Rect } from "./layout";

export interface LabelSpec {
  key: string;
  text: string;
  font: string;
  /** Height of the text box in px. */
  h: number;
  prio: number;
  forced?: boolean;
  /** Must appear: ignores soft obstacles (badges) and, as a last resort, overlaps. */
  mustPlace?: boolean;
  /** Extra acceptance test for a candidate (e.g. a pill must not reach into another island). */
  accept?: (r: Rect) => boolean;
  /** For must-place labels: how bad a fallback position is (lower is better). */
  badness?: (r: Rect) => number;
  /** Alternative texts, preferred first (e.g. the full name, then a shortened one). */
  texts?: string[];
  /** Candidate anchor points; the function returns a rect for a measured width, in order of preference. */
  candidates: (w: number) => Rect[];
  /** Extra data the renderer needs (colour, style, node). */
  data?: unknown;
}

export interface Placed {
  key: string;
  text: string;
  font: string;
  rect: Rect;
  alpha: number;
  data?: unknown;
}

const CELL = 100;
const PAD = 3;

export class LabelPlacer {
  private ctx: CanvasRenderingContext2D;
  private widths = new Map<string, number>();
  private alphas = new Map<string, { a: number; target: number; spec: LabelSpec; rect: Rect; idx: number; text: string }>();
  private lastPlaced = new Set<string>();
  private lost = new Map<string, number>();
  private grid = new Map<number, Rect[]>();
  /** Obstacles a must-place label may cover (badges, dots). */
  private soft = new Map<number, Rect[]>();

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  flushWidths() {
    this.widths.clear();
  }

  measure(text: string, font: string): number {
    const key = `${font}|${text}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      this.ctx.font = font;
      w = this.ctx.measureText(text).width;
      this.widths.set(key, w);
    }
    return w;
  }

  /** Fit text into maxW by trimming characters and adding an ellipsis. */
  fit(text: string, font: string, maxW: number): string {
    if (this.measure(text, font) <= maxW) return text;
    let t = text;
    while (t.length > 2 && this.measure(`${t}…`, font) > maxW) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  }

  private gridKey(cx: number, cy: number) {
    return cx * 100003 + cy;
  }

  private collides(r: Rect, grid = this.grid): boolean {
    const x0 = Math.floor(r.x0 / CELL);
    const x1 = Math.floor(r.x1 / CELL);
    const y0 = Math.floor(r.y0 / CELL);
    const y1 = Math.floor(r.y1 / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = grid.get(this.gridKey(cx, cy));
        if (!list) continue;
        for (const q of list) if (!(r.x1 + PAD <= q.x0 || r.x0 - PAD >= q.x1 || r.y1 + PAD <= q.y0 || r.y0 - PAD >= q.y1)) return true;
      }
    }
    return false;
  }

  private occupy(r: Rect, grid = this.grid) {
    const x0 = Math.floor(r.x0 / CELL);
    const x1 = Math.floor(r.x1 / CELL);
    const y0 = Math.floor(r.y0 / CELL);
    const y1 = Math.floor(r.y1 / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.gridKey(cx, cy);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(r);
      }
    }
  }

  /**
   * Places labels. `obstacles` are rects nothing may overlap (badges, chrome).
   * `viewport` keeps labels on screen.
   */
  private lastViewport: Rect = { x0: 0, y0: 0, x1: 1e5, y1: 1e5 };

  place(specs: LabelSpec[], obstacles: Rect[], viewport: Rect, hard: Rect[] = []) {
    this.lastViewport = viewport;
    this.grid.clear();
    this.soft.clear();
    for (const o of obstacles) {
      this.occupy(o);
      this.occupy(o, this.soft);
    }
    // Hard obstacles (chrome) block every label, including must-place ones.
    const hardGrid = new Map<number, Rect[]>();
    for (const o of hard) {
      this.occupy(o);
      this.occupy(o, hardGrid);
    }
    const sorted = [...specs].sort((a, b) => b.prio + (this.lastPlaced.has(b.key) ? 8 : 0) - (a.prio + (this.lastPlaced.has(a.key) ? 8 : 0)));
    const placedNow = new Set<string>();
    /** This pass's placed labels, by their rect in the grid (for the second-chance pass below). */
    const owners = new Map<Rect, { spec: LabelSpec; idx: number; text: string }>();
    const seen = new Set<string>();
    const inside = (r: Rect) => r.x0 >= viewport.x0 && r.x1 <= viewport.x1 && r.y0 >= viewport.y0 && r.y1 <= viewport.y1;
    for (const spec of sorted) {
      seen.add(spec.key);
      const ok = (r: Rect) => !spec.accept || spec.accept(r);
      const free = (r: Rect) => spec.forced || (inside(r) && !this.collides(r) && ok(r));
      const prev = this.alphas.get(spec.key);
      const texts = spec.forced ? [spec.texts?.[0] ?? spec.text] : (spec.texts ?? [spec.text]);
      let chosen: Rect | null = null;
      let idx = -1;
      let text = texts[0];

      // A shorter text placed earlier gives way to a longer (preferred) one as soon as that fits.
      const prevText = prev && prev.target > 0 ? texts.indexOf(prev.text) : -1;
      for (let t = 0; !chosen && t < prevText; t++) {
        const cands = spec.candidates(this.measure(texts[t], spec.font));
        const ci = cands.findIndex((r) => free(r));
        if (ci >= 0) {
          chosen = cands[ci];
          idx = ci;
          text = texts[t];
        }
      }
      // Hysteresis: keep the previous position (and text) while it still works.
      if (!chosen && prev && prev.target > 0 && texts.includes(prev.text)) {
        const r = spec.candidates(this.measure(prev.text, spec.font))[prev.idx];
        if (r && free(r)) {
          chosen = r;
          idx = prev.idx;
          text = prev.text;
        }
      }
      for (let t = 0; !chosen && t < texts.length; t++) {
        const cands = spec.candidates(this.measure(texts[t], spec.font));
        for (let ci = 0; ci < cands.length; ci++) {
          if (free(cands[ci])) {
            chosen = cands[ci];
            idx = ci;
            text = texts[t];
            break;
          }
        }
      }
      if (!chosen && spec.mustPlace) {
        // Must appear: try positions clamped onto the screen, ignoring badges; else the least-bad one.
        text = texts[texts.length - 1];
        const cands = spec.candidates(this.measure(text, spec.font)).map((r) => clampInto(r, viewport));
        // Score each: chrome and other labels are near-absolute; covering a badge (a logo) is worse than
        // failing the spec's own test (e.g. a pill inside its island); then the spec's badness; earlier
        // candidates win ties, and the previous position gets a small bonus so the label doesn't hop.
        const labelsOnly = (r: Rect) => !this.collidesExcept(r, this.soft);
        let ci = 0;
        let best = Infinity;
        cands.forEach((r, i) => {
          const bad =
            (this.collides(r, hardGrid) ? 1e6 : 0) +
            (labelsOnly(r) ? 0 : 1e4) +
            (ok(r) ? 0 : 1e3) +
            (spec.badness?.(r) ?? 0) +
            (this.collides(r, this.soft) ? 1500 : 0) +
            i * 0.5 -
            (prev && prev.target > 0 && prev.idx === i && prev.text === text ? 8 : 0);
          if (bad < best) {
            best = bad;
            ci = i;
          }
        });
        // Even a must-place label never goes under the interface chrome.
        if (best < 1e6) {
          chosen = cands[ci];
          idx = ci;
        }
      }
      // Stickiness: a label placed last pass survives one losing pass where it was.
      if (!chosen && this.lastPlaced.has(spec.key) && !spec.forced && prev) {
        const losses = (this.lost.get(spec.key) ?? 0) + 1;
        this.lost.set(spec.key, losses);
        const r = spec.candidates(this.measure(prev.text, spec.font))[prev.idx];
        if (losses < 2 && r) {
          chosen = r;
          idx = prev.idx;
          text = prev.text;
        }
      } else if (chosen) this.lost.delete(spec.key);
      if (chosen) {
        this.occupy(chosen);
        owners.set(chosen, { spec, idx, text });
        placedNow.add(spec.key);
        this.commit(spec, chosen, idx, text);
      } else if (prev) {
        prev.target = 0;
        prev.spec = spec;
      }
    }

    // Second chance for labels that found no room: take a spot held by a single label placed in this pass,
    // if that label can move to another of its own spots. Only labels new in this pass are moved, so a label
    // already on screen never jumps (and once both are placed, hysteresis keeps them where they are).
    for (const spec of sorted) {
      if (placedNow.has(spec.key) || spec.forced || spec.mustPlace) continue;
      const texts = spec.texts ?? [spec.text];
      let done = false;
      for (let t = 0; !done && t < texts.length; t++) {
        const cands = spec.candidates(this.measure(texts[t], spec.font));
        for (let ci = 0; !done && ci < cands.length; ci++) {
          const r = cands[ci];
          if (!inside(r) || (spec.accept && !spec.accept(r))) continue;
          const q = this.soleBlocker(r);
          const other = q && owners.get(q);
          if (!q || !other || this.lastPlaced.has(other.spec.key) || other.spec.forced || other.spec.mustPlace) continue;
          this.vacate(q);
          this.occupy(r);
          const alt = this.firstFree(other.spec, other.idx, other.text, inside);
          if (alt) {
            this.occupy(alt.rect);
            owners.delete(q);
            owners.set(alt.rect, { spec: other.spec, idx: alt.idx, text: alt.text });
            this.commit(other.spec, alt.rect, alt.idx, alt.text);
            owners.set(r, { spec, idx: ci, text: texts[t] });
            placedNow.add(spec.key);
            this.lost.delete(spec.key);
            this.commit(spec, r, ci, texts[t]);
            done = true;
          } else {
            this.vacate(r);
            this.occupy(q);
          }
        }
      }
    }
    for (const [key, entry] of this.alphas) if (!seen.has(key)) entry.target = 0;
    this.lastPlaced = placedNow;
  }

  /** Records a label's position for this pass (and starts its fade-in if it's new). */
  private commit(spec: LabelSpec, rect: Rect, idx: number, text: string) {
    const prev = this.alphas.get(spec.key);
    if (prev) {
      prev.target = 1;
      prev.spec = spec;
      prev.rect = rect;
      prev.idx = idx;
      prev.text = text;
    } else this.alphas.set(spec.key, { a: spec.forced ? 1 : 0, target: 1, spec, rect, idx, text });
  }

  /** The one rect in the grid that `r` collides with; null if none or several. */
  private soleBlocker(r: Rect): Rect | null {
    let found: Rect | null = null;
    const x0 = Math.floor(r.x0 / CELL);
    const x1 = Math.floor(r.x1 / CELL);
    const y0 = Math.floor(r.y0 / CELL);
    const y1 = Math.floor(r.y1 / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.grid.get(this.gridKey(cx, cy));
        if (!list) continue;
        for (const q of list) {
          if (q === found || r.x1 + PAD <= q.x0 || r.x0 - PAD >= q.x1 || r.y1 + PAD <= q.y0 || r.y0 - PAD >= q.y1) continue;
          if (found) return null;
          found = q;
        }
      }
    }
    return found;
  }

  /**
   * A label's first free spot other than the one it has, keeping its text. Only for a label showing its
   * preferred text: one showing a shorter text would look for room for the longer one next pass, and could
   * take back the spot it gave up.
   */
  private firstFree(spec: LabelSpec, idx: number, text: string, inside: (r: Rect) => boolean): { rect: Rect; idx: number; text: string } | null {
    if (text !== (spec.texts?.[0] ?? spec.text)) return null;
    const cands = spec.candidates(this.measure(text, spec.font));
    for (let ci = 0; ci < cands.length; ci++) {
      if (ci === idx) continue;
      const r = cands[ci];
      if (inside(r) && !this.collides(r) && (!spec.accept || spec.accept(r))) return { rect: r, idx: ci, text };
    }
    return null;
  }

  /** Removes a rect from the grid. */
  private vacate(r: Rect) {
    const x0 = Math.floor(r.x0 / CELL);
    const x1 = Math.floor(r.x1 / CELL);
    const y0 = Math.floor(r.y0 / CELL);
    const y1 = Math.floor(r.y1 / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.grid.get(this.gridKey(cx, cy));
        const i = list ? list.indexOf(r) : -1;
        if (i >= 0) list!.splice(i, 1);
      }
    }
  }

  /** Collides with a placed label (anything in the main grid that isn't in `except`). */
  private collidesExcept(r: Rect, except: Map<number, Rect[]>): boolean {
    const x0 = Math.floor(r.x0 / CELL);
    const x1 = Math.floor(r.x1 / CELL);
    const y0 = Math.floor(r.y0 / CELL);
    const y1 = Math.floor(r.y1 / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.gridKey(cx, cy);
        const list = this.grid.get(k);
        if (!list) continue;
        const ex = new Set(except.get(k) ?? []);
        for (const q of list) {
          if (ex.has(q)) continue;
          if (!(r.x1 + PAD <= q.x0 || r.x0 - PAD >= q.x1 || r.y1 + PAD <= q.y0 || r.y0 - PAD >= q.y1)) return true;
        }
      }
    }
    return false;
  }

  /** Advance fades. Returns true while any label is fading. */
  step(dt: number): boolean {
    let busy = false;
    for (const [key, e] of this.alphas) {
      const rate = e.target > e.a ? dt / 0.12 : dt / 0.09;
      if (e.a < e.target) e.a = Math.min(e.target, e.a + rate);
      else if (e.a > e.target) e.a = Math.max(e.target, e.a - rate);
      if (e.a !== e.target) busy = true;
      if (e.a === 0 && e.target === 0) this.alphas.delete(key);
    }
    return busy;
  }

  /** Re-resolve the rects of placed labels against new candidate positions (labels follow their nodes between passes). */
  follow(specs: Map<string, LabelSpec>) {
    for (const [key, e] of this.alphas) {
      const spec = specs.get(key);
      if (!spec) continue;
      e.spec = spec;
      // Keep the candidate position (and text) the label was placed with; it rides along with its node.
      const r = spec.candidates(this.measure(e.text, spec.font))[e.idx];
      if (r) e.rect = spec.mustPlace ? clampInto(r, this.lastViewport) : r;
    }
  }

  visible(): Placed[] {
    const out: Placed[] = [];
    for (const [key, e] of this.alphas) if (e.a > 0.01) out.push({ key, text: e.text, font: e.spec.font, rect: e.rect, alpha: e.a, data: e.spec.data });
    return out;
  }

  rectOf(key: string): Rect | null {
    const e = this.alphas.get(key);
    return e && e.target > 0 ? e.rect : null;
  }

  clear() {
    this.alphas.clear();
    this.lastPlaced.clear();
  }
}

function clampInto(r: Rect, v: Rect): Rect {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const x0 = Math.min(Math.max(r.x0, v.x0), v.x1 - w);
  const y0 = Math.min(Math.max(r.y0, v.y0), v.y1 - h);
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}
