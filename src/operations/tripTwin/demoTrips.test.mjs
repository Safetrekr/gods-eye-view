// SOC multi-view (phase 10): Trips on watch tiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_TRIPS,
  isTripDemo,
  scenarioForTrip,
  sortTiles,
  tripById,
  tripDays,
  tripForCity,
  tripTile,
} from './demoTrips.js';
import { SCENARIOS } from './demoTripTwin.js';
import { tripTwinDemoSnapshot } from './demoTripTwin.js';
import { bannedWordHits } from './twinData.js';

const NOW = Date.parse('2026-10-16T21:30:00Z');

test('three trips, one per recorded city', () => {
  assert.equal(DEMO_TRIPS.length, 3);
  assert.deepEqual(
    DEMO_TRIPS.map((t) => t.city),
    ['austin', 'dc', 'london'],
  );
  assert.equal(tripForCity('dc').id, 'trip-band-dc');
});

test('tiles: the trip with a reported incident comes first; never "all clear"', () => {
  const tiles = DEMO_TRIPS.map((t) =>
    tripTile(
      t,
      tripTwinDemoSnapshot(t.city, t.scenario, { now: NOW, elapsed: 60 }),
      { now: NOW, dataAgeS: 5 },
    ),
  );
  const sorted = sortTiles(tiles);
  assert.equal(sorted[0].id, 'trip-youth-london');
  assert.match(
    sorted[0].incident,
    /^Fire reported, floor 4 \(hotel desk, .* not verified\)/,
  );
  for (const t of tiles) {
    assert.ok(t.people > 0);
    assert.match(t.localTime, /^\d\d:\d\d$/);
    const text = [t.incident, t.next, t.data].filter(Boolean).join(' ');
    assert.deepEqual(bannedWordHits(text), []);
  }
});

test('a trip with no data is grey and says so; delayed data is flagged', () => {
  const none = tripTile(DEMO_TRIPS[1], null);
  assert.equal(none.noData, true);
  assert.match(none.line, /No data/);
  const late = tripTile(
    DEMO_TRIPS[0],
    tripTwinDemoSnapshot('austin', 'baseline', { now: NOW, elapsed: 60 }),
    { now: NOW, dataAgeS: 600 },
  );
  assert.equal(late.stale, true);
  assert.match(late.data, /delayed/);
});

test('a shared start time gives every screen the same scenario moment', () => {
  const start = NOW - 90_000;
  const a = tripTwinDemoSnapshot('austin', 'baseline', {
    now: NOW,
    startMs: start,
  });
  const b = tripTwinDemoSnapshot('austin', 'baseline', {
    now: NOW,
    startMs: start,
  });
  assert.equal(a.scenario.elapsed_s, 90);
  assert.deepEqual(a.participants, b.participants);
});

test('trip days: every day of the trip with its events, places and flags', () => {
  const t = DEMO_TRIPS[0];
  const snap = tripTwinDemoSnapshot(t.city, t.scenario, {
    now: NOW,
    elapsed: 60,
    pois: [
      {
        kind: 'hospital',
        name: 'General',
        lat: 30.27,
        lon: -97.74,
        emergency: 'yes',
      },
    ],
  });
  const days = tripDays(t, snap);
  assert.ok(days.length >= 3);
  assert.equal(days[0].day, 1);
  assert.match(days[0].events[0].title, /Arrive/);
  assert.ok(days.some((d) => d.events.length > 1 || d.day > 1));
  assert.equal(days[0].sites[0].key, 'austin');
  assert.ok(days[0].sites[0].places.some((p) => p.kind === 'hospital'));
  assert.match(days[0].sunset, /^\d\d:\d\d$/);
  for (const d of days)
    for (const f of d.flags) assert.deepEqual(bannedWordHits(f), []);
});

test('the trip in focus uses the wall’s own counts, clock and report (R3)', () => {
  const t = DEMO_TRIPS[0];
  const snap = tripTwinDemoSnapshot(t.city, t.scenario, {
    now: NOW,
    elapsed: 60,
  });
  const tile = tripTile(t, snap, {
    now: NOW,
    dataAgeS: 5,
    override: {
      notCurrent: 4,
      notLocated: 1,
      localTime: '21:39',
      incident:
        'Smoke reported, floor 9 (operator entry, 2 min ago, not verified)',
    },
  });
  assert.equal(tile.notCurrent, 4);
  assert.equal(tile.localTime, '21:39');
  assert.match(tile.incident, /operator entry/);
  assert.ok(tile.need >= 100, 'an incident sorts first');
  // Without an override: the sample clock, not the real clock.
  const plain = tripTile(t, snap, { now: NOW, dataAgeS: 5 });
  assert.equal(plain.localTime, '21:33');
  assert.doesNotMatch(plain.next, /\d{4}-\d\d-\d\d/);
});

test("S6: one moment for every trip, in each trip's zone; tiers, not a sum", () => {
  const at = Date.parse('2026-10-26T02:32:00Z');
  const tiles = DEMO_TRIPS.map((t) =>
    tripTile(t, tripTwinDemoSnapshot(t.city, t.scenario, { now: NOW }), {
      now: NOW,
      dataAgeS: 5,
      at,
    }),
  );
  const by = Object.fromEntries(tiles.map((t) => [t.id, t]));
  assert.equal(by['trip-youth-london'].localTime, '02:32');
  assert.equal(by['trip-choir-austin'].localTime, '21:32');
  assert.equal(by['trip-band-dc'].localTime, '22:32');
  assert.equal(by['trip-band-dc'].zone, 'EDT');
  // No data sorts right after reports, never last (S6 plan).
  const none = tripTile(DEMO_TRIPS[1], null);
  const calm = { ...by['trip-choir-austin'], tier: 5 };
  const order = sortTiles([calm, none, by['trip-youth-london']]);
  assert.deepEqual(
    order.map((t) => t.id),
    ['trip-youth-london', 'trip-band-dc', 'trip-choir-austin'],
  );
  // By name, the report still leads; the rest by name (S6 r1).
  assert.deepEqual(
    sortTiles(tiles, { order: 'name' }).map((t) => t.title),
    ['Youth choir tour', 'Jazz band trip', 'Spring choir tour'],
  );
});

test('Demo C is the London trip’s extra demo, picked, never its default', () => {
  const london = tripById('trip-youth-london');
  assert.equal(london.scenario, 'a');
  assert.equal(scenarioForTrip(london), 'a');
  assert.equal(scenarioForTrip(london, 'c'), 'c');
  assert.equal(scenarioForTrip(london, 'b'), 'a', 'only its own demos');
  for (const t of DEMO_TRIPS.filter((x) => x !== london))
    assert.equal(scenarioForTrip(t, 'c'), t.scenario, t.id);
  assert.equal(isTripDemo('c'), true);
  for (const k of ['a', 'b', 'baseline', null, ''])
    assert.equal(isTripDemo(k), false);
  // Every trip demo is a scenario of that trip's city.
  for (const t of DEMO_TRIPS)
    for (const d of t.demos || []) assert.equal(SCENARIOS[d].city, t.city);
});

test('London Day 1: Heathrow T5 first, then the hotel', () => {
  const t = tripById('trip-youth-london');
  const snap = tripTwinDemoSnapshot(t.city, 'c', { now: NOW, elapsed: 0 });
  const day1 = tripDays(t, snap)[0];
  assert.deepEqual(
    day1.events.map((e) => [e.start, e.title, e.siteKey]),
    [
      ['07:30', 'Arrival · Heathrow T5', 'london-heathrow-t5'],
      ['15:00', 'Arrive · Park Plaza London Waterloo', 'london'],
    ],
  );
  assert.deepEqual(
    day1.sites.map((x) => x.key),
    ['london-heathrow-t5', 'london'],
  );
  // Other days and other trips keep the hotel first.
  assert.equal(tripDays(t, snap)[1].sites[0].key, 'london');
  const a = DEMO_TRIPS[0];
  const as = tripTwinDemoSnapshot(a.city, a.scenario, { now: NOW, elapsed: 0 });
  for (const d of tripDays(a, as)) assert.equal(d.sites[0].key, 'austin');
});
