/* ==========================================================================
   Data: reads data/nestle-brands.csv (the spreadsheet export) and enriches
   each row with a short description (data/descriptions.json) and a logo
   (data/logos.json, files in public/logos/). Both are keyed by the CSV id,
   so a fresh export of the spreadsheet keeps them as long as ids are stable.
   ========================================================================== */

import csvText from "../data/nestle-brands.csv?raw";
import descriptionsJson from "../data/descriptions.json";
import logosJson from "../data/logos.json";
import type { Entry, Kind, Status } from "./types";

const descriptions: Record<string, string> = descriptionsJson;
const logos: Record<string, { file: string; bg?: string; ar?: number }> = logosJson;

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') (field += '"'), i++;
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Spreadsheet ownership values → legend bucket, wording and (rough) stake. */
const OWNERSHIP: Record<string, { status: Status; label: string; stake?: number }> = {
  Parent: { status: "owned", label: "Parent company" },
  Category: { status: "owned", label: "Category" },
  Group: { status: "owned", label: "Group of brands" },
  Owned: { status: "owned", label: "Owned by Nestlé" },
  Majority: { status: "partial", label: "Majority stake", stake: 2 / 3 },
  Minority: { status: "partial", label: "Minority stake", stake: 1 / 3 },
  "JV 50%": { status: "partial", label: "50/50 joint venture", stake: 0.5 },
  "JV (stake undisclosed)": { status: "partial", label: "Joint venture", stake: 0.5 },
  Licensed: { status: "licensed", label: "Licensed" },
  Transitioning: { status: "transition", label: "In transition" },
  "Pending sale": { status: "transition", label: "Sale pending" },
  Divested: { status: "former", label: "Sold" },
  Discontinued: { status: "former", label: "Discontinued" },
  Uncertain: { status: "uncertain", label: "Status unconfirmed" },
};

function splitName(full: string, kind: Kind): { name: string; qualifier: string } {
  const paren = full.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (paren) return { name: paren[1], qualifier: paren[2] };
  const via = kind === "category" ? full.match(/^(.+?)\s+(via\s+.+)$/) : null;
  if (via) return { name: via[1], qualifier: via[2] };
  return { name: full, qualifier: "" };
}

function load(): Entry[] {
  const [header, ...body] = parseCsv(csvText);
  const col = (name: string) => header.indexOf(name);
  const c = {
    id: col("id"),
    parent: col("parent_id"),
    name: col("name"),
    ownership: col("ownership"),
    note: col("status_note"),
    url: col("url"),
    verified: col("url_verified"),
  };
  for (const [key, index] of Object.entries(c)) {
    if (index < 0) console.warn(`[data] The CSV has no "${key}" column.`);
  }
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  const raw = body.map((r) => ({
    id: cell(r, c.id),
    parentId: cell(r, c.parent) || null,
    fullName: cell(r, c.name),
    ownership: cell(r, c.ownership),
    note: cell(r, c.note),
    url: cell(r, c.url),
    urlVerified: cell(r, c.verified).toLowerCase() === "yes",
  }));
  const byId = new Map(raw.map((r) => [r.id, r]));
  const rootId = raw.find((r) => !r.parentId)?.id;

  // Kind comes from the parent's kind, so it works however deep the sheet goes.
  const kinds = new Map<string, Kind>();
  const kindOf = (id: string, seen = new Set<string>()): Kind => {
    const known = kinds.get(id);
    if (known) return known;
    const r = byId.get(id)!;
    let kind: Kind;
    if (id === rootId) kind = "root";
    else if (!r.parentId || !byId.has(r.parentId) || seen.has(r.parentId)) {
      console.warn(`[data] Row ${id} "${r.fullName}" has a missing or looping parent — shown as a category.`);
      r.parentId = rootId ?? null;
      kind = "category";
    } else {
      seen.add(id);
      const parent = kindOf(r.parentId, seen);
      kind =
        parent === "root" ? "category"
        : r.ownership === "Group" ? "group"
        : parent === "category" || parent === "group" ? "brand"
        : "product";
    }
    kinds.set(id, kind);
    return kind;
  };

  return raw.map((r) => {
    const kind = kindOf(r.id);
    let own = OWNERSHIP[r.ownership];
    if (!own) {
      console.warn(`[data] Row ${r.id} has unknown ownership "${r.ownership}" — shown as unconfirmed.`);
      own = { status: "uncertain", label: r.ownership || "Unknown" };
    }
    const logo = logos[r.id];
    return {
      ...r,
      ...splitName(r.fullName, kind),
      kind,
      status: own.status,
      statusLabel: own.label,
      stake: own.stake,
      description: descriptions[r.id] ?? "",
      logo: logo?.file ?? undefined,
      logoDark: logo?.bg === "dark",
      logoAspect: logo?.ar ?? 1,
    };
  });
}

export const ENTRIES: Entry[] = load();
