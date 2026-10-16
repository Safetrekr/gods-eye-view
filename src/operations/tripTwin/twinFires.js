// Satellite heat detections near the hotel (P1; 02 layer catalog, 04 §5.6).
// These are heat detections, not fire perimeters: a path can only be "within
// X km of a detection", never "through the fire". Live NASA FIRMS through the
// existing /api/firms proxy; or clearly labelled SIMULATED records (prototype).
import * as Cesium from 'cesium';
import { adaptFirmsRecords } from '../../data/firmsAdapt.js';
import {
  bearingLabel,
  formatAge,
  formatDistance,
  formatRadius,
  haversineM,
  makeProjector,
} from './twinData.js';

const css = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
export const NEAR_KM = 3;
const VIIRS_PIXEL_M = 375;

export async function loadFires(
  center,
  { simulated = false, signal, now = Date.now() } = {},
) {
  if (simulated)
    return { status: 'simulated', records: simulatedFires(center, now) };
  try {
    const res = await fetch('/api/firms', { signal });
    if (res.status === 503) {
      const body = await res.json().catch(() => ({}));
      return {
        status: body.error === 'no_key' ? 'no_key' : 'unavailable',
        records: [],
      };
    }
    if (!res.ok) return { status: 'unavailable', records: [] };
    const json = await res.json();
    const records = adaptFirmsRecords(json.fires || []).filter(
      (r) =>
        haversineM(center, { lat: r.lat, lon: r.lon }) <= NEAR_KM * 1000 * 4,
    );
    return {
      status: json.stale ? 'stale' : 'live',
      records,
      fetchedAt: json.fetchedAt || null,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: 'unavailable', records: [] };
  }
}

/** A small detection cluster SW of the hotel, one detection ~700 m away. Fictional. */
export function simulatedFires(center, now = Date.now()) {
  const proj = makeProjector(center);
  const spots = [
    [-520, -480, 0.4, 'h'],
    [-1300, -900, 1.2, 'h'],
    [-1700, -1200, 2.5, 'h'],
    [-1500, -1600, 4.0, 'n'],
    [-2100, -1400, 9.0, 'n'],
    [-2500, -900, 14, 'n'],
  ];
  return spots.map(([x, y, hoursAgo, conf], i) => {
    const ll = proj.toLL(x, y);
    return {
      index: i,
      lat: ll.lat,
      lon: ll.lon,
      frp: 8 + i * 6,
      confidence: conf === 'h' ? 0.9 : 0.6,
      acqMs: now - hoursAgo * 3600000,
      satellite: 'SIMULATED',
      simulated: true,
    };
  });
}

export function fireSummary(center, records, now = Date.now()) {
  const near = records
    .map((r) => ({ ...r, d: haversineM(center, { lat: r.lat, lon: r.lon }) }))
    .filter((r) => r.d <= NEAR_KM * 1000)
    .sort((a, b) => a.d - b.d);
  if (!near.length)
    return {
      count: 0,
      text: `Heat detections within ${formatRadius(NEAR_KM * 1000)}: 0 (not an all-clear)`,
    };
  const newest = Math.min(...near.map((r) => (now - r.acqMs) / 1000));
  const n = near[0];
  return {
    count: near.length,
    nearest: n,
    text: `Heat detections within ${NEAR_KM} km: ${near.length} · nearest ${formatDistance(n.d)} ${bearingLabel(center, n)} · newest ${formatAge(newest)} ago`,
  };
}

export function drawFires(viewer, site, records, now = Date.now()) {
  const ds = new Cesium.CustomDataSource('trip-twin-fires');
  const added = viewer.dataSources.add(ds); // resolves in a microtask
  const { projector, field } = site;
  for (const r of records) {
    const ageH = (now - r.acqMs) / 3600000;
    if (ageH > 24) continue;
    const recent = ageH <= 6;
    const lowConf = r.confidence < 0.5;
    const [x, y] = projector.toXY(r.lat, r.lon);
    const half = VIIRS_PIXEL_M / 2;
    const corners = [
      [x - half, y - half],
      [x + half, y - half],
      [x + half, y + half],
      [x - half, y + half],
      [x - half, y - half],
    ].map(([cx, cy]) => {
      const q = projector.toLL(cx, cy);
      return Cesium.Cartesian3.fromDegrees(
        q.lon,
        q.lat,
        field.at(cx, cy) + 0.6,
      );
    });
    const alpha = lowConf ? 0.1 : recent ? 0.3 : 0.14;
    ds.entities.add({
      id: `twin-fire:${r.index}`,
      polygon: {
        hierarchy: corners,
        perPositionHeight: true,
        material: css('#ee7789', alpha),
      },
      polyline: {
        positions: corners,
        width: 1.5,
        arcType: Cesium.ArcType.NONE,
        material: recent
          ? css('#ee7789', 0.9)
          : new Cesium.PolylineDashMaterialProperty({
              color: css('#ee7789', 0.7),
              dashLength: 10,
            }),
      },
    });
    ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        r.lon,
        r.lat,
        field.at(x, y) + 30,
      ),
      label: {
        text: `${r.simulated ? 'SIMULATED ' : ''}heat detection · ${formatAge(ageH * 3600)} ago`,
        font: '11px Inter, ui-sans-serif, sans-serif',
        fillColor: css('#f299a6'),
        showBackground: true,
        backgroundColor: css('#061a23', 0.92),
        backgroundPadding: new Cesium.Cartesian2(5, 3),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6000),
      },
    });
  }
  viewer.scene.requestRender();
  return () => {
    added.then(() => {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
    });
  };
}
