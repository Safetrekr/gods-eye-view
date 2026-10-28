// SafeTrekr Executive B4: the reversals through the reducer (EP-33 §3).
// Nothing is deleted or edited: every reversal is a new event carrying
// `reverses: e-…`, and the reversed event stays in the record beside it.
// Restore a dismissal, reopen a decision (never under a live push),
// recall before a read, supersede after one, reopen a closed situation
// (the SITREP keeps v1 and gains v2), re-tier back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CODES, applyLoopEvent } from './twinLoop.js';
import { REVERSALS, UNDOABLE } from './loopPolicy.js';
import { mainRowFor, selectCounter } from './select.js';
import { buildTimeline, fold } from '../timeline.js';

const day = JSON.parse(
  readFileSync(new URL('../data/day.json', import.meta.url), 'utf8'),
);
const TL = buildTimeline(day);
const upTo = (iso) =>
  fold(
    day,
    TL.filter((e) => e.at <= iso),
  ).loop;
const ev = (id) => structuredClone(day.events.find((e) => e.id === id));
const ok = (r) => {
  assert.equal(r.refused, undefined, JSON.stringify(r.refused));
  return r.loop;
};
function no(loop, event, code) {
  const snapshot = JSON.stringify(loop);
  const r = applyLoopEvent(loop, event);
  assert.equal(
    r.refused?.code,
    code,
    `${event.type}: ${JSON.stringify(r.refused)}`,
  );
  assert.ok(CODES[code], `code ${code} is listed`);
  assert.equal(JSON.stringify(loop), snapshot, 'a refusal changes nothing');
}
const logLine = (loop, id) => loop.log.find((l) => l.id === id);

test('B4 EP-33 §3: the reversal kinds are data; every one names what it may reverse', () => {
  assert.deepEqual(Object.keys(REVERSALS).sort(), [
    'intel.restore',
    'push.recall',
    'situation.reopen',
    'verification.reopen',
  ]);
  for (const r of Object.values(UNDOABLE)) assert.ok(REVERSALS[r]);
});

test('B4 restore a dismissal: back from dismissed, the dismissal stays on record; a reversal must say what it reverses', () => {
  let loop = upTo('2026-10-27T14:25:00Z');
  assert.equal(loop.intel['b-m-034'].status, 'dismissed');
  const restore = {
    id: 'e-t-restore',
    type: 'intel.restore',
    bundle_id: 'b-m-034',
    at: '2026-10-27T14:26:30Z',
    by: 'VALE',
  };
  no(loop, restore, 'BAD_EVENT');
  no(loop, { ...restore, reverses: 'e-nope' }, 'NOT_FOUND');
  // A reversal of another record or kind is refused.
  no(loop, { ...restore, reverses: 'e-0006' }, 'REVERSES_MISMATCH');
  no(loop, { ...restore, reverses: 'e-am-kestrel-am-1' }, 'REVERSES_MISMATCH');
  // Only the watch reverses.
  no(loop, { ...restore, reverses: 'e-0007', by: 'p-kestrel' }, 'ROLE');
  loop = ok(applyLoopEvent(loop, { ...restore, reverses: 'e-0007' }));
  const b = loop.intel['b-m-034'];
  assert.notEqual(b.status, 'dismissed');
  assert.equal(b.decided, null);
  assert.equal(b.restored.of.kind, 'dismiss');
  assert.equal(b.restored.reverses, 'e-0007');
  assert.equal(logLine(loop, 'e-t-restore').reverses, 'e-0007');
  assert.ok(logLine(loop, 'e-0007'), 'the dismissal stays in the record');
  // Twice: nothing left to restore.
  no(
    loop,
    {
      ...restore,
      id: 'e-t-restore-2',
      reverses: 'e-0007',
      at: '2026-10-27T14:27:00Z',
    },
    'ALREADY',
  );
});

test('B4 reopen a decision: back to RAISED and the approval void; a new decision is v2; never under a live push', () => {
  let loop = upTo('2026-10-27T16:04:40Z');
  assert.equal(loop.situations['s-kestrel-01'].state, 'VERIFIED');
  loop = ok(
    applyLoopEvent(loop, {
      id: 'e-t-reopen',
      type: 'verification.reopen',
      sit_id: 's-kestrel-01',
      reverses: 'e-0012',
      at: '2026-10-27T16:04:45Z',
      by: 'VALE',
    }),
  );
  const sit = loop.situations['s-kestrel-01'];
  assert.equal(sit.state, 'RAISED');
  assert.equal(sit.verification_id, null);
  assert.equal(loop.verifications['v-kestrel-01'].reversed_by, 'VALE');
  // The scripted approval has nothing to rest on now (I1).
  no(loop, ev('e-0014'), 'I1_NO_VERIFICATION');
  // A new decision takes the same verification, version 2.
  loop = ok(
    applyLoopEvent(loop, {
      id: 'e-t-v2',
      type: 'verification.decide',
      sit_id: 's-kestrel-01',
      decision: 'verified',
      at: '2026-10-27T16:04:48Z',
      by: 'VALE',
    }),
  );
  const v = loop.verifications['v-kestrel-01'];
  assert.equal(v.version, 2);
  assert.equal(v.reversed_at, undefined);
  assert.equal(v.versions[0].reversed_by, 'VALE', 'v1 kept with its reversal');
  loop = ok(applyLoopEvent(loop, { ...ev('e-0014'), version: undefined }));
  loop = ok(applyLoopEvent(loop, ev('e-0015')));
  // Pushed: the decision stays (recall or supersede first).
  no(
    loop,
    {
      id: 'e-t-reopen-2',
      type: 'verification.reopen',
      sit_id: 's-kestrel-01',
      reverses: 'e-t-v2',
      at: '2026-10-27T16:05:30Z',
      by: 'VALE',
    },
    'UNDO_LOWERS',
  );
});

test('B4 a countersign on a reopened DETAIL decision is stale (the two-person rule rechecks)', () => {
  let loop = upTo('2026-10-27T18:05:30Z');
  loop = ok(
    applyLoopEvent(loop, {
      id: 'e-t-reopen-atlas',
      type: 'verification.reopen',
      sit_id: 's-atlas-01',
      reverses: 'e-0027',
      at: '2026-10-27T18:05:40Z',
      by: 'VALE',
    }),
  );
  no(loop, ev('e-0028'), 'STALE');
});

test('B4 recall before a read: off MAIN, back to verified, later receipts refused; after a read it is a supersede', () => {
  const pushed = upTo('2026-10-27T16:05:30Z');
  assert.ok(mainRowFor(pushed, 's-kestrel-01').row);
  const recall = {
    id: 'e-t-recall',
    type: 'push.recall',
    push_id: 'push-kestrel-01',
    reason: 'wrong recipient',
    reverses: 'e-0015',
    at: '2026-10-27T16:05:40Z',
    by: 'VALE',
  };
  no(pushed, { ...recall, reason: ' ' }, 'NO_REASON');
  no(pushed, { ...recall, by: 'ORTEGA' }, 'ROLE');
  const loop = ok(applyLoopEvent(pushed, recall));
  const p = loop.pushes['push-kestrel-01'];
  assert.equal(p.recalled_by, 'VALE');
  assert.equal(p.recall_reason, 'wrong recipient');
  assert.equal(loop.situations['s-kestrel-01'].state, 'VERIFIED');
  assert.equal(loop.recommendations['r-kestrel-01'].status, 'recalled');
  assert.equal(
    mainRowFor(loop, 's-kestrel-01').refused?.code,
    'I3_NOT_ON_MAIN',
  );
  no(loop, ev('e-0018'), 'RECALLED');
  // Read already: refused, supersede instead.
  const read = upTo('2026-10-27T16:06:10Z');
  no(read, { ...recall, at: '2026-10-27T16:06:20Z' }, 'RECALL_AFTER_READ');
});

test('B4 supersede after a read: a new version replaces the push; the old card takes no more answers', () => {
  let loop = upTo('2026-10-27T16:07:10Z');
  const edit = {
    id: 'e-t-edit',
    type: 'recommendation.edit',
    recommendation_id: 'r-kestrel-01',
    patch: {
      bluf: 'Arrive 1220L by the Barton Springs Rd side; avoid W Riverside Dr',
    },
    at: '2026-10-27T16:07:20Z',
    by: 'VALE',
  };
  loop = ok(applyLoopEvent(loop, edit));
  loop = ok(
    applyLoopEvent(loop, {
      id: 'e-t-approve',
      type: 'recommendation.approve',
      recommendation_id: 'r-kestrel-01',
      at: '2026-10-27T16:07:25Z',
      by: 'VALE',
    }),
  );
  const push = {
    id: 'e-t-push2',
    type: 'push.send',
    recommendation_id: 'r-kestrel-01',
    push_id: 'push-kestrel-01-v2',
    at: '2026-10-27T16:07:30Z',
    by: 'VALE',
  };
  no(loop, push, 'SUPERSEDE_REQUIRED');
  loop = ok(
    applyLoopEvent(loop, {
      ...push,
      supersedes: 'push-kestrel-01',
      reverses: 'e-0015',
    }),
  );
  assert.equal(
    loop.pushes['push-kestrel-01'].superseded_by,
    'push-kestrel-01-v2',
  );
  assert.equal(loop.pushes['push-kestrel-01-v2'].supersedes, 'push-kestrel-01');
  assert.equal(loop.situations['s-kestrel-01'].push_id, 'push-kestrel-01-v2');
  assert.equal(logLine(loop, 'e-t-push2').supersedes, 'push-kestrel-01');
  no(loop, ev('e-0022'), 'SUPERSEDED');
  // Before any read, a supersede is refused: recall instead.
  let early = upTo('2026-10-27T16:05:30Z');
  early = ok(applyLoopEvent(early, { ...edit, at: '2026-10-27T16:05:31Z' }));
  early = ok(
    applyLoopEvent(early, {
      id: 'e-t-approve',
      type: 'recommendation.approve',
      recommendation_id: 'r-kestrel-01',
      at: '2026-10-27T16:05:32Z',
      by: 'VALE',
    }),
  );
  no(
    early,
    { ...push, supersedes: 'push-kestrel-01', at: '2026-10-27T16:05:33Z' },
    'SUPERSEDE_BEFORE_READ',
  );
});

test('B4 reopen a closed situation: reason from a closed list; the SITREP keeps v1 and gains an unsigned v2; close again', () => {
  let loop = upTo('2026-10-27T17:16:20Z');
  const before = selectCounter(loop);
  assert.equal(loop.situations['s-kestrel-01'].state, 'CLOSED');
  const reopen = {
    id: 'e-t-sit-reopen',
    type: 'situation.reopen',
    sit_id: 's-kestrel-01',
    reason: 'new_report',
    reverses: 'e-0026',
    at: '2026-10-27T17:16:30Z',
    by: 'ORTEGA',
  };
  no(loop, { ...reopen, reason: 'because' }, 'BAD_VALUE');
  no(loop, { ...reopen, reverses: 'e-0025' }, 'REVERSES_MISMATCH');
  loop = ok(applyLoopEvent(loop, reopen));
  const sit = loop.situations['s-kestrel-01'];
  assert.equal(sit.state, 'DONE', 'back to what its ladder says');
  assert.equal(sit.reopened[0].reason, 'new_report');
  assert.equal(sit.reopened[0].by, 'ORTEGA');
  const rep = loop.sitreps['sr-kestrel-01'];
  assert.equal(rep.version, 2);
  assert.equal(rep.signed_at, null);
  assert.equal(rep.versions.at(-1).signed_by, 'VALE', 'v1 kept, signed');
  assert.equal(selectCounter(loop).closed, before.closed - 1);
  no(loop, { ...reopen, id: 'e-x', at: '2026-10-27T17:16:31Z' }, 'NOT_CLOSED');
  // Sign v2 and close again.
  loop = ok(
    applyLoopEvent(loop, {
      id: 'e-t-sign2',
      type: 'sitrep.sign',
      sitrep_id: 'sr-kestrel-01',
      version: 2,
      at: '2026-10-27T17:17:00Z',
      by: 'VALE',
    }),
  );
  loop = ok(
    applyLoopEvent(loop, {
      id: 'e-t-close2',
      type: 'situation.close',
      sit_id: 's-kestrel-01',
      reason: 'clear',
      at: '2026-10-27T17:17:10Z',
      by: 'VALE',
    }),
  );
  assert.equal(loop.situations['s-kestrel-01'].state, 'CLOSED');
  assert.equal(selectCounter(loop).closed, before.closed);
});

test('B4 re-tier back: ORTEGA only, with a reason, naming the re-tier it reverses', () => {
  let loop = upTo('2026-10-27T22:12:10Z');
  assert.equal(loop.people['p-wren'].protection, 'REMOTE');
  const back = {
    id: 'e-t-back',
    type: 'posture.retier',
    person_id: 'p-wren',
    to: 'MONITORED',
    reason: 'event over; post removed',
    reverses: 'e-0064',
    at: '2026-10-27T22:12:20Z',
    by: 'ORTEGA',
  };
  no(loop, { ...back, by: 'VALE' }, 'I6_NOT_SUPERVISOR');
  no(loop, { ...back, reverses: 'e-0063' }, 'REVERSES_MISMATCH');
  loop = ok(applyLoopEvent(loop, back));
  assert.equal(loop.people['p-wren'].protection, 'MONITORED');
  const rt = loop.retiers.at(-1);
  assert.equal(rt.from, 'REMOTE');
  assert.equal(rt.reverses, 'e-0064');
  assert.equal(loop.retiers.length, 2, 'the first re-tier stays');
});
