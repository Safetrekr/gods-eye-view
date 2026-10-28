// SafeTrekr Executive B5: the mock phones (EP-32 §4, EP-36 §2, EP-37
// §§3–4, 8, 11, EP-38 #12, DATA-REVIEW-privacy #1, #4, #6, B4b request 1).
// What each storyboard phone sees per beat; a phone answers only for its
// own person (I10); a tap answers early, pre-empts the scripted reply and
// the day still closes 214·11·6·4·6; WREN has no location before her own
// sharing.set; recalled and superseded pushes read as such; SAMPLE is
// always there; and no phone's view carries another person's data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { phoneViewModel, scriptHint } from './phoneView.js';
import { applyLoopEvent } from '../loop/twinLoop.js';
import { selectCounter } from '../loop/select.js';
import { buildTimeline, fold } from '../timeline.js';
import { agrees, createLoopHost } from '../host/loopHost.js';
import { phoneEvent, presenterCmd } from '../host/execProtocol.js';
import { TOKENS } from '../../../../../../server/tripTwin/twinTokens.js';

const day = JSON.parse(
  readFileSync(new URL('../data/day.json', import.meta.url), 'utf8'),
);
const TL = buildTimeline(day);
const upTo = (iso) =>
  fold(
    day,
    TL.filter((e) => e.at <= iso),
  ).loop;
const at = (iso) => {
  const l = upTo(iso);
  const r = applyLoopEvent(l, {
    type: 'clock.jump',
    at: iso,
    to: iso,
    by: 'generator',
  });
  return r.refused ? l : r.loop;
};
const view = (loop, pid, opts) => phoneViewModel(loop, pid, opts);
const C = (c) => [c.in, c.matched, c.raised, c.pushed, c.closed];
const STORY = [
  'p-kestrel',
  'p-harrier',
  'p-atlas6',
  'p-atlas3',
  'p-wren',
  'p-swift1',
  'p-swift2',
];

function host() {
  let t = 1_000_000;
  const h = createLoopHost({ day, now: () => t, tokens: TOKENS });
  const P = (cmd) => {
    const p = presenterCmd(cmd);
    assert.equal(p.code, undefined, JSON.stringify(p));
    t += 10;
    return h.presenter(p.cmd, { by: 'R1' });
  };
  const jump = (to) => assert.ok(P({ type: 'clock.jump', to }).ok, to);
  /** A phone tap as the relay takes it: phoneEvent, then applyLive. */
  const tap = (pid, cmd) => {
    const p = phoneEvent(cmd, pid);
    if (p.code) return { ok: false, code: p.code };
    return h.applyLive(p.event, {
      by: pid,
      via: 'phone',
      device: { participant_id: pid },
      from: 'phone',
    });
  };
  /** A form sent as the script would have it (the hint, minus its time). */
  const send = (pid, hint) => {
    const { at: _at, ...cmd } = hint;
    void _at;
    return tap(pid, cmd);
  };
  return { h, P, jump, tap, send };
}

// ------------------------------------------------------------ per beat

test('B5 beat 0: quiet phones; WREN shares at check-ins only; every view is SAMPLE', () => {
  const loop = at('2026-10-27T14:30:00Z');
  for (const pid of STORY) {
    const v = view(loop, pid);
    assert.equal(v.sample, true);
    assert.match(v.sampleLine, /^SAMPLE/);
    assert.deepEqual(v.alerts, [], pid);
  }
  const w = view(loop, 'p-wren');
  assert.equal(w.name, 'Isla Halden', 'names only on phones and the desk');
  assert.equal(w.callsign, 'WREN');
  assert.equal(
    w.sharing.line,
    'Location sharing paused · shared at check-ins only',
  );
  assert.equal(w.protection, 'MONITORED');
});

test('B5 beat 1: KESTREL gets the reroute in phone order; HARRIER the car-service card; delivered → read → accepted', () => {
  let loop = at('2026-10-27T16:05:10Z');
  const k = view(loop, 'p-kestrel').alerts[0];
  assert.equal(k.id, 'push-kestrel-01');
  assert.equal(k.title, 'Reroute · Lunch 1230L');
  assert.equal(
    k.body,
    'Arrive 1215L by the Barton Springs Rd side; avoid W Riverside Dr. Valid until 1400L. Tap to accept.',
  );
  assert.deepEqual(k.buttons, ['Accept', 'Call the watch']);
  assert.equal(k.kind, 'instruction');
  assert.equal(k.header, 'REROUTE · SAMPLE');
  assert.equal(k.sender, 'VALE · SafeTrekr Watch Floor');
  assert.equal(
    k.bluf,
    'Arrive 1215L by the Barton Springs Rd side; avoid W Riverside Dr',
  );
  const row = Object.fromEntries(k.rows.map((r) => [r.k, r.v]));
  assert.equal(row.BY, '1215L (1715Z)');
  assert.equal(row.WHERE, 'Barton Springs Rd side');
  assert.equal(row['VALID UNTIL'], '1400L (1900Z)');
  assert.equal(row.KNOWN, 'march route, closure');
  assert.equal(row['NOT KNOWN'], 'crowd size after 1200L');
  assert.deepEqual(
    k.rows.map((r) => r.k),
    [
      'ACTION',
      'BY',
      'WHERE',
      'WHY',
      'VALID UNTIL',
      'REPLY',
      'NEXT UPDATE',
      'KNOWN',
      'NOT KNOWN',
      'OFFICIAL INSTRUCTION',
    ],
    'EP-37 §3 phone order',
  );
  assert.equal(k.rung, 'delivered');
  assert.equal(k.ladder[0].line, '1105L (1605Z)');
  assert.equal(k.severity, 'danger', 'P2 → severity.danger');
  const hr = view(loop, 'p-harrier').alerts[0];
  assert.equal(hr.title, 'Inform car service · KESTREL');
  assert.deepEqual(hr.buttons, ['Car service informed']);
  assert.equal(hr.role, 'inform car service');
  assert.deepEqual(view(loop, 'p-atlas6').alerts, []);

  loop = at('2026-10-27T16:12:00Z');
  const k2 = view(loop, 'p-kestrel').alerts[0];
  assert.equal(k2.rung, 'accepted');
  assert.deepEqual(
    k2.ladder.map((l) => l.line),
    ['1105L (1605Z)', '1106L (1606Z)', '1107L (1607Z)', null],
  );
  assert.equal(view(loop, 'p-harrier').alerts[0].rung, 'accepted');
  loop = at('2026-10-27T17:16:00Z');
  assert.equal(view(loop, 'p-kestrel').alerts[0].rung, 'done');
});

test('B5 beat 2: ATLAS 6 the recommendation with four answers; ATLAS 3 the SALUTE; then NON-CONCUR and the watch’s answer', () => {
  let loop = at('2026-10-27T18:08:30Z');
  const a = view(loop, 'p-atlas6').alerts[0];
  assert.equal(a.kind, 'recommendation');
  assert.equal(a.header, 'UNCONFIRMED · F3 · SAMPLE');
  assert.equal(a.priority, 'P1');
  assert.equal(a.severity, 'critical');
  assert.equal(a.title, 'Watch recommendation · Keynote 1930L');
  assert.deepEqual(a.buttons, [
    'Concur',
    'Non-concur',
    'Executing',
    'Request support',
  ]);
  assert.equal(a.toggle, 'Principal informed');
  assert.equal(
    a.rows.find((r) => r.k === 'REQUEST').v,
    'North entrance status from your advance',
  );
  assert.equal(a.signed, 'Verified VALE 1805Z · countersigned ORTEGA 1806Z');
  // ATLAS 3 is no recipient: the advance files from his own phone.
  assert.deepEqual(view(loop, 'p-atlas3').alerts, []);
  assert.equal(view(loop, 'p-atlas3').detail.roleLine, 'Advance agent');
  assert.equal(view(loop, 'p-atlas6').detail.leader, true);

  loop = at('2026-10-27T18:25:00Z');
  const v6 = view(loop, 'p-atlas6');
  assert.equal(v6.alerts[0].dl.word, 'NON-CONCUR');
  assert.equal(v6.alerts[0].ladder[2].word, 'NON-CONCUR');
  assert.equal(v6.alerts[0].dl.principalInformed, true);
  const ack = v6.messages.find((m) => m.kind === 'watch_ack');
  assert.match(ack.text, /^Acknowledged\. Monitoring; will re-raise/);
  assert.equal(ack.signature, 'VALE / ORTEGA');
  const s = view(loop, 'p-atlas3').salutes[0];
  assert.deepEqual(
    s.rows.map((r) => r.k),
    ['SIZE', 'ACTIVITY', 'LOCATION', 'UNIT', 'TIME', 'EQUIPMENT'],
  );
  assert.equal(s.rows[4].v, '1812Z (1812L)');
  assert.equal(s.tag, 'HUMAN · B2');
  loop = at('2026-10-27T21:07:00Z');
  assert.match(view(loop, 'p-atlas6').standDown.text, /^ATLAS and LARK/);
});

test('B5 beat 3: WREN’s privacy first, then the sharing request she may accept, missed calls to her only, her reply', () => {
  let loop = at('2026-10-27T22:05:00Z');
  let w = view(loop, 'p-wren');
  assert.equal(w.sharing.state, 'check_in_only');
  assert.deepEqual(w.alerts, []);
  loop = at('2026-10-27T22:13:00Z');
  w = view(loop, 'p-wren');
  assert.equal(w.sharing.state, 'requested', 'asked, not switched on');
  assert.equal(w.sharing.on, false);
  const ask = w.messages.find((m) => m.card);
  assert.equal(ask.card.title, 'Watch change · today');
  assert.deepEqual(ask.card.buttons, ['Turn sharing on', 'Not now']);
  assert.equal(w.protection, 'REMOTE');
  loop = at('2026-10-27T22:29:30Z');
  w = view(loop, 'p-wren');
  assert.equal(w.alerts[0].title, 'Kennedy Center · 1930L');
  assert.deepEqual(w.alerts[0].buttons, ['Accept', 'Reply']);
  assert.equal(w.alerts[0].rung, 'delivered');
  assert.equal(w.calls.length, 2, 'two calls to WREN; not the lead’s');
  assert.ok(w.calls.every((c) => c.line.startsWith('Missed call')));
  loop = at('2026-10-27T22:31:00Z');
  w = view(loop, 'p-wren');
  assert.equal(w.sharing.state, 'on');
  assert.equal(w.sharing.line, 'Location sharing on: watch level raised.');
  assert.equal(w.alerts[0].rung, 'accepted');
  assert.ok(w.calls.every((c) => c.answered));
});

test('B5 beat 4: SWIFT 1 and 2 the advisory; no move asked; check in', () => {
  const loop = at('2026-10-28T00:36:30Z');
  for (const pid of ['p-swift1', 'p-swift2']) {
    const a = view(loop, pid).alerts[0];
    assert.equal(a.title, 'Advisory · Hotel → IAD 2030L');
    assert.equal(a.kind, 'advisory');
    assert.deepEqual(a.buttons, ['Check in']);
    assert.match(a.body, /Flight decision stays with crew and dispatch/);
  }
  assert.equal(view(loop, 'p-swift1').alerts[0].rung, 'read');
});

test('B5 Zurich and Dubai people: no dialable number on their phone (privacy #4)', () => {
  const loop = at('2026-10-27T14:30:00Z');
  for (const pid of ['p-001', 'p-012', 'p-027', 'p-011', 'p-026']) {
    const v = view(loop, pid);
    assert.equal(v.phoneLine, 'via the watch (SAMPLE)', pid);
    assert.doesNotMatch(JSON.stringify(v), /\+41|\+971/);
  }
});

// ------------------------------------------------------------- I10

test('B5 I10: a phone answers only for itself; another person’s push or role is refused', () => {
  const { jump, tap, h } = host();
  jump('2026-10-27T18:09:30Z');
  // The page cannot name another participant.
  assert.equal(
    phoneEvent(
      {
        type: 'dl.respond',
        participant_id: 'p-atlas6',
        push_id: 'push-atlas-01',
        answer: 'concur',
      },
      'p-kestrel',
    ).code,
    'I10_NOT_BOUND',
  );
  assert.equal(
    phoneEvent(
      { type: 'sharing.set', person_id: 'p-wren', on: true },
      'p-kestrel',
    ).code,
    'I10_NOT_BOUND',
  );
  // Bound to itself, it still may not answer a push it was not sent.
  assert.equal(
    tap('p-kestrel', {
      type: 'ack',
      push_id: 'push-atlas-01',
      rung: 'read',
    }).code,
    'NOT_RECIPIENT',
  );
  // ATLAS 3 is on the detail but not its leader.
  assert.match(
    tap('p-atlas3', {
      type: 'dl.respond',
      push_id: 'push-atlas-01',
      answer: 'concur',
    }).code,
    /I5_NOT_DETAIL_LEADER|NOT_RECIPIENT/,
  );
  assert.equal(h.loop.pushes['push-atlas-01'].recipients['p-atlas6'].dl, null);
  // A stamped field never comes from the page.
  assert.equal(
    phoneEvent({ type: 'ack', by: 'p-atlas6' }, 'p-atlas6').code,
    'VALIDATION_COMMAND',
  );
});

// ------------------------------------------- a tap answers early

test('B5 taps answer early on every storyboard phone; each pre-empts its scripted reply; the day still closes 214·11·6·4·6', () => {
  const { h, jump, tap, send } = host();
  const ok = (r, what) => assert.ok(r.ok, `${what}: ${JSON.stringify(r)}`);
  // Beat 1: KESTREL opens (read) and accepts before the script (1606Z, 1607Z);
  // HARRIER confirms the car service before 1609Z.
  jump('2026-10-27T16:05:30Z');
  ok(
    tap('p-kestrel', {
      type: 'ack',
      push_id: 'push-kestrel-01',
      rung: 'read',
      source: 'app open',
    }),
    'KESTREL read',
  );
  ok(
    tap('p-kestrel', {
      type: 'ack',
      push_id: 'push-kestrel-01',
      rung: 'accepted',
      source: 'reply word',
      reply_word: 'ACCEPT',
    }),
    'KESTREL accept',
  );
  const hint = (pid, type) =>
    h.phoneView(pid).script.find((x) => x.type === type);
  const informed = hint('p-harrier', 'checkin.respond');
  assert.equal(informed.status, 'informed');
  ok(
    tap('p-harrier', {
      type: 'ack',
      push_id: 'push-kestrel-01',
      rung: 'read',
      source: 'app open',
    }),
    'HARRIER read',
  );
  ok(send('p-harrier', informed), 'HARRIER informed');
  ok(
    tap('p-harrier', {
      type: 'ack',
      push_id: 'push-kestrel-01',
      rung: 'accepted',
      source: 'reply word',
      reply_word: 'Car service informed',
    }),
    'HARRIER accepted',
  );
  const kr = h.loop.pushes['push-kestrel-01'].recipients['p-kestrel'];
  assert.equal(kr.at.accepted, '2026-10-27T16:05:30Z');
  for (const id of ['e-0018', 'e-0020', 'e-0019', 'e-0021', 'e-0022'])
    assert.ok(h.preempted[id], `${id} pre-empted`);

  // Beat 2: the SALUTE and the NON-CONCUR from the phones' own forms.
  jump('2026-10-27T18:11:30Z');
  const sal = hint('p-atlas3', 'salute.file');
  assert.equal(sal.size, '1 male');
  ok(send('p-atlas3', sal), 'ATLAS 3 SALUTE');
  assert.ok(h.loop.salutes['sal-atlas3-01'], 'the script’s own record');
  assert.equal(h.loop.salutes['sal-atlas3-01'].feed_tag, 'HUMAN · ATLAS 3');
  const dl = hint('p-atlas6', 'dl.respond');
  assert.equal(dl.answer, 'nonconcur');
  ok(send('p-atlas6', dl), 'ATLAS 6 NON-CONCUR');
  assert.equal(h.loop.situations['s-atlas-01'].state, 'NONCONCUR');
  assert.ok(h.preempted['e-0035'] && h.preempted['e-0036']);
  assert.equal(
    h.loop.pushes['push-atlas-01'].recipients['p-atlas6'].dl.plan,
    'original plan, +1 post north door',
  );

  // Beat 3: WREN replies after the third call step, turns sharing on herself.
  jump('2026-10-27T22:29:30Z');
  const reply = hint('p-wren', 'checkin.respond');
  assert.match(reply.text, /^In class, phone off/);
  ok(
    tap('p-wren', {
      type: 'ack',
      push_id: 'push-wren-01',
      rung: 'read',
      source: 'app open',
    }),
    'WREN read',
  );
  ok(send('p-wren', reply), 'WREN reply');
  ok(
    tap('p-wren', { type: 'sharing.set', on: true, state: 'sharing_on' }),
    'WREN sharing',
  );
  ok(
    tap('p-wren', {
      type: 'ack',
      push_id: 'push-wren-01',
      rung: 'accepted',
      source: 'reply word',
      reply_word: 'ACCEPT',
    }),
    'WREN accepted',
  );
  for (const id of ['e-0074', 'e-0075', 'e-0076', 'e-0077'])
    assert.ok(h.preempted[id], `${id} pre-empted`);

  // Beat 4: SWIFT 1 checks in with status before 0038Z.
  jump('2026-10-28T00:37:30Z');
  const st = hint('p-swift1', 'checkin.respond');
  assert.equal(st.status, 'status');
  ok(send('p-swift1', st), 'SWIFT 1 status');
  ok(
    tap('p-swift1', {
      type: 'ack',
      push_id: 'push-swift-01',
      rung: 'accepted',
      source: 'reply word',
      reply_word: 'STATUS',
    }),
    'SWIFT 1 accepted',
  );

  jump(day.end);
  assert.deepEqual(C(selectCounter(h.loop)), [214, 11, 6, 4, 6]);
  assert.deepEqual(
    h.scriptRefused,
    [],
    'every pre-empted reply is a no-op, never a refusal',
  );
  const skipped = new Set(h.skipped.map((x) => x.id));
  for (const id of Object.keys(h.preempted))
    assert.ok(skipped.has(id), `${id} skipped when the clock reached it`);
  assert.ok(skipped.size >= 13);
});

test('B5 a tap that says something else still pre-empts, and carries only the phone’s own fields', () => {
  const { h, jump, tap } = host();
  jump('2026-10-27T18:10:00Z');
  const r = tap('p-atlas6', {
    type: 'dl.respond',
    push_id: 'push-atlas-01',
    sit_id: 's-atlas-01',
    answer: 'concur',
    reason: 'Delay accepted; Belvedere Rd entrance.',
    principal_informed: true,
  });
  assert.ok(r.ok);
  const dl = h.loop.pushes['push-atlas-01'].recipients['p-atlas6'].dl;
  assert.equal(dl.answer, 'concur');
  assert.equal(dl.plan, null, 'the script’s non-concur plan is not copied');
  assert.ok(h.preempted['e-0036']);
  assert.equal(agrees({ answer: 'nonconcur' }, { answer: 'concur' }), false);
  assert.equal(
    agrees({ answer: 'nonconcur', plan: 'x' }, { answer: 'nonconcur' }),
    true,
  );
});

// ------------------------------------------------------- privacy

test('B5 WREN: no location before her own sharing.set, scripted or live; a phone view never carries a fix', () => {
  // Scripted: her first fix follows her sharing.set (2230Z).
  const { h, P, jump } = host();
  jump('2026-10-27T22:00:00Z');
  for (let m = 1; m <= 40; m++) {
    const iso = new Date(Date.parse('2026-10-27T22:00:00Z') + m * 60e3)
      .toISOString()
      .replace('.000Z', 'Z');
    jump(iso);
    const on = h.loop.people['p-wren'].sharing === 'on';
    if (!on) assert.equal(h.loop.positions['p-wren'], undefined, iso);
  }
  assert.ok(h.loop.positions['p-wren'], 'shared after she turned it on');
  assert.deepEqual(h.withheld, []);
  // Live phones and no tap: her scripted reply waits, so do her fixes.
  const live = host();
  live.jump('2026-10-27T22:00:00Z');
  assert.ok(live.P({ type: 'phones.mode', mode: 'live' }).ok);
  live.jump('2026-10-27T23:00:00Z');
  assert.equal(live.h.loop.people['p-wren'].sharing, 'requested');
  assert.equal(live.h.loop.positions['p-wren'], undefined);
  assert.ok(live.h.withheld.length > 0);
  // She turns it on from her phone: later fixes land.
  assert.ok(
    live.tap('p-wren', { type: 'sharing.set', on: true, state: 'sharing_on' })
      .ok,
  );
  live.jump('2026-10-27T23:10:00Z');
  assert.ok(live.h.loop.positions['p-wren']);
  for (const pid of STORY) {
    const s = JSON.stringify(live.h.phoneView(pid));
    assert.doesNotMatch(s, /"lat"|"lon"|f-0\d{4}/, pid);
  }
  void P;
});

test('B5 recalled and superseded pushes read as such; no answer buttons on them; the new card on top', () => {
  const pushed = upTo('2026-10-27T16:05:30Z');
  const recalled = applyLoopEvent(pushed, {
    id: 'e-t-recall',
    type: 'push.recall',
    push_id: 'push-kestrel-01',
    reason: 'wrong recipient',
    reverses: 'e-0015',
    at: '2026-10-27T16:05:40Z',
    by: 'VALE',
  }).loop;
  const a = view(recalled, 'p-kestrel').alerts[0];
  assert.equal(a.state, 'recalled');
  assert.equal(a.recalled.line, '1105L (1605Z)');
  assert.equal(a.recalled.reason, 'wrong recipient');
  assert.equal(a.canAct, false);

  let loop = upTo('2026-10-27T16:07:10Z');
  for (const e of [
    {
      type: 'recommendation.edit',
      recommendation_id: 'r-kestrel-01',
      patch: {
        bluf: 'Arrive 1220L by the Barton Springs Rd side; avoid W Riverside Dr',
      },
      at: '2026-10-27T16:07:20Z',
    },
    {
      type: 'recommendation.approve',
      recommendation_id: 'r-kestrel-01',
      at: '2026-10-27T16:07:25Z',
    },
    {
      type: 'push.send',
      recommendation_id: 'r-kestrel-01',
      push_id: 'push-kestrel-01-v2',
      supersedes: 'push-kestrel-01',
      reverses: 'e-0015',
      at: '2026-10-27T16:07:30Z',
    },
  ]) {
    const r = applyLoopEvent(loop, { id: `e-t-${e.type}`, by: 'VALE', ...e });
    assert.equal(r.refused, undefined, JSON.stringify(r.refused));
    loop = r.loop;
  }
  const v = view(loop, 'p-kestrel');
  assert.equal(v.alerts[0].id, 'push-kestrel-01-v2', 'the new card on top');
  assert.equal(v.alerts[0].supersedes, 'push-kestrel-01');
  assert.equal(v.alerts[0].state, 'active');
  assert.equal(v.alerts[1].state, 'superseded');
  assert.equal(v.alerts[1].superseded.line, '1107L (1607Z)');
  assert.equal(v.alerts[1].superseded.by, 'push-kestrel-01-v2');
  assert.equal(v.alerts[1].canAct, false);
});

test('B5 no phone’s view carries another person’s data (names, numbers, pushes, messages, salutes, DL reason)', () => {
  const people = Object.values(day.people);
  const moments = [
    '2026-10-27T16:12:00Z',
    '2026-10-27T18:25:00Z',
    '2026-10-27T22:31:00Z',
    '2026-10-28T00:47:30Z',
    day.end,
  ];
  // Through the host, so the script hints are in the view too.
  const { h, jump } = host();
  for (const iso of moments) {
    jump(iso);
    const loop = h.loop;
    for (const pid of STORY) {
      const v = h.phoneView(pid);
      const s = JSON.stringify(v);
      for (const p of people) {
        if (p.id === pid) continue;
        assert.ok(!s.includes(p.name), `${pid} ${iso}: ${p.name}`);
        if (p.phone_display && !/via the watch/.test(p.phone_display))
          assert.ok(!s.includes(p.phone_display), `${pid}: ${p.phone_display}`);
      }
      for (const st of day.watch.staff)
        assert.ok(!s.includes(st.name), `${pid}: ${st.name}`);
      for (const p of Object.values(loop.pushes))
        if (!p.recipients[pid])
          assert.ok(!s.includes(p.push_id), `${pid}: ${p.push_id}`);
      for (const m of loop.messages)
        if (m.to !== pid && m.text && m.text.length > 12)
          assert.ok(!s.includes(m.text), `${pid}: ${m.text}`);
      for (const sa of Object.values(loop.salutes))
        if (sa.person_id !== pid)
          assert.ok(!s.includes(sa.salute_id), `${pid}: ${sa.salute_id}`);
      if (pid !== 'p-atlas6')
        for (const e of day.events)
          if (e.type === 'dl.respond')
            assert.ok(!s.includes(e.reason), `${pid}: DL reason`);
      // Never the intel itself (posts, titles).
      for (const b of Object.values(day.bundles))
        if (b.title?.length >= 16)
          assert.ok(!s.includes(b.title), `${pid}: ${b.title}`);
      assert.equal(v.sample, true);
      for (const a of v.alerts) {
        assert.equal(a.sample, true);
        if (a.header) assert.match(a.header, /SAMPLE/);
      }
    }
  }
});

test('B5 script hints carry only the phone’s own fields', () => {
  const e = day.events.find((x) => x.id === 'e-0035');
  const h = scriptHint(e);
  assert.deepEqual(Object.keys(h).sort(), [
    'activity',
    'at',
    'equipment',
    'location',
    'sit_id',
    'size',
    'time',
    'type',
    'unit',
  ]);
  assert.equal(h.location.place_id, undefined);
  assert.equal(scriptHint({ type: 'push.send' }), null);
});
