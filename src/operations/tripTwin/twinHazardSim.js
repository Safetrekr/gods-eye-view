// SIMULATED fire boundary and hurricane for the demo (review/hazards
// H5-PLAN). Pure and deterministic from (center, startMs, now, wind): every
// wall computes the same shapes. They use upstream's row and storm shapes so
// one assessor (twinHazards.js) reads real and simulated data alike.
import { makeProjector } from './twinData.js';

const RAD = Math.PI / 180;
/** The demo fire is re-mapped once, 10 minutes in. */
export const SIM_FIRE_REMAP_MS = 10 * 60e3;

/** A point `m` metres from the origin along compass bearing `deg`. */
const along = (deg, m) => [Math.sin(deg * RAD) * m, Math.cos(deg * RAD) * m];

/** A lobed outline: irregular enough to read as a mapped fire, not a circle. */
function outline(cx, cy, r, downwindDeg) {
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * 360;
    const lobe = 1 + 0.18 * Math.sin(3 * a * RAD) + 0.1 * Math.cos(5 * a * RAD);
    // Fires stretch downwind.
    const stretch = 1 + 0.35 * Math.max(0, Math.cos((a - downwindDeg) * RAD));
    const [dx, dy] = along(a, r * lobe * stretch);
    pts.push([cx + dx, cy + dy]);
  }
  pts.push(pts[0]);
  return pts;
}

const ringAreaM2 = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
};

/** The demo fire's bearing from the hotel: fixed, so every window agrees. */
export const SIM_FIRE_BEARING = 250;

/**
 * The demo fire, WSW of the hotel. Its edge starts about 4 km away and is
 * re-mapped at +10 min to about 1.8 km, so the age and the distance both
 * visibly change. A fixed bearing (not the live wind) keeps the remote,
 * which reads no wind, in step with the walls.
 * Returns {row, heat} — heat is 4 SIMULATED detections inside and 1 outside.
 */
export function simulatedFire(center, startMs, now) {
  const from = SIM_FIRE_BEARING;
  const remapped = now - startMs >= SIM_FIRE_REMAP_MS;
  const r = remapped ? 1500 : 1200;
  const edge = remapped ? 1800 : 4000;
  // The fire sits upwind; the downwind lobe faces the hotel.
  const [cx, cy] = along(from, edge + r * 1.35);
  const ringXY = outline(cx, cy, r, (from + 180) % 360);
  const proj = makeProjector(center);
  const toLonLat = ([x, y]) => {
    const p = proj.toLL(x, y);
    return [+p.lon.toFixed(6), +p.lat.toFixed(6)];
  };
  const row = {
    stableId: 'SIMULATED-demo-fire',
    name: 'Demo',
    acres: Math.round(ringAreaM2(ringXY) / 4046.86),
    containedPct: remapped ? 10 : 5,
    state: 'SIMULATED',
    category: 'WF',
    discoveredTime: startMs - 3 * 3600e3,
    updatedTime: remapped ? startMs + SIM_FIRE_REMAP_MS : startMs,
    cause: null,
    behavior: 'SIMULATED',
    polygons: [[ringXY.map(toLonLat)]],
    simulated: true,
  };
  const heatAt = [
    [0, 0.2],
    [60, 0.55],
    [170, 0.4],
    [250, 0.6],
  ].map(([a, f]) => {
    const [dx, dy] = along(a, r * f);
    return [cx + dx, cy + dy];
  });
  // One detection outside any boundary, off to the hotel's side: more
  // than 1 km from the fire, so no boundary claims it.
  heatAt.push(along((from + 100) % 360, 1300));
  const heat = heatAt.map(([x, y], i) => {
    const p = proj.toLL(x, y);
    return {
      index: 900 + i,
      lat: p.lat,
      lon: p.lon,
      frp: 20 + i * 7,
      confidence: 0.9,
      acqMs: now - (i + 1) * 40 * 60e3,
      satellite: 'SIMULATED',
      simulated: true,
    };
  });
  return { row, heat };
}

/** Convex hull of [x, y] points (Andrew's monotone chain). */
function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0)
      lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0)
      upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * The demo hurricane: one advisory issued at `startMs`, 600 km SE of the
 * hotel and heading NW. Its cone covers the hotel; the forecast centre
 * passes about 120 km away 36 h out, weakening to 45 kt over land.
 */
export function simulatedHurricane(center, startMs) {
  const proj = makeProjector(center);
  // Centre positions in metres from the hotel, every 12 h.
  const path = [
    [0, 135, 600000, 85],
    [12, 132, 430000, 85],
    [24, 125, 260000, 80],
    [36, 75, 120000, 45],
    [48, 20, 260000, 35],
    [72, 10, 560000, 25],
  ].map(([tau, deg, m, windKt]) => ({ tau, xy: along(deg, m), windKt }));
  const toPos = ([x, y]) => {
    const p = proj.toLL(x, y);
    return { longitude: +p.lon.toFixed(4), latitude: +p.lat.toFixed(4) };
  };
  // The cone widens with lead time (NHC's error circles, roughly).
  const radius = (tau) => 40000 + tau * 3600;
  const circlePts = [];
  for (let i = 0; i < path.length - 1; i++)
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      const a = path[i];
      const b = path[i + 1];
      const x = a.xy[0] + (b.xy[0] - a.xy[0]) * t;
      const y = a.xy[1] + (b.xy[1] - a.xy[1]) * t;
      const r = radius(a.tau + (b.tau - a.tau) * t);
      for (let j = 0; j < 16; j++) {
        const [dx, dy] = along((j / 16) * 360, r);
        circlePts.push([x + dx, y + dy]);
      }
    }
  const ring = hull(circlePts).map(toPos);
  ring.push(ring[0]);
  const issuedAt = new Date(startMs).toISOString();
  return {
    id: 'SIMULATED-demo-hurricane',
    name: 'Demo',
    classification: 'HU',
    basin: 'AL',
    position: toPos(path[0].xy),
    positionAt: issuedAt,
    advisoryNumber: 'DEMO',
    issuedAt,
    windKt: 85,
    pressureHpa: 972,
    movement: { directionDegrees: 315, speedKt: 9 },
    advisoryUrl: null,
    outlookUrl: null,
    forecastPoints: path.map((p) => ({
      position: toPos(p.xy),
      tauHours: p.tau,
      windKt: p.windKt,
      gustKt: p.windKt + 15,
    })),
    track: {
      type: 'LineString',
      coordinates: path.map((p) => {
        const q = toPos(p.xy);
        return [q.longitude, q.latitude];
      }),
    },
    cone: {
      type: 'Polygon',
      coordinates: [ring.map((q) => [q.longitude, q.latitude])],
    },
    simulated: true,
  };
}
