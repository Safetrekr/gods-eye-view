// Fire boundaries and hurricane geometry on the twin's ground (review/hazards
// H4 UI spec, H5-PLAN). Amber marks what to check, steel is context; never
// red (reports) and never dashed (another trip). No text on the map: names
// live in cards and chips. Nothing animates: one frame per redraw.
import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';
import { isCheckLevel } from './twinHazards.js';

const AMBER = '#f59e0b';
const STEEL = '#b8c3c7';
const CASING = '#040c12';
const css = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
/** Fill alpha by scale; Building has none (boundaries are ~100 m generalised). */
// Faint: amber over teal-black turns muddy above ~8% (hazards X24).
const FILL = { building: 0, neighborhood: 0.05, city: 0.07 };
/** Fires and storm geometry farther than this from the site are not drawn. */
const DRAW_RANGE_M = 80000;

/** Insert points so a long edge follows the ground field (≤ `step` m). */
function densify(xy, step = 150, max = 3000) {
  const out = [];
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1];
    const [bx, by] = xy[i];
    const n = Math.min(
      40,
      Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step)),
    );
    for (let k = 0; k < n; k++)
      out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
    if (out.length > max) break;
  }
  out.push(xy[xy.length - 1]);
  return out;
}

/**
 * Draw the assessed fires and storms. opts = {fires (assessFires items),
 * tropical (assessTropical items), scale, wall, show:{fireBounds, tropical}}.
 * Returns a dispose function.
 */
export function drawHazards(viewer, site, opts) {
  const ds = new Cesium.CustomDataSource('trip-twin-hazards');
  const added = viewer.dataSources.add(ds);
  const { projector, field } = site;
  const lift = 1.2; // above heat squares (0.6 m)
  const toCart = ([x, y], up = lift) => {
    const q = projector.toLL(x, y);
    return Cesium.Cartesian3.fromDegrees(q.lon, q.lat, field.at(x, y) + up);
  };
  const lineW = opts.wall ? 3 : 2;
  const scale = opts.scale || 'neighborhood';

  const line = (id, xy, color, alpha, width) => {
    const positions = xy.map((p) => toCart(p));
    // A dark casing under every line holds it over lit blocks.
    ds.entities.add({
      id: `${id}:casing`,
      polyline: {
        positions,
        width: width + 3,
        arcType: Cesium.ArcType.NONE,
        material: css(CASING, 0.7),
      },
    });
    ds.entities.add({
      id,
      polyline: {
        positions,
        width,
        arcType: Cesium.ArcType.NONE,
        material: css(color, alpha),
      },
    });
  };

  if (opts.show?.fireBounds !== false)
    for (const item of opts.fires || []) {
      if (item.dMin > DRAW_RANGE_M) continue;
      // Contained fires and prescribed burns are context: steel (X28).
      const done =
        Number(item.row.containedPct) >= 100 || item.row.category === 'RX';
      const color = done ? STEEL : AMBER;
      item.row.polygons.forEach((rings, pi) => {
        const outer = densify(
          rings[0].map(([lon, lat]) => projector.toXY(lat, lon)),
        );
        const fill = done ? 0 : (FILL[scale] ?? 0.08);
        if (fill > 0)
          ds.entities.add({
            id: `twin-hazard:fire:${item.row.stableId}:${pi}:fill`,
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(
                outer.map((p) => toCart(p, lift - 0.4)),
                rings
                  .slice(1)
                  .map(
                    (hole) =>
                      new Cesium.PolygonHierarchy(
                        hole.map(([lon, lat]) =>
                          toCart(projector.toXY(lat, lon), lift - 0.4),
                        ),
                      ),
                  ),
              ),
              perPositionHeight: true,
              material: css(color, fill),
            },
          });
        if (scale === 'building' && !done)
          // A soft band says "about here": the edge is good to ~100 m.
          ds.entities.add({
            id: `twin-hazard:fire:${item.row.stableId}:${pi}:band`,
            polyline: {
              positions: outer.map((p) => toCart(p)),
              width: 16,
              arcType: Cesium.ArcType.NONE,
              material: css(AMBER, 0.14),
            },
          });
        line(
          `twin-hazard:fire:${item.row.stableId}:${pi}`,
          outer,
          color,
          scale === 'building' && !done ? 0.5 : done ? 0.6 : 0.9,
          done ? Math.max(1.5, lineW - 1) : lineW,
        );
      });
    }

  if (opts.show?.tropical !== false)
    for (const item of opts.tropical || []) {
      const st = item.storm;
      const check = isCheckLevel(item.level);
      const near = (lon, lat) => {
        const [x, y] = projector.toXY(lat, lon);
        return Math.hypot(x, y) <= DRAW_RANGE_M;
      };
      const coneRing =
        st.cone?.type === 'Polygon' ? st.cone.coordinates[0] : null;
      // Only the part of the cone that crosses the scene: never a fill,
      // which would tint the whole city from inside it.
      if (coneRing && coneRing.some(([lon, lat]) => near(lon, lat)))
        line(
          `twin-hazard:cone:${st.id}`,
          densify(
            coneRing.map(([lon, lat]) => projector.toXY(lat, lon)),
            2000,
          ),
          check ? AMBER : STEEL,
          0.85,
          lineW,
        );
      const track = st.track?.coordinates || [];
      if (track.some(([lon, lat]) => near(lon, lat)))
        line(
          `twin-hazard:track:${st.id}`,
          densify(
            track.map(([lon, lat]) => projector.toXY(lat, lon)),
            2000,
          ),
          STEEL,
          0.8,
          2,
        );
      const p = item.nearest?.position;
      if (p && near(p.longitude, p.latitude)) {
        const [x, y] = projector.toXY(p.latitude, p.longitude);
        ds.entities.add({
          id: `twin-hazard:point:${st.id}`,
          position: toCart([x, y], 4),
          point: {
            pixelSize: 9,
            color: css(AMBER, 0.95),
            outlineColor: css(CASING, 0.8),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
    }

  governorRequestRender('twin-hazards');
  return () => {
    added.then(() => {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
      governorRequestRender('twin-hazards');
    });
  };
}
