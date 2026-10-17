import type { GraphNode } from "./graph";

/** "Nescafé" → "nescafe", "Coffee mate" → "coffeemate": accent-, case- and spacing-insensitive. */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const MAX_RESULTS = 10;

export interface SearchOptions {
  isVisible(n: GraphNode): boolean;
  onPick(n: GraphNode): void;
}

/** Type-ahead over brand names, then descriptions ("cat food"), then category names. */
export function attachSearch(input: HTMLInputElement, list: HTMLUListElement, nodes: GraphNode[], opts: SearchOptions): void {
  const index = nodes.map((n) => ({
    n,
    name: fold(n.fullName),
    desc: fold(`${n.description} ${n.qualifier}`),
    cat: n.kind === "brand" ? fold(n.category?.name ?? "") : "",
  }));
  /** On equal matches, show the bigger thing first. */
  const KIND_ORDER = { root: 0, category: 1, group: 2, brand: 3, product: 4 };
  let results: GraphNode[] = [];
  let active = 0;

  const find = (query: string): GraphNode[] => {
    const q = fold(query);
    if (!q) return [];
    const scored: [number, GraphNode][] = [];
    for (const e of index) {
      if (!opts.isVisible(e.n)) continue;
      const score = e.name.startsWith(q) ? 0 : e.name.includes(q) ? 1 : e.desc.includes(q) ? 2 : e.cat.includes(q) ? 3 : -1;
      // Products rank one step lower, so "pro plan" finds the brand before its 19 products.
      if (score >= 0) scored.push([score + (e.n.kind === "product" ? 1 : 0), e.n]);
    }
    return scored
      .sort((a, b) => a[0] - b[0] || KIND_ORDER[a[1].kind] - KIND_ORDER[b[1].kind] || a[1].name.localeCompare(b[1].name))
      .slice(0, MAX_RESULTS)
      .map(([, n]) => n);
  };

  const meta = (n: GraphNode) => {
    switch (n.kind) {
      case "root":
        return "Parent company";
      case "category":
        return "Category";
      case "group":
        return `Group · ${n.category?.name ?? ""}`;
      case "brand":
        return n.category?.name ?? "";
      case "product":
        return n.brand ? `in ${n.brand.name}` : "Product";
    }
  };

  const render = () => {
    const open = input.value.trim() !== "" && document.activeElement === input;
    list.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    if (!open) return;

    if (!results.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No matching brands";
      list.replaceChildren(li);
      input.removeAttribute("aria-activedescendant");
      return;
    }

    list.replaceChildren(
      ...results.map((n, i) => {
        const li = document.createElement("li");
        li.id = `search-option-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(i === active));
        li.style.setProperty("--c", n.color);
        const dot = document.createElement("span");
        dot.className = `dot ${n.status}`;
        const small = document.createElement("span");
        small.className = "meta";
        small.textContent = meta(n);
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = n.kind === "root" ? n.label : n.name;
        li.append(dot, name, small);
        li.addEventListener("pointerdown", (e) => {
          e.preventDefault(); // keep focus in the input until we're done
          pick(n);
        });
        li.addEventListener("pointermove", () => {
          if (active === i) return;
          active = i;
          highlight();
        });
        return li;
      }),
    );
    input.setAttribute("aria-activedescendant", `search-option-${active}`);
  };

  /** Moves the keyboard/hover highlight without rebuilding the list. */
  const highlight = () => {
    [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
    input.setAttribute("aria-activedescendant", `search-option-${active}`);
    list.children[active]?.scrollIntoView({ block: "nearest" });
  };

  const pick = (n: GraphNode) => {
    input.value = "";
    results = [];
    input.blur();
    render();
    opts.onPick(n);
  };

  input.addEventListener("input", () => {
    results = find(input.value);
    active = 0;
    render();
  });
  input.addEventListener("focus", render);
  input.addEventListener("blur", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      highlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) pick(results[active]);
    } else if (e.key === "Escape") {
      input.value = "";
      results = [];
      input.blur();
    }
  });
}
