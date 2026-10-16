// Route from any place (phase 3 Part C, ROUND-2 §7). On demand only, one
// route set visible at a time, never computed without an operator action.
// Same wording and checks as the rally-point path: primary + alternate,
// 1 km heat-detection check, "Suggested · unverified".
import { formatDistance, haversineM, makeProjector } from './twinData.js';
import { avoidCrossings } from './twinCustomPaths.js';
import {
  fetchRoute,
  hazardProximity,
  HAZARD_NEAR_M,
  sharedStart,
  walkMinutes,
} from './twinPaths.js';

export const MODES = Object.freeze({
  foot: { key: 'foot', verb: 'Walk', noun: 'walking' },
  car: { key: 'car', verb: 'Drive', noun: 'driving' },
});

/** OSRM duration as a range: no live traffic, so widen it (−10 % / +40 %). */
export function driveMinutes(durationS) {
  if (!Number.isFinite(durationS)) return null;
  return [
    Math.max(1, Math.round((durationS * 0.9) / 60)),
    Math.max(1, Math.ceil((durationS * 1.4) / 60)),
  ];
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Group centre: median of current positions within `radiusM` of the site.
 * Returns null with fewer than 3 people (not a meaningful centre).
 */
export function groupCentre(rows, siteCenter, radiusM = 600) {
  const pts = rows
    .filter((r) => r.pos.current && r.person.coordinates)
    .map((r) => ({
      lat: r.person.coordinates.lat,
      lon: r.person.coordinates.lng,
    }))
    .filter((p) => haversineM(p, siteCenter) <= radiusM);
  if (pts.length < 3) return null;
  return {
    lat: median(pts.map((p) => p.lat)),
    lon: median(pts.map((p) => p.lon)),
    n: pts.length,
  };
}

/** Plan primary + alternate (≤ 3 requests), like the rally-point path. */
export async function planRouteSet(
  from,
  to,
  { profile = 'foot', signal, hazards = [] } = {},
) {
  const primary = await fetchRoute(from, to, null, signal, profile);
  const out = [{ kind: 'primary', ...primary }];
  const proj = makeProjector(from);
  const [tx, ty] = proj.toXY(to.lat, to.lon);
  const len = Math.hypot(tx, ty) || 1;
  const side = Math.max(120, 0.45 * len);
  for (const sign of [1, -1]) {
    const via = proj.toLL(
      tx / 2 + (sign * -ty * side) / len,
      ty / 2 + (sign * tx * side) / len,
    );
    try {
      const alt = await fetchRoute(from, to, via, signal, profile);
      const shared = sharedStart(alt.geometry, primary.geometry);
      // An alternate more than 1.6× longer is not a useful alternate.
      if (alt.distanceM > primary.distanceM * 1.6) continue;
      if (shared.fraction < 0.5 || sign === -1) {
        out.push({
          kind: 'alternate',
          ...alt,
          sharedStartM: Math.round(shared.sharedM),
        });
        break;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  for (const p of out) {
    p.profile = profile;
    p.walk = profile === 'foot' ? walkMinutes(p.distanceM) : null;
    p.drive = profile === 'car' ? driveMinutes(p.durationS) : null;
    p.hazard = hazardProximity(p.geometry, hazards);
  }
  return out;
}

/**
 * Cards for a route set. req = {fromLabel, toLabel, profile}; pace (walking
 * only) from the weather (simulated flagged).
 */
export function routeCards(
  paths,
  req,
  { pace = null, simulatedFires = false, areas = [] } = {},
) {
  const mode = MODES[req.profile] || MODES.foot;
  return paths.map((p) => {
    const flagged = p.hazard?.hazard && p.hazard.distanceM <= HAZARD_NEAR_M;
    const time =
      mode.key === 'foot'
        ? `walk ${p.walk[0]}–${p.walk[1]} min (group pace)`
        : p.drive
          ? `drive ${p.drive[0]}–${p.drive[1]} min (no live traffic)`
          : 'drive time unknown';
    const lines = [
      'Suggested · unverified · not checked for closures, crowds or lighting',
    ];
    if (mode.key === 'car')
      lines.push(
        'Driving path from OpenStreetMap routing · no traffic, parking or drop-off checked',
      );
    if (flagged)
      lines.push(
        `Within 1 km of a ${simulatedFires ? 'SIMULATED ' : ''}heat detection (${formatDistance(p.hazard.distanceM)}) — check before use`,
      );
    // Every drawn path is checked against the trip's avoid-areas (phase 4 H3).
    const entered = avoidCrossings(p.geometry || [], areas);
    if (entered.length)
      lines.push(
        `Enters avoid-area: ${entered.map((a) => a.reason).join(', ')} — plan your own path to go around it`,
      );
    if (p.kind === 'alternate' && p.sharedStartM > 40)
      lines.push(`Shares the first ${p.sharedStartM} m with the primary path`);
    if (pace && mode.key === 'foot')
      lines.push(
        `${pace.simulated ? 'SIMULATED ' : ''}${pace.band} rain: allow +${pace.pct}% walking time → ${Math.ceil(p.walk[0] * pace.factor)}–${Math.ceil(p.walk[1] * pace.factor)} min`.replace(
          /^./,
          (m) => m.toUpperCase(),
        ),
      );
    return {
      flagged: Boolean(flagged) || entered.length > 0,
      title: `${p.kind === 'alternate' ? 'Alternate' : `${mode.verb} from ${req.fromLabel || 'here'} to ${req.toLabel}`} · ${formatDistance(p.distanceM)} · ${time}`,
      lines,
    };
  });
}
