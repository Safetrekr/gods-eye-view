// SOC multi-view (phase 10): the six wall-screen roles, their defaults for
// 1–6 screens, and what a wall may show (plans/trip-twin/SOC-MULTIVIEW.md).
// Pure: shared by the screens, the remote and the session host.

/** Roles in order of importance: with N screens the first N are used. */
export const ROLE_ORDER = Object.freeze([
  'site',
  'travelers',
  'incident',
  'weather',
  'day',
  'trips',
]);

export const ROLES = Object.freeze({
  site: {
    key: 'site',
    textScale: 1.75,
    label: 'Site',
    kicker: 'SITE',
    sub: '3D site picture',
    canvas: true,
    scale: 'neighborhood',
  },
  travelers: {
    key: 'travelers',
    textScale: 1.75,
    label: 'People',
    kicker: 'PEOPLE',
    sub: 'Where everyone is now',
    canvas: true,
    scale: 'neighborhood',
  },
  incident: {
    key: 'incident',
    textScale: 1.75,
    label: 'Incident & attention',
    kicker: 'INCIDENT & ATTENTION',
    sub: 'Needs attention · incident board',
    canvas: false,
  },
  weather: {
    key: 'weather',
    textScale: 1.75,
    label: 'Weather & alerts',
    kicker: 'WEATHER & ALERTS',
    sub: 'Official alerts · sensed hazards',
    canvas: true,
    scale: 'city',
    // Seen from across the room (review R7): the weather and heat layers.
    layersOn: ['precip', 'clouds', 'lightning', 'radar3d', 'fires'],
  },
  day: {
    key: 'day',
    textScale: 1.75,
    label: 'Day plan',
    kicker: 'DAY PLAN',
    sub: 'Schedule · places · paths',
    canvas: true,
    scale: 'city',
  },
  trips: {
    key: 'trips',
    textScale: 1.75,
    label: 'Trips on watch',
    kicker: 'TRIPS ON WATCH',
    sub: 'Every active trip',
    canvas: false,
  },
});

/**
 * Default role per slot for N screens (1–6). Small counts merge: one screen
 * is the site with today's panels (≈ All in one); two add the attention
 * column to Travelers.
 */
export function defaultRoles(n) {
  const count = Math.max(1, Math.min(6, Math.round(Number(n) || 1)));
  return ROLE_ORDER.slice(0, count).map((role, i) => ({
    slot: i + 1,
    role,
    merged:
      count === 1 && role === 'site'
        ? ['travelers', 'incident']
        : count === 2 && role === 'travelers'
          ? ['incident']
          : [],
  }));
}

/**
 * A traveler's name on a wall. Private SOC: first name + last initial;
 * visitor mode: initials only (Jesse, 16 Oct 2026).
 */
export function wallName(name = '', { visitor = false } = {}) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (visitor) return parts.map((p) => p[0].toUpperCase()).join('');
  return parts.length > 1
    ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
    : parts[0];
}

/** Content that never goes on a wall, whatever the role or mode. */
export const NEVER_ON_WALL = Object.freeze([
  'medical',
  'guardians',
  'contacts',
  'responderText',
  'trails',
]);

/** Short status text for a screen card on the remote. */
export function screenSummary(slot, screen = {}, link = {}) {
  const r = ROLES[screen.role] || ROLES.site;
  const age = Number.isFinite(link.ageS)
    ? link.ageS < 60
      ? `${Math.round(link.ageS)} s`
      : `${Math.round(link.ageS / 60)} min`
    : '';
  return [
    `S${slot}`,
    r.kicker,
    screen.pinned ? 'PINNED' : null,
    link.online === false
      ? `offline${age ? ` ${age}` : ''}`
      : age
        ? `✓ ${age}`
        : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Layers the remote can set per screen (every setting lives on the remote;
 * walls are display only). def = the twin's own default. People, reported
 * incidents and the hotel are always shown and not listed.
 */
export const LAYER_CATALOG = Object.freeze([
  {
    group: 'People',
    layers: [{ key: 'floors', label: 'Floor estimates', def: true }],
  },
  {
    group: 'Hazards',
    layers: [
      { key: 'radar3d', label: 'Storm shells (3D)', def: false },
      { key: 'alertAreas', label: 'Official alert areas', def: true },
      { key: 'fires', label: 'Satellite heat detections', def: true },
      { key: 'lightning', label: 'Lightning', def: false },
      { key: 'precip', label: 'Rain map (flat)', def: false },
      { key: 'clouds', label: 'Clouds & haze (3D)', def: false },
      { key: 'fx', label: 'Rain & snow at the site (3D)', def: false },
      { key: 'totals', label: 'Rain & snow totals, 24 h', def: false },
    ],
  },
  {
    group: 'Safety',
    layers: [{ key: 'safety', label: 'Safety resources', def: true }],
  },
  {
    group: 'Paths',
    layers: [
      { key: 'paths', label: 'Suggested paths', def: true },
      { key: 'savedPaths', label: 'Saved paths', def: true },
      { key: 'avoidAreas', label: 'Avoid-areas', def: true },
    ],
  },
  {
    group: 'Site',
    layers: [
      { key: 'buildings', label: 'Surrounding buildings', def: true },
      { key: 'streets', label: 'Streets', def: false },
      { key: 'walkways', label: 'Walkways, steps & entrances', def: false },
      { key: 'context', label: 'Wider area', def: true },
      { key: 'corridors', label: 'Toward venues & hospital', def: true },
      { key: 'grid', label: 'Scale grid', def: true },
      { key: 'elevation', label: 'Elevation contours', def: false },
    ],
  },
  {
    group: 'Views',
    layers: [{ key: 'waysOut', label: 'Ways out view', def: false }],
  },
]);

/**
 * What a layer shows on one screen: the session's value, else the role's
 * default, else the twin's own (the wall's L sheet and the remote agree).
 */
export function layerValue(screen = {}, key) {
  if (screen.layers && key in screen.layers) return Boolean(screen.layers[key]);
  if (ROLES[screen.role]?.layersOn?.includes(key)) return true;
  for (const g of LAYER_CATALOG)
    for (const L of g.layers) if (L.key === key) return L.def;
  return false;
}

/**
 * The cards each role shows in its left column, which a wall's Layout may
 * hide one by one (screens/05-S1-PLAN §13). lock: never hidden — the
 * summary, needs attention and the incident board carry the safety story.
 */
export const CARD_CATALOG = Object.freeze({
  site: [{ key: 'hotel', label: 'Group hotel · floors' }],
  travelers: [
    { key: 'summary', label: 'Summary', lock: true },
    // Locked too (70-S2-FIX-LIST G15): a People wall without its counts
    // makes no sense, and no control offers hiding it.
    { key: 'people', label: 'People', lock: true },
    { key: 'attention', label: 'Needs attention', lock: true },
  ],
  incident: [
    { key: 'attention', label: 'Needs attention', lock: true },
    { key: 'board', label: 'Incident board', lock: true },
  ],
  weather: [
    { key: 'weather', label: 'Weather & alerts', lock: true },
    { key: 'timeline', label: 'Timeline' },
  ],
  day: [
    { key: 'brief', label: 'Site brief' },
    { key: 'schedule', label: 'Schedule' },
  ],
  trips: [{ key: 'trips', label: 'Trips on watch', lock: true }],
});

/** Layout values a wall may hold (the relay rebuilds `layout` from these). */
export const LAYOUT_CARDS = Object.freeze(['shown', 'map']);
export const LAYOUT_WIDTHS = Object.freeze(['standard', 'wide']);

/**
 * A screen's layout with every default filled in: {cards, width, off}.
 * cards 'map' = map only (the left column steps away); off = hidden card
 * keys of this role, locked cards never among them.
 */
export function layoutValue(screen = {}) {
  const l = screen.layout || {};
  const keys = new Set(
    (CARD_CATALOG[screen.role] || []).filter((c) => !c.lock).map((c) => c.key),
  );
  // Map only needs a map: a board wall's cards are always shown.
  const map = ROLES[screen.role]?.canvas !== false;
  return {
    cards: map && LAYOUT_CARDS.includes(l.cards) ? l.cards : 'shown',
    width: LAYOUT_WIDTHS.includes(l.width) ? l.width : 'standard',
    off: Array.isArray(l.off) ? l.off.filter((k) => keys.has(k)) : [],
  };
}

/** True when a screen's layout differs from its role's default. */
export function layoutChanged(screen = {}) {
  const v = layoutValue(screen);
  return v.cards !== 'shown' || v.width !== 'standard' || v.off.length > 0;
}

/**
 * Layers a wall cannot turn off while a report is open (screens/03-spec-aia
 * §3); while any is off the map bar says so. Floors count on the Site wall.
 */
export const SAFETY_LAYERS = Object.freeze([
  'alertAreas',
  'fires',
  'safety',
  'avoidAreas',
  'floors',
]);

/**
 * Roles already in the new wall frame (screens/05-S1-PLAN, 55-S2-PLAN):
 * their layout options do something. One role at a time (Jesse): S1 Site,
 * S2 People. A wall carrying more than one role (one or two screens)
 * converts with them: a second card column (55-S2-PLAN §2).
 */
export const WALL_LAYOUT_ROLES = new Set(['site', 'travelers', 'incident']);
export const wallShellOn = (screen = {}) => WALL_LAYOUT_ROLES.has(screen.role);

/**
 * Text size on a wall (screens/20-S1-FIX-LIST F12): inside this range the
 * type rule holds (Manrope ≥ 26 px, Inter ≤ 28 px after the wall scale).
 */
export const WALL_TEXT_MIN = 1.5;
export const WALL_TEXT_MAX = 2.25;
