/* ==========================================================================
   Logo atlas: every brand badge (white disc + logo clipped to the circle, or
   an initials tile) is drawn once into one big canvas, so drawing a badge on
   the map is a single drawImage. Former brands are baked in greyscale.
   The open brand gets its own sharper bitmap.
   ========================================================================== */

import { initials, type MNode, type Model } from "./model";
import { COLORS, FONT } from "./tokens";

interface Cell {
  x: number;
  y: number;
  ready: boolean;
  logo: boolean;
}

const BASE = import.meta.env.BASE_URL;
const url = (file: string) => `${BASE}${file}`;

export class Atlas {
  canvas: HTMLCanvasElement;
  cellPx: number;
  private ctx: CanvasRenderingContext2D;
  private items: MNode[];
  private gen = 0;
  private cells = new Map<MNode, Cell>();
  private blobs = new Map<MNode, Blob>();
  private highRes = new Map<MNode, HTMLCanvasElement>();
  private scratch: CanvasRenderingContext2D;
  private onReady: (n: MNode) => void;
  private queue: MNode[] = [];
  private inFlight = 0;
  private fontsReady = false;

  constructor(model: Model, cellPx: number, onReady: (n: MNode) => void) {
    this.cellPx = cellPx;
    this.onReady = onReady;
    this.items = [model.root, ...model.categories.filter((c) => c.e.logo), ...model.brands];
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d")!;
    const sc = document.createElement("canvas");
    this.scratch = sc.getContext("2d", { willReadFrequently: true })!;
    for (const n of this.items) this.cells.set(n, { x: 0, y: 0, ready: false, logo: !!n.e.logo });
    this.allocate();
  }

  /** Lays the cells out on a canvas sized for the current cell size. */
  private allocate() {
    const size = this.cellPx;
    const perRow = Math.max(1, Math.floor(2048 / size));
    this.canvas.width = perRow * size;
    this.canvas.height = Math.ceil(this.items.length / perRow) * size;
    this.scratch.canvas.width = this.scratch.canvas.height = size;
    this.items.forEach((n, i) => {
      const c = this.cells.get(n)!;
      c.x = (i % perRow) * size;
      c.y = Math.floor(i / perRow) * size;
    });
  }

  /** Redraws every badge at a new cell size (after a change of screen or pixel density), from cached files. */
  rebuild(cellPx: number) {
    if (cellPx === this.cellPx) return;
    this.cellPx = cellPx;
    this.gen++;
    this.highRes.clear();
    this.allocate();
    for (const [n, c] of this.cells) {
      if (!c.ready) continue;
      const blob = this.blobs.get(n);
      if (c.logo && blob) {
        // Keep showing the old cell scaled until the new one is decoded.
        c.ready = false;
        void this.paint(n, blob);
      } else if (!c.logo) {
        c.ready = false;
        if (this.fontsReady) this.drawInitials(n, c);
      }
    }
  }

  /** Atlas source rectangle for a node's badge, or null until it is ready. */
  cell(n: MNode): { x: number; y: number; size: number } | null {
    const c = this.cells.get(n);
    return c?.ready ? { x: c.x, y: c.y, size: this.cellPx } : null;
  }

  /** A sharper bitmap for the open brand, if decoded. */
  sharp(n: MNode): HTMLCanvasElement | null {
    return this.highRes.get(n) ?? null;
  }

  /** Initials tiles need the serif font; call once fonts are loaded. */
  fontsLoaded() {
    this.fontsReady = true;
    for (const [n, c] of this.cells) if (!c.logo && !c.ready) this.drawInitials(n, c);
  }

  /** Start loading logos in priority order (signposts and the focused island first). */
  load(order: MNode[]) {
    const seen = new Set(this.queue);
    for (const n of order) {
      const c = this.cells.get(n);
      if (c && c.logo && !c.ready && !seen.has(n)) {
        this.queue.push(n);
        seen.add(n);
      }
    }
    this.pump();
  }

  /** Move a node to the front of the queue (it's needed right now). */
  prioritise(nodes: MNode[]) {
    const set = new Set(nodes);
    this.queue = [...nodes.filter((n) => this.queue.includes(n)), ...this.queue.filter((n) => !set.has(n))];
    this.pump();
  }

  private pump() {
    while (this.inFlight < 6 && this.queue.length) {
      const n = this.queue.shift()!;
      this.inFlight++;
      this.fetchLogo(n).finally(() => {
        this.inFlight--;
        this.pump();
      });
    }
  }

  private async fetchLogo(n: MNode) {
    const c = this.cells.get(n)!;
    try {
      const res = await fetch(url(n.e.logo!));
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      this.blobs.set(n, blob);
      await this.paint(n, blob);
    } catch {
      // Missing or undecodable logo: fall back to initials.
      c.logo = false;
      if (this.fontsReady) this.drawInitials(n, c);
    }
  }

  /** Decodes a logo at the current cell size and draws its badge; starts over if the size changes meanwhile. */
  private async paint(n: MNode, blob: Blob) {
    for (;;) {
      const gen = this.gen;
      const box = this.logoBox(n, this.cellPx);
      const bitmap = await decode(blob, box.w, box.h);
      if (gen === this.gen) {
        this.drawBadge(n, this.cells.get(n)!, bitmap, box);
        if ("close" in bitmap) bitmap.close();
        return;
      }
      if ("close" in bitmap) bitmap.close();
    }
  }

  /** Largest box of the logo's aspect ratio inside 86% of the disc (the ring sits just outside it). */
  private logoBox(n: MNode, size: number) {
    const a = n.e.logoAspect || 1;
    const reach = size * 0.43 * (n.kind === "root" ? 1.04 : 1);
    return { w: Math.max(1, Math.round((2 * reach * a) / Math.hypot(a, 1))), h: Math.max(1, Math.round((2 * reach) / Math.hypot(a, 1))) };
  }

  private drawBadge(n: MNode, c: Cell, img: CanvasImageSource, box: { w: number; h: number }) {
    const size = this.cellPx;
    const ctx = n.status === "former" ? this.scratch : this.ctx;
    const ox = n.status === "former" ? 0 : c.x;
    const oy = n.status === "former" ? 0 : c.y;
    ctx.clearRect(ox, oy, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(ox + size / 2, oy + size / 2, size / 2 - 0.5, 0, Math.PI * 2);
    ctx.fillStyle = n.e.logoDark ? COLORS.logoDark : "#ffffff";
    ctx.fill();
    ctx.clip();
    ctx.drawImage(img, ox + (size - box.w) / 2, oy + (size - box.h) / 2, box.w, box.h);
    ctx.restore();
    if (n.status === "former") {
      // Greyscale, then copy into the atlas.
      fade(this.scratch, size);
      this.ctx.clearRect(c.x, c.y, size, size);
      this.ctx.drawImage(this.scratch.canvas, c.x, c.y);
    }
    c.ready = true;
    this.onReady(n);
  }

  private drawInitials(n: MNode, c: Cell) {
    const size = this.cellPx;
    const ctx = this.ctx;
    ctx.clearRect(c.x, c.y, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x + size / 2, c.y + size / 2, size / 2 - 0.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.globalAlpha = n.status === "former" ? 0.08 : 0.14;
    ctx.fillStyle = n.color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = n.status === "former" ? COLORS.inkSoft : COLORS.ink;
    const text = initials(n.name);
    ctx.font = `600 ${Math.round(size * (text.length > 1 ? 0.34 : 0.42))}px ${FONT.serif}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, c.x + size / 2, c.y + size / 2 + size * 0.02);
    ctx.restore();
    c.ready = true;
    this.onReady(n);
  }

  /** Decode a sharp bitmap for the open brand at its on-screen size. */
  async makeSharp(n: MNode, px: number) {
    if (!n.e.logo || (this.highRes.get(n)?.width ?? 0) >= Math.ceil(px)) return;
    let blob = this.blobs.get(n);
    if (!blob) {
      try {
        const res = await fetch(url(n.e.logo));
        blob = await res.blob();
        this.blobs.set(n, blob);
      } catch {
        return;
      }
    }
    const size = Math.ceil(px);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const box = this.logoBox(n, size);
    try {
      const bmp = await decode(blob, box.w, box.h);
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 0.5, 0, Math.PI * 2);
      ctx.fillStyle = n.e.logoDark ? COLORS.logoDark : "#ffffff";
      ctx.fill();
      ctx.clip();
      ctx.drawImage(bmp, (size - box.w) / 2, (size - box.h) / 2, box.w, box.h);
      if ("close" in bmp) bmp.close();
      if (n.status === "former") fade(ctx, size);
      // Keep at most two sharp bitmaps (current and previous).
      this.highRes.delete(n);
      if (this.highRes.size >= 2) this.highRes.delete(this.highRes.keys().next().value!);
      this.highRes.set(n, canvas);
      this.onReady(n);
    } catch {
      /* keep the atlas cell */
    }
  }
}

/** Former brands: greyscale, lifted toward white, in place. */
function fade(ctx: CanvasRenderingContext2D, size: number) {
  const data = ctx.getImageData(0, 0, size, size);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = l + (255 - l) * 0.35;
  }
  ctx.putImageData(data, 0, 0);
}

async function decode(blob: Blob, w: number, h: number): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
    } catch {
      /* Safari without resize options: fall through */
    }
  }
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  return img;
}
