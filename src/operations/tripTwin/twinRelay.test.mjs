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
import { layoutValue } from './twinScreenRoles.js';

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
  // CF (K5 attribution): the wall's actor, via its keyboard; a CMD state,
  // so no message changes shape; the page's label is never broadcast.
  assert.equal(st.cause, 'cmd');
  assert.equal(st.by.kind, 'screen');
  assert.equal(st.by.slot, 2);
  assert.equal(st.by.name, 'S2');
  assert.equal(st.by.via, 'keyboard');
  assert.match(st.by.ref, /^D\d+$/);
  assert.equal('label' in st, false);
  assert.equal('slot' in st, false);
  assert.deepEqual(st.state.screens[2].layers, { precip: true });
  assert.equal(st.state.screens[2].scale, 'city');
  assert.equal(st.state.screens[2].meta.scale.by, st.by.ref);

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
    assert.equal(s2.last('ack').code, 'VALIDATION_COMMAND');
  }
  assert.equal(remote.out.length, before);

  // Text size is clamped; a reset of its own slot is allowed.
  s2.say({
    t: 'screen-cmd',
    reqId: 3,
    cmd: { type: 'screens', target: 2, patch: { textScale: 9 } },
  });
  // A wall's text size stays where the type rule holds (screens F12).
  assert.equal(remote.last('state').state.screens[2].textScale, 2.25);
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

test("a wall's menu: layout from the allowlist; pinned, visitor and safety layers refused (screens/05-S1-PLAN)", () => {
  const relay = createRelay();
  const launcher = fakeSocket();
  relay.attach(launcher);
  launcher.say({ t: 'setup', count: 2 });
  const { setup } = launcher.last('setup');
  const s1 = fakeSocket();
  relay.attach(s1);
  s1.say({ t: 'hello', id: 'S1', kind: 'screen', setup, slot: 1 });
  const s2 = fakeSocket();
  relay.attach(s2);
  s2.say({ t: 'hello', id: 'S2', kind: 'screen', setup, slot: 2 });
  const remote = fakeSocket();
  relay.attach(remote);
  remote.say({ t: 'hello', id: 'R', kind: 'remote', setup, name: 'iPad' });
  let req = 0;
  const wall = (sock, slot, patch) => {
    sock.say({
      t: 'screen-cmd',
      reqId: ++req,
      cmd: { type: 'screens', target: slot, patch },
    });
    return sock.last('ack');
  };
  const cmd = (c) => {
    remote.say({ t: 'cmd', reqId: ++req, cmd: c });
    return remote.last('ack');
  };
  const screen = (n) => remote.last('state').state.screens[n];

  // Layout: enums kept, junk and other roles' or locked cards dropped.
  assert.equal(
    wall(s1, 1, {
      layout: { cards: 'map', width: 'huge', off: ['hotel', 'summary', 9] },
    }).ok,
    true,
  );
  assert.deepEqual(screen(1).layout, { cards: 'map', off: ['hotel'] });
  // S2 People is in the new frame (55-S2-PLAN): its cards are locked
  // (70-S2-FIX-LIST G15) — layout is accepted, no card is hidden.
  assert.equal(
    wall(s2, 2, { layout: { width: 'wide', off: ['summary', 'people'] } }).ok,
    true,
  );
  assert.deepEqual(screen(2).layout, { width: 'wide', off: [] });
  // A merge, not a replace: width joins what the wall already set.
  wall(s1, 1, { layout: { width: 'wide' } });
  assert.deepEqual(screen(1).layout, {
    cards: 'map',
    off: ['hotel'],
    width: 'wide',
  });
  // Reset brings the role's default layout back, and keeps Advance: the
  // mode is the remote's (F19).
  cmd({ type: 'screens', target: 1, patch: { mode: 'advance', day: 2 } });
  s1.say({ t: 'screen-cmd', reqId: ++req, cmd: { type: 'reset', target: 1 } });
  assert.deepEqual(screen(1).layout, {});
  assert.equal(screen(1).mode, 'advance');
  assert.equal(screen(1).day, 2);

  // Safety layers stay on at the wall while a report is open; others not.
  assert.equal(
    cmd({ type: 'session', patch: { report: { floor: 9 } } }).ok,
    true,
  );
  const refused = wall(s1, 1, { layers: { fires: false } });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'SAFETY_LAYER');
  assert.equal(wall(s1, 1, { layers: { grid: false } }).ok, true);

  // A pinned wall keeps what the remote set.
  assert.equal(
    cmd({ type: 'screens', target: 1, patch: { pinned: true } }).ok,
    true,
  );
  const pin = wall(s1, 1, { textScale: 2 });
  assert.equal(pin.ok, false);
  assert.equal(pin.code, 'PINNED');
  // The remote's "every wall view only" (Q2): nothing saved at a wall;
  // on again, the wall saves.
  cmd({ type: 'session', patch: { wallControls: false } });
  const vo = wall(s2, 2, { textScale: 2 });
  assert.equal(vo.ok, false);
  assert.equal(vo.code, 'VIEW_ONLY');
  cmd({ type: 'session', patch: { wallControls: true } });
  assert.equal(wall(s2, 2, { textScale: 2 }).ok, true);
  // Visitor mode: read-only at every wall.
  cmd({ type: 'session', patch: { visitor: true } });
  const vis = wall(s2, 2, { textScale: 2 });
  assert.equal(vis.ok, false);
  assert.equal(vis.code, 'VISITOR');
});

test('S3 board: Map only needs a map — refused at the wall; Columns kept (S3 reviews)', () => {
  const relay = createRelay();
  const launcher = fakeSocket();
  relay.attach(launcher);
  launcher.say({ t: 'setup', count: 3 });
  const { setup } = launcher.last('setup');
  const s3 = fakeSocket();
  relay.attach(s3);
  s3.say({ t: 'hello', id: 'S3', kind: 'screen', setup, slot: 3 });
  const remote = fakeSocket();
  relay.attach(remote);
  remote.say({ t: 'hello', id: 'R', kind: 'remote', setup, name: 'iPad' });
  let req = 0;
  const wall = (patch) => {
    s3.say({
      t: 'screen-cmd',
      reqId: ++req,
      cmd: { type: 'screens', target: 3, patch },
    });
    return s3.last('ack');
  };
  const screen = () => remote.last('state').state.screens[3];
  assert.equal(wall({ layout: { cards: 'map' } }).ok, false);
  assert.equal(wall({ layout: { cards: 'map', width: 'wide' } }).ok, true);
  assert.equal(screen().role, 'incident');
  assert.deepEqual(screen().layout, { width: 'wide' });
  assert.equal(
    layoutValue({ role: 'incident', layout: { cards: 'map' } }).cards,
    'shown',
  );
});

test('S4: the demo storm keeps alert areas on at a wall (A5-S4-PLAN)', () => {
  const relay = createRelay();
  const launcher = fakeSocket();
  relay.attach(launcher);
  launcher.say({ t: 'setup', count: 4 });
  const { setup } = launcher.last('setup');
  const s4 = fakeSocket();
  relay.attach(s4);
  s4.say({ t: 'hello', id: 'S4', kind: 'screen', setup, slot: 4 });
  const remote = fakeSocket();
  relay.attach(remote);
  remote.say({ t: 'hello', id: 'R', kind: 'remote', setup, name: 'iPad' });
  let req = 0;
  const wall = (patch) => {
    s4.say({
      t: 'screen-cmd',
      reqId: ++req,
      cmd: { type: 'screens', target: 4, patch },
    });
    return s4.last('ack');
  };
  // Calm: the wall may turn them off.
  assert.equal(wall({ layers: { alertAreas: false } }).ok, true);
  assert.equal(wall({ layers: { alertAreas: true } }).ok, true);
  remote.say({
    t: 'cmd',
    reqId: ++req,
    cmd: { type: 'session', patch: { simStorm: Date.now() } },
  });
  const r = wall({ layers: { alertAreas: false } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'SAFETY_LAYER');
  // Heat is not held by a storm (only a fire or smoke warning, at the wall).
  assert.equal(wall({ layers: { fires: false } }).ok, true);
  // Weather layers stay free at the host; S4's hold is the wall's.
  assert.equal(wall({ layers: { lightning: false } }).ok, true);
});

test("CF: a wall's keyboard changes share the per-device command limit (S-16) and carry no actor field from the page", () => {
  const relay = createRelay();
  const launcher = fakeSocket();
  relay.attach(launcher);
  launcher.say({ t: 'setup', count: 3 });
  const { setup } = launcher.last('setup');
  const s3 = fakeSocket();
  relay.attach(s3);
  s3.say({ t: 'hello', id: 'S3', kind: 'screen', setup, slot: 3 });
  // An actor claimed inside the command or beside it is never read.
  s3.say({
    t: 'screen-cmd',
    reqId: 1,
    by: 'D0',
    via: 'voice',
    cmd: {
      type: 'screens',
      target: 3,
      by: 'D0',
      patch: { layers: { lightning: true } },
    },
  });
  const st = launcher.last('state') || s3.last('state');
  assert.equal(st.by.kind, 'screen');
  assert.equal(st.by.via, 'keyboard');
  // Burst 20, then RATE_LIMITED with retryAfterMs; nothing past it applies.
  const acks = [];
  for (let i = 0; i < 40; i++) {
    s3.say({
      t: 'screen-cmd',
      reqId: 100 + i,
      cmd: { type: 'screens', target: 3, patch: { textScale: 1 + (i % 2) } },
    });
    acks.push(s3.last('ack'));
  }
  const refused = acks.filter((a) => a.code === 'RATE_LIMITED');
  assert.ok(refused.length >= 15, `${refused.length} refused`);
  assert.ok(refused.every((a) => a.ok === false && a.retryAfterMs > 0));
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
    // K7 (SEC-4): 256 bits from node:crypto, base64url.
    assert.match(said(local).setup, /^[A-Za-z0-9_-]{43}$/);
  } finally {
    v.close();
  }
});
