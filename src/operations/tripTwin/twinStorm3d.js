// See it coming in 3D (phase 12, revised after review/phase12): the storm as
// smooth terraced glass shells (one per reflectivity level), standing at the
// storm's measured height (NEXRAD echo tops, drawn at 1:8), rain curtains
// under heavy cores, the storm's track ending on the hotel, the 6 mi ring,
// official alert areas, and the nearest lightning. Every element is pickable
// and says its value, source and age (the inspect card).
//
// Colour: rain is a steel ramp (never path blue, never a meaning colour);
// alert areas amber (official = attention); lightning red (hazard).
import * as Cesium from 'cesium';
import { bandOf, compass, toKm } from './twinNowcast.js';
import { smoothLoop, traceAreas } from './twinContours.js';

export const DRAW_SCALE = 1 / 8;
export const HEIGHT_RULE =
  'height = storm top (NEXRAD echo tops), drawn at 1:8';
export const HEIGHT_RULE_EST =
  'height from intensity (no echo tops here), drawn at 1:8';
export const COLUMN_RULE = HEIGHT_RULE;
const FT = 0.3048;
// Level: [dBZ, fill hex, fill alpha, edge hex, edge alpha, share of the top]
const LEVELS = [
  [30, '#80959b', 0.05, null, 0, 0.12],
  [40, '#9fb3bd', 0.09, '#9fb3bd', 0.55, 0.42],
  [50, '#c3d0d6', 0.14, '#c3d0d6', 0.75, 0.72],
  [60, '#e2e9ec', 0.2, '#eef5f3', 0.9, 1],
];
// Trial (?stormColor=severity): grey for rain, amber for very heavy cores
// (attention), hazard red for intense cores. Not yet adopted.
const SEVERITY_LEVELS = [
  [30, '#80959b', 0.05, null, 0, 0.12],
  [40, '#9fb3bd', 0.08, '#b8c3c7', 0.6, 0.42],
  [50, '#f59e0b', 0.16, '#f59e0b', 0.85, 0.72],
  [60, '#ee7789', 0.26, '#f299a6', 0.95, 1],
];
const SEVERITY =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('stormColor') === 'severity';
const FALLBACK_TOP_KFT = { moderate: 28, heavy: 38, intense: 46 };
const AMBER = Cesium.Color.fromCssColorString('#f59e0b');
const STEEL = Cesium.Color.fromCssColorString('#b8c3c7');
const RED = Cesium.Color.fromCssColorString('#ee7789');
const FIELD = Cesium.Color.fromCssColorString('#040c12');
const RAD = Math.PI / 180;
const KM_PER_DEG = 111.32;

/** A tiling streak texture for rain curtains (drawn once). */
function streakCanvas() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = (i * 37) % 64;
    const y0 = (i * 53) % 256;
    const len = 60 + ((i * 29) % 90);
    const grad = g.createLinearGradient(0, y0, 0, y0 + len);
    grad.addColorStop(0, 'rgba(226,233,236,0)');
    grad.addColorStop(0.5, 'rgba(226,233,236,0.55)');
    grad.addColorStop(1, 'rgba(226,233,236,0)');
    g.strokeStyle = grad;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y0);
    g.lineTo(x - 4, y0 + len);
    g.stroke();
  }
  return c;
}

function loopHas(loop, p) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (
      a.lat > p.lat !== b.lat > p.lat &&
      p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon
    )
      inside = !inside;
  }
  return inside;
}

export function createStormLayer(viewer, site) {
  const scene = viewer.scene;
  const ds = new Cesium.CustomDataSource('trip-twin-storm');
  viewer.dataSources.add(ds);
  let infoText = {};
  let shellInfo = [];
  let labelScale = 1;
  const streaks = streakCanvas();
  const base = () => site.field?.at?.(0, 0) ?? 0;
  const ll = (p, h) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, h);
  const siteLL = () => ({
    lat: site.center.lat,
    lon: site.center.lon ?? site.center.lng,
  });
  const kmToLL = (p0, kx, ky) => ({
    lat: p0.lat + ky / KM_PER_DEG,
    lon: p0.lon + kx / (KM_PER_DEG * Math.cos(p0.lat * RAD)),
  });
  const label = (text, color, extra = {}) => ({
    text,
    font: '500 13px Inter, sans-serif',
    fillColor: color,
    showBackground: true,
    backgroundColor: FIELD.withAlpha(0.88),
    backgroundPadding: new Cesium.Cartesian2(8, 5),
    horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    scale: labelScale,
    ...extra,
  });
  /** Corner coordinates (x right, y down) of the grid → {lat, lon}. */
  const cornerLL = (grid, [x, y]) => {
    const [w, s, e, n] = grid.bbox;
    return {
      lon: w + (x / grid.w) * (e - w),
      lat: n - (y / grid.h) * (n - s),
    };
  };

  /** The storm as terraced glass shells, curtains under heavy cores. */
  function drawShells(grid, { radiusKm = 45, clearKm = 3 } = {}) {
    shellInfo = [];
    const s = siteLL();
    const h0 = base();
    for (const [dbz, fill, fa, edge, ea, share] of SEVERITY
      ? SEVERITY_LEVELS
      : LEVELS) {
      const areas = traceAreas(grid.data, grid.w, grid.h, dbz, {
        tops: grid.tops,
        minCells: dbz === 30 ? 12 : 6,
      });
      for (const a of areas) {
        // The faint footprint only where a real core exists inside it.
        if (dbz === 30 && a.max < 40) continue;
        const loop = smoothLoop(a.loop).map((p) => cornerLL(grid, p));
        let near = Infinity;
        for (const p of loop) {
          const k = toKm(s, p);
          near = Math.min(near, Math.hypot(k.x, k.y));
        }
        const atSite = near < clearKm || loopHas(loop, s);
        if (atSite) near = 0;
        if (near > radiusKm) continue;
        const band = bandOf(a.max);
        const topKft = a.top > 0 ? a.top : FALLBACK_TOP_KFT[band] || 20;
        // Over or right next to the hotel the shell lies flat, so the hotel
        // and the people stay readable; its edge still shows the outline.
        const height = atSite
          ? 12
          : Math.max(60, topKft * 1000 * FT * DRAW_SCALE * share);
        const id = `wx-shell:${shellInfo.length}`;
        shellInfo.push({
          dbz,
          band,
          maxDbz: a.max,
          topKft: a.top > 0 ? a.top : null,
          near,
          atSite,
          center: loop[Math.floor(loop.length / 2)],
          simulated: Boolean(grid.simulated),
        });
        ds.entities.add({
          id,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(
              loop.map((p) => ll(p, h0)),
            ),
            height: h0,
            extrudedHeight: h0 + height,
            material: Cesium.Color.fromCssColorString(fill).withAlpha(
              atSite ? fa * 0.5 : fa,
            ),
            outline: false,
            // Polygons take GEODESIC or RHUMB only (NONE stops rendering).
            arcType: Cesium.ArcType.RHUMB,
          },
        });
        if (edge) {
          const ring = loop.map((p) => ll(p, h0 + height));
          ring.push(ring[0]);
          ds.entities.add({
            id: `${id}:edge`,
            polyline: {
              positions: ring,
              width: dbz >= 60 ? 3 : 1.5,
              arcType: Cesium.ArcType.NONE,
              material:
                dbz >= 60
                  ? new Cesium.PolylineGlowMaterialProperty({
                      color:
                        Cesium.Color.fromCssColorString(edge).withAlpha(ea),
                      glowPower: 0.25,
                    })
                  : Cesium.Color.fromCssColorString(edge).withAlpha(ea),
            },
          });
        }
        // Rain curtains hang under heavy cores (not at the site itself).
        if (dbz === 50 && !atSite) {
          const pts = loop.filter((_, i) => i % 3 === 0);
          pts.push(pts[0]);
          let lenKm = 0;
          for (let i = 1; i < pts.length; i++) {
            const k = toKm(pts[i - 1], pts[i]);
            lenKm += Math.hypot(k.x, k.y);
          }
          ds.entities.add({
            id: `${id}:rain`,
            wall: {
              positions: pts.map((p) => ll(p, h0)),
              maximumHeights: pts.map(() => h0 + height * 0.9),
              minimumHeights: pts.map(() => h0),
              material: new Cesium.ImageMaterialProperty({
                image: streaks,
                repeat: new Cesium.Cartesian2(Math.max(4, lenKm * 3), 1),
                transparent: true,
                color: SEVERITY
                  ? AMBER.withAlpha(0.6)
                  : Cesium.Color.WHITE.withAlpha(0.55),
              }),
              outline: false,
            },
          });
        }
      }
    }
  }

  /** The 6 mi ring around the site: the storm crossing it is the lead time. */
  function drawNearRing(opts) {
    const s = siteLL();
    const R = 10;
    const color = opts.level === 'attention' ? AMBER : STEEL;
    const pts = [];
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * 2 * Math.PI;
      pts.push(ll(kmToLL(s, R * Math.sin(a), R * Math.cos(a)), base() + 20));
    }
    ds.entities.add({
      id: 'wx-near',
      polyline: {
        positions: pts,
        width: 2,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineDashMaterialProperty({
          color: color.withAlpha(0.7),
          dashLength: 22,
        }),
      },
    });
    ds.entities.add({
      id: 'wx-near:label',
      position: ll(kmToLL(s, 0, -R), base() + 30),
      label: label(opts.nearLabel || '6 mi', color.withAlpha(0.95), {
        font: '500 12px "Intel One Mono", monospace',
      }),
    });
    infoText['wx-near'] =
      'The 6 mi (10 km) ring: lightning and gusts usually arrive before the rain core does';
  }

  /** The track from the core to the hotel: thick, with 15-min ticks. */
  function drawTrack(ap, motion, opts) {
    if (!ap?.core || !motion || motion.unmeasured) return;
    const attention = opts.level === 'attention';
    const color = attention ? AMBER : STEEL;
    const h = base() + 60;
    const v = { x: motion.vxKmh / 60, y: motion.vyKmh / 60 };
    const s = siteLL();
    const p0 = toKm(s, ap.core);
    const vv = v.x * v.x + v.y * v.y || 1;
    // Ends at the core's closest approach to the hotel, then a faint dash.
    const tc = Math.max(5, -(p0.x * v.x + p0.y * v.y) / vv);
    const at = (m) => kmToLL(ap.core, v.x * m, v.y * m);
    const main = [];
    const step = Math.max(1, tc / 30);
    for (let m = 0; m < tc; m += step) main.push(ll(at(m), h));
    main.push(ll(at(tc), h));
    ds.entities.add({
      id: 'wx-track',
      polyline: {
        positions: main,
        width: attention ? 9 : 6,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineArrowMaterialProperty(
          color.withAlpha(0.95),
        ),
      },
    });
    const past = [];
    for (let m = tc; m <= tc + 20; m += 2) past.push(ll(at(m), h));
    ds.entities.add({
      polyline: {
        positions: past,
        width: 2,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineDashMaterialProperty({
          color: color.withAlpha(0.35),
          dashLength: 12,
        }),
      },
    });
    for (let m = 15; m < tc; m += 15)
      ds.entities.add({
        position: ll(at(m), h),
        point: {
          pixelSize: 7 * labelScale,
          color,
          outlineColor: FIELD,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: label(`+${m} min`, color, {
          font: '500 12px "Intel One Mono", monospace',
          pixelOffset: new Cesium.Cartesian2(10, 0),
        }),
      });
    ds.entities.add({
      id: 'wx-core',
      position: ll(ap.core, h + 40),
      label: label(opts.trackText || '', color, {
        font: '500 14px Inter, sans-serif',
        pixelOffset: new Cesium.Cartesian2(12, -20),
      }),
    });
    infoText['wx-track'] = opts.inspect || opts.trackText;
    infoText['wx-core'] = opts.inspect || opts.trackText;
    // Time lens: where the core is at the viewed time.
    if (Number.isFinite(opts.lensMin) && opts.lensMin > 0)
      ds.entities.add({
        position: ll(at(opts.lensMin), h + 20),
        point: {
          pixelSize: 13 * labelScale,
          color: FIELD,
          outlineColor: color,
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: label(opts.lensText || '', color, {
          pixelOffset: new Cesium.Cartesian2(14, 14),
        }),
      });
  }

  /** The arrival marker on the hotel: a ring and its time. */
  function drawArrival(opts) {
    if (!opts.arrivalText) return;
    const s = siteLL();
    const color = opts.level === 'attention' ? AMBER : STEEL;
    const R = 1.5;
    const pts = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * 2 * Math.PI;
      pts.push(ll(kmToLL(s, R * Math.sin(a), R * Math.cos(a)), base() + 40));
    }
    ds.entities.add({
      id: 'wx-arrival',
      polyline: {
        positions: pts,
        width: 3,
        arcType: Cesium.ArcType.NONE,
        material: color.withAlpha(0.9),
      },
      // The label sits on the ring's near side, so it stays in view and
      // clear of the wall header at close scales.
      position: (() => {
        const h = viewer.camera.heading + Math.PI;
        return ll(kmToLL(s, R * Math.sin(h), R * Math.cos(h)), base() + 60);
      })(),
      label: label(opts.arrivalText, color, {
        font: '600 14px "Intel One Mono", monospace',
      }),
    });
    infoText['wx-arrival'] = opts.inspect || opts.arrivalText;
  }

  function drawAlerts(alerts, siteNoun) {
    const s = siteLL();
    alerts.forEach((a, i) => {
      if (!a.rings?.length) return;
      const id = `wx-warn:${i}`;
      const text = `${a.simulated ? 'SIMULATED (demo) · ' : `${a.source}: `}${a.event}${a.untilText ? ` · until ${a.untilText}` : ''}${a.inside ? ` · the ${siteNoun} is inside the area` : ''}`;
      infoText[id] =
        `${text} · area from ${a.geometry || a.simulated ? 'the alert polygon' : 'its forecast zones'}`;
      let nearest = null;
      a.rings.slice(0, 12).forEach((ring, j) => {
        const step = Math.ceil(ring.length / 300);
        const r = step > 1 ? ring.filter((_, k) => k % step === 0) : ring;
        ds.entities.add({
          id: j === 0 ? id : `${id}:${j}`,
          wall: {
            positions: r.map(([lon, lat]) => ll({ lat, lon }, base())),
            maximumHeights: r.map(() => base() + 260),
            minimumHeights: r.map(() => base()),
            material: AMBER.withAlpha(a.simulated ? 0.12 : 0.09),
            outline: false,
          },
          polyline: {
            positions: r.map(([lon, lat]) => ll({ lat, lon }, base() + 260)),
            width: 2.5,
            arcType: Cesium.ArcType.NONE,
            material: a.simulated
              ? new Cesium.PolylineDashMaterialProperty({
                  color: AMBER.withAlpha(0.9),
                  dashLength: 16,
                })
              : AMBER.withAlpha(0.85),
          },
        });
        for (const [lon, lat] of r) {
          const k = toKm(s, { lat, lon });
          const d = Math.hypot(k.x, k.y);
          if (!nearest || d < nearest.d) nearest = { d, lat, lon };
        }
      });
      if (nearest)
        ds.entities.add({
          id: `${id}:label`,
          position: ll(nearest, base() + 300),
          label: label(text, AMBER),
        });
    });
  }

  function drawLightning(ltg) {
    if (!ltg?.point) return;
    const h = base() + 25;
    ds.entities.add({
      id: 'wx-ltg',
      polyline: {
        positions: [ll(siteLL(), h), ll(ltg.point, h)],
        width: 2,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineDashMaterialProperty({
          color: RED.withAlpha(0.85),
          dashLength: 12,
        }),
      },
      position: ll(ltg.point, h),
      label: label(ltg.text, RED, {
        pixelOffset: new Cesium.Cartesian2(10, -12),
      }),
    });
    infoText['wx-ltg'] = ltg.text;
  }

  return {
    /**
     * opts: {grid, showShells, ap, motion, level, trackText, arrivalText,
     * inspect, lensMin, lensText, alerts, showAlerts, lightning, siteNoun,
     * nearLabel, labelScale}
     */
    set(opts) {
      ds.entities.removeAll();
      infoText = {};
      labelScale = opts.labelScale || 1;
      if (opts.showShells && opts.grid) drawShells(opts.grid);
      else shellInfo = [];
      const active = ['arriving', 'near', 'over'].includes(opts.ap?.status);
      if (active) drawNearRing(opts);
      if (
        (active || opts.showShells) &&
        opts.ap?.core &&
        opts.ap.status !== 'over' &&
        opts.ap.edgeKm < 120
      )
        drawTrack(opts.ap, opts.motion, opts);
      if (active) drawArrival(opts);
      if (opts.showAlerts)
        drawAlerts(opts.alerts || [], opts.siteNoun || 'hotel');
      if (opts.lightning) drawLightning(opts.lightning);
      scene.requestRender();
    },
    /** Inspect text for a picked weather id: {title, lines} or null. */
    info(id, { frameText = '', siteNoun = 'hotel', dist = null } = {}) {
      const m = /^wx-shell:(\d+)/.exec(id);
      if (m) {
        const c = shellInfo[Number(m[1])];
        if (!c) return null;
        const k = toKm(siteLL(), c.center);
        const dir = compass((Math.atan2(k.x, k.y) / RAD + 360) % 360);
        const band = c.band
          ? c.band[0].toUpperCase() + c.band.slice(1)
          : 'Rain';
        return {
          title: `${c.simulated ? 'SIMULATED · ' : ''}Rain · ${c.dbz} dBZ and above`,
          lines: [
            `${band} · peak ${Math.round(c.maxDbz)} dBZ${c.topKft ? ` · storm top ${Math.round(c.topKft)},000 ft` : ''}`,
            c.atSite
              ? `Over the ${siteNoun}`
              : `${dist ? dist(c.near * 1000) : `${c.near.toFixed(1)} km`} ${dir} of the ${siteNoun} at its nearest`,
            frameText,
            c.atSite
              ? `Drawn flat over the ${siteNoun} so it stays readable`
              : c.topKft
                ? HEIGHT_RULE
                : HEIGHT_RULE_EST,
          ].filter(Boolean),
        };
      }
      const titles = {
        'wx-track': 'Storm track',
        'wx-core': 'Storm track',
        'wx-arrival': 'Arrival at the hotel',
        'wx-near': '6 mi ring',
        'wx-ltg': 'Lightning',
        'wx-warn': 'Official alert area',
      };
      const key = Object.keys(infoText).find(
        (kk) => id === kk || id.startsWith(`${kk}:`),
      );
      if (!key) return null;
      const t = titles[key.replace(/:.*$/, '')] || 'Weather';
      return {
        title:
          key.startsWith('wx-warn') && /SIMULATED/.test(infoText[key])
            ? 'Simulated alert (demo)'
            : t,
        lines: [infoText[key]],
      };
    },
    dispose() {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
    },
  };
}
