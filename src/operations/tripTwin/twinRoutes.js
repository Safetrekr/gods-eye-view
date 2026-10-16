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
    // Structured for the card's result block (review/phase5 J3): warnings
    // sit above the caveats, never inside them.
    const warnings = lines.filter((l) => /^(Within 1 km|Enters avoid)/.test(l));
    const notes = lines.filter((l) => !warnings.includes(l));
    const range =
      mode.key === 'foot'
        ? `${p.walk[0]}–${p.walk[1]} min`
        : p.drive
          ? `${p.drive[0]}–${p.drive[1]} min`
          : 'time unknown';
    return {
      flagged: Boolean(flagged) || entered.length > 0,
      title: `${p.kind === 'alternate' ? 'Alternate' : `${mode.verb} from ${req.fromLabel || 'here'} to ${req.toLabel}`} · ${formatDistance(p.distanceM)} · ${time}`,
      lines,
      kind: p.kind,
      kicker: `${p.kind === 'alternate' ? 'Alternate' : 'Suggested'} ${mode.noun} path`,
      metric: `${formatDistance(p.distanceM)} · ${range}`,
      metricNote: mode.key === 'foot' ? 'group pace' : 'no live traffic',
      route: `${req.fromLabel || 'here'} → ${req.toLabel}`,
      warnings,
      notes,
    };
  });
}

/** One primary path for a mode, for the time on the mode switch (J1). */
export async function primaryEstimate(from, to, { profile, signal }) {
  const p = await fetchRoute(from, to, null, signal, profile);
  return profile === 'foot'
    ? { range: walkMinutes(p.distanceM), distanceM: p.distanceM }
    : { range: driveMinutes(p.durationS), distanceM: p.distanceM };
}

/**
 * Mode to draw before the operator picks one (J1): drive when the straight
 * line is 1.2 km or more, else walk. Returns {profile, reason}.
 */
export function defaultMode(straightM) {
  return straightM >= 1200
    ? {
        profile: 'car',
        reason: `Showing the drive: ${formatDistance(straightM)} in a straight line. Walk is one click.`,
      }
    : { profile: 'foot', reason: '' };
}

/** "Emi Sato" → "Emi S." (copied text never carries a full traveler name). */
export const shortName = (name = '') => {
  const [first, ...rest] = String(name).trim().split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first;
};

/**
 * Plain text for "Copy path summary" (review/phase5 J5). s = {title, stamp,
 * from, to, toExtra[], shown: card, other: {verb, distance, range}|null,
 * simulated}. No coordinates.
 */
export function pathSummaryText(s) {
  const c = s.shown;
  return [
    `${s.simulated ? '[SIMULATED DATA IN USE — training only] ' : ''}${s.title} — suggested, unverified (Trip Twin, ${s.stamp})`,
    `From: ${s.from}`,
    `To: ${s.to}`,
    ...(s.toExtra || []).map((l) => `    ${l}`),
    `${c.kicker.replace(/^Suggested /, '').replace(/^./, (m) => m.toUpperCase())}: ${c.metric} (${c.metricNote})`,
    ...(s.other ? [`${s.other.verb}: ${s.other.text}`] : []),
    ...(c.warnings.length
      ? c.warnings.map((w) => `Flag: ${w}`)
      : ['Flags: none raised (not a verification)']),
    'Not checked for closures, crowds or lighting.',
  ].join('\n');
}
