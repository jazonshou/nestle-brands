/** How much of a brand Nestlé holds today. */
export type Status = "owned" | "partial" | "former";

/** Fields every circle on the map can show in the detail panel. */
export interface Entry {
  /** Unique, lowercase, no spaces. Used for links and image file names. */
  id: string;
  name: string;
  /** A few words on what it is, e.g. "Cat food". */
  description: string;
  /** Official website. */
  url?: string;
  /** Path or URL of an image, e.g. "images/kitkat.png" (files live in public/images). Wins over `wiki`. */
  image?: string;
  /** English Wikipedia article title. Its lead image is used when there's no `image`. */
  wiki?: string;
  /** One short sentence of context: sale date, stake, licence… */
  note?: string;
}

export type Root = Entry;

export interface Category extends Entry {
  /** Colour for the category and every brand under it. */
  color: string;
}

export interface Brand extends Entry {
  /** Id of a category, or of another brand (e.g. Purina → Fancy Feast). */
  parent: string;
  status: Status;
  /** 0–1, how much Nestlé owns. Only for "partial"; drawn as a pie slice. */
  stake?: number;
  /** Circle radius in px. Defaults to 15. */
  size?: number;
}

/** An extra connection beyond the parent → child tree. */
export interface Connection {
  source: string;
  target: string;
  note?: string;
}

export interface EmpireData {
  root: Root;
  categories: Category[];
  brands: Brand[];
  links: Connection[];
}
