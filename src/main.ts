/* ==========================================================================
   The Nestlé Empire — bootstrap and wiring.
   data → model → layout → scene/camera/physics → one frame loop → canvas.
   ========================================================================== */

import "./styles.css";
import { anyAnimating, AnimValue, setClock, smoothstep, stepAll } from "./anim";
import { Atlas } from "./atlas";
import { Camera } from "./camera";
import categoriesJson from "../data/categories.json";
import { ENTRIES } from "./data";
import { freeArea, layoutMode, pickSignposts, type Viewport } from "./geometry";
import { buildLabels, pillExtra } from "./labeling";
import { LabelPlacer } from "./labels";
import { arrange, layoutReport, packIslands, snapAspect, type Rect } from "./layout";
import { invalidate, frameStats, loopRunning, pump, setFrame } from "./loop";
import { brandsIn, buildModel, countBrands, type CategoryMeta, type MNode } from "./model";
import { Nav } from "./nav";
import { Physics } from "./physics";
import { pick, Renderer, type Hit } from "./render";
import { format, parse, stateFor, type NavState } from "./router";
import { Scene } from "./scene";
import { MOTION, SIZE } from "./tokens";
import { Card, LABELS } from "./ui/card";
import { Caption, Legend, Mirror, Strip, Tooltip, TopBar, buildHelp } from "./ui/chrome";
import { Search } from "./ui/search";
import { Input } from "./input";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// Model and layout
// ---------------------------------------------------------------------------

const model = buildModel(ENTRIES, categoriesJson as Record<string, CategoryMeta>);
const pack = packIslands(model);
const canvas = $<HTMLCanvasElement>("map");
const coarseQuery = window.matchMedia("(pointer: coarse)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function readViewport(): Viewport {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return { w, h, mode: layoutMode(w, h), coarse: coarseQuery.matches };
}
let vp = readViewport();
const aspectOf = (v: Viewport) => {
  const a = freeArea("overview", v);
  return snapAspect(a.w / a.h);
};
let layout = arrange(pack, aspectOf(vp));
const scene = new Scene(model, layout, vp);
const camera = new Camera();
const physics = new Physics(scene);
const renderer = new Renderer(canvas);
const placer = new LabelPlacer(renderer.ctx);
scene.measure = (t, f) => placer.measure(t, f);

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

const card = new Card($("card"), model, {
  navigate: (n) => go(stateFor(n), n),
  up: () => nav.up(),
  overview: () => nav.go({ level: "overview" }),
  hoverProduct: (p) => {
    scene.keyFocus = p;
    invalidate();
  },
});
const topbar = new TopBar($("topbar"), (n) => (n ? go(stateFor(n)) : nav.go({ level: "overview" })));
const strip = new Strip($("strip"), model, (n, up) => {
  if (up) nav.up();
  else if (n) go(stateFor(n));
});
const tooltip = new Tooltip($("tooltip"));
const caption = new Caption($("caption"));
const toast = new Caption($("toast"));
const overshootPill = new Caption($("overshoot"));
const helpPop = $("help-pop");
buildHelp(helpPop, coarseQuery.matches);
const mirror = new Mirror(
  $("mirror"),
  $("live"),
  model,
  (n) => go(stateFor(n)),
  (n) => {
    scene.keyFocus = n;
    if (n) bringIntoView(n);
    invalidate();
  },
);
const legend = new Legend(
  $("legend"),
  model,
  scene.hiddenStatuses,
  () => applyFilters(),
  (s) => {
    scene.highlightSet = s ? new Set(model.brands.filter((b) => b.status === s)) : null;
    scene.highlight.tween(s ? 1 : 0, MOTION.filterMs);
    invalidate();
  },
);
const search = new Search(topbar.searchMount, model, {
  pick: (n) => go(stateFor(n), n),
  highlight: (set) => {
    if (set) scene.highlightSet = set;
    scene.highlight.tween(set ? 1 : 0, MOTION.filterMs);
    if (!set) window.setTimeout(() => !scene.highlight.target && (scene.highlightSet = null), 200);
    invalidate();
  },
});
topbar.searchButton.addEventListener("click", () => {
  document.body.classList.toggle("search-open");
  if (document.body.classList.contains("search-open")) search.focus();
});
search.input.addEventListener("blur", () => window.setTimeout(() => document.body.classList.remove("search-open"), 150));
function closeHelp() {
  helpPop.hidden = true;
  topbar.helpButton.setAttribute("aria-expanded", "false");
}
topbar.helpButton.addEventListener("click", () => {
  helpPop.hidden = !helpPop.hidden;
  topbar.helpButton.setAttribute("aria-expanded", String(!helpPop.hidden));
});
/** Set when a press only closed a popover: its click shouldn't also act on the map. */
let swallowClick = false;
document.addEventListener("pointerdown", (e) => {
  const inside = (sel: string) => e.target instanceof Element && !!e.target.closest(sel);
  let closed = legend.closedAt === e.timeStamp;
  if (!helpPop.hidden && !inside("#help-pop, .help-button")) {
    closeHelp();
    closed = true;
  }
  if (document.body.classList.contains("search-open") && !inside(".search-mount, .search-toggle")) {
    document.body.classList.remove("search-open");
    search.input.blur();
    closed = true;
  }
  swallowClick = closed;
});

const tidyButton = $("tidy");
$("zoom-in").addEventListener("click", () => zoomButton(Math.log(1.5)));
$("zoom-out").addEventListener("click", () => zoomButton(-Math.log(1.5)));
$("show-all").addEventListener("click", () => nav.go({ level: "overview" }));
tidyButton.addEventListener("click", () => {
  physics.tidyUp();
  tidyButton.hidden = true;
  invalidate();
});
physics.onFirstDrop = () => (tidyButton.hidden = false);

function zoomButton(ln: number) {
  const a = freeArea(levelOf(nav.state), vp);
  camera.zoomSpring(ln, a.x + a.w / 2, a.y + a.h / 2, "now");
  nav.userMoved();
  invalidate();
}

// Chrome rectangles that labels and chips must avoid; refreshed on layout changes only.
let chrome: Rect[] = [];
function refreshChrome() {
  chrome = [];
  for (const id of ["topbar", "legend", "controls", "strip"]) {
    const e = $(id);
    if (!e || e.hidden) continue;
    const r = e.getBoundingClientRect();
    if (r.width && r.height) chrome.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
  }
  if (card.root.classList.contains("is-open")) {
    const r = card.root.getBoundingClientRect();
    if (vp.mode === "wide") chrome.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
    else chrome.push({ x0: 0, y0: window.innerHeight - card.sheetHeight(nav.state.level, window.innerHeight), x1: window.innerWidth, y1: window.innerHeight });
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const levelOf = (s: NavState) => (s.level === "overview" ? "overview" : s.level === "category" ? "category" : "brand");

/** Atlas cells sized for the largest badge (30 px radius) at this screen's pixel density. */
const atlasCell = () => Math.min(128, Math.ceil(60 * Math.min(2, window.devicePixelRatio || 1)));
const atlas = new Atlas(model, atlasCell(), (n) => {
  const a = scene.logoA.get(n);
  if (a) {
    if (scene.frame.vis[n.i]) a.tween(1, 120, (t) => t);
    else a.snap(1);
  }
  invalidate();
});

/** The open brand gets a logo bitmap decoded at its on-screen size. */
function sharpen(b: MNode) {
  const px = 2 * (vp.mode === "wide" ? SIZE.openBadge : SIZE.openBadgeNarrow) * Math.min(2, window.devicePixelRatio || 1);
  void atlas.makeSharp(b, px);
}

const nav = new Nav(model, scene, camera, {
  render: (state) => {
    card.show(state);
    topbar.show(state);
    strip.show(state, vp.mode === "narrow", nav.origin);
    mirror.sync(state);
    clearTimeout(tipTimer);
    tooltip.hide();
    document.body.dataset.level = state.level;
    requestAnimationFrame(refreshChrome);
    if (state.level === "category" && !(state as { group?: MNode }).group) coachFocus();
    window.setTimeout(explainEmpty, 0);
  },
  chipWidth: (c) => placer.measure(c.short, `600 12.5px "DM Sans", sans-serif`) + 24 + 10 + pillExtra((t, f) => placer.measure(t, f), pillCount(c), undefined, true),
  avoid: () => {
    const open = card.root.classList.contains("is-open");
    const cardBottom = open ? card.root.getBoundingClientRect().bottom : 72;
    const legendRect = $("legend").getBoundingClientRect();
    const controlsRect = $("controls").getBoundingClientRect();
    return { cardBottom, legendRight: legendRect.right, controlsLeft: controlsRect.left };
  },
  stripSlots: () => strip.slots(),
  prioritiseLogos: (nodes) => atlas.prioritise(nodes),
  beforeNavigate: () => physics.settleNow(),
  sharpen,
  invalidate,
});
camera.onOvershoot = (amount) => {
  if (amount >= 0.2) overshootPill.show("Release to go up");
  else overshootPill.hide();
};

/** Opening a brand or product that the Key hides shows its ownership type again (with a note). */
function revealFor(state: NavState) {
  const shown = new Set<string>();
  const show = (n: MNode | undefined) => {
    if (n && scene.hiddenStatuses.delete(n.status)) shown.add(LABELS[n.status]);
  };
  if (state.level === "brand") {
    show(state.brand);
    show(state.product);
  } else if (state.level === "category" && state.group) {
    const members = brandsIn(state.group);
    if (members.length && members.every((b) => scene.isFiltered(b))) members.forEach(show);
  }
  if (!shown.size) return;
  legend.sync();
  applyFilters();
  toast.show(`Showing ${[...shown].join(" and ")} again`, 2500);
}

function go(state: NavState, pulse?: MNode) {
  dismissCoach();
  search.clear();
  revealFor(state);
  nav.go(state, { pulse: pulse && (pulse.kind === "brand" || pulse.kind === "product") ? pulse : undefined, replace: isProductSwitch(state) });
}

function isProductSwitch(next: NavState) {
  const cur = nav.state;
  return cur.level === "brand" && next.level === "brand" && cur.brand === next.brand && !!cur.product && !!next.product;
}

window.addEventListener("popstate", () => {
  const { state, exact } = parse(location.hash, model);
  if (!exact) history.replaceState(null, "", format(state));
  revealFor(state);
  nav.go(state, { push: false });
});

// ---------------------------------------------------------------------------
// Filters and pills
// ---------------------------------------------------------------------------

function pillCount(c: MNode): string {
  const all = brandsIn(c);
  if (!scene.hiddenStatuses.size) return String(all.length);
  const shown = all.filter((b) => !scene.isFiltered(b)).length;
  return `${shown} of ${all.length}`;
}

function applyFilters() {
  for (const [n, a] of scene.filterA) a.tween(scene.isFiltered(n) ? 0 : 1, MOTION.filterMs);
  const s = nav.state;
  if (s.level === "brand") {
    if (scene.isFiltered(s.brand)) nav.go({ level: "category", cat: s.cat });
    else if (s.product && scene.isFiltered(s.product)) nav.go({ level: "brand", cat: s.cat, brand: s.brand });
  } else if (s.level === "category" && s.group && brandsIn(s.group).every((b) => scene.isFiltered(b))) {
    nav.go({ level: "category", cat: s.cat });
  }
  explainEmpty();
  nav.recomputeChips();
  invalidate();
}

/** A category whose brands are all hidden by the Key says so, instead of just looking empty. */
function explainEmpty() {
  const s = nav.state;
  if (s.level !== "category" || !scene.hiddenStatuses.size) return;
  const all = brandsIn(s.cat);
  if (all.length && all.every((b) => scene.isFiltered(b))) caption.show(`All ${all.length} brands here are hidden by the Key`, 4000);
}

// ---------------------------------------------------------------------------
// Hover: lift, peek after a short dwell, tooltip
// ---------------------------------------------------------------------------

let hoverNode: MNode | null = null;
let hoverIsland: MNode | null = null;
let peekTimer = 0;
let peekOff = 0;
let tipTimer = 0;
let peeked: MNode | null = null;
let lastPointer = { x: 0, y: 0 };

function nodeOfHit(h: Hit | null): MNode | null {
  if (!h) return null;
  return h.node;
}

function setHover(h: Hit | null, x: number, y: number) {
  lastPointer = { x, y };
  const n = nodeOfHit(h);
  const island = h && (h.kind === "island" || (h.kind === "label" && h.node.kind === "category")) ? h.node : null;
  canvas.style.cursor = h && !(h.kind === "island" && scene.focused === h.node) ? "pointer" : "";
  if (island !== hoverIsland) {
    hoverIsland = island;
    invalidate();
  }
  if (n === hoverNode) {
    if (n && tooltip.current === n) placeTooltip(n);
    return;
  }
  // Leaving
  if (hoverNode) {
    const lift = scene.lift.get(hoverNode);
    if (lift && hoverNode !== scene.dragged) lift.spring(1, MOTION.hoverH);
    const leaving = hoverNode;
    if (peeked === leaving) {
      clearTimeout(peekOff);
      peekOff = window.setTimeout(() => {
        if (hoverNode !== leaving && !(hoverNode?.kind === "product" && hoverNode.brand === leaving)) {
          nav.peek(leaving, false);
          if (peeked === leaving) peeked = null;
        }
      }, 80);
    }
  }
  hoverNode = n;
  scene.hovered = n && (n.kind === "brand" || n.kind === "group" || n.kind === "product") ? n : null;
  clearTimeout(peekTimer);
  clearTimeout(tipTimer);
  if (!n) {
    tooltip.hide();
    invalidate();
    return;
  }
  const lift = scene.lift.get(n);
  if (lift && (n.kind === "brand" || n.kind === "root" || (n.kind === "category" && !!scene.focused))) lift.spring(MOTION.hoverLift, MOTION.hoverH);
  if (n.kind === "brand" && n.products.length && n !== scene.open) {
    peekTimer = window.setTimeout(() => {
      if (hoverNode === n) {
        if (peeked && peeked !== n) nav.peek(peeked, false);
        peeked = n;
        nav.peek(n, true);
      }
    }, MOTION.peekDwellMs);
  }
  const warm = performance.now() - tooltip.lastHidden < MOTION.tooltipWarmMs;
  const showTip = () => {
    if (hoverNode !== n || (n.kind === "category" && scene.focused === n && h?.kind === "island")) return;
    placeTooltip(n);
  };
  if (warm) showTip();
  else tipTimer = window.setTimeout(showTip, MOTION.tooltipDwellMs);
  invalidate();
}

function placeTooltip(n: MNode) {
  const F = scene.frame;
  if (n.kind === "category") {
    const j = layout.islands.findIndex((is) => is.node === n);
    const chip = F.chips.find((c) => c.island.node === n);
    if (chip) tooltip.show(n, chip.x + chip.w / 2, chip.y, 14, `Go to ${n.short} · ${countBrands(n)} brands`);
    else if (n === scene.focused) tooltip.show(n, F.sx[n.i], F.sy[n.i], 18, `${countBrands(n)} brands · click to re-centre`);
    else tooltip.show(n, F.islandX[j], F.islandY[j], F.islandR[j]);
    return;
  }
  if (n.kind === "group") {
    tooltip.show(n, lastPointer.x, lastPointer.y, 12);
    return;
  }
  if (n === scene.open) return;
  // A product row in the open lens already shows its name and status.
  if (n.kind === "product" && n.brand === scene.open) return;
  tooltip.show(n, F.sx[n.i], F.sy[n.i], F.s[n.i]);
}

// ---------------------------------------------------------------------------
// Clicks, following the table in the spec (D3)
// ---------------------------------------------------------------------------

/**
 * Whether a click is close to the focused category's content (its hub or a brand, with a margin
 * for near misses). A click on empty space anywhere else goes back up.
 */
function insideFocusedIsland(x: number, y: number): boolean {
  const cat = scene.focused;
  if (!cat) return false;
  const F = scene.frame;
  if (Math.hypot(x - F.sx[cat.i], y - F.sy[cat.i]) < 40) return true;
  for (const b of brandsIn(cat)) {
    if (F.vis[b.i] && Math.hypot(x - F.sx[b.i], y - F.sy[b.i]) < F.s[b.i] + 28) return true;
  }
  for (const g of cat.children) {
    if (g.kind === "group" && F.vis[g.i] && Math.hypot((x - F.sx[g.i]) / (F.rx[g.i] + 28), (y - F.sy[g.i]) / (F.ry[g.i] + 28)) < 1) return true;
  }
  // Brand names and the category's chips (including faded ones) aren't empty space either.
  for (const l of placer.visible()) {
    if (!l.key.startsWith("brand:") && !l.key.startsWith("chip:")) continue;
    const r = l.rect;
    if (x >= r.x0 - 12 && x <= r.x1 + 12 && y >= r.y0 - 12 && y <= r.y1 + 12) return true;
  }
  return false;
}

/** Handles a click; returns true if it navigated or moved the view. */
function onClick(h: Hit | null, x: number, y: number): boolean {
  if (swallowClick) {
    swallowClick = false;
    return true;
  }
  dismissCoach();
  clearTimeout(tipTimer);
  tooltip.hide();
  closeHelp();
  const s = nav.state;
  if (!h) {
    if (s.level === "overview") {
      if (s.card) {
        nav.go({ level: "overview" });
        return true;
      }
      return false;
    }
    if (s.level === "brand") {
      nav.up();
      return true;
    }
    if (s.group) {
      nav.go({ level: "category", cat: s.cat });
      return true;
    }
    if (!insideFocusedIsland(x, y)) {
      nav.go({ level: "overview" });
      return true;
    }
    return false;
  }
  const n = h.node;
  switch (h.kind) {
    case "more":
      card.revealProducts();
      return false;
    case "open":
      if (s.level === "brand" && n === s.brand) {
        if (Math.hypot(x - scene.frame.sx[n.i], y - scene.frame.sy[n.i]) <= scene.frame.s[n.i] + 4) {
          nav.refit();
          return true;
        }
        return false; // anywhere else inside the lens does nothing
      }
      go(stateFor(n));
      return true;
    case "island":
      if (scene.focused === n) {
        if (!insideFocusedIsland(x, y)) {
          nav.go({ level: "overview" });
          return true;
        }
        return false;
      }
      go(stateFor(n));
      return true;
    case "hub":
      if (s.level !== "overview" && s.cat === n) {
        if (s.level === "brand" || s.group) nav.go({ level: "category", cat: n });
        else nav.refit();
        return true;
      }
      go(stateFor(n));
      return true;
    case "nestle":
      nav.go(s.level === "overview" && !s.card ? { level: "overview", card: "nestle" } : { level: "overview" });
      return true;
    case "label":
      if (n.kind === "category" && scene.focused === n) {
        nav.refit();
        return true;
      }
      go(stateFor(n));
      return true;
    default:
      go(stateFor(n));
      return true;
  }
}

// ---------------------------------------------------------------------------
// Drag
// ---------------------------------------------------------------------------

function dragTarget(h: Hit): MNode | null {
  const n = h.node;
  switch (h.kind) {
    case "brand":
    case "open":
      return n.kind === "brand" ? n : null;
    case "fanRow":
      return n.brand;
    case "label":
      if (n.kind === "brand") return n;
      if (n.kind === "group") return n;
      if (n.kind === "category" && !scene.focused) return n;
      return null;
    case "island":
      return scene.focused ? null : n;
    case "hub":
      return scene.focused ? null : n;
    case "nestle":
      return scene.focused ? null : n;
    default:
      return null;
  }
}

let dragNode: MNode | null = null;
function startDrag(h: Hit, x: number, y: number): boolean {
  if (swallowClick) return false;
  const n = dragTarget(h);
  if (!n) return false;
  const w = camera.toWorld(x, y);
  const a = freeArea(levelOf(nav.state), vp);
  const v0 = camera.toWorld(a.x, a.y);
  const v1 = camera.toWorld(a.x + a.w, a.y + a.h);
  if (!physics.start(n, w.x, w.y, camera.view.k, { x0: v0.x, y0: v0.y, x1: v1.x, y1: v1.y })) return false;
  camera.stop();
  dragNode = n;
  tooltip.hide();
  setHover(null, x, y);
  scene.lift.get(n)?.spring(MOTION.dragLift, 0.025);
  canvas.style.cursor = "grabbing";
  dismissCoach();
  return true;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const input = new Input($("map-wrap"), camera, {
  pick: (x, y, coarse) => pick(renderer.hits, x, y, coarse),
  draggable: (h) => !!dragTarget(h),
  onHover: (h, x, y) => {
    if (input.dragging || physics.dragging) return;
    setHover(h, x, y);
  },
  onClick: (h, x, y) => onClick(h, x, y),
  resume: () => nav.refit(),
  resumes: (h) => (h.kind === "island" && h.node === scene.focused) || (h.kind === "open" && h.node === scene.open),
  onDoubleClick: (h, x, y, shift) => {
    if (h && !(h.kind === "island" && scene.focused === h.node)) return;
    camera.zoomSpring(shift ? -Math.LN2 : Math.LN2, x, y);
    nav.userMoved();
  },
  onDragStart: startDrag,
  onDragMove: (x, y) => {
    const w = camera.toWorld(x, y);
    physics.move(w.x, w.y);
    invalidate();
  },
  onDragEnd: (vx, vy, cancelled) => {
    if (cancelled) physics.cancel();
    else physics.release(vx, vy);
    if (dragNode) scene.lift.get(dragNode)?.springUD(1, reducedMotion.matches ? 1 : 0.6, 0.25);
    dragNode = null;
    canvas.style.cursor = "";
    invalidate();
  },
  onUserCamera: () => {
    nav.userMoved();
    dismissCoach();
  },
  onFirstMouseWheel: () => toast.show(navigator.platform.startsWith("Mac") ? "Tip: hold ⌘ and scroll to zoom" : "Tip: hold Ctrl and scroll to zoom", 3500),
  ignoreWheel: (t) => t instanceof Element && !!t.closest(".card-body, #search-results, .legend-panel, #help-pop, #strip"),
  freeEdges: () => {
    const a = freeArea(levelOf(nav.state), vp);
    return { x0: a.x, y0: a.y, x1: a.x + a.w, y1: a.y + a.h };
  },
  invalidate,
});

// Keyboard
window.addEventListener("keydown", (e) => {
  const t = e.target instanceof HTMLElement ? e.target : document.body;
  if (t instanceof HTMLInputElement || t.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const a = freeArea(levelOf(nav.state), vp);
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const inMirror = !!t.closest("#mirror");
  switch (e.key) {
    case "/":
    case "s":
    case "S":
      e.preventDefault();
      if (vp.mode === "narrow") document.body.classList.add("search-open");
      search.focus();
      return;
    case "Escape":
      if (!helpPop.hidden) {
        closeHelp();
        return;
      }
      if (legend.close()) return;
      nav.up();
      return;
    case "+":
    case "=":
      camera.zoomSpring(Math.log(1.5), cx, cy);
      break;
    case "-":
    case "_":
      camera.zoomSpring(-Math.log(1.5), cx, cy, "now");
      break;
    case "0":
    case "!":
      nav.go({ level: "overview" });
      return;
    case "@":
      nav.refit();
      return;
    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowDown": {
      if (inMirror) return;
      const step = e.shiftKey ? 300 : 100;
      const dx = e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
      const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
      camera.wheelPanBy(dx, dy);
      break;
    }
    default:
      return;
  }
  e.preventDefault();
  nav.userMoved();
  invalidate();
});

function bringIntoView(n: MNode) {
  const F = scene.frame;
  const a = freeArea(levelOf(nav.state), vp);
  const x = n.kind === "category" ? F.islandX[layout.islands.findIndex((is) => is.node === n)] : F.sx[n.i];
  const y = n.kind === "category" ? F.islandY[layout.islands.findIndex((is) => is.node === n)] : F.sy[n.i];
  if (x < a.x || x > a.x + a.w || y < a.y || y > a.y + a.h) {
    const w = camera.toWorld(x, y);
    camera.springTo(w.x, w.y, camera.view.k, a);
  }
}

// ---------------------------------------------------------------------------
// Signposts, recomputed only once the camera has settled
// ---------------------------------------------------------------------------

/** Returns true if any signpost started fading in or out. */
function updateSignposts(): boolean {
  const F = scene.frame;
  const k = camera.view.k;
  const narrow = vp.mode === "narrow";
  const want = new Set<MNode>();
  layout.islands.forEach((is, j) => {
    const cat = is.node;
    if (scene.focus.get(cat)!.x > 0.01 || scene.collapse.get(cat)!.x > 0.01) return;
    const D = 2 * is.R * k;
    if (D >= SIZE.signpost * 22) return;
    const brands = brandsIn(cat);
    const chosen = pickSignposts(
      {
        brands,
        pos: brands.map((b) => ({ x: F.sx[b.i], y: F.sy[b.i] })),
        cx: F.islandX[j],
        cy: F.islandY[j],
        R: F.islandR[j],
        available: (b) => !scene.isFiltered(b) && !!b.e.logo,
      },
      narrow,
    );
    for (const b of chosen) want.add(b);
  });
  let changed = false;
  for (const b of model.brands) {
    const a = scene.signpost.get(b)!;
    const t = want.has(b) ? 1 : 0;
    if (a.target !== t) {
      a.tween(t, 160);
      changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

let frameNo = 0;
let lastLabelPass = 0;
setFrame(
  (dt, now) => {
    frameNo++;
    setClock(now);
    let busy = input.tick(now);
    busy = camera.step(dt, now) || busy;
    busy = physics.step(dt) || busy;
    busy = stepAll(dt, now) || busy;
    busy = nav.stepDip(dt) || busy;
    scene.resolve(camera.view, now);

    // Labels: full passes at rest, every other frame while the user moves, minimal during flights.
    const forced = new Set<MNode>();
    if (hoverNode && (hoverNode.kind === "brand" || hoverNode.kind === "group")) forced.add(hoverNode);
    if (scene.dragged) forced.add(scene.dragged);
    if (scene.keyFocus && scene.keyFocus.kind === "brand") forced.add(scene.keyFocus);
    if (nav.state.level === "brand" && !scene.lens.x) forced.add(nav.state.brand);
    const minimal = camera.flying;
    const { specs, obstacles, hard, arcs } = buildLabels(
      { model, scene, forced, hoverIsland, chrome, narrow: vp.mode === "narrow", pillCount, minimal },
      (t, f) => placer.measure(t, f),
    );
    const doPlace = !camera.userMoving || frameNo - lastLabelPass >= 2;
    if (doPlace) {
      placer.place(specs, obstacles, { x0: 4, y0: vp.mode === "wide" ? SIZE.topbar + 2 : SIZE.topbarNarrow + 2, x1: vp.w - 4, y1: vp.h - 4 }, hard);
      lastLabelPass = frameNo;
    } else placer.follow(new Map(specs.map((s) => [s.key, s])));
    busy = placer.step(dt) || busy;
    // Label building may start small fades (chips over badges): keep the loop going for them.
    busy = anyAnimating() || busy;

    renderer.draw(scene, model, atlas, placer.visible(), { focused: scene.focused, open: scene.open, selectedProduct: scene.selectedProduct, hoverIsland, coarse: vp.coarse, dip: nav.dip, arcs }, now);
    if (tooltip.current && (camera.moving || physics.active)) placeTooltip(tooltip.current);
    return busy || !!scene.pulse || input.busy;
  },
  () => {
    // Settled: signposts and a fresh hover test. Only redraw if something actually changed,
    // otherwise the loop would never go idle.
    camera.userMoving = false;
    let changed = updateSignposts();
    if (!input.busy && lastPointer.x > 0 && !vp.coarse) {
      const before = hoverNode;
      setHover(pick(renderer.hits, lastPointer.x, lastPointer.y, vp.coarse), lastPointer.x, lastPointer.y);
      changed = changed || before !== hoverNode;
    }
    if (changed) invalidate();
  },
);

// ---------------------------------------------------------------------------
// Resize and device pixel ratio
// ---------------------------------------------------------------------------

function resize() {
  const next = readViewport();
  const dpr = Math.min(next.mode === "narrow" ? 2 : 3, window.devicePixelRatio || 1);
  renderer.resize(next.w, next.h, dpr);
  atlas.rebuild(atlasCell());
  const classChanged = aspectOf(next) !== aspectOf(vp) || next.mode !== vp.mode;
  vp = next;
  scene.setViewport(vp);
  card.setNarrow(vp.mode === "narrow");
  document.body.classList.toggle("is-narrow", vp.mode === "narrow");
  if (classChanged) {
    // A drag in progress belongs to the old layout: end it where it is.
    physics.settleNow();
    layout = arrange(pack, aspectOf(vp));
    scene.setLayout(layout);
    scene.islandDrop.clear();
  }
  strip.show(nav.state, vp.mode === "narrow", nav.origin);
  refreshChrome();
  scene.setViewport(vp);
  nav.resized(classChanged);
  // The open badge's size depends on the layout mode.
  if (nav.state.level === "brand") sharpen(nav.state.brand);
  invalidate();
}
new ResizeObserver(() => {
  refreshChrome();
  nav.recomputeChips();
}).observe(card.root);
let resizeFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(resize);
}).observe(document.documentElement);
// A change of pixel density (moving the window to another screen, or browser zoom) needs a resize and sharper logos.
function watchDpr() {
  window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.(
    "change",
    () => {
      resize();
      if (nav.state.level === "brand") sharpen(nav.state.brand);
      watchDpr();
    },
    { once: true },
  );
}
watchDpr();

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

const ONBOARD_KEY = "nestle-empire:onboard:v1";
function onboardFlags(): number {
  try {
    return Number(localStorage.getItem(ONBOARD_KEY) ?? 0);
  } catch {
    return 3;
  }
}
function setOnboardFlag(bit: number) {
  try {
    localStorage.setItem(ONBOARD_KEY, String(onboardFlags() | bit));
  } catch {
    /* storage unavailable: show hints every visit */
  }
}
let coachDismissable = false;
function dismissCoach() {
  if (coachDismissable) {
    caption.hide();
    coachDismissable = false;
  }
}
function demo() {
  if (onboardFlags() & 1) return;
  setOnboardFlag(1);
  const touch = coarseQuery.matches;
  caption.show(touch ? "Tap to explore · Drag to move · Pinch to zoom · Hold to pick up" : "Hover to peek · Click to explore · Scroll to move · ⌘/Ctrl-scroll to zoom", 9000);
  coachDismissable = false;
  window.setTimeout(() => (coachDismissable = true), 900);
  if (reducedMotion.matches) return;
  const nescafe = model.byId.get("3");
  if (nescafe && nav.state.level === "overview") {
    nav.peek(nescafe, true);
    scene.signpost.get(nescafe)?.tween(1, 160);
    window.setTimeout(() => nav.peek(nescafe, false), 1200);
  }
}
function coachFocus() {
  if (onboardFlags() & 2) return;
  setOnboardFlag(2);
  window.setTimeout(() => {
    caption.show(coarseQuery.matches ? "Tap a brand to see its products" : "Hover a brand to see its products", 4000);
    coachDismissable = false;
    window.setTimeout(() => (coachDismissable = true), 600);
  }, 1100);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

resize();
atlas.load([
  model.root,
  ...model.categories.filter((c) => c.e.logo),
  ...model.brands.filter((b) => b.hero < 999).sort((a, b) => a.hero - b.hero),
  ...model.brands,
]);
document.fonts?.load(`600 15px "DM Sans"`).finally(() => {
  atlas.fontsLoaded();
  placer.flushWidths();
  invalidate();
});
window.setTimeout(() => atlas.fontsLoaded(), 800);

const initial = parse(location.hash, model);
if (!initial.exact) history.replaceState(null, "", format(initial.state));
if (initial.state.level !== "overview" || initial.state.card) {
  nav.go(initial.state, { push: false, instant: true });
} else {
  const { fit, area } = nav.overviewFit();
  camera.setFit(fit.cx, fit.cy, fit.k, area);
  nav.go({ level: "overview" }, { push: false, instant: true });
  window.setTimeout(demo, 900);
}
nav.refit(true);
// Pick the overview's signposts now, so the first label pass already places pills around them
// (instead of moving pills once they appear).
scene.resolve(camera.view, performance.now());
updateSignposts();
for (const b of model.brands) {
  const a = scene.signpost.get(b)!;
  if (a.target === 1) a.snap(1);
}
canvas.classList.add("is-ready");
invalidate();

// ---------------------------------------------------------------------------
// Debug hooks (always on; tiny and harmless)
// ---------------------------------------------------------------------------

(window as unknown as { __ne: unknown }).__ne = {
  state: () => format(nav.state),
  go: (hash: string) => nav.go(parse(hash, model).state),
  view: () => ({ ...camera.view }),
  screenOf: (id: string) => {
    const n = model.byId.get(id);
    if (!n) return null;
    const F = scene.frame;
    if (n.kind === "category") {
      const j = layout.islands.findIndex((is) => is.node === n);
      return { x: F.islandX[j], y: F.islandY[j], r: F.islandR[j] };
    }
    return { x: F.sx[n.i], y: F.sy[n.i], r: F.s[n.i], vis: F.vis[n.i], beta: F.beta[n.i] };
  },
  labels: () => placer.visible().map((l) => l.text),
  placed: () => placer.visible().map((l) => ({ key: l.key, text: l.text, rect: l.rect, alpha: l.alpha })),
  hits: (x: number, y: number) => {
    const h = pick(renderer.hits, x, y, false);
    return h ? { kind: h.kind, name: h.node.name } : null;
  },
  layoutReport: () => layoutReport(layout),
  frameStats,
  loopRunning,
  pump,
  find: (name: string) => model.nodes.find((n) => n.name.toLowerCase() === name.toLowerCase())?.id ?? null,
  debug: () => ({ nav, scene, camera, physics, hoverNode, peeked }),
};
void AnimValue;
void smoothstep;
