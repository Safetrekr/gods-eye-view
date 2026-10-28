// SafeTrekr Executive B1: what each surface may see (EP-35 §§1 I3, 7; §9
// group 5). selectMain carries no roster name, intel title, note, post
// text or DL reason at any step of the day; selectPhone returns only the
// bound participant's pushes; MAIN's rows equal loop.json's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyLoopEvent } from './twinLoop.js';
import {
  byExposure,
  MAIN_STATES,
  queueLine,
  selectCounter,
  selectFeed,
  selectMain,
  selectPhone,
  selectQueue,
  selectTimeStrip,
} from './select.js';
import { plainBreach } from '../words.js';
import { buildTimeline, fold, foldTo, foldToBeat } from '../timeline.js';

const day = JSON.parse(
  readFileSync(new URL('../data/day.json', import.meta.url), 'utf8'),
);
const TL = buildTimeline(day);
const upTo = (iso) =>
  fold(
    day,
    TL.filter((e) => e.at <= iso),
  ).loop;

/** Strings MAIN must never carry (EP-35 §9 group 5; EP-14 (d); EP-34). */
function forbidden() {
  const out = new Set();
  for (const p of Object.values(day.people)) out.add(p.name);
  for (const s of day.watch.staff) out.add(s.name);
  for (const b of Object.values(day.bundles)) {
    if (b.title?.length >= 12) out.add(b.title);
    if (b.short_summary?.length >= 12) out.add(b.short_summary);
    for (const p of b.posts || []) out.add(p.text);
    for (const m of b.members || []) if (m.text?.length >= 12) out.add(m.text);
  }
  for (const e of day.events) {
    if (e.type === 'verification.decide' && e.note) out.add(e.note);
    if (e.type === 'dl.respond') out.add(e.reason);
    if (e.type === 'message.send' && e.text?.length >= 12) out.add(e.text);
  }
  return [...out].filter(Boolean);
}

test('selectMain never carries a name, an intel title, a note, a post or a DL reason, at any step', () => {
  const bad = forbidden();
  assert.ok(bad.length > 300);
  let checked = 0;
  fold(day, TL, {
    onStep: (loop, e) => {
      // Every step but a position fix, once there is anything to show.
      if (e.ev.type === 'position.fix' || !Object.keys(loop.situations).length)
        return;
      const main = selectMain(loop);
      const text = JSON.stringify(main);
      for (const s of bad)
        assert.ok(
          !text.includes(s),
          `MAIN at ${e.at} (${e.ev.id}) carries "${s.slice(0, 60)}"`,
        );
      for (const row of [...main.rows, ...main.closed, ...main.bands])
        assert.equal(plainBreach(row.text, { main: true }), null, row.text);
      checked += 1;
    },
  });
  assert.ok(checked > 200, `checked ${checked} steps`);
});

test('I3 at every step: MAIN rows are verified situations in a MAIN state only, and only the five fields (as MAIN shows them)', () => {
  fold(day, TL, {
    onStep: (loop, e) => {
      if (e.ev.type === 'position.fix') return;
      const main = selectMain(loop);
      for (const row of main.rows) {
        // callsign, leg, BLUF, ladder, next update: each as data and as
        // MAIN writes it (leg_z, line, word, tone, next, text). Nothing else.
        assert.deepEqual(Object.keys(row).sort(), [
          'bluf',
          'callsign',
          'ladder',
          'leg',
          'leg_z',
          'line',
          'next',
          'next_update_at',
          'text',
          'tier',
          'tone',
          'word',
        ]);
        const s = Object.values(loop.situations).find(
          (x) => x.callsign === row.callsign && MAIN_STATES.includes(x.state),
        );
        assert.ok(
          s?.verification_id,
          `${row.callsign} on MAIN at ${e.at} is verified`,
        );
      }
    },
  });
});

test('MAIN reproduces every row loop.json writes, at the moment it writes it', () => {
  let rows = 0;
  fold(day, TL, {
    onStep: (loop, e) => {
      if (!e.ev.main_row) return;
      const m = selectMain(loop);
      const all = [
        ...m.rows.map((r) => r.text),
        ...m.closed.map((c) => c.text),
      ];
      assert.ok(
        all.includes(e.ev.main_row),
        `${e.ev.id}: "${e.ev.main_row}" not in ${JSON.stringify(all)}`,
      );
      rows += 1;
    },
  });
  assert.equal(rows, 18);
});

test('MAIN lines at the beats: counter, queue, last verified by a human, closed rows', () => {
  const b0 = selectMain(foldToBeat(day, 0, TL).loop);
  assert.equal(
    b0.counterLine,
    '186 in (intake + partner feeds) · 7 matched · 2 raised · 0 pushed · 2 closed',
  );
  assert.equal(b0.verifiedLine, 'Last verified by a human 1426Z · VALE');
  assert.equal(b0.empty, 'No active situations');
  assert.equal(b0.queueLine, 'Queue: empty');
  const b5 = selectMain(foldToBeat(day, 5, TL).loop);
  assert.equal(
    b5.counterLine,
    '214 in (intake + partner feeds) · 11 matched · 6 raised · 4 pushed · 6 closed',
  );
  assert.equal(b5.verifiedLine, 'Last verified by a human 0058Z · VALE');
  const daily = day.events.find((e) => e.id === 'e-0106').closed_rows;
  assert.deepEqual(
    b5.closed.map((c) => c.text),
    daily,
  );
});

test('the queue: a raised item waits for verification; a DETAIL item for its countersign', () => {
  const raised = foldTo(day, '2026-10-27T18:04:00Z', TL).loop;
  const q = selectQueue(raised);
  assert.equal(q.length, 1);
  assert.equal(q[0].sit_id, 's-atlas-01');
  assert.equal(q[0].awaiting, 'verification');
  assert.equal(
    q[0].overdue,
    true,
    'the keynote window is open and the item is unverified',
  );
  assert.equal(queueLine(q), 'Queue: 1 awaiting · oldest 1 min · 1 overdue');
  const cs = selectQueue(foldTo(day, '2026-10-27T18:05:30Z', TL).loop);
  assert.equal(cs[0].awaiting, 'countersign');
  assert.equal(
    queueLine(cs),
    'Queue: 1 awaiting · oldest 2 min · 1 awaiting countersign',
  );
  assert.deepEqual(selectQueue(upTo('2026-10-27T18:06:30Z')), []);
});

test('selectPhone returns only the bound participant’s pushes and cards', () => {
  const end = foldToBeat(day, 5, TL).loop;
  for (const [pid, push] of [
    ['p-kestrel', 'push-kestrel-01'],
    ['p-harrier', 'push-kestrel-01'],
    ['p-atlas6', 'push-atlas-01'],
    ['p-wren', 'push-wren-01'],
    ['p-swift1', 'push-swift-01'],
    ['p-swift2', 'push-swift-01'],
  ]) {
    const phone = selectPhone(end, pid);
    assert.deepEqual(
      phone.alerts.map((a) => a.id),
      [push],
      pid,
    );
    const card = day.events.find(
      (e) => e.push_id === push && e.type === 'push.send',
    ).phone[pid];
    assert.equal(phone.alerts[0].title, card.title);
    assert.equal(phone.alerts[0].message, card.body);
    assert.equal(phone.alerts[0].sample, true);
    for (const m of phone.messages)
      assert.ok(end.messages.find((x) => x.id === m.id).to === pid);
  }
  // KESTREL's phone never shows HARRIER's card, nor the other way round.
  const k = JSON.stringify(selectPhone(end, 'p-kestrel'));
  assert.ok(!k.includes('Inform car service · KESTREL'));
  assert.ok(
    !JSON.stringify(selectPhone(end, 'p-harrier')).includes('Tap to accept'),
  );
  // The principal is never a recipient (EP-37 A1); a bystander sees nothing.
  assert.deepEqual(selectPhone(end, 'p-atlas').alerts, []);
  assert.deepEqual(selectPhone(end, 'p-001').alerts, []);
  assert.equal(selectPhone(end, 'p-nobody'), null);
  // The DETAIL push is unconfirmed on the leader's phone.
  const dl = selectPhone(end, 'p-atlas6').alerts[0];
  assert.equal(dl.unconfirmed, true);
  assert.equal(dl.header, 'UNCONFIRMED · F3 · SAMPLE');
  assert.deepEqual(dl.dl, { answer: 'nonconcur' });
});

test('a foreign ack from a phone is refused and the phone’s view does not move', () => {
  const loop = upTo('2026-10-27T16:05:30Z');
  const before = JSON.stringify(selectPhone(loop, 'p-kestrel'));
  const r = applyLoopEvent(loop, {
    type: 'ack',
    at: '2026-10-27T16:05:40Z',
    by: 'p-harrier',
    via: 'phone',
    device: { kind: 'phone', participant_id: 'p-harrier' },
    push_id: 'push-kestrel-01',
    participant_id: 'p-kestrel',
    rung: 'read',
  });
  assert.equal(r.refused.code, 'I10_NOT_BOUND');
  assert.equal(JSON.stringify(selectPhone(r.loop, 'p-kestrel')), before);
});

test('WREN’s phone: sharing paused, then requested by the re-tier, then on by her own act', () => {
  assert.equal(
    selectPhone(upTo('2026-10-27T22:00:00Z'), 'p-wren').sharing,
    'check_in_only',
  );
  assert.equal(
    selectPhone(upTo('2026-10-27T22:12:00Z'), 'p-wren').sharing,
    'requested',
  );
  assert.equal(
    selectPhone(upTo('2026-10-27T22:30:00Z'), 'p-wren').sharing,
    'on',
  );
});

test('selectCounter: the three inequalities hold at every event of the day', () => {
  let n = 0;
  fold(day, TL, {
    onStep: (loop) => {
      const c = selectCounter(loop);
      assert.ok(
        c.raised <= c.matched &&
          c.pushed <= c.raised &&
          c.closed <= c.raised &&
          c.matched <= c.in,
        JSON.stringify(c),
      );
      n += 1;
    },
  });
  assert.equal(n, TL.length);
});

test('the feed: newest first, not-raised reasons with initials, partner and human tags', () => {
  const b0 = foldToBeat(day, 0, TL).loop;
  const feed = selectFeed(b0, { limit: 300 });
  assert.equal(feed.length, 186);
  const namesake = feed.find((f) => f.bundle_id === 'b-m-034');
  assert.equal(
    namesake.line,
    'not raised: namesake: Halden Capital, a different company · VALE',
  );
  const partner = feed.find((f) => f.bundle_id === 'b-intel-095');
  assert.equal(partner.tag, 'PARTNER FEED');
  assert.equal(partner.status, 'watch');
  assert.equal(
    feed.find((f) => f.bundle_id === 'b-m-018').collapse,
    '30 re-shares · one item',
  );
  assert.equal(
    feed.find((f) => f.bundle_id === 'b-intel-093').line,
    'not raised: duplicate of i-0412',
  );
  const b2 = selectFeed(upTo('2026-10-27T18:13:00Z'), { limit: 20 });
  const salute = b2.find((f) => f.kind === 'salute');
  assert.equal(salute.tag, 'HUMAN · ATLAS 3');
  assert.equal(salute.grade, 'B2');
});

test('the time strip: active cities local, then Zulu', () => {
  const loop = foldToBeat(day, 0, TL).loop;
  assert.equal(
    selectTimeStrip(loop, [
      ['Austin', 'America/Chicago'],
      ['DC', 'America/New_York'],
      ['London', 'Europe/London'],
    ]),
    'AUSTIN 0930L · DC 1030L · LONDON 1430L · 1430Z',
  );
});

/** A copy of `loop` with situation `id` cloned from `from` as `newId`. */
function withClone(loop, from, id, newId, patch) {
  const out = JSON.parse(JSON.stringify(loop));
  const src = from.situations[id];
  out.situations[newId] = { ...src, sit_id: newId, ...patch };
  for (const k of ['pushes', 'verifications', 'recommendations', 'legs'])
    for (const [kk, v] of Object.entries(from[k])) out[k][kk] ??= v;
  for (const [kk, v] of Object.entries(from.callbacks || {}))
    out.callbacks[kk] ??= v;
  return out;
}

test('B4a MAIN rows by time until exposure (EP-34 §5), not by raised time; ties by posture, then raised', () => {
  // 1825Z: ATLAS (raised 1803Z, Keynote 1930Z) is on MAIN. Add a second
  // verified row raised later (1820Z) whose leg starts sooner (1840Z).
  const atlas = upTo('2026-10-27T18:25:00Z');
  const kestrel = upTo('2026-10-27T16:12:00Z');
  const two = withClone(atlas, kestrel, 's-kestrel-01', 's-kestrel-x', {
    raised_at: '2026-10-27T18:20:00Z',
    exposure_at: '2026-10-27T18:40:00Z',
  });
  const m = selectMain(two);
  assert.deepEqual(
    m.rows.map((r) => r.callsign),
    ['KESTREL', 'ATLAS'],
  );
  // The same pair by raised time would put ATLAS first: the order is exposure.
  const later = withClone(atlas, kestrel, 's-kestrel-01', 's-kestrel-x', {
    raised_at: '2026-10-27T17:00:00Z',
    exposure_at: '2026-10-27T21:00:00Z',
  });
  assert.deepEqual(
    selectMain(later).rows.map((r) => r.callsign),
    ['ATLAS', 'KESTREL'],
  );
  // A leg under way (exposure passed) sorts first.
  const under = withClone(atlas, kestrel, 's-kestrel-01', 's-kestrel-x', {
    raised_at: '2026-10-27T18:24:00Z',
    exposure_at: '2026-10-27T18:00:00Z',
  });
  assert.equal(selectMain(under).rows[0].callsign, 'KESTREL');
  // Same exposure: the higher posture first, whatever was raised first.
  const tie = withClone(atlas, kestrel, 's-kestrel-01', 's-kestrel-x', {
    raised_at: '2026-10-27T17:00:00Z',
    exposure_at: atlas.situations['s-atlas-01'].exposure_at,
  });
  tie.people['p-atlas'] = { ...tie.people['p-atlas'], posture: 'HIGH' };
  tie.people['p-kestrel'] = {
    ...tie.people['p-kestrel'],
    posture: 'ROUTINE',
  };
  assert.deepEqual(
    selectMain(tie).rows.map((r) => r.callsign),
    ['ATLAS', 'KESTREL'],
  );
  // MAIN's map follows the top row (one comparator for both).
  assert.equal(
    byExposure(two)(
      two.situations['s-kestrel-x'],
      two.situations['s-atlas-01'],
    ) < 0,
    true,
  );
});

test('B4a MAIN rows read as the storyboard: DETAIL shows the DL answer and the DL’s own line; others the BLUF and the ladder word in capitals', () => {
  const r2 = selectMain(upTo('2026-10-27T18:25:00Z')).rows[0];
  assert.equal(r2.word, 'DL: NON-CONCUR');
  assert.equal(r2.line, 'original plan, +1 post north door');
  assert.equal(r2.tone, 'amber');
  assert.equal(r2.next, 'next update 1915L');
  assert.equal(r2.leg_z, '1930Z');
  assert.equal(
    r2.text,
    'ATLAS · Keynote 1930L · DL: NON-CONCUR · original plan, +1 post north door · next update 1915L',
  );
  assert.notEqual(r2.line, r2.bluf);
  const r1 = selectMain(upTo('2026-10-27T16:12:00Z')).rows[0];
  assert.equal(r1.word, 'ACCEPTED');
  assert.equal(
    r1.line,
    'Arrive 1215L by the Barton Springs Rd side; avoid W Riverside Dr',
  );
  const r3 = selectMain(upTo('2026-10-27T22:24:00Z')).rows[0];
  assert.match(r3.word, /^NO READ 10 MIN · CALLING WREN$/);
  assert.equal(r3.tone, 'amber');
  const r4 = selectMain(upTo('2026-10-28T00:36:00Z')).rows[0];
  assert.equal(r4.word, 'READ');
  assert.equal(r4.callsign, 'SWIFT 1–2');
  for (const r of [r1, r2, r3, r4]) {
    assert.equal(r.word, r.word.toUpperCase());
    assert.equal(plainBreach(r.line, { main: true }), null, r.line);
  }
});
