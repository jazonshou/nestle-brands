/**
 * Where a row sits in the tree. Derived from the spreadsheet's parent_id column:
 * root → category → (group →) brand → product (→ product …).
 */
export type Kind = "root" | "category" | "group" | "brand" | "product";

/** Ownership buckets used for line styles and the legend filter. */
export type Status = "owned" | "partial" | "licensed" | "transition" | "former" | "uncertain";

/** One row of data/nestle-brands.csv, cleaned up and enriched. */
export interface Entry {
  /** The spreadsheet's id column. Logos and descriptions are keyed by it. */
  id: string;
  parentId: string | null;
  kind: Kind;
  /** As written in the spreadsheet, e.g. "Brite (Japan creamer)". */
  fullName: string;
  /** Without the trailing parenthetical: "Brite". */
  name: string;
  /** The trailing parenthetical (or "via …" for categories): "Japan creamer". */
  qualifier: string;
  /** The spreadsheet's ownership column, verbatim. */
  ownership: string;
  status: Status;
  /** Plain-English version of `ownership`, e.g. "50/50 joint venture". */
  statusLabel: string;
  /** 0–1, roughly how much Nestlé owns. Only for partly owned rows; drawn as an arc. */
  stake?: number;
  /** The spreadsheet's status_note column. */
  note: string;
  url: string;
  urlVerified: boolean;
  /** A few words on what it is, e.g. "Cat food". From data/descriptions.json. */
  description: string;
  /** Path of a downloaded logo under public/, from data/logos.json. */
  logo?: string;
  /** True when the logo is light-coloured and needs a dark background. */
  logoDark: boolean;
  /** Logo width ÷ height, so it can be sized to fill its circle. */
  logoAspect: number;
}
