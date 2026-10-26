// Trip Twin pure data rules. No Cesium, DOM, network or clock reads.
// Spec: plans/trip-twin/03-architecture.md §4, §7; 06-layer-taxonomy.md §3.
import { currentFreshness, validPoint } from '../model.js';

export const TWIN_RADIUS_M = 400;
export const NEARBY_M = 150; // 06 HTL-03 / HTL-04 split (01 [A5])
export const LEVEL_HEIGHT_M = 3.3; // repo convention (annotationResolver), X-11
export const DEFAULT_BUILDING_HEIGHT_M = 9.9; // three levels, drawn as approximate
export const BUILDING_CAP = 2500;
const EARTH_M = 6371008.8;
const RAD = Math.PI / 180;

// --- geometry ----------------------------------------------------------------

/** Local east/north metres around a centre; accurate to <0.1% inside 1 km. */
export function makeProjector(center) {
  const lat0 = center.lat * RAD;
  const mx = Math.cos(lat0) * EARTH_M * RAD;
  const my = EARTH_M * RAD;
  return {
    toXY: (lat, lon) => [(lon - center.lon) * mx, (lat - center.lat) * my],
    toLL: (x, y) => ({ lat: center.lat + y / my, lon: center.lon + x / mx }),
  };
}

export function haversineM(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function bearingLabel(from, to) {
  const y = Math.sin((to.lon - from.lon) * RAD) * Math.cos(to.lat * RAD);
  const x =
    Math.cos(from.lat * RAD) * Math.sin(to.lat * RAD) -
    Math.sin(from.lat * RAD) *
      Math.cos(to.lat * RAD) *
      Math.cos((to.lon - from.lon) * RAD);
  const deg = (Math.atan2(y, x) / RAD + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

/** ring: [[x,y], ...] in metres (closed or open). */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}

export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Shortest distance from a point to the ring's edges (metres). */
export function distanceToRing([x, y], ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

export function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

/** Stitch relation member ways (arrays of {lat,lon}) into closed rings. */
export function ringStitch(paths) {
  const pending = paths.filter((p) => p.length >= 2).map((p) => p.slice());
  const rings = [];
  const same = (a, b) => a.lat === b.lat && a.lon === b.lon;
  while (pending.length) {
    let ring = pending.shift();
    let grew = true;
    while (!same(ring[0], ring.at(-1)) && grew) {
      grew = false;
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        if (same(ring.at(-1), p[0])) ring = ring.concat(p.slice(1));
        else if (same(ring.at(-1), p.at(-1)))
          ring = ring.concat(p.slice(0, -1).reverse());
        else continue;
        pending.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && same(ring[0], ring.at(-1))) rings.push(ring);
  }
  return rings;
}

// --- Overpass -------------------------------------------------------------------

const HIGHWAYS =
  'motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|pedestrian|footway|steps';

/** 03 §4.1. Centre rounded to 5 decimals so cache keys are stable. */
export function buildTwinQuery(center, radius = TWIN_RADIUS_M) {
  const r = Math.round(Math.min(800, Math.max(100, radius)));
  const lat = center.lat.toFixed(5);
  const lon = center.lon.toFixed(5);
  const near = `${lat},${lon}`;
  return [
    '[out:json][timeout:25];',
    '(',
    `way(around:${r},${near})["building"];`,
    `relation(around:${r},${near})["building"]["type"="multipolygon"];`,
    `way(around:150,${near})["building:part"];`,
    `nwr(around:150,${near})["tourism"~"^(hotel|hostel|guest_house|motel|apartment)$"];`,
    `node(around:150,${near})["entrance"];`,
    `way(around:${r},${near})["highway"~"^(${HIGHWAYS})$"];`,
    ');',
    'out geom qt;',
  ].join('\n');
}

export function parseMeters(value) {
  if (value == null) return 0;
  const n = Number.parseFloat(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return /\b(ft|feet|foot)\b|'/i.test(String(value)) ? n * 0.3048 : n;
}

/**
 * Height with its provenance. 06 §3.5 labels: mapped height, from levels,
 * or approximate. Never guesses a level count.
 */
export function buildingHeight(tags = {}) {
  const levelsRaw = Number.parseFloat(tags['building:levels']);
  const levels = Number.isFinite(levelsRaw) && levelsRaw > 0 ? levelsRaw : null;
  const minLevel = Number.parseFloat(tags['building:min_level']);
  const minHeightM =
    parseMeters(tags.min_height) ||
    (Number.isFinite(minLevel) && minLevel > 0 ? minLevel * LEVEL_HEIGHT_M : 0);
  const mapped =
    parseMeters(tags.height) || parseMeters(tags['building:height']);
  if (mapped)
    return {
      heightM: mapped,
      minHeightM,
      levels,
      source: 'height',
      approximate: false,
    };
  if (levels)
    return {
      heightM: levels * LEVEL_HEIGHT_M + parseMeters(tags['roof:height']),
      minHeightM,
      levels,
      source: 'levels',
      approximate: false,
    };
  return {
    heightM: Math.max(DEFAULT_BUILDING_HEIGHT_M, minHeightM + 3),
    minHeightM,
    levels: null,
    source: 'default',
    approximate: true,
  };
}

const ll = (p) => ({ lat: p.lat, lon: p.lon });

/**
 * Overpass `out geom` elements → buildings, parts, roads, entrances, hotels.
 * Rings are arrays of {lat,lon}, closed.
 */
export function parseOverpassElements(elements = []) {
  const buildings = [];
  const parts = [];
  const roads = [];
  const entrances = [];
  const hotels = [];
  for (const el of elements) {
    const tags = el.tags || {};
    if (
      tags.tourism &&
      /^(hotel|hostel|guest_house|motel|apartment)$/.test(tags.tourism)
    ) {
      const pt =
        el.type === 'node' ? ll(el) : el.center || centroidLL(el.geometry);
      if (pt)
        hotels.push({
          id: `${el.type}/${el.id}`,
          name: tags.name || '',
          ...pt,
          tags,
        });
    }
    if (el.type === 'node' && tags.entrance) {
      entrances.push({
        id: `node/${el.id}`,
        lat: el.lat,
        lon: el.lon,
        kind: tags.entrance,
      });
      continue;
    }
    if (el.type === 'way' && tags.highway && Array.isArray(el.geometry)) {
      roads.push({
        id: `way/${el.id}`,
        highway: tags.highway,
        name: tags.name || null,
        // Walkability tags (review/phase7 UX P0-2): never walk a tunnel,
        // motorway or a way marked foot=no / private.
        tunnel: tags.tunnel && tags.tunnel !== 'no' ? tags.tunnel : null,
        bridge: tags.bridge && tags.bridge !== 'no' ? tags.bridge : null,
        foot: tags.foot || null,
        access: tags.access || null,
        footway: tags.footway || null,
        crossing: tags.crossing || null,
        coords: el.geometry.map(ll),
      });
      continue;
    }
    const isPart = Boolean(tags['building:part']) && !tags.building;
    if (!tags.building && !isPart) continue;
    let outer = [];
    if (el.type === 'way' && Array.isArray(el.geometry)) {
      const g = el.geometry.map(ll);
      if (g.length >= 4)
        outer = [
          g[0].lat === g.at(-1).lat && g[0].lon === g.at(-1).lon
            ? g
            : [...g, g[0]],
        ];
    } else if (el.type === 'relation' && Array.isArray(el.members)) {
      outer = ringStitch(
        el.members
          .filter((m) => m.role !== 'inner' && Array.isArray(m.geometry))
          .map((m) => m.geometry.map(ll)),
      );
    }
    if (!outer.length) continue;
    const record = {
      id: `${el.type}/${el.id}`,
      name: tags.name || '',
      tags,
      rings: outer,
      isPart,
      ...buildingHeight(tags),
    };
    (isPart ? parts : buildings).push(record);
  }
  return { buildings, parts, roads, entrances, hotels };
}

function centroidLL(geometry) {
  if (!Array.isArray(geometry) || !geometry.length) return null;
  let lat = 0;
  let lon = 0;
  for (const p of geometry) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / geometry.length, lon: lon / geometry.length };
}

/** Attach metric geometry and drop implausible footprints (03 R-10). */
export function projectBuildings(list, projector, center, cap = BUILDING_CAP) {
  const out = [];
  for (const b of list) {
    const xy = b.rings.map((r) => r.map((p) => projector.toXY(p.lat, p.lon)));
    const areaM2 = ringArea(xy[0]);
    if (areaM2 < 15 || areaM2 > 400000) continue;
    const [cx, cy] = ringCentroid(xy[0]);
    out.push({ ...b, xy, areaM2, distanceM: Math.hypot(cx, cy) });
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  const shown = out.slice(0, cap);
  return {
    buildings: shown,
    total: out.length,
    capped: out.length > cap,
    center,
  };
}

/**
 * Footprint ladder (03 §4.3): containing outline → tourism name match within
 * 120 m → nearest ≤ 40 m and ≥ 150 m² → synthesized 30 m circle (approximate).
 */
export function selectHotelFootprint(buildings, hotels, place, projector) {
  const p = projector.toXY(place.lat, place.lon);
  if (place.osm_id) {
    const exact = buildings.find((b) => b.id === place.osm_id);
    if (exact) return { building: exact, source: 'osm_id', approximate: false };
  }
  const containing = buildings.filter((b) => pointInRing(p, b.xy[0]));
  if (containing.length) {
    containing.sort((a, b) => a.areaM2 - b.areaM2);
    return { building: containing[0], source: 'contains', approximate: false };
  }
  const name = (place.name || '').toLowerCase();
  if (name) {
    for (const h of hotels) {
      if (!h.name || !name.includes(h.name.toLowerCase().split(' ')[0]))
        continue;
      if (haversineM(place, h) > 120) continue;
      const hp = projector.toXY(h.lat, h.lon);
      const hit = buildings.find((b) => pointInRing(hp, b.xy[0]));
      if (hit) return { building: hit, source: 'name', approximate: false };
    }
  }
  const nearest = buildings
    .filter((b) => b.areaM2 >= 150)
    .map((b) => ({ b, d: distanceToRing(p, b.xy[0]) }))
    .sort((a, b) => a.d - b.d)[0];
  if (nearest && nearest.d <= 40)
    return { building: nearest.b, source: 'nearest', approximate: false };
  const ring = Array.from({ length: 33 }, (_, i) => {
    const t = (i / 32) * Math.PI * 2;
    return [p[0] + 30 * Math.cos(t), p[1] + 30 * Math.sin(t)];
  });
  return {
    building: {
      id: 'synthesized',
      name: place.name || 'Hotel',
      tags: {},
      xy: [ring],
      rings: [ring.map(([x, y]) => projector.toLL(x, y))],
      areaM2: ringArea(ring),
      ...buildingHeight({}),
    },
    source: 'synthesized',
    approximate: true,
  };
}

// --- ground heightfield ----------------------------------------------------------

export function gridPoints(center, radius = TWIN_RADIUS_M, n = 21) {
  const proj = makeProjector(center);
  const half = radius + 100;
  const pts = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = -half + (2 * half * i) / (n - 1);
      const y = -half + (2 * half * j) / (n - 1);
      pts.push(proj.toLL(x, y));
    }
  return { points: pts, n, half };
}

/** Bilinear heightfield over the grid; heights may contain nulls (filled). */
export function makeHeightfield(grid, heights) {
  const known = heights.filter(Number.isFinite);
  const fallback = known.length
    ? known.reduce((a, b) => a + b, 0) / known.length
    : 0;
  const h = heights.map((v) => (Number.isFinite(v) ? v : fallback));
  const { n, half } = grid;
  const step = (2 * half) / (n - 1);
  return {
    base: fallback,
    /** x,y in local metres. */
    at(x, y) {
      const fx = Math.max(0, Math.min(n - 1.0001, (x + half) / step));
      const fy = Math.max(0, Math.min(n - 1.0001, (y + half) / step));
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const tx = fx - i;
      const ty = fy - j;
      const v = (a, b) => h[b * n + a];
      return (
        v(i, j) * (1 - tx) * (1 - ty) +
        v(i + 1, j) * tx * (1 - ty) +
        v(i, j + 1) * (1 - tx) * ty +
        v(i + 1, j + 1) * tx * ty
      );
    },
  };
}

// --- people: position state, hotel verdict, roster ----------------------------------

/** 06 §3.1. Returns {id, chip, current, notCurrent, age, label}. */
export function positionState(person, elapsed = 0, snapshotDelayed = false) {
  const f = currentFreshness(person, elapsed);
  if (!validPoint(person.coordinates))
    return {
      id: 'POS-01',
      chip: 'Not located',
      current: false,
      located: false,
      age: null,
      label: f.label,
    };
  if (f.state === 'unknown')
    return {
      id: 'POS-02',
      chip: 'Time unknown',
      current: false,
      located: true,
      age: null,
      label: f.label,
    };
  let state = f.state;
  // POS-M5: a delayed snapshot treats every private layer one state older.
  if (snapshotDelayed && f.presence !== 'stopped')
    state = state === 'fresh' ? 'aging' : 'stale';
  if (f.presence === 'stopped' && !snapshotDelayed)
    return {
      id: 'POS-03',
      chip: 'Stopped · current',
      current: true,
      located: true,
      age: f.age,
      label: f.label,
    };
  if (f.presence === 'stopped_no_answer')
    return {
      id: 'POS-06b',
      chip: 'Last known',
      current: false,
      located: true,
      age: f.age,
      label: f.label,
    };
  if (state === 'fresh')
    return {
      id: 'POS-04',
      chip: 'Live',
      current: true,
      located: true,
      age: f.age,
      label: f.label,
    };
  if (state === 'aging')
    return {
      id: 'POS-05',
      chip: 'Aging',
      current: false,
      located: true,
      age: f.age,
      label: f.label,
    };
  return {
    id: 'POS-06',
    chip: 'Last known',
    current: false,
    located: true,
    age: f.age,
    label: f.label,
  };
}

/**
 * 06 §3.2 hotel verdict with the 2× accuracy rule (F2).
 * hotel: {xy: ring metres, approximate}, projector; floorLevelLow optional.
 */
export function hotelVerdict(person, pos, hotel, projector, extras = {}) {
  if (!pos.located) return { id: 'none', bucket: 'Not located' };
  const c = person.coordinates;
  const p = projector.toXY(c.lat, c.lng);
  const ring = hotel.xy;
  const inside = pointInRing(p, ring);
  const edge = distanceToRing(p, ring);
  const distM = inside ? 0 : edge;
  const acc = Number.isFinite(person.accuracy_m) ? person.accuracy_m : null;
  const r2 = acc === null ? null : 2 * acc;
  let verdict;
  if (distM > NEARBY_M) verdict = 'HTL-04';
  else if (hotel.approximate || acc === null || acc > 100) verdict = 'HTL-02';
  else if (inside && edge >= r2) verdict = 'HTL-01';
  else if (
    inside &&
    Number.isFinite(extras.floorLevelLow) &&
    extras.floorLevelLow >= 2
  )
    verdict = 'HTL-01';
  else if (inside && extras.stoppedSinceEntry) verdict = 'HTL-01';
  else if (!inside && edge >= r2) verdict = 'HTL-03';
  else verdict = 'HTL-02';
  if (!pos.current)
    return { id: verdict, bucket: 'Not current', lastVerdict: verdict, distM };
  const bucket = {
    'HTL-01': 'Inside (likely)',
    'HTL-02': 'At hotel, undetermined',
    'HTL-03': 'Outside, nearby',
    'HTL-04': 'Away',
  }[verdict];
  return { id: verdict, bucket, distM };
}

export const ROSTER_BUCKETS = [
  'Inside (likely)',
  'At hotel, undetermined',
  'Outside, nearby',
  'Away',
  'Not current',
  'Not located',
];

export function rosterCounts(verdicts) {
  const counts = Object.fromEntries(ROSTER_BUCKETS.map((b) => [b, 0]));
  for (const v of verdicts) counts[v.bucket] += 1;
  return counts;
}

export function rosterLine(counts, loaded, { hotelApproximate = false } = {}) {
  return (
    ROSTER_BUCKETS.map((b) =>
      b === 'Inside (likely)' && hotelApproximate
        ? `${b} —`
        : `${b} ${counts[b]}`,
    ).join(' · ') + ` · of ${loaded} loaded`
  );
}

/** 06 §3.3 zone line, read from Core's group_zone_state only (03 ADR-004). */
export function zoneLine(people, posById) {
  let outside = 0;
  let unaccompanied = 0;
  let unknown = 0;
  for (const p of people) {
    const pos = posById.get(p.id);
    if (!pos?.current) {
      unknown += 1;
      continue;
    }
    if (p.group_zone_state === 'outside') {
      outside += 1;
      if (p.unaccompanied) unaccompanied += 1;
    } else if (p.group_zone_state !== 'inside') unknown += 1;
  }
  return {
    outside,
    unaccompanied,
    unknown,
    text: `Outside group zone ${outside} · Unaccompanied ${unaccompanied} · Zone unknown ${unknown}`,
  };
}

// --- floor partition (06 FLR-11/12, FL06) -------------------------------------------

/**
 * Classifies a person's floor display state. est = participant.floor_estimate.
 * Returns {kind: 'band'|'last'|'unknown'|'not_shared'|'none', ...}.
 */
/** At the hotel now, or last seen at the hotel (not current). */
export function atHotelVerdict(verdict) {
  return (
    verdict.bucket === 'Inside (likely)' ||
    verdict.bucket === 'At hotel, undetermined' ||
    (verdict.bucket === 'Not current' &&
      ['HTL-01', 'HTL-02'].includes(verdict.lastVerdict))
  );
}

export function floorDisplay(person, pos, verdict, est, elapsed = 0) {
  const atHotel = atHotelVerdict(verdict);
  if (!atHotel || !pos.located) return { kind: 'none' };
  if (!est) return { kind: 'none' };
  if (est.status === 'unknown' && est.unknown_reason === 'consent_off')
    return { kind: 'not_shared' };
  if (est.status === 'unknown')
    return { kind: 'unknown', reason: est.unknown_reason };
  const sampleAge = ageSeconds(est.sample_at, person, elapsed);
  if (!pos.current || pos.id === 'POS-03' || sampleAge > 600)
    return { kind: 'last', est, sampleAge, stopped: pos.id === 'POS-03' };
  return { kind: 'band', est, sampleAge, aging: sampleAge > 120 };
}

function ageSeconds(iso, person, elapsed) {
  const t = Date.parse(iso);
  const cap = Date.parse(person.capturedAt);
  if (!Number.isFinite(t)) return Infinity;
  // Server "now" is capturedAt + locationAgeSeconds (same rule as derivePresence).
  const serverNow =
    Number.isFinite(cap) && Number.isFinite(person.locationAgeSeconds)
      ? cap + person.locationAgeSeconds * 1000
      : t;
  return Math.max(0, (serverNow - t) / 1000 + elapsed);
}

export function floorPartition(
  rows,
  reportedLabel,
  { comparable = true } = {},
) {
  const out = {
    Above: 0,
    'At or near': 0,
    Below: 0,
    'Last est. only': 0,
    'Floor unknown': 0,
    'Not shared': 0,
    'No floor (not at hotel)': 0,
  };
  const priority = [];
  const lastIds = [];
  // Unmapped numbering: estimates are levels above the lobby and cannot be
  // compared with the hotel's floor number (no false zero, review/phase2 F2).
  const compare = comparable && Number.isFinite(reportedLabel);
  for (const r of rows) {
    const d = r.floor;
    if (d.kind === 'none') out['No floor (not at hotel)'] += 1;
    else if (d.kind === 'not_shared') out['Not shared'] += 1;
    else if (d.kind === 'unknown') out['Floor unknown'] += 1;
    else if (d.kind === 'last') {
      out['Last est. only'] += 1;
      if (compare && d.est.label_high >= reportedLabel)
        lastIds.push(r.person.id);
    } else if (!compare) out.Below += 0;
    else if (d.est.label_low > reportedLabel) {
      out.Above += 1;
      priority.push(r.person.id);
    } else if (d.est.label_high >= reportedLabel) {
      out['At or near'] += 1;
      priority.push(r.person.id);
    } else out.Below += 1;
  }
  return {
    counts: out,
    priority,
    lastIds,
    lastAtOrAbove: lastIds.length,
    comparable: comparable !== false,
  };
}

export function partitionLine(counts, loaded) {
  return (
    Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ') + ` · of ${loaded} loaded`
  );
}

// --- formatting -----------------------------------------------------------------

/** Floor label text for a person (06 §3.4). */
export function floorText(display, { numbering = true } = {}) {
  const d = display;
  if (!d || d.kind === 'none') return '';
  if (d.kind === 'not_shared') return 'Floor not shared';
  if (d.kind === 'unknown')
    return `Floor unknown — ${UNKNOWN_TEXT[d.reason] || 'no estimate'}`;
  const e = d.est;
  const lo = numbering ? e.label_low : e.level_low;
  const hi = numbering ? e.label_high : e.level_high;
  const likely = numbering ? e.label_likely : e.level_likely;
  const age = `${formatAge(d.sampleAge)} ago`;
  const range = (u) => (lo === hi ? `${u} ${lo}` : `${u}s ${lo}–${hi}`);
  const unit = numbering ? 'floor' : 'level';
  if (d.kind === 'last')
    return `Last est. ${range(unit)} · ${age} · not current${d.stopped ? ' · vertical movement not tracked while phone is stopped' : ''}`;
  const base =
    e.confidence === 'high'
      ? `Likely ${unit} ${likely}${lo === hi ? '' : ` (${lo}–${hi})`} · ${age}`
      : `Rough: ${range(unit)} · ${age}`;
  return `${base}${e.moving ? ` · ${e.moving}` : ''}${d.aging ? ' · aging' : ''}${numbering ? '' : ' above lobby · Floor numbering not verified'}`;
}

export const UNKNOWN_TEXT = {
  no_barometer: 'phone has no pressure sensor',
  no_anchor: 'no ground reference since this phone entered the hotel',
  anchor_too_old: 'ground reference too old',
  sample_too_old: 'no recent reading',
  too_uncertain: 'estimate too uncertain (more than 5 floors)',
  position_stale: 'position not current',
  inconsistent_with_building: "reading does not fit this building's height",
  sensor_jump: 'pressure reading disturbed',
  not_at_lodging: 'not at the hotel',
};

export function formatAge(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

// Display units for every distance on screen (Display › Units; phase 5b).
// Meters by default; feet or yards switch to miles from 1,000.
let distanceUnit = 'm';
export function setDistanceUnit(unit) {
  distanceUnit = ['m', 'ft', 'yd'].includes(unit) ? unit : 'm';
}
export const getDistanceUnit = () => distanceUnit;

export function formatDistance(m, unit = distanceUnit) {
  if (unit === 'ft' || unit === 'yd') {
    const v = m / (unit === 'ft' ? 0.3048 : 0.9144);
    // Feet up to 1,500 ft (0.3 mi reads too coarse for a walk); yards to 1,000.
    return v < (unit === 'ft' ? 1500 : 1000)
      ? `${(Math.round(v / 10) * 10).toLocaleString('en-US')} ${unit}`
      : `${(m / 1609.344).toFixed(1)} mi`;
  }
  return m < 1000
    ? `${Math.round(m / 10) * 10} m`
    : `${(m / 1000).toFixed(1)} km`;
}

/** Rule distances ("within 1 km", "10 km watch") without a trailing ".0". */
export function formatRadius(m, unit = distanceUnit) {
  if (unit === 'ft' || unit === 'yd') {
    const v = m / (unit === 'ft' ? 0.3048 : 0.9144);
    // Two decimals under a mile so a rule reads true (1 km = 0.62 mi).
    const mi = m / 1609.344;
    return v < 1000
      ? `${Math.round(v).toLocaleString('en-US')} ${unit}`
      : `${+mi.toFixed(mi < 1 ? 2 : 1)} mi`;
  }
  return m < 1000 ? `${Math.round(m)} m` : `${+(m / 1000).toFixed(1)} km`;
}

/** Short lengths (accuracy, radii, heights) in the display unit, no rounding to 10. */
export function formatShort(m, unit = distanceUnit) {
  const per = unit === 'ft' ? 0.3048 : unit === 'yd' ? 0.9144 : 1;
  return `${Math.round(m / per)} ${unit === 'ft' || unit === 'yd' ? unit : 'm'}`;
}

/** 06 §3.11 words never to use on screen (case-insensitive whole words). */
export const BANNED_WORDS = [
  'all clear',
  'safe route',
  'safe zone',
  'evacuated',
  'accounted for',
  'nominal',
  'real-time',
  'exact location',
  'missing',
  'confirmed safe',
  'in room',
];

export function bannedWordHits(text) {
  const t = String(text || '').toLowerCase();
  return BANNED_WORDS.filter((w) =>
    new RegExp(`\\b${w.replace(/[-]/g, '\\-')}\\b`).test(t),
  );
}

// --- whole-view assessment (one pure pass; HUD and tests share it) ----------

const NEEDS_ORDER = [
  'at_or_above',
  'not_current',
  'unaccompanied',
  'outside_zone',
  'not_located',
];

/**
 * snapshot + hotel geometry → everything the rail shows. hotel = {xy, approximate}
 * from selectHotelFootprint; reportedLabel = floor label of a reported incident.
 */
export function assessSnapshot(
  snapshot,
  hotel,
  projector,
  { elapsed = 0, delayed = false, reportedLabel = null, placeId = null } = {},
) {
  const people = snapshot.participants || [];
  const lastEntry = new Map();
  for (const ev of snapshot.geofence_events || []) {
    if (ev.geofence_name !== 'Hotel perimeter') continue;
    const prev = lastEntry.get(ev.participant_id);
    if (!prev || Date.parse(ev.timestamp) > Date.parse(prev.timestamp))
      lastEntry.set(ev.participant_id, ev);
  }
  const place =
    (placeId && snapshot.places?.find((p) => p.id === placeId)) ||
    snapshot.places?.[0];
  // Rooming list of the site on screen only (a venue has none; review/phase3).
  const assignedById = new Map();
  for (const a of place?.room_assignments || [])
    if (Number.isFinite(a.floor_label))
      assignedById.set(a.participant_id, a.floor_label);
  const rows = [];
  const posById = new Map();
  for (const person of people) {
    const pos = positionState(person, elapsed, delayed);
    posById.set(person.id, pos);
    const est = person.floor_estimate;
    const entry = lastEntry.get(person.id);
    const stoppedSinceEntry =
      pos.id === 'POS-03' &&
      entry?.direction === 'enter' &&
      Date.parse(entry.timestamp) <= Date.parse(person.stationarySince);
    const floorLevelLow =
      est?.status === 'estimated' && pos.current ? est.level_low : undefined;
    const verdict = hotelVerdict(person, pos, hotel, projector, {
      stoppedSinceEntry,
      floorLevelLow,
    });
    const floor = floorDisplay(person, pos, verdict, est, elapsed);
    rows.push({
      person,
      pos,
      verdict,
      floor,
      assigned: assignedById.get(person.id) ?? null,
    });
  }
  const counts = rosterCounts(rows.map((r) => r.verdict));
  const zone = zoneLine(people, posById);
  // Mapped numbering, or the operator's answer (phase 3 Part E).
  let comparable =
    place?.levels_above_ground != null || place?.levels_source === 'operator';
  // A reported floor outside the building's floors is never counted: a
  // wrong numbering answer must not turn into a false zero (review/phase3).
  let outOfRange = null;
  const levels = place?.levels_above_ground;
  const ground = place?.ground_floor_label;
  if (
    comparable &&
    Number.isFinite(reportedLabel) &&
    Number.isFinite(levels) &&
    Number.isFinite(ground)
  ) {
    const top = ground + levels - 1;
    if (reportedLabel > top || reportedLabel < ground) {
      outOfRange = { top, ground };
      comparable = false;
    }
  }
  const partition = floorPartition(rows, reportedLabel, { comparable });
  partition.outOfRange = outOfRange;
  partition.numberingSource =
    place?.levels_source === 'operator' ? 'operator' : 'mapped';
  // EX-FLR-03: assigned at or above the reported floor, at the hotel (or last
  // seen there), and no floor from the phone. Joins the at-or-above group.
  partition.assignedNotDetected =
    comparable && Number.isFinite(reportedLabel)
      ? rows
          .filter(
            (r) =>
              r.assigned !== null &&
              r.assigned >= reportedLabel &&
              (r.floor.kind === 'unknown' ||
                r.floor.kind === 'not_shared' ||
                (r.floor.kind === 'none' && atHotelVerdict(r.verdict))),
          )
          .map((r) => r.person.id)
      : [];
  const atOrAboveIds = new Set([
    ...partition.priority,
    ...partition.lastIds,
    ...partition.assignedNotDetected,
  ]);
  const needs = [];
  for (const r of rows) {
    const reasons = [];
    if (atOrAboveIds.has(r.person.id)) reasons.push('at_or_above');
    if (r.pos.located && !r.pos.current) reasons.push('not_current');
    if (r.floor.kind === 'last' && Number.isFinite(reportedLabel))
      reasons.push('last_estimate');
    if (r.pos.current && r.person.unaccompanied) reasons.push('unaccompanied');
    if (r.pos.current && r.person.group_zone_state === 'outside')
      reasons.push('outside_zone');
    if (!r.pos.located) reasons.push('not_located');
    if (reasons.length) needs.push({ row: r, reasons });
  }
  const rank = (n) =>
    Math.min(...n.reasons.map((x) => NEEDS_ORDER.indexOf(x) + 1 || 3));
  needs.sort((a, b) => rank(a) - rank(b));
  const chaperones = rows.filter((r) => r.person.role === 'chaperone');
  return {
    rows,
    counts,
    rosterText: rosterLine(counts, people.length, {
      hotelApproximate: hotel.approximate,
    }),
    zone,
    partition,
    partitionText: partitionLine(partition.counts, people.length),
    needs,
    chaperones,
  };
}

// --- modes, top line and grouped exceptions (review/03 §1–2) -----------------

const GROUP_LABEL = {
  // One wording on every surface (screens S3 reviews).
  at_or_above: (f) => `May be at or above floor ${f}`,
  in_building: () => 'May still be inside',
  not_current: () => 'Not current',
  alone: () => 'Unaccompanied or outside group zone',
  not_located: () => 'Not located',
};

/** Reason a row needs attention, one group per person (first match wins). */
function groupFor(row, { incident, atOrAbove }) {
  const { pos, person, verdict } = row;
  if (incident && atOrAbove.has(person.id)) return 'at_or_above';
  if (!pos.located) return 'not_located';
  if (!pos.current) return 'not_current';
  if (
    incident &&
    (verdict.bucket === 'Inside (likely)' ||
      verdict.bucket === 'At hotel, undetermined')
  )
    return 'in_building';
  if (person.unaccompanied || person.group_zone_state === 'outside')
    return 'alone';
  return null;
}

const firstName = (name) => String(name || '').split(/\s+/)[0];

/**
 * ctx = { reportedLabel, incident: {kind, source, ageMin}|null, delayedS,
 *   asOf, hazard: {text, distanceM}|null, dataAgeS }
 * Returns { mode, degraded, chip, topLine, subLine, groups:[{key,label,rows}] }.
 */
export function deriveMode(assessment, ctx = {}) {
  const incident = Number.isFinite(ctx.reportedLabel);
  const part = assessment.partition;
  const byEstimate = new Set(incident ? part.priority : []);
  const byLast = new Set(incident ? part.lastIds || [] : []);
  const assignedAbove = new Set(incident ? part.assignedNotDetected || [] : []);
  const atOrAbove = new Set([...byEstimate, ...byLast, ...assignedAbove]);
  const groups = {};
  for (const row of assessment.rows) {
    const g = groupFor(row, { incident, atOrAbove });
    if (!g) continue;
    (groups[g] ||= []).push(row);
  }
  for (const rows of Object.values(groups))
    rows.sort(
      (a, b) =>
        (b.pos.age ?? Infinity) - (a.pos.age ?? Infinity) ||
        a.person.name.localeCompare(b.person.name),
    );
  // Unaccompanied first inside the "alone" group.
  groups.alone?.sort(
    (a, b) => Number(b.person.unaccompanied) - Number(a.person.unaccompanied),
  );
  const aboveRows = groups.at_or_above || [];
  const breakdown = {
    estimate: aboveRows.filter((r) => byEstimate.has(r.person.id)).length,
    last: aboveRows.filter((r) => byLast.has(r.person.id)).length,
    room: aboveRows.filter((r) => assignedAbove.has(r.person.id)),
    noFloor: assessment.rows.filter(
      (r) => atHotelVerdict(r.verdict) && r.floor.kind !== 'band',
    ).length,
  };
  const order = incident
    ? ['at_or_above', 'in_building', 'not_current', 'alone', 'not_located']
    : ['alone', 'not_current', 'not_located'];
  // In a report a person sits in the first group that fits; when that
  // leaves a count short of People's, the heading says so (S3 reviews:
  // People "4 not current" beside "Not current 3").
  const listedAbove = {
    not_current: assessment.rows.some(
      (r) =>
        incident &&
        atOrAbove.has(r.person.id) &&
        r.pos.located &&
        !r.pos.current,
    ),
    not_located: assessment.rows.some(
      (r) => incident && atOrAbove.has(r.person.id) && !r.pos.located,
    ),
  };
  const list = order
    .filter((k) => groups[k]?.length)
    .map((k) => ({
      key: k,
      label: `${GROUP_LABEL[k](ctx.reportedLabel)}${listedAbove[k] ? ' · not listed above' : ''}`,
      rows: groups[k],
    }));
  const total = list.reduce((n, g) => n + g.rows.length, 0);
  const degraded = (ctx.delayedS ?? 0) > 45;
  const mode = incident ? 'incident' : ctx.hazard ? 'watch' : 'monitoring';
  let topLine;
  let subLine = null;
  if (mode === 'incident') {
    const inBuilding = groups.in_building?.length || 0;
    const missing =
      (groups.not_current?.length || 0) + (groups.not_located?.length || 0);
    const inc = ctx.incident;
    const head = `${inc ? `${cap(inc.kind)} reported` : 'Incident reported'}, floor ${ctx.reportedLabel} (${inc ? `${inc.source}, ${inc.ageMin} min ago, ` : 'operator entry, '}not verified)`;
    const tail = `${missing} not current or not located`;
    const operator =
      part.numberingSource === 'operator'
        ? ' · floor numbering from operator entry, not verified'
        : '';
    topLine = part.comparable
      ? `${head} — ${atOrAboveText(atOrAbove.size, breakdown, ctx.reportedLabel)}, ${inBuilding} more may still be inside, ${tail}${operator}`
      : part.outOfRange
        ? `${head} — reported floor ${ctx.reportedLabel} is outside this building's floors (${part.outOfRange.ground}–${part.outOfRange.top}${operator ? ', operator entry' : ''}); check the floor numbering; ${inBuilding} may still be inside, ${tail}`
        : `${head} — floor estimates can't be matched to this building's floor numbers; ${inBuilding} may still be inside, ${tail}`;
    subLine =
      'No official instruction about this incident on file · Headcount: not reported';
  } else if (degraded) {
    topLine = `Traveler data delayed ${formatAge(ctx.delayedS)} — counts as of ${ctx.asOf}; positions shown one state older`;
  } else if (mode === 'watch') {
    topLine = `${ctx.hazard.text} — check paths and outdoor plans`;
  } else if (total) {
    const first = list[0].rows[0];
    const reason =
      list[0].key === 'alone'
        ? first.person.unaccompanied
          ? 'unaccompanied outside group zone'
          : 'outside group zone'
        : list[0].key === 'not_current'
          ? first.pos.label.toLowerCase()
          : 'no location reported';
    topLine = `No incident reported · ${total} to check on — first: ${first.person.name}, ${reason}`;
  } else {
    topLine = `No incident reported · no one needs a check-in · traveler data ${formatAge(ctx.dataAgeS ?? 0)} old`;
  }
  if (degraded && mode === 'incident') topLine += ` · data as of ${ctx.asOf}`;
  const chip = {
    monitoring: 'MONITORING',
    watch: 'WATCH',
    incident: 'INCIDENT',
  }[mode];
  return {
    mode,
    degraded,
    chip,
    topLine,
    subLine,
    groups: list,
    total,
    assignedAbove,
    byLast,
    comparable: part.comparable,
    outOfRange: part.outOfRange || null,
    numberingSource: part.numberingSource || 'mapped',
    breakdown: {
      estimate: breakdown.estimate,
      last: breakdown.last,
      room: breakdown.room.length,
      noFloor: breakdown.noFloor,
      text: breakdownText(breakdown, ctx.reportedLabel),
    },
  };
}

/** "2 by phone estimate, 1 by last estimate, 1 assigned above, floor not known" */
function breakdownText(b, reported) {
  const parts = [];
  if (b.estimate) parts.push(`${b.estimate} by phone estimate`);
  if (b.last) parts.push(`${b.last} by last estimate (not current)`);
  if (b.room.length)
    parts.push(
      `${b.room.length} assigned ${b.room.every((r) => r.assigned > reported) ? 'above' : 'at or above'}, floor not known`,
    );
  return parts.join(', ');
}

function atOrAboveText(n, b, reported) {
  // Never a bare zero while people inside have no current floor.
  if (!n)
    return b.noFloor
      ? `no one at or above by phone estimate or room list — ${b.noFloor} inside without a current floor estimate`
      : 'no one at or above by phone estimate or room list';
  return `${n} may be at or above (${breakdownText(b, reported)})`;
}

function cap(s) {
  return String(s || '').replace(/^./, (m) => m.toUpperCase());
}
void firstName;

// --- floors: per-floor occupancy and roster (phase 2, review/phase2 F3–F5) ----

/** Why someone assigned to a floor is not placed on it (never "missing"). */
export function notDetectedReason(row, { numbering = true } = {}) {
  const d = row.floor;
  if (d.kind === 'band')
    return `Estimate on another floor · ${floorText(d, { numbering })}`;
  if (d.kind === 'last' || d.kind === 'unknown' || d.kind === 'not_shared')
    return floorText(d, { numbering });
  const b = row.verdict.bucket;
  if (b === 'Not located') return 'No location reported';
  if (atHotelVerdict(row.verdict))
    return b === 'Not current'
      ? `Last seen at the hotel · ${row.pos.label}`
      : 'At the hotel · no floor estimate';
  if (b === 'Not current') return row.pos.label;
  if (b === 'Outside, nearby') return 'Outside the hotel, nearby';
  if (b === 'Away') return 'Away from the hotel';
  return 'Not at the hotel';
}

const covers = (est, label) =>
  est && est.label_low <= label && est.label_high >= label;

/**
 * Per-floor read for the cutaway. A floor is "detected" when any current
 * estimate range covers it. Per floor: likely (most likely here), possible
 * (range covers it, most likely elsewhere), lastCovers (last estimate covers
 * it, not current), and the assigned people split into floorNotKnown (at the
 * hotel, no floor), elsewhere (estimate on another floor) and away (not at the
 * hotel now). States: reported · occupied · possible · floor-not-known (amber)
 * · lobby · quiet. "quiet" is never shown as a word.
 */
export function floorOccupancy(assessment, place, reportedLabel = null) {
  const levels = place?.levels_above_ground;
  const ground = place?.ground_floor_label;
  const c = assessment.partition.counts;
  const footer = {
    loaded: assessment.rows.length,
    'floor not known': c['Floor unknown'],
    'not shared': c['Not shared'],
    'last estimate only': c['Last est. only'],
  };
  if (!Number.isFinite(levels) || levels < 1 || !Number.isFinite(ground))
    return {
      available: false,
      reason:
        place?.levels_source === 'operator'
          ? 'Floors above ground not entered · add them in the numbering answer to draw Floors'
          : 'Floor count not mapped for this building · floor numbering not verified',
      floors: [],
      footer,
      reportedLabel,
    };
  const floors = [];
  for (let level = levels - 1; level >= 0; level--)
    floors.push({
      label: level + ground,
      level,
      likely: [],
      possible: [],
      lastCovers: [],
      assigned: [],
      floorNotKnown: [],
      elsewhere: [],
      away: [],
      state: 'quiet',
      amber: false,
    });
  const byLabel = new Map(floors.map((f) => [f.label, f]));
  for (const row of assessment.rows) {
    const d = row.floor;
    if (d.kind === 'band' || d.kind === 'last') {
      const e = d.est;
      for (let l = e.label_low; l <= e.label_high; l++) {
        const f = byLabel.get(l);
        if (!f) continue;
        if (d.kind === 'last') f.lastCovers.push(row);
        else if (l === e.label_likely) f.likely.push(row);
        else f.possible.push(row);
      }
    }
    if (row.assigned !== null) byLabel.get(row.assigned)?.assigned.push(row);
  }
  for (const f of floors) {
    for (const row of f.assigned) {
      const d = row.floor;
      if ((d.kind === 'band' || d.kind === 'last') && covers(d.est, f.label))
        continue; // already listed as likely / possible / last estimate
      if (d.kind === 'band' || d.kind === 'last') f.elsewhere.push(row);
      else if (
        d.kind === 'unknown' ||
        d.kind === 'not_shared' ||
        atHotelVerdict(row.verdict)
      )
        f.floorNotKnown.push(row);
      else f.away.push(row);
    }
    f.amber = f.floorNotKnown.length > 0;
    f.state =
      f.label === reportedLabel
        ? 'reported'
        : f.likely.length
          ? 'occupied'
          : f.possible.length || f.lastCovers.length
            ? 'possible'
            : f.amber
              ? 'floor-not-known'
              : f.level === 0
                ? 'lobby'
                : 'quiet';
  }
  return { available: true, floors, footer, reportedLabel };
}

const assignedNote = (row, f) =>
  row.assigned === f.label
    ? 'assigned here'
    : row.assigned !== null
      ? `assigned floor ${row.assigned}`
      : '';

/** Floor card sections, in order; optional empty sections are omitted. */
export function floorRoster(occupancy, label, { numbering = true } = {}) {
  const f = occupancy.floors.find((x) => x.label === label);
  if (!f) return null;
  const withNote = (row, extra) => ({
    row,
    note: [floorText(row.floor, { numbering }), assignedNote(row, f), extra]
      .filter(Boolean)
      .join(' · '),
  });
  const sections = [
    {
      key: 'likely',
      title: 'Most likely here',
      rows: f.likely.map((r) => withNote(r)),
      none: 'No current estimate puts anyone most likely on this floor',
    },
  ];
  const add = (key, title, rows, collapsed = false) => {
    if (rows.length) sections.push({ key, title, rows, collapsed });
  };
  add(
    'possible',
    `Possibly here (estimate range includes floor ${f.label})`,
    f.possible.map((r) => withNote(r)),
  );
  add(
    'last',
    `Last estimate includes floor ${f.label} · not current`,
    f.lastCovers.map((r) => withNote(r)),
  );
  add(
    'not_known',
    'Assigned here, floor not known',
    f.floorNotKnown.map((row) => ({ row, note: notDetectedReason(row) })),
  );
  add(
    'elsewhere',
    'Assigned here, estimate on another floor',
    f.elsewhere.map((row) => ({ row, note: notDetectedReason(row) })),
  );
  add(
    'away',
    'Assigned here, not at the hotel now',
    f.away.map((row) => ({ row, note: notDetectedReason(row) })),
    true,
  );
  return { floor: f, sections };
}

/** "Whole group (27): floor not known 2 · last estimate only 1" — one
 *  form for the floor not known, and no bucket that is zero (S3 reviews). */
export function footerLine(footer) {
  const { loaded, ...rest } = footer;
  const parts = Object.entries(rest)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k} ${v}`);
  return `Whole group (${loaded})${parts.length ? `: ${parts.join(' · ')}` : ''}`;
}

// --- trip-wide incidents (phase 3 G3) -------------------------------------------

/**
 * When the site on screen has no report but another site of the trip does,
 * return a mode that says so (never "No incident reported"), with a group of
 * people whose phone estimate at that place reaches the reported floor.
 * mode: deriveMode result; ctx = {snapshot, activePlaceId, siteName(placeId),
 * rows (assessment rows)}. Returns the mode unchanged when not needed.
 */
export function withTripIncidents(mode, ctx) {
  const reps = (ctx.snapshot.reported_incidents || []).filter(
    (r) => r.place_id !== ctx.activePlaceId,
  );
  if (!reps.length || mode.mode === 'incident') return mode;
  const r = reps[0];
  const where = ctx.siteName(r.place_id);
  const rows = (ctx.rows || []).filter((row) => {
    const e = row.person.floor_estimate;
    return (
      e?.status === 'estimated' &&
      e.place_id === r.place_id &&
      Number.isFinite(e.label_high) &&
      e.label_high >= r.floor_label
    );
  });
  for (const row of rows) {
    const e = row.person.floor_estimate;
    row.elsewhereReason = `Phone estimate at ${where}: floor ${e.label_likely}${e.label_low !== e.label_high ? ` (${e.label_low}–${e.label_high})` : ''}`;
  }
  const group = rows.length
    ? [
        {
          key: 'elsewhere_above',
          label: `At or above floor ${r.floor_label} at ${where} (by phone estimate)`,
          rows,
        },
      ]
    : [];
  const more =
    reps.length > 1 ? ` · ${reps.length - 1} more report(s) on this trip` : '';
  return {
    ...mode,
    mode: 'incident_elsewhere',
    chip: 'INCIDENT · OTHER SITE',
    topLine: `${cap(r.kind)} reported at ${where}, floor ${r.floor_label} (${r.source}, not verified) — ${rows.length} at or above by phone estimate there · not the site on screen${more}`,
    subLine: `On screen: ${ctx.siteName(ctx.activePlaceId)} · ${mode.topLine}`,
    groups: [
      ...group,
      ...mode.groups.filter((g) => !rows.length || g.key !== 'elsewhere_above'),
    ],
    total: mode.total + rows.length,
    elsewhere: { placeId: r.place_id, where, floor: r.floor_label },
  };
}

/**
 * Copied text is read aloud: "22m" could be meters. Spell out time units
 * next to ages (phase 5b supervision F2): "22m ago" → "22 min ago".
 */
export function spokenAges(text) {
  return String(text)
    .replace(/\b(\d+)h (\d+)m\b/g, '$1 h $2 min')
    .replace(/\b(\d+)m\b(?= ago| old|,|\)| ·)/g, '$1 min')
    .replace(/\b(\d+)s\b(?= ago| old)/g, '$1 s');
}
