// Sites (phase 3, PHASE-3-PLAN Part A). Every trip place is a site: the hotel
// (TWIN_CITIES, keys kept so fixtures and URLs still work) plus real public
// venues per city. All people are fictional. Anchors are computed once from
// each site's OSM footprint by scripts/capture-trip-twin-osm.mjs
// (computeAnchors below) and pasted here, like the hotels'.
import { TWIN_CITIES } from './twinCities.js';
import { distanceToRing, makeProjector, pointInRing } from './twinData.js';

export const TWIN_VENUES = Object.freeze({
  'austin-long-center': {
    key: 'austin-long-center',
    assemblyToward: 0,
    city: 'austin',
    kind: 'venue',
    role: 'performance',
    osm: 'way/187668220',
    label: 'Long Center for the Performing Arts',
    short: 'Long Center',
    // How a sentence names it (street photos: "towards the Long Center").
    photoName: 'the Long Center',
    center: { lat: 30.26026, lon: -97.75112 },
    groundFloorLabel: 1,
    levels: 2,
    floorHeightM: 6,
    day: 2,
    start: '19:00',
    end: '21:30',
    anchors: {
      inside: { lat: 30.260163, lon: -97.751246 },
      insideClearanceM: 32.6,
      edge: { lat: 30.260663, lon: -97.751185 },
      assembly: { lat: 30.261316, lon: -97.751105 },
    },
  },
  'austin-capitol': {
    key: 'austin-capitol',
    city: 'austin',
    kind: 'venue',
    role: 'visit',
    osm: 'way/25758443',
    label: 'Texas State Capitol',
    short: 'Texas Capitol',
    // How a sentence names it (street photos: "towards the Texas Capitol").
    photoName: 'the Texas Capitol',
    center: { lat: 30.27469, lon: -97.74035 },
    groundFloorLabel: 1,
    levels: 4,
    floorHeightM: 6,
    day: 3,
    start: '10:00',
    end: '12:00',
    anchors: {
      inside: { lat: 30.274659, lon: -97.740347 },
      insideClearanceM: 22.7,
      edge: { lat: 30.274407, lon: -97.740442 },
      assembly: { lat: 30.273795, lon: -97.740672 },
    },
  },
  'dc-kennedy-center': {
    key: 'dc-kennedy-center',
    assemblyToward: 90,
    city: 'dc',
    kind: 'venue',
    role: 'performance',
    osm: 'way/66418634',
    label: 'John F. Kennedy Center for the Performing Arts',
    short: 'Kennedy Center',
    // How a sentence names it (street photos: "towards the Kennedy Center").
    photoName: 'the Kennedy Center',
    center: { lat: 38.8959, lon: -77.05576 },
    groundFloorLabel: 1,
    levels: 4,
    floorHeightM: 7,
    day: 2,
    start: '19:30',
    end: '22:00',
    anchors: {
      inside: { lat: 38.895909, lon: -77.055758 },
      insideClearanceM: 62.4,
      edge: { lat: 38.895909, lon: -77.055111 },
      assembly: { lat: 38.895909, lon: -77.054279 },
    },
  },
  'dc-air-space': {
    key: 'dc-air-space',
    city: 'dc',
    kind: 'venue',
    role: 'visit',
    osm: 'relation/16159112',
    label: 'National Air and Space Museum',
    short: 'Air and Space',
    // How a sentence names it (street photos: "towards the Air and Space Museum").
    photoName: 'the Air and Space Museum',
    center: { lat: 38.88814, lon: -77.01984 },
    groundFloorLabel: 1,
    levels: null, // not mapped: shows the floor-numbering prompt
    floorHeightM: null,
    day: 3,
    start: '10:00',
    end: '13:00',
    anchors: {
      inside: { lat: 38.888141, lon: -77.020202 },
      insideClearanceM: 31.3,
      edge: { lat: 38.888359, lon: -77.020293 },
      assembly: { lat: 38.889005, lon: -77.020562 },
    },
  },
  'london-festival-hall': {
    key: 'london-festival-hall',
    assemblyToward: 160,
    city: 'london',
    kind: 'venue',
    role: 'performance',
    osm: 'way/5987419',
    label: 'Royal Festival Hall',
    short: 'Festival Hall',
    // How a sentence names it (street photos: "towards the Royal Festival Hall").
    photoName: 'the Royal Festival Hall',
    center: { lat: 51.50582, lon: -0.11678 },
    groundFloorLabel: 0,
    levels: 6,
    floorHeightM: 4.5,
    day: 2,
    start: '19:30',
    end: '21:45',
    anchors: {
      inside: { lat: 51.505806, lon: -0.116772 },
      insideClearanceM: 34.9,
      edge: { lat: 51.505566, lon: -0.116424 },
      assembly: { lat: 51.505085, lon: -0.115728 },
    },
  },
  'london-abbey': {
    key: 'london-abbey',
    city: 'london',
    kind: 'venue',
    role: 'visit',
    osm: 'way/364313092',
    label: 'Westminster Abbey',
    short: 'Westminster Abbey',
    // How a sentence names it (street photos: "towards Westminster Abbey").
    photoName: 'Westminster Abbey',
    center: { lat: 51.4994, lon: -0.12739 },
    groundFloorLabel: 0,
    levels: 2,
    floorHeightM: 10,
    day: 3,
    start: '10:00',
    end: '11:30',
    anchors: {
      inside: { lat: 51.49939, lon: -0.127291 },
      insideClearanceM: 21.4,
      edge: { lat: 51.499293, lon: -0.12681 },
      assembly: { lat: 51.499101, lon: -0.125862 },
    },
  },
});

/** The hotel as a site (day 1 = arrival; no event time). */
function hotelSite(city) {
  return {
    ...city,
    city: city.key,
    kind: 'lodging',
    role: 'lodging',
    short: city.label,
    day: null,
    start: null,
    end: null,
  };
}

/** Any site by key: hotel keys are the city keys. */
export function siteConfig(key) {
  if (TWIN_CITIES[key]) return hotelSite(TWIN_CITIES[key]);
  const v = TWIN_VENUES[key];
  if (!v) return null;
  const city = TWIN_CITIES[v.city];
  return { ...v, timezone: city.timezone };
}

/** All sites of a city's trip: hotel first, then venues by day and time. */
export function sitesForCity(cityKey) {
  const hotel = siteConfig(cityKey);
  if (!hotel) return [];
  const venues = Object.values(TWIN_VENUES)
    .filter((v) => v.city === cityKey)
    .map((v) => siteConfig(v.key))
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  return [hotel, ...venues];
}

export const cityOfSite = (key) => siteConfig(key)?.city ?? null;

/** Switcher label: "Long Center (Day 2, 19:00)" / "Fairmont Austin (hotel)". */
export function siteOptionLabel(site) {
  return site.kind === 'lodging'
    ? `${site.label} (hotel)`
    : `${site.short} (Day ${site.day}, ${site.start})`;
}

// --- anchors (offline, by the capture script) ----------------------------------

/**
 * Placement anchors for a footprint, all in lat/lon:
 *  inside   — the deepest point inside the outline (max distance to the wall)
 *  edge     — a point 6–10 m inside the wall, on the side facing `assembly`
 *  assembly — an outdoor point 45–70 m from the wall, not inside any
 *             building, with the most clearance from other buildings.
 * ringLL: [{lat, lon}]; others: [[{lat, lon}]] (other building rings).
 */
export function computeAnchors(ringLL, others = [], { towardDeg = null } = {}) {
  const c = ringLL.reduce(
    (a, p) => ({
      lat: a.lat + p.lat / ringLL.length,
      lon: a.lon + p.lon / ringLL.length,
    }),
    { lat: 0, lon: 0 },
  );
  const proj = makeProjector(c);
  const ring = ringLL.map((p) => proj.toXY(p.lat, p.lon));
  const rings = others.map((r) => r.map((p) => proj.toXY(p.lat, p.lon)));
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const [x0, x1, y0, y1] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  let inside = null;
  const step = Math.max(1, Math.min(x1 - x0, y1 - y0) / 60);
  for (let x = x0; x <= x1; x += step)
    for (let y = y0; y <= y1; y += step) {
      if (!pointInRing([x, y], ring)) continue;
      const d = distanceToRing([x, y], ring);
      if (!inside || d > inside.d) inside = { x, y, d };
    }
  let assembly = null;
  // towardDeg (compass bearing): keep the assembly point on that side (±50°),
  // e.g. away from a river the outline data does not include.
  const allowed = (a) => {
    if (towardDeg === null) return true;
    const bearing = (90 - a + 360) % 360;
    const d = Math.abs(((bearing - towardDeg + 540) % 360) - 180);
    return d <= 50;
  };
  for (let a = 0; a < 360; a += 6)
    for (const r of [45, 55, 65]) {
      if (!allowed(a)) continue;
      // walk outward from the deepest point to r metres beyond the wall
      const ux = Math.cos((a * Math.PI) / 180);
      const uy = Math.sin((a * Math.PI) / 180);
      let t = 0;
      while (pointInRing([inside.x + ux * t, inside.y + uy * t], ring)) t += 1;
      const p = [inside.x + ux * (t + r), inside.y + uy * (t + r)];
      if (pointInRing(p, ring) || rings.some((o) => pointInRing(p, o)))
        continue;
      const clear = Math.min(
        distanceToRing(p, ring),
        ...rings.map((o) => distanceToRing(p, o)),
      );
      if (!assembly || clear > assembly.clear)
        assembly = { p, clear, ux, uy, t };
    }
  let edge = null;
  if (assembly)
    for (let s = assembly.t; s > 0; s -= 0.5) {
      const p = [inside.x + assembly.ux * s, inside.y + assembly.uy * s];
      const d = distanceToRing(p, ring);
      if (pointInRing(p, ring) && d >= 6 && d <= 10) {
        edge = p;
        break;
      }
    }
  const ll = (p) => {
    const q = proj.toLL(p[0], p[1]);
    return { lat: +q.lat.toFixed(6), lon: +q.lon.toFixed(6) };
  };
  return {
    inside: ll([inside.x, inside.y]),
    insideClearanceM: +inside.d.toFixed(1),
    edge: edge ? ll(edge) : ll([inside.x, inside.y]),
    assembly: assembly ? ll(assembly.p) : null,
  };
}

// --- people per site (rail summary; nobody is dropped) ------------------------

export const AT_SITE_M = 150;
export const BETWEEN_M = 200;

function segDistM(p, a, b) {
  const proj = makeProjector(a);
  const [px, py] = proj.toXY(p.lat, p.lon);
  const [bx, by] = proj.toXY(b.lat, b.lon);
  const t = Math.max(
    0,
    Math.min(1, (px * bx + py * by) / (bx * bx + by * by || 1)),
  );
  return Math.hypot(px - t * bx, py - t * by);
}

/**
 * Count participants per site. sites: [{key, short, anchors.inside}] (hotel
 * first). A person is at a site within 150 m of its centre; "between sites"
 * within 200 m of the straight line hotel → venue; otherwise elsewhere.
 * Returns {bySite: [{key, short, n}], between, elsewhere, notLocated, total}.
 */
export function siteCounts(participants, sites) {
  const hotel = sites[0];
  const ll = (s) => ({
    lat: (s.anchors?.inside || s.center).lat,
    lon: (s.anchors?.inside || s.center).lon,
  });
  const bySite = sites.map((s) => ({ key: s.key, short: s.short, n: 0 }));
  let between = 0;
  let elsewhere = 0;
  let notLocated = 0;
  let notCurrent = 0;
  for (const p of participants) {
    const c = p.coordinates;
    if (!c) {
      notLocated += 1;
      continue;
    }
    // Only current fixes count toward a site (review/phase3 G5).
    if (!(p.isFresh || p.presence === 'stopped')) {
      notCurrent += 1;
      continue;
    }
    const pt = { lat: c.lat, lon: c.lng ?? c.lon };
    const proj = makeProjector(pt);
    const d = sites.map((s) => {
      const [x, y] = proj.toXY(ll(s).lat, ll(s).lon);
      return Math.hypot(x, y);
    });
    const i = d.indexOf(Math.min(...d));
    if (d[i] <= AT_SITE_M) bySite[i].n += 1;
    else if (
      sites.slice(1).some((v) => segDistM(pt, ll(hotel), ll(v)) <= BETWEEN_M)
    )
      between += 1;
    else elsewhere += 1;
  }
  return {
    bySite,
    between,
    elsewhere,
    notLocated,
    notCurrent,
    total: participants.length,
  };
}

/** "Group across 2 sites: Long Center 17 · Fairmont Austin 3 · …" */
export function siteCountsLine(c, activeKey) {
  const used = c.bySite.filter((s) => s.n > 0);
  const parts = [...c.bySite]
    .filter((s) => s.n > 0 || s.key === activeKey)
    .sort((a, b) => b.n - a.n)
    .map((s) => `${s.short} ${s.n}`);
  if (c.between) parts.push(`between sites ${c.between}`);
  if (c.elsewhere) parts.push(`elsewhere ${c.elsewhere}`);
  if (c.notCurrent) parts.push(`not current ${c.notCurrent}`);
  if (c.notLocated) parts.push(`not located ${c.notLocated}`);
  const head = used.length > 1 ? `Group across ${used.length} sites` : 'Group';
  return `${head}: ${parts.join(' · ')} · of ${c.total}`;
}
