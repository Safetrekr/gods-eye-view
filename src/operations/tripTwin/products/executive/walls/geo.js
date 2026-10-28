// SafeTrekr Executive B4a: the flat maps' geography, as plain data (no DOM).
//   projection(box)      equirectangular with a standard parallel: lon/lat
//                        → viewBox px. Quiet and honest at regional scale.
//   landPath(proj)       the land outline (worldOutline.js, from the repo's
//                        own Natural Earth pack) as one SVG path
//   rosterLayout(cities) the roster map: each city's dot at its true
//                        projected place, its panel beside it, and the
//                        leader line from the dot to the panel's edge
// walls.test.mjs checks the dots against the projection and that every
// leader ends on its panel's edge.
import { OUTLINE_RINGS } from './worldOutline.js';

const RAD = Math.PI / 180;

/**
 * An equirectangular projection fitted to a viewBox of `w` × `h`: the
 * longitudes `lon0`..`lon1` fill the width; `top` is the latitude at y = 0;
 * `parallel` is the standard parallel (x is scaled by its cosine).
 */
export function projection({ w, h, lon0, lon1, top, parallel = 42 }) {
  const k = Math.cos(parallel * RAD);
  const s = w / ((lon1 - lon0) * k); // px per degree of latitude
  const bottom = top - h / s;
  const x = (lon) => (lon - lon0) * s * k;
  const y = (lat) => (top - lat) * s;
  return {
    w,
    h,
    lon0,
    lon1,
    top,
    bottom,
    key: `${w}:${h}:${lon0}:${lon1}:${top}:${parallel}`,
    x,
    y,
    /** [x, y] in viewBox px. */
    at: (lat, lon) => [x(lon), y(lat)],
  };
}

const pathCache = new Map();
/** The land outline as an SVG path `d`, in the projection's px (cached). */
export function landPath(proj) {
  if (pathCache.has(proj.key)) return pathCache.get(proj.key);
  const out = [];
  for (const ring of OUTLINE_RINGS) {
    let lon = ring[0];
    let lat = ring[1];
    const pts = [[lon / 10, lat / 10]];
    for (let i = 2; i < ring.length; i += 2) {
      lon += ring[i];
      lat += ring[i + 1];
      pts.push([lon / 10, lat / 10]);
    }
    // Skip rings wholly outside the box (the SVG clips the rest).
    const xs = pts.map((p) => proj.x(p[0]));
    const ys = pts.map((p) => proj.y(p[1]));
    if (
      Math.max(...xs) < -40 ||
      Math.min(...xs) > proj.w + 40 ||
      Math.max(...ys) < -40 ||
      Math.min(...ys) > proj.h + 40
    )
      continue;
    out.push(
      `M${xs.map((x, i) => `${x.toFixed(1)} ${ys[i].toFixed(1)}`).join('L')}Z`,
    );
  }
  const d = out.join('');
  pathCache.set(proj.key, d);
  return d;
}

/** The roster map's frame: the Americas to the Gulf, 16 : 10. */
export const ROSTER_BOX = Object.freeze({
  w: 1600,
  h: 1000,
  lon0: -112,
  lon1: 66,
  top: 73,
  parallel: 42,
});

/**
 * Where each city's panel sits, as fractions of the map: `x`, `w`, and
 * the edge that faces the dot (`top` for a panel below its dot, `bottom`
 * for one above) at `y`. Chosen so no two panels meet and no panel covers
 * another city's dot.
 */
export const ROSTER_PANELS = Object.freeze({
  Austin: { x: 0.005, w: 0.265, edge: 'top', y: 0.6 },
  'Washington DC': { x: 0.035, w: 0.15, edge: 'bottom', y: 0.33 },
  'New York': { x: 0.205, w: 0.15, edge: 'bottom', y: 0.33 },
  Miami: { x: 0.285, w: 0.15, edge: 'top', y: 0.6 },
  London: { x: 0.49, w: 0.27, edge: 'bottom', y: 0.21 },
  Zurich: { x: 0.69, w: 0.15, edge: 'top', y: 0.41 },
  Dubai: { x: 0.83, w: 0.15, edge: 'top', y: 0.66 },
});

/**
 * The roster map's geometry: each city's dot (true projected position, as
 * fractions of the map), its panel, and its leader line from the dot to
 * the nearest point on the panel's facing edge.
 */
export function rosterLayout(cities, box = ROSTER_BOX) {
  const proj = projection(box);
  const pad = 0.012;
  return cities
    .filter((c) => ROSTER_PANELS[c.name])
    .map((c) => {
      const [px, py] = proj.at(c.lat, c.lon);
      const dot = { x: px / box.w, y: py / box.h };
      const panel = ROSTER_PANELS[c.name];
      const lx = Math.min(
        Math.max(dot.x, panel.x + pad),
        panel.x + panel.w - pad,
      );
      return {
        name: c.name,
        dot,
        panel,
        lead: { x1: dot.x, y1: dot.y, x2: lx, y2: panel.y },
      };
    });
}
