// Map layer for custom paths (phase 4): avoid-areas (amber hatched discs),
// saved paths (long dash, never mistaken for a suggested path) and the path
// being edited (numbered waypoints, labelled ends).
import * as Cesium from 'cesium';
import { AVOID_REASONS, crossingRuns } from './twinCustomPaths.js';

const css = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
const reasonLabel = (key) =>
  (AVOID_REASONS.find(([k]) => k === key) || [, 'Other'])[1];
const LABEL_RANGE = new Cesium.DistanceDisplayCondition(0, 6000);

export function createCustomPathsLayer(viewer, site) {
  const areasDs = new Cesium.CustomDataSource('trip-twin-avoid-areas');
  const savedDs = new Cesium.CustomDataSource('trip-twin-saved-paths');
  const editDs = new Cesium.CustomDataSource('trip-twin-path-edit');
  for (const ds of [areasDs, savedDs, editDs]) viewer.dataSources.add(ds);
  const base = site.field.at(0, 0);
  const at = (p, dz) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, base + dz);
  const plate = (fill) => ({
    font: '500 11px Inter, sans-serif',
    fillColor: css(fill),
    showBackground: true,
    backgroundColor: css('#061a23', 0.88),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    distanceDisplayCondition: LABEL_RANGE,
  });
  const render = () => viewer.scene.requestRender();
  /** Amber dashes with dark gaps on the parts inside avoid-areas. */
  const crossings = (ds, geometry, areas, dz) => {
    for (const run of crossingRuns(geometry, areas))
      ds.entities.add({
        polyline: {
          positions: run.map((q) => at(q, dz)),
          width: 6,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineDashMaterialProperty({
            color: css('#f59e0b', 1),
            gapColor: css('#061a23', 0.9),
            dashLength: 10,
          }),
        },
      });
  };
  return {
    drawAreas(areas, { show = true } = {}) {
      areasDs.entities.removeAll();
      if (show)
        for (const a of areas) {
          areasDs.entities.add({
            id: `twin-avoid:${a.id}`,
            position: at(a.center, 2),
            ellipse: {
              semiMajorAxis: a.radiusM,
              semiMinorAxis: a.radiusM,
              height: base + 0.8,
              material: new Cesium.StripeMaterialProperty({
                evenColor: css('#f59e0b', 0.28),
                oddColor: css('#f59e0b', 0.06),
                repeat: Math.max(6, a.radiusM / 8),
                orientation: Cesium.StripeOrientation.VERTICAL,
              }),
              outline: true,
              outlineColor: css('#f59e0b', 0.95),
            },
            label: {
              text: `Avoid · ${reasonLabel(a.reason)}${a.note ? ` · ${a.note}` : ''}`,
              ...plate('#f8c471'),
              pixelOffset: new Cesium.Cartesian2(0, -10),
            },
          });
        }
      render();
    },
    /** paths: saved records to show (already filtered by Layers). */
    drawSaved(paths, { selectedId = null, areas = [] } = {}) {
      savedDs.entities.removeAll();
      for (const p of paths) {
        const sel = p.id === selectedId;
        savedDs.entities.add({
          id: `twin-saved:${p.id}`,
          polyline: {
            positions: p.geometry.map((q) => at(q, 1.3)),
            width: sel ? 5 : 3,
            arcType: Cesium.ArcType.NONE,
            material: new Cesium.PolylineDashMaterialProperty({
              color: css('#93bafa', sel ? 1 : 0.8),
              gapColor: css('#061a23', 0.5),
              dashLength: 28,
            }),
          },
        });
        crossings(savedDs, p.geometry, areas, 1.5);
        const mid = p.geometry[Math.floor(p.geometry.length / 2)];
        if (mid)
          savedDs.entities.add({
            id: `twin-saved:${p.id}:label`,
            position: at(mid, 4),
            label: {
              text: `Saved · ${p.name}${p.reviewedBy ? '' : ' · draft'}`,
              ...plate('#93bafa'),
              pixelOffset: new Cesium.Cartesian2(0, -12),
            },
          });
      }
      render();
    },
    /** The path being edited: line, numbered waypoints, labelled ends. */
    drawEdit({
      points,
      geometry,
      fromLabel,
      toLabel,
      areas = [],
      original = null,
    }) {
      editDs.entities.removeAll();
      // The suggested line being edited stays faintly visible (phase 9).
      if (original?.length)
        editDs.entities.add({
          polyline: {
            positions: original.map((q) => at(q, 1.2)),
            width: 3,
            arcType: Cesium.ArcType.NONE,
            material: new Cesium.PolylineDashMaterialProperty({
              color: css('#eff7f3', 0.45),
              gapColor: css('#061a23', 0),
              dashLength: 10,
            }),
          },
        });
      if (geometry?.length)
        editDs.entities.add({
          polyline: {
            positions: geometry.map((q) => at(q, 1.6)),
            width: 5,
            arcType: Cesium.ArcType.NONE,
            // Being edited: blue with a white outline — never the suggested
            // path's glow, never the saved path's long dash.
            material: new Cesium.PolylineOutlineMaterialProperty({
              color: css('#3b82f6', 1),
              outlineColor: css('#eff7f3', 0.9),
              outlineWidth: 1.5,
            }),
          },
        });
      if (geometry?.length) crossings(editDs, geometry, areas, 1.9);
      points.forEach((p, i) => {
        const end = i === 0 || i === points.length - 1;
        editDs.entities.add({
          id: end ? undefined : `twin-wp:${i}`,
          position: at(p, 5),
          point: {
            pixelSize: end ? 9 : 14,
            color: end ? css('#3b82f6') : css('#061a23'),
            outlineColor: css('#eff7f3'),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: end
              ? `${i === 0 ? 'Start' : 'End'} · ${i === 0 ? fromLabel : toLabel}`
              : `${i}`,
            ...plate(end ? '#93bafa' : '#eff7f3'),
            pixelOffset: new Cesium.Cartesian2(0, end ? -16 : -15),
          },
        });
      });
      render();
    },
    clearEdit() {
      editDs.entities.removeAll();
      render();
    },
    dispose() {
      if (viewer.isDestroyed()) return;
      for (const ds of [areasDs, savedDs, editDs])
        viewer.dataSources.remove(ds, true);
    },
  };
}
