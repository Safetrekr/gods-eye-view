// See it coming (phase 12): where the nearest rain core is, which way it is
// moving, and when it reaches the site if it keeps its track. Built from the
// last two observed radar frames (IEM NEXRAD in the US, the EUMETSAT
// satellite rain estimate in Europe). Pure: no DOM, no Cesium.
//
// Honesty rules (06 §5, 05 P3): the motion is observed, never a forecast
// model; every line carries its frame time; a core's band comes from the
// radar colour class, not a measured rain rate; never "safe" or "all clear".

export const NOWCAST_BOX_KM = 160; // frames for motion and approach
export const NOWCAST_PX = 320; // 500 m per pixel
export const FRAME_GAP_MIN = 20; // older frame for the motion pair
export const PROJECT_MAX_MIN = 60; // the time lens projects this far, no more
export const CORE_T = 0.5; // yellow (~40 dBZ) and above make a core
export const SITE_REACH_KM = 1.5; // "reaches the hotel": core edge this close

const KM_PER_DEG = 111.32;
const RAD = Math.PI / 180;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Intensity bands from the radar colour class t (0..1). */
export function bandOf(t) {
  if (!(t > 0)) return null;
  if (t < CORE_T) return 'light';
  if (t < 0.67) return 'moderate';
  if (t < 0.9) return 'heavy';
  return 'intense';
}

/**
 * RGBA pixels of a radar or rain-rate PNG → intensity 0..1 per pixel (0 =
 * none), by the reflectivity palette's hue (IEM n0q, verified 16 Oct 2026):
 * blue and cyan below ~20 dBZ (often not rain: birds, insects, clear air),
 * green 20–35 dBZ light rain, yellow ~40 moderate, orange and red 45–55
 * heavy, magenta and purple 60+ intense (hail likely). A core starts at
 * yellow, so night-time clear-air return never becomes a "storm".
 */
export function hueToIntensity(hue) {
  if (hue >= 260) return 0.95; // magenta / purple
  if (hue < 15) return 0.82; // red
  if (hue < 45) return 0.72; // orange
  if (hue < 75) return 0.55; // yellow
  if (hue < 165) return 0.3; // green
  return 0.12; // cyan / blue
}
export function rgbaToIntensity(rgba, w, h) {
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; j < w * h; i += 4, j++) {
    if (rgba[i + 3] < 40) continue;
    const r = rgba[i] / 255;
    const g = rgba[i + 1] / 255;
    const b = rgba[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let hue = 0;
    if (max !== min) {
      const d = max - min;
      hue =
        max === r
          ? ((g - b) / d + 6) % 6
          : max === g
            ? (b - r) / d + 2
            : (r - g) / d + 4;
      hue *= 60;
    }
    out[j] = hueToIntensity(hue);
  }
  return out;
}

/** A grid: {data: Float32Array, w, h, bbox:[w,s,e,n], t (ms), simulated?}. */
export function makeGrid(data, w, h, bbox, t, extra = {}) {
  return { data, w, h, bbox, t, ...extra };
}

/** Mean-pool by an integer factor (motion is matched on the coarse grid). */
export function downsample(grid, f) {
  const w = Math.floor(grid.w / f);
  const h = Math.floor(grid.h / f);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let yy = 0; yy < f; yy++)
        for (let xx = 0; xx < f; xx++)
          s += grid.data[(y * f + yy) * grid.w + x * f + xx];
      out[y * w + x] = s / (f * f);
    }
  return { ...grid, data: out, w, h };
}

const lit = (g) => {
  let n = 0;
  for (let i = 0; i < g.data.length; i++) if (g.data[i] > 0) n++;
  return n;
};

/** Normalised cross-correlation of b against a shifted by (dx, dy). */
function ncc(a, b, dx, dy) {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  const { w, h } = a;
  for (let y = Math.max(0, dy); y < Math.min(h, h + dy); y++) {
    const ya = y - dy;
    for (let x = Math.max(0, dx); x < Math.min(w, w + dx); x++) {
      const va = a.data[ya * w + (x - dx)];
      const vb = b.data[y * w + x];
      ab += va * vb;
      aa += va * va;
      bb += vb * vb;
    }
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

/**
 * How the rain field moved from `older` to `newer` (same box, same size):
 * {vxKmh east, vyKmh north, speedKmh, headingDeg (toward), score} or null when
 * there is too little rain or no clear match. Coarse-to-fine search.
 */
export function motionVector(older, newer, { maxKmh = 110, coarse = 4 } = {}) {
  if (!older || !newer || older.w !== newer.w || older.h !== newer.h)
    return null;
  const dtH = (newer.t - older.t) / 3600e3;
  if (!(dtH > 0)) return null;
  if (lit(older) < 12 || lit(newer) < 12) return null;
  const kmPerPx = cellKm(newer).x;
  const a = downsample(older, coarse);
  const b = downsample(newer, coarse);
  const maxC = Math.ceil((maxKmh * dtH) / (kmPerPx * coarse));
  let best = { dx: 0, dy: 0, s: -1 };
  for (let dy = -maxC; dy <= maxC; dy++)
    for (let dx = -maxC; dx <= maxC; dx++) {
      const s = ncc(a, b, dx, dy);
      if (s > best.s) best = { dx, dy, s };
    }
  // Refine at full resolution around the coarse peak.
  let fine = { dx: best.dx * coarse, dy: best.dy * coarse, s: -1 };
  const r = coarse;
  for (let dy = fine.dy - r; dy <= fine.dy + r; dy++)
    for (let dx = fine.dx - r; dx <= fine.dx + r; dx++) {
      const s = ncc(older, newer, dx, dy);
      if (s > fine.s) fine = { dx, dy, s };
    }
  if (fine.s < 0.35) return null;
  // Pixel rows run north to south: +dy is southward.
  const vxKmh = (fine.dx * cellKm(newer).x) / dtH;
  const vyKmh = (-fine.dy * cellKm(newer).y) / dtH;
  const speedKmh = Math.hypot(vxKmh, vyKmh);
  const headingDeg = (Math.atan2(vxKmh, vyKmh) / RAD + 360) % 360 || 0;
  return {
    vxKmh,
    vyKmh,
    speedKmh,
    headingDeg,
    score: fine.s,
    dtMin: dtH * 60,
  };
}

/** Kilometres per cell east-west (x) and north-south (y). */
export function cellKm(grid) {
  const [w, s, e, n] = grid.bbox;
  const midLat = (s + n) / 2;
  return {
    x: ((e - w) * KM_PER_DEG * Math.cos(midLat * RAD)) / grid.w,
    y: ((n - s) * KM_PER_DEG) / grid.h,
  };
}

/** Pixel (x, y) → {lat, lon} at the cell centre. */
export function pxToLL(grid, x, y) {
  const [w, s, e, n] = grid.bbox;
  return {
    lon: w + ((x + 0.5) / grid.w) * (e - w),
    lat: n - ((y + 0.5) / grid.h) * (n - s),
  };
}

/** {lat, lon} → east/north km from an origin. */
export function toKm(origin, p) {
  return {
    x: (p.lon - origin.lon) * KM_PER_DEG * Math.cos(origin.lat * RAD),
    y: (p.lat - origin.lat) * KM_PER_DEG,
  };
}

/**
 * Rain cores: 4-connected areas at or above `threshold`, largest first by
 * peak. Each: {x, y (px centroid), lat, lon, cells, areaKm2, radiusKm, maxT,
 * band}.
 */
export function findCores(grid, { threshold = CORE_T, minCells = 3 } = {}) {
  const { w, h, data } = grid;
  const seen = new Uint8Array(w * h);
  const ck = cellKm(grid);
  const cores = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || data[i] < threshold) continue;
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sv = 0;
    let peak = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      const x = j % w;
      const y = (j - x) / w;
      const v = data[j];
      n++;
      sx += x * v;
      sy += y * v;
      sv += v;
      if (v > peak) peak = v;
      if (x > 0 && !seen[j - 1] && data[j - 1] >= threshold) {
        seen[j - 1] = 1;
        stack.push(j - 1);
      }
      if (x < w - 1 && !seen[j + 1] && data[j + 1] >= threshold) {
        seen[j + 1] = 1;
        stack.push(j + 1);
      }
      if (y > 0 && !seen[j - w] && data[j - w] >= threshold) {
        seen[j - w] = 1;
        stack.push(j - w);
      }
      if (y < h - 1 && !seen[j + w] && data[j + w] >= threshold) {
        seen[j + w] = 1;
        stack.push(j + w);
      }
    }
    if (n < minCells) continue;
    const x = sx / sv;
    const y = sy / sv;
    const areaKm2 = n * ck.x * ck.y;
    cores.push({
      x,
      y,
      ...pxToLL(grid, x, y),
      cells: n,
      areaKm2,
      radiusKm: Math.sqrt(areaKm2 / Math.PI),
      maxT: peak,
      band: bandOf(peak),
    });
  }
  return cores.sort((a, b) => b.maxT - a.maxT || b.cells - a.cells);
}

/** 8-point compass for a bearing in degrees. */
export const compass = (deg) =>
  COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/**
 * Where each core goes on its current track, relative to the site.
 * Returns the one that matters most:
 *   {status: 'over' | 'arriving' | 'passing' | 'receding' | 'stationary' |
 *    'unknown' | 'none', core, etaMin, distKm, fromDir (where the core is,
 *    seen from the site), headingDir (where it is going), speedKmh, cpaKm,
 *    cpaMin}
 * Priority: over the site, then the earliest arrival within the horizon,
 * then the nearest core.
 */
export function approach({
  cores,
  motion,
  site,
  reachKm = SITE_REACH_KM,
  horizonMin = 120,
}) {
  if (!cores?.length) return { status: 'none' };
  const v = motion
    ? { x: motion.vxKmh / 60, y: motion.vyKmh / 60 } // km per minute
    : null;
  const rows = cores.map((core) => {
    const p = toKm(site, core);
    const distKm = Math.hypot(p.x, p.y);
    const R = reachKm + core.radiusKm;
    const fromDir = compass((Math.atan2(p.x, p.y) / RAD + 360) % 360);
    const base = {
      core,
      distKm,
      edgeKm: Math.max(0, distKm - core.radiusKm),
      fromDir,
    };
    if (distKm <= R) return { ...base, status: 'over', etaMin: 0 };
    if (!v) return { ...base, status: 'unknown' };
    const speed = Math.hypot(v.x, v.y) * 60;
    const headingDir = compass(motion.headingDeg);
    if (speed < 5)
      return { ...base, status: 'stationary', speedKmh: speed, headingDir };
    // |p + v t| = R → (v·v) t² + 2 (p·v) t + (p·p − R²) = 0
    const A = v.x * v.x + v.y * v.y;
    const B = 2 * (p.x * v.x + p.y * v.y);
    const C = p.x * p.x + p.y * p.y - R * R;
    const cpaMin = Math.max(0, -B / (2 * A));
    const cpaKm = Math.hypot(p.x + v.x * cpaMin, p.y + v.y * cpaMin);
    const disc = B * B - 4 * A * C;
    const more = { speedKmh: speed, headingDir, cpaKm, cpaMin };
    if (B >= 0) return { ...base, ...more, status: 'receding' };
    if (disc < 0) return { ...base, ...more, status: 'passing' };
    const etaMin = (-B - Math.sqrt(disc)) / (2 * A);
    return etaMin <= horizonMin
      ? { ...base, ...more, status: 'arriving', etaMin }
      : { ...base, ...more, status: 'passing' };
  });
  const over = rows.filter((r) => r.status === 'over');
  if (over.length) return over.sort((a, b) => b.core.maxT - a.core.maxT)[0];
  const arriving = rows
    .filter((r) => r.status === 'arriving')
    .sort((a, b) => a.etaMin - b.etaMin);
  if (arriving.length) return arriving[0];
  return rows.sort((a, b) => a.edgeKm - b.edgeKm)[0];
}

/** Round an ETA for a wall: 5-minute steps past 20 minutes. */
export function etaText(min) {
  if (min < 1) return 'now';
  if (min <= 20) return `about ${Math.max(1, Math.round(min))} min`;
  return `about ${Math.round(min / 5) * 5} min`;
}

/**
 * The line every surface shows. fmt = {dist(m), speed(kmh), siteNoun,
 * frame (clock of the newest frame), source ('radar' | 'satellite
 * estimate'), simulated}. Returns {text, short, level: 'attention' |
 * 'watch' | 'info', status}.
 */
export function approachText(ap, fmt) {
  const sim = fmt.simulated ? 'SIMULATED · ' : '';
  const src = `${fmt.source || 'radar'} ${fmt.frame || ''}`.trim();
  const noun = fmt.siteNoun || 'hotel';
  const what = (c) =>
    `${c.band === 'intense' ? 'Intense' : c.band === 'heavy' ? 'Heavy' : 'Moderate'} rain core`;
  if (!ap || ap.status === 'none')
    return {
      status: 'none',
      level: 'info',
      text: `${sim}No rain core within ${fmt.boxText || fmt.dist(fmt.boxKm * 500)} in the latest ${src}`,
      short: '',
    };
  const c = ap.core;
  const dir = `${fmt.dist(ap.edgeKm * 1000)} ${ap.fromDir}`;
  const heavy = c.band === 'heavy' || c.band === 'intense';
  if (ap.status === 'over')
    return {
      status: 'over',
      level: heavy ? 'attention' : 'watch',
      text: `${sim}${what(c)} over the ${noun} now · ${src}`,
      short: `${sim}${what(c)} over the ${noun}`,
    };
  if (ap.status === 'unknown')
    return {
      status: 'unknown',
      level: 'info',
      text: `${sim}${what(c)} · ${dir} · motion not measured yet (one frame) · ${src}`,
      short: '',
    };
  const moving = `moving ${ap.headingDir} ${fmt.speed(ap.speedKmh)}`;
  if (ap.status === 'arriving')
    return {
      status: 'arriving',
      level: heavy && ap.etaMin <= 60 ? 'attention' : 'watch',
      eta: ap.etaMin,
      text: `${sim}${what(c)} · ${dir} · ${moving} · on this track reaches the ${noun} in ${etaText(ap.etaMin)} · ${src}, ${fmt.simulated ? 'simulated' : 'observed'} motion`,
      short: `${sim}${what(c)} · ${etaText(ap.etaMin).replace('about ', '~')} · ${dir}`,
    };
  if (ap.status === 'passing')
    return {
      status: 'passing',
      level: 'info',
      text: `${sim}${what(c)} · ${dir} · ${moving} · on this track passes ${fmt.dist(ap.cpaKm * 1000)} from the ${noun} · ${src}`,
      short: '',
    };
  if (ap.status === 'stationary')
    return {
      status: 'stationary',
      level: 'info',
      text: `${sim}${what(c)} · ${dir} · nearly stationary · ${src}`,
      short: '',
    };
  return {
    status: 'receding',
    level: 'info',
    text: `${sim}${what(c)} · ${dir} · ${moving}, away from the ${noun} · ${src}`,
    short: '',
  };
}

/** The grid moved along the motion for dtMin (nearest cell, empty fill). */
export function projectGrid(grid, motion, dtMin) {
  if (!motion || !dtMin) return grid;
  const ck = cellKm(grid);
  const dx = Math.round(((motion.vxKmh / 60) * dtMin) / ck.x);
  const dy = Math.round((-(motion.vyKmh / 60) * dtMin) / ck.y);
  const { w, h } = grid;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ys = y - dy;
    if (ys < 0 || ys >= h) continue;
    for (let x = 0; x < w; x++) {
      const xs = x - dx;
      if (xs < 0 || xs >= w) continue;
      out[y * w + x] = grid.data[ys * w + xs];
    }
  }
  return {
    ...grid,
    data: out,
    t: grid.t + dtMin * 60e3,
    projected: true,
  };
}

/** Box of `km` on a side around a point, [w, s, e, n]. */
export function boxKm(center, km) {
  const dLat = km / 2 / KM_PER_DEG;
  const dLon = km / 2 / (KM_PER_DEG * Math.cos(center.lat * RAD));
  return [
    center.lon - dLon,
    center.lat - dLat,
    center.lon + dLon,
    center.lat + dLat,
  ];
}

/**
 * A simulated squall line for demos (Prototype › Simulated storm, or the
 * remote's Weather station): a band of rain with three embedded cores,
 * moving toward the NE at 40 km/h, its strongest core aimed at the site and
 * arriving about 30 min after `startMs`. Deterministic for a given time, so
 * every wall draws the same storm.
 */
export const SIM_STORM = Object.freeze({
  headingDeg: 45,
  speedKmh: 40,
  startKm: 22, // core centre distance from the site at the start
});
export function simulatedStorm({ center, bbox, w, h, tMs, startMs }) {
  const { headingDeg, speedKmh, startKm } = SIM_STORM;
  const hx = Math.sin(headingDeg * RAD);
  const hy = Math.cos(headingDeg * RAD);
  const minutes = (tMs - startMs) / 60e3;
  // Core centre: starts startKm upstream of the site, moves along heading.
  const along = -startKm + (speedKmh / 60) * minutes;
  const cx = hx * along;
  const cy = hy * along;
  // Line axis: perpendicular to the motion.
  const px = hy;
  const py = -hx;
  const blobs = [
    // [offset along the line km, offset behind km, sigma km, peak t]
    [0, 0, 2.2, 0.92],
    [-9, 1.5, 2.6, 0.72],
    [8, 1, 2.4, 0.78],
    [-18, 3, 3.5, 0.5],
    [17, 2.5, 3.2, 0.55],
  ];
  const data = new Float32Array(w * h);
  const grid = { bbox, w, h };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = toKm(center, pxToLL(grid, x, y));
      // Coordinates relative to the moving line centre.
      const rx = p.x - cx;
      const ry = p.y - cy;
      const u = rx * px + ry * py; // along the line
      const v = rx * hx + ry * hy; // ahead (+) / behind (−)
      // The stratiform band: a long soft ridge just behind the leading edge.
      let t =
        Math.exp(-((v + 3) ** 2) / (2 * 3.2 ** 2)) *
        Math.exp(-(u ** 2) / (2 * 26 ** 2)) *
        0.3;
      for (const [bu, bv, s, peak] of blobs) {
        const d2 = (u - bu) ** 2 + (v + bv) ** 2;
        t = Math.max(t, peak * Math.exp(-d2 / (2 * s * s)));
      }
      if (t > 0.06) data[y * w + x] = Math.min(1, t);
    }
  return makeGrid(data, w, h, bbox, tMs, { simulated: true });
}

/** The simulated storm's own motion (it is known, not measured). */
export function simulatedMotion() {
  const { headingDeg, speedKmh } = SIM_STORM;
  return {
    vxKmh: speedKmh * Math.sin(headingDeg * RAD),
    vyKmh: speedKmh * Math.cos(headingDeg * RAD),
    speedKmh,
    headingDeg,
    score: 1,
    dtMin: FRAME_GAP_MIN,
    simulated: true,
  };
}

/**
 * Simulated strikes riding with the storm's cores (demo): up to `n` points
 * near the strongest cores, each with an age in minutes.
 */
export function simulatedStormStrikes(cores, tMs, n = 6) {
  const out = [];
  const heavy = cores.filter((c) => c.maxT >= 0.67).slice(0, 3);
  let k = 0;
  for (const c of heavy)
    for (let i = 0; i < Math.ceil(n / Math.max(1, heavy.length)); i++) {
      const a = (k * 137.5 * RAD) % (2 * Math.PI);
      const r = (c.radiusKm * 0.6 * ((k % 3) + 1)) / 3;
      const dLat = (r * Math.cos(a)) / KM_PER_DEG;
      const dLon = (r * Math.sin(a)) / (KM_PER_DEG * Math.cos(c.lat * RAD));
      // Ages cycle on the clock so they are deterministic per minute.
      const ageMin = (Math.floor(tMs / 60e3) + k * 3) % 9;
      out.push({ lat: c.lat + dLat, lon: c.lon + dLon, ageMin });
      k++;
    }
  return out.slice(0, n);
}

/** Nearest point to the site: {point, distKm, dir} or null. */
export function nearestPoint(site, points) {
  let best = null;
  for (const p of points || []) {
    const k = toKm(site, p);
    const d = Math.hypot(k.x, k.y);
    if (!best || d < best.distKm)
      best = {
        point: p,
        distKm: d,
        dir: compass((Math.atan2(k.x, k.y) / RAD + 360) % 360),
      };
  }
  return best;
}

/** closing | receding | steady, from two distances (km) a few minutes apart. */
export function trendOf(prevKm, nowKm, epsKm = 1.5) {
  if (!Number.isFinite(prevKm) || !Number.isFinite(nowKm)) return null;
  if (nowKm < prevKm - epsKm) return 'closing';
  if (nowKm > prevKm + epsKm) return 'moving away';
  return 'steady';
}

// --- official warning areas -------------------------------------------------

/** Ray casting; ring = [[lon, lat], ...]. */
export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > p.lat !== yj > p.lat &&
      p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

/** GeoJSON Polygon / MultiPolygon → outer rings [[lon, lat], ...][]. */
export function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
  if (geometry.type === 'MultiPolygon')
    return geometry.coordinates.map((poly) => poly[0]);
  return [];
}

/** Is the point inside any of these rings? */
export const insideAny = (p, rings) => rings.some((r) => pointInRing(p, r));

/**
 * A simulated Severe Thunderstorm Warning box for the demo storm: a
 * parallelogram along its track, from the storm now to 60 min ahead.
 */
export function simulatedWarningRing(center, tMs, startMs) {
  const { headingDeg, speedKmh, startKm } = SIM_STORM;
  const hx = Math.sin(headingDeg * RAD);
  const hy = Math.cos(headingDeg * RAD);
  const minutes = (tMs - startMs) / 60e3;
  const along = -startKm + (speedKmh / 60) * minutes;
  const a0 = along - 6;
  const a1 = along + 40;
  const half = 14;
  const px = hy;
  const py = -hx;
  const pt = (a, s) => {
    const x = hx * a + px * s;
    const y = hy * a + py * s;
    return [
      center.lon + x / (KM_PER_DEG * Math.cos(center.lat * RAD)),
      center.lat + y / KM_PER_DEG,
    ];
  };
  const ring = [pt(a0, -half), pt(a1, -half), pt(a1, half), pt(a0, half)];
  ring.push(ring[0]);
  return ring;
}
