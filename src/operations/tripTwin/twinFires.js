// Satellite heat detections near the hotel (P1; 02 layer catalog, 04 §5.6).
// These are heat detections, not fire perimeters: a path can only be "within
// X km of a detection", never "through the fire". Live NASA FIRMS through the
// existing /api/firms proxy; or clearly labelled SIMULATED records (prototype).
import * as Cesium from 'cesium';
import { adaptFirmsRecords } from '../../data/firmsAdapt.js';
import { TT_OVERLAY_ACCENTS, mapLabel } from './twinMapLabelEntries.js';
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
      text: `Heat detections within ${formatRadius(NEAR_KM * 1000)}: none in the last pass${records.length ? ` · newest ${formatAge(Math.min(...records.map((r) => (now - r.acqMs) / 1000)))} ago` : ''} · FIRMS`,
    };
  const newest = Math.min(...near.map((r) => (now - r.acqMs) / 1000));
  const n = near[0];
  return {
    count: near.length,
    nearest: n,
    text: `Heat detections within ${NEAR_KM} km: ${near.length} · nearest ${formatDistance(n.d)} ${bearingLabel(center, n)} · newest ${formatAge(newest)} ago`,
  };
}

/**
 * `owned`: detections a fire boundary claims (hazards H5): drawn as faint
 * outlines so the eye does not count the same fire twice.
 */
export function drawFires(
  viewer,
  site,
  records,
  now = Date.now(),
  { owned = null } = {},
) {
  const ds = new Cesium.CustomDataSource('trip-twin-fires');
  const added = viewer.dataSources.add(ds); // resolves in a microtask
  const { projector, field } = site;
  // One label per cluster of detections within 500 m, on the newest, so the
  // words (and SIMULATED) never drop out between neighbouring squares
  // (every-time P0-2).
  const leads = new Map();
  for (const r of records
    .filter((q) => (now - q.acqMs) / 3600000 <= 24)
    .sort((a, b) => b.acqMs - a.acqMs)) {
    // Real and SIMULATED detections never share a label (every-time R2).
    const lead = [...leads.keys()].find(
      (l) =>
        Boolean(l.simulated) === Boolean(r.simulated) &&
        haversineM(l, r) <= 500,
    );
    if (lead) leads.get(lead).push(r);
    else leads.set(r, [r]);
  }
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
    const claimed = owned?.has(r);
    const alpha = claimed ? 0 : lowConf ? 0.1 : recent ? 0.3 : 0.14;
    ds.entities.add({
      id: `twin-fire:${r.index}`,
      polygon: {
        hierarchy: corners,
        perPositionHeight: true,
        material: css('#f59e0b', alpha),
      },
      polyline: {
        positions: corners,
        width: 1.5,
        arcType: Cesium.ArcType.NONE,
        // Claimed by a fire boundary: the fire's amber, faint (hazards X24).
        material: claimed
          ? css('#f59e0b', 0.5)
          : recent
            ? css('#f59e0b', 0.9)
            : new Cesium.PolylineDashMaterialProperty({
                color: css('#f59e0b', 0.7),
                dashLength: 10,
              }),
      },
    });
    const group = leads.get(r);
    if (!group) continue;
    ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        r.lon,
        r.lat,
        field.at(x, y) + 30,
      ),
      // On the world overlay (review/map-labels L5): SIMULATED first, the
      // detections' amber (559da4f) on the bar.
      mapLabel: mapLabel('hazard', {
        title: `${r.simulated ? 'SIMULATED heat' : 'Heat'} detection${group.length > 1 ? 's' : ''}`,
        details: [
          group.length > 1
            ? `${group.length} detections here · newest ${formatAge(ageH * 3600)} ago`
            : `${formatAge(ageH * 3600)} ago`,
        ],
        far: 6000,
        accent: TT_OVERLAY_ACCENTS.check,
      }),
    });
  }
  viewer.scene.requestRender();
  return () => {
    added.then(() => {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
    });
  };
}
