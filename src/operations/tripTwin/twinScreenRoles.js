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
    textScale: 1.5,
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
    scale: 'city',
  },
  incident: {
    key: 'incident',
    textScale: 2,
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
    textScale: 2,
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
      { key: 'fires', label: 'Satellite heat detections', def: true },
      { key: 'lightning', label: 'Lightning', def: false },
      { key: 'precip', label: 'Rain & snow map', def: false },
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
