// Trip Twin session store (Phase CF K2; PHASE-CF-PLAN S-1, S-14 and the K2
// gate): atomic writes and modes, quarantine, the one-time migration from
// the old os.tmpdir() store, no fallback read, the dual write that keeps a
// revert working, the data-folder fence, flush on close and Forget. Every
// test runs in its own temporary folders; the live wall's files are never
// read or written. Assertion messages carry slots and counts, never tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeSocket, fakeViteRelay } from './twinTestKit.mjs';
import { createSessionHost } from './twinSessionHost.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
/**
 * A pre-K2 store as the base relay wrote it (host.snapshot() as JSON) for a
 * Mac Studio wall: S1–S5 from the launcher, S6 paired by code, the iPad in
 * control, a stray screen that never paired. Every token is redacted. A
 * copy of the real Mac Studio store (tokens redacted, or not: nothing here
 * prints them) can be checked the same way before a deploy:
 *   TRIP_TWIN_STORE_FIXTURE=<copy> node --test src/operations/tripTwin/twinStore.test.mjs
 */
const FIXTURE =
  process.env.TRIP_TWIN_STORE_FIXTURE ||
  path.join(HERE, 'fixtures', 'twinStore-pre-k2-redacted.json');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-store-test-'));
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
let n = 0;
/** Fresh data and tmp folders; the relay reads both from the environment. */
function place() {
  const base = path.join(root, `t${++n}`);
  const p = {
    data: path.join(base, 'data'),
    tmp: path.join(base, 'tmp'),
  };
  fs.mkdirSync(p.tmp, { recursive: true });
  p.store = path.join(p.data, 'session.json');
  p.backup = path.join(p.data, 'session.prev.json');
  p.marker = path.join(p.data, 'migrated.json');
  p.quarantine = path.join(p.data, 'quarantine');
  p.legacy = path.join(p.tmp, 'trip-twin-soc-session.json');
  process.env.TRIP_TWIN_DATA_DIR = p.data;
  process.env.TMPDIR = p.tmp;
  return p;
}
const { openSessionStore, resolveDataDir, writeFileAtomic, defaultDataDir } =
  await import('../../../server/tripTwin/sessionStore.js');
const { twinSyncRelay, openRelayStore } =
  await import('../../../server/tripTwin/syncRelay.js');
const boot = () => fakeViteRelay(twinSyncRelay());
const mode = (f) => fs.statSync(f).mode & 0o777;
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/** A wall in a fresh host: launcher setup, n screens, one remote. */
function wall(nScreens = 2) {
  const host = createSessionHost();
  const setup = host.setup({ count: nScreens }).setup;
  for (let s = 1; s <= nScreens; s += 1)
    host.hello({ id: `screen-${s}`, kind: 'screen', setup, slot: s });
  host.hello({ id: 'remote-1', kind: 'remote', setup, name: 'iPad' });
  return host;
}
const tokensOf = (snap) => snap.devices.map(([, d]) => d.token).filter(Boolean);
/** Every file under a folder, as text (for token scans). */
const textUnder = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => fs.readFileSync(path.join(e.parentPath, e.name), 'utf8'))
        .join('\n')
    : '';

test('store: saves atomically into a 0700 folder as 0600 files with v:1; no temp file left', () => {
  const p = place();
  fs.mkdirSync(p.data, { recursive: true, mode: 0o755 });
  fs.chmodSync(p.data, 0o755);
  const store = openSessionStore({ dir: p.data, legacyFile: p.legacy });
  assert.equal(mode(p.data), 0o700, 'data folder tightened to 0700');
  const snap = wall(2).snapshot();
  assert.equal(store.save(snap), true);
  const doc = readJson(p.store);
  assert.equal(doc.v, 1);
  assert.equal(typeof doc.migratedAt, 'number');
  assert.deepEqual(doc.devices, JSON.parse(JSON.stringify(snap.devices)));
  for (const f of [p.store, p.marker, p.legacy])
    assert.equal(mode(f), 0o600, `${path.basename(f)} is 0600`);
  const left = fs.readdirSync(p.data).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(left, [], 'no temp file left behind');
  assert.equal(store.status().ok, true);
});

test('store: a crash between write and rename leaves the old file readable', () => {
  const p = place();
  const first = openSessionStore({ dir: p.data, legacyFile: p.legacy });
  first.save(wall(2).snapshot());
  const before = fs.readFileSync(p.store, 'utf8');
  const crashy = {
    ...fs,
    renameSync(from, to) {
      if (to === p.store)
        throw Object.assign(new Error('killed'), { code: 'EINTR' });
      return fs.renameSync(from, to);
    },
  };
  const store = openSessionStore({
    dir: p.data,
    legacyFile: p.legacy,
    fs: crashy,
  });
  assert.equal(store.save(wall(4).snapshot()), false);
  assert.equal(store.status().ok, false, 'the failed save shows in status');
  assert.equal(fs.readFileSync(p.store, 'utf8'), before, 'old file unchanged');
  assert.ok(fs.existsSync(`${p.store}.tmp`), 'the crash left its temp file');
  // The next start loads the old file and deletes the temp unread.
  const again = openSessionStore({ dir: p.data, legacyFile: p.legacy });
  assert.equal(again.info.loaded, 'store');
  assert.equal(again.restore.devices.length, 3);
  assert.equal(fs.existsSync(`${p.store}.tmp`), false, 'temp removed');
});

test('store: a torn write (half the bytes, then a crash) leaves the old file readable', () => {
  const p = place();
  openSessionStore({ dir: p.data, legacyFile: p.legacy }).save(
    wall(3).snapshot(),
  );
  const torn = {
    ...fs,
    writeSync(fd, buf, off = 0, len = buf.length) {
      fs.writeSync(fd, buf, off, Math.floor(len / 2));
      throw Object.assign(new Error('power cut'), { code: 'EIO' });
    },
  };
  const store = openSessionStore({
    dir: p.data,
    legacyFile: p.legacy,
    fs: torn,
  });
  assert.equal(store.save(wall(5).snapshot()), false);
  const again = openSessionStore({ dir: p.data, legacyFile: p.legacy });
  assert.equal(again.info.loaded, 'store', 'old file loads');
  assert.deepEqual(
    again.restore.devices.filter(([, d]) => d.slot).map(([, d]) => d.slot),
    [1, 2, 3],
  );
  assert.deepEqual(again.info.quarantined, [], 'nothing was bad');
});

test('store: a corrupt store is moved to quarantine/ and the server starts', async () => {
  const p = place();
  const v1 = boot();
  const setup = (await v1.hello({ t: 'setup', count: 2 })).setup;
  await v1.hello({
    t: 'hello',
    id: 'screen-a',
    kind: 'screen',
    setup,
    slot: 1,
  });
  v1.close();
  boot().close(); // a good start: the backup now holds this wall
  const good = fs.readFileSync(p.store, 'utf8');
  // A store damaged outside a save (disk, hand edit): half the bytes.
  fs.writeFileSync(p.store, good.slice(0, Math.floor(good.length / 2)));
  const v2 = boot();
  try {
    assert.ok(v2.logs.some((l) => /store\.quarantined/.test(l)));
    const q = fs.readdirSync(p.quarantine);
    assert.equal(q.length, 1, 'one file in quarantine/');
    assert.equal(mode(path.join(p.quarantine, q[0])), 0o600);
    assert.equal(mode(p.quarantine), 0o700);
    assert.equal(fs.existsSync(p.store), false, 'bad store moved, not kept');
    // The server is up: a wall is accepted and gets a pair code (fresh wall;
    // the backup is restored by hand only, re-pair.md).
    const w = await v2.hello({ t: 'hello', id: 'screen-a', kind: 'screen' });
    assert.equal(w.type, 'pair-code');
    assert.ok(
      fs.existsSync(p.backup),
      'the backup is still there for a hand restore',
    );
  } finally {
    v2.close();
  }
  // Quarantine is never read back: the next start is not the old wall.
  const v3 = openSessionStore({ dir: p.data, legacyFile: p.legacy });
  assert.notEqual(v3.info.loaded, 'migrated');
  assert.equal(v3.info.legacyRead, false);
  assert.equal(fs.readdirSync(p.quarantine).length, 1);
});

test('store: a store of an unknown version is quarantined, not half-loaded', () => {
  const p = place();
  openSessionStore({ dir: p.data, legacyFile: p.legacy }).save(
    wall(2).snapshot(),
  );
  const doc = readJson(p.store);
  fs.writeFileSync(p.store, JSON.stringify({ ...doc, v: 2 }));
  const store = openSessionStore({ dir: p.data, legacyFile: p.legacy });
  assert.equal(store.restore, null);
  assert.equal(store.info.loaded, 'fresh');
  assert.equal(store.info.quarantined.length, 1);
  assert.equal(
    readJson(store.info.quarantined[0]).v,
    2,
    'kept whole for a hand restore',
  );
});

/** Put the fixture where the pre-K2 relay kept its store. */
function seedLegacy(p) {
  fs.copyFileSync(FIXTURE, p.legacy);
  return readJson(FIXTURE);
}
/** Hello every paired device of a snapshot; the replies, by device. */
async function rejoinAll(v, snap) {
  const out = [];
  for (const [id, d] of snap.devices) {
    if (!d.token || (d.kind === 'screen' && !d.slot)) continue;
    const w = await v.hello({
      t: 'hello',
      id,
      kind: d.kind,
      token: d.token,
      name: d.name,
    });
    out.push({ kind: d.kind, slot: d.slot, type: w?.type, got: w?.slot });
  }
  return out;
}

test('store: a redacted copy of a real pre-K2 store migrates once and its walls rejoin', async () => {
  const p = place();
  const old = seedLegacy(p);
  const tokens = tokensOf(old);
  assert.ok(tokens.length >= 2, 'fixture has paired devices');
  const v1 = boot();
  let rows;
  try {
    assert.equal(v1.logs.filter((l) => /store\.migrated/.test(l)).length, 1);
    rows = await rejoinAll(v1, old);
  } finally {
    v1.close();
  }
  for (const r of rows.filter((x) => x.kind === 'screen'))
    assert.ok(
      r.type === 'paired' && r.got === r.slot,
      `S${r.slot} rejoined (${r.type})`,
    );
  for (const r of rows.filter((x) => x.kind === 'remote'))
    assert.equal(r.type, 'remote', 'the remote rejoined with its token');
  const doc = readJson(p.store);
  assert.equal(doc.v, 1);
  assert.equal(typeof doc.migratedAt, 'number');
  assert.equal(readJson(p.marker).migratedAt, doc.migratedAt);
  assert.equal(readJson(p.marker).from, p.legacy);
  assert.equal(readJson(p.backup).v, 1, 'backup of the migrated wall');
  // The tmp copy is now a dual write (marked), not a store to migrate.
  assert.equal(readJson(p.legacy).migratedAt, doc.migratedAt);
  // Migrates once: the second start loads the new store.
  const v2 = boot();
  try {
    assert.equal(
      v2.logs.some((l) => /store\.migrated/.test(l)),
      false,
    );
    assert.ok(v2.logs.some((l) => /store\.loaded/.test(l)));
    const again = await rejoinAll(v2, old);
    assert.ok(again.every((r) => r.type === 'paired' || r.type === 'remote'));
  } finally {
    v2.close();
  }
  for (const l of [...v1.logs, ...v2.logs])
    assert.equal(
      tokens.some((t) => l.includes(t)),
      false,
      'no token in a log line',
    );
});

test('store: after migration, deleting the new store and restarting does not read the tmp file', async () => {
  const p = place();
  const old = seedLegacy(p);
  boot().close(); // migrates
  assert.ok(fs.existsSync(p.store));
  fs.rmSync(p.store);
  // Spy on reads: the tmp file must not even be opened.
  const reads = [];
  const spy = {
    ...fs,
    readFileSync(f, ...a) {
      reads.push(String(f));
      return fs.readFileSync(f, ...a);
    },
  };
  const s = openRelayStore({ fs: spy, dualWrite: false });
  assert.equal(s.info.loaded, 'fresh');
  assert.equal(s.info.legacyRead, false);
  assert.equal(reads.includes(p.legacy), false, 'tmp file not read');
  // Through the real plugin: the old walls are not brought back.
  const v = boot();
  try {
    // The first paired wall (S1 in the fixture; any slot in a real copy).
    const [s1] = old.devices.filter(
      ([, d]) => d.kind === 'screen' && d.slot && d.token,
    );
    const w = await v.hello({
      t: 'hello',
      id: s1[0],
      kind: 'screen',
      token: s1[1].token,
    });
    assert.equal(
      w.type,
      'pair-code',
      `S${s1[1].slot} is not restored from the tmp file`,
    );
  } finally {
    v.close();
  }
  // Even with the whole data folder gone, the tmp copy is marked as written
  // after a migration and is not taken as a store.
  fs.rmSync(p.data, { recursive: true });
  const bare = openRelayStore({});
  assert.equal(bare.info.loaded, 'fresh');
  assert.equal(bare.restore, null);
});

test('store: revert-and-restart: the pre-K2 loader still finds the wall in the tmp file (dual write)', async () => {
  const p = place();
  const v = boot();
  const setup = (await v.hello({ t: 'setup', count: 3 })).setup;
  const ids = ['screen-r1', 'screen-r2', 'screen-r3'];
  const tokens = {};
  for (const [i, id] of ids.entries())
    tokens[id] = (
      await v.hello({ t: 'hello', id, kind: 'screen', setup, slot: i + 1 })
    ).token;
  v.close(); // flushes
  // Exactly what the relay at ff8a953 (K1) did on start:
  //   loadStore() { return JSON.parse(fs.readFileSync(STORE, 'utf8')) }
  //   createSessionHost({ restore: loadStore() })
  // with STORE = os.tmpdir()/trip-twin-soc-session.json.
  const restore = JSON.parse(
    fs.readFileSync(
      path.join(os.tmpdir(), 'trip-twin-soc-session.json'),
      'utf8',
    ),
  );
  const host = createSessionHost({ restore });
  for (const [i, id] of ids.entries()) {
    const w = host.hello({ id, kind: 'screen', token: tokens[id] });
    assert.ok(
      w.type === 'paired' && w.slot === i + 1,
      `S${i + 1} rejoins on the old code (${w.type})`,
    );
  }
  assert.equal(
    restore.session.rev,
    readJson(p.store).session.rev,
    'tmp copy is current',
  );
  // And the old code's own relay runs on it.
  const { createRelay } = await import('../../../server/tripTwin/syncRelay.js');
  const relay = createRelay({ host });
  const ws = fakeSocket();
  relay.attach(ws);
  ws.say({
    t: 'hello',
    id: 'screen-r2',
    kind: 'screen',
    token: tokens['screen-r2'],
  });
  assert.equal(ws.last('welcome').slot, 2);
});

test("store: TRIP_TWIN_DATA_DIR inside the repo or Vite's root is refused and the wall runs unsaved", async () => {
  const fences = [
    { name: 'the repo', path: REPO },
    { name: "Vite's root", path: path.join(root, 'vite-root') },
  ];
  const inRepo = resolveDataDir({
    env: { TRIP_TWIN_DATA_DIR: path.join(REPO, 'data', 'trip-twin') },
    fences,
  });
  assert.equal(inRepo.dir, null);
  assert.match(inRepo.refused.reason, /the repo/);
  const inRoot = resolveDataDir({
    env: { TRIP_TWIN_DATA_DIR: path.join(root, 'vite-root', 'public', 'x') },
    fences,
  });
  assert.match(inRoot.refused.reason, /Vite's root/);
  assert.match(
    resolveDataDir({ env: { TRIP_TWIN_DATA_DIR: 'rel/dir' }, fences }).refused
      .reason,
    /absolute/,
  );
  const ok = resolveDataDir({ env: {}, home: '/Users/someone', fences });
  assert.equal(
    ok.dir,
    '/Users/someone/Library/Application Support/SafeTrekr/trip-twin',
  );
  assert.equal(
    defaultDataDir('/h'),
    '/h/Library/Application Support/SafeTrekr/trip-twin',
  );
  // Through the plugin: refused, never swapped for the default folder.
  const p = place();
  const viteRoot = path.join(root, 'vite-root');
  process.env.TRIP_TWIN_DATA_DIR = path.join(viteRoot, 'store');
  const v = fakeViteRelay(twinSyncRelay(), { root: viteRoot });
  try {
    assert.ok(v.logs.some((l) => /store\.dir_refused/.test(l)));
    assert.ok(v.logs.some((l) => /store\.memory_only/.test(l)));
    const setup = (await v.hello({ t: 'setup', count: 1 })).setup;
    assert.ok(setup, 'the wall still works');
    await v.hello({
      t: 'hello',
      id: 'screen-x',
      kind: 'screen',
      setup,
      slot: 1,
    });
  } finally {
    v.close();
  }
  assert.equal(
    fs.existsSync(viteRoot),
    false,
    'nothing written under Vite root',
  );
  assert.equal(fs.existsSync(p.legacy), false, 'no tmp copy either');
});

test('store: the last change is flushed when the server closes', async () => {
  const p = place();
  const v = boot();
  const frames = await v.talk([
    { t: 'hello', id: 'L', kind: 'launcher' },
    { t: 'setup', count: 2 },
  ]);
  const rev = frames.filter((m) => m.t === 'state').pop().state.rev;
  v.close(); // well inside the 300 ms debounce
  assert.equal(readJson(p.store).session.rev, rev, 'saved at close');
  assert.equal(readJson(p.legacy).session.rev, rev, 'tmp copy too');
  await tick(400); // the debounce timer must not write again after close
  assert.equal(readJson(p.store).session.rev, rev);
});

test('store: Forget rewrites the store and the backup without that device', () => {
  const p = place();
  const host = wall(2);
  const snap = host.snapshot();
  openSessionStore({ dir: p.data, legacyFile: p.legacy }).save(snap);
  const store = openSessionStore({ dir: p.data, legacyFile: p.legacy }); // backup written
  const gone = 'screen-2';
  const goneToken = snap.devices.find(([id]) => id === gone)[1].token;
  assert.ok(fs.readFileSync(p.backup, 'utf8').includes(goneToken));
  const after = {
    ...snap,
    devices: snap.devices.filter(([id]) => id !== gone),
  };
  const r = store.forget(after, [gone]);
  assert.deepEqual(r, { store: true, backup: 'rewritten' });
  for (const f of [p.store, p.backup, p.legacy]) {
    const text = fs.readFileSync(f, 'utf8');
    assert.equal(
      text.includes(goneToken),
      false,
      `${path.basename(f)} holds no forgotten token`,
    );
    assert.equal(
      text.includes(gone),
      false,
      `${path.basename(f)} holds no forgotten id`,
    );
  }
  assert.equal(
    textUnder(p.data).includes(goneToken),
    false,
    'data folder clean',
  );
  assert.equal(readJson(p.backup).devices.length, snap.devices.length - 1);
  // An unreadable backup is deleted rather than left holding the token.
  fs.writeFileSync(p.backup, '{torn');
  assert.equal(store.forget(after, [gone]).backup, 'deleted');
  assert.equal(fs.existsSync(p.backup), false);
});

test('store: a crash-left temp file of the store is deleted unread at start', () => {
  const p = place();
  openSessionStore({ dir: p.data, legacyFile: p.legacy }).save(
    wall(1).snapshot(),
  );
  writeFileAtomic(`${p.store}.tmp.ignored`, 'x'); // not ours: left alone
  fs.writeFileSync(`${p.store}.tmp`, '{"half":');
  const s = openSessionStore({ dir: p.data, legacyFile: p.legacy });
  assert.equal(s.info.loaded, 'store');
  assert.equal(fs.existsSync(`${p.store}.tmp`), false);
  assert.equal(fs.existsSync(`${p.store}.tmp.ignored`), true);
});

test('store: a migration whose store write fails is tried again at the next start', () => {
  const p = place();
  const old = seedLegacy(p);
  const full = {
    ...fs,
    renameSync(from, to) {
      if (to === p.store)
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      return fs.renameSync(from, to);
    },
  };
  const first = openSessionStore({
    dir: p.data,
    legacyFile: p.legacy,
    fs: full,
  });
  assert.equal(first.info.loaded, 'migrated', 'this start still runs the wall');
  assert.equal(fs.existsSync(p.marker), false, 'no marker without a store');
  assert.equal(readJson(p.legacy).migratedAt, undefined, 'tmp store untouched');
  const second = openSessionStore({ dir: p.data, legacyFile: p.legacy });
  assert.equal(second.info.loaded, 'migrated');
  assert.equal(second.restore.devices.length, old.devices.length);
  assert.ok(fs.existsSync(p.marker));
});
