// Trip Twin attribution (Phase CF K5; PHASE-CF-PLAN §4.4, CF-D8, S-18,
// F-0003, F-0009; cf/02-backend.md BE-1, cf/01-security.md SEC-11,
// cf/06-qa.md QA-8 T8.1–T8.3, cf/07-reasoning.md ET-5 R2): every change
// names the device that made it by a public ref and a name the host owns,
// and no device id ever reaches a socket. Fake sockets, fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clockHost, fakeSocket } from './twinTestKit.mjs';
import { createSession } from './twinSession.js';
import { createSessionHost } from './twinSessionHost.js';
import {
  CAUSE,
  CODE,
  HOST_NAME,
  HOST_REF,
  REPLACED,
  VIA,
  isRef,
} from './twinProtocol.js';

// No test here writes a store; point the relay's folders away anyway.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-attr-test-'));
process.env.TMPDIR = path.join(scratch, 'tmp');
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
fs.mkdirSync(process.env.TMPDIR);
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const { createRelay } = await import('../../../server/tripTwin/syncRelay.js');

// Device ids as the pages make them: long and distinctive, so a substring
// search finds one anywhere it leaks (a key, a value, inside text).
const ID = {
  launcher: 'launcher-qa-0c1d2e3f',
  s1: 'screen-9f8e7d6c5b4a39281706f5e4d3c2b1a0',
  s2: 'screen-1a2b3c4d5e6f708192a3b4c5d6e7f809',
  s3: 'screen-0f1e2d3c4b5a69788796a5b4c3d2e1f0',
  tv: 'screen-77aa66bb55cc44dd33ee22ff11009988',
  ipad: 'remote-5e4d3c2b1a0f9e8d7c6b5a4938271605',
  laptop: 'remote-a1b2c3d4e5f60718293a4b5c6d7e8f90',
};
const ALL_IDS = Object.values(ID);

/** Every place a string from `needles` appears in a value (keys too). */
function findIn(value, needles, at = '$', hits = []) {
  if (typeof value === 'string') {
    for (const n of needles)
      if (n && value.includes(n)) hits.push(`${at} ∋ ${n}`);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      for (const n of needles)
        if (n && k.includes(n)) hits.push(`${at} key ∋ ${n}`);
      findIn(v, needles, `${at}.${k}`, hits);
    }
  }
  return hits;
}

/** A relay on a fake clock; `join` attaches a socket and says hello. */
function world({ restore = null, start = 1_000_000 } = {}) {
  let t = start;
  let s = 0.321;
  const host = createSessionHost({
    now: () => t,
    random: () => {
      s = (s * 9301 + 0.49297) % 1;
      return s;
    },
    restore,
  });
  const relay = createRelay({ host });
  const socks = [];
  const tokens = {}; // device id → token (from its own welcome / paired)
  const keep = (id, ws) => {
    for (const m of ws.out)
      if ((m.t === 'welcome' || m.t === 'paired') && m.token)
        tokens[id] = m.token;
  };
  const join = (id, hello, { local = false } = {}) => {
    const ws = fakeSocket();
    ws.deviceId = id;
    socks.push(ws);
    relay.attach(ws, { isLocal: local });
    ws.say({ t: 'hello', id, ...hello });
    keep(id, ws);
    return ws;
  };
  return {
    host,
    relay,
    socks,
    tokens,
    join,
    keep,
    tick: (ms) => (t += ms),
    launch(count = 3) {
      const l = join(ID.launcher, { kind: 'launcher' }, { local: true });
      l.say({ t: 'setup', count });
      return l.last('setup').setup;
    },
  };
}

/** No socket heard any device id; none heard a token not its own. */
function assertNoLeak(w, extra = []) {
  for (const ws of w.socks) {
    const own = w.tokens[ws.deviceId];
    const others = Object.entries(w.tokens)
      .filter(([id]) => id !== ws.deviceId)
      .map(([, tk]) => tk)
      .filter((tk) => tk !== own);
    const hits = findIn(ws.out, [...ALL_IDS, ...extra]);
    assert.deepEqual(hits, [], `${ws.deviceId} heard a device id`);
    assert.deepEqual(
      findIn(ws.out, others),
      [],
      `${ws.deviceId} heard another device's token`,
    );
  }
}

test('K5 T8.1: after setup, pairing, commands, undo, a handover, a duplicate window and a restart, no device id appears in any message to any socket, nor anywhere in state', () => {
  const w = world();
  const setup = w.launch(3);
  const s1 = w.join(ID.s1, { kind: 'screen', setup, slot: 1 });
  const s2 = w.join(ID.s2, { kind: 'screen', setup, slot: 2 });
  w.join(ID.s3, { kind: 'screen', setup, slot: 3 });
  const ipad = w.join(ID.ipad, { kind: 'remote', setup, name: 'iPad' });
  // A screen on another device pairs by code into S4.
  const tv = w.join(ID.tv, { kind: 'screen' });
  ipad.say({ t: 'pair', reqId: 1, code: tv.last('welcome').code, slot: 4 });
  w.keep(ID.tv, tv);
  assert.equal(ipad.last('pair-result').ok, true);
  // Commands and an undo from the iPad.
  let req = 10;
  const cmd = (ws, c) => {
    ws.say({ t: 'cmd', reqId: ++req, cmd: c });
    return ws.last('ack');
  };
  cmd(ipad, { type: 'screens', target: 2, patch: { role: 'day' } });
  cmd(ipad, { type: 'session', patch: { visitor: true, wxAt: 5 } });
  cmd(ipad, {
    type: 'screens',
    target: 'all',
    patch: { layers: { radar: true } },
  });
  const a = cmd(ipad, { type: 'screens', target: 1, patch: { pinned: true } });
  ipad.say({ t: 'undo', reqId: ++req, undoId: a.undoId });
  assert.equal(ipad.last('ack').ok, true);
  cmd(ipad, { type: 'returnLive' });
  // A second remote asks for control; the iPad hands over.
  const laptop = w.join(ID.laptop, { kind: 'remote', setup, name: 'Laptop' });
  laptop.say({ t: 'request-control' });
  ipad.say({ t: 'handover', accept: true });
  cmd(laptop, {
    type: 'screens',
    target: 3,
    patch: { mode: 'advance', day: 2 },
  });
  laptop.say({ t: 'identify' });
  s1.say({ t: 'thumb', data: 'data:image/jpeg;base64,AAAA' });
  s2.say({ t: 'local', on: true, text: 'picked a place' });
  // The same wall opened again in another window (same id and token).
  const s2b = w.join(ID.s2, {
    kind: 'screen',
    slot: 2,
    token: w.tokens[ID.s2],
  });
  assert.ok(s2.last(REPLACED));
  assert.equal(s2b.last('welcome').type, 'paired');
  w.relay.presenceTick();

  // Restart: a new host from the saved snapshot; everyone rejoins.
  const snap = JSON.parse(JSON.stringify(w.host.snapshot()));
  const w2 = world({ restore: snap, start: 2_000_000 });
  Object.assign(w2.tokens, w.tokens);
  for (const [id, hello] of [
    [ID.s1, { kind: 'screen', slot: 1 }],
    [ID.s2, { kind: 'screen', slot: 2 }],
    [ID.s3, { kind: 'screen', slot: 3 }],
    [ID.tv, { kind: 'screen', slot: 4 }],
    [ID.laptop, { kind: 'remote', name: 'Laptop' }],
    [ID.ipad, { kind: 'remote', name: 'iPad' }],
  ])
    assert.notEqual(
      w2.join(id, { ...hello, token: w.tokens[id] }).last('welcome').type,
      'denied',
      `${id} rejoins`,
    );
  const ctl = w2.socks.find((x) => x.last('welcome')?.controller);
  ctl.say({
    t: 'cmd',
    reqId: 99,
    cmd: { type: 'screens', target: 4, patch: { role: 'map' } },
  });
  assert.equal(ctl.last('ack').ok, true);
  w2.relay.presenceTick();

  assertNoLeak(w);
  assertNoLeak(w2);
  // The whole state, and presence as each socket sees it.
  assert.deepEqual(findIn(w.host.state, ALL_IDS), []);
  assert.deepEqual(findIn(w2.host.state, ALL_IDS), []);
  // Every attribution in state is a ref (or null).
  const bys = [];
  for (const s of Object.values(w2.host.state.screens))
    for (const m of Object.values(s.meta || {})) bys.push(m.by);
  for (const m of Object.values(w2.host.state.session.meta || {}))
    bys.push(m.by);
  bys.push(w.host.state.lastUndo?.by);
  assert.ok(bys.length > 5);
  for (const b of bys) assert.ok(b === null || isRef(b), `meta.by ${b}`);
});

test('K5 T8.2: two remotes, Laptop and iPad, hand over control; each broadcast names the device that acted (ref, kind, name, via touch)', () => {
  const w = world();
  const setup = w.launch(2);
  const wall = w.join(ID.s1, { kind: 'screen', setup, slot: 1 });
  const laptop = w.join(ID.laptop, { kind: 'remote', setup, name: 'Laptop' });
  const ipad = w.join(ID.ipad, { kind: 'remote', setup, name: 'iPad' });
  assert.equal(laptop.last('welcome').controller, true);
  laptop.say({
    t: 'cmd',
    reqId: 1,
    cmd: { type: 'screens', target: 1, patch: { role: 'day' } },
  });
  ipad.say({ t: 'request-control' });
  laptop.say({ t: 'handover', accept: true });
  ipad.say({
    t: 'cmd',
    reqId: 2,
    cmd: { type: 'screens', target: 1, patch: { mode: 'advance' } },
  });
  const u = ipad.last('ack').undoId;
  ipad.say({ t: 'undo', reqId: 3, undoId: u });
  const changes = wall.all('state').filter((m) => m.by);
  assert.deepEqual(
    changes.map((m) => [m.cause, m.by.name, m.by.kind, m.by.via]),
    [
      [CAUSE.CMD, 'Laptop', 'remote', VIA.TOUCH],
      [CAUSE.CMD, 'iPad', 'remote', VIA.TOUCH],
      [CAUSE.UNDO, 'iPad', 'remote', VIA.TOUCH],
    ],
  );
  const [l, i] = [changes[0].by.ref, changes[1].by.ref];
  assert.ok(isRef(l) && isRef(i) && l !== i);
  assert.equal(changes[2].by.ref, i);
  // The state names the same refs.
  const meta = wall.last('state').state.screens[1].meta;
  assert.equal(meta.role.by, l);
  assert.equal(wall.last('state').state.lastUndo.by, i);
  assert.equal(
    wall.last('state').state.lastUndo.of,
    changes[1].rev ??
      wall
        .all('state')
        .filter((m) => m.cause === CAUSE.CMD)
        .at(-1).state.rev,
  );
  // The ack says nothing about who: the broadcast does.
  assert.equal(ipad.last('ack').by, undefined);
});

test('K5 T8.3, CF-D8: two iPads are "iPad" and "iPad 2"; a remote on this computer is "Trip Twin computer"; a name the page makes up is never shown', () => {
  const w = world();
  const setup = w.launch(1);
  const a = w.join('remote-ipad-a-0001', {
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  const b = w.join('remote-ipad-b-0002', {
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  const odd = w.join('remote-odd-0003', {
    kind: 'remote',
    setup,
    name: 'Mallory <b>EV</b>',
  });
  const here = w.join(
    'remote-here-0004',
    { kind: 'remote', setup, name: 'Laptop' },
    { local: true },
  );
  const p = here.last('presence')?.presence || here.last('welcome').presence;
  const names = p.remotes.map((r) => r.name);
  assert.deepEqual(names, ['iPad', 'iPad 2', 'Laptop', HOST_NAME]);
  assert.equal(new Set(p.remotes.map((r) => r.ref)).size, 4);
  // A later hello cannot rename a device: the host named it at pairing.
  const again = w.join('remote-ipad-b-0002', {
    kind: 'remote',
    name: 'Phone',
    token: w.tokens['remote-ipad-b-0002'],
  });
  const p2 = again.last('welcome').presence;
  assert.equal(p2.remotes.find((r) => r.you).name, 'iPad 2');
  assert.ok(!JSON.stringify(p2).includes('Mallory'));
  void a;
  void b;
  void odd;
});

test('K5 F-0003: a ref still names its device after the device is gone (a restart without it; a screen whose slot went to another)', () => {
  const w = world();
  const setup = w.launch(2);
  const ipad = w.join(ID.ipad, { kind: 'remote', setup, name: 'iPad' });
  ipad.say({
    t: 'cmd',
    reqId: 1,
    cmd: { type: 'screens', target: 2, patch: { role: 'day' } },
  });
  const ref = w.host.state.screens[2].meta.role.by;
  assert.equal(w.host.actor(ref).name, 'iPad');
  // The device record is gone (as after a Forget), the ref table is not.
  const snap = JSON.parse(JSON.stringify(w.host.snapshot()));
  snap.devices = snap.devices.filter(([id]) => id !== ID.ipad);
  snap.lease = { holder: null, at: 0 };
  const w2 = world({ restore: snap });
  assert.equal(w2.host.state.screens[2].meta.role.by, ref);
  assert.deepEqual(w2.host.actor(ref), {
    ref,
    kind: 'remote',
    name: 'iPad',
    slot: null,
    via: VIA.TOUCH,
  });
  // Presence still resolves it (offline) because the state names it.
  const seen = w2.host.presence().actors.find((x) => x.ref === ref);
  assert.deepEqual(seen, {
    ref,
    kind: 'remote',
    name: 'iPad',
    slot: null,
    online: false,
  });
  // A new remote (after a new setup) never takes the old ref; the ref
  // table still names it.
  const next = w2.join('remote-new-ipad-0005', {
    kind: 'remote',
    setup: w2.host.setup({ count: 2 }).setup,
    name: 'iPad',
  });
  const mine = next.last('welcome').presence.remotes.find((r) => r.you);
  assert.notEqual(mine.ref, ref);
  assert.equal(w2.host.actor(ref).name, 'iPad');
  // A screen whose slot went to another device keeps naming itself.
  const w3 = world();
  const st = w3.launch(2);
  w3.join(ID.s1, { kind: 'screen', setup: st, slot: 1 });
  const s1ref = w3.host.presence().screens[1].ref;
  w3.join(ID.s3, { kind: 'screen', setup: st, slot: 1 });
  assert.notEqual(w3.host.presence().screens[1].ref, s1ref);
  assert.equal(w3.host.actor(s1ref).name, 'S1');
});

test('K5: a restart keeps refs, names and the ref table; a screen moved to another slot gets a new ref, so an old label never changes', () => {
  const w = world();
  const setup = w.launch(3);
  w.join(ID.s1, { kind: 'screen', setup, slot: 1 });
  w.join(ID.ipad, { kind: 'remote', setup, name: 'iPad' });
  w.join(ID.laptop, { kind: 'remote', setup, name: 'iPad' });
  const before = w.host.presence();
  const snap = JSON.parse(JSON.stringify(w.host.snapshot()));
  assert.ok(Number.isInteger(snap.nextRef));
  assert.ok(Object.keys(snap.refs).every(isRef));
  assert.equal(snap.refs[HOST_REF], undefined, 'the host is not in the table');
  const w2 = world({ restore: snap });
  const after = w2.host.presence();
  assert.deepEqual(
    after.remotes.map((r) => [r.ref, r.name]),
    before.remotes.map((r) => [r.ref, r.name]),
  );
  assert.equal(after.screens[1].ref, before.screens[1].ref);
  // The S1 device moves to S3 (a new pairing): a new ref named S3.
  const st = w2.host.setup({ count: 3 }).setup;
  w2.join(ID.s1, {
    kind: 'screen',
    setup: st,
    slot: 3,
    token: w.tokens[ID.s1],
  });
  const moved = w2.host.presence().screens[3].ref;
  assert.notEqual(moved, before.screens[1].ref);
  assert.equal(w2.host.actor(moved).name, 'S3');
  assert.equal(w2.host.actor(before.screens[1].ref).name, 'S1');
  // Refs are sequential and never reused.
  const nums = Object.keys(w2.host.snapshot().refs).map((r) =>
    Number(r.slice(1)),
  );
  assert.equal(new Set(nums).size, nums.length);
  assert.ok(w2.host.snapshot().nextRef > Math.max(...nums));
});

test('K5 restore migration: a pre-K5 store’s device ids in meta.by and lastUndo.by become refs; "setup" becomes the host; anything else becomes null', () => {
  const session = createSession({ count: 3, epochMs: 1 });
  session.screens[1].meta = {
    role: { source: 'override', rev: 3, by: ID.ipad, at: 10 },
    layers: { source: 'all', rev: 4, by: 'remote', at: 11 },
  };
  session.screens[2].meta = {
    mode: { source: 'override', rev: 5, by: 'ghost-device-id-0000', at: 12 },
    count: { source: 'override', rev: 1, by: 'setup', at: 1 },
  };
  session.lastUndo = { by: ID.ipad, at: 20 };
  const restore = {
    session,
    devices: [
      [
        ID.ipad,
        { kind: 'remote', name: 'iPad', token: 'tok-ipad', lastSeen: 5 },
      ],
      [
        ID.laptop,
        { kind: 'remote', name: 'QA iPad', token: 'tok-lap', lastSeen: 6 },
      ],
      [ID.s1, { kind: 'screen', slot: 1, token: 'tok-s1', lastSeen: 7 }],
      [ID.tv, { kind: 'screen', lastSeen: 8 }], // waiting for a code
    ],
    lease: { holder: ID.ipad, at: 9 },
  };
  const host = createSessionHost({ now: () => 100, restore });
  const st = host.state;
  const ipadRef = st.screens[1].meta.role.by;
  assert.ok(isRef(ipadRef));
  assert.equal(host.actor(ipadRef).name, 'iPad');
  assert.equal(st.screens[1].meta.layers.by, null);
  assert.equal(st.screens[2].meta.mode.by, null);
  assert.equal(st.screens[2].meta.count.by, HOST_REF);
  assert.equal(st.lastUndo.by, ipadRef);
  assert.deepEqual(findIn(st, ALL_IDS), []);
  // Old free-text names become kind names; the waiting screen has no ref.
  const p = host.presence();
  assert.deepEqual(p.remotes.map((r) => r.name).sort(), ['Laptop', 'iPad']);
  assert.ok(isRef(p.screens[1].ref));
  const snap = host.snapshot();
  assert.equal(snap.devices.find(([id]) => id === ID.tv)[1].ref, undefined);
  assert.equal(Object.keys(snap.refs).length, 3);
});

test('K5 revert: a store written by the K4 build (refs on device records, no ref table) still names the same devices, and a remote paired meanwhile gets a new ref', () => {
  const w = world();
  const setup = w.launch(2);
  w.join(ID.s1, { kind: 'screen', setup, slot: 1 });
  const ipad = w.join(ID.ipad, { kind: 'remote', setup, name: 'iPad' });
  ipad.say({
    t: 'cmd',
    reqId: 1,
    cmd: { type: 'screens', target: 1, patch: { role: 'day' } },
  });
  const ref = w.host.state.screens[1].meta.role.by;
  // What K4's docOf writes: no refs, no nextRef; it rewrote the iPad's
  // record on a hello (no ref) and paired another iPad (no ref).
  const snap = JSON.parse(JSON.stringify(w.host.snapshot()));
  delete snap.refs;
  delete snap.nextRef;
  snap.devices.push([
    ID.laptop,
    { kind: 'remote', name: 'iPad', token: 'tok-k4', lastSeen: 1 },
  ]);
  const host = createSessionHost({ now: () => 2_000_000, restore: snap });
  assert.equal(host.state.screens[1].meta.role.by, ref);
  assert.equal(host.actor(ref).name, 'iPad');
  const names = host.presence().remotes.map((r) => [r.ref, r.name]);
  assert.equal(names.length, 2);
  const other = names.find(([r]) => r !== ref);
  assert.deepEqual(other[1], 'iPad 2');
  assert.ok(Number(other[0].slice(1)) > Number(ref.slice(1)));
  // K4 also rewrites a remote's record on its hello, ref and all: that
  // ref is never issued again, and the change it made reads "by nobody"
  // rather than by the wrong device.
  const k4 = JSON.parse(JSON.stringify(snap));
  const rec = k4.devices.find(([id]) => id === ID.ipad)[1];
  delete rec.ref;
  k4.devices = k4.devices.filter(([id]) => id !== ID.laptop);
  const h2 = createSessionHost({ now: () => 2_000_000, restore: k4 });
  assert.equal(h2.state.screens[1].meta.role.by, null);
  const back = h2.presence().remotes[0];
  assert.equal(back.name, 'iPad');
  assert.ok(Number(back.ref.slice(1)) > Number(ref.slice(1)), back.ref);
});

test('K5 S-18, F-0009: a by, via or name beside cmd is ignored; inside cmd it is refused VALIDATION_COMMAND and nothing changes', () => {
  const w = world();
  const setup = w.launch(2);
  const wall = w.join(ID.s1, { kind: 'screen', setup, slot: 1 });
  const ipad = w.join(ID.ipad, { kind: 'remote', setup, name: 'iPad' });
  ipad.say({
    t: 'cmd',
    reqId: 1,
    by: { ref: 'D99', name: 'Voice', kind: 'host' },
    via: 'voice',
    name: 'Trip Twin computer',
    cmd: { type: 'screens', target: 1, patch: { role: 'day' } },
  });
  assert.equal(ipad.last('ack').ok, true);
  const by = wall.last('state').by;
  assert.equal(by.name, 'iPad');
  assert.equal(by.via, VIA.TOUCH);
  assert.notEqual(by.ref, 'D99');
  const rev = w.host.state.rev;
  for (const k of ['by', 'via', 'name', 'actor', 'ref', 'proposalId']) {
    ipad.say({
      t: 'cmd',
      reqId: 2,
      cmd: {
        type: 'screens',
        target: 1,
        patch: { mode: 'advance' },
        [k]: 'voice',
      },
    });
    const ack = ipad.last('ack');
    assert.equal(ack.ok, false, k);
    assert.equal(ack.code, CODE.VALIDATION_COMMAND, k);
    assert.match(ack.error, new RegExp(`^Not applied: ${k} is not valid$`));
  }
  assert.equal(w.host.state.rev, rev, 'nothing applied');
  assert.equal(w.host.state.screens[1].mode, 'live');
});

test('K5: walls still see a truthy `by` after a command and after an undo; setup, pairing and a wall joining carry a cause and no `by`', () => {
  const w = world();
  const setup = w.launch(3);
  const wall = w.join(ID.s1, { kind: 'screen', setup, slot: 1 });
  const ipad = w.join(ID.ipad, { kind: 'remote', setup, name: 'iPad' });
  const tv = w.join(ID.tv, { kind: 'screen' });
  ipad.say({ t: 'pair', reqId: 1, code: tv.last('welcome').code, slot: 2 });
  w.join(ID.s3, { kind: 'screen', setup, slot: 3 }); // another wall joins
  ipad.say({
    t: 'cmd',
    reqId: 2,
    cmd: { type: 'screens', target: 2, patch: { role: 'day' } },
  });
  ipad.say({ t: 'undo', reqId: 3, undoId: ipad.last('ack').undoId });
  const seen = wall
    .all('state')
    .map((m) => [m.cause, Boolean(m.by), Boolean(m.undone)]);
  assert.deepEqual(seen, [
    [CAUSE.JOIN, false, false], // this wall's own join
    [CAUSE.PAIR, false, false],
    [CAUSE.JOIN, false, false],
    [CAUSE.CMD, true, false],
    [CAUSE.UNDO, true, true],
  ]);
  // Only an accepted wall hears state; the launcher heard the setup one.
  assert.equal(w.socks[0].all('state')[0].cause, CAUSE.SETUP);
  assert.deepEqual(wall.last('state').undone, {
    of: wall.all('state').at(-2).state.rev,
  });
});

test('K5: setup and pairing are written by the host (D0, Trip Twin computer, via system); session fields get session.meta like screen fields', () => {
  const w = world();
  const setup = w.launch(2);
  const ipad = w.join(ID.ipad, { kind: 'remote', setup, name: 'iPad' });
  const st = w.host.state;
  assert.equal(st.session.meta.tripId.by, HOST_REF);
  assert.equal(st.session.meta.tripId.source, 'session');
  assert.deepEqual(w.host.actor(HOST_REF), {
    ref: HOST_REF,
    kind: 'host',
    name: HOST_NAME,
    slot: null,
    via: VIA.SYSTEM,
  });
  // Pairing into a slot past the count grows the wall as the host.
  const tv = w.join(ID.tv, { kind: 'screen' });
  ipad.say({ t: 'pair', reqId: 1, code: tv.last('welcome').code, slot: 5 });
  assert.equal(w.host.state.screens[5].meta?.count, undefined);
  ipad.say({
    t: 'cmd',
    reqId: 2,
    cmd: { type: 'session', patch: { visitor: true } },
  });
  const m = w.host.state.session.meta.visitor;
  assert.equal(m.by, w.host.presence().remotes[0].ref);
  assert.equal(m.rev, w.host.state.rev);
  ipad.say({ t: 'cmd', reqId: 3, cmd: { type: 'returnLive' } });
  assert.equal(w.host.state.session.meta.simStorm.by, m.by);
});

test('K5: presence carries actors (no ids) and the controller’s controlSince; a handover names fromRef', () => {
  const w = world();
  const setup = w.launch(1);
  w.join(ID.s1, { kind: 'screen', setup, slot: 1 });
  const ipad = w.join(ID.ipad, { kind: 'remote', setup, name: 'iPad' });
  w.tick(5000);
  const laptop = w.join(ID.laptop, { kind: 'remote', setup, name: 'Laptop' });
  laptop.say({ t: 'request-control' });
  const p = ipad.last('presence').presence;
  const ctl = p.remotes.find((r) => r.controller);
  assert.equal(ctl.name, 'iPad');
  assert.equal(ctl.controlSince, 1_000_000);
  assert.equal(p.remotes.find((r) => !r.controller).controlSince, null);
  assert.equal(p.handover.fromName, 'Laptop');
  assert.equal(
    p.handover.fromRef,
    p.remotes.find((r) => r.name === 'Laptop').ref,
  );
  assert.deepEqual(
    p.actors.map((a) => [a.ref, a.kind, a.name, a.slot, a.online]),
    [
      [HOST_REF, 'host', HOST_NAME, null, true],
      [p.actors[1].ref, 'screen', 'S1', 1, true],
      [ctl.ref, 'remote', 'iPad', null, true],
      [p.handover.fromRef, 'remote', 'Laptop', null, true],
    ],
  );
  // Heartbeats renew the lease but not controlSince; a handover resets it.
  w.tick(5000);
  ipad.say({ t: 'hb' });
  ipad.say({ t: 'handover', accept: true });
  const p2 = laptop.last('presence').presence;
  assert.equal(p2.remotes.find((r) => r.controller).name, 'Laptop');
  assert.equal(p2.remotes.find((r) => r.controller).controlSince, 1_010_000);
  assertNoLeak(w);
});

test('K5 SEC-11: a pair result names the slot only, never the screen’s id or token', () => {
  const w = world();
  const setup = w.launch(1);
  const ipad = w.join(ID.ipad, { kind: 'remote', setup, name: 'iPad' });
  const tv = w.join(ID.tv, { kind: 'screen' });
  ipad.say({ t: 'pair', reqId: 4, code: tv.last('welcome').code, slot: 3 });
  w.keep(ID.tv, tv);
  const r = ipad.last('pair-result');
  assert.deepEqual(Object.keys(r).sort(), ['ok', 'reqId', 'slot', 't']);
  assert.ok(tv.last('paired').token, 'the screen itself gets its token');
  assertNoLeak(w);
});

test('K5 clockHost: the shared fake-clock host attributes setup to the host', () => {
  const { host } = clockHost();
  assert.equal(host.state.session.meta.tripId.by, HOST_REF);
});
