/* ==========================================================================
   Search: type-ahead over names, descriptions, categories and status words
   ("cat food", "sold", "jv"). Results are grouped by category with a logo
   thumbnail and status mark; matches are highlighted live on the map.
   ========================================================================== */

import { fold, initials, statusSentence, statusShort, type MNode, type Model } from "../model";
import { LABELS, markSvg } from "./card";

const BASE = import.meta.env.BASE_URL;
const squash = (s: string) => s.replace(/[^a-z0-9%]+/g, "");
const KIND_ORDER = { root: 0, category: 1, group: 2, brand: 3, product: 4 };

export interface SearchEvents {
  pick(n: MNode): void;
  /** Live highlight while typing (null clears it). */
  highlight(nodes: Set<MNode> | null): void;
}

export class Search {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  private list: HTMLUListElement;
  private ev: SearchEvents;
  private results: MNode[] = [];
  private active = 0;
  private index: { n: MNode; name: string; nameSq: string; more: string; moreSq: string }[];

  constructor(mount: HTMLElement, model: Model, ev: SearchEvents) {
    this.ev = ev;
    this.root = document.createElement("div");
    this.root.className = "search";
    this.root.setAttribute("role", "search");
    this.root.innerHTML = `
      <svg class="search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.6 12.6 17 17"/></svg>
      <input type="search" placeholder="Find a brand…" autocomplete="off" spellcheck="false" aria-label="Find a brand"
             role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="search-results">
      <kbd aria-hidden="true">/</kbd>
      <ul id="search-results" role="listbox" hidden></ul>`;
    mount.append(this.root);
    this.input = this.root.querySelector("input")!;
    this.list = this.root.querySelector("ul")!;
    this.index = model.nodes
      .filter((n) => n.kind !== "root" || true)
      .map((n) => ({ n, name: n.searchName, nameSq: squash(n.searchName), more: n.searchMore, moreSq: squash(n.searchMore) }));

    this.input.addEventListener("input", () => this.update());
    this.input.addEventListener("focus", () => this.render());
    this.input.addEventListener("blur", () => {
      window.setTimeout(() => this.render(), 0);
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!this.results.length) return;
        this.active = (this.active + (e.key === "ArrowDown" ? 1 : -1) + this.results.length) % this.results.length;
        this.highlightRow();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (this.results[this.active]) this.pick(this.results[this.active]);
      } else if (e.key === "Escape") {
        e.stopPropagation();
        this.clear();
        this.input.blur();
      }
    });
  }

  focus() {
    this.input.focus();
    this.input.select();
  }

  clear() {
    this.input.value = "";
    this.results = [];
    this.ev.highlight(null);
    this.render();
  }

  /** Matches left out of the list by the caps. */
  private hiddenCount = 0;

  private find(query: string): MNode[] {
    const q = fold(query).trim();
    if (!q) return [];
    const qs = squash(q);
    const scored: [number, MNode][] = [];
    for (const e of this.index) {
      let score = -1;
      if (e.name.startsWith(q) || e.nameSq.startsWith(qs)) score = 0;
      else if (e.name.includes(q) || e.nameSq.includes(qs)) score = 1;
      else if (e.n.kind !== "product" && (e.more.includes(q) || e.moreSq.includes(qs))) score = e.n.kind === "brand" ? 2 : 3;
      if (score < 0) continue;
      if (e.n.kind === "product") score += 1;
      scored.push([score, e.n]);
    }
    return scored
      .sort((a, b) => a[0] - b[0] || KIND_ORDER[a[1].kind] - KIND_ORDER[b[1].kind] || a[1].name.localeCompare(b[1].name))
      .map(([, n]) => n);
  }

  private update() {
    const all = this.find(this.input.value);
    // At most 12 results, at most 4 per category.
    const perCat = new Map<MNode | null, number>();
    this.results = [];
    for (const n of all) {
      const c = n.category;
      const used = perCat.get(c) ?? 0;
      if (used >= 4) continue;
      perCat.set(c, used + 1);
      this.results.push(n);
      if (this.results.length >= 12) break;
    }
    // Group by category, keeping the best-first order of categories.
    const order = [...new Set(this.results.map((n) => n.category))];
    this.results.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
    this.active = 0;
    this.hiddenCount = all.length - this.results.length;
    const highlight = new Set<MNode>();
    for (const n of all.slice(0, 200)) highlight.add(n.kind === "product" ? n.brand! : n);
    this.ev.highlight(this.input.value.trim() ? highlight : null);
    this.render();
  }

  private render() {
    const open = this.input.value.trim() !== "" && document.activeElement === this.input;
    this.list.hidden = !open;
    this.input.setAttribute("aria-expanded", String(open));
    if (!open) return;
    if (!this.results.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No matches — try a category or “sold”";
      this.list.replaceChildren(li);
      this.input.removeAttribute("aria-activedescendant");
      return;
    }
    const items: HTMLElement[] = [];
    // Rows are grouped under their category; Nestlé itself gets its own heading.
    let lastGroup: MNode | null | undefined;
    this.results.forEach((n, i) => {
      const group = n.kind === "root" ? n : n.category;
      if (group !== lastGroup) {
        lastGroup = group;
        const h = document.createElement("li");
        h.className = "group-head";
        h.setAttribute("role", "presentation");
        h.style.setProperty("--c", n.kind === "root" ? "#6b4a3a" : (n.category?.color ?? "#888"));
        h.textContent = n.kind === "root" ? "Parent company" : (n.category?.short ?? "");
        items.push(h);
      }
      const li = document.createElement("li");
      li.id = `search-option-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === this.active));
      li.style.setProperty("--c", n.color);
      const thumbSrc = n.e.logo ? n : n.kind === "product" && n.brand?.e.logo ? n.brand : null;
      const thumb = document.createElement("span");
      thumb.className = "thumb";
      if (thumbSrc) {
        const img = document.createElement("img");
        img.src = `${BASE}${thumbSrc.e.logo}`;
        img.alt = "";
        img.loading = "lazy";
        if (thumbSrc.e.logoDark) thumb.classList.add("is-dark");
        thumb.append(img);
      } else thumb.textContent = initials(n.kind === "category" ? n.short : n.name);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = n.kind === "category" ? n.short : n.kind === "root" ? "Nestlé" : n.name;
      const meta = document.createElement("span");
      // Short status words never clip; a product's "Brand product" context can shrink.
      meta.className = n.kind === "product" ? "meta" : "meta is-status";
      meta.append(markSvg(n.status, n.color));
      const metaText = document.createElement("span");
      metaText.className = "meta-text";
      metaText.textContent =
        n.kind === "product" ? `${n.brand?.name ?? ""} product` : n.kind === "category" ? "Category" : n.kind === "group" ? "Group" : n.kind === "root" ? "Parent company" : (statusShort(n) ?? LABELS[n.status]);
      meta.append(metaText);
      li.title = n.kind === "brand" ? `${n.name}: ${statusSentence(n)}` : `${name.textContent} · ${metaText.textContent}`;
      li.append(thumb, name, meta);
      // Mouse picks on press (so the input keeps focus). Touch and pen pick on release, and only for a tap:
      // a finger that moves is scrolling the list.
      let press: { x: number; y: number; id: number } | null = null;
      li.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (e.pointerType === "mouse") this.pick(n);
        else press = { x: e.clientX, y: e.clientY, id: e.pointerId };
      });
      li.addEventListener("pointerup", (e) => {
        if (press && press.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 8) this.pick(n);
        press = null;
      });
      li.addEventListener("pointercancel", () => (press = null));
      li.addEventListener("pointermove", () => {
        if (this.active !== i) {
          this.active = i;
          this.highlightRow();
        }
      });
      items.push(li);
    });
    // Say when results were left out (they're still highlighted on the map).
    if (this.hiddenCount > 0) {
      const more = document.createElement("li");
      more.className = "empty";
      more.setAttribute("role", "presentation");
      more.textContent = `+${this.hiddenCount} more highlighted on the map · type more to narrow`;
      items.push(more);
    }
    this.list.replaceChildren(...items);
    this.input.setAttribute("aria-activedescendant", `search-option-${this.active}`);
  }

  private highlightRow() {
    this.list.querySelectorAll('[role="option"]').forEach((li, i) => li.setAttribute("aria-selected", String(i === this.active)));
    this.input.setAttribute("aria-activedescendant", `search-option-${this.active}`);
    this.list.querySelector(`#search-option-${this.active}`)?.scrollIntoView({ block: "nearest" });
  }

  private pick(n: MNode) {
    this.input.value = "";
    this.results = [];
    this.ev.highlight(null);
    this.input.blur();
    this.render();
    this.ev.pick(n);
  }
}
