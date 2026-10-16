import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tripTwinDemoSnapshot } from './demoTripTwin.js';
import { TWIN_CITIES } from './twinCities.js';
import {
  assessSnapshot,
  deriveMode,
  floorOccupancy,
  makeProjector,
  parseOverpassElements,
  projectBuildings,
  selectHotelFootprint,
} from './twinData.js';
import {
  applyOperatorNumbering,
  numberingNote,
  levelsOf,
  validEntry,
} from './twinNumbering.js';

function london(entries) {
  const city = TWIN_CITIES.london;
  const f = JSON.parse(
    readFileSync(
      new URL(
        '../../../scripts/fixtures/trip-twin/london.overpass.json',
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
  const s = applyOperatorNumbering(
    tripTwinDemoSnapshot('london', 'a', { elapsed: 0 }),
    entries,
  );
  const a = assessSnapshot(
    s,
    { xy: h.building.xy[0], approximate: h.approximate },
    projector,
    { reportedLabel: 9, placeId: s.places[0].id },
  );
  const m = deriveMode(a, {
    reportedLabel: 9,
    incident: { kind: 'smoke', source: 'hotel desk', ageMin: 2 },
  });
  return { s, a, m };
}

test('entries are validated', () => {
  assert.ok(validEntry({ groundLabel: 0, topFloor: null }));
  assert.ok(validEntry({ groundLabel: 1, topFloor: 12 }));
  assert.ok(!validEntry({ groundLabel: 2, topFloor: 12 }));
  assert.ok(!validEntry({ groundLabel: 1, topFloor: 0 }), 'top below ground');
  assert.ok(!validEntry(null));
  assert.equal(levelsOf({ groundLabel: 0, topFloor: 9 }), 10, 'floors 0–9');
  assert.equal(levelsOf({ groundLabel: 1, topFloor: 9 }), 9, 'floors 1–9');
});

test('London: no answer keeps the honest "can not be matched" line', () => {
  const { m } = london({});
  assert.equal(m.comparable, false);
  assert.match(m.topLine, /can't be matched/);
});

test('London: operator answer relabels estimates and enables at-or-above', () => {
  const { s, a, m } = london({
    london: { groundLabel: 0, topFloor: 9, at: 'x' },
  });
  assert.equal(s.places[0].levels_source, 'operator');
  const est = s.participants.find(
    (p) => p.floor_estimate?.status === 'estimated',
  ).floor_estimate;
  assert.equal(est.label_likely, est.level_likely + 0);
  assert.equal(m.comparable, true);
  assert.equal(m.numberingSource, 'operator');
  assert.match(m.topLine, /floor numbering from operator entry, not verified$/);
  const occ = floorOccupancy(a, s.places[0], 9);
  assert.equal(occ.available, true);
  assert.equal(occ.floors.length, 10);
  assert.equal(occ.floors[0].label, 9, 'top floor = the answer');
  assert.equal(occ.floors.at(-1).label, 0, 'ground floor = 0');
});

test('mapped buildings are never overridden', () => {
  const s0 = tripTwinDemoSnapshot('austin', 'a', { elapsed: 0 });
  const s1 = applyOperatorNumbering(s0, {
    austin: { groundLabel: 0, topFloor: 3 },
  });
  assert.equal(s1, s0);
  assert.equal(
    numberingNote({ groundLabel: 0, topFloor: 9 }),
    'Floor numbering: ground floor = 0 · top floor 9 · operator entry, not verified',
  );
});

test('a wrong answer never becomes a false zero: reported floor outside → no count', () => {
  // Operator says top floor 8 (floors 0–8); the hotel desk reports floor 9.
  const { m } = london({ london: { groundLabel: 0, topFloor: 8, at: 'x' } });
  assert.equal(m.comparable, false);
  assert.deepEqual(m.outOfRange, { top: 8, ground: 0 });
  assert.match(
    m.topLine,
    /reported floor 9 is outside this building's floors \(0–8, operator entry\); check the floor numbering/,
  );
  assert.doesNotMatch(m.topLine, /\b0 may be at or above/);
  assert.ok(!m.groups.some((g) => g.key === 'at_or_above'));
});

test('no bare zero while people inside have no current floor', () => {
  const { m } = london({ london: { groundLabel: 0, topFloor: 9, at: 'x' } });
  assert.match(
    m.topLine,
    /no one at or above by phone estimate or room list — \d+ inside without a current floor estimate/,
  );
});
