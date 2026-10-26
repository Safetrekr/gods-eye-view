// Trip Twin protocol version and wire contract (Phase CF K5; PHASE-CF-PLAN
// S-8, S-15, review U-B1 / ET S1; cf/02-backend.md BE-2 proto, BE-12;
// cf/07-reasoning.md ET-3 R0.3): a page from before PROTO_MIN is sent to
// RELOAD, every welcome says PROTO, and one schema hash per PROTO fails
// any change of message shape that comes without a bump.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  fakeBrowser,
  fakeSocket,
  fakeTimers,
  memStorage,
  settle,
} from './twinTestKit.mjs';
import { CODE_TTL_MS, createSessionHost } from './twinSessionHost.js';
import {
  CODE,
  DENY,
  PROTO,
  PROTO_MIN,
  RELOAD_EVERY_MS,
  RELOAD_KEY,
  TERMINAL_DENY,
  UNPAIRED,
  mergeShape,
  protoOk,
  reloadGuard,
  reloadText,
  shapeOf,
} from './twinProtocol.js';
import { connectSync } from './twinSync.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-proto-test-'));
process.env.TMPDIR = path.join(scratch, 'tmp');
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
fs.mkdirSync(process.env.TMPDIR);
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const { createRelay } = await import('../../../server/tripTwin/syncRelay.js');

/**
 * The relay → page message shapes, one row per protocol version. NEVER
 * edit a row: a change of shape adds a row with PROTO + 1 (and
 * PROTO_MIN = PROTO, S-15), in the same commit as the change.
 */
const WIRE_SCHEMA = Object.freeze({
  2: '21bbf078de4aa135d7f800c2685ed4ffd5a931b563c71a8b922d87609af5a199',
  3: 'c89e2144cc6ab7cb9626508850956fa7bbca62ff626360657212d2936534cd51',
  4: '6806f367d0ae2fa55feea8f6f16820626a904c76982da0bb61b6be21a66cc4f3',
  // The wall menu: every screen carries `layout`, the session
  // `wallControls` (screens/05-S1-PLAN, Q2).
  5: 'e34b496a7165fd723ea0ec559622a24bd1c78195982a3d6a0f0a17caded7d04f',
});

/** A host on a fake clock with a seeded random (deterministic tokens). */
function seededHost(start = 1_000_000) {
  let t = start;
  let s = 0.777;
  const host = createSessionHost({
    now: () => t,
    random: () => {
      s = (s * 9301 + 0.49297) % 1;
      return s;
    },
  });
  return { host, tick: (ms) => (t += ms), now: () => t };
}

/**
 * The golden transcript: one scripted session that makes the relay send
 * every message type it has (and every refusal shape), on a fake clock.
 * Returns every frame each socket received, in order.
 */
function goldenTranscript() {
  const { host, tick, now } = seededHost();
  const relay = createRelay({ host, now });
  const socks = [];
  const sock = (local = true) => {
    const ws = fakeSocket();
    socks.push(ws);
    relay.attach(ws, { isLocal: local });
    return ws;
  };
  // Launcher: refused hello, setup refused from the LAN and for an old
  // page, then setup.
  const lan = sock(false);
  lan.say({ t: 'setup', count: 2 });
  const stale = sock();
  stale.say({ t: 'hello', id: 'launcher-old', kind: 'launcher', proto: null });
  stale.say({ t: 'setup', count: 2, proto: null });
  const l = sock();
  l.say({ t: 'hello', id: 'launcher-gold', kind: 'launcher' });
  l.say({ t: 'setup', count: 3 });
  const setup = l.last('setup').setup;
  // A launch link opened on this computer (the launcher's own page).
  sock().say({ t: 'hello', id: 'launcher-gold-2', kind: 'launcher', setup });
  // Walls and remotes.
  const s1 = sock();
  s1.say({ t: 'hello', id: 'screen-gold-1', kind: 'screen', setup, slot: 1 });
  const s2 = sock();
  s2.say({ t: 'hello', id: 'screen-gold-2', kind: 'screen', setup, slot: 2 });
  const r = sock(false);
  r.say({
    t: 'hello',
    id: 'remote-gold-1',
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  const v = sock(false);
  v.say({
    t: 'hello',
    id: 'remote-gold-2',
    kind: 'remote',
    setup,
    name: 'Laptop',
  });
  const tv = sock(false);
  tv.say({ t: 'hello', id: 'screen-gold-tv', kind: 'screen' });
  r.say({ t: 'pair', reqId: 1, code: '0000', slot: 3 }); // wrong code
  r.say({ t: 'pair', reqId: 2, code: tv.last('welcome').code, slot: 3 });
  v.say({ t: 'pair', reqId: 3, code: '1234', slot: 3 }); // not in control
  // Commands, refusals and an undo.
  r.say({
    t: 'cmd',
    reqId: 4,
    cmd: {
      type: 'screens',
      target: 1,
      patch: { role: 'day', layers: { radar: true } },
    },
  });
  r.say({
    t: 'cmd',
    reqId: 5,
    cmd: { type: 'session', patch: { visitor: true } },
  });
  r.say({
    t: 'cmd',
    reqId: 6,
    cmd: { type: 'screens', target: 'all', patch: { mode: 'advance' } },
  });
  const undoId = r.last('ack').undoId;
  r.say({ t: 'cmd', reqId: 7, cmd: { type: 'nope' } });
  r.say({
    t: 'cmd',
    reqId: 8,
    cmd: { type: 'screens', target: 1, patch: {}, via: 'voice' },
  });
  v.say({ t: 'cmd', reqId: 9, cmd: { type: 'returnLive' } });
  // A wall's own L / D sheet (shell D5): applied and refused. Same `ack`
  // and `state` shapes as a remote's command, so no row of its own.
  s2.say({
    t: 'screen-cmd',
    reqId: 90,
    label: 'Rain map on',
    cmd: { type: 'screens', target: 2, patch: { layers: { precip: true } } },
  });
  s2.say({
    t: 'screen-cmd',
    reqId: 91,
    cmd: { type: 'screens', target: 1, patch: { role: 'day' } },
  });
  r.say({ t: 'undo', reqId: 10, undoId });
  r.say({ t: 'undo', reqId: 11, undoId });
  // Thumbnails, hands-on, identify, control and handover.
  s1.say({ t: 'thumb', data: 'data:image/jpeg;base64,AAAA' });
  s2.say({ t: 'local', on: true, text: 'picked' });
  r.say({ t: 'identify' });
  v.say({ t: 'request-control' });
  relay.presenceTick();
  r.say({ t: 'handover', accept: true });
  tick(1000);
  r.say({ t: 'request-control' });
  v.say({ t: 'handover', accept: false });
  // Hello refusals: every code the host sends today, plus the relay's.
  const deny = (hello, local = true) =>
    sock(local).say({ t: 'hello', ...hello });
  deny({ id: '', kind: 'screen' });
  deny({ id: 'screen-gold-1', kind: 'screen', token: 'wrong' });
  deny({ id: 'x-kind', kind: 'toaster' });
  deny({ id: 'remote-x', kind: 'remote' }, false);
  deny({ id: 'remote-y', kind: 'remote', token: 'gone' }, false);
  deny({ id: 'remote-z', kind: 'remote', setup: 'expired' }, false);
  deny({ id: 'screen-z', kind: 'screen', setup: 'expired', slot: 2 });
  // From another computer: on this one, an expired launch code rejoins
  // (the All-in-one's review link, Jesse 26 Oct).
  deny({ id: 'launcher-z', kind: 'launcher', setup: 'expired' }, false);
  deny({ id: 'screen-old', kind: 'screen', proto: 1 });
  deny({
    id: 'screen-gold-2',
    kind: 'screen',
    slot: 1,
    token: s2.last('welcome').token,
  });
  const twice = sock();
  twice.say({
    t: 'hello',
    id: 'screen-gold-3',
    kind: 'screen',
    setup,
    slot: 3,
  });
  twice.say({
    t: 'hello',
    id: 'screen-gold-4',
    kind: 'screen',
    setup,
    slot: 2,
  });
  // The same wall opened again (replaced), and a slot taken (unpaired).
  const s1b = sock();
  s1b.say({
    t: 'hello',
    id: 'screen-gold-1',
    kind: 'screen',
    slot: 1,
    token: s1.last('welcome').token,
  });
  const s9 = sock();
  s9.say({ t: 'hello', id: 'screen-gold-9', kind: 'screen', setup, slot: 2 });
  // K7: a computer on the LAN past its 6 codes is told BUSY; a remote past
  // its burst is told RATE_LIMITED (both with retryAfterMs); an expired
  // code is sent again with a new one.
  for (let i = 0; i < 7; i += 1) {
    const ws = fakeSocket();
    socks.push(ws);
    relay.attach(ws, { isLocal: false, peer: '192.168.1.77' });
    ws.say({ t: 'hello', id: `screen-gold-lan-${i}`, kind: 'screen' });
  }
  for (let i = 0; i < 24; i += 1)
    r.say({ t: 'cmd', reqId: 100 + i, cmd: { type: 'returnLive' } });
  tick(CODE_TTL_MS + 1);
  relay.sweep();
  return socks.map((ws) => ws.out);
}

/** Message shapes by type (welcome and ack by their outcome). */
function shapesOf(frames) {
  const out = {};
  for (const m of frames.flat()) {
    const key = [
      m.t,
      m.t === 'welcome' ? m.type : null,
      m.t === 'ack' || m.t === 'pair-result' || m.t === 'setup'
        ? m.ok
          ? 'ok'
          : 'refused'
        : null,
    ]
      .filter((x) => x != null)
      .join(':');
    out[key] = key in out ? mergeShape(out[key], shapeOf(m)) : shapeOf(m);
  }
  return Object.fromEntries(
    Object.keys(out)
      .sort()
      .map((k) => [k, out[k]]),
  );
}
const hashOf = (shapes) =>
  createHash('sha256').update(JSON.stringify(shapes)).digest('hex');

test('K5 S-15: a page with no proto, or proto 1, is refused RELOAD with text it can show; nothing reaches the host', () => {
  const host = createSessionHost({ now: () => 1000 });
  const relay = createRelay({ host });
  const setup = host.setup({ count: 2 }).setup;
  const before = JSON.stringify(host.snapshot());
  for (const [kind, proto, text] of [
    ['screen', null, /^This screen page is out of date/],
    ['screen', 1, /^This screen page is out of date/],
    [
      'remote',
      null,
      /^This remote page is out of date · nothing was sent · Reload$/,
    ],
    ['remote', 1.5, /^This remote page is out of date/],
    ['launcher', null, /^This page is out of date · Reload$/],
  ]) {
    const ws = fakeSocket();
    relay.attach(ws, { isLocal: kind !== 'remote' });
    ws.say({ t: 'hello', id: `${kind}-stale`, kind, setup, slot: 1, proto });
    const w = ws.last('welcome');
    assert.equal(w.type, 'denied', `${kind} ${proto}`);
    assert.equal(w.code, DENY.RELOAD);
    assert.match(w.error, text);
    assert.equal(w.proto, PROTO);
    assert.equal(ws.last('state'), undefined, 'no state to an old page');
    assert.equal(w.state, undefined);
    // Still nothing after it tries a command.
    ws.say({ t: 'cmd', reqId: 1, cmd: { type: 'returnLive' } });
    assert.equal(ws.last('ack'), undefined);
  }
  assert.equal(JSON.stringify(host.snapshot()), before, 'the host saw none');
  assert.equal(relay.connections().filter((c) => c.kind).length, 0);
});

test('K5 S-15: a launcher page from before K5 cannot start a setup (RELOAD); this build’s can, after its refused hello', () => {
  const relay = createRelay({ host: createSessionHost({ now: () => 1000 }) });
  const old = fakeSocket();
  relay.attach(old);
  old.say({ t: 'hello', id: 'launcher-old', kind: 'launcher', proto: null });
  old.say({ t: 'setup', count: 2, proto: null });
  assert.equal(old.last('setup').ok, false);
  assert.equal(old.last('setup').code, CODE.RELOAD);
  assert.match(old.last('setup').error, /out of date · Reload/);
  // twinEntry.js sends setup without proto; its hello said PROTO.
  const now = fakeSocket();
  relay.attach(now);
  now.say({ t: 'hello', id: 'launcher-new', kind: 'launcher' });
  assert.equal(now.last('welcome').code, DENY.NOT_TRUSTED);
  now.say({ t: 'setup', count: 2, proto: undefined });
  assert.equal(now.last('setup').ok, true);
});

test('K5 S-15: every welcome says PROTO; PROTO_MIN equals PROTO at this slice; protoOk takes integers from PROTO_MIN up', () => {
  assert.equal(PROTO, 5);
  assert.equal(PROTO_MIN, PROTO);
  for (const p of [PROTO, PROTO + 1]) assert.equal(protoOk(p), true);
  for (const p of [undefined, null, 0, 1, '2', 1.5, NaN])
    assert.equal(protoOk(p), false);
  const frames = goldenTranscript().flat();
  const welcomes = frames.filter((m) => m.t === 'welcome');
  assert.ok(welcomes.length > 15);
  for (const w of welcomes)
    assert.equal(w.proto, PROTO, `${w.type} ${w.code ?? ''}`);
});

test('K5 schema hash: the golden transcript’s message shapes match the row for this PROTO (a change of shape needs a bump)', () => {
  const keys = Object.keys(WIRE_SCHEMA).map(Number);
  assert.deepEqual(
    keys,
    [...keys].sort((a, b) => a - b),
    'rows in order',
  );
  assert.equal(Math.max(...keys), PROTO, 'the newest row is this PROTO');
  assert.equal(
    new Set(Object.values(WIRE_SCHEMA)).size,
    keys.length,
    'a bump changes the shape',
  );
  const shapes = shapesOf(goldenTranscript());
  // Every relay → page message type is in the transcript.
  for (const t of [
    'welcome:paired',
    'welcome:pair-code',
    'welcome:remote',
    'welcome:launcher',
    'welcome:denied',
    'state',
    'presence',
    'ack:ok',
    'ack:refused',
    'pair-result:ok',
    'pair-result:refused',
    'paired',
    'unpaired',
    'replaced',
    'setup:ok',
    'setup:refused',
    'thumb',
    'local',
    'identify',
    'control',
  ])
    assert.ok(shapes[t], `the transcript has ${t}`);
  const hash = hashOf(shapes);
  // To see what changed before a bump: TRIP_TWIN_SHAPES=<file> writes them.
  if (process.env.TRIP_TWIN_SHAPES)
    fs.writeFileSync(
      process.env.TRIP_TWIN_SHAPES,
      JSON.stringify(shapes, null, 1),
    );
  assert.equal(
    hash,
    WIRE_SCHEMA[PROTO],
    `message shapes changed: raise PROTO (and PROTO_MIN) in twinProtocol.js and add the row ${PROTO + 1}: '${hash}' here (TRIP_TWIN_SHAPES=<file> writes the shapes)`,
  );
});

test('K5 schema hash: renaming one field, or adding one, changes the hash; a value change does not', () => {
  const frames = goldenTranscript();
  const base = hashOf(shapesOf(frames));
  const tweak = (fn) =>
    hashOf(
      shapesOf(frames.map((list) => list.map((m) => fn(structuredClone(m))))),
    );
  assert.equal(
    tweak((m) => (m.t === 'ack' && m.rev ? { ...m, rev: m.rev + 1 } : m)),
    base,
  );
  assert.notEqual(
    tweak((m) => {
      if (m.t === 'state' && m.by) {
        m.by.label = m.by.name;
        delete m.by.name;
      }
      return m;
    }),
    base,
  );
  assert.notEqual(
    tweak((m) => (m.t === 'presence' ? { ...m, health: { log: true } } : m)),
    base,
  );
});

test('K5 wall reload guard: reloads once, waits out 2 minutes, then may reload again; never without working storage', () => {
  let t = 5_000_000;
  const now = () => t;
  const storage = memStorage();
  assert.deepEqual(reloadGuard({ storage, now }), { reload: true });
  assert.equal(storage.getItem(RELOAD_KEY), String(t));
  t += 30_000;
  assert.deepEqual(reloadGuard({ storage, now }), {
    reload: false,
    waitMs: RELOAD_EVERY_MS - 30_000,
  });
  t += RELOAD_EVERY_MS;
  assert.deepEqual(reloadGuard({ storage, now }), { reload: true });
  // Storage that throws, or forgets what it was told: no reload loop.
  const throwing = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {},
  };
  assert.deepEqual(reloadGuard({ storage: throwing, now }), { reload: false });
  const forgetful = { getItem: () => null, setItem() {} };
  assert.deepEqual(reloadGuard({ storage: forgetful, now }), { reload: false });
  assert.deepEqual(reloadGuard({ storage: null, now }), { reload: false });
});

test('K5 client: every hello from twinSync.js says PROTO; RELOAD is not terminal (the page keeps its id and token and hears the refusal)', async () => {
  const timers = fakeTimers();
  const host = createSessionHost({ now: timers.now });
  const relay = createRelay({ host });
  const b = fakeBrowser({ relay, timers });
  const setup = host.setup({ count: 2 }).setup;
  const w = b.window({
    href: `http://localhost:4173/twin.html?view=screen&slot=1&setup=${setup}`,
  });
  const got = [];
  const sync = connectSync({
    kind: 'screen',
    slot: 1,
    setup,
    on: { welcome: (m) => got.push(m), status() {} },
    env: w.env,
  });
  await settle();
  assert.equal(got[0]?.type, 'paired');
  assert.ok(w.sockets[0].hellos.every((h) => h.proto === PROTO));
  const keys = [...b.local().map];
  // The same page against a relay that wants a newer page.
  const stale = {
    attach(srv) {
      srv.on('message', (raw) => {
        const m = JSON.parse(String(raw));
        if (m.t === 'hello')
          srv.send(
            JSON.stringify({
              t: 'welcome',
              type: 'denied',
              code: DENY.RELOAD,
              error: reloadText('screen'),
              proto: PROTO + 1,
            }),
          );
      });
    },
  };
  b.relay = stale;
  b.drop();
  await timers.run(70_000);
  const refusal = got.at(-1);
  assert.equal(refusal.code, DENY.RELOAD);
  assert.equal(sync.stopped, null, 'not stopped: the page decides');
  assert.deepEqual([...b.local().map], keys, 'storage untouched');
  assert.ok(!TERMINAL_DENY.includes(DENY.RELOAD));
  sync.close();
});

test('K5 S-8: the protocol lists each code once; terminal codes and unpaired reasons are deny codes', () => {
  const deny = Object.values(DENY);
  const code = Object.values(CODE);
  assert.equal(new Set(deny).size, deny.length);
  assert.equal(new Set(code).size, code.length);
  for (const c of TERMINAL_DENY) assert.ok(deny.includes(c), c);
  for (const r of Object.values(UNPAIRED))
    assert.ok(deny.includes(r) || r === 'SLOT_TAKEN' || r === 'EXPIRED', r);
  for (const c of [
    'CMDID_REUSED',
    'PENDING_BUSY',
    'VALIDATION_COMMAND',
    'RELOAD',
  ])
    assert.ok(code.includes(c), c);
  assert.ok(
    !code.includes('IDEMPOTENCY_CONFLICT'),
    'S-18: CMDID_REUSED instead',
  );
});
