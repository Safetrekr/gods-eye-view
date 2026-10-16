// People, floor ruler and reported-floor slab on the hologram (04 §5.4–5.5).
// Everything sits on the twin's heightfield (HeightReference.NONE); nothing
// clamps to Google tiles or the globe (03 ADR-003).
import * as Cesium from 'cesium';
import { RING, pinCanvas, ringKind } from './twinPins.js';
import { UNKNOWN_TEXT, floorText } from './twinData.js';

// Ruler text only where it can be read (Building / Neighborhood scale).
const RULER_LABEL_RANGE = new Cesium.DistanceDisplayCondition(0, 1000);
const css = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
const toCart = (ll, h) =>
  Cesium.Cartesian3.fromDegrees(ll.lon ?? ll.lng, ll.lat, h);

function circle(projector, x, y, r, n = 48) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return projector.toLL(x + r * Math.cos(t), y + r * Math.sin(t));
  });
}

// floorText / UNKNOWN_TEXT live in twinData (pure, shared with the cutaway).
export { floorText, UNKNOWN_TEXT };

export function createPeopleLayer(viewer, site, twin) {
  const ds = new Cesium.CustomDataSource('trip-twin-people');
  viewer.dataSources.add(ds);
  const { projector, field } = site;
  const hotelRing = site.hotel.building.xy[0];
  const lobbyH = twin.lobbyH;
  const fh = twin.floorH;
  const zBase = (level) =>
    twin.hotelBase + (level <= 0 ? 0 : lobbyH + (level - 1) * fh);
  const zTop = (level) =>
    level <= 0 ? twin.hotelBase + lobbyH : zBase(level) + fh;

  // Ruler: 12 m outside the south-east-most corner (faces the entry camera).
  let corner = hotelRing[0];
  for (const v of hotelRing)
    if (v[0] - v[1] > corner[0] - corner[1]) corner = v;
  let cx = 0;
  let cy = 0;
  for (const v of hotelRing) {
    cx += v[0];
    cy += v[1];
  }
  cx /= hotelRing.length;
  cy /= hotelRing.length;
  const out = [corner[0] - cx, corner[1] - cy];
  const len = Math.hypot(...out) || 1;
  const ux = out[0] / len;
  const uy = out[1] / len;
  const rulerAt = (d) =>
    projector.toLL(corner[0] + ux * (12 + d), corner[1] + uy * (12 + d));

  function personEntities(row, { attention, selected, onFloors, dim = false }) {
    const { person, pos } = row;
    const c = person.coordinates;
    const [x, y] = projector.toXY(c.lat, c.lng);
    const ground = field.at(x, y);
    const kind = ringKind(pos);
    const style = RING[kind];
    const id = `twin-person:${person.id}`;
    // On a floor only with a CURRENT estimate (band). Everyone else stays at
    // street level: we never place a person on a floor we cannot support.
    // Floor focus: people not on that floor's lists step back (pin only).
    const band =
      onFloors && !dim && row.floor.kind === 'band' ? row.floor.est : null;
    const zLikely = band
      ? (zBase(band.level_likely) + zTop(band.level_likely)) / 2 - 0.5
      : null;
    const pinZ = band ? zLikely : ground + 1.5;
    const discZ = band ? zBase(band.level_likely) + 0.3 : null;
    if (band) {
      const high = band.confidence === 'high' && !row.floor.aging;
      // Vertical range bar through the building at the fix: the honest band.
      ds.entities.add({
        id: `${id}:range`,
        polyline: {
          positions: [
            toCart(c, zBase(band.level_low)),
            toCart(c, zTop(band.level_high)),
          ],
          width: 3,
          arcType: Cesium.ArcType.NONE,
          material: high
            ? css(style.color, 0.75)
            : new Cesium.PolylineDashMaterialProperty({
                color: css(style.color, 0.75),
                dashLength: 8,
              }),
        },
      });
      for (const z of [zBase(band.level_low), zTop(band.level_high)]) {
        const a = projector.toLL(x - 1.2, y);
        const b = projector.toLL(x + 1.2, y);
        ds.entities.add({
          polyline: {
            positions: [toCart(a, z), toCart(b, z)],
            width: 2,
            material: css(style.color, 0.75),
            arcType: Cesium.ArcType.NONE,
          },
        });
      }
      // Dashed drop line to the street-level GPS fix.
      ds.entities.add({
        id: `${id}:drop`,
        polyline: {
          positions: [
            toCart(c, ground + 0.3),
            toCart(c, zBase(band.level_low)),
          ],
          width: 1,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineDashMaterialProperty({
            color: css(style.color, 0.35),
            dashLength: 6,
          }),
        },
      });
    }
    ds.entities.add({
      id,
      position: toCart(c, pinZ),
      billboard: {
        image: pinCanvas(person, kind, { attention, selected }),
        scale: dim ? 0.4 : 0.5,
        color: Cesium.Color.WHITE.withAlpha(dim ? 0.3 : 1),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      point: {
        pixelSize: style.hollow ? 6 : 5,
        color: style.hollow ? css('#040c12', 0.9) : css(style.color),
        outlineColor: css(style.color),
        outlineWidth: style.hollow ? 1.5 : 0,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    const acc = person.accuracy_m;
    if (!dim && Number.isFinite(acc) && acc > 0) {
      const r = Math.min(500, acc);
      // On a floor, the horizontal accuracy disc sits on that floor.
      const ring = circle(projector, x, y, r).map((p) =>
        toCart(p, discZ ?? field.at(...projector.toXY(p.lat, p.lon)) + 0.4),
      );
      ds.entities.add({
        id: `${id}:acc`,
        polyline: {
          positions: ring,
          width: 1.5,
          arcType: Cesium.ArcType.NONE,
          material: style.dash
            ? new Cesium.PolylineDashMaterialProperty({
                color: css(style.color, 0.6),
                dashLength: kind === 'last' ? 6 : 14,
              })
            : css(style.color, attention || selected ? 0.55 : 0.32),
        },
      });
      ds.entities.add({
        id: `${id}:fill`,
        polygon: {
          hierarchy: ring,
          perPositionHeight: true,
          material: css(
            style.color,
            (kind === 'live' || kind === 'stopped'
              ? 0.06
              : kind === 'aging'
                ? 0.04
                : 0.03) * (attention || selected ? 1.4 : 1),
          ),
        },
      });
    }
  }

  function ruler(rows, reportedLevel, numbering, groundLabel) {
    const top = twin.levels;
    const foot = rulerAt(0);
    ds.entities.add({
      id: 'twin-ruler',
      polyline: {
        positions: [
          toCart(foot, twin.hotelBase),
          toCart(foot, zTop(top - 1) + 2),
        ],
        width: 1,
        material: css('#e3e7e9', 0.6),
        arcType: Cesium.ArcType.NONE,
      },
    });
    for (let l = 0; l < top; l++) {
      const z = zBase(l);
      const a = rulerAt(-2);
      const b = rulerAt(2);
      ds.entities.add({
        polyline: {
          positions: [toCart(a, z), toCart(b, z)],
          width: 1,
          material: css('#e3e7e9', 0.5),
          arcType: Cesium.ArcType.NONE,
        },
      });
      const lbl = numbering ? l + groundLabel : l;
      const nearReported =
        Number.isFinite(reportedLevel) &&
        l !== reportedLevel &&
        Math.abs(l - reportedLevel) <= 1;
      const isReported = l === reportedLevel;
      if (
        l === 0 ||
        ((l + (numbering ? groundLabel : 0)) % 5 === 0 && !nearReported) ||
        isReported ||
        l === top - 1
      )
        ds.entities.add({
          // The ruler never moves; other labels slide around it (declutter).
          declutterFixed: true,
          position: toCart(rulerAt(-4), z + fh / 2),
          label: {
            text: String(lbl),
            font: isReported
              ? '600 11px ui-monospace, Menlo, monospace'
              : '11px ui-monospace, Menlo, monospace',
            // The reported floor's tag is the incident's (red).
            fillColor: isReported ? css('#f299a6', 1) : css('#e3e7e9', 0.9),
            showBackground: true,
            backgroundColor: isReported
              ? css('#3a1219', 0.95)
              : css('#040c12', 0.92),
            backgroundPadding: new Cesium.Cartesian2(4, 2),
            horizontalOrigin: Cesium.HorizontalOrigin.RIGHT,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: RULER_LABEL_RANGE,
            scale: 1,
          },
        });
    }
    // The ruler caveat lives in the rail (Sources) instead of a floating plate.
    // Lanes: highest likely floor first, max 12 (04 §5.5).
    const lanes = rows
      .filter((r) => r.floor.kind === 'band' || r.floor.kind === 'last')
      .sort((a, b) => b.floor.est.level_likely - a.floor.est.level_likely)
      .slice(0, 12);
    lanes.forEach((r, i) => {
      const e = r.floor.est;
      const at = rulerAt(5 + i * 3.2);
      const z0 = zBase(e.level_low);
      const z1 = zTop(e.level_high);
      const last = r.floor.kind === 'last';
      const color = last ? '#9aa8ac' : r.floor.aging ? '#f59e0b' : '#eff7f3';
      const dashed = last || r.floor.aging || e.confidence !== 'high';
      const mat = dashed
        ? new Cesium.PolylineDashMaterialProperty({
            color: css(color, 0.95),
            dashLength: last ? 6 : 10,
          })
        : css(color, 0.95);
      ds.entities.add({
        id: `twin-bracket:${r.person.id}`,
        polyline: {
          positions: [toCart(at, z0), toCart(at, z1)],
          width: 2.5,
          material: mat,
          arcType: Cesium.ArcType.NONE,
        },
      });
      const capA = rulerAt(5 + i * 3.2 - 0.9);
      const capB = rulerAt(5 + i * 3.2 + 0.9);
      for (const z of [z0, z1])
        ds.entities.add({
          polyline: {
            positions: [toCart(capA, z), toCart(capB, z)],
            width: 2,
            material: css(color, 0.9),
            arcType: Cesium.ArcType.NONE,
          },
        });
      if (!last && e.confidence === 'high') {
        const zl = (zBase(e.level_likely) + zTop(e.level_likely)) / 2;
        ds.entities.add({
          polyline: {
            positions: [
              toCart(rulerAt(5 + i * 3.2 - 1.6), zl),
              toCart(rulerAt(5 + i * 3.2 + 1.6), zl),
            ],
            width: 2,
            material: css(color, 1),
            arcType: Cesium.ArcType.NONE,
          },
        });
      }
      ds.entities.add({
        id: `twin-bracket-label:${r.person.id}`,
        // Tied to a floor: slides sideways only (review/phase5b).
        declutterAxis: 'x',
        position: toCart(at, z1 + 1.2),
        label: {
          text: `${initialsOf(r.person.name).replace(/\./g, '')}${e.moving === 'descending' ? ' ↓' : e.moving === 'ascending' ? ' ↑' : ''}`,
          font: '600 10px Inter, ui-sans-serif, sans-serif',
          fillColor: css(color, 1),
          showBackground: true,
          backgroundColor: css('#040c12', 0.92),
          backgroundPadding: new Cesium.Cartesian2(3, 2),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          // Right of the lane (floor numbers sit left of the ruler) and
          // staggered so neighbouring lanes do not overprint (phase 3 F).
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          pixelOffset: new Cesium.Cartesian2(12, i % 2 ? -14 : 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: RULER_LABEL_RANGE,
        },
      });
    });
    // Reported floor slab across the hotel and the ruler (hatched band, 04 §5.5).
    if (Number.isFinite(reportedLevel)) {
      const ringLL = site.hotel.building.rings[0];
      const z0 = zBase(reportedLevel);
      const z1 = zTop(reportedLevel);
      ds.entities.add({
        id: 'twin-reported-slab',
        polygon: {
          hierarchy: ringLL.map((p) => toCart(p, z0)),
          height: z0,
          extrudedHeight: z1,
          material: new Cesium.StripeMaterialProperty({
            evenColor: css('#ee7789', 0.18),
            oddColor: css('#ee7789', 0.04),
            repeat: 18,
            orientation: Cesium.StripeOrientation.VERTICAL,
          }),
          outline: false,
        },
      });
      for (const z of [z0, z1])
        ds.entities.add({
          polyline: {
            positions: ringLL.map((p) => toCart(p, z)),
            width: 2,
            material: css('#ee7789', 1),
            arcType: Cesium.ArcType.NONE,
          },
        });
      const band0 = rulerAt(-2);
      const band1 = rulerAt(5 + Math.max(1, lanes.length) * 3.2);
      for (const z of [z0, z1])
        ds.entities.add({
          polyline: {
            positions: [toCart(band0, z), toCart(band1, z)],
            width: 2,
            material: css('#ee7789', 1),
            arcType: Cesium.ArcType.NONE,
          },
        });
    }
  }

  // Floor focus (phase 2): a thin white slab so the cutaway and the 3D agree.
  // Own data source: people redraws must not wipe it.
  const focusDs = new Cesium.CustomDataSource('trip-twin-floor-focus');
  viewer.dataSources.add(focusDs);

  return {
    dataSource: ds,
    floorZ(level) {
      return { z0: zBase(level), z1: zTop(level) };
    },
    /** state: 'reported' | 'floor-not-known' | other (white). */
    setFloorFocus(level, { label = null, state = null } = {}) {
      focusDs.entities.removeAll();
      if (Number.isFinite(level)) {
        const ringLL = site.hotel.building.rings[0];
        const z0 = zBase(level);
        const z1 = zTop(level);
        const hex =
          state === 'reported'
            ? '#ee7789'
            : state === 'floor-not-known'
              ? '#f59e0b'
              : '#eff7f3';
        focusDs.entities.add({
          id: 'twin-floor-focus',
          polygon: {
            hierarchy: ringLL.map((p) => toCart(p, z0)),
            height: z0,
            extrudedHeight: z1,
            material: css(hex, 0.22),
            outline: false,
          },
        });
        // Edge rings 0.6 m outside the footprint so they never sit on the
        // reported-floor lines (UI P1-5).
        const outer = hotelRing.map(([vx, vy]) => {
          const dx = vx - cx;
          const dy = vy - cy;
          const l = Math.hypot(dx, dy) || 1;
          return projector.toLL(vx + (dx / l) * 0.6, vy + (dy / l) * 0.6);
        });
        for (const z of [z0 - 0.2, z1 + 0.2])
          focusDs.entities.add({
            polyline: {
              positions: [...outer, outer[0]].map((p) => toCart(p, z)),
              width: 3,
              material: css(hex, 1),
              arcType: Cesium.ArcType.NONE,
            },
          });
        // Label on the side away from the ruler.
        const away = projector.toLL(cx - ux * (len + 14), cy - uy * (len + 14));
        if (label !== null)
          focusDs.entities.add({
            declutterFixed: true,
            position: toCart(away, (z0 + z1) / 2),
            label: {
              text: `Floor ${label}`,
              font: '500 12px "Intel One Mono", ui-monospace, monospace',
              fillColor: css('#eff7f3', 1),
              showBackground: true,
              backgroundColor: css('#0b1416', 0.8),
              horizontalOrigin: Cesium.HorizontalOrigin.RIGHT,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              distanceDisplayCondition: RULER_LABEL_RANGE,
            },
          });
      }
      viewer.scene.requestRender();
    },
    update(
      assessment,
      {
        floorsOn = false,
        reportedLabel = null,
        selectedId = null,
        numbering = true,
        groundLabel = 1,
        focusIds = null,
        // Phase 8: is a point drawn on the map (wider area)? null = core only.
        covers = null,
      } = {},
    ) {
      ds.entities.removeAll();
      const attentionIds = new Set(
        assessment.needs.map((n) => n.row.person.id),
      );
      const limit = site.radius + 100;
      let beyond = 0;
      for (const row of assessment.rows) {
        if (!row.pos.located) continue;
        const c = row.person.coordinates;
        const [px, py] = projector.toXY(c.lat, c.lng);
        if (
          Math.hypot(px, py) > limit &&
          !covers?.({ lat: c.lat, lon: c.lng })
        ) {
          beyond += 1; // shown as an edge chip, not as a pin floating over the site
          continue;
        }
        personEntities(row, {
          attention: attentionIds.has(row.person.id),
          selected: row.person.id === selectedId,
          onFloors: floorsOn,
          dim: Boolean(focusIds) && !focusIds.has(row.person.id),
        });
      }
      const reportedLevel = Number.isFinite(reportedLabel)
        ? reportedLabel - groundLabel
        : null;
      if (floorsOn)
        ruler(assessment.rows, reportedLevel, numbering, groundLabel);
      viewer.scene.requestRender();
      return { beyond };
    },
    dispose() {
      if (!viewer.isDestroyed()) {
        viewer.dataSources.remove(ds, true);
        viewer.dataSources.remove(focusDs, true);
      }
    },
  };
}

function initialsOf(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => `${w[0].toUpperCase()}.`)
    .join('');
}
export { initialsOf };
