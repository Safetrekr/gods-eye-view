import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProjector, setDistanceUnit } from './twinData.js';
import {
  FIRE_RULES,
  ageText,
  assessFires,
  fireLines,
  nearestFire,
  tropicalHeadline,
  assessTropical,
  attributeHeat,
  distanceToPolygonsM,
  fireHeadline,
  fireStatusLine,
  hazardCoverage,
  hazardFeedState,
  hazardPicture,
  pathAgainstBoundary,
  pointInPolygons,
  tropicalLines,
  tropicalStatusLine,
} from './twinHazards.js';
import {
  simulatedFire,
  simulatedHurricane,
  SIM_FIRE_REMAP_MS,
} from './twinHazardSim.js';

setDistanceUnit('m');
const AUSTIN = { lat: 30.2655, lon: -97.7437 };
const LONDON = { lat: 51.5072, lon: -0.1276 };
const DC = { lat: 38.8977, lon: -77.0365 };
const NOW = Date.parse('2026-10-26T21:00:00Z');
const proj = makeProjector(AUSTIN);

/** A square fire boundary `half` m across, centred `east` m E and `north` m N. */
function squareFire(east, north, half, extra = {}) {
  const c = [
    [east - half, north - half],
    [east + half, north - half],
    [east + half, north + half],
    [east - half, north + half],
    [east - half, north - half],
  ].map(([x, y]) => {
    const p = proj.toLL(x, y);
    return [p.lon, p.lat];
  });
  return {
    stableId: `f-${east}-${north}`,
    name: 'Cedar',
    acres: 4210,
    containedPct: 15,
    category: 'WF',
    updatedTime: NOW - 6 * 3600e3,
    polygons: [[c]],
    ...extra,
  };
}
const ctx = (extra = {}) => ({
  center: AUSTIN,
  stops: [],
  people: [],
  ...extra,
});

test('pointInPolygons respects holes', () => {
  const outer = squareFire(0, 0, 2000).polygons[0][0];
  const hole = squareFire(0, 0, 500).polygons[0][0];
  assert.equal(pointInPolygons(AUSTIN, [[outer]]), true);
  assert.equal(pointInPolygons(AUSTIN, [[outer, hole]]), false);
  assert.ok(distanceToPolygonsM(AUSTIN, [[outer, hole]]) > 400);
});

test('fire levels: inside (with the 200 m edge allowance), near at 5 km, area to 50 km', () => {
  const level = (row) => assessFires([row], ctx(), NOW)[0]?.level ?? 'none';
  assert.equal(level(squareFire(0, 0, 1000)), 'inside');
  assert.equal(level(squareFire(1150, 0, 1000)), 'inside'); // 150 m from the edge
  assert.equal(level(squareFire(5000, 0, 1000)), 'near'); // 4 km
  assert.equal(level(squareFire(21000, 0, 1000)), 'area'); // 20 km
  assert.equal(level(squareFire(60000, 0, 1000)), 'none');
});

test('upwind is null without wind, and lifts a fire within 25 km to near', () => {
  const row = squareFire(-16000, 0, 1000); // 15 km W
  assert.equal(assessFires([row], ctx(), NOW)[0].upwind, null);
  const west = assessFires(
    [row],
    ctx({ windFromDeg: 270, windKmh: 22 }),
    NOW,
  )[0];
  assert.equal(west.upwind, true);
  assert.equal(west.level, 'near');
  const east = assessFires(
    [row],
    ctx({ windFromDeg: 90, windKmh: 22 }),
    NOW,
  )[0];
  assert.equal(east.upwind, false);
  assert.equal(east.level, 'area');
});

test('a prescribed burn or a fully contained fire caps at area, unless inside', () => {
  const near = squareFire(5000, 0, 1000, { category: 'RX' });
  assert.equal(assessFires([near], ctx(), NOW)[0].level, 'area');
  const done = squareFire(5000, 0, 1000, { containedPct: 100 });
  assert.equal(assessFires([done], ctx(), NOW)[0].level, 'area');
  const inside = squareFire(0, 0, 1000, { containedPct: 100 });
  assert.equal(assessFires([inside], ctx(), NOW)[0].level, 'inside');
});

test('people inside or within 1 km of a boundary are named for Needs attention', () => {
  const row = squareFire(8000, 0, 1000);
  const people = [
    { id: 'p1', name: 'A', ...proj.toLL(8000, 0) },
    { id: 'p2', name: 'B', ...proj.toLL(9600, 0) },
    { id: 'p3', name: 'C', ...proj.toLL(0, 0) },
  ];
  const [f] = assessFires([row], ctx({ people }), NOW);
  assert.deepEqual(f.peopleIn, ['p1']);
  assert.deepEqual(f.peopleNear, ['p2']);
  assert.equal(f.level, 'inside');
});

test('a boundary mapped more than a day ago may have grown', () => {
  const row = squareFire(5000, 0, 1000, { updatedTime: NOW - 30 * 3600e3 });
  const [f] = assessFires([row], ctx(), NOW);
  assert.equal(f.mayHaveGrown, true);
});

test('a path can cross a boundary with no vertex inside', () => {
  const row = squareFire(0, 3000, 400);
  const a = proj.toLL(-2000, 3000);
  const b = proj.toLL(2000, 3000);
  assert.equal(
    pathAgainstBoundary(
      [
        [a.lon, a.lat],
        [b.lon, b.lat],
      ],
      row.polygons,
    ),
    'crosses',
  );
  const c = proj.toLL(-2000, 3900);
  const d = proj.toLL(2000, 3900);
  assert.equal(
    pathAgainstBoundary(
      [
        [c.lon, c.lat],
        [d.lon, d.lat],
      ],
      row.polygons,
    ),
    'near',
  );
  const e = proj.toLL(-2000, 6000);
  const f = proj.toLL(2000, 6000);
  assert.equal(
    pathAgainstBoundary(
      [
        [e.lon, e.lat],
        [f.lon, f.lat],
      ],
      row.polygons,
    ),
    null,
  );
});

test('heat detections inside or within 1 km of a boundary count once, under that fire', () => {
  const row = squareFire(8000, 0, 1000);
  const at = (x, y) => ({ ...proj.toLL(x, y) });
  const { byFire, outside } = attributeHeat(
    [at(8000, 0), at(9500, 0), at(3000, 0)],
    [row, squareFire(8000, 0, 1200, { stableId: 'dup' })],
  );
  assert.equal(
    [...byFire.values()].reduce((a, b) => a + b, 0),
    2,
  );
  assert.equal(outside.length, 1);
});

test('coverage: Austin and Washington have both feeds; London has neither', () => {
  assert.deepEqual(hazardCoverage(AUSTIN), { fire: true, tropical: true });
  assert.deepEqual(hazardCoverage(DC), { fire: true, tropical: true });
  assert.deepEqual(hazardCoverage(LONDON), { fire: false, tropical: false });
});

test('feed state never reads live without data; status lines never say none when not checked', () => {
  assert.equal(hazardFeedState(null, NOW, 1), 'loading');
  assert.equal(
    hazardFeedState({ status: 'error', hasData: false }, NOW, 1),
    'unavailable',
  );
  const live = {
    status: 'ok',
    hasData: true,
    ageAtReceiveMs: 60e3,
    receivedAt: NOW,
  };
  assert.equal(hazardFeedState(live, NOW, 30 * 60e3), 'live');
  assert.equal(hazardFeedState(live, NOW + 40 * 60e3, 30 * 60e3), 'stale');
  const cov = hazardCoverage(AUSTIN);
  const down = fireStatusLine({ state: 'unavailable', coverage: cov });
  assert.match(down, /not checked/);
  assert.doesNotMatch(down, /No fire boundary/);
  assert.match(
    fireStatusLine({ state: 'live', coverage: cov, ageMs: 60e3 }),
    /No fire boundary within 50 km of the hotel · US fires only/,
  );
  assert.match(
    fireStatusLine({ state: 'live', coverage: hazardCoverage(LONDON) }),
    /not covered here/,
  );
  assert.match(
    tropicalStatusLine({
      state: 'live',
      coverage: hazardCoverage(LONDON),
      storms: [],
    }),
    /not covered here/,
  );
});

test('the demo fire is near, never inside; re-mapped closer at +10 min; every record SIMULATED', () => {
  const t0 = NOW;
  const first = simulatedFire(AUSTIN, t0, t0 + 60e3);
  const again = simulatedFire(AUSTIN, t0, t0 + 60e3);
  assert.deepEqual(first, again);
  const a = assessFires([first.row], ctx(), t0 + 60e3)[0];
  assert.equal(a.level, 'near');
  assert.ok(a.dHotel > 3000 && a.dHotel < 5000, `edge ${a.dHotel}`);
  const later = simulatedFire(AUSTIN, t0, t0 + SIM_FIRE_REMAP_MS + 1);
  const b = assessFires([later.row], ctx(), t0 + SIM_FIRE_REMAP_MS + 1)[0];
  assert.ok(
    b.dHotel < a.dHotel && b.dHotel > FIRE_RULES.insideEdgeM,
    `edge ${b.dHotel}`,
  );
  assert.ok(b.mappedAgoMs < a.mappedAgoMs + 60e3);
  assert.match(fireHeadline(b), /^SIMULATED · Demo Fire boundary/);
  const { byFire, outside } = attributeHeat(later.heat, [later.row]);
  assert.equal(byFire.get(later.row.stableId), 4);
  assert.equal(outside.length, 1);
  assert.ok(later.heat.every((h) => h.simulated));
});

test('the demo hurricane puts the cone over the hotel; forecast times come from issuedAt', () => {
  const storm = simulatedHurricane(AUSTIN, NOW);
  const [t] = assessTropical([storm], ctx());
  assert.equal(t.level, 'cone');
  assert.equal(t.title, 'Hurricane Demo');
  // Read the same storm a day later: the 36 h point is now 12 h away.
  const lines = tropicalLines(t, NOW + 24 * 3600e3).map((l) => l.text);
  assert.ok(
    lines.some((l) => /in 12 h/.test(l)),
    lines.join(' | '),
  );
  assert.match(
    lines[0],
    /^SIMULATED · Hurricane Demo · the forecast cone covers the hotel/,
  );
});

test('hazardPicture: worst word, SIMULATED suffix, people near a fire', () => {
  const sim = simulatedFire(AUSTIN, NOW, NOW + 60e3);
  const fires = assessFires([sim.row], ctx(), NOW + 60e3);
  const pic = hazardPicture({
    fires,
    tropical: [],
    coverage: hazardCoverage(AUSTIN),
    firesFeed: {
      status: 'ok',
      hasData: true,
      ageAtReceiveMs: 0,
      receivedAt: NOW,
    },
    tropicalFeed: {
      status: 'ok',
      hasData: true,
      ageAtReceiveMs: 0,
      receivedAt: NOW,
    },
    storms: [],
    now: NOW + 60e3,
    demo: { fire: true },
  });
  assert.equal(pic.word, 'FIRE NEAR (SIMULATED)');
  assert.equal(pic.badge, 'FIRE NEAR');
  assert.equal(pic.check, true);
  assert.match(pic.fireStatus, /^Real NIFC under the demo/);
});

test('X3: a person within 1 km makes a far fire near, with a headline that says so', () => {
  const row = squareFire(30000, 0, 1000); // 29 km from the hotel
  const people = [{ id: 'p1', name: 'A', ...proj.toLL(31600, 0) }];
  const [f] = assessFires([row], ctx({ people }), NOW);
  assert.equal(f.level, 'near');
  assert.deepEqual(f.peopleNear, ['p1']);
  assert.match(
    fireHeadline(f),
    /^1 person within 1 km of the Cedar Fire boundary/,
  );
  const done = squareFire(30000, 0, 1000, { containedPct: 100 });
  assert.equal(assessFires([done], ctx({ people }), NOW)[0].level, 'near');
});

test('X34: a fire near because of a stop names the stop', () => {
  const row = squareFire(20000, 0, 1000);
  const stops = [{ label: 'Long Center', ...proj.toLL(16000, 0) }];
  const [f] = assessFires([row], ctx({ stops }), NOW);
  assert.equal(f.level, 'near');
  assert.match(
    fireHeadline(f),
    /km E of the hotel · [\d.]+ km from Long Center$/,
  );
});

test('X1: a prescribed or contained fire claims heat only at its edge', () => {
  const rx = squareFire(8000, 0, 1000, { category: 'RX' });
  const near = { ...proj.toLL(9600, 0) }; // 600 m outside
  const edge = { ...proj.toLL(9100, 0) }; // 100 m outside
  const { outside } = attributeHeat([near, edge], [rx]);
  assert.equal(outside.length, 1);
});

test('X2: a storm with its shapes pending still counts from where it is now', () => {
  const pos = proj.toLL(0, -150000);
  const storm = {
    id: 'al99',
    name: 'Test',
    classification: 'TS',
    basin: 'AL',
    position: { latitude: pos.lat, longitude: pos.lon },
    issuedAt: new Date(NOW).toISOString(),
    windKt: 50,
    geometryStatus: 'pending',
  };
  const [t] = assessTropical([storm], ctx());
  assert.equal(t.level, 'near');
  assert.equal(t.noShapes, true);
  assert.ok(
    tropicalLines(t, NOW).some((l) => /not available yet/.test(l.text)),
  );
  assert.match(tropicalHeadline(t, NOW), /now 150 km S, winds 93 km\/h/);
  const line = tropicalStatusLine({
    state: 'live',
    coverage: hazardCoverage(AUSTIN),
    storms: [storm],
  });
  assert.doesNotMatch(line, /No forecast within/);
});

test('X4: with a fire and a cone both at amber, the word names both', () => {
  const fire = simulatedFire(AUSTIN, NOW, NOW + 60e3);
  const storm = simulatedHurricane(AUSTIN, NOW);
  const pic = hazardPicture({
    fires: assessFires([fire.row], ctx(), NOW + 60e3),
    tropical: assessTropical([storm], ctx()),
    coverage: hazardCoverage(AUSTIN),
    now: NOW + 60e3,
  });
  assert.equal(pic.word, 'FIRE NEAR + IN FORECAST CONE (SIMULATED)');
});

test('X6, X14: demo provenance never names NIFC or NHC; ages never read as metres', () => {
  const fire = simulatedFire(AUSTIN, NOW, NOW + 60e3);
  const [f] = assessFires([fire.row], ctx(), NOW + 60e3);
  const text = fireLines(f)
    .map((l) => l.text)
    .join(' | ');
  assert.doesNotMatch(text, /NIFC/);
  assert.match(text, /Demo boundary \(SIMULATED\) · drawn 1 min ago/);
  const [t] = assessTropical([simulatedHurricane(AUSTIN, NOW)], ctx());
  assert.doesNotMatch(
    tropicalLines(t, NOW + 60e3)
      .map((l) => l.text)
      .join(' '),
    /NHC advisory/,
  );
  assert.equal(ageText(60e3), '1 min');
  assert.equal(ageText(200 * 60e3), '3 h 20 min');
  assert.equal(ageText(13 * 86400e3), '13 d');
});

test('X30: the nearest fire is measured to its edge, not its box', () => {
  // An L-shaped fire whose box covers the hotel while its edge is 4 km away.
  const L = [
    [4000, -6000],
    [8000, -6000],
    [8000, 6000],
    [-6000, 6000],
    [-6000, 4000],
    [4000, 4000],
    [4000, -6000],
  ].map(([x, y]) => {
    const q = proj.toLL(x, y);
    return [q.lon, q.lat];
  });
  const n = nearestFire(
    [{ stableId: 'L', name: 'Ell', polygons: [[L]] }],
    AUSTIN,
  );
  assert.ok(n.d > 3500 && n.d < 4500, String(n.d));
});

test('round 2 N2: a path through a fire is flagged on path cards and saved paths (X1 regression)', async () => {
  const { pathCards } = await import('./twinHud.js');
  const { pathChecks } = await import('./twinCustomPaths.js');
  const row = squareFire(0, 3000, 400);
  const g = [proj.toLL(-2000, 3000), proj.toLL(2000, 3000)];
  const [card] = pathCards(
    [{ kind: 'primary', distanceM: 4000, walk: [50, 60], geometry: g }],
    { fireBounds: [row] },
  );
  assert.equal(card.flagged, true);
  assert.ok(
    card.lines.some((l) => /^Crosses the Cedar Fire boundary \(NIFC\)/.test(l)),
    card.lines.join(' | '),
  );
  const flags = pathChecks(
    { geometry: g, distanceM: 4000, avoidApplied: true },
    { points: [g[0], g[1]], areas: [], hazards: [], fireBounds: [row] },
  );
  assert.ok(flags.some((f) => f.key === 'fire' && f.warn));
  // No boundary near: no fire line.
  const far = [proj.toLL(-2000, 9000), proj.toLL(2000, 9000)];
  const [calm] = pathCards(
    [{ kind: 'primary', distanceM: 4000, walk: [50, 60], geometry: far }],
    { fireBounds: [row] },
  );
  assert.ok(!calm.lines.some((l) => /boundary/.test(l)));
});
