// SafeTrekr Executive B6: the day's record (loop/record.js) over the
// scripted day. Deterministic; the day summary is counted from the record
// and reconciled to the close counter (214·11·6·4·6); the record matches
// the SITREPs; no free text an audience must not see; the access log and
// disclosures per situation, retention by class with legal hold, and no
// "no one else" claim (privacy review 2); recalled and superseded pushes
// stay on the record beside what replaced them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyLoopEvent } from './twinLoop.js';
import { selectCounter } from './select.js';
import { buildTimeline, fold } from '../timeline.js';
import { plainBreach } from '../words.js';
import {
  AUDIENCES,
  RETENTION,
  RETENTION_LINE,
  SAMPLE_FOOTER,
  assembleRecord,
} from './record.js';

const day = JSON.parse(
  readFileSync(new URL('../data/day.json', import.meta.url), 'utf8'),
);
const TL = buildTimeline(day);
const cache = new Map();
const upTo = (iso) => {
  if (!cache.has(iso))
    cache.set(
      iso,
      fold(
        day,
        TL.filter((e) => e.at <= iso),
      ).loop,
    );
  return cache.get(iso);
};
const END = '2026-10-28T01:00:00Z';
const ok = (r) => {
  assert.equal(r.refused, undefined, JSON.stringify(r.refused));
  return r.loop;
};
const strings = (o, out = []) => {
  if (typeof o === 'string') out.push(o);
  else if (o && typeof o === 'object')
    for (const v of Object.values(o)) strings(v, out);
  return out;
};
const NAMES = [
  ...Object.values(day.people).map((p) => p.name),
  ...day.watch.staff.map((s) => s.name),
].filter(Boolean);
/** Texts no record may carry: posts, handles, member texts, the leak's origin. */
function unseen() {
  const out = new Set();
  for (const b of Object.values(day.bundles)) {
    for (const p of b.posts || []) {
      if (p.text?.length >= 12) out.add(p.text);
      if (p.handle) out.add(p.handle);
    }
    if (b.source_kind === 'mention')
      for (const m of b.members || [])
        if (m.text?.length >= 24 && m.text !== b.title) out.add(m.text);
    if (b.short_summary?.length >= 24 && b.source_kind === 'mention')
      out.add(b.short_summary);
    const origin = b.origin?.person_id;
    if (origin && day.people[origin]) out.add(day.people[origin].callsign);
  }
  return [...out];
}

test('B6 the day at 0100Z: the record reconciles to the close counter 214·11·6·4·6', () => {
  const loop = upTo(END);
  const r = assembleRecord(loop, { audience: 'office' });
  assert.equal(r.kind, 'day');
  assert.deepEqual(r.summary.counter, {
    in: 214,
    matched: 11,
    raised: 6,
    pushed: 4,
    closed: 6,
  });
  assert.deepEqual(r.summary.counted, r.summary.counter);
  assert.equal(r.summary.reconciled, true);
  assert.deepEqual(r.summary.mismatches, []);
  assert.equal(
    r.summary.line,
    '214 in (intake + partner feeds) · 11 matched · 6 raised · 4 pushed · 6 closed',
  );
  assert.equal(r.summary.notRaised, 208);
  assert.deepEqual(r.summary.open, []);
  // One entry per raised situation, in raise order.
  assert.deepEqual(
    r.situations.map((s) => s.sit_id),
    [
      's-intel-kestrel-am',
      's-intel-atlas-am',
      's-kestrel-01',
      's-atlas-01',
      's-wren-01',
      's-swift-01',
    ],
  );
  assert.equal(r.situations.filter((s) => s.pushes.length).length, 4);
  assert.equal(r.generated, 'Generated 0100Z · SafeTrekr Watch Floor · SAMPLE');
  assert.equal(r.footer, SAMPLE_FOOTER);
});

test('B6 the record reconciles at every beat (the counter is never stored)', () => {
  for (const t of [
    '2026-10-27T14:30:00Z',
    '2026-10-27T16:12:00Z',
    '2026-10-27T18:25:00Z',
    '2026-10-27T22:24:00Z',
    '2026-10-28T00:36:00Z',
    END,
  ]) {
    const loop = upTo(t);
    const r = assembleRecord(loop, { audience: 'room' });
    assert.equal(r.summary.reconciled, true, `${t}: ${r.summary.mismatches}`);
    assert.deepEqual(r.summary.counted, selectCounter(loop), t);
  }
  const r = assembleRecord(upTo('2026-10-27T14:30:00Z'), { audience: 'room' });
  assert.deepEqual(
    Object.values(r.summary.counter),
    [186, 7, 2, 0, 2],
    'beat 0',
  );
});

test('B6 the record matches the SITREPs: each signed version, and the daily SITREP’s totals', () => {
  const loop = upTo(END);
  const r = assembleRecord(loop, { audience: 'office' });
  for (const s of r.situations) {
    const sit = loop.situations[s.sit_id];
    const rep = loop.sitreps[sit.sitrep_id];
    assert.equal(s.sitreps.length, 1, s.sit_id);
    const v = s.sitreps[0];
    assert.equal(v.current, true);
    assert.equal(v.signedBy, rep.signed_by);
    assert.equal(v.signedAt, rep.signed_at);
    assert.deepEqual(v.body, rep.body);
    assert.ok(s.closed, `${s.sit_id} closed`);
  }
  const atlas = r.situations.find((s) => s.sit_id === 's-atlas-01');
  assert.equal(
    atlas.sitreps[0].header,
    'SITREP ATLAS · s-atlas-01 · 272109Z OCT 26',
  );
  assert.equal(atlas.sitreps[0].signed, 'Signed VALE 272109Z OCT 26');
  assert.equal(r.daily.signed, 'Signed VALE 280100Z OCT 26');
  const body = r.daily.body.join(' ');
  assert.equal(Number(/Pushes (\d+)/.exec(body)[1]), r.summary.pushes.total);
  assert.match(body, /six raised, none open/);
  assert.equal(r.summary.counter.raised, 6);
});

test('B6 ATLAS: the storyboard’s record (beat 5): times, grades, two-person, SALUTE, non-concur, stand-down, SITREP', () => {
  const loop = upTo(END);
  const r = assembleRecord(loop, { sitId: 's-atlas-01', audience: 'room' });
  assert.equal(r.kind, 'situation');
  assert.equal(r.title, 'RECORD · ATLAS · 27 OCT 26 · SAMPLE');
  const s = r.situations[0];
  assert.equal(s.raised.when, '1803Z (1803L)');
  assert.equal(s.grade.word, 'F3 · UNCONFIRMED, actionable');
  assert.equal(s.verification.by, 'VALE');
  assert.equal(s.verification.when, '1805Z (1805L)');
  assert.equal(s.verification.countersigned, 'ORTEGA 1806Z (1806L)');
  assert.equal(s.verification.twoPerson, true);
  assert.deepEqual(s.notified[0].parties, [
    'Venue security, Royal Festival Hall',
    'Local police',
  ]);
  assert.equal(s.notified[0].when, '1807Z (1807L)');
  assert.equal(
    s.recommendation.bluf,
    'Recommend delay departure 20 min; use the Belvedere Rd entrance',
  );
  assert.equal(s.recommendation.to, 'ATLAS 6 (detail leader)');
  assert.deepEqual(s.field[0].rows[0], ['SIZE', '1 male']);
  assert.equal(s.field[0].by, 'ATLAS 3');
  assert.equal(s.answers[0].word, 'NON-CONCUR');
  assert.equal(s.answers[0].plan, 'original plan, +1 post north door');
  assert.equal(
    s.ladders[0].text,
    'DELIVERED 1808Z · READ 1809Z · NON-CONCUR 1814Z · DONE —',
  );
  assert.equal(s.standDown.when, '2105Z (2105L)');
  assert.equal(s.standDown.by, 'ATLAS 6');
  assert.equal(s.closed.reason, 'stand-down');
  assert.match(s.comms.line, /1 overdue at 2005Z/);
  // Z first, local beside, on every line of the timeline.
  for (const l of s.timeline) assert.match(l.when, /^\d{4}Z \(\d{4}L\)$/);
  assert.deepEqual(s.timeline.map((l) => l.z).slice(0, 4), [
    '1742Z',
    '1800Z',
    '1803Z',
    '1805Z',
  ]);
});

test('B6 privacy 2: an access log and disclosures per situation, retention by class with legal hold, no “no one else”', () => {
  const loop = upTo(END);
  const r = assembleRecord(loop, { audience: 'room' });
  const atlas = r.situations.find((s) => s.sit_id === 's-atlas-01');
  assert.deepEqual(atlas.access.people, ['OSPREY', 'VALE', 'ORTEGA']);
  assert.deepEqual(
    atlas.access.log.map((a) => `${a.time} ${a.who} ${a.action}`),
    [
      '1803Z OSPREY opened',
      '1805Z VALE assessed',
      '1806Z ORTEGA countersigned',
      '1808Z VALE pushed',
      '2109Z VALE signed SITREP v1',
    ],
  );
  const external = atlas.access.disclosures.filter((d) => d.external);
  assert.deepEqual(
    external.map((d) => `${d.time} ${d.to}`),
    ['1807Z Venue security, Royal Festival Hall', '1807Z Local police'],
  );
  const kestrel = r.situations.find((s) => s.sit_id === 's-kestrel-01');
  assert.ok(
    kestrel.access.disclosures.some(
      (d) => d.external && d.to === 'car service (via HARRIER)',
    ),
  );
  const wren = r.situations.find((s) => s.sit_id === 's-wren-01');
  assert.ok(
    wren.access.log.some((a) => a.who === 'ORTEGA' && a.action === 're-tiered'),
  );
  assert.ok(
    wren.access.disclosures.some(
      (d) => d.kind === 'call-back' && d.to === 'OSPREY',
    ),
  );
  for (const s of r.situations) {
    assert.ok(s.access.log.length >= 3, s.sit_id);
    assert.equal(s.access.legalHold, false);
  }
  assert.match(RETENTION_LINE, /\(SAMPLE policy\)/);
  assert.match(RETENTION_LINE, /legal hold on request/);
  assert.equal(RETENTION.legalHold.supported, true);
  assert.equal(r.access.retention, RETENTION_LINE);
  // Never a number of days without the policy label, never the overclaim.
  // The class table prints under its policy label; every other line says it.
  assert.equal(r.retention.policy, 'SAMPLE policy');
  for (const text of strings({ ...r, retention: null })) {
    assert.doesNotMatch(text, /no one else/i, text);
    if (/\d+ days/.test(text)) assert.match(text, /SAMPLE policy/, text);
  }
});

test('B6 WREN: the re-tier with its reason, the call-back chain to step 3, step 4 not taken (needs countersign)', () => {
  const r = assembleRecord(upTo(END), { sitId: 's-wren-01', audience: 'room' });
  const s = r.situations[0];
  assert.equal(s.protection, 'MONITORED → REMOTE');
  assert.equal(s.retiers[0].by, 'ORTEGA');
  assert.match(
    s.retiers[0].line,
    /^MONITORED → REMOTE · ORTEGA 2212Z · reason: /,
  );
  assert.equal(s.callback.steps.length, 5);
  assert.equal(
    s.callback.steps.at(-1).line,
    '4 · police welfare check · not taken · needs countersign',
  );
  assert.match(s.callback.resolved, /^resolved 2230Z · resolved · WREN/);
  assert.equal(s.grade.token, 'F2');
});

test('B6 deterministic and pure: the same loop gives the same record; the loop is not touched', () => {
  const loop = upTo(END);
  const before = JSON.stringify(loop);
  for (const audience of AUDIENCES) {
    const a = assembleRecord(loop, { audience });
    const b = assembleRecord(structuredClone(loop), { audience });
    assert.equal(JSON.stringify(a), JSON.stringify(b), audience);
  }
  assert.equal(JSON.stringify(loop), before);
  assert.throws(() => assembleRecord(loop, { audience: 'press' }), /audience/);
  assert.throws(() => assembleRecord(loop, { sitId: 's-nope' }), /situation/);
});

test('B6 room: callsigns only; no post, handle, member text or leak origin; no banned word', () => {
  const loop = upTo(END);
  const bad = unseen();
  for (const opts of [
    { audience: 'room' },
    { audience: 'room', sitId: 's-atlas-01' },
    { audience: 'room', personId: 'p-wren' },
  ]) {
    const text = JSON.stringify(assembleRecord(loop, opts));
    for (const n of NAMES)
      assert.ok(!text.includes(n), `${n} in ${JSON.stringify(opts)}`);
    for (const x of bad)
      assert.ok(!text.includes(x), `unseen text: ${x.slice(0, 60)}`);
  }
  for (const audience of AUDIENCES)
    for (const s of strings(assembleRecord(loop, { audience })))
      assert.equal(plainBreach(s), null, s);
});

test('B6 office: the name is added in the header only (EP-34 §2); nothing else changes', () => {
  const loop = upTo(END);
  const office = assembleRecord(loop, { audience: 'office' });
  const room = assembleRecord(loop, { audience: 'room' });
  const stripped = structuredClone(office);
  stripped.audience = 'room';
  for (const s of stripped.situations) {
    assert.ok(s.name && NAMES.includes(s.name), s.sit_id);
    delete s.name;
  }
  assert.equal(JSON.stringify(stripped), JSON.stringify(room));
  const one = assembleRecord(loop, { audience: 'office', sitId: 's-atlas-01' });
  assert.equal(one.who.name, day.people['p-atlas'].name);
  const text = JSON.stringify({
    ...one,
    who: null,
    situations: one.situations.map(({ name: _n, ...s }) => s),
  });
  for (const n of NAMES) assert.ok(!text.includes(n), n);
});

test('B6 reversals stay on the record: a recall, then a supersede, each beside what it replaced', () => {
  // Recall before a read (EP-33 §3).
  let loop = upTo('2026-10-27T16:05:30Z');
  loop = ok(
    applyLoopEvent(loop, {
      id: 'e-t-recall',
      type: 'push.recall',
      push_id: 'push-kestrel-01',
      reason: 'wrong recipient',
      reverses: 'e-0015',
      at: '2026-10-27T16:05:40Z',
      by: 'VALE',
      via: 'touch',
    }),
  );
  let s = assembleRecord(loop, { sitId: 's-kestrel-01', audience: 'room' })
    .situations[0];
  assert.equal(s.pushes[0].state, 'recalled');
  assert.equal(
    s.pushes[0].status,
    'RECALLED 1605Z VALE · reason: wrong recipient',
  );
  assert.ok(
    s.timeline.some(
      (l) =>
        l.what === 'recalled · reason: wrong recipient' &&
        l.reverses === 'push-kestrel-01',
    ),
  );
  assert.ok(
    s.timeline.some(
      (l) =>
        /^pushed to KESTREL, HARRIER/.test(l.what) &&
        /^RECALLED/.test(l.reversed),
    ),
  );
  assert.ok(s.access.log.some((a) => a.action === 'recalled'));
  const day1 = assembleRecord(loop, { audience: 'room' });
  assert.equal(day1.summary.reconciled, true);
  assert.equal(day1.summary.pushes.recalled, 1);

  // Supersede after a read: the old push greyed, the new one above it.
  loop = upTo('2026-10-27T16:07:10Z');
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
  s = assembleRecord(loop, { sitId: 's-kestrel-01', audience: 'room' })
    .situations[0];
  assert.deepEqual(
    s.pushes.map((p) => p.state),
    ['superseded', 'live'],
  );
  assert.equal(s.pushes[0].status, 'SUPERSEDED 1607Z · see push-kestrel-01-v2');
  assert.equal(s.pushes[1].supersedes, 'push-kestrel-01');
  assert.equal(s.recommendation.version, 2);
  assert.equal(
    s.recommendation.bluf,
    'Arrive 1220L by the Barton Springs Rd side; avoid W Riverside Dr',
  );
  const r2 = assembleRecord(loop, { audience: 'room' });
  assert.equal(r2.summary.reconciled, true);
  assert.equal(r2.summary.pushes.superseded, 1);
});

test('B6 a reopened situation: the SITREP keeps v1 and gains an unsigned v2; closed drops until it is signed', () => {
  let loop = upTo('2026-10-27T21:20:00Z');
  loop = ok(
    applyLoopEvent(loop, {
      id: 'e-t-reopen',
      type: 'situation.reopen',
      sit_id: 's-atlas-01',
      reason: 'new_report',
      reverses: 'e-0061',
      at: '2026-10-27T21:21:00Z',
      by: 'ORTEGA',
    }),
  );
  const r = assembleRecord(loop, { audience: 'room' });
  const s = r.situations.find((x) => x.sit_id === 's-atlas-01');
  assert.deepEqual(
    s.sitreps.map((v) => [v.version, v.signed]),
    [
      [1, 'Signed VALE 272109Z OCT 26'],
      [2, 'not signed'],
    ],
  );
  assert.deepEqual(s.reopened, ['new report · ORTEGA 2121Z']);
  assert.equal(s.closed, null);
  assert.equal(r.summary.reconciled, true);
  assert.equal(r.summary.counter.closed, selectCounter(loop).closed);
  assert.ok(r.summary.open.includes('ATLAS'));
});
