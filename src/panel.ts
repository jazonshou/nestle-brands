import type { GraphNode } from "./graph";
import { countBrands } from "./render";

function initials(name: string): string {
  const words = name.replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const first = (w: string) => [...w][0]?.toUpperCase() ?? "";
  return words.length > 1 ? first(words[0]) + first(words[1]) : first(words[0] ?? "?");
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function linkText(url: string): string {
  const host = hostname(url);
  if (/wikipedia\.org$/.test(host)) return "Read on Wikipedia";
  return host ? `Visit ${host}` : "Visit website";
}

function statusText(n: GraphNode): string {
  switch (n.kind) {
    case "root":
      return "Parent company";
    case "category":
    case "group": {
      const count = `${countBrands(n)} brands`;
      return n.status === "owned" ? count : `${count} · ${n.statusLabel}`;
    }
    default:
      return n.statusLabel;
  }
}

/** The kind of thing it is, for the second tag. */
function contextText(n: GraphNode): string {
  if (n.kind === "product") return n.brand ? `Product of ${n.brand.name}` : "Product";
  if (n.kind === "brand" || n.kind === "group") return n.category?.name ?? "";
  return "";
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface PanelEvents {
  /** A chip or link inside the panel was clicked. */
  onNavigate(node: GraphNode): void;
  onClose(): void;
}

/** The slide-in card that shows one node's details. */
export class Panel {
  private readonly root = byId("panel");
  private readonly media = byId("panel-media");
  private readonly monogram = byId("panel-monogram");
  private readonly img = byId<HTMLImageElement>("panel-image");
  private readonly status = byId("panel-status");
  private readonly context = byId("panel-category");
  private readonly name = byId("panel-name");
  private readonly qualifier = byId("panel-qualifier");
  private readonly desc = byId("panel-desc");
  private readonly note = byId("panel-note");
  private readonly link = byId<HTMLAnchorElement>("panel-link");
  private readonly linkText = byId("panel-link-text");
  private readonly connections = byId("panel-connections");
  private readonly events: PanelEvents;
  private token = 0;

  constructor(events: PanelEvents) {
    this.events = events;
    byId("panel-close").addEventListener("click", () => events.onClose());
  }

  get isOpen(): boolean {
    return document.body.classList.contains("panel-open");
  }

  show(n: GraphNode): void {
    this.root.style.setProperty("--c", n.color);
    this.root.dataset.status = n.status;
    this.root.setAttribute("aria-hidden", "false");
    this.root.scrollTop = 0;
    document.body.classList.add("panel-open");

    this.status.textContent = statusText(n);
    this.context.textContent = contextText(n);
    this.name.textContent = n.kind === "root" ? n.label : n.name;
    this.qualifier.textContent = n.qualifier;
    this.desc.textContent = n.description;
    this.note.textContent = n.note;

    this.link.hidden = !n.url;
    if (n.url) {
      this.link.href = n.url;
      this.linkText.textContent = linkText(n.url);
    }

    this.renderConnections(n);
    this.showImage(n);
  }

  hide(): void {
    this.token++;
    this.root.setAttribute("aria-hidden", "true");
    document.body.classList.remove("panel-open");
  }

  /** The node's own logo; products borrow their brand's. Initials when there's none. */
  private showImage(n: GraphNode): void {
    const token = ++this.token;
    const source = n.logo ? n : n.kind === "product" && n.brand?.logo ? n.brand : null;
    this.monogram.textContent = initials((source ?? n).name);
    this.media.classList.toggle("is-former", n.status === "former");
    this.media.classList.toggle("is-dark", !!source?.logoDark);
    this.media.classList.remove("has-image");
    this.img.classList.remove("is-loaded");
    this.img.removeAttribute("src");
    this.img.alt = "";
    if (!source) return;

    this.img.onload = () => {
      if (token !== this.token) return;
      this.img.alt = `${source.name} logo`;
      this.img.classList.add("is-loaded");
      this.media.classList.add("has-image");
    };
    this.img.onerror = null;
    this.img.src = source.logo!;
  }

  private renderConnections(n: GraphNode): void {
    const groups: { title: string; nodes: GraphNode[] }[] = [];
    if (n.parent && n.parent.kind !== "root") groups.push({ title: "Part of", nodes: [n.parent] });

    if (n.kind === "brand" && n.products.length) groups.push({ title: `Products (${n.products.length})`, nodes: n.products });
    else if (n.kind === "product" && n.children.length) groups.push({ title: "Includes", nodes: n.children });
    else if (n.kind === "root") groups.push({ title: "Categories", nodes: n.children });
    else if (n.kind === "category" || n.kind === "group") {
      const groupsFirst = [...n.children].sort((a, b) => Number(b.kind === "group") - Number(a.kind === "group"));
      groups.push({ title: `Brands (${countBrands(n)})`, nodes: groupsFirst });
    }

    this.connections.replaceChildren(
      ...groups.map((group) => {
        const wrap = document.createElement("div");
        wrap.className = "conn-group";
        const h = document.createElement("h3");
        h.textContent = group.title;
        const chips = document.createElement("div");
        chips.className = "chips";
        chips.append(...group.nodes.map((c) => this.chip(c, n)));
        wrap.append(h, chips);
        return wrap;
      }),
    );
  }

  private chip(n: GraphNode, from: GraphNode): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `chip kind-${n.kind} status-${n.status}`;
    b.style.setProperty("--c", n.color);
    b.title = n.fullName;
    if (n.logo) {
      const img = Object.assign(document.createElement("img"), { src: n.logo, alt: "", loading: "lazy", className: "chip-logo" });
      if (n.logoDark) img.classList.add("is-dark");
      b.append(img);
    } else {
      const dot = document.createElement("span");
      dot.className = "dot";
      b.append(dot);
    }
    b.append(n.kind === "product" && from.kind === "brand" ? n.label : n.kind === "root" ? n.label : n.name);
    b.addEventListener("click", () => this.events.onNavigate(n));
    return b;
  }
}
