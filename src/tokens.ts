/* ==========================================================================
   Every tunable number in one place: layout, sizes, colours and motion.
   World units are CSS px at zoom k = 1 (the focus view).
   ========================================================================== */

export const COLORS = {
  bg: "#f8f3ec",
  bgEdge: "#f1e9dd",
  card: "#fffdf9",
  ink: "#3a2a1f",
  inkSoft: "#6b5647",
  inkFaint: "#8a7768",
  line: "#e6dacb",
  root: "#5a3a28",
  former: "#8f857c",
  amber: "#a85a00",
  focus: "#1f5fbf",
  logoDark: "#2a1f18",
  track: "#e4d9cc",
};

export const FONT = {
  sans: '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Fraunces, Georgia, "Times New Roman", serif',
};

/** Layout (world units). */
export const LAYOUT = {
  hubR: 26, // category hub slot inside its island
  groupHubR: 5,
  groupPad: 10,
  islandMargin: 18,
  relaxIters: 300,
  gravity: 0.02,
  nestleR: 64,
  wheelGap: 56,
  wheelStart: -Math.PI / 2 - 0.25,
  aspectClasses: [0.5, 0.75, 1.0, 1.4, 1.8],
  /** Brand labels on the map are cut (at a word, if possible) to about this width. */
  labelW: 126,
};

/** Brand radius in world units: 16–28 depending on product count. */
export const brandRadius = (products: number) => 16 + 2.6 * Math.sqrt(products);

/**
 * Approximate advance widths for DM Sans 500 at 12.5 px, by character class.
 * The layout must not depend on when the web font finishes loading, so it uses
 * these instead of measureText (labels themselves are measured for real).
 */
export function estimateWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (" ,.'’:;|!ilj".includes(ch)) w += 3.4;
    else if ("ftrI()[]-/".includes(ch)) w += 4.6;
    else if ("mwMW@".includes(ch)) w += 10.4;
    else if (ch >= "A" && ch <= "Z") w += 8.2;
    else if (ch >= "0" && ch <= "9") w += 7;
    else w += 6.9;
  }
  return w;
}

/** Screen sizes (CSS px). */
export const SIZE = {
  wideMinW: 1100,
  wideMinH: 600,
  topbar: 56,
  topbarNarrow: 48,
  strip: 44,
  cardW: 340,
  signpost: 18,
  signpostNarrow: 14,
  focusMinBadge: 14,
  focusMinBadgeNarrow: 12,
  badgeMax: 30,
  openBadge: 36,
  openBadgeNarrow: 30,
  nestleMin: 28,
  pillH: 26,
  chipH: 28,
  productRow: 20,
  productRowCoarse: 26,
  hitMouse: 12,
  hitTouch: 22,
  hitProduct: 12,
};

/** Motion. Halflives in seconds; durations in ms. */
export const MOTION = {
  hoverLift: 1.08,
  hoverH: 0.03,
  peekZeta: 0.75,
  peekT: 0.28,
  peekStaggerMs: 12,
  peekInH: 0.035,
  fanZeta: 0.8,
  fanT: 0.32,
  fanDelayMs: 60,
  fanCloseH: 0.04,
  lensH: 0.05,
  dimH: 0.045,
  collapseMs: 280,
  focusH: 0.08,
  chipH: 0.06,
  cameraH: 0.08,
  wheelZoomH: 0.05,
  wheelPanTauMs: 80,
  flightRho: 1.42,
  flightMinMs: 450,
  flightMaxMs: 900,
  flightDelayFromOverviewMs: 120,
  glideTauMs: 200,
  glideMinSpeed: 0.15,
  glideMaxSpeed: 2.5,
  throwTauMs: 180,
  dragLift: 1.1,
  neighbourH: 0.09,
  islandH: 0.11,
  labelInMs: 120,
  labelOutMs: 90,
  filterMs: 150,
  pulseMs: 600,
  tooltipDwellMs: 250,
  tooltipWarmMs: 500,
  peekDwellMs: 120,
  settleMs: 64,
};

/** Level-of-detail thresholds (screen px). */
export const LOD = {
  skip: 1.2,
  badgeSpan: 4, // dot → badge cross-fade width after b0
  moonsFrom: 12,
  moonsTo: 15,
  tagFrom: 13,
  interactiveFrom: 8,
  labelOn: 10,
  islandLabelsFrom: 480, // island diameter at which brand names may appear outside focus
  signpostsUntil: 400,
  groupFillFrom: 160,
  groupCaptionFrom: 120,
};
