// Phase 4 deferred items: street names for waypoints, out / back legs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeFromNominatim } from '../../../server/tripTwin/routingProxy.js';
import { bannedWordHits } from './twinData.js';
import {
  legWindow,
  nearestStreet,
  pathChecks,
  savedPathLines,
  waypointText,
} from './twinCustomPaths.js';

const road = (name, a, b) => ({ name, coords: [a, b] });
const pt = { lat: 30.262, lon: -97.738 };

test('nearest named street within reach, else none', () => {
  const roads = [
    road(
      'Red River Street',
      { lat: 30.2615, lon: -97.73805 },
      { lat: 30.2625, lon: -97.73805 },
    ),
    road(null, { lat: 30.262, lon: -97.7381 }, { lat: 30.262, lon: -97.7379 }),
    road(
      'Far Street',
      { lat: 30.27, lon: -97.73 },
      { lat: 30.271, lon: -97.73 },
    ),
  ];
  const s = nearestStreet(pt, roads);
  assert.equal(s.name, 'Red River Street');
  assert.ok(s.d < 10);
  assert.equal(waypointText(pt, s), 'Red River Street');
  assert.equal(waypointText(pt, { name: 'X Street', d: 30 }), 'near X Street');
  assert.equal(nearestStreet({ lat: 30.3, lon: -97.7 }, roads), null);
  assert.equal(waypointText(pt, null), '30.26200, -97.73800');
});

test('Nominatim reverse: street first, place name next, else not found', () => {
  assert.deepEqual(
    placeFromNominatim({ address: { road: 'Congress Avenue' } }),
    { ok: true, name: 'Congress Avenue' },
  );
  assert.deepEqual(
    placeFromNominatim({ name: 'Republic Square', address: {} }),
    { ok: true, name: 'Republic Square' },
  );
  assert.equal(placeFromNominatim({ address: {} }).ok, false);
});

const fmt = (ms) => new Date(ms).toISOString().slice(11, 16);
const T = (h, m = 0) => Date.UTC(2026, 9, 16, h, m);

test('out leg arrives for the start; back leg leaves at the end', () => {
  const event = {
    title: 'Evening concert',
    startMs: T(19, 30),
    endMs: T(21, 30),
  };
  const out = legWindow({
    leg: 'out',
    event,
    durationS: 1800,
    sunsetMs: T(19, 0),
    fmt,
  });
  assert.equal(out.toMs, T(19, 30));
  assert.match(
    out.text,
    /leave about 19:00 to arrive for Evening concert at 19:30/,
  );
  assert.equal(out.dark, true);
  const back = legWindow({
    leg: 'back',
    event,
    durationS: 1800,
    sunsetMs: T(19, 0),
    fmt,
  });
  assert.equal(back.fromMs, T(21, 30));
  assert.match(back.text, /ends 21:30 · about 21:30–22:00/);
  assert.match(back.darkText, /after sunset \(19:00\) — check lighting/);
  const day = legWindow({
    leg: 'out',
    event: { ...event, startMs: T(10) },
    durationS: 900,
    sunsetMs: T(19),
    fmt,
  });
  assert.equal(day.dark, false);
  assert.match(day.darkText, /before sunset/);
  const noEnd = legWindow({
    leg: 'back',
    event: { ...event, endMs: NaN },
    durationS: 600,
    sunsetMs: T(19),
    fmt,
  });
  assert.match(noEnd.text, /no end time set · assumed 21:30/);
  assert.equal(legWindow({ leg: null, event, durationS: 1, fmt }), null);
});

test('a leg replaces the day-wide after-dark guess in the checks', () => {
  const result = {
    geometry: [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.001 },
    ],
    distanceM: 111,
    avoidApplied: true,
  };
  const ctx = {
    points: result.geometry,
    areas: [],
    hazards: [],
    day: 2,
    dark: true,
    profile: 'foot',
  };
  const leg = { dark: false, darkText: 'On the way before sunset (19:00)' };
  const f = pathChecks(result, { ...ctx, leg });
  assert.ok(f.some((x) => x.key === 'daylight' && !x.warn));
  assert.ok(!f.some((x) => x.key === 'dark'));
  const g = pathChecks(result, {
    ...ctx,
    leg: {
      dark: true,
      darkText: 'On the way after sunset (19:00) — check lighting on this path',
    },
  });
  assert.ok(g.some((x) => x.key === 'dark' && x.warn));
});

test('brief line carries the leg; no banned words', () => {
  const p = {
    id: 'a',
    name: 'Hotel → Hall',
    day: 2,
    profile: 'foot',
    distanceM: 900,
    durationS: 700,
    siteKeys: ['h'],
    points: [],
    geometry: [],
    areaIds: [],
    routedAroundIds: [],
  };
  const [line] = savedPathLines([p], {
    day: 2,
    siteKey: 'h',
    leg: () => ({
      text: 'Back leg · after Concert ends 21:30 · about 21:30–21:42',
    }),
  });
  assert.match(line.text, /Back leg · after Concert/);
  const out = legWindow({
    leg: 'back',
    event: { title: 'X', startMs: T(18), endMs: T(20) },
    durationS: 60,
    sunsetMs: T(19),
    fmt,
  });
  assert.deepEqual(bannedWordHits([out.text, out.darkText].join(' ')), []);
});
