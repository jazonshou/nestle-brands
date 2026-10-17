import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { EmpireData, Entry, Status } from "./types";

export type NodeKind = "root" | "category" | "brand";

export interface GraphNode extends SimulationNodeDatum, Entry {
  kind: NodeKind;
  status: Status;
  stake?: number;
  color: string;
  /** Circle radius in graph units. */
  r: number;
  /** 0 = Nestlé, 1 = category, 2 = brand, 3+ = sub-brand. */
  depth: number;
  parent: GraphNode | null;
  children: GraphNode[];
  /** Nearest category above this node (itself for categories). */
  category: GraphNode | null;
  x: number;
  y: number;
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: GraphNode;
  target: GraphNode;
  kind: "tree" | "related";
  note?: string;
}

export interface Graph {
  root: GraphNode;
  nodes: GraphNode[];
  links: GraphLink[];
  byId: Map<string, GraphNode>;
  linksOf: Map<GraphNode, GraphLink[]>;
}

export const ROOT_COLOR = "#5a3a28";

const RING = 300; // distance from Nestlé to the category ring
const BRAND_GAP = 170; // category → brand
const SUB_GAP = 105; // brand → sub-brand

/** Turns the flat data file into linked nodes, warning about anything that doesn't line up. */
export function buildGraph(data: EmpireData): Graph {
  const nodes: GraphNode[] = [];
  const byId = new Map<string, GraphNode>();

  const add = (n: GraphNode) => {
    if (byId.has(n.id)) {
      console.warn(`[data] Duplicate id "${n.id}" — the second one was skipped.`);
      return;
    }
    nodes.push(n);
    byId.set(n.id, n);
  };
  const blank = () => ({ parent: null, children: [] as GraphNode[], category: null, x: 0, y: 0 });

  const root: GraphNode = { ...data.root, ...blank(), kind: "root", status: "owned", color: ROOT_COLOR, r: 50, depth: 0 };
  add(root);
  for (const c of data.categories) {
    add({ ...c, ...blank(), kind: "category", status: "owned", r: 26, depth: 1 });
  }
  const parentIds = new Map<GraphNode, string>();
  for (const b of data.brands) {
    const { parent, size, ...rest } = b;
    const node: GraphNode = { ...rest, ...blank(), kind: "brand", color: ROOT_COLOR, r: size ?? 15, depth: 2 };
    add(node);
    parentIds.set(node, parent);
  }

  // Wire up parents. Anything with a bad parent hangs off Nestlé so it's still visible.
  for (const n of nodes) {
    if (n === root) continue;
    let parent: GraphNode = root;
    if (n.kind === "brand") {
      const id = parentIds.get(n)!;
      const found = byId.get(id);
      if (!found || found === n) console.warn(`[data] "${n.id}" has unknown parent "${id}" — attached to Nestlé instead.`);
      else parent = found;
    }
    n.parent = parent;
    parent.children.push(n);
  }

  // Depth, category and colour come from walking up the tree.
  for (const n of nodes) {
    let depth = 0;
    let category: GraphNode | null = null;
    const seen = new Set<GraphNode>();
    for (let p: GraphNode | null = n; p && p !== root; p = p.parent) {
      if (seen.has(p)) {
        console.warn(`[data] "${n.id}" is part of a parent loop — attached to Nestlé instead.`);
        n.parent?.children.splice(n.parent.children.indexOf(n), 1);
        n.parent = root;
        root.children.push(n);
        depth = 1;
        category = null;
        break;
      }
      seen.add(p);
      depth++;
      if (!category && p.kind === "category") category = p;
    }
    n.depth = depth;
    n.category = category;
    if (n.kind === "brand") n.color = category?.color ?? ROOT_COLOR;
  }

  const links: GraphLink[] = nodes
    .filter((n) => n.parent)
    .map((n) => ({ source: n.parent!, target: n, kind: "tree" as const }));

  for (const l of data.links) {
    const source = byId.get(l.source);
    const target = byId.get(l.target);
    if (!source || !target) {
      console.warn(`[data] Link "${l.source}" → "${l.target}" points at an unknown id — skipped.`);
      continue;
    }
    links.push({ source, target, kind: "related", note: l.note });
  }

  const linksOf = new Map<GraphNode, GraphLink[]>(nodes.map((n) => [n, []]));
  for (const l of links) {
    linksOf.get(l.source)!.push(l);
    linksOf.get(l.target)!.push(l);
  }

  return { root, nodes, links, byId, linksOf };
}

/** Rough on-screen footprint of a node including its label, used to keep labels from overlapping. */
function footprint(n: GraphNode): number {
  if (n.kind === "root") return n.r + 24;
  const labelWidth = n.name.length * (n.kind === "category" ? 8 : 6.6);
  return Math.max(n.r + 18, labelWidth * 0.5);
}

function ringRadius(n: GraphNode): number {
  if (n.depth === 0) return 0;
  if (n.depth === 1) return RING;
  return RING + BRAND_GAP + (n.depth - 2) * SUB_GAP;
}

/**
 * Seeds a tidy radial layout (each category gets a slice of the circle sized by
 * how many brands it has), then lets a force simulation relax it.
 */
export function layout(graph: Graph): Simulation<GraphNode, GraphLink> {
  const { root, nodes, links } = graph;
  const weight = (n: GraphNode): number => n.children.reduce((sum, c) => sum + weight(c), 0) || 1;

  const ring = root.children;
  const total = ring.reduce((sum, n) => sum + weight(n), 0);
  let angle = -Math.PI / 2;
  for (const top of ring) {
    const span = (weight(top) / total) * Math.PI * 2;
    const mid = angle + span / 2;
    top.x = RING * Math.cos(mid);
    top.y = RING * Math.sin(mid);

    const below: GraphNode[] = [];
    const walk = (n: GraphNode) => n.children.forEach((c) => (below.push(c), walk(c)));
    walk(top);
    below.forEach((n, i) => {
      const a = angle + ((i + 0.5) / below.length) * span;
      const r = ringRadius(n);
      n.x = r * Math.cos(a);
      n.y = r * Math.sin(a);
    });
    angle += span;
  }

  root.fx = 0;
  root.fy = 0;

  const sim = forceSimulation<GraphNode, GraphLink>(nodes)
    .force(
      "link",
      forceLink<GraphNode, GraphLink>(links)
        .distance((l) => (l.kind === "related" ? 200 : l.target.depth === 1 ? RING : l.target.depth === 2 ? BRAND_GAP : SUB_GAP))
        .strength((l) => (l.kind === "related" ? 0.02 : 0.6)),
    )
    .force(
      "charge",
      forceManyBody<GraphNode>()
        .strength((n) => (n.kind === "root" ? -1500 : n.kind === "category" ? -600 : -240))
        .distanceMax(800),
    )
    .force("collide", forceCollide<GraphNode>(footprint).strength(0.9).iterations(2))
    .force("radial", forceRadial<GraphNode>(ringRadius).strength((n) => (n.depth === 1 ? 0.6 : 0.05)))
    .stop();

  // Settle before the first paint so the map appears calm and finished.
  sim.tick(400);
  return sim.alpha(0);
}
