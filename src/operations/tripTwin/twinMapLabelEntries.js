// Map words on upstream's world overlay (review/map-labels L5): what each
// kind of Trip Twin label looks like there and how it ranks. Pure: no DOM,
// no Cesium. Layers put a `mapLabel(kind, …)` record on their entity instead
// of a Cesium label; twinMapLabels.js turns it into an overlay entry.
//
// The overlay paints one type and one text colour, so a label's meaning is
// in its words (SIMULATED, "Not approved") and its 2 px accent bar, always
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

/** The overlay source and collision group every Trip Twin label shares. */
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

/**
 * The trip's own safety plan: green when approved. Public places (hospital,
 * public shelter) are steel, so green means only an approved place of the
 * trip's plan (brand, UX round 1).
 */
export const PLAN_SAFETY = new Set([
  'rally_primary',
  'rally_secondary',
  'safe_house',
  'relocation',
]);

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
 * string, or a function for live text; '' draws nothing); details: where and
 * when (lines); state: what an edge tag must keep; near/far: metres from
 * the camera, as the old distance condition; draft: grey bar; protect /
 * priority override the kind (a SIMULATED title is always protected); pick:
 * a click goes to the entity; wallDetails: false keeps operator free text
 * off the walls; boost: a size up; gap: leader gap over a tall mark.
 */
export function mapLabel(kind, o = {}) {
  const k = LABEL_KINDS[kind];
  if (!k) throw new TypeError(`Unknown map label kind: ${kind}`);
  // SIMULATED words are never dropped by crowding (every-time P0-2).
  const simulated = typeof o.title === 'string' && /^SIMULATED\b/.test(o.title);
  return {
    kind,
    title: o.title ?? '',
    details: o.details || [],
    state: o.state || '',
    near: o.near ?? 0,
    far: o.far ?? Infinity,
    draft: Boolean(o.draft),
    protect: o.protect ?? (Boolean(k.protect) || simulated),
    priority: o.priority ?? k.priority,
    accent: o.accent || null,
    pick: Boolean(o.pick),
    wallDetails: o.wallDetails ?? true,
    boost: o.boost ?? 1,
    gap: o.gap ?? null,
    // Shared plates: rank (lower hosts), may merge on screen, and the other
    // protected places an edge tag names.
    rank: o.rank ?? 10,
    merge: Boolean(o.merge),
    tagAlso: o.tagAlso || [],
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
  { scale = () => 1, interactive = true, wall = false } = {},
) {
  const k = LABEL_KINDS[ml.kind];
  const { title, details: all } = labelText(ml);
  const details = wall && ml.wallDetails === false ? [] : all;
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
    // A draft is said in words and a grey bar, never faint (round 1).
    sourceAlpha: 1,
    presentationScale: ml.boost === 1 ? scale : () => scale() * ml.boost,
    interactive: interactive && ml.pick,
  };
}

/** Everything that changes an overlay entry, for "has it changed?". */
export function labelSignature(ml, f) {
  return [
    f.title,
    f.details.join('/'),
    ml.kind,
    ml.draft,
    ml.protect,
    ml.priority,
    f.accent,
    ml.pick,
    ml.near,
    ml.far,
    ml.boost,
    ml.gap,
    ml.state,
    ml.tagAlso.join('+'),
    f.interactive,
  ].join('|');
}

/** Wall label scale (L4 §5): grows with the wall scale, never doubles. */
export const wallLabelScale = (wallScale) =>
  1.1 * Math.max(1, 0.75 * (Number(wallScale) || 1));
export const PAGE_LABEL_SCALE = 1.1;

/** The safety place's label (L1 wording; route-end merge, D12). */
export function safetyLabel(
  p,
  {
    label,
    draft,
    selected = false,
    endOfRoute = false,
    far,
    also = [],
    alsoTitles = [],
  },
) {
  const name = p.name && !p.name.startsWith(label) ? p.name : '';
  const said = safetyState(p, draft);
  return mapLabel(PROTECTED_SAFETY.has(p.category) ? 'safety' : 'resource', {
    title: label,
    details: [
      said,
      name,
      // Places at the same spot share one plate (brand, UI round 1).
      ...also.map((a) => `Also here: ${a}`),
      endOfRoute ? 'End of shown route' : '',
    ].filter(Boolean),
    state: said,
    accent: PLAN_SAFETY.has(p.category) ? null : TT_OVERLAY_ACCENTS.steel,
    draft,
    far,
    pick: true,
    // The selected place reads a size up (L4 §2), never World View's cyan.
    boost: selected ? 1.15 : 1,
    rank: PLACE_RANK[p.category] ?? 10,
    merge: true,
    tagAlso: alsoTitles,
  });
}

/** "Not approved · chaperones only" as a place says it. */
export function safetyState(p, draft) {
  const state = [
    draft ? 'Not approved' : '',
    p.chaperone_only ? 'chaperones only' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return state ? state.charAt(0).toUpperCase() + state.slice(1) : '';
}

/** Place order for a shared plate: the selected, then the safety plan. */
export const PLACE_RANK = {
  rally_primary: 0,
  rally_secondary: 1,
  safe_house: 2,
  relocation: 3,
  shelter: 4,
  hospital: 5,
};
/**
 * Places within m metres share one plate: the most important carries it
 * and names the others ("Also here: Fire station"). places: [{id, category,
 * ll, words}]; dist(a, b) in metres. Returns {absorbed: Set id, also: Map
 * hostId → [words]}.
 */
export function sharePlates(places, dist, { m = 40 } = {}) {
  // Importance only: selecting a fire station never puts a rally point on
  // a droppable plate; the selection shows by size (round 2).
  const rank = (p) => PLACE_RANK[p.category] ?? 10;
  const order = [...places].sort((a, b) => rank(a) - rank(b));
  const hosts = [];
  const absorbed = new Set();
  const also = new Map();
  const hostOf = new Map();
  for (const p of order) {
    const host = hosts.find((h) => dist(h.ll, p.ll) <= m);
    if (!host) {
      hosts.push(p);
      continue;
    }
    absorbed.add(p.id);
    hostOf.set(p.id, host.id);
    if (!also.has(host.id)) also.set(host.id, []);
    also.get(host.id).push(p.words);
  }
  return { absorbed, also, hostOf };
}

/** "6 mi lightning watch · SIMULATED (prototype)" → SIMULATED first. */
export function simulatedFirst(t) {
  const s = String(t || '');
  if (!/SIMULATED/.test(s) || /^SIMULATED\b/.test(s)) return s;
  const rest = s
    .replace(/\s*·?\s*SIMULATED\s*/, ' · ')
    .replace(/(\s*·\s*)+$/, '')
    .replace(/\s*·\s*·\s*/g, ' · ')
    .replace(/\s*·\s*\(/g, ' (')
    .trim();
  return `SIMULATED ${rest}`;
}

/**
 * The free part of the map in canvas pixels. safe: the page's covered
 * margins in viewport px ({left, right, top, bottom}); box: the canvas's
 * client rect; view: {w, h} the viewport (walls inset the map, round 1).
 */
export function freeRect(safe, box, view, pad = 4) {
  if (!safe || !box) return null;
  return {
    left: Math.max(0, safe.left - box.left) + pad,
    right: Math.min(box.width, view.w - safe.right - box.left) - pad,
    top: Math.max(0, (safe.top || 0) - box.top),
    bottom: Math.min(box.height, view.h - (safe.bottom || 0) - box.top),
  };
}

/**
 * Which edge a plate is hidden behind, or null: its centre outside the free
 * rect, or 40% of it under a band (a half-hidden plate is tagged too).
 */
export function hiddenSide(r, f) {
  if (!f) return null;
  const area = r.w * r.h || 1;
  const under = {
    left: Math.max(0, Math.min(r.x + r.w, f.left) - r.x) * r.h,
    right: Math.max(0, r.x + r.w - Math.max(r.x, f.right)) * r.h,
    top: Math.max(0, Math.min(r.y + r.h, f.top) - r.y) * r.w,
    bottom: Math.max(0, r.y + r.h - Math.max(r.y, f.bottom)) * r.w,
  };
  const side = Object.keys(under).reduce((a, b) =>
    under[b] > under[a] ? b : a,
  );
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const out = cx < f.left || cx > f.right || cy < f.top || cy > f.bottom;
  return out || under[side] / area >= 0.4 ? side : null;
}

/** How much of a plate (0–1) lies outside the free rect. */
export function hiddenShare(r, f) {
  if (!f) return 0;
  const w = Math.max(0, Math.min(r.x + r.w, f.right) - Math.max(r.x, f.left));
  const h = Math.max(0, Math.min(r.y + r.h, f.bottom) - Math.max(r.y, f.top));
  return 1 - (w * h) / (r.w * r.h || 1);
}

/** Edge tags never overprint: stacked along their edge (round 1). */
export function stackTags(tags, gap = 3, f = null) {
  const out = tags.map((t) => ({ ...t }));
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const along = side === 'left' || side === 'right' ? 'y' : 'x';
    const size = along === 'y' ? 'h' : 'w';
    const row = out
      .filter((t) => t.side === side)
      .sort((a, b) => a[along] - b[along]);
    for (let i = 1; i < row.length; i += 1) {
      const min = row[i - 1][along] + row[i - 1][size] + gap;
      if (row[i][along] < min) row[i][along] = min;
    }
    // Kept inside the free rect: a row that runs off the end moves back.
    const end = f && (along === 'y' ? f.bottom : f.right);
    const start = f ? (along === 'y' ? f.top : f.left) : 0;
    const last = row[row.length - 1];
    if (end != null && last && last[along] + last[size] > end) {
      const back = last[along] + last[size] - end;
      for (const t of row) t[along] = Math.max(start, t[along] - back);
    }
  }
  return out;
}

/**
 * Ruler numbers that may be painted: when numbers overlap (a view from
 * above), the higher rank wins (reported 3, top 2, ground 1); the reported
 * floor is painted last, so nothing covers it (UX P0-1).
 */
export function rulerOrder(items) {
  const overlaps = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const kept = [];
  for (const it of [...items].sort((a, b) => (b.rank || 0) - (a.rank || 0)))
    if (!kept.some((k) => overlaps(k, it))) kept.push(it);
  return kept.sort((a, b) => (a.rank || 0) - (b.rank || 0));
}
