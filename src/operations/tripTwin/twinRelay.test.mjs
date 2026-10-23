// Trip Twin SOC relay (phase 10; moved here in Phase CF K1 so `npm test`
// runs it, PHASE-CF-PLAN S-3): hello / setup / command / thumbnails with
// fake sockets, and today's upgrade rule through the real handler — no
// network, no Vite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clientFrame,
  fakeSocket,
  fakeViteRelay as kitViteRelay,
  script,
  serverFrames,
  setupOf,
} from './twinTestKit.mjs';

// The relay keeps its store in TRIP_TWIN_DATA_DIR (K2) and still writes
// the old os.tmpdir() copy. Point both at a fresh folder first, so no test
// can read or write the live wall's session files (cf/06-qa.md N3).
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-relay-test-'));
process.env.TMPDIR = path.join(scratch, 'tmp');
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
// K3: the would-refuse record goes to TRIP_TWIN_AUDIT_DIR; never the live one.
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
fs.mkdirSync(process.env.TMPDIR);
// After the relay's debounced save has run (exit waits for its timer).
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const { createRelay, lanAddresses, twinSyncRelay } =
  await import('../../../server/tripTwin/syncRelay.js');

test('setup → local screen joins → remote controls → all screens get state', () => {
  const relay = createRelay();
  const launcher = fakeSocket();
  relay.attach(launcher);
  launcher.say({ t: 'hello', id: 'L', kind: 'launcher' });
  launcher.say({ t: 'setup', count: 3 });
  const { setup } = launcher.last('setup');
  assert.ok(setup);

  const s2 = fakeSocket();
  relay.attach(s2);
  s2.say({ t: 'hello', id: 'S2', kind: 'screen', setup, slot: 2 });
  assert.equal(s2.last('welcome').type, 'paired');
  assert.equal(s2.last('welcome').slot, 2);

  const remote = fakeSocket();
  relay.attach(remote);
  remote.say({ t: 'hello', id: 'R', kind: 'remote', setup, name: 'iPad' });
  assert.equal(remote.last('welcome').controller, true);

  remote.say({
    t: 'cmd',
    reqId: 1,
    cmd: { type: 'screens', target: 2, patch: { role: 'day' } },
  });
  assert.equal(remote.last('ack').ok, true);
  assert.equal(s2.last('state').state.screens[2].role, 'day');
  assert.deepEqual(s2.last('state').changed, [2]);

  // Snapshots go to remotes only, tagged with the slot.
  s2.say({ t: 'thumb', data: 'data:image/jpeg;base64,AAAA' });
  assert.equal(remote.last('thumb').slot, 2);
  assert.equal(s2.last('thumb'), undefined);
});

test('a screen on another device pairs by code; viewers cannot command', () => {
  const relay = createRelay();
  const launcher = fakeSocket();
  relay.attach(launcher);
  launcher.say({ t: 'setup', count: 2 });
  const { setup } = launcher.last('setup');
  const remote = fakeSocket();
  relay.attach(remote);
  remote.say({ t: 'hello', id: 'R', kind: 'remote', setup });
  const tv = fakeSocket();
  relay.attach(tv);
  tv.say({ t: 'hello', id: 'TV', kind: 'screen' });
  const { code } = tv.last('welcome');
  assert.match(code, /^\d{4}$/);
  remote.say({ t: 'pair', reqId: 7, code, slot: 4 });
  assert.equal(remote.last('pair-result').ok, true);
  assert.equal(tv.last('paired').slot, 4);

  const viewer = fakeSocket();
  relay.attach(viewer);
  viewer.say({ t: 'hello', id: 'R2', kind: 'remote', setup });
  assert.equal(viewer.last('welcome').controller, false);
  viewer.say({
    t: 'cmd',
    reqId: 2,
    cmd: { type: 'session', patch: { visitor: true } },
  });
  assert.equal(viewer.last('ack').ok, false);
});

test('LAN addresses skip loopback and link-local', () => {
  assert.deepEqual(
    lanAddresses({
      lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      en0: [
        { family: 'IPv4', address: '192.168.1.20', internal: false },
        { family: 'IPv6', address: 'fe80::1', internal: false },
      ],
      en5: [{ family: 'IPv4', address: '169.254.3.3', internal: false }],
    }),
    ['192.168.1.20'],
  );
});

test('only this computer can start a setup', () => {
  const relay = createRelay();
  const lan = fakeSocket();
  relay.attach(lan, { isLocal: false });
  lan.say({ t: 'setup', count: 6 });
  assert.equal(lan.last('setup').ok, false);
});

test('a spoofed remote id gets nothing and cannot command (R1)', () => {
  const relay = createRelay();
  const launcher = fakeSocket();
  relay.attach(launcher);
  launcher.say({ t: 'setup', count: 2 });
  const { setup } = launcher.last('setup');
  const remote = fakeSocket();
  relay.attach(remote);
  remote.say({
    t: 'hello',
    id: 'remote-ipad',
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  assert.equal(remote.last('welcome').controller, true);
  // Presence carries no device ids.
  const p = remote.last('welcome').presence;
  assert.equal(JSON.stringify(p).includes('remote-ipad'), false);
  assert.equal(p.youControl, true);
  // An attacker claims the same id without the token.
  const evil = fakeSocket();
  relay.attach(evil, { isLocal: false });
  evil.say({ t: 'hello', id: 'remote-ipad', kind: 'remote' });
  assert.equal(evil.last('welcome').type, 'denied');
  evil.say({
    t: 'cmd',
    reqId: 1,
    cmd: { type: 'session', patch: { report: { floor: 30 } } },
  });
  assert.equal(evil.last('ack'), undefined, 'no answer to a refused socket');
  assert.equal(relay.host.state.session.report, null);
  // A refused socket receives no broadcasts.
  remote.say({
    t: 'cmd',
    reqId: 2,
    cmd: { type: 'session', patch: { visitor: true } },
  });
  assert.equal(evil.last('state'), undefined);
});

test('a screen whose slot is given away is told', () => {
  const relay = createRelay();
  const { a, b } = script(relay, [
    { as: 'launcher', say: { t: 'setup', count: 2 } },
    {
      as: 'a',
      say: (s) => ({
        t: 'hello',
        id: 'A',
        kind: 'screen',
        setup: setupOf(s.launcher),
        slot: 2,
      }),
    },
    {
      as: 'b',
      say: (s) => ({
        t: 'hello',
        id: 'B',
        kind: 'screen',
        setup: setupOf(s.launcher),
        slot: 2,
      }),
    },
  ]);
  assert.ok(a.last('unpaired'), 'old screen told');
  assert.equal(b.last('welcome').slot, 2);
});

test('a wall changes its own layers and display, nothing else (D5)', () => {
  const relay = createRelay();
  const launcher = fakeSocket();
  relay.attach(launcher);
  launcher.say({ t: 'setup', count: 3 });
  const { setup } = launcher.last('setup');
  const s2 = fakeSocket();
  relay.attach(s2);
  s2.say({ t: 'hello', id: 'S2', kind: 'screen', setup, slot: 2 });
  const remote = fakeSocket();
  relay.attach(remote);
  remote.say({ t: 'hello', id: 'R', kind: 'remote', setup, name: 'iPad' });

  // Its own slot, with a remote in control: applied, and the remote hears.
  s2.say({
    t: 'screen-cmd',
    reqId: 1,
    label: 'Rain map on',
    cmd: {
      type: 'screens',
      target: 2,
      patch: { layers: { precip: true, bogus: true }, scale: 'city' },
    },
  });
  assert.equal(s2.last('ack').ok, true);
  const st = remote.last('state');
  assert.equal(st.by, 'screen');
  assert.equal(st.slot, 2);
  assert.equal(st.label, 'Rain map on');
  assert.deepEqual(st.state.screens[2].layers, { precip: true });
  assert.equal(st.state.screens[2].scale, 'city');
  assert.equal(st.state.screens[2].meta.scale.by, 'S2');

  // Another screen, the role, a pin or the session: refused, no broadcast.
  const before = remote.out.length;
  for (const cmd of [
    { type: 'screens', target: 1, patch: { layers: { precip: true } } },
    { type: 'screens', target: 2, patch: { role: 'trips', pinned: true } },
    { type: 'screens', target: 'all', patch: { scale: 'city' } },
    { type: 'session', patch: { visitor: true } },
    { type: 'returnLive' },
  ]) {
    s2.say({ t: 'screen-cmd', reqId: 2, cmd });
    assert.equal(s2.last('ack').ok, false);
  }
  assert.equal(remote.out.length, before);

  // Text size is clamped; a reset of its own slot is allowed.
  s2.say({
    t: 'screen-cmd',
    reqId: 3,
    cmd: { type: 'screens', target: 2, patch: { textScale: 9 } },
  });
  assert.equal(remote.last('state').state.screens[2].textScale, 3.5);
  s2.say({ t: 'screen-cmd', reqId: 4, cmd: { type: 'reset', target: 2 } });
  assert.equal(s2.last('ack').ok, true);
  assert.deepEqual(remote.last('state').state.screens[2].layers, {});

  // A remote cannot use the screen path.
  remote.say({
    t: 'screen-cmd',
    reqId: 5,
    cmd: { type: 'screens', target: 2, patch: { scale: 'building' } },
  });
  assert.equal(remote.last('ack')?.reqId, undefined);
});

// ---- Today's upgrade rule, through the real Vite plugin handler --------
// Pinned before CF-1 changes it (K3 report mode, K12 enforce), so a change
// to the accept cases shows up as a failing test (cf/06-qa.md QA-2, QA-3).

/** The relay plugin wired to a fake Vite dev server (kit, K2). */
const fakeViteRelay = () => kitViteRelay(twinSyncRelay());

const tick = () => new Promise((r) => setTimeout(r, 20));

test('upgrade today: a same-origin page is accepted, another origin is refused', () => {
  const v = fakeViteRelay();
  try {
    assert.equal(v.upgrade({}).verdict, 'accepted');
    assert.equal(
      v.upgrade({ host: '[::1]:4173', origin: 'http://[::1]:4173' }).verdict,
      'accepted',
    );
    assert.equal(
      v.upgrade({ host: 'localhost:4173', origin: 'http://evil.example' })
        .verdict,
      'refused',
    );
    // Today a rebinding pair (Host and Origin both foreign) still passes:
    // K3 records it as a would-refuse (report mode); K12 refuses it.
    assert.equal(
      v.upgrade({
        host: 'evil.example:4173',
        origin: 'http://evil.example:4173',
      }).verdict,
      'accepted',
    );
  } finally {
    v.close();
  }
});

test('upgrade today: no Origin header is accepted; other paths are left to Vite', () => {
  const v = fakeViteRelay();
  try {
    assert.equal(v.upgrade({ origin: null }).verdict, 'accepted');
    assert.equal(v.upgrade({ url: '/@vite/client' }).verdict, 'untouched');
  } finally {
    v.close();
  }
});

test('upgrade today: only a loopback peer can start a setup through the real handler', async () => {
  const v = fakeViteRelay();
  try {
    const lan = v.upgrade({ remoteAddress: '192.168.1.40' });
    lan.socket.emit('data', clientFrame({ t: 'setup', count: 2 }));
    const local = v.upgrade({ remoteAddress: '::1' });
    local.socket.emit('data', clientFrame({ t: 'setup', count: 2 }));
    await tick();
    const said = (u) => serverFrames(u.socket.written).find((m) => m.t);
    assert.equal(said(lan).ok, false);
    assert.equal(said(local).ok, true);
    assert.match(said(local).setup, /^[0-9a-z]{24}$/);
  } finally {
    v.close();
  }
});
