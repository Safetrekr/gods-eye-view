// SafeTrekr Executive: the per-leg match (EP-35 §3). Pure: a bundle, the
// legs, the people and an instant in; hits, the primary match, banners and
// the mechanical not-raised reason out. The geometry is the intake
// generators' own (local equirectangular metres, haversine for points), so
// the engine reproduces every fixture match.
//
// Refinements the intake authors applied and EP-35 §3 leaves open, kept
// here so the fixtures and the engine agree (intel-notes, mentions-notes):
// - a spatial hit whose window opens within 6 h is a match ("opens in N h");
// - an item observed more than 4 h before ingest is stale, never a match;
// - a region item never matches; it is a banner for a leg whose city lies
//   inside and whose window is live within 12 h;
// - a mention matches only for a roster subject, a claimed place or leg,
//   and a class that can hurt (threat, veiled threat, doxx, travel-plan
//   leak, self-exposure); distance reads "named";
// - a bundle linked to a situation by subject or `related_to` is never a
//   match (EP-41: the agenda leak, the road closure, the bus detour);
// - radii are the roster's (`leg.radius_m`, flight 5 km at each airport),
//   which EP-35's 3 km for airports does not override.

export const OPENS_WITHIN_H = 6;
export const STALE_AFTER_H = 4;
export const BANNER_WITHIN_H = 12;
export const HAZARD_REACH_M = 50_000;
/** A place reached when two fixes fall inside it (EP-37 §4). */
export const WHERE_RADIUS_M = 50;
export const MENTION_CLASSES = Object.freeze([
  'threat',
  'veiled threat',
  'doxx',
  'travel-plan leak',
  'self-exposure',
]);

const H = 3600e3;
const R_EARTH = 6_371_000;
const rad = (d) => (d * Math.PI) / 180;
const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));

export function haversine(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const a =
    Math.sin((p2 - p1) / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const dl = rad(lon2 - lon1);
  const x = Math.sin(dl) * Math.cos(p2);
  const y =
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (b) => COMPASS[Math.round(b / 45) % 8];

const toXY = (lat, lon, lat0, lon0) => [
  (lon - lon0) * 111320 * Math.cos(rad(lat0)),
  (lat - lat0) * 110574,
];
function segNearest(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return [ax, ay];
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)),
  );
  return [ax + t * dx, ay + t * dy];
}
function inRing(px, py, ring) {
  let inside = false;
  for (let i = 0, n = ring.length; i < n; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    if (y1 > py !== y2 > py && px < x1 + ((py - y1) * (x2 - x1)) / (y2 - y1))
      inside = !inside;
  }
  return inside;
}
const back = (lat, lon, [nx, ny]) => [
  lat + ny / 110574,
  lon + nx / (111320 * Math.cos(rad(lat))),
];

/** Metres from a point to a polygon edge (0 inside); ring is [[lat, lon]]. */
export function distToPolygon(lat, lon, ring) {
  const xy = ring.map(([la, lo]) => toXY(la, lo, lat, lon));
  if (inRing(0, 0, xy)) return { d: 0, at: [lat, lon] };
  let best = null;
  for (let i = 0; i < xy.length; i += 1) {
    const n = segNearest(0, 0, ...xy[i], ...xy[(i + 1) % xy.length]);
    const d = Math.hypot(n[0], n[1]);
    if (!best || d < best.d) best = { d, at: back(lat, lon, n) };
  }
  return best;
}

/** Metres from a point to a polyline of [[lat, lon]]. */
export function distToPolyline(lat, lon, pts) {
  let best = null;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = toXY(pts[i][0], pts[i][1], lat, lon);
    const b = toXY(pts[i + 1][0], pts[i + 1][1], lat, lon);
    const n = segNearest(0, 0, ...a, ...b);
    const d = Math.hypot(n[0], n[1]);
    if (!best || d < best.d) best = { d, at: back(lat, lon, n) };
  }
  return best;
}

/** EP-35 §3 windows per leg kind. */
export function legWindow(leg) {
  const s = ms(leg.start);
  const e = ms(leg.end);
  switch (leg.kind) {
    case 'hotel':
    case 'private':
      return [s - 2 * H, e];
    case 'meeting':
      return [s - 3 * H, e + H];
    case 'ground':
      return [s - H, e + 30 * 60e3];
    case 'flight': {
      const w = (leg.window_min ?? 120) * 60e3;
      return [s - w, e + w];
    }
    default:
      return [s, e];
  }
}

/** Reach per leg: hazard 50 km, ground its corridor, else the leg radius
 * widened by the person's watch radius after a re-tier (EP-37 §6). */
export function legRadius(leg, hazard, person = null) {
  if (hazard) return HAZARD_REACH_M;
  if (leg.kind === 'ground') return leg.corridor_m || 500;
  return Math.max(leg.radius_m || 0, person?.radius_m || 0);
}

function legDistance(leg, b) {
  const ring = b.geo?.polygon;
  const o = leg.origin;
  const t = leg.destination;
  if (ring) {
    const from =
      leg.kind === 'ground' && o && t
        ? [o, t, leg.place]
        : leg.kind === 'flight' && o && t
          ? [o, t]
          : [leg.place];
    let best = null;
    for (const p of from) {
      const r = distToPolygon(p.lat, p.lon, ring);
      if (!best || r.d < best.d)
        best = { d: r.d, b: bearingDeg(p.lat, p.lon, ...r.at) };
    }
    return best;
  }
  const { lat, lon } = b.geo;
  if (leg.kind === 'ground' && o && t) {
    const r = distToPolyline(lat, lon, [
      [o.lat, o.lon],
      [t.lat, t.lon],
    ]);
    return { d: r.d, b: bearingDeg(...r.at, lat, lon) };
  }
  if (leg.kind === 'flight' && o && t) {
    let best = null;
    for (const p of [o, t]) {
      const d = haversine(p.lat, p.lon, lat, lon);
      if (!best || d < best.d)
        best = { d, b: bearingDeg(p.lat, p.lon, lat, lon) };
    }
    return best;
  }
  return {
    d: haversine(leg.place.lat, leg.place.lon, lat, lon),
    b: bearingDeg(leg.place.lat, leg.place.lon, lat, lon),
  };
}

function windowFor(leg, t) {
  const [ws, we] = legWindow(leg);
  if (t >= ws && t <= we) return { window: 'in window', opensH: 0 };
  if (t < ws) {
    const opensH = (ws - t) / H;
    return { window: `opens in ${Math.ceil(opensH - 1e-9)} h`, opensH };
  }
  return { window: 'closed', opensH: null };
}

const KIND_RANK = { ground: 0, meeting: 1, private: 2, flight: 3, hotel: 4 };

/** The callsign a hit is shown under (a two-person crew reads `SWIFT 1–2`). */
export function legCallsign(leg, people) {
  const own = people[leg.person_id]?.callsign || leg.person_id;
  const m = /^(.*\S) (\d+)$/.exec(own);
  if (!m) return own;
  const crew = (leg.participants || [leg.person_id])
    .map((p) => people[p]?.callsign)
    .filter((c) => c && c.startsWith(`${m[1]} `));
  if (crew.length < 2) return own;
  const n = crew
    .map((c) => Number(c.slice(m[1].length + 1)))
    .sort((a, b) => a - b);
  return `${m[1]} ${n[0]}–${n[n.length - 1]}`;
}

function hitFor(leg, people, t, extra) {
  const { window, opensH } = windowFor(leg, t);
  return {
    leg_id: leg.id,
    person_id: leg.person_id,
    callsign: legCallsign(leg, people),
    kind: leg.kind,
    briefed: Boolean(leg.briefed),
    window,
    time_to_exposure_s: Math.max(0, Math.round((ms(leg.start) - t) / 1000)),
    within:
      window === 'in window' || (opensH != null && opensH <= OPENS_WITHIN_H),
    ...extra,
  };
}

const legsOf = (legs, personId) =>
  Object.values(legs).filter(
    (l) =>
      l.person_id === personId || (l.participants || []).includes(personId),
  );

function mentionHits(b, legs, people, t) {
  if (!MENTION_CLASSES.includes(b.mention_class)) return [];
  if (!b.claimed?.place_id && !b.claimed?.leg_id && !b.claimed?.time_text)
    return [];
  const hits = [];
  for (const s of b.subjects || []) {
    if (!people[s.person_id]) continue;
    const own = legsOf(legs, s.person_id).sort(
      (x, y) => ms(x.start) - ms(y.start),
    );
    const leg =
      own.find((l) => l.id === b.claimed?.leg_id) ||
      own.find(
        (l) =>
          b.claimed?.place_id &&
          l.place?.place_id === b.claimed.place_id &&
          legWindow(l)[1] >= t,
      ) ||
      own.find((l) => legWindow(l)[1] >= t);
    if (leg)
      hits.push(
        hitFor(leg, people, t, {
          distance_m: null,
          distance: 'named',
          bearing: null,
          named: true,
          radius_m: null,
        }),
      );
  }
  return hits;
}

function spatialHits(b, legs, people, t) {
  const hazard = Boolean(b.hazard_area);
  const acc = b.accuracy_m ?? b.geo?.accuracy_m ?? 0;
  const hits = [];
  for (const leg of Object.values(legs)) {
    if (!leg.place) continue;
    const r = legRadius(leg, hazard, people[leg.person_id]);
    const { d, b: brg } = legDistance(leg, b);
    if (Math.max(0, d - acc) > r) continue;
    hits.push(
      hitFor(leg, people, t, {
        distance_m: Math.round(d),
        bearing: compass(brg),
        hazard,
        radius_m: r,
      }),
    );
  }
  return hits;
}

/**
 * matchLegs(bundle, legs, people, simNow) → {hits, match, banner, reason}.
 * match: the primary within-window hit (in window first, briefed first,
 * earliest exposure, then kind) or null; banner: cities or null; reason:
 * the mechanical not-raised reason when there is no match.
 */
export function matchLegs(bundle, legs, people, simNow) {
  const t = ms(simNow);
  const out = { hits: [], match: null, banner: null, reason: null };
  if (bundle.related_to) {
    out.reason = 'linked';
    return out;
  }
  if (bundle.geo_precision === 'region' || bundle.geo?.precision === 'region') {
    const cities = new Set(bundle.region_cities || []);
    const banner = [];
    for (const leg of Object.values(legs)) {
      const [ws, we] = legWindow(leg);
      if (
        leg.city &&
        cities.has(leg.city) &&
        ws - BANNER_WITHIN_H * H <= t &&
        t <= we
      )
        if (!banner.includes(leg.city)) banner.push(leg.city);
    }
    if (banner.length) {
      out.banner = banner;
      out.reason = 'region, banner only';
    } else out.reason = 'no leg within reach';
    return out;
  }
  const named = bundle.source_kind === 'mention' && !bundle.geo;
  if (!named && !bundle.geo) {
    out.reason = 'no leg within reach';
    return out;
  }
  const ageH = (ms(bundle.ingested_at) - ms(bundle.sent_at)) / H;
  if (!named && ageH > STALE_AFTER_H) {
    out.reason = `stale, observed ${Math.round(ageH)} h ago`;
    return out;
  }
  out.hits = named
    ? mentionHits(bundle, legs, people, t)
    : spatialHits(bundle, legs, people, t);
  const within = out.hits
    .filter((h) => h.within)
    .sort(
      (a, b) =>
        (a.window !== 'in window') - (b.window !== 'in window') ||
        !a.briefed - !b.briefed ||
        a.time_to_exposure_s - b.time_to_exposure_s ||
        KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
        (a.leg_id < b.leg_id ? -1 : 1),
    );
  if (within.length) out.match = within[0];
  else out.reason = out.hits.length ? 'outside window' : 'no leg within reach';
  return out;
}

/** A fix from a moving or stopped vehicle does not put a person at a place. */
export const IN_VEHICLE = Object.freeze(['moving', 'stopped']);

/** Is a fix inside a place (`where`), on foot? */
export function insideWhere(fix, where, radiusM = WHERE_RADIUS_M) {
  if (!fix || !where || IN_VEHICLE.includes(fix.activity)) return false;
  return haversine(fix.lat, fix.lon, where.lat, where.lon) <= radiusM;
}

/**
 * The instant of the second consecutive on-foot fix inside `where`, or
 * null (EP-37 §4; movement-notes: the car's drop fix does not count).
 */
export function doneByPosition(fixes, where, radiusM = WHERE_RADIUS_M) {
  let run = 0;
  for (const f of fixes) {
    run = insideWhere(f, where, radiusM) ? run + 1 : 0;
    if (run >= 2) return f.at;
  }
  return null;
}
