import "./styles.css";
import { Camera, MAX_ZOOM, MIN_ZOOM, type Area, type Transform } from "./camera";
import { ENTRIES } from "./data";
import { buildGraph, focusPositions, overviewPositions, PEEK, within, type GraphLink, type GraphNode, type Positions } from "./graph";
import { attachInput } from "./input";
import { Panel } from "./panel";
import { Physics } from "./physics";
import { LOD, Renderer } from "./render";
import { attachSearch } from "./search";
import type { Status } from "./types";

const GRID = 24; // background dot spacing at zoom 1
const NARROW = 760; // matches the CSS breakpoint where the panel becomes a bottom sheet
const CONTROLS_WIDTH = 80; // zoom buttons column plus its margin

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector(selector) as T;

const stage = $("#stage");
const svg = $<SVGSVGElement>("#graph");
const viewport = $<SVGGElement>("#viewport");
const panelEl = $("#panel");
const masthead = $(".masthead");
const crumbs = $("#crumbs");
const hint = $("#hint");
const helpButton = $("#help-toggle");

const graph = buildGraph(ENTRIES);
const renderer = new Renderer(svg, graph, {
  links: $("#links"),
  nodes: $("#nodes"),
  products: $("#products"),
  hubs: $("#hubs"),
});
const physics = new Physics(graph.placed, () => renderer.paint());
graph.root.fx = graph.root.x;
graph.root.fy = graph.root.y;
renderer.paint();

const linksOf = new Map<GraphNode, GraphLink[]>(graph.placed.map((n) => [n, []]));
for (const l of graph.links) {
  linksOf.get(l.source)!.push(l);
  linksOf.get(l.target)!.push(l);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** The category being looked at in focus mode, or null for the overview. */
let focus: GraphNode | null = null;
/** The brand whose products are fanned out. */
let open: GraphNode | null = null;
/** What the detail panel shows. */
let selected: GraphNode | null = null;
let hovered: GraphNode | null = null;
let dragging: GraphNode | null = null;
/** Once the user has moved the map, window resizes stop re-fitting it. */
let userMoved = false;

const hiddenStatuses = new Set<Status>();

/** Filtered out by the legend. Products also hide when their brand does. */
const isFiltered = (n: GraphNode) =>
  (n.kind === "brand" || n.kind === "product") && (hiddenStatuses.has(n.status) || (n.kind === "product" && !!n.brand && hiddenStatuses.has(n.brand.status)));

/** Tucked away because another category is in focus. */
const isAway = (n: GraphNode) => !!focus && n.kind !== "root" && n.kind !== "category" && !within(n, focus);

const isShown = (n: GraphNode) => !isAway(n) && !isFiltered(n);

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

let logoFrame = 0;

const camera = new Camera((t: Transform) => {
  viewport.setAttribute("transform", `translate(${t.x},${t.y}) scale(${t.k})`);
  // Dot grid follows the map; spacing doubles/halves so it never gets too dense or sparse.
  let s = GRID * t.k;
  while (s < 14) s *= 2;
  while (s > 30) s /= 2;
  stage.style.backgroundSize = `${s}px ${s}px`;
  stage.style.backgroundPosition = `${t.x}px ${t.y}px`;
  renderer.setZoom(t.k);
  if (!logoFrame) logoFrame = requestAnimationFrame(loadVisibleLogos);
});

/** Logos download only once their circle is on screen and big enough to see. */
function loadVisibleLogos() {
  logoFrame = 0;
  if (camera.t.k < LOD.logos) return;
  const margin = 250;
  const a = camera.toGraph(-margin, -margin);
  const b = camera.toGraph(svg.clientWidth + margin, svg.clientHeight + margin);
  renderer.loadLogos({ x0: a.x, y0: a.y, x1: b.x, y1: b.y }, isShown);
}

/** The part of the screen not covered by the detail panel. */
function visibleArea(): Area {
  const w = svg.clientWidth;
  const h = svg.clientHeight;
  if (w <= NARROW) {
    // Phones: the title card sits on top and the panel is a bottom sheet.
    const top = masthead.getBoundingClientRect().bottom;
    const bottom = panel.isOpen ? panelEl.offsetHeight : 0;
    return { x: 0, y: top, w, h: Math.max(160, h - top - bottom) };
  }
  if (!panel.isOpen) return { x: 0, y: 0, w, h };
  const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gutter")) || 20;
  return { x: 0, y: 0, w: w - panelEl.offsetWidth - 2 * gutter, h };
}

/** Flies (or jumps) so the given nodes fill the visible area. `pos` overrides live positions (e.g. where a transition will end). */
function fit(nodes: GraphNode[], opts: { pos?: Positions; maxK: number; pad?: number; margin?: number; animate?: boolean; clearMasthead?: boolean }) {
  if (!nodes.length) return;
  const at = (n: GraphNode) => opts.pos?.get(n) ?? n;
  const pad = opts.pad ?? 40;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    const p = at(n);
    const r = n.collideR;
    x0 = Math.min(x0, p.x - r);
    y0 = Math.min(y0, p.y - r);
    x1 = Math.max(x1, p.x + r);
    y1 = Math.max(y1, p.y + r);
  }
  x0 -= pad, y0 -= pad, x1 += pad, y1 += pad;

  const area = visibleArea();
  const margin = opts.margin ?? 24; // screen px kept clear around the fitted content
  const k = Math.max(MIN_ZOOM, Math.min(opts.maxK, MAX_ZOOM, (area.w - 2 * margin) / (x1 - x0), (area.h - 2 * margin) / (y1 - y0)));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;

  // On wide screens, slide right (if there's room) so the title card doesn't cover the map.
  if (opts.clearMasthead && area.w > NARROW) {
    const half = ((x1 - x0) * k) / 2;
    const centre = area.x + area.w / 2;
    const clear = Math.min(masthead.getBoundingClientRect().right + 8 + half, area.x + area.w - CONTROLS_WIDTH - half);
    if (clear > centre) area.x += clear - centre;
  }

  if (opts.animate === false) camera.set({ k, x: area.x + area.w / 2 - cx * k, y: area.y + area.h / 2 - cy * k });
  else camera.flyTo(cx, cy, k, area);
}

function fitOverview(animate = true) {
  // Wider margin: category names are drawn at a fixed screen size and stick out past their bubbles.
  fit(graph.placed.filter((n) => !isFiltered(n)), { pos: overviewPositions(graph), maxK: 1, margin: 70, clearMasthead: true, animate });
}

// ---------------------------------------------------------------------------
// Product orbits: tucked in → peeking (hover) → fanned out with labels (open)
// ---------------------------------------------------------------------------

const orbitTargets = new Map<GraphNode, number>();
let orbitFrame = 0;
let orbitLast = 0;

function setOrbit(brand: GraphNode, target: number) {
  if (!brand.products.length) return;
  orbitTargets.set(brand, target);
  if (!orbitFrame) {
    orbitLast = performance.now();
    orbitFrame = requestAnimationFrame(stepOrbits);
  }
}

function stepOrbits(now: number) {
  const f = 1 - Math.exp(-(now - orbitLast) / 90);
  orbitLast = now;
  for (const [b, target] of orbitTargets) {
    b.orbit += (target - b.orbit) * f;
    if (Math.abs(target - b.orbit) < 0.002) {
      b.orbit = target;
      orbitTargets.delete(b);
    }
  }
  renderer.paint();
  orbitFrame = orbitTargets.size ? requestAnimationFrame(stepOrbits) : 0;
}

function openBrand(b: GraphNode) {
  if (open === b) return;
  closeBrand();
  if (!b.products.length) return;
  open = b;
  b.collideR = b.openR;
  b.fx = b.x;
  b.fy = b.y;
  renderer.mark(b, "is-open", true);
  for (const p of b.products) renderer.mark(p, "is-open", true);
  svg.classList.add("has-open");
  setOrbit(b, 1);
  physics.nudge(0.7); // neighbours shuffle aside to make room
}

function closeBrand() {
  const b = open;
  if (!b) return;
  open = null;
  b.collideR = b.footprint;
  b.fx = b.fy = null;
  renderer.mark(b, "is-open", false);
  for (const p of b.products) renderer.mark(p, "is-open", false);
  svg.classList.remove("has-open");
  setOrbit(b, hovered === b ? PEEK : 0);
  physics.nudge(0.4);
}

// ---------------------------------------------------------------------------
// Focus mode
// ---------------------------------------------------------------------------

let modeToken = 0;
let transition: Promise<void> = Promise.resolve();

/**
 * Switches between the overview (null) and focusing one category. Resolves to
 * false if another navigation started in the meantime.
 */
function setFocus(c: GraphNode | null): Promise<boolean> {
  const token = ++modeToken;
  if (c !== focus) {
    if (open && (!c || !within(open, c))) closeBrand();
    focus = c;
    const targets = c ? focusPositions(graph, c) : overviewPositions(graph);
    // Physics anchors follow the new layout so drags in this mode feel the same.
    for (const n of graph.placed) {
      const t = targets.get(n)!;
      const pt = n.parent ? targets.get(n.parent)! : { x: 0, y: 0 };
      n.ax = t.x - pt.x;
      n.ay = t.y - pt.y;
    }
    physics.setNodes(graph.placed.filter((n) => !isAway(n)));

    svg.classList.toggle("focus-mode", !!c);
    document.body.classList.toggle("is-focused", !!c);
    renderer.classify("is-away", isAway);
    renderer.classify("is-satellite", (n) => !!c && (n.kind === "root" || (n.kind === "category" && n !== c)));
    renderer.setLinkClass((l) => isAway(l.target) || (!!c && l.target.kind === "category" && l.target !== c), "is-away");
    transition = physics.animateTo(targets).then(loadVisibleLogos);
  }
  renderCrumbs();
  return transition.then(() => token === modeToken);
}

// ---------------------------------------------------------------------------
// Navigation: All brands → category → (group →) brand → product
// ---------------------------------------------------------------------------

function select(n: GraphNode | null) {
  if (selected) renderer.mark(selected, "is-selected", false);
  selected = n;
  if (n) {
    renderer.mark(n, "is-selected", true);
    panel.show(n);
  } else panel.hide();
  renderCrumbs();
}

function goOverview(show: GraphNode | null = null) {
  closeBrand();
  select(show);
  void setFocus(null);
  fitOverview();
}

function goCategory(c: GraphNode, show: GraphNode = c) {
  closeBrand();
  select(show);
  const members = graph.placed.filter((n) => within(n, c));
  fit(members, { pos: focus === c ? undefined : focusPositions(graph, c), maxK: 1.15, clearMasthead: true });
  void setFocus(c);
}

function goGroup(g: GraphNode) {
  closeBrand();
  select(g);
  const pos = focus === g.category ? undefined : focusPositions(graph, g.category!);
  fit(graph.placed.filter((n) => within(n, g)), { pos, maxK: 1.3, pad: 60 });
  void setFocus(g.category);
}

async function goBrand(b: GraphNode, show: GraphNode = b) {
  if (open && open !== b) closeBrand();
  select(show);
  const at = focus === b.category ? b : focusPositions(graph, b.category!).get(b)!;
  const radius = b.products.length ? b.openR : b.footprint + 80;
  const area = visibleArea();
  const k = Math.max(0.8, Math.min(1.7, Math.min(area.w, area.h) / (2.2 * radius)));
  camera.flyTo(at.x, at.y, k, area);
  if (await setFocus(b.category)) openBrand(b);
}

function navigate(n: GraphNode) {
  userMoved = true;
  hideHintSoon();
  switch (n.kind) {
    case "root":
      return goOverview(n);
    case "category":
      return goCategory(n);
    case "group":
      return goGroup(n);
    case "brand":
      return void goBrand(n);
    case "product":
      return void goBrand(n.brand!, n);
  }
}

/** Esc / clicking empty space: one level up. */
function goUp() {
  const s = selected;
  if (s) {
    if (s.kind === "root" || s.kind === "category" || !s.parent || s.parent.kind === "root") return goOverview();
    return navigate(s.parent);
  }
  if (open) return closeBrand();
  if (focus) return goOverview();
}

function renderCrumbs() {
  const tip = selected && selected.kind !== "root" ? selected : (open ?? focus);
  const trail: GraphNode[] = [];
  for (let p = tip; p && p.kind !== "root"; p = p.parent) trail.unshift(p);
  crumbs.hidden = trail.length === 0;
  if (!trail.length) return crumbs.replaceChildren();

  const button = (text: string, onClick: () => void, current = false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    if (current) b.setAttribute("aria-current", "page");
    b.addEventListener("click", onClick);
    return b;
  };
  const sep = () => Object.assign(document.createElement("span"), { className: "sep", textContent: "›", ariaHidden: "true" });
  const back = button("All brands", () => goOverview());
  back.className = "crumb-home";
  crumbs.replaceChildren(back, ...trail.flatMap((n, i) => [sep(), button(n.name, () => navigate(n), i === trail.length - 1)]));
}

const panel = new Panel({
  onNavigate: navigate,
  onClose: () => select(null),
});

// ---------------------------------------------------------------------------
// Hover spotlight
// ---------------------------------------------------------------------------

let lit: GraphNode[] = [];
let litLinks: GraphLink[] = [];

let hot: GraphNode | null = null;

function light(n: GraphNode | null) {
  if (hot) renderer.mark(hot, "is-hot", false);
  hot = n;
  if (n) renderer.mark(n, "is-hot", true);
  for (const m of lit) renderer.mark(m, "is-lit", false);
  for (const l of litLinks) renderer.linkEl.get(l)!.classList.remove("is-lit");
  lit = [];
  litLinks = [];
  svg.classList.toggle("has-lit", n !== null);
  if (!n) return;

  const add = (m: GraphNode) => {
    renderer.mark(m, "is-lit", true);
    lit.push(m);
  };
  add(n);
  if (n.kind === "product") {
    if (n.brand) add(n.brand);
    return;
  }
  for (const l of linksOf.get(n) ?? []) {
    renderer.linkEl.get(l)!.classList.add("is-lit");
    litLinks.push(l);
    add(l.source === n ? l.target : l.source);
  }
  n.products.forEach(add);
}

for (const n of graph.nodes) {
  const el = renderer.elementOf(n)!;
  el.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    hovered = n;
    if (dragging || svg.classList.contains("is-panning")) return;
    light(n);
    if (n.kind === "brand" && n !== open) setOrbit(n, PEEK);
  });
  el.addEventListener("pointerleave", () => {
    if (hovered === n) hovered = null;
    if (dragging) return;
    light(null);
    if (n.kind === "brand" && n !== open) setOrbit(n, 0);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    navigate(n);
  });
}

// ---------------------------------------------------------------------------
// Pointer input: pan, zoom, drag, click
// ---------------------------------------------------------------------------

attachInput<GraphNode>(svg, camera, {
  nodeAt: (target) => renderer.nodeAt(target),
  onNodeClick: navigate,
  onNodeDragStart: (n, gx, gy) => {
    // Grabbing a product moves its brand.
    const target = n.kind === "product" ? n.brand! : n;
    dragging = target;
    light(target);
    physics.dragStart(target, gx, gy);
  },
  onNodeDrag: (_n, gx, gy) => {
    if (dragging) physics.drag(dragging, gx, gy);
  },
  onNodeDragEnd: () => {
    const t = dragging;
    dragging = null;
    if (!t) return;
    // Nestlé and an open brand stay pinned where they're dropped; everything else floats.
    const { ax, ay } = physics.dragEnd(t, t.kind === "root" || t === open);
    // In the overview the new spot sticks; focus mode is a temporary arrangement.
    if (!focus) {
      t.ox = ax;
      t.oy = ay;
    }
    userMoved = true;
    light(hovered);
  },
  onBackgroundClick: goUp,
  onNavigate: noteNavigation,
  ignoreWheel: (target) => target instanceof Element && target.closest(".panel, #search-results") !== null,
});

$("#zoom-in").addEventListener("click", () => camera.zoomBy(1.5, visibleArea()));
$("#zoom-out").addEventListener("click", () => camera.zoomBy(1 / 1.5, visibleArea()));
$("#zoom-fit").addEventListener("click", () => goOverview());

const searchInput = $<HTMLInputElement>("#search-input");
attachSearch(searchInput, $<HTMLUListElement>("#search-results"), graph.nodes, {
  isVisible: (n) => !isFiltered(n),
  onPick: navigate,
});

const PAN_STEP = 90;
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
  const area = visibleArea();
  switch (e.key) {
    case "/":
      searchInput.focus();
      break;
    case "Escape":
      goUp();
      break;
    case "+":
    case "=":
      camera.zoomBy(1.5, area);
      break;
    case "-":
    case "_":
      camera.zoomBy(1 / 1.5, area);
      break;
    case "0":
      goOverview();
      break;
    case "ArrowLeft":
      camera.panBy(PAN_STEP, 0);
      break;
    case "ArrowRight":
      camera.panBy(-PAN_STEP, 0);
      break;
    case "ArrowUp":
      camera.panBy(0, PAN_STEP);
      break;
    case "ArrowDown":
      camera.panBy(0, -PAN_STEP);
      break;
    default:
      return;
  }
  e.preventDefault();
  noteNavigation();
});

// ---------------------------------------------------------------------------
// Legend filter
// ---------------------------------------------------------------------------

function applyFilter() {
  renderer.classify("is-filtered", isFiltered);
  renderer.setLinkClass((l) => isFiltered(l.target), "is-filtered");
  if (selected && isFiltered(selected)) goUp();
  loadVisibleLogos();
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".legend-item")) {
  const status = button.dataset.status as Status;
  const count = graph.nodes.filter((n) => (n.kind === "brand" || n.kind === "product") && n.status === status).length;
  button.querySelector(".count")!.textContent = String(count);
  if (!count) button.hidden = true;
  button.addEventListener("click", () => {
    const show = hiddenStatuses.has(status);
    if (show) hiddenStatuses.delete(status);
    else hiddenStatuses.add(status);
    button.setAttribute("aria-pressed", String(show));
    applyFilter();
  });
}

const legend = $(".legend");
const legendToggle = $("#legend-toggle");
function setLegendOpen(open: boolean) {
  legend.classList.toggle("is-collapsed", !open);
  legendToggle.setAttribute("aria-expanded", String(open));
}
legendToggle.addEventListener("click", () => setLegendOpen(legend.classList.contains("is-collapsed")));
setLegendOpen(window.innerWidth > NARROW);

// ---------------------------------------------------------------------------
// Controls hint
// ---------------------------------------------------------------------------

let hintTimer = 0;

function setHint(show: boolean) {
  clearTimeout(hintTimer);
  hintTimer = 0;
  hint.classList.toggle("is-hidden", !show);
  helpButton.setAttribute("aria-expanded", String(show));
}

function hideHintSoon() {
  if (hintTimer || hint.classList.contains("is-hidden")) return;
  hintTimer = window.setTimeout(() => setHint(false), 1500);
}

helpButton.addEventListener("click", () => setHint(hint.classList.contains("is-hidden")));

/** The user moved the map themselves: stop auto-fitting and tuck the hint away. */
function noteNavigation() {
  userMoved = true;
  hideHintSoon();
}

// ---------------------------------------------------------------------------

fitOverview(false);

// On resize: re-fit until the user has moved the map, then just keep the centre in the centre.
let size = { w: svg.clientWidth, h: svg.clientHeight };
window.addEventListener("resize", () => {
  const next = { w: svg.clientWidth, h: svg.clientHeight };
  if (userMoved) camera.panBy((next.w - size.w) / 2, (next.h - size.h) / 2);
  else fitOverview(false);
  size = next;
});
