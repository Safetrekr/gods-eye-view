// SafeTrekr Executive B6: the Verify wall shows recalled and superseded
// pushes as such (EP-33 §3, B4b requests 1–2), and at beat 5 the record of
// ATLAS opens there with the day summary (EP-20 beat 5): callsigns only,
// the access log, no "no one else".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyLoopEvent } from '../loop/twinLoop.js';
import { buildTimeline, fold } from '../timeline.js';
import { verifyView } from './views.js';

const day = JSON.parse(
  readFileSync(new URL('../data/day.json', import.meta.url), 'utf8'),
);
const TL = buildTimeline(day);
const upTo = (iso) =>
  fold(
    day,
    TL.filter((e) => e.at <= iso),
  ).loop;
const ok = (r) => {
  assert.equal(r.refused, undefined, JSON.stringify(r.refused));
  return r.loop;
};
const NAMES = Object.values(day.people).map((p) => p.name);

test('B6 Verify: a recalled push is back on the wall, RECALLED with time, who and reason', () => {
  const loop = ok(
    applyLoopEvent(upTo('2026-10-27T16:05:30Z'), {
      id: 'e-t-recall',
      type: 'push.recall',
      push_id: 'push-kestrel-01',
      reason: 'wrong recipient',
      reverses: 'e-0015',
      at: '2026-10-27T16:05:40Z',
      by: 'VALE',
    }),
  );
  const v = verifyView(loop);
  assert.equal(v.recalled.length, 1);
  assert.equal(v.recalled[0].callsign, 'KESTREL');
  assert.equal(
    v.recalled[0].line,
    'RECALLED 1605Z VALE · reason: wrong recipient',
  );
  assert.equal(v.cardWhy, 'recalled · awaiting a new push');
  assert.match(v.card.rec.sig, /RECALLED 1605Z VALE · reason: wrong recipient/);
  assert.ok(v.card.rec.ladders.every((l) => l.state === 'recalled'));
  assert.equal(v.record, null);
});

test('B6 Verify: a superseded push stays, greyed, under the new one', () => {
  let loop = upTo('2026-10-27T16:07:10Z');
  for (const ev of [
    {
      id: 'e-t-edit',
      type: 'recommendation.edit',
      recommendation_id: 'r-kestrel-01',
      patch: {
        bluf: 'Arrive 1220L by the Barton Springs Rd side; avoid W Riverside Dr',
      },
      at: '2026-10-27T16:07:20Z',
      by: 'VALE',
    },
    {
      id: 'e-t-approve',
      type: 'recommendation.approve',
      recommendation_id: 'r-kestrel-01',
      at: '2026-10-27T16:07:25Z',
      by: 'VALE',
    },
    {
      id: 'e-t-push2',
      type: 'push.send',
      recommendation_id: 'r-kestrel-01',
      push_id: 'push-kestrel-01-v2',
      supersedes: 'push-kestrel-01',
      reverses: 'e-0015',
      at: '2026-10-27T16:07:30Z',
      by: 'VALE',
    },
  ])
    loop = ok(applyLoopEvent(loop, ev));
  const v = verifyView(loop);
  const rec = v.card.rec;
  assert.deepEqual(
    rec.pushes.map((p) => p.state),
    ['live', 'superseded'],
  );
  assert.match(rec.pushes[1].text, /SUPERSEDED 1607Z · see push-kestrel-01-v2/);
  assert.match(rec.pushes[0].text, /supersedes push-kestrel-01/);
  const old = rec.ladders.filter((l) => l.state === 'superseded');
  assert.equal(old.length, 2);
  assert.equal(old[0].note, 'SUPERSEDED 1607Z · see push-kestrel-01-v2');
  assert.ok(v.decided.some((d) => /1 superseded/.test(d.line)));
});

test('B6 beat 5: the record of ATLAS opens on Verify, with the day reconciled; callsigns only', () => {
  const v = verifyView(upTo('2026-10-28T01:00:00Z'));
  assert.ok(v.record, 'the record opens at beat 5');
  assert.equal(v.record.title, 'RECORD · ATLAS · 27 OCT 26 · SAMPLE');
  assert.equal(v.record.situations[0].sit_id, 's-atlas-01');
  assert.equal(v.day.summary.reconciled, true);
  assert.equal(
    v.day.summary.line,
    '214 in (intake + partner feeds) · 11 matched · 6 raised · 4 pushed · 6 closed',
  );
  const text = JSON.stringify({ record: v.record, day: v.day });
  for (const n of NAMES) assert.ok(!text.includes(n), n);
  assert.doesNotMatch(text, /no one else/i);
  assert.equal(verifyView(upTo('2026-10-28T00:36:00Z')).record, null);
});
