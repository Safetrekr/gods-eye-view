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
  g.fillStyle = '#040c12';
  g.fill();
  g.beginPath();
  g.arc(24, 24, 17, 0, Math.PI * 2);
  if (draft) {
    g.setLineDash([5, 4]);
    g.lineWidth = 3;
    g.strokeStyle = '#7f949b';
    g.stroke();
  } else {
    g.fillStyle = '#4ba467';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#edf6f0';
    g.stroke();
  }
  g.setLineDash([]);
  g.fillStyle = draft ? '#7f949b' : '#edf6f0';
  g.font = `700 ${GLYPH[category]?.length > 1 ? 13 : 17}px Inter, ui-sans-serif, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(GLYPH[category] || '•', 24, 25);
  cache.set(key, c);
  return c;
}

let halo = null;
/** Soft white ring for the selected place (drawn once, reused). */
function haloImage() {
  if (halo) return halo;
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(48, 48, 14, 48, 48, 46);
  grad.addColorStop(0, 'rgba(239,247,243,0)');
  grad.addColorStop(0.45, 'rgba(239,247,243,0.55)');
  grad.addColorStop(0.62, 'rgba(239,247,243,0.9)');
  grad.addColorStop(1, 'rgba(239,247,243,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(48, 48, 46, 0, Math.PI * 2);
  g.fill();
  halo = c;
  return c;
}

export function createSafetyLayer(viewer, site) {
  const ds = new Cesium.CustomDataSource('trip-twin-safety');
  viewer.dataSources.add(ds);
  const { projector, field, center } = site;
  const inView = site.radius + 100;
  // The place whose card is open glows like a selected building: white glow
  // on its beacon and ring, a larger glyph and a brighter label (phase 5b).
  let selectedId = null;
  let lastSig = null;
  let lastChips = [];
  let lastArgs = null;
  const glowMat = (a = 0.95, power = 0.25) =>
    new Cesium.PolylineGlowMaterialProperty({
      color: css('#eef5f3', a),
      glowPower: power,
    });
  return {
    dataSource: ds,
    setSelected(id) {
      if (id === selectedId) return;
      selectedId = id;
      if (lastArgs) this.update(...lastArgs);
    },
    /** Returns edge chips for points beyond the hologram. */
    update(points = [], { show = true, covers = null } = {}) {
      lastArgs = [points, { show, covers }];
      // Unchanged places are not redrawn: clearing and rebuilding the rings
      // every feed tick made them blink (Jesse, 27 Oct).
      const sig = JSON.stringify([
        show,
        selectedId,
        points.map((p) => [
          p.id,
          p.category,
          p.approval_status,
          p.name,
          p.coordinates?.lat,
          p.coordinates?.lng,
          p.coordinates
            ? Boolean(
                covers?.({ lat: p.coordinates.lat, lon: p.coordinates.lng }),
              )
            : null,
        ]),
      ]);
      if (sig === lastSig) return lastChips;
      lastSig = sig;
      ds.entities.removeAll();
      const chips = [];
      lastChips = chips;
      if (!show) return chips;
      // The selected place is drawn last so its glyph sits on top.
      const ordered = [...points].sort(
        (a, b) => Number(a.id === selectedId) - Number(b.id === selectedId),
      );
      for (const p of ordered) {
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
        // Pinned wherever the map is drawn (phase 8 N1), else an edge chip.
        if (d > inView && !covers?.(ll)) {
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
        const sel = p.id === selectedId;
        const pos = Cesium.Cartesian3.fromDegrees(ll.lon, ll.lat, h + 25);
        ds.entities.add({
          id: `twin-safety:${p.id}`,
          declutterGlyph: sel ? 36 : 24,
          position: pos,
          billboard: {
            image: glyph(p.category, draft),
            scale: sel ? 0.75 : 0.5,
            // The selected glyph draws in front of its neighbours.
            eyeOffset: new Cesium.Cartesian3(0, 0, sel ? -40 : 0),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `${label}${draft ? ' · not approved' : ''}${p.chaperone_only ? ' · chaperones only' : ''}\n${p.name && !p.name.startsWith(label) ? p.name : ''}`.trim(),
            font: sel
              ? '600 12px Inter, ui-sans-serif, sans-serif'
              : '11px Inter, ui-sans-serif, sans-serif',
            fillColor: sel
              ? css('#eef5f3')
              : css(draft ? '#7f949b' : '#81bf95'),
            showBackground: true,
            backgroundColor: sel ? css('#0d2d3a', 0.98) : css('#040c12', 0.92),
            backgroundPadding: new Cesium.Cartesian2(5, 3),
            // Overlaps are resolved on screen by the declutter (phase 5b).
            pixelOffset: new Cesium.Cartesian2(0, sel ? -28 : -22),
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
            width: sel ? 8 : 1.5,
            material: sel
              ? glowMat()
              : draft
                ? new Cesium.PolylineDashMaterialProperty({
                    color: css('#7f949b', 0.6),
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
              width: sel ? 6 : 1.5,
              material: sel
                ? glowMat(0.9, 0.3)
                : draft
                  ? new Cesium.PolylineDashMaterialProperty({
                      color: css('#7f949b', 0.7),
                      dashLength: 8,
                    })
                  : css('#4ba467', 0.7),
              arcType: Cesium.ArcType.NONE,
            },
          });
        }
        if (sel)
          // A screen-sized glow behind the glyph, visible at every zoom.
          ds.entities.add({
            position: pos,
            billboard: {
              image: haloImage(),
              scale: 1,
              eyeOffset: new Cesium.Cartesian3(0, 0, -20),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        if (sel) {
          // Outer selection halo, the same white glow as a selected building.
          const halo = Array.from({ length: 65 }, (_, i) => {
            const t = (i / 64) * Math.PI * 2;
            const q = projector.toLL(
              x + 24 * Math.cos(t),
              y + 24 * Math.sin(t),
            );
            return Cesium.Cartesian3.fromDegrees(q.lon, q.lat, h + 0.5);
          });
          ds.entities.add({
            polyline: {
              positions: halo,
              width: 10,
              material: glowMat(0.55, 0.18),
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
