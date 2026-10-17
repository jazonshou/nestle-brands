import "./styles.css";
import { Camera, MAX_ZOOM, MIN_ZOOM, type Area, type Transform } from "./camera";
import { DATA } from "./data";
import { buildGraph, layout, type GraphLink, type GraphNode } from "./graph";
import { attachInput } from "./input";
import { Panel } from "./panel";
import { attachSearch } from "./search";
import type { Status } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";
const GRID = 24; // background dot spacing at zoom 1
const FAR_ZOOM = 0.6; // below this, brand labels hide until hovered
const NARROW = 760; // matches the CSS breakpoint where the panel becomes a bottom sheet
const CONTROLS_WIDTH = 80; // zoom buttons column plus its margin

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector(selector) as T;

const stage = $("#stage");
const svg = $<SVGSVGElement>("#graph");
const viewport = $<SVGGElement>("#viewport");
const linkLayer = $<SVGGElement>("#links");
const nodeLayer = $<SVGGElement>("#nodes");
const panelEl = $("#panel");
const masthead = $(".masthead");
const hint = $("#hint");
const helpButton = $("#help-toggle");

const graph = buildGraph(DATA);
const sim = layout(graph);

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const nodeEls = new Map<GraphNode, SVGGElement>();
const linkEls = new Map<GraphLink, SVGLineElement>();
const nodeOfEl = new WeakMap<Element, GraphNode>();

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent.append(el);
  return el;
}

/** Pie slice of fraction `f`, starting at 12 o'clock, for partial stakes. */
function pieSlice(r: number, f: number): string {
  if (f >= 0.999) return `M0,${-r}A${r},${r} 0 1 1 0,${r}A${r},${r} 0 1 1 0,${-r}Z`;
  const a = f * Math.PI * 2 - Math.PI / 2;
  return `M0,0L0,${-r}A${r},${r} 0 ${f > 0.5 ? 1 : 0} 1 ${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}Z`;
}

for (const l of graph.links) {
  const classes = ["link", l.kind === "related" ? "related" : `tier-${l.target.depth}`];
  if (l.kind === "tree" && l.target.status !== "owned") classes.push(`to-${l.target.status}`);
  const line = svgEl("line", { class: classes.join(" ") }, linkLayer);
  line.style.setProperty("--c", l.target.color);
  linkEls.set(l, line);
}

// Deepest first, so Nestlé and the categories sit on top.
for (const n of [...graph.nodes].sort((a, b) => b.depth - a.depth)) {
  const g = svgEl("g", { class: `node kind-${n.kind} status-${n.status}`, tabindex: 0, role: "button", "aria-label": `${n.name}: ${n.description}` }, nodeLayer);
  g.style.setProperty("--c", n.color);
  g.style.setProperty("--delay", `${Math.round(n.depth * 110 + Math.random() * 140)}ms`);

  const inner = svgEl("g", { class: "node-inner" }, g);
  svgEl("circle", { class: "halo", r: n.r + 6 }, inner);
  svgEl("circle", { class: "body", r: n.r }, inner);
  if (n.status === "partial" && n.stake) svgEl("path", { class: "stake", d: pieSlice(n.r - 4, n.stake) }, inner);

  const label = n.kind === "root" ? svgEl("text", { class: "label" }, inner) : svgEl("text", { class: "label", y: n.r + (n.kind === "category" ? 20 : 16) }, g);
  label.textContent = n.name;

  nodeEls.set(n, g);
  nodeOfEl.set(g, n);
}

function paint() {
  for (const [n, g] of nodeEls) g.setAttribute("transform", `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
  for (const [l, line] of linkEls) {
    line.setAttribute("x1", l.source.x.toFixed(1));
    line.setAttribute("y1", l.source.y.toFixed(1));
    line.setAttribute("x2", l.target.x.toFixed(1));
    line.setAttribute("y2", l.target.y.toFixed(1));
  }
}
sim.on("tick", paint);
paint();

// Where every circle rests. After a drag, everything springs back here.
const home = new Map(graph.nodes.map((n) => [n, { x: n.x, y: n.y }]));
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let settling = 0;

function springHome() {
  sim.stop();
  const from = new Map(graph.nodes.map((n) => [n, { x: n.x, y: n.y }]));
  const duration = reducedMotion.matches ? 0 : 650;
  const start = performance.now();
  const easeOutBack = (u: number) => 1 + 2.2 * (u - 1) ** 3 + 1.2 * (u - 1) ** 2; // slight overshoot
  const step = (now: number) => {
    const u = duration ? Math.min(1, (now - start) / duration) : 1;
    const e = easeOutBack(u);
    for (const n of graph.nodes) {
      const a = from.get(n)!;
      const b = home.get(n)!;
      n.x = a.x + (b.x - a.x) * e;
      n.y = a.y + (b.y - a.y) * e;
      n.vx = n.vy = 0;
    }
    paint();
    settling = u < 1 ? requestAnimationFrame(step) : 0;
  };
  settling = requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

const camera = new Camera((t: Transform) => {
  viewport.setAttribute("transform", `translate(${t.x},${t.y}) scale(${t.k})`);
  // Dot grid follows the map; spacing doubles/halves so it never gets too dense or sparse.
  let s = GRID * t.k;
  while (s < 14) s *= 2;
  while (s > 30) s /= 2;
  stage.style.backgroundSize = `${s}px ${s}px`;
  stage.style.backgroundPosition = `${t.x}px ${t.y}px`;
  svg.classList.toggle("zoom-far", t.k < FAR_ZOOM);
});

/** The part of the screen not covered by the detail panel. */
function visibleArea(): Area {
  const w = svg.clientWidth;
  const h = svg.clientHeight;
  if (!panel.isOpen) return { x: 0, y: 0, w, h };
  if (w <= NARROW) return { x: 0, y: 0, w, h: h - panelEl.offsetHeight };
  const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gutter")) || 20;
  return { x: 0, y: 0, w: w - panelEl.offsetWidth - 2 * gutter, h };
}

function fitAll(animate = true) {
  const shown = graph.nodes.filter(isVisible);
  const pad = 60;
  const x0 = Math.min(...shown.map((n) => n.x - n.r)) - pad;
  const x1 = Math.max(...shown.map((n) => n.x + n.r)) + pad;
  const y0 = Math.min(...shown.map((n) => n.y - n.r)) - pad;
  const y1 = Math.max(...shown.map((n) => n.y + n.r)) + pad;
  const area = visibleArea();
  const k = Math.max(MIN_ZOOM, Math.min(1.1, MAX_ZOOM, area.w / (x1 - x0), area.h / (y1 - y0)));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;

  // On wide screens, slide the map right (if there's room) so the title card doesn't cover it.
  if (area.w > NARROW) {
    const half = ((x1 - x0) * k) / 2;
    const centre = area.x + area.w / 2;
    const clear = Math.min(masthead.getBoundingClientRect().right + 8 + half, area.x + area.w - CONTROLS_WIDTH - half);
    if (clear > centre) area.x += clear - centre;
  }

  if (animate) camera.flyTo(cx, cy, k, area);
  else camera.set({ k, x: area.x + area.w / 2 - cx * k, y: area.y + area.h / 2 - cy * k });
}

// ---------------------------------------------------------------------------
// Focus (hover), selection and filters
// ---------------------------------------------------------------------------

let userMoved = false;
let hovered: GraphNode | null = null;
let dragging: GraphNode | null = null;
let selected: GraphNode | null = null;
let lit: Element[] = [];

/** Spotlights a node, its links and its neighbours; everything else dims. */
function setFocus(n: GraphNode | null) {
  for (const el of lit) el.classList.remove("is-lit");
  lit = [];
  svg.classList.toggle("has-focus", n !== null);
  if (!n) return;
  const light = (el: Element) => {
    el.classList.add("is-lit");
    lit.push(el);
  };
  light(nodeEls.get(n)!);
  for (const l of graph.linksOf.get(n)!) {
    light(linkEls.get(l)!);
    light(nodeEls.get(l.source === n ? l.target : l.source)!);
  }
}

const panel = new Panel(graph, {
  onNavigate: (n) => select(n, true),
  onClose: deselect,
});

function select(n: GraphNode, fly = false) {
  if (selected) nodeEls.get(selected)!.classList.remove("is-selected");
  selected = n;
  userMoved = true;
  nodeEls.get(n)!.classList.add("is-selected");
  panel.show(n);

  const area = visibleArea();
  if (fly) return camera.flyTo(n.x, n.y, Math.max(camera.t.k, 1), area);
  // Only move the map if the panel would cover the circle.
  const p = camera.toScreen(n.x, n.y);
  const m = 70;
  if (p.x < area.x + m || p.x > area.x + area.w - m || p.y < area.y + m || p.y > area.y + area.h - m) {
    camera.flyTo(n.x, n.y, camera.t.k, area);
  }
}

function deselect() {
  if (selected) nodeEls.get(selected)!.classList.remove("is-selected");
  selected = null;
  panel.hide();
}

const hiddenStatuses = new Set<Status>();
const isVisible = (n: GraphNode) => n.kind !== "brand" || !hiddenStatuses.has(n.status);

function applyFilter() {
  for (const [n, g] of nodeEls) {
    const hide = !isVisible(n);
    g.classList.toggle("is-filtered", hide);
    g.setAttribute("tabindex", hide ? "-1" : "0");
  }
  for (const [l, line] of linkEls) line.classList.toggle("is-filtered", !isVisible(l.source) || !isVisible(l.target));
  if (selected && !isVisible(selected)) deselect();
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".legend-item")) {
  const status = button.dataset.status as Status;
  const count = graph.nodes.filter((n) => n.kind === "brand" && n.status === status).length;
  button.querySelector(".count")!.textContent = String(count);
  button.addEventListener("click", () => {
    const show = hiddenStatuses.has(status);
    if (show) hiddenStatuses.delete(status);
    else hiddenStatuses.add(status);
    button.setAttribute("aria-pressed", String(show));
    applyFilter();
  });
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

for (const [n, g] of nodeEls) {
  g.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    hovered = n;
    if (!dragging && !svg.classList.contains("is-panning")) setFocus(n);
  });
  g.addEventListener("pointerleave", () => {
    if (hovered === n) hovered = null;
    if (!dragging) setFocus(null);
  });
  g.addEventListener("focus", () => setFocus(n));
  g.addEventListener("blur", () => !hovered && !dragging && setFocus(null));
  g.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    select(n, true);
  });
}

attachInput<GraphNode>(svg, camera, {
  nodeAt: (target) => {
    const g = target instanceof Element ? target.closest(".node") : null;
    return g ? (nodeOfEl.get(g) ?? null) : null;
  },
  onNodeClick: (n) => select(n),
  onNodeDragStart: (n) => {
    cancelAnimationFrame(settling);
    dragging = n;
    setFocus(n);
    n.fx = n.x;
    n.fy = n.y;
    sim.alphaTarget(0.25).restart();
  },
  onNodeDrag: (n, x, y) => {
    n.fx = x;
    n.fy = y;
  },
  onNodeDragEnd: (n) => {
    dragging = null;
    sim.alphaTarget(0);
    // Nestlé stays pinned at the centre; everything else is free again.
    n.fx = n.kind === "root" ? home.get(n)!.x : null;
    n.fy = n.kind === "root" ? home.get(n)!.y : null;
    springHome();
    setFocus(hovered);
  },
  onBackgroundClick: deselect,
  onNavigate: noteNavigation,
  ignoreWheel: (target) => target instanceof Element && target.closest(".panel, #search-results") !== null,
});

$("#zoom-in").addEventListener("click", () => camera.zoomBy(1.5, visibleArea()));
$("#zoom-out").addEventListener("click", () => camera.zoomBy(1 / 1.5, visibleArea()));
$("#zoom-fit").addEventListener("click", () => fitAll());

const searchInput = $<HTMLInputElement>("#search-input");
attachSearch(searchInput, $<HTMLUListElement>("#search-results"), graph.nodes, {
  isVisible,
  onPick: (n) => select(n, true),
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
      deselect();
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
      fitAll();
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

fitAll(false);

// On resize: re-fit until the user has moved the map, then just keep the centre in the centre.
let size = { w: svg.clientWidth, h: svg.clientHeight };
window.addEventListener("resize", () => {
  const next = { w: svg.clientWidth, h: svg.clientHeight };
  if (userMoved) camera.panBy((next.w - size.w) / 2, (next.h - size.h) / 2);
  else fitAll(false);
  size = next;
});
