// Selection glow for Trip Twin buildings. Ambient light, not thick lines:
// soft shells, a brighter rim and a pool of light on the ground. Styles are a
// prototype switch so Jesse can compare them (`?glow=` or the toolbar).
import * as Cesium from 'cesium';

export const GLOW_STYLES = Object.freeze({
  'aura-pool': 'Aura + light pool',
  aura: 'Aura',
  rim: 'Soft rim',
  pool: 'Light pool',
  beacon: 'Aura + beacon',
});
export const DEFAULT_GLOW = 'aura-pool';
const SELECT = '#eff7f3'; // twin-select (05 §2.5)
const TINT = '#b8c3c7'; // slate-teal ramp top: keeps the glow on-brand

const GLOW_SOURCE = `
uniform vec4 glowColor;
uniform float rimPower;
uniform float coreAlpha;
uniform float rimAlpha;
uniform float fade;
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  vec3 n = normalize(materialInput.normalEC);
  vec3 v = normalize(materialInput.positionToEyeEC);
  float f = pow(1.0 - abs(dot(n, v)), rimPower);
  m.diffuse = vec3(0.0);
  m.specular = 0.0;
  m.emission = glowColor.rgb;
  m.alpha = clamp(coreAlpha + rimAlpha * f, 0.0, 1.0) * fade;
  return m;
}`;

const POOL_SOURCE = `
uniform vec4 glowColor;
uniform float strength;
uniform float fade;
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  float d = distance(materialInput.st, vec2(0.5)) * 2.0;
  float a = strength * pow(clamp(1.0 - d, 0.0, 1.0), 2.2);
  m.diffuse = vec3(0.0);
  m.specular = 0.0;
  m.emission = glowColor.rgb;
  m.alpha = a * fade;
  return m;
}`;

let typeSeq = 0;
function material(source, uniforms) {
  return new Cesium.Material({
    fabric: { type: `TwinGlow${typeSeq++}`, uniforms, source },
    translucent: true,
  });
}

function volume(ring, base, top, mat, { caps = true } = {}) {
  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(
          ring.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, base)),
        ),
        height: base,
        extrudedHeight: top,
        // Halo shells are walls only: stacked lids read as steps.
        closeTop: caps,
        closeBottom: caps,
        vertexFormat:
          Cesium.MaterialAppearance.MaterialSupport.BASIC.vertexFormat,
      }),
    }),
    appearance: new Cesium.MaterialAppearance({
      material: mat,
      materialSupport: Cesium.MaterialAppearance.MaterialSupport.BASIC,
      translucent: true,
      faceForward: true,
      closed: false,
    }),
    asynchronous: false,
  });
}

function meanRadius(ring) {
  const n = ring.length - 1;
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < n; i++) {
    lat += ring[i].lat;
    lon += ring[i].lon;
  }
  lat /= n;
  lon /= n;
  const mPerLon = 111320 * Math.cos((lat * Math.PI) / 180);
  let r = 0;
  for (let i = 0; i < n; i++)
    r += Math.hypot(
      (ring[i].lat - lat) * 110540,
      (ring[i].lon - lon) * mPerLon,
    );
  return Math.max(4, r / n);
}

function scaleRing(ring, s) {
  const n = ring.length - 1;
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < n; i++) {
    lat += ring[i].lat;
    lon += ring[i].lon;
  }
  lat /= n;
  lon /= n;
  return ring.map((p) => ({
    lat: lat + (p.lat - lat) * s,
    lon: lon + (p.lon - lon) * s,
  }));
}

/** Grow a ring outward by ~d metres (scale about its centroid; fine for a halo). */
function grow(ring, d) {
  const n = ring.length - 1;
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < n; i++) {
    lat += ring[i].lat;
    lon += ring[i].lon;
  }
  lat /= n;
  lon /= n;
  const mPerLat = 110540;
  const mPerLon = 111320 * Math.cos((lat * Math.PI) / 180);
  let r = 0;
  for (let i = 0; i < n; i++)
    r += Math.hypot(
      (ring[i].lat - lat) * mPerLat,
      (ring[i].lon - lon) * mPerLon,
    );
  r = Math.max(4, r / n);
  const s = (r + d) / r;
  return ring.map((p) => ({
    lat: lat + (p.lat - lat) * s,
    lon: lon + (p.lon - lon) * s,
  }));
}

function poolDisc(ring, base, radiusPad, mat) {
  const n = ring.length - 1;
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < n; i++) {
    lat += ring[i].lat;
    lon += ring[i].lon;
  }
  lat /= n;
  lon /= n;
  const mPerLat = 110540;
  const mPerLon = 111320 * Math.cos((lat * Math.PI) / 180);
  let r = 0;
  for (let i = 0; i < n; i++)
    r = Math.max(
      r,
      Math.hypot((ring[i].lat - lat) * mPerLat, (ring[i].lon - lon) * mPerLon),
    );
  const R = r + radiusPad;
  const pts = Array.from({ length: 64 }, (_, i) => {
    const t = (i / 64) * Math.PI * 2;
    return Cesium.Cartesian3.fromDegrees(
      lon + (R * Math.cos(t)) / mPerLon,
      lat + (R * Math.sin(t)) / mPerLat,
      base + 0.25,
    );
  });
  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(pts),
        perPositionHeight: true,
        vertexFormat:
          Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
      }),
    }),
    appearance: new Cesium.MaterialAppearance({
      material: mat,
      translucent: true,
      flat: true,
    }),
    asynchronous: false,
  });
}

/**
 * select(geom, style) draws the glow; clear() removes it. Fades in over
 * 320 ms (dur.medium, ease.enter); instant under reduced motion.
 */
export function createSelectionGlow(
  viewer,
  parent,
  { reducedMotion = () => false } = {},
) {
  const collection = new Cesium.PrimitiveCollection();
  parent.add(collection);
  let mats = [];
  let raf = 0;

  function clear() {
    cancelAnimationFrame(raf);
    collection.removeAll();
    mats = [];
    viewer.scene.requestRender();
  }

  function select(geom, style = DEFAULT_GLOW) {
    clear();
    if (!geom) return;
    const ring = geom.building.rings[0];
    const base = geom.base + (geom.building.minHeightM || 0);
    const top = geom.base + geom.building.heightM;
    const color = Cesium.Color.fromCssColorString(geom.isHotel ? SELECT : TINT);
    const shells = (layers) => {
      for (const [d, core, rim] of layers) {
        const m = material(GLOW_SOURCE, {
          glowColor: color,
          rimPower: 1.4,
          coreAlpha: core,
          rimAlpha: rim,
          fade: 0,
        });
        mats.push(m);
        // One height for every shell, no lids: a smooth falloff outward,
        // never tiers (Jesse, 16 Oct 2026: "the bloom turned into steps").
        collection.add(
          volume(grow(ring, d), base, top + 0.5, m, { caps: false }),
        );
      }
    };
    // Halo size follows the building: a soft falloff, not a fixed-width line.
    const r = meanRadius(ring);
    if (style === 'aura' || style === 'aura-pool' || style === 'beacon')
      // Softer than before (about half): the selection reads, the
      // building under it still shows (Jesse: "make the bloom less").
      shells([
        [0.03 * r + 1, 0.03, 0.1],
        [0.09 * r + 3, 0.012, 0.05],
        [0.18 * r + 7, 0.006, 0.03],
      ]);
    if (style === 'rim') shells([[0.4, 0.1, 0.45]]);
    if (style === 'pool' || style === 'aura-pool' || style === 'beacon') {
      const m = material(POOL_SOURCE, {
        glowColor: color,
        strength: 0.35,
        fade: 0,
      });
      mats.push(m);
      collection.add(
        poolDisc(ring, geom.base, Math.max(30, meanRadius(ring) * 0.9), m),
      );
    }
    if (style === 'pool') shells([[0.6, 0.06, 0.2]]);
    if (style === 'beacon') {
      // A soft column of light rising from the roof: findable at City scale.
      const m = material(GLOW_SOURCE, {
        glowColor: color,
        rimPower: 1.0,
        coreAlpha: 0.02,
        rimAlpha: 0.2,
        fade: 0,
      });
      mats.push(m);
      collection.add(
        volume(
          scaleRing(ring, 0.35),
          top,
          top + Math.max(60, geom.building.heightM * 0.8),
          m,
        ),
      );
    }
    // Fade in.
    const start = performance.now();
    const dur = reducedMotion() ? 0 : 320;
    const step = () => {
      const t = dur ? Math.min(1, (performance.now() - start) / dur) : 1;
      const eased = 1 - Math.pow(1 - t, 3);
      for (const m of mats) m.uniforms.fade = eased;
      viewer.scene.requestRender();
      if (t < 1) raf = requestAnimationFrame(step);
    };
    step();
  }

  return {
    select,
    clear,
    dispose() {
      clear();
      if (!parent.isDestroyed?.()) parent.remove(collection);
    },
  };
}
