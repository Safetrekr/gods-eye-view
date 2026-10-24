// Trip Twin hashed token store (Phase CF L5; PHASE-CF-PLAN S-14, §6.6 L5;
// cf/01-security.md SEC-6 (hashing), cf/07-reasoning.md ET-7 R6c): tokens
// at rest as sha256 compared with timingSafeEqual, store v:2, the one-time
// v1 migration with the plain copy, the whole-folder token scan, the
// retired tmp-path dual write and the by-hand drop of the plain copy.
// Every test runs in its own temporary folders; the live wall's files are
// never read or written. Assertion messages carry slots, counts and file
// names, never tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeViteRelay } from './twinTestKit.mjs';
import { createSessionHost } from './twinSessionHost.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
/**
 * A v1 store as the K7 code (5c1cb6c) wrote it: the pre-K2 fixture run
 * through K7's migration and host (S1–S6, the remote in control, a stray
 * screen; refs). Tokens redacted. A copy of the real Mac Studio store can
 * be checked the same way before the L5 deploy (nothing here prints it):
 *   TRIP_TWIN_V1_FIXTURE=<copy> node --test src/operations/tripTwin/twinTokens.test.mjs
 */
const V1_FIXTURE =
  process.env.TRIP_TWIN_V1_FIXTURE ||
  path.join(HERE, 'fixtures', 'twinStore-v1-k7-redacted.json');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-tokens-test-'));
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
let n = 0;
/** Fresh data and tmp folders; the relay reads both from the environment. */
function place() {
  const base = path.join(root, `t${++n}`);
  const p = { data: path.join(base, 'data'), tmp: path.join(base, 'tmp') };
  fs.mkdirSync(p.tmp, { recursive: true });
  p.store = path.join(p.data, 'session.json');
  p.backup = path.join(p.data, 'session.prev.json');
  p.marker = path.join(p.data, 'migrated.json');
  p.quarantine = path.join(p.data, 'quarantine');
  p.copy = path.join(p.data, 'session.v1.json');
  p.legacy = path.join(p.tmp, 'trip-twin-soc-session.json');
  process.env.TRIP_TWIN_DATA_DIR = p.data;
  process.env.TMPDIR = p.tmp;
  return p;
}
const { checkSnapshot, dropPlainCopy, openSessionStore, scanForPlainTokens } =
  await import('../../../server/tripTwin/sessionStore.js');
const { TOKENS, plainTokenFiles, sameToken, scrubText, tokenHash } =
  await import('../../../server/tripTwin/twinTokens.js');
const { twinSyncRelay } = await import('../../../server/tripTwin/syncRelay.js');
const boot = () => fakeViteRelay(twinSyncRelay());
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const tokensOf = (doc) =>
  doc.devices.map(([, d]) => d.token).filter((t) => typeof t === 'string');

/** Put a v1 store where K2–K7 kept it; returns it. */
function seedV1(p) {
  fs.mkdirSync(p.data, { recursive: true, mode: 0o700 });
  fs.copyFileSync(V1_FIXTURE, p.store);
  return readJson(V1_FIXTURE);
}
/** Hello every paired device of a v1 store with its token; replies. */
async function rejoinAll(v, doc) {
  const out = [];
  for (const [id, d] of doc.devices) {
    if (!d.token || (d.kind === 'screen' && !d.slot)) continue;
    const w = await v.hello({
      t: 'hello',
      id,
      kind: d.kind,
      token: d.token,
      name: d.name,
    });
    out.push({
      kind: d.kind,
      slot: d.slot,
      type: w?.type,
      got: w?.slot,
      same: w?.token === d.token,
    });
  }
  return out;
}
const allBack = (rows) =>
  rows.length > 0 &&
  rows.every(
    (r) =>
      r.same &&
      (r.kind === 'remote'
        ? r.type === 'remote'
        : r.type === 'paired' && r.got === r.slot),
  );
const show = (rows) =>
  rows
    .map((r) => `${r.kind}${r.slot ? ` S${r.slot}` : ''} ${r.type}`)
    .join(', ');

test('L5 SEC-6: a token is kept as its sha256 and checked with timingSafeEqual; the host holds hashes only and a token leaves it only in the reply that issues it or to the device that showed it; a wrong token, its hash shown as a token, or none is refused', () => {
  assert.equal(
    tokenHash('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'sha256 test vector',
  );
  const h = tokenHash('a-token');
  assert.equal(sameToken('a-token', h), true);
  for (const [tk, hh] of [
    ['b-token', h],
    [h, h],
    ['', h],
    [null, h],
    ['a-token', h.slice(0, 63)],
    ['a-token', h.toUpperCase()],
  ])
    assert.equal(sameToken(tk, hh), false, 'refused');
  // The host's own default (no node: import) and the relay's agree.
  const events = [];
  for (const tokens of [undefined, TOKENS]) {
    const host = createSessionHost({ tokens, emit: (t, e) => events.push(e) });
    const setup = host.setup({ count: 2 }).setup;
    const s1 = host.hello({ id: 'scr-1', kind: 'screen', setup, slot: 1 });
    const r = host.hello({ id: 'rem-1', kind: 'remote', setup, name: 'iPad' });
    const text = JSON.stringify(host.snapshot());
    for (const tk of [s1.token, r.token]) {
      assert.equal(text.includes(tk), false, 'no token in the snapshot');
      assert.equal(text.includes(tokenHash(tk)), true, 'its sha256 is');
    }
    assert.equal(/"token"/.test(text), false, 'no token field at all');
    // A reload with the token: the same token back, nothing issued.
    events.length = 0;
    const again = host.hello({ id: 'scr-1', kind: 'screen', token: s1.token });
    assert.equal(again.type, 'paired');
    assert.equal(again.token, s1.token);
    assert.equal(events.at(-1).data.token, 'kept');
    const rr = host.hello({ id: 'rem-1', kind: 'remote', token: r.token });
    assert.equal(rr.type, 'remote');
    assert.equal(rr.token, r.token);
    for (const bad of [tokenHash(s1.token), 'x'.repeat(43), null])
      assert.equal(
        host.hello({ id: 'scr-1', kind: 'screen', token: bad }).code,
        'ID_IN_USE',
      );
    assert.equal(
      host.hello({ id: 'rem-1', kind: 'remote', token: tokenHash(r.token) })
        .code,
      'ID_IN_USE',
    );
  }
  // twinSessionHost.js is in src/ (browser-built): still no node: import.
  const src = fs.readFileSync(path.join(HERE, 'twinSessionHost.js'), 'utf8');
  assert.equal(/\bfrom\s*['"]node:|\bimport\s*\(\s*['"]node:/.test(src), false);
});

test('L5 gate: a v1 store (K2–K7) migrates once to v:2 in place; every wall and the remote rejoin with the token they hold (no re-pair); the marker says hashedAt; the plain copy is the v1 store; the next start loads v:2 and hashes nothing', async () => {
  const p = place();
  const old = seedV1(p);
  const tokens = tokensOf(old);
  assert.ok(tokens.length >= 2, 'fixture has paired devices');
  const v1 = boot();
  let rows;
  try {
    assert.equal(v1.logs.filter((l) => /store\.hashed/.test(l)).length, 1);
    assert.equal(
      v1.logs.some((l) => /store\.migrated/.test(l)),
      false,
    );
    rows = await rejoinAll(v1, old);
  } finally {
    v1.close();
  }
  assert.ok(allBack(rows), `rejoined: ${show(rows)}`);
  const doc = readJson(p.store);
  assert.equal(doc.v, 2);
  assert.equal(typeof doc.hashedAt, 'number');
  assert.equal(readJson(p.marker).hashedAt, doc.hashedAt);
  assert.equal(readJson(p.marker).plainCopy, p.copy);
  assert.equal(readJson(p.backup).v, 2);
  for (const [id, d] of old.devices) {
    const now = doc.devices.find(([x]) => x === id)?.[1];
    assert.ok(now, 'every record kept');
    assert.equal('token' in now, false, 'no token field');
    if (d.token) assert.equal(now.tokenHash, tokenHash(d.token), 'its hash');
  }
  assert.deepEqual(doc.refs, old.refs, 'refs kept');
  const copy = readJson(p.copy);
  assert.equal(copy.v, 1, 'the plain copy is a v1 store');
  assert.deepEqual(copy.devices, old.devices, 'as it was before hashing');
  assert.equal(
    (fs.statSync(p.copy).mode & 0o777).toString(8),
    '600',
    'copy is 0600',
  );
  // Once: the second start loads v:2; the copy stays until dropped by hand.
  const v2 = boot();
  try {
    assert.equal(
      v2.logs.some((l) => /store\.hashed/.test(l)),
      false,
    );
    assert.ok(v2.logs.some((l) => /store\.loaded/.test(l)));
    assert.ok(v2.logs.some((l) => /store\.plain_copy_kept/.test(l)));
    const again = await rejoinAll(v2, old);
    assert.ok(allBack(again), `rejoined again: ${show(again)}`);
  } finally {
    v2.close();
  }
  assert.ok(fs.existsSync(p.copy), 'no start deletes the copy');
  for (const l of [...v1.logs, ...v2.logs])
    assert.equal(
      tokens.some((t) => l.includes(t) || l.includes(tokenHash(t))),
      false,
      'no token or hash in a log line',
    );
});

test('L5 gate: the whole-folder token scan (S-14): after a migration, pairings, restarts, a torn store in quarantine/, a stale backup and a tmp store a reverted build wrote, no plain token is at rest in the data folder, session.prev.json, quarantine/ or the relay’s os.tmpdir() files (the plain copy aside until its drill)', async () => {
  const p = place();
  const old = seedV1(p);
  const v1Text = fs.readFileSync(V1_FIXTURE, 'utf8');
  // Plain tokens everywhere K2–K7 could leave them.
  fs.mkdirSync(p.quarantine, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(p.quarantine, 'session-20261020T120000Z.json'),
    v1Text.slice(0, Math.floor(v1Text.length * 0.6)), // torn mid-way
  );
  fs.writeFileSync(
    path.join(p.quarantine, 'session-20261021T120000Z.json'),
    v1Text,
  );
  fs.writeFileSync(p.backup, v1Text);
  fs.writeFileSync(p.legacy, v1Text); // K2–K7's dual write
  fs.writeFileSync(`${p.legacy}.tmp`, v1Text.slice(0, 900)); // its temp
  fs.writeFileSync(
    p.marker,
    JSON.stringify({ v: 1, migratedAt: 1, from: null }),
  );
  const held = tokensOf(old);
  // This build: walls and a remote pair, restart twice.
  const v = boot();
  try {
    const setup = (await v.hello({ t: 'setup', count: 6 })).setup;
    for (let s = 1; s <= 3; s += 1)
      held.push(
        (
          await v.hello({
            t: 'hello',
            id: `screen-scan-${s}`,
            kind: 'screen',
            setup,
            slot: s,
          })
        ).token,
      );
    held.push(
      (
        await v.hello({
          t: 'hello',
          id: 'remote-scan',
          kind: 'remote',
          setup,
          name: 'iPad',
        })
      ).token,
    );
  } finally {
    v.close();
  }
  boot().close();
  boot().close();
  assert.ok(held.length >= old.devices.length, 'tokens to look for');
  const where = { dirs: [p.data, p.tmp], tokens: held };
  // Everything but the kept copy is clean, as text and verbatim.
  const hits = plainTokenFiles({ ...where, skip: [p.copy] });
  assert.deepEqual(
    hits.map((h) => `${path.relative(root, h.file)} (${h.why})`),
    [],
    'no plain token at rest',
  );
  assert.deepEqual(
    scanForPlainTokens({
      dir: p.data,
      legacyFile: p.legacy,
      keepPlainCopy: true,
    }),
    [],
  );
  assert.equal(fs.existsSync(p.legacy), false, 'tmp store deleted');
  assert.equal(fs.existsSync(`${p.legacy}.tmp`), false, 'and its temp');
  const q = fs.readdirSync(p.quarantine).map((f) => path.join(p.quarantine, f));
  assert.equal(q.length, 2, 'quarantine/ kept (hashed in place)');
  assert.equal(readJson(q[1]).devices.length, old.devices.length);
  // The copy is the one plain file, until dropped by hand.
  assert.deepEqual(
    plainTokenFiles(where).map((h) => path.basename(h.file)),
    ['session.v1.json'],
  );
  const dropped = dropPlainCopy({ dir: p.data, legacyFile: p.legacy });
  assert.equal(dropped.removed, true);
  assert.deepEqual(dropped.findings, []);
  assert.deepEqual(plainTokenFiles(where), [], 'after the drop: nothing');
  // The scanner itself finds what it is for: a v1 copy, a token verbatim.
  fs.writeFileSync(path.join(p.data, 'deploy-copy.json'), v1Text);
  fs.writeFileSync(path.join(p.tmp, 'note.txt'), `x ${held.at(-1)} y`);
  assert.deepEqual(
    plainTokenFiles(where).map((h) => `${path.basename(h.file)} ${h.why}`),
    ['deploy-copy.json plain token field', 'note.txt a known token, verbatim'],
  );
});

test('L5 revert drill (S-14): before the copy is dropped, a revert below L5 restores session.v1.json by hand: a v1 store with every token, which K2–K7 load and their walls rejoin; Forget rewrites the copy too; forward again it is hashed once more; after drop-plain-copy a revert is a re-pair (K2–K7 refuse a v:2 store)', async () => {
  const p = place();
  const old = seedV1(p);
  boot().close(); // L5 deploy: hashed in place, copy kept
  const copy = readJson(p.copy);
  // K2–K7's load rule (sessionStore.js at 5c1cb6c): v must be 1, tokens
  // strings; their host compares the token as it is.
  const k7Loads = (doc) =>
    doc.v === 1 &&
    doc.devices.every(
      ([, d]) => d.token == null || typeof d.token === 'string',
    );
  assert.equal(k7Loads(copy), true, 'K2–K7 load the copy');
  assert.equal(k7Loads(readJson(p.store)), false, 'and refuse the v:2 store');
  assert.equal(checkSnapshot(copy, { plain: true }).ok, true);
  for (const [id, d] of old.devices)
    if (d.token)
      assert.equal(
        copy.devices.find(([x]) => x === id)[1].token,
        d.token,
        'each device’s own token',
      );
  // The reverted code runs on the copy (its host takes the tokens as they
  // are): every wall rejoins with what it holds.
  const reverted = createSessionHost({ restore: copy });
  for (const [id, d] of old.devices.filter(([, x]) => x.token)) {
    const w = reverted.hello({
      id,
      kind: d.kind,
      token: d.token,
      name: d.name,
    });
    assert.ok(
      d.kind === 'remote' ? w.type === 'remote' : w.slot === d.slot,
      `${d.kind} ${d.slot ?? ''} rejoins on the copy (${w.type})`,
    );
  }
  // Forget (K11) rewrites the copy as well as the store and the backup.
  const gone = old.devices.find(([, d]) => d.kind === 'screen' && d.slot)[0];
  const goneToken = old.devices.find(([id]) => id === gone)[1].token;
  const store = openSessionStore({ dir: p.data, legacyFile: p.legacy });
  const snap = createSessionHost({ restore: store.restore }).snapshot();
  const r = store.forget(
    { ...snap, devices: snap.devices.filter(([id]) => id !== gone) },
    [gone],
  );
  assert.deepEqual(r, {
    store: true,
    backup: 'rewritten',
    plainCopy: 'rewritten',
  });
  for (const f of [p.store, p.backup, p.copy])
    assert.equal(
      fs.readFileSync(f, 'utf8').includes(goneToken),
      false,
      `${path.basename(f)} holds no forgotten token`,
    );
  // The hand restore of the drill, then forward again: hashed once more.
  fs.copyFileSync(p.copy, p.store);
  const fwd = boot();
  try {
    assert.equal(fwd.logs.filter((l) => /store\.hashed/.test(l)).length, 1);
    const left = { ...old, devices: old.devices.filter(([id]) => id !== gone) };
    const rows = await rejoinAll(fwd, left);
    assert.ok(allBack(rows), `forward again: ${show(rows)}`);
  } finally {
    fwd.close();
  }
  assert.equal(readJson(p.store).v, 2);
  // The drill passed: drop the copy. A revert now finds no v1 store.
  assert.equal(
    dropPlainCopy({ dir: p.data, legacyFile: p.legacy }).removed,
    true,
  );
  assert.equal(fs.existsSync(p.copy), false);
  assert.equal(readJson(p.marker).plainCopy, null);
  assert.equal(typeof readJson(p.marker).plainCopyDroppedAt, 'number');
  const v1Left = [
    p.store,
    p.backup,
    ...fs.readdirSync(p.data).map((f) => path.join(p.data, f)),
  ]
    .filter((f) => f.endsWith('.json') && fs.existsSync(f))
    .filter((f) => k7Loads(readJson(f)));
  assert.deepEqual(
    v1Left,
    [],
    'no store a K2–K7 build loads: a revert re-pairs',
  );
});

test('L5: a v:2 store with a plain token in it fails the shape check and is quarantined, hashed in place there; a torn store’s cut-off token is dropped with the rest of the tear', () => {
  const p = place();
  const old = readJson(V1_FIXTURE);
  const bad = { ...old, v: 2 }; // v:2 by its label, plain tokens inside
  assert.match(checkSnapshot(bad).reason, /plain token in a v2 store/);
  assert.match(
    checkSnapshot({
      ...old,
      v: 2,
      devices: [['x', { kind: 'screen', tokenHash: 'ab' }]],
    }).reason,
    /tokenHash not a sha256/,
  );
  fs.mkdirSync(p.data, { recursive: true });
  fs.writeFileSync(p.store, JSON.stringify(bad));
  const s = openSessionStore({ dir: p.data, legacyFile: p.legacy });
  assert.equal(s.info.loaded, 'fresh');
  assert.equal(s.info.quarantined.length, 1);
  const q = fs.readFileSync(s.info.quarantined[0], 'utf8');
  for (const t of tokensOf(old)) {
    assert.equal(q.includes(t), false, 'no plain token in quarantine/');
    assert.equal(q.includes(tokenHash(t)), true, 'its hash is');
  }
  assert.equal(JSON.parse(q).devices.length, old.devices.length, 'still whole');
  // A tear inside a token: the rest of the file goes with it.
  const text = JSON.stringify(old);
  const at = text.indexOf(tokensOf(old)[2]) + 5;
  const torn = scrubText(text.slice(0, at));
  assert.equal(torn.cut, true);
  assert.equal(torn.hashed, 2);
  assert.equal(torn.text.includes(tokensOf(old)[2].slice(0, 5)), false);
  assert.equal(/"token"\s*:\s*"/.test(torn.text), false);
});

test('L5 S-14: the tmp-path dual write is retired: no save writes os.tmpdir(); a tmp store a reverted build wrote is deleted unread at the next start, its temp too; a pre-K2 tmp store with no marker is still migrated once (hashed), then deleted', async () => {
  const p = place();
  const writes = [];
  const spy = {
    ...fs,
    openSync(f, ...a) {
      writes.push(String(f));
      return fs.openSync(f, ...a);
    },
    writeFileSync(f, ...a) {
      writes.push(String(f));
      return fs.writeFileSync(f, ...a);
    },
  };
  const store = openSessionStore({
    dir: p.data,
    legacyFile: p.legacy,
    fs: spy,
  });
  const host = createSessionHost();
  const setup = host.setup({ count: 1 }).setup;
  host.hello({ id: 'scr-tmp', kind: 'screen', setup, slot: 1 });
  store.save(host.snapshot());
  store.queue(host.snapshot());
  store.close();
  assert.ok(
    writes.some((f) => f.startsWith(p.data)),
    'the store is written',
  );
  assert.deepEqual(
    writes.filter((f) => f.startsWith(p.tmp)),
    [],
    'nothing under os.tmpdir()',
  );
  // A reverted build wrote the tmp store again: deleted, never read.
  fs.copyFileSync(V1_FIXTURE, p.legacy);
  fs.writeFileSync(`${p.legacy}.tmp`, '{"half":');
  const reads = [];
  const rspy = {
    ...fs,
    readFileSync(f, ...a) {
      reads.push(String(f));
      return fs.readFileSync(f, ...a);
    },
  };
  const again = openSessionStore({
    dir: p.data,
    legacyFile: p.legacy,
    fs: rspy,
  });
  assert.equal(again.info.loaded, 'store');
  assert.equal(reads.includes(p.legacy), false, 'tmp store not read');
  assert.equal(fs.existsSync(p.legacy), false, 'tmp store deleted');
  assert.equal(fs.existsSync(`${p.legacy}.tmp`), false, 'its temp deleted');
  // A box that never ran K2: the tmp store is migrated once, hashed.
  const q = place();
  fs.copyFileSync(
    path.join(HERE, 'fixtures', 'twinStore-pre-k2-redacted.json'),
    q.legacy,
  );
  const pre = readJson(q.legacy);
  const v = boot();
  try {
    assert.ok(v.logs.some((l) => /store\.migrated/.test(l)));
    assert.ok(v.logs.some((l) => /store\.hashed/.test(l)));
    const [id, d] = pre.devices.find(([, x]) => x.kind === 'screen' && x.slot);
    const w = await v.hello({ t: 'hello', id, kind: 'screen', token: d.token });
    assert.equal(w.slot, d.slot, 'its wall rejoins');
  } finally {
    v.close();
  }
  assert.equal(readJson(q.store).v, 2);
  assert.equal(readJson(q.copy).v, 1, 'plain copy written as v1');
  assert.equal(fs.existsSync(q.legacy), false, 'tmp store deleted after');
});

test('L5: drop-plain-copy is by hand only: no start deletes the copy; scripts/trip-twin-store.mjs scan reports it, drop-plain-copy deletes it and notes it in the marker; a deploy-copy.json from before L5 is reported, not deleted; health says plainCopy; nothing printed holds a token', () => {
  const p = place();
  const old = seedV1(p);
  for (let i = 0; i < 3; i += 1) boot().close();
  assert.ok(fs.existsSync(p.copy), 'three starts, copy still there');
  const s = openSessionStore({ dir: p.data, legacyFile: p.legacy });
  assert.equal(s.status().plainCopy, true, 'health shows the copy');
  fs.copyFileSync(V1_FIXTURE, path.join(p.data, 'deploy-copy.json'));
  const cli = (...args) =>
    spawnSync(process.execPath, ['scripts/trip-twin-store.mjs', ...args], {
      cwd: REPO,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TRIP_TWIN_DATA_DIR: p.data,
        TMPDIR: p.tmp,
      },
    });
  const outs = [];
  const scan = cli('scan');
  outs.push(scan.stdout + scan.stderr);
  assert.equal(scan.status, 1, 'plain files at rest: exit 1');
  assert.match(scan.stdout, /session\.v1\.json present/);
  assert.match(scan.stdout, /FOUND .*session\.v1\.json/);
  assert.match(scan.stdout, /FOUND .*deploy-copy\.json/);
  const kept = cli('scan', '--keep-plain-copy');
  outs.push(kept.stdout + kept.stderr);
  assert.doesNotMatch(kept.stdout, /FOUND .*session\.v1\.json/);
  const drop = cli('drop-plain-copy');
  outs.push(drop.stdout + drop.stderr);
  assert.match(drop.stdout, /deleted session\.v1\.json/);
  assert.equal(drop.status, 1, 'deploy-copy.json still reported');
  assert.equal(fs.existsSync(p.copy), false);
  assert.ok(
    fs.existsSync(path.join(p.data, 'deploy-copy.json')),
    'not deleted',
  );
  assert.equal(readJson(p.marker).plainCopy, null);
  fs.rmSync(path.join(p.data, 'deploy-copy.json'));
  const clean = cli('scan');
  outs.push(clean.stdout + clean.stderr);
  assert.equal(clean.status, 0);
  assert.match(clean.stdout, /clean: no plain token at rest/);
  assert.match(clean.stdout, /session\.json v:2/);
  const again = cli('drop-plain-copy');
  assert.equal(again.status, 0);
  assert.match(again.stdout, /nothing to delete/);
  assert.equal(
    openSessionStore({ dir: p.data, legacyFile: p.legacy }).status().plainCopy,
    false,
  );
  for (const o of outs)
    for (const t of tokensOf(old))
      assert.equal(
        o.includes(t) || o.includes(tokenHash(t)),
        false,
        'no token printed',
      );
});
