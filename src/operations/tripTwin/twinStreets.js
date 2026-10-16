// Streets, walkways, steps and mapped entrances (phase 7, BACKLOG "ways
// out"; review/phase7 M5–M12). Streets by class with names; what cannot be
// walked is drawn as such; walkways solid (dashes mean planned or
// uncertain); steps and doors marked. Neutral greys and whites only (blue =
// paths, green = approved places). Data: the site's OpenStreetMap fixture —
// not checked for closures, locked gates or private access.
import * as Cesium from 'cesium';
import { haversineM } from './twinData.js';
import { nearestStreet } from './twinCustomPaths.js';
import { drape } from './twinScene.js';

const MAJOR = /^(primary|secondary)(_link)?$/;
const NOWALK_HW = /^(motorway|trunk)(_link)?$/;
const MINOR = /^(tertiary|unclassified|residential|living_street)(_link)?$/;
const WALK = /^(footway|pedestrian|path|cycleway)$/;

/**
 * Drawing class: major | minor | service | walk | steps | nowalk | hidden |
 * null. hidden = not at street level (tunnel) or part of the street
 * (sidewalk). Accepts a highway string or a road {highway, tunnel, foot,
 * access, footway}.
 */
export function roadClass(road) {
  const r = typeof road === 'string' ? { highway: road } : road || {};
  const h = String(r.highway || '');
  if (r.tunnel) return 'hidden';
  if (h === 'footway' && r.footway === 'sidewalk') return 'hidden';
  if (NOWALK_HW.test(h) || r.foot === 'no') return 'nowalk';
  if (['private', 'no'].includes(r.access) && r.foot !== 'yes') return 'nowalk';
  if (MAJOR.test(h)) return 'major';
  if (MINOR.test(h)) return 'minor';
  if (h === 'service') return 'service';
  if (h === 'steps') return 'steps';
  if (WALK.test(h)) return 'walk';
  return null;
}

/** "North Red River Street" → "N Red River St" (labels only). */
export function shortStreet(name) {
  return String(name || '')
    .replace(/\bStreet\b/g, 'St')
    .replace(/\bAvenue\b/g, 'Ave')
    .replace(/\bBoulevard\b/g, 'Blvd')
    .replace(/\bRoad\b/g, 'Rd')
    .replace(/\bDrive\b/g, 'Dr')
    .replace(/\bPlace\b/g, 'Pl')
    .replace(/\bInterstate (\d+)/g, 'I-$1')
    .replace(/\bNorthwest\b/g, 'NW')
    .replace(/\bNortheast\b/g, 'NE')
    .replace(/\bSouthwest\b/g, 'SW')
    .replace(/\bSoutheast\b/g, 'SE')
    .replace(/^(North|South|East|West) /, (m, d) => `${d[0]} `);
}

const lengthM = (coords) =>
  coords.reduce((s, p, i) => (i ? s + haversineM(coords[i - 1], p) : 0), 0);

/**
 * Point half way along a polyline — along its longest stretch that stays
 * more than avoidM from hub (labels never sit on the hotel).
 */
function midpoint(coords, hub = null, avoidM = 0) {
  // Densify every ~10 m so the stretch test is not vertex-bound.
  const dense = [];
  for (let i = 0; i < coords.length; i += 1) {
    const a = coords[i];
    dense.push(a);
    const b = coords[i + 1];
    if (!b) break;
    const n = Math.floor(haversineM(a, b) / 10);
    for (let k = 1; k < n; k += 1)
      dense.push({
        lat: a.lat + ((b.lat - a.lat) * k) / n,
        lon: a.lon + ((b.lon - a.lon) * k) / n,
      });
  }
  const runs = [];
  let run = [];
  for (const p of dense) {
    if (!hub || haversineM(p, hub) > avoidM) run.push(p);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  const best = runs.sort((x, y) => lengthM(y) - lengthM(x))[0];
  if (!best || best.length < 2) return null;
  const half = lengthM(best) / 2;
  let acc = 0;
  for (let i = 1; i < best.length; i += 1) {
    const d = haversineM(best[i - 1], best[i]);
    if (acc + d >= half) return best[i];
    acc += d;
  }
  return best[best.length - 1];
}

/**
 * One name label per street, at most `max`: streets the hotel faces first,
 * then majors by length; never within 60 m of the hotel (it would sit on the
 * building). Returns [{name, text, at, cls, priority}].
 */
export function streetLabels(roads, { hub = null, max = 12 } = {}) {
  const best = new Map();
  for (const r of roads) {
    const cls = roadClass(r);
    if (
      !r.name ||
      !['major', 'minor', 'nowalk'].includes(cls) ||
      r.coords.length < 2
    )
      continue;
    const len = lengthM(r.coords);
    // Distance from the hotel to the line (not just its vertices).
    const near = hub
      ? (nearestStreet(hub, [{ name: r.name, coords: r.coords }], 1e7)?.d ??
        Infinity)
      : Infinity;
    const cur = best.get(r.name);
    if (!cur || len > cur.len)
      best.set(r.name, {
        r,
        len,
        cls,
        near: Math.min(near, cur?.near ?? Infinity),
      });
    else cur.near = Math.min(cur.near, near);
  }
  const rank = (b) =>
    b.near < 80 ? 0 : b.cls === 'major' ? 1 : b.cls === 'minor' ? 2 : 3;
  return [...best.values()]
    .filter((b) => b.len >= 60)
    .sort((a, b) => rank(a) - rank(b) || b.len - a.len)
    .map((b) => ({ ...b, at: midpoint(b.r.coords, hub, 60) }))
    .filter((b) => b.at)
    .slice(0, max)
    .map((b) => ({
      name: b.r.name,
      text: `${shortStreet(b.r.name)}${b.cls === 'nowalk' ? ' · no walking' : ''}`,
      at: b.at,
      cls: b.cls,
      priority: rank(b),
    }));
}

/** Mapped entrances; the hotel's (within 25 m) labelled with their street. */
export function doorPlan(entrances, roads, hotelRing) {
  const named = roads.filter(
    (r) =>
      r.name && ['major', 'minor', 'service', 'nowalk'].includes(roadClass(r)),
  );
  return entrances.map((e) => {
    const atHotel = hotelRing
      ? nearestStreet(e, [{ name: 'hotel', coords: hotelRing }], 25)
      : null;
    const street = atHotel ? nearestStreet(e, named, 80) : null;
    return {
      ...e,
      atHotel: Boolean(atHotel),
      label: atHotel
        ? `Mapped entrance${e.kind === 'main' ? ' (main)' : ''}${street ? ` · ${shortStreet(street.name)}` : ''}`
        : null,
    };
  });
}

const STYLE = {
  major: { width: 4.5, color: '#eff7f3', alpha: 0.9 },
  minor: { width: 2.5, color: '#b8c3c7', alpha: 0.85 },
  service: { width: 1.5, color: '#9aa8ac', alpha: 0.85, far: 2000 },
  nowalk: { width: 3, color: '#415e6b', alpha: 0.95 },
  walk: { width: 1.25, color: '#b8c3c7', alpha: 0.5, far: 1500 },
  steps: { width: 2.5, color: '#e3e7e9', alpha: 0.95, far: 1500 },
};

function glyphCanvas(draw) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  draw(c.getContext('2d'));
  return c;
}
let DOOR = null;
let STAIRS = null;
function glyphs() {
  // A door: a rotated square with a dark edge (never "exit").
  DOOR ||= glyphCanvas((g) => {
    g.translate(16, 16);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#eff7f3';
    g.strokeStyle = '#061a23';
    g.lineWidth = 3;
    g.fillRect(-7, -7, 14, 14);
    g.strokeRect(-7, -7, 14, 14);
  });
  // Steps: three stair treads on a dark plate.
  STAIRS ||= glyphCanvas((g) => {
    g.fillStyle = 'rgba(6,26,35,0.9)';
    g.fillRect(2, 2, 28, 28);
    g.strokeStyle = '#e3e7e9';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(6, 25);
    g.lineTo(13, 25);
    g.lineTo(13, 18);
    g.lineTo(19, 18);
    g.lineTo(19, 11);
    g.lineTo(26, 11);
    g.stroke();
  });
}

export function createStreetsLayer(viewer, site) {
  glyphs();
  const scene = viewer.scene;
  const { projector, field, center } = site;
  const R = (site.radius || 400) + 60;
  const inside = (coords) => coords.filter((p) => haversineM(p, center) <= R);
  const prims = {};
  const labels = new Cesium.CustomDataSource('trip-twin-street-names');
  const marks = new Cesium.CustomDataSource('trip-twin-street-marks');
  viewer.dataSources.add(labels);
  viewer.dataSources.add(marks);
  const css = (hex, a) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
  const ground = (p, dz) => {
    const [x, y] = projector.toXY(p.lat, p.lon);
    return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, field.at(x, y) + dz);
  };

  const clipped = (site.roads || []).map((r) => ({
    ...r,
    coords: inside(r.coords),
  }));
  const byClass = {};
  for (const road of clipped) {
    const cls = roadClass(road);
    if (!cls || cls === 'hidden' || road.coords.length < 2) continue;
    (byClass[cls] ||= []).push(road);
  }
  // One batched primitive per class; far classes fade with camera distance.
  for (const [cls, ways] of Object.entries(byClass)) {
    const st = STYLE[cls];
    prims[cls] = scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: ways.map(
          (w) =>
            new Cesium.GeometryInstance({
              geometry: new Cesium.PolylineGeometry({
                positions: drape(
                  w.coords,
                  projector,
                  field,
                  cls === 'major' ? 0.6 : 0.5,
                ),
                width: st.width,
                arcType: Cesium.ArcType.NONE,
              }),
              attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                  css(st.color, st.alpha),
                ),
                ...(st.far
                  ? {
                      distanceDisplayCondition:
                        new Cesium.DistanceDisplayConditionGeometryInstanceAttribute(
                          0,
                          st.far,
                        ),
                    }
                  : {}),
              },
            }),
        ),
        appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
        asynchronous: false,
        show: false,
      }),
    );
  }
  const ring = site.hotel?.building?.rings?.[0] || null;
  const hub = ring
    ? ring.reduce(
        (a, p) => ({
          lat: a.lat + p.lat / ring.length,
          lon: a.lon + p.lon / ring.length,
        }),
        { lat: 0, lon: 0 },
      )
    : center;
  for (const l of streetLabels(clipped, { hub })) {
    const e = labels.entities.add({
      position: ground(l.at, 3),
      label: {
        text: l.text,
        font: `${l.cls === 'major' ? '600 ' : ''}11px Inter, sans-serif`,
        fillColor: css(
          l.cls === 'major'
            ? '#eff7f3'
            : l.cls === 'nowalk'
              ? '#9aa8ac'
              : '#b8c3c7',
          1,
        ),
        showBackground: true,
        backgroundColor: css('#061a23', 0.82),
        backgroundPadding: new Cesium.Cartesian2(4, 2),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
          0,
          l.cls === 'major' ? 3200 : 1800,
        ),
      },
    });
    e.declutterPriority = 6 + l.priority; // after places and people
  }
  // Steps: a stairs glyph at each flight.
  for (const w of byClass.steps || []) {
    marks.entities.add({
      position: ground(midpoint(w.coords) || w.coords[0], 2),
      billboard: {
        image: STAIRS,
        width: 16,
        height: 16,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1500),
      },
    });
  }
  // Mapped entrances (OSM, unverified): doors by kind, the hotel's labelled.
  const doors = doorPlan(
    (site.entrances || []).filter((e) => haversineM(e, center) <= R),
    clipped,
    ring,
  );
  for (const d of doors) {
    const size = d.kind === 'main' ? 16 : 12;
    const e = marks.entities.add({
      position: ground(d, 1.5),
      billboard: {
        image: DOOR,
        width: size,
        height: size,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1500),
      },
      ...(d.label
        ? {
            label: {
              text: d.label,
              font: '500 11px Inter, sans-serif',
              fillColor: css('#eff7f3', 1),
              showBackground: true,
              backgroundColor: css('#061a23', 0.88),
              pixelOffset: new Cesium.Cartesian2(0, -16),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
                0,
                1200,
              ),
            },
          }
        : {}),
    });
    e.declutterGlyph = size;
  }
  labels.show = false;
  marks.show = false;
  const counts = {
    streets: ['major', 'minor', 'service'].reduce(
      (n, c) => n + (byClass[c]?.length || 0),
      0,
    ),
    nowalk: byClass.nowalk?.length || 0,
    walkways: byClass.walk?.length || 0,
    steps: byClass.steps?.length || 0,
    entrances: doors.length,
    hotelDoors: doors.filter((d) => d.atHotel).length,
    hotelMain: doors.filter((d) => d.atHotel && d.kind === 'main').length,
    names: labels.entities.values.length,
  };

  return {
    counts,
    /** {streets, walkways} on / off. */
    set({ streets = false, walkways = false } = {}) {
      for (const c of ['major', 'minor', 'service', 'nowalk'])
        if (prims[c]) prims[c].show = streets;
      labels.show = streets;
      for (const c of ['walk', 'steps']) if (prims[c]) prims[c].show = walkways;
      marks.show = walkways;
      scene.requestRender();
    },
    dispose() {
      if (viewer.isDestroyed()) return;
      for (const p of Object.values(prims)) scene.primitives.remove(p);
      viewer.dataSources.remove(labels, true);
      viewer.dataSources.remove(marks, true);
    },
  };
}
