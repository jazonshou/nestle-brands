/* ==========================================================================
   Hash routes ⇄ navigation state. Works on GitHub Pages (no server routing).
     #/                      overview
     #/nestle                overview with Nestlé's card
     #/purina-petcare        a category
     #/waters/germany-waters a group inside a category (groups and brands share slugs per category)
     #/purina-petcare/x      a brand
     #/purina-petcare/x/y    a product (inside its brand)
   ========================================================================== */

import type { MNode, Model } from "./model";

export type NavState =
  | { level: "overview"; card?: "nestle" }
  | { level: "category"; cat: MNode; group?: MNode }
  | { level: "brand"; cat: MNode; brand: MNode; product?: MNode };

export function format(s: NavState): string {
  switch (s.level) {
    case "overview":
      return s.card ? "#/nestle" : "#/";
    case "category":
      return s.group ? `#/${s.cat.slug}/${s.group.slug}` : `#/${s.cat.slug}`;
    case "brand":
      return `#/${s.cat.slug}/${s.brand.slug}${s.product ? `/${s.product.slug}` : ""}`;
  }
}

/** Resolves a hash to the deepest valid state. `exact` is false if anything had to be dropped. */
export function parse(hash: string, model: Model): { state: NavState; exact: boolean } {
  // Each part is decoded on its own, so one malformed escape only spoils that part (which then just won't match).
  const decode = (p: string) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  };
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decode);
  if (!parts.length) return { state: { level: "overview" }, exact: true };
  if (parts[0] === "nestle" && parts.length === 1) return { state: { level: "overview", card: "nestle" }, exact: true };
  const cat = model.categories.find((c) => c.slug === parts[0]);
  if (!cat) return { state: { level: "overview" }, exact: false };
  if (parts.length === 1) return { state: { level: "category", cat }, exact: true };
  const brand = model.brands.find((b) => b.category === cat && b.slug === parts[1]);
  if (!brand) {
    const group = model.groups.find((g) => g.category === cat && g.slug === parts[1]);
    if (group) return { state: { level: "category", cat, group }, exact: parts.length === 2 };
    return { state: { level: "category", cat }, exact: false };
  }
  if (parts.length === 2) return { state: { level: "brand", cat, brand }, exact: true };
  const product = brand.products.find((p) => p.slug === parts[2]);
  if (!product) return { state: { level: "brand", cat, brand }, exact: false };
  return { state: { level: "brand", cat, brand, product }, exact: parts.length === 3 };
}

export function sameState(a: NavState, b: NavState): boolean {
  return format(a) === format(b) && (a.level !== "category" || b.level !== "category" || a.group === b.group);
}

/** What a node navigates to when clicked or picked from search. */
export function stateFor(n: MNode): NavState {
  switch (n.kind) {
    case "root":
      return { level: "overview", card: "nestle" };
    case "category":
      return { level: "category", cat: n };
    case "group":
      return { level: "category", cat: n.category!, group: n };
    case "brand":
      return { level: "brand", cat: n.category!, brand: n };
    case "product":
      return { level: "brand", cat: n.category!, brand: n.brand!, product: n };
  }
}

/** One level up. */
export function upOf(s: NavState): NavState {
  switch (s.level) {
    case "overview":
      return { level: "overview" };
    case "category":
      return s.group ? { level: "category", cat: s.cat } : { level: "overview" };
    case "brand":
      return s.product ? { level: "brand", cat: s.cat, brand: s.brand } : { level: "category", cat: s.cat };
  }
}
