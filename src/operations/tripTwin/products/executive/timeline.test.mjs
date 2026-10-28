// SafeTrekr Executive B1: the scripted day (EP-35 §§5, 9 groups 1–2).
// Deterministic replay (fold twice deep-equal; golden state hashes at the
// beat anchors), the counter at 1430Z and 0100Z, loop.json's own counter
// at each of its events, and replay from any point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  beatAt,
  buildTimeline,
  fold,
  foldTo,
  foldToBeat,
  goldenFor,
  replay,
  stableStringify,
} from './timeline.js';
import { applyLoopEvent } from './loop/twinLoop.js';
import { selectCounter } from './loop/select.js';

const day = JSON.parse(
  readFileSync(new URL('./data/day.json', import.meta.url), 'utf8'),
);
const golden = JSON.parse(
  readFileSync(new URL('./loop/replay.golden.json', import.meta.url), 'utf8'),
);
const sha = (t) => createHash('sha256').update(t).digest('hex');
const TL = buildTimeline(day);
const asList = (c) => [c.in, c.matched, c.raised, c.pushed, c.closed];

test('the timeline: every bundle, version, raise, fix and scripted event once, in time order', () => {
  const versions = Object.values(day.bundles).reduce(
    (n, b) => n + 1 + (b.history?.length || 0),
    0,
  );
  const raises = day.raises.filter(
    (r) => r.at > day.bundles[r.bundle_id].ingested_at,
  ).length;
  assert.equal(
    TL.length,
    versions + raises + day.fixes.length + day.events.length,
  );
  assert.equal(
    new Set(TL.map((e) => e.ev.id)).size,
    TL.length,
    'event ids are unique',
  );
  assert.equal(TL[0].seq, 't-0001');
  for (let i = 1; i < TL.length; i += 1)
    assert.ok(TL[i - 1].at <= TL[i].at, `${TL[i].seq} in order`);
  // A done-by-position ack follows the fix that proves it.
  const done = TL.findIndex((e) => e.ev.id === 'e-0023');
  const fix = TL.findIndex((e) => e.ev.fix_id === 'f-00405');
  assert.ok(fix < done && TL[fix].at === TL[done].at);
  // Beats: the scripted events keep loop.json's own; the rest fall in by anchor.
  assert.equal(beatAt(day, '2026-10-27T15:19:00Z'), 0);
  assert.equal(beatAt(day, '2026-10-27T22:06:00Z'), 3);
  assert.equal(beatAt(day, '2026-10-28T00:59:00Z'), 4);
  assert.equal(TL.find((e) => e.ev.id === 'e-0035').beat, 2);
});

test('replay: the whole day folds with no refusal, and twice is deep-equal', () => {
  const a = fold(day, TL);
  const b = fold(day, buildTimeline(day));
  assert.deepEqual(a.refused, []);
  assert.deepEqual(a.loop, b.loop);
  assert.equal(sha(stableStringify(a.loop)), sha(stableStringify(b.loop)));
  for (const s of Object.values(a.loop.situations))
    assert.equal(s.state, 'CLOSED', s.sit_id);
});

test('replay: the state hash at each beat anchor matches the golden file', () => {
  assert.equal(golden.entries, TL.length);
  assert.deepEqual(goldenFor(day, sha), golden);
  for (const [n, g] of Object.entries(golden.beats)) {
    const { loop, refused } = foldToBeat(day, n, TL);
    assert.equal(refused.length, 0);
    assert.equal(loop.clock.simNow, g.at);
    assert.equal(loop.clock.beat, Number(n));
    assert.equal(sha(stableStringify(loop)), g.hash, `beat ${n}`);
  }
});

test('the counter: {186,7,2,0,2} at 1430Z and {214,11,6,4,6} at 0100Z (EP-41)', () => {
  assert.deepEqual(
    asList(selectCounter(foldToBeat(day, 0, TL).loop)),
    [186, 7, 2, 0, 2],
  );
  assert.deepEqual(
    asList(selectCounter(foldToBeat(day, 5, TL).loop)),
    [214, 11, 6, 4, 6],
  );
  assert.deepEqual(day.expected.ledger.at_1430Z, {
    in: 186,
    matched: 7,
    raised: 2,
    pushed: 0,
    closed: 2,
  });
  assert.deepEqual(day.expected.ledger.at_0100Z, {
    in: 214,
    matched: 11,
    raised: 6,
    pushed: 4,
    closed: 6,
  });
});

test('the counter equals loop.json’s counter_after at each of its 106 events, and the inequalities hold', () => {
  let seen = 0;
  fold(day, TL, {
    onStep: (loop, e) => {
      const c = selectCounter(loop);
      assert.ok(
        c.raised <= c.matched && c.pushed <= c.raised && c.closed <= c.raised,
        `${e.seq} ${JSON.stringify(c)}`,
      );
      const want = day.expected.counter_after[e.ev.id];
      if (!want) return;
      assert.deepEqual(asList(c), want, `${e.ev.id} at ${e.at}`);
      seen += 1;
    },
  });
  assert.equal(seen, 106);
});

test('replay from any point: fold(slice(0, i)) then the rest equals the whole fold', () => {
  const whole = fold(day, TL).loop;
  for (const i of [1, 400, 699, 1000, 1500, TL.length - 1]) {
    const head = replay(day, i, TL).loop;
    const tail = fold(day, TL.slice(i), { loop: head }).loop;
    assert.deepEqual(tail, whole, `split at ${i}`);
  }
});

test('the six situations open where the fixtures say, from intel.received or the deferred raise', () => {
  const { loop } = fold(day, TL);
  for (const exp of day.expected.situations) {
    const s = loop.situations[exp.sit_id];
    assert.equal(s.raised_at, exp.raised_at, exp.sit_id);
    assert.equal(s.person_id, exp.person_id);
    assert.equal(s.leg_id, exp.leg_id);
    assert.equal(s.verification_id, exp.verification_id);
    assert.equal(s.push_id, exp.push_id);
    assert.equal(
      loop.sitreps[s.sitrep_id].signed_at,
      exp.signed_at,
      exp.sit_id,
    );
  }
  // The march: watched at 1519Z (P3), raise-ready at 1552Z (P2), raised at 1555Z, C2 at 1602Z.
  assert.equal(
    foldTo(day, '2026-10-27T15:54:00Z', TL).loop.intel['b-reg-048']
      .raise_pending,
    'raise',
  );
  const m = foldTo(day, '2026-10-27T16:03:00Z', TL).loop;
  assert.equal(m.intel['b-reg-048'].grade, 'C2');
  assert.equal(m.situations['s-kestrel-01'].grade, 'C2');
});

test('beat.go: one pass to the anchor; going back is reset and refold', () => {
  const b2 = foldToBeat(day, 2, TL).loop;
  assert.equal(b2.clock.simNow, '2026-10-27T18:00:00Z');
  assert.equal(
    applyLoopEvent(b2, {
      type: 'beat.go',
      n: 1,
      at: b2.clock.simNow,
      by: 'presenter',
    }).refused.code,
    'I12_TIME',
  );
  const reset = applyLoopEvent(b2, {
    type: 'reset',
    at: b2.clock.simNow,
    by: 'presenter',
  }).loop;
  const refold = fold(
    day,
    TL.filter((e) => e.at <= day.beats[1]),
    { loop: reset },
  ).loop;
  const direct = fold(
    day,
    TL.filter((e) => e.at <= day.beats[1]),
  ).loop;
  // Same records; only their meta.rev differs, since rev never rewinds.
  const noMeta = (x) =>
    JSON.parse(JSON.stringify(x, (k, v) => (k === 'meta' ? undefined : v)));
  assert.deepEqual(noMeta(refold.situations), noMeta(direct.situations));
  assert.deepEqual(noMeta(refold.intel), noMeta(direct.intel));
  assert.equal(refold.rev, b2.rev + 1 + direct.rev);
});
