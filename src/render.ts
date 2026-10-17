import { dotRadius, orbitRadius, type Graph, type GraphLink, type GraphNode } from "./graph";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Zoom thresholds for level of detail. */
export const LOD = {
  /** Below this: brands are plain coloured dots (no logos, no product dots). */
  logos: 0.38,
  /** At or above this: brand names are shown. */
  labels: 0.7,
};

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent.append(node);
  return node;
}

/** Arc from 12 o'clock, clockwise, covering fraction `f` of the circle. */
function arc(r: number, f: number): string {
  const a = f * Math.PI * 2 - Math.PI / 2;
  return `M0,${-r}A${r},${r} 0 ${f > 0.5 ? 1 : 0} 1 ${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
}

function initials(name: string): string {
  const words = name.replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const first = (w: string) => [...w][0]?.toUpperCase() ?? "";
  return words.length > 1 ? first(words[0]) + first(words[1]) : first(words[0] ?? "?");
}

export interface Layers {
  links: SVGGElement;
  nodes: SVGGElement;
  products: SVGGElement;
  hubs: SVGGElement;
}

/** Owns every SVG element on the map. Knows how to draw, not what the app is doing. */
export class Renderer {
  readonly nodeEl = new Map<GraphNode, SVGGElement>();
  readonly linkEl = new Map<GraphLink, SVGLineElement>();
  readonly productEl = new Map<GraphNode, SVGGElement>();
  private readonly owner = new WeakMap<Element, GraphNode>();
  private readonly pendingLogos = new Map<GraphNode, SVGImageElement>();
  private readonly dotSize = new Map<GraphNode, number>();
  private readonly svg: SVGSVGElement;
  private readonly graph: Graph;

  constructor(svg: SVGSVGElement, graph: Graph, layers: Layers) {
    this.svg = svg;
    this.graph = graph;

    for (const l of graph.links) {
      const line = el("line", { class: `link to-${l.target.kind} status-${l.target.status}` }, layers.links);
      line.style.setProperty("--c", l.target.color);
      this.linkEl.set(l, line);
    }

    // Deepest first so bigger things sit on top; categories and Nestlé go in the top layer.
    for (const n of [...graph.placed].sort((a, b) => depth(b) - depth(a))) {
      const layer = n.kind === "category" || n.kind === "root" ? layers.hubs : layers.nodes;
      this.drawNode(n, layer);
    }
    for (const p of graph.products) this.drawProduct(p, layers.products);
  }

  /** The node an event target belongs to, if any. */
  nodeAt(target: EventTarget | null): GraphNode | null {
    const g = target instanceof Element ? target.closest(".node, .product") : null;
    return g ? (this.owner.get(g) ?? null) : null;
  }

  elementOf(n: GraphNode): SVGGElement | undefined {
    return n.kind === "product" ? this.productEl.get(n) : this.nodeEl.get(n);
  }

  private drawNode(n: GraphNode, layer: SVGGElement) {
    const g = el(
      "g",
      {
        class: `node kind-${n.kind} status-${n.status}${n.logo ? " has-logo" : ""}${n.logoDark ? " logo-dark" : ""}`,
        tabindex: 0,
        role: "button",
        "aria-label": [n.name, n.description].filter(Boolean).join(": "),
      },
      layer,
    );
    g.style.setProperty("--c", n.color);
    const inner = el("g", { class: "node-inner" }, g);
    el("circle", { class: "halo", r: n.r + 6 }, inner);
    el("circle", { class: "body", r: n.r }, inner);

    if (n.kind === "brand" || n.kind === "group") {
      el("circle", { class: "ring", r: n.r }, inner);
      if (n.status === "partial") el("path", { class: "stake", d: arc(n.r, n.stake ?? 0.5) }, inner);
    }
    if (n.kind === "category" && n.status !== "owned") el("circle", { class: "ring", r: n.r + 6 }, inner);

    if (n.kind === "brand" || (n.kind === "root" && n.logo)) {
      if (n.logo) {
        // The largest box of the logo's shape that fits inside the circle (with a little padding).
        const a = n.logoAspect;
        const reach = n.r * 0.8;
        const w = (2 * reach * a) / Math.hypot(a, 1);
        const h = (2 * reach) / Math.hypot(a, 1);
        const img = el("image", { class: "logo", x: -w / 2, y: -h / 2, width: w, height: h, preserveAspectRatio: "xMidYMid meet" }, inner);
        img.addEventListener("error", () => {
          img.remove();
          this.drawInitials(n, inner);
        });
        // Nestlé's logo is visible at every zoom; brand logos wait until they're on screen and big enough.
        if (n.kind === "root") img.setAttribute("href", n.logo);
        else this.pendingLogos.set(n, img);
      } else {
        this.drawInitials(n, inner);
      }
    }
    if (n.kind === "category") {
      const count = el("text", { class: "count" }, inner);
      count.textContent = String(countBrands(n));
    }

    const label = el("text", { class: "label", y: n.r + (n.kind === "brand" || n.kind === "group" ? 14 : 12) }, g);
    label.textContent = n.label;
    el("title", {}, g).textContent = n.fullName;

    this.nodeEl.set(n, g);
    this.owner.set(g, n);
  }

  private drawInitials(n: GraphNode, parent: Element) {
    const t = el("text", { class: "initials", "font-size": (n.r * 0.78).toFixed(1) }, parent);
    t.textContent = initials(n.name);
  }

  private drawProduct(p: GraphNode, layer: SVGGElement) {
    const g = el("g", { class: `product status-${p.status}`, role: "button", "aria-label": p.fullName }, layer);
    g.style.setProperty("--c", p.color);
    el("circle", { class: "dot", r: 2.2 }, g);

    // Names point away from the brand: right column reads left-to-right, left column right-to-left.
    const right = Math.cos(p.angle) >= 0;
    const label = el("text", { class: "plabel", x: right ? 9 : -9, y: 3.2, "text-anchor": right ? "start" : "end" }, g);
    label.textContent = p.label;
    el("title", {}, g).textContent = p.fullName;

    this.productEl.set(p, g);
    this.owner.set(g, p);
  }

  /** Writes every position to the DOM. Called on each physics tick or animation frame. */
  paint(): void {
    for (const [n, g] of this.nodeEl) g.setAttribute("transform", `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    for (const [l, line] of this.linkEl) {
      line.setAttribute("x1", l.source.x.toFixed(1));
      line.setAttribute("y1", l.source.y.toFixed(1));
      line.setAttribute("x2", l.target.x.toFixed(1));
      line.setAttribute("y2", l.target.y.toFixed(1));
    }
    for (const [p, g] of this.productEl) {
      const b = p.brand;
      if (!b) continue;
      const R = orbitRadius(b, b.orbit);
      g.setAttribute("transform", `translate(${(b.x + Math.cos(p.angle) * R).toFixed(1)},${(b.y + Math.sin(p.angle) * R).toFixed(1)})`);
      const size = Math.round(dotRadius(b.orbit) * 10) / 10;
      if (this.dotSize.get(p) !== size) {
        this.dotSize.set(p, size);
        g.firstElementChild!.setAttribute("r", String(size));
      }
    }
  }

  /** Zoom-dependent detail: CSS reads --k and the lod-* classes. */
  setZoom(k: number): void {
    this.svg.style.setProperty("--k", k.toFixed(3));
    this.svg.classList.toggle("lod-far", k < LOD.logos);
    this.svg.classList.toggle("lod-near", k >= LOD.labels);
  }

  /** Starts downloading logos for brands inside the given graph-space box (they're lazy). */
  loadLogos(box: { x0: number; y0: number; x1: number; y1: number }, isVisible: (n: GraphNode) => boolean): void {
    for (const [n, img] of this.pendingLogos) {
      if (n.x < box.x0 || n.x > box.x1 || n.y < box.y0 || n.y > box.y1 || !isVisible(n)) continue;
      img.setAttribute("href", n.logo!);
      this.pendingLogos.delete(n);
    }
  }

  /** Toggles a class on a node's or product's element. */
  mark(n: GraphNode, cls: string, on: boolean): void {
    this.elementOf(n)?.classList.toggle(cls, on);
  }

  setLinkClass(test: (l: GraphLink) => boolean, cls: string): void {
    for (const [l, line] of this.linkEl) line.classList.toggle(cls, test(l));
  }

  /** Applies a class to every node, product and link based on a predicate over nodes. */
  classify(cls: string, test: (n: GraphNode) => boolean): void {
    for (const n of this.graph.nodes) this.mark(n, cls, test(n));
  }
}

function depth(n: GraphNode): number {
  let d = 0;
  for (let p = n.parent; p; p = p.parent) d++;
  return d;
}

export function countBrands(n: GraphNode): number {
  return n.children.reduce((sum, c) => sum + (c.kind === "brand" ? 1 : 0) + (c.kind === "group" ? countBrands(c) : 0), 0);
}
