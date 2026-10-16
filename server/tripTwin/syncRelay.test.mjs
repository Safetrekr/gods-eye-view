// Trip Twin SOC relay (phase 10): hello / setup / command / thumbnails with
// fake sockets — no network, no Vite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRelay, lanAddresses } from './syncRelay.js';

function fakeSocket() {
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.out = [];
  ws.send = (s) => ws.out.push(JSON.parse(s));
  ws.say = (m) => ws.emit('message', JSON.stringify(m));
  ws.last = (t) => [...ws.out].reverse().find((m) => m.t === t);
  return ws;
}

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
  const launcher = fakeSocket();
  relay.attach(launcher);
  launcher.say({ t: 'setup', count: 2 });
  const { setup } = launcher.last('setup');
  const a = fakeSocket();
  relay.attach(a);
  a.say({ t: 'hello', id: 'A', kind: 'screen', setup, slot: 2 });
  const b = fakeSocket();
  relay.attach(b);
  b.say({ t: 'hello', id: 'B', kind: 'screen', setup, slot: 2 });
  assert.ok(a.last('unpaired'), 'old screen told');
  assert.equal(b.last('welcome').slot, 2);
});
