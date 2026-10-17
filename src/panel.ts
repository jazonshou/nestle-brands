import type { Graph, GraphNode } from "./graph";

interface WikiImage {
  source: string;
  width: number;
}

interface WikiSummary {
  originalimage?: WikiImage;
  thumbnail?: WikiImage;
  content_urls?: { desktop?: { page?: string } };
}

interface PanelImage {
  src: string;
  credit?: { label: string; href: string };
}

const wikiCache = new Map<string, Promise<PanelImage | null>>();

/** Lead image of an English Wikipedia article, or null if it has none (non-free logos are never returned). */
function wikiImage(title: string): Promise<PanelImage | null> {
  const cached = wikiCache.get(title);
  if (cached) return cached;

  const request = (async () => {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
    if (res.status === 429 || res.status >= 500) throw new Error(`Wikipedia ${res.status}`);
    if (!res.ok) return null;
    const page = (await res.json()) as WikiSummary;
    const { originalimage: full, thumbnail: thumb } = page;
    // Prefer the original unless it's huge; thumbnails can be re-requested at any width.
    const src = full && full.width <= 1200 ? full.source : (thumb?.source.replace(/\/\d+px-/, "/640px-") ?? full?.source);
    if (!src) return null;
    const href = page.content_urls?.desktop?.page;
    return { src, credit: href ? { label: "Wikipedia", href } : undefined };
  })().catch(() => {
    wikiCache.delete(title); // rate-limited or offline: try again next time
    return null;
  });

  wikiCache.set(title, request);
  return request;
}

function imageFor(n: GraphNode): Promise<PanelImage | null> {
  if (n.image) return Promise.resolve({ src: n.image });
  if (n.wiki) return wikiImage(n.wiki);
  return Promise.resolve(null);
}

function initials(name: string): string {
  const words = name.replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const first = (w: string) => [...w][0]?.toUpperCase() ?? "";
  if (words.length === 0) return "?";
  return words.length === 1 ? first(words[0]) : first(words[0]) + first(words[1]);
}

function countBrands(n: GraphNode): number {
  return n.children.reduce((sum, c) => sum + (c.kind === "brand" ? 1 : 0) + countBrands(c), 0);
}

function statusText(n: GraphNode): string {
  if (n.kind === "root") return "Parent company";
  if (n.kind === "category") return `${countBrands(n)} brands`;
  switch (n.status) {
    case "owned":
      return "Owned by Nestlé";
    case "partial":
      return n.stake ? `Nestlé owns ~${Math.round(n.stake * 100)}%` : "Partly owned";
    case "former":
      return "Formerly owned";
  }
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "website";
  }
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface PanelEvents {
  /** A connection chip was clicked. */
  onNavigate(node: GraphNode): void;
  onClose(): void;
}

/** The slide-in card that shows one brand's details. */
export class Panel {
  private readonly root = byId("panel");
  private readonly media = byId("panel-media");
  private readonly monogram = byId("panel-monogram");
  private readonly img = byId<HTMLImageElement>("panel-image");
  private readonly status = byId("panel-status");
  private readonly category = byId("panel-category");
  private readonly name = byId("panel-name");
  private readonly desc = byId("panel-desc");
  private readonly note = byId("panel-note");
  private readonly link = byId<HTMLAnchorElement>("panel-link");
  private readonly linkText = byId("panel-link-text");
  private readonly connections = byId("panel-connections");
  private readonly credit = byId("panel-credit");
  private readonly graph: Graph;
  private readonly events: PanelEvents;
  /** Bumped on every show() so a slow image can't land on the wrong brand. */
  private token = 0;

  constructor(graph: Graph, events: PanelEvents) {
    this.graph = graph;
    this.events = events;
    byId("panel-close").addEventListener("click", () => events.onClose());
  }

  get isOpen(): boolean {
    return document.body.classList.contains("panel-open");
  }

  show(n: GraphNode): void {
    this.root.style.setProperty("--c", n.color);
    this.root.setAttribute("aria-hidden", "false");
    this.root.scrollTop = 0;
    document.body.classList.add("panel-open");

    this.status.textContent = statusText(n);
    this.status.classList.toggle("former", n.status === "former");
    this.category.textContent = n.kind === "brand" ? (n.category?.name ?? "") : "";
    this.name.textContent = n.name;
    this.desc.textContent = n.description;
    this.note.textContent = n.note ?? "";

    this.link.hidden = !n.url;
    if (n.url) {
      this.link.href = n.url;
      this.linkText.textContent = `Visit ${hostname(n.url)}`;
    }

    this.renderConnections(n);
    this.loadImage(n);
  }

  hide(): void {
    this.token++;
    this.root.setAttribute("aria-hidden", "true");
    document.body.classList.remove("panel-open");
  }

  private loadImage(n: GraphNode): void {
    const token = ++this.token;
    this.monogram.textContent = initials(n.name);
    this.media.classList.toggle("is-former", n.status === "former");
    this.media.classList.remove("has-image");
    this.img.classList.remove("is-loaded");
    this.img.removeAttribute("src");
    this.img.alt = "";
    this.credit.replaceChildren();

    const pending = n.image !== undefined || n.wiki !== undefined;
    this.media.classList.toggle("is-loading", pending);
    if (!pending) return;

    const done = () => this.media.classList.remove("is-loading");
    imageFor(n).then((found) => {
      if (token !== this.token) return;
      if (!found) return done();

      this.img.onload = () => {
        if (token !== this.token) return;
        done();
        this.img.alt = n.name;
        this.img.classList.add("is-loaded");
        this.media.classList.add("has-image");
        if (found.credit) {
          const a = Object.assign(document.createElement("a"), {
            href: found.credit.href,
            target: "_blank",
            rel: "noopener noreferrer",
            textContent: found.credit.label,
          });
          this.credit.append("Image via ", a);
        }
      };
      this.img.onerror = () => token === this.token && done();
      this.img.src = found.src;
    });
  }

  private renderConnections(n: GraphNode): void {
    const groups: { title: string; nodes: GraphNode[]; notes?: string[] }[] = [];
    if (n.parent) groups.push({ title: "Part of", nodes: [n.parent] });
    if (n.children.length) groups.push({ title: n.kind === "root" ? "Divisions" : "Includes", nodes: n.children });

    const related = this.graph.linksOf.get(n)!.filter((l) => l.kind === "related");
    if (related.length) {
      groups.push({
        title: "Connected to",
        nodes: related.map((l) => (l.source === n ? l.target : l.source)),
        notes: related.flatMap((l) => l.note ?? []),
      });
    }

    this.connections.replaceChildren(
      ...groups.map((group) => {
        const wrap = document.createElement("div");
        wrap.className = "conn-group";
        const h = document.createElement("h3");
        h.textContent = group.title;
        const chips = document.createElement("div");
        chips.className = "chips";
        chips.append(...group.nodes.map((c) => this.chip(c)));
        wrap.append(h, chips);
        for (const text of group.notes ?? []) {
          const p = document.createElement("p");
          p.className = "conn-note";
          p.textContent = text;
          wrap.append(p);
        }
        return wrap;
      }),
    );
  }

  private chip(n: GraphNode): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.style.setProperty("--c", n.color);
    const dot = document.createElement("span");
    dot.className = `dot ${n.status}`;
    b.append(dot, n.name);
    b.addEventListener("click", () => this.events.onNavigate(n));
    return b;
  }
}
