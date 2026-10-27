// Weather for the Trip Twin (phase 2). Free / open sources only
// (plans/trip-twin/WEATHER-SOURCES.md). Purposeful, not decorative: every
// layer answers "does weather change what the operator should do here?".
// Precipitation and cloud are neutral grey, never blue (blue = paths).
// Lightning glyphs are static (no flashing; WCAG 2.3.1).
import * as Cesium from 'cesium';
import {
  TT_OVERLAY_ACCENTS,
  mapLabel,
  simulatedFirst,
} from './twinMapLabelEntries.js';
import {
  bearingLabel,
  formatDistance,
  formatRadius,
  haversineM,
} from './twinData.js';

export const LIGHTNING_WATCH_KM = 10;
export const GATHERING_RADIUS_M = 75;
export const WX_BOX_KM = 12; // image box edge, centred on the site

// --- pure: sources ---------------------------------------------------------------

const lng = (p) => p.lon ?? p.lng;

/** WMS GetMap URL for one layer over a box (EPSG:4326, WMS 1.1.1 axis order). */
export function wmsUrl(base, layer, bbox, size = 512) {
  const q = new URLSearchParams({
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
  });
  return `${base}?${q}`;
}

export function boxAround(center, km = WX_BOX_KM) {
  const dLat = km / 2 / 111.32;
  const dLon = km / 2 / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  return [
    lng(center) - dLon,
    center.lat - dLat,
    lng(center) + dLon,
    center.lat + dLat,
  ];
}

const IEM = 'https://mesonet.agron.iastate.edu/cgi-bin/wms';
const NOWCOAST = 'https://nowcoast.noaa.gov/geoserver/ows';
const EUMETVIEW = 'https://view.eumetsat.int/geoserver/wms';

/** Which source answers which need, by region (us | eu). */
export function weatherSources(region) {
  if (region === 'us')
    return {
      precip: {
        base: `${IEM}/nexrad/n0q.cgi`,
        layer: 'nexrad-n0q-900913',
        label: 'Radar · IEM NEXRAD (latest, ~5 min)',
        credit: 'Radar: Iowa Environmental Mesonet / NOAA NEXRAD',
      },
      totals: {
        base: `${IEM}/us/mrms.cgi`,
        layer: 'mrms_p24h',
        label: 'Rain & snow 24 h · NOAA MRMS via IEM',
        credit: '24 h totals: NOAA MRMS via Iowa Environmental Mesonet',
      },
      lightning: {
        base: NOWCOAST,
        layer: 'lightning_detection:ldn_lightning_strike_density',
        label: 'Lightning density · NOAA nowCOAST (8 km grid)',
        credit: 'Lightning: NOAA nowCOAST',
        gridKm: 8,
      },
      warnings: 'nws',
    };
  return {
    precip: {
      base: EUMETVIEW,
      layer: 'mtg_fd:h40b',
      label: 'Rain rate · satellite estimate · EUMETSAT H SAF',
      credit: 'Rain rate: EUMETSAT H SAF (CC BY 4.0)',
    },
    totals: null, // OPERA radar licence unverified: "not available here"
    lightning: {
      base: EUMETVIEW,
      layer: 'mtg_fd:li_afa',
      label: 'Lightning flash area · EUMETSAT MTG-LI (2 km)',
      credit: 'Lightning: EUMETSAT MTG-LI (CC BY 4.0)',
      gridKm: 2,
    },
    warnings: 'meteoalarm',
  };
}

// --- pure: MET Norway now ----------------------------------------------------------

const SYMBOL_TEXT = [
  [/thunder/, 'thunder'],
  [/heavysnow/, 'heavy snow'],
  [/lightsnow/, 'light snow'],
  [/snow/, 'snow'],
  [/sleet/, 'sleet'],
  [/heavyrainshowers/, 'heavy rain showers'],
  [/lightrainshowers/, 'light rain showers'],
  [/rainshowers/, 'rain showers'],
  [/heavyrain/, 'heavy rain'],
  [/lightrain/, 'light rain'],
  [/rain/, 'rain'],
  [/fog/, 'fog'],
  [/partlycloudy/, 'partly cloudy'],
  [/cloudy/, 'cloudy'],
  [/fair/, 'mostly clear'],
  [/clearsky/, 'clear'],
];

export function conditionText(symbol) {
  const s = String(symbol || '').replace(/_(day|night|polartwilight)$/, '');
  for (const [re, text] of SYMBOL_TEXT) if (re.test(s)) return text;
  return s || 'conditions unknown';
}

/** The first time step at or after `now` (MET gives hourly steps). */
export function summarizeMet(json, now = Date.now()) {
  const steps = json?.properties?.timeseries || [];
  const step =
    steps.find((t) => Date.parse(t.time) + 3600e3 > now) || steps[0] || null;
  if (!step) return null;
  const d = step.data.instant.details;
  const n1 = step.data.next_1_hours;
  return {
    validTime: step.time,
    updatedAt: json.properties.meta?.updated_at || null,
    tempC: d.air_temperature,
    apparentC: d.apparent_air_temperature ?? d.air_temperature,
    cloud: {
      total: d.cloud_area_fraction ?? null,
      low: d.cloud_area_fraction_low ?? null,
      mid: d.cloud_area_fraction_medium ?? null,
      high: d.cloud_area_fraction_high ?? null,
    },
    precipMmH: n1?.details?.precipitation_amount ?? null,
    windMs: d.wind_speed ?? null,
    windFromDeg: d.wind_from_direction ?? null,
    symbol: n1?.summary?.symbol_code || null,
    condition: conditionText(n1?.summary?.symbol_code),
  };
}

export const fahrenheit = (c) => Math.round((c * 9) / 5 + 32);

/** Top-bar chip: "84 °F · clear · MET Norway 19:00". */
/**
 * Top-bar chip in parts so only the condition truncates (UI P1-8):
 * {live: 'Now' | 'SIM', temp, condition, source}. Simulated rain is never
 * credited to MET Norway.
 */
export function weatherChipParts(
  sum,
  { useF = false, clock = '', simulated = false } = {},
) {
  if (!sum) return null;
  return {
    live: simulated ? 'SIM' : 'Now',
    temp: useF ? `${fahrenheit(sum.tempC)} °F` : `${Math.round(sum.tempC)} °C`,
    condition: simulated ? `SIMULATED ${sum.condition}` : sum.condition,
    source: simulated
      ? 'prototype · temperature MET Norway'
      : `forecast ${clock} · MET Norway`,
  };
}

export function weatherChip(sum, opts = {}) {
  const p = weatherChipParts(sum, opts);
  if (!p) return 'Weather unavailable';
  return `${p.live} · ${p.temp} · ${p.condition} · ${p.source}`;
}

/** Rain rate band (mm/h, WMO-style): light < 2.5 ≤ moderate < 7.6 ≤ heavy. */
export function rainBand(mmH) {
  if (!Number.isFinite(mmH) || mmH <= 0) return null;
  return mmH < 2.5 ? 'light' : mmH < 7.6 ? 'moderate' : 'heavy';
}

/** Walk-time allowance for rain, with the arithmetic shown (path cards). */
export function rainPace(sum, { simulated = false } = {}) {
  const band = rainBand(sum?.precipMmH);
  if (band !== 'moderate' && band !== 'heavy') return null;
  const pct = band === 'heavy' ? 40 : 25;
  return { band, pct, factor: 1 + pct / 100, simulated };
}

// --- pure: official warnings ------------------------------------------------------

export function parseNwsAlerts(geojson) {
  return (geojson?.features || []).map((f) => ({
    source: 'NWS',
    event: f.properties.event,
    severity: f.properties.severity,
    headline: f.properties.headline,
    ends: f.properties.ends || f.properties.expires || null,
    geometry: f.geometry || null,
    zones: f.properties.affectedZones || [],
  }));
}

export function warningLine(w, timeZone) {
  const until = w.ends || w.expires;
  const t = until
    ? new Date(until).toLocaleString('en-GB', {
        timeZone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  return `Official weather alert · ${w.source}: ${w.event} · area alert${t ? ` until ${t}` : ''}`;
}

// --- pure: exceptions ---------------------------------------------------------------

/**
 * Outdoor gathering points in use: assembly point and rally points with ≥ 3
 * current people within 75 m. Returns [{label, point, count}].
 */
export function gatheringInUse(assessment, snapshot) {
  const pts = [];
  const hc = snapshot.places?.[0]?.hotel_card;
  if (hc?.assembly_point?.coordinates)
    pts.push({
      label: 'the hotel assembly point',
      point: hc.assembly_point.coordinates,
    });
  for (const s of snapshot.safety_points || [])
    if (/^rally/.test(s.category) && s.coordinates)
      pts.push({ label: s.name || 'a rally point', point: s.coordinates });
  return pts
    .map((g) => ({
      ...g,
      count: assessment.rows.filter(
        (r) =>
          r.pos.current &&
          r.person.coordinates &&
          (r.verdict.bucket === 'Outside, nearby' ||
            r.verdict.bucket === 'Away') &&
          haversineM(
            { lat: r.person.coordinates.lat, lon: r.person.coordinates.lng },
            { lat: g.point.lat, lon: lng(g.point) },
          ) <= GATHERING_RADIUS_M,
      ).length,
    }))
    .filter((g) => g.count >= 3);
}

/**
 * EX-WX-01: lightning within 10 km of an outdoor gathering point in use.
 * strikes: [{lat, lon, ageMin}] (points, or density-grid cell centres).
 * Returns null or {text, distanceM, gathering}. Never says "all clear".
 */
export function lightningException(
  strikes,
  gatherings,
  { simulated = false, gridKm = null } = {},
) {
  let best = null;
  for (const g of gatherings)
    for (const s of strikes) {
      const d = haversineM({ lat: g.point.lat, lon: lng(g.point) }, s);
      if (d <= LIGHTNING_WATCH_KM * 1000 && (!best || d < best.distanceM))
        best = { distanceM: d, strike: s, gathering: g };
    }
  if (!best) return null;
  const s = best.strike;
  const age = Number.isFinite(s.ageMin) ? `, ${s.ageMin} min ago` : '';
  // A density raster is a cell, not a strike: say so (review/phase2 F12).
  const what = simulated
    ? 'SIMULATED lightning'
    : `Lightning detected${gridKm ? ` (${gridKm} km grid cell)` : ''}`;
  return {
    ...best,
    text: `${what} ${gridKm && !simulated ? 'within ' : ''}${formatDistance(best.distanceM)} ${bearingLabel({ lat: best.gathering.point.lat, lon: lng(best.gathering.point) }, s)} of ${best.gathering.label}${age} — ${best.gathering.count} people outdoors there`,
  };
}

/** 30-min hold after the last detection (EX-WX-01 resolving text). */
export const LIGHTNING_HOLD_MIN = 30;
export function heldLightning(last, now, clock) {
  if (!last) return null;
  const min = (now - last.at) / 60000;
  if (min > LIGHTNING_HOLD_MIN) return null;
  return {
    ...last.ex,
    text: `${last.ex.text.split(' — ')[0]} — last detected ${clock}; holding ${LIGHTNING_HOLD_MIN} min after the last detection`,
  };
}

/**
 * EX-WX-02 (incident only): ≥ 5 people outside ≥ 20 min, and apparent temp
 * < 5 °C / > 32 °C or moderate+ rain. Information, not advice.
 */
export function exposureException(
  sum,
  outsideCount,
  outsideMin,
  { useF = false, simulated = false } = {},
) {
  if (!sum || outsideCount < 5 || outsideMin < 20) return null;
  const a = sum.apparentC;
  const band = rainBand(sum.precipMmH);
  const why = [];
  if (a < 5 || a > 32)
    why.push(
      `feels like ${useF ? `${fahrenheit(a)} °F` : `${Math.round(a)} °C`}`,
    );
  if (band === 'moderate' || band === 'heavy')
    why.push(`${simulated ? 'SIMULATED ' : ''}${band} rain`);
  if (!why.length) return null;
  // The clock is minutes since the report, not measured dwell (F17).
  return {
    text: `${outsideCount} people outside — about ${outsideMin} min since the report · ${why.join(' · ')} — information, not advice`,
  };
}

// --- simulated (prototype drawer) ------------------------------------------------------

/** Three static strikes; the nearest is 6.2 km from the site. */
export function simulatedStrikes(center) {
  const at = (bearingDeg, km) => {
    const b = (bearingDeg * Math.PI) / 180;
    const dLat = (km * Math.cos(b)) / 111.32;
    const dLon =
      (km * Math.sin(b)) / (111.32 * Math.cos((center.lat * Math.PI) / 180));
    return { lat: center.lat + dLat, lon: lng(center) + dLon };
  };
  return [
    { ...at(225, 6.2), ageMin: 4 },
    { ...at(260, 8.5), ageMin: 11 },
    { ...at(305, 14), ageMin: 22 },
  ];
}

export function simulatedRain(sum) {
  return {
    ...(sum || { tempC: 18, apparentC: 18, cloud: {}, windMs: 4 }),
    precipMmH: 4.2,
    condition: 'moderate rain',
    cloud: { total: 95, low: 85, mid: 70, high: 40 },
  };
}

// --- browser: images -------------------------------------------------------------------

function loadImage(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const off = () => reject(new DOMException('aborted', 'AbortError'));
    signal?.addEventListener('abort', off, { once: true });
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed'));
    img.src = url;
  });
}

/** Three intensity classes (light / moderate / heavy) as grey opacity. */
export const CLASS_ALPHA = [0.22, 0.42, 0.66];
export const classOf = (t) => (t < 0.34 ? 0 : t < 0.67 ? 1 : 2);

/**
 * Recolour a source palette to one neutral grey ramp: hue (blue → red in radar
 * palettes) becomes one of three opacity classes, never colour. The image is
 * upsampled with smoothing first so coarse grids do not read as a
 * checkerboard. A layer that covers almost everything is treated as no data
 * (UI P1-6, SUP P2). Returns {canvas, cover, cells, noData}.
 */
export function recolour(
  img,
  { rgb = [184, 195, 199], sample = 16, scale = 2 } = {},
) {
  const c = document.createElement('canvas');
  c.width = img.width * scale;
  c.height = img.height * scale;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  const data = g.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  let lit = 0;
  const cells = [];
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3];
    if (a < 40) {
      p[i + 3] = 0;
      continue;
    }
    const r = p[i] / 255;
    const gg = p[i + 1] / 255;
    const b = p[i + 2] / 255;
    const max = Math.max(r, gg, b);
    const min = Math.min(r, gg, b);
    let h = 0;
    if (max !== min) {
      const d = max - min;
      h =
        max === r
          ? ((gg - b) / d + 6) % 6
          : max === gg
            ? (b - r) / d + 2
            : (r - gg) / d + 4;
      h *= 60;
    }
    const t = Math.max(0, Math.min(1, (220 - (h > 300 ? 0 : h)) / 220));
    p[i] = rgb[0];
    p[i + 1] = rgb[1];
    p[i + 2] = rgb[2];
    p[i + 3] = Math.round(255 * CLASS_ALPHA[classOf(t)]);
    lit += 1;
    const px = (i / 4) % c.width;
    const py = Math.floor(i / 4 / c.width);
    if (px % sample === 0 && py % sample === 0)
      cells.push([(px + 0.5) / c.width, (py + 0.5) / c.height]);
  }
  const cover = lit / (p.length / 4);
  if (cover > 0.85) {
    g.clearRect(0, 0, c.width, c.height);
    return { canvas: c, cover, cells: [], noData: true };
  }
  g.putImageData(data, 0, 0);
  return { canvas: c, cover, cells, noData: false };
}

/** Synthetic rain cells for the prototype drawer (deterministic). */
export function simulatedRainCanvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  // A band of cells passing just west of the site (centre = 0.5, 0.5).
  const blobs = [
    [0.38, 0.62, 0.09, 0.7],
    [0.44, 0.5, 0.07, 0.85],
    [0.33, 0.44, 0.08, 0.55],
    [0.27, 0.3, 0.1, 0.6],
    [0.5, 0.74, 0.06, 0.45],
    [0.2, 0.18, 0.07, 0.4],
  ];
  for (const [x, y, r, a] of blobs) {
    const grad = g.createRadialGradient(
      x * size,
      y * size,
      0,
      x * size,
      y * size,
      r * size,
    );
    grad.addColorStop(0, `rgba(184,195,199,${a})`);
    grad.addColorStop(1, 'rgba(184,195,199,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  // Same three classes as live data.
  const d = g.getImageData(0, 0, size, size);
  for (let i = 3; i < d.data.length; i += 4) {
    const a = d.data[i] / 255;
    d.data[i] =
      a < 0.12
        ? 0
        : Math.round(255 * CLASS_ALPHA[a < 0.3 ? 0 : a < 0.5 ? 1 : 2]);
  }
  g.putImageData(d, 0, 0);
  return c;
}

function boltCanvas() {
  const c = document.createElement('canvas');
  c.width = 28;
  c.height = 36;
  const g = c.getContext('2d');
  g.fillStyle = '#ee7789';
  g.strokeStyle = '#040c12';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(17, 2);
  g.lineTo(5, 20);
  g.lineTo(13, 20);
  g.lineTo(9, 34);
  g.lineTo(23, 14);
  g.lineTo(15, 14);
  g.closePath();
  g.stroke();
  g.fill();
  return c;
}

// --- browser: scene -------------------------------------------------------------------

/**
 * createWeatherLayer(viewer, site) → { set(layers, data), dispose }.
 * layers: {lightning, precip, totals, clouds}; data: {images, strikes, summary}.
 * Rectangles sit over the site box; precipitation near cloud base (~1.5 km)
 * with a faint ground echo; totals and lightning density as ground tints.
 */
export function createWeatherLayer(viewer, site) {
  const ds = new Cesium.CustomDataSource('trip-twin-weather');
  viewer.dataSources.add(ds);
  const base = site.field.at(0, 0);
  const rect = (bbox) => Cesium.Rectangle.fromDegrees(...bbox);
  const tint = (canvas, alpha = 1) =>
    new Cesium.ImageMaterialProperty({
      image: canvas,
      transparent: true,
      color: Cesium.Color.WHITE.withAlpha(alpha),
    });
  const bolt = boltCanvas();
  const grey = Cesium.Color.fromCssColorString('#b8c3c7');
  const pink = Cesium.Color.fromCssColorString('#ee7789');
  // Weather words are on the world overlay (review/map-labels L5): ambient,
  // first to go when crowded; a lightning note keeps the hazard bar.
  const plate = (pos, text, color) =>
    ds.entities.add({
      position: pos,
      // SIMULATED first, so it is protected and read first (round 1).
      mapLabel: mapLabel('ambient', {
        title: simulatedFirst(text),
        accent: color === pink ? TT_OVERLAY_ACCENTS.hazard : null,
      }),
    });
  /** Dashed edge of an image box with its source label (what, where, when). */
  const boxEdge = (bbox, h, text, color = grey) => {
    const [w, so, e, n] = bbox;
    ds.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([
          w,
          so,
          h,
          e,
          so,
          h,
          e,
          n,
          h,
          w,
          n,
          h,
          w,
          so,
          h,
        ]),
        width: 1,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineDashMaterialProperty({
          color: color.withAlpha(0.6),
          dashLength: 14,
        }),
      },
    });
    plate(Cesium.Cartesian3.fromDegrees(w, so, h + 2), text, color);
  };
  const ring = (center, radiusM, h, material, width = 1) => {
    const pts = [];
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * Math.PI * 2;
      const dLat = (radiusM * Math.cos(t)) / 111320;
      const dLon =
        (radiusM * Math.sin(t)) /
        (111320 * Math.cos((center.lat * Math.PI) / 180));
      pts.push(
        Cesium.Cartesian3.fromDegrees(lng(center) + dLon, center.lat + dLat, h),
      );
    }
    ds.entities.add({
      polyline: {
        positions: pts,
        width,
        arcType: Cesium.ArcType.NONE,
        material,
      },
    });
  };
  return {
    set(layers, data) {
      ds.entities.removeAll();
      const bbox = data.bbox;
      const labels = data.labels || {};
      // Precipitation on the ground: where it is raining relative to the
      // hotel and the paths. A sheet in the air hid the site from above.
      if (layers.precip && data.images.precip)
        ds.entities.add({
          id: 'twin-wx-precip',
          rectangle: {
            coordinates: rect(bbox),
            height: base + 1.5,
            material: tint(data.images.precip, 0.9),
          },
        });
      if (layers.precip && labels.precip)
        boxEdge(bbox, base + 2, labels.precip);
      if (layers.totals && data.images.totals)
        ds.entities.add({
          id: 'twin-wx-totals',
          rectangle: {
            coordinates: rect(bbox),
            height: base + 2,
            material: tint(data.images.totals, 0.6),
          },
        });
      if (layers.totals && labels.totals && !layers.precip)
        boxEdge(bbox, base + 2.5, labels.totals);
      if (layers.lightning) {
        if (data.images.lightning)
          ds.entities.add({
            id: 'twin-wx-lightning-density',
            rectangle: {
              coordinates: rect(data.ltgBbox || bbox),
              height: base + 3,
              material: tint(data.images.lightning, 0.5),
            },
          });
        // The 10 km watch distance around the outdoor gathering point.
        if (data.watchCenter) {
          ring(
            data.watchCenter,
            LIGHTNING_WATCH_KM * 1000,
            base + 4,
            new Cesium.PolylineDashMaterialProperty({
              color: pink.withAlpha(0.8),
              dashLength: 20,
            }),
            2,
          );
          const edge = {
            lat: data.watchCenter.lat - (LIGHTNING_WATCH_KM * 1000) / 111320,
            lon: lng(data.watchCenter),
          };
          plate(
            Cesium.Cartesian3.fromDegrees(edge.lon, edge.lat, base + 6),
            `${formatRadius(LIGHTNING_WATCH_KM * 1000)} lightning watch · ${labels.lightning || ''}`,
            pink,
          );
        }
        // One label per 2 km cluster of strikes, on the newest (round 1).
        const leads = [];
        for (const s of [...(data.strikes || [])].sort(
          (a, b) => a.ageMin - b.ageMin,
        )) {
          const lead = leads.find((l) => haversineM(l, s) <= 2000);
          if (lead) lead.n += 1;
          else leads.push({ ...s, s, n: 1 });
        }
        const leadOf = new Map(leads.map((l) => [l.s, l]));
        for (const s of data.strikes || [])
          ds.entities.add({
            position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, base + 40),
            billboard: {
              image: bolt,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            // The strike says what happened (L1): "SIMULATED lightning".
            mapLabel: leadOf.has(s)
              ? mapLabel('hazard', {
                  title: `${data.simulated?.lightning ? 'SIMULATED l' : 'L'}ightning`,
                  details: [
                    leadOf.get(s).n > 1
                      ? `${leadOf.get(s).n} strikes here · newest ${s.ageMin} min ago`
                      : `${s.ageMin} min ago`,
                  ],
                  gap: 44, // above the bolt
                })
              : undefined,
          });
      }
      const cl = data.summary?.cloud;
      if (layers.clouds && cl) {
        // Three ceilings drawn as rings with a whisper of fill; opacity
        // follows cover %, so stacked layers never wash the site out.
        const center = site.center;
        // 1.5 × the site radius so the rings sit in frame (UI P1-7).
        const r = Math.max(600, 1.5 * (site.radius || 600));
        for (const [km, cover, name] of [
          [1, cl.low, 'Low cloud'],
          [4, cl.mid, 'Mid cloud'],
          [8, cl.high, 'High cloud'],
        ]) {
          if (!Number.isFinite(cover) || cover < 5) continue;
          const h = base + km * 1000;
          ds.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lng(center), center.lat),
            ellipse: {
              semiMajorAxis: r,
              semiMinorAxis: r,
              height: h,
              material: grey.withAlpha(0.02 + 0.05 * (cover / 100)),
              outline: false,
            },
          });
          const pts = [];
          for (let i = 0; i <= 96; i++) {
            const t = (i / 96) * Math.PI * 2;
            const ll = site.projector.toLL(r * Math.cos(t), r * Math.sin(t));
            pts.push(Cesium.Cartesian3.fromDegrees(ll.lon, ll.lat, h));
          }
          ds.entities.add({
            polyline: {
              positions: pts,
              width: 1,
              arcType: Cesium.ArcType.NONE,
              material: new Cesium.PolylineDashMaterialProperty({
                color: grey.withAlpha(0.25 + 0.5 * (cover / 100)),
                dashLength: 16,
              }),
            },
          });
          const edge = site.projector.toLL(0, -r);
          ds.entities.add({
            position: Cesium.Cartesian3.fromDegrees(edge.lon, edge.lat, h),
            mapLabel: mapLabel('ambient', {
              title: `${name} ${Math.round(cover)}%`,
              details: [`~${formatRadius(km * 1000)}`],
            }),
          });
        }
      }
      viewer.scene.requestRender();
    },
    dispose() {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
    },
  };
}

/** Fetch + recolour the image layers that are switched on (lazy, cached by caller). */
export async function loadWeatherImage(src, bbox, { signal, rgb } = {}) {
  const img = await loadImage(wmsUrl(src.base, src.layer, bbox), signal);
  return recolour(img, { rgb });
}

/** Density-grid cells → points (for lightning distance from a raster). */
export function cellsToPoints(cells, bbox) {
  const [w, s, e, n] = bbox;
  return cells.map(([u, v]) => ({
    lat: n - v * (n - s),
    lon: w + u * (e - w),
  }));
}

/** Fetch + recolour one map frame by URL (phase 6 timeline). */
export async function loadWeatherUrl(url, { signal, rgb } = {}) {
  return recolour(await loadImage(url, signal), { rgb });
}
