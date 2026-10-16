// floor-v1: deterministic floor estimate from phone barometer samples.
// Pure: JSON in, JSON out, no clock or IO (03 §6.4). Designed to move into
// Core unchanged; scripts/fixtures/trip-twin/floor-vectors.json is the shared
// golden file a Python port must also pass.
//
// Band rule: the reported floors are the ones whose height range overlaps
// [h − 2σ, h + 2σ] (floor(), not floor/ceil). The plan's floor/ceil wording
// always widens a band to ≥ 4 levels, contradicting its own "Likely floor 10
// (9–11)" examples; overlap is what the label means.

export const MODEL_VERSION = 'floor-v1';
const R_DRY = 287.05;
const G = 9.80665;
const T_STD = 288.15;
const SCALE_M = (R_DRY * T_STD) / G; // ≈ 8434 m
const SIGMA_FIXED = Math.sqrt(0.8 ** 2 + 1.0 ** 2 + 1.5 ** 2); // sensor, anchor, HVAC
const DRIFT_NO_REF = 2.0; // m per hour
const DRIFT_WITH_REF = 0.8;
const ANCHOR_MAX_S = 4 * 3600;
const SAMPLE_MAX_S = 30 * 60;
const SMOOTH_S = 60;
const VERTICAL_RATE = 0.15; // m/s: stairs are ~0.15–0.3 m/s vertical, lifts 1–2 m/s
export const DEFAULT_FLOOR_H = 3.3;
export const DEFAULT_LOBBY_H = 4.5;

const unknown = (reason, extra = {}) => ({
  status: 'unknown',
  unknown_reason: reason,
  basis: 'barometric',
  model_version: MODEL_VERSION,
  ...extra,
});

function interp(series, t) {
  if (!series?.length) return null;
  if (t <= series[0].t) return series[0].pressure_hpa;
  if (t >= series.at(-1).t) return series.at(-1).pressure_hpa;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    if (t <= b.t)
      return (
        a.pressure_hpa +
        ((b.pressure_hpa - a.pressure_hpa) * (t - a.t)) / (b.t - a.t || 1)
      );
  }
  return series.at(-1).pressure_hpa;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Height (m above street) → level index above the street (0 = street level). */
export function levelAt(z, floorH, lobbyH) {
  if (z < lobbyH) return z < 0 ? Math.floor(z / floorH) : 0;
  return 1 + Math.floor((z - lobbyH) / floorH);
}

/**
 * input = { now, samples:[{t,pressure_hpa}], anchor:{t,pressure_hpa,ground_m},
 *   entrance_ground_m, reference:[{t,pressure_hpa}], building:{levels_above_ground,
 *   floor_height_m, height_m, lobby_height_m, ground_floor_label}, barometer,
 *   consent, place_id }  (times in seconds)
 */
export function estimateFloor(input) {
  const { now, samples = [], anchor, reference = [], building = {} } = input;
  const base = { place_id: input.place_id ?? null };
  if (input.consent === false) return unknown('consent_off', base);
  if (input.barometer !== 'available') return unknown('no_barometer', base);
  if (!anchor) return unknown('no_anchor', base);
  if (now - anchor.t > ANCHOR_MAX_S)
    return unknown('anchor_too_old', { ...base, anchor_at: anchor.t });
  const recent = samples.filter((s) => s.t <= now);
  if (!recent.length) return unknown('no_anchor', base);
  const newest = recent.at(-1);
  if (now - newest.t > SAMPLE_MAX_S)
    return unknown('sample_too_old', { ...base, sample_at: newest.t });

  // Sensor jump: > 0.5 hPa step in < 5 s (02 §2.5).
  for (let i = Math.max(1, recent.length - 30); i < recent.length; i++) {
    const a = recent[i - 1];
    const b = recent[i];
    if (b.t - a.t < 5 && Math.abs(b.pressure_hpa - a.pressure_hpa) > 0.5)
      return unknown('sensor_jump', { ...base, sample_at: newest.t });
  }

  // Vertical movement over the last ~20 s. While moving, smooth over 5 s
  // instead of 60 s so the band follows the phone rather than lagging behind.
  const tail = recent.filter((s) => newest.t - s.t <= 20);
  let moving = null;
  if (tail.length >= 5) {
    // Least-squares slope of height vs time: robust to single noisy samples.
    const hs = tail.map((s) => ({
      t: s.t,
      h: SCALE_M * Math.log(tail[0].pressure_hpa / s.pressure_hpa),
    }));
    const mt = hs.reduce((a, x) => a + x.t, 0) / hs.length;
    const mh = hs.reduce((a, x) => a + x.h, 0) / hs.length;
    let num = 0;
    let den = 0;
    for (const x of hs) {
      num += (x.t - mt) * (x.h - mh);
      den += (x.t - mt) ** 2;
    }
    const rate = den ? num / den : 0; // m/s, + = up
    if (Math.abs(rate) > VERTICAL_RATE)
      moving = rate > 0 ? 'ascending' : 'descending';
  }
  const window = recent.filter(
    (s) => newest.t - s.t <= (moving ? 5 : SMOOTH_S),
  );
  const pNow = median(window.map((s) => s.pressure_hpa));

  // Weather drift correction against a reference series.
  const refAnchor = interp(reference, anchor.t);
  const refNow = interp(reference, newest.t);
  const hasRef = refAnchor !== null && refNow !== null;
  const pAnchor = anchor.pressure_hpa + (hasRef ? refNow - refAnchor : 0);

  const dh = SCALE_M * Math.log(pAnchor / pNow);
  const h =
    dh +
    ((anchor.ground_m ?? 0) -
      (input.entrance_ground_m ?? anchor.ground_m ?? 0));
  const hours = Math.max(0, (newest.t - anchor.t) / 3600);
  const drift = (hasRef ? DRIFT_WITH_REF : DRIFT_NO_REF) * hours;
  const sigma = Math.sqrt(SIGMA_FIXED ** 2 + drift ** 2);

  const levels = building.levels_above_ground ?? null;
  const floorH =
    building.floor_height_m ??
    (building.height_m && levels
      ? building.height_m / levels
      : DEFAULT_FLOOR_H);
  const lobbyH = Math.max(floorH, building.lobby_height_m ?? DEFAULT_LOBBY_H);
  const groundLabel = building.ground_floor_label ?? null;

  const maxLevel = levels ? levels : Infinity; // one level of slack above the top floor
  if (levels && h - 2 * sigma > levels * floorH + lobbyH)
    return unknown('inconsistent_with_building', {
      ...base,
      sample_at: newest.t,
    });

  // No basements unless the building says so: never report a floor we can't place.
  const minLevel = -(building.levels_below_ground ?? 0) || 0; // avoid -0
  const clampLevel = (l) => Math.min(maxLevel, Math.max(minLevel, l));
  const likely = clampLevel(levelAt(h, floorH, lobbyH));
  const low = clampLevel(levelAt(h - 2 * sigma, floorH, lobbyH));
  const high = clampLevel(levelAt(h + 2 * sigma, floorH, lobbyH));
  const width = high - low + 1;
  if (width > 5)
    return unknown('too_uncertain', {
      ...base,
      sample_at: newest.t,
      sigma_m: round(sigma),
    });
  let confidence = width <= 3 ? 'high' : 'medium';
  if (!levels && confidence === 'high') confidence = 'medium';
  const label = (l) => (groundLabel === null ? null : l + groundLabel);
  return {
    status: 'estimated',
    moving,
    unknown_reason: null,
    place_id: input.place_id ?? null,
    level_likely: likely,
    level_low: low,
    level_high: high,
    label_likely: label(likely),
    label_low: label(low),
    label_high: label(high),
    ground_floor_label: groundLabel,
    height_above_ground_m: round(h),
    sigma_m: round(sigma),
    confidence,
    sample_at: newest.t,
    anchor_at: anchor.t,
    basis: 'barometric',
    levels_basis: levels ? building.levels_source || 'osm_levels' : 'unknown',
    model_version: MODEL_VERSION,
  };
}

function round(x) {
  return Math.round(x * 100) / 100;
}

/** Pressure (hPa) for a height above a reference pressure — inverse of the model. */
export function pressureAt(heightM, p0) {
  return p0 * Math.exp(-heightM / SCALE_M);
}
