import test from 'node:test';
import assert from 'node:assert/strict';
import { tripTwinDemoSnapshot } from './demoTripTwin.js';
import {
  computeAnchors,
  siteConfig,
  siteCounts,
  siteCountsLine,
  siteOptionLabel,
  sitesForCity,
} from './twinSites.js';

test('every city has its hotel first, then venues by day', () => {
  for (const city of ['austin', 'dc', 'london']) {
    const s = sitesForCity(city);
    assert.equal(s[0].kind, 'lodging');
    assert.equal(s[0].key, city);
    assert.equal(s.length, 3);
    assert.deepEqual(
      s.slice(1).map((v) => v.day),
      [2, 3],
    );
    for (const v of s) assert.ok(v.anchors?.assembly, `${v.key} anchors`);
  }
  assert.equal(
    siteOptionLabel(siteConfig('austin-long-center')),
    'Long Center (Day 2, 19:00)',
  );
  assert.equal(
    siteOptionLabel(siteConfig('austin')),
    'Fairmont Austin (hotel)',
  );
  assert.equal(siteConfig('nope'), null);
});

test('snapshot carries venue places, itinerary and per-venue safety points', () => {
  const s = tripTwinDemoSnapshot('austin', 'baseline', { elapsed: 0 });
  assert.deepEqual(
    s.places.map((p) => [p.kind, p.site_key]),
    [
      ['lodging', 'austin'],
      ['venue', 'austin-long-center'],
      ['venue', 'austin-capitol'],
    ],
  );
  assert.equal(s.itinerary.length, 2);
  assert.equal(s.itinerary[0].start_time, '19:00');
  for (const v of s.places.filter((p) => p.kind === 'venue'))
    assert.deepEqual(v.room_assignments, [], 'rooming only for lodging');
});

test('Demo B: nobody is dropped from the per-site counts', () => {
  const s = tripTwinDemoSnapshot('austin', 'b', { elapsed: 0 });
  const c = siteCounts(s.participants, sitesForCity('austin'));
  const sum =
    c.bySite.reduce((n, x) => n + x.n, 0) +
    c.between +
    c.elsewhere +
    c.notLocated;
  assert.equal(sum, 27);
  assert.equal(c.bySite.find((x) => x.key === 'austin-long-center').n, 20);
  assert.equal(c.bySite.find((x) => x.key === 'austin').n, 3);
  assert.equal(c.between, 2);
  assert.equal(c.notLocated, 1);
  assert.equal(
    siteCountsLine(c, 'austin-long-center'),
    'Group across 2 sites: Long Center 20 · Fairmont Austin 3 · between sites 2 · elsewhere 1 · not located 1 · of 27',
  );
});

test('anchors: deepest inside point, edge inside the wall, assembly outside', () => {
  // 100 m × 60 m box at the equator-ish (degrees ≈ metres / 111 km).
  const d = (m) => m / 111320;
  const ring = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: d(100) },
    { lat: d(60), lon: d(100) },
    { lat: d(60), lon: 0 },
  ];
  const a = computeAnchors(ring, [], { towardDeg: 0 });
  assert.ok(Math.abs(a.insideClearanceM - 30) < 2);
  assert.ok(a.assembly.lat > d(60) + d(40), 'north of the wall by ≥ 40 m');
  assert.ok(a.edge.lat < d(60) && a.edge.lat > d(48), 'edge 6–10 m inside');
});

test('an incident at another site is never hidden ("No incident" never shown)', async () => {
  const { assessSnapshot, deriveMode, withTripIncidents } =
    await import('./twinData.js');
  const { makeProjector } = await import('./twinData.js');
  const s = tripTwinDemoSnapshot('austin', 'a', { elapsed: 0 });
  const venue = s.places.find((p) => p.site_key === 'austin-long-center');
  const v = siteConfig('austin-long-center');
  const projector = makeProjector(v.center);
  const ring = [
    [-30, -30],
    [30, -30],
    [30, 30],
    [-30, 30],
  ];
  const a = assessSnapshot(s, { xy: ring, approximate: false }, projector, {
    reportedLabel: null,
    placeId: venue.id,
  });
  const base = deriveMode(a, {});
  assert.match(base.topLine, /^No incident reported/);
  const m = withTripIncidents(base, {
    snapshot: s,
    activePlaceId: venue.id,
    siteName: (id) => (id === venue.id ? 'Long Center' : 'Fairmont Austin'),
    rows: a.rows,
  });
  assert.equal(m.chip, 'INCIDENT · OTHER SITE');
  assert.doesNotMatch(m.topLine, /No incident/);
  assert.match(
    m.topLine,
    /^Smoke reported at Fairmont Austin, floor 9 \(hotel desk, not verified\) — \d+ at or above by phone estimate there/,
  );
  assert.equal(m.groups[0].key, 'elsewhere_above');
  assert.ok(m.groups[0].rows.length >= 2, 'M.R. and A.K. by phone estimate');
});
