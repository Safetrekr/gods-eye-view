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

// Demo C (Jesse, 29 Oct 2026): the London group across Heathrow T5 in
// small groups (meeting point, reclaim belts, café, restrooms); normal,
// nobody away, stale or unlocated.
test('Demo C: all 27 inside Heathrow T5 by the 2× rule, in six small groups, nothing to check', async () => {
  const { siteConfig, siteCounts, sitesForCity } =
    await import('./twinSites.js');
  const { deriveMode } = await import('./twinData.js');
  const key = 'london-heathrow-t5';
  const site = siteConfig(key);
  const s = tripTwinDemoSnapshot('london', 'c', {
    now: Date.now(),
    elapsed: 0,
    pois: fixture('london', 'pois').pois,
    poisBySite: { [key]: fixture(key, 'pois').pois },
  });
  assert.equal(s.scenario.key, 'c');
  assert.equal(s.scenario.label, 'Arrival at Heathrow (Demo C)');
  assert.equal(s.scenario.clock, '08:15:00');
  assert.deepEqual(s.reported_incidents, []);
  assert.equal(s.participants.length, 27);
  const f = fixture(key, 'overpass');
  const center = f.meta.hotel.center;
  const projector = makeProjector(center);
  const parsed = parseOverpassElements(f.elements);
  const projected = projectBuildings(parsed.buildings, projector, center);
  const sel = selectHotelFootprint(
    projected.buildings,
    parsed.hotels,
    { ...center, osm_id: site.osm },
    projector,
  );
  const place = s.places.find((p) => p.site_key === key);
  const a = assessSnapshot(
    s,
    { xy: sel.building.xy[0], approximate: sel.approximate },
    projector,
    { placeId: place.id },
  );
  assert.equal(a.counts['Inside (likely)'], 27, JSON.stringify(a.counts));
  assert.deepEqual(a.needs, []);
  assert.deepEqual(deriveMode(a, {}).groups, []);
  for (const p of s.participants) {
    assert.equal(p.isFresh, true, p.name);
    assert.ok(p.accuracy_m >= 8 && p.accuracy_m <= 20, `${p.name} accuracy`);
    assert.equal(p.group_zone_state, 'inside', p.name);
    assert.equal(p.unaccompanied, false, p.name);
    assert.equal(p.floor_estimate?.place_id, place.id, `${p.name} floor at T5`);
  }
  // Everyone at the arrival site, nobody between, elsewhere or unlocated.
  const c = siteCounts(s.participants, sitesForCity('london'));
  assert.equal(c.bySite.find((x) => x.key === key).n, 27);
  assert.equal(c.between + c.elsewhere + c.notLocated + c.notCurrent, 0);
  // Small groups, not one blob (Jesse, 29 Oct 2026): six groups at least
  // 40 m apart (meeting point, three reclaim belts, café, restrooms), no
  // two people within 5 m (no stacked pin), a chaperone in each of three
  // groups, T10 and NF at reclaim, airside of the meeting point.
  const xy = new Map(
    s.participants.map((p) => [
      p.id.slice(5),
      projector.toXY(p.coordinates.lat, p.coordinates.lng),
    ]),
  );
  const ids = [...xy.keys()];
  const dist = (a, b) =>
    Math.hypot(xy.get(a)[0] - xy.get(b)[0], xy.get(a)[1] - xy.get(b)[1]);
  for (const a of ids)
    for (const b of ids)
      if (a < b) assert.ok(dist(a, b) >= 5, `${a} and ${b} ${dist(a, b)} m`);
  // Groups: people within 25 m of each other, chained.
  const groupOf = new Map();
  let groups = 0;
  for (const id of ids) {
    if (groupOf.has(id)) continue;
    groups += 1;
    const todo = [id];
    groupOf.set(id, groups);
    while (todo.length) {
      const a = todo.pop();
      for (const b of ids)
        if (!groupOf.has(b) && dist(a, b) <= 25) {
          groupOf.set(b, groups);
          todo.push(b);
        }
    }
  }
  assert.equal(groups, 6);
  const sizes = [...new Set(groupOf.values())]
    .map((g) => ids.filter((id) => groupOf.get(id) === g).length)
    .sort((a, b) => b - a);
  assert.deepEqual(sizes, [13, 4, 3, 3, 2, 2]);
  const chaps = ['TC', 'KV', 'HL'];
  assert.equal(new Set(chaps.map((c) => groupOf.get(c))).size, 3);
  assert.equal(groupOf.get('T10') === groupOf.get('NF'), false, 'two belts');
  const meeting = ids.filter((id) => groupOf.get(id) === groupOf.get('TC'));
  assert.equal(meeting.length, 13);
  const eastMost = Math.max(...meeting.map((id) => xy.get(id)[0]));
  for (const id of ['T10', 'NF'])
    assert.ok(xy.get(id)[0] > eastMost + 30, `${id} at reclaim, airside`);
  // The plan: the arrival is Day 1's first stop, its pick-up named.
  assert.equal(s.itinerary[0].title, 'Arrival · Heathrow T5');
  assert.equal(s.itinerary[0].start_time, '07:30');
  assert.match(place.assembly_point.label, /coach pick-up/);
  assert.deepEqual(bannedWordHits(JSON.stringify([s.places, s.itinerary])), []);
});

test('Demo C is the London trip’s: another city reads it as baseline', () => {
  for (const city of ['austin', 'dc']) {
    const c = tripTwinDemoSnapshot(city, 'c', { now: 0, elapsed: 0 });
    const b = tripTwinDemoSnapshot(city, 'baseline', { now: 0, elapsed: 0 });
    assert.equal(c.scenario.key, 'baseline');
    assert.deepEqual(c.participants, b.participants);
  }
});

test('the existing scenarios keep their people: nobody at Heathrow in A or baseline', async () => {
  const { siteCounts, sitesForCity } = await import('./twinSites.js');
  for (const sc of ['baseline', 'a', 'b']) {
    const s = tripTwinDemoSnapshot('london', sc, { now: 0, elapsed: 0 });
    assert.equal(s.participants.length, 27);
    const c = siteCounts(s.participants, sitesForCity('london'));
    assert.equal(c.bySite.find((x) => x.key === 'london-heathrow-t5').n, 0);
  }
  // London's Demo A as before: the hotel, its assembly point, one away.
  const a = tripTwinDemoSnapshot('london', 'a', { now: 0, elapsed: 0 });
  const { hotel, projector } = hotelFor('london');
  const r = assessSnapshot(a, hotel, projector);
  assert.equal(
    Object.values(r.counts).reduce((x, y) => x + y, 0),
    27,
  );
  assert.equal(r.counts['Not located'], 1);
  assert.equal(a.reported_incidents[0].id, 'rep-fire-4');
});
