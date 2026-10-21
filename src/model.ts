/* ==========================================================================
   The tree: Nestlé → categories → (groups →) brands → products, with display
   names, slugs, labels, status wording and search text. Built once; immutable.
   ========================================================================== */

import { brandRadius, estimateWidth, LAYOUT } from "./tokens";
import type { Entry, Kind, Status } from "./types";

export interface CategoryMeta {
  short: string;
  color: string;
  order: number;
  heroes: string[];
  tag?: string;
  tagStatus?: Status;
  /** How to word "Transitioning" for this category's brands, when the generic "being sold" doesn't fit. */
  transition?: { sentence: string; short: string };
  spoke?: "partial" | "former";
  border?: "dashed";
  gapBefore?: number;
}

export interface MNode {
  /** Index into Model.nodes. */
  i: number;
  id: string;
  e: Entry;
  kind: Kind;
  parent: MNode | null;
  children: MNode[];
  category: MNode | null;
  group: MNode | null;
  brand: MNode | null;
  /** Brands: every product below, flattened in sheet order. */
  products: MNode[];
  status: Status;
  /** Display name without the trailing parenthetical. */
  name: string;
  /** Categories: short name for pills. Others: same as name. */
  short: string;
  slug: string;
  /** Text drawn on the map (truncated). */
  label: string;
  color: string;
  /** Signpost rank inside the category (lower = more important), or 999. */
  hero: number;
  /** Brands: world radius. Groups/categories: hub radius. */
  r: number;
  /** Brands: collision footprint that leaves room for a label. */
  f: number;
  /** Lower-cased search haystacks. */
  searchName: string;
  searchMore: string;
  meta?: CategoryMeta;
}

export interface Model {
  root: MNode;
  nodes: MNode[];
  categories: MNode[];
  brands: MNode[];
  groups: MNode[];
  products: MNode[];
  byId: Map<string, MNode>;
}

const FALLBACK_COLOR = "#8a7f74";

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Shortens text to an estimated width, preferring to cut between words. */
export function truncateWidth(s: string, maxW: number): string {
  if (estimateWidth(s) <= maxW) return s;
  const room = maxW - estimateWidth("…");
  const words = s.split(" ");
  let text = "";
  for (const w of words) {
    const next = text ? `${text} ${w}` : w;
    if (estimateWidth(next) > room) break;
    text = next;
  }
  // Fall back to a character cut when the first word alone is too long, or the word cut loses too much.
  if (estimateWidth(text) < room * 0.6) {
    text = "";
    for (const ch of s) {
      if (estimateWidth(text + ch) > room) break;
      text += ch;
    }
  }
  return `${text.replace(/[\s,.&:;–-]+$/, "")}…`;
}

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const slugify = (s: string) =>
  fold(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

/** "Nescafé Gold" under Nescafé → "Gold"; "Pro Plan Dog" under Purina Pro Plan → "Dog". */
export function productLabel(product: string, brand: string): string {
  const words = brand.split(/\s+/);
  let text = product;
  for (let i = 0; i < words.length; i++) {
    const prefix = `${words.slice(i).join(" ")} `;
    if (prefix.length > 3 && product.toLowerCase().startsWith(prefix.toLowerCase())) {
      const rest = product.slice(prefix.length);
      if (rest.length >= 3) {
        text = rest;
        break;
      }
    }
  }
  // Kept long: the lens cuts names to the room it has.
  return truncate(text.replace(/\s*\([^()]*\)\s*$/, ""), 48);
}

export function initials(name: string): string {
  const words = name.replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const first = (w: string) => [...w][0]?.toUpperCase() ?? "";
  return words.length > 1 ? first(words[0]) + first(words[1]) : first(words[0] ?? "?");
}

/** Plain-English ownership sentence for cards and tooltips. */
/** A short status word that's specific to this node's category, if its category words it differently. */
export function statusShort(n: MNode): string | null {
  return n.status === "transition" ? (n.category?.meta?.transition?.short ?? null) : null;
}

export function statusSentence(n: MNode): string {
  switch (n.e.ownership) {
    case "Owned":
    case "Category":
    case "Group":
      return "Owned by Nestlé";
    case "Parent":
      return "Parent company";
    case "Majority":
      return "Majority-owned by Nestlé";
    case "Minority":
      return "Minority stake";
    case "JV 50%":
      return "50/50 joint venture";
    case "JV (stake undisclosed)":
      return "Joint venture (stake undisclosed)";
    case "Licensed":
      return "Licensed brand";
    case "Transitioning":
      return n.category?.meta?.transition?.sentence ?? "Being sold or spun off";
    case "Pending sale":
      return "Sale agreed, not yet closed";
    case "Divested":
      return "Formerly Nestlé: sold";
    case "Discontinued":
      return "Discontinued";
    case "Uncertain":
      return "Ownership unconfirmed";
    default:
      return n.e.statusLabel;
  }
}

/** Short tag drawn on a badge's rim for statuses that need one. */
export function statusTag(n: MNode): string {
  switch (n.e.ownership) {
    case "JV 50%":
      return "50%";
    case "Majority":
      return "Maj";
    case "Minority":
      return "Min";
    case "JV (stake undisclosed)":
      return "JV";
    case "Licensed":
      return "L";
    case "Transitioning":
    case "Pending sale":
      return "→";
    case "Uncertain":
      return "?";
    default:
      return "";
  }
}

const STATUS_WORDS: Record<Status, string> = {
  owned: "owned",
  partial: "partly owned joint venture jv stake majority minority 50%",
  licensed: "licensed licence license",
  transition: "being sold for sale sale pending transition spin off peranel",
  former: "sold divested former formerly discontinued ex",
  uncertain: "unconfirmed uncertain unknown",
};

export function buildModel(entries: Entry[], meta: Record<string, CategoryMeta>): Model {
  const nodes: MNode[] = [];
  const byId = new Map<string, MNode>();
  for (const e of entries) {
    if (byId.has(e.id)) {
      console.warn(`[data] Duplicate id ${e.id} "${e.fullName}" — skipped.`);
      continue;
    }
    const n: MNode = {
      i: nodes.length, id: e.id, e, kind: e.kind, parent: null, children: [],
      category: null, group: null, brand: null, products: [], status: e.status,
      name: e.name, short: e.name, slug: "", label: e.name, color: FALLBACK_COLOR,
      hero: 999, r: 0, f: 0, searchName: "", searchMore: "",
    };
    nodes.push(n);
    byId.set(e.id, n);
  }
  const root = nodes.find((n) => n.kind === "root");
  if (!root) throw new Error("The CSV needs one row without a parent_id (Nestlé itself).");
  root.name = root.e.name.replace(/\s+S\.A\.$/, "");
  root.short = root.label = root.name;
  root.color = "#5a3a28";

  for (const n of nodes) {
    if (n === root) continue;
    const parent = (n.e.parentId && byId.get(n.e.parentId)) || root;
    n.parent = parent;
    parent.children.push(n);
  }

  let nextOrder = 100;
  const categories = root.children.filter((n) => n.kind === "category");
  for (const c of categories) {
    let m = meta[c.id];
    if (!m) {
      console.warn(`[data] Category ${c.id} "${c.e.fullName}" has no entry in data/categories.json — using defaults.`);
      m = { short: c.name, color: FALLBACK_COLOR, order: nextOrder++, heroes: [] };
    }
    c.meta = m;
    c.short = c.label = m.short;
    c.color = m.color;
    c.r = LAYOUT.hubR;
  }
  categories.sort((a, b) => a.meta!.order - b.meta!.order);

  for (const n of nodes) {
    for (let p: MNode | null = n; p; p = p.parent) {
      if (!n.category && p.kind === "category") n.category = p;
      if (!n.group && p.kind === "group") n.group = p;
      if (!n.brand && p.kind === "brand") n.brand = p;
    }
    if (n !== root && n.kind !== "category") n.color = n.category?.color ?? FALLBACK_COLOR;
    if (n.kind === "product" && n.brand) n.brand.products.push(n);
  }

  for (const n of nodes) {
    if (n.kind === "brand") {
      n.r = brandRadius(n.products.length);
      n.label = truncateWidth(n.name, LAYOUT.labelW);
      n.f = Math.max(n.r, 0.375 * (estimateWidth(n.label) + 8)) + 5;
      const heroes = n.category?.meta?.heroes ?? [];
      const rank = heroes.indexOf(n.id);
      n.hero = rank >= 0 ? rank : 999;
    } else if (n.kind === "group") {
      n.r = LAYOUT.groupHubR;
      n.label = truncate(n.name, 30);
    } else if (n.kind === "product") {
      n.label = productLabel(n.name, n.brand?.name ?? "");
    }
    const cat = n.category;
    n.searchName = fold(`${n.e.fullName} ${n.name}`);
    n.searchMore = fold(
      [n.e.description, n.e.qualifier, cat?.short, cat?.e.fullName, n.group?.name, STATUS_WORDS[n.status], ...n.children.map((c) => c.name)]
        .filter(Boolean)
        .join(" "),
    );
  }

  // Slugs: unique among siblings (the URL path is category/brand/product).
  const used = new Map<MNode, Set<string>>();
  for (const n of nodes) {
    if (n === root) {
      n.slug = "nestle";
      continue;
    }
    const scope = n.kind === "category" ? root : n.kind === "product" ? n.brand! : n.category!;
    const taken = used.get(scope) ?? new Set<string>();
    used.set(scope, taken);
    let slug = slugify(n.kind === "category" ? n.short : n.name);
    if (taken.has(slug)) slug = `${slug}-${n.id}`;
    taken.add(slug);
    n.slug = slug;
  }

  return {
    root,
    nodes,
    categories,
    brands: nodes.filter((n) => n.kind === "brand"),
    groups: nodes.filter((n) => n.kind === "group"),
    products: nodes.filter((n) => n.kind === "product"),
    byId,
  };
}

export const countBrands = (n: MNode): number =>
  n.children.reduce((sum, c) => sum + (c.kind === "brand" ? 1 : c.kind === "group" ? countBrands(c) : 0), 0);

/** Every brand inside a category or group. */
export function brandsIn(n: MNode): MNode[] {
  const out: MNode[] = [];
  for (const c of n.children) {
    if (c.kind === "brand") out.push(c);
    else if (c.kind === "group") out.push(...brandsIn(c));
  }
  return out;
}
