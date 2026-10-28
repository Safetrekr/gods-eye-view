// SafeTrekr Executive B4: the desk and the presenter on the loop host and
// the relay (EP-31 §§3, 7; EP-33 §§1–3, 7; EP-38 #6, #8, #12). A live desk
// action pre-empts the scripted one it stands for, deterministically (the
// script's later duplicate is skipped, never refused), so a run with live
// actions ends on the same counter; Reset sets the live actions aside and
// the script is back; the desk's undo lasts 10 s; ORTEGA's two shortcuts
// work only at their beats, from the remote in control, and are audited;
// the room preset gives each slot its roles when a room is set up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeSocket, setupOf } from '../../../twinTestKit.mjs';
import { createLoopHost, executiveRelay } from './loopHost.js';
import {
  EXEC_CODE,
  EXEC_ROLE_ORDER,
  MAIN_TEXT_SCALE,
  deskCmd,
  presenterCmd,
  roomPreset,
} from './execProtocol.js';
import { selectCounter } from '../loop/select.js';
import { stableStringify } from '../timeline.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-exec-b4-test-'));
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const { createRelay } =
  await import('../../../../../../server/tripTwin/syncRelay.js');
const { auditCatalogue, serialiseEvent } =
  await import('../../../../../../server/tripTwin/auditLog.js');
const { TOKENS } =
  await import('../../../../../../server/tripTwin/twinTokens.js');

const day = JSON.parse(
  fs.readFileSync(new URL('../data/day.json', import.meta.url), 'utf8'),
);
const golden = JSON.parse(
  fs.readFileSync(
    new URL('../loop/replay.golden.json', import.meta.url),
    'utf8',
  ),
);
const C = (c) => [c.in, c.matched, c.raised, c.pushed, c.closed];
const G = (n) => C(golden.beats[n].counter);
const END = '2026-10-28T01:00:00Z';

function host() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (d) => (t += d) };
  const h = createLoopHost({ day, now: clock.now, tokens: TOKENS });
  return { h, clock };
}
const P = (h, cmd, by = 'R1') => {
  const p = presenterCmd(cmd);
  assert.equal(p.code, undefined, JSON.stringify(p));
  return h.presenter(p.cmd, { by });
};
const asked = (h, cmd, by = 'R1') => {
  const r = P(h, cmd, by);
  assert.equal(r.code, EXEC_CODE.CONFIRM_REQUIRED, JSON.stringify(r));
  return P(h, { type: 'confirm', id: r.ask.id }, by);
};
const D = (h, cmd, as = 'VALE', device = 'desk-1') => {
  const p = deskCmd(cmd, as);
  assert.equal(p.code, undefined, JSON.stringify(p));
  return h.desk(p.cmd, { by: as, device });
};
const jump = (h, to) => assert.ok(P(h, { type: 'clock.jump', to }).ok, to);

/** Beat 1 with the desk's verify and push a minute ahead of the script. */
function earlyBeat1() {
  const { h, clock } = host();
  P(h, { type: 'beat.go', n: 1 });
  jump(h, '2026-10-27T16:03:00Z');
  const v = D(h, {
    type: 'verification.decide',
    sit_id: 's-kestrel-01',
    decision: 'verified',
    grade: { source: 'C', info: 2 },
  });
  assert.ok(v.ok, JSON.stringify(v));
  jump(h, '2026-10-27T16:04:00Z');
  const a = D(h, {
    type: 'recommendation.approve',
    recommendation_id: 'r-kestrel-01',
  });
  assert.ok(a.ok, JSON.stringify(a));
  const p = D(h, { type: 'push.send', recommendation_id: 'r-kestrel-01' });
  assert.ok(p.ok, JSON.stringify(p));
  return { h, clock, v, a, p };
}

test('B4 desk: beat 1’s verify and push a minute early pre-empt the script; the counter still ends 214·11·6·4·6', () => {
  const { h, v, p } = earlyBeat1();
  // The verify took the scripted ids; the system draft came with it.
  assert.equal(v.evs[0].preempts, 'e-0012');
  assert.equal(v.evs[0].verification_id, 'v-kestrel-01');
  assert.equal(v.evs[1].type, 'recommendation.draft');
  assert.equal(v.evs[1].preempts, 'e-0013');
  assert.equal(v.evs[1].by, 'generator', 'drafts stay the system’s');
  assert.equal(p.ev.preempts, 'e-0015');
  assert.equal(p.ev.push_id, 'push-kestrel-01');
  const push = h.loop.pushes['push-kestrel-01'];
  assert.equal(push.sent_at, '2026-10-27T16:04:00Z');
  assert.equal(push.sent_by, 'VALE');
  jump(h, END);
  assert.deepEqual(C(selectCounter(h.loop)), G(5));
  // The scripted duplicates were skipped, never refused.
  assert.deepEqual(
    h.skipped
      .map((s) => s.id)
      .filter((id) => ['e-0012', 'e-0013', 'e-0014', 'e-0015'].includes(id))
      .sort(),
    ['e-0012', 'e-0013', 'e-0014', 'e-0015'],
  );
  assert.deepEqual(
    h.scriptRefused.filter((x) => x.run === h.run),
    [],
    'nothing in the script was refused',
  );
  assert.equal(h.loop.situations['s-kestrel-01'].state, 'CLOSED');
});

test('B4 desk: pre-emption is deterministic — the same live actions give the same record, byte for byte', () => {
  const a = earlyBeat1().h;
  const b = earlyBeat1().h;
  jump(a, END);
  jump(b, END);
  assert.equal(stableStringify(a.loop), stableStringify(b.loop));
  // And the run with live actions ends on the scripted run's counter.
  const s = host().h;
  jump(s, END);
  assert.deepEqual(C(selectCounter(a.loop)), C(selectCounter(s.loop)));
});

test('B4 desk: a click after the script already acted is the reducer’s no-op (already verified), never a second record', () => {
  const { h } = host();
  P(h, { type: 'beat.go', n: 1 });
  jump(h, '2026-10-27T16:04:10Z');
  const r = D(h, {
    type: 'verification.decide',
    sit_id: 's-kestrel-01',
    decision: 'verified',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ALREADY');
  assert.equal(
    h.loop.verifications['v-kestrel-01'].verified_at,
    '2026-10-27T16:04:00Z',
  );
});

test('B4 EP-38 #6: Reset restores the script; the run’s live actions are set aside, not lost', () => {
  const { h } = earlyBeat1();
  const liveIds = h.live.map((e) => e.id);
  assert.ok(liveIds.length >= 4);
  const r = asked(h, { type: 'reset' });
  assert.ok(r.ok);
  assert.deepEqual(h.live, []);
  assert.deepEqual(h.preempted, {});
  assert.deepEqual(
    h.setAside.map((e) => e.id),
    liveIds,
  );
  assert.deepEqual(C(selectCounter(h.loop)), G(0));
  jump(h, END);
  assert.deepEqual(C(selectCounter(h.loop)), G(5));
  // The scripted times are back.
  assert.equal(
    h.loop.verifications['v-kestrel-01'].verified_at,
    '2026-10-27T16:04:00Z',
  );
  assert.equal(
    h.loop.pushes['push-kestrel-01'].sent_at,
    '2026-10-27T16:05:00Z',
  );
});

test('B4 EP-33 §7: Previous keeps the live actions before its target and their pre-emptions with them', () => {
  const { h } = earlyBeat1();
  P(h, { type: 'beat.go', n: 2 });
  const r = asked(h, { type: 'previous' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(h.clock.simNow, '2026-10-27T17:13:00Z');
  assert.equal(
    h.preempted['e-0015'],
    h.live.find((e) => e.type === 'push.send').id,
  );
  assert.equal(
    h.loop.pushes['push-kestrel-01'].sent_at,
    '2026-10-27T16:04:00Z',
  );
});

test('B4 EP-33 §3: the desk’s undo reverses its last act-tier change for 10 s, as a new event naming it', () => {
  const { h, clock } = host();
  P(h, { type: 'beat.go', n: 1 });
  jump(h, '2026-10-27T16:03:00Z');
  const v = D(h, {
    type: 'verification.decide',
    sit_id: 's-kestrel-01',
    decision: 'verified',
  });
  assert.ok(v.ok);
  // Another desk device has nothing to undo.
  assert.equal(
    D(h, { type: 'undo' }, 'VALE', 'desk-2').code,
    EXEC_CODE.NOT_UNDOABLE,
  );
  const u = D(h, { type: 'undo' });
  assert.ok(u.ok, JSON.stringify(u));
  assert.equal(u.ev.type, 'verification.reopen');
  assert.equal(u.ev.reverses, v.ev.id);
  assert.equal(h.loop.situations['s-kestrel-01'].state, 'RAISED');
  assert.equal(D(h, { type: 'undo' }).code, EXEC_CODE.NOT_UNDOABLE);
  // A new decision, then 10 s go by: too late.
  assert.ok(
    D(h, {
      type: 'verification.decide',
      sit_id: 's-kestrel-01',
      decision: 'verified',
    }).ok,
  );
  assert.equal(h.loop.verifications['v-kestrel-01'].version, 2);
  clock.advance(10_001);
  assert.equal(D(h, { type: 'undo' }).code, EXEC_CODE.UNDO_EXPIRED);
});

test('B4 desk reversals through the host: recall names the push, restore names the dismissal, reopen names the close', () => {
  const { h } = host();
  P(h, { type: 'beat.go', n: 1 });
  jump(h, '2026-10-27T16:05:30Z');
  const rc = D(h, {
    type: 'push.recall',
    push_id: 'push-kestrel-01',
    reason: 'wrong recipient',
  });
  assert.ok(rc.ok, JSON.stringify(rc));
  assert.equal(rc.ev.reverses, 'e-0015');
  // Re-issue: a new version, approved, pushed (no scripted counterpart).
  assert.ok(
    D(h, {
      type: 'recommendation.edit',
      recommendation_id: 'r-kestrel-01',
      bluf: 'Arrive 1215L by the Barton Springs Rd side; avoid W Riverside Dr',
    }).ok,
  );
  assert.ok(
    D(h, { type: 'recommendation.approve', recommendation_id: 'r-kestrel-01' })
      .ok,
  );
  const p2 = D(h, { type: 'push.send', recommendation_id: 'r-kestrel-01' });
  assert.ok(p2.ok, JSON.stringify(p2));
  assert.equal(p2.ev.push_id, 'push-r-kestrel-01-v2');
  assert.equal(
    h.loop.situations['s-kestrel-01'].push_id,
    'push-r-kestrel-01-v2',
  );
  // A closed situation reopens with a reason; the SITREP gains v2.
  const { h: k } = host();
  P(k, { type: 'beat.go', n: 1 });
  jump(k, '2026-10-27T17:16:30Z');
  const ro = D(
    k,
    {
      type: 'situation.reopen',
      sit_id: 's-kestrel-01',
      reason: 'signed_in_error',
    },
    'ORTEGA',
  );
  assert.ok(ro.ok, JSON.stringify(ro));
  assert.equal(ro.ev.reverses, 'e-0026');
  assert.equal(k.loop.sitreps['sr-kestrel-01'].version, 2);
  const sc = D(k, { type: 'sitrep.sign', sit_id: 's-kestrel-01', close: true });
  assert.ok(sc.ok, JSON.stringify(sc));
  assert.deepEqual(
    sc.evs.map((e) => e.type),
    ['sitrep.sign', 'situation.close'],
  );
  assert.equal(k.loop.situations['s-kestrel-01'].state, 'CLOSED');
  // Sign-and-close is all or none: an open ladder signs nothing.
  const { h: w } = host();
  P(w, { type: 'beat.go', n: 1 });
  jump(w, '2026-10-27T16:10:00Z');
  const early = D(w, {
    type: 'sitrep.sign',
    sit_id: 's-kestrel-01',
    close: true,
  });
  assert.equal(early.code, 'I7_OPEN_LADDER');
  assert.equal(w.loop.sitreps['sr-kestrel-01'], undefined, 'nothing pulled');
});

test('B4 desk: only the watch, only desk intents; `as` is VALE or ORTEGA; the page never names ids the host decides', () => {
  assert.equal(deskCmd({ type: 'undo' }, 'p-kestrel').code, EXEC_CODE.BAD_AS);
  assert.equal(deskCmd({ type: 'ack' }, 'VALE').code, EXEC_CODE.NOT_DESK);
  assert.equal(deskCmd({ type: 'reset' }, 'VALE').code, EXEC_CODE.NOT_DESK);
  for (const k of ['reverses', 'preempts', 'version', 'by', 'at', 'id'])
    assert.equal(
      deskCmd({ type: 'intel.restore', bundle_id: 'b-1', [k]: 'x' }, 'VALE')
        .code,
      EXEC_CODE.VALIDATION_COMMAND,
      k,
    );
  assert.equal(
    deskCmd(
      {
        type: 'verification.decide',
        sit_id: 's-1',
        grade: { source: 'Z', info: 2 },
      },
      'VALE',
    ).code,
    EXEC_CODE.VALIDATION_COMMAND,
  );
  const { h } = host();
  assert.equal(h.desk({ type: 'undo' }, { by: 'presenter' }).code, 'ROLE');
  // The countersign needs the supervisor switch: as VALE it is refused.
  P(h, { type: 'beat.go', n: 2 });
  jump(h, '2026-10-27T18:05:30Z');
  assert.equal(
    D(h, { type: 'verification.countersign', sit_id: 's-atlas-01' }).code,
    'ROLE',
  );
  const cs = D(
    h,
    { type: 'verification.countersign', sit_id: 's-atlas-01' },
    'ORTEGA',
  );
  assert.ok(cs.ok, JSON.stringify(cs));
  assert.equal(cs.ev.preempts, 'e-0028');
});

test('B4 EP-38 #8: ORTEGA’s countersign from the iPad — ask first, at beat 2 only, while it is still to come', () => {
  const { h } = host();
  P(h, { type: 'beat.go', n: 1 });
  assert.equal(P(h, { type: 'ortega.countersign' }).code, EXEC_CODE.WRONG_BEAT);
  assert.equal(P(h, { type: 'ortega.retier' }).code, EXEC_CODE.WRONG_BEAT);
  P(h, { type: 'beat.go', n: 2 });
  assert.equal(h.clockView().shortcuts['ortega.countersign'].ready, false);
  // Before VALE's assessment the reducer refuses (nothing to countersign).
  jump(h, '2026-10-27T18:02:00Z');
  assert.equal(asked(h, { type: 'ortega.countersign' }).code, 'NOT_FOUND');
  jump(h, '2026-10-27T18:05:30Z');
  assert.equal(h.clockView().shortcuts['ortega.countersign'].ready, true);
  const r = asked(h, { type: 'ortega.countersign' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.shortcut.preempts, 'e-0028');
  assert.equal(r.shortcut.by, 'ORTEGA');
  const v = h.loop.verifications['v-atlas-01'];
  assert.equal(v.countersigned_by, 'ORTEGA');
  assert.equal(v.countersigned_at, '2026-10-27T18:05:30Z');
  const line = h.loop.log.find((l) => l.id === r.shortcut.id);
  assert.equal(line.via, 'presenter');
  assert.equal(
    P(h, { type: 'ortega.countersign' }).code,
    EXEC_CODE.NOT_PENDING,
  );
  assert.equal(h.clockView().shortcuts['ortega.countersign'], null);
  jump(h, END);
  assert.deepEqual(C(selectCounter(h.loop)), G(5));
  assert.ok(h.skipped.some((s) => s.id === 'e-0028'));
});

test('B4 EP-38 #8: ORTEGA’s re-tier from the iPad at beat 3; the scripted one is skipped; the day still closes', () => {
  const { h } = host();
  P(h, { type: 'beat.go', n: 3 });
  jump(h, '2026-10-27T22:11:00Z');
  const r = asked(h, { type: 'ortega.retier' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.shortcut.preempts, 'e-0064');
  assert.equal(h.loop.people['p-wren'].protection, 'REMOTE');
  assert.equal(h.loop.retiers.at(-1).by, 'ORTEGA');
  assert.equal(h.loop.retiers.at(-1).at, '2026-10-27T22:11:00Z');
  jump(h, END);
  assert.deepEqual(C(selectCounter(h.loop)), G(5));
});

test('B4 EP-38 #12: phones live hold the scripted replies; a tap answers; scripted again from then on', () => {
  const { h } = host();
  P(h, { type: 'beat.go', n: 1 });
  assert.ok(P(h, { type: 'phones.mode', mode: 'live' }).ok);
  assert.equal(h.clockView().phones, 'live');
  jump(h, '2026-10-27T16:06:30Z');
  const kr = () => h.loop.pushes['push-kestrel-01'].recipients['p-kestrel'];
  assert.equal(kr().rung, 'delivered', 'the system receipt still lands');
  assert.ok(h.held.some((x) => x.id === 'e-0018'));
  const tap = h.applyLive(
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
  assert.ok(tap.ok);
  assert.equal(kr().rung, 'read');
  assert.ok(P(h, { type: 'phones.mode', mode: 'scripted' }).ok);
  // A tap ahead of a scripted reply pre-empts it (accepted at 1607Z).
  const acc = h.applyLive(
    {
      type: 'ack',
      push_id: 'push-kestrel-01',
      participant_id: 'p-kestrel',
      rung: 'accepted',
    },
    {
      by: 'p-kestrel',
      via: 'phone',
      device: { participant_id: 'p-kestrel' },
      from: 'phone',
    },
  );
  assert.ok(acc.ok);
  assert.equal(acc.ev.preempts, 'e-0020');
  assert.equal(
    presenterCmd({ type: 'phones.mode', mode: 'loud' }).code,
    EXEC_CODE.BAD_MODE,
  );
});

test('B4 room preset: slots main, verify, intel, roster, principal, trips on the school roles they are built on', () => {
  const plan = roomPreset(6);
  assert.deepEqual(
    plan.map((p) => p.role),
    [...EXEC_ROLE_ORDER],
  );
  assert.deepEqual(
    plan.map((p) => p.patch.role),
    ['site', 'trips', 'trips', 'trips', 'site', 'trips'],
  );
  assert.equal(plan[0].patch.textScale, MAIN_TEXT_SCALE);
  assert.equal(plan[4].patch.textScale, undefined);
  assert.equal(plan[0].patch.layers.streets, true);
  assert.equal(plan[0].patch.layers.paths, false);
  assert.equal(roomPreset(2).length, 2);
});

// ------------------------------------------------------------- the relay

const NO_TIMERS = Object.freeze({ set: () => null, clear: () => {} });
function room() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (d) => (t += d) };
  const lines = [];
  const relay = createRelay({
    now: clock.now,
    timers: NO_TIMERS,
    audit: {
      emit(type, ev) {
        const l = serialiseEvent(type, ev, t, auditCatalogue('executive'));
        if (l) lines.push(l);
        return Boolean(l);
      },
      health: () => ({ ok: true }),
    },
    exec: executiveRelay({ day, tokens: TOKENS }),
  });
  const sock = (hello, opts = {}) => {
    const s = fakeSocket();
    relay.attach(s, opts);
    s.say(hello);
    return s;
  };
  const launcher = sock({ t: 'hello', id: 'L', kind: 'launcher' });
  launcher.say({ t: 'setup', count: 6 });
  const setup = setupOf(launcher);
  const s1 = sock({ t: 'hello', id: 'S1', kind: 'screen', setup, slot: 1 });
  let req = 0;
  const loopCmd = (ws, cmd) => {
    req += 1;
    ws.say({ t: 'loop-cmd', reqId: req, cmd });
    return ws.all('loop-ack').find((a) => a.reqId === req);
  };
  const deskSay = (ws, cmd, as = 'VALE') => {
    req += 1;
    ws.say({ t: 'desk-cmd', reqId: req, as, cmd });
    return ws.all('loop-ack').find((a) => a.reqId === req);
  };
  return { relay, clock, lines, sock, setup, s1, loopCmd, deskSay, launcher };
}

test('B4 room preset from the host: once a remote holds control, every slot gets its roles and MAIN its text scale; audited', () => {
  const { relay, sock, setup, lines } = room();
  const before = relay.host.state.screens;
  assert.notEqual(before[2].role, 'trips', 'not before a remote is in control');
  const remote = sock({
    t: 'hello',
    id: 'R',
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  assert.equal(remote.last('welcome').controller, true);
  relay.exec.tick();
  const sc = relay.host.state.screens;
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((n) => sc[n].role),
    ['site', 'trips', 'trips', 'trips', 'site', 'trips'],
  );
  assert.equal(sc[1].textScale, MAIN_TEXT_SCALE);
  assert.equal(sc[1].layers.streets, true);
  assert.equal(sc[5].layers.paths, false);
  const preset = lines.filter((l) => l.type === 'room.preset');
  assert.equal(preset.length, 1);
  assert.equal(preset[0].data.slots, 6);
  // Once per setup: a second tick does nothing more.
  const rev = relay.host.state.rev;
  relay.exec.tick();
  assert.equal(relay.host.state.rev, rev);
  assert.equal(remote.last('state').state.screens[2].role, 'trips');
});

test('B4 a wall’s executive role from the remote also sets the school role it is built on', () => {
  const { relay, sock, setup, loopCmd } = room();
  const remote = sock({
    t: 'hello',
    id: 'R',
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  relay.exec.tick();
  assert.ok(
    loopCmd(remote, { type: 'wall.role', slot: 2, role: 'principal' }).ok,
  );
  assert.equal(relay.host.state.screens[2].role, 'site');
  assert.ok(loopCmd(remote, { type: 'wall.role', slot: 5, role: 'roster' }).ok);
  assert.equal(relay.host.state.screens[5].role, 'trips');
  assert.equal(relay.exec.loopHost.wallRole(2), 'principal');
});

test('B4 the desk on the relay: this computer only; its live action goes through the reducer, pre-empts the script and is audited', () => {
  const { relay, sock, setup, loopCmd, deskSay, lines } = room();
  const remote = sock({
    t: 'hello',
    id: 'R',
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  relay.exec.tick();
  const lan = sock(
    { t: 'hello', id: 'desk-x', kind: 'desk' },
    { isLocal: false },
  );
  assert.equal(lan.last('welcome').type, 'denied');
  assert.equal(lan.last('welcome').code, 'NOT_TRUSTED');
  const desk = sock({ t: 'hello', id: 'desk-1', kind: 'desk' });
  assert.equal(desk.last('welcome').type, 'desk');
  const view = desk.all('loop').at(-1);
  assert.equal(view.view, 'desk');
  assert.ok(Array.isArray(view.desk.pending));
  assert.ok(view.loop.people['p-kestrel'].name, 'the desk has names');
  loopCmd(remote, { type: 'beat.go', n: 1 });
  loopCmd(remote, { type: 'clock.jump', to: '2026-10-27T16:03:00Z' });
  relay.exec.tick();
  const pend = desk.all('loop').at(-1).desk.pending;
  assert.ok(
    pend.some((x) => x.id === 'e-0012' && x.at === '2026-10-27T16:04:00Z'),
  );
  assert.ok(desk.all('loop').at(-1).desk.drafts['s-kestrel-01'].bluf);
  const a = deskSay(desk, {
    type: 'verification.decide',
    sit_id: 's-kestrel-01',
    decision: 'verified',
  });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.events.length, 2);
  const after = desk.all('loop').at(-1);
  assert.equal(after.loop.situations['s-kestrel-01'].state, 'VERIFIED');
  assert.equal(after.undo.reversal, 'verification.reopen');
  assert.equal(after.desk.preempted['e-0012'], a.events[0]);
  const ln = lines.filter(
    (l) => l.type === 'loop.event' && l.data.from === 'desk',
  );
  assert.ok(
    ln.some(
      (l) =>
        l.data.type === 'verification.decide' &&
        l.data.preempts === 'e-0012' &&
        l.data.by === 'VALE',
    ),
  );
  assert.ok(
    !JSON.stringify(ln).includes('Barton'),
    'no free text in the audit',
  );
  // Not from a remote or a wall; not as someone else.
  assert.equal(deskSay(remote, { type: 'undo' }).code, EXEC_CODE.NOT_DESK);
  assert.equal(
    deskSay(desk, { type: 'undo' }, 'p-kestrel').code,
    EXEC_CODE.BAD_AS,
  );
  assert.ok(
    lines.some((l) => l.type === 'loop.refused' && l.data.code === 'NOT_DESK'),
  );
  // A refused desk action says why.
  const r = deskSay(desk, {
    type: 'push.recall',
    push_id: 'push-kestrel-01',
    reason: 'x',
  });
  assert.equal(r.ok, false);
});

test('B4 the ORTEGA shortcuts on the relay: only the remote in control; refused and audited at the wrong beat; audited as ORTEGA via the presenter', () => {
  const { relay, sock, setup, loopCmd, lines } = room();
  const remote = sock({
    t: 'hello',
    id: 'R',
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  const viewer = sock({
    t: 'hello',
    id: 'R2',
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  relay.exec.tick();
  assert.equal(
    loopCmd(viewer, { type: 'ortega.countersign' }).code,
    'LEASE_NOT_CONTROLLER',
  );
  loopCmd(remote, { type: 'beat.go', n: 1 });
  const wrong = loopCmd(remote, { type: 'ortega.countersign' });
  assert.equal(wrong.code, EXEC_CODE.WRONG_BEAT);
  assert.ok(
    lines.some(
      (l) =>
        l.type === 'loop.refused' &&
        l.data.type === 'ortega.countersign' &&
        l.data.code === 'WRONG_BEAT' &&
        l.data.from === 'presenter',
    ),
  );
  loopCmd(remote, { type: 'beat.go', n: 2 });
  loopCmd(remote, { type: 'clock.jump', to: '2026-10-27T18:05:30Z' });
  const ask = loopCmd(remote, { type: 'ortega.countersign' });
  assert.equal(ask.code, 'CONFIRM_REQUIRED');
  assert.match(ask.ask.text, /as ORTEGA now\?/);
  // Only the asker answers.
  assert.equal(
    loopCmd(viewer, { type: 'confirm', id: ask.ask.id }).code,
    'LEASE_NOT_CONTROLLER',
  );
  assert.equal(loopCmd(remote, { type: 'confirm', id: ask.ask.id }).ok, true);
  const line = lines.find(
    (l) =>
      l.type === 'loop.event' &&
      l.data.type === 'verification.countersign' &&
      l.data.from === 'presenter',
  );
  assert.ok(line, 'audited');
  assert.equal(line.data.by, 'ORTEGA');
  assert.equal(line.data.preempts, 'e-0028');
  assert.equal(
    relay.exec.loopHost.loop.verifications['v-atlas-01'].countersigned_by,
    'ORTEGA',
  );
});

// ------------------------------------------------------------- B7 (F1)

test('B7 #4: Previous from beat 1 lands at the beat 0 anchor (1430Z), not 1200Z, at the rate that holds there', () => {
  const { h } = host();
  assert.ok(P(h, { type: 'next' }).ok);
  assert.equal(h.clock.simNow, '2026-10-27T15:54:00Z');
  const r = asked(h, { type: 'previous' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.beat.to, '2026-10-27T14:30:00Z');
  assert.equal(h.clock.simNow, '2026-10-27T14:30:00Z');
  assert.deepEqual(C(selectCounter(h.loop)), [186, 7, 2, 0, 2]);
  assert.equal(h.clock.paused, true);
  assert.equal(h.clock.held, null);
  assert.equal(h.clock.rate, 10, 'the next checkpoint’s rate');
});

test('B7 R19 S2-3: clock.jump takes the rate of where it lands and clears a hold', () => {
  const { h, clock } = host();
  assert.ok(P(h, { type: 'next' }).ok);
  for (let i = 0; i < 420; i++) h.tick(clock.advance(250));
  assert.equal(h.clock.held, 'checkpoint');
  P(h, { type: 'clock.rate', rate: 60 });
  jump(h, '2026-10-27T20:05:00Z');
  assert.equal(h.clock.rate, 20, 'beat 2’s comms-check checkpoint runs ×20');
  assert.equal(h.clock.held, null);
});

test('B7: the presenter sees held phone replies and the next scripted act (ids only)', () => {
  const { h } = host();
  P(h, { type: 'beat.go', n: 1 });
  let c = h.clockView();
  assert.equal(c.heldReplies, 0);
  assert.equal(c.nextScript.by, 'VALE');
  assert.equal(c.nextScript.type, 'verification.decide');
  assert.equal(c.nextScript.sit_id, 's-kestrel-01');
  assert.equal(c.nextScript.at, '2026-10-27T16:04:00Z');
  assert.equal(JSON.stringify(c.nextScript).includes('KESTREL'), false);
  P(h, { type: 'phones.mode', mode: 'live' });
  jump(h, '2026-10-27T16:08:00Z');
  c = h.clockView();
  assert.ok(c.heldReplies > 0, 'KESTREL’s scripted read and accept wait');
});

test('B7 R13 S2-2: the welfare-check step needs a countersign from another supervisor', () => {
  const { h } = host();
  P(h, { type: 'beat.go', n: 3 });
  jump(h, '2026-10-27T22:29:30Z');
  const step = (fields, as = 'VALE') =>
    D(h, { type: 'callback.step', push_id: 'push-wren-01', ...fields }, as);
  const bare = step({ step: 4, outcome: 'call placed' });
  assert.equal(bare.code, 'CALLBACK_NEEDS_COUNTERSIGN');
  const self = step(
    { step: 4, outcome: 'call placed', countersigned_by: 'ORTEGA' },
    'ORTEGA',
  );
  assert.equal(self.code, 'CALLBACK_NEEDS_COUNTERSIGN');
  const two = step({
    step: 4,
    outcome: 'call placed',
    countersigned_by: 'ORTEGA',
  });
  assert.ok(two.ok, JSON.stringify(two));
  const last = h.loop.callbacks['push-wren-01'].steps.at(-1);
  assert.equal(last.step, 4);
  assert.equal(last.countersigned_by, 'ORTEGA');
  assert.equal(h.loop.lastHuman.type, 'callback.step');
});

test('B7 R13 S2-3/S2-4: the desk’s VALE/ORTEGA switch and the presenter’s ORTEGA are on the audit; MAIN and phones get a lean clock', () => {
  const { relay, sock, setup, loopCmd, deskSay, lines } = room();
  const remote = sock({
    t: 'hello',
    id: 'R',
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  relay.exec.tick();
  const desk = sock({ t: 'hello', id: 'desk-1', kind: 'desk' });
  loopCmd(remote, { type: 'beat.go', n: 2 });
  loopCmd(remote, { type: 'clock.jump', to: '2026-10-27T18:05:30Z' });
  relay.exec.tick();
  assert.ok(
    deskSay(desk, { type: 'intel.watch', bundle_id: 'b-m-046', reason: 'x' })
      .ok,
  );
  const cs = deskSay(
    desk,
    { type: 'verification.countersign', sit_id: 's-atlas-01' },
    'ORTEGA',
  );
  assert.ok(cs.ok, JSON.stringify(cs));
  const sw = lines.filter((l) => l.type === 'desk.as');
  assert.equal(sw.length, 1);
  assert.deepEqual(sw[0].data, {
    device: 'desk-1',
    from: 'VALE',
    to: 'ORTEGA',
    run: 1,
  });
  const ev = lines.find(
    (l) =>
      l.type === 'loop.event' && l.data.type === 'verification.countersign',
  );
  assert.equal(ev.data.device, 'desk-1');
  assert.equal(ev.data.via, 'touch');
});

test('B7: MAIN and the phones get the clock without the presenter’s extras; the iPad gets them', () => {
  const { relay, sock, setup, loopCmd, s1 } = room();
  const remote = sock({
    t: 'hello',
    id: 'R',
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  relay.exec.tick();
  assert.ok(loopCmd(remote, { type: 'wall.role', slot: 1, role: 'main' }).ok);
  loopCmd(remote, { type: 'beat.go', n: 1 });
  relay.exec.tick();
  const clocks = (ws) =>
    [...ws.all('loop'), ...ws.all('loop-clock')]
      .map((m) => m.clock)
      .filter(Boolean);
  const main = clocks(s1);
  assert.ok(main.length > 0);
  for (const c of main) {
    assert.equal(c.nextScript, undefined);
    assert.equal(c.heldReplies, undefined);
  }
  assert.ok(clocks(remote).some((c) => c.nextScript?.by === 'VALE'));
});

test('B7 R13 S2-4: an ORTEGA shortcut from the iPad is on the day’s record as from the presenter', () => {
  const { h } = host();
  P(h, { type: 'beat.go', n: 2 });
  jump(h, '2026-10-27T18:05:30Z');
  const r = asked(h, { type: 'ortega.countersign' });
  assert.ok(r.ok, JSON.stringify(r));
  const v = h.loop.verifications['v-atlas-01'];
  assert.equal(v.countersigned_by, 'ORTEGA');
  assert.equal(v.countersigned_via, 'presenter');
  assert.equal(h.loop.lastHuman.via, 'presenter');
});

test('B7 #12 / F2 S2: MAIN’s scene carries the storm band, the route and the hotel at beat 4, and the doors and posts after the NON-CONCUR; geometry and callsigns only', () => {
  const { h } = host();
  const names = [
    ...Object.values(day.people).map((p) => p.name),
    ...day.watch.staff.map((s) => s.name),
  ];
  const intel = Object.values(day.bundles)
    .flatMap((b) => [b.title, b.short_summary])
    .filter((x) => x?.length >= 12);
  const clean = (sc) => {
    const text = JSON.stringify(sc);
    for (const n of [...names, ...intel])
      assert.ok(!text.includes(n), `MAIN's scene carries "${n}"`);
  };
  P(h, { type: 'beat.go', n: 2 });
  jump(h, '2026-10-27T19:10:00Z');
  let sc = h.mainView().scene;
  assert.deepEqual(
    sc.entrances.map((e) => [e.name, e.side]),
    [
      ['Belvedere Rd entrance', 'E'],
      ['north door', 'N'],
    ],
  );
  assert.deepEqual(
    sc.posts.map((p) => p.label),
    ['ATLAS 3 · advance', 'ATLAS 4 · +1 post'],
  );
  clean(sc);
  jump(h, '2026-10-27T20:45:00Z');
  assert.deepEqual(
    h.mainView().scene.posts.map((p) => p.label),
    ['ATLAS 3 · advance'],
    'the +1 post is stood down at 2040Z',
  );
  P(h, { type: 'beat.go', n: 4 });
  jump(h, '2026-10-27T23:58:30Z');
  sc = h.mainView().scene;
  assert.equal(sc.site, null);
  assert.equal(sc.origin.name, 'Westin Washington Dulles');
  assert.ok(sc.route.length > 2);
  assert.deepEqual(
    sc.areas.map((a) => [a.kind, a.label, a.polygon.length > 2]),
    [['weather', 'Storm line', true]],
  );
  clean(sc);
});
