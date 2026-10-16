// Suggested walking paths (P1; 01 §6 rules R1–R12, 04 §5.7, 06 §3.7).
// Primary: OSRM foot route hotel → primary rally point via the existing
// /api/route proxy. Alternate: a second request through a side waypoint
// (hook H-9's `alternatives=1` is not available to the standalone page).
// Never called "safe"; always "Suggested path (unverified)".
import * as Cesium from 'cesium';
import {
  bearingLabel,
  formatDistance,
  formatShort,
  haversineM,
  makeProjector,
} from './twinData.js';

const css = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
export const GROUP_PACE_M_PER_MIN = [50, 65]; // slow / brisk group walking
export const HAZARD_NEAR_M = 1000;

export function walkMinutes(distanceM) {
  return [
    Math.ceil(distanceM / GROUP_PACE_M_PER_MIN[1]),
    Math.ceil(distanceM / GROUP_PACE_M_PER_MIN[0]),
  ];
}

/** 01 §6: show the arithmetic, never a bare number. Night prep is longer. */
export function arriveBy(distanceM, { night = false } = {}) {
  const prepare = night ? 12 : 5;
  const walk = walkMinutes(distanceM)[1];
  const buffer = 7;
  return { total: prepare + walk + buffer, prepare, walk, buffer };
}

/** One OSRM route through the existing proxy (profile foot | car). */
export async function fetchRoute(from, to, via, signal, profile = 'foot') {
  return route(from, to, via, signal, profile);
}

async function route(from, to, via, signal, profile = 'foot') {
  const pts = [from, ...(via ? [via] : []), to].map(
    (p) => `${(p.lon ?? p.lng).toFixed(6)},${p.lat.toFixed(6)}`,
  );
  const res = await fetch(
    `/api/route?profile=${profile}&coords=${pts.join(';')}`,
    { signal },
  );
  const json = await res
    .json()
    .catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!json.ok) throw new Error(json.error || 'route failed');
  return {
    distanceM: json.distanceM,
    durationS: json.durationS ?? null,
    geometry: json.geometry.map(([lon, lat]) => ({ lat, lon })),
  };
}

/** Fraction of the first `firstM` metres of `a` that lie within `tol` m of `b`. */
export function sharedStart(a, b, firstM = 200, tol = 15) {
  const proj = makeProjector(a[0]);
  const B = b.map((p) => proj.toXY(p.lat, p.lon));
  const near = (x, y) => {
    for (let i = 1; i < B.length; i++) {
      const [ax, ay] = B[i - 1];
      const [bx, by] = B[i];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
      );
      if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= tol) return true;
    }
    return false;
  };
  let walked = 0;
  let shared = 0;
  for (let i = 1; i < a.length && walked < firstM; i++) {
    const d = haversineM(a[i - 1], a[i]);
    const [x, y] = proj.toXY(a[i].lat, a[i].lon);
    if (near(x, y)) shared += d;
    walked += d;
  }
  return { sharedM: shared, fraction: walked ? shared / walked : 0 };
}

/** Closest approach of a path to any hazard point (m), with its index. */
export function hazardProximity(path, hazards) {
  let best = { distanceM: Infinity, hazard: null, index: -1 };
  for (const h of hazards)
    for (let i = 0; i < path.length; i++) {
      const d = haversineM(path[i], h);
      if (d < best.distanceM) best = { distanceM: d, hazard: h, index: i };
    }
  return best;
}

/**
 * Plan primary + alternate to the primary rally point. ≤ 3 route requests per
 * open (03 RK-03). Returns cards for the HUD and geometry for the scene.
 */
export async function planPaths(
  hotel,
  destinations,
  { signal, hazards = [] } = {},
) {
  const primaryDest = destinations.find(
    (d) => d.category === 'rally_primary' && d.coordinates,
  );
  if (!primaryDest)
    return { paths: [], note: 'No primary rally point set for this hotel' };
  const to = {
    lat: primaryDest.coordinates.lat,
    lon: primaryDest.coordinates.lng,
  };
  const out = [];
  let primary;
  try {
    primary = await route(hotel, to, null, signal);
    out.push({ kind: 'primary', dest: primaryDest, ...primary });
  } catch (error) {
    if (signal?.aborted) throw error;
    out.push({
      kind: 'unavailable',
      dest: primaryDest,
      distanceM: haversineM(hotel, to),
      geometry: [hotel, to],
      error: String(error.message || error),
    });
    return { paths: out };
  }
  // Alternate: a waypoint to one side of the straight line, then the other.
  const proj = makeProjector(hotel);
  const [tx, ty] = proj.toXY(to.lat, to.lon);
  const len = Math.hypot(tx, ty) || 1;
  const side = Math.max(120, 0.45 * len);
  for (const sign of [1, -1]) {
    const via = proj.toLL(
      tx / 2 + (sign * -ty * side) / len,
      ty / 2 + (sign * tx * side) / len,
    );
    try {
      const alt = await route(hotel, to, via, signal);
      const shared = sharedStart(alt.geometry, primary.geometry);
      if (shared.fraction < 0.5 || sign === -1) {
        out.push({
          kind: 'alternate',
          dest: primaryDest,
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
    p.walk = walkMinutes(p.distanceM);
    p.hazard = hazardProximity(p.geometry, hazards);
  }
  return { paths: out };
}

export function pathCardText(p, { night = false, incident = false } = {}) {
  const lines = [];
  const name =
    p.kind === 'alternate' ? 'Alternate path' : 'Rally point (primary)';
  if (p.kind === 'unavailable') {
    lines.push(
      `${name} · ${formatDistance(p.distanceM)} straight line · walking path unavailable`,
    );
    return lines;
  }
  lines.push(
    `${name} · ${formatDistance(p.distanceM)} · walk ${p.walk[0]}–${p.walk[1]} min (group pace)`,
  );
  lines.push('Suggested path (unverified)');
  if (p.kind === 'alternate' && p.sharedStartM > 40)
    lines.push(
      `Shares the first ${formatShort(p.sharedStartM)} with the primary path`,
    );
  if (p.hazard?.hazard && p.hazard.distanceM <= HAZARD_NEAR_M)
    lines.push(
      `Passes within ${formatDistance(p.hazard.distanceM)} of a satellite heat detection (${bearingLabel(p.geometry[p.hazard.index], p.hazard.hazard)})`,
    );
  if (incident && p.kind === 'primary') {
    const a = arriveBy(p.distanceM, { night });
    lines.push(
      `Suggested arrive-by: ${a.total} min (${a.prepare} prepare + ${a.walk} walk + ${a.buffer} buffer)`,
    );
  }
  return lines;
}

/** Draw paths on the twin's heightfield. Returns a dispose function. */
export function drawPaths(
  viewer,
  site,
  paths,
  { selected = null, faded = false } = {},
) {
  // Faded: a saved path covers the same ends; the suggestion steps back but
  // stays readable and clickable. Heat ticks keep full strength.
  const k = faded ? 0.4 : 1;
  const ds = new Cesium.CustomDataSource('trip-twin-paths');
  // add() resolves in a microtask: a dispose in the same tick must wait for
  // it, or the drawing is left behind (phase 9: select, then edit a copy).
  const added = viewer.dataSources.add(ds);
  const hoverCasings = new Map();
  const { projector, field } = site;
  const lift = (p, dz) => {
    const [x, y] = projector.toXY(p.lat, p.lon);
    return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, field.at(x, y) + dz);
  };
  for (const p of paths) {
    const primary = p.kind === 'primary';
    const unavailable = p.kind === 'unavailable';
    const nearHazard = p.hazard?.distanceM <= HAZARD_NEAR_M;
    const positions = densify(p.geometry, 12).map((q) =>
      lift(q, primary ? 1.0 : 0.9),
    );
    // A dark casing keeps the blue path on top of bright streets (phase 7).
    // Selected: a white glow *under* the casing, so the blue line keeps its
    // colour and the alternate its dash (review/phase9 O6). An invisible
    // 22 px line is the click target; hover lightens the casing (O7).
    const isSel = selected === p.kind;
    const under = densify(p.geometry, 12).map((q) =>
      lift(q, primary ? 0.95 : 0.85),
    );
    if (!unavailable) {
      if (isSel)
        ds.entities.add({
          id: `twin-path:${p.kind}:glow`,
          polyline: {
            positions: under,
            width: primary ? 18 : 15,
            arcType: Cesium.ArcType.NONE,
            material: new Cesium.PolylineGlowMaterialProperty({
              color: css('#eff7f3', 0.42),
              glowPower: 0.22,
            }),
          },
        });
      ds.entities.add({
        id: `twin-path:${p.kind}:casing`,
        polyline: {
          positions: under,
          width: (primary ? 7 : 4) + 4,
          arcType: Cesium.ArcType.NONE,
          material: css('#061a23', 0.85 * k),
        },
      });
      hoverCasings.set(
        p.kind,
        ds.entities.add({
          id: `twin-path:${p.kind}:hover`,
          show: false,
          polyline: {
            positions: under,
            width: (primary ? 7 : 4) + 6,
            arcType: Cesium.ArcType.NONE,
            material: css('#5f8797', 0.9),
          },
        }),
      );
      ds.entities.add({
        id: `twin-path:${p.kind}:pick`,
        polyline: {
          positions: under,
          width: 22,
          arcType: Cesium.ArcType.NONE,
          material: css('#061a23', 0.01),
        },
      });
    }
    ds.entities.add({
      id: `twin-path:${p.kind}`,
      polyline: {
        positions,
        width: unavailable ? 2 : primary ? 7 : 4,
        arcType: Cesium.ArcType.NONE,
        material: unavailable
          ? new Cesium.PolylineDashMaterialProperty({
              color: css('#9aa8ac', 0.7),
              dashLength: 12,
            })
          : primary
            ? new Cesium.PolylineGlowMaterialProperty({
                color: css('#3b82f6', 0.95 * k),
                glowPower: 0.15,
              })
            : new Cesium.PolylineDashMaterialProperty({
                color: css('#3b82f6', 0.9 * k),
                gapColor: css('#061a23', 0.85 * k),
                dashLength: 18,
              }),
      },
    });
    if (unavailable) continue;
    // Chevrons along the path show direction (every 40 m primary, 60 m alternate).
    const every = primary ? 40 : 60;
    let walked = 0;
    let next = every;
    for (let i = 1; i < p.geometry.length; i++) {
      const a = p.geometry[i - 1];
      const b = p.geometry[i];
      const seg = haversineM(a, b);
      while (seg > 0 && next <= walked + seg) {
        const t = (next - walked) / seg;
        chevron(
          ds,
          projector,
          field,
          {
            lat: a.lat + (b.lat - a.lat) * t,
            lon: a.lon + (b.lon - a.lon) * t,
          },
          b,
          primary,
          `twin-path:${p.kind}:chev:${next}`,
          k,
        );
        next += every;
      }
      walked += seg;
    }
    if (nearHazard) {
      // Amber ticks where the path comes within 1 km of a heat detection.
      const i = p.hazard.index;
      const seg = p.geometry.slice(Math.max(0, i - 2), i + 3);
      ds.entities.add({
        polyline: {
          positions: densify(seg, 10).map((q) => lift(q, 1.4)),
          width: 5,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineDashMaterialProperty({
            color: css('#f59e0b', 1),
            dashLength: 10,
          }),
        },
      });
    }
  }
  viewer.scene.requestRender();
  const dispose = () => {
    added.then(() => {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
    });
  };
  /** Lighten one path's casing under the pointer (null: none). */
  dispose.hover = (kind) => {
    for (const [k, e] of hoverCasings) e.show = k === kind;
    viewer.scene.requestRender();
  };
  return dispose;
}

function chevron(ds, projector, field, at, toward, primary, id, k = 1) {
  const [x, y] = projector.toXY(at.lat, at.lon);
  const [tx, ty] = projector.toXY(toward.lat, toward.lon);
  const len = Math.hypot(tx - x, ty - y) || 1;
  const ux = (tx - x) / len;
  const uy = (ty - y) / len;
  const s = primary ? 4 : 3;
  const tip = [x + ux * s, y + uy * s];
  const l = [x - uy * s, y + ux * s];
  const r = [x + uy * s, y - ux * s];
  const h = field.at(x, y) + 1.2;
  const pt = ([px, py]) => {
    const q = projector.toLL(px, py);
    return Cesium.Cartesian3.fromDegrees(q.lon, q.lat, h);
  };
  ds.entities.add({
    id,
    polyline: {
      positions: [pt(l), pt(tip), pt(r)],
      width: 2,
      arcType: Cesium.ArcType.NONE,
      material: css('#93bafa', (primary ? 1 : 0.8) * k),
    },
  });
}

function densify(path, stepM) {
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
