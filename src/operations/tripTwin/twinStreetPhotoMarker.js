// Where a street photo was taken and which way it looks (review/street-photos
// P5, UI spec P4 §4): a steel point and a faint ground fan the width of the
// view. Never dashed (another trip), never green or blue (rally points,
// paths), never labelled. Drawn once per change: one frame, no hold.
import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';

const STEEL = '#b8c3c7';
const CASING = '#040c12';
const css = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
const RADIUS = { building: 35, neighborhood: 60, city: 140 };

// One data source per viewer, added once: DataSourceCollection.add settles
// on a later microtask, so a remove right after an add left a stale fan
// (UI round 2). Each change clears its entities instead.
const sources = new WeakMap();
function sourceFor(viewer) {
  let ds = sources.get(viewer);
  if (!ds) {
    ds = new Cesium.CustomDataSource('trip-twin-street-photo');
    viewer.dataSources.add(ds);
    sources.set(viewer, ds);
  }
  return ds;
}

/**
 * opts: {photo: {lat, lon}, look (deg), fov (deg), scale, wall}.
 * Returns a dispose function.
 */
export function drawPhotoMarker(viewer, site, opts) {
  const ds = sourceFor(viewer);
  ds.entities.removeAll();
  const { projector, field } = site;
  const [cx, cy] = projector.toXY(opts.photo.lat, opts.photo.lon);
  const at = (x, y, up = 1.5) => {
    const q = projector.toLL(x, y);
    return Cesium.Cartesian3.fromDegrees(q.lon, q.lat, field.at(x, y) + up);
  };
  const r = RADIUS[opts.scale] || RADIUS.neighborhood;
  if (Number.isFinite(opts.look)) {
    const half = Math.min(170, (opts.fov || 60) / 2);
    const ring = [[cx, cy]];
    for (let k = 0; k <= 12; k++) {
      const a = ((opts.look - half + (2 * half * k) / 12) * Math.PI) / 180;
      ring.push([cx + r * Math.sin(a), cy + r * Math.cos(a)]);
    }
    const positions = ring.map(([x, y]) => at(x, y));
    ds.entities.add({
      polygon: {
        hierarchy: positions,
        perPositionHeight: true,
        material: css(STEEL, 0.16),
      },
    });
    ds.entities.add({
      polyline: {
        positions: [...positions, positions[0]],
        width: opts.wall ? 2 : 1.5,
        arcType: Cesium.ArcType.NONE,
        material: css(STEEL, 0.6),
      },
    });
  }
  ds.entities.add({
    position: at(cx, cy, 2),
    point: {
      pixelSize: 8,
      color: css(STEEL),
      outlineColor: css(CASING),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  governorRequestRender('twin-photos');
  return () => {
    ds.entities.removeAll();
    governorRequestRender('twin-photos');
  };
}
