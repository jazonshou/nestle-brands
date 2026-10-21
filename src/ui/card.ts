/* ==========================================================================
   The detail card (wide) / bottom sheet (narrow). One slot, one component,
   with a variant for each kind of thing: Nestlé, category, group, brand,
   product.
   ========================================================================== */

import { brandsIn, countBrands, initials, statusSentence, type MNode, type Model } from "../model";
import type { NavState } from "../router";
import type { Status } from "../types";

export interface CardEvents {
  navigate(n: MNode): void;
  up(): void;
  overview(): void;
  /** Hovering a product row highlights its dot. */
  hoverProduct(p: MNode | null): void;
}

const BASE = import.meta.env.BASE_URL;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function markSvg(status: Status, color = "currentColor"): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "-7 -7 14 14");
  svg.setAttribute("class", "mark");
  svg.setAttribute("aria-hidden", "true");
  const c = document.createElementNS(NS, "circle");
  c.setAttribute("r", "5");
  if (status === "former") {
    c.setAttribute("fill", "#fffdf9");
    c.setAttribute("stroke", "#8f857c");
    c.setAttribute("stroke-width", "1.6");
    svg.append(c);
  } else if (status === "partial") {
    c.setAttribute("fill", "#fffdf9");
    c.setAttribute("stroke", color);
    c.setAttribute("stroke-width", "1.4");
    const half = document.createElementNS(NS, "path");
    half.setAttribute("d", "M0,-5A5,5 0 0 0 0,5Z");
    half.setAttribute("fill", color);
    svg.append(c, half);
  } else {
    c.setAttribute("fill", color);
    svg.append(c);
  }
  return svg;
}

export class Card {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private close: HTMLButtonElement;
  private grabber: HTMLElement;
  private model: Model;
  private ev: CardEvents;
  private current = "";
  private narrow = false;
  /** The node the card shows now (to tell a page forward from a page back). */
  private shown: MNode | null = null;
  /** Screen top of the product row just clicked, to keep it in place when the card rebuilds. */
  private anchorTop: number | null = null;
  /** Sheet detent on narrow screens. */
  detent: "hidden" | "mini" | "peek" | "full" = "hidden";
  private drag: { y0: number; t0: number; start: number; lastY: number; lastT: number } | null = null;

  constructor(root: HTMLElement, model: Model, ev: CardEvents) {
    this.root = root;
    this.model = model;
    this.ev = ev;
    root.setAttribute("role", "region");
    root.setAttribute("aria-labelledby", "card-title");
    this.grabber = el("div", "sheet-grabber");
    this.grabber.setAttribute("aria-hidden", "true");
    this.close = el("button", "card-close");
    this.close.type = "button";
    this.close.setAttribute("aria-label", "Close (Esc)");
    this.close.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>';
    this.close.addEventListener("click", () => ev.up());
    this.body = el("div", "card-body");
    root.append(this.grabber, this.close, this.body);
    this.bindSheet();
  }

  setNarrow(narrow: boolean) {
    this.narrow = narrow;
    this.root.classList.toggle("is-sheet", narrow);
    this.applyDetent();
  }

  get height(): number {
    return this.root.offsetHeight;
  }

  /** Height the sheet occupies in a given state (for camera fits). */
  sheetHeight(level: NavState["level"], vh: number): number {
    if (!this.narrow) return 0;
    if (level === "category") return 96;
    if (level === "brand") return vh * 0.4;
    return 0;
  }

  show(state: NavState) {
    let node: MNode | null = null;
    if (state.level === "overview") node = state.card === "nestle" ? this.model.root : null;
    else if (state.level === "category") node = state.group ?? state.cat;
    else node = state.product ?? state.brand;
    const key = node ? `${node.id}|${state.level}` : "";
    if (!node) {
      this.root.classList.remove("is-open");
      this.root.setAttribute("aria-hidden", "true");
      this.current = "";
      this.shown = null;
      this.detent = "hidden";
      this.applyDetent();
      return;
    }
    const swap = this.current && this.current !== key;
    this.current = key;
    // Brand → its product (or the next product) slides in like a new page; going back slides the other way.
    const prev = this.shown;
    this.shown = node;
    let dir: "forward" | "back" | null = null;
    if (prev && prev !== node) {
      if (node.kind === "product" && prev === node.brand) dir = "forward";
      else if (prev.kind === "product" && node === prev.brand) dir = "back";
      else if (node.kind === "product" && prev.kind === "product" && prev.brand === node.brand) {
        dir = node.brand!.products.indexOf(node) > node.brand!.products.indexOf(prev) ? "forward" : "back";
      }
    }
    const hadFocus = this.body.contains(document.activeElement);
    const build = () => {
      // Rows about to be removed can't fire pointerleave, so clear any hover they set.
      this.ev.hoverProduct(null);
      this.body.replaceChildren(this.content(node!, state));
      // After picking a product from the list, the picked row stays under the pointer (and keeps focus).
      const sel = this.body.querySelector<HTMLElement>(".card-products button.is-selected");
      if (sel && this.anchorTop !== null) this.body.scrollTop += sel.getBoundingClientRect().top - this.anchorTop;
      if (sel && hadFocus) sel.focus({ preventScroll: true });
      this.anchorTop = null;
      this.root.dataset.kind = node!.kind;
      // Every card can be closed; on a category it goes back to the everything view.
      this.close.hidden = false;
      this.close.setAttribute("aria-label", node!.kind === "category" ? "Back to everything (Esc)" : "Close (Esc)");
      this.close.title = node!.kind === "category" ? "Back to everything" : "Close";
    };
    // The new content goes in now (so anything measuring the card sees its real size) and fades in.
    build();
    this.body.classList.remove("is-swapping", "is-sliding-forward", "is-sliding-back");
    if (dir) {
      // A new page starts at its top; keyboard focus moves with it.
      this.body.scrollTop = 0;
      void this.body.offsetWidth;
      this.body.classList.add(dir === "forward" ? "is-sliding-forward" : "is-sliding-back");
      if (hadFocus) {
        const target =
          dir === "forward" || node.kind === "product"
            ? this.body.querySelector<HTMLElement>(".brand-back")
            : this.body.querySelector<HTMLElement>(`.card-products button[data-id="${prev!.id}"]`);
        target?.focus({ preventScroll: true });
      }
    } else if (swap && !this.narrow) {
      void this.body.offsetWidth;
      this.body.classList.add("is-swapping");
    }
    this.root.classList.add("is-open");
    this.root.setAttribute("aria-hidden", "false");
    this.root.style.setProperty("--c", node.color);
    // Categories and groups keep the sheet low, so the map above it shows all their brands.
    this.detent = state.level === "category" ? "mini" : "peek";
    this.applyDetent();
  }

  private applyDetent() {
    this.root.dataset.detent = this.narrow ? this.detent : "";
    document.body.classList.toggle("sheet-full", this.narrow && this.detent === "full");
  }

  private media(n: MNode, size: number): HTMLElement {
    const src = n.e.logo ? n : n.kind === "product" && n.brand?.e.logo ? n.brand : null;
    const tile = el("div", "media");
    tile.style.width = tile.style.height = `${size}px`;
    if (src) {
      const img = el("img");
      img.src = `${BASE}${src.e.logo}`;
      img.alt = `${src.name} logo`;
      img.decoding = "async";
      if (src.e.logoDark) tile.classList.add("is-dark");
      if (n.status === "former") tile.classList.add("is-former");
      tile.append(img);
    } else {
      tile.classList.add("is-initials");
      tile.textContent = initials((n.kind === "product" ? n.brand : n)?.name ?? n.name);
      tile.style.fontSize = `${Math.round(size * 0.36)}px`;
    }
    return tile;
  }

  private statusChip(n: MNode): HTMLElement {
    const chip = el("div", "status-chip");
    chip.append(markSvg(n.status, n.color), el("span", "", statusSentence(n)));
    return chip;
  }

  private note(n: MNode): HTMLElement | null {
    if (!n.e.note) return null;
    const wrap = el("div", "card-note");
    const p = el("p", "", n.e.note);
    wrap.append(p);
    if (n.e.note.length > 110) {
      const more = el("button", "link-button", "More");
      more.type = "button";
      more.addEventListener("click", () => {
        wrap.classList.toggle("is-expanded");
        more.textContent = wrap.classList.contains("is-expanded") ? "Less" : "More";
      });
      wrap.append(more);
    }
    return wrap;
  }

  private link(n: MNode, small = false): HTMLElement | null {
    const url = n.e.url;
    if (!url) return null;
    const h = host(url);
    const wiki = /wikipedia\.org$/.test(h);
    const a = el("a", `visit${small ? " is-small" : ""}${!n.e.urlVerified && !wiki ? " is-unverified" : ""}`);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.append(document.createTextNode(wiki ? "Read on Wikipedia" : h ? `Visit ${h}` : "Visit website"), el("span", "arrow", " ↗"));
    if (!n.e.urlVerified && !wiki && !small) {
      const wrap = el("div", "visit-wrap");
      wrap.append(a, el("p", "unverified", "Link not yet checked"));
      return wrap;
    }
    return a;
  }

  private chain(n: MNode): HTMLElement {
    const nav = el("nav", "chain");
    nav.setAttribute("aria-label", "Part of");
    const path: MNode[] = [];
    for (let p: MNode | null = n.parent; p; p = p.parent) path.unshift(p);
    path.forEach((p, i) => {
      if (i) nav.append(el("span", "sep", "›"));
      const b = el("button", "", p.kind === "root" ? "Nestlé" : p.kind === "category" ? p.short : p.name);
      b.type = "button";
      b.addEventListener("click", () => (p.kind === "root" ? this.ev.overview() : this.ev.navigate(p)));
      nav.append(b);
    });
    return nav;
  }

  private products(b: MNode, selected: MNode | null): HTMLElement {
    const wrap = el("section", "card-products");
    wrap.append(el("h3", "", `Products (${b.products.length})`));
    const list = el("ul");
    for (const p of b.products) {
      const li = el("li");
      const btn = el("button", p === selected ? "is-selected" : "");
      btn.type = "button";
      btn.dataset.id = p.id;
      btn.style.setProperty("--c", p.color);
      btn.append(markSvg(p.status, p.color), el("span", "", p.name));
      btn.addEventListener("click", () => {
        this.anchorTop = btn.getBoundingClientRect().top;
        this.ev.navigate(p);
      });
      btn.addEventListener("pointerenter", () => this.ev.hoverProduct(p));
      btn.addEventListener("pointerleave", () => this.ev.hoverProduct(null));
      li.append(btn);
      list.append(li);
    }
    wrap.append(list);
    return wrap;
  }

  /** Previous / next product of the same brand, with where this one sits. */
  private pager(n: MNode): HTMLElement {
    const list = n.brand!.products;
    const i = list.indexOf(n);
    const nav = el("nav", "pager");
    nav.setAttribute("aria-label", `Other ${n.brand!.name} products`);
    const step = (p: MNode | undefined, cls: string, text: (p: MNode) => string) => {
      if (!p) return el("span", cls);
      const btn = el("button", cls, text(p));
      btn.type = "button";
      btn.title = p.name;
      btn.addEventListener("click", () => this.ev.navigate(p));
      return btn;
    };
    nav.append(
      step(list[i - 1], "prev", (p) => `‹ ${p.label}`),
      el("span", "where", `${i + 1} of ${list.length}`),
      step(list[i + 1], "next", (p) => `${p.label} ›`),
    );
    return nav;
  }

  private mixBar(c: MNode): HTMLElement {
    const brands = brandsIn(c);
    const order: Status[] = ["owned", "licensed", "transition", "uncertain", "partial", "former"];
    const bar = el("div", "mix-bar");
    bar.setAttribute("role", "img");
    const parts: string[] = [];
    for (const s of order) {
      const n = brands.filter((b) => b.status === s).length;
      if (!n) continue;
      const seg = el("span", `seg status-${s}`);
      seg.style.flex = String(n);
      seg.style.setProperty("--c", c.color);
      const word = (s === "transition" ? c.meta?.transition?.short : undefined) ?? LABELS[s];
      seg.title = `${n} ${word.toLowerCase()}`;
      bar.append(seg);
      parts.push(`${n} ${word.toLowerCase()}`);
    }
    bar.setAttribute("aria-label", parts.join(", "));
    return bar;
  }

  private content(n: MNode, state: NavState): HTMLElement {
    const frag = el("div", `card-content kind-${n.kind}`);
    const head = el("div", "card-head");
    const title = el("h2", "", n.kind === "category" ? n.short : n.kind === "root" ? "Nestlé S.A." : n.name);
    title.id = "card-title";

    if (n.kind === "category") {
      head.append(this.media(n, 40));
      const t = el("div", "titles");
      t.append(title);
      if (n.e.fullName !== n.short) t.append(el("p", "qualifier", n.e.fullName));
      head.append(t);
      frag.append(head);
      frag.append(el("p", "desc", n.e.description));
      const products = brandsIn(n).reduce((s, b) => s + b.products.length, 0);
      frag.append(el("p", "counts", `${countBrands(n)} brands${products ? ` · ${products} products` : ""}`));
      frag.append(this.mixBar(n));
      if (n.status !== "owned" || n.e.note) {
        const note = this.note(n);
        if (n.status !== "owned") frag.append(this.statusChip(n));
        if (note) frag.append(note);
      }
      const link = this.link(n, true);
      if (link) frag.append(link);
      return frag;
    }

    if (n.kind === "root") {
      head.append(this.media(n, 72));
      const t = el("div", "titles");
      t.append(title, el("p", "desc", n.e.description));
      head.append(t);
      frag.append(head);
      frag.append(el("p", "counts", `${this.model.categories.length} categories · ${this.model.brands.length} brands`));
      if (n.e.note) frag.append(el("p", "card-note-plain", n.e.note));
      const link = this.link(n);
      if (link) frag.append(link);
      return frag;
    }

    if (n.kind === "group") {
      const t = el("div", "titles");
      t.append(title, el("p", "desc", n.e.description));
      head.append(t);
      frag.append(head);
      frag.append(el("p", "counts", `${countBrands(n)} brands`));
      const link = this.link(n);
      if (link) frag.append(link);
      frag.append(this.chain(n));
      return frag;
    }

    if (n.kind === "product") {
      // The product's own page: back to its brand, what it is, who owns it, its link, and the brand's other products.
      const b = n.brand!;
      const back = el("button", "brand-back", `‹ ${b.name}`);
      back.type = "button";
      back.setAttribute("aria-label", `Back to ${b.name}`);
      back.addEventListener("click", () => this.ev.navigate(b));
      frag.append(back);
      head.append(this.media(n, 56));
      const t = el("div", "titles");
      t.append(el("p", "caption", `${b.name} product`), title);
      head.append(t);
      frag.append(head);
      if (n.e.qualifier) frag.append(el("p", "detail", sentence(n.e.qualifier)));
      frag.append(el("p", "desc", `From ${b.name}: ${b.e.description.charAt(0).toLowerCase()}${b.e.description.slice(1)}`));
      frag.append(this.statusChip(n));
      const note = this.note(n);
      if (note) frag.append(note);
      const link = this.link(n);
      if (link) frag.append(link);
      frag.append(this.pager(n));
      frag.append(this.chain(n));
      return frag;
    }

    // Brand
    head.append(this.media(n, 96));
    const t = el("div", "titles");
    t.append(title);
    if (n.e.qualifier) t.append(el("p", "qualifier", n.e.qualifier));
    t.append(el("p", "desc", n.e.description));
    head.append(t);
    frag.append(head);
    frag.append(this.statusChip(n));
    const note = this.note(n);
    if (note) frag.append(note);
    const link = this.link(n);
    if (link) frag.append(link);
    frag.append(this.chain(n));
    if (n.products.length) frag.append(this.products(n, state.level === "brand" ? (state.product ?? null) : null));
    return frag;
  }

  /** Scroll the product list into view ("+N more"). */
  revealProducts() {
    if (this.narrow) {
      this.detent = "full";
      this.applyDetent();
    }
    this.body.querySelector(".card-products")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // --- Phone sheet: drag the grabber between detents --------------------------

  private bindSheet() {
    const start = (e: PointerEvent) => {
      if (!this.narrow) return;
      const target = e.target as HTMLElement;
      if (!target.closest(".sheet-grabber, .card-head") && this.detent === "full") return;
      this.drag = { y0: e.clientY, t0: e.timeStamp, start: this.root.getBoundingClientRect().top, lastY: e.clientY, lastT: e.timeStamp };
      this.root.classList.add("is-dragging");
    };
    const move = (e: PointerEvent) => {
      const d = this.drag;
      if (!d) return;
      const dy = e.clientY - d.y0;
      if (Math.abs(dy) < 4) return;
      this.root.style.transform = `translateY(${Math.max(0, d.start + dy - (window.innerHeight - this.root.offsetHeight))}px)`;
      d.lastY = e.clientY;
      d.lastT = e.timeStamp;
    };
    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      this.root.classList.remove("is-dragging");
      this.root.style.transform = "";
      const dy = e.clientY - d.y0;
      if (Math.abs(dy) < 6) return;
      const v = (e.clientY - d.lastY) / Math.max(1, e.timeStamp - d.lastT);
      const projected = dy + v * 200;
      const order: (typeof this.detent)[] = ["mini", "peek", "full"];
      let i = order.indexOf(this.detent === "hidden" ? "peek" : this.detent);
      if (projected > 60) i--;
      else if (projected < -60) i++;
      if (i < 0 || (i === 0 && this.root.dataset.kind !== "category")) {
        this.ev.up();
        return;
      }
      this.detent = order[Math.min(2, i)];
      this.applyDetent();
    };
    this.root.addEventListener("pointerdown", start);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
}

export const LABELS: Record<Status, string> = {
  owned: "Owned",
  partial: "Part-owned",
  licensed: "Licensed",
  transition: "Being sold",
  former: "Formerly Nestlé",
  uncertain: "Unconfirmed",
};

/** "incl. Gold Mixes: …" → "Includes Gold Mixes: …"; otherwise just capitalised. */
function sentence(q: string): string {
  const t = q.replace(/^incl\.?\s+/i, "Includes ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
