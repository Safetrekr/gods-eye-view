// Custom paths (phase 4, PHASE-4-PLAN): operator waypoints, avoid-areas,
// saved paths per trip and day. Pure model + requests; drawing lives in
// twinCustomPathsLayer.js and the editor UI in twinPathEditor.js.
import { formatDistance, haversineM, makeProjector } from './twinData.js';
import { HAZARD_NEAR_M, hazardProximity, walkMinutes } from './twinPaths.js';
import { driveMinutes } from './twinRoutes.js';

export const AVOID_REASONS = Object.freeze([
  ['construction', 'Construction'],
  ['crowd', 'Crowd / event'],
  ['lighting', 'Poor lighting'],
  ['traffic', 'Traffic'],
  ['other', 'Other'],
]);
export const AVOID_RADII = Object.freeze([50, 100, 200]);
export const LONG_RATIO = 1.8;
export const REACH_M = 150;

const reasonLabel = (key) =>
  (AVOID_REASONS.find(([k]) => k === key) || [, 'Other'])[1];

// --- geometry -------------------------------------------------------------------

/** Circle as a closed ring of {lat, lon} (Valhalla exclude_polygons). */
export function circleRing(center, radiusM, n = 24) {
  const proj = makeProjector(center);
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    ring.push(proj.toLL(radiusM * Math.cos(t), radiusM * Math.sin(t)));
  }
  return ring;
}

/** Points every ~stepM along a path (so short crossings are not missed). */
function densify(path, stepM = 8) {
  const out = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    out.push(a);
    const b = path[i + 1];
    if (!b) break;
    const n = Math.floor(haversineM(a, b) / stepM);
    for (let k = 1; k < n; k++)
      out.push({
        lat: a.lat + ((b.lat - a.lat) * k) / n,
        lon: a.lon + ((b.lon - a.lon) * k) / n,
      });
  }
  return out;
}

/** Runs of path points inside any avoid-area (for amber overlay dashes). */
export function crossingRuns(geometry, areas) {
  if (!areas.length) return [];
  const runs = [];
  let run = null;
  for (const p of densify(geometry, 4)) {
    const inside = areas.some((a) => haversineM(p, a.center) <= a.radiusM);
    if (inside) (run ||= []).push(p);
    else if (run) {
      if (run.length > 1) runs.push(run);
      run = null;
    }
  }
  if (run?.length > 1) runs.push(run);
  return runs;
}

/** Avoid-areas the path enters (areas are circles: {id, center, radiusM}). */
export function avoidCrossings(geometry, areas) {
  const pts = densify(geometry);
  return areas.filter((a) =>
    pts.some((p) => haversineM(p, a.center) <= a.radiusM),
  );
}

/**
 * Insert a waypoint where it adds the least distance.
 * points = [from, ...waypoints, to] → new array.
 */
export function insertWaypoint(points, wp) {
  let best = 1;
  let bestCost = Infinity;
  for (let i = 1; i < points.length; i++) {
    const cost =
      haversineM(points[i - 1], wp) +
      haversineM(wp, points[i]) -
      haversineM(points[i - 1], points[i]);
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  }
  return [...points.slice(0, best), wp, ...points.slice(best)];
}

// --- requests -------------------------------------------------------------------

/**
 * Ask for a path through the points, avoiding the areas. Valhalla first (it
 * honours avoid-areas); OSRM through the waypoints if it is down — then the
 * avoid-areas are only checked, and the result says so.
 */
export async function requestPath(
  { points, profile = 'foot', areas = [] },
  { signal, fetchImpl = fetch } = {},
) {
  // An area that holds the start, end or a waypoint cannot be avoided: the
  // router would refuse. Leave it out and say so (checks name it).
  const endpointAreas = areas.filter((a) =>
    points.some((p) => haversineM(p, a.center) <= a.radiusM),
  );
  const avoidable = areas.filter((a) => !endpointAreas.includes(a));
  try {
    const res = await fetchImpl('/api/twin-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points,
        profile,
        // The polygon circumscribes the circle, so no part of it is left out.
        avoid: avoidable.map((a) =>
          circleRing(a.center, a.radiusM / Math.cos(Math.PI / 16), 16),
        ),
      }),
      signal,
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'routing failed');
    return {
      ...json,
      avoidApplied: true,
      endpointAreas,
      avoidedAreas: avoidable,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    const coords = points
      .map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`)
      .join(';');
    const res = await fetchImpl(
      `/api/route?profile=${profile}&coords=${coords}`,
      { signal },
    );
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'routing failed');
    return {
      ok: true,
      engine: 'osrm',
      distanceM: json.distanceM,
      durationS: json.durationS,
      geometry: json.geometry.map(([lon, lat]) => ({ lat, lon })),
      avoidApplied: false,
      endpointAreas,
      fallbackReason: /No path could be found/i.test(String(error?.message))
        ? 'no path avoids every area — the areas block all ways through; move or shrink one'
        : String(error?.message || error),
    };
  }
}

// --- checks ---------------------------------------------------------------------

/**
 * Flags on a custom path (PHASE-4 E). ctx = {points, areas, hazards, dark,
 * profile}. Returns [{key, text, warn}] — never "safe" or "clear".
 */
export function pathChecks(result, ctx) {
  const flags = [];
  const from = ctx.points[0];
  const to = ctx.points[ctx.points.length - 1];
  const straight = haversineM(from, to);
  const inside = result.endpointAreas || [];
  if (inside.length)
    flags.push({
      key: 'avoid_endpoint',
      warn: true,
      text: `The start, end or a waypoint is inside an avoid-area (${inside.map((a) => reasonLabel(a.reason)).join(', ')}) — move it or the area; that area is not avoided`,
    });
  const crossed = avoidCrossings(result.geometry, ctx.areas || []).filter(
    (a) => !inside.some((b) => b.id === a.id),
  );
  if (crossed.length)
    flags.push({
      key: 'avoid',
      warn: true,
      text: `Enters ${crossed.length} avoid-area${crossed.length > 1 ? 's' : ''}: ${crossed.map((a) => `${reasonLabel(a.reason)}${a.note ? ` (${a.note})` : ''}`).join(', ')}${result.avoidApplied ? '' : ' — avoid-areas could not be applied by the router'}`,
    });
  else if (!result.avoidApplied && ctx.areas?.length)
    flags.push({
      key: 'avoid_not_applied',
      warn: true,
      text: 'Avoid-areas not applied by the router (fallback) — checked instead: none entered',
    });
  const hz = hazardProximity(result.geometry, ctx.hazards || []);
  if (ctx.hazardsStatus === 'unavailable')
    flags.push({
      key: 'heat_unknown',
      warn: false,
      text: 'Heat detections unavailable right now — not checked',
    });
  else if (hz.hazard && hz.distanceM <= HAZARD_NEAR_M)
    flags.push({
      key: 'heat',
      warn: true,
      text: `Within ${formatDistance(hz.distanceM)} of a heat detection`,
    });
  if (straight > 50 && result.distanceM > LONG_RATIO * straight)
    flags.push({
      key: 'long',
      warn: true,
      text: `${(result.distanceM / straight).toFixed(1)}× the straight line — check the waypoints`,
    });
  const end = result.geometry[result.geometry.length - 1];
  const gap = end ? haversineM(end, to) : Infinity;
  const startGap = result.geometry[0]
    ? haversineM(result.geometry[0], from)
    : Infinity;
  if (gap > REACH_M || startGap > REACH_M)
    flags.push({
      key: 'reach',
      warn: true,
      text:
        gap > REACH_M
          ? `Ends ${formatDistance(gap)} from the destination — the network does not reach it`
          : `Starts ${formatDistance(startGap)} from the start point — the network does not reach it`,
    });
  if (ctx.profile !== 'car' && ctx.leg)
    flags.push({
      key: ctx.leg.dark ? 'dark' : 'daylight',
      warn: ctx.leg.dark,
      text: ctx.leg.darkText,
    });
  else if (ctx.profile !== 'car' && ctx.day == null)
    flags.push({
      key: 'dark_unknown',
      warn: false,
      text: 'No day set — after dark not checked',
    });
  else if (ctx.dark && ctx.profile !== 'car')
    flags.push({
      key: 'dark',
      warn: true,
      text: 'A stop that day ends after dark — check when this path is walked',
    });
  return flags;
}

export function timeText(result, profile) {
  if (profile === 'car') {
    const d = driveMinutes(result.durationS);
    return d
      ? `drive ${d[0]}–${d[1]} min (no live traffic)`
      : 'drive time unknown';
  }
  const w = walkMinutes(result.distanceM);
  return `walk ${w[0]}–${w[1]} min (group pace)`;
}

// --- saved paths ----------------------------------------------------------------

let seq = 0;
export const newId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** A saved path record (prototype storage; production table in 07). */
export function savedPathRecord(edit, result, { stamp, siteKeys = [] } = {}) {
  return {
    id: edit.savedId || newId('path'),
    name: edit.name,
    day: edit.day ?? null,
    profile: edit.profile,
    fromLabel: edit.fromLabel,
    toLabel: edit.toLabel,
    points: edit.points,
    areaIds: (edit.areas || []).map((a) => a.id),
    endpointAreaIds: (result.endpointAreas || []).map((a) => a.id),
    // Only what the router actually routed around (review/phase4 H1).
    routedAroundIds: result.avoidApplied
      ? (result.avoidedAreas || []).map((a) => a.id)
      : [],
    notes: edit.notes || '',
    eventKey: edit.eventKey || null,
    leg: edit.eventKey ? edit.leg || null : null,
    siteKeys,
    distanceM: result.distanceM,
    durationS: result.durationS ?? null,
    engine: result.engine,
    avoidApplied: Boolean(result.avoidApplied),
    geometry: result.geometry,
    savedBy: stamp,
    reviewedBy: null,
  };
}

const short = (s, n = 28) =>
  String(s || '').length > n
    ? `${String(s)
        .slice(0, n - 1)
        .trim()}…`
    : s;

/** Default name: "Fairmont Austin → Long Center". Day and mode are facets. */
export function defaultName(edit) {
  return `${short(edit.fromLabel)} → ${short(edit.toLabel)}`;
}

/**
 * What a saved path did with the trip's avoid-areas, in plain words — never
 * "avoids" next to "enters" (review/phase4 H1).
 */
export function avoidStatus(p, areas) {
  const inside = p.endpointAreaIds || [];
  const crossed = avoidCrossings(p.geometry, areas).filter(
    (a) => !inside.includes(a.id),
  );
  const parts = [];
  if (crossed.length)
    parts.push(
      `ENTERS avoid-area: ${crossed.map((a) => reasonLabel(a.reason).toLowerCase()).join(', ')}`,
    );
  const insideAreas = areas.filter((a) => inside.includes(a.id));
  if (insideAreas.length)
    parts.push(
      `a stop is inside avoid-area: ${insideAreas.map((a) => reasonLabel(a.reason).toLowerCase()).join(', ')}`,
    );
  const around = areas.filter(
    (a) =>
      (p.routedAroundIds || []).includes(a.id) &&
      !crossed.includes(a) &&
      !inside.includes(a.id),
  );
  if (around.length)
    parts.push(
      `routed around: ${around.map((a) => reasonLabel(a.reason).toLowerCase()).join(', ')}`,
    );
  if (!p.avoidApplied && p.areaIds?.length && !crossed.length)
    parts.push('avoid-areas not applied (fallback) · checked: none entered');
  const newer = areas.filter((a) => !(p.areaIds || []).includes(a.id));
  if (newer.length)
    parts.push(
      `planned before ${newer.length} newer avoid-area${newer.length > 1 ? 's' : ''} — plan again to route around ${newer.length > 1 ? 'them' : 'it'}`,
    );
  return {
    text: parts.join(' · '),
    warn: crossed.length > 0 || insideAreas.length > 0 || newer.length > 0,
  };
}

/** Flag keys at review time, to notice when the flags change later. */
export const flagSignature = (flags) =>
  flags
    .map((f) => f.key)
    .sort()
    .join(',');

/** Brief lines for a day's saved paths that touch a site. */
export function savedPathLines(
  saved,
  { day, siteKey, areas = [], checks = () => [], leg = () => null },
) {
  return saved
    .filter(
      (p) =>
        (day == null || p.day == null || p.day === day) &&
        (!siteKey || p.siteKeys.includes(siteKey)),
    )
    .map((p) => {
      const st = avoidStatus(p, areas);
      const flags = checks(p).filter((f) => !/^avoid/.test(f.key));
      const reviewed = reviewState(p, areas, flags);
      const flagText = flags.map((f) => f.text).join(' · ');
      const lg = leg(p);
      return {
        id: p.id,
        text: `${p.name}${p.day ? ` · Day ${p.day}` : ''}${lg ? ` · ${lg.text}` : ''} · ${p.profile === 'car' ? 'drive' : 'walk'}: ${formatDistance(p.distanceM)} · ${timeText(p, p.profile)}${st.text ? ` · ${st.text}` : ''}${flagText ? ` · ${flagText}` : ''} · ${reviewed.text}`,
        warn: st.warn || flags.some((f) => f.warn) || !reviewed.ok,
      };
    });
}

/**
 * Review state: reviewed only while the avoid-area outcome is unchanged.
 * Returns {ok, text}.
 */
export function reviewState(p, areas, flags = []) {
  if (!p.reviewedBy) return { ok: false, text: 'not reviewed' };
  const now = reviewSignature(p, areas, flags);
  if (p.reviewedStatus !== undefined && p.reviewedStatus !== now)
    return {
      ok: false,
      text: `review out of date (avoid-areas or checks changed since ${p.reviewedBy})`,
    };
  return { ok: true, text: `reviewed by ${p.reviewedBy}` };
}

/** Storage (browser, per trip): {paths: [], areas: []}. */
export function loadStore(raw) {
  try {
    const v = JSON.parse(raw || '{}');
    return {
      paths: Array.isArray(v.paths) ? v.paths : [],
      areas: Array.isArray(v.areas) ? v.areas : [],
    };
  } catch {
    return { paths: [], areas: [] };
  }
}

export const areaLabel = (a) =>
  `${reasonLabel(a.reason)}${a.note ? ` · ${a.note}` : ''} · ${a.radiusM} m`;

/** What a review covers: the avoid-area outcome and the flags at that time. */
export function reviewSignature(p, areas, flags = []) {
  return `${avoidStatus(p, areas).text}|${flagSignature(flags.filter((f) => !/^avoid/.test(f.key)))}`;
}

/**
 * Nearest named street to a point from the site's OpenStreetMap roads
 * (phase 4 deferred: street names for waypoints). roads: [{name, coords}].
 * Returns {name, d} within maxM, else null.
 */
export function nearestStreet(pt, roads = [], maxM = 40) {
  const k = Math.cos((pt.lat * Math.PI) / 180) * 111320;
  const xy = (q) => [(q.lon - pt.lon) * k, (q.lat - pt.lat) * 110540];
  let best = null;
  for (const r of roads) {
    if (!r.name || !r.coords?.length) continue;
    for (let i = 0; i < r.coords.length - 1; i += 1) {
      const [ax, ay] = xy(r.coords[i]);
      const [bx, by] = xy(r.coords[i + 1]);
      const dx = bx - ax;
      const dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d <= maxM && (!best || d < best.d)) best = { name: r.name, d };
    }
  }
  return best;
}

/** "near Red River Street" or the coordinates when no street is known. */
export function waypointText(pt, street) {
  return street
    ? `${street.d > 15 ? 'near ' : ''}${street.name}`
    : `${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}`;
}

/**
 * Out / back legs tied to an event (phase 4 deferred). The out leg arrives
 * for the event's start; the back leg leaves at its end (start + 2 h when no
 * end is set). event = {title, startMs, endMs}; returns {fromMs, toMs, dark,
 * text, darkText} — times are estimates from the router's duration.
 */
export function legWindow({ leg, event, durationS, sunsetMs, fmt }) {
  if (!event || !leg || !Number.isFinite(event.startMs)) return null;
  const dur = Math.max(60, durationS || 0) * 1000;
  const endMs = Number.isFinite(event.endMs)
    ? event.endMs
    : event.startMs + 2 * 3600000;
  const fromMs = leg === 'out' ? event.startMs - dur : endMs;
  const toMs = fromMs + dur;
  const text =
    leg === 'out'
      ? `Out leg · leave about ${fmt(fromMs)} to arrive for ${event.title} at ${fmt(event.startMs)}`
      : `Back leg · after ${event.title}${Number.isFinite(event.endMs) ? ` ends ${fmt(endMs)}` : ` (no end time set · assumed ${fmt(endMs)})`} · about ${fmt(fromMs)}–${fmt(toMs)}`;
  const dark = Number.isFinite(sunsetMs) && toMs > sunsetMs;
  const darkText = !Number.isFinite(sunsetMs)
    ? 'Sunset unknown — after dark not checked'
    : dark
      ? `On the way after sunset (${fmt(sunsetMs)}) — check lighting on this path`
      : `On the way before sunset (${fmt(sunsetMs)})`;
  return { fromMs, toMs, dark, text, darkText };
}

/**
 * Text a lead pastes to chaperones for a reviewed saved path (phase 4
 * deferred). Reviewed paths only; never a traveler's name or position.
 * Returns null when the path is not (or no longer) reviewed.
 */
export function chaperoneShareText(
  p,
  { review, leg, via, flags = [], areas = [] },
) {
  if (!review?.ok) return null;
  const st = avoidStatus(p, areas);
  return [
    `PATH FOR CHAPERONES · ${p.name}`,
    `${p.day ? `Day ${p.day}` : 'Any day'} · ${p.profile === 'car' ? 'drive' : 'walk'} · ${formatDistance(p.distanceM)} · ${timeText(p, p.profile)}`,
    ...(leg ? [leg.text] : []),
    ...(via ? [`Via ${via}`] : []),
    ...(st.text ? [st.text] : []),
    ...flags.filter((f) => !/^avoid/.test(f.key)).map((f) => f.text),
    ...(p.notes ? [`Notes: ${p.notes}`] : []),
    `Suggested path, ${review.text} · a review is a check, not an approval · follow local instructions on the day`,
    'Prototype · not sent — copied for a message to chaperones',
  ].join('\n');
}
