// Live aircraft on the twin (Jesse, 29 Oct 2026): each aircraft at its real
// position and altitude, nose along its track; on the ground just above the
// site's heightfield (stands, taxiways). Quiet Instrument marks: steel in
// the air, dimmer steel on the ground, a faint stem to the ground and a
// short trail of the last fixes. Callsigns go on Trip Twin's world overlay
// (twinMapLabels.js reads `mapLabel` off the entity), only at closer views.
// Between polls an airborne fix is carried forward along its track when
// `extrapolate()` says so (the Live motion tier, never under Reduce motion);
// otherwise each poll jumps. The silhouette is upstream's (imported).
import * as Cesium from 'cesium';
import { aircraftIcon } from '../../data/aircraftIcons.js';
import { ensureGeoidReady, geoidHeight } from '../../data/geoid.js';
import {
  AIRCRAFT_LABEL_FAR_M,
  aircraftHeightM,
  aircraftTitle,
  extrapolate,
} from './twinAircraft.js';
import { mapLabel } from './twinMapLabelEntries.js';

// Instrument tokens: near-white in the air, steel on the ground.
const AIR = '#eef5f3';
const GROUND = '#b8c3c7';
const TRAIL = '#80959b';
const TRAIL_N = 4;
/** Stems for aircraft below this altitude (metres). */
const STEM_BELOW_M = 3000;
const css = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);

/**
 * createAircraftLayer(viewer, site, o) → {update(view), setShow(on), dispose}
 * o: {wall() → true on a wall, extrapolate() → carry fixes forward, now()}.
 * view: aircraftView() (twinAircraft.js).
 */
export function createAircraftLayer(viewer, site, o = {}) {
  const now = o.now || (() => Date.now());
  const ds = new Cesium.CustomDataSource('trip-twin-aircraft');
  ds.show = false;
  viewer.dataSources.add(ds);
  const icon = aircraftIcon('airliner');
  const c = site.center;
  const clon = c.lon ?? c.lng;
  let N = 0;
  let lastView = null;
  let disposed = false;
  ensureGeoidReady()
    .then(() => {
      if (disposed) return;
      N = geoidHeight(c.lat, clon);
      if (lastView) update(lastView);
    })
    .catch(() => {});
  const ground = (lat, lon) => {
    const [x, y] = site.projector.toXY(lat, lon);
    return site.field.at(x, y);
  };
  const recs = new Map(); // icao24 → {a, fixAt, entity, trail}

  /** Where a record is now (carried forward, or its fix). */
  function where(r) {
    const dt = o.extrapolate?.() ? (now() - r.fixAt) / 1000 : 0;
    const p = extrapolate(r.a, dt);
    return {
      ...p,
      h: aircraftHeightM({ ...r.a, altM: p.altM }, ground(p.lat, p.lon), N),
    };
  }
  const cart = (p, out) =>
    Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.h, undefined, out);

  function headingAxis(a, at) {
    const t = Cesium.Math.toRadians(Number(a.trackDeg) || 0);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(at);
    const east = Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian4());
    const north = Cesium.Matrix4.getColumn(enu, 1, new Cesium.Cartesian4());
    const v = new Cesium.Cartesian3(
      east.x * Math.sin(t) + north.x * Math.cos(t),
      east.y * Math.sin(t) + north.y * Math.cos(t),
      east.z * Math.sin(t) + north.z * Math.cos(t),
    );
    return Cesium.Cartesian3.normalize(v, v);
  }

  function entityFor(r, wall) {
    const pos = new Cesium.Cartesian3();
    const foot = new Cesium.Cartesian3();
    const top = new Cesium.Cartesian3();
    const px = wall ? 40 : 28;
    const e = ds.entities.add({
      id: `twin-aircraft:${r.a.icao24}`,
      position: new Cesium.CallbackProperty(() => cart(where(r), pos), false),
      billboard: {
        image: icon,
        width: px,
        height: px,
        color: css(r.a.onGround ? GROUND : AIR, r.a.onGround ? 0.9 : 1),
        alignedAxis: headingAxis(r.a, cart(where(r))),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      mapLabel: mapLabel('ambient', {
        title: aircraftTitle(r.a),
        far: AIRCRAFT_LABEL_FAR_M,
        priority: 6,
        // Operator free text never: a callsign is public data.
        wallDetails: false,
      }),
    });
    if (!r.a.onGround && r.a.altM < STEM_BELOW_M)
      // A faint stem says how high, over the ground beneath it: low traffic
      // (arriving, departing) only; an overflight 12 km up needs none.
      e.polyline = new Cesium.PolylineGraphics({
        positions: new Cesium.CallbackProperty(() => {
          const p = where(r);
          return [cart({ ...p, h: ground(p.lat, p.lon) }, foot), cart(p, top)];
        }, false),
        width: 1,
        arcType: Cesium.ArcType.NONE,
        material: css(TRAIL, 0.35),
      });
    return e;
  }

  function trailFor(r) {
    const id = `twin-aircraft-trail:${r.a.icao24}`;
    const old = ds.entities.getById(id);
    const pts = r.trail;
    if (r.a.onGround || pts.length < 2) {
      if (old) ds.entities.remove(old);
      return;
    }
    const positions = pts.map((p) => cart(p));
    if (old) old.polyline.positions = positions;
    else
      ds.entities.add({
        id,
        polyline: {
          positions,
          width: 1.5,
          arcType: Cesium.ArcType.NONE,
          material: css(TRAIL, 0.4),
        },
      });
  }

  function update(view) {
    lastView = view;
    if (disposed) return;
    const wall = Boolean(o.wall?.());
    const list = view?.aircraft || [];
    const at = view?.receivedAt ?? now();
    const ageS = Number.isFinite(view?.ageS) ? view.ageS : 0;
    const seen = new Set();
    ds.entities.suspendEvents();
    try {
      for (const a of list) {
        seen.add(a.icao24);
        // The fix's own time: the answer's age plus the position's age.
        const fixAt =
          at -
          (Math.max(0, ageS - (now() - at) / 1000) + (a.posAgeS || 0)) * 1000;
        const prev = recs.get(a.icao24);
        const here = {
          lat: a.lat,
          lon: a.lon,
          h: aircraftHeightM(a, ground(a.lat, a.lon), N),
        };
        if (
          prev &&
          aircraftTitle(prev.a) === aircraftTitle(a) &&
          prev.a.onGround === a.onGround &&
          prev.a.altM < STEM_BELOW_M === a.altM < STEM_BELOW_M &&
          prev.wall === wall
        ) {
          const moved =
            prev.trail.length === 0 ||
            prev.trail[prev.trail.length - 1].lat !== here.lat ||
            prev.trail[prev.trail.length - 1].lon !== here.lon;
          prev.a = a;
          prev.fixAt = fixAt;
          if (moved) prev.trail = [...prev.trail, here].slice(-TRAIL_N);
          prev.entity.billboard.alignedAxis = headingAxis(a, cart(where(prev)));
          trailFor(prev);
          continue;
        }
        if (prev) ds.entities.remove(prev.entity);
        const r = {
          a,
          fixAt,
          wall,
          trail: prev ? [...prev.trail, here].slice(-TRAIL_N) : [here],
        };
        r.entity = entityFor(r, wall);
        recs.set(a.icao24, r);
        trailFor(r);
      }
      for (const [id, r] of recs)
        if (!seen.has(id)) {
          ds.entities.remove(r.entity);
          const t = ds.entities.getById(`twin-aircraft-trail:${id}`);
          if (t) ds.entities.remove(t);
          recs.delete(id);
        }
    } finally {
      ds.entities.resumeEvents();
    }
    viewer.scene.requestRender();
  }

  return {
    update,
    setShow(on) {
      ds.show = Boolean(on);
      if (!on) update({ aircraft: [] });
      viewer.scene.requestRender();
    },
    get count() {
      return recs.size;
    },
    dispose() {
      disposed = true;
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
    },
  };
}
