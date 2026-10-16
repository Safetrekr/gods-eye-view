// Seeded mock barometer traces (03 §6.3, X-31). Fictional. Models weather
// drift, an indoor HVAC offset and sensor noise, so the floor estimator is
// exercised against known ground truth. Also loads a real phone recording
// (CSV: time_s,pressure_hpa[,lat,lon,acc_m],true_floor) for later testing.
import { pressureAt } from './floorEstimate.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Weather: a slow linear trend in hPa/h from a base pressure. */
export function weather({ base = 1013.2, trendHpaPerHour = -0.8 } = {}) {
  return (t) => base + (trendHpaPerHour * t) / 3600;
}

/**
 * path: [{t, z, inside}] keyframes (seconds, metres above street). Linear in
 * between. Returns 1 Hz samples from tStart to tEnd.
 */
export function makeTrace({
  seed = 1,
  path,
  tStart,
  tEnd,
  hz = 1,
  wx = weather(),
  hvacHpa = 0.25,
  noiseHpa = 0.06,
}) {
  const rand = mulberry32(seed);
  const samples = [];
  let wander = 0;
  const zAt = (t) => {
    if (t <= path[0].t) return path[0];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (t <= b.t) {
        const k = (t - a.t) / (b.t - a.t || 1);
        return {
          z: a.z + (b.z - a.z) * k,
          inside: k < 1 ? a.inside : b.inside,
        };
      }
    }
    return path.at(-1);
  };
  for (let t = tStart; t <= tEnd; t += 1 / hz) {
    const { z, inside } = zAt(t);
    wander += gauss(rand) * 0.004;
    const p =
      pressureAt(z, wx(t)) +
      (inside ? hvacHpa : 0) +
      gauss(rand) * noiseHpa +
      wander;
    samples.push({ t, pressure_hpa: Math.round(p * 1000) / 1000 });
  }
  return samples;
}

/** Reference station series every 10 min (outdoor, no HVAC). */
export function stationSeries({
  tStart,
  tEnd,
  wx = weather(),
  seed = 99,
  gap = null,
}) {
  const rand = mulberry32(seed);
  const out = [];
  for (let t = tStart; t <= tEnd; t += 600) {
    if (gap && t >= gap[0] && t <= gap[1]) continue;
    out.push({
      t,
      pressure_hpa: Math.round((wx(t) + gauss(rand) * 0.02) * 1000) / 1000,
    });
  }
  return out;
}

export function parseTraceCsv(text) {
  const rows = String(text).trim().split(/\r?\n/);
  const head = rows[0].split(',').map((s) => s.trim());
  const idx = (k) => head.indexOf(k);
  const out = [];
  for (const line of rows.slice(1)) {
    const c = line.split(',');
    const t = Number(c[idx('time_s')]);
    const p = Number(c[idx('pressure_hpa')]);
    if (!Number.isFinite(t) || !Number.isFinite(p)) continue;
    const row = { t, pressure_hpa: p };
    if (idx('true_floor') >= 0 && c[idx('true_floor')] !== '')
      row.true_floor = Number(c[idx('true_floor')]);
    out.push(row);
  }
  return out;
}
