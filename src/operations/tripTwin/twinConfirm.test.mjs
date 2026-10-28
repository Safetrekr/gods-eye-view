// Phase CF K10 (cf/02-backend.md BE-3, PHASE-CF-PLAN K10 gate, C24, C25,
// CF-D4, S-18): the server asks. A confirm-class command is held until the
// device that sent it confirms; the stored command is what applies; a stale
// question is asked again in place; nothing confirm-class ever applies
// unanswered, from any socket.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clockHost,
  confirmed,
  fakeSocket,
  sayConfirmed,
} from './twinTestKit.mjs';
import { changeList, applyCommand, needsConfirm } from './twinSession.js';
import { previewOf } from './twinPolicy.js';
import { CODE, CONFIRM_MS, PROTO } from './twinProtocol.js';

// The relay writes its store under TMPDIR (S-1): a fresh folder per run.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-k10-'));
process.env.TMPDIR = path.join(scratch, 'tmp');
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
fs.mkdirSync(process.env.TMPDIR);
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const { createRelay, healthOf } =
  await import('../../../server/tripTwin/syncRelay.js');

/** Every command `needsConfirm` names (twinSession.js), with a state. */
const ASKED = [
  { type: 'returnLive' },
  { type: 'count', n: 3 },
  { type: 'reset', target: 'all' },
  { type: 'session', patch: { tripId: 'trip-youth-london' } },
  { type: 'session', patch: { siteKey: 'austin-capitol' } },
  { type: 'session', patch: { report: null } },
  { type: 'session', patch: { visitor: false } },
  { type: 'session', patch: { simStorm: 1_000_000 } },
  { type: 'session', patch: { simFire: 1_000_000 } },
  { type: 'session', patch: { simCyclone: 1_000_000 } },
  { type: 'screens', target: 'all', patch: { role: 'weather' } },
  { type: 'screens', target: 'all', patch: { mode: 'advance' } },
  { type: 'screens', target: 'all', patch: { day: 2 } },
  { type: 'screens', target: 'all', patch: { scale: 'city' } },
  { type: 'screens', target: 'all', patch: { frame: { nonce: 1 } } },
];

function rig() {
  const k = clockHost();
  const events = [];
  k.host.onEvent((type, ev) => events.push({ type, ...ev }));
  k.host.hello({ id: 'r1', kind: 'remote', setup: k.setup, name: 'iPad' });
  // Visitor on and a report, so turning them off changes something.
  k.host.command({
    by: 'r1',
    cmd: { type: 'session', patch: { visitor: true } },
  });
  return { ...k, events, of: (t) => events.filter((e) => e.type === t) };
}

test('K10 BE-3: every confirm-class command is refused CONFIRM_REQUIRED without a ticket and the rev does not move; the confirm applies exactly the stored command', () => {
  for (const cmd of ASKED) {
    assert.equal(needsConfirm(cmd), true, JSON.stringify(cmd));
    const { host } = rig();
    const rev = host.state.rev;
    const r = host.command({ by: 'r1', cmd });
    assert.equal(r.code, CODE.CONFIRM_REQUIRED, JSON.stringify(cmd));
    assert.match(r.confirmId, /^[0-9a-f]{32}$/);
    assert.equal(r.ttlMs, CONFIRM_MS);
    assert.equal(r.reason, 'policy');
    assert.ok(Array.isArray(r.question.parts));
    assert.equal(typeof r.question.text, 'string');
    assert.equal(host.state.rev, rev, 'nothing applied');
    const want = applyCommand(host.state, cmd, { at: 0 }).state;
    const ok = host.confirm({ by: 'r1', confirmId: r.confirmId });
    assert.equal(ok.ok, true, JSON.stringify(cmd));
    assert.equal(host.state.rev, rev + 1);
    assert.deepEqual(changeList(want, host.state), [], 'the stored command');
    assert.equal(host.confirmBypass, 0);
  }
});

test('K10 oracle (sec S4): from a raw controller socket, every confirm-class command with no confirm gives no state broadcast and no change; a client-side `confirm` field never stands in', () => {
  const k = clockHost();
  const relay = createRelay({ host: k.host, now: k.now });
  const wall = fakeSocket();
  relay.attach(wall);
  wall.say({
    t: 'hello',
    id: 'S1',
    kind: 'screen',
    setup: k.setup,
    slot: 1,
    proto: PROTO,
  });
  const raw = fakeSocket();
  relay.attach(raw, { isLocal: false, peer: '192.168.1.9' });
  raw.say({
    t: 'hello',
    id: 'R',
    kind: 'remote',
    setup: k.setup,
    proto: PROTO,
  });
  const before = JSON.stringify(k.host.state);
  const states = wall.all('state').length;
  let req = 0;
  for (const cmd of ASKED) {
    raw.say({ t: 'cmd', reqId: ++req, cmd });
    // A page that claims it already asked: ignored (S-18).
    raw.say({ t: 'cmd', reqId: ++req, cmd, confirmed: true, confirmId: 'x' });
    raw.say({ t: 'cmd', reqId: ++req, cmd: { ...cmd, confirmed: true } });
    k.tick(100);
    raw.say({ t: 'hb' });
  }
  assert.equal(JSON.stringify(k.host.state), before, 'the wall never moved');
  assert.equal(wall.all('state').length, states, 'no state broadcast');
  assert.ok(raw.all('ack').every((a) => !a.ok));
  assert.equal(relay.health().counters.confirmBypass, 0);
});

test('K10: the same id twice → CONFIRM_UNKNOWN (single use; a 200 ms double tap applies once); another device → CONFIRM_NOT_YOURS; a replaced question → CONFIRM_SUPERSEDED', () => {
  const { host, tick, setup } = rig();
  host.hello({ id: 'r2', kind: 'remote', setup, name: 'Laptop' });
  const q = host.command({ by: 'r1', cmd: { type: 'returnLive' } });
  assert.equal(
    host.confirm({ by: 'r2', confirmId: q.confirmId }).code,
    CODE.CONFIRM_NOT_YOURS,
  );
  const rev = host.state.rev;
  assert.equal(host.confirm({ by: 'r1', confirmId: q.confirmId }).ok, true);
  tick(200);
  assert.equal(
    host.confirm({ by: 'r1', confirmId: q.confirmId }).code,
    CODE.CONFIRM_UNKNOWN,
  );
  assert.equal(host.state.rev, rev + 1, 'applied once');
  // A new question from the same device replaces its old one.
  const a = host.command({ by: 'r1', cmd: { type: 'count', n: 2 } });
  const b = host.command({ by: 'r1', cmd: { type: 'returnLive' } });
  assert.equal(
    host.confirm({ by: 'r1', confirmId: a.confirmId }).code,
    CODE.CONFIRM_SUPERSEDED,
  );
  assert.equal(host.confirm({ by: 'r1', confirmId: b.confirmId }).ok, true);
  assert.equal(host.state.count, 4, 'the replaced count never applied');
});

test('K10 C24: pin S3, then confirm "Advance on All" asked before the pin → CONFIRM_STALE with a fresh question that leaves S3 out; an unrelated layer change in between leaves the question standing', () => {
  const { host, of } = rig();
  const cmd = { type: 'screens', target: 'all', patch: { mode: 'advance' } };
  const q = host.command({ by: 'r1', cmd });
  // Unrelated: a layer on S2 (not in what the question changes).
  host.command({
    by: 'r1',
    cmd: { type: 'screens', target: 2, patch: { layers: { radar: true } } },
  });
  const ok = host.confirm({ by: 'r1', confirmId: q.confirmId });
  assert.equal(ok.ok, true, 'still the same question');
  assert.deepEqual(ok.skipped, []);
  // Stale: S3 pinned after the question.
  confirmed(host, 'r1', {
    type: 'screens',
    target: 'all',
    patch: { mode: 'live' },
  });
  const q2 = host.command({ by: 'r1', cmd });
  host.command({
    by: 'r1',
    cmd: { type: 'screens', target: 3, patch: { pinned: true } },
  });
  const rev = host.state.rev;
  const st = host.confirm({ by: 'r1', confirmId: q2.confirmId });
  assert.equal(st.code, CODE.CONFIRM_STALE);
  assert.notEqual(st.confirmId, q2.confirmId);
  assert.equal(host.state.rev, rev, 'nothing applied');
  assert.ok(!st.question.parts.some((p) => p.scope === 'S3'), 'S3 left out');
  assert.equal(of('confirm.stale').length, 1);
  const done = host.confirm({ by: 'r1', confirmId: st.confirmId });
  assert.equal(done.ok, true);
  assert.deepEqual(done.skipped, [3]);
  assert.equal(host.state.screens[3].mode, 'live');
});

test('K10: a confirm at 14 s is accepted, at 16 s refused (confirm.expired); the tick expires an unanswered one; a handover cancels the question (lease)', () => {
  let { host, tick, of } = rig();
  let q = host.command({ by: 'r1', cmd: { type: 'returnLive' } });
  tick(14_000);
  assert.equal(host.confirm({ by: 'r1', confirmId: q.confirmId }).ok, true);
  q = host.command({ by: 'r1', cmd: { type: 'returnLive' } });
  tick(16_000);
  host.beat('r1');
  assert.equal(
    host.confirm({ by: 'r1', confirmId: q.confirmId }).code,
    CODE.CONFIRM_UNKNOWN,
  );
  assert.equal(of('confirm.expired').length, 1);
  q = host.command({ by: 'r1', cmd: { type: 'returnLive' } });
  tick(CONFIRM_MS);
  assert.equal(host.expireConfirms(), true);
  assert.equal(host.questionOpen, false);
  assert.equal(of('confirm.expired').length, 2);
  // Handover: the question goes with the lease.
  ({ host, of } = rig());
  const setup = host.setup({ count: 4 }).setup;
  host.hello({ id: 'r1', kind: 'remote', setup });
  host.hello({ id: 'r2', kind: 'remote', setup });
  q = host.command({ by: 'r1', cmd: { type: 'returnLive' } });
  host.requestControl('r2');
  host.answerHandover('r1', true);
  assert.equal(
    host.confirm({ by: 'r1', confirmId: q.confirmId }).code,
    CODE.CONFIRM_UNKNOWN,
  );
  assert.ok(of('confirm.cancelled').some((e) => e.data.reason === 'lease'));
});

test('K10: a page may raise a question with a closed-list ask (reason client), never lower one; anything else is VALIDATION_COMMAND', () => {
  const { host } = rig();
  const cmd = { type: 'screens', target: 2, patch: { mode: 'advance' } };
  const q = host.command({ by: 'r1', cmd, ask: 'incident' });
  assert.equal(q.code, CODE.CONFIRM_REQUIRED);
  assert.equal(q.reason, 'client');
  assert.equal(host.confirm({ by: 'r1', confirmId: q.confirmId }).ok, true);
  for (const bad of ['no', true, 0, { text: 'x' }]) {
    const r = host.command({ by: 'r1', cmd, ask: bad });
    assert.equal(r.code, CODE.VALIDATION_COMMAND, JSON.stringify(bad));
  }
  // `ask` cannot lower: a confirm-class command still asks with any hint.
  assert.equal(
    host.command({ by: 'r1', cmd: { type: 'returnLive' }, ask: 'day-all' })
      .code,
    CODE.CONFIRM_REQUIRED,
  );
});

test('K10 CF-D4 (sup B2): undo of Visitor on, of a new report and of Return all with a running storm each ask, from the author too; a plain undo stays one tap', () => {
  const { host } = rig();
  const visitor = host.command({
    by: 'r1',
    cmd: { type: 'session', patch: { visitor: false } },
  });
  host.confirm({ by: 'r1', confirmId: visitor.confirmId });
  const on = host.command({
    by: 'r1',
    cmd: { type: 'session', patch: { visitor: true } },
  });
  let u = host.undo({ by: 'r1', undoId: on.undoId });
  assert.equal(u.code, CODE.CONFIRM_REQUIRED);
  assert.equal(u.question.text, 'Undo · names back on');
  assert.equal(host.confirm({ by: 'r1', confirmId: u.confirmId }).ok, true);
  assert.equal(host.state.session.visitor, false);
  const rep = host.command({
    by: 'r1',
    cmd: {
      type: 'session',
      patch: { report: { id: 'r-1', floor: 4, kind: 'medical', at: 1 } },
    },
  });
  u = host.undo({ by: 'r1', undoId: rep.undoId });
  assert.equal(u.question.text, 'Undo · reported floor cleared');
  const storm = host.command({
    by: 'r1',
    cmd: { type: 'session', patch: { simStorm: 1_000_000 } },
  });
  host.confirm({ by: 'r1', confirmId: storm.confirmId });
  const back = host.command({ by: 'r1', cmd: { type: 'returnLive' } });
  const done = host.confirm({ by: 'r1', confirmId: back.confirmId });
  u = host.undo({ by: 'r1', undoId: done.undoId });
  assert.equal(u.code, CODE.CONFIRM_REQUIRED);
  assert.equal(
    u.question.text,
    'Undo · simulated weather back on every screen',
  );
  // A layer: one tap.
  const layer = host.command({
    by: 'r1',
    cmd: { type: 'screens', target: 1, patch: { layers: { radar: true } } },
  });
  assert.equal(host.undo({ by: 'r1', undoId: layer.undoId }).ok, true);
});

test('K10: pairing a screen during an unrelated question, then Confirm, is accepted', () => {
  const { host, setup } = rig();
  const q = host.command({
    by: 'r1',
    cmd: { type: 'screens', target: 'all', patch: { mode: 'advance' } },
  });
  const tv = host.hello({ id: 'tv', kind: 'screen' });
  assert.equal(tv.type, 'pair-code');
  assert.equal(host.pair({ by: 'r1', code: tv.code, slot: 2 }).ok, true);
  assert.equal(host.confirm({ by: 'r1', confirmId: q.confirmId }).ok, true);
  void setup;
});

test('K10 (F-0014 c): for 50 seeded commands the preview names exactly what the apply changed', () => {
  let s = 0.4242;
  const rnd = () => (s = (s * 9301 + 0.49297) % 1);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const { host } = rig();
  const make = () =>
    pick([
      () => ({
        type: 'screens',
        target: pick([1, 2, 3, 4, 'all']),
        patch: { mode: pick(['live', 'advance']) },
      }),
      () => ({
        type: 'screens',
        target: pick([1, 2, 'all']),
        patch: { layers: { radar: rnd() > 0.5 } },
      }),
      () => ({
        type: 'screens',
        target: pick([1, 3]),
        patch: { pinned: rnd() > 0.5 },
      }),
      () => ({
        type: 'screens',
        target: pick([2, 4, 'all']),
        patch: { role: pick(['site', 'weather', 'day']) },
      }),
      () => ({
        type: 'session',
        patch: {
          spotlight: rnd() > 0.5 ? { kind: 'person', id: 'twin-NF' } : null,
        },
      }),
      () => ({ type: 'reset', target: pick([1, 'all']) }),
      () => ({ type: 'count', n: pick([2, 3, 4, 5, 6]) }),
      () => ({ type: 'returnLive' }),
    ])();
  for (let i = 0; i < 50; i += 1) {
    const cmd = make();
    const before = host.state;
    const p = previewOf(before, cmd);
    const r = host.command({ by: 'r1', cmd });
    const done =
      r.code === CODE.CONFIRM_REQUIRED
        ? host.confirm({ by: 'r1', confirmId: r.confirmId })
        : r;
    assert.equal(done.ok, true, JSON.stringify(cmd));
    assert.deepEqual(
      p.changes.map((c) => [c.key, c.to]),
      changeList(before, host.state).map((c) => [c.key, c.to]),
      JSON.stringify(cmd),
    );
  }
  assert.equal(host.confirmBypass, 0);
});

test('K10 relay: the remote round trip (cmd → CONFIRM_REQUIRED → confirm → state with `by`); confirm-cancel drops it; health says confirm server and confirmBypass 0', () => {
  const k = clockHost();
  const relay = createRelay({ host: k.host, now: k.now });
  const wall = fakeSocket();
  relay.attach(wall);
  wall.say({
    t: 'hello',
    id: 'S1',
    kind: 'screen',
    setup: k.setup,
    slot: 1,
    proto: PROTO,
  });
  const ipad = fakeSocket();
  relay.attach(ipad, { isLocal: false, peer: '192.168.1.9' });
  ipad.say({
    t: 'hello',
    id: 'R',
    kind: 'remote',
    setup: k.setup,
    name: 'iPad',
    proto: PROTO,
  });
  ipad.say({ t: 'cmd', reqId: 1, cmd: { type: 'returnLive' } });
  const q = ipad.last('ack');
  assert.equal(q.code, CODE.CONFIRM_REQUIRED);
  ipad.say({ t: 'confirm-cancel', reqId: 2, confirmId: q.confirmId });
  assert.equal(ipad.last('ack').ok, true);
  ipad.say({ t: 'confirm', reqId: 3, confirmId: q.confirmId });
  assert.equal(ipad.last('ack').code, CODE.CONFIRM_UNKNOWN);
  // Something for Return all to put back (else it changes nothing and
  // has no undo: K9 `undoable`).
  ipad.say({
    t: 'cmd',
    reqId: 30,
    cmd: { type: 'screens', target: 1, patch: { layers: { radar: true } } },
  });
  const states = wall.all('state').length;
  const a = sayConfirmed(ipad, {
    t: 'cmd',
    reqId: 4,
    cmd: { type: 'returnLive' },
  });
  assert.equal(a.ok, true);
  assert.match(a.undoId, /^[0-9a-f]{32}$/);
  assert.equal(wall.all('state').length, states + 1);
  assert.equal(wall.last('state').by.via, 'touch');
  const body = healthOf({ relay, startedAt: k.now() });
  assert.equal(body.confirm, 'server');
  assert.equal(body.counters.confirmBypass, 0);
  assert.equal(body.question, false);
});
