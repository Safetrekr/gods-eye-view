// SOC multi-view (phase 10): roles, session reducer, host pairing / lease.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_ORDER,
  defaultRoles,
  wallName,
  screenSummary,
} from './twinScreenRoles.js';
import {
  applyCommand,
  applyUndo,
  createSession,
  needsConfirm,
  previewAll,
} from './twinSession.js';
import {
  CODE_TTL_MS,
  LEASE_MS,
  UNDO_MS,
  SETUP_TTL_MS,
  createSessionHost,
} from './twinSessionHost.js';

test('default roles: first N in order of importance, small counts merge', () => {
  assert.deepEqual(ROLE_ORDER, [
    'site',
    'travelers',
    'incident',
    'weather',
    'day',
    'trips',
  ]);
  assert.deepEqual(
    defaultRoles(1).map((d) => [d.role, d.merged]),
    [['site', ['travelers', 'incident']]],
  );
  assert.deepEqual(defaultRoles(2)[1].merged, ['incident']);
  assert.equal(defaultRoles(6).length, 6);
  assert.equal(defaultRoles(9).length, 6);
  assert.equal(defaultRoles(0).length, 1);
});

test('wall names: first + initial; visitor mode initials only', () => {
  assert.equal(wallName('Emi Sato'), 'Emi S.');
  assert.equal(wallName('Maya Ruiz Lopez'), 'Maya L.');
  assert.equal(wallName('Emi Sato', { visitor: true }), 'ES');
  assert.equal(wallName('Leo'), 'Leo');
  assert.equal(wallName(''), '');
});

test('screen summary for the remote card', () => {
  assert.match(
    screenSummary(2, { role: 'travelers' }, { online: true, ageS: 2 }),
    /^S2 · .+ · ✓ 2 s$/,
  );
  assert.match(
    screenSummary(
      3,
      { role: 'incident', pinned: true },
      { online: false, ageS: 130 },
    ),
    /S3 · .+ · PINNED · offline 2 min/,
  );
});

test('All writes only the named fields and skips pinned screens', () => {
  let s = createSession({ count: 4 });
  s = applyCommand(s, {
    type: 'screens',
    target: 3,
    patch: { pinned: true },
  }).state;
  s = applyCommand(s, {
    type: 'screens',
    target: 2,
    patch: { textScale: 3 },
  }).state;
  const r = applyCommand(s, {
    type: 'screens',
    target: 'all',
    patch: { layers: { paths: false } },
  });
  assert.deepEqual(r.skipped, [3]);
  assert.deepEqual(r.changed, [1, 2, 4]);
  assert.equal(r.state.screens[2].textScale, 3, 'untouched field kept');
  assert.equal(r.state.screens[2].layers.paths, false);
  assert.equal(r.state.screens[3].layers.paths, undefined, 'pinned skipped');
  assert.equal(r.state.screens[1].meta.layers.source, 'all');
  assert.equal(r.state.rev, s.rev + 1);
});

test('Live / Advance and the day are per screen; a pinned board stays Live (R2)', () => {
  let s = createSession({ count: 6 });
  s = applyCommand(s, {
    type: 'screens',
    target: 3,
    patch: { pinned: true },
  }).state;
  const r = applyCommand(s, {
    type: 'screens',
    target: 'all',
    patch: { mode: 'advance', day: 2 },
  });
  assert.deepEqual(r.skipped, [3]);
  assert.equal(r.state.screens[1].mode, 'advance');
  assert.equal(r.state.screens[1].day, 2);
  assert.equal(r.state.screens[3].mode, 'live');
  const one = applyCommand(s, {
    type: 'screens',
    target: 5,
    patch: { role: 'day', day: 3 },
  });
  assert.deepEqual(one.changed, [5]);
  assert.equal(one.state.screens[5].day, 3);
  assert.equal(one.state.screens[1].day, null);
  assert.equal(
    needsConfirm({
      type: 'screens',
      target: 'all',
      patch: { mode: 'advance' },
    }),
    true,
  );
  assert.equal(
    needsConfirm({ type: 'screens', target: 5, patch: { mode: 'advance' } }),
    false,
  );
});

test('undo restores only what that command changed, never a framing (R12)', () => {
  let s = createSession({ count: 3 });
  s = applyCommand(s, {
    type: 'screens',
    target: 2,
    patch: { textScale: 3 },
  }).state;
  const r = applyCommand(s, {
    type: 'screens',
    target: 'all',
    patch: { mode: 'advance', day: 2 },
  });
  const later = applyCommand(r.state, {
    type: 'screens',
    target: 2,
    patch: { layers: { fires: false } },
  }).state;
  const back = applyUndo(later, r.undo);
  assert.equal(back.screens[1].mode, 'live');
  assert.equal(back.screens[2].day, null);
  assert.equal(back.screens[2].layers.fires, false, 'later change kept');
  assert.equal(back.screens[2].textScale, 3);
  assert.equal(back.rev, later.rev + 1);
  const f1 = applyCommand(back, {
    type: 'screens',
    target: 1,
    patch: { frame: { subject: { kind: 'floor', label: 9 }, nonce: 1 } },
  });
  const f2 = applyCommand(f1.state, {
    type: 'screens',
    target: 1,
    patch: { frame: { subject: { kind: 'floor', label: 12 }, nonce: 2 } },
  });
  assert.equal(applyUndo(f2.state, f2.undo).screens[1].frame.nonce, 2);
});

test('an acknowledgement belongs to one report (R4)', () => {
  let s = createSession({ count: 1 });
  s = applyCommand(s, {
    type: 'session',
    patch: { report: { id: 'r1', floor: 9, kind: 'smoke', at: 1000 } },
  }).state;
  s = applyCommand(s, { type: 'session', patch: { incidentAck: 'r1' } }).state;
  assert.equal(s.session.incidentAck, 'r1');
  s = applyCommand(s, {
    type: 'session',
    patch: { report: { id: 'r2', floor: 12, kind: 'smoke', at: 2000 } },
  }).state;
  assert.equal(s.session.incidentAck, null);
  assert.equal(s.session.report.at, 2000, 'the report keeps its own time');
});

test('return to Live resets screens (pins included) but keeps roles and pins', () => {
  let s = createSession({ count: 3 });
  s = applyCommand(s, {
    type: 'screens',
    target: 2,
    patch: { pinned: true, textScale: 3, mode: 'advance', day: 2 },
  }).state;
  s = applyCommand(s, { type: 'returnLive' }).state;
  assert.equal(s.screens[2].mode, 'live');
  assert.equal(s.screens[2].day, null);
  assert.equal(s.screens[2].pinned, true);
  assert.equal(s.screens[2].textScale, 1.75, 'back to the role default');
  assert.equal(s.screens[2].role, 'travelers');
});

test('confirm and preview for wide pushes', () => {
  assert.equal(
    needsConfirm({ type: 'screens', target: 'all', patch: { role: 'site' } }),
    true,
  );
  assert.equal(
    needsConfirm({ type: 'screens', target: 2, patch: { role: 'site' } }),
    false,
  );
  assert.equal(
    needsConfirm({ type: 'session', patch: { siteKey: 'x' } }),
    true,
  );
  assert.equal(
    needsConfirm({ type: 'session', patch: { report: null } }),
    true,
  );
  assert.equal(
    needsConfirm({ type: 'session', patch: { visitor: false } }),
    true,
  );
  assert.equal(
    needsConfirm({ type: 'session', patch: { spotlight: null } }),
    false,
  );
  let s = createSession({ count: 4 });
  s = applyCommand(s, {
    type: 'screens',
    target: 3,
    patch: { pinned: true },
  }).state;
  assert.match(
    previewAll(s, { layers: {} }).text,
    /S1, S2, S4 · S3 pinned, unchanged/,
  );
});

function clockHost() {
  let t = 1_000_000;
  let seed = 0.123;
  const host = createSessionHost({
    now: () => t,
    random: () => {
      seed = (seed * 9301 + 0.49297) % 1;
      return seed;
    },
  });
  const setup = host.setup({ count: 4 }).setup;
  return { host, tick: (ms) => (t += ms), setup };
}

test('pairing: code, single use, expiry, lockout, token rejoin, unpaired notice', () => {
  const { host, tick, setup } = clockHost();
  assert.equal(
    host.hello({ id: 'r1', kind: 'remote', setup }).controller,
    true,
  );
  const a = host.hello({ id: 's1', kind: 'screen' });
  assert.equal(a.type, 'pair-code');
  const ok = host.pair({ by: 'r1', code: a.code, slot: 2 });
  assert.equal(ok.ok, true);
  assert.equal(
    host.pair({ by: 'r1', code: a.code, slot: 2 }).ok,
    false,
    'single use',
  );
  assert.deepEqual(host.hello({ id: 's1', kind: 'screen', token: ok.token }), {
    type: 'paired',
    slot: 2,
    token: ok.token,
  });
  // Another device takes slot 2: the old one is told (R10).
  const b = host.hello({ id: 's9', kind: 'screen' });
  const taken = host.pair({ by: 'r1', code: b.code, slot: 2 });
  assert.deepEqual(taken.unpaired, ['s1']);
  // Expiry.
  const c = host.hello({ id: 's2', kind: 'screen' });
  tick(CODE_TTL_MS + 1);
  host.beat('r1');
  assert.equal(host.pair({ by: 'r1', code: c.code, slot: 3 }).ok, false);
  // Lockout after 5 wrong codes.
  for (let i = 0; i < 5; i++) host.pair({ by: 'r1', code: '0000', slot: 3 });
  const d = host.hello({ id: 's3', kind: 'screen' });
  assert.match(host.pair({ by: 'r1', code: d.code, slot: 3 }).error, /locked/);
});

test('a device id with a token cannot be claimed without it (R1)', () => {
  const { host, setup } = clockHost();
  const r = host.hello({
    id: 'remote-ipad',
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  assert.equal(
    host.hello({ id: 'remote-ipad', kind: 'remote' }).type,
    'denied',
  );
  assert.equal(
    host.hello({ id: 'remote-ipad', kind: 'screen' }).type,
    'denied',
  );
  assert.equal(
    host.hello({ id: 'remote-ipad', kind: 'remote', token: 'wrong' }).type,
    'denied',
  );
  assert.equal(
    host.hello({ id: 'remote-ipad', kind: 'remote', token: r.token }).type,
    'remote',
  );
  assert.equal(host.hello({ id: 'x', kind: 'remote' }).type, 'denied');
  assert.equal(host.hello({ id: 'L', kind: 'launcher' }).type, 'denied');
  assert.equal(
    host.hello({ id: 'L', kind: 'launcher', setup }).type,
    'launcher',
  );
});

test('hand-over: never silent while the controller is online (R14)', () => {
  const { host, tick, setup } = clockHost();
  host.hello({ id: 'r1', kind: 'remote', setup, name: 'Laptop' });
  host.hello({ id: 'r2', kind: 'remote', setup, name: 'iPad' });
  assert.equal(host.isController('r1'), true);
  assert.equal(
    host.command({
      by: 'r2',
      cmd: { type: 'session', patch: { visitor: true } },
    }).ok,
    false,
  );
  assert.equal(host.requestControl('r2').pending, true);
  assert.equal(host.presence().handover.fromName, 'iPad');
  tick(20_000);
  host.beat('r1');
  assert.equal(host.isController('r1'), true, 'no automatic grant');
  host.answerHandover('r1', true);
  assert.equal(host.isController('r2'), true);
  // A controller that drops: the next request passes at once.
  host.gone('r2');
  assert.equal(host.requestControl('r1').granted, true);
  // A lapsed lease passes too.
  tick(LEASE_MS + 1);
  assert.equal(host.requestControl('r2').granted, true);
});

test('commands and 10 s undo through the host', () => {
  const { host, tick, setup } = clockHost();
  host.hello({ id: 'r1', kind: 'remote', setup });
  const r = host.command({
    by: 'r1',
    cmd: { type: 'session', patch: { visitor: true } },
  });
  assert.equal(r.ok, true);
  assert.equal(host.state.session.visitor, true);
  assert.equal(host.undo({ by: 'r1', undoId: r.undoId }).ok, true);
  assert.equal(host.state.session.visitor, false);
  const r2 = host.command({
    by: 'r1',
    cmd: { type: 'session', patch: { visitor: true } },
  });
  tick(UNDO_MS + 1);
  host.beat('r1');
  assert.equal(host.undo({ by: 'r1', undoId: r2.undoId }).ok, false);
});

test('setup: local screens join by slot; remotes need the QR setup or a token', () => {
  const { host, tick, setup } = clockHost();
  assert.equal(host.hello({ id: 'x', kind: 'remote' }).type, 'denied');
  const r = host.hello({ id: 'r1', kind: 'remote', setup });
  assert.equal(r.controller, true);
  const sc = host.hello({ id: 'w5', kind: 'screen', setup, slot: 5 });
  assert.equal(sc.type, 'paired');
  assert.equal(sc.slot, 5);
  assert.ok(host.state.screens[5], 'slot 5 exists');
  tick(SETUP_TTL_MS + 1);
  assert.equal(host.hello({ id: 'r9', kind: 'remote', setup }).type, 'denied');
  assert.equal(
    host.hello({ id: 'r1', kind: 'remote', token: r.token }).type,
    'remote',
  );
});

test('a dropped remote shows as offline at once but can reclaim within the lease', () => {
  const { host, setup } = clockHost();
  const r = host.hello({ id: 'r1', kind: 'remote', setup });
  host.gone('r1');
  assert.equal(host.presence().controller, null);
  assert.equal(host.presence().remotes[0].controller, false);
  host.hello({ id: 'r1', kind: 'remote', token: r.token });
  assert.equal(host.presence().controller, 'r1');
});

test('starting multi-view again starts a fresh wall', () => {
  const { host, setup } = clockHost();
  host.hello({ id: 'r1', kind: 'remote', setup });
  host.command({
    by: 'r1',
    cmd: { type: 'screens', target: 3, patch: { pinned: true } },
  });
  host.command({
    by: 'r1',
    cmd: { type: 'session', patch: { visitor: true } },
  });
  const rev = host.state.rev;
  host.setup({ count: 6, tripId: 'trip-band-dc', siteKey: 'dc' });
  assert.equal(host.state.screens[3].pinned, false);
  assert.equal(host.state.session.visitor, false);
  assert.equal(host.state.session.tripId, 'trip-band-dc');
  assert.ok(host.state.rev > rev, 'rev never goes back');
});

test('a restart keeps the wall: devices rejoin with their tokens (R18)', () => {
  const { host, setup } = clockHost();
  const r = host.hello({ id: 'r1', kind: 'remote', setup });
  const s = host.hello({ id: 'w2', kind: 'screen', setup, slot: 2 });
  host.command({
    by: 'r1',
    cmd: { type: 'session', patch: { visitor: true } },
  });
  const again = createSessionHost({
    restore: JSON.parse(JSON.stringify(host.snapshot())),
  });
  assert.equal(again.state.session.visitor, true);
  assert.equal(
    again.hello({ id: 'w2', kind: 'screen', token: s.token }).slot,
    2,
  );
  assert.equal(
    again.hello({ id: 'r1', kind: 'remote', token: r.token }).type,
    'remote',
  );
});
