// Trip Twin controller: lifecycle, data loading, solo mode and the entry /
// exit sequences (03 §5.1, §5.4; 05 §3.1, §3.5). Idempotent open/close/dispose.
import * as Cesium from 'cesium';
import { createDeclutter } from './twinDeclutter.js';
import { createStreetsLayer } from './twinStreets.js';
import { createContextLayer } from './twinContext.js';
import { resolveEllipsoidalGround } from '../../data/terrainHeights.js';
import {
  TWIN_RADIUS_M,
  buildTwinQuery,
  gridPoints,
  makeHeightfield,
  makeProjector,
  parseOverpassElements,
  projectBuildings,
  selectHotelFootprint,
} from './twinData.js';
import { buildTwinScene } from './twinScene.js';
import { siteConfig } from './twinSites.js';
import { DEFAULT_GLOW, createSelectionGlow } from './twinSelect.js';
import { createPeopleLayer } from './twinPeople.js';
import { createSafetyLayer } from './twinSafety.js';
import {
  drawPaths,
  hazardProximity,
  pathCardText,
  planPaths,
} from './twinPaths.js';
import { drawFires, fireSummary, loadFires } from './twinFires.js';
import { attributeHeat } from './twinHazards.js';
import { assessSnapshot, bearingLabel, formatDistance } from './twinData.js';

const OVERPASS_TIMEOUT_MS = 25000;
const FIELD = '#040c12';

export async function loadOsm(siteKey, mode, signal) {
  const city = siteConfig(siteKey);
  const fixture = async () => {
    const res = await fetch(
      `/scripts/fixtures/trip-twin/${siteKey}.overpass.json`,
      { signal },
    );
    if (!res.ok) throw new Error(`fixture ${res.status}`);
    const json = await res.json();
    return {
      elements: json.elements,
      source: 'fixture',
      fetchedAt: json.meta.fetched_at,
    };
  };
  if (mode !== 'live') return fixture();
  const timeout = AbortSignal.timeout(OVERPASS_TIMEOUT_MS);
  try {
    const res = await fetch('/api/overpass', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(buildTwinQuery(city.center, TWIN_RADIUS_M))}`,
      signal: AbortSignal.any([signal, timeout]),
    });
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.elements)) throw new Error('overpass: no elements');
    return {
      elements: json.elements,
      source:
        res.headers.get('X-Overpass-Cache') === 'STALE' ? 'cache' : 'live',
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (signal.aborted) throw error;
    console.warn(
      '[TripTwin] live OSM unavailable, using the recorded fixture:',
      error,
    );
    const f = await fixture();
    return {
      ...f,
      source: 'fixture-fallback',
      liveError: String(error?.message || error),
    };
  }
}

async function loadHeightfield(center, signal) {
  // 41 × 41 = 1,681 points (~25 m spacing): enough for honest contours.
  const grid = gridPoints(center, TWIN_RADIUS_M, 41);
  try {
    const results = await resolveEllipsoidalGround(
      grid.points.map((p) => ({ lat: p.lat, lon: p.lon })),
      { signal },
    );
    const heights = results.map((r) =>
      Number.isFinite(r?.ellipsoid) ? r.ellipsoid : null,
    );
    const source = results.some((r) => r?.source === 'reearth')
      ? 'reearth'
      : 'geoid-fallback';
    return { field: makeHeightfield(grid, heights), source };
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      field: makeHeightfield(
        grid,
        grid.points.map(() => 0),
      ),
      source: 'flat',
    };
  }
}

export function flightMs(distanceM) {
  return Math.min(
    2400,
    Math.max(600, 600 + 350 * Math.log10(Math.max(1, distanceM / 100))),
  );
}

function circlePositions(center, radius, n = 72) {
  const proj = makeProjector(center);
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const ll = proj.toLL(radius * Math.cos(t), radius * Math.sin(t));
    return Cesium.Cartesian3.fromDegrees(ll.lon, ll.lat, 0);
  });
}

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
  (() => {
    try {
      return localStorage.getItem('tripTwin.reduceMotion') === '1';
    } catch {
      return false;
    }
  })();

export function createTripTwin({
  viewer,
  tileset,
  onStatus = () => {},
  onReady = () => {},
  onSelect = () => {},
  // Phase 3: page-level picks (site beacons, places) — return true if handled.
  onEntityPick = () => false,
  onAssess = () => {},
  onContext = () => {},
  onContextClick = () => {},
  // Phase 9 (review O1): the drawn suggested-path set changed (id or null).
  onDrawnPaths = () => {},
  glowStyle = DEFAULT_GLOW,
  simulateFires = false,
}) {
  const scene = viewer.scene;
  let state = 'idle';
  let twin = null;
  let site = null;
  let activeSiteKey = null;
  let disposeRoute = null;
  let routeGeometry = null;
  let pickHandler = null;
  let dragHandler = null;
  let dragging = false;
  let swallowClick = false;
  let safeArea = null; // () => {left, right, top, bottom} px covered by panels
  let editingPath = false;

  /** Screen point → ground {lat, lon} on the site's ground plane. */
  function groundAt(position) {
    if (!site) return null;
    const ray = viewer.camera.getPickRay(position);
    if (!ray) return null;
    const origin = Cesium.Cartesian3.fromDegrees(
      site.center.lon,
      site.center.lat,
      site.field.at(0, 0),
    );
    const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(origin);
    const plane = Cesium.Plane.fromPointNormal(origin, normal);
    const hit = Cesium.IntersectionTests.rayPlane(ray, plane);
    if (!hit) return null;
    const c = Cesium.Cartographic.fromCartesian(hit);
    return {
      lat: Cesium.Math.toDegrees(c.latitude),
      lon: Cesium.Math.toDegrees(c.longitude),
    };
  }
  let peopleHidden = false;
  let saved = null;
  let abort = null;
  let clipping = null;
  let glow = null;
  let handler = null;
  let selectedId = null;
  let selectedPersonId = null;
  let style = glowStyle;
  let people = null;
  let safety = null;
  let declutterer = null;
  let selectedPlaceId = null;
  let streetsLayer = null;
  // The wider area (phase 8): context ring + corridors, on by default.
  let contextLayer = null;
  let contextState = { ring: true, corridors: true };
  let contextDim = { on: false, keep: null };
  let contextInfo = { status: 'loading', counts: null };
  let hotelStepBack = false; // Ways out view (phase 7)
  /** The wider area for the site's city (hotel ring, corridors to venues). */
  async function loadContext(forSite) {
    const cityKey = siteConfig(forSite.key)?.city || forSite.key;
    contextInfo = { status: 'loading', counts: null };
    try {
      const res = await fetch(
        `/scripts/fixtures/trip-twin/${cityKey}.context.json`,
        { signal: abort?.signal },
      );
      if (!res.ok) throw new Error(`context ${res.status}`);
      const data = await res.json();
      if (site !== forSite || state !== 'ready') return;
      contextLayer?.dispose();
      const hotelKey = siteConfig(forSite.key)?.city || forSite.key;
      const h = siteConfig(hotelKey)?.center;
      contextLayer = createContextLayer(viewer, forSite, data, {
        hotel: h ? { lat: h.lat, lon: h.lon ?? h.lng } : null,
        coreIds: new Set([
          ...(forSite.roads || []).map((r) => r.id),
          ...(forSite.buildings || []).map((b) => b.id),
        ]),
      });
      contextLayer.set(contextState);
      contextLayer.setDim(contextDim.on, { keep: contextDim.keep });
      contextInfo = {
        status: 'ready',
        counts: contextLayer.counts,
        fetchedAt: data.meta?.fetchedAt || null,
      };
      refresh(); // re-pin people and places now the map reaches further
    } catch (error) {
      if (abort?.signal?.aborted) return;
      contextInfo = { status: 'unavailable', counts: null };
      console.warn('[TripTwin] wider area unavailable', error?.message);
    }
    onContext?.(contextInfo);
  }
  /** Hotel glass: floor focus 0.4; Ways out 0.2 (edges carry the shape). */
  function applyHotelDim() {
    twin?.setHotelDim(
      floorFocus !== null || hotelStepBack,
      floorFocus !== null ? 0.4 : 0.2,
    );
  }
  let streetsState = { streets: false, walkways: false };
  let peopleDim = false;
  let chips = [];
  let peopleInfo = { beyond: 0 };
  let paths = null; // { paths: [...] } once planned
  let pathsPlanning = false;
  let pathsVisible = true;
  let disposePaths = null;
  // Phase 9: the drawn suggested path set and which path is selected.
  let routeSet = null;
  let selectedPathKind = null;
  let routeLines = null; // drawPaths dispose (+ .hover) for the shown set
  let setSeq = 0;
  let lastDrawnId = null;
  let hoverKind = null;
  let suggestionFaded = false; // a saved path covers the same ends
  let fires = { status: 'loading', records: [] };
  // Fire boundaries (NIFC) claim the heat detections inside or next to
  // them; the demo fire adds its own SIMULATED detections (hazards H5).
  let fireRows = [];
  let extraHeat = [];
  const allHeat = () =>
    extraHeat.length ? [...fires.records, ...extraHeat] : fires.records;
  const heatSplit = () => attributeHeat(allHeat(), fireRows);
  let disposeFires = null;
  let simulatedFires = simulateFires;
  let snapshot = null;
  let receivedAt = 0;
  let elapsed = 0;
  let floorsOn = true; // Jesse: people on their estimated floors by default
  let sessionReported; // undefined = use the snapshot's report; null = cleared
  let sessionAt = null; // when the operator's report was made (review/phase10 R4)
  let sessionKind = null; // operator-entered report kind
  let dismissed = null; // { reason, at } for the snapshot report (Undo restores)
  // Phase 3: reports and dismissals belong to the site they were made at.
  const sessionBySite = new Map();
  function swapSiteSession(nextKey) {
    if (activeSiteKey)
      sessionBySite.set(activeSiteKey, {
        sessionReported,
        sessionKind,
        sessionAt,
        dismissed,
      });
    const saved = sessionBySite.get(nextKey);
    sessionReported = saved ? saved.sessionReported : undefined;
    sessionKind = saved ? saved.sessionKind : null;
    sessionAt = saved ? saved.sessionAt : null;
    dismissed = saved ? saved.dismissed : null;
  }
  let firesVisible = true;
  let safetyVisible = true;
  let assessment = null;
  const stats = (window.__tripTwinStats = {
    status: state,
    requests: { overpass: 0, terrain: 0 },
    buildings: 0,
    triangles: 0,
    primitives: 0,
    osmSource: null,
    terrainSource: null,
    timings: {},
    motion: { reduced: reducedMotion(), clipSupported: null, dissolve: null },
  });
  const setState = (s, detail) => {
    state = s;
    stats.status = s;
    onStatus(s, detail);
  };

  function saveScene() {
    saved = {
      globe: scene.globe.show,
      tileset: tileset?.show ?? null,
      sky: scene.skyAtmosphere.show,
      brightness: scene.skyAtmosphere.brightnessShift,
      skyBox: scene.skyBox?.show,
      sun: scene.sun?.show,
      moon: scene.moon?.show,
      background: Cesium.Color.clone(scene.backgroundColor),
      fog: scene.fog.enabled,
      globeClip: scene.globe.clippingPolygons,
      tileClip: tileset?.clippingPolygons,
    };
  }

  function soloScene() {
    scene.globe.show = false;
    if (tileset) tileset.show = false;
    scene.skyAtmosphere.show = false;
    if (scene.skyBox) scene.skyBox.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    scene.fog.enabled = false;
    scene.backgroundColor = Cesium.Color.fromCssColorString(FIELD);
    clearClipping();
  }

  function restoreScene() {
    if (!saved) return;
    clearClipping();
    scene.globe.show = saved.globe;
    if (tileset && saved.tileset !== null) tileset.show = saved.tileset;
    scene.skyAtmosphere.show = saved.sky;
    scene.skyAtmosphere.brightnessShift = saved.brightness;
    if (scene.skyBox) scene.skyBox.show = saved.skyBox;
    if (scene.sun) scene.sun.show = saved.sun;
    if (scene.moon) scene.moon.show = saved.moon;
    scene.backgroundColor = saved.background;
    scene.fog.enabled = saved.fog;
    saved = null;
  }

  function setClip(radius) {
    if (!clipping) return;
    const positions = circlePositions(site.center, radius);
    for (const target of clipping.targets) {
      target.collection.removeAll();
      target.collection.add(new Cesium.ClippingPolygon({ positions }));
    }
  }

  function clearClipping() {
    if (!clipping) return;
    for (const target of clipping.targets)
      target.owner.clippingPolygons = target.previous;
    clipping = null;
  }

  async function dissolve({ reverse = false } = {}) {
    const reduced = reducedMotion();
    const radii = [...twin.radii.slice(0, 5), 3000];
    const supported = Cesium.ClippingPolygonCollection.isSupported(scene);
    stats.motion.clipSupported = supported;
    stats.motion.reduced = reduced;
    const t0 = performance.now();
    if (reduced) {
      if (reverse) twin.hideAll();
      else {
        twin.showAll();
        soloScene();
      }
      scene.requestRender();
      stats.motion.dissolve = { mode: 'instant', ms: 0 };
      return;
    }
    if (!supported) {
      // Veil cut (M-A3 fallback): fade a field-coloured veil, swap, fade out.
      const veil = document.getElementById('tt-veil');
      veil?.classList.add('on');
      await wait(160);
      if (reverse) {
        twin.hideAll();
        restoreScene();
        saveScene();
      } else {
        twin.showAll();
        soloScene();
      }
      scene.requestRender();
      await wait(40);
      veil?.classList.remove('on');
      stats.motion.dissolve = { mode: 'veil', ms: performance.now() - t0 };
      return;
    }
    const targets = [];
    if (scene.globe.show) targets.push({ owner: scene.globe });
    if (tileset?.show) targets.push({ owner: tileset });
    clipping = {
      targets: targets.map((t) => {
        const collection = new Cesium.ClippingPolygonCollection({
          polygons: [],
        });
        const previous = t.owner.clippingPolygons;
        t.owner.clippingPolygons = collection;
        return { owner: t.owner, collection, previous };
      }),
    };
    const steps = reverse ? [...radii].reverse() : radii;
    const stepMs = 1200 / steps.length;
    let clipCost = 0;
    for (let i = 0; i < steps.length; i++) {
      const r = steps[i];
      const c0 = performance.now();
      setClip(r);
      clipCost = Math.max(clipCost, performance.now() - c0);
      if (reverse) twin.reveal(steps[i + 1] ?? 0);
      else twin.reveal(r);
      scene.skyAtmosphere.brightnessShift =
        saved.brightness +
        (reverse ? 1 - (i + 1) / steps.length : (i + 1) / steps.length) *
          (-1 - saved.brightness);
      scene.requestRender();
      await wait(stepMs);
    }
    stats.motion.dissolve = {
      mode: 'stepped-clip',
      ms: performance.now() - t0,
      maxClipUpdateMs: clipCost,
    };
    if (!reverse) soloScene();
    else {
      twin.hideAll();
      clearClipping();
    }
  }

  /** siteKey: a hotel (city key) or a venue key (twinSites). */
  async function open(siteKey, { osmMode = 'fixture' } = {}) {
    if (state !== 'idle') return;
    abort = new AbortController();
    const { signal } = abort;
    setState('loading', 'Loading OpenStreetMap buildings…');
    const t0 = performance.now();
    try {
      const city = siteConfig(siteKey);
      if (activeSiteKey !== siteKey) swapSiteSession(siteKey);
      activeSiteKey = siteKey;
      stats.site = siteKey;
      const center = city.center;
      const projector = makeProjector(center);
      stats.requests.overpass += osmMode === 'live' ? 1 : 0;
      const [osm, ground] = await Promise.all([
        loadOsm(siteKey, osmMode, signal),
        ((stats.requests.terrain += 1), loadHeightfield(center, signal)),
      ]);
      performance.mark('trip-twin:parse:start');
      const parsed = parseOverpassElements(osm.elements);
      const projected = projectBuildings(parsed.buildings, projector, center);
      const hotel = selectHotelFootprint(
        projected.buildings,
        parsed.hotels,
        { ...center, name: city.label, osm_id: city.osm },
        projector,
      );
      if (hotel.source === 'synthesized') {
        const [x, y] = [0, 0];
        hotel.building.distanceM = Math.hypot(x, y);
      }
      performance.mark('trip-twin:parse:end');
      stats.timings.parseMs = performance.measure(
        'trip-twin:parse',
        'trip-twin:parse:start',
        'trip-twin:parse:end',
      ).duration;
      site = {
        key: siteKey,
        city,
        center,
        projector,
        field: ground.field,
        radius: TWIN_RADIUS_M,
        buildings: projected.buildings,
        totalBuildings: projected.total,
        capped: projected.capped,
        hotel,
        roads: parsed.roads,
        entrances: parsed.entrances,
        osmSource: osm.source,
        osmFetchedAt: osm.fetchedAt,
        terrainSource: ground.source,
      };
      stats.osmSource = osm.source;
      stats.terrainSource = ground.source;
      setState('loading', 'Building the hologram…');
      performance.mark('trip-twin:build:start');
      twin = buildTwinScene(viewer, site);
      Object.assign(stats, twin.stats);
      const compiled = await twin.ready();
      twin.hideAll();
      performance.mark('trip-twin:build:end');
      stats.timings.buildMs = performance.measure(
        'trip-twin:build',
        'trip-twin:build:start',
        'trip-twin:build:end',
      ).duration;
      stats.timings.compiled = compiled;
      signal.throwIfAborted();

      // Entry: fly first, then dissolve with the camera still (05 §3.1).
      setState('entering');
      saveScene();
      const target = new Cesium.BoundingSphere(
        Cesium.Cartesian3.fromDegrees(
          center.lon,
          center.lat,
          twin.hotelBase + twin.levels * twin.floorH * 0.4,
        ),
        60,
      );
      const distance = Cesium.Cartesian3.distance(
        viewer.camera.positionWC,
        target.center,
      );
      const reduced = reducedMotion();
      await new Promise((resolve) => {
        viewer.camera.flyToBoundingSphere(target, {
          offset: new Cesium.HeadingPitchRange(
            0,
            Cesium.Math.toRadians(-40),
            2 * TWIN_RADIUS_M,
          ),
          duration: reduced ? 0 : flightMs(distance) / 1000,
          easingFunction: Cesium.EasingFunction.QUARTIC_IN_OUT,
          complete: resolve,
          cancel: resolve,
        });
      });
      performance.mark('trip-twin:entry:dissolve');
      await dissolve();
      stats.timings.readyMs = performance.now() - t0;
      glow = createSelectionGlow(viewer, twin.primitives, { reducedMotion });
      people = createPeopleLayer(viewer, site, twin);
      people.dataSource.show = !peopleHidden;
      refreshFires();
      safety = createSafetyLayer(viewer, site);
      safety.setSelected(selectedPlaceId);
      loadContext(site);
      streetsLayer = createStreetsLayer(viewer, site);
      streetsLayer.set(streetsState);
      twin.setBaseStreets?.(!streetsState.streets);
      // A site switch keeps the Ways out view (review/phase7 M4).
      applyHotelDim();
      twin.setContextDim?.(hotelStepBack);
      // Labels stay inside the area the panels leave free.
      declutterer = createDeclutter(viewer, {
        bounds: () => {
          const a = safeArea?.();
          if (!a) return null;
          return {
            left: a.left + 4,
            right: scene.canvas.clientWidth - a.right - 4,
          };
        },
      });
      handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
      handler.setInputAction((click) => {
        // The click that closed a popover does nothing else (review/phase5 J7).
        if (swallowClick) {
          swallowClick = false;
          return;
        }
        const picked = scene.pick(click.position);
        const entityId = typeof picked?.id?.id === 'string' ? picked.id.id : '';
        // Phase 4 edit mode: clicks place waypoints / areas, not selections.
        if (pickHandler) {
          pickHandler({ entityId, ground: groundAt(click.position) });
          return;
        }
        const personMatch = /^twin-(?:person|bracket(?:-label)?):([^:]+)/.exec(
          entityId,
        );
        if (personMatch) return selectPerson(personMatch[1]);
        if (entityId && onEntityPick(entityId, picked?.id)) return;
        // The wider area is map detail only: a click keeps the selection.
        if (picked?.primitive && contextLayer?.owns(picked.primitive))
          return onContextClick();
        const rec = picked?.id?.opsRecord;
        if (rec && (rec.kind === 'twin-building' || rec.kind === 'twin-hotel'))
          select(rec.record.id);
        else select(null);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      handler.setInputAction(
        () => frameSelection(),
        Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
      );
      // Phase 4 deferred: drag a waypoint. The camera holds still while a
      // waypoint is held; a press that does not move stays a click.
      handler.setInputAction((down) => {
        if (!dragHandler || swallowClick) return;
        const picked = scene.pick(down.position);
        const entityId = typeof picked?.id?.id === 'string' ? picked.id.id : '';
        if (!dragHandler.start(entityId)) return;
        dragging = true;
        scene.screenSpaceCameraController.enableInputs = false;
        scene.canvas.style.cursor = 'grabbing';
      }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
      // Hover: a pointer over anything that opens a card (phase 9 UX P1-2).
      let hoverAt = 0;
      const CLICKABLE =
        /^(twin-path:|twin-safety:|twin-saved:|twin-avoid:|twin-person:|twin-bracket|twin-site:)/;
      // One MOUSE_MOVE handler: Cesium keeps only the last one per type.
      handler.setInputAction((move) => {
        if (dragging) {
          const g = groundAt(move.endPosition);
          if (g) dragHandler?.move(g);
          return;
        }
        if (pickHandler) return;
        const now = performance.now();
        if (now - hoverAt < 90) return;
        hoverAt = now;
        const picked = scene.pick(move.endPosition);
        const id = typeof picked?.id?.id === 'string' ? picked.id.id : '';
        const rec = picked?.id?.opsRecord;
        scene.canvas.style.cursor = CLICKABLE.test(id) || rec ? 'pointer' : '';
        // Lighten the casing of the path under the pointer (review O7).
        const hk = /^twin-path:(primary|alternate)/.exec(id)?.[1] || null;
        if (hk !== hoverKind) {
          hoverKind = hk;
          (routeLines || disposePaths)?.hover?.(hk);
        }
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      handler.setInputAction((up) => {
        if (!dragging) return;
        dragging = false;
        scene.screenSpaceCameraController.enableInputs = true;
        scene.canvas.style.cursor = pickHandler ? 'crosshair' : '';
        dragHandler?.end(groundAt(up.position));
      }, Cesium.ScreenSpaceEventType.LEFT_UP);
      setState('ready');
      if (snapshot) refresh();
      // The group's hotel is the subject: selected with its glow on arrival.
      select(site.hotel.building.id);
      onReady(site, twin);
    } catch (error) {
      if (signal.aborted) return;
      console.error('[TripTwin] open failed', error);
      setState(
        'degraded',
        `Could not build the hologram: ${error?.message || error}`,
      );
    }
  }

  function select(id) {
    if (!twin || !glow) return;
    if (id !== site?.hotel.building.id) setFloorFocus(null);
    selectedId = id;
    if (selectedPersonId) {
      selectedPersonId = null;
      redrawPeople();
    }
    const geom = id ? twin.geomFor(id) : null;
    if (geom) glow.select(geom, style);
    else glow.clear();
    stats.selected = geom ? { id, style } : null;
    onSelect(geom ? { kind: 'building', geom } : null);
  }

  function selectPerson(personId, { frame = false } = {}) {
    if (!twin) return;
    setFloorFocus(null);
    selectedId = null;
    glow?.clear();
    selectedPersonId = personId;
    redrawPeople();
    const row = assessment?.rows.find((r) => r.person.id === personId);
    stats.selected = row ? { person: personId } : null;
    onSelect(row ? { kind: 'person', row } : null);
    if (frame) frameSelection();
  }

  let floorFocus = null; // hotel floor label in focus (cutaway), operator-set

  function groundLabel() {
    return activePlace()?.ground_floor_label ?? 1;
  }

  /** Floor focus: white slab on that floor; framing stays an operator action. */
  let floorFocusIds = null; // people on the focused floor's lists
  let savedView = null; // camera before floor focus (Esc / back restores it)

  /** info: the floor from floorOccupancy (state, lists) — colours and dims. */
  function setFloorFocus(label, info = null) {
    floorFocus = Number.isFinite(label) ? label : null;
    stats.floorFocus = floorFocus;
    floorFocusIds =
      floorFocus === null || !info
        ? null
        : new Set(
            [
              ...info.likely,
              ...info.possible,
              ...info.lastCovers,
              ...info.floorNotKnown,
            ].map((r) => r.person.id),
          );
    people?.setFloorFocus(
      floorFocus === null ? null : floorFocus - groundLabel(),
      { label: floorFocus, state: info?.state ?? null },
    );
    applyHotelDim();
    redrawPeople();
  }

  function restoreView() {
    if (!savedView) return;
    const v = savedView;
    savedView = null;
    viewer.camera.flyTo({
      destination: v.position,
      orientation: { heading: v.heading, pitch: v.pitch, roll: v.roll },
      duration: reducedMotion() ? 0 : 0.8,
      easingFunction: Cesium.EasingFunction.QUARTIC_IN_OUT,
    });
  }

  /**
   * Fly so the target sits in the middle of the panel-free area, not the
   * middle of the canvas (phase 1 / phase 3 deferred). fit: widen the range
   * so a large target fits the free width. Operator actions only.
   */
  function flySafe(sphere, { heading, pitch, range, fit = false, duration }) {
    const a = safeArea?.();
    const canvas = viewer.scene.canvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    let center = sphere.center;
    let r = range;
    if (a && w && h) {
      const freeW = Math.max(240, w - a.left - a.right);
      const freeH = Math.max(200, h - a.top - a.bottom);
      if (fit) r = range * Math.min(2.4, Math.max(1, w / freeW, h / freeH));
      const fov = viewer.camera.frustum.fov || Math.PI / 3;
      const mpp = (2 * r * Math.tan(fov / 2)) / Math.max(w, h);
      const dx = ((a.left - a.right) / 2) * mpp;
      const dy = ((a.top - a.bottom) / 2) * mpp;
      const sh = Math.sin(heading);
      const ch = Math.cos(heading);
      const sp = Math.sin(pitch);
      const cp = Math.cos(pitch);
      // Camera right and up in east-north-up at the target.
      const right = new Cesium.Cartesian3(ch, -sh, 0);
      const up = new Cesium.Cartesian3(-sh * sp, -ch * sp, cp);
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
      const shift = Cesium.Cartesian3.add(
        Cesium.Cartesian3.multiplyByScalar(right, -dx, new Cesium.Cartesian3()),
        Cesium.Cartesian3.multiplyByScalar(up, dy, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      );
      center = Cesium.Cartesian3.add(
        center,
        Cesium.Matrix4.multiplyByPointAsVector(
          enu,
          shift,
          new Cesium.Cartesian3(),
        ),
        new Cesium.Cartesian3(),
      );
    }
    const d = Cesium.Cartesian3.distance(viewer.camera.positionWC, center);
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(center, sphere.radius),
      {
        offset: new Cesium.HeadingPitchRange(heading, pitch, r),
        duration:
          duration ?? (reducedMotion() ? 0 : flightMs(Math.abs(d - r)) / 1000),
        easingFunction: Cesium.EasingFunction.QUARTIC_IN_OUT,
      },
    );
  }

  /** Camera on one hotel floor, slightly above it, looking across the slab. */
  function frameFloor(label) {
    if (!twin || !people || !Number.isFinite(label)) return;
    const cam = viewer.camera;
    savedView ||= {
      position: cam.positionWC.clone(),
      heading: cam.heading,
      pitch: cam.pitch,
      roll: cam.roll,
    };
    const ring = site.hotel.building.rings[0];
    const { z0, z1 } = people.floorZ(label - groundLabel());
    const pts = ring.map((p) =>
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat, (z0 + z1) / 2),
    );
    const sphere = Cesium.BoundingSphere.fromPoints(pts);
    flySafe(sphere, {
      heading: viewer.camera.heading,
      pitch: Cesium.Math.toRadians(-8),
      range: Math.max(180, sphere.radius * 4.4),
    });
  }

  /** What the compass orbits: the selection, else the site centre (ground). */
  function orbitTarget() {
    if (!twin) return null;
    if (selectedPersonId) {
      const c = assessment?.rows.find((r) => r.person.id === selectedPersonId)
        ?.person.coordinates;
      if (c) {
        const [x, y] = site.projector.toXY(c.lat, c.lng);
        return Cesium.Cartesian3.fromDegrees(c.lng, c.lat, site.field.at(x, y));
      }
    }
    if (selectedId) {
      const geom = twin.geomFor(selectedId);
      if (geom) {
        const pts = geom.building.rings[0].map((p) =>
          Cesium.Cartesian3.fromDegrees(p.lon, p.lat, geom.base),
        );
        const c = Cesium.BoundingSphere.fromPoints(pts).center;
        if (floorFocus === null) return c;
        // Floor focus: orbit around that floor, not the roof.
        const carto = Cesium.Cartographic.fromCartesian(c);
        const { z0, z1 } = people.floorZ(floorFocus - groundLabel());
        return Cesium.Cartesian3.fromRadians(
          carto.longitude,
          carto.latitude,
          (z0 + z1) / 2,
        );
      }
    }
    return Cesium.Cartesian3.fromDegrees(
      site.center.lon,
      site.center.lat,
      site.field.at(0, 0),
    );
  }

  /**
   * Compass (phase 3 Part D): stand on one side and look across the target.
   * headingDeg is the camera's look direction (view from north = look south
   * = 180°). Pitch and distance are kept.
   */
  function viewFromSide(headingDeg) {
    const target = orbitTarget();
    if (!target) return;
    const cam = viewer.camera;
    const range = Math.max(
      60,
      Cesium.Cartesian3.distance(cam.positionWC, target),
    );
    const pitch = Math.min(-0.12, cam.pitch);
    cam.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), {
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(headingDeg),
        pitch,
        range,
      ),
      duration: reducedMotion() ? 0 : 0.9,
      easingFunction: Cesium.EasingFunction.QUARTIC_IN_OUT,
    });
  }

  /** F / Z / double-click: frame the selection (3D-tool convention). */
  function frameSelection() {
    if (!twin) return;
    if (selectedId && floorFocus !== null) return frameFloor(floorFocus);
    let sphere = null;
    let range = 0;
    if (selectedPersonId) {
      const row = assessment?.rows.find(
        (r) => r.person.id === selectedPersonId,
      );
      const c = row?.person.coordinates;
      if (!c) return;
      const [x, y] = site.projector.toXY(c.lat, c.lng);
      sphere = new Cesium.BoundingSphere(
        Cesium.Cartesian3.fromDegrees(c.lng, c.lat, site.field.at(x, y) + 2),
        10,
      );
      range = Math.max(120, (row.person.accuracy_m || 20) * 5);
    } else if (selectedId) {
      const geom = twin.geomFor(selectedId);
      if (!geom) return;
      const ring = geom.building.rings[0];
      const pts = ring.map((p) =>
        Cesium.Cartesian3.fromDegrees(
          p.lon,
          p.lat,
          geom.base + geom.building.heightM / 2,
        ),
      );
      sphere = Cesium.BoundingSphere.fromPoints(pts);
      sphere.radius = Math.max(sphere.radius, geom.building.heightM / 2);
      range = Math.max(150, sphere.radius * 3.2);
    } else return;
    flySafe(sphere, {
      heading: viewer.camera.heading,
      pitch: Cesium.Math.toRadians(-30),
      range,
    });
  }

  /** The trip place for the site on screen (phase 3: hotel or a venue). */
  function activePlace() {
    const places = snapshot?.places || [];
    return (
      places.find((p) => p.site_key === activeSiteKey) || places[0] || null
    );
  }

  function reportedLabel() {
    if (sessionReported !== undefined) return sessionReported;
    const rep = snapshot?.reported_incidents?.find(
      (r) => r.place_id === activePlace()?.id,
    );
    return Number.isFinite(rep?.floor_label) ? rep.floor_label : null;
  }

  function floorsVisible() {
    return floorsOn === null ? Number.isFinite(reportedLabel()) : floorsOn;
  }

  function redrawPeople() {
    if (!people || !assessment) return;
    const place = activePlace() || {};
    peopleInfo = people.update(assessment, {
      floorsOn: floorsVisible(),
      reportedLabel: reportedLabel(),
      selectedId: selectedPersonId,
      // Viewing another weather time dims everyone: positions are now.
      focusIds: peopleDim ? new Set() : floorFocusIds,
      covers: contextLayer ? (pt) => contextLayer.covers(pt) : null,
      numbering:
        place.levels_above_ground != null || place.levels_source === 'operator',
      groundLabel: place.ground_floor_label ?? 1,
    });
  }

  function refresh() {
    if (!snapshot || !site) return;
    const delayed = (Date.now() - receivedAt) / 1000 > 45;
    assessment = assessSnapshot(
      snapshot,
      { xy: site.hotel.building.xy[0], approximate: site.hotel.approximate },
      site.projector,
      {
        elapsed,
        delayed,
        reportedLabel: reportedLabel(),
        placeId: activePlace()?.id,
      },
    );
    stats.roster = assessment.rosterText;
    stats.partition = assessment.partitionText;
    stats.zone = assessment.zone.text;
    if (state === 'ready') {
      redrawPeople();
      chips =
        safety?.update(
          // This site's places only (venues carry their own).
          (snapshot.safety_points || []).filter(
            (p) => !p.location_id || p.location_id === activePlace()?.id,
          ),
          {
            show: safetyVisible,
            covers: contextLayer ? (pt) => contextLayer.covers(pt) : null,
          },
        ) || [];
      if (!paths && !pathsPlanning) planOnce();
      // Only detections outside any mapped fire boundary get a chip.
      const fsum = fireSummary(site.center, heatSplit().outside);
      if (fsum.nearest && fsum.nearest.d > site.radius + 100)
        chips = [
          ...chips,
          {
            label: `${simulatedFires || fsum.nearest.simulated ? 'SIMULATED ' : ''}Heat detection`,
            distance: formatDistance(fsum.nearest.d),
            bearing: bearingLabel(site.center, fsum.nearest),
            // Amber, like a fire boundary: red on the map means a report
            // (hazards Q1, Jesse 27 Oct).
            wx: 'attention',
          },
        ];
      if (peopleInfo?.beyond)
        chips = [
          {
            label: contextLayer
              ? `${peopleInfo.beyond} beyond the wider area`
              : `${peopleInfo.beyond} outside the mapped area`,
            people: true,
          },
          ...chips,
        ];
    }
    onAssess(assessment, {
      reportedLabel: reportedLabel(),
      floorsOn: floorsVisible(),
      delayed,
      snapshot,
      chips,
      paths: pathsVisible && paths?.paths ? paths.paths : [],
      pathsLoading: pathsPlanning,
      pathNote: paths?.note || null,
      fires: (() => {
        const split = heatSplit();
        return {
          status: fires.status,
          fetchedAt: fires.fetchedAt || null,
          summary: (() => {
            const sum = fireSummary(site.center, split.outside);
            // Beside mapped fire boundaries, a leftover detection is said
            // to be outside them: it may be a new fire (round 2 UX).
            if (fireRows.length && sum.count)
              sum.text += ' · outside any mapped fire boundary';
            return sum;
          })(),
          simulated: simulatedFires,
          visible: firesVisible,
          byFire: split.byFire,
          claimed: allHeat().length - split.outside.length,
        };
      })(),
      pathsVisible,
      safetyVisible,
      night: isNight(),
      operatorReport:
        sessionReported !== undefined && sessionReported !== null
          ? { label: sessionReported, kind: sessionKind, at: sessionAt }
          : null,
      dismissed,
    });
    if (selectedPersonId) {
      const row = assessment.rows.find((r) => r.person.id === selectedPersonId);
      if (row) onSelect({ kind: 'person', row });
    }
  }

  const isNight = () => {
    const h = Number(snapshot?.scenario?.clock?.slice(0, 2));
    return Number.isFinite(h) ? h < 6 || h >= 19 : false;
  };

  function hazardPoints() {
    const now = Date.now();
    // Every detection, claimed or not: a path near heat is flagged even
    // inside a mapped fire (hazards X1); fire boundaries flag paths too.
    return allHeat()
      .filter((r) => now - r.acqMs <= 24 * 3600000)
      .map((r) => ({ lat: r.lat, lon: r.lon }));
  }

  function redrawPaths() {
    disposePaths?.();
    disposePaths = null;
    if (routeSet) {
      // The shown set's heat proximity follows the detections too (O4).
      const hz = hazardPoints();
      for (const p of routeSet.paths)
        p.hazard = hazardProximity(p.geometry, hz);
      if (!editingPath) drawRoute();
      return notifyDrawn();
    }
    if (editingPath) return; // the copy being edited has the stage
    if (!paths?.paths?.length || !pathsVisible || state !== 'ready')
      return notifyDrawn();
    const hz = hazardPoints();
    for (const p of paths.paths) p.hazard = hazardProximity(p.geometry, hz);
    disposePaths = drawPaths(viewer, site, paths.paths, {
      selected: selectedPathKind,
      faded: suggestionFaded,
    });
    notifyDrawn();
  }

  /** Draw (or redraw) the shown path set; steps back while editing. */
  function drawRoute() {
    disposeRoute?.();
    disposeRoute = null;
    routeLines = null;
    routeGeometry = null;
    if (!routeSet || state !== 'ready') return;
    const { paths: list, fromLabel, toLabel, startText } = routeSet;
    routeGeometry = list.flatMap((p) => p.geometry);
    stats.route = list.map((p) => ({
      kind: p.kind,
      profile: p.profile,
      distanceM: p.distanceM,
    }));
    // The standing rally path steps back while this one is shown.
    disposePaths?.();
    disposePaths = null;
    if (editingPath) return; // the copy being edited has the stage (O13)
    const disposeLines = drawPaths(viewer, site, list, {
      selected: selectedPathKind,
      faded: suggestionFaded,
    });
    routeLines = disposeLines;
    const ends = new Cesium.CustomDataSource('trip-twin-route-ends');
    const added = viewer.dataSources.add(ends);
    const g = list[0].geometry;
    const base = site.field.at(0, 0);
    for (const [pt, text] of [
      [
        g[0],
        startText
          ? new Cesium.CallbackProperty(() => `Start · ${startText()}`, false)
          : `Start · ${fromLabel}`,
      ],
      [g[g.length - 1], `End · ${toLabel}`],
    ])
      ends.entities.add({
        position: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, base + 6),
        point: {
          pixelSize: 8,
          color: Cesium.Color.fromCssColorString('#3b82f6'),
          outlineColor: Cesium.Color.fromCssColorString('#eef5f3'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text,
          font: '500 11px Inter, sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#93bafa'),
          showBackground: true,
          backgroundColor:
            Cesium.Color.fromCssColorString('#040c12').withAlpha(0.88),
          pixelOffset: new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    disposeRoute = () => {
      disposeLines();
      added.then(() => {
        if (!viewer.isDestroyed()) viewer.dataSources.remove(ends, true);
      });
    };
    viewer.scene.requestRender();
  }

  /** The suggested paths on the map: the shown route, else the rally path. */
  function drawnInfo() {
    if (routeSet)
      return { source: 'route', ...routeSet, faded: suggestionFaded };
    if (paths?.paths?.length && pathsVisible && state === 'ready')
      return {
        source: 'rally',
        id: paths.id,
        paths: paths.paths,
        fromLabel:
          activePlace()?.name || site?.hotel?.building?.name || 'the site',
        toLabel: 'Rally point (primary)',
        // The fixture's name repeats "Rally point (primary) · …": keep the place.
        toName:
          paths.destName?.replace(/^Rally point \(primary\)( · )?/, '') || null,
        ends: paths.ends,
        plannedAt: paths.plannedAt,
        fromPerson: false,
        faded: suggestionFaded,
      };
    return null;
  }
  function notifyDrawn() {
    const id = drawnInfo()?.id ?? null;
    if (id === lastDrawnId) return;
    lastDrawnId = id;
    onDrawnPaths(id);
  }

  async function planOnce() {
    pathsPlanning = true;
    const signal = abort?.signal;
    try {
      const place = activePlace();
      const hotel = { lat: place.coordinates.lat, lon: place.coordinates.lng };
      // This site's own rally points (venues have their own).
      const points = (snapshot.safety_points || []).filter(
        (p) => !p.location_id || p.location_id === place.id,
      );
      paths = await planPaths(hotel, points, {
        signal,
        hazards: hazardPoints(),
      });
      // Identity and true ends for the path card (review/phase9 O1, O5).
      const dest = paths.paths?.find((p) => p.dest)?.dest;
      paths.id = ++setSeq;
      paths.plannedAt = Date.now();
      paths.ends = dest
        ? {
            from: hotel,
            to: { lat: dest.coordinates.lat, lon: dest.coordinates.lng },
          }
        : null;
      paths.destName = dest?.name || null;
      stats.paths = paths.paths?.map((p) => ({
        kind: p.kind,
        distanceM: Math.round(p.distanceM),
      }));
    } catch (error) {
      if (signal?.aborted) return;
      paths = {
        paths: [],
        note: `Suggested walking paths unavailable (${error?.message || error})`,
      };
    } finally {
      pathsPlanning = false;
    }
    redrawPaths();
    refresh();
  }

  async function refreshFires() {
    const signal = abort?.signal;
    fires = await loadFires(site.center, {
      simulated: simulatedFires,
      signal,
    }).catch(() => ({
      status: 'unavailable',
      records: [],
    }));
    if (signal?.aborted || state !== 'ready') return;
    stats.fires = { status: fires.status, count: fires.records.length };
    redrawFires();
    redrawPaths();
    refresh();
  }

  function redrawFires() {
    disposeFires?.();
    disposeFires =
      firesVisible && state === 'ready'
        ? drawFires(viewer, site, allHeat(), Date.now(), {
            owned: fireRows.length
              ? (() => {
                  const outside = new Set(heatSplit().outside);
                  return new Set(allHeat().filter((r) => !outside.has(r)));
                })()
              : null,
          })
        : null;
  }

  function teardownSelection() {
    handler?.destroy();
    handler = null;
    glow = null; // primitives are owned by the twin collection
    people?.dispose();
    people = null;
    disposeRoute?.();
    disposeRoute = null;
    floorFocus = null;
    floorFocusIds = null;
    savedView = null;
    stats.floorFocus = null;
    safety?.dispose();
    streetsLayer?.dispose();
    streetsLayer = null;
    contextLayer?.dispose();
    contextLayer = null;
    declutterer?.dispose();
    declutterer = null;
    disposePaths?.();
    disposePaths = null;
    paths = null;
    pathsPlanning = false;
    routeSet = null;
    routeLines = null;
    selectedPathKind = null;
    notifyDrawn();
    disposeFires?.();
    disposeFires = null;
    safety = null;
    selectedId = null;
    selectedPersonId = null;
  }

  async function close() {
    if (state !== 'ready' && state !== 'degraded') return;
    setState('closing');
    abort?.abort();
    glow?.clear();
    if (twin && state !== 'degraded') {
      // Exit runs the reveal backwards, then restores the scene (05 §3.5).
      const reduced = reducedMotion();
      if (!reduced && Cesium.ClippingPolygonCollection.isSupported(scene)) {
        scene.globe.show = saved?.globe ?? true;
        if (tileset && saved) tileset.show = saved.tileset;
        scene.skyAtmosphere.show = saved?.sky ?? true;
        await dissolve({ reverse: true });
      }
    }
    teardownSelection();
    twin?.dispose();
    twin = null;
    restoreScene();
    scene.requestRender();
    setState('idle');
  }

  function dispose() {
    abort?.abort();
    teardownSelection();
    twin?.dispose();
    twin = null;
    restoreScene();
    state = 'idle';
  }

  return {
    open,
    close,
    dispose,
    get siteKey() {
      return activeSiteKey;
    },
    activePlace,
    /** Fly out, rebuild the hologram for another site, fly in. */
    async switchSite(key, opts = {}) {
      if (key === activeSiteKey && state === 'ready') return;
      if (state === 'ready' || state === 'degraded') await close();
      paths = null;
      await open(key, opts);
    },
    get state() {
      return state;
    },
    get site() {
      return site;
    },
    get scene() {
      return twin;
    },
    select,
    selectPerson,
    frameSelection,
    /** Feed a snapshot (harness stands in for H-2's setSnapshot). */
    setSnapshot(next) {
      snapshot = next;
      receivedAt = Date.now();
      elapsed = 0;
      refresh();
    },
    /** Age tick (H-2's aging timer): seconds since the snapshot arrived. */
    age() {
      elapsed = (Date.now() - receivedAt) / 1000;
      refresh();
    },
    setFloors(on) {
      floorsOn = on;
      refresh();
    },
    setSimulatedFires(on) {
      simulatedFires = on;
      if (state === 'ready') refreshFires();
    },
    setPathsVisible(on) {
      pathsVisible = on;
      redrawPaths();
      refresh();
    },
    /** Operator-entered floor (session only). null clears it. */
    /** at: when it was reported (a remote's report keeps its own time). */
    reportFloor(label, kind = 'other', at = Date.now()) {
      sessionReported = label;
      sessionKind = label === null ? null : kind;
      sessionAt = label === null ? null : at;
      if (label !== null) dismissed = null;
      refresh();
    },
    /** Dismiss the current report (snapshot or operator), with a reason; Undo restores it. */
    dismissReport(reason) {
      const fromSnapshot = sessionReported === undefined;
      dismissed = fromSnapshot
        ? {
            reason,
            at: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
          }
        : null;
      sessionReported = null;
      sessionKind = null;
      refresh();
    },
    undoDismiss() {
      dismissed = null;
      sessionReported = undefined;
      refresh();
    },
    setLayer(name, on) {
      if (name === 'floors') floorsOn = on;
      else if (name === 'paths') {
        pathsVisible = on;
        redrawPaths();
      } else if (name === 'fires') {
        firesVisible = on;
        redrawFires();
      } else if (name === 'safety') safetyVisible = on;
      else if (name === 'buildings') twin?.setContextVisible(on);
      refresh();
    },
    get layers() {
      return {
        floors: floorsVisible(),
        paths: pathsVisible,
        fires: firesVisible,
        safety: safetyVisible,
        buildings: twin?.contextVisible ?? true,
      };
    },
    get assessment() {
      return assessment;
    },
    setGround(next) {
      return twin ? twin.setGround(next) : null;
    },
    setFloorFocus,
    frameFloor,
    hazardPoints,
    /** Fire boundary rows (hazards H5): they claim the heat inside them. */
    setFireBoundaries(rows) {
      fireRows = Array.isArray(rows) ? rows : [];
      if (state === 'ready') redrawFires();
    },
    /** The demo fire's SIMULATED heat detections, drawn with the real ones. */
    setExtraHeat(records) {
      extraHeat = Array.isArray(records) ? records : [];
      if (state === 'ready') redrawFires();
    },
    fireBounds: () => fireRows,
    /** Phase 6: travelers dimmed while the weather shows another time. */
    setPeopleDim(on) {
      if (peopleDim === Boolean(on)) return;
      peopleDim = Boolean(on);
      redrawPeople();
      viewer.scene.requestRender();
    },
    /** Advance mode (Part B): no traveler positions drawn. */
    setPeopleVisible(on) {
      peopleHidden = !on;
      if (people) people.dataSource.show = on;
      viewer.scene.requestRender();
    },
    /** Phase 3 Part C: one on-demand route set at a time. */
    /**
     * One on-demand path set at a time, ends labelled (review/phase3 G11).
     * meta (phase 9): {ends, fix, fromPerson, plannedAt, startText()} — the
     * start label re-reads startText() each frame so a position's age is
     * live (review/phase9 O2).
     */
    showRoute(paths, { fromLabel = '', toLabel = '', ...meta } = {}) {
      if (!paths?.length || state !== 'ready') {
        this.clearRoute();
        return;
      }
      routeSet = {
        id: ++setSeq,
        paths,
        fromLabel,
        toLabel,
        plannedAt: Date.now(),
        fromPerson: Boolean(meta.fromPerson),
        ends: meta.ends || null,
        fix: meta.fix || null,
        personId: meta.personId || null,
        startText: meta.startText || null,
      };
      drawRoute();
      notifyDrawn();
    },
    clearRoute() {
      const had = Boolean(routeSet);
      routeSet = null;
      selectedPathKind = null;
      disposeRoute?.();
      disposeRoute = null;
      routeLines = null;
      routeGeometry = null;
      stats.route = null;
      if (had) redrawPaths();
      notifyDrawn();
    },
    /** The suggested paths on the map: the shown route, else the rally path. */
    get drawnPaths() {
      return drawnInfo();
    },
    /** Fade the drawn suggestion when a saved path covers its ends. */
    setSuggestionFaded(on) {
      if (suggestionFaded === Boolean(on)) return;
      suggestionFaded = Boolean(on);
      if (routeSet) drawRoute();
      else redrawPaths();
    },
    /** Highlight one drawn suggested path ('primary' | 'alternate' | null). */
    setPathSelected(kind) {
      if (selectedPathKind === kind) return;
      selectedPathKind = kind;
      if (routeSet) drawRoute();
      else redrawPaths();
    },
    /** Operator action: fit the whole path in view. */
    frameRoute() {
      this.frameGeometry(routeGeometry);
    },
    /** Operator action: fit any list of {lat, lon} in view. */
    frameGeometry(geometry) {
      if (!geometry?.length) return;
      const sphere = Cesium.BoundingSphere.fromPoints(
        geometry.map((p) =>
          Cesium.Cartesian3.fromDegrees(p.lon, p.lat, site.field.at(0, 0)),
        ),
      );
      flySafe(sphere, {
        heading: viewer.camera.heading,
        pitch: Cesium.Math.toRadians(-55),
        range: Math.max(200, sphere.radius * 3.2),
        fit: true,
        duration: reducedMotion() ? 0 : 1.2,
      });
    },
    get hasRoute() {
      return Boolean(routeSet);
    },
    restoreView,
    viewFromSide,
    /** Phase 4: route map clicks to the path editor (null restores). */
    /** The wider area (phase 8): {ring, corridors}. */
    setContext(next) {
      contextState = { ...contextState, ...next };
      contextLayer?.set(contextState);
    },
    get context() {
      return { ...contextState, ...contextInfo };
    },
    /** The wider area steps back (Ways out, incident); keep a strip kind. */
    setContextDim(on, { keep = null } = {}) {
      contextDim = { on: Boolean(on), keep };
      contextLayer?.setDim(contextDim.on, { keep });
    },
    /** Streets and walkways (phase 7): {streets, walkways}. */
    setStreets(next) {
      streetsState = { ...streetsState, ...next };
      streetsLayer?.set(streetsState);
      twin?.setBaseStreets?.(!streetsState.streets);
    },
    /** Ways out: the hotel's glass steps back so streets behind it read. */
    setHotelStepBack(on) {
      hotelStepBack = Boolean(on);
      applyHotelDim();
      twin?.setContextDim?.(hotelStepBack);
      viewer.scene.requestRender();
    },
    get streets() {
      return {
        ...streetsState,
        counts: streetsLayer?.counts || null,
        doors: streetsLayer?.doors || [],
      };
    },
    /** The place whose card is open glows on the map (phase 5b). */
    setSelectedPlace(id) {
      selectedPlaceId = id || null;
      safety?.setSelected(selectedPlaceId);
    },
    /** Fly into the panel-free area (operator actions only, phase 12). */
    flySafe(sphere, opts) {
      flySafe(sphere, opts);
    },
    /** Panel insets for framing (phase 5b): () => {left, right, top, bottom}. */
    setSafeArea(fn) {
      safeArea = fn || null;
    },
    /** The next map click only closed a popover (review/phase5 J7). */
    swallowNextClick(on) {
      swallowClick = Boolean(on);
    },
    /** Phase 4 deferred: {start(entityId) → bool, move(ground), end(ground)}. */
    setDragHandler(h) {
      dragHandler = h || null;
      if (!h && dragging) {
        dragging = false;
        scene.screenSpaceCameraController.enableInputs = true;
      }
    },
    setPickHandler(fn) {
      pickHandler = fn || null;
      scene.canvas.style.cursor = fn ? 'crosshair' : '';
      // Other paths step back while one is being edited (review/phase4 H12).
      const was = editingPath;
      editingPath = Boolean(fn);
      if (was === editingPath) return;
      // Every drawn suggestion steps back while a copy is edited; the editor
      // draws the original as a dashed ghost (review/phase9 O13).
      if (routeSet) drawRoute();
      else if (editingPath) {
        disposePaths?.();
        disposePaths = null;
      } else redrawPaths();
    },
    /** Camera look direction in degrees (0 = looking north). */
    get headingDeg() {
      return Cesium.Math.toDegrees(viewer.camera.heading);
    },
    refresh() {
      refresh();
    },
    /** The person selected on this screen, or null (screens S2 plan). */
    get selectedPersonId() {
      return selectedPersonId;
    },
    get floorFocus() {
      return floorFocus;
    },
    setGlowStyle(next) {
      style = next;
      if (selectedId) select(selectedId);
    },
  };
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
