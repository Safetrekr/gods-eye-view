// The wider area around a site (phase 8; review/phase8 N1–N14): a ring of
// plain buildings and main streets out to the recorded radius around the
// hotel, and strips toward each venue and the nearest hospital. Map detail
// only — no labels, no picking, never a path. Brightness order: detailed
// core > strips > ring. Steps back in Ways out and during an incident.
import * as Cesium from 'cesium';
import { haversineM } from './twinData.js';
import { roadClass } from './twinStreets.js';
import { drape } from './twinScene.js';

const css = (hex, a) => Cesium.Color.fromCssColorString(hex).withAlpha(a);
const ll = ([lat, lon]) => ({ lat, lon });

/** Mapped height, else levels × 3.2 m, else 9 m drawn as estimated. */
export function contextHeight(b) {
  if (Number.isFinite(b.h) && b.h > 0)
    return { m: Math.min(b.h, 400), est: false };
  if (Number.isFinite(b.l) && b.l > 0)
    return { m: Math.min(b.l * 3.2, 400), est: false };
  return { m: 9, est: true };
}

/** A compact fixture road → a road for roadClass (walkability tags kept). */
export const contextRoad = (r) => ({
  highway: r.k,
  tunnel: r.t ? 'yes' : null,
  access: r.a || null,
  foot: r.f || null,
  footway: r.w || null,
});

/** Split a polyline into the runs that lie inside [minM, maxM] of hub. */
export function clipRuns(coords, hub, minM, maxM) {
  const runs = [];
  let run = [];
  for (const p of coords) {
    const d = haversineM(p, hub);
    if (d >= minM && d <= maxM) run.push(p);
    else {
      if (run.length >= 2) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}

/**
 * What to draw, pure. Skips anything already in the detailed core (by OSM
 * id or by position), each item once; toward-strips first. coreIds: Set of
 * "way/<id>" already drawn in the core.
 * Returns {ring: {buildings, roads}, strips: [{key, label, kind, buildings,
 * roads, path}], hub, ringM}.
 */
export function contextPlan(data, { coreCenter, coreM, coreIds = new Set() }) {
  const hub = data.meta?.hub || null;
  const seen = new Set();
  const centroid = (c) => {
    const n = c.length;
    return c.reduce(
      (a, p) => ({ lat: a.lat + p[0] / n, lon: a.lon + p[1] / n }),
      { lat: 0, lon: 0 },
    );
  };
  const fresh = (x) => {
    if (seen.has(x.id) || coreIds.has(`way/${x.id}`)) return false;
    seen.add(x.id);
    return true;
  };
  const outsideCore = (c) => haversineM(centroid(c), coreCenter) > coreM;
  const keepRoad = (r, allowed) => {
    const cls = roadClass(contextRoad(r));
    return cls && cls !== 'hidden' && allowed.includes(cls);
  };
  const strips = (data.corridors || []).map((c) => ({
    key: c.key,
    label: c.label,
    kind: c.kind,
    path: (c.path || []).map(ll),
    buildings: (c.buildings || []).filter(
      (b) => b.c.length >= 4 && outsideCore(b.c) && fresh(b),
    ),
    roads: (c.roads || []).filter(
      (r) =>
        r.c.length >= 2 &&
        keepRoad(r, ['major', 'minor', 'service', 'nowalk', 'walk', 'steps']) &&
        fresh(r),
    ),
  }));
  const ring = {
    buildings: (data.ring?.buildings || []).filter(
      (b) => b.c.length >= 4 && outsideCore(b.c) && fresh(b),
    ),
    roads: (data.ring?.roads || []).filter(
      (r) =>
        r.c.length >= 2 &&
        keepRoad(r, ['major', 'minor', 'nowalk']) &&
        fresh(r),
    ),
  };
  return { ring, strips, ringM: data.meta?.ringM || 1200 };
}

/**
 * Is a point drawn on the map? Inside the ring around the hotel, or within
 * stripM of a strip's path (review/phase8 N1). Pure.
 */
export function coversPoint(
  pt,
  { hotel, ringM, strips = [], stripM = 150, ringOn = true },
) {
  if (ringOn && hotel && haversineM(pt, hotel) <= ringM) return true;
  for (const s of strips)
    for (let i = 0; i < s.path.length; i += 4)
      if (haversineM(pt, s.path[i]) <= stripM + 40) return true;
  return false;
}

export function createContextLayer(
  viewer,
  site,
  data,
  { hotel, coreIds } = {},
) {
  const scene = viewer.scene;
  const { projector, field } = site;
  const coreM = (site.radius || 400) + 60;
  const plan = contextPlan(data, {
    coreCenter: site.center,
    coreM: coreM - 70,
    coreIds,
  });
  const hub = hotel || site.center;
  // At a venue far from the hotel, the hotel's ring is not this site's.
  const ringHere = haversineM(site.center, hub) <= 1000;
  const groundAt = (lat, lon) => {
    const [x, y] = projector.toXY(lat, lon);
    return field.at(x, y);
  };
  const owned = new Set();
  const add = (prim) => {
    owned.add(prim);
    return scene.primitives.add(prim);
  };

  /** Faint volumes; edges as roof (and footprint) outlines, no verticals. */
  function buildings(list, { fill, fillEst, edge, footprint }) {
    const solids = [];
    const outlines = [];
    for (const b of list) {
      const pos = b.c.map(([lat, lon]) =>
        Cesium.Cartesian3.fromDegrees(lon, lat),
      );
      const base = groundAt(b.c[0][0], b.c[0][1]);
      const { m, est } = contextHeight(b);
      solids.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(pos),
            height: base,
            extrudedHeight: base + m,
            vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              est ? fillEst : fill,
            ),
          },
        }),
      );
      for (const h of footprint ? [base + m, base + 0.3] : [base + m])
        outlines.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.PolylineGeometry({
              positions: b.c.map(([lat, lon]) =>
                Cesium.Cartesian3.fromDegrees(lon, lat, h),
              ),
              width: 1,
              arcType: Cesium.ArcType.NONE,
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(edge),
            },
          }),
        );
    }
    return {
      solids: solids.length
        ? add(
            new Cesium.Primitive({
              geometryInstances: solids,
              appearance: new Cesium.PerInstanceColorAppearance({
                flat: true,
                translucent: true,
              }),
              asynchronous: true,
              show: false,
            }),
          )
        : null,
      edges: outlines.length
        ? add(
            new Cesium.Primitive({
              geometryInstances: outlines,
              appearance: new Cesium.PolylineColorAppearance({
                translucent: true,
              }),
              asynchronous: true,
              show: false,
            }),
          )
        : null,
    };
  }
  /** Streets draped on the ground grid; style by class; far detail fades. */
  function roads(list, styleFor, clip) {
    const inst = [];
    for (const r of list) {
      const cls = roadClass(contextRoad(r));
      const st = styleFor(cls);
      if (!st) continue;
      for (const run of clip(r.c.map(ll))) {
        inst.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.PolylineGeometry({
              positions: drape(run, projector, field, 0.4, 25),
              width: st.w,
              arcType: Cesium.ArcType.NONE,
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                css(st.c, st.a),
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
        );
      }
    }
    return inst.length
      ? add(
          new Cesium.Primitive({
            geometryInstances: inst,
            appearance: new Cesium.PolylineColorAppearance({
              translucent: true,
            }),
            asynchronous: true,
            show: false,
          }),
        )
      : null;
  }

  // Ring: the faintest — enough to know where you are.
  const ring = ringHere
    ? {
        ...buildings(plan.ring.buildings, {
          fill: css('#415e6b', 0.04),
          fillEst: css('#415e6b', 0.025),
          edge: css('#80959b', 0.14),
          footprint: false,
        }),
        roads: roads(
          plan.ring.roads,
          (cls) =>
            cls === 'major'
              ? { w: 1.5, c: '#415e6b', a: 0.55 }
              : cls === 'minor'
                ? { w: 1, c: '#415e6b', a: 0.35 }
                : cls === 'nowalk'
                  ? { w: 1, c: '#2a4a59', a: 0.5 }
                  : null,
          (pts) =>
            clipRuns(
              pts,
              hub,
              haversineM(hub, site.center) > 50 ? 0 : coreM,
              plan.ringM,
            ),
        ),
      }
    : null;
  // Toward-strips: a step brighter than the ring, never brighter than the core.
  const strips = plan.strips.map((s) => ({
    key: s.key,
    kind: s.kind,
    ...buildings(s.buildings, {
      fill: css('#415e6b', 0.07),
      fillEst: css('#415e6b', 0.045),
      edge: css('#80959b', 0.28),
      footprint: true,
    }),
    roads: roads(
      s.roads,
      (cls) =>
        cls === 'major' || cls === 'minor'
          ? { w: 1.5, c: '#415e6b', a: 0.9 }
          : cls === 'service'
            ? { w: 1, c: '#415e6b', a: 0.6 }
            : cls === 'nowalk'
              ? { w: 1, c: '#2a4a59', a: 0.6 }
              : cls === 'walk' || cls === 'steps'
                ? { w: 1, c: '#415e6b', a: 0.5, far: 1500 }
                : null,
      (pts) => clipRuns(pts, site.center, coreM, Infinity),
    ),
  }));

  let state = { ring: true, corridors: true };
  let dim = { on: false, keep: null };
  function apply() {
    const show = (p, on) => {
      if (p) p.show = on;
    };
    if (ring) {
      show(ring.solids, state.ring);
      show(ring.edges, state.ring && !dim.on);
      show(ring.roads, state.ring && !dim.on);
    }
    for (const s of strips) {
      const kept = dim.on && dim.keep === s.kind;
      show(s.solids, state.corridors);
      show(s.edges, state.corridors && (!dim.on || kept));
      show(s.roads, state.corridors && (!dim.on || kept));
    }
    scene.requestRender();
  }

  return {
    counts: {
      ringBuildings: ringHere ? plan.ring.buildings.length : 0,
      ringHere,
      estimated: plan.ring.buildings.filter((b) => contextHeight(b).est).length,
      stripBuildings: plan.strips.reduce((n, s) => n + s.buildings.length, 0),
      strips: plan.strips.map((s) => s.label),
      ringM: plan.ringM,
    },
    /** Is a point drawn (ring or strip)? For pins and the chip (N1). */
    covers(pt) {
      return coversPoint(pt, {
        hotel: hub,
        ringM: plan.ringM,
        strips: state.corridors ? plan.strips : [],
        ringOn: Boolean(ring) && state.ring,
      });
    },
    owns(primitive) {
      return owned.has(primitive);
    },
    set(next = {}) {
      state = { ...state, ...next };
      apply();
    },
    /** Step back (Ways out, incident); keep: a strip kind left drawn. */
    setDim(on, { keep = null } = {}) {
      dim = { on: Boolean(on), keep };
      apply();
    },
    dispose() {
      if (viewer.isDestroyed()) return;
      for (const p of owned) scene.primitives.remove(p);
    },
  };
}
