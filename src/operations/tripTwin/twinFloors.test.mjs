import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tripTwinDemoSnapshot } from './demoTripTwin.js';
import { TWIN_CITIES } from './twinCities.js';
import {
  assessSnapshot,
  bannedWordHits,
  deriveMode,
  floorPartition,
  floorOccupancy,
  floorRoster,
  footerLine,
  makeProjector,
  parseOverpassElements,
  projectBuildings,
  selectHotelFootprint,
} from './twinData.js';

function setup(cityKey, scenario) {
  const city = TWIN_CITIES[cityKey];
  const f = JSON.parse(
    readFileSync(
      new URL(
        `../../../scripts/fixtures/trip-twin/${cityKey}.overpass.json`,
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
  const s = tripTwinDemoSnapshot(cityKey, scenario, { elapsed: 0 });
  const reportedLabel = s.reported_incidents[0]?.floor_label ?? null;
  const a = assessSnapshot(
    s,
    { xy: h.building.xy[0], approximate: h.approximate },
    projector,
    { reportedLabel },
  );
  return {
    s,
    a,
    reportedLabel,
    occ: floorOccupancy(a, s.places[0], reportedLabel),
  };
}

const floor = (occ, label) => occ.floors.find((f) => f.label === label);
const names = (rows) => rows.map((r) => (r.row || r).person.name);

test('rooming list is floor-only and covers the whole cast', () => {
  const { s } = setup('austin', 'a');
  const ra = s.places[0].room_assignments;
  assert.equal(ra.length, 27);
  for (const r of ra)
    assert.deepEqual(Object.keys(r).sort(), ['floor_label', 'participant_id']);
  assert.deepEqual(
    [...new Set(ra.map((r) => r.floor_label))].sort(),
    [11, 8, 9],
  );
});

test('Demo A cutaway: ranges count as detected; amber only for at-hotel, floor not known', () => {
  const { occ } = setup('austin', 'a');
  assert.equal(occ.available, true);
  assert.equal(occ.floors[0].label, 37, 'top floor first');
  assert.equal(floor(occ, 9).state, 'reported');
  assert.deepEqual(names(floor(occ, 9).likely), ['Aron Kim']);
  assert.deepEqual(names(floor(occ, 9).possible), ['Maya Ruiz']);
  assert.equal(floor(occ, 10).state, 'occupied');
  // Floor 11: M.R.'s range reaches it (possible) and L.B. is at the hotel with
  // no pressure sensor (amber). People outside never make a floor amber.
  assert.equal(floor(occ, 11).state, 'possible');
  assert.equal(floor(occ, 11).amber, true);
  assert.deepEqual(names(floor(occ, 11).floorNotKnown), ['Leo Brandt']);
  assert.equal(floor(occ, 11).away.length, 6);
  assert.equal(floor(occ, 1).state, 'possible', 'S.D. last estimate floor 1');
  assert.equal(
    footerLine(occ.footer),
    'Whole group (27): floor unknown 2 · not shared 0 · last estimate only 1',
  );
});

test('floor 11 card: every section has a reason; never "missing" or "empty"', () => {
  const { occ } = setup('austin', 'a');
  const r = floorRoster(occ, 11);
  assert.deepEqual(
    r.sections.map((x) => x.title),
    [
      'Most likely here',
      'Possibly here (estimate range includes floor 11)',
      'Assigned here, floor not known',
      'Assigned here, not at the hotel now',
    ],
  );
  assert.equal(r.sections[0].rows.length, 0);
  assert.match(
    r.sections[1].rows[0].note,
    /^Likely floor 10 \(9–11\) .* · assigned here$/,
  );
  assert.equal(
    r.sections[2].rows[0].note,
    'Floor unknown — phone has no pressure sensor',
  );
  assert.equal(r.sections[3].collapsed, true);
  assert.ok(
    r.sections[3].rows.every((x) => x.note === 'Outside the hotel, nearby'),
  );
  const all = JSON.stringify(
    r.sections.map((x) => [x.title, x.none, ...x.rows.map((y) => y.note)]),
  );
  assert.doesNotMatch(all, /missing|empty/i);
  assert.deepEqual(bannedWordHits(all), []);
});

test('floor 9 card lists M.R. as possibly here and N.P. as estimate elsewhere', () => {
  const { occ } = setup('austin', 'a');
  const r = floorRoster(occ, 9);
  assert.deepEqual(names(r.sections.find((x) => x.key === 'possible').rows), [
    'Maya Ruiz',
  ]);
  const nia = r.sections
    .find((x) => x.key === 'elsewhere')
    .rows.find((x) => x.row.person.name === 'Nia Park');
  assert.match(nia.note, /^Estimate on another floor · Rough: floors 5–8/);
});

test('stopped phones with a last estimate above the fire join "at or above" (FLR-11)', () => {
  const { s, a, reportedLabel } = setup('austin', 'a');
  // Make S.D.'s last estimate read floors 10–12 (stopped phone, sleeping).
  const sd = a.rows.find((r) => r.person.id === 'twin-SD');
  assert.equal(sd.floor.kind, 'last');
  sd.floor = {
    ...sd.floor,
    est: { ...sd.floor.est, label_low: 10, label_high: 12, label_likely: 11 },
  };
  const part = floorPartition(a.rows, reportedLabel);
  assert.deepEqual(part.lastIds, ['twin-SD']);
  const m = deriveMode(
    {
      ...a,
      partition: {
        ...part,
        assignedNotDetected: a.partition.assignedNotDetected,
      },
    },
    {
      reportedLabel,
      incident: { kind: 'smoke', source: 'hotel desk', ageMin: 2 },
    },
  );
  assert.equal(m.groups[0].key, 'at_or_above');
  assert.equal(m.groups[0].rows.length, 4);
  assert.match(
    m.topLine,
    /— 4 may be at or above \(2 by phone estimate, 1 by last estimate \(not current\), 1 assigned above, floor not detected\)/,
  );
  void s;
});

test('London: numbering not mapped → no at-or-above count, everyone inside listed', () => {
  const { a, reportedLabel, s, occ } = setup('london', 'a');
  assert.deepEqual(s.places[0].room_assignments, []);
  assert.equal(occ.available, false);
  assert.match(occ.reason, /not mapped/);
  const m = deriveMode(a, {
    reportedLabel,
    incident: { kind: 'smoke', source: 'hotel desk', ageMin: 2 },
  });
  assert.equal(m.comparable, false);
  assert.ok(!m.groups.some((g) => g.key === 'at_or_above'));
  assert.match(
    m.topLine,
    /floor estimates can't be matched to this building's floor numbers; 8 may still be inside/,
  );
});

test('cutaway bar text, hover plate and the copy-for-hotel text', async () => {
  const { floorBarText, floorPlate, floorRosterText } =
    await import('./twinCutaway.js');
  const { occ } = setup('austin', 'a');
  assert.equal(
    floorBarText(floor(occ, 9), { reportKind: 'smoke' }),
    'Reported: smoke · not verified · 1 likely · 1 possible',
  );
  assert.equal(floorBarText(floor(occ, 11)), '1 possible · 1 floor not known');
  assert.equal(
    floorPlate(floor(occ, 11)),
    'Floor 11 · 0 most likely · 1 possibly here · 1 assigned, floor not known · 8 assigned',
  );
  const text = floorRosterText(occ, 11, {
    hotelLabel: 'Fairmont Austin',
    reportKind: 'smoke',
    asOf: '02:14',
    atHotelNoFloor: 2,
  });
  assert.match(text, /^Fairmont Austin · Floor 11 · as of 02:14\n/);
  assert.match(text, /Not a headcount/);
  assert.match(
    text,
    /Assigned here, floor not known \(1\):\n- Leo Brandt: Floor unknown — phone has no pressure sensor/,
  );
  assert.match(text, /- Hana Lee \(chaperone\): Outside the hotel, nearby/);
  assert.doesNotMatch(text, /missing|empty|clear/i);
  assert.deepEqual(bannedWordHits(text), []);
});
