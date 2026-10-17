import type { SimulationNodeDatum } from "d3-force";
import { packSiblings } from "d3-hierarchy";
import type { Entry } from "./types";

export interface GraphNode extends SimulationNodeDatum, Entry {
  parent: GraphNode | null;
  children: GraphNode[];
  /** Nearest category above (itself for categories). */
  category: GraphNode | null;
  /** Products: the brand they orbit. Brands: themselves. */
  brand: GraphNode | null;
  /** Brands: every product below them, flattened, in sheet order. */
  products: GraphNode[];
  color: string;
  /** Circle radius in graph units. */
  r: number;
  /** Short text drawn on the map. */
  label: string;
  /** Space the node (with its label) needs; used for packing and collisions. */
  footprint: number;
  /** Radius of the whole cluster around this node (categories and groups). */
  clusterR: number;
  /** Current collision radius (grows while a brand's products are open). */
  collideR: number;
  x: number;
  y: number;
  /** Where physics pulls this node, as an offset from its parent (absolute for the root). */
  ax: number;
  ay: number;
  /** The overview layout's offset from the parent. Focus mode changes ax/ay but not this. */
  ox: number;
  oy: number;
  /** Products: angle around their brand. */
  angle: number;
  /** Brands: 0 = products tucked in, PEEK = hovered, 1 = open. Animated. */
  orbit: number;
  /** Brands: radius of the open product ring, and the collision radius while open. */
  ringR: number;
  openR: number;
}

export interface GraphLink {
  source: GraphNode;
  target: GraphNode;
}

export interface Graph {
  root: GraphNode;
  nodes: GraphNode[];
  /** Root, categories, groups and brands: the nodes with their own position. */
  placed: GraphNode[];
  products: GraphNode[];
  categories: GraphNode[];
  links: GraphLink[];
  byId: Map<string, GraphNode>;
}

export const ROOT_COLOR = "#5a3a28";
const PALETTE = [
  "#7a4e30", "#3f8a96", "#b4443c", "#e0849e", "#5b84b1", "#d4892a", "#b7a22e",
  "#d2622f", "#7f9b4f", "#3f8f6b", "#6d6a96", "#9b72b5", "#8a4f74",
];
const FORMER_COLOR = "#8f857c";

export const SIZE = { root: 70, category: 36, group: 11 };
/** Brand circles grow a little with their number of products. */
const brandRadius = (products: number) => Math.min(32, 20 + 2.6 * Math.sqrt(products));

/** Approximate label widths (DM Sans) in graph units, for spacing. */
const BRAND_CHAR = 5.9;
const PRODUCT_CHAR = 5.3;

/** Product orbit geometry. Open products sit in two columns on arcs left and right of the brand. */
export const PEEK = 0.35;
const PRODUCT_ROW = 15;
const MAX_FAN = (55 * Math.PI) / 180;
const COLLAPSED_GAP = 5;
const PEEK_GAP = 15;

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Drops the part of a product name that repeats its brand: "Nescafé Gold" → "Gold", "Pro Plan Dog" (Purina Pro Plan) → "Dog". */
function productLabel(product: string, brand: string): string {
  const words = brand.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const prefix = `${words.slice(i).join(" ")} `;
    if (prefix.length > 3 && product.toLowerCase().startsWith(prefix.toLowerCase())) {
      const rest = product.slice(prefix.length);
      if (rest.length >= 3) return truncate(rest, 26);
    }
  }
  return truncate(product, 26);
}

export function buildGraph(entries: Entry[]): Graph {
  const nodes: GraphNode[] = [];
  const byId = new Map<string, GraphNode>();
  for (const e of entries) {
    if (byId.has(e.id)) {
      console.warn(`[data] Duplicate id ${e.id} "${e.fullName}" — skipped.`);
      continue;
    }
    const n: GraphNode = {
      ...e,
      parent: null, children: [], category: null, brand: null, products: [],
      color: ROOT_COLOR, r: 0, label: e.name, footprint: 0, clusterR: 0, collideR: 0,
      x: 0, y: 0, ax: 0, ay: 0, ox: 0, oy: 0, angle: 0, orbit: 0, ringR: 0, openR: 0,
    };
    nodes.push(n);
    byId.set(n.id, n);
  }

  const root = nodes.find((n) => n.kind === "root");
  if (!root) throw new Error("The CSV needs one row without a parent_id (Nestlé itself).");

  for (const n of nodes) {
    if (n === root) continue;
    const parent = (n.parentId && byId.get(n.parentId)) || root;
    n.parent = parent;
    parent.children.push(n);
  }

  const categories = root.children.filter((n) => n.kind === "category");
  let paletteIndex = 0;
  for (const c of categories) {
    c.color = /divest/i.test(c.fullName) ? FORMER_COLOR : PALETTE[paletteIndex++ % PALETTE.length];
  }

  for (const n of nodes) {
    for (let p: GraphNode | null = n; p; p = p.parent) {
      if (!n.category && p.kind === "category") n.category = p;
      if (!n.brand && p.kind === "brand") n.brand = p;
    }
    if (n !== root) n.color = n.category?.color ?? ROOT_COLOR;
    if (n.kind === "product") n.brand?.products.push(n);
  }

  for (const n of nodes) {
    switch (n.kind) {
      case "root":
        n.r = SIZE.root;
        n.label = n.name.replace(/\s+S\.A\.$/, "");
        n.footprint = n.r + 40;
        break;
      case "category":
        n.r = SIZE.category;
        n.footprint = n.r + 40;
        break;
      case "group":
        n.r = SIZE.group;
        n.label = truncate(n.name, 26);
        n.footprint = Math.max(n.r + 16, (n.label.length * BRAND_CHAR) / 2 + 6);
        break;
      case "brand": {
        n.r = brandRadius(n.products.length);
        n.label = truncate(n.name, 22);
        n.footprint = Math.max(n.r + 16, (n.label.length * BRAND_CHAR) / 2 + 6);
        const count = n.products.length;
        const right = Math.ceil(count / 2);
        const left = count - right;
        const halfColumn = ((Math.max(right, left) - 1) / 2) * PRODUCT_ROW;
        n.ringR = Math.max(n.r + 34, halfColumn / Math.sin(MAX_FAN));
        n.products.forEach((p, i) => {
          const onRight = i < right;
          const rows = onRight ? right : left;
          const y = ((onRight ? i : i - right) - (rows - 1) / 2) * PRODUCT_ROW;
          const x = Math.sqrt(n.ringR ** 2 - y ** 2);
          p.angle = Math.atan2(y, onRight ? x : -x);
          p.label = productLabel(p.name, n.name);
          p.r = 5;
        });
        const longest = Math.max(0, ...n.products.map((p) => p.label.length));
        n.openR = n.ringR + 16 + longest * PRODUCT_CHAR;
        break;
      }
      case "product":
        break;
    }
    n.collideR = n.footprint;
  }

  const placed = nodes.filter((n) => n.kind !== "product");
  const links = placed.filter((n) => n.parent).map((n) => ({ source: n.parent!, target: n }));
  const graph: Graph = {
    root, nodes, placed, categories, links, byId,
    products: nodes.filter((n) => n.kind === "product"),
  };
  layoutOverview(graph);
  return graph;
}

// ---------------------------------------------------------------------------
// Overview layout: nested circle packing. Each category is a tight bubble of its
// brands (big brands nearest the middle), groups are mini-bubbles inside, and the
// category bubbles are packed around Nestlé.
// ---------------------------------------------------------------------------

const GAP = { brands: 4, groups: 10, categories: 60 };

/** Packs discs around a centre disc. Returns offsets from the centre and the radius that encloses everything. */
function packAround(centerR: number, radii: number[], gap: number) {
  const discs = [centerR, ...radii].map((r) => ({ r: r + gap / 2, x: 0, y: 0 }));
  packSiblings(discs);
  const [c, ...rest] = discs;
  const offsets = rest.map((d) => ({ x: d.x - c.x, y: d.y - c.y }));
  const radius = Math.max(centerR, ...offsets.map((o, i) => Math.hypot(o.x, o.y) + radii[i]));
  return { offsets, radius };
}

function layoutCluster(n: GraphNode): number {
  const members = n.children.filter((c) => c.kind !== "product");
  if (!members.length) return (n.clusterR = n.footprint);

  const disc = new Map(members.map((m) => [m, m.children.some((c) => c.kind !== "product") ? layoutCluster(m) : m.footprint]));
  const ordered = [...members].sort((a, b) => disc.get(b)! - disc.get(a)!);
  const gap = n.kind === "root" ? GAP.categories : ordered.some((m) => m.kind === "group") ? GAP.groups : GAP.brands;
  const { offsets, radius } = packAround(n.footprint, ordered.map((m) => disc.get(m)!), gap);
  ordered.forEach((m, i) => {
    m.ox = offsets[i].x;
    m.oy = offsets[i].y;
  });
  return (n.clusterR = radius);
}

function layoutOverview(g: Graph) {
  layoutCluster(g.root);
  for (const n of g.placed) {
    n.ax = n.ox;
    n.ay = n.oy;
  }
  const pos = overviewPositions(g);
  for (const n of g.placed) Object.assign(n, pos.get(n));
}

export type Positions = Map<GraphNode, { x: number; y: number }>;

/** Absolute positions implied by the overview offsets. */
export function overviewPositions(g: Graph): Positions {
  const out: Positions = new Map();
  const walk = (n: GraphNode, px: number, py: number) => {
    const p = { x: px + n.ox, y: py + n.oy };
    out.set(n, p);
    for (const c of n.children) if (c.kind !== "product") walk(c, p.x, p.y);
  };
  walk(g.root, 0, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Focus mode: one category's brands are laid out in concentric rings around it
// (biggest brands innermost, each group's brands kept together), every other
// category (and Nestlé) moves to a ring of "satellites" around it, and their
// brands tuck into them.
// ---------------------------------------------------------------------------

/** Most products first, then alphabetical. */
const bySize = (a: GraphNode, b: GraphNode) => b.products.length - a.products.length || a.name.localeCompare(b.name);

/** Arc length a node needs on a ring so badges and names don't collide. */
const arcNeeded = (n: GraphNode) => Math.max(2 * n.r + 18, Math.min(n.label.length * BRAND_CHAR, 130) * 0.85);

function ringLayout(focus: GraphNode, centre: { x: number; y: number }, out: Positions): number {
  const members = focus.children.filter((c) => c.kind !== "product");
  const standalone = members.filter((m) => m.kind !== "group").sort(bySize);
  const groups = members.filter((m) => m.kind === "group").sort((a, b) => b.children.length - a.children.length);
  const sequence = [...standalone, ...groups.flatMap((g) => [g, ...g.children.filter((c) => c.kind !== "product").sort(bySize)])];
  if (!sequence.length) return focus.r;

  const maxR = Math.max(...sequence.map((n) => n.r));
  const first = focus.r + maxR + 70;
  const step = Math.max(2 * maxR + 40, 100);
  const total = sequence.reduce((sum, n) => sum + arcNeeded(n), 0);

  // How many rings are needed, then share the items out in proportion to each ring's length.
  let rings = 1;
  const capacity = (count: number) => Array.from({ length: count }, (_, i) => 2 * Math.PI * (first + i * step));
  while (capacity(rings).reduce((a, b) => a + b, 0) < total) rings++;
  const lengths = capacity(rings);
  const fill = total / lengths.reduce((a, b) => a + b, 0);

  let index = 0;
  lengths.forEach((length, ring) => {
    const radius = first + ring * step;
    const items: GraphNode[] = [];
    let used = 0;
    while (index < sequence.length && (ring === rings - 1 || used + arcNeeded(sequence[index]) / 2 <= length * fill)) {
      used += arcNeeded(sequence[index]);
      items.push(sequence[index++]);
    }
    // Spread this ring's items evenly around the full circle, weighted by how much room each needs.
    const sum = items.reduce((a, n) => a + arcNeeded(n), 0);
    let along = 0;
    const offset = -Math.PI / 2 + (ring % 2) * (Math.PI / Math.max(items.length, 1));
    for (const n of items) {
      const a = offset + ((along + arcNeeded(n) / 2) / sum) * Math.PI * 2;
      along += arcNeeded(n);
      out.set(n, { x: centre.x + radius * Math.cos(a), y: centre.y + radius * Math.sin(a) });
    }
  });
  return first + (rings - 1) * step + maxR + 40;
}

export function focusPositions(g: Graph, focus: GraphNode): Positions {
  const base = overviewPositions(g);
  const out: Positions = new Map();
  const centre = base.get(focus)!;
  out.set(focus, centre);
  const radius = ringLayout(focus, centre, out);

  const satellites = [g.root, ...g.categories.filter((c) => c !== focus)];
  const angleOf = (n: GraphNode) => {
    const p = base.get(n)!;
    return Math.atan2(p.y - centre.y, p.x - centre.x);
  };
  const sorted = satellites.map((n) => ({ n, a: angleOf(n) })).sort((a, b) => a.a - b.a);
  const step = (Math.PI * 2) / sorted.length;
  const offset = sorted.reduce((sum, s, i) => sum + (s.a - i * step), 0) / sorted.length;
  const ring = radius + 170;
  sorted.forEach(({ n }, i) => {
    const a = offset + i * step;
    out.set(n, { x: centre.x + ring * Math.cos(a), y: centre.y + ring * Math.sin(a) });
  });

  // Everything else collapses into its category satellite.
  for (const n of g.placed) {
    if (!out.has(n)) out.set(n, out.get(n.category ?? g.root)!);
  }
  return out;
}

/** Is `n` the node itself or somewhere below `ancestor`? */
export function within(n: GraphNode, ancestor: GraphNode): boolean {
  for (let p: GraphNode | null = n; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Product orbit: tucked against the brand → a little further out on hover →
// a labelled ring when the brand is open.
// ---------------------------------------------------------------------------

export function orbitRadius(brand: GraphNode, o: number): number {
  const tucked = brand.r + COLLAPSED_GAP;
  const peek = brand.r + PEEK_GAP;
  return o <= PEEK ? tucked + (peek - tucked) * (o / PEEK) : peek + (brand.ringR - peek) * ((o - PEEK) / (1 - PEEK));
}

export function dotRadius(o: number): number {
  return o <= PEEK ? 2.2 + 1.2 * (o / PEEK) : 3.4 + 1.6 * ((o - PEEK) / (1 - PEEK));
}
