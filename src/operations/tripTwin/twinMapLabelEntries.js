// Map words on upstream's world overlay (review/map-labels L5): what each
// kind of Trip Twin label looks like there and how it ranks. Pure: no DOM,
// no Cesium. Layers put a `mapLabel(kind, …)` record on their entity instead
// of a Cesium label; twinMapLabels.js turns it into an overlay entry.
//
// The overlay paints one type and one text colour, so a label's meaning is
// in its words (SIMULATED, "not approved") and its 2 px accent bar, always
// an Instrument colour: never World View's cyan, `selected` or tactical cards
// (L4 §3), so the steel QA shots stay steel.

export const TT_OVERLAY_ACCENTS = Object.freeze({
  rally: '#4ba467',
  draft: '#7f949b',
  steel: '#b8c3c7',
  quiet: '#7f949b',
  route: '#3b82f6',
  hazard: '#ee7789',
  check: '#f59e0b',
});

/** The overlay collision group every Trip Twin label shares (L1). */
export const TT_LABEL_GROUP = 'tt-labels';

/**
 * Per kind: overlay variant, accent, priority (higher wins), protected (the
 * arbiter never drops it), leader gap and stub (from the edge of our own
 * mark, so a leader never crosses a glyph). L1 tiers, L4 table.
 */
export const LABEL_KINDS = Object.freeze({
  safety: {
    variant: 'card',
    accent: 'rally',
    priority: 100,
    protect: true,
    gap: 22,
    lead: 11,
  },
  resource: {
    variant: 'card',
    accent: 'steel',
    priority: 75,
    gap: 22,
    lead: 11,
  },
  edit: {
    variant: 'label',
    accent: 'route',
    priority: 90,
    protect: true,
    gap: 12,
  },
  hazard: { variant: 'label', accent: 'hazard', priority: 85, gap: 12 },
  avoid: { variant: 'label', accent: 'check', priority: 65, gap: 12 },
  route: { variant: 'label', accent: 'route', priority: 60, gap: 12 },
  saved: { variant: 'label', accent: 'route', priority: 55, gap: 12 },
  site: { variant: 'card', accent: 'steel', priority: 40, gap: 18, lead: 8 },
  entrance: { variant: 'card', accent: 'steel', priority: 30, gap: 12 },
  streetMajor: { variant: 'track', accent: 'steel', priority: 20, gap: 0 },
  street: { variant: 'label', accent: 'quiet', priority: 10, gap: 0 },
  ambient: { variant: 'label', accent: 'quiet', priority: 5, gap: 12 },
});

/** Safety places that are never dropped by crowding (L1 tier 1; Q2). */
export const PROTECTED_SAFETY = new Set([
  'rally_primary',
  'rally_secondary',
  'safe_house',
  'shelter',
  'relocation',
  'hospital',
]);

/**
 * A layer's label record. kind: a LABEL_KINDS key; title: the meaning (a
 * string, or a function for live text); details: where and when (lines);
 * near/far: metres from the camera, as the old distance condition; draft:
 * grey bar at 72%; protect / priority override the kind; pick: the label
 * opens what its entity opens (a click goes to that entity).
 */
export function mapLabel(kind, o = {}) {
  const k = LABEL_KINDS[kind];
  if (!k) throw new TypeError(`Unknown map label kind: ${kind}`);
  return {
    kind,
    title: o.title ?? '',
    details: o.details || [],
    near: o.near ?? 0,
    far: o.far ?? Infinity,
    draft: Boolean(o.draft),
    protect: o.protect ?? Boolean(k.protect),
    priority: o.priority ?? k.priority,
    accent: o.accent || null,
    pick: Boolean(o.pick),
    boost: o.boost ?? 1,
    // Leader gap from the anchor, when our mark is taller than the kind's.
    gap: o.gap ?? null,
  };
}

const text = (v) => (typeof v === 'function' ? v() : v);

/** The live title and details of a record (functions are read now). */
export function labelText(ml) {
  return {
    title: String(text(ml.title) ?? ''),
    details: (text(ml.details) || []).map(String).filter(Boolean),
  };
}

/**
 * Overlay fields for a record, without id and position. scale: the page's
 * presentation scale (a function, read every frame by the overlay).
 */
export function overlayFields(
  ml,
  { scale = () => 1, interactive = true } = {},
) {
  const k = LABEL_KINDS[ml.kind];
  const { title, details } = labelText(ml);
  const accent = ml.accent || TT_OVERLAY_ACCENTS[ml.draft ? 'draft' : k.accent];
  // A label variant paints its title only: details need a card (L3 §1).
  const variant = details.length && k.variant !== 'card' ? 'card' : k.variant;
  return {
    variant,
    title,
    details,
    accent,
    priority: ml.priority,
    protected: ml.protect,
    collisionGroup: TT_LABEL_GROUP,
    minDistance: ml.near,
    maxDistance: Number.isFinite(ml.far) ? ml.far : undefined,
    // A hard cut at the range, as the Cesium labels had; no edge fade.
    distanceFadeStartRatio: 1,
    edgeFade: false,
    horizonCull: true,
    terrainOcclusion: false,
    placement: 'above',
    verticalOnly: ml.kind !== 'site',
    gapPx: ml.gap ?? k.gap ?? 12,
    leaderOffsetPx: k.lead ?? 0,
    anchorDot: false,
    sourceAlpha: ml.draft ? 0.72 : 1,
    presentationScale: ml.boost === 1 ? scale : () => scale() * ml.boost,
    interactive: interactive && ml.pick,
  };
}

/** Wall label scale (L4 §5): grows with the wall scale, never doubles. */
export const wallLabelScale = (wallScale) =>
  1.1 * Math.max(1, 0.75 * (Number(wallScale) || 1));
export const PAGE_LABEL_SCALE = 1.1;

/** The safety place's label (L1 wording; route-end merge, D12). */
export function safetyLabel(
  p,
  { label, draft, selected = false, endOfRoute = false, far },
) {
  const name = p.name && !p.name.startsWith(label) ? p.name : '';
  const state = [
    draft ? 'Not approved' : '',
    p.chaperone_only ? 'chaperones only' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return mapLabel(PROTECTED_SAFETY.has(p.category) ? 'safety' : 'resource', {
    title: label,
    details: [
      state ? state.charAt(0).toUpperCase() + state.slice(1) : '',
      name,
      endOfRoute ? 'End of shown route' : '',
    ].filter(Boolean),
    draft,
    far,
    pick: true,
    // The selected place reads a size up (L4 §2), never World View's cyan.
    boost: selected ? 1.15 : 1,
  });
}
