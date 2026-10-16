// SOC multi-view (phase 10): Trips on watch tiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_TRIPS,
  sortTiles,
  tripDays,
  tripForCity,
  tripTile,
} from './demoTrips.js';
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
  assert.match(sorted[0].incident, /floor 9 · not verified/);
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
