// Trip Twin lost pairing identity (Phase CF K4; CF-2, BE-7, BE-8, SEC-9,
// C16, S-16, S-23; cf/06-qa.md QA-4 T4.2, T4.3). The unit repros R-1 … R-3
// from 02 BE-7, the one-identity rule in the relay, and twinSync.js with
// twinIdentity.js in a fake browser (shared localStorage and Web Locks per
// origin, sessionStorage per window, sockets bridged to a real relay, a
// fake clock). Assertion messages carry slots and codes, never tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  fakeBrowser,
  fakeSocket,
  fakeTimers,
  fakeViteRelay,
  settle,
  setupOf,
} from './twinTestKit.mjs';
import { SETUP_TTL_MS, createSessionHost } from './twinSessionHost.js';
import {
  CLOSE,
  DENY,
  REPLACED,
  TERMINAL_DENY,
  UNPAIRED,
} from './twinProtocol.js';
import {
  REMOTE_KEY,
  localhostUrl,
  newDeviceId,
  sessionKey,
  slotKey,
  tokenKey,
} from './twinIdentity.js';
import { connectSync } from './twinSync.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-identity-test-'));
process.env.TMPDIR = path.join(scratch, 'tmp');
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
fs.mkdirSync(process.env.TMPDIR);
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const { createRelay, twinSyncRelay } =
  await import('../../../server/tripTwin/syncRelay.js');

const ORIGIN = 'http://localhost:4173';

/** A relay on a fake clock, and the setup a local launcher started. */
function world({ locks = true, count = 6 } = {}) {
  const timers = fakeTimers();
  const host = createSessionHost({ now: timers.now });
  const relay = createRelay({ host });
  const l = fakeSocket();
  relay.attach(l);
  l.say({ t: 'hello', id: 'launcher-k4', kind: 'launcher' });
  l.say({ t: 'setup', count });
  const b = fakeBrowser({ relay, timers, locks });
  return { timers, host, relay, b, setup: setupOf(l), launcher: l };
}

/**
 * A wall page: twinSync.js as twinScreen.js uses it (its `unpaired`
 * handler forgets, as the real one does). `w.got` is every message.
 */
function wall(
  b,
  {
    slot = null,
    setup = null,
    opener = null,
    before,
    withLocks,
    origin = ORIGIN,
  } = {},
) {
  const q = new URLSearchParams({ view: 'screen' });
  if (slot) q.set('slot', String(slot));
  if (setup) q.set('setup', setup);
  const w = b.window({ href: `${origin}/twin.html?${q}`, opener, withLocks });
  before?.(w);
  w.got = [];
  const on = new Proxy(
    {},
    {
      get: (_, t) =>
        t === 'status'
          ? () => {}
          : (m) => {
              w.got.push(m);
              if (t === 'unpaired') w.sync.forget();
            },
    },
  );
  w.sync = connectSync({ kind: 'screen', slot, setup, on, env: w.env });
  return w;
}
/** What the relay said to this window, refusals handled inside included. */
const said = (w) => w.sockets.flatMap((x) => x.srv?.out || []);
const lastOf = (w, t) => [...w.got].reverse().find((m) => m.t === t);
const welcome = (w) => lastOf(w, 'welcome');
const rec = (b, key) => JSON.parse(b.local().getItem(key) || 'null');
const online = (host, slot) => host.presence().screens[slot]?.online;

// ---- Unit repros (02 BE-7) ---------------------------------------------

test('K4 R-1: a wall window opened again after its setup link expired rejoins S4 by its slot record; a new id is told why', async () => {
  const { b, host, timers, setup } = world({ locks: false });
  const a = wall(b, { slot: 4, setup });
  await settle();
  assert.equal(welcome(a).type, 'paired');
  assert.equal(welcome(a).slot, 4);
  a.sync.close(); // the S4 window is closed
  await settle();
  await timers.run(SETUP_TTL_MS + 60_000);
  // "Open S4" again: a new window (no sessionStorage), the expired link.
  const again = wall(b, { slot: 4, setup });
  await settle();
  assert.equal(welcome(again).type, 'paired', 'the reopened window rejoins');
  assert.equal(welcome(again).slot, 4);
  assert.equal(lastOf(again, 'welcome').type, 'paired');
  assert.equal(again.sync.id, a.sync.id, 'the same device as before');
  assert.equal(online(host, 4), true);
  // A window with no record (another profile) is told why, then gets a code.
  const stranger = host.hello({
    id: 'screen-new',
    kind: 'screen',
    setup,
    slot: 4,
  });
  assert.equal(stranger.type, 'denied');
  assert.equal(stranger.code, DENY.TICKET_EXPIRED);
  assert.match(stranger.error, /expired/);
  assert.equal(
    host.hello({ id: 'screen-new', kind: 'screen', slot: 4 }).type,
    'pair-code',
  );
});

test('K4 R-2: one id said hello for S3, then for S4 while S3 is live: the copy is told ID_COPIED and S3 keeps its slot', () => {
  const { relay, host, setup } = world();
  const s3 = fakeSocket();
  relay.attach(s3);
  s3.say({ t: 'hello', id: 'screen-shared', kind: 'screen', setup, slot: 3 });
  const tok = s3.last('welcome').token;
  const s4 = fakeSocket();
  relay.attach(s4);
  s4.say({
    t: 'hello',
    id: 'screen-shared',
    kind: 'screen',
    setup,
    slot: 4,
    token: tok,
  });
  const w = s4.last('welcome');
  assert.equal(w.type, 'denied');
  assert.equal(w.code, DENY.ID_COPIED);
  assert.equal(host.slotOf('screen-shared'), 3, 'S3 kept its device');
  assert.equal(online(host, 3), true);
  assert.equal(s3.last(REPLACED), undefined, 'S3 is not replaced by a copy');
  // The client takes a fresh id and asks again on the same socket.
  s4.say({ t: 'hello', id: 'screen-fresh', kind: 'screen', setup, slot: 4 });
  assert.equal(s4.last('welcome').type, 'paired');
  assert.equal(online(host, 3) && online(host, 4), true, 'S3 and S4 both live');
});

test('K4 R-3: a save cut off half-way leaves the last good store, and the wall rejoins through the relay', async () => {
  const data = path.join(scratch, 'r3');
  process.env.TRIP_TWIN_DATA_DIR = data;
  try {
    const v1 = fakeViteRelay(twinSyncRelay());
    const setup = (await v1.hello({ t: 'setup', count: 2 })).setup;
    const w1 = await v1.hello({
      t: 'hello',
      id: 'screen-r3',
      kind: 'screen',
      setup,
      slot: 1,
    });
    assert.equal(w1.type, 'paired');
    v1.close(); // flushes the store
    const store = path.join(data, 'session.json');
    const text = fs.readFileSync(store, 'utf8');
    fs.writeFileSync(
      `${store}.tmp`,
      text.slice(0, Math.floor(text.length / 2)),
    );
    const v2 = fakeViteRelay(twinSyncRelay());
    try {
      const w2 = await v2.hello({
        t: 'hello',
        id: 'screen-r3',
        kind: 'screen',
        token: w1.token,
      });
      assert.equal(w2.type, 'paired');
      assert.equal(w2.slot, 1);
      assert.equal(
        fs.existsSync(`${store}.tmp`),
        false,
        'the torn temp file is gone, unread',
      );
    } finally {
      v2.close();
    }
  } finally {
    process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
  }
});

// ---- The relay: one live identity per id (C16) -------------------------

test('K4 T4.2: two sockets with one id and token for one slot: the older gets {t:"replaced"} and 4003, and its close leaves the wall online', () => {
  const { relay, host, setup } = world();
  const a = fakeSocket();
  relay.attach(a);
  a.say({ t: 'hello', id: 'screen-dup', kind: 'screen', setup, slot: 2 });
  const tok = a.last('welcome').token;
  const b = fakeSocket();
  relay.attach(b);
  b.say({ t: 'hello', id: 'screen-dup', kind: 'screen', slot: 2, token: tok });
  assert.equal(b.last('welcome').type, 'paired');
  assert.ok(a.last(REPLACED), 'the older socket is told');
  assert.equal(a.last('unpaired'), undefined, 'never as unpaired (sec S13)');
  assert.equal(a.closeCode, CLOSE.REPLACED);
  assert.equal(online(host, 2), true, 'the survivor keeps S2 online');
  // Broadcasts reach only the survivor.
  const before = a.out.length;
  relay.presenceTick();
  assert.equal(a.out.length, before);
  assert.ok(b.last('presence'));
  // Same for a remote (no slot): the newest tab is the remote.
  const r1 = fakeSocket();
  relay.attach(r1);
  r1.say({ t: 'hello', id: 'remote-k4', kind: 'remote', setup, name: 'iPad' });
  const r2 = fakeSocket();
  relay.attach(r2);
  r2.say({
    t: 'hello',
    id: 'remote-k4',
    kind: 'remote',
    token: r1.last('welcome').token,
  });
  assert.equal(r2.last('welcome').type, 'remote');
  assert.equal(r1.closeCode, CLOSE.REPLACED);
  assert.equal(host.presence().remotes.filter((r) => r.online).length, 1);
  // A wrong token never replaces anyone.
  const evil = fakeSocket();
  relay.attach(evil, { isLocal: false });
  evil.say({
    t: 'hello',
    id: 'screen-dup',
    kind: 'screen',
    slot: 2,
    token: 'wrong',
  });
  assert.equal(evil.last('welcome').code, DENY.ID_IN_USE);
  assert.equal(b.last(REPLACED), undefined);
  assert.equal(online(host, 2), true);
});

test('K4: paired goes only to the socket that showed the code (SEC-9 rule 2)', () => {
  const { relay, setup } = world();
  const r = fakeSocket();
  relay.attach(r);
  r.say({ t: 'hello', id: 'remote-k4', kind: 'remote', setup, name: 'iPad' });
  const s = fakeSocket();
  relay.attach(s);
  s.say({ t: 'hello', id: 'screen-code', kind: 'screen' });
  const { code } = s.last('welcome');
  // Another socket says hello with the same id (no token): the first is
  // replaced, and only the newer one may receive the pairing.
  const copy = fakeSocket();
  relay.attach(copy);
  copy.say({ t: 'hello', id: 'screen-code', kind: 'screen' });
  const code2 = copy.last('welcome').code;
  r.say({ t: 'pair', reqId: 1, code: code2, slot: 6 });
  assert.equal(r.last('pair-result').ok, true);
  assert.ok(copy.last('paired'), 'the asking socket is paired');
  assert.equal(copy.last('paired').slot, 6);
  assert.equal(s.last('paired'), undefined, 'nothing to the replaced socket');
  assert.notEqual(code, undefined);
});

test('K4: a second hello on one socket is refused ALREADY_IDENTIFIED and the socket is closed (4002)', () => {
  const { relay, setup } = world();
  const s = fakeSocket();
  relay.attach(s);
  s.say({ t: 'hello', id: 'screen-one', kind: 'screen', setup, slot: 1 });
  assert.equal(s.last('welcome').type, 'paired');
  s.say({ t: 'hello', id: 'screen-other', kind: 'screen', setup, slot: 2 });
  assert.equal(s.last('welcome').code, DENY.ALREADY_IDENTIFIED);
  assert.equal(s.closeCode, CLOSE.ALREADY_IDENTIFIED);
  assert.equal(relay.host.slotOf('screen-other'), null, 'no second identity');
});

test('K4 deny codes: every hello refusal carries a code from twinProtocol.js and readable text', async () => {
  const t = fakeTimers();
  const host = createSessionHost({ now: t.now });
  const setup = host.setup({ count: 2 }).setup;
  const r = host.hello({ id: 'remote-a', kind: 'remote', setup, name: 'iPad' });
  const rows = [
    [{ id: '', kind: 'screen' }, DENY.NO_ID],
    [{ id: 'remote-a', kind: 'remote', token: 'wrong' }, DENY.ID_IN_USE],
    [{ id: 'remote-a', kind: 'screen', token: r.token }, DENY.ID_IN_USE],
    [{ id: 'x', kind: 'printer' }, DENY.UNKNOWN_KIND],
    [{ id: 'remote-b', kind: 'remote' }, DENY.NOT_TRUSTED],
    [
      { id: 'remote-b', kind: 'remote', token: 'from-a-lost-store' },
      DENY.FORGOTTEN,
    ],
    [{ id: 'L', kind: 'launcher' }, DENY.NOT_TRUSTED],
  ];
  for (const [hello, code] of rows) {
    const got = host.hello(hello);
    assert.equal(
      got.type,
      'denied',
      JSON.stringify({ ...hello, token: undefined }),
    );
    assert.equal(got.code, code);
    assert.ok(got.error && typeof got.error === 'string');
    assert.ok(Object.values(DENY).includes(got.code));
  }
  await t.run(SETUP_TTL_MS + 1);
  for (const kind of ['remote', 'screen', 'launcher'])
    assert.equal(
      host.hello({ id: `${kind}-late`, kind, setup, slot: 2 }).code,
      DENY.TICKET_EXPIRED,
      kind,
    );
  // A remote with a stale token from a lost store can still pair by a QR.
  const fresh = host.setup({ count: 2 }).setup;
  assert.equal(
    host.hello({
      id: 'remote-b',
      kind: 'remote',
      setup: fresh,
      token: 'from-a-lost-store',
    }).type,
    'remote',
  );
  assert.deepEqual([...TERMINAL_DENY].sort(), [
    'FORGOTTEN',
    'ID_IN_USE',
    'TICKET_EXPIRED',
    'TICKET_USED',
    'TOKEN_EXPIRED',
  ]);
});

test('K4 T4.3: after a restore every device rejoins with its token; a stale token is refused ID_IN_USE with a code', () => {
  const t = fakeTimers();
  const a = createSessionHost({ now: t.now });
  const setup = a.setup({ count: 3 }).setup;
  const toks = {};
  for (const s of [1, 2, 3])
    toks[s] = a.hello({
      id: `screen-${s}`,
      kind: 'screen',
      setup,
      slot: s,
    }).token;
  const rt = a.hello({
    id: 'remote-1',
    kind: 'remote',
    setup,
    name: 'iPad',
  }).token;
  const b = createSessionHost({
    now: t.now,
    restore: JSON.parse(JSON.stringify(a.snapshot())),
  });
  for (const s of [1, 2, 3]) {
    const w = b.hello({
      id: `screen-${s}`,
      kind: 'screen',
      token: toks[s],
      slot: s,
    });
    assert.equal(w.type, 'paired');
    assert.equal(w.slot, s);
  }
  assert.equal(
    b.hello({ id: 'remote-1', kind: 'remote', token: rt }).type,
    'remote',
  );
  const stale = b.hello({
    id: 'screen-2',
    kind: 'screen',
    token: 'old',
    slot: 2,
  });
  assert.equal(stale.code, DENY.ID_IN_USE);
  assert.match(stale.error, /in use/);
});

// ---- The client: twinSync.js + twinIdentity.js --------------------------

for (const locks of [false, true])
  test(`K4 ET S2: duplicate → old window replaced → winner reloads → still paired (${locks ? 'Web Locks' : 'no Web Locks, as on a LAN address'})`, async () => {
    const { b, host, timers, setup } = world({ locks });
    const a = wall(b, { slot: 2, setup });
    await settle();
    assert.equal(welcome(a).type, 'paired');
    const id = a.sync.id;
    // Tab › Duplicate: the copy gets a copy of A's sessionStorage.
    const copy = wall(b, { slot: 2, opener: a });
    await settle();
    assert.equal(welcome(copy).type, 'paired');
    assert.equal(welcome(copy).slot, 2);
    assert.equal(copy.sync.id, id, 'one device: the slot record');
    assert.ok(lastOf(a, REPLACED), 'the older window is told');
    assert.equal(a.sync.stopped, 'replaced');
    assert.equal(lastOf(a, 'unpaired'), undefined);
    assert.equal(online(host, 2), true);
    const tok = rec(b, slotKey(2)).token;
    assert.ok(tok, 'the slot record keeps its token');
    assert.equal(b.local().getItem(tokenKey(id)), tok, 'the old key too');
    // The old window never reconnects and never clears anything.
    await timers.run(5 * 60_000);
    assert.equal(a.sockets.length, 1, 'no reconnect from the replaced window');
    assert.equal(rec(b, slotKey(2)).token, tok);
    // The winner reloads: same tab, same sessionStorage, the same device.
    copy.sync.close();
    await settle();
    const reloaded = wall(b, { slot: 2, opener: copy });
    await settle();
    assert.equal(welcome(reloaded).type, 'paired', 'still paired');
    assert.equal(welcome(reloaded).slot, 2);
    assert.equal(
      reloaded.got.some((m) => m.type === 'pair-code'),
      false,
    );
    assert.equal(online(host, 2), true);
  });

test('K4 sec S13: an old page (base unpaired handler) that is replaced never wipes the winner’s token', async () => {
  const { b, relay, host, setup } = world({ locks: false });
  const first = wall(b, { slot: 3, setup });
  await settle();
  const id = first.sync.id;
  const tok = rec(b, slotKey(3)).token;
  first.sync.close();
  await settle();
  // The same identity on a page still running the base client.
  const old = fakeSocket();
  relay.attach(old);
  old.say({ t: 'hello', id, kind: 'screen', slot: 3, token: tok });
  assert.equal(old.last('welcome').type, 'paired');
  const baseHandler = (m) => {
    // twinScreen.js at 3431392: unpaired → sync.forget() → token.<id> gone.
    if (m.t === 'unpaired') b.local().removeItem(tokenKey(id));
  };
  // A K4 window takes over the slot; the old page is replaced.
  const winner = wall(b, { slot: 3 });
  await settle();
  assert.equal(welcome(winner).type, 'paired');
  for (const m of old.out) baseHandler(m);
  assert.ok(old.last(REPLACED));
  assert.equal(
    old.all('unpaired').length,
    0,
    'the relay never sends unpaired here',
  );
  assert.equal(b.local().getItem(tokenKey(id)), tok, 'the token survives');
  winner.sync.close();
  await settle();
  const reload = wall(b, { slot: 3 });
  await settle();
  assert.equal(welcome(reload).type, 'paired');
  assert.equal(online(host, 3), true);
});

test('K4 sup S13: without Web Locks, S5 closed after its link expired and opened again comes back as S5 with no code', async () => {
  const { b, timers, setup, host } = world({ locks: false });
  const a = wall(b, { slot: 5, setup, withLocks: false });
  await settle();
  assert.equal(welcome(a).type, 'paired');
  a.sync.close();
  await settle();
  await timers.run(SETUP_TTL_MS + 5 * 60_000);
  for (const url of [setup, null]) {
    // Opened again from the launcher (expired link), or restored (no link).
    const w = wall(b, { slot: 5, setup: url, withLocks: false });
    await settle();
    assert.equal(welcome(w).type, 'paired');
    assert.equal(welcome(w).slot, 5);
    assert.equal(
      w.got.some((m) => m.type === 'pair-code' || m.type === 'denied'),
      false,
    );
    w.sync.close();
    await settle();
  }
  assert.equal(host.presence().screens[5].online, false);
});

test('K4 S-16: a remote with a forgotten token on loopback stops retrying after one terminal deny', async () => {
  const { b, timers, setup } = world();
  const r = b.window({ href: `${ORIGIN}/twin-remote.html?setup=${setup}` });
  r.got = [];
  r.sync = connectSync({
    kind: 'remote',
    setup,
    name: 'Laptop',
    env: r.env,
    on: { welcome: (m) => r.got.push(m) },
  });
  await settle();
  assert.equal(r.got.at(-1).type, 'remote');
  const firstId = r.sync.id;
  assert.equal(
    rec(b, REMOTE_KEY).id,
    firstId,
    'the remote keeps its id in localStorage',
  );
  // The Trip Twin computer no longer knows it (a lost store), then restarts.
  b.relay = createRelay({ host: createSessionHost({ now: timers.now }) });
  b.drop();
  await settle();
  await timers.run(10 * 60_000);
  const denies = r.got.filter((m) => m.type === 'denied');
  assert.equal(denies.length, 1, 'one refusal');
  assert.equal(denies[0].code, DENY.FORGOTTEN);
  assert.ok(TERMINAL_DENY.includes(denies[0].code));
  assert.equal(r.sync.stopped, 'denied');
  assert.equal(
    r.sockets.length,
    2,
    'the first socket and one reconnect, then nothing',
  );
  assert.equal(r.sockets.flatMap((s) => s.hellos).length, 2);
  assert.notEqual(r.sync.id, firstId, 'the dead token is dropped with its id');
});

test('K4 S-16: a remote with a token the relay does not know is told FORGOTTEN and stops', async () => {
  const { b, timers } = world();
  const r = b.window({ href: `${ORIGIN}/twin-remote.html` });
  r.env.local.set(
    REMOTE_KEY,
    JSON.stringify({ id: 'remote-gone', token: 'tok-gone' }),
  );
  r.got = [];
  r.sync = connectSync({
    kind: 'remote',
    name: 'Laptop',
    env: r.env,
    on: { welcome: (m) => r.got.push(m) },
  });
  await settle();
  assert.equal(r.got.at(-1).code, DENY.FORGOTTEN);
  assert.match(r.got.at(-1).error, /no longer knows this remote/);
  b.drop();
  await timers.run(10 * 60_000);
  assert.equal(r.sockets.length, 1, 'never reconnects');
  assert.equal(rec(b, REMOTE_KEY).token, null, 'the dead token is dropped');
});

test('K4 S-16: a wall refused ID_IN_USE falls to a fresh id and the pair card (it used to freeze)', async () => {
  const { b, relay, setup } = world();
  const s = fakeSocket();
  relay.attach(s);
  s.say({ t: 'hello', id: 'screen-k4x', kind: 'screen', setup, slot: 3 });
  s.close();
  const w = wall(b, {
    slot: 3,
    before: (x) =>
      x.env.local.set(
        slotKey(3),
        JSON.stringify({ id: 'screen-k4x', token: 'stale' }),
      ),
  });
  await settle();
  const ws = said(w).filter((m) => m.t === 'welcome');
  assert.equal(ws[0]?.code, DENY.ID_IN_USE, 'told first');
  assert.equal(ws.at(-1).type, 'pair-code', 'then the pair card');
  assert.equal(welcome(w).type, 'pair-code', 'the page sees the pair card');
  assert.notEqual(w.sync.id, 'screen-k4x');
  assert.equal(
    rec(b, slotKey(3)).id,
    w.sync.id,
    'the record follows the fresh id',
  );
});

test('K4 S-16: a wall with an expired link and no pairing drops the link and shows the pair card', async () => {
  const { b, timers, setup } = world();
  await timers.run(SETUP_TTL_MS + 1000);
  const w = wall(b, { slot: 2, setup });
  await settle();
  const ws = said(w).filter((m) => m.t === 'welcome');
  assert.equal(ws[0].code, DENY.TICKET_EXPIRED);
  assert.equal(ws.at(-1).type, 'pair-code');
  const hellos = w.sockets[0].hellos;
  assert.equal(hellos.at(-1).setup, null, 'the second hello carries no link');
  assert.equal(hellos.at(-1).id, hellos[0].id, 'the id is kept');
});

test('K4: a wall whose slot went to another device is told SLOT_TAKEN and clears its own record (only FORGOTTEN and SLOT_TAKEN do)', async () => {
  const { b, relay, setup } = world();
  const a = wall(b, { slot: 4, setup });
  await settle();
  const id = a.sync.id;
  const other = fakeSocket();
  relay.attach(other);
  other.say({
    t: 'hello',
    id: 'screen-elsewhere',
    kind: 'screen',
    setup,
    slot: 4,
  });
  await settle();
  assert.equal(lastOf(a, 'unpaired').reason, UNPAIRED.SLOT_TAKEN);
  assert.equal(rec(b, slotKey(4)), null, 'the record is cleared');
  assert.equal(b.local().getItem(tokenKey(id)), null);
});

test('K4 migration: a pre-K4 wall and remote keep their pairing; the old keys stay for a revert', async () => {
  const { b, relay, setup } = world();
  const s = fakeSocket();
  relay.attach(s);
  s.say({ t: 'hello', id: 'screen-k4mig', kind: 'screen', setup, slot: 4 });
  const tok = s.last('welcome').token;
  s.close();
  const r = fakeSocket();
  relay.attach(r);
  r.say({
    t: 'hello',
    id: 'remote-k4mig',
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  const rtok = r.last('welcome').token;
  r.close();
  // The page reloads on K4 code: sessionStorage id + localStorage token.
  const w = wall(b, {
    slot: 4,
    before: (x) => {
      x.session.setItem(sessionKey('screen'), 'screen-k4mig');
      x.env.local.set(tokenKey('screen-k4mig'), tok);
    },
  });
  await settle();
  assert.equal(welcome(w).type, 'paired');
  assert.equal(welcome(w).slot, 4);
  assert.deepEqual(rec(b, slotKey(4)), { id: 'screen-k4mig', token: tok });
  assert.equal(w.session.getItem(sessionKey('screen')), 'screen-k4mig');
  assert.equal(b.local().getItem(tokenKey('screen-k4mig')), tok);
  const rm = b.window({ href: `${ORIGIN}/twin-remote.html` });
  rm.session.setItem(sessionKey('remote'), 'remote-k4mig');
  rm.env.local.set(tokenKey('remote-k4mig'), rtok);
  rm.got = [];
  rm.sync = connectSync({
    kind: 'remote',
    name: 'iPad',
    env: rm.env,
    on: { welcome: (m) => rm.got.push(m) },
  });
  await settle();
  assert.equal(rm.got.at(-1).type, 'remote');
  assert.equal(rec(b, REMOTE_KEY).id, 'remote-k4mig');
  // Safari tab closed and opened again: no sessionStorage, same remote.
  rm.sync.close();
  await settle();
  const again = b.window({ href: `${ORIGIN}/twin-remote.html` });
  again.got = [];
  again.sync = connectSync({
    kind: 'remote',
    name: 'iPad',
    env: again.env,
    on: { welcome: (m) => again.got.push(m) },
  });
  await settle();
  assert.equal(again.got.at(-1).type, 'remote', 'rejoins without a QR');
  assert.equal(again.sync.id, 'remote-k4mig');
});

test('K4 R-H1 (unit): window.open copies the opener’s id; S3 and S4 opened from it get their own ids', async () => {
  for (const locks of [true, false]) {
    const { b, host, setup } = world({ locks });
    // The tab was a paired wall (S1), then became the launcher.
    const opener = wall(b, { slot: 1, setup });
    await settle();
    const openerId = opener.sync.id;
    const s3 = wall(b, { slot: 3, setup, opener });
    const s4 = wall(b, { slot: 4, setup, opener });
    await settle();
    assert.notEqual(s3.sync.id, openerId);
    assert.notEqual(s4.sync.id, openerId);
    assert.notEqual(s3.sync.id, s4.sync.id);
    assert.equal(online(host, 1) && online(host, 3) && online(host, 4), true);
    // A wall waiting for a code, copied: with locks the copy takes a fresh
    // id at once (tt-id); without, the relay keeps one live window.
    const pending = wall(b, {});
    await settle();
    const dup = wall(b, { opener: pending });
    await settle();
    if (locks) assert.notEqual(dup.sync.id, pending.sync.id);
    else assert.ok(lastOf(pending, REPLACED));
    assert.equal(welcome(dup).type, 'pair-code');
  }
});

test('K4: the newest window for a slot on this computer takes its lock; the older stops at once without touching storage', async () => {
  const { b, host, setup } = world({ locks: true });
  const a = wall(b, { slot: 6, setup });
  await settle();
  const before = b.local().getItem(slotKey(6));
  const other = wall(b, { slot: 6 }); // another launcher tab's "Open S6"
  await settle();
  assert.equal(a.sync.stopped, 'replaced');
  assert.ok(
    a.got.some((m) => m.t === REPLACED && m.local),
    'stopped by the lock',
  );
  assert.equal(welcome(other).type, 'paired');
  assert.equal(b.local().getItem(slotKey(6)), before, 'nothing rewritten');
  assert.equal(online(host, 6), true);
});

test('K4: a wall paired by code keeps a slot record and rejoins when opened again with that slot', async () => {
  const { b, relay, setup } = world();
  const r = fakeSocket();
  relay.attach(r);
  r.say({ t: 'hello', id: 'remote-k4c', kind: 'remote', setup, name: 'iPad' });
  assert.equal(r.last('welcome').controller, true);
  const w = wall(b, {});
  await settle();
  const code = welcome(w).code;
  assert.equal(welcome(w).type, 'pair-code');
  r.say({ t: 'pair', reqId: 9, code, slot: 6 });
  await settle();
  assert.equal(lastOf(w, 'paired').slot, 6);
  assert.equal(rec(b, slotKey(6)).id, w.sync.id, 'the slot record is written');
  w.sync.close();
  await settle();
  const again = wall(b, { slot: 6 });
  await settle();
  assert.equal(welcome(again).type, 'paired');
  assert.equal(welcome(again).slot, 6);
});

test('K4 S-7: device ids are kind- and 32 hex characters from getRandomValues; 1,000 are unique', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(newDeviceId('screen'));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.match(id, /^screen-[0-9a-f]{32}$/);
  const src = fs.readFileSync(
    new URL('./twinIdentity.js', import.meta.url),
    'utf8',
  );
  const sync = fs.readFileSync(
    new URL('./twinSync.js', import.meta.url),
    'utf8',
  );
  for (const text of [src, sync]) {
    const code = text.replace(/\/\/.*$/gm, '');
    assert.equal(/Math\.random|randomUUID/.test(code), false);
  }
});

test('K4 S-23: 127.0.0.1 and [::1] go to localhost, unless this origin already holds the pairing', async () => {
  assert.equal(
    localhostUrl(new URL('http://127.0.0.1:4173/twin.html?view=screen&slot=6')),
    'http://localhost:4173/twin.html?view=screen&slot=6',
  );
  assert.equal(
    localhostUrl(new URL('http://[::1]:4173/twin-remote.html')),
    'http://localhost:4173/twin-remote.html',
  );
  for (const h of [
    'http://localhost:4173/',
    'http://192.168.1.3:4173/',
    'http://jesses-mac-studio.local:4173/',
  ])
    assert.equal(localhostUrl(new URL(h)), null, h);
  const { b, setup } = world();
  const w = wall(b, { slot: 6, origin: 'http://127.0.0.1:4173' });
  await settle();
  assert.equal(
    w.location.replaced,
    'http://localhost:4173/twin.html?view=screen&slot=6',
  );
  assert.equal(w.sockets.length, 0, 'no socket from the page that leaves');
  // A pre-K4 wall paired on 127.0.0.1 stays there and keeps its pairing.
  const kept = wall(b, { slot: 2, setup, origin: 'http://127.0.0.1:4173' });
  await settle();
  assert.ok(kept.location.replaced, 'no pairing here yet: it leaves too');
  const site = b.local('http://127.0.0.1:4173/');
  site.setItem(
    slotKey(2),
    JSON.stringify({ id: 'screen-127', token: 'tok-127' }),
  );
  const stay = wall(b, { slot: 2, origin: 'http://127.0.0.1:4173' });
  await settle();
  assert.equal(stay.location.replaced, null);
  assert.equal(stay.sockets.length, 1);
});
