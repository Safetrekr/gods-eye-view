import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimateFloor, levelAt, pressureAt } from './floorEstimate.js';
import { makeTrace, parseTraceCsv, weather } from './floorTraces.js';

const building = {
  levels_above_ground: 37,
  floor_height_m: 3.3,
  ground_floor_label: 1,
};
const P0 = 1000;
const at = (z, t) => ({ t, pressure_hpa: pressureAt(z, P0) });

test('levelAt: lobby is level 0 up to the lobby height, then floor-height slabs', () => {
  assert.equal(levelAt(0, 3.3, 4.5), 0);
  assert.equal(levelAt(4.4, 3.3, 4.5), 0);
  assert.equal(levelAt(4.5, 3.3, 4.5), 1);
  assert.equal(levelAt(4.5 + 9 * 3.3 - 0.01, 3.3, 4.5), 9);
  assert.equal(levelAt(-1, 3.3, 4.5), -1);
});

test('a clean, recent reading on level 9 gives "likely 10 (9-11)" with US labels', () => {
  const z = 4.5 + 8 * 3.3 + 1.5; // phone 1.5 m above the level-9 slab floor
  const est = estimateFloor({
    now: 600,
    samples: [at(z, 560), at(z, 580), at(z, 600)],
    anchor: { t: 0, pressure_hpa: P0, ground_m: 0 },
    entrance_ground_m: 0,
    barometer: 'available',
    building,
  });
  assert.equal(est.status, 'estimated');
  assert.equal(est.level_likely, 9);
  assert.equal(est.label_likely, 10);
  assert.deepEqual([est.label_low, est.label_high], [9, 11]);
  assert.equal(est.confidence, 'high');
});

test('guards return explicit unknown reasons, never a guess', () => {
  const base = {
    now: 100,
    samples: [at(10, 100)],
    anchor: { t: 0, pressure_hpa: P0, ground_m: 0 },
    building,
  };
  assert.equal(
    estimateFloor({ ...base, barometer: 'missing' }).unknown_reason,
    'no_barometer',
  );
  assert.equal(
    estimateFloor({ ...base, barometer: 'available', anchor: null })
      .unknown_reason,
    'no_anchor',
  );
  assert.equal(
    estimateFloor({ ...base, barometer: 'available', consent: false })
      .unknown_reason,
    'consent_off',
  );
  assert.equal(
    estimateFloor({
      ...base,
      barometer: 'available',
      now: 5 * 3600,
      samples: [at(10, 5 * 3600)],
    }).unknown_reason,
    'anchor_too_old',
  );
  assert.equal(
    estimateFloor({
      ...base,
      barometer: 'available',
      now: 3000,
      samples: [at(10, 100)],
    }).unknown_reason,
    'sample_too_old',
  );
  assert.equal(
    estimateFloor({
      ...base,
      barometer: 'available',
      samples: [at(10, 98), { t: 100, pressure_hpa: pressureAt(10, P0) - 0.9 }],
    }).unknown_reason,
    'sensor_jump',
  );
});

test('uncertainty grows with anchor age until the band is too wide', () => {
  const z = 30;
  const mk = (hours) =>
    estimateFloor({
      now: hours * 3600,
      samples: [at(z, hours * 3600)],
      anchor: { t: 0, pressure_hpa: P0, ground_m: 0 },
      barometer: 'available',
      building,
    });
  assert.ok(mk(0.1).sigma_m < mk(3).sigma_m);
  assert.equal(mk(0.1).confidence, 'high');
});

test('unknown floor count caps confidence at medium (Floor numbering not verified)', () => {
  const est = estimateFloor({
    now: 60,
    samples: [at(20, 60)],
    anchor: { t: 0, pressure_hpa: P0, ground_m: 0 },
    barometer: 'available',
    building: { ground_floor_label: 0 },
  });
  assert.equal(est.confidence, 'medium');
  assert.equal(est.levels_basis, 'unknown');
});

test('synthetic trace with weather drift + HVAC: reference correction keeps the band honest', () => {
  const wx = weather({ base: 1009, trendHpaPerHour: -1.0 });
  const trueLevel = 14;
  const z = 4.5 + (trueLevel - 1) * 3.3 + 1.5;
  const path = [
    { t: 0, z: 0, inside: false },
    { t: 120, z: 0, inside: true },
    { t: 180, z, inside: true },
    { t: 3600, z, inside: true },
  ];
  const samples = makeTrace({
    seed: 7,
    path,
    tStart: 0,
    tEnd: 3600,
    wx,
    hvacHpa: 0.25,
  });
  const reference = Array.from({ length: 8 }, (_, i) => ({
    t: i * 600,
    pressure_hpa: wx(i * 600),
  }));
  const est = estimateFloor({
    now: 3600,
    samples,
    anchor: { t: 30, pressure_hpa: samples[30].pressure_hpa, ground_m: 0 },
    reference,
    barometer: 'available',
    building,
  });
  assert.equal(est.status, 'estimated');
  assert.ok(
    est.level_low <= trueLevel && trueLevel <= est.level_high,
    JSON.stringify(est),
  );
});

test('golden vectors (shared with a future Core port)', () => {
  const vectors = JSON.parse(
    readFileSync(
      new URL(
        '../../../scripts/fixtures/trip-twin/floor-vectors.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.ok(vectors.length >= 6);
  for (const v of vectors) {
    const out = estimateFloor(v.input);
    for (const [k, expected] of Object.entries(v.expect))
      assert.deepEqual(out[k], expected, `${v.name}: ${k}`);
  }
});

test('CSV loader reads a phone recording with ground-truth floors', () => {
  const rows = parseTraceCsv(
    'time_s,pressure_hpa,true_floor\n0,1001.2,1\n1,1001.1,\n2,1000.0,4\n',
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[2].true_floor, 4);
  assert.equal(rows[1].true_floor, undefined);
});
