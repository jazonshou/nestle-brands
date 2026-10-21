/* ==========================================================================
   Navigation: one function turns a logical state into animation targets.
   No promises, no awaits: every value is retargeted from wherever it is,
   so a new click mid-transition just continues smoothly from there.
   ========================================================================== */

import { AnimValue, easeInOutCubic, smoothstep, type Progress } from "./anim";
import type { Bounds, Camera } from "./camera";
import { chipSlots, focusFit, freeArea, layoutMode, stretchFor, type Area, type Viewport } from "./geometry";
import type { Island, Rect } from "./layout";
import { brandsIn, type MNode, type Model } from "./model";
import { format, sameState, upOf, type NavState } from "./router";
import type { Scene } from "./scene";
import { MOTION, SIZE } from "./tokens";

export interface NavHooks {
  /** The DOM chrome reacts to the new state (card, top bar, strip, mirror, live region). */
  render(state: NavState): void;
  /** Width of an edge chip for a category, in px. */
  chipWidth(cat: MNode): number;
  /** Rects the chips must avoid (wide layout). */
  avoid(): { cardBottom: number; legendRight: number; controlsLeft: number };
  /** Screen centres of the strip's pills (narrow layout), after it has rendered. */
  stripSlots(): Map<MNode, { x: number; y: number }>;
  /** Ask the atlas for these logos first. */
  prioritiseLogos(nodes: MNode[]): void;
  /** Sharp bitmap for the open brand. */
  sharpen(b: MNode): void;
  /** A navigation is starting: finish any drag settling so it can't outlive the route. */
  beforeNavigate(): void;
  invalidate(): void;
}

interface Fit {
  cx: number;
  cy: number;
  k: number;
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export class Nav {
  state: NavState = { level: "overview" };
  private scene: Scene;
  private camera: Camera;
  private hooks: NavHooks;
  /** Overview view to return to, relative to the overview fit (so it survives resizes). */
  private savedOverview: { cx: number; cy: number; kRel: number } | null = null;
  /** The category view a brand was opened from. */
  private savedCategory: { cat: MNode; cx: number; cy: number; k: number } | null = null;
  /** Cleared by any user camera input after opening a brand. */
  untouched = false;
  /** The user has panned or zoomed since the last fit. */
  private viewDirty = false;
  /** The latest flight back to the overview; a view caught before it lands isn't saved. */
  private overviewFlight: Progress | null = null;
  /** The group view a brand was opened from (going up from the brand returns to it). */
  private brandOrigin: MNode | null = null;
  dip = 0;
  private dipTarget = 0;
  /** The state a fit is being computed from (for relative zooms). */
  private fitFrom: NavState | null = null;

  constructor(_model: Model, scene: Scene, camera: Camera, hooks: NavHooks) {
    this.scene = scene;
    this.camera = camera;
    this.hooks = hooks;
    camera.onExitGesture = () => this.up();
    camera.onInterruptSettled = () => this.recover();
    camera.focusPoint = () => {
      const s = this.state;
      const F = this.scene.frame;
      if (s.level === "brand") return { x: F.sx[s.brand.i], y: F.sy[s.brand.i] };
      if (s.level === "category") {
        const n = s.group ?? s.cat;
        return { x: F.sx[n.i], y: F.sy[n.i] };
      }
      return null;
    };
  }

  /** The group view the open brand was opened from, if any. */
  get origin(): MNode | null {
    return this.brandOrigin;
  }

  get vp(): Viewport {
    return this.scene.vp;
  }

  // --- Public API --------------------------------------------------------------

  go(next: NavState, opts: { push?: boolean; replace?: boolean; instant?: boolean; pulse?: MNode } = {}) {
    const prev = this.state;
    if (sameState(prev, next) && !opts.instant) {
      // Re-clicking the current thing re-fits it.
      this.refit();
      return;
    }
    this.hooks.beforeNavigate();
    this.camera.resetGesture();
    this.viewDirty = false;

    // Remember where the user was, so going back up returns there (not a view caught mid-flight).
    const cam = this.camera;
    const overviewLanded = !this.overviewFlight || this.overviewFlight.u >= 1;
    if (prev.level === "overview" && next.level !== "overview" && !cam.flying && overviewLanded) {
      const o = this.overviewFit();
      const a = o.area;
      const v = cam.view;
      this.savedOverview = { cx: (a.x + a.w / 2 - v.x) / v.k, cy: (a.y + a.h / 2 - v.y) / v.k, kRel: v.k / o.fit.k };
    }
    if (next.level === "overview") {
      this.savedCategory = null;
      this.untouched = false;
    } else if (next.level === "brand" && !(prev.level === "brand" && prev.cat === next.cat)) {
      if (prev.level === "category" && prev.cat === next.cat && !prev.group) {
        const a = freeArea("category", this.vp);
        const v = cam.flying || cam.programmatic ? null : cam.view;
        const fit = this.fitFor(prev).fit;
        // Mid-move, the view worth returning to is the one being restored (if any), else the fit.
        const restoring = this.savedCategory?.cat === next.cat ? this.savedCategory : null;
        this.savedCategory = v ? { cat: next.cat, cx: (a.x + a.w / 2 - v.x) / v.k, cy: (a.y + a.h / 2 - v.y) / v.k, k: v.k } : (restoring ?? { cat: next.cat, ...fit });
        this.untouched = true;
      } else {
        this.savedCategory = null;
        this.untouched = false;
      }
    }

    if (next.level === "brand") {
      if (prev.level === "category" && prev.group && next.brand.group === prev.group) this.brandOrigin = prev.group;
      else if (!(prev.level === "brand" && prev.brand === next.brand)) this.brandOrigin = null;
    } else this.brandOrigin = null;
    this.state = next;
    const url = format(next);
    if (opts.push !== false && location.hash !== url) {
      if (opts.replace) history.replaceState(null, "", url);
      else history.pushState(null, "", url);
    }
    // Chrome first, so chip slots are measured against the card and strip as they'll be.
    this.hooks.render(next);
    const landsIn = this.apply(prev, next, !!opts.instant);
    if (opts.pulse) this.scene.pulse = { node: opts.pulse, start: performance.now() + landsIn };
    this.hooks.invalidate();
  }

  up() {
    const s = this.state;
    if (s.level === "overview") {
      if (s.card) this.go({ level: "overview" });
      return;
    }
    if (s.level === "brand" && !s.product && this.brandOrigin) {
      this.go({ level: "category", cat: s.cat, group: this.brandOrigin });
      return;
    }
    this.go(upOf(s));
  }

  /** The user moved the camera: don't spring back to a saved view later. */
  userMoved() {
    this.untouched = false;
    this.viewDirty = true;
    // A view the user chose at the overview is worth returning to, even if a flight was cut short.
    if (this.state.level === "overview") this.overviewFlight = null;
  }

  /** Re-fit the current state (Shift+2, re-clicking the hub, after an interrupted move). */
  refit(instant = false) {
    this.viewDirty = false;
    const { fit, area } = this.fitFor(this.state);
    if (instant) this.camera.setFit(fit.cx, fit.cy, fit.k, area);
    else this.camera.springTo(fit.cx, fit.cy, fit.k, area);
    this.setBounds(this.state);
    this.ensureFan(instant);
    this.hooks.invalidate();
  }

  /**
   * How far (screen px) the content must move for a brand's lens, opened at the current view, to sit inside
   * the free area: {0, 0} if it already fits; null if the brand isn't on screen or the lens can't fit at all.
   */
  private lensShift(b: MNode, area: Area): { x: number; y: number } | null {
    const F = this.scene.frame;
    if (!F.vis[b.i]) return null;
    const box = this.scene.fanFor(b).box;
    const x0 = F.sx[b.i] + box.x0 - 16;
    const x1 = F.sx[b.i] + box.x1 + 16;
    const y0 = F.sy[b.i] + box.y0 - 16;
    const y1 = F.sy[b.i] + box.y1 + 16;
    if (x1 - x0 > area.w || y1 - y0 > area.h) return null;
    const dx = x0 < area.x ? area.x - x0 : x1 > area.x + area.w ? area.x + area.w - x1 : 0;
    const dy = y0 < area.y ? area.y - y0 : y1 > area.y + area.h ? area.y + area.h - y1 : 0;
    return { x: dx, y: dy };
  }

  /** A brand whose flight was cut short (re-fit, resize) still gets its products fanned out. */
  private ensureFan(instant: boolean) {
    const s = this.state;
    const sc = this.scene;
    if (s.level !== "brand" || sc.open !== s.brand) return;
    sc.fan = sc.fanFor(s.brand);
    this.openFan(s.brand, s.product ?? null, instant);
  }

  /**
   * Input interrupted a navigation move and the camera has settled. If that left it below the
   * minimum zoom or with the destination mostly off screen, finish the move after all.
   */
  private recover(): boolean {
    const s = this.state;
    const cam = this.camera;
    const F = this.scene.frame;
    const { fit, area } = this.fitFor(s);
    if (s.level === "overview") {
      // Back at the overview but still zoomed in on one corner of it: finish the move.
      const islands = this.scene.layout.islands;
      const off = islands.filter((_, j) => {
        const x = F.islandX[j];
        const y = F.islandY[j];
        return !(x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h);
      }).length;
      // (A deliberate zoom-in on the way back is the user's choice, not a stranded view.)
      if (cam.userZoomLn > 0.05) return false;
      if (cam.view.k <= fit.k * 2 && off <= 0.25 * islands.length) return false;
      this.refit();
      return true;
    }
    const outside = (n: MNode) => {
      const x = F.sx[n.i];
      const y = F.sy[n.i];
      return !(x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h);
    };
    let bad = !!cam.bounds && cam.view.k < cam.bounds.minK * 0.999;
    if (s.level === "brand") {
      // The brand and its whole lens should be in view.
      const d = this.lensShift(s.brand, area);
      bad ||= outside(s.brand) || !d || !!(d.x || d.y);
    }
    else {
      const brands = brandsIn(s.group ?? s.cat);
      bad ||= brands.filter(outside).length > 0.25 * brands.length;
    }
    if (!bad) return false;
    this.refit();
    return true;
  }

  /** Viewport changed: recompute stretch, chips and fits; keep the state. */
  resized(layoutChanged: boolean) {
    const s = this.state;
    // The saved category view is in absolute screen terms, so any resize invalidates it.
    this.savedCategory = null;
    this.untouched = false;
    if (layoutChanged) this.savedOverview = null;
    if (s.level !== "overview") this.computeFocusGeometry(s.cat);
    this.ensureFan(true);
    this.recomputeChips(false);
    // Keep a view the user chose, unless the layout itself changed or it no longer shows the destination.
    if (this.viewDirty && !layoutChanged) {
      this.setBounds(s);
      this.scene.resolve(this.camera.view, performance.now());
      this.recover();
    } else this.refit(true);
  }

  /** Chips depend on the card, legend and strip; call when any of them change size. */
  recomputeChips(animate = true) {
    const s = this.state;
    if (s.level === "overview") return;
    this.computeChips(s.cat, animate ? "slide" : "snap");
    this.hooks.invalidate();
  }

  stepDip(dt: number): boolean {
    if (this.dip === this.dipTarget) return false;
    const rate = dt / 0.1;
    this.dip = this.dipTarget > this.dip ? Math.min(this.dipTarget, this.dip + rate) : Math.max(this.dipTarget, this.dip - rate);
    if (this.dip >= 1 && this.dipTarget === 1) this.dipTarget = 0;
    return true;
  }

  // --- Geometry ------------------------------------------------------------------

  islandOf(cat: MNode): Island {
    return this.scene.layout.islandOf.get(cat)!;
  }

  private unitAt(is: Island) {
    return (i: number) => this.scene.unitOffset(is.units[i]);
  }

  private computeFocusGeometry(cat: MNode) {
    const is = this.islandOf(cat);
    // Phones (tall and narrow) can stretch further: a wide island then uses the height instead of shrinking.
    // There the stretch also opens up the groups (see Scene.memberStretchOf).
    const narrow = this.vp.mode === "narrow";
    this.scene.stretch.set(cat, stretchFor(is, this.unitAt(is), freeArea("category", this.vp), narrow ? 2.4 : 1.6, narrow));
  }

  private categoryFit(cat: MNode) {
    const is = this.islandOf(cat);
    const free = freeArea("category", this.vp);
    const narrow = this.vp.mode === "narrow";
    const s = this.scene.stretch.get(cat) ?? stretchFor(is, this.unitAt(is), free, narrow ? 2.4 : 1.6, narrow);
    // Phones can go a little further out so the biggest islands still fit.
    return focusFit(is, this.unitAt(is), s, free, narrow ? 0.5 * Math.min(1, free.w / 359, free.h / 564) : undefined, narrow);
  }

  focusK(cat: MNode): number {
    return this.categoryFit(cat).k;
  }

  /** World position of a brand once its island is fully focused (stretch applied). */
  private brandWorldFocused(b: MNode) {
    const is = this.islandOf(b.category!);
    const s = this.scene.stretch.get(is.node) ?? { sx: 1, sy: 1 };
    const centre = this.scene.islandCentre(is);
    const u = this.scene.layout.unitOf.get(b)!;
    const o = this.scene.unitOffset(u);
    const ux = centre.x + o.x * s.sx;
    const uy = centre.y + o.y * s.sy;
    if (!u.isGroup) return { x: ux, y: uy };
    const m = this.scene.layout.memberOf.get(b)!;
    const d = this.scene.memberDrop.get(b);
    const M = this.vp.mode === "narrow" ? s : { sx: 1, sy: 1 };
    return { x: ux + (m.lx + (d?.x ?? 0)) * M.sx, y: uy + (m.ly + (d?.y ?? 0)) * M.sy };
  }

  overviewFit(): { fit: Fit; area: Area } {
    const area = freeArea("overview", this.vp);
    const b = this.liveBounds();
    const k = Math.min(4, area.w / (b.x1 - b.x0), area.h / (b.y1 - b.y0));
    return { fit: { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, k }, area };
  }

  liveBounds(): Rect {
    const n = 64;
    const sc = this.scene;
    const r: Rect = { x0: sc.nestleDrop.x - n, y0: sc.nestleDrop.y - n, x1: sc.nestleDrop.x + n, y1: sc.nestleDrop.y + n };
    for (const is of sc.layout.islands) {
      const c = sc.islandCentre(is);
      r.x0 = Math.min(r.x0, c.x - is.R);
      r.y0 = Math.min(r.y0, c.y - is.R);
      r.x1 = Math.max(r.x1, c.x + is.R);
      r.y1 = Math.max(r.y1, c.y + is.R);
    }
    return r;
  }

  fitFor(s: NavState): { fit: Fit; area: Area } {
    if (s.level === "overview") return this.overviewFit();
    const cat = s.cat;
    const is = this.islandOf(cat);
    const centre = this.scene.islandCentre(is);
    if (s.level === "category") {
      const area = freeArea("category", this.vp);
      if (s.group) {
        const u = this.scene.layout.unitOf.get(s.group)!;
        const st = this.scene.stretch.get(cat) ?? { sx: 1, sy: 1 };
        const o = this.scene.unitOffset(u);
        const M = this.vp.mode === "narrow" ? st : { sx: 1, sy: 1 };
        const k = Math.min(1.6, area.w / (2 * u.R * M.sx * 1.15), area.h / (2 * u.R * M.sy * 1.15));
        return { fit: { cx: centre.x + o.x * st.sx, cy: centre.y + o.y * st.sy, k }, area };
      }
      const f = this.categoryFit(cat);
      return { fit: { cx: centre.x + f.dx, cy: centre.y + f.dy, k: f.k }, area };
    }
    // Brand: zoom relative to the category view (or where the user had zoomed within it), never less, at most 1.4× more.
    const area = freeArea("brand", this.vp);
    const b = s.brand;
    const w = this.brandWorldFocused(b);
    const fk = this.focusK(cat);
    const from = this.fitFrom;
    let ref = fk;
    if (from && from.level === "category" && from.cat === cat && !from.group) ref = this.camera.programmatic ? this.camera.targetK : this.camera.view.k;
    else if (from && from.level === "brand" && from.cat === cat && this.savedCategory?.cat === cat) ref = this.savedCategory.k;
    const base = Math.max(fk, Math.min(ref, fk * 1.4));
    const k = b.products.length ? Math.min(4, Math.max(1.6 * base, 36 / b.r)) : Math.min(base * 1.25, Math.max(base, 28 / b.r));
    const box = this.scene.fanFor(b).box;
    return { fit: { cx: w.x + (box.x0 + box.x1) / 2 / k, cy: w.y + (box.y0 + box.y1) / 2 / k, k }, area };
  }

  private setBounds(s: NavState) {
    let b: Bounds;
    if (s.level === "overview") {
      const o = this.overviewFit();
      b = { rect: this.liveBounds(), free: o.area, minK: o.fit.k * 0.8, maxK: 4, exitable: false };
    } else {
      const is = this.islandOf(s.cat);
      const c = this.scene.islandCentre(is);
      const f = this.categoryFit(s.cat);
      const pad = 0.15;
      const bw = (f.box.x1 - f.box.x0) * pad;
      const bh = (f.box.y1 - f.box.y0) * pad;
      const free = freeArea(s.level === "brand" ? "brand" : "category", this.vp);
      b = {
        rect: { x0: c.x + f.box.x0 - bw, y0: c.y + f.box.y0 - bh, x1: c.x + f.box.x1 + bw, y1: c.y + f.box.y1 + bh },
        free,
        minK: f.k * 0.75,
        maxK: 4,
        exitable: true,
      };
    }
    this.camera.bounds = b;
  }

  private computeChips(cat: MNode, mode: "slide" | "fade" | "snap") {
    const animate = mode === "slide";
    const sc = this.scene;
    const previous = new Map(sc.chipSlots);
    sc.chipSlots.clear();
    // The island now in focus keeps its old chip slot, so it grows out of the chip that was clicked.
    const mine = previous.get(cat);
    if (mine) sc.chipSlots.set(cat, mine);
    const others = sc.layout.islands.filter((is) => is.node !== cat);
    const place = (n: MNode, x: number, y: number, w: number, canvas: boolean) => {
      const old = previous.get(n);
      const ax = old?.x ?? new AnimValue(x);
      const ay = old?.y ?? new AnimValue(y);
      const a = old?.a ?? new AnimValue(1);
      if (old && animate && old.canvas === canvas) {
        ax.spring(x, MOTION.chipH);
        ay.spring(y, MOTION.chipH);
      } else {
        // A chip that jumps to a new slot fades in there once the chip that was clicked has gone.
        if (mode === "fade" && old && Math.hypot(ax.x - x, ay.x - y) > 2) a.snap(0).tween(1, 180, (t) => t, 260);
        else if (mode === "snap") a.snap(1);
        ax.snap(x);
        ay.snap(y);
      }
      sc.chipSlots.set(n, { x: ax, y: ay, a, cover: old?.cover ?? new AnimValue(1), w, canvas });
    };
    if (this.vp.mode === "narrow") {
      const slots = this.hooks.stripSlots();
      for (const is of others) {
        const p = slots.get(is.node);
        if (p) place(is.node, p.x, p.y, 0, false);
      }
      return;
    }
    const me = sc.islandCentre(this.islandOf(cat));
    const bearings = others.map((is) => {
      const c = sc.islandCentre(is);
      return Math.atan2(c.y - me.y, c.x - me.x);
    });
    const widths = others.map((is) => this.hooks.chipWidth(is.node));
    const slots = chipSlots(bearings, widths, this.vp, this.hooks.avoid());
    others.forEach((is, i) => place(is.node, slots[i].x, slots[i].y, slots[i].w, true));
  }

  // --- The one rule: state → targets ----------------------------------------------

  /** Applies a state; returns roughly how long (ms) until the camera arrives. */
  private apply(prev: NavState, next: NavState, instant: boolean): number {
    const sc = this.scene;
    const cam = this.camera;
    const reduced = reducedMotion.matches;
    const cat = next.level === "overview" ? null : next.cat;
    const prevCat = prev.level === "overview" ? null : prev.cat;
    sc.focused = cat;
    sc.focusedGroup = next.level === "category" ? (next.group ?? null) : null;

    if (cat) {
      this.computeFocusGeometry(cat);
      const chipsShown = sc.chipsVisible.x > 0.05;
      this.computeChips(cat, prevCat === cat && prev.level === "category" && chipsShown ? "slide" : chipsShown ? "fade" : "snap");
    }

    this.fitFrom = instant ? null : prev;
    const { fit, area } = this.fitFor(next);
    this.fitFrom = null;
    this.setBounds(next);

    // Which camera move?
    const fromOverview = prev.level === "overview" && next.level !== "overview";
    const changeIsland = !!prevCat && !!cat && prevCat !== cat;
    const sameBrand = prev.level === "brand" && next.level === "brand" && prev.brand === next.brand;
    const smallMove = !fromOverview && !changeIsland && (next.level === "brand" || prev.level === "brand" || (next.level === "category" && !!next.group) || (prev.level === "category" && !!prev.group));
    let flight: Progress | null = null;
    let landsIn = 300;
    if (instant) {
      cam.setFit(fit.cx, fit.cy, fit.k, area);
      landsIn = 0;
    } else if (reduced) {
      this.dipTarget = 1;
      window.setTimeout(() => cam.setFit(fit.cx, fit.cy, fit.k, area), 100);
      landsIn = 200;
    } else if (sameBrand) {
      // Only the selected product changed: keep the view.
      landsIn = 0;
    } else if (next.level === "category" && prev.level === "brand" && prev.cat === next.cat && !next.group) {
      // Back from a brand: return to where the user was, if they haven't moved since; otherwise make sure the island is in view.
      const saved = this.savedCategory;
      if (this.untouched && saved && saved.cat === next.cat) cam.springTo(saved.cx, saved.cy, saved.k, area);
      else if (!saved || saved.cat !== next.cat) cam.springTo(fit.cx, fit.cy, fit.k, area);
      else {
        // They moved: keep their view only if it still shows the category (not zoomed in at brand level,
        // and at least three quarters of its brands on screen).
        const F = sc.frame;
        const brands = brandsIn(next.cat);
        let outside = 0;
        for (const b of brands) {
          const x = F.sx[b.i];
          const y = F.sy[b.i];
          if (x < area.x || x > area.x + area.w || y < area.y || y > area.y + area.h) outside++;
        }
        if (cam.view.k > fit.k * 1.15 || outside > 0.25 * brands.length) cam.springTo(fit.cx, fit.cy, fit.k, area);
      }
    } else if (next.level === "overview" && prev.level !== "overview" && this.savedOverview) {
      // Back to where the user was at the overview, as long as that view shows the category being left.
      const o = this.overviewFit();
      const v = this.savedOverview;
      const k = o.fit.k * v.kRel;
      let ok = true;
      if (prevCat) {
        const c = sc.islandCentre(this.islandOf(prevCat));
        const x = o.area.x + o.area.w / 2 + (c.x - v.cx) * k;
        const y = o.area.y + o.area.h / 2 + (c.y - v.cy) * k;
        ok = x >= o.area.x && x <= o.area.x + o.area.w && y >= o.area.y && y <= o.area.y + o.area.h;
      }
      flight = ok ? cam.flyTo(v.cx, v.cy, k, o.area) : cam.flyTo(o.fit.cx, o.fit.cy, o.fit.k, o.area);
    } else if (smallMove && next.level === "brand" && !next.brand.products.length && !cam.programmatic && this.lensShift(next.brand, area)) {
      // A brand with no products opens in place at the current zoom; the view pans only if its lens would be cut off.
      const d = this.lensShift(next.brand, area)!;
      if (d.x || d.y) {
        const c = cam.toWorld(area.x + area.w / 2, area.y + area.h / 2);
        const k = cam.view.k;
        cam.springTo(c.x - d.x / k, c.y - d.y / k, k, area);
      } else landsIn = 0;
    } else if (smallMove) cam.springTo(fit.cx, fit.cy, fit.k, area);
    else if (!(next.level === "overview" && prev.level === "overview")) {
      flight = cam.flyTo(fit.cx, fit.cy, fit.k, area, {
        delayMs: fromOverview ? MOTION.flightDelayFromOverviewMs : 0,
        marks: next.level === "brand" && (fromOverview || changeIsland) ? [{ u: 0.6, fn: () => this.openFan(next.brand, next.product ?? null) }] : [],
      });
    }
    if (flight) landsIn = (fromOverview ? MOTION.flightDelayFromOverviewMs : 0) + 750;
    if (next.level === "overview" && prev.level !== "overview") this.overviewFlight = flight;

    const snapAll = instant || reduced;

    // Islands: collapse others into chips; focus this one.
    for (const is of sc.layout.islands) {
      const c = sc.collapse.get(is.node)!;
      const f = sc.focus.get(is.node)!;
      const cTarget = cat && is.node !== cat ? 1 : 0;
      const fTarget = cat && is.node === cat ? 1 : 0;
      if (snapAll) {
        c.snap(cTarget);
        f.snap(fTarget);
        continue;
      }
      if (cTarget === 1 && c.target !== 1) {
        // Leaving one category for another: it folds away with the flight, so it's still there
        // while the next one appears (no empty frames in between).
        if (flight && changeIsland && is.node === prevCat) c.link(flight, 1, (u) => smoothstep(0.15, 0.75, u));
        else c.tween(1, MOTION.collapseMs, easeInOutCubic);
      } else if (cTarget === 0 && c.target !== 0) {
        // Into a new category: it grows out of its chip early in the flight.
        // Back to the overview: islands re-expand as the camera pulls back.
        if (flight) c.link(flight, 0, changeIsland ? (u) => smoothstep(0, 0.3, u) : (u) => smoothstep(0.3, 1, u));
        else c.tween(0, MOTION.collapseMs, easeInOutCubic);
      }
      if (f.target !== fTarget) {
        if (flight) f.link(flight, fTarget);
        else f.spring(fTarget, MOTION.focusH);
      }
    }
    const nestleT = cat ? 0 : 1;
    if (snapAll) sc.nestleFade.snap(nestleT);
    else sc.nestleFade.tween(nestleT, cat ? 200 : 400, easeInOutCubic, cat ? 0 : 200);
    const chipsT = next.level === "category" ? 1 : 0;
    if (snapAll) sc.chipsVisible.snap(chipsT);
    else sc.chipsVisible.tween(chipsT, 150);

    // Brand open / close.
    const nextBrand = next.level === "brand" ? next.brand : null;
    const prevBrand = sc.open;
    if (prevBrand && prevBrand !== nextBrand) this.closeFan(prevBrand, snapAll);
    if (nextBrand) {
      sc.open = nextBrand;
      sc.fan = sc.fanFor(nextBrand);
      sc.selectedProduct = next.level === "brand" ? (next.product ?? null) : null;
      this.hooks.sharpen(nextBrand);
      if (snapAll) {
        sc.lens.snap(1);
        sc.dimOthers.snap(1);
        this.openFan(nextBrand, sc.selectedProduct, true);
      } else if (flight && (fromOverview || changeIsland)) {
        // The lens and dim ride the flight (and catch up if it's interrupted); products open at u = 0.6.
        // Coming from another brand, its lens closes first rather than jumping to the new one.
        if (prevBrand) {
          sc.lens.snap(0);
          sc.dimOthers.snap(0);
        }
        // From another brand the lens opens late, as the camera nears the new brand's zoom.
        const [a, b] = prevBrand ? [0.6, 0.85] : [0.45, 0.55];
        sc.lens.link(flight, 1, (u) => smoothstep(a, b, u));
        sc.dimOthers.link(flight, 1, (u) => smoothstep(a, b, u));
      } else {
        sc.lens.spring(1, MOTION.lensH);
        sc.dimOthers.spring(1, MOTION.dimH);
        if (prevBrand !== nextBrand) this.openFan(nextBrand, sc.selectedProduct);
      }
    } else {
      sc.open = null;
      sc.selectedProduct = null;
      if (snapAll) {
        sc.lens.snap(0);
        sc.dimOthers.snap(0);
      } else {
        sc.lens.spring(0, MOTION.lensH);
        sc.dimOthers.spring(0, MOTION.dimH);
      }
    }
    if (cat) this.hooks.prioritiseLogos([...this.islandOf(cat).units.flatMap((u) => (u.isGroup ? u.members.map((m) => m.node) : [u.node]))]);
    return landsIn;
  }

  private openFan(b: MNode, product: MNode | null, instant = false) {
    const sc = this.scene;
    if (sc.open !== b) return;
    if (!sc.lens.moving || sc.lens.target !== 1) sc.lens.spring(1, MOTION.lensH);
    if (!sc.dimOthers.moving || sc.dimOthers.target !== 1) sc.dimOthers.spring(1, MOTION.dimH);
    sc.selectedProduct = product;
    const fan = sc.fanFor(b);
    const usable = fan.more > 0 ? fan.slots.length - 1 : fan.slots.length;
    b.products.forEach((p, j) => {
      const o = sc.orbit.get(p)!;
      const l = sc.productLabel.get(p)!;
      const visible = j < usable;
      if (instant) {
        o.snap(visible ? 2 : 0);
        l.snap(visible ? 1 : 0);
        return;
      }
      const delay = MOTION.fanDelayMs + Math.min(150, j * 12);
      if (visible) {
        o.springUD(2, MOTION.fanZeta, MOTION.fanT, delay);
        l.tween(1, MOTION.labelInMs, (t) => t, delay + 160);
      } else o.spring(0, MOTION.fanCloseH);
    });
    // The "+N more" row's label fades in with the rest.
    if (fan.more > 0) {
      const lastSlot = b.products[fan.slots.length - 1];
      if (lastSlot) {
        const l = sc.productLabel.get(lastSlot)!;
        if (instant) l.snap(1);
        else l.tween(1, MOTION.labelInMs, (t) => t, MOTION.fanDelayMs + 160);
      }
    }
    this.hooks.invalidate();
  }

  private closeFan(b: MNode, instant: boolean) {
    const sc = this.scene;
    for (const p of b.products) {
      const o = sc.orbit.get(p)!;
      const l = sc.productLabel.get(p)!;
      if (instant) {
        o.snap(0);
        l.snap(0);
      } else {
        o.spring(0, MOTION.fanCloseH);
        l.tween(0, MOTION.labelOutMs, (t) => t);
      }
    }
  }

  /** Hover peek (moons spring out to a ring) and back. */
  peek(b: MNode, on: boolean) {
    const sc = this.scene;
    if (sc.open === b) return;
    b.products.forEach((p, j) => {
      const o = sc.orbit.get(p)!;
      if (on) o.springUD(1, MOTION.peekZeta, MOTION.peekT, Math.min(150, j * MOTION.peekStaggerMs));
      else o.spring(0, MOTION.peekInH);
    });
    this.hooks.invalidate();
  }

  /** Called when the viewport size/class changes. */
  viewportFor(w: number, h: number, coarse: boolean): Viewport {
    return { w, h, mode: layoutMode(w, h), coarse };
  }

  get chipH() {
    return SIZE.chipH;
  }
}
