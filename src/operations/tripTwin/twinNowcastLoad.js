// See it coming (phase 12), browser side without Cesium: fetch the radar
// frames, official alert areas and the nearest lightning, then run the pure
// nowcast. Shared by the twin (All-in-one and walls) and the remote, so every
// surface says the same thing from the same sources.
import {
  FRAME_GAP_MIN,
  NOWCAST_BOX_KM,
  NOWCAST_PX,
  approach,
  approachNow,
  boxKm,
  findCores,
  insideAny,
  makeGrid,
  motionVector,
  nearestPoint,
  outerRings,
  persistent,
  rgbaToDbz,
  simulatedMotion,
  simulatedStorm,
  simulatedStormStrikes,
  simulatedWarningRing,
} from './twinNowcast.js';
import { eetKft, n0qDbz } from './twinRadarPalette.js';

const IEM = 'https://mesonet.agron.iastate.edu';
const NOWCOAST = 'https://nowcoast.noaa.gov/geoserver/ows';
const EUMETVIEW = 'https://view.eumetsat.int/geoserver/wms';
const MIN = 60e3;
const floorTo = (t, m) => Math.floor(t / (m * MIN)) * m * MIN;
const iso = (t) => new Date(t).toISOString().replace('.000Z', 'Z');

const wms = (base, layer, bbox, size, extra = {}) =>
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

/** Region from a city's time zone (as the twin decides it). */
export const regionOf = (timezone) =>
  String(timezone || '').startsWith('America') ? 'us' : 'eu';

/** Where radar frames come from, by region. */
export function nowcastSource(region) {
  if (region === 'us')
    return {
      region,
      source: 'radar',
      stepMin: 5,
      label: 'IEM NEXRAD',
      credit: 'Radar: Iowa Environmental Mesonet / NOAA NEXRAD',
      decode: n0qDbz,
      /** Newest complete 5-min frame: {t, quorum, fallback}. */
      async latest(now, signal) {
        try {
          const r = await fetch(
            `${IEM}/data/gis/images/4326/USCOMP/n0q_0.json`,
            { signal },
          );
          const j = await r.json();
          const t = Date.parse(j?.meta?.valid ?? j?.valid);
          if (Number.isFinite(t))
            return { t: floorTo(t, 5), quorum: j?.meta?.radar_quorum || null };
        } catch {
          /* fall back to a frame safely in the past, and say so */
        }
        return { t: floorTo(now - 10 * MIN, 5), quorum: null, fallback: true };
      },
      topsUrl: (bbox, size) =>
        wms(
          `${IEM}/cgi-bin/wms/nexrad/eet.cgi`,
          'nexrad-eet-900913',
          bbox,
          size,
        ),
      topsMeta: `${IEM}/data/gis/images/4326/USCOMP/eet_0.json`,
      url: (bbox, t, size) =>
        wms(
          `${IEM}/cgi-bin/wms/nexrad/n0q-t.cgi`,
          'nexrad-n0q-wmst',
          bbox,
          size,
          {
            TIME: iso(floorTo(t, 5)),
          },
        ),
    };
  return {
    region,
    source: 'satellite estimate',
    stepMin: 10,
    label: 'EUMETSAT H SAF',
    credit: 'Rain rate: EUMETSAT H SAF (CC BY 4.0)',
    decode: null, // satellite rain rate: hue rule, labelled an estimate
    positionOnly: true, // ~65 min behind: no arrival time from it
    // About 65 min behind real time; say so in every line (frame time).
    async latest(now) {
      return { t: floorTo(now - 65 * MIN, 10), quorum: null };
    },
    url: (bbox, t, size) =>
      wms(EUMETVIEW, 'mtg_fd:h40b', bbox, size, { TIME: iso(floorTo(t, 10)) }),
  };
}

function loadImage(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    signal?.addEventListener(
      'abort',
      () => reject(new DOMException('aborted', 'AbortError')),
      { once: true },
    );
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed'));
    img.src = url;
  });
}

/** One frame as an intensity grid (null when the image does not load). */
export async function loadGrid(
  url,
  { bbox, t, size = NOWCAST_PX, signal, decode = null, raw = false },
) {
  const img = await loadImage(url, signal);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, size, size);
  const px = g.getImageData(0, 0, size, size).data;
  if (raw) return px;
  const data = rgbaToDbz(px, size, size, decode);
  // A frame that is lit almost everywhere is a no-data tile, not rain.
  let lit = 0;
  for (let i = 0; i < data.length; i++) if (data[i] > 0) lit++;
  if (lit / data.length > 0.9) return null;
  return makeGrid(data, size, size, bbox, t);
}

/**
 * The nowcast for a place:
 *   {status: 'live' | 'unavailable', latest, older, motion, cores, ap,
 *    frameAt (ms), source, credit, simulated, bbox}
 * simStart (ms) switches to the simulated storm (demo).
 */
export async function runNowcast({
  center,
  region,
  now = Date.now(),
  signal,
  cache = new Map(),
}) {
  const bbox = boxKm(center, NOWCAST_BOX_KM);
  const src = nowcastSource(region);
  const meta = await src.latest(now, signal);
  const t1 = meta.t;
  const t0 = t1 - FRAME_GAP_MIN * MIN;
  const get = async (t) => {
    const url = src.url(bbox, t, NOWCAST_PX);
    if (cache.has(url)) return cache.get(url);
    const p = loadGrid(url, { bbox, t, signal, decode: src.decode }).catch(
      () => null,
    );
    cache.set(url, p);
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    return p;
  };
  const [older, latest] = await Promise.all([get(t0), get(t1)]);
  if (!latest)
    return {
      status: 'unavailable',
      source: src.source,
      credit: src.credit,
      frameAt: t1,
      bbox,
      region,
    };
  // Echo tops (US): the measured storm height, for the shells.
  if (src.topsUrl) {
    try {
      const [px, tj] = await Promise.all([
        loadGrid(src.topsUrl(bbox, NOWCAST_PX), {
          bbox,
          t: t1,
          signal,
          raw: true,
        }),
        fetch(src.topsMeta, { signal }).then((r) => r.json()),
      ]);
      const tops = new Float32Array(NOWCAST_PX * NOWCAST_PX);
      for (let i = 0, j = 0; j < tops.length; i += 4, j++)
        if (px[i + 3] > 40) tops[j] = eetKft(px[i], px[i + 1], px[i + 2]) || 0;
      latest.tops = tops;
      latest.topsAt = Date.parse(tj?.meta?.valid) || null;
    } catch {
      /* heights then come from intensity, and say so */
    }
  }
  const motion = older
    ? motionVector(older, latest)
    : { unmeasured: 'one frame' };
  // A core must be in both frames: specks and one-frame artefacts are not.
  const cores = findCores(latest).filter(
    (c) => !older || persistent(c, older, motion, latest),
  );
  const frameAgeMin = (now - t1) / 60e3;
  // apFrame is at the frame time; ap is shifted to now (re-shift as it ages).
  const apFrame = approach({ cores, motion, site: center, grid: latest });
  return {
    status: 'live',
    simulated: false,
    region,
    latest,
    older,
    motion,
    cores,
    apFrame,
    ap: approachNow(apFrame, frameAgeMin),
    frameAt: t1,
    frameAgeMin,
    quorum: meta.quorum,
    fallback: Boolean(meta.fallback),
    positionOnly: Boolean(src.positionOnly),
    source: src.source,
    credit: src.credit,
    bbox,
    stepMin: src.stepMin,
  };
}

/** The simulated storm (demo), drawn on top of real weather, never instead. */
export function simNowcast({ center, now = Date.now(), simStart }) {
  const bbox = boxKm(center, NOWCAST_BOX_KM);
  const latest = simulatedStorm({
    center,
    bbox,
    w: NOWCAST_PX,
    h: NOWCAST_PX,
    tMs: now,
    startMs: simStart,
  });
  const motion = simulatedMotion();
  const cores = findCores(latest);
  return {
    status: 'live',
    simulated: true,
    latest,
    older: null,
    motion,
    cores,
    ap: approach({ cores, motion, site: center, grid: latest }),
    frameAt: now,
    frameAgeMin: 0,
    source: 'simulated radar',
    credit: 'SIMULATED storm (prototype)',
    bbox,
    strikes: simulatedStormStrikes(cores, now),
  };
}

/** A past frame on the nowcast box (time lens), from the same source. */
export async function loadPastGrid({ region, center, t, signal, cache }) {
  const src = nowcastSource(region);
  const bbox = boxKm(center, NOWCAST_BOX_KM);
  const ft = floorTo(t, src.stepMin);
  const url = src.url(bbox, ft, NOWCAST_PX);
  if (cache?.has(url)) return cache.get(url);
  const p = loadGrid(url, { bbox, t: ft, signal, decode: src.decode }).catch(
    () => null,
  );
  cache?.set(url, p);
  return p;
}

// --- official alert areas --------------------------------------------------------

const zoneCache = new Map();
async function zoneRings(url, signal) {
  if (zoneCache.has(url)) return zoneCache.get(url);
  const p = fetch(url, {
    signal,
    headers: { Accept: 'application/geo+json' },
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => outerRings(j?.geometry))
    .catch(() => []);
  zoneCache.set(url, p);
  return p;
}

/**
 * NWS alerts for a point, with their areas: [{source, event, severity, ends,
 * rings, inside}]. The area is the alert's own polygon when it has one,
 * else its forecast zones (up to 8 per alert). MeteoAlarm areas carry no
 * shapes: rings is empty and inside is null (unknown).
 */
export async function loadAlertAreas(alerts, center, { signal } = {}) {
  const out = [];
  for (const a of alerts || []) {
    let rings = outerRings(a.geometry);
    if (!rings.length && a.zones?.length) {
      const list = await Promise.all(
        a.zones.slice(0, 40).map((z) => zoneRings(z, signal)),
      );
      rings = list.flat();
    }
    out.push({
      ...a,
      rings,
      inside: rings.length ? insideAny(center, rings) : null,
    });
  }
  return out;
}

/** NWS active alerts at a point, parsed with their zone links. */
export async function loadNwsAlerts(center, { signal } = {}) {
  const r = await fetch(
    `https://api.weather.gov/alerts/active?point=${center.lat.toFixed(4)},${center.lon.toFixed(4)}`,
    { signal, headers: { Accept: 'application/geo+json' } },
  );
  if (!r.ok) throw new Error(`NWS HTTP ${r.status}`);
  const j = await r.json();
  return (j?.features || []).map((f) => ({
    source: 'NWS',
    event: f.properties.event,
    severity: f.properties.severity,
    headline: f.properties.headline,
    ends: f.properties.ends || f.properties.expires || null,
    geometry: f.geometry || null,
    zones: f.properties.affectedZones || [],
  }));
}

/** The demo storm's warning (always labelled SIMULATED). */
export function simulatedAlert(center, now, simStart) {
  const ring = simulatedWarningRing(center, now, simStart);
  return {
    source: 'SIMULATED',
    event: 'Severe Thunderstorm Warning',
    severity: 'Severe',
    ends: new Date(simStart + 75 * MIN).toISOString(),
    rings: [ring],
    inside: insideAny(center, [ring]),
    simulated: true,
  };
}

// --- lightning ----------------------------------------------------------------------

/**
 * The nearest lightning to the site from the regional density grid
 * (nowCOAST 8 km cells in the US, EUMETSAT MTG-LI in Europe):
 * {distKm, dir, point, at, source, grid: true} | null (none in the box).
 * Throws when the source does not answer.
 */
export async function loadLightningNearest(region, center, { signal } = {}) {
  const km = 80;
  const bbox = boxKm(center, km);
  const size = 160;
  const url =
    region === 'us'
      ? wms(
          NOWCOAST,
          'lightning_detection:ldn_lightning_strike_density',
          bbox,
          size,
        )
      : wms(EUMETVIEW, 'mtg_fd:li_afa', bbox, size);
  const img = await loadImage(url, signal);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, size, size);
  const px = g.getImageData(0, 0, size, size).data;
  const points = [];
  const [w, s, e, n] = bbox;
  for (let y = 0; y < size; y += 2)
    for (let x = 0; x < size; x += 2)
      if (px[(y * size + x) * 4 + 3] > 40)
        points.push({
          lon: w + ((x + 0.5) / size) * (e - w),
          lat: n - ((y + 0.5) / size) * (n - s),
        });
  const near = nearestPoint(center, points);
  return near
    ? {
        ...near,
        at: Date.now(),
        source: region === 'us' ? 'nowCOAST density' : 'EUMETSAT MTG-LI',
        grid: true,
      }
    : null;
}
