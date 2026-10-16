import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arriveBy,
  hazardProximity,
  pathCardText,
  sharedStart,
  walkMinutes,
} from './twinPaths.js';
import { fireSummary, simulatedFires } from './twinFires.js';
import { bannedWordHits } from './twinData.js';

const line = (n, dLat = 0.0001, lat0 = 30.26, lon0 = -97.74, dLon = 0) =>
  Array.from({ length: n }, (_, i) => ({
    lat: lat0 + i * dLat,
    lon: lon0 + i * dLon,
  }));

test('group pace and arrive-by show their arithmetic (01 §6)', () => {
  assert.deepEqual(walkMinutes(850), [14, 17]);
  assert.deepEqual(arriveBy(850, { night: true }), {
    total: 36,
    prepare: 12,
    walk: 17,
    buffer: 7,
  });
  assert.equal(arriveBy(850).prepare, 5);
});

test('sharedStart measures how much of the first 200 m two paths share', () => {
  const a = line(30);
  assert.ok(sharedStart(a, a).fraction > 0.95);
  const b = line(30, 0, 30.26, -97.74, 0.0002); // heads east instead of north
  assert.ok(sharedStart(a, b).fraction < 0.2);
});

test('hazard proximity finds the closest approach', () => {
  const path = line(10);
  const h = hazardProximity(path, [{ lat: 30.2605, lon: -97.735 }]);
  assert.ok(h.distanceM > 400 && h.distanceM < 600, String(h.distanceM));
});

test('path cards never call a route safe and say "unverified"', () => {
  const p = {
    kind: 'primary',
    distanceM: 850,
    walk: walkMinutes(850),
    geometry: line(5),
    hazard: { distanceM: 300, hazard: { lat: 30.26, lon: -97.737 }, index: 0 },
  };
  const text = pathCardText(p, { night: true, incident: true }).join(' ');
  assert.match(text, /Suggested path \(unverified\)/);
  assert.match(
    text,
    /Suggested arrive-by: 36 min \(12 prepare \+ 17 walk \+ 7 buffer\)/,
  );
  assert.match(text, /satellite heat detection/);
  assert.deepEqual(bannedWordHits(text), []);
});

test('no detections is never presented as an all-clear', () => {
  const s = fireSummary({ lat: 30.26, lon: -97.74 }, []);
  assert.match(s.text, /not an all-clear/);
});

test('simulated detections are labelled and summarised with nearest first', () => {
  const now = Date.UTC(2026, 9, 15, 7, 14);
  const recs = simulatedFires({ lat: 30.262, lon: -97.738 }, now);
  assert.ok(recs.every((r) => r.simulated && r.satellite === 'SIMULATED'));
  const s = fireSummary({ lat: 30.262, lon: -97.738 }, recs, now);
  assert.ok(s.count >= 3);
  assert.ok(s.nearest.d < 800);
});
