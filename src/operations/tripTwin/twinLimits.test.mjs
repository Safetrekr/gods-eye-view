// Trip Twin relay: crypto ids, no state before pairing, loopback-aware
// limits (Phase CF K7; PHASE-CF-PLAN S-7, S-15, S-16, §6.3 K7; review
// cf/01-reasoning.md B4, cf/02-security.md S5, S6; cf/01-security.md
// SEC-4, SEC-7, SEC-8; cf/06-qa.md QA-3 T3.7, T3.10, T3.11, T3.13–T3.16;
// cf/07-reasoning.md ET-7 R6a, R6b, R6c).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import {
  clientFrame,
  fakeBrowser,
  fakeSocket,
  fakeTimers,
  fakeViteRelay,
  liveTwinServer,
  serverFrames,
  settle,
} from './twinTestKit.mjs';
import {
  CODES_PER_IP,
  CODES_TOTAL,
  CODE_TTL_MS,
  MAX_TRIES,
  createSessionHost,
  randomSource,
} from './twinSessionHost.js';
import { CLOSE, CODE, DENY, MSG_TYPES, PROTO } from './twinProtocol.js';
import { connectSync } from './twinSync.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-limits-test-'));
process.env.TMPDIR = path.join(scratch, 'tmp');
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
fs.mkdirSync(process.env.TMPDIR);
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const { createRelay, twinSyncRelay } =
  await import('../../../server/tripTwin/syncRelay.js');
const { LIMITS, createLimiter, socketBudget, thumbOk } =
  await import('../../../server/tripTwin/twinLimits.js');
const { WIRING_ENFORCED, wiringFindings } =
  await import('../../../scripts/test-trip-twin.mjs');

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const LAN = '192.168.1.20';

/**
 * A relay on a fake clock (host, relay and the hello deadline share it),
 * with sockets from this computer or the LAN, and a setup link for six.
 */
function rig({ host: hostOpts = {}, limits, audit = null } = {}) {
  const timers = fakeTimers();
  const host = createSessionHost({ now: timers.now, ...hostOpts });
  const relay = createRelay({
    host,
    now: timers.now,
    timers: { set: timers.setTimeout, clear: timers.clearTimeout },
    ...(limits ? { limits } : {}),
    audit,
  });
  const sock = ({ local = true, peer = null } = {}) => {
    const ws = fakeSocket();
    ws.attached = relay.attach(ws, {
      isLocal: local,
      peer: peer ?? (local ? '127.0.0.1' : LAN),
    });
    return ws;
  };
  const setup = host.setup({ count: 6 }).setup;
  const wall = (n, extra = {}) => {
    const ws = sock();
    ws.say({
      t: 'hello',
      id: `screen-k7-${n}`,
      kind: 'screen',
      setup,
      slot: n,
      ...extra,
    });
    return ws;
  };
  const ipad = () => {
    const ws = sock({ local: false });
    ws.say({
      t: 'hello',
      id: 'remote-k7-ipad',
      kind: 'remote',
      setup,
      name: 'iPad',
    });
    return ws;
  };
  return { timers, host, relay, sock, setup, wall, ipad };
}

/** A seeded random in [0, 1) (fuzz). */
function seeded(seed = 0.4242) {
  let s = seed;
  return () => {
    s = (s * 9301 + 0.49297) % 1;
    return s;
  };
}

test('K7 T3.7 SEC-4: tokens are 256-bit base64url, codes 4 digits, undo ids 128-bit hex, all from the CSPRNG (getRandomValues); a constant Math.random changes none of them (T3.16)', () => {
  const real = Math.random;
  Math.random = () => 0.5;
  try {
    const src = randomSource();
    const tokens = new Set();
    for (let i = 0; i < 10_000; i += 1) {
      const t = src.token();
      assert.match(t, /^[A-Za-z0-9_-]{43}$/);
      tokens.add(t);
    }
    assert.equal(tokens.size, 10_000, '10,000 tokens, all different');
    const codes = new Set();
    for (let i = 0; i < 2000; i += 1) {
      const c = src.code();
      assert.ok(Number.isInteger(c) && c >= 0 && c <= 9999);
      codes.add(c);
    }
    assert.ok(codes.size > 1500, 'codes spread over 0000–9999');
    // Through the host and the relay: what a wall and a remote are given.
    const r = rig();
    const s1 = r.wall(1);
    const s2 = r.wall(2);
    const ip = r.ipad();
    assert.match(r.setup, /^[A-Za-z0-9_-]{43}$/, 'the setup link too');
    for (const w of [s1, s2, ip])
      assert.match(w.last('welcome').token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(s1.last('welcome').token, s2.last('welcome').token);
    const tv = r.sock();
    tv.say({ t: 'hello', id: 'screen-k7-tv', kind: 'screen' });
    assert.match(tv.last('welcome').code, /^\d{4}$/);
    ip.say({ t: 'cmd', reqId: 1, cmd: { type: 'returnLive' } });
    assert.match(ip.last('ack').undoId, /^[0-9a-f]{32}$/);
  } finally {
    Math.random = real;
  }
});

test('K7 R6c: tokens issued before K7 (24 characters) stay valid: a wall and a remote from an old store rejoin with them and keep them (nobody re-pairs)', () => {
  const old = {
    screen: 'k5era0wall0token0abcdefg',
    remote: 'k5era0ipad0token0hijklmn',
  };
  const host = createSessionHost({
    restore: {
      devices: [
        [
          'screen-old-1',
          { kind: 'screen', slot: 1, token: old.screen, ref: 'D1' },
        ],
        [
          'remote-old-ipad',
          { kind: 'remote', token: old.remote, name: 'iPad', ref: 'D2' },
        ],
      ],
      refs: {
        D1: { kind: 'screen', name: 'S1', slot: 1 },
        D2: { kind: 'remote', name: 'iPad', slot: null },
      },
      nextRef: 3,
    },
  });
  const relay = createRelay({ host });
  const wall = fakeSocket();
  relay.attach(wall);
  wall.say({
    t: 'hello',
    id: 'screen-old-1',
    kind: 'screen',
    slot: 1,
    token: old.screen,
  });
  assert.equal(wall.last('welcome').type, 'paired');
  assert.equal(wall.last('welcome').token, old.screen, 'the old token kept');
  const ipad = fakeSocket();
  relay.attach(ipad, { isLocal: false, peer: LAN });
  ipad.say({
    t: 'hello',
    id: 'remote-old-ipad',
    kind: 'remote',
    token: old.remote,
    name: 'iPad',
  });
  assert.equal(ipad.last('welcome').type, 'remote');
  assert.equal(ipad.last('welcome').token, old.remote);
  assert.equal(host.tokensIssued, 0, 'no new token minted');
});

test('K7 SEC-7 T3.10: a pending screen hears only its code, then `paired`, then the state: nothing across a command, a thumbnail, an identify, a presence tick or another pairing; it is not saved', () => {
  const r = rig();
  const s1 = r.wall(1);
  const ip = r.ipad();
  const tv = r.sock({ local: false, peer: '192.168.1.30' });
  tv.say({ t: 'hello', id: 'screen-k7-tv', kind: 'screen' });
  const other = r.sock();
  other.say({ t: 'hello', id: 'screen-k7-other', kind: 'screen' });
  // Everything that reaches the wall today.
  ip.say({
    t: 'cmd',
    reqId: 1,
    cmd: { type: 'screens', target: 1, patch: { role: 'day' } },
  });
  s1.say({ t: 'thumb', data: JPEG });
  s1.say({ t: 'local', on: true, text: 'picked' });
  ip.say({ t: 'identify' });
  r.relay.presenceTick();
  ip.say({ t: 'request-control' });
  ip.say({ t: 'pair', reqId: 2, code: other.last('welcome').code, slot: 3 });
  assert.equal(ip.last('pair-result').ok, true);
  // What a pending screen says itself is dropped.
  for (const m of [
    { t: 'hb' },
    { t: 'thumb', data: JPEG },
    { t: 'local', on: true, text: 'x' },
    { t: 'cmd', reqId: 9, cmd: { type: 'returnLive' } },
    { t: 'identify' },
  ])
    tv.say(m);
  assert.deepEqual(
    tv.out.map((m) => m.t),
    ['welcome'],
  );
  assert.deepEqual(Object.keys(tv.out[0]).sort(), [
    'code',
    'proto',
    't',
    'ttlMs',
    'type',
  ]);
  assert.equal(tv.out[0].ttlMs, CODE_TTL_MS);
  assert.ok(
    !JSON.stringify(r.host.snapshot()).includes('screen-k7-tv'),
    'a screen waiting for a code is not saved',
  );
  assert.equal(r.relay.health().devices.screensWaiting, 1);
  // Paired: `paired`, then the state in the same breath.
  ip.say({ t: 'pair', reqId: 3, code: tv.out[0].code, slot: 4 });
  assert.deepEqual(
    tv.out.map((m) => m.t),
    ['welcome', 'paired', 'state'],
  );
  assert.equal(tv.out[2].state.screens[4] != null, true);
  assert.ok(JSON.stringify(r.host.snapshot()).includes('screen-k7-tv'));
  // From now on it is on the wall: identify and broadcasts reach it.
  ip.say({ t: 'identify' });
  assert.equal(tv.last('identify')?.t, 'identify');
});

test('K7 SEC-7: a launcher gets presence only: no state in its welcome or after a command, a pairing or a setup', () => {
  const r = rig();
  const link = r.sock();
  link.say({
    t: 'hello',
    id: 'launcher-k7-link',
    kind: 'launcher',
    setup: r.setup,
  });
  assert.equal(link.last('welcome').type, 'launcher');
  assert.equal(link.last('welcome').state, undefined);
  assert.ok(link.last('welcome').presence);
  // The launcher's own start: a refused hello, then setup.
  const start = r.sock();
  start.say({ t: 'hello', id: 'launcher-k7', kind: 'launcher' });
  start.say({ t: 'setup', count: 2 });
  assert.equal(start.last('setup').ok, true);
  const setup = start.last('setup').setup;
  const s1 = r.sock();
  s1.say({ t: 'hello', id: 'screen-k7-1', kind: 'screen', setup, slot: 1 });
  const ip = r.sock({ local: false });
  ip.say({ t: 'hello', id: 'remote-k7', kind: 'remote', setup, name: 'iPad' });
  ip.say({ t: 'cmd', reqId: 1, cmd: { type: 'returnLive' } });
  assert.equal(ip.last('ack').ok, true);
  for (const l of [link, start]) {
    assert.equal(l.all('state').length, 0, 'never state');
    assert.ok(l.all('presence').length >= 2);
    assert.equal(l.last('presence').presence.screens[1].online, true);
  }
});

test('K7 T3.11 SEC-8: 10,001 screen hellos (the LAN and this computer) leave a command acked in under 100 ms; codes stay at 20 or fewer; nothing is saved for them; the wrong-code lock still works', async () => {
  const r = rig();
  const s1 = r.wall(1);
  const ip = r.ipad();
  const devicesBefore = r.host.snapshot().devices.length;
  const answered = {};
  const t0 = performance.now();
  for (let i = 0; i < 10_001; i += 1) {
    const local = i % 2 === 0;
    const ws = r.sock({
      local,
      peer: local ? '127.0.0.1' : `192.168.1.${100 + (i % 50)}`,
    });
    ws.say({ t: 'hello', id: `screen-flood-${i}`, kind: 'screen' });
    const w = ws.last('welcome');
    answered[w ? (w.type === 'denied' ? w.code : w.type) : 'none'] =
      (answered[w ? (w.type === 'denied' ? w.code : w.type) : 'none'] || 0) + 1;
    if (i % 3 === 0) ws.close();
    if (i % 1000 === 0) await r.timers.run(250);
  }
  const floodMs = performance.now() - t0;
  // Every hello is answered at once (a code, or BUSY): never a hang.
  assert.equal(answered.none, undefined, JSON.stringify(answered));
  assert.equal(
    (answered['pair-code'] || 0) + (answered.BUSY || 0),
    10_001,
    JSON.stringify(answered),
  );
  // The oldest waiting sockets gave way; the wall and the iPad did not.
  assert.ok(r.relay.health().counters.limits['unauth-evicted'] > 0);
  assert.equal(s1.readyState, 1);
  assert.equal(ip.readyState, 1);
  assert.ok(r.host.codesOut() <= CODES_TOTAL, `codes ${r.host.codesOut()}`);
  const c = r.relay.connections();
  assert.ok(c.length <= LIMITS.socketsTotal, `sockets ${c.length}`);
  assert.ok(
    c.filter((x) => x.state !== 'paired').length <= LIMITS.unauthSockets,
  );
  assert.equal(r.host.snapshot().devices.length, devicesBefore);
  ip.say({ t: 'hb' });
  const t1 = performance.now();
  ip.say({
    t: 'cmd',
    reqId: 7,
    cmd: { type: 'screens', target: 1, patch: { role: 'day' } },
  });
  const ackMs = performance.now() - t1;
  assert.equal(ip.last('ack').ok, true);
  assert.ok(ackMs < 100, `ack ${ackMs.toFixed(1)} ms`);
  assert.equal(s1.last('state').cause, 'cmd', 'the wall still hears it');
  // The existing wrong-code lock (twinSessionHost.js) still holds.
  for (let i = 0; i < MAX_TRIES; i += 1)
    ip.say({ t: 'pair', reqId: 20 + i, code: '99999', slot: 2 });
  ip.say({ t: 'pair', reqId: 30, code: '99999', slot: 2 });
  assert.match(ip.last('pair-result').error, /^Pairing paused until/);
  assert.ok(floodMs < 20_000, `flood took ${floodMs.toFixed(0)} ms`);
});

test('K7 T3.15 SUP-5: an expired code is purged and the waiting wall is sent a new one by the sweep; the old code no longer pairs, the new one does', async () => {
  const r = rig();
  const ip = r.ipad();
  const tv = r.sock();
  tv.say({ t: 'hello', id: 'screen-k7-tv', kind: 'screen' });
  const first = tv.last('welcome').code;
  assert.equal(r.host.codesOut(), 1);
  await r.timers.run(CODE_TTL_MS - 1000);
  r.relay.presenceTick();
  assert.equal(tv.all('welcome').length, 1, 'still valid: not re-sent');
  await r.timers.run(2000);
  // Another device's hello purges it too; the sweep still re-issues.
  r.sock().say({ t: 'hello', id: 'screen-k7-x', kind: 'screen' });
  r.relay.presenceTick();
  const again = tv.all('welcome');
  assert.equal(again.length, 2, 'a new code was pushed');
  assert.equal(again[1].type, 'pair-code');
  assert.equal(again[1].ttlMs, CODE_TTL_MS);
  assert.equal(tv.out.filter((m) => m.t !== 'welcome').length, 0);
  ip.say({ t: 'request-control' });
  if (first !== again[1].code) {
    ip.say({ t: 'pair', reqId: 1, code: first, slot: 2 });
    assert.equal(ip.last('pair-result').ok, false, 'the old code is gone');
  }
  ip.say({ t: 'pair', reqId: 2, code: again[1].code, slot: 2 });
  assert.equal(ip.last('pair-result').ok, true);
  assert.equal(tv.last('paired').slot, 2);
});

test('K7 S-16 B4: codes cap at 20 in all and 6 per LAN address, this computer exempt from the per-address cap; the next is BUSY with retryAfterMs; a code that cannot be drawn is BUSY too, never a spin', () => {
  const r = rig();
  const lan = [];
  for (let i = 0; i < CODES_PER_IP + 1; i += 1) {
    const ws = r.sock({ local: false, peer: '192.168.1.77' });
    ws.say({ t: 'hello', id: `screen-lan-${i}`, kind: 'screen' });
    lan.push(ws.last('welcome'));
  }
  assert.deepEqual(
    lan.map((w) => w.type),
    [...Array(CODES_PER_IP).fill('pair-code'), 'denied'],
  );
  assert.equal(lan.at(-1).code, DENY.BUSY);
  assert.ok(lan.at(-1).retryAfterMs >= 1000);
  assert.match(lan.at(-1).error, /Too many screens are waiting to pair/);
  // This computer: past 6 (it holds the Mac Studio's walls), up to 20 in
  // all (the host's cap; the relay keeps at most 16 sockets waiting).
  const host = createSessionHost({ now: () => 5_000_000 });
  const here = [];
  for (let i = 0; i < CODES_TOTAL + 1; i += 1)
    here.push(
      host.hello({
        id: `screen-here-${i}`,
        kind: 'screen',
        local: true,
        ip: '127.0.0.1',
      }),
    );
  assert.equal(
    here.filter((x) => x.type === 'pair-code').length,
    CODES_TOTAL,
    'loopback past 6, up to 20',
  );
  assert.equal(here.at(-1).code, DENY.BUSY);
  assert.equal(here.at(-1).limit, 'codes-total');
  assert.equal(host.codesOut(), CODES_TOTAL);
  assert.equal(host.snapshot().devices.length, 0, 'none of them saved');
  // Through the relay: 16 sockets waiting at most; the oldest gives way.
  for (let i = 0; i < 20; i += 1)
    r.sock().say({ t: 'hello', id: `screen-relay-${i}`, kind: 'screen' });
  assert.ok(r.relay.health().devices.screensWaiting <= LIMITS.unauthSockets);
  // A random source that always draws the same code: BUSY, not a hang.
  const stuck = rig({ host: { random: () => 0.1234 } });
  const a = stuck.sock();
  a.say({ t: 'hello', id: 'screen-a', kind: 'screen' });
  assert.equal(a.last('welcome').code, '1234');
  const b = stuck.sock();
  b.say({ t: 'hello', id: 'screen-b', kind: 'screen' });
  assert.equal(b.last('welcome').code, DENY.BUSY);
  assert.equal(stuck.relay.health().counters.limits['code-draws'], 1);
});

test('K7 sec S5: six walls fall back to codes at once (their store was lost) and all six get a code, on this computer and from one LAN address', () => {
  for (const where of [
    { local: true },
    { local: false, peer: '192.168.1.9' },
  ]) {
    const r = rig();
    const got = [];
    for (let n = 1; n <= 6; n += 1) {
      const ws = r.sock(where);
      ws.say({
        t: 'hello',
        id: `screen-lost-${n}`,
        kind: 'screen',
        slot: n,
        token: `a-token-this-host-never-saw-${n}`,
      });
      got.push(ws.last('welcome'));
    }
    assert.deepEqual(
      got.map((w) => w.type),
      Array(6).fill('pair-code'),
      JSON.stringify(where),
    );
    assert.equal(new Set(got.map((w) => w.code)).size, 6);
  }
});

test('K7 B4 gate: one stuck remote retrying on loopback with a forgotten token for 10 minutes locks nobody out; then a wall reloads and rejoins by its token', async () => {
  const r = rig();
  const walls = [1, 2, 3, 4].map((n) => r.wall(n));
  const tokens = walls.map((w) => w.last('welcome').token);
  for (const w of walls) assert.equal(w.last('welcome').type, 'paired');
  // Once a second for 10 minutes: faster than twinSync.js ever retries.
  let stuck = null;
  for (let i = 0; i < 600; i += 1) {
    assert.equal(r.relay.admit({ peer: '127.0.0.1', isLocal: true }).ok, true);
    stuck = r.sock();
    stuck.say({
      t: 'hello',
      id: 'remote-k7-stuck',
      kind: 'remote',
      token: 'a-token-that-was-forgotten-long-ago-0000000',
    });
    assert.equal(stuck.last('welcome').code, DENY.FORGOTTEN);
    for (const w of walls) w.say({ t: 'hb' });
    await r.timers.run(1000);
  }
  const h = r.relay.health();
  assert.equal(h.counters.wrongToken, 600, 'every wrong token counted');
  assert.ok(h.counters.limits['wrong-token'] >= 1, 'the signal was raised');
  // S2 reloads: its old socket goes, the new one says hello with the token.
  walls[1].close();
  assert.equal(r.relay.admit({ peer: '127.0.0.1', isLocal: true }).ok, true);
  const again = r.sock();
  again.say({
    t: 'hello',
    id: 'screen-k7-2',
    kind: 'screen',
    slot: 2,
    token: tokens[1],
  });
  assert.equal(again.last('welcome').type, 'paired');
  assert.equal(again.last('welcome').slot, 2);
  // And a new wall still gets its code.
  const fresh = r.sock();
  fresh.say({ t: 'hello', id: 'screen-k7-new', kind: 'screen' });
  assert.equal(fresh.last('welcome').type, 'pair-code');
});

test('K7 sec S6: 64 sockets that never say hello, then six walls reconnect: all six rejoin at once; the idle ones are closed at the 5 s hello deadline (4004)', async () => {
  const r = rig();
  const walls = [1, 2, 3, 4, 5, 6].map((n) => r.wall(n));
  const tokens = walls.map((w) => w.last('welcome').token);
  for (const w of walls) w.close(); // a restart of the walls
  const idle = [];
  for (let i = 0; i < 64; i += 1)
    idle.push(
      i % 2
        ? r.sock({ local: false, peer: `192.168.1.${60 + (i % 3)}` })
        : r.sock(),
    );
  const open = () => r.relay.connections();
  assert.ok(open().length <= LIMITS.unauthSockets, `${open().length} open`);
  for (let n = 1; n <= 6; n += 1) {
    const ws = r.sock();
    assert.equal(ws.attached, true, `S${n} got a socket`);
    ws.say({
      t: 'hello',
      id: `screen-k7-${n}`,
      kind: 'screen',
      slot: n,
      token: tokens[n - 1],
    });
    assert.equal(ws.last('welcome').type, 'paired', `S${n}`);
    walls[n - 1] = ws;
  }
  await r.timers.run(LIMITS.helloDeadlineMs + 1);
  const still = idle.filter((ws) => ws.readyState !== 3);
  assert.equal(still.length, 0, 'every idle socket closed');
  assert.ok(
    idle.some((ws) => ws.closeCode === CLOSE.NO_HELLO),
    'by the deadline',
  );
  assert.deepEqual(
    open().map((c) => c.state),
    Array(6).fill('paired'),
  );
  assert.ok(walls.every((ws) => ws.readyState === 1));
});

test('K7 sec S6: a socket with no accepted hello is closed after 5 s; one refused (an old page, RELOAD) is closed too; an accepted one is not', async () => {
  const r = rig();
  const quiet = r.sock();
  const old = r.sock();
  old.say({ t: 'hello', id: 'screen-old', kind: 'screen', proto: 2 });
  assert.equal(old.last('welcome').code, DENY.RELOAD);
  const ok = r.wall(1);
  await r.timers.run(LIMITS.helloDeadlineMs - 1);
  assert.equal(quiet.readyState, 1);
  await r.timers.run(2);
  assert.equal(quiet.closeCode, CLOSE.NO_HELLO);
  assert.equal(old.closeCode, CLOSE.NO_HELLO);
  assert.equal(ok.readyState, 1);
  assert.equal(r.relay.health().counters.limits['hello-deadline'], 2);
});

test('K7 S-15 stale page: a page from K5 or K6 (proto 2) is told RELOAD with text it can show; this build says its own proto (3 at K7); nothing reaches the host', () => {
  assert.ok(PROTO >= 3);
  const r = rig();
  const before = JSON.stringify(r.host.snapshot());
  for (const [kind, text] of [
    ['screen', /^This screen page is out of date/],
    ['remote', /^This remote page is out of date · nothing was sent · Reload$/],
    ['launcher', /^This page is out of date · Reload$/],
  ]) {
    const ws = r.sock({ local: kind !== 'remote' });
    ws.say({
      t: 'hello',
      id: `${kind}-k6-page`,
      kind,
      setup: r.setup,
      slot: 1,
      proto: 2,
    });
    const w = ws.last('welcome');
    assert.equal(w.code, DENY.RELOAD, kind);
    assert.match(w.error, text);
    assert.equal(w.proto, PROTO);
    assert.equal(w.state, undefined);
    assert.equal(w.presence, undefined);
  }
  assert.equal(JSON.stringify(r.host.snapshot()), before);
});

test('K7 T3.13 BE-2: a 2 MiB frame closes only its own socket (1009) on a real server; the wall beside it carries on', async () => {
  process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data-live');
  const srv = await liveTwinServer({
    plugins: [twinSyncRelay()],
    host: 'localhost',
  });
  const dial = () =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/api/twin-sync`, {
        headers: { Origin: `http://127.0.0.1:${srv.port}` },
      });
      ws.got = [];
      ws.on('message', (raw) => ws.got.push(JSON.parse(String(raw))));
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  const wait = async (fn, ms = 3000) => {
    const end = Date.now() + ms;
    while (!fn() && Date.now() < end)
      await new Promise((r) => setTimeout(r, 10));
    return fn();
  };
  const say = (ws, m) => ws.send(JSON.stringify({ proto: PROTO, ...m }));
  try {
    const l = await dial();
    say(l, { t: 'setup', count: 2 });
    await wait(() => l.got.some((m) => m.t === 'setup'));
    const setup = l.got.find((m) => m.t === 'setup').setup;
    const big = await dial();
    say(big, { t: 'hello', id: 'screen-big', kind: 'screen', setup, slot: 1 });
    const wall = await dial();
    say(wall, { t: 'hello', id: 'screen-ok', kind: 'screen', setup, slot: 2 });
    const remote = await dial();
    say(remote, { t: 'hello', id: 'remote-live', kind: 'remote', setup });
    await wait(() => remote.got.some((m) => m.t === 'welcome'));
    const closed = new Promise((r) => big.once('close', (code) => r(code)));
    big.send(
      JSON.stringify({
        t: 'thumb',
        data: `${JPEG}${'A'.repeat(2 * 1024 * 1024)}`,
      }),
    );
    assert.equal(await closed, 1009);
    say(remote, {
      t: 'cmd',
      reqId: 1,
      cmd: { type: 'screens', target: 2, patch: { role: 'day' } },
    });
    assert.ok(
      await wait(() =>
        wall.got.some((m) => m.t === 'state' && m.cause === 'cmd'),
      ),
      'the other wall still hears the change',
    );
    assert.equal(wall.readyState, 1);
    for (const ws of [l, wall, remote]) ws.close();
  } finally {
    await srv.close();
  }
});

test('K7 T3.14 SEC-8: 10,000 seeded fuzz frames (JSON and not, before and after hello, every socket kind but the one in control) throw nothing and change nothing on the wall', async () => {
  const r = rig();
  r.wall(1);
  const ip = r.ipad();
  const viewer = r.sock({ local: false, peer: '192.168.1.21' });
  viewer.say({
    t: 'hello',
    id: 'remote-k7-viewer',
    kind: 'remote',
    setup: r.setup,
    name: 'Laptop',
  });
  const waiting = r.sock({ local: false, peer: '192.168.1.22' });
  waiting.say({ t: 'hello', id: 'screen-k7-wait', kind: 'screen' });
  const rnd = seeded();
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const junk = () =>
    pick([
      null,
      true,
      0,
      -1,
      1e308,
      'x'.repeat(Math.floor(rnd() * 200)),
      [],
      {},
      { __proto__: { t: 'cmd' } },
      { constructor: 'x' },
      [1, [2, [3]]],
      JPEG,
      'data:image/png;base64,AAAA',
      DENY.FORGOTTEN,
    ]);
  const frame = () => {
    const k = rnd();
    if (k < 0.15) return '{"t":"cmd",'; // not JSON
    if (k < 0.25) return JSON.stringify(junk());
    const m = { t: pick([...MSG_TYPES.filter((t) => t !== 'setup'), 'x', '']) };
    for (const f of ['id', 'kind', 'token', 'setup', 'slot', 'cmd', 'code'])
      if (rnd() < 0.4) m[f] = junk();
    if (rnd() < 0.3) m.kind = pick(['screen', 'remote', 'launcher', 'toaster']);
    if (rnd() < 0.3)
      m.cmd = { type: pick(['screens', 'session', 'reset']), patch: junk() };
    if (rnd() < 0.5) m.proto = pick([PROTO, 2, null, '3']);
    return JSON.stringify(m);
  };
  const rev = r.host.state.rev;
  const fresh = () => r.sock({ local: false, peer: '192.168.1.40' });
  let lanSock = fresh();
  const others = [viewer, waiting, r.wall(2)];
  for (let i = 0; i < 10_000; i += 1) {
    if (lanSock.readyState === 3) lanSock = fresh();
    const to = pick([lanSock, ...others]);
    if (to.readyState !== 1) continue;
    assert.doesNotThrow(() => to.emit('message', frame()));
    if (i % 200 === 0) {
      ip.say({ t: 'hb' });
      await r.timers.run(1000);
    }
  }
  assert.equal(r.host.state.rev, rev, 'nothing changed on the wall');
  assert.equal(r.relay.health().counters.msgError, 0, 'no handler threw');
  // The controller still works.
  ip.say({ t: 'hb' });
  ip.say({ t: 'cmd', reqId: 1, cmd: { type: 'returnLive' } });
  assert.equal(ip.last('ack').ok, true);
});

test('K7 SEC-8: a message the host throws on is caught: msg.error with the type only, and the next message is answered', () => {
  const events = [];
  const audit = {
    emit: (type, ev) => events.push({ type, ...ev }),
    health: () => ({ ok: true }),
  };
  const r = rig({ audit });
  const ip = r.ipad();
  const command = r.host.command;
  r.host.command = () => {
    throw new Error('boom: Ottoline Quarnby');
  };
  assert.doesNotThrow(() =>
    ip.say({ t: 'cmd', reqId: 1, cmd: { type: 'returnLive' } }),
  );
  assert.equal(ip.last('ack'), undefined);
  const e = events.find((x) => x.type === 'msg.error');
  assert.deepEqual(e.data, { type: 'cmd' });
  assert.equal(r.relay.health().counters.msgError, 1);
  r.host.command = command;
  ip.say({ t: 'cmd', reqId: 2, cmd: { type: 'returnLive' } });
  assert.equal(ip.last('ack').ok, true);
});

test('K7 S-16: a socket past 40 messages in a burst has the rest dropped; over its budget for 10 s it is closed (1008); one that keeps to 20 a second stays', async () => {
  const r = rig();
  const loud = r.wall(1);
  const calm = r.wall(2);
  for (let i = 0; i < 60; i += 1) loud.say({ t: 'hb' });
  const d = r.relay.health().counters.budgetDropped;
  assert.equal(d, 21, 'its hello and 39 heartbeats fit in the burst of 40');
  for (let s = 0; s < 11; s += 1) {
    for (let i = 0; i < 100 && loud.readyState === 1; i += 1)
      loud.say({ t: 'hb' });
    for (let i = 0; i < 20; i += 1) calm.say({ t: 'hb' });
    await r.timers.run(1000);
  }
  assert.equal(loud.closeCode, CLOSE.OVER_BUDGET);
  assert.equal(calm.readyState, 1);
  assert.equal(r.relay.health().counters.limits['socket-budget'], 1);
  // Unit: the budget alone.
  const b = socketBudget(LIMITS, 0);
  const outs = Array.from({ length: 41 }, () => b.take(0));
  assert.equal(outs.filter((x) => x === 'ok').length, 40);
  assert.equal(outs.at(-1), 'drop');
});

test('K7 S-16: per device, 20 commands in a burst, then RATE_LIMITED with retryAfterMs; 10 a second after that are applied', async () => {
  const r = rig();
  const ip = r.ipad();
  for (let i = 0; i < 21; i += 1)
    ip.say({ t: 'cmd', reqId: i, cmd: { type: 'returnLive' } });
  const acks = ip.all('ack');
  assert.equal(acks.filter((a) => a.ok).length, 20);
  assert.equal(acks.at(-1).code, CODE.RATE_LIMITED);
  assert.ok(acks.at(-1).retryAfterMs > 0);
  assert.equal(r.relay.health().counters.cmdRefused.RATE_LIMITED, 1);
  for (let s = 0; s < 3; s += 1) {
    await r.timers.run(1000);
    ip.say({ t: 'hb' });
    for (let i = 0; i < 9; i += 1)
      ip.say({
        t: 'cmd',
        reqId: 100 + s * 10 + i,
        cmd: { type: 'returnLive' },
      });
    assert.ok(
      ip
        .all('ack')
        .slice(-9)
        .every((a) => a.ok),
      `second ${s}`,
    );
  }
});

test('K7 S-16: upgrades per address: 30 a minute from the LAN (then 429 with retryAfterMs), 120 from this computer (its own budget); through the real handler the 25th socket from one address gets 503', () => {
  const r = rig();
  for (let i = 0; i < 30; i += 1)
    assert.equal(r.relay.admit({ peer: '192.168.1.50' }).ok, true, `#${i + 1}`);
  const no = r.relay.admit({ peer: '192.168.1.50' });
  assert.deepEqual([no.ok, no.status, no.limit], [false, 429, 'upgrade-rate']);
  assert.ok(no.retryAfterMs > 0);
  assert.equal(r.relay.admit({ peer: '192.168.1.51' }).ok, true, 'per address');
  for (let i = 0; i < 120; i += 1)
    assert.equal(r.relay.admit({ peer: '127.0.0.1', isLocal: true }).ok, true);
  assert.equal(r.relay.admit({ peer: '127.0.0.1', isLocal: true }).ok, false);
  // The limiter refills: a minute later the LAN address may again.
  const lim = createLimiter();
  for (let i = 0; i < 30; i += 1) lim.upgrade('10.0.0.5', false, 0);
  assert.equal(lim.upgrade('10.0.0.5', false, 0).ok, false);
  assert.equal(lim.upgrade('10.0.0.5', false, 60_000).ok, true);
  // The real upgrade handler: 24 sockets from one address (a launcher
  // and 23 paired remotes), the 25th 503 before any handshake.
  process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data-upgrade');
  const v = fakeViteRelay(twinSyncRelay());
  try {
    const l = v.upgrade();
    l.socket.emit('data', clientFrame({ t: 'setup', count: 2 }));
    const setup = serverFrames(l.socket.written).find(
      (m) => m.t === 'setup',
    )?.setup;
    assert.ok(setup);
    const got = [];
    for (let i = 0; i < 24; i += 1) {
      const u = v.upgrade();
      u.socket.emit(
        'data',
        clientFrame({
          t: 'hello',
          id: `remote-up-${i}`,
          kind: 'remote',
          setup,
        }),
      );
      got.push(u);
    }
    assert.equal(got.filter((u) => u.verdict === 'accepted').length, 23);
    const last = got.at(-1).socket.written[0];
    assert.match(String(last), /^HTTP\/1\.1 503 /);
    assert.equal(got.at(-1).socket.destroyed, true);
  } finally {
    v.close();
  }
});

test('K7 SEC-8: thumbnails: a JPEG data URL only, one per screen per 2 s; anything else is dropped and never reaches a remote; a wall’s text loses its control characters', async () => {
  const r = rig();
  const s1 = r.wall(1);
  const ip = r.ipad();
  for (const bad of [
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    `${JPEG}"><img src=x>`,
    `data:image/jpeg;base64,${'A'.repeat(LIMITS.thumbMaxChars)}`,
    42,
    null,
  ])
    s1.say({ t: 'thumb', data: bad });
  assert.equal(ip.all('thumb').length, 0);
  s1.say({ t: 'thumb', data: JPEG });
  s1.say({ t: 'thumb', data: JPEG }); // too soon
  assert.equal(ip.all('thumb').length, 1);
  assert.equal(ip.last('thumb').data, JPEG, 'forwarded as sent, not cut');
  await r.timers.run(LIMITS.thumbEveryMs);
  s1.say({ t: 'thumb', data: JPEG });
  assert.equal(ip.all('thumb').length, 2);
  // A wall's `local` text reaches remotes without control characters.
  s1.say({ t: 'local', on: true, text: 'hands\u0000-on\u001b[2J\nS1' });
  assert.equal(ip.last('local').text, 'hands-on[2JS1');
  assert.equal(thumbOk(JPEG), true);
  assert.equal(thumbOk('data:image/jpeg;base64,'), false);
});

test('K7 R6c: a newly issued token is in the store at once (no 300 ms wait), through the plugin; presence says health {audit, store}', async () => {
  const data = path.join(scratch, 'data-flush');
  process.env.TRIP_TWIN_DATA_DIR = data;
  const v = fakeViteRelay(twinSyncRelay());
  try {
    const frames = await v.talk([
      { t: 'hello', id: 'L', kind: 'launcher' },
      { t: 'setup', count: 2 },
    ]);
    const setup = frames.find((m) => m.t === 'setup').setup;
    const u = v.upgrade();
    u.socket.emit(
      'data',
      clientFrame({
        t: 'hello',
        id: 'screen-flush',
        kind: 'screen',
        setup,
        slot: 1,
      }),
    );
    await settle(2);
    const w = serverFrames(u.socket.written).find((m) => m.t === 'welcome');
    assert.equal(w.type, 'paired');
    const text = fs.readFileSync(path.join(data, 'session.json'), 'utf8');
    // L5: what is saved at once is the token's hash, never the token.
    const { tokenHash } =
      await import('../../../server/tripTwin/twinTokens.js');
    assert.ok(text.includes(tokenHash(w.token)), 'the token is saved at once');
    assert.equal(text.includes(w.token), false, 'as its hash only');
    assert.deepEqual(w.presence.health, { audit: true, store: true });
    const r = u.socket.written.length;
    assert.ok(r > 0);
  } finally {
    v.close();
  }
});

test('K7 S-16: a good code with a wrong slot is kept for 3 tries, then burnt; wrong codes keep today’s 5-then-60 s lock', () => {
  const r = rig();
  const ip = r.ipad();
  const tv = r.sock();
  tv.say({ t: 'hello', id: 'screen-k7-tv', kind: 'screen' });
  const code = tv.last('welcome').code;
  ip.say({ t: 'pair', reqId: 1, code, slot: 9 });
  ip.say({ t: 'pair', reqId: 2, code, slot: 0 });
  assert.equal(r.host.codesOut(), 1, 'still there after 2 slips');
  ip.say({ t: 'pair', reqId: 3, code, slot: 2 });
  assert.equal(ip.last('pair-result').ok, true, 'a slip does not burn it');
  const tv2 = r.sock();
  tv2.say({ t: 'hello', id: 'screen-k7-tv2', kind: 'screen' });
  const c2 = tv2.last('welcome').code;
  for (let i = 0; i < 3; i += 1)
    ip.say({ t: 'pair', reqId: 10 + i, code: c2, slot: 7 });
  ip.say({ t: 'pair', reqId: 20, code: c2, slot: 3 });
  assert.equal(ip.last('pair-result').ok, false, 'burnt after 3');
  assert.equal(r.host.codesOut(), 0);
});

test('K7 client: BUSY with retryAfterMs: twinSync.js does not connect again before it, and does after', async () => {
  const timers = fakeTimers();
  const busy = {
    attach(srv) {
      srv.on('message', (raw) => {
        const m = JSON.parse(String(raw));
        if (m.t !== 'hello') return;
        srv.send(
          JSON.stringify({
            t: 'welcome',
            type: 'denied',
            code: DENY.BUSY,
            error:
              'Too many screens are waiting to pair · trying again in 1 min',
            retryAfterMs: 60_000,
            proto: PROTO,
          }),
        );
        // The hello deadline closes it, as the relay does.
        setImmediate(() => srv.close(CLOSE.NO_HELLO));
      });
    },
  };
  const b = fakeBrowser({ relay: busy, timers });
  const w = b.window({ href: 'http://localhost:4173/twin.html?view=screen' });
  const seen = [];
  const sync = connectSync({
    kind: 'screen',
    on: { welcome: (m) => seen.push(m.code), status() {} },
    env: w.env,
  });
  await settle();
  await timers.run(10);
  assert.equal(seen[0], DENY.BUSY);
  assert.equal(w.sockets.length, 1);
  await timers.run(55_000);
  assert.equal(w.sockets.length, 1, 'not before retryAfterMs');
  await timers.run(10_000);
  assert.ok(w.sockets.length >= 2, 'and again after');
  sync.close();
});

test('K7 S-4 wiring: the Math.random rule is enforced from K7 and clean; /api/route stays a warning until L1', () => {
  assert.equal(WIRING_ENFORCED['math-random'], true);
  assert.equal(WIRING_ENFORCED['api-route'], false);
  assert.deepEqual(
    wiringFindings().filter((w) => w.id === 'math-random'),
    [],
  );
});
