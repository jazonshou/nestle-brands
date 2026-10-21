/* ==========================================================================
   Chrome: top bar with breadcrumbs, legend, controls, tooltip, coach
   captions, toast, help popover, the narrow-screen category strip, and the
   screen-reader mirror of the map.
   ========================================================================== */

import { brandsIn, countBrands, statusSentence, type MNode, type Model } from "../model";
import type { NavState } from "../router";
import type { Status } from "../types";
import { LABELS, markSvg } from "./card";

const BASE = import.meta.env.BASE_URL;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

export class TopBar {
  readonly root: HTMLElement;
  private context: HTMLElement;
  readonly searchMount: HTMLElement;
  readonly helpButton: HTMLButtonElement;
  readonly searchButton: HTMLButtonElement;
  private onCrumb: (n: MNode | null) => void;

  constructor(root: HTMLElement, onCrumb: (n: MNode | null) => void) {
    this.root = root;
    this.onCrumb = onCrumb;
    const title = el("a", "title");
    title.href = "#/";
    title.innerHTML = '<span class="mark-n" aria-hidden="true"></span><span>The Nestlé Empire</span>';
    title.addEventListener("click", (e) => {
      e.preventDefault();
      onCrumb(null);
    });
    this.context = el("div", "context");
    this.searchMount = el("div", "search-mount");
    this.searchButton = el("button", "icon-button search-toggle");
    this.searchButton.type = "button";
    this.searchButton.setAttribute("aria-label", "Search");
    this.searchButton.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.6 12.6 17 17"/></svg>';
    this.helpButton = el("button", "icon-button help-button", "?");
    this.helpButton.type = "button";
    this.helpButton.setAttribute("aria-label", "How to explore");
    root.append(title, this.context, this.searchMount, this.searchButton, this.helpButton);
  }

  show(state: NavState) {
    this.context.replaceChildren();
    if (state.level === "overview") return;
    const trail: MNode[] = [state.cat];
    if (state.level === "category" && state.group) trail.push(state.group);
    if (state.level === "brand") {
      if (state.brand.group) trail.push(state.brand.group);
      trail.push(state.brand);
      if (state.product) trail.push(state.product);
    }
    const nav = el("nav", "crumbs");
    nav.setAttribute("aria-label", "You are here");
    const home = el("button", "", "Nestlé");
    home.type = "button";
    home.title = "Show all categories (Esc)";
    home.addEventListener("click", () => this.onCrumb(null));
    nav.append(home);
    trail.forEach((n, i) => {
      nav.append(el("span", "sep", "›"));
      const b = el("button", "", n.kind === "category" ? n.short : n.name);
      b.type = "button";
      if (i === trail.length - 1) b.setAttribute("aria-current", "page");
      b.addEventListener("click", () => this.onCrumb(n));
      nav.append(b);
    });
    this.context.append(nav);
  }
}

// ---------------------------------------------------------------------------
// Narrow-screen category strip
// ---------------------------------------------------------------------------

export class Strip {
  readonly root: HTMLElement;
  private pills = new Map<MNode, HTMLButtonElement>();
  private back: HTMLButtonElement;
  private onPick: (n: MNode | null, up?: boolean) => void;

  constructor(root: HTMLElement, model: Model, onPick: (n: MNode | null, up?: boolean) => void) {
    this.root = root;
    this.onPick = onPick;
    this.back = el("button", "strip-back");
    this.back.type = "button";
    this.back.addEventListener("click", () => this.onPick(null, true));
    root.append(this.back);
    for (const c of model.categories) {
      const b = el("button", "strip-pill");
      b.type = "button";
      b.style.setProperty("--c", c.color);
      b.append(el("span", "dot"), el("span", "", c.short), el("span", "count", String(countBrands(c))));
      b.addEventListener("click", () => this.onPick(c));
      this.pills.set(c, b);
      root.append(b);
    }
    root.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          root.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      },
      { passive: false },
    );
  }

  show(state: NavState, narrow: boolean, origin: MNode | null = null) {
    if (!narrow || state.level === "overview") {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    const cat = state.cat;
    // From a category it goes to all of Nestlé; anywhere deeper the current category's pill is right there,
    // so the button just says Back.
    const top = state.level === "category" && !state.group;
    this.back.textContent = top ? "‹ Nestlé" : "‹ Back";
    this.back.setAttribute(
      "aria-label",
      top
        ? "Back to all of Nestlé"
        : state.level === "brand" && state.product
          ? `Back to ${state.brand.name}`
          : `Back to ${state.level === "brand" && origin ? origin.name : cat.short}`,
    );
    for (const [c, b] of this.pills) b.classList.toggle("is-current", c === cat);
    // The current pill sits just right of the (sticky) back button, with the ones before it fully under it.
    // Measured from screen rects, since the sticky button's offset moves with the scroll.
    const pill = this.pills.get(cat);
    if (pill) this.root.scrollLeft = Math.max(0, this.root.scrollLeft + pill.getBoundingClientRect().left - this.back.getBoundingClientRect().right - 6);
  }

  slots(): Map<MNode, { x: number; y: number }> {
    const out = new Map<MNode, { x: number; y: number }>();
    for (const [c, b] of this.pills) {
      const r = b.getBoundingClientRect();
      out.set(c, { x: Math.min(window.innerWidth - 8, Math.max(8, r.left + 14)), y: r.top + r.height / 2 });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

export class Legend {
  readonly root: HTMLElement;
  private panel: HTMLElement;
  private more: HTMLButtonElement;
  private rows = new Map<Status, HTMLButtonElement[]>();
  private hidden: Set<Status>;
  private onChange: () => void;
  private onHighlight: (s: Status | null) => void;

  constructor(root: HTMLElement, model: Model, hidden: Set<Status>, onChange: () => void, onHighlight: (s: Status | null) => void) {
    this.root = root;
    this.hidden = hidden;
    this.onChange = onChange;
    this.onHighlight = onHighlight;
    const counts = new Map<Status, number>();
    for (const b of model.brands) counts.set(b.status, (counts.get(b.status) ?? 0) + 1);

    const row = el("div", "legend-row");
    const primary: Status[] = ["owned", "partial", "former"];
    for (const s of primary) row.append(this.item(s, LABELS[s], undefined));
    const more = el("button", "legend-more");
    more.type = "button";
    more.setAttribute("aria-expanded", "false");
    more.innerHTML = '<span class="wide-only">More</span><span class="narrow-only">Key</span> <span aria-hidden="true">▸</span>';
    row.append(more);

    this.panel = el("div", "legend-panel");
    this.panel.hidden = true;
    this.panel.append(el("h3", "", "Ownership (brands)"));
    const order: Status[] = ["owned", "partial", "licensed", "transition", "former", "uncertain"];
    for (const s of order) this.panel.append(this.item(s, LABELS[s], counts.get(s) ?? 0, true));
    this.panel.append(el("p", "line-key", "Lines: solid = owned · dashed = part-owned · dotted = formerly Nestlé"));
    const reset = el("button", "link-button", "Show all statuses");
    reset.type = "button";
    reset.addEventListener("click", () => {
      this.hidden.clear();
      this.sync();
      this.onChange();
    });
    this.panel.append(reset);
    more.addEventListener("click", () => {
      this.panel.hidden = !this.panel.hidden;
      more.setAttribute("aria-expanded", String(!this.panel.hidden));
    });
    this.more = more;
    root.append(row, this.panel);
    // The panel closes on a press anywhere else, like the help popover (and that press does nothing else).
    document.addEventListener("pointerdown", (e) => {
      if (!this.panel.hidden && !(e.target instanceof Element && e.target.closest("#legend"))) {
        this.close();
        this.closedAt = e.timeStamp;
      }
    });
  }

  /** Time stamp of the press that last closed the panel from outside. */
  closedAt = -1;

  /** Closes the panel; returns true if it was open (Escape closes it before doing anything else). */
  close(): boolean {
    if (this.panel.hidden) return false;
    if (this.panel.contains(document.activeElement)) this.more.focus();
    this.panel.hidden = true;
    this.more.setAttribute("aria-expanded", "false");
    this.onHighlight(null);
    return true;
  }

  private item(s: Status, label: string, count: number | undefined, wide = false): HTMLButtonElement {
    const b = el("button", `legend-item status-${s}${wide ? " is-row" : ""}`);
    b.type = "button";
    b.setAttribute("aria-pressed", "true");
    b.title = "Click to show or hide";
    b.append(markSvg(s, "#6b5647"), el("span", "label", label));
    if (s === "licensed") b.querySelector(".mark")!.insertAdjacentHTML("afterend", '<span class="tag-mini">L</span>');
    if (s === "transition") b.querySelector(".mark")!.insertAdjacentHTML("afterend", '<span class="tag-mini amber">→</span>');
    if (s === "uncertain") b.querySelector(".mark")!.insertAdjacentHTML("afterend", '<span class="tag-mini">?</span>');
    if (count !== undefined) b.append(el("span", "count", String(count)));
    b.addEventListener("click", () => {
      if (this.hidden.has(s)) this.hidden.delete(s);
      else this.hidden.add(s);
      this.sync();
      this.onChange();
      this.onHighlight(this.hidden.has(s) ? null : s);
    });
    b.addEventListener("pointerenter", () => this.onHighlight(this.hidden.has(s) ? null : s));
    b.addEventListener("pointerleave", () => this.onHighlight(null));
    const list = this.rows.get(s) ?? [];
    list.push(b);
    this.rows.set(s, list);
    return b;
  }

  sync() {
    for (const [s, list] of this.rows) for (const b of list) b.setAttribute("aria-pressed", String(!this.hidden.has(s)));
    // A count on the Key/More button says that some ownership types are hidden.
    if (this.hidden.size) {
      this.more.dataset.hidden = String(this.hidden.size);
      this.more.setAttribute("aria-label", `Key, ${this.hidden.size} hidden`);
    } else {
      delete this.more.dataset.hidden;
      this.more.removeAttribute("aria-label");
    }
  }

  get rect(): DOMRect {
    return this.root.getBoundingClientRect();
  }
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export class Tooltip {
  readonly root: HTMLElement;
  private shown: MNode | null = null;
  private hideTimer = 0;
  lastHidden = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.setAttribute("role", "tooltip");
  }

  show(n: MNode, x: number, y: number, r: number, extra?: string) {
    clearTimeout(this.hideTimer);
    if (this.shown !== n) {
      this.root.replaceChildren(this.content(n, extra));
      this.shown = n;
    }
    this.root.classList.add("is-on");
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    let top = y - r - 10 - h;
    if (top < 64) top = y + r + 10;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2));
    this.root.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  hide() {
    if (!this.shown) return;
    this.shown = null;
    this.lastHidden = performance.now();
    this.root.classList.remove("is-on");
  }

  get current() {
    return this.shown;
  }

  private content(n: MNode, extra?: string): HTMLElement {
    const box = el("div", "tip");
    if (n.kind === "brand") {
      const head = el("div", "tip-head");
      if (n.e.logo) {
        const img = el("img", n.e.logoDark ? "is-dark" : "");
        img.src = `${BASE}${n.e.logo}`;
        img.alt = "";
        head.append(img);
      }
      head.append(el("strong", "", n.name));
      box.append(head);
      if (n.e.description) box.append(el("p", "", n.e.description));
      if (n.status !== "owned") {
        const chip = el("p", "tip-status");
        chip.append(markSvg(n.status, n.color), document.createTextNode(` ${statusSentence(n)}`));
        box.append(chip);
      }
      box.append(el("p", "tip-hint", n.products.length ? `${n.products.length} products · click to see them` : "Click for details"));
    } else if (n.kind === "product") {
      box.append(el("strong", "", n.name), el("p", "", `${n.brand?.name ?? ""} product`));
    } else if (n.kind === "category") {
      box.append(el("strong", "", n.short), el("p", "tip-hint", extra ?? `${countBrands(n)} brands · click to explore`));
    } else if (n.kind === "group") {
      box.append(el("strong", "", n.name), el("p", "tip-hint", `${brandsIn(n).length} brands`));
    } else if (n.kind === "root") {
      box.append(el("strong", "", "Nestlé S.A."), el("p", "tip-hint", "Click for details"));
    }
    return box;
  }
}

// ---------------------------------------------------------------------------
// Small floating messages
// ---------------------------------------------------------------------------

export class Caption {
  readonly root: HTMLElement;
  private timer = 0;
  constructor(root: HTMLElement) {
    this.root = root;
    root.setAttribute("role", "status");
  }
  show(text: string, ms = 0) {
    clearTimeout(this.timer);
    this.root.textContent = text;
    this.root.classList.add("is-on");
    if (ms) this.timer = window.setTimeout(() => this.hide(), ms);
  }
  hide() {
    clearTimeout(this.timer);
    this.root.classList.remove("is-on");
  }
  get visible() {
    return this.root.classList.contains("is-on");
  }
}

// ---------------------------------------------------------------------------
// Help popover
// ---------------------------------------------------------------------------

export function buildHelp(root: HTMLElement, touch: boolean) {
  const rows: [string, string][] = touch
    ? [
        ["Move", "Drag with one finger"],
        ["Zoom", "Pinch"],
        ["Open", "Tap a category, brand or product"],
        ["Rearrange", "Hold a circle, then drag it"],
        ["Go back", "Tap a name in the strip, or swipe the card down"],
      ]
    : [
        ["Move", "Two-finger scroll, or right-click and drag"],
        ["Zoom", "Pinch, or ⌘ / Ctrl + scroll"],
        ["Peek", "Hover a brand to see its products"],
        ["Open", "Click a category, brand or product"],
        ["Rearrange", "Drag any circle"],
        ["Go back", "Esc, or click empty space"],
        ["Search", "Press /"],
        ["Show everything", "Press 0"],
      ];
  const table = el("dl", "help-table");
  for (const [a, b] of rows) table.append(el("dt", "", a), el("dd", "", b));
  root.replaceChildren(
    el("h2", "", "How to explore"),
    table,
    el("p", "help-note", "Compiled from public sources; it may be incomplete or out of date."),
    el("p", "help-note", "Independent fan project, not affiliated with Nestlé. Trademarks and logos belong to their owners."),
  );
}

// ---------------------------------------------------------------------------
// Screen-reader mirror
// ---------------------------------------------------------------------------

export class Mirror {
  private nav: HTMLElement;
  private live: HTMLElement;
  private onActivate: (n: MNode) => void;
  private onFocus: (n: MNode | null) => void;
  private model: Model;

  constructor(nav: HTMLElement, live: HTMLElement, model: Model, onActivate: (n: MNode) => void, onFocus: (n: MNode | null) => void) {
    this.nav = nav;
    this.live = live;
    this.model = model;
    this.onActivate = onActivate;
    this.onFocus = onFocus;
  }

  sync(state: NavState) {
    const lists: [string, MNode[]][] = [["Categories", this.model.categories]];
    if (state.level !== "overview") lists.push([`Brands in ${state.cat.short}`, brandsIn(state.cat)]);
    if (state.level === "brand" && state.brand.products.length) lists.push([`Products of ${state.brand.name}`, state.brand.products]);
    this.nav.replaceChildren(
      ...lists.map(([title, nodes]) => {
        const sec = el("section");
        sec.append(el("h2", "", title));
        const ul = el("ul");
        for (const n of nodes) {
          const li = el("li");
          const b = el("button", "", n.kind === "category" ? `${n.short}, ${countBrands(n)} brands` : `${n.name}${n.e.description ? `, ${n.e.description}` : ""}`);
          b.type = "button";
          b.addEventListener("click", () => this.onActivate(n));
          b.addEventListener("focus", () => this.onFocus(n));
          b.addEventListener("blur", () => this.onFocus(null));
          li.append(b);
          ul.append(li);
        }
        sec.append(ul);
        return sec;
      }),
    );
    this.announce(state);
  }

  private announce(state: NavState) {
    let text = "Overview of Nestlé's brands.";
    if (state.level === "category") text = `${state.cat.short}, ${countBrands(state.cat)} brands.`;
    if (state.level === "brand") text = state.product ? `${state.product.name}, a ${state.brand.name} product.` : `${state.brand.name}: ${state.brand.e.description}. ${statusSentence(state.brand)}.`;
    this.live.textContent = text;
  }
}
