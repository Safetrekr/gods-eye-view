// SafeTrekr Executive B3: the 3D site twin under MAIN and the Principal
// view, through page.js's own hooks only (no edit on twin.html's graph):
//   window.tripTwin.setSnapshot   the twin's snapshot feed ("harness stands
//                                 in for H-2's setSnapshot"): a hollow one,
//                                 with no school traveller, place, safety
//                                 point, zone or incident, so no school pin
//                                 or label is drawn. ?freeze (page.js) keeps
//                                 the demo feed from refilling it.
//   window.tripTwinPage.switchSite the site twin of the person's venue
//   window.testTwinViewer / window.testCesium  the viewer, for one data
//                                 source of our own: the executive overlay
// The school layers that draw their own content (suggested and saved
// paths, corridors, safety resources, floors, the street photo) are turned
// off per wall from the remote (session layers), as any wall's are.
import { tripTwinDemoSnapshot } from '../../../demoTripTwin.js';

/** Snapshot arrays that carry school people, places or events. */
const HOLLOW = [
  'participants',
  'places',
  'itinerary',
  'safety_points',
  'geofences',
  'geofence_events',
  'group_zones',
  'musters',
  'morning_musters',
  'alerts',
  'flights',
  'reported_incidents',
];

/** The school snapshot with every person, place and event taken out. */
export function hollowSnapshot(cityKey = 'austin') {
  const s = tripTwinDemoSnapshot(cityKey, 'baseline', {
    pois: [],
    poisBySite: {},
  });
  for (const k of HOLLOW) if (Array.isArray(s[k])) s[k] = [];
  if (s.page) s.page = { ...s.page, total: 0, has_more: false };
  return s;
}

const twin = () => globalThis.tripTwin;
const page = () => globalThis.tripTwinPage;
const viewer = () => globalThis.testTwinViewer;
const C = () => globalThis.testCesium;
const ready = () =>
  Boolean(
    twin() && viewer() && C() && ['ready', 'degraded'].includes(twin().state),
  );

export function createScene({ cityKey = 'austin' } = {}) {
  let ds = null;
  let wantSite = null;
  let switching = false;
  let lastDraw = null;
  let lastSig = '';

  /** People left in the twin's own layer (0 once hollow). */
  function schoolPeople() {
    const v = viewer();
    if (!v) return 0;
    let n = 0;
    for (let i = 0; i < v.dataSources.length; i++) {
      const d = v.dataSources.get(i);
      if (d.name === 'trip-twin-people') n += d.entities.values.length;
    }
    return n;
  }
  function hollow() {
    if (!ready()) return false;
    if (schoolPeople() > 0 || !hollow.done) {
      twin().setSnapshot(hollowSnapshot(cityKey));
      hollow.done = true;
    }
    return true;
  }
  /**
   * The school trip's other sites ("Day 3 · 10:00" beacons) are not the
   * executive day's: keep their layer off on the executive 3D walls.
   */
  function quietSchool() {
    const v = viewer();
    if (!v) return;
    for (let i = 0; i < v.dataSources.length; i++) {
      const d = v.dataSources.get(i);
      if (d.name === 'trip-twin-site-beacons' && d.show) {
        d.show = false;
        v.scene.requestRender?.();
      }
    }
  }
  // A site switch or a late feed refills the twin: keep it hollow.
  setInterval(() => {
    hollow();
    quietSchool();
    tick();
    // QA hook: the site the wall wants is up and the overlay drawn.
    const ok =
      ready() &&
      !switching &&
      (!wantSite || twin().siteKey === wantSite) &&
      schoolPeople() === 0;
    document.body.dataset.exScene = ok ? 'settled' : 'moving';
  }, 1500);

  async function tick() {
    if (!ready() || switching) return;
    if (wantSite && twin().siteKey !== wantSite) {
      switching = true;
      try {
        await page()?.switchSite(wantSite);
      } catch {
        /* the next tick tries again */
      }
      switching = false;
      hollow.done = false;
      hollow();
      ensureDs(true);
      if (lastDraw) draw(lastDraw, true);
    }
  }

  function ensureDs(force = false) {
    const v = viewer();
    const Cs = C();
    if (!v || !Cs) return null;
    if (ds && v.dataSources.contains(ds) && !force) return ds;
    if (ds && v.dataSources.contains(ds)) v.dataSources.remove(ds, true);
    ds = new Cs.CustomDataSource('executive-overlay');
    v.dataSources.add(ds);
    return ds;
  }

  /** Ground height near the site's centre (the twin's own field). */
  function ground() {
    const s = twin()?.site;
    try {
      return (s?.field?.at?.(0, 0) ?? 0) + 2;
    } catch {
      return 2;
    }
  }

  /**
   * Draw the overlay: {routes, areas, entrances, marks, posts, focus}.
   * Labels are callsigns and place words only.
   */
  function draw(o, force = false) {
    lastDraw = o;
    if (!ready() || switching) {
      // Nothing of the last site may stay up while the next one loads.
      if (ds?.entities.values.length) {
        ds.entities.removeAll();
        lastSig = '';
        viewer()?.scene?.requestRender?.();
      }
      return false;
    }
    const sig = JSON.stringify([twin().siteKey, o]);
    if (!force && sig === lastSig) return true;
    lastSig = sig;
    const d = ensureDs();
    const Cs = C();
    if (!d || !Cs) return false;
    d.entities.removeAll();
    const h = ground();
    const P = (lat, lon, dz = 0) => Cs.Cartesian3.fromDegrees(lon, lat, h + dz);
    const col = (hex, a = 1) => Cs.Color.fromCssColorString(hex).withAlpha(a);
    const TEXT = '#eef5f3';
    const FIELD = '#040c12';
    const label = (
      text,
      { size = 16, color = TEXT, dy = -18, plate = true } = {},
    ) => ({
      text,
      font: `600 ${size}px "Intel One Mono", ui-monospace, Menlo, monospace`,
      fillColor: col(color),
      outlineColor: col(FIELD),
      outlineWidth: 3,
      style: Cs.LabelStyle.FILL_AND_OUTLINE,
      showBackground: plate,
      backgroundColor: col('#08161e', 0.82),
      backgroundPadding: new Cs.Cartesian2(7, 4),
      pixelOffset: new Cs.Cartesian2(0, dy),
      verticalOrigin: Cs.VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    for (const a of o.areas || [])
      d.entities.add({
        position: P(a.lat, a.lon),
        ellipse: {
          semiMajorAxis: a.r,
          semiMinorAxis: a.r,
          height: h,
          material: col('#f59e0b', 0.16),
          outline: true,
          outlineColor: col('#f59e0b', 0.8),
        },
        label: label(a.label, { color: '#f59e0b', dy: 0 }),
      });
    for (const r of o.routes || []) {
      if (r.coords.length < 2) continue;
      d.entities.add({
        polyline: {
          positions: r.coords.map(([lat, lon]) => P(lat, lon, 1)),
          width: r.planned ? 4 : 6,
          material: r.planned
            ? new Cs.PolylineDashMaterialProperty({
                color: col('#b8c3c7', 0.75),
                dashLength: 18,
              })
            : new Cs.PolylineGlowMaterialProperty({
                color: col('#3b82f6', 0.95),
                glowPower: 0.18,
              }),
          depthFailMaterial: r.planned
            ? new Cs.PolylineDashMaterialProperty({
                color: col('#b8c3c7', 0.35),
                dashLength: 18,
              })
            : col('#3b82f6', 0.45),
        },
      });
      const mid = r.coords[Math.floor(r.coords.length * 0.55)];
      d.entities.add({
        position: P(mid[0], mid[1], 2),
        label: label(r.label, {
          size: 13,
          color: r.planned ? '#b8c3c7' : '#93bafa',
          dy: -6,
        }),
      });
    }
    for (const e of o.entrances || []) {
      const named = o.focusEntrance && e.name === o.focusEntrance;
      d.entities.add({
        position: P(e.lat, e.lon, 1),
        point: {
          pixelSize: named ? 14 : 10,
          color: col(named ? '#eef5f3' : '#b8c3c7'),
          outlineColor: col(FIELD),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: label(e.name, { size: named ? 18 : 15 }),
      });
    }
    for (const p of o.posts || [])
      d.entities.add({
        position: P(p.lat, p.lon, 1),
        point: {
          pixelSize: 11,
          color: col('#040c12'),
          outlineColor: col('#eef5f3'),
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: label(p.label, { size: 14, dy: 16 }),
      });
    for (const m of o.marks || []) {
      const main = m.kind === 'person';
      d.entities.add({
        position: P(m.lat, m.lon, 2),
        point: {
          pixelSize: main ? 16 : m.kind === 'vehicle' ? 10 : 9,
          color: col(main ? '#eef5f3' : '#b8c3c7'),
          outlineColor: col(m.fresh === 'aging' ? '#f59e0b' : FIELD),
          outlineWidth: main ? 3 : 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label:
          main || m.kind === 'vehicle'
            ? label(m.label, { size: main ? 20 : 13, dy: main ? -22 : -12 })
            : undefined,
      });
    }
    // Labels rasterise their glyphs on one frame and show on a later one:
    // ask for a few more frames so they appear without a camera move.
    const again = () => viewer()?.scene?.requestRender?.();
    again();
    for (const ms of [120, 400, 1200, 3000]) setTimeout(again, ms);
    return true;
  }

  return {
    /** Go to a site twin (null: stay). */
    site(key) {
      wantSite = key || null;
      if (wantSite && twin()?.siteKey !== wantSite && ds) {
        ds.entities.removeAll();
        lastSig = '';
      }
      tick();
    },
    draw,
    clear() {
      lastDraw = null;
      lastSig = '';
      ds?.entities.removeAll();
    },
    get ready() {
      return ready();
    },
    get siteKey() {
      return twin()?.siteKey ?? null;
    },
    schoolPeople,
  };
}
