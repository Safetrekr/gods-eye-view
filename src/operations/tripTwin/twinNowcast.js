// See it coming (phase 12, revised after review/phase12): where the most
// severe rain core near the site is, which way storm echo is moving, and
// when that core comes within 6 mi (10 km) of the site and over it if it
// keeps its track. Built from two observed radar frames 20 min apart (IEM
// NEXRAD n0q in the US, decoded by exact palette to dBZ; EUMETSAT H SAF in
// Europe, a satellite estimate about 65 min behind, position only). Pure: no
// DOM, no Cesium.
//
// Honesty rules (06 §5, 05 P3): the motion is observed storm echo, never a
// forecast model; every time counts from now and carries its frame age; an
// arrival is a range; never "safe" or "all clear".

export const NOWCAST_BOX_KM = 160; // frames for motion and approach
export const NOWCAST_PX = 320; // 500 m per pixel
export const FRAME_GAP_MIN = 20; // older frame for the motion pair
export const PROJECT_MAX_MIN = 60; // the time lens projects this far, no more
export const RAIN_DBZ = 20; // below this is not rain (clear air, birds, noise)
export const MOTION_DBZ = 35; // motion is matched on storm echo only
export const CORE_DBZ = 40; // a core starts here
export const HEAVY_DBZ = 50;
export const INTENSE_DBZ = 60;
export const CORE_MIN_KM2 = 4; // specks are never cores
export const SITE_REACH_KM = 1.5; // "over the hotel": core edge this close
export const NEAR_KM = 10; // "within 6 mi": lightning and gusts arrive first

const KM_PER_DEG = 111.32;
const RAD = Math.PI / 180;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const BAND_RANK = { moderate: 1, heavy: 2, intense: 3 };

/** Bands by reflectivity (dBZ). Below 20 dBZ is not rain. */
export function bandOf(dbz) {
  if (!(dbz >= RAIN_DBZ)) return null;
  if (dbz < CORE_DBZ) return 'light';
  if (dbz < HEAVY_DBZ) return 'moderate';
  if (dbz < INTENSE_DBZ) return 'heavy';
  return 'intense';
}

/**
 * A satellite rain-rate palette (Europe) by hue, mapped onto the same dBZ
 * scale for display only. Labelled "satellite estimate" wherever it is used.
 */
export function hueToDbz(hue) {
  if (hue >= 260) return 62;
  if (hue < 15) return 55;
  if (hue < 45) return 50;
  if (hue < 75) return 44;
  if (hue < 165) return 36;
  return 26;
}

/**
 * RGBA pixels → dBZ per pixel (0 = none). decode(r, g, b) → dBZ | null is
 * the exact palette for the source (twinRadarPalette.n0qDbz); without it the
 * hue rule is used (satellite estimate). Anything below 20 dBZ is dropped.
 */
export function rgbaToDbz(rgba, w, h, decode = null) {
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; j < w * h; i += 4, j++) {
    if (rgba[i + 3] < 40) continue;
    let d;
    if (decode) d = decode(rgba[i], rgba[i + 1], rgba[i + 2]);
    else {
      const r = rgba[i] / 255;
      const g = rgba[i + 1] / 255;
      const b = rgba[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let hue = 0;
      if (max !== min) {
        const dd = max - min;
        hue =
          max === r
            ? ((g - b) / dd + 6) % 6
            : max === g
              ? (b - r) / dd + 2
              : (r - g) / dd + 4;
        hue *= 60;
      }
      d = hueToDbz(hue);
    }
    if (d != null && d >= RAIN_DBZ) out[j] = d;
  }
  return out;
}

/** A grid: {data: Float32Array of dBZ, w, h, bbox:[w,s,e,n], t (ms), …}. */
export function makeGrid(data, w, h, bbox, t, extra = {}) {
  return { data, w, h, bbox, t, ...extra };
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

/** 8-point compass for a bearing in degrees. */
export const compass = (deg) =>
  COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Storm echo only (≥ MOTION_DBZ), mean-pooled by f, as matching weights. */
function stormEcho(grid, f) {
  const w = Math.floor(grid.w / f);
  const h = Math.floor(grid.h / f);
  const out = new Float32Array(w * h);
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let yy = 0; yy < f; yy++)
        for (let xx = 0; xx < f; xx++) {
          const v = grid.data[(y * f + yy) * grid.w + x * f + xx];
          if (v >= MOTION_DBZ) s += v - MOTION_DBZ + 1;
        }
      out[y * w + x] = s / (f * f);
      if (s > 0) n++;
    }
  return { data: out, w, h, n };
}

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
 * How storm echo (≥ 35 dBZ) moved from `older` to `newer`:
 * {vxKmh east, vyKmh north, speedKmh, headingDeg (toward), score, dtMin} or
 * {unmeasured: reason}. Clear air, birds and light rain never set the motion.
 */
export function motionVector(
  older,
  newer,
  { maxKmh = 110, coarse = 4, minPx = 50, minScore = 0.5 } = {},
) {
  if (!older || !newer || older.w !== newer.w || older.h !== newer.h)
    return { unmeasured: 'one frame' };
  const dtH = (newer.t - older.t) / 3600e3;
  if (!(dtH > 0)) return { unmeasured: 'one frame' };
  const fullA = stormEcho(older, 1);
  const fullB = stormEcho(newer, 1);
  if (fullA.n < minPx || fullB.n < minPx)
    return { unmeasured: 'too little storm echo' };
  const ck = cellKm(newer);
  const a = stormEcho(older, coarse);
  const b = stormEcho(newer, coarse);
  const maxC = Math.ceil((maxKmh * dtH) / (ck.x * coarse));
  let best = { dx: 0, dy: 0, s: -1 };
  for (let dy = -maxC; dy <= maxC; dy++)
    for (let dx = -maxC; dx <= maxC; dx++) {
      const s = ncc(a, b, dx, dy);
      if (s > best.s) best = { dx, dy, s };
    }
  let fine = { dx: best.dx * coarse, dy: best.dy * coarse, s: -1 };
  for (let dy = fine.dy - coarse; dy <= fine.dy + coarse; dy++)
    for (let dx = fine.dx - coarse; dx <= fine.dx + coarse; dx++) {
      const s = ncc(fullA, fullB, dx, dy);
      if (s > fine.s) fine = { dx, dy, s };
    }
  if (fine.s < minScore) return { unmeasured: 'no clear match between frames' };
  // Pixel rows run north to south: +dy is southward.
  const vxKmh = (fine.dx * ck.x) / dtH;
  const vyKmh = (-fine.dy * ck.y) / dtH;
  return {
    vxKmh,
    vyKmh,
    speedKmh: Math.hypot(vxKmh, vyKmh),
    headingDeg: (Math.atan2(vxKmh, vyKmh) / RAD + 360) % 360 || 0,
    score: fine.s,
    dtMin: dtH * 60,
  };
}
export const hasMotion = (m) => Boolean(m && !m.unmeasured);

/**
 * Cores: 4-connected areas at or above CORE_DBZ, at least CORE_MIN_KM2.
 * Each: {x, y (px centroid), lat, lon, pixels (indices), areaKm2, radiusKm,
 * maxDbz, band}. Strongest first.
 */
export function findCores(
  grid,
  { threshold = CORE_DBZ, minKm2 = CORE_MIN_KM2 } = {},
) {
  const { w, h, data } = grid;
  const seen = new Uint8Array(w * h);
  const ck = cellKm(grid);
  const cores = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || data[i] < threshold) continue;
    const pixels = [];
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
      pixels.push(j);
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
    const areaKm2 = pixels.length * ck.x * ck.y;
    if (areaKm2 < minKm2) continue;
    const x = sx / sv;
    const y = sy / sv;
    cores.push({
      x,
      y,
      ...pxToLL(grid, x, y),
      pixels,
      areaKm2,
      radiusKm: Math.sqrt(areaKm2 / Math.PI),
      maxDbz: peak,
      band: bandOf(peak),
    });
  }
  return cores.sort(
    (a, b) => b.maxDbz - a.maxDbz || b.pixels.length - a.pixels.length,
  );
}

/**
 * Was this core in the older frame too (storm echo near where it was, along
 * the motion)? Specks and one-frame artefacts are not cores.
 */
export function persistent(core, older, motion, grid, { slackPx = 4 } = {}) {
  if (!older) return false;
  const ck = cellKm(grid);
  const back = hasMotion(motion)
    ? {
        dx: Math.round(((motion.vxKmh / 60) * motion.dtMin) / ck.x),
        dy: Math.round((-(motion.vyKmh / 60) * motion.dtMin) / ck.y),
      }
    : { dx: 0, dy: 0 };
  const { w, h } = grid;
  for (const j of core.pixels) {
    const x = (j % w) - back.dx;
    const y = Math.floor(j / w) - back.dy;
    for (let yy = y - slackPx; yy <= y + slackPx; yy += 2)
      for (let xx = x - slackPx; xx <= x + slackPx; xx += 2)
        if (
          xx >= 0 &&
          yy >= 0 &&
          xx < w &&
          yy < h &&
          older.data[yy * w + xx] >= MOTION_DBZ
        )
          return true;
  }
  return false;
}

/** Earliest t ≥ 0 (min) with |p + v t| ≤ R, or null. p km, v km/min. */
function reachTime(p, v, R) {
  const C = p.x * p.x + p.y * p.y - R * R;
  if (C <= 0) return 0;
  const A = v.x * v.x + v.y * v.y;
  if (A < 1e-9) return null;
  const B = 2 * (p.x * v.x + p.y * v.y);
  const disc = B * B - 4 * A * C;
  if (B >= 0 || disc < 0) return null;
  return (-B - Math.sqrt(disc)) / (2 * A);
}

/**
 * Where each core goes on its current track, relative to the site, with every
 * core pixel projected (a squall line is not a circle). Times count from the
 * frame; approachNow() shifts them to now. Returns the core that matters
 * most: {status: 'over' | 'near' | 'arriving' | 'passing' | 'receding' |
 * 'stationary' | 'unknown' | 'none', core, nearMin (to within 10 km),
 * overMin (to within 1.5 km), edgeKm, fromDir, headingDir, speedKmh, cpaKm,
 * others}. Priority: the most severe core over or near the site, then the
 * most severe core arriving within the horizon (earliest within a band),
 * then the nearest core.
 */
export function approach({
  cores,
  motion,
  site,
  grid,
  reachKm = SITE_REACH_KM,
  nearKm = NEAR_KM,
  horizonMin = 120,
}) {
  if (!cores?.length) return { status: 'none' };
  const moving = hasMotion(motion);
  const v = moving ? { x: motion.vxKmh / 60, y: motion.vyKmh / 60 } : null;
  const rows = cores.map((core) => {
    const pts =
      grid && core.pixels
        ? core.pixels.map((j) =>
            toKm(site, pxToLL(grid, j % grid.w, Math.floor(j / grid.w))),
          )
        : [toKm(site, core)];
    let edgeKm = Infinity;
    for (const p of pts) edgeKm = Math.min(edgeKm, Math.hypot(p.x, p.y));
    if (!(grid && core.pixels))
      edgeKm = Math.max(0, edgeKm - (core.radiusKm || 0));
    const c = toKm(site, core);
    const fromDir = compass((Math.atan2(c.x, c.y) / RAD + 360) % 360);
    const base = { core, edgeKm, fromDir };
    if (edgeKm <= reachKm)
      return { ...base, status: 'over', overMin: 0, nearMin: 0 };
    if (!moving)
      return { ...base, status: edgeKm <= nearKm ? 'near' : 'unknown' };
    const speedKmh = motion.speedKmh;
    const more = { speedKmh, headingDir: compass(motion.headingDeg) };
    if (speedKmh < 5)
      return {
        ...base,
        ...more,
        status: edgeKm <= nearKm ? 'near' : 'stationary',
      };
    let nearMin = null;
    let overMin = null;
    let cpaKm = Infinity;
    for (const p of pts) {
      const tn = reachTime(p, v, nearKm);
      const to = reachTime(p, v, reachKm);
      if (tn != null && (nearMin == null || tn < nearMin)) nearMin = tn;
      if (to != null && (overMin == null || to < overMin)) overMin = to;
      const tc = Math.max(
        0,
        -(p.x * v.x + p.y * v.y) / (v.x * v.x + v.y * v.y),
      );
      cpaKm = Math.min(cpaKm, Math.hypot(p.x + v.x * tc, p.y + v.y * tc));
    }
    if (edgeKm <= nearKm)
      return { ...base, ...more, status: 'near', nearMin: 0, overMin, cpaKm };
    if (nearMin != null && nearMin <= horizonMin)
      return { ...base, ...more, status: 'arriving', nearMin, overMin, cpaKm };
    const closing = pts.some((p) => p.x * v.x + p.y * v.y < 0);
    return {
      ...base,
      ...more,
      status: closing ? 'passing' : 'receding',
      cpaKm,
      // On a track to the site, but past the horizon (QA D11).
      beyondMin: nearMin != null ? horizonMin : null,
    };
  });
  const sev = (r) => BAND_RANK[r.core.band] || 0;
  const pick = (status) =>
    rows
      .filter((r) => r.status === status)
      .sort((a, b) => sev(b) - sev(a) || (a.nearMin ?? 0) - (b.nearMin ?? 0));
  const arrivingCount = rows.filter((r) => r.status === 'arriving').length;
  for (const s of ['over', 'near']) {
    const list = pick(s);
    if (list.length) return { ...list[0], others: arrivingCount };
  }
  const arriving = pick('arriving');
  if (arriving.length) return { ...arriving[0], others: arriving.length - 1 };
  return { ...rows.sort((a, b) => a.edgeKm - b.edgeKm)[0], others: 0 };
}

/** Shift an approach computed at the frame time to now (minutes). */
export function approachNow(ap, frameAgeMin) {
  if (!ap || !Number.isFinite(frameAgeMin) || frameAgeMin <= 0) return ap;
  const shift = (t) => (t == null ? t : Math.max(0, t - frameAgeMin));
  return { ...ap, nearMin: shift(ap.nearMin), overMin: shift(ap.overMin) };
}

/** An arrival as a range: "10–15 min", "within 5 min". */
export function etaRange(min) {
  if (!(min > 0)) return 'now';
  if (min < 5) return 'within 5 min';
  const lo = Math.floor((min * 0.8) / 5) * 5;
  const hi = Math.max(lo + 5, Math.ceil((min * 1.2) / 5) * 5);
  return `${lo || '<5'}–${hi} min`;
}

/** The range inside a sentence: "in 10–15 min", "within 5 min", "now". */
export function inEta(min) {
  const r = etaRange(min);
  return r === 'now' || r.startsWith('within') ? r : `in ${r}`;
}

/** "about 25 min" (a single figure, kept for compact places). */
export function etaText(min) {
  if (min < 1) return 'now';
  if (min <= 20) return `about ${Math.max(1, Math.round(min))} min`;
  return `about ${Math.round(min / 5) * 5} min`;
}

const coreName = (c) =>
  `${c.band === 'intense' ? 'Intense' : c.band === 'heavy' ? 'Heavy' : 'Moderate'} rain core`;

/**
 * The line every surface shows, in three tiers:
 *   lead   — the time ("10–15 min", "NOW") for a big numeral
 *   claim  — what happens ("Heavy rain core within 6 mi of the hotel")
 *   detail — where it is now, motion, source and age
 * plus text (all three), short (chip), level (attention | watch | info) and
 * status. fmt = {dist(m), speed(kmh), siteNoun, frame (clock), frameAge
 * (min), source, simulated, boxText, nearText, positionOnly, unmeasured}.
 */
export function approachText(ap, fmt) {
  const sim = fmt.simulated ? 'SIMULATED · ' : '';
  const age = Number.isFinite(fmt.frameAge)
    ? `, ${Math.max(0, Math.round(fmt.frameAge))} min old`
    : '';
  const src = `${fmt.source || 'radar'} ${fmt.frame || ''}${age}`.trim();
  const noun = fmt.siteNoun || 'hotel';
  const six = fmt.nearText || '6 mi';
  const out = (o) => ({
    ...o,
    claim: `${sim}${o.claim}`,
    text: `${sim}${[o.claim, o.detail].filter(Boolean).join(' · ')}`,
    short: o.short ? `${sim}${o.short}` : '',
  });
  if (!ap || ap.status === 'none')
    return out({
      status: 'none',
      level: 'info',
      lead: '',
      claim: `No rain core within ${fmt.boxText || '50 mi'}`,
      detail: `latest ${src}`,
      short: '',
    });
  const c = ap.core;
  const where = `now ${fmt.dist(ap.edgeKm * 1000)} ${ap.fromDir}`;
  const severe = c.band === 'heavy' || c.band === 'intense';
  if (fmt.positionOnly)
    return out({
      status: 'position',
      level: 'info',
      lead: '',
      claim: `${coreName(c)} ${fmt.dist(ap.edgeKm * 1000)} ${ap.fromDir} of the ${noun}`,
      detail: `${src} · no arrival time from an estimate this old`,
      short: '',
    });
  if (ap.status === 'over')
    return out({
      status: 'over',
      level: severe ? 'attention' : 'watch',
      lead: 'NOW',
      claim: `${coreName(c)} over the ${noun}`,
      detail: src,
      short: `${coreName(c)} over the ${noun}`,
    });
  const moving = ap.speedKmh
    ? `moving ${ap.headingDir} ${fmt.speed(ap.speedKmh)}`
    : '';
  if (ap.status === 'near')
    return out({
      status: 'near',
      level: severe ? 'attention' : 'watch',
      lead: 'NOW',
      claim: `${coreName(c)} within ${six} of the ${noun}${ap.overMin ? ` · over it ${inEta(ap.overMin)} on its current track` : ''}`,
      detail: [where, moving, src].filter(Boolean).join(' · '),
      short: `${coreName(c)} within ${six}`,
    });
  if (ap.status === 'unknown')
    return out({
      status: 'unknown',
      level: 'info',
      lead: '',
      claim: `${coreName(c)} ${fmt.dist(ap.edgeKm * 1000)} ${ap.fromDir}`,
      detail: `motion not measured (${fmt.unmeasured || 'too little storm echo'}) · ${src}`,
      short: '',
    });
  if (ap.status === 'arriving') {
    const lead = etaRange(ap.nearMin);
    return out({
      status: 'arriving',
      level: severe && ap.nearMin <= 60 ? 'attention' : 'watch',
      eta: ap.nearMin,
      lead,
      claim: `${coreName(c)} within ${six} of the ${noun} ${inEta(ap.nearMin)}${ap.overMin != null ? ` · over it ${inEta(ap.overMin)}` : ''} on its current track`,
      detail: [
        where,
        moving,
        `${src}, ${fmt.simulated ? 'simulated' : 'observed'} motion`,
        ap.others
          ? `${ap.others} more core${ap.others > 1 ? 's' : ''} on a track toward the ${noun}`
          : '',
      ]
        .filter(Boolean)
        .join(' · '),
      short: `${coreName(c)} · ${six} ${inEta(ap.nearMin)}`,
    });
  }
  if (ap.status === 'passing')
    return out({
      status: 'passing',
      level: 'info',
      lead: '',
      claim:
        ap.beyondMin != null
          ? `${coreName(c)} on a track toward the ${noun}, more than ${ap.beyondMin / 60} h away`
          : `${coreName(c)} passing ${fmt.dist(ap.cpaKm * 1000)} from the ${noun} on its current track`,
      detail: [where, moving, src].filter(Boolean).join(' · '),
      short: '',
    });
  if (ap.status === 'stationary')
    return out({
      status: 'stationary',
      level: 'info',
      lead: '',
      claim: `${coreName(c)} ${fmt.dist(ap.edgeKm * 1000)} ${ap.fromDir}, nearly stationary`,
      detail: `cells repeating over one place can flood · ${src}`,
      short: '',
    });
  return out({
    status: 'receding',
    level: 'info',
    lead: '',
    claim: `${coreName(c)} moving away from the ${noun}`,
    detail: [where, moving, src].filter(Boolean).join(' · '),
    short: '',
  });
}

/** The grid moved along the motion for dtMin (nearest cell, empty fill). */
export function projectGrid(grid, motion, dtMin) {
  if (!hasMotion(motion) || !dtMin) return grid;
  const ck = cellKm(grid);
  const dx = Math.round(((motion.vxKmh / 60) * dtMin) / ck.x);
  const dy = Math.round((-(motion.vyKmh / 60) * dtMin) / ck.y);
  const { w, h } = grid;
  const shift = (src) => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const ys = y - dy;
      if (ys < 0 || ys >= h) continue;
      for (let x = 0; x < w; x++) {
        const xs = x - dx;
        if (xs < 0 || xs >= w) continue;
        out[y * w + x] = src[ys * w + xs];
      }
    }
    return out;
  };
  return {
    ...grid,
    data: shift(grid.data),
    tops: grid.tops ? shift(grid.tops) : grid.tops,
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
 * A simulated squall line for demos: a band of rain with embedded cores,
 * moving NE at 40 km/h, its strongest core aimed at the site and over it
 * about 30 min after `startMs`. Deterministic for a given time, so every
 * wall draws the same storm. Carries simulated echo tops (kft).
 */
export const SIM_STORM = Object.freeze({
  headingDeg: 45,
  speedKmh: 40,
  startKm: 22,
});
export function simulatedStorm({ center, bbox, w, h, tMs, startMs }) {
  const { headingDeg, speedKmh, startKm } = SIM_STORM;
  const hx = Math.sin(headingDeg * RAD);
  const hy = Math.cos(headingDeg * RAD);
  const minutes = (tMs - startMs) / 60e3;
  const along = -startKm + (speedKmh / 60) * minutes;
  const cx = hx * along;
  const cy = hy * along;
  const px = hy;
  const py = -hx;
  const blobs = [
    // [offset along the line km, offset behind km, sigma km, peak dBZ, top kft]
    [0, 0, 2.4, 63, 46],
    [-9, 1.5, 2.8, 54, 38],
    [8, 1, 2.6, 56, 41],
    [-18, 3, 3.6, 46, 30],
    [17, 2.5, 3.4, 47, 31],
  ];
  const data = new Float32Array(w * h);
  const tops = new Float32Array(w * h);
  const grid = { bbox, w, h };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = toKm(center, pxToLL(grid, x, y));
      const rx = p.x - cx;
      const ry = p.y - cy;
      const u = rx * px + ry * py;
      const v = rx * hx + ry * hy;
      // The stratiform band just behind the leading edge (light rain).
      const t =
        Math.exp(-((v + 3) ** 2) / (2 * 3.4 ** 2)) *
        Math.exp(-(u ** 2) / (2 * 26 ** 2));
      let dbz = t > 0.12 ? 22 + 14 * t : 0;
      let top = dbz ? 18 + 6 * t : 0;
      for (const [bu, bv, s, peak, kft] of blobs) {
        const k = Math.exp(-((u - bu) ** 2 + (v + bv) ** 2) / (2 * s * s));
        const d = 20 + (peak - 20) * k;
        if (k > 0.08 && d > dbz) {
          dbz = d;
          top = Math.max(top, 15 + (kft - 15) * Math.sqrt(k));
        }
      }
      if (dbz >= RAIN_DBZ) {
        data[y * w + x] = dbz;
        tops[y * w + x] = top;
      }
    }
  return makeGrid(data, w, h, bbox, tMs, { simulated: true, tops });
}

/** The simulated storm's own motion (known, not measured). */
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

/** Simulated strikes riding with the strongest cores, each with an age. */
export function simulatedStormStrikes(cores, tMs, n = 6) {
  const out = [];
  const heavy = cores.filter((c) => c.maxDbz >= HEAVY_DBZ).slice(0, 3);
  let k = 0;
  for (const c of heavy)
    for (let i = 0; i < Math.ceil(n / Math.max(1, heavy.length)); i++) {
      const a = (k * 137.5 * RAD) % (2 * Math.PI);
      const r = (c.radiusKm * 0.6 * ((k % 3) + 1)) / 3;
      const dLat = (r * Math.cos(a)) / KM_PER_DEG;
      const dLon = (r * Math.sin(a)) / (KM_PER_DEG * Math.cos(c.lat * RAD));
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

/**
 * Trend between two lightning grids. A density grid has 8 km cells, so a
 * change under one cell is not a trend.
 */
export function trendOf(prevKm, nowKm, epsKm = 8) {
  if (!Number.isFinite(prevKm) || !Number.isFinite(nowKm)) return null;
  if (nowKm < prevKm - epsKm) return 'getting closer';
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
