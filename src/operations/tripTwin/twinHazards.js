// Fire boundaries (NIFC) and hurricanes & tropical storms (NHC) near a trip
// (review/hazards H5-PLAN). Pure: no Cesium, no fetch. Every surface takes
// its words from here so the walls, the All-in-one and the remote agree.
// Rows are upstream's normalised shapes: /api/fire-perimeters rows
// (src/layers/perimeters/records.js) and /api/cyclones storms
// (src/layers/cyclones/source.js).
import {
  bearingLabel,
  distanceToRing,
  formatAge,
  formatDistance,
  formatRadius,
  getDistanceUnit,
  haversineM,
  makeProjector,
  pointInRing,
} from './twinData.js';

/** Fire rules (H5): distances in metres, measured to the boundary edge. */
export const FIRE_RULES = Object.freeze({
  // Boundaries are generalised to about 100 m: twice that counts as inside.
  insideEdgeM: 200,
  nearM: 5000,
  upwindM: 25000,
  upwindMinKmh: 15,
  areaM: 50000,
  // Active fires are usually re-mapped about daily.
  mayHaveGrownMs: 24 * 3600e3,
  // A heat detection this close to a boundary belongs to that fire.
  attributeM: 1000,
  // People this close to a boundary join Needs attention.
  peopleNearM: 1000,
  // Paths this close to a boundary are flagged.
  pathNearM: 1000,
});

/** Tropical rules (H5). The feed has no wind radii. */
export const TROPICAL_RULES = Object.freeze({
  tsKt: 34,
  nearM: 300000,
  watchM: 1000000,
});

/** Feed ages past which a line says it may be out of date. */
export const HAZARD_STALE = Object.freeze({
  fireMs: 30 * 60e3,
  advisoryMs: 7 * 3600e3,
});

export const LEVEL_RANK = Object.freeze({
  inside: 3,
  near: 2,
  cone: 2,
  area: 1,
  watch: 1,
  none: 0,
});
/** Levels that are amber, never fold, and keep their layer on at a wall. */
export const isCheckLevel = (level) =>
  level === 'inside' || level === 'near' || level === 'cone';

/** NHC classification codes by their published meanings. */
const CLASSIFICATION = Object.freeze({
  HU: 'Hurricane',
  MH: 'Major Hurricane',
  TY: 'Typhoon',
  TS: 'Tropical Storm',
  TD: 'Tropical Depression',
  STS: 'Subtropical Storm',
  STD: 'Subtropical Depression',
  PTC: 'Potential Tropical Cyclone',
  PT: 'Post-Tropical Cyclone',
});
export const stormTitle = (storm) =>
  `${CLASSIFICATION[storm?.classification] || 'Tropical Cyclone'} ${storm?.name || ''}`.trim();

const BASINS = Object.freeze({
  AL: 'Atlantic',
  EP: 'E Pacific',
  CP: 'C Pacific',
});

const ll = (p) => ({
  lat: p.lat ?? p.latitude,
  lon: p.lon ?? p.lng ?? p.longitude,
});
const valid = (p) =>
  p && Number.isFinite(ll(p).lat) && Number.isFinite(ll(p).lon);

// ---- Coverage --------------------------------------------------------------

const box = (s, n, w, e) => (p) =>
  p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e;
// Coarse on purpose: NIFC itself is the authority, and every fire line says
// "US fires only" so a trip near a border is never told more than the feed knows.
const US_BOXES = [
  box(24.4, 49.4, -125, -66.9),
  box(51, 71.6, -170, -129.9),
  box(18.8, 22.4, -160.4, -154.6),
];
// NHC (AL, EP) and CPHC (CP) forecast areas.
const NHC_BOXES = [
  box(0, 45, -100, -30),
  box(0, 40, -140, -77),
  box(0, 40, -180, -140),
];

/** What the feeds cover at a point: {fire, tropical}. */
export function hazardCoverage(center) {
  if (!valid(center)) return { fire: false, tropical: false };
  const p = ll(center);
  return {
    fire: US_BOXES.some((b) => b(p)),
    tropical: NHC_BOXES.some((b) => b(p)),
  };
}

// ---- Feed state ------------------------------------------------------------

/**
 * live | stale | unavailable | loading. `feed` = {status:'ok'|'error'|null,
 * hasData (a good snapshot is held), stale (the proxy says so),
 * ageAtReceiveMs (the data's age when it arrived), receivedAt (this
 * window's clock)}.
 * Ages come from the feed's fetchedAt against the window's receive time.
 */
export function hazardFeedState(feed, now, staleMs) {
  if (!feed || feed.status == null) return 'loading';
  if (feed.status === 'error' && !feed.hasData) return 'unavailable';
  const age = hazardAge(feed, now);
  if (feed.status === 'error' || feed.stale || age > staleMs) return 'stale';
  return 'live';
}
/** Milliseconds since the feed fetched its data, by the window's own clock. */
export function hazardAge(feed, now) {
  if (!feed) return Infinity;
  const at = Number.isFinite(feed.ageAtReceiveMs) ? feed.ageAtReceiveMs : 0;
  return at + Math.max(0, now - (feed.receivedAt ?? now));
}

// ---- Geometry --------------------------------------------------------------

/** Polygons [[ring...]...] in [lon, lat] → metres around `origin`. */
function projectPolygons(polygons, proj) {
  return polygons.map((rings) =>
    rings.map((ring) => ring.map(([lon, lat]) => proj.toXY(lat, lon))),
  );
}
const insidePolygon = (pt, rings) => {
  // Even-odd across the outer ring and its holes.
  let inside = false;
  for (const ring of rings) if (pointInRing(pt, ring)) inside = !inside;
  return inside;
};

/** 0 inside; otherwise metres from `point` to the nearest boundary edge. */
export function distanceToPolygonsM(point, polygons) {
  if (!valid(point) || !polygons?.length) return Infinity;
  const p = ll(point);
  const proj = makeProjector(p);
  let best = Infinity;
  for (const rings of projectPolygons(polygons, proj)) {
    if (insidePolygon([0, 0], rings)) return 0;
    for (const ring of rings)
      best = Math.min(best, distanceToRing([0, 0], ring));
  }
  return best;
}

/** True when a point lies inside one of the polygons (holes respected). */
export function pointInPolygons(point, polygons) {
  return distanceToPolygonsM(point, polygons) === 0;
}

/** The boundary vertex nearest `point`, for a bearing. */
function nearestVertex(point, polygons) {
  const p = ll(point);
  let best = null;
  let bestD = Infinity;
  for (const rings of polygons)
    for (const ring of rings)
      for (const [lon, lat] of ring) {
        const d =
          (lat - p.lat) ** 2 +
          ((lon - p.lon) * Math.cos(p.lat * 0.0174533)) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { lat, lon };
        }
      }
  return best;
}

/** Shortest distance from a point to an open polyline (metres). */
function distanceToPolyline([x, y], pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

const segmentsCross = (a, b, c, d) => {
  const o = (p, q, r) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
};

/**
 * Path [[lon, lat]...] against fire polygons: 'crosses' when a vertex is
 * inside or a segment cuts an edge (a path can cross with no vertex inside),
 * 'near' within `nearM`, else null.
 */
export function pathAgainstBoundary(
  coords,
  polygons,
  nearM = FIRE_RULES.pathNearM,
) {
  if (!coords?.length || !polygons?.length) return null;
  const origin = { lat: coords[0][1], lon: coords[0][0] };
  const proj = makeProjector(origin);
  const pts = coords.map(([lon, lat]) => proj.toXY(lat, lon));
  const polys = projectPolygons(polygons, proj);
  for (const rings of polys) {
    if (pts.some((pt) => insidePolygon(pt, rings))) return 'crosses';
    for (const ring of rings)
      for (let i = 1; i < pts.length; i++)
        for (let k = 0, j = ring.length - 1; k < ring.length; j = k++)
          if (segmentsCross(pts[i - 1], pts[i], ring[j], ring[k]))
            return 'crosses';
  }
  let best = Infinity;
  for (const rings of polys)
    for (const ring of rings)
      for (const pt of pts) best = Math.min(best, distanceToRing(pt, ring));
  // A straight path can pass a boundary corner between its own points.
  if (pts.length > 1)
    for (const rings of polys)
      for (const ring of rings)
        for (const v of ring) best = Math.min(best, distanceToPolyline(v, pts));
  return best <= nearM ? 'near' : null;
}

/**
 * A path ([{lat, lon}]) against fire boundary rows (X1): the worst hit,
 * {kind: 'crosses'|'near', row} or null. Feeds path cards and saved paths.
 */
export function pathFireHit(geometry, rows) {
  if (!geometry?.length || !rows?.length) return null;
  const coords = geometry.map((p) => [p.lon ?? p.lng, p.lat]);
  let near = null;
  for (const row of rows) {
    if (!row?.polygons?.length) continue;
    const k = pathAgainstBoundary(coords, row.polygons);
    if (k === 'crosses') return { kind: k, row };
    if (k === 'near' && !near) near = { kind: k, row };
  }
  return near;
}
/** Words for a path's fire hit: one wording on every path surface. */
export function pathFireText(hit) {
  if (!hit) return null;
  const s = hit.row.simulated ? 'SIMULATED ' : '';
  const src = hit.row.simulated ? 'demo' : 'NIFC';
  return hit.kind === 'crosses'
    ? `Crosses the ${s}${fireName(hit.row)} boundary (${src}) — plan your own way around it`
    : `Within ${formatRadius(FIRE_RULES.pathNearM)} of the ${s}${fireName(hit.row)} boundary (${src}) — check before use`;
}

/** A fire's bounding box in degrees, to skip far fires cheaply. */
function bboxOf(row) {
  if (row._bbox) return row._bbox;
  let s = 90;
  let n = -90;
  let w = 180;
  let e = -180;
  for (const rings of row.polygons || [])
    for (const [lon, lat] of rings[0] || []) {
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      if (lon < w) w = lon;
      if (lon > e) e = lon;
    }
  Object.defineProperty(row, '_bbox', { value: { s, n, w, e } });
  return row._bbox;
}
/** Lower bound on the distance from `p` to the box (metres). */
function bboxDistanceM(p, b) {
  const lat = Math.min(Math.max(p.lat, b.s), b.n);
  const lon = Math.min(Math.max(p.lon, b.w), b.e);
  return haversineM(p, { lat, lon });
}

// ---- Fires -----------------------------------------------------------------

const angleGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
export function bearingDeg(from, to) {
  const R = Math.PI / 180;
  const y = Math.sin((to.lon - from.lon) * R) * Math.cos(to.lat * R);
  const x =
    Math.cos(from.lat * R) * Math.sin(to.lat * R) -
    Math.sin(from.lat * R) *
      Math.cos(to.lat * R) *
      Math.cos((to.lon - from.lon) * R);
  return (Math.atan2(y, x) / R + 360) % 360;
}

/**
 * Assess every fire against the trip. ctx = {center, stops:[{label, lat,
 * lon}], people:[{id, name, lat, lon}], windFromDeg, windKmh}. Returns the
 * fires within FIRE_RULES.areaM of the hotel, a stop or a person, worst first.
 */
export function assessFires(rows, ctx, now = Date.now()) {
  const center = ll(ctx.center);
  const stops = (ctx.stops || []).filter(valid);
  const people = (ctx.people || []).filter(valid);
  const out = [];
  for (const row of rows || []) {
    if (!row?.polygons?.length) continue;
    const b = bboxOf(row);
    const targets = [center, ...stops.map(ll), ...people.map(ll)];
    if (targets.every((t) => bboxDistanceM(t, b) > FIRE_RULES.areaM)) continue;
    const dHotel = distanceToPolygonsM(center, row.polygons);
    const stopHits = stops
      .map((s) => ({ stop: s, d: distanceToPolygonsM(s, row.polygons) }))
      .filter((h) => h.d <= FIRE_RULES.areaM);
    const peopleIn = [];
    const peopleNear = [];
    for (const person of people) {
      const d = distanceToPolygonsM(person, row.polygons);
      if (d <= FIRE_RULES.insideEdgeM) peopleIn.push(person.id);
      else if (d <= FIRE_RULES.peopleNearM) peopleNear.push(person.id);
    }
    const dMin = Math.min(dHotel, ...stopHits.map((h) => h.d));
    if (dMin > FIRE_RULES.areaM && !peopleIn.length && !peopleNear.length)
      continue;
    const vertex = dHotel > 0 ? nearestVertex(center, row.polygons) : null;
    const bearing = vertex ? bearingDeg(center, vertex) : null;
    const windKnown =
      Number.isFinite(ctx.windFromDeg) && Number.isFinite(ctx.windKmh);
    const upwind =
      bearing === null || !windKnown
        ? null
        : ctx.windKmh >= FIRE_RULES.upwindMinKmh &&
          angleGap(bearing, ctx.windFromDeg) <= 45 &&
          dHotel <= FIRE_RULES.upwindM;
    const hotelInside = dHotel <= FIRE_RULES.insideEdgeM;
    const stopInside = stopHits.filter((h) => h.d <= FIRE_RULES.insideEdgeM);
    let level = 'area';
    if (hotelInside || stopInside.length || peopleIn.length) level = 'inside';
    // A person within 1 km makes a fire near wherever the hotel is (X3).
    else if (dMin <= FIRE_RULES.nearM || upwind || peopleNear.length)
      level = 'near';
    const capped =
      level === 'near' &&
      !peopleNear.length &&
      (row.category === 'RX' || Number(row.containedPct) >= 100);
    if (capped) level = 'area';
    // The line measures from what made the fire matter: a nearer stop is
    // named, not only the hotel (X34).
    const nearStop = stopHits.sort((a, b2) => a.d - b2.d)[0] || null;
    const anchor =
      nearStop && nearStop.d < dHotel
        ? {
            label: nearStop.stop.label,
            d: nearStop.d,
            bearing: (() => {
              const v = nearestVertex(nearStop.stop, row.polygons);
              return v ? bearingLabel(ll(nearStop.stop), v) : null;
            })(),
          }
        : null;
    const updated = Number.isFinite(row.updatedTime) ? row.updatedTime : null;
    out.push({
      row,
      level,
      dHotel,
      dMin,
      bearing: vertex ? bearingLabel(center, vertex) : null,
      bearingDeg: bearing,
      upwind,
      hotelInside,
      hotelAtEdge: hotelInside && dHotel > 0,
      stopsInside: stopInside.map((h) => h.stop),
      nearestStop: nearStop,
      anchor,
      peopleIn,
      peopleNear,
      mappedAgoMs: updated === null ? null : Math.max(0, now - updated),
      mayHaveGrown:
        updated !== null && now - updated > FIRE_RULES.mayHaveGrownMs,
      simulated: Boolean(row.simulated),
    });
  }
  return out.sort(
    (a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || a.dMin - b.dMin,
  );
}

/** The nearest fire boundary anywhere (coarse, by box), for "under the demo". */
export function nearestFire(rows, center) {
  const p = ll(center);
  // Boxes rank the candidates; the closest few are measured to the edge.
  const ranked = (rows || [])
    .filter((row) => row?.polygons?.length)
    .map((row) => ({ row, box: bboxDistanceM(p, bboxOf(row)) }))
    .sort((a, b) => a.box - b.box)
    .slice(0, 5)
    .map(({ row }) => ({ row, d: distanceToPolygonsM(p, row.polygons) }))
    .sort((a, b) => a.d - b.d);
  const best = ranked[0];
  if (!best) return null;
  const v = nearestVertex(p, best.row.polygons);
  return { ...best, bearing: v ? bearingLabel(p, v) : '' };
}

/**
 * Heat detections that belong to a mapped fire: {byFire: Map(stableId →
 * count), outside: records}. Only `outside` records drive HEAT and its chip.
 */
export function attributeHeat(records, rows) {
  const byFire = new Map();
  const outside = [];
  for (const r of records || []) {
    let owner = null;
    for (const row of rows || []) {
      if (!row?.polygons?.length) continue;
      // A detection just outside a burn that is meant to be there, or out,
      // could be a spot fire: those claim only what is at their edge (X1).
      const reach =
        row.category === 'RX' || Number(row.containedPct) >= 100
          ? FIRE_RULES.insideEdgeM
          : FIRE_RULES.attributeM;
      if (bboxDistanceM(r, bboxOf(row)) > reach) continue;
      if (distanceToPolygonsM(r, row.polygons) <= reach) {
        owner = row.stableId;
        break;
      }
    }
    if (owner) byFire.set(owner, (byFire.get(owner) || 0) + 1);
    else outside.push(r);
  }
  return { byFire, outside };
}

// ---- Tropical --------------------------------------------------------------

const conePolygons = (cone) =>
  cone?.type === 'Polygon'
    ? [cone.coordinates]
    : cone?.type === 'MultiPolygon'
      ? cone.coordinates
      : [];

/**
 * Assess every storm against the hotel and today's remaining stops.
 * Forecast times are issuedAt + tau, never the window's clock.
 */
export function assessTropical(storms, ctx) {
  const center = ll(ctx.center);
  const places = [center, ...(ctx.stops || []).filter(valid).map(ll)];
  const out = [];
  for (const storm of storms || []) {
    const cone = conePolygons(storm.cone);
    const inCone = cone.length
      ? places.some((p) => pointInPolygons(p, cone))
      : false;
    const issued = Date.parse(storm.issuedAt);
    const pos = valid(storm.position) ? ll(storm.position) : null;
    // Without its forecast shapes (geometry pending or unavailable) the
    // storm still counts from where it is now, at hour 0 (X2).
    const noShapes =
      storm.geometryStatus !== undefined
        ? storm.geometryStatus !== 'current' || !storm.forecastPoints?.length
        : !storm.forecastPoints?.length;
    const raw = storm.forecastPoints?.length
      ? storm.forecastPoints
      : pos
        ? [{ position: storm.position, tauHours: 0, windKt: storm.windKt }]
        : [];
    const points = raw
      .filter((f) => valid(f.position))
      .map((f) => ({
        ...f,
        d: Math.min(...places.map((p) => haversineM(p, ll(f.position)))),
        etaMs: Number.isFinite(issued) ? issued + f.tauHours * 3600e3 : null,
        bearing: bearingLabel(center, ll(f.position)),
      }));
    const nearest = [...points].sort((a, b) => a.d - b.d)[0] || null;
    const strongNear = points
      .filter(
        (f) => f.windKt >= TROPICAL_RULES.tsKt && f.d <= TROPICAL_RULES.nearM,
      )
      .sort((a, b) => a.tauHours - b.tauHours)[0];
    const coneD = cone.length
      ? Math.min(...places.map((p) => distanceToPolygonsM(p, cone)))
      : Infinity;
    let level = 'none';
    if (inCone) level = 'cone';
    else if (strongNear) level = 'near';
    else if (
      (nearest && nearest.d <= TROPICAL_RULES.watchM) ||
      coneD <= TROPICAL_RULES.watchM
    )
      level = 'watch';
    out.push({
      storm,
      level,
      title: stormTitle(storm),
      inCone,
      noShapes,
      nearest,
      firstStrong: strongNear || null,
      nowD: pos ? haversineM(center, pos) : null,
      nowBearing: pos ? bearingLabel(center, pos) : null,
      // Toward where the storm is now, as the card's "Now … SE" (X16).
      towardDeg: pos
        ? bearingDeg(center, pos)
        : nearest?.position
          ? bearingDeg(center, ll(nearest.position))
          : null,
      issuedMs: Number.isFinite(issued) ? issued : null,
      simulated: Boolean(storm.simulated),
    });
  }
  return out.sort(
    (a, b) =>
      LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
      (a.nowD ?? Infinity) - (b.nowD ?? Infinity),
  );
}

// ---- Words -----------------------------------------------------------------

const acres = (a) =>
  Number.isFinite(a) ? `${Math.round(a).toLocaleString('en-US')} acres` : null;
const contained = (row) =>
  row.category === 'RX'
    ? 'prescribed burn'
    : Number.isFinite(row.containedPct)
      ? `${Math.round(row.containedPct)}% contained`
      : 'containment not reported';
const sim = (item) => (item.simulated ? 'SIMULATED · ' : '');
/** "Cedar Fire" — NIFC names omit "Fire"; add it unless already there. */
export const fireName = (row) => {
  const n = String(row?.name || 'Unnamed').trim();
  return /\b(fire|complex|burn)\b/i.test(n) ? n : `${n} Fire`;
};
/** Durations: hours and minutes up to two days, then days. */
export function ageText(ms) {
  if (!Number.isFinite(ms)) return '';
  // Never "1m": beside distances it reads as metres (X14).
  const min = Math.max(0, Math.round(ms / 60e3));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  return `${Math.round(h / 24)} d`;
}
/** A rule radius with thousands separators ("1,000 km"). */
const radius = (m) =>
  m < 10000
    ? formatRadius(m)
    : getDistanceUnit() === 'm'
      ? `${Math.round(m / 1000).toLocaleString('en-US')} km`
      : `${Math.round(m / 1609.344).toLocaleString('en-US')} mi`;

const mapped = (item) =>
  item.mappedAgoMs === null
    ? 'mapping time not reported'
    : `mapped ${ageText(item.mappedAgoMs)} ago${item.mayHaveGrown ? ' · may have grown' : ''}`;
/** Where the boundary data comes from: never NIFC for the demo (X6). */
const provenance = (item) =>
  item.simulated
    ? `Demo boundary (SIMULATED) · drawn ${ageText(item.mappedAgoMs)} ago · not real data`
    : `NIFC boundary ${mapped(item)} · accurate to about 100 m`;

/** The headline for one assessed fire: where it is relative to the trip. */
export function fireHeadline(item, noun = 'hotel') {
  const name = `${fireName(item.row)} boundary`;
  if (item.hotelInside)
    return `${sim(item)}${noun[0].toUpperCase()}${noun.slice(1)} ${item.hotelAtEdge ? 'at the edge of' : 'inside'} the ${name}`;
  if (item.stopsInside.length)
    return `${sim(item)}${item.stopsInside[0].label} inside the ${name}`;
  if (item.peopleIn.length)
    return `${sim(item)}${item.peopleIn.length} ${item.peopleIn.length === 1 ? 'person' : 'people'} inside the ${name}`;
  // Near only because of people (X3): say so.
  if (item.peopleNear.length && item.dMin > FIRE_RULES.nearM && !item.upwind)
    return `${sim(item)}${item.peopleNear.length} ${item.peopleNear.length === 1 ? 'person' : 'people'} within ${radius(FIRE_RULES.peopleNearM)} of the ${name}`;
  // Always from the hotel (as the chip); a nearer stop is a second clause
  // (X34, round 2 N1).
  const where = `${formatDistance(item.dHotel)}${item.bearing ? ` ${item.bearing}` : ''}`;
  const stop =
    item.anchor && noun === 'hotel'
      ? ` · ${formatDistance(item.anchor.d)} from ${item.anchor.label}`
      : '';
  return `${sim(item)}${name} ${where} of the ${noun}${stop}`;
}

/** Card lines for one fire: headline, facts, provenance. */
export function fireLines(item, { heatInside = 0, wind, noun = 'hotel' } = {}) {
  const lines = [
    {
      text: fireHeadline(item, noun),
      tone: isCheckLevel(item.level) ? 'amber' : '',
    },
  ];
  const facts = [acres(item.row.acres), contained(item.row)].filter(Boolean);
  if (item.upwind && wind)
    facts.push(
      `upwind: wind from the ${wind.from} at ${Math.round(wind.kmh)} km/h`,
    );
  lines.push({ text: facts.join(' · '), tone: '' });
  if (heatInside)
    lines.push({
      text: `Heat detections at this fire: ${heatInside} · ${item.simulated ? 'SIMULATED' : 'FIRMS'}`,
      tone: '',
    });
  lines.push({ text: provenance(item), tone: 'dim' });
  return lines;
}

/** One line for S3, S5, S6 and the closed Hazards line: the headline (X13). */
export function fireShort(item, noun = 'hotel') {
  return fireHeadline(item, noun);
}
/** The chip's own short form: "Fire 1.1 mi W · Demo Fire" (X4). */
export function fireChip(item, noun = 'hotel') {
  if (item.hotelInside)
    return `${sim(item)}${noun[0].toUpperCase()}${noun.slice(1)} inside a fire boundary`;
  if (item.stopsInside.length)
    return `${sim(item)}${item.stopsInside[0].label} inside a fire boundary`;
  if (item.peopleIn.length) return `${sim(item)}People inside a fire boundary`;
  if (item.peopleNear.length) return `${sim(item)}People near a fire boundary`;
  return `${sim(item)}Fire ${formatDistance(item.dHotel)}${item.bearing ? ` ${item.bearing}` : ''}`;
}

/** Knots in the display units: km/h with metres, mph with feet or yards. */
const kt = (v) =>
  !Number.isFinite(v)
    ? null
    : getDistanceUnit() === 'm'
      ? `${Math.round(v * 1.852)} km/h`
      : `${Math.round(v * 1.15078)} mph`;
const inHours = (etaMs, now) =>
  etaMs === null
    ? null
    : etaMs <= now
      ? 'now'
      : `in ${Math.max(1, Math.round((etaMs - now) / 3600e3))} h`;

export const CONE_NOTE =
  "The cone shows where the centre may go, not the storm's size · wind and rain reach beyond it";
export const NO_RADII_NOTE =
  'This feed has no wind radii: storm winds may reach well beyond the centre · read the advisory';

/** The headline for one assessed storm. */
export function tropicalHeadline(item, now = Date.now(), noun = 'hotel') {
  const s = item.simulated ? 'SIMULATED · ' : '';
  if (item.inCone)
    return `${s}${item.title} · the forecast cone covers the ${noun}`;
  const strong = item.firstStrong;
  if (item.level === 'near' && strong && item.noShapes)
    return `${s}${item.title} · now ${formatDistance(strong.d)} ${strong.bearing}, winds ${kt(strong.windKt)}`;
  if (item.level === 'near' && strong)
    return `${s}${item.title} · forecast centre ${formatDistance(strong.d)} ${strong.bearing} ${inHours(strong.etaMs, now) || ''}, winds ${kt(strong.windKt)}`.trim();
  return `${s}${item.title} · now ${formatDistance(item.nowD ?? NaN)} ${item.nowBearing || ''}`.trim();
}

export function tropicalLines(item, now = Date.now(), noun = 'hotel') {
  const st = item.storm;
  const lines = [
    {
      text: tropicalHeadline(item, now, noun),
      tone: isCheckLevel(item.level) ? 'amber' : '',
    },
  ];
  const facts = [
    item.nowD === null
      ? null
      : `Now ${formatDistance(item.nowD)} ${item.nowBearing}`,
    st.movement && Number.isFinite(st.movement.speedKt)
      ? `moving ${bearingWord(st.movement.directionDegrees)} ${kt(st.movement.speedKt)}`
      : null,
    st.windKt != null ? `winds ${kt(st.windKt)}` : null,
    Number.isFinite(st.pressureHpa) ? `${st.pressureHpa} hPa` : null,
  ].filter(Boolean);
  lines.push({ text: facts.join(' · '), tone: '' });
  if (item.noShapes)
    lines.push({
      text: 'Forecast track and cone not available yet · read the advisory',
      tone: 'amber',
    });
  else if (item.nearest && item.level !== 'watch')
    lines.push({
      text: `Nearest forecast centre ${formatDistance(item.nearest.d)} ${item.nearest.bearing} ${inHours(item.nearest.etaMs, now) || ''}${item.nearest.windKt ? `, winds ${kt(item.nearest.windKt)}` : ''}`,
      tone: '',
    });
  const age =
    item.issuedMs === null ? '' : `, ${ageText(now - item.issuedMs)} ago`;
  lines.push({
    // Never NHC for the demo (X6).
    text: item.simulated
      ? `Demo advisory (SIMULATED)${age} · not real data`
      : `${st.basin === 'CP' ? 'CPHC' : 'NHC'} advisory ${st.advisoryNumber || '—'}${age}${item.issuedMs !== null && now - item.issuedMs > HAZARD_STALE.advisoryMs ? ' · a newer one may be out' : ''}`,
    tone: 'dim',
  });
  if (item.inCone) lines.push({ text: CONE_NOTE, tone: 'dim' });
  else if (item.level === 'near')
    lines.push({ text: NO_RADII_NOTE, tone: 'dim' });
  return lines;
}

export function tropicalShort(item, now = Date.now()) {
  const s = item.simulated ? 'SIMULATED · ' : '';
  if (item.inCone) return `${s}In the forecast cone · ${item.title}`;
  if (item.level === 'near' && item.firstStrong)
    return `${s}${item.title} · ${formatDistance(item.firstStrong.d)} ${inHours(item.firstStrong.etaMs, now) || ''}`.trim();
  return `${s}${item.title} · ${formatDistance(item.nowD ?? NaN)} ${item.nowBearing || ''}`.trim();
}

const WORDS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function bearingWord(deg) {
  return Number.isFinite(deg) ? WORDS[Math.round(deg / 45) % 8] : '';
}
export const compassWord = bearingWord;

/** The quiet or status line for fires (never "none" without its scope). */
export function fireStatusLine({
  state,
  coverage,
  ageMs,
  nearest,
  demo,
  count = 0,
  noun = 'hotel',
}) {
  const age = Number.isFinite(ageMs) ? ` · NIFC ${ageText(ageMs)} ago` : '';
  if (!coverage.fire && !demo)
    return 'Fire boundaries: not covered here · NIFC maps US fires only · not checked';
  if (state === 'loading') return 'Fire boundaries: checking NIFC…';
  if (state === 'unavailable')
    return 'Fire boundaries unavailable right now · NIFC · not checked';
  const stale = state === 'stale' ? ' · may be out of date' : '';
  // With fires listed, the status line is only the source and its age.
  if (count && !demo) return `Fire boundaries · US fires only${age}${stale}`;
  const lead = demo ? 'Real NIFC under the demo: ' : '';
  const far =
    nearest && Number.isFinite(nearest.d)
      ? `nearest boundary ${formatDistance(nearest.d)} ${nearest.bearing} · ${fireName(nearest.row)}`
      : `no fire boundary within ${radius(FIRE_RULES.areaM)} of the ${noun}`;
  const body = demo
    ? far
    : `No fire boundary within ${radius(FIRE_RULES.areaM)} of the ${noun}`;
  return `${lead}${body} · US fires only${age}${stale}`;
}

/** The quiet or status line for hurricanes & tropical storms. */
export function tropicalStatusLine({
  state,
  coverage,
  ageMs,
  storms,
  demo,
  count = 0,
}) {
  const age = Number.isFinite(ageMs) ? ` · NHC ${ageText(ageMs)} ago` : '';
  if (state === 'loading') return 'Hurricanes & tropical storms: checking NHC…';
  if (state === 'unavailable')
    return 'Hurricanes & tropical storms unavailable right now · NHC · not checked';
  const real = (storms || []).filter((s) => !s.simulated);
  const list = real.length
    ? `${real.length} active: ${real
        .slice(0, 3)
        .map((s) => `${s.name} (${BASINS[s.basin] || s.basin})`)
        .join(', ')}`
    : "No active storms in NHC's area";
  const stale = state === 'stale' ? ' · may be out of date' : '';
  // A storm without its forecast shapes is never summed up as "none" (X2).
  const pending = real.filter((s) => !s.forecastPoints?.length);
  const shapes = pending.length
    ? ` · forecast shapes not available yet: ${pending.map((s) => s.name).join(', ')}`
    : '';
  if (count && !demo)
    return `Hurricanes & tropical storms · ${list}${shapes}${age}${stale}`;
  if (!coverage.tropical && !demo)
    return `Hurricanes & tropical storms: not covered here · NHC forecasts the Atlantic and E/C Pacific · not checked · ${list}${age}${stale}`;
  const lead = demo ? 'Real NHC under the demo: ' : '';
  const body =
    real.length && !pending.length
      ? `No forecast within ${radius(TROPICAL_RULES.watchM)} of the trip · ${list}`
      : `${list}${shapes}`;
  return `${lead}${body}${age}${stale}`;
}

// ---- Summary for every surface ---------------------------------------------

/**
 * One object every surface reads. input = {fires, tropical (assessed),
 * firesFeed, tropicalFeed, coverage, rows, storms, center, now, demo:{fire,
 * cyclone}, heat: attributeHeat result}.
 */
export function hazardPicture(input) {
  const { now = Date.now(), coverage } = input;
  const fireState = hazardFeedState(input.firesFeed, now, HAZARD_STALE.fireMs);
  const tropState = hazardFeedState(
    input.tropicalFeed,
    now,
    HAZARD_STALE.advisoryMs,
  );
  const fires = input.fires || [];
  const tropical = (input.tropical || []).filter((t) => t.level !== 'none');
  const fireTop = fires[0] || null;
  const tropTop = tropical[0] || null;
  const fireCheck = fires.filter((f) => isCheckLevel(f.level));
  const tropCheck = tropical.filter((t) => isCheckLevel(t.level));
  // FIRE › FIRE NEAR › CONE › TROPICAL NEAR (H5 badge order); both kinds
  // are named when both need a check (X4). "Forecast cone": a hurricane's
  // cone is not a tropical storm's (X20).
  const fireWord =
    fireTop?.level === 'inside'
      ? 'INSIDE FIRE BOUNDARY'
      : fireTop?.level === 'near'
        ? 'FIRE NEAR'
        : null;
  const tropWord =
    tropTop?.level === 'cone'
      ? 'IN FORECAST CONE'
      : tropTop?.level === 'near'
        ? 'TROPICAL NEAR'
        : null;
  const parts = [
    fireWord && { w: fireWord, sim: fireTop.simulated },
    tropWord && { w: tropWord, sim: tropTop.simulated },
  ].filter(Boolean);
  const allSim = parts.length && parts.every((x) => x.sim);
  const word = parts.length
    ? allSim
      ? `${parts.map((x) => x.w).join(' + ')} (SIMULATED)`
      : parts.map((x) => `${x.w}${x.sim ? ' (SIMULATED)' : ''}`).join(' + ')
    : null;
  return {
    fireState,
    tropState,
    fires,
    tropical,
    fireCheck,
    tropCheck,
    check: fireCheck.length > 0 || tropCheck.length > 0,
    word,
    badge:
      fireTop?.level === 'inside'
        ? 'FIRE'
        : fireTop?.level === 'near'
          ? 'FIRE NEAR'
          : tropTop?.level === 'cone'
            ? 'CONE'
            : tropTop?.level === 'near'
              ? 'TROPICAL NEAR'
              : null,
    // Every assessed fire, not only those at amber for the hotel (X3).
    peopleNearFire: [
      ...new Set(fires.flatMap((f) => [...f.peopleIn, ...f.peopleNear])),
    ],
    fireStatus: fireStatusLine({
      state: fireState,
      coverage,
      ageMs: hazardAge(input.firesFeed, now),
      nearest: input.nearest,
      demo: input.demo?.fire,
      count: fires.length,
      noun: input.noun,
    }),
    tropStatus: tropicalStatusLine({
      state: tropState,
      coverage,
      ageMs: hazardAge(input.tropicalFeed, now),
      storms: input.storms,
      demo: input.demo?.cyclone,
      count: tropical.length,
    }),
    heat: input.heat || { byFire: new Map(), outside: null },
  };
}
