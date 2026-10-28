// Phase CF K9 (cf/02-backend.md BE-4, VOICE-CONTROL §3.4 A9, C10, C11,
// S-18): revision-checked undo. An undo names the command it reverses and
// restores a field only while that command is still its last writer; what
// changed since is skipped and named, so an undo never overwrites a later
// write and never says it undid what it did not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clockHost,
  confirmed,
  fakeSocket,
  undoConfirmed,
} from './twinTestKit.mjs';
import { applyUndoChecked, changeList, createSession } from './twinSession.js';
import { createSessionHost } from './twinSessionHost.js';
import { notUndoneText } from './twinDescribe.js';
import { CODE, PROTO } from './twinProtocol.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-k9-'));
process.env.TMPDIR = path.join(scratch, 'tmp');
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
fs.mkdirSync(process.env.TMPDIR);
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const { createRelay } = await import('../../../server/tripTwin/syncRelay.js');

/** A host with the iPad in control and S4 paired (its keyboard writes). */
function rig(opts = {}) {
  const k = clockHost(opts);
  k.host.hello({ id: 'r1', kind: 'remote', setup: k.setup, name: 'iPad' });
  k.host.hello({ id: 'w4', kind: 'screen', setup: k.setup, slot: 4 });
  const cmd = (c) => confirmed(k.host, 'r1', c);
  const wall = (patch) =>
    k.host.screenCommand({
      by: 'w4',
      cmd: { type: 'screens', target: 4, patch },
    });
  return { ...k, cmd, wall };
}

test('K9 BE-4: interleaved writes never lose the later write (role undone, a later radar kept); a field written since is skipped with who and when', () => {
  const { host, cmd, wall, tick } = rig();
  const a = cmd({ type: 'screens', target: 4, patch: { role: 'day' } });
  assert.equal(wall({ layers: { precip: true } }).ok, true);
  const u = host.undo({ by: 'r1', undoId: a.undoId });
  assert.equal(u.ok, true);
  assert.equal(u.of, a.rev);
  assert.equal(host.state.screens[4].role, 'weather');
  assert.equal(host.state.screens[4].layers.precip, true, 'the later write');
  assert.deepEqual(u.skipped, []);
  // A turns radar off, the wall turns it back on, then A's undo.
  const off = cmd({
    type: 'screens',
    target: 4,
    patch: { layers: { precip: false } },
  });
  tick(1000);
  assert.equal(wall({ layers: { precip: true } }).ok, true);
  const rev = host.state.rev;
  const v = host.undo({ by: 'r1', undoId: off.undoId });
  assert.equal(v.ok, true);
  assert.deepEqual(v.restored, []);
  assert.equal(host.state.rev, rev, 'nothing restored: no new revision');
  assert.equal(v.skipped.length, 1);
  const [x] = v.skipped;
  assert.deepEqual(
    [x.scope, x.field, x.reason, x.by.name, x.by.via, x.rev],
    ['S4', 'layers.precip', 'changed', 'S4', 'keyboard', rev],
  );
  assert.equal(x.at, 1_001_000);
  assert.equal(host.state.screens[4].layers.precip, true);
  assert.match(
    notUndoneText(v.skipped, [], { timeZone: 'UTC' }),
    /^Not undone: S4 layer, changed \d\d:\d\d at the wall|^Not undone: S4 layer, changed \d\d:\d\d by S4 at the wall$/,
  );
});

test('K9 C11: a scale change undone gets a new meta.scale rev (the wall flies back); a role change undone stamps no scale (role → undo → role again still re-scales)', () => {
  const { host, cmd } = rig();
  const s = cmd({ type: 'screens', target: 2, patch: { scale: 'city' } });
  host.undo({ by: 'r1', undoId: s.undoId });
  const m = host.state.screens[2].meta.scale;
  assert.equal(m.source, 'undo');
  assert.equal(m.rev, host.state.rev);
  assert.equal(host.state.screens[2].scale, 'neighborhood');
  const before = JSON.stringify(host.state.screens[3].meta.scale ?? null);
  const r = cmd({ type: 'screens', target: 3, patch: { role: 'weather' } });
  host.undo({ by: 'r1', undoId: r.undoId });
  assert.equal(
    JSON.stringify(host.state.screens[3].meta.scale ?? null),
    before,
  );
  const again = cmd({ type: 'screens', target: 3, patch: { role: 'weather' } });
  assert.equal(again.ok, true);
  assert.equal(
    host.state.screens[3].scale,
    'city',
    'the role brings its scale',
  );
});

test('K9: undo of Return all restores only the screens nobody touched since; a pinned screen kept its pin through it', () => {
  const { host, cmd } = rig();
  cmd({ type: 'screens', target: 1, patch: { layers: { radar: true } } });
  cmd({
    type: 'screens',
    target: 2,
    patch: { layers: { precip: true }, mode: 'advance' },
  });
  const back = cmd({ type: 'returnLive' });
  assert.equal(back.ok, true);
  cmd({ type: 'screens', target: 2, patch: { mode: 'advance' } });
  const u = undoConfirmed(host, 'r1', back.undoId);
  assert.equal(u.ok, true);
  assert.equal(host.state.screens[1].layers.radar, true);
  assert.equal(host.state.screens[2].layers.precip, true, 'untouched key');
  assert.ok(u.skipped.some((x) => x.scope === 'S2' && x.field === 'mode'));
});

test('K9: undo of count 4 → 2 after the screens came back says recreated; a screen added by count is removed only if nothing on it changed since', () => {
  const { host, cmd } = rig();
  const down = cmd({ type: 'count', n: 2 });
  cmd({ type: 'count', n: 4 });
  const u = host.undo({ by: 'r1', undoId: down.undoId });
  assert.equal(u.ok, true);
  assert.deepEqual(
    u.skipped
      .filter((x) => x.field === 'screen')
      .map((x) => [x.scope, x.reason]),
    [
      ['S3', 'recreated'],
      ['S4', 'recreated'],
    ],
  );
  const up = cmd({ type: 'count', n: 6 });
  cmd({ type: 'screens', target: 6, patch: { layers: { radar: true } } });
  // Fewer screens is a protection-lowering undo (CF-D4): it asks first.
  const v = undoConfirmed(host, 'r1', up.undoId);
  assert.ok(host.state.screens[6], 'S6 changed since: kept');
  assert.ok(!host.state.screens[5], 'S5 untouched: removed');
  assert.ok(v.skipped.some((x) => x.scope === 'S6' && x.reason === 'changed'));
});

test('K9: a framing is never replayed (camera); a framing alone has no undo (undoable false)', () => {
  const { host, cmd } = rig();
  const f = cmd({
    type: 'screens',
    target: 1,
    patch: { frame: { subject: { kind: 'site' }, nonce: 7 } },
  });
  assert.equal(f.ok, true);
  assert.equal(f.undoable, false);
  assert.equal(f.undoId, null);
  const both = cmd({
    type: 'screens',
    target: 1,
    patch: {
      frame: { subject: { kind: 'site' }, nonce: 8 },
      layers: { radar: true },
    },
  });
  const u = host.undo({ by: 'r1', undoId: both.undoId });
  assert.deepEqual(u.restored, [{ scope: 'S1', field: 'layers.radar' }]);
  assert.deepEqual(
    u.skipped.map((x) => [x.scope, x.field, x.reason]),
    [['S1', 'frame', 'camera']],
  );
  assert.equal(host.state.screens[1].frame.nonce, 8, 'the camera stays');
  assert.equal(notUndoneText(u.skipped), 'camera stays where it is');
});

test('K9 S-18: the same undo again in its window is a replay (no new rev); after the window UNDO_EXPIRED; a pre-restart undo id is refused after a restart', () => {
  const { host, cmd, tick } = rig();
  const a = cmd({
    type: 'screens',
    target: 1,
    patch: { layers: { radar: true } },
  });
  const u1 = host.undo({ by: 'r1', undoId: a.undoId });
  const rev = host.state.rev;
  const u2 = host.undo({ by: 'r1', undoId: a.undoId });
  assert.equal(u2.replay, true);
  assert.equal(u2.rev, u1.rev);
  assert.equal(host.state.rev, rev);
  assert.equal('undoId' in u1, false, 'no undo of an undo');
  tick(11_000);
  host.beat('r1');
  assert.equal(
    host.undo({ by: 'r1', undoId: a.undoId }).code,
    CODE.UNDO_EXPIRED,
  );
  const b = cmd({
    type: 'screens',
    target: 1,
    patch: { layers: { radar: false } },
  });
  const after = createSessionHost({
    restore: host.snapshot(),
    now: () => 1_000_000 + 11_000,
  });
  after.hello({ id: 'r1', kind: 'remote', token: null });
  assert.equal(after.undo({ by: 'r1', undoId: b.undoId }).ok, false);
});

test('K9 property: 400 seeded sequences of commands, wall keyboard writes and undos from both: after every undo each field is either back to its value before the undone command or as it was just before the undo, and no write after the undone command is ever lost', () => {
  for (let seq = 0; seq < 400; seq += 1) {
    let s = (seq + 1) / 401;
    const rnd = () => (s = (s * 9301 + 0.49297) % 1);
    const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
    const { host, cmd, wall } = rig({ seed: (seq % 97) / 97 + 0.001 });
    const done = []; // {undoId, before, step}
    const lastWrite = {}; // key → step
    let step = 0;
    const stamp = (a, b) => {
      for (const c of changeList(a, b)) lastWrite[c.key] = step;
    };
    for (let i = 0; i < 14; i += 1) {
      step += 1;
      const before = host.state;
      const r = rnd();
      if (r < 0.45) {
        const c = pick([
          () => ({
            type: 'screens',
            target: pick([1, 2, 3, 4]),
            patch: { layers: { precip: rnd() > 0.5, precip: rnd() > 0.5 } },
          }),
          () => ({
            type: 'screens',
            target: pick([1, 2, 3, 4]),
            patch: { role: pick(['site', 'weather', 'day', 'travelers']) },
          }),
          () => ({
            type: 'screens',
            target: pick([1, 2, 3, 4, 'all']),
            patch: { mode: pick(['live', 'advance']) },
          }),
          () => ({
            type: 'screens',
            target: pick([1, 2, 3, 4]),
            patch: { scale: pick(['building', 'city']) },
          }),
          () => ({
            type: 'screens',
            target: pick([1, 3]),
            patch: { pinned: rnd() > 0.5 },
          }),
          () => ({
            type: 'session',
            patch: {
              spotlight: rnd() > 0.5 ? { kind: 'person', id: 'twin-NF' } : null,
            },
          }),
          () => ({ type: 'reset', target: pick([1, 2, 3, 4, 'all']) }),
          () => ({ type: 'returnLive' }),
        ])();
        const a = cmd(c);
        assert.equal(a.ok, true);
        stamp(before, host.state);
        if (a.undoId) done.push({ undoId: a.undoId, before, step });
      } else if (r < 0.7) {
        wall(
          pick([
            { layers: { precip: rnd() > 0.5 } },
            { textScale: pick([1.5, 2, 2.5]) },
            { scale: pick(['building', 'neighborhood']) },
          ]),
        );
        stamp(before, host.state);
      } else if (done.length) {
        const d = pick(done);
        const u = undoConfirmed(host, 'r1', d.undoId);
        if (!u.ok) continue; // expired is fine; the clock does not move here
        const after = host.state;
        for (const c of changeList(before, after)) {
          // Every changed field went back to its value before the command…
          const was = changeList(d.before, after).find((x) => x.key === c.key);
          assert.equal(
            was,
            undefined,
            `seq ${seq}: ${c.key} is not as before the undone command`,
          );
          // …and nobody wrote it after the undone command.
          assert.ok(
            !(lastWrite[c.key] > d.step) || u.replay,
            `seq ${seq}: ${c.key} overwrote a later write`,
          );
        }
        stamp(before, after);
      }
    }
  }
});

test('K9 pure: applyUndoChecked with no ledger entry for a field skips it (changed), never restores blind', () => {
  const s0 = createSession({ count: 2 });
  const s1 = {
    ...s0,
    rev: 1,
    screens: { ...s0.screens, 1: { ...s0.screens[1], mode: 'advance' } },
  };
  const r = applyUndoChecked(
    s1,
    { rev: 1, before: s0, changes: changeList(s0, s1), type: 'screens' },
    {},
  );
  assert.deepEqual(r.restored, []);
  assert.equal(r.skipped[0].reason, 'changed');
  assert.equal(r.state, s1);
});

test('K9 relay: an undo broadcast says what it restored and skipped; an undo that restores nothing broadcasts nothing', () => {
  const k = clockHost();
  const relay = createRelay({ host: k.host, now: k.now });
  const wallWs = fakeSocket();
  relay.attach(wallWs);
  wallWs.say({
    t: 'hello',
    id: 'S4',
    kind: 'screen',
    setup: k.setup,
    slot: 4,
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
  ipad.say({
    t: 'cmd',
    reqId: 1,
    cmd: {
      type: 'screens',
      target: 4,
      patch: { role: 'day', layers: { precip: true } },
    },
  });
  const id1 = ipad.last('ack').undoId;
  wallWs.say({
    t: 'screen-cmd',
    reqId: 2,
    cmd: { type: 'screens', target: 4, patch: { layers: { precip: false } } },
  });
  ipad.say({ t: 'undo', reqId: 3, undoId: id1 });
  const st = wallWs.last('state');
  assert.equal(st.cause, 'undo');
  assert.deepEqual(
    st.undone.restored.map((x) => x.field).filter((f) => f !== 'scale'),
    ['role'],
  );
  assert.deepEqual(
    st.undone.skipped.map((x) => [x.scope, x.field, x.reason, x.by.kind]),
    [['S4', 'layers.precip', 'changed', 'screen']],
  );
  // Nothing left to restore: no broadcast.
  ipad.say({
    t: 'cmd',
    reqId: 4,
    cmd: { type: 'screens', target: 4, patch: { layers: { precip: true } } },
  });
  const id2 = ipad.last('ack').undoId;
  wallWs.say({
    t: 'screen-cmd',
    reqId: 5,
    cmd: { type: 'screens', target: 4, patch: { layers: { precip: false } } },
  });
  const n = wallWs.all('state').length;
  ipad.say({ t: 'undo', reqId: 6, undoId: id2 });
  assert.deepEqual(ipad.last('ack').restored, []);
  assert.equal(wallWs.all('state').length, n);
});
