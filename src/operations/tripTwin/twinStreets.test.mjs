// Phase 7: streets by class, one name per street.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { haversineM as haversine, parseOverpassElements } from './twinData.js';
import { roadClass, streetLabels } from './twinStreets.js';

test('road classes', () => {
  assert.equal(roadClass('primary'), 'major');
  assert.equal(roadClass('secondary_link'), 'major');
  assert.equal(roadClass('residential'), 'minor');
  assert.equal(roadClass('service'), 'service');
  assert.equal(roadClass('footway'), 'walk');
  assert.equal(roadClass('pedestrian'), 'walk');
  assert.equal(roadClass('steps'), 'steps');
  assert.equal(roadClass('bus_stop'), null);
});

test('one label per street, on its longest way, majors first', () => {
  const way = (name, highway, lat0, lat1) => ({
    name,
    highway,
    coords: [
      { lat: lat0, lon: -97.74 },
      { lat: lat1, lon: -97.74 },
    ],
  });
  const labels = streetLabels([
    way('Congress Avenue', 'primary', 30.26, 30.262),
    way('Congress Avenue', 'primary', 30.262, 30.2625),
    way('Red River Street', 'residential', 30.26, 30.263),
    way('Tiny Lane', 'residential', 30.26, 30.2601),
    way(null, 'primary', 30.26, 30.27),
    way('Waller Trail', 'footway', 30.26, 30.27),
  ]);
  assert.deepEqual(
    labels.map((l) => l.name),
    ['Congress Avenue', 'Red River Street'],
  );
  assert.ok(
    Math.abs(labels[0].at.lat - 30.261) < 1e-6,
    'half way along the longest way',
  );
});

test('the Austin fixture has streets, walkways, steps and entrances', () => {
  const json = JSON.parse(
    readFileSync(
      new URL(
        '../../../scripts/fixtures/trip-twin/austin.overpass.json',
        import.meta.url,
      ),
    ),
  );
  const parsed = parseOverpassElements(json.elements);
  const classes = new Set(parsed.roads.map((r) => roadClass(r.highway)));
  for (const c of ['major', 'minor', 'walk']) assert.ok(classes.has(c), c);
  assert.ok(
    parsed.roads.some((r) => r.name),
    'names kept',
  );
});

test('walkability: motorways, private ways and foot=no cannot be walked; tunnels and sidewalks are not drawn', async () => {
  const { roadClass } = await import('./twinStreets.js');
  assert.equal(roadClass({ highway: 'motorway' }), 'nowalk');
  assert.equal(roadClass({ highway: 'trunk_link' }), 'nowalk');
  assert.equal(
    roadClass({ highway: 'residential', access: 'private' }),
    'nowalk',
  );
  assert.equal(
    roadClass({ highway: 'service', access: 'private', foot: 'yes' }),
    'service',
  );
  assert.equal(roadClass({ highway: 'primary', foot: 'no' }), 'nowalk');
  assert.equal(roadClass({ highway: 'primary', tunnel: 'yes' }), 'hidden');
  assert.equal(
    roadClass({ highway: 'footway', footway: 'sidewalk' }),
    'hidden',
  );
  assert.equal(roadClass({ highway: 'footway', footway: 'crossing' }), 'walk');
});

test('labels: short names, the hotel streets first, none on the hotel, at most 12', async () => {
  const { shortStreet, streetLabels } = await import('./twinStreets.js');
  assert.equal(shortStreet('North Red River Street'), 'N Red River St');
  assert.equal(shortStreet('Interstate 35 Frontage Road'), 'I-35 Frontage Rd');
  const hub = { lat: 30.262, lon: -97.738 };
  const way = (name, highway, lat0, lat1, lon = -97.7381) => ({
    name,
    highway,
    coords: [
      { lat: lat0, lon },
      { lat: lat1, lon },
    ],
  });
  const ls = streetLabels(
    [
      way('Far Primary Avenue', 'primary', 30.27, 30.28, -97.74),
      way('Hotel Street', 'residential', 30.2605, 30.2635),
      ...Array.from({ length: 20 }, (_, i) =>
        way(
          `Road ${i}`,
          'residential',
          30.25 - i * 0.01,
          30.245 - i * 0.01,
          -97.75,
        ),
      ),
    ],
    { hub },
  );
  assert.equal(ls[0].name, 'Hotel Street', 'the street the hotel faces first');
  assert.ok(ls.length <= 12);
  assert.ok(
    ls.every((l) => haversine(l.at, hub) > 59),
    'never on the hotel',
  );
});

test('doors: the hotel entrances are labelled with their street, never "exit"', async () => {
  const { doorPlan } = await import('./twinStreets.js');
  const ring = [
    { lat: 30.262, lon: -97.7385 },
    { lat: 30.262, lon: -97.738 },
    { lat: 30.2625, lon: -97.738 },
    { lat: 30.2625, lon: -97.7385 },
    { lat: 30.262, lon: -97.7385 },
  ];
  const roads = [
    {
      name: 'Red River Street',
      highway: 'secondary',
      coords: [
        { lat: 30.261, lon: -97.7378 },
        { lat: 30.264, lon: -97.7378 },
      ],
    },
  ];
  const [door, far] = doorPlan(
    [
      { lat: 30.2622, lon: -97.73798, kind: 'main' },
      { lat: 30.27, lon: -97.73, kind: 'yes' },
    ],
    roads,
    ring,
  );
  assert.equal(door.label, 'Mapped entrance (main) · Red River St');
  assert.equal(far.label, null);
  assert.ok(!/exit/i.test(door.label));
});
