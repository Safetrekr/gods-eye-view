// Phase 12 · see it coming (revised after review/phase12): exact palette
// decoding, storm-echo motion, cores (size and persistence), per-pixel
// arrival from now, the simulated storm, contours, warning areas, wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_DBZ,
  approach,
  approachNow,
  approachText,
  bandOf,
  boxKm,
  cellKm,
  etaRange,
  findCores,
  hasMotion,
  insideAny,
  makeGrid,
  motionVector,
  nearestPoint,
  outerRings,
  persistent,
  pointInRing,
  projectGrid,
  rgbaToDbz,
  simulatedMotion,
  simulatedStorm,
  simulatedStormStrikes,
  simulatedWarningRing,
  toKm,
  trendOf,
} from './twinNowcast.js';
import { eetKft, n0qDbz } from './twinRadarPalette.js';
import { chaikin, signedArea, traceAreas } from './twinContours.js';
import { bannedWordHits } from './twinData.js';

const SITE = { lat: 30.2622, lon: -97.7382 }; // Fairmont Austin
const BOX = boxKm(SITE, 160);
const W = 160; // 1 km cells for the tests
const fmt = {
  dist: (m) => `${(m / 1000).toFixed(1)} km`,
  speed: (k) => `${Math.round(k)} km/h`,
  siteNoun: 'hotel',
  frame: '21:25 CDT',
  frameAge: 3,
  source: 'radar',
  boxText: '80 km',
  nearText: '10 km',
};

/** A dBZ grid with Gaussian cells at (east km, north km): [x, y, sigma, peak]. */
function cells(list, t = 0) {
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
          20 +
            (peak - 20) *
              Math.exp(-((ex - bx) ** 2 + (ny - by) ** 2) / (2 * s * s)),
        );
      if (v >= 21) data[y * W + x] = v;
    }
  return g;
}

test('exact palette: n0q colours decode to dBZ; echo tops to kft', () => {
  assert.equal(n0qDbz(17, 209, 23), 22); // green: light rain
  assert.equal(n0qDbz(255, 226, 0), 40); // yellow: a core starts
  assert.equal(n0qDbz(248, 0, 0), 50); // red: heavy
  assert.equal(n0qDbz(133, 113, 143), -32); // grey clear air, never a core
  assert.equal(eetKft(69, 104, 166), 7);
  assert.equal(eetKft(255, 0, 0), 50);
  const px = new Uint8ClampedArray([
    133, 113, 143, 255, 17, 209, 23, 255, 248, 0, 0, 255,
  ]);
  const d = rgbaToDbz(px, 3, 1, n0qDbz);
  assert.equal(d[0], 0, 'below 20 dBZ is not rain');
  assert.equal(bandOf(d[1]), 'light');
  assert.equal(bandOf(d[2]), 'heavy');
});

test('motion: storm echo moved 10 km east and 5 km north in 20 min', () => {
  const a = cells(
    [
      [-30, -20, 4, 55],
      [-10, -35, 5, 48],
      [20, 10, 3, 52],
    ],
    0,
  );
  const b = cells(
    [
      [-20, -15, 4, 55],
      [0, -30, 5, 48],
      [30, 15, 3, 52],
    ],
    20 * 60e3,
  );
  const m = motionVector(a, b);
  assert.ok(hasMotion(m), JSON.stringify(m));
  assert.ok(Math.abs(m.vxKmh - 30) < 4, `vx ${m.vxKmh}`);
  assert.ok(Math.abs(m.vyKmh - 15) < 4, `vy ${m.vyKmh}`);
});

test('motion: light echo (birds, clear air) never sets the motion', () => {
  const a = cells([[-20, 0, 30, 32]], 0);
  const b = cells([[-10, 0, 30, 32]], 20 * 60e3);
  const m = motionVector(a, b);
  assert.equal(hasMotion(m), false);
  assert.match(m.unmeasured, /too little storm echo/);
});

test('cores: specks are not cores; bands by dBZ; persistence across frames', () => {
  const g = cells([
    [-20, 0, 3, 62],
    [25, 10, 4, 46],
    [5, 5, 0.4, 55],
  ]);
  const cores = findCores(g);
  assert.equal(cores.length, 2, 'the 0.4 km speck is dropped');
  assert.equal(cores[0].band, 'intense');
  assert.equal(cores[1].band, 'moderate');
  assert.ok(cores.every((c) => c.maxDbz >= CORE_DBZ && c.areaKm2 >= 4));
  const older = cells(
    [
      [-23, -1, 3, 60],
      [22, 9, 4, 45],
    ],
    -20 * 60e3,
  );
  const m = { vxKmh: 9, vyKmh: 3, speedKmh: 9.5, headingDeg: 72, dtMin: 20 };
  assert.equal(persistent(cores[0], older, m, g), true);
  const empty = makeGrid(new Float32Array(W * W), W, W, BOX, -20 * 60e3);
  assert.equal(persistent(cores[0], empty, m, g), false);
});

const NE40 = {
  vxKmh: 28.3,
  vyKmh: 28.3,
  speedKmh: 40,
  headingDeg: 45,
  dtMin: 20,
};

test('arrival: within 10 km and over the site, counted from now, as a range', () => {
  const g = cells([[-14.1, -14.1, 2.2, 56]]);
  const cores = findCores(g);
  const ap = approach({ cores, motion: NE40, site: SITE, grid: g });
  assert.equal(ap.status, 'arriving');
  assert.equal(ap.fromDir, 'SW');
  assert.ok(ap.nearMin > 4 && ap.nearMin < 16, `near ${ap.nearMin}`);
  assert.ok(ap.overMin > ap.nearMin, `over ${ap.overMin}`);
  const now = approachNow(ap, 4);
  assert.ok(Math.abs(now.nearMin - Math.max(0, ap.nearMin - 4)) < 1e-9);
  const tx = approachText(now, fmt);
  assert.equal(tx.level, 'attention');
  assert.ok(/min$/.test(tx.lead), tx.lead);
  assert.match(tx.claim, /within 10 km of the hotel in/);
  assert.match(tx.detail, /radar 21:25 CDT, 3 min old, observed motion/);
  assert.deepEqual(bannedWordHits(tx.text), []);
});

test('a squall line is not a circle: the line sweeps over an off-centre site', () => {
  const list = [];
  for (let s = -30; s <= 30; s += 2)
    list.push([-14.1 + s * 0.707 + 10.6, -14.1 - s * 0.707 - 10.6, 2, 52]);
  const g = cells(list);
  const ap = approach({ cores: findCores(g), motion: NE40, site: SITE, grid: g });
  assert.ok(['arriving', 'near'].includes(ap.status), ap.status);
  assert.ok(ap.overMin != null, 'the line passes over the site');
});

test('the worst core leads, not the earliest speck', () => {
  const g = cells([
    [-9, -9, 1.3, 44],
    [-16, -16, 2.5, 58],
  ]);
  const ap = approach({ cores: findCores(g), motion: NE40, site: SITE, grid: g });
  assert.equal(ap.core.band, 'heavy');
  assert.equal(ap.others, 1);
});

test('statuses: moving away, passing, over, near without motion, none', () => {
  const sw = findCores(cells([[-14, -14, 2, 55]]));
  const away = approach({
    cores: sw,
    motion: { vxKmh: -28, vyKmh: -28, speedKmh: 40, headingDeg: 225, dtMin: 20 },
    site: SITE,
  });
  assert.equal(away.status, 'receding');
  const passing = approach({
    cores: findCores(cells([[-30, -15, 2, 46]])),
    motion: { vxKmh: 0, vyKmh: 40, speedKmh: 40, headingDeg: 0, dtMin: 20 },
    site: SITE,
  });
  assert.equal(passing.status, 'passing');
  const over = approach({
    cores: findCores(cells([[0.5, 0.3, 2, 62]])),
    motion: null,
    site: SITE,
  });
  assert.equal(over.status, 'over');
  assert.match(approachText(over, fmt).claim, /over the hotel/);
  const near = approach({
    cores: findCores(cells([[5, 3, 1.5, 48]])),
    motion: { unmeasured: 'one frame' },
    site: SITE,
  });
  assert.equal(near.status, 'near');
  const none = approachText(
    approach({ cores: [], motion: null, site: SITE }),
    fmt,
  );
  assert.equal(none.status, 'none');
  for (const t of [away, passing, over, near].map(
    (a) => approachText(a, fmt).text,
  ))
    assert.deepEqual(bannedWordHits(t), [], t);
  assert.match(
    approachText(away, { ...fmt, positionOnly: true }).detail,
    /no arrival time/,
  );
});

test('arrival ranges', () => {
  assert.equal(etaRange(0), 'now');
  assert.equal(etaRange(3), 'within 5 min');
  assert.equal(etaRange(12), '5–15 min');
  assert.equal(etaRange(25), '20–30 min');
});

test('projection moves the field (and its tops) along the motion', () => {
  const g = cells([[-20, 0, 3, 56]], 1000);
  g.tops = new Float32Array(W * W);
  const p = projectGrid(
    g,
    { vxKmh: 30, vyKmh: 0, speedKmh: 30, headingDeg: 90, dtMin: 20 },
    20,
  );
  assert.equal(p.projected, true);
  assert.equal(p.t, 1000 + 20 * 60e3);
  assert.ok(p.tops instanceof Float32Array);
  assert.ok(Math.abs(toKm(SITE, findCores(p)[0]).x + 10) < 1.5);
});

test('simulated storm: intense core with tops, over the site about 30 min after the start', () => {
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
  const g0 = at(0);
  const ap0 = approach({ cores: findCores(g0), motion, site: SITE, grid: g0 });
  assert.equal(ap0.status, 'arriving');
  assert.equal(ap0.core.band, 'intense');
  assert.ok(ap0.overMin > 18 && ap0.overMin < 36, `over ${ap0.overMin}`);
  assert.ok(Math.max(...g0.tops) > 40, 'simulated echo tops in kft');
  const g1 = at(33);
  assert.equal(
    approach({ cores: findCores(g1), motion, site: SITE, grid: g1 }).status,
    'over',
  );
  assert.ok(simulatedStormStrikes(findCores(g0), start).length > 0);
});

test('contours: one smooth closed outline per area', () => {
  const g = cells([
    [-20, 0, 4, 56],
    [25, 10, 3, 52],
  ]);
  const areas = traceAreas(g.data, g.w, g.h, 45);
  assert.equal(areas.length, 2);
  for (const a of areas) {
    assert.ok(a.loop.length >= 8);
    assert.equal(chaikin(a.loop, 2).length, a.loop.length * 4);
    assert.ok(Math.abs(signedArea(a.loop)) >= a.cells * 0.9);
  }
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
  assert.equal(pointInRing(SITE, simulatedWarningRing(SITE, 5 * 60e3, 0)), true);
});

test('lightning: nearest point; a trend needs more than one 8 km cell', () => {
  const n = nearestPoint(SITE, [
    { lat: 30.3, lon: -97.8 },
    { lat: 30.1, lon: -97.5 },
  ]);
  assert.equal(n.dir, 'NW');
  assert.equal(trendOf(30, 20), 'getting closer');
  assert.equal(trendOf(20, 30), 'moving away');
  assert.equal(trendOf(12, 8), 'steady');
  assert.equal(trendOf(null, 8), null);
});

test('QA D11: a direct track past the horizon is not "passing 0.0 mi"', () => {
  const w = 320;
  const grid = makeGrid(new Float32Array(w * w), w, w, boxKm({ lat: 30, lon: -97 }, 160), 0);
  const site = { lat: 30, lon: -97 };
  const core = { lat: 30 - 70 / 111.32, lon: -97, band: 'heavy', maxDbz: 52, pixels: [] };
  // A ring of pixels 4 km round the core centre, 70 km south of the site.
  const ck = cellKm(grid);
  const cx = w / 2;
  const cy = w / 2 + Math.round(70 / ck.y);
  for (let dy = -6; dy <= 6; dy++)
    for (let dx = -6; dx <= 6; dx++)
      if (dx * dx + dy * dy <= 36) core.pixels.push((cy + dy) * w + cx + dx);
  const motion = { vxKmh: 0, vyKmh: 20, speedKmh: 20, headingDeg: 0, score: 0.9 };
  const ap = approach({ cores: [core], motion, site, grid });
  assert.equal(ap.status, 'passing');
  assert.equal(ap.beyondMin, 120);
  const t = approachText(ap, { dist: (m) => `${(m / 1000).toFixed(1)} km`, speed: (k) => `${k} km/h`, siteNoun: 'hotel', frame: '20:00', source: 'radar' });
  assert.match(t.claim, /more than 2 h away/);
});
