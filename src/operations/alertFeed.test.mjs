import test from 'node:test';
import assert from 'node:assert/strict';
import { fireAlertAreas } from '../data/fireAlertAreas.js';
import { buildAlertFeed, tripReferences } from './alertFeed.js';
import { snapshotHasValidScope } from './access.js';
import { demoSnapshot } from './demo.js';

const now = Date.parse('2026-09-15T12:00:00Z');
const snapshot = () => ({
  trips: [{ id: 'a', title: 'Trip A' }],
  participants: [],
  places: [{ trip_id: 'a', coordinates: { lat: 0, lng: 179.9 } }],
  itinerary: [],
  safety_points: [],
  alerts: [],
  geofence_events: [],
  source_issues: [],
});
const world = () => ({
  earthquakes: [],
  fires: [],
  feeds: {
    earthquakes: { enabled: true, stats: {} },
    fires: { enabled: true, stats: {} },
  },
});
const quake = (id, lat, lon, timeMs = now) => ({
  id,
  lat,
  lon,
  magnitude: 5,
  timeMs,
  depthKm: 10,
});

test('near-trip matching wraps the date line and excludes distant and expired earthquakes', () => {
  const data = world();
  data.earthquakes = [
    quake('near', 0, -179.9),
    quake('far', 40, 0),
    quake('old', 0, 179.9, now - 86400001),
    quake('future', 0, 179.9, now + 3600000),
  ];
  const nearby = buildAlertFeed({ snapshot: snapshot(), world: data, now });
  assert.deepEqual(
    nearby.items.map((item) => item.id),
    ['earthquake:near'],
  );
  const global = buildAlertFeed({
    snapshot: snapshot(),
    world: data,
    now,
    mode: 'worldwide',
  });
  assert.equal(global.items.length, 2);
  assert.equal(
    global.items.find((item) => item.id === 'earthquake:far').tripIds.length,
    0,
  );
});

test('stale or foreign participant locations cannot become trip references', () => {
  const data = snapshot();
  data.places = [];
  data.participants = [
    {
      trip_id: 'a',
      coordinates: { lat: 0, lng: 0 },
      freshness: 'fresh',
      locationAgeSeconds: 110,
      freshMaxAgeSeconds: 120,
      staleAgeSeconds: 600,
    },
    {
      trip_id: 'foreign',
      coordinates: { lat: 1, lng: 1 },
      freshness: 'fresh',
      locationAgeSeconds: 0,
      freshMaxAgeSeconds: 120,
      staleAgeSeconds: 600,
    },
  ];
  assert.equal(tripReferences(data, 0).length, 1);
  assert.equal(tripReferences(data, 20).length, 0);
  assert.match(
    buildAlertFeed({ snapshot: data, now, elapsedSeconds: 20 }).notices.join(
      ' ',
    ),
    /No usable trip reference/,
  );
});

test('fire aggregation includes weak detections beyond a strongest-2000 cap, groups passes, and uses stable ids', () => {
  const records = Array.from({ length: 2200 }, (_, i) => ({
    lat: 45,
    lon: 5,
    acqMs: now - i,
    frp: 100,
  }));
  records.push({ lat: 0, lon: 179.9, acqMs: now, frp: 0.1 });
  const areas = fireAlertAreas(records);
  assert.equal(areas.length, 2);
  assert.equal(areas.find((area) => area.count === 2200).radiusKm, 8);
  assert.deepEqual(fireAlertAreas([...records].reverse()), areas);
  const data = world();
  data.fires = areas;
  const result = buildAlertFeed({ snapshot: snapshot(), world: data, now });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].kind, 'fire');
  assert.match(result.items[0].body, /1 observation/);
});

test('recorded trip transitions are scoped, deduplicated, and never generated from outside coordinates', () => {
  const data = snapshot();
  data.participants = [
    { id: 'p', trip_id: 'a', name: 'Alex', group_zone_state: 'outside' },
  ];
  assert.equal(
    buildAlertFeed({ snapshot: data, world: world(), now }).items.length,
    0,
  );
  const event = {
    id: 'e',
    trip_id: 'a',
    participant_id: 'p',
    direction: 'exit',
    timestamp: new Date(now).toISOString(),
  };
  data.geofence_events = [
    event,
    event,
    { ...event, id: 'foreign', trip_id: 'b' },
    { ...event, id: 'back', direction: 'enter' },
  ];
  const result = buildAlertFeed({ snapshot: data, world: world(), now });
  assert.equal(result.items.length, 2);
  assert.match(result.items[0].title, /Alex left the geofence/);
  assert.match(result.items[1].title, /re-entered/);
  data.geofence_events[3].timestamp = new Date(now + 60000).toISOString();
  const cleared = buildAlertFeed({
    snapshot: data,
    world: world(),
    now,
  }).items.find((item) => item.id.endsWith(':e'));
  assert.equal(cleared.priority, 0);
  assert.match(cleared.body, /later re-entry was recorded/);
});

test('group directions require recorded action metadata, not a matching headline', () => {
  const data = snapshot();
  data.alerts = [
    {
      id: '1',
      trip_id: 'a',
      headline: 'Go to SafeHouse',
      created_at: new Date(now).toISOString(),
    },
  ];
  assert.equal(
    buildAlertFeed({ snapshot: data, world: world(), now }).items[0].kind,
    'alert',
  );
  data.alerts[0].operations_event = { kind: 'group_direction' };
  assert.equal(
    buildAlertFeed({ snapshot: data, world: world(), now }).items[0].kind,
    'direction',
  );
});

test('old Core snapshots remain compatible while foreign geofence event rows fail closed', () => {
  const data = demoSnapshot();
  assert.equal(snapshotHasValidScope(data), true);
  delete data.geofence_events;
  assert.equal(snapshotHasValidScope(data), true);
  assert.match(
    buildAlertFeed({ snapshot: data, world: world() }).notices.join(' '),
    /pending Core update/,
  );
  data.geofence_events = [{ trip_id: 'foreign' }];
  assert.equal(snapshotHasValidScope(data), false);
});

test('off, failed and incomplete sources are explicit instead of an all-clear', () => {
  const data = snapshot();
  data.source_issues = [{ source: 'geofence_violations', reason: 'row_limit' }];
  const sources = world();
  sources.feeds.fires.stats = { error: 'offline', stale: true };
  sources.feeds.earthquakes.enabled = false;
  const result = buildAlertFeed({ snapshot: data, world: sources, now });
  assert.match(result.notices.join(' '), /Geofence history is incomplete/);
  assert.match(result.notices.join(' '), /Earthquakes layer is off/);
  assert.match(result.notices.join(' '), /Active fires feed is delayed/);
});
