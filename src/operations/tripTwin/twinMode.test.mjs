import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tripTwinDemoSnapshot } from './demoTripTwin.js';
import { TWIN_CITIES } from './twinCities.js';
import {
  assessSnapshot,
  deriveMode,
  makeProjector,
  parseOverpassElements,
  projectBuildings,
  selectHotelFootprint,
  bannedWordHits,
} from './twinData.js';

function setup(scenario) {
  const city = TWIN_CITIES.austin;
  const f = JSON.parse(
    readFileSync(
      new URL(
        '../../../scripts/fixtures/trip-twin/austin.overpass.json',
        import.meta.url,
      ),
    ),
  );
  const projector = makeProjector(city.center);
  const p = parseOverpassElements(f.elements);
  const pb = projectBuildings(p.buildings, projector, city.center);
  const h = selectHotelFootprint(
    pb.buildings,
    p.hotels,
    { ...city.center, osm_id: city.osm },
    projector,
  );
  const s = tripTwinDemoSnapshot('austin', scenario, { elapsed: 0 });
  const reportedLabel = s.reported_incidents[0]?.floor_label ?? null;
  return {
    s,
    reportedLabel,
    a: assessSnapshot(
      s,
      { xy: h.building.xy[0], approximate: h.approximate },
      projector,
      { reportedLabel },
    ),
  };
}

test('Demo A is INCIDENT and the top line says who may still be inside', () => {
  const { a, reportedLabel } = setup('a');
  const m = deriveMode(a, {
    reportedLabel,
    incident: { kind: 'smoke', source: 'hotel desk', ageMin: 2 },
  });
  assert.equal(m.mode, 'incident');
  assert.equal(
    m.topLine,
    'Smoke reported, floor 9 (hotel desk, 2 min ago, not verified) — 3 may be at or above (2 by phone estimate, 1 assigned above, floor not detected), 5 more may still be inside, 3 not current or not located',
  );
  assert.equal(
    m.subLine,
    'No official instruction about this incident on file · Headcount: not reported',
  );
  assert.deepEqual(
    m.groups.map((g) => g.key),
    ['at_or_above', 'in_building', 'not_current', 'not_located'],
  );
  // EX-FLR-03: L.B. is assigned floor 11 and his phone has no pressure sensor.
  assert.equal(m.groups[0].rows.length, 3);
  assert.deepEqual([...m.assignedAbove], ['twin-LB']);
  assert.deepEqual(bannedWordHits(m.topLine), []);
});

test('baseline is MONITORING with an exception-first top line', () => {
  const { a } = setup('baseline');
  const m = deriveMode(a, {});
  assert.equal(m.mode, 'monitoring');
  assert.match(m.topLine, /^No incident reported · \d+ to check on — first: /);
  assert.equal(m.groups[0].key, 'alone');
});

test('a nearby hazard raises WATCH; a delayed feed becomes the top line in calm', () => {
  const { a } = setup('baseline');
  assert.equal(
    deriveMode(a, { hazard: { text: 'Heat detection 0.7 km SW' } }).mode,
    'watch',
  );
  const d = deriveMode(a, { delayedS: 70, asOf: '21:31:40' });
  assert.ok(d.degraded);
  assert.match(d.topLine, /^Traveler data delayed 1m/);
});
