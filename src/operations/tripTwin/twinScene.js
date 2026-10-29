// Trip Twin hologram: every Cesium primitive the twin owns, built from OSM
// data on one heightfield. Nothing clamps to Google tiles or the globe
// (03 ADR-003). Colors are SafeTrekr brand tokens (04 §5.1–5.2).
import * as Cesium from 'cesium';
import { AIRSIDE_DETAIL_M, clipToDisc, haversineM } from './twinData.js';

const css = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);

export const TWIN_PALETTE = Object.freeze({
  field: '#040c12',
  glass: ['#415e6b', 0.12],
  glassApprox: ['#415e6b', 0.06],
  rim: ['#80959b', 0.3],
  edge: ['#80959b', 0.4],
  edgeApprox: ['#80959b', 0.25],
  subjectGlass: ['#b8c3c7', 0.14],
  subjectRim: ['#b8c3c7', 0.2],
  subjectEdge: '#eef5f3',
  floorLine: ['#b8c3c7', 0.22],
  gridMinor: ['#415e6b', 0.55],
  gridMajor: ['#365462', 0.9],
  street: ['#415e6b', 0.9],
  // Airside (airport sites only): quieter than the buildings. Runways are
  // wide pale bands, taxiways thin lines, aprons faint areas.
  runway: ['#b8c3c7', 0.24],
  runwayEdge: ['#b8c3c7', 0.45],
  taxiway: ['#80959b', 0.38],
  apron: ['#415e6b', 0.1],
  apronEdge: ['#80959b', 0.2],
});

const GLASS_SOURCE = `
uniform vec4 glassColor;
uniform vec4 rimColor;
uniform float rimPower;
uniform float fade;
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  vec3 n = normalize(materialInput.normalEC);
  vec3 v = normalize(materialInput.positionToEyeEC);
  float f = pow(1.0 - abs(dot(n, v)), rimPower);
  m.diffuse = vec3(0.0);
  m.specular = 0.0;
  m.emission = mix(glassColor.rgb, rimColor.rgb, f);
  m.alpha = clamp(glassColor.a + rimColor.a * f, 0.0, 1.0) * fade;
  return m;
}`;

function glassMaterial([glassHex, glassA], [rimHex, rimA]) {
  return new Cesium.Material({
    fabric: {
      type: `TwinGlass${Math.random().toString(36).slice(2, 8)}`,
      uniforms: {
        glassColor: css(glassHex, glassA),
        rimColor: css(rimHex, rimA),
        rimPower: 2.5,
        fade: 1,
      },
      source: GLASS_SOURCE,
    },
    translucent: true,
  });
}

/** Reveal bands for the stepped dissolve (05 §3.1 fallback, M-A1). */
export function revealRadii(radius) {
  return [radius / 8, radius / 4, radius / 2, radius, radius + 100, Infinity];
}

const toCart = (p, h) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, h);

function baseHeight(rings0, projector, field) {
  let min = Infinity;
  for (const p of rings0) {
    const [x, y] = projector.toXY(p.lat, p.lon);
    min = Math.min(min, field.at(x, y));
  }
  return Number.isFinite(min) ? min : field.base;
}

/** Densify a lat/lon polyline so it can follow the heightfield. */
export function drape(coords, projector, field, lift, stepM = 15) {
  const out = [];
  for (let i = 0; i < coords.length; i++) {
    const a = coords[i];
    out.push(a);
    const b = coords[i + 1];
    if (!b) break;
    const n = Math.floor(haversineM(a, b) / stepM);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
      });
    }
  }
  return out.map((p) => {
    const [x, y] = projector.toXY(p.lat, p.lon);
    return toCart(p, field.at(x, y) + lift);
  });
}

/**
 * Build the hologram. site = {center, projector, field, buildings, hotel,
 * roads, radius}. Returns a handle with show/reveal controls and dispose().
 */
export function buildTwinScene(viewer, site) {
  const { center, projector, field, radius } = site;
  const primitives = new Cesium.PrimitiveCollection();
  viewer.scene.primitives.add(primitives);
  const radii = revealRadii(radius);
  const bands = radii.map(() => ({ glass: [], approxGlass: [], edges: [] }));
  const materials = [];
  let triangles = 0;

  const hotelId = site.hotel.building.id;
  const geomById = new Map();
  for (const b of site.buildings) {
    if (b.id === hotelId) continue;
    const band = bands[radii.findIndex((r) => b.distanceM <= r)];
    const base = baseHeight(b.rings[0], projector, field);
    geomById.set(b.id, { building: b, base });
    const geometryArgs = {
      polygonHierarchy: new Cesium.PolygonHierarchy(
        b.rings[0].map((p) => toCart(p, base)),
      ),
      height: base + (b.minHeightM || 0),
      extrudedHeight: base + b.heightM,
    };
    const id = {
      opsRecord: {
        kind: 'twin-building',
        record: { id: b.id, name: b.name, source: b.source },
      },
    };
    (b.approximate ? band.approxGlass : band.glass).push(
      new Cesium.GeometryInstance({
        id,
        geometry: new Cesium.PolygonGeometry({
          ...geometryArgs,
          vertexFormat:
            Cesium.MaterialAppearance.MaterialSupport.BASIC.vertexFormat,
        }),
      }),
    );
    band.edges.push(
      new Cesium.GeometryInstance({
        id,
        geometry: new Cesium.PolygonOutlineGeometry(geometryArgs),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            css(
              ...(b.approximate ? TWIN_PALETTE.edgeApprox : TWIN_PALETTE.edge),
            ),
          ),
        },
      }),
    );
    triangles += b.rings[0].length * 4;
  }

  const contextMaterials = []; // surrounding buildings (Ways out fades them)
  const bandPrimitives = bands.map((band) => {
    const group = new Cesium.PrimitiveCollection();
    primitives.add(group);
    for (const [list, tokens] of [
      [band.glass, [TWIN_PALETTE.glass, TWIN_PALETTE.rim]],
      [band.approxGlass, [TWIN_PALETTE.glassApprox, ['#80959b', 0.12]]],
    ]) {
      if (!list.length) continue;
      const material = glassMaterial(...tokens);
      materials.push(material);
      contextMaterials.push(material);
      group.add(
        new Cesium.Primitive({
          geometryInstances: list,
          appearance: new Cesium.MaterialAppearance({
            material,
            materialSupport: Cesium.MaterialAppearance.MaterialSupport.BASIC,
            translucent: true,
            faceForward: true,
            closed: false,
          }),
          asynchronous: true,
        }),
      );
    }
    if (band.edges.length)
      group.add(
        new Cesium.Primitive({
          geometryInstances: band.edges,
          appearance: new Cesium.PerInstanceColorAppearance({
            flat: true,
            translucent: true,
          }),
          asynchronous: true,
        }),
      );
    return group;
  });

  // --- hotel (the subject): neutral slate, never green (X-01) ---
  const hotel = site.hotel.building;
  const hotelBase = baseHeight(hotel.rings[0], projector, field);
  const hotelTop = hotelBase + hotel.heightM;
  geomById.set(hotel.id, { building: hotel, base: hotelBase, isHotel: true });
  const hotelGroup = new Cesium.PrimitiveCollection();
  primitives.add(hotelGroup);
  const hotelMaterial = glassMaterial(
    TWIN_PALETTE.subjectGlass,
    TWIN_PALETTE.subjectRim,
  );
  materials.push(hotelMaterial);
  hotelGroup.add(
    new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        id: {
          opsRecord: {
            kind: 'twin-hotel',
            record: { id: hotel.id, name: hotel.name },
          },
        },
        geometry: new Cesium.PolygonGeometry({
          polygonHierarchy: new Cesium.PolygonHierarchy(
            hotel.rings[0].map((p) => toCart(p, hotelBase)),
          ),
          height: hotelBase,
          extrudedHeight: hotelTop,
          vertexFormat:
            Cesium.MaterialAppearance.MaterialSupport.BASIC.vertexFormat,
        }),
      }),
      appearance: new Cesium.MaterialAppearance({
        material: hotelMaterial,
        materialSupport: Cesium.MaterialAppearance.MaterialSupport.BASIC,
        translucent: true,
        faceForward: true,
        closed: false,
      }),
      asynchronous: true,
    }),
  );
  const hotelLines = new Cesium.PolylineCollection();
  hotelGroup.add(hotelLines);
  const ring = hotel.rings[0];
  // One material per polyline: PolylineCollection destroys each line's material.
  const approxHotel = site.hotel.approximate || hotel.approximate;
  const dash = () =>
    approxHotel
      ? Cesium.Material.fromType('PolylineDash', {
          color: css(TWIN_PALETTE.subjectEdge, 0.9),
          dashLength: 20,
        })
      : Cesium.Material.fromType('PolylineGlow', {
          color: css(TWIN_PALETTE.subjectEdge, 0.95),
          glowPower: 0.18,
          taperPower: 1,
        });
  for (const h of [hotelBase + 0.2, hotelTop])
    hotelLines.add({
      positions: ring.map((p) => toCart(p, h)),
      width: 5,
      material: dash(),
    });
  // Verticals only at real corners (skip near-collinear vertices).
  for (let i = 0; i < ring.length - 1; i++) {
    const prev = ring[(i - 1 + ring.length - 1) % (ring.length - 1)];
    const cur = ring[i];
    const next = ring[i + 1];
    const a1 = Math.atan2(cur.lat - prev.lat, cur.lon - prev.lon);
    const a2 = Math.atan2(next.lat - cur.lat, next.lon - cur.lon);
    const turn = Math.abs(((a2 - a1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (turn < 0.35) continue;
    hotelLines.add({
      positions: [toCart(cur, hotelBase), toCart(cur, hotelTop)],
      width: 4,
      material: dash(),
    });
  }
  // Approximate floor heights (04 §5.5): a taller lobby, then equal floors.
  // Same model as floorEstimate (lobby 4.5 m), so bands line up with lines.
  const LOBBY_H = 4.5;
  const levels = hotel.levels || Math.max(2, Math.round(hotel.heightM / 3.3));
  const floorH = Math.max(
    2.4,
    (hotel.heightM - LOBBY_H) / Math.max(1, levels - 1),
  );
  for (let l = 1; l < levels; l++)
    hotelLines.add({
      positions: ring.map((p) =>
        toCart(p, hotelBase + LOBBY_H + (l - 1) * floorH),
      ),
      width: 1,
      material: Cesium.Material.fromType('Color', {
        color: css(...TWIN_PALETTE.floorLine),
      }),
    });

  // --- ground: grid (operator-chosen spacing) and terrain contours ---
  // A wide site (Heathrow T5, 2.75 km) keeps the grid and contours to its
  // detail ring: beyond it the map is roads, runways and footprints, so a
  // 50 m grid does not swamp the City view.
  const gridR =
    radius > AIRSIDE_DETAIL_M * 1.5 ? AIRSIDE_DETAIL_M + 100 : radius + 100;
  let grid = null;
  let contours = null;
  // Grid and elevation are independent layers (Jesse): either, both or neither.
  let groundState = {
    grid: true,
    contours: false,
    spacingM: 50,
    majorEvery: 5,
    contourM: 2,
  };
  let revealed = 0;
  const groundVisible = () => revealed >= radius / 4;
  function rebuildGround() {
    for (const prim of [grid, contours]) if (prim) primitives.remove(prim);
    grid = null;
    contours = null;
    if (groundState.grid)
      grid = primitives.add(
        makeGrid(
          projector,
          field,
          gridR,
          groundState.spacingM,
          groundState.majorEvery,
        ),
      );
    if (groundState.contours)
      contours = primitives.add(
        makeContours(
          projector,
          field,
          gridR,
          groundState.contourM,
          field.at(0, 0),
        ),
      );
    for (const prim of [grid, contours])
      if (prim) prim.show = groundVisible() || revealed === 0;
    viewer.scene.requestRender();
  }
  rebuildGround();

  // --- streets on the heightfield, inside the grid disc ---
  const streetInstances = [];
  for (const road of site.roads) {
    const inside = road.coords.filter(
      (p) => haversineM(p, center) <= radius + 60,
    );
    if (inside.length < 2) continue;
    const minor = /^(footway|steps|service|pedestrian)$/.test(road.highway);
    streetInstances.push(
      new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry({
          positions: drape(inside, projector, field, 0.3),
          width: minor ? 1 : 1.5,
          arcType: Cesium.ArcType.NONE,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            css(TWIN_PALETTE.street[0], minor ? 0.45 : TWIN_PALETTE.street[1]),
          ),
        },
      }),
    );
  }
  const streets = streetInstances.length
    ? primitives.add(
        new Cesium.Primitive({
          geometryInstances: streetInstances,
          appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
          asynchronous: true,
        }),
      )
    : null;
  const airside = makeAirside(site.aeroways || [], projector, field, radius);
  if (airside) primitives.add(airside.group);
  // Primitives compile only while shown; the controller hides them after ready().

  let disposed = false;
  let contextOn = true;
  let baseStreetsOff = false; // the Streets layer draws its own (phase 7)
  let lastReveal = 0;
  return {
    primitives,
    /** Geometry for selection overlays: {building, base, isHotel}. */
    geomFor: (id) => geomById.get(id) || null,
    radii,
    hotelBase,
    hotelTop,
    levels,
    floorH,
    lobbyH: LOBBY_H,
    stats: {
      buildings: site.buildings.length,
      triangles,
      primitives: bandPrimitives.length * 2 + 4,
      roads: streetInstances.length,
      aeroways: airside?.count || 0,
    },
    /** The faint base streets step aside while the Streets layer is on. */
    setBaseStreets(on) {
      baseStreetsOff = !on;
      if (streets) streets.show = on && lastReveal >= radius / 2;
      viewer.scene.requestRender();
    },
    /** Show bands whose radius is ≤ r, plus hotel, grid and streets. */
    reveal(r) {
      lastReveal = r;
      revealed = r;
      hotelGroup.show = true;
      bandPrimitives.forEach((g, i) => {
        g.show = contextOn && (radii[i] <= r || (i === 0 && r > 0));
      });
      if (grid) grid.show = r >= radius / 4;
      if (contours) contours.show = r >= radius / 4;
      if (streets) streets.show = r >= radius / 2 && !baseStreetsOff;
      if (airside) airside.group.show = r >= radius / 4;
    },
    /** Surrounding buildings on/off (Layers › Site). The hotel always stays. */
    /** Floor focus (phase 3 Part F): the hotel glass steps back. */
    setHotelDim(on, level = 0.4) {
      hotelMaterial.uniforms.fade = on ? level : 1;
      viewer.scene.requestRender();
    },
    /** Ways out (phase 7): surrounding buildings step back to faint volumes. */
    setContextDim(on) {
      for (const m of contextMaterials) m.uniforms.fade = on ? 0.35 : 1;
      viewer.scene.requestRender();
    },
    setContextVisible(on) {
      contextOn = on;
      this.reveal(lastReveal);
      viewer.scene.requestRender();
    },
    get contextVisible() {
      return contextOn;
    },
    showAll() {
      this.reveal(Infinity);
    },
    /** Ground options: {mode:'grid'|'terrain'|'both'|'none', spacingM, majorEvery, contourM}. */
    setGround(next) {
      const n = { ...next };
      if (n.mode) {
        // Backward compatible with the old single select.
        n.grid = n.mode === 'grid' || n.mode === 'both';
        n.contours = n.mode === 'terrain' || n.mode === 'both';
        delete n.mode;
      }
      groundState = { ...groundState, ...n };
      rebuildGround();
      if (revealed === 0) {
        if (grid) grid.show = false;
        if (contours) contours.show = false;
      }
      return { ...groundState, relief: terrainRelief(projector, field, gridR) };
    },
    get ground() {
      return { ...groundState, relief: terrainRelief(projector, field, gridR) };
    },
    hideAll() {
      hotelGroup.show = false;
      bandPrimitives.forEach((g) => (g.show = false));
      if (streets) streets.show = false;
      if (airside) airside.group.show = false;
    },
    /** Resolves when every asynchronous primitive has compiled (or timeout). */
    ready(timeoutMs = 20000) {
      const list = [];
      const walk = (c) => {
        for (let i = 0; i < c.length; i++) {
          const p = c.get(i);
          if (p instanceof Cesium.PrimitiveCollection) walk(p);
          else if (p && 'ready' in p) list.push(p);
        }
      };
      walk(primitives);
      const started = performance.now();
      return new Promise((resolve) => {
        const tick = () => {
          if (
            disposed ||
            list.every((p) => p.ready) ||
            performance.now() - started > timeoutMs
          ) {
            remove();
            resolve(list.every((p) => p.ready));
          } else viewer.scene.requestRender();
        };
        const remove = viewer.scene.postRender.addEventListener(tick);
        viewer.scene.requestRender();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!viewer.isDestroyed()) viewer.scene.primitives.remove(primitives);
    },
  };
}

/**
 * Runways, taxiways and aprons inside the disc (airport sites only; none
 * elsewhere, so nothing is built). Flat on the heightfield: runways as
 * bands of their mapped width with faint edges, taxiways as 1 px lines,
 * aprons as faint areas with a faint outline. Returns {group, count} or null.
 */
function makeAirside(aeroways, projector, field, radius) {
  if (!aeroways.length) return null;
  const R = radius + 60;
  const at = (p) => {
    const [x, y] = projector.toXY(p.lat, p.lon);
    return field.at(x, y);
  };
  const color = ([hex, a]) =>
    Cesium.ColorGeometryInstanceAttribute.fromColor(css(hex, a));
  const bands = [];
  const lines = [];
  const areas = [];
  const outlines = [];
  let count = 0;
  for (const a of aeroways) {
    if (a.kind === 'apron') {
      const ring = a.ring;
      if (!ring.some((p) => Math.hypot(...projector.toXY(p.lat, p.lon)) <= R))
        continue;
      const h = at(ring[0]) + 0.05;
      const hierarchy = new Cesium.PolygonHierarchy(
        ring.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, h)),
      );
      areas.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: hierarchy,
            height: h,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: { color: color(TWIN_PALETTE.apron) },
        }),
      );
      outlines.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: ring.map((p) =>
              Cesium.Cartesian3.fromDegrees(p.lon, p.lat, h + 0.05),
            ),
            width: 1,
            arcType: Cesium.ArcType.NONE,
          }),
          attributes: { color: color(TWIN_PALETTE.apronEdge) },
        }),
      );
      count += 1;
      continue;
    }
    for (const piece of clipToDisc(a.coords, projector, R)) {
      const pts = piece.filter(
        (p, i) =>
          i === 0 || p.lat !== piece[i - 1].lat || p.lon !== piece[i - 1].lon,
      );
      if (pts.length < 2) continue;
      const h = at(pts[Math.floor(pts.length / 2)]) + 0.1;
      const positions = pts.map((p) =>
        Cesium.Cartesian3.fromDegrees(p.lon, p.lat, h),
      );
      if (a.kind === 'runway') {
        bands.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.CorridorGeometry({
              positions,
              width: a.widthM,
              height: h,
              vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
            }),
            attributes: { color: color(TWIN_PALETTE.runway) },
          }),
        );
        outlines.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.CorridorOutlineGeometry({
              positions,
              width: a.widthM,
              height: h + 0.05,
            }),
            attributes: { color: color(TWIN_PALETTE.runwayEdge) },
          }),
        );
      } else
        lines.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.PolylineGeometry({
              positions,
              width: 1,
              arcType: Cesium.ArcType.NONE,
            }),
            attributes: { color: color(TWIN_PALETTE.taxiway) },
          }),
        );
      count += 1;
    }
  }
  const group = new Cesium.PrimitiveCollection();
  const flat = (instances) =>
    group.add(
      new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({
          flat: true,
          translucent: true,
        }),
        asynchronous: true,
      }),
    );
  const polylines = (instances) =>
    group.add(
      new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
        asynchronous: true,
      }),
    );
  if (areas.length) flat(areas);
  if (bands.length) flat(bands);
  const outlineLines = outlines.filter(
    (g) => g.geometry instanceof Cesium.PolylineGeometry,
  );
  const outlineEdges = outlines.filter(
    (g) => !(g.geometry instanceof Cesium.PolylineGeometry),
  );
  if (outlineEdges.length) flat(outlineEdges);
  if (outlineLines.length || lines.length)
    polylines([...outlineLines, ...lines]);
  return count ? { group, count } : null;
}

function makeGrid(projector, field, gridR, spacingM, majorEvery) {
  const instances = [];
  const n = Math.floor(gridR / spacingM);
  const sample = Math.max(8, Math.min(25, spacingM / 2));
  for (let i = -n; i <= n; i++) {
    const k = i * spacingM;
    const major = i % majorEvery === 0;
    const [hex, alpha] = major
      ? TWIN_PALETTE.gridMajor
      : TWIN_PALETTE.gridMinor;
    for (const axis of [0, 1]) {
      const half = Math.sqrt(Math.max(0, gridR * gridR - k * k));
      if (half < 5) continue;
      const pts = [];
      const colors = [];
      for (let t = -half; t <= half + 0.01; t += sample) {
        const [x, y] = axis ? [k, t] : [t, k];
        pts.push(toCart(projector.toLL(x, y), field.at(x, y) + 0.05));
        const fadeT = Math.max(
          0,
          Math.min(1, (gridR - Math.hypot(x, y)) / 100),
        );
        colors.push(css(hex, alpha * fadeT));
      }
      instances.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: pts,
            colors,
            colorsPerVertex: true,
            width: 1,
            arcType: Cesium.ArcType.NONE,
          }),
        }),
      );
    }
  }
  return new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    asynchronous: false,
  });
}

/** Min/max ground (m) inside the disc, relative to the hotel's street level. */
export function terrainRelief(projector, field, gridR) {
  const ref = field.at(0, 0);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = -gridR; y <= gridR; y += 20)
    for (let x = -gridR; x <= gridR; x += 20) {
      if (x * x + y * y > gridR * gridR) continue;
      const h = field.at(x, y) - ref;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  return { low: lo, high: hi };
}

/**
 * Contour lines by marching squares over the heightfield, drawn as one LINES
 * geometry per level. Major contours (every 5th) are brighter. Levels are
 * relative to the hotel's street level so "+10 m" reads as high ground.
 */
function makeContours(projector, field, gridR, intervalM, ref) {
  const step = 10;
  const n = Math.floor((2 * gridR) / step);
  const x0 = -gridR;
  const H = new Float64Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++)
      H[j * (n + 1) + i] = field.at(x0 + i * step, x0 + j * step) - ref;
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of H) {
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const instances = [];
  const first = Math.ceil(lo / intervalM);
  const last = Math.floor(hi / intervalM);
  for (let k = first; k <= last; k++) {
    const level = k * intervalM;
    const pos = [];
    const edge = (ax, ay, ha, bx, by, hb) => {
      const t = (level - ha) / (hb - ha);
      return [ax + (bx - ax) * t, ay + (by - ay) * t];
    };
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const xa = x0 + i * step;
        const ya = x0 + j * step;
        const h00 = H[j * (n + 1) + i];
        const h10 = H[j * (n + 1) + i + 1];
        const h01 = H[(j + 1) * (n + 1) + i];
        const h11 = H[(j + 1) * (n + 1) + i + 1];
        const pts = [];
        if (h00 < level !== h10 < level)
          pts.push(edge(xa, ya, h00, xa + step, ya, h10));
        if (h10 < level !== h11 < level)
          pts.push(edge(xa + step, ya, h10, xa + step, ya + step, h11));
        if (h01 < level !== h11 < level)
          pts.push(edge(xa, ya + step, h01, xa + step, ya + step, h11));
        if (h00 < level !== h01 < level)
          pts.push(edge(xa, ya, h00, xa, ya + step, h01));
        for (let q = 0; q + 1 < pts.length; q += 2) {
          const [p1, p2] = [pts[q], pts[q + 1]];
          if (
            p1[0] ** 2 + p1[1] ** 2 > gridR ** 2 &&
            p2[0] ** 2 + p2[1] ** 2 > gridR ** 2
          )
            continue;
          for (const [x, y] of [p1, p2]) {
            const c = toCart(projector.toLL(x, y), ref + level + 0.15);
            pos.push(c.x, c.y, c.z);
          }
        }
      }
    if (!pos.length) continue;
    const major = k % 5 === 0;
    const t = hi > lo ? (level - lo) / (hi - lo) : 0.5;
    // Low end lifted from #415e6b so minor contours clear 3:1 on the field.
    const color = Cesium.Color.lerp(
      css('#6f8a95'),
      css('#c8d2d5'),
      t,
      new Cesium.Color(),
    );
    color.alpha = major ? 1 : 0.8;
    const positions = new Float64Array(pos);
    instances.push(
      new Cesium.GeometryInstance({
        geometry: new Cesium.Geometry({
          attributes: {
            position: new Cesium.GeometryAttribute({
              componentDatatype: Cesium.ComponentDatatype.DOUBLE,
              componentsPerAttribute: 3,
              values: positions,
            }),
          },
          primitiveType: Cesium.PrimitiveType.LINES,
          boundingSphere: Cesium.BoundingSphere.fromVertices(positions),
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
        },
      }),
    );
  }
  if (!instances.length) return new Cesium.PrimitiveCollection();
  return new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PerInstanceColorAppearance({
      flat: true,
      translucent: true,
    }),
    asynchronous: false,
  });
}
