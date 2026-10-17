// See it coming in 3D (phase 12): radar with height, the storm's track to the
// site, official alert areas, and the nearest lightning. Every element is
// pickable and says its value, source and age (the inspect card).
//
// Colour: rain is a steel ramp (never path blue, never a meaning colour);
// alert areas amber (official = attention); lightning red (hazard). Column
// height encodes the radar's intensity class, not cloud height, and says so.
import * as Cesium from 'cesium';
import { bandOf, cellKm, pxToLL, toKm, compass } from './twinNowcast.js';

const STEEL = {
  light: ['#80959b', 0.12, 120],
  moderate: ['#9fb3bd', 0.22, 280],
  heavy: ['#c3d0d6', 0.34, 520],
  intense: ['#e2e9ec', 0.5, 800],
};
export const COLUMN_RULE =
  'column height = radar intensity class, not cloud height';
const AMBER = Cesium.Color.fromCssColorString('#f59e0b');
const STEEL_LINE = Cesium.Color.fromCssColorString('#b8c3c7');
const RED = Cesium.Color.fromCssColorString('#ee7789');
const FIELD = Cesium.Color.fromCssColorString('#040c12');
const RAD = Math.PI / 180;

const label = (text, color, extra = {}) => ({
  text,
  font: '500 12px Inter, sans-serif',
  fillColor: color,
  showBackground: true,
  backgroundColor: FIELD.withAlpha(0.88),
  backgroundPadding: new Cesium.Cartesian2(7, 4),
  horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
  disableDepthTestDistance: Number.POSITIVE_INFINITY,
  ...extra,
});

/** Keep at most n points of a ring (alert zones can be detailed). */
function thin(ring, n = 300) {
  if (ring.length <= n) return ring;
  const step = Math.ceil(ring.length / n);
  const out = ring.filter((_, i) => i % step === 0);
  out.push(ring[ring.length - 1]);
  return out;
}

export function createStormLayer(viewer, site) {
  const scene = viewer.scene;
  const ds = new Cesium.CustomDataSource('trip-twin-storm');
  viewer.dataSources.add(ds);
  let columns = null;
  let columnKey = '';
  let cellInfo = [];
  let lastGrid = null;
  let infoText = {};
  const base = () => site.field?.at?.(0, 0) ?? 0;
  const ll = (p, h) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, h);

  function dropColumns() {
    if (columns && !scene.isDestroyed?.()) scene.primitives.remove(columns);
    columns = null;
    columnKey = '';
    cellInfo = [];
  }

  /** Columns for every lit cell within radiusKm, outside the site's clear disc. */
  function drawColumns(grid, { radiusKm = 30, clearM = 700, maxCells = 4000 }) {
    const key = `${grid.t}:${grid.projected ? 'p' : ''}:${grid.simulated ? 's' : ''}:${grid.bbox.join(',')}`;
    if (key === columnKey) return;
    dropColumns();
    columnKey = key;
    lastGrid = grid;
    const ck = cellKm(grid);
    const c = site.center;
    const center = { lat: c.lat, lon: c.lon ?? c.lng };
    const cells = [];
    for (let y = 0; y < grid.h; y++)
      for (let x = 0; x < grid.w; x++) {
        const t = grid.data[y * grid.w + x];
        // Moderate and above only: light returns can be birds, insects or
        // clear air at night; the ground map still shows them.
        if (!(t >= 0.5)) continue;
        const p = pxToLL(grid, x, y);
        const k = toKm(center, p);
        const d = Math.hypot(k.x, k.y);
        if (d > radiusKm || d * 1000 < clearM) continue;
        cells.push({ t, p, d, k });
      }
    cells.sort((a, b) => b.t - a.t);
    const keep = cells.slice(0, maxCells);
    if (!keep.length) return;
    const h0 = base();
    const instances = keep.map((cell, i) => {
      const band = bandOf(cell.t);
      const [hex, alpha, full] = STEEL[band];
      // Within 3 km of the site a column is a flat plate: the hotel and the
      // people stay readable at close range; height returns further out.
      const height = cell.d < 3 ? 6 : full;
      const pos = ll(cell.p, h0 + height / 2);
      cellInfo[i] = { ...cell, band, height };
      return new Cesium.GeometryInstance({
        geometry: Cesium.BoxGeometry.fromDimensions({
          vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
          dimensions: new Cesium.Cartesian3(ck.x * 920, ck.y * 920, height),
        }),
        modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(pos),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            Cesium.Color.fromCssColorString(hex).withAlpha(
              cell.d < 3 ? alpha * 0.35 : alpha,
            ),
          ),
        },
        id: { id: `wx-cell:${i}` },
      });
    });
    columns = scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({
          flat: true,
          translucent: true,
          closed: true,
        }),
        asynchronous: true,
        releaseGeometryInstances: true,
      }),
    );
  }

  /** The track from the core along its motion, ticks every 15 min. */
  function drawTrack(ap, motion, opts) {
    if (!ap?.core || !motion) return;
    const color = opts.level === 'attention' ? AMBER : STEEL_LINE;
    const h = base() + 40;
    const v = { x: motion.vxKmh / 60, y: motion.vyKmh / 60 };
    const kmToLL = (p0, kx, ky) => ({
      lat: p0.lat + ky / 111.32,
      lon: p0.lon + kx / (111.32 * Math.cos(p0.lat * RAD)),
    });
    const span = ap.status === 'arriving' ? Math.max(60, ap.etaMin + 15) : 60;
    const pts = [];
    for (let m = 0; m <= span; m += 5)
      pts.push(ll(kmToLL(ap.core, v.x * m, v.y * m), h));
    ds.entities.add({
      id: 'wx-track',
      polyline: {
        positions: pts,
        width: 3,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineArrowMaterialProperty(
          color.withAlpha(0.9),
        ),
      },
    });
    for (let m = 15; m <= span; m += 15) {
      const p = kmToLL(ap.core, v.x * m, v.y * m);
      ds.entities.add({
        position: ll(p, h),
        point: {
          pixelSize: 5,
          color: color,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: label(`+${m} min`, color, {
          font: '500 11px "Intel One Mono", monospace',
          pixelOffset: new Cesium.Cartesian2(8, 0),
        }),
      });
    }
    ds.entities.add({
      id: 'wx-core',
      position: ll(ap.core, h + 20),
      label: label(opts.trackText || '', color, {
        pixelOffset: new Cesium.Cartesian2(10, -18),
      }),
    });
    infoText['wx-track'] = opts.inspect || opts.trackText;
    infoText['wx-core'] = opts.inspect || opts.trackText;
    // Time lens: where the core is at the viewed time.
    if (Number.isFinite(opts.lensMin) && opts.lensMin > 0) {
      const p = kmToLL(ap.core, v.x * opts.lensMin, v.y * opts.lensMin);
      ds.entities.add({
        position: ll(p, h + 10),
        point: {
          pixelSize: 11,
          color: FIELD,
          outlineColor: color,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: label(opts.lensText || '', color, {
          pixelOffset: new Cesium.Cartesian2(12, 12),
        }),
      });
    }
  }

  function drawOver(opts) {
    const c = site.center;
    const R = 1500;
    const color = opts.level === 'attention' ? AMBER : STEEL_LINE;
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * 2 * Math.PI;
      pts.push(
        ll(
          {
            lat: c.lat + (R * Math.cos(a)) / 111320,
            lon:
              (c.lon ?? c.lng) +
              (R * Math.sin(a)) / (111320 * Math.cos(c.lat * RAD)),
          },
          base() + 30,
        ),
      );
    }
    ds.entities.add({
      id: 'wx-over',
      polyline: {
        positions: pts,
        width: 2,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineDashMaterialProperty({
          color: color.withAlpha(0.85),
          dashLength: 18,
        }),
      },
    });
    infoText['wx-over'] = opts.inspect || opts.trackText;
  }

  function drawAlerts(alerts, siteLL, siteNoun) {
    alerts.forEach((a, i) => {
      if (!a.rings?.length) return;
      const color = AMBER;
      const id = `wx-warn:${i}`;
      const text = `${a.simulated ? 'SIMULATED · ' : ''}${a.source === 'SIMULATED' ? '' : `${a.source} `}${a.event}${a.untilText ? ` · until ${a.untilText}` : ''}${a.inside ? ` · the ${siteNoun} is inside` : ''}`;
      infoText[id] =
        `${text} · area from ${a.geometry || a.simulated ? 'the alert polygon' : 'its forecast zones'}`;
      let nearest = null;
      a.rings.forEach((ring, j) => {
        const r = thin(ring);
        const pos = r.map(([lon, lat]) => ll({ lat, lon }, base()));
        ds.entities.add({
          id: j === 0 ? id : `${id}:${j}`,
          wall: {
            positions: pos,
            maximumHeights: r.map(() => base() + 220),
            minimumHeights: r.map(() => base()),
            material: color.withAlpha(a.simulated ? 0.07 : 0.05),
            outline: false,
          },
          polyline: {
            positions: r.map(([lon, lat]) => ll({ lat, lon }, base() + 220)),
            width: 1.5,
            arcType: Cesium.ArcType.NONE,
            material: a.simulated
              ? new Cesium.PolylineDashMaterialProperty({
                  color: color.withAlpha(0.85),
                  dashLength: 16,
                })
              : color.withAlpha(0.75),
          },
        });
        for (const [lon, lat] of r) {
          const k = toKm(siteLL, { lat, lon });
          const d = Math.hypot(k.x, k.y);
          if (!nearest || d < nearest.d) nearest = { d, lat, lon };
        }
      });
      if (nearest)
        ds.entities.add({
          id: `${id}:label`,
          position: ll(nearest, base() + 240),
          label: label(text, color),
        });
    });
  }

  function drawLightning(ltg, siteLL) {
    if (!ltg?.point) return;
    const h = base() + 25;
    ds.entities.add({
      id: 'wx-ltg',
      polyline: {
        positions: [ll(siteLL, h), ll(ltg.point, h)],
        width: 1.5,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineDashMaterialProperty({
          color: RED.withAlpha(0.8),
          dashLength: 12,
        }),
      },
      position: ll(ltg.point, h),
      label: label(ltg.text, RED, {
        pixelOffset: new Cesium.Cartesian2(8, -10),
      }),
    });
    infoText['wx-ltg'] = ltg.text;
  }

  return {
    /**
     * opts: {grid, showColumns, ap, motion, level, trackText, inspect,
     * lensMin, lensText, alerts, showAlerts, lightning, siteNoun}
     */
    set(opts) {
      ds.entities.removeAll();
      infoText = {};
      const c = site.center;
      const siteLL = { lat: c.lat, lon: c.lon ?? c.lng };
      if (opts.showColumns && opts.grid)
        drawColumns(opts.grid, {
          clearM: Math.max(600, (site.radius || 400) * 1.4),
        });
      else dropColumns();
      if (opts.ap?.status === 'over') drawOver(opts);
      else if (
        opts.ap &&
        ['arriving', 'passing'].includes(opts.ap.status) &&
        opts.ap.distKm < 90
      )
        drawTrack(opts.ap, opts.motion, opts);
      if (opts.showAlerts)
        drawAlerts(opts.alerts || [], siteLL, opts.siteNoun || 'hotel');
      if (opts.lightning) drawLightning(opts.lightning, siteLL);
      scene.requestRender();
    },
    /** Inspect text for a picked weather id, or null. */
    info(id, { frameText = '', siteNoun = 'hotel' } = {}) {
      const m = /^wx-cell:(\d+)$/.exec(id);
      if (m) {
        const cell = cellInfo[Number(m[1])];
        if (!cell) return null;
        const dir = compass((Math.atan2(cell.k.x, cell.k.y) / RAD + 360) % 360);
        return {
          title: `Radar · ${cell.band}`,
          lines: [
            `${cell.d.toFixed(1)} km ${dir} of the ${siteNoun}`,
            frameText,
            COLUMN_RULE,
          ].filter(Boolean),
          projected: Boolean(lastGrid?.projected),
          simulated: Boolean(lastGrid?.simulated),
        };
      }
      const key = Object.keys(infoText).find(
        (k) => id === k || id.startsWith(`${k}:`),
      );
      return key ? { title: 'Weather', lines: [infoText[key]] } : null;
    },
    dispose() {
      dropColumns();
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
    },
  };
}
