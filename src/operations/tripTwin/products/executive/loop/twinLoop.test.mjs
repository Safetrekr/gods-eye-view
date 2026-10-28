// SafeTrekr Executive B1: the loop reducer (EP-35 §§1, 9 groups 3 and 6).
// Every invariant I1–I12 with a refusing case and its code, EP-37 §12's
// refusals, expiry, the call-back chain and the re-tier. Scenarios start
// from the scripted day folded to a moment, then apply one crafted event.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CODES, applyLoopEvent, createLoop } from './twinLoop.js';
import { selectMain, mainRowFor } from './select.js';
import { buildTimeline, fold } from '../timeline.js';

const day = JSON.parse(
  readFileSync(new URL('../data/day.json', import.meta.url), 'utf8'),
);
const TL = buildTimeline(day);
/** The loop with every scripted entry at or before `iso` applied. */
const upTo = (iso) =>
  fold(
    day,
    TL.filter((e) => e.at <= iso),
  ).loop;
/** …and every entry before the event with this id. */
const before = (id) => {
  const i = TL.findIndex((e) => e.ev.id === id);
  return fold(day, TL.slice(0, i)).loop;
};
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
  assert.equal(r.loop, loop, 'a refusal returns the same state');
  assert.deepEqual(r.changed, []);
  assert.equal(JSON.stringify(loop), snapshot, 'a refusal changes nothing');
}

test('createLoop: people, legs and details from the fixtures; no intel; clock at t0', () => {
  const loop = createLoop({ fixtures: day, t0: day.t0 });
  assert.equal(loop.rev, 0);
  assert.equal(loop.clock.simNow, '2026-10-27T00:00:00Z');
  assert.equal(Object.keys(loop.people).length, 40);
  assert.equal(Object.keys(loop.legs).length, 22);
  assert.equal(loop.people['p-wren'].protection, 'MONITORED');
  assert.equal(loop.people['p-atlas'].detail_id, 'd-atlas');
  assert.deepEqual(loop.intel, {});
  assert.equal(loop.watch.ORTEGA.role, 'supervisor');
});

test('applyLoopEvent: clone, rev + 1, meta {rev, by, at} on the record written', () => {
  const loop = before('e-0012');
  const r = applyLoopEvent(loop, ev('e-0012'));
  const next = ok(r);
  assert.equal(next.rev, loop.rev + 1);
  assert.deepEqual(next.verifications['v-kestrel-01'].meta, {
    rev: next.rev,
    by: 'VALE',
    at: '2026-10-27T16:04:00Z',
  });
  assert.equal(
    loop.verifications['v-kestrel-01'],
    undefined,
    'the input is untouched',
  );
  assert.ok(
    r.changed.includes('verifications') && r.changed.includes('situations'),
  );
  assert.equal(next.log.at(-1).type, 'verification.decide');
});

test('I1 no push without verification: approve and push refused before a verification', () => {
  const loop = upTo('2026-10-27T15:56:00Z'); // the march raised 1555Z, not yet verified
  assert.equal(loop.situations['s-kestrel-01'].state, 'RAISED');
  const draft = {
    ...ev('e-0013'),
    at: '2026-10-27T15:56:10Z',
    verification_id: undefined,
  };
  const drafted = ok(applyLoopEvent(loop, draft));
  no(
    drafted,
    { ...ev('e-0014'), at: '2026-10-27T15:56:20Z' },
    'I1_NO_VERIFICATION',
  );
  no(
    drafted,
    { ...ev('e-0015'), at: '2026-10-27T15:56:30Z' },
    'I1_NO_VERIFICATION',
  );
  // A `watch` decision is a verification a push may not rest on.
  const watched = ok(
    applyLoopEvent(drafted, {
      ...ev('e-0012'),
      at: '2026-10-27T15:56:40Z',
      decision: 'watch',
    }),
  );
  no(
    watched,
    { ...ev('e-0014'), at: '2026-10-27T15:56:50Z' },
    'I1_NO_VERIFICATION',
  );
  // Verified, but a draft is not yet approved: push refused.
  const verified = ok(
    applyLoopEvent(drafted, { ...ev('e-0012'), at: '2026-10-27T15:56:40Z' }),
  );
  no(
    verified,
    { ...ev('e-0015'), at: '2026-10-27T15:56:50Z' },
    'I1_NOT_APPROVED',
  );
});

test('I2 DETAIL needs a countersign: ATLAS approve refused before, allowed after; the push carries unconfirmed', () => {
  let loop = upTo('2026-10-27T18:05:00Z'); // assessed 1805Z VALE, not countersigned
  loop = ok(
    applyLoopEvent(loop, { ...ev('e-0030'), at: '2026-10-27T18:05:30Z' }),
  );
  no(
    loop,
    { ...ev('e-0031'), at: '2026-10-27T18:05:40Z' },
    'I2_NO_COUNTERSIGN',
  );
  loop = ok(applyLoopEvent(loop, ev('e-0028'))); // ORTEGA 1806Z
  const v = loop.verifications['v-atlas-01'];
  assert.equal(v.countersigned_by, 'ORTEGA');
  assert.notEqual(v.countersigned_by, v.verified_by);
  loop = ok(
    applyLoopEvent(loop, { ...ev('e-0031'), at: '2026-10-27T18:06:10Z' }),
  );
  loop = ok(
    applyLoopEvent(loop, { ...ev('e-0032'), at: '2026-10-27T18:06:20Z' }),
  );
  assert.equal(loop.pushes['push-atlas-01'].unconfirmed, true);
  assert.equal(loop.pushes['push-atlas-01'].tier, 'DETAIL');
});

test('I2 the countersign must be another person; the analyst may not countersign at all', () => {
  const loop = before('e-0028');
  no(loop, { ...ev('e-0028'), by: 'VALE' }, 'ROLE');
  // The supervisor assessed it himself: his countersign is refused.
  let own = before('e-0027');
  own = ok(applyLoopEvent(own, { ...ev('e-0027'), by: 'ORTEGA' }));
  no(own, ev('e-0028'), 'I2_SAME_PERSON');
  // A countersign on a version that has moved on is stale (EP-33 §2).
  no(loop, { ...ev('e-0028'), version: 2 }, 'STALE');
});

test('I3 MAIN only sees verified situations, and a DETAIL item once its leader answers', () => {
  const raised = upTo('2026-10-27T15:56:00Z');
  assert.equal(
    mainRowFor(raised, 's-kestrel-01').refused.code,
    'I3_NOT_ON_MAIN',
  );
  assert.deepEqual(selectMain(raised).rows, []);
  const pushed = upTo('2026-10-27T18:10:00Z'); // ATLAS pushed 1808Z, DL not yet answered
  assert.equal(pushed.situations['s-atlas-01'].state, 'PUSHED');
  assert.equal(mainRowFor(pushed, 's-atlas-01').refused.code, 'I3_NOT_ON_MAIN');
  const answered = upTo('2026-10-27T18:14:00Z');
  assert.equal(mainRowFor(answered, 's-atlas-01').row.ladder, 'DL: nonconcur');
  assert.ok(CODES.I3_NOT_ON_MAIN);
});

test('I4 unconfirmed, actionable is for DETAIL only', () => {
  const loop = before('e-0012');
  no(
    loop,
    { ...ev('e-0012'), decision: 'unconfirmed_actionable' },
    'I4_UNCONFIRMED_NOT_DETAIL',
  );
  const atlas = before('e-0027');
  ok(applyLoopEvent(atlas, ev('e-0027')));
});

test('I5 dl.respond only from that detail’s leader, only on a DETAIL situation', () => {
  const loop = before('e-0036');
  no(
    loop,
    { ...ev('e-0036'), by: 'p-atlas3', participant_id: 'p-atlas3' },
    'I5_NOT_DETAIL_LEADER',
  );
  const k = upTo('2026-10-27T16:06:00Z');
  no(
    k,
    {
      ...ev('e-0036'),
      at: '2026-10-27T16:06:30Z',
      push_id: 'push-kestrel-01',
      by: 'p-kestrel',
      participant_id: 'p-kestrel',
    },
    'I5_NOT_DETAIL',
  );
  // On a DETAIL ladder the leader's answer stands in for "accepted".
  no(
    loop,
    {
      ...ev('e-0020'),
      at: '2026-10-27T18:13:00Z',
      push_id: 'push-atlas-01',
      by: 'p-atlas6',
      participant_id: 'p-atlas6',
    },
    'I5_DL_ANSWERS',
  );
});

test('I6 posture.retier only by the supervisor, with a reason', () => {
  const loop = before('e-0064');
  no(loop, { ...ev('e-0064'), by: 'VALE' }, 'I6_NOT_SUPERVISOR');
  no(loop, { ...ev('e-0064'), reason: '  ' }, 'I6_NO_REASON');
  ok(applyLoopEvent(loop, ev('e-0064')));
});

test('I7 close needs a signed SITREP and a finished ladder, a stand-down, expiry or dismissal', () => {
  // KESTREL accepted, HARRIER told; not done by position yet.
  let loop = upTo('2026-10-27T16:10:00Z');
  const close = { ...ev('e-0026'), at: '2026-10-27T16:10:30Z' };
  no(loop, close, 'I7_NO_SITREP');
  loop = ok(
    applyLoopEvent(loop, { ...ev('e-0024'), at: '2026-10-27T16:10:10Z' }),
  );
  loop = ok(
    applyLoopEvent(loop, { ...ev('e-0025'), at: '2026-10-27T16:10:20Z' }),
  );
  no(loop, close, 'I7_OPEN_LADDER');
  // ATLAS: a NON-CONCUR closes only after the leader's stand-down.
  let atlas = upTo('2026-10-27T20:00:00Z');
  atlas = ok(
    applyLoopEvent(atlas, { ...ev('e-0059'), at: '2026-10-27T20:00:10Z' }),
  );
  atlas = ok(
    applyLoopEvent(atlas, { ...ev('e-0060'), at: '2026-10-27T20:00:20Z' }),
  );
  no(atlas, { ...ev('e-0061'), at: '2026-10-27T20:00:30Z' }, 'I7_OPEN_LADDER');
  atlas = ok(
    applyLoopEvent(atlas, { ...ev('e-0057'), at: '2026-10-27T20:00:40Z' }),
  );
  ok(applyLoopEvent(atlas, { ...ev('e-0061'), at: '2026-10-27T20:00:50Z' }));
});

test('I8 past valid_until → EXPIRED on the next tick, off MAIN; a new push needs a new approval', () => {
  let loop = upTo('2026-10-27T16:10:00Z');
  assert.ok(selectMain(loop).rows.some((r) => r.callsign === 'KESTREL'));
  // The recommendation is valid until 1400L (1900Z). Nothing happens after 1610Z here.
  loop = ok(
    applyLoopEvent(loop, {
      type: 'clock.jump',
      at: '2026-10-27T19:01:00Z',
      to: '2026-10-27T19:01:00Z',
      by: 'presenter',
    }),
  );
  const s = loop.situations['s-kestrel-01'];
  assert.equal(s.state, 'EXPIRED');
  assert.equal(s.expired_at, '2026-10-27T19:00:00Z');
  assert.equal(loop.recommendations['r-kestrel-01'].status, 'expired');
  assert.equal(mainRowFor(loop, 's-kestrel-01').refused.code, 'I3_NOT_ON_MAIN');
  assert.ok(!selectMain(loop).rows.some((r) => r.callsign === 'KESTREL'));
  // The same recommendation may not be pushed again …
  no(
    loop,
    { ...ev('e-0015'), at: '2026-10-27T19:02:00Z', push_id: 'push-kestrel-02' },
    'I8_NEEDS_APPROVAL',
  );
  // … and may not be approved with a past valid_until.
  const edited = ok(
    applyLoopEvent(loop, {
      type: 'recommendation.edit',
      at: '2026-10-27T19:02:00Z',
      by: 'VALE',
      recommendation_id: 'r-kestrel-01',
      patch: { valid_until: '2026-10-27T19:01:30Z' },
    }),
  );
  no(
    edited,
    { ...ev('e-0014'), at: '2026-10-27T19:02:10Z', version: 2 },
    'I8_EXPIRED',
  );
  // A new version, a new approval, a new push: back on MAIN.
  loop = ok(
    applyLoopEvent(loop, {
      type: 'recommendation.edit',
      at: '2026-10-27T19:02:00Z',
      by: 'VALE',
      recommendation_id: 'r-kestrel-01',
      patch: { valid_until: '2026-10-27T20:00:00Z' },
    }),
  );
  assert.equal(loop.recommendations['r-kestrel-01'].version, 2);
  loop = ok(
    applyLoopEvent(loop, {
      ...ev('e-0014'),
      at: '2026-10-27T19:02:10Z',
      version: 2,
    }),
  );
  loop = ok(
    applyLoopEvent(loop, {
      ...ev('e-0015'),
      at: '2026-10-27T19:02:20Z',
      push_id: 'push-kestrel-02',
    }),
  );
  assert.equal(loop.situations['s-kestrel-01'].push_id, 'push-kestrel-02');
  assert.equal(loop.situations['s-kestrel-01'].state, 'PUSHED');
  assert.ok(selectMain(loop).rows.some((r) => r.callsign === 'KESTREL'));
});

test('I9 the ladder only moves up; a call-back needs an open chain', () => {
  const loop = upTo('2026-10-27T16:08:00Z'); // KESTREL accepted
  no(loop, { ...ev('e-0018'), at: '2026-10-27T16:08:10Z' }, 'I9_LADDER');
  no(
    loop,
    { ...ev('e-0070'), at: '2026-10-27T16:08:10Z', push_id: 'push-kestrel-01' },
    'I9_CALLBACK_NOT_OPEN',
  );
});

test('I9 a call-back opens at +10 min without a read and follows WREN’s escalation', () => {
  const at = '2026-10-27T22:23:59Z';
  const quiet = upTo(at);
  assert.equal(quiet.callbacks['push-wren-01'], undefined);
  const open = ok(
    applyLoopEvent(quiet, {
      type: 'clock.jump',
      at: '2026-10-27T22:24:00Z',
      to: '2026-10-27T22:24:00Z',
      by: 'presenter',
    }),
  );
  const cb = open.callbacks['push-wren-01'];
  assert.equal(cb.started_at, '2026-10-27T22:24:00Z');
  assert.equal(cb.person_id, 'p-wren');
  assert.equal(cb.step, 1);
  assert.deepEqual(
    cb.chain.map((s) => [s.step, s.role, s.participant_id]),
    day.people['p-wren'].escalation.map((s) => [
      s.step,
      s.role,
      s.participant_id,
    ]),
  );
  // A step out of order is refused.
  no(open, { ...ev('e-0073'), at: '2026-10-27T22:24:10Z' }, 'CALLBACK_ORDER');
  // The scripted chain: 1, 1 (90 s later), 2, 3, the reply, then 4 logged "not taken".
  const done = upTo('2026-10-27T22:31:00Z').callbacks['push-wren-01'];
  assert.deepEqual(
    done.steps.map((s) => [s.step, s.contact_ref, s.outcome]),
    [
      [1, 'p-wren', 'no answer'],
      [1, 'p-wren', 'no answer'],
      [2, 'p-016', 'reached'],
      [3, 'p-014', 'no answer'],
      [4, null, 'not taken'],
    ],
  );
  assert.equal(done.resolved_at, '2026-10-27T22:30:00Z');
  assert.equal(done.resolved_by, 'p-wren');
  assert.equal(done.steps[4].needs, 'countersign');
});

test('I10 a phone event must come from its bound participant; a foreign ack is refused', () => {
  const loop = before('e-0018');
  no(loop, { ...ev('e-0018'), by: 'p-harrier' }, 'I10_NOT_BOUND');
  no(
    loop,
    {
      ...ev('e-0018'),
      via: 'phone',
      device: { kind: 'phone', participant_id: 'p-harrier' },
    },
    'I10_NOT_BOUND',
  );
  no(loop, { ...ev('e-0018'), via: 'phone' }, 'I10_NOT_BOUND');
  no(
    loop,
    { ...ev('e-0018'), by: 'p-wren', participant_id: 'p-wren' },
    'NOT_RECIPIENT',
  );
  // The generator may mark delivered (a receipt), never read.
  no(loop, { ...ev('e-0018'), by: 'generator' }, 'I10_NOT_BOUND');
  ok(
    applyLoopEvent(loop, {
      ...ev('e-0018'),
      via: 'phone',
      device: { kind: 'phone', participant_id: 'p-kestrel' },
    }),
  );
});

test('I11 nothing is edited in place: decisions, drafts and SITREPs carry versions', () => {
  const loop = upTo('2026-10-27T16:05:00Z');
  no(
    loop,
    { ...ev('e-0012'), at: '2026-10-27T16:05:10Z' },
    'I11_EDIT_IN_PLACE',
  );
  no(
    loop,
    { ...ev('e-0013'), at: '2026-10-27T16:05:10Z' },
    'I11_EDIT_IN_PLACE',
  );
  const v2 = ok(
    applyLoopEvent(loop, {
      ...ev('e-0012'),
      at: '2026-10-27T16:05:10Z',
      version: 2,
      note: 'second look',
    }),
  );
  const v = v2.verifications['v-kestrel-01'];
  assert.equal(v.version, 2);
  assert.equal(v.versions.length, 1);
  assert.equal(v.versions[0].version, 1);
  const e = ok(
    applyLoopEvent(loop, {
      type: 'recommendation.edit',
      at: '2026-10-27T16:05:10Z',
      by: 'VALE',
      recommendation_id: 'r-kestrel-01',
      patch: { next_update_at: '2026-10-27T17:30:00Z' },
    }),
  );
  assert.equal(e.recommendations['r-kestrel-01'].version, 2);
  assert.equal(
    e.recommendations['r-kestrel-01'].versions[0].next_update_at,
    '2026-10-27T17:15:00Z',
  );
  const signed = upTo('2026-10-27T17:16:05Z');
  no(
    signed,
    { ...ev('e-0024'), at: '2026-10-27T17:16:06Z' },
    'I11_EDIT_IN_PLACE',
  );
});

test('I12 sim time only moves forward, except through reset', () => {
  const loop = upTo('2026-10-27T18:00:00Z');
  no(loop, { ...ev('e-0012') }, 'I12_TIME');
  no(
    loop,
    {
      type: 'clock.jump',
      at: '2026-10-27T18:00:00Z',
      to: '2026-10-27T17:00:00Z',
      by: 'presenter',
    },
    'I12_TIME',
  );
  no(
    loop,
    { type: 'beat.go', n: 1, at: '2026-10-27T18:00:00Z', by: 'presenter' },
    'I12_TIME',
  );
  const r = ok(
    applyLoopEvent(loop, {
      type: 'reset',
      at: '2026-10-27T18:00:00Z',
      by: 'presenter',
    }),
  );
  assert.equal(r.clock.simNow, day.t0);
  assert.equal(r.rev, loop.rev + 1);
  assert.deepEqual(r.intel, {});
  assert.equal(r.people['p-wren'].protection, 'MONITORED');
  // The presenter may not send a loop action; a phone may not reset.
  no(
    loop,
    { ...ev('e-0063'), by: 'presenter', at: '2026-10-27T22:10:00Z' },
    'ROLE',
  );
  no(loop, { type: 'reset', at: '2026-10-27T18:00:00Z', by: 'p-wren' }, 'ROLE');
});

test('EP-37 §12: no push to the principal; no BLUF over 90 or with "safe"; a SALUTE is never edited', () => {
  let loop = before('e-0030');
  no(
    loop,
    {
      ...ev('e-0030'),
      recipients: [{ participant_id: 'p-atlas', role: 'principal' }],
    },
    'A1_PRINCIPAL',
  );
  no(
    loop,
    {
      ...ev('e-0030'),
      recipients: [{ participant_id: 'p-lark', role: 'spouse' }],
    },
    'A1_PRINCIPAL',
  );
  no(loop, { ...ev('e-0030'), bluf: `Recommend ${'x'.repeat(85)}` }, 'BLUF');
  no(loop, { ...ev('e-0030'), bluf: 'Recommend you stay safe inside' }, 'BLUF');
  loop = upTo('2026-10-27T18:12:00Z');
  no(loop, { ...ev('e-0035'), at: '2026-10-27T18:12:30Z' }, 'SALUTE_IMMUTABLE');
  no(
    loop,
    {
      ...ev('e-0035'),
      at: '2026-10-27T18:12:30Z',
      salute_id: 'sal-2',
      by: 'VALE',
    },
    'ROLE',
  );
});

test('done by position: two fixes inside the place; a done claimed before the fixes is refused', () => {
  const early = upTo('2026-10-27T17:13:30Z');
  no(
    early,
    { ...ev('e-0023'), at: '2026-10-27T17:13:40Z' },
    'DONE_NOT_AT_PLACE',
  );
  const loop = before('e-0023');
  const next = ok(applyLoopEvent(loop, ev('e-0023')));
  assert.equal(
    next.pushes['push-kestrel-01'].recipients['p-kestrel'].at.done,
    '2026-10-27T17:15:30Z',
  );
  assert.equal(next.situations['s-kestrel-01'].state, 'DONE');
});

test('re-tier widens the radius, changes cadence and sharing, and re-matches open intel', () => {
  const loop = before('e-0064');
  const kc = day.legs['l-wren-event'].place;
  // A point 2.5 km from the Kennedy Center: outside MONITORED reach (1 km), inside REMOTE (3 km).
  const bundle = {
    bundle_id: 'b-test-near-kc',
    sample: true,
    file: 'test',
    title: 'Test item near the Kennedy Center',
    category: 'security',
    event_type: 'test',
    operational_priority: 'P1',
    source_kind: 'official',
    grade: 'A1',
    sent_at: '2026-10-27T22:11:00Z',
    received_at: '2026-10-27T22:11:00Z',
    ingested_at: '2026-10-27T22:11:00Z',
    geo: {
      lat: kc.lat - 0.016,
      lon: kc.lon - 0.02,
      precision: 'point',
      accuracy_m: 10,
    },
    geo_precision: 'point',
    accuracy_m: 10,
    subjects: [],
    region_cities: [],
    related_to: null,
    duplicate_of: null,
  };
  let next = ok(
    applyLoopEvent(loop, {
      type: 'intel.received',
      at: '2026-10-27T22:11:30Z',
      by: 'generator',
      bundle,
    }),
  );
  assert.equal(next.intel['b-test-near-kc'].matched_at, null);
  next = ok(applyLoopEvent(next, ev('e-0064')));
  const wren = next.people['p-wren'];
  assert.equal(wren.protection, 'REMOTE');
  assert.equal(wren.radius_m, 3000);
  assert.equal(wren.checkin_every_min, 120);
  assert.equal(wren.next_checkin_due_at, '2026-10-28T00:12:00Z');
  assert.equal(wren.sharing, 'requested', 'the re-tier only requests sharing');
  assert.equal(next.retiers.at(-1).by, 'ORTEGA');
  assert.equal(next.situations['s-wren-01'].tier, 'REMOTE');
  const rec = next.intel['b-test-near-kc'];
  assert.equal(rec.matched_at, '2026-10-27T22:12:00Z');
  assert.equal(rec.match.leg_id, 'l-wren-event');
  // WREN turns sharing on herself, with her reply (EP-38).
  assert.equal(upTo('2026-10-27T22:30:00Z').people['p-wren'].sharing, 'on');
});

test('comms check: overdue at +5 min with an agent missing, cleared by the late answer', () => {
  assert.equal(
    upTo('2026-10-27T20:04:59Z').commsChecks['d-atlas'].overdue,
    false,
  );
  const c = upTo('2026-10-27T20:05:00Z').commsChecks['d-atlas'];
  assert.equal(c.overdue, true);
  assert.equal(c.overdue_at, '2026-10-27T20:05:00Z');
  assert.deepEqual(c.missing, ['p-atlas4']);
  assert.ok(
    selectMain(upTo('2026-10-27T20:05:00Z')).bands.some(
      (b) => b.text === 'ATLAS · comms check overdue 05:00',
    ),
  );
  const later = upTo('2026-10-27T20:12:20Z').commsChecks['d-atlas'];
  assert.equal(later.overdue, false);
  assert.deepEqual(later.missing, []);
});

test('unknown and malformed events are refused with a code', () => {
  const loop = createLoop({ fixtures: day });
  no(
    loop,
    { type: 'loop.delete', at: '2026-10-27T01:00:00Z', by: 'VALE' },
    'UNKNOWN_EVENT',
  );
  no(loop, { at: '2026-10-27T01:00:00Z' }, 'BAD_EVENT');
  no(loop, { type: 'intel.dismiss', at: 'yesterday', by: 'VALE' }, 'BAD_EVENT');
});
