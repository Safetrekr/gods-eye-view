// 3D weather over the site (phase 6): falling rain / sleet / snow, cumulus
// clouds at the forecast layers, and ground haze. Shapes are illustrative;
// what falls, how hard and where come from data (see twinWeatherTime.js and
// PHASE-6-PLAN). Neutral white / grey only — blue means paths.
import * as Cesium from 'cesium';
import {
  holdContinuousRender,
  releaseContinuousRender,
} from '../../renderGovernor.js';

const css = (hex, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
const STREAK = canvas(4, 32, (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.fillRect(1, 0, 2, h);
});
const FLAKE = canvas(16, 16, (g) => {
  const grad = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 16);
});

const HAZE = canvas(128, 128, (g) => {
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(223,230,232,0.9)');
  grad.addColorStop(0.6, 'rgba(223,230,232,0.45)');
  grad.addColorStop(1, 'rgba(223,230,232,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
});

// Per kind: how particles look and move (fall speed is exaggerated for
// legibility at twin scale; the row text carries the real numbers).
const KIND = {
  rain: {
    image: STREAK,
    size: [1.5, 20],
    color: '#b8c3c7',
    alpha: 0.55,
    fall: 28,
    top: 140,
    rate: 1300,
  },
  sleet: {
    image: STREAK,
    size: [2, 10],
    color: '#e3e9eb',
    alpha: 0.7,
    fall: 14,
    top: 120,
    rate: 900,
  },
  snow: {
    image: FLAKE,
    size: [4, 4],
    color: '#b8c3c7',
    alpha: 0.6,
    fall: 3,
    top: 90,
    rate: 220,
  },
};

/** Deterministic pseudo-random (so clouds do not jump on every refresh). */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createWeatherFx(viewer, site) {
  const scene = viewer.scene;
  const base = site.field.at(0, 0);
  const R = Math.max(350, site.radius || 500);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(site.center.lon, site.center.lat, base),
  );
  const inv = Cesium.Matrix4.inverseTransformation(enu, new Cesium.Matrix4());
  const local = new Cesium.Cartesian3();
  let particles = null;
  let still = null;
  let clouds = null;
  let haze = null;
  let sig = '';
  // Where it falls: (x, y) metres east / north of the centre → bool.
  let covered = () => true;
  // Particles are fixed in screen pixels: thin them as the camera pulls
  // back so the site stays readable (review/phase6 UI P0-1).
  const centreWorld = Cesium.Matrix4.getTranslation(
    enu,
    new Cesium.Cartesian3(),
  );
  let baseRate = 0;
  function viewScale() {
    const d = Cesium.Cartesian3.distance(scene.camera.positionWC, centreWorld);
    return Math.min(1, Math.max(0.1, 700 / Math.max(1, d)));
  }
  const offMove = scene.camera.moveEnd.addEventListener(() => {
    if (particles) particles.emissionRate = Math.round(baseRate * viewScale());
  });

  // Particles advance with the scene clock: run it only while they are on.
  let clockWas = null;
  function runClock(on) {
    const clock = viewer.clock;
    if (on && clockWas === null) {
      clockWas = { animate: clock.shouldAnimate, multiplier: clock.multiplier };
      clock.multiplier = 1;
      clock.shouldAnimate = true;
      holdContinuousRender('twin-weather-fx');
    } else if (!on && clockWas) {
      clock.shouldAnimate = clockWas.animate;
      clock.multiplier = clockWas.multiplier;
      clockWas = null;
      releaseContinuousRender('twin-weather-fx');
    }
  }
  function clearPrecip() {
    runClock(false);
    if (particles) scene.primitives.remove(particles);
    if (still) scene.primitives.remove(still);
    particles = null;
    still = null;
  }
  function clearClouds() {
    if (clouds) scene.primitives.remove(clouds);
    clouds = null;
  }
  function clearHaze() {
    if (haze) viewer.entities.remove(haze);
    haze = null;
  }

  function setPrecip({ kind, level, windMs = 0, windFromDeg = 0, reduced }) {
    clearPrecip();
    if (!kind || !level) return;
    const k = KIND[kind];
    // Wind blows FROM windFromDeg: drift toward the opposite bearing.
    const toRad = Cesium.Math.toRadians((windFromDeg + 180) % 360);
    const drift = Math.min(12, windMs || 0) * (kind === 'snow' ? 0.8 : 0.35);
    const vx = Math.sin(toRad) * drift;
    const vy = Math.cos(toRad) * drift;
    const color = css(k.color, k.alpha);
    const vLocal = new Cesium.Cartesian3(vx, vy, -k.fall);
    const vWorld = Cesium.Matrix4.multiplyByPointAsVector(
      enu,
      vLocal,
      new Cesium.Cartesian3(),
    );
    if (reduced) {
      // Reduce motion: the same streaks / flakes, drawn still.
      still = scene.primitives.add(
        new Cesium.BillboardCollection({ modelMatrix: enu }),
      );
      const r = rng(7);
      const n = Math.round(1800 * level);
      const nScaled = Math.round(n * viewScale());
      for (let i = 0; i < nScaled; i += 1) {
        const x = (r() * 2 - 1) * R;
        const y = (r() * 2 - 1) * R;
        if (x * x + y * y > R * R || !covered(x, y)) continue;
        still.add({
          position: new Cesium.Cartesian3(x, y, 4 + r() * k.top),
          image: k.image,
          width: k.size[0],
          height: k.size[1],
          color,
        });
      }
      return;
    }
    runClock(true);
    baseRate = k.rate * level;
    particles = scene.primitives.add(
      new Cesium.ParticleSystem({
        modelMatrix: enu,
        emitterModelMatrix: Cesium.Matrix4.fromTranslation(
          new Cesium.Cartesian3(0, 0, k.top),
        ),
        emitter: new Cesium.BoxEmitter(new Cesium.Cartesian3(2 * R, 2 * R, 1)),
        image: k.image,
        minimumImageSize: new Cesium.Cartesian2(
          k.size[0] * (kind === 'snow' ? 0.75 : 1),
          k.size[1] * (kind === 'snow' ? 0.75 : 1),
        ),
        maximumImageSize: new Cesium.Cartesian2(
          k.size[0] * (kind === 'snow' ? 1.75 : 1),
          k.size[1] * (kind === 'snow' ? 1.75 : 1),
        ),
        startColor: color,
        endColor: color,
        emissionRate: Math.round(k.rate * level * viewScale()),
        minimumParticleLife: k.top / k.fall,
        maximumParticleLife: k.top / k.fall + 0.5,
        minimumSpeed: k.fall,
        maximumSpeed: k.fall,
        // Particles live in world coordinates: test and steer in site-local
        // metres (east, north, up), then rotate the velocity back.
        updateCallback: (p) => {
          const pos = Cesium.Matrix4.multiplyByPoint(inv, p.position, local);
          // Outside the site disc, or where the radar shows nothing: gone.
          if (
            pos.x * pos.x + pos.y * pos.y > R * R ||
            pos.z < 0 ||
            !covered(pos.x, pos.y)
          ) {
            // End it now (life = 0 would divide by zero in Cesium's sizing).
            p.life = Math.max(p.age, 1e-3);
            return;
          }
          if (kind === 'snow') {
            const wob = Math.sin((p.age + pos.x) * 1.7) * 0.6;
            vLocal.x = vx + wob;
            p.velocity = Cesium.Matrix4.multiplyByPointAsVector(
              enu,
              vLocal,
              p.velocity,
            );
          } else p.velocity = Cesium.Cartesian3.clone(vWorld, p.velocity);
        },
      }),
    );
  }

  function setClouds(cl, { seed = 1 } = {}) {
    clearClouds();
    if (!cl) return;
    clouds = scene.primitives.add(
      new Cesium.CloudCollection({ noiseDetail: 16 }),
    );
    const r = rng(seed);
    // A clear column over the site keeps the hologram visible (said in the row).
    for (const [km, cover, n, w] of [
      [1, cl.low, 5, 520],
      [3.5, cl.mid, 3, 900],
      [8, cl.high, 2, 1400],
    ]) {
      if (!Number.isFinite(cover) || cover < 5) continue;
      const count = Math.round((n * cover) / 100);
      for (let i = 0; i < count; i += 1) {
        const a = r() * Math.PI * 2;
        // Outside a 45° cone over the site, so clouds never sit on it.
        const d = R * 1.3 + km * 1000 + r() * R * 3;
        const local = new Cesium.Cartesian3(
          Math.cos(a) * d,
          Math.sin(a) * d,
          km * 1000 + (r() - 0.5) * 300,
        );
        const sc = w * (0.6 + r() * 0.8);
        clouds.add({
          position: Cesium.Matrix4.multiplyByPoint(
            enu,
            local,
            new Cesium.Cartesian3(),
          ),
          scale: new Cesium.Cartesian2(sc, sc * 0.45),
          maximumSize: new Cesium.Cartesian3(18, 10, 14),
          slice: 0.3 + r() * 0.2,
          brightness: km > 5 ? 0.7 : 0.6,
        });
      }
    }
  }

  function setHaze(fogPct) {
    clearHaze();
    if (!Number.isFinite(fogPct) || fogPct < 3) return;
    haze = viewer.entities.add({
      position: Cesium.Matrix4.getTranslation(enu, new Cesium.Cartesian3()),
      // A soft ground glow with no edge (a hard rim reads as a zone).
      ellipse: {
        semiMajorAxis: R * 1.8,
        semiMinorAxis: R * 1.8,
        height: base + 6,
        material: new Cesium.ImageMaterialProperty({
          image: HAZE,
          transparent: true,
          color: Cesium.Color.WHITE.withAlpha(
            Math.min(0.5, 0.12 + 0.4 * (fogPct / 100)),
          ),
        }),
      },
    });
  }

  return {
    /**
     * state = {precip: {kind, level, windMs, windFromDeg} | null,
     *          clouds: {low, mid, high} | null, fogPct, reduced,
     *          covered: (x, y) => bool | null}
     */
    set(state) {
      covered = state.covered || (() => true);
      const p = state.precip;
      const s = JSON.stringify([
        p?.kind,
        p?.level,
        Math.round(p?.windMs || 0),
        Math.round((p?.windFromDeg || 0) / 15),
        state.reduced,
        state.coverSig || '',
      ]);
      if (s !== sig) {
        sig = s;
        setPrecip({ ...(p || {}), reduced: state.reduced });
      }
      const cs = JSON.stringify(state.clouds);
      if (cs !== this._cs) {
        this._cs = cs;
        setClouds(state.clouds, { seed: 11 });
      }
      if (state.fogPct !== this._fog) {
        this._fog = state.fogPct;
        setHaze(state.fogPct);
      }
      scene.requestRender();
    },
    get active() {
      return Boolean(particles || still || clouds || haze);
    },
    dispose() {
      offMove();
      if (viewer.isDestroyed()) return;
      clearPrecip();
      clearClouds();
      clearHaze();
    },
  };
}

/**
 * A recoloured radar canvas (box `bbox`) → covered(x, y) for local metres
 * around `center`. Any non-transparent pixel counts as precipitation.
 */
export function coverageFromCanvas(cv, bbox, center) {
  if (!cv) return null;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const { data, width, height } = g.getImageData(0, 0, cv.width, cv.height);
  const [w, s, e, n] = bbox;
  const kx = Math.cos((center.lat * Math.PI) / 180) * 111320;
  return (x, y) => {
    const lon = center.lon + x / kx;
    const lat = center.lat + y / 110540;
    const px = Math.floor(((lon - w) / (e - w)) * width);
    const py = Math.floor(((n - lat) / (n - s)) * height);
    if (px < 0 || py < 0 || px >= width || py >= height) return false;
    return data[(py * width + px) * 4 + 3] > 20;
  };
}
