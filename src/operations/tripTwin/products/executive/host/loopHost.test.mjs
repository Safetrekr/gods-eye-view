// SafeTrekr Executive B2: the loop host (EP-35 §§5, 7; EP-33 §§1, 7). The
// clock applies the script on its own and reaches each beat anchor's
// counter; presenter commands are the only way in from the iPad; Reset and
// Previous re-derive from the script, never edit the record; a phone binds
// to one participant (I10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLoopHost } from './loopHost.js';
import {
  EXEC_CODE,
  PRESENTER_CMDS,
  phoneEvent,
  presenterCmd,
  roleOfSlot,
  viewFor,
} from './execProtocol.js';
import { LOOP_ACTIONS } from '../loop/loopPolicy.js';
import { selectCounter } from '../loop/select.js';
import { TOKENS } from '../../../../../../server/tripTwin/twinTokens.js';
import {
  LOOP_EVENT_NAMES,
  PRESENTER_CMD_NAMES,
} from '../../../../../../server/tripTwin/auditLog.js';

const day = JSON.parse(
  readFileSync(new URL('../data/day.json', import.meta.url), 'utf8'),
);
const golden = JSON.parse(
  readFileSync(new URL('../loop/replay.golden.json', import.meta.url), 'utf8'),
);
const C = (c) => [c.in, c.matched, c.raised, c.pushed, c.closed];
const G = (n) => C(golden.beats[n].counter);

function host(opts = {}) {
  let t = 1_000_000;
  const clock = {
    now: () => t,
    advance: (dms) => (t += dms),
  };
  const h = createLoopHost({ day, now: clock.now, tokens: TOKENS, ...opts });
  return { h, clock };
}
const P = (h, cmd, by = 'R1') => {
  const p = presenterCmd(cmd);
  assert.equal(p.code, undefined, JSON.stringify(p));
  return h.presenter(p.cmd, { by });
};
/** Ask first, then confirm from the same device. */
const asked = (h, cmd, by = 'R1') => {
  const r = P(h, cmd, by);
  assert.equal(r.code, EXEC_CODE.CONFIRM_REQUIRED);
  assert.ok(r.ask.text.length > 10);
  return P(h, { type: 'confirm', id: r.ask.id }, by);
};

test('the host starts as Reset leaves it: beat 0, 1430Z, paused, 186·7·2·0·2', () => {
  const { h } = host();
  assert.equal(h.clock.simNow, '2026-10-27T14:30:00Z');
  assert.equal(h.clock.paused, true);
  assert.deepEqual(C(selectCounter(h.loop)), [186, 7, 2, 0, 2]);
  assert.deepEqual(C(selectCounter(h.loop)), G(0));
  assert.equal(h.loop.clock.beat, 0);
  const v = h.clockView();
  assert.equal(v.sample, true);
  assert.equal(v.label, 'SAMPLE · accelerated ×10');
});

test('on its own: auto run cuts checkpoint to checkpoint and reaches every anchor’s counter, then 214·11·6·4·6', () => {
  const { h, clock } = host();
  const r = P(h, { type: 'clock.start', rate: 60, auto: true });
  assert.ok(r.ok);
  const anchors = Object.fromEntries(
    Object.entries(day.beats).map(([n, a]) => [a, n]),
  );
  const seen = {};
  let ticks = 0;
  while (!h.clock.paused && ticks < 50_000) {
    clock.advance(250);
    h.tick(clock.now());
    const n = anchors[h.loop.clock.simNow];
    if (n != null && !seen[n]) seen[n] = C(selectCounter(h.loop));
    ticks += 1;
  }
  assert.equal(h.clockView().held, 'end');
  for (const n of ['1', '2', '3', '4'])
    assert.deepEqual(seen[n], G(n), `beat ${n}`);
  assert.deepEqual(C(selectCounter(h.loop)), [214, 11, 6, 4, 6]);
  assert.deepEqual(h.scriptRefused, [], 'no scripted entry refused');
  // raised ≤ matched, pushed ≤ raised, closed ≤ raised
  const c = selectCounter(h.loop);
  assert.ok(
    c.raised <= c.matched && c.pushed <= c.raised && c.closed <= c.raised,
  );
});

test('without auto the clock holds at a checkpoint’s end; Next cuts to the next one at its rate', () => {
  const { h, clock } = host();
  P(h, { type: 'next' });
  assert.equal(h.clock.simNow, '2026-10-27T15:30:00Z');
  assert.equal(h.clock.rate, 10);
  assert.equal(h.clock.paused, false);
  assert.deepEqual(C(selectCounter(h.loop)), G(1));
  // 42 sim min at ×10 = 252 s, plus a little.
  for (let i = 0; i < 1100; i++) h.tick(clock.advance(250));
  assert.equal(h.clock.paused, true);
  assert.equal(h.clock.held, 'checkpoint');
  assert.equal(h.clock.simNow, '2026-10-27T16:12:00Z');
  P(h, { type: 'next' });
  assert.equal(h.clock.simNow, '2026-10-27T17:12:00Z');
  assert.equal(h.clock.rate, 1);
});

test('beat.go forward folds up to the anchor in one pass; the counters match the golden file', () => {
  const { h } = host();
  for (const n of [1, 2, 3, 4, 5]) {
    const r = P(h, { type: 'beat.go', n });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(h.loop.clock.beat, n);
    assert.deepEqual(C(selectCounter(h.loop)), G(n), `beat ${n}`);
  }
});

test('rate ×1/×10/×60 only; a pause stops the clock; a jump backwards is refused (I12)', () => {
  const { h, clock } = host();
  assert.equal(presenterCmd({ type: 'clock.rate', rate: 5 }).code, 'BAD_RATE');
  P(h, { type: 'clock.start', rate: 60 });
  h.tick(clock.advance(1000));
  assert.equal(h.clock.simNow, '2026-10-27T14:31:00Z');
  P(h, { type: 'clock.rate', rate: 1 });
  h.tick(clock.advance(1000));
  assert.equal(h.clock.simNow, '2026-10-27T14:31:01Z');
  P(h, { type: 'clock.pause' });
  h.tick(clock.advance(60_000));
  assert.equal(h.clock.simNow, '2026-10-27T14:31:01Z');
  const back = P(h, { type: 'clock.jump', to: '2026-10-27T14:00:00Z' });
  assert.equal(back.code, 'I12_TIME');
  assert.ok(P(h, { type: 'clock.jump', to: '2026-10-27T15:00:00Z' }).ok);
  assert.equal(h.clock.simNow, '2026-10-27T15:00:00Z');
});

test('the presenter can never send a loop decision (EP-33 §1)', () => {
  for (const type of Object.keys(LOOP_ACTIONS)) {
    if (PRESENTER_CMDS[type]) continue;
    const r = presenterCmd({ type, sit_id: 's-kestrel-01' });
    assert.equal(r.code, EXEC_CODE.NOT_PRESENTER, type);
  }
  assert.equal(
    presenterCmd({ type: 'clock.start', by: 'VALE' }).code,
    'VALIDATION_COMMAND',
  );
});

test('Reset is ask first, answered only by the asker; it re-folds the script and sets live actions aside', () => {
  const { h } = host();
  P(h, { type: 'beat.go', n: 1 });
  // Run to the push, then a live phone read before the scripted one.
  assert.ok(P(h, { type: 'clock.jump', to: '2026-10-27T16:05:30Z' }).ok);
  const live = h.applyLive(
    {
      type: 'ack',
      push_id: 'push-kestrel-01',
      participant_id: 'p-kestrel',
      rung: 'read',
    },
    {
      by: 'p-kestrel',
      via: 'phone',
      device: { participant_id: 'p-kestrel' },
      from: 'phone',
    },
  );
  assert.ok(live.ok, JSON.stringify(live));
  const logLen = h.loop.log.length;
  const r = P(h, { type: 'reset' });
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.match(r.ask.text, /^Reset the day to 0930L \(1430Z\)\?/);
  // Another device's yes is refused (CONFIRM_NOT_YOURS).
  assert.equal(
    P(h, { type: 'confirm', id: r.ask.id }, 'R2').code,
    'CONFIRM_NOT_YOURS',
  );
  assert.equal(h.loop.log.length, logLen, 'nothing changed');
  const ok = P(h, { type: 'confirm', id: r.ask.id });
  assert.ok(ok.ok);
  assert.equal(h.run, 2);
  assert.equal(h.clock.simNow, '2026-10-27T14:30:00Z');
  assert.equal(h.clock.paused, true);
  assert.deepEqual(C(selectCounter(h.loop)), G(0));
  assert.equal(h.loop.log[0].type, 'reset', 'the record starts with the reset');
  assert.deepEqual(h.live, []);
  assert.equal(h.setAside.length, 1);
  assert.equal(h.setAside[0].id, live.ev.id);
  // The state equals a fresh host's beat 0, but for the record's own
  // lines and revisions (rev keeps counting through a reset).
  const fresh = host().h;
  const noMeta = (x) =>
    JSON.parse(JSON.stringify(x, (k, v) => (k === 'meta' ? undefined : v)));
  for (const k of ['intel', 'situations', 'pushes', 'verifications', 'people'])
    assert.deepEqual(noMeta(h.loop[k]), noMeta(fresh.loop[k]), k);
  // An answered question is gone.
  assert.equal(P(h, { type: 'confirm', id: r.ask.id }).code, 'CONFIRM_UNKNOWN');
});

test('a question expires after 10 s (CONFIRM_STALE)', () => {
  const { h, clock } = host();
  const r = P(h, { type: 'reset' });
  clock.advance(10_001);
  assert.equal(P(h, { type: 'confirm', id: r.ask.id }).code, 'CONFIRM_STALE');
});

test('Previous and a backward beat ask first; live events before the target are kept, after it set aside', () => {
  const { h } = host();
  P(h, { type: 'beat.go', n: 1 });
  P(h, { type: 'clock.jump', to: '2026-10-27T16:05:30Z' });
  const read = h.applyLive(
    {
      type: 'ack',
      push_id: 'push-kestrel-01',
      participant_id: 'p-kestrel',
      rung: 'read',
    },
    {
      by: 'p-kestrel',
      via: 'phone',
      device: { participant_id: 'p-kestrel' },
      from: 'phone',
    },
  );
  assert.ok(read.ok);
  P(h, { type: 'beat.go', n: 2 });
  P(h, { type: 'clock.jump', to: '2026-10-27T18:20:00Z' });
  const late = h.applyLive(
    { type: 'checkin.respond', person_id: 'p-wren', status: 'ok', text: 'OK' },
    {
      by: 'p-wren',
      via: 'phone',
      device: { participant_id: 'p-wren' },
      from: 'phone',
    },
  );
  assert.ok(late.ok);
  const r = asked(h, { type: 'beat.go', n: 2 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(h.clock.simNow, '2026-10-27T18:00:00Z');
  assert.deepEqual(
    h.live.map((e) => e.id),
    [read.ev.id],
  );
  assert.deepEqual(
    h.setAside.map((e) => e.id),
    [late.ev.id],
  );
  // The kept live read stands; the scripted read (1606Z) was refused as a lower rung.
  const kr = h.loop.pushes['push-kestrel-01'].recipients['p-kestrel'];
  assert.equal(kr.at.read, read.ev.at);
  assert.deepEqual(C(selectCounter(h.loop)), G(2));
  const prev = asked(h, { type: 'previous' });
  assert.ok(prev.ok);
  assert.equal(h.clock.simNow, '2026-10-27T17:12:00Z');
});

test('the desk’s way in takes only a watch member and only desk events', () => {
  const { h } = host();
  assert.equal(
    h.desk({ type: 'intel.watch', bundle_id: 'x' }, { by: 'p-kestrel' }).code,
    'ROLE',
  );
  assert.equal(h.desk({ type: 'ack' }, { by: 'VALE' }).code, 'UNKNOWN_EVENT');
  assert.equal(h.desk({ type: 'reset' }, { by: 'VALE' }).code, 'UNKNOWN_EVENT');
});

test('phone binding (I10): a ticket once, then the token; this computer by participant; never another person', () => {
  const { h } = host();
  const t = P(h, { type: 'phone.ticket', participant_id: 'p-kestrel' });
  assert.ok(t.ticket);
  const lan = h.phoneHello({
    id: 'phone-a1',
    participant_id: 'p-atlas6',
    ticket: t.ticket,
  });
  assert.equal(
    lan.code,
    'I10_NOT_BOUND',
    'a ticket for KESTREL is not ATLAS 6’s',
  );
  const ok = h.phoneHello({ id: 'phone-a1', ticket: t.ticket });
  assert.equal(ok.participant_id, 'p-kestrel');
  assert.equal(
    h.phoneHello({ id: 'phone-a2', ticket: t.ticket }).code,
    'TICKET_EXPIRED',
    'used once',
  );
  assert.equal(
    h.phoneHello({ id: 'phone-a1', token: ok.token }).participant_id,
    'p-kestrel',
  );
  assert.equal(
    h.phoneHello({ id: 'phone-a1', token: 'nope' }).code,
    'ID_IN_USE',
  );
  assert.equal(
    h.phoneHello({
      id: 'phone-a1',
      token: ok.token,
      participant_id: 'p-harrier',
    }).code,
    'I10_NOT_BOUND',
  );
  assert.equal(
    h.phoneHello({ id: 'phone-b', participant_id: 'p-wren' }).code,
    'NOT_TRUSTED',
    'LAN needs a ticket',
  );
  assert.equal(
    h.phoneHello({ id: 'phone-b', participant_id: 'p-wren', local: true })
      .participant_id,
    'p-wren',
  );
  assert.equal(
    h.phoneHello({ id: 'phone-c', participant_id: 'p-nobody', local: true })
      .code,
    'UNKNOWN_PERSON',
  );
});

test('phone events: allowlisted fields only, stamped fields refused, another participant refused', () => {
  assert.deepEqual(
    phoneEvent(
      { type: 'ack', push_id: 'push-kestrel-01', rung: 'read', extra: 1 },
      'p-kestrel',
    ),
    {
      event: {
        type: 'ack',
        push_id: 'push-kestrel-01',
        rung: 'read',
        participant_id: 'p-kestrel',
      },
    },
  );
  assert.equal(
    phoneEvent({ type: 'ack', participant_id: 'p-harrier' }, 'p-kestrel').code,
    'I10_NOT_BOUND',
  );
  assert.equal(
    phoneEvent({ type: 'ack', by: 'p-kestrel' }, 'p-kestrel').code,
    'VALIDATION_COMMAND',
  );
  assert.equal(
    phoneEvent({ type: 'ack', at: '2026-10-27T00:00:00Z' }, 'p-kestrel').code,
    'VALIDATION_COMMAND',
  );
  assert.equal(
    phoneEvent({ type: 'ack', rung: 'superseded' }, 'p-kestrel').code,
    'VALIDATION_COMMAND',
  );
  assert.equal(
    phoneEvent({ type: 'ack', source: 'position' }, 'p-kestrel').code,
    'VALIDATION_COMMAND',
  );
  assert.equal(
    phoneEvent({ type: 'push.send' }, 'p-kestrel').code,
    'NOT_PHONE_EVENT',
  );
  assert.equal(
    phoneEvent({ type: 'verification.decide' }, 'p-kestrel').code,
    'NOT_PHONE_EVENT',
  );
});

test('views per socket: a phone its own, MAIN selectMain only, the rest the loop, a launcher nothing', () => {
  assert.equal(viewFor({ kind: 'phone' }), 'phone');
  assert.equal(viewFor({ kind: 'screen', role: 'main' }), 'main');
  assert.equal(viewFor({ kind: 'screen', role: 'verify' }), 'loop');
  assert.equal(viewFor({ kind: 'remote' }), 'loop');
  assert.equal(viewFor({ kind: 'monitor' }), 'loop');
  assert.equal(viewFor({ kind: 'launcher' }), null);
  assert.equal(roleOfSlot(1), 'main');
  assert.equal(roleOfSlot(2), 'verify');
  assert.equal(roleOfSlot(2, { 2: 'main' }), 'main');
  assert.equal(roleOfSlot(null), 'main', 'fails closed to the narrowest view');
});

test('the audit allowlist spells the loop’s event and presenter names exactly', () => {
  assert.deepEqual(
    [...LOOP_EVENT_NAMES].sort(),
    Object.keys(LOOP_ACTIONS).sort(),
  );
  assert.deepEqual(
    [...PRESENTER_CMD_NAMES].sort(),
    Object.keys(PRESENTER_CMDS)
      .filter((k) => !LOOP_ACTIONS[k])
      .sort(),
  );
});
