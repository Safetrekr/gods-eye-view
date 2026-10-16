// Weather over time (phase 6): the MET Norway timeseries as steps, what is
// falling and how hard, and which kind of data a moment on the timeline is.
// Pure — no Cesium, no DOM.
import { conditionText } from './twinWeather.js';

const HOUR = 3600e3;

/**
 * MET Norway Locationforecast "complete" → [{t, tempC, precipMmH, symbol,
 * condition, cloud{low,mid,high,total}, fogPct, windMs, windFromDeg, stepH}].
 * Hourly steps carry next_1_hours; later 6-hourly steps carry next_6_hours
 * (spread evenly, so mm/h stays comparable).
 */
export function metSteps(json) {
  const out = [];
  for (const s of json?.properties?.timeseries || []) {
    const d = s.data?.instant?.details || {};
    const n1 = s.data?.next_1_hours;
    const n6 = s.data?.next_6_hours;
    const next = n1 || n6 || null;
    const hours = n1 ? 1 : n6 ? 6 : null;
    const amount = next?.details?.precipitation_amount;
    out.push({
      t: Date.parse(s.time),
      tempC: d.air_temperature ?? null,
      precipMmH:
        Number.isFinite(amount) && hours ? +(amount / hours).toFixed(2) : null,
      symbol: next?.summary?.symbol_code || null,
      condition: conditionText(next?.summary?.symbol_code),
      cloud: {
        total: d.cloud_area_fraction ?? null,
        low: d.cloud_area_fraction_low ?? null,
        mid: d.cloud_area_fraction_medium ?? null,
        high: d.cloud_area_fraction_high ?? null,
      },
      fogPct: d.fog_area_fraction ?? null,
      windMs: d.wind_speed ?? null,
      windFromDeg: d.wind_from_direction ?? null,
      stepH: hours,
    });
  }
  return out.filter((s) => Number.isFinite(s.t)).sort((a, b) => a.t - b.t);
}

/** The step covering time t (the last step that starts at or before t). */
export function stepAt(steps, t) {
  if (!steps?.length) return null;
  let best = null;
  for (const s of steps) {
    if (s.t <= t) best = s;
    else break;
  }
  if (!best) return null;
  // Past the end of the covered period: no step (never stretch a forecast).
  if (t >= best.t + (best.stepH || 1) * HOUR) return null;
  return best;
}

/**
 * What is falling: 'snow' | 'sleet' | 'rain' | null. The symbol decides; the
 * temperature only settles a bare "rain"/precip amount near freezing.
 */
export function precipKind(step) {
  if (!step) return null;
  const sym = String(step.symbol || '');
  const mm = step.precipMmH ?? 0;
  if (/sleet/.test(sym)) return 'sleet';
  if (/snow/.test(sym)) return 'snow';
  if (/rain|showers|thunder/.test(sym)) return 'rain';
  if (mm > 0.05) {
    if (Number.isFinite(step.tempC) && step.tempC <= 0) return 'snow';
    if (Number.isFinite(step.tempC) && step.tempC <= 2) return 'sleet';
    return 'rain';
  }
  return null;
}

/** mm/h → {band, level 0..1}; rain bands as in phase 2 (rainBand). */
export function intensity(mmH, kind = 'rain') {
  if (!Number.isFinite(mmH) || mmH <= 0) return { band: 'trace', level: 0.15 };
  // Snow water equivalent is small: 1 mm/h of water is heavy snow.
  const m = kind === 'snow' ? mmH * 4 : mmH;
  if (m < 2.5) return { band: 'light', level: 0.3 };
  if (m < 7.6) return { band: 'moderate', level: 0.6 };
  return { band: 'heavy', level: 1 };
}

/**
 * The kind of data at time t on the timeline.
 * observed: radar / satellite past frames; model: forecast map (US, to
 * modelUntil); site: the site forecast only; none: beyond every source.
 */
export function timeKind(
  t,
  { now, pastMs = 2 * HOUR, modelUntil = null, siteUntil = null },
) {
  if (t < now - pastMs) return 'none';
  if (t <= now) return 'observed';
  if (modelUntil && t <= modelUntil) return 'model';
  if (siteUntil && t <= siteUntil) return 'site';
  return 'none';
}

/** "+1 h 45 min" / "−55 min" relative to now. */
export function relText(t, now) {
  const d = Math.round((t - now) / 60000);
  if (d === 0) return 'now';
  const sign = d > 0 ? '+' : '−';
  const a = Math.abs(d);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `${sign}${h ? `${h} h${m ? ' ' : ''}` : ''}${m || !h ? `${m} min` : ''}`;
}

/**
 * The row text for 3D rain & snow — honest about the source and about a
 * forecast the radar does not show. radar: null (off / unavailable) |
 * {covered: bool, label}.
 */
export function precipRowText({ step, kind, radar, simulated, at }) {
  if (simulated) return `SIMULATED ${simulated} (prototype)`;
  if (!step) return 'No site forecast for this time';
  const level = intensity(step.precipMmH, kind || 'rain').band;
  const what = kind ? `${level} ${kind}` : 'no rain or snow';
  if (!kind) return `Forecast: ${what} · MET Norway, ${at}`;
  if (radar && !radar.covered)
    return `Forecast ${kind} · none on ${radar.label} over the site now`;
  return radar
    ? `${what.replace(/^./, (c) => c.toUpperCase())} · where ${radar.label} shows it · amount: MET Norway forecast, ${at}`
    : `${what.replace(/^./, (c) => c.toUpperCase())} · MET Norway forecast for the site, ${at} · not a map`;
}

// --- map frames over time (WEATHER-TIMELINE-SOURCES.md, verified 16 Oct 2026) ---

const IEM = 'https://mesonet.agron.iastate.edu';
const EUMETVIEW = 'https://view.eumetsat.int/geoserver/wms';
const DWD = 'https://maps.dwd.de/geoserver/dwd/wms';
const MIN = 60e3;

const wms = (base, layer, bbox, extra = {}, size = 512) =>
  `${base}?${new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.1.1',
    LAYERS: layer,
    STYLES: '',
    SRS: 'EPSG:4326',
    BBOX: bbox.join(','),
    WIDTH: String(size),
    HEIGHT: String(size),
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
    ...extra,
  })}`;
const floorTo = (t, min) => Math.floor(t / (min * MIN)) * min * MIN;
const iso = (t) => new Date(t).toISOString().replace('.000Z', 'Z');
const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * Past and forecast map frames by region. Each frame source gives
 * {kind, from(now, meta), until(now, meta), frameTime(t), url(bbox, t, meta),
 *  label(t, meta), credit}. meta = what the page fetched (latest radar frame,
 *  model run). A time outside [from, until] has no frame.
 */
export function timeSources(region) {
  if (region === 'us')
    return {
      observed: {
        kind: 'observed',
        // IEM n0q WMS-T: exact 5-min frames only (off-grid = blank PNG).
        from: (now) => now - 2 * 3600e3,
        until: (now, meta) => meta?.latestRadar ?? now - 10 * MIN,
        frameTime: (t) => floorTo(t, 5),
        url: (bbox, t) =>
          wms(`${IEM}/cgi-bin/wms/nexrad/n0q-t.cgi`, 'nexrad-n0q-wmst', bbox, {
            TIME: iso(floorTo(t, 5)),
          }),
        latestUrl: `${IEM}/data/gis/images/4326/USCOMP/n0q_0.json`,
        parseLatest: (j) => {
          const t = Date.parse(j?.meta?.valid ?? j?.valid);
          return Number.isFinite(t) ? t : null;
        },
        label: () => 'Radar · IEM NEXRAD · observed',
        credit: 'Radar: Iowa Environmental Mesonet / NOAA NEXRAD',
      },
      model: {
        kind: 'model',
        // HRRR simulated reflectivity, pinned to one run: 15-min to +18 h.
        from: (now) => now,
        until: (now, meta) => (meta?.run ? meta.run + 18 * 3600e3 : null),
        frameTime: (t) => floorTo(t, 15),
        url: (bbox, t, meta) => {
          const r = new Date(meta.run);
          const f = Math.round((floorTo(t, 15) - meta.run) / MIN);
          return wms(`${IEM}/cgi-bin/wms/hrrr/refd.cgi`, 'refd-t', bbox, {
            year: String(r.getUTCFullYear()),
            month: pad(r.getUTCMonth() + 1),
            day: pad(r.getUTCDate()),
            hour: pad(r.getUTCHours()),
            f: pad(f, 4),
          });
        },
        runUrl: `${IEM}/data/gis/images/4326/hrrr/refd_0000.json`,
        parseRun: (j) => {
          const t = Date.parse(j?.model_init_utc);
          return Number.isFinite(t) ? t : null;
        },
        label: () => 'Forecast radar (model) · NOAA HRRR',
        credit: 'Forecast radar: NOAA/NCEP HRRR via Iowa Environmental Mesonet',
      },
    };
  return {
    observed: {
      kind: 'observed',
      // EUMETSAT H SAF satellite rain rate: 10-min frames, ~65 min behind,
      // some frames missing (502) — shown as missing, never interpolated.
      from: (now) => now - 2 * 3600e3,
      until: (now) => now - 65 * MIN,
      frameTime: (t) => floorTo(t, 10),
      url: (bbox, t) =>
        wms(EUMETVIEW, 'mtg_fd:h40b', bbox, { TIME: iso(floorTo(t, 10)) }),
      label: () => 'Rain rate · satellite estimate · EUMETSAT H SAF',
      credit: 'Rain rate: EUMETSAT H SAF (CC BY 4.0)',
    },
    model: {
      kind: 'model',
      // DWD ICON-EU 1 h precipitation, hourly, from a run old enough to be
      // fully loaded (runs 00/06/12/18 UTC; ~5 h to ingest).
      from: (now) => now,
      until: (now) => now + 48 * 3600e3,
      frameTime: (t) => Math.ceil(t / 3600e3) * 3600e3,
      url: (bbox, t, meta) =>
        wms(DWD, 'dwd:Icon-eu_reg00625_fd_sl_TOTPREC01H', bbox, {
          TIME: new Date(Math.ceil(t / 3600e3) * 3600e3).toISOString(),
          DIM_REFERENCE_TIME: new Date(meta.run).toISOString(),
        }),
      run: (now) => floorTo(now - 5 * 3600e3, 360),
      label: () => 'Forecast rain (model) · DWD ICON-EU, 1 h totals',
      credit: 'Forecast rain: Deutscher Wetterdienst ICON-EU (CC BY 4.0)',
    },
  };
}
