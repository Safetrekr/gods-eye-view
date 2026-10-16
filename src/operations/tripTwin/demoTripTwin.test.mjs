import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tripTwinDemoSnapshot } from './demoTripTwin.js';
import { demoSnapshot } from '../demo.js';
import { TWIN_CITIES } from './twinCities.js';
import {
  assessSnapshot,
  makeProjector,
  parseOverpassElements,
  projectBuildings,
  selectHotelFootprint,
  bannedWordHits,
} from './twinData.js';

const fixture = (city, kind) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../scripts/fixtures/trip-twin/${city}.${kind}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  );

function hotelFor(cityKey) {
  const city = TWIN_CITIES[cityKey];
  const f = fixture(cityKey, 'overpass');
  const projector = makeProjector(city.center);
  const parsed = parseOverpassElements(f.elements);
  const projected = projectBuildings(parsed.buildings, projector, city.center);
  const sel = selectHotelFootprint(
    projected.buildings,
    parsed.hotels,
    { ...city.center, osm_id: city.osm },
    projector,
  );
  return {
    hotel: { xy: sel.building.xy[0], approximate: sel.approximate },
    projector,
  };
}

const snap = (city, scenario) =>
  tripTwinDemoSnapshot(city, scenario, {
    now: Date.now(),
    pois: fixture(city, 'pois').pois,
  });

test('envelope keys match demoSnapshot() and every participant uses Core field names', () => {
  const s = snap('austin', 'baseline');
  for (const key of Object.keys(demoSnapshot()))
    assert.ok(key in s, `missing ${key}`);
  assert.equal(s.participants.length, 27);
  assert.equal(s.participants.filter((p) => p.role === 'chaperone').length, 3);
  for (const p of s.participants) {
    for (const k of [
      'capturedAt',
      'locationAgeSeconds',
      'freshness',
      'isFresh',
      'accuracy_m',
      'group_zone_state',
    ])
      assert.ok(k in p, `${p.name} missing ${k}`);
    assert.ok(!('phone' in p) && !('email' in p) && !('altitude' in p));
  }
});

test('Demo A hero counts at 02:14 match PROJECT-PLAN §7.3 exactly', () => {
  const s = snap('austin', 'a');
  const { hotel, projector } = hotelFor('austin');
  const r = assessSnapshot(s, hotel, projector, {
    reportedLabel: s.reported_incidents[0].floor_label,
  });
  assert.equal(
    r.rosterText,
    'Inside (likely) 3 · At hotel, undetermined 5 · Outside, nearby 16 · Away 0 · Not current 2 · Not located 1 · of 27 loaded',
  );
  assert.equal(
    r.zone.text,
    'Outside group zone 0 · Unaccompanied 0 · Zone unknown 3',
  );
  assert.equal(
    r.partitionText,
    'Above 0 · At or near 2 · Below 3 · Last est. only 1 · Floor unknown 2 · Not shared 0 · No floor (not at hotel) 19 · of 27 loaded',
  );
  const pri = r.partition.priority
    .map((id) => s.participants.find((p) => p.id === id).name)
    .sort();
  assert.deepEqual(pri, ['Aron Kim', 'Maya Ruiz']);
  const mr = s.participants.find((p) => p.name === 'Maya Ruiz').floor_estimate;
  assert.deepEqual(
    [mr.label_likely, mr.label_low, mr.label_high, mr.confidence],
    [10, 9, 11, 'high'],
  );
  const ak = s.participants.find((p) => p.name === 'Aron Kim').floor_estimate;
  assert.deepEqual(
    [ak.label_likely, ak.label_low, ak.label_high, ak.moving],
    [9, 8, 10, 'descending'],
  );
});

test('baseline covers the position states and the floor unknown reasons', () => {
  const s = snap('austin', 'baseline');
  const { hotel, projector } = hotelFor('austin');
  const r = assessSnapshot(s, hotel, projector);
  const states = new Set(r.rows.map((x) => x.pos.id));
  for (const id of [
    'POS-01',
    'POS-02',
    'POS-03',
    'POS-04',
    'POS-05',
    'POS-06',
    'POS-06b',
  ])
    assert.ok(states.has(id), id);
  const reasons = new Set(r.rows.map((x) => x.floor.reason).filter(Boolean));
  for (const k of [
    'no_barometer',
    'no_anchor',
    'anchor_too_old',
    'sensor_jump',
    'inconsistent_with_building',
  ])
    assert.ok(reasons.has(k), k);
  assert.ok(r.rows.some((x) => x.floor.kind === 'not_shared'));
  assert.equal(r.counts['Not located'], 1);
  assert.equal(
    r.rosterText,
    'Inside (likely) 15 · At hotel, undetermined 3 · Outside, nearby 1 · Away 3 · Not current 4 · Not located 1 · of 27 loaded',
  );
  const sum = Object.values(r.counts).reduce((a, b) => a + b, 0);
  assert.equal(sum, 27);
});

test('every city builds a snapshot whose roster sums to the loaded count', () => {
  for (const city of ['austin', 'dc', 'london']) {
    const s = snap(city, 'baseline');
    const { hotel, projector } = hotelFor(city);
    const r = assessSnapshot(s, hotel, projector);
    assert.equal(
      Object.values(r.counts).reduce((a, b) => a + b, 0),
      27,
      city,
    );
    assert.ok(
      s.safety_points.some((p) => p.category === 'hospital'),
      `${city} hospital`,
    );
    assert.ok(
      !s.safety_points.some((p) => p.category === 'pharmacy'),
      `${city} pharmacy gap`,
    );
  }
});

test('no banned words in names, labels or geofences', () => {
  const s = snap('austin', 'a');
  const text = JSON.stringify([
    s.safety_points.map((p) => p.name),
    s.geofences.map((g) => g.name),
    s.places,
  ]);
  assert.deepEqual(bannedWordHits(text), []);
});
