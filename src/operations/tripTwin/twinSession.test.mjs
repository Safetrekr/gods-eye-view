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
  HANDOVER_AUTO_MS,
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
  assert.equal(
    screenSummary(2, { role: 'travelers' }, { online: true, ageS: 2 }),
    'S2 · TRAVELERS · ✓ 2 s',
  );
  assert.match(
    screenSummary(
      3,
      { role: 'incident', pinned: true },
      { online: false, ageS: 130 },
    ),
    /S3 · INCIDENT & ATTENTION · PINNED · offline 2 min/,
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

test('one screen at a time: a single target changes only that screen', () => {
  const s = createSession({ count: 6 });
  const r = applyCommand(s, {
    type: 'screens',
    target: 4,
    patch: { role: 'day', layers: { fires: false } },
  });
  assert.deepEqual(r.changed, [4]);
  assert.equal(r.state.screens[4].role, 'day');
  assert.equal(r.state.screens[4].meta.role.source, 'override');
  assert.deepEqual(r.state.screens[1], s.screens[1]);
});

test('undo restores the touched screens and the session as a new rev', () => {
  const s = createSession({ count: 3 });
  const r = applyCommand(s, {
    type: 'session',
    patch: { mode: 'advance', day: 2 },
  });
  const r2 = applyCommand(r.state, {
    type: 'screens',
    target: 'all',
    patch: { role: 'day' },
  });
  const back = applyUndo(r2.state, r2.undo);
  assert.equal(back.screens[1].role, 'site');
  assert.equal(back.session.mode, 'advance', 'only that push is undone');
  assert.equal(back.rev, r2.state.rev + 1);
});

test('a new reported floor needs a fresh acknowledgement', () => {
  let s = createSession({ count: 1 });
  s = applyCommand(s, { type: 'session', patch: { incidentAck: true } }).state;
  s = applyCommand(s, {
    type: 'session',
    patch: { report: { floor: 9, kind: 'smoke' } },
  }).state;
  assert.equal(s.session.incidentAck, false);
});

test('return to Live resets screens but keeps roles and pins', () => {
  let s = createSession({ count: 3 });
  s = applyCommand(s, {
    type: 'session',
    patch: { mode: 'advance', day: 2 },
  }).state;
  s = applyCommand(s, {
    type: 'screens',
    target: 2,
    patch: { pinned: true, textScale: 3 },
  }).state;
  s = applyCommand(s, { type: 'returnLive' }).state;
  assert.equal(s.session.mode, 'live');
  assert.equal(s.session.day, null);
  assert.equal(s.screens[2].pinned, true);
  assert.equal(s.screens[2].textScale, 1.75, 'back to the role default');
  assert.equal(s.screens[2].role, 'travelers');
});

test('confirm and preview for All pushes', () => {
  assert.equal(
    needsConfirm({ type: 'screens', target: 'all', patch: { role: 'site' } }),
    true,
  );
  assert.equal(
    needsConfirm({ type: 'screens', target: 2, patch: { role: 'site' } }),
    false,
  );
  assert.equal(
    needsConfirm({ type: 'session', patch: { mode: 'advance' } }),
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
    /S1, S2, S4 \(S3 pinned, skipped\)/,
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

test('pairing: code, single use, expiry, lockout, token rejoin', () => {
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
  // Token rejoin after a reload.
  assert.deepEqual(host.hello({ id: 's1', kind: 'screen', token: ok.token }), {
    type: 'paired',
    slot: 2,
    token: ok.token,
  });
  // Expiry.
  const b = host.hello({ id: 's2', kind: 'screen' });
  tick(CODE_TTL_MS + 1);
  host.beat('r1');
  assert.equal(host.pair({ by: 'r1', code: b.code, slot: 3 }).ok, false);
  // Lockout after 5 wrong codes.
  for (let i = 0; i < 5; i++) host.pair({ by: 'r1', code: '0000', slot: 3 });
  const c = host.hello({ id: 's3', kind: 'screen' });
  assert.match(host.pair({ by: 'r1', code: c.code, slot: 3 }).error, /locked/);
});

test('one controller: viewers cannot command; hand-over and stale lease', () => {
  const { host, tick, setup } = clockHost();
  host.hello({ id: 'r1', kind: 'remote', setup });
  assert.equal(
    host.hello({ id: 'r2', kind: 'remote', setup }).controller,
    false,
  );
  assert.equal(
    host.command({
      by: 'r2',
      cmd: { type: 'session', patch: { visitor: true } },
    }).ok,
    false,
  );
  // Request, then the controller accepts.
  assert.equal(host.requestControl('r2').pending, true);
  host.answerHandover('r1', true);
  assert.equal(host.isController('r2'), true);
  // Unanswered request is granted after 15 s.
  host.requestControl('r1');
  tick(HANDOVER_AUTO_MS);
  host.beat('r2');
  assert.equal(host.isController('r1'), true);
  // A stale lease passes at once.
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
  // After the setup expires a remote rejoins with its token, not the QR.
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
