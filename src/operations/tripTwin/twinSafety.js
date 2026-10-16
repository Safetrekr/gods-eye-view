// Safety resources on the hologram (04 §5.7, 06 §3.6). Approved points are
// filled green glyphs; drafts are hollow grey and dashed. Green means
// "approved place of safety" and nothing else in Trip Twin.
import * as Cesium from 'cesium';
import { bearingLabel, formatDistance, haversineM } from './twinData.js';

const css = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
export const SAFETY_LABEL = {
  rally_primary: 'Rally point (primary)',
  rally_secondary: 'Rally point (secondary)',
  safe_house: 'Group shelter',
  hospital: 'Hospital',
  police: 'Police',
  fire: 'Fire station',
  pharmacy: 'Pharmacy',
  embassy: 'Embassy',
  consulate: 'Consulate',
  shelter: 'Shelter',
  relocation: 'Relocation site',
  other: 'Resource',
};
const GLYPH = {
  rally_primary: 'R1',
  rally_secondary: 'R2',
  safe_house: 'GS',
  hospital: 'H',
  police: 'P',
  fire: 'F',
  pharmacy: 'Rx',
  embassy: 'E',
  consulate: 'C',
  shelter: 'S',
  relocation: 'RL',
  other: '•',
};
const cache = new Map();
function glyph(category, draft) {
  const key = `${category}|${draft}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 48;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(24, 24, 21, 0, Math.PI * 2);
  g.fillStyle = '#061a23';
  g.fill();
  g.beginPath();
  g.arc(24, 24, 17, 0, Math.PI * 2);
  if (draft) {
    g.setLineDash([5, 4]);
    g.lineWidth = 3;
    g.strokeStyle = '#9aa8ac';
    g.stroke();
  } else {
    g.fillStyle = '#4ba467';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#edf6f0';
    g.stroke();
  }
  g.setLineDash([]);
  g.fillStyle = draft ? '#9aa8ac' : '#edf6f0';
  g.font = `700 ${GLYPH[category]?.length > 1 ? 13 : 17}px Inter, ui-sans-serif, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(GLYPH[category] || '•', 24, 25);
  cache.set(key, c);
  return c;
}

export function createSafetyLayer(viewer, site) {
  const ds = new Cesium.CustomDataSource('trip-twin-safety');
  viewer.dataSources.add(ds);
  const { projector, field, center } = site;
  const inView = site.radius + 100;
  return {
    dataSource: ds,
    /** Returns edge chips for points beyond the hologram. */
    update(points = [], { show = true } = {}) {
      ds.entities.removeAll();
      const chips = [];
      const placed = [];
      if (!show) return chips;
      for (const p of points) {
        if (!p.coordinates) {
          chips.push({
            label: `${SAFETY_LABEL[p.category] || p.category} · location not set`,
            missing: true,
          });
          continue;
        }
        const ll = { lat: p.coordinates.lat, lon: p.coordinates.lng };
        const d = haversineM(center, ll);
        const label = SAFETY_LABEL[p.category] || p.category;
        if (d > inView) {
          chips.push({
            id: p.id,
            label,
            distance: formatDistance(d),
            bearing: bearingLabel(center, ll),
            draft: p.approval_status !== 'active',
          });
          continue;
        }
        const [x, y] = projector.toXY(ll.lat, ll.lon);
        const h = field.at(x, y);
        const draft = p.approval_status !== 'active';
        // Stack labels of places within 90 m of an earlier one (phase 3 F).
        const stack = placed.filter(
          (q) => Math.hypot(q[0] - x, q[1] - y) < 160,
        ).length;
        placed.push([x, y]);
        const pos = Cesium.Cartesian3.fromDegrees(ll.lon, ll.lat, h + 25);
        ds.entities.add({
          id: `twin-safety:${p.id}`,
          position: pos,
          billboard: {
            image: glyph(p.category, draft),
            scale: 0.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `${label}${draft ? ' · Draft · not approved' : ''}${p.chaperone_only ? ' · chaperones only' : ''}\n${p.name && !p.name.startsWith(label) ? p.name : ''}`.trim(),
            font: '11px Inter, ui-sans-serif, sans-serif',
            fillColor: css(draft ? '#9aa8ac' : '#81bf95'),
            showBackground: true,
            backgroundColor: css('#061a23', 0.92),
            backgroundPadding: new Cesium.Cartesian2(5, 3),
            pixelOffset: new Cesium.Cartesian2(0, -22 - 34 * stack),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
              0,
              2600,
            ),
          },
        });
        // Beacon to the ground and a ground ring (primary rally: double ring).
        ds.entities.add({
          polyline: {
            positions: [Cesium.Cartesian3.fromDegrees(ll.lon, ll.lat, h), pos],
            width: 1.5,
            material: draft
              ? new Cesium.PolylineDashMaterialProperty({
                  color: css('#9aa8ac', 0.6),
                  dashLength: 8,
                })
              : css('#81bf95', 0.5),
            arcType: Cesium.ArcType.NONE,
          },
        });
        for (const r of p.category === 'rally_primary' ? [12, 16] : [12]) {
          const ring = Array.from({ length: 49 }, (_, i) => {
            const t = (i / 48) * Math.PI * 2;
            const q = projector.toLL(x + r * Math.cos(t), y + r * Math.sin(t));
            return Cesium.Cartesian3.fromDegrees(q.lon, q.lat, h + 0.4);
          });
          ds.entities.add({
            polyline: {
              positions: ring,
              width: 1.5,
              material: draft
                ? new Cesium.PolylineDashMaterialProperty({
                    color: css('#9aa8ac', 0.7),
                    dashLength: 8,
                  })
                : css('#4ba467', 0.7),
              arcType: Cesium.ArcType.NONE,
            },
          });
        }
      }
      viewer.scene.requestRender();
      return chips;
    },
    dispose() {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
    },
  };
}
