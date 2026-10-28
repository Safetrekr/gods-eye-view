// SafeTrekr Executive B1: the fixture file itself (EP-41, EP-36 §§4–5).
// The ledger and every id (the generator's own assertions, re-run on the
// committed file), `sample: true`, no banned word in any string a screen
// shows, the length caps, the school build hashes and the school import
// graph (nothing on twin.html's graph imports products/executive/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertDay } from '../../../../../scripts/executive-fixtures-lib.mjs';
import {
  FORBIDDEN,
  HASHES,
  TAG,
  twinGraph,
} from '../../../../../scripts/trip-twin-profile-check.mjs';
import { CAPS, plainBreach } from './words.js';
import { bluf } from './format.js';

const day = JSON.parse(
  readFileSync(new URL('./data/day.json', import.meta.url), 'utf8'),
);
const root = new URL('../../../../../', import.meta.url);

test('day.json: the EP-41 ledger holds and every id resolves (the generator’s assertions)', () => {
  assert.equal(assertDay(day), true);
  assert.equal(Object.keys(day.bundles).length, 214);
  assert.equal(day.events.filter((e) => /^e-\d{4}$/.test(e.id)).length, 106);
  assert.equal(day.expected.situations.length, 6);
});

test('day.json: sample is true on the file and on every record', () => {
  assert.equal(day.sample, true);
  for (const [name, coll] of Object.entries({
    bundles: day.bundles,
    people: day.people,
    legs: day.legs,
    places: day.places,
    details: day.details,
  }))
    for (const [id, r] of Object.entries(coll))
      assert.equal(r.sample, true, `${name}.${id}`);
  for (const e of day.events) assert.equal(e.sample, true, e.id);
  for (const s of [
    ...day.watch.staff,
    ...day.trips,
    ...day.vehicles,
    ...day.schedule_positions,
    ...day.paths,
  ])
    assert.equal(s.sample, true, s.id);
  assert.match(day.label, /^SAMPLE/);
});

test('day.json: no string a screen shows holds a banned word (EP-36 §5)', () => {
  // TarvaRI's msg_type enum value "alert" is a field value, never shown.
  const exempt = new Set(['msg_type']);
  const hits = [];
  (function walk(v, path, key) {
    if (typeof v === 'string') {
      if (!exempt.has(key)) {
        const w = plainBreach(v);
        if (w) hits.push(`${path}: "${w}" in "${v.slice(0, 80)}"`);
      }
    } else if (Array.isArray(v))
      v.forEach((x, i) => walk(x, `${path}[${i}]`, key));
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, k);
  })(day, 'day', null);
  assert.deepEqual(hits, []);
});

test('day.json: the EP-36 §4 length caps hold on every capped field', () => {
  const len = (s) => [...s].length;
  const over = [];
  const cap = (kind, s, where) => {
    if (typeof s === 'string' && len(s) > CAPS[kind])
      over.push(`${where} ${kind} ${len(s)} > ${CAPS[kind]}: ${s}`);
  };
  for (const p of Object.values(day.people)) {
    cap('callsign', p.callsign, p.id);
    cap('displayName', p.name, p.id);
  }
  for (const pl of Object.values(day.places))
    cap('placeName', pl.name, pl.place_id);
  for (const s of day.expected.situations)
    cap('whyRaised', s.why_raised, s.sit_id);
  for (const e of day.events) {
    if (e.type === 'recommendation.draft') bluf(e.bluf);
    cap('mainRow', e.main_row, e.id);
    if (e.type === 'intel.dismiss') cap('dismissalReason', e.reason, e.id);
    if (e.type === 'dl.respond') cap('dlAnswer', e.reason, e.id);
    if (e.type === 'posture.retier') cap('retierReason', e.reason, e.id);
    for (const c of Object.values(e.phone || {})) {
      cap('notificationTitle', c.title, e.id);
      cap('notificationBody', c.body, e.id);
      for (const b of c.buttons || []) cap('button', b, e.id);
    }
    if (e.type === 'salute.file')
      for (const line of e.card)
        cap('saluteValue', line.replace(/^[A-Z]+ /, ''), e.id);
    if (e.type === 'sitrep.draft')
      for (const v of Object.values(e.card || {})) cap('sitrepSlot', v, e.id);
  }
  assert.deepEqual(over, []);
});

test('day.json: times are ISO UTC, events in time order, the beats at EP-35 §5’s anchors', () => {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  for (const e of day.events) assert.match(e.at, iso, e.id);
  for (let i = 1; i < day.events.length; i += 1)
    assert.ok(day.events[i - 1].at <= day.events[i].at);
  for (const b of Object.values(day.bundles))
    assert.match(b.ingested_at, iso, b.bundle_id);
  assert.deepEqual(day.beats, {
    0: '2026-10-27T14:30:00Z',
    1: '2026-10-27T15:30:00Z',
    2: '2026-10-27T18:00:00Z',
    3: '2026-10-27T22:00:00Z',
    4: '2026-10-28T00:30:00Z',
    5: '2026-10-28T01:00:00Z',
  });
});

test('school build hashes: recorded once from the clean tag (twin.html and assets/twin-*.js)', () => {
  const h = JSON.parse(readFileSync(new URL(HASHES, root), 'utf8'));
  assert.equal(h.tag, TAG);
  assert.match(h.commit, /^[0-9a-f]{40}$/);
  const names = Object.keys(h.files);
  assert.ok(names.includes('twin.html'));
  assert.ok(names.some((n) => /^assets\/twin-[^.]+\.js$/.test(n)));
  for (const v of Object.values(h.files)) assert.match(v, /^[0-9a-f]{64}$/);
});

test('nothing on twin.html’s import graph imports products/executive/', () => {
  const graph = twinGraph();
  assert.ok(graph.includes('src/operations/tripTwin/page.js'));
  assert.ok(graph.length > 100);
  assert.deepEqual(
    graph.filter((f) => f.startsWith(FORBIDDEN)),
    [],
  );
});
