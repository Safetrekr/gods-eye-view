// Phase 12 · see it coming: radar motion, cores, arrival on the current
// track, the simulated storm, warning areas, and honest wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_T,
  approach,
  approachText,
  bandOf,
  boxKm,
  cellKm,
  etaText,
  findCores,
  insideAny,
  makeGrid,
  motionVector,
  nearestPoint,
  outerRings,
  pointInRing,
  projectGrid,
  rgbaToIntensity,
  simulatedMotion,
  simulatedStorm,
  simulatedStormStrikes,
  simulatedWarningRing,
  toKm,
  trendOf,
} from './twinNowcast.js';
import { bannedWordHits } from './twinData.js';

const SITE = { lat: 30.2622, lon: -97.7382 }; // Fairmont Austin
const BOX = boxKm(SITE, 160);
const W = 160; // 1 km cells for the tests
const fmt = {
  dist: (m) => `${(m / 1000).toFixed(1)} km`,
  speed: (k) => `${Math.round(k)} km/h`,
  siteNoun: 'hotel',
  frame: '21:25',
  source: 'radar',
  boxKm: 160,
};

/** A grid with Gaussian blobs at (east km, north km) from the site. */
function blobs(list, t = 0) {
  const data = new Float32Array(W * W);
  const g = makeGrid(data, W, W, BOX, t);
  const ck = cellKm(g);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const ex = (x + 0.5 - W / 2) * ck.x;
      const ny = (W / 2 - (y + 0.5)) * ck.y;
      let v = 0;
      for (const [bx, by, s, peak] of list)
        v = Math.max(
          v,
          peak * Math.exp(-((ex - bx) ** 2 + (ny - by) ** 2) / (2 * s * s)),
        );
      if (v > 0.06) data[y * W + x] = v;
    }
  return g;
}

test('radar colours become intensity bands; transparent is no rain', () => {
  const px = new Uint8ClampedArray([
    0,
    100,
    255,
    255, // blue → light (often not rain)
    0,
    200,
    0,
    255, // green, 20–35 dBZ → light rain, not a core
    255,
    255,
    0,
    255, // yellow, ~40 dBZ → moderate core
    255,
    0,
    0,
    255, // red → heavy
    255,
    0,
    255,
    255, // magenta → intense
    0,
    200,
    0,
    10, // nearly transparent → none
  ]);
  const t = rgbaToIntensity(px, 6, 1);
  assert.equal(bandOf(t[0]), 'light');
  assert.equal(bandOf(t[1]), 'light');
  assert.ok(t[1] < CORE_T, 'green is never a core');
  assert.equal(bandOf(t[2]), 'moderate');
  assert.equal(bandOf(t[3]), 'heavy');
  assert.equal(bandOf(t[4]), 'intense');
  assert.equal(t[5], 0);
});

test('motion: a field moved 10 km east and 5 km north in 20 min is measured', () => {
  const a = blobs(
    [
      [-30, -20, 4, 0.8],
      [-10, -35, 5, 0.5],
      [20, 10, 3, 0.6],
    ],
    0,
  );
  const b = blobs(
    [
      [-20, -15, 4, 0.8],
      [0, -30, 5, 0.5],
      [30, 15, 3, 0.6],
    ],
    20 * 60e3,
  );
  const m = motionVector(a, b);
  assert.ok(m, 'motion found');
  assert.ok(Math.abs(m.vxKmh - 30) < 4, `vx ${m.vxKmh}`);
  assert.ok(Math.abs(m.vyKmh - 15) < 4, `vy ${m.vyKmh}`);
  assert.ok(m.headingDeg > 50 && m.headingDeg < 75, `heading ${m.headingDeg}`);
});

test('motion: too little rain or no time between frames gives no motion', () => {
  const empty = makeGrid(new Float32Array(W * W), W, W, BOX, 0);
  const one = blobs([[0, 0, 3, 0.8]], 20 * 60e3);
  assert.equal(motionVector(empty, one), null);
  assert.equal(motionVector(one, one), null);
});

test('cores: two separate cores, strongest first, placed where they are', () => {
  const g = blobs([
    [-20, 0, 3, 0.95],
    [25, 10, 4, 0.62],
  ]);
  const cores = findCores(g);
  assert.equal(cores.length, 2);
  assert.equal(cores[0].band, 'intense');
  assert.equal(cores[1].band, 'moderate');
  const k = toKm(SITE, cores[0]);
  assert.ok(Math.abs(k.x + 20) < 1.5 && Math.abs(k.y) < 1.5, JSON.stringify(k));
  assert.ok(cores.every((c) => c.maxT >= CORE_T));
});

test('approach: a core 20 km SW moving NE at 40 km/h arrives on its track', () => {
  const g = blobs([[-14.1, -14.1, 2, 0.8]]);
  const cores = findCores(g);
  const motion = { vxKmh: 28.3, vyKmh: 28.3, speedKmh: 40, headingDeg: 45 };
  const ap = approach({ cores, motion, site: SITE });
  assert.equal(ap.status, 'arriving');
  assert.equal(ap.fromDir, 'SW');
  assert.equal(ap.headingDir, 'NE');
  // Distance 20 km less the reach (1.5 km) and the core radius, at 40 km/h.
  const expect = ((20 - 1.5 - cores[0].radiusKm) / 40) * 60;
  assert.ok(Math.abs(ap.etaMin - expect) < 2.5, `${ap.etaMin} vs ${expect}`);
  const tx = approachText(ap, fmt);
  assert.equal(tx.level, 'attention');
  assert.match(tx.text, /on this track reaches the hotel in about \d+ min/);
  assert.match(tx.text, /observed motion/);
  assert.deepEqual(bannedWordHits(tx.text), []);
});

test('approach: moving away, passing to one side, over the site, no motion', () => {
  const sw = findCores(blobs([[-14, -14, 2, 0.8]]));
  const away = approach({
    cores: sw,
    motion: { vxKmh: -28, vyKmh: -28, speedKmh: 40, headingDeg: 225 },
    site: SITE,
  });
  assert.equal(away.status, 'receding');
  const west = findCores(blobs([[-30, -15, 2, 0.6]]));
  const passing = approach({
    cores: west,
    motion: { vxKmh: 0, vyKmh: 40, speedKmh: 40, headingDeg: 0 },
    site: SITE,
  });
  assert.equal(passing.status, 'passing');
  assert.ok(passing.cpaKm > 25 && passing.cpaKm < 35, `${passing.cpaKm}`);
  const over = approach({
    cores: findCores(blobs([[0.5, 0.3, 2, 0.9]])),
    motion: null,
    site: SITE,
  });
  assert.equal(over.status, 'over');
  assert.match(approachText(over, fmt).text, /over the hotel now/);
  const unknown = approach({ cores: sw, motion: null, site: SITE });
  assert.equal(unknown.status, 'unknown');
  assert.match(approachText(unknown, fmt).text, /motion not measured/);
  const none = approachText(
    approach({ cores: [], motion: null, site: SITE }),
    fmt,
  );
  assert.equal(none.status, 'none');
  for (const t of [away, passing, unknown].map(
    (a) => approachText(a, fmt).text,
  ))
    assert.deepEqual(bannedWordHits(t), [], t);
});

test('ETAs read in plain steps', () => {
  assert.equal(etaText(0.4), 'now');
  assert.equal(etaText(12.4), 'about 12 min');
  assert.equal(etaText(33), 'about 35 min');
  assert.equal(etaText(57), 'about 55 min');
});

test('projection moves the field along the motion and says so', () => {
  const g = blobs([[-20, 0, 3, 0.8]], 1000);
  const m = { vxKmh: 30, vyKmh: 0, speedKmh: 30, headingDeg: 90 };
  const p = projectGrid(g, m, 20);
  assert.equal(p.projected, true);
  assert.equal(p.t, 1000 + 20 * 60e3);
  const c = findCores(p)[0];
  assert.ok(Math.abs(toKm(SITE, c).x + 10) < 1.5, `${toKm(SITE, c).x}`);
});

test('simulated storm: heavy core arrives about 30 min after the start, then passes', () => {
  const start = Date.UTC(2026, 9, 16, 2, 0);
  const at = (min) =>
    simulatedStorm({
      center: SITE,
      bbox: BOX,
      w: W,
      h: W,
      tMs: start + min * 60e3,
      startMs: start,
    });
  const motion = simulatedMotion();
  const ap0 = approach({ cores: findCores(at(0)), motion, site: SITE });
  assert.equal(ap0.status, 'arriving');
  assert.ok(ap0.etaMin > 22 && ap0.etaMin < 34, `${ap0.etaMin}`);
  assert.ok(['heavy', 'intense'].includes(ap0.core.band));
  assert.equal(at(0).simulated, true);
  const ap1 = approach({ cores: findCores(at(33)), motion, site: SITE });
  assert.equal(ap1.status, 'over');
  const ap2 = approach({ cores: findCores(at(75)), motion, site: SITE });
  assert.notEqual(ap2.status, 'arriving');
  const sim = approachText(ap0, { ...fmt, simulated: true });
  assert.match(sim.text, /^SIMULATED · /);
  const strikes = simulatedStormStrikes(findCores(at(0)), start);
  assert.ok(
    strikes.length > 0 && strikes.every((s) => s.ageMin >= 0 && s.ageMin < 9),
  );
});

test('warning areas: point in ring, multipolygons, simulated box covers the site', () => {
  const sq = [
    [-98, 30],
    [-97, 30],
    [-97, 31],
    [-98, 31],
    [-98, 30],
  ];
  assert.equal(pointInRing({ lat: 30.26, lon: -97.74 }, sq), true);
  assert.equal(pointInRing({ lat: 29.9, lon: -97.74 }, sq), false);
  const multi = {
    type: 'MultiPolygon',
    coordinates: [
      [sq],
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    ],
  };
  assert.equal(outerRings(multi).length, 2);
  assert.equal(insideAny({ lat: 30.5, lon: -97.5 }, outerRings(multi)), true);
  const start = 0;
  const ring = simulatedWarningRing(SITE, start + 5 * 60e3, start);
  assert.equal(pointInRing(SITE, ring), true);
});

test('lightning: nearest point and its trend', () => {
  const n = nearestPoint(SITE, [
    { lat: 30.3, lon: -97.8 },
    { lat: 30.1, lon: -97.5 },
  ]);
  assert.equal(n.dir, 'NW');
  assert.ok(n.distKm > 6 && n.distKm < 8);
  assert.equal(trendOf(12, 8), 'closing');
  assert.equal(trendOf(8, 12), 'moving away');
  assert.equal(trendOf(8, 8.5), 'steady');
  assert.equal(trendOf(null, 8), null);
});
