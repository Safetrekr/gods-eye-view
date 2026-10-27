// Trip Twin audit log and health (Phase CF K6; PHASE-CF-PLAN §6.3 K6, S-19,
// CF-D9, C38, F-0004; cf/06-qa.md QA-7 T7.1–T7.5, T7.7; cf/01-security.md
// SEC-12; cf/02-backend.md BE-5, BE-6, BE-10, BE-11; cf/07-reasoning.md
// ET-5 R3). Every folder is a throwaway one under os.tmpdir(); nothing
// reaches ~/Library/Logs/trip-twin/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fakeSocket, liveTwinServer } from './twinTestKit.mjs';
import { createSessionHost } from './twinSessionHost.js';
import { DRIFT_REASONS, PROTO, driftState } from './twinProtocol.js';
import { fileURLToPath } from 'node:url';

const REPO_DOCS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs',
);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-audit-test-'));
process.env.TMPDIR = path.join(scratch, 'tmp');
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
fs.mkdirSync(process.env.TMPDIR);
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const {
  AUDIT_EVENTS,
  AUDIT_EVENT_TYPES,
  auditFiles,
  createAuditLog,
  defaultAuditDir,
  serialiseEvent,
  useAuditLog,
} = await import('../../../server/tripTwin/auditLog.js');
const { createRelay, healthOf, twinSyncRelay } =
  await import('../../../server/tripTwin/syncRelay.js');
const { createHostCheck, useHostCheck } =
  await import('../../../server/tripTwin/twinHostCheck.js');

let dirs = 0;
const freshDir = () => path.join(scratch, `audit-${++dirs}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every audit line in a folder, oldest file first. */
function linesIn(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return auditFiles(names).flatMap((f) =>
    fs
      .readFileSync(path.join(dir, f.name), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return []; // a torn line, or a test's filler
        }
      }),
  );
}
/** Every byte in a folder (the canary greps this). */
function folderText(dir) {
  let out = '';
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out += fs.readFileSync(p, 'utf8');
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}
const typesIn = (dir) =>
  linesIn(dir)
    .map((l) => l.type)
    .filter((t) => t !== 'log.opened');

/** A host on a fake clock with a seeded random (deterministic tokens). */
function seededHost(start = 1_000_000) {
  let t = start;
  let s = 0.4242;
  const host = createSessionHost({
    now: () => t,
    random: () => {
      s = (s * 9301 + 0.49297) % 1;
      return s;
    },
  });
  return { host, tick: (ms) => (t += ms), now: () => t };
}

const PLANTED = 'Ottoline Quarnby';
const THUMB = 'data:image/jpeg;base64,Q0FOQVJZ';

/**
 * The T7.1 session: setup, walls join, a remote pairs by QR and a wall by
 * code, commands (one refused), undo (one refused), a handover, hands-on
 * and drift, a thumbnail and heartbeats (never logged), identify, a wall
 * going offline. A planted name rides in a wall's text, a page's name and
 * a spotlight. Returns the sockets and every secret it saw.
 */
function goldenSession(audit) {
  const { host, tick } = seededHost();
  const relay = createRelay({ host, audit });
  const secrets = new Set();
  const ids = [];
  const sock = (local = true) => {
    const ws = fakeSocket();
    relay.attach(ws, {
      isLocal: local,
      peer: local ? '127.0.0.1' : '192.168.1.44',
    });
    return ws;
  };
  const keep = (w) => {
    for (const k of ['token', 'setup']) if (w?.[k]) secrets.add(w[k]);
    return w;
  };
  const id = (kind, n) => {
    const v = `${kind}-${'0123456789abcdef'
      .repeat(2)
      .slice(n, n + 32)
      .padEnd(32, '7')}`;
    ids.push(v);
    return v;
  };
  const L = sock();
  L.say({ t: 'hello', id: 'launcher-qa', kind: 'launcher' });
  L.say({ t: 'setup', count: 2 });
  const setup = keep(L.last('setup')).setup;
  const S1 = sock();
  S1.say({ t: 'hello', id: id('screen', 1), kind: 'screen', setup, slot: 1 });
  keep(S1.last('welcome'));
  const S2 = sock();
  S2.say({ t: 'hello', id: id('screen', 2), kind: 'screen', setup, slot: 2 });
  keep(S2.last('welcome'));
  const R = sock(false);
  R.say({
    t: 'hello',
    id: id('remote', 3),
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  keep(R.last('welcome'));
  const T = sock(false);
  T.say({ t: 'hello', id: id('screen', 4), kind: 'screen' });
  const code = T.last('welcome').code;
  secrets.add(`"${code}"`);
  const wrong = code === '9137' ? '9138' : '9137';
  secrets.add(`"${wrong}"`);
  R.say({ t: 'pair', reqId: 1, code: wrong, slot: 3 });
  R.say({ t: 'pair', reqId: 2, code, slot: 3 });
  keep(T.last('paired'));
  R.say({
    t: 'cmd',
    reqId: 3,
    cmd: { type: 'screens', target: 1, patch: { role: 'day' } },
  });
  const undoId = R.last('ack').undoId;
  R.say({
    t: 'cmd',
    reqId: 4,
    cmd: {
      type: 'session',
      patch: { spotlight: { kind: 'person', id: 'twin-OQ', name: PLANTED } },
    },
  });
  const V = sock(false);
  V.say({
    t: 'hello',
    id: id('remote', 5),
    kind: 'remote',
    setup,
    name: PLANTED,
  });
  keep(V.last('welcome'));
  V.say({ t: 'cmd', reqId: 5, cmd: { type: 'returnLive' } });
  // Undo the spotlight; the same undo again is refused.
  const spotUndo = R.all('ack')[1].undoId;
  R.say({ t: 'undo', reqId: 6, undoId: spotUndo });
  R.say({ t: 'undo', reqId: 7, undoId: spotUndo });
  void undoId;
  V.say({ t: 'request-control' });
  R.say({ t: 'handover', accept: true });
  S2.say({
    t: 'local',
    on: true,
    text: `hands-on · ${PLANTED}`,
    drift: false,
    driftReason: 'input',
  });
  S2.say({
    t: 'local',
    on: true,
    text: `hands-on · ${PLANTED} 2`,
    drift: false,
    driftReason: 'input',
  });
  S2.say({
    t: 'local',
    on: false,
    text: '',
    drift: false,
    driftReason: 'input',
  });
  S1.say({
    t: 'local',
    on: false,
    text: 'drifting · idle camera',
    drift: true,
    driftReason: 'idle',
  });
  S1.say({
    t: 'local',
    on: false,
    text: '',
    drift: false,
    driftReason: 'command',
  });
  S1.say({ t: 'thumb', data: THUMB });
  for (const w of [S1, S2, R, V, T]) w.say({ t: 'hb' });
  tick(1000);
  V.say({ t: 'identify' });
  T.close();
  return { relay, host, secrets, ids, socks: { L, S1, S2, R, T, V } };
}

const GOLDEN = [
  'device.hello', // launcher, refused (no setup link)
  'session.setup',
  'device.hello', // S1 paired by the setup link
  'device.hello', // S2
  'device.hello', // the iPad, in control
  'device.hello', // a wall shows a code
  'pair.failed', // wrong code
  'device.paired', // S3
  'cmd.applied', // S1 → Day plan
  'cmd.applied', // spotlight
  'device.hello', // the laptop
  'cmd.refused', // the laptop is not in control
  'undo.applied',
  'undo.refused', // the same undo again
  'handover.requested',
  'handover.answered',
  'wall.hands', // S2 hands on
  'wall.hands', // S2 hands off (the repeat in between writes nothing)
  'wall.drift', // S1 drifts
  'wall.drift', // S1 stops
  'wall.identify',
  'device.offline', // S3 closed
];

test('K6 T7.1 golden: a scripted relay session writes exactly the golden event sequence, with refs, revs and reqIds', async () => {
  const dir = freshDir();
  const audit = createAuditLog({ dir, pruneEveryMs: 0 });
  const { socks } = goldenSession(audit);
  assert.equal(socks.R.all('ack').filter((a) => a.ok).length, 3);
  assert.equal(await audit.flush(), true);
  const lines = linesIn(dir);
  assert.equal(lines[0].type, 'log.opened');
  assert.deepEqual(typesIn(dir), GOLDEN);
  const of = (t) => lines.filter((l) => l.type === t);
  const [, , , ipad] = of('device.hello');
  assert.deepEqual(ipad.actor, {
    ref: ipad.actor.ref,
    kind: 'remote',
    name: 'iPad',
    slot: null,
    via: 'touch',
  });
  assert.match(ipad.actor.ref, /^D\d+$/);
  assert.equal(ipad.data.outcome, 'remote');
  assert.equal(ipad.data.token, 'issued');
  assert.equal(ipad.data.controller, true);
  // The laptop's page called itself by the planted name; the host did not.
  assert.equal(of('device.hello')[5].actor.name, 'Laptop');
  const [day, spot] = of('cmd.applied');
  assert.deepEqual(day.rev, {
    before: day.rev.before,
    after: day.rev.before + 1,
  });
  assert.equal(day.corr.reqId, 3);
  assert.deepEqual(day.data.diffs, [
    { scope: 'S1', field: 'role', from: 'site', to: 'day' },
  ]);
  assert.deepEqual(spot.data.diffs, [
    {
      scope: 'session',
      field: 'spotlight',
      from: null,
      to: { kind: 'person', id: 'twin-OQ' },
    },
  ]);
  assert.equal(of('cmd.refused')[0].data.code, 'LEASE_NOT_CONTROLLER');
  assert.equal(of('undo.refused')[0].data.code, 'UNDO_EXPIRED');
  assert.deepEqual(
    of('wall.drift').map((l) => [l.data.on, l.data.reason]),
    [
      [true, 'idle'],
      [false, 'command'],
    ],
  );
  assert.deepEqual(of('wall.identify')[0].data, { ok: true, screens: 3 });
  assert.deepEqual(of('device.offline')[0].data, { kind: 'screen', slot: 3 });
  // T7.3: the envelope on every row; seq strictly increasing; at in order.
  let seq = 0;
  let at = '';
  for (const l of lines) {
    assert.equal(l.v, 1);
    assert.ok(l.seq > seq, `seq ${l.seq} after ${seq}`);
    seq = l.seq;
    assert.match(l.boot, /^[0-9a-f]{12}$/);
    assert.ok(l.at >= at);
    at = l.at;
    for (const k of ['type', 'actor', 'rev', 'corr', 'data'])
      assert.ok(k in l, k);
  }
});

test('K6 ET-5: each message type writes exactly one line; heartbeats, thumbnails and an unchanged local write none', async () => {
  const dir = freshDir();
  const audit = createAuditLog({ dir, pruneEveryMs: 0 });
  const { relay, socks } = goldenSession(audit);
  await audit.flush();
  const count = async (ws, msg) => {
    const before = linesIn(dir).length;
    if (typeof msg === 'string') ws.emit('message', msg);
    else ws.say(msg);
    await audit.flush();
    return linesIn(dir).length - before;
  };
  const { S1, S2, V, R } = socks;
  const lan = fakeSocket();
  relay.attach(lan, { isLocal: false, peer: '192.168.1.50' });
  const rows = [
    [lan, { t: 'setup', count: 2 }, 1],
    [lan, { t: 'hello', id: 'screen-x', kind: 'screen', proto: 1 }, 1],
    [R, { t: 'pair', reqId: 9, code: '1', slot: 2 }, 1],
    [
      V,
      {
        t: 'cmd',
        reqId: 10,
        cmd: { type: 'screens', target: 2, patch: { pinned: true } },
      },
      1,
    ],
    [V, { t: 'undo', reqId: 11, undoId: 'u999' }, 1],
    [R, { t: 'request-control' }, 1],
    [V, { t: 'handover', accept: false }, 1],
    [V, { t: 'identify' }, 1],
    [
      S2,
      {
        t: 'screen-cmd',
        reqId: 12,
        label: 'x',
        cmd: { type: 'screens', target: 2, patch: { scale: 'city' } },
      },
      1,
    ],
    [
      S2,
      {
        t: 'screen-cmd',
        reqId: 13,
        cmd: { type: 'screens', target: 1, patch: { scale: 'city' } },
      },
      1,
    ],
    [S2, { t: 'local', on: true, text: 'x', drift: false }, 1],
    [S2, { t: 'local', on: true, text: 'y', drift: false }, 0],
    [S1, { t: 'thumb', data: THUMB }, 0],
    [S1, { t: 'hb' }, 0],
    [S1, { t: 'nope' }, 0],
    [S1, 'null', 0],
    // Last: a second hello is refused and closes that socket (4002); the
    // close is the device going offline, a line of its own.
    [V, { t: 'hello', id: 'again', kind: 'remote' }, 2],
  ];
  for (const [ws, msg, want] of rows)
    assert.equal(await count(ws, msg), want, JSON.stringify(msg));
});

test("CF (shell D5): a wall's keyboard change is logged as cmd.applied by the wall's ref, via keyboard; a refused one as cmd.refused with its code", async () => {
  const dir = freshDir();
  const audit = createAuditLog({ dir, pruneEveryMs: 0 });
  const { socks } = goldenSession(audit);
  // Its free-text label (a planted name here) never reaches the folder.
  socks.S2.say({
    t: 'screen-cmd',
    reqId: 80,
    label: `Rain map on · ${PLANTED}`,
    cmd: { type: 'screens', target: 2, patch: { layers: { precip: true } } },
  });
  socks.S2.say({
    t: 'screen-cmd',
    reqId: 81,
    label: PLANTED,
    cmd: { type: 'screens', target: 1, patch: { role: 'day' } },
  });
  await audit.flush();
  assert.equal(folderText(dir).includes('Ottoline'), false);
  const lines = linesIn(dir);
  const mine = lines.filter((l) => l.actor?.via === 'keyboard');
  const applied = mine.find((l) => l.type === 'cmd.applied');
  assert.ok(applied, 'cmd.applied via keyboard');
  assert.equal(applied.actor.kind, 'screen');
  assert.equal(applied.actor.slot, 2);
  assert.match(applied.actor.ref, /^D\d+$/);
  assert.deepEqual(applied.data.fields, ['layers']);
  assert.equal(applied.data.target, 2);
  const refused = mine.find((l) => l.type === 'cmd.refused');
  assert.ok(refused, 'cmd.refused via keyboard');
  assert.equal(refused.data.code, 'VALIDATION_COMMAND');
});

// ------------------------------------------------------------- canary
const TOKEN = 'k6canarytokenzz9q8w7e6r5t';
const SETUP_TOKEN = 'k6canarysetupaa1s2d3f4g5h';
const BOOT_SECRET = 'k6canarybootsecretqq0p9o8';
const CONFIRM_ID = 'c0ffee11c0ffee22c0ffee33c0ffee44';
const DEVICE_ID = 'remote-0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const PAIR_CODE = '"4827"';
const UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)';
const POISON = [
  TOKEN,
  SETUP_TOKEN,
  BOOT_SECRET,
  CONFIRM_ID,
  DEVICE_ID,
  PLANTED,
  THUMB,
  UA,
  `http://192.168.1.3:4173/twin-remote.html?setup=${SETUP_TOKEN}`,
  { token: TOKEN, name: PLANTED, id: DEVICE_ID },
  [TOKEN, PLANTED, DEVICE_ID],
];
const NEEDLES = [
  TOKEN,
  SETUP_TOKEN,
  BOOT_SECRET,
  CONFIRM_ID,
  DEVICE_ID,
  PAIR_CODE,
  'Ottoline',
  'Quarnby',
  'data:image',
  'base64',
  'Mozilla',
  'setup=',
];
/** Hostile extras on every event: a raw message spread, an actor with an id. */
const extras = () => ({
  actor: {
    ref: 'D7',
    kind: 'remote',
    name: PLANTED,
    id: DEVICE_ID,
    token: TOKEN,
  },
  corr: { reqId: 4, confirmId: CONFIRM_ID, cmdId: TOKEN },
  rev: { before: 1, after: 2, state: { token: TOKEN } },
  peer: { ip: '192.168.1.44', local: false, ua: UA },
  secure: false,
  token: TOKEN,
  setup: SETUP_TOKEN,
  text: PLANTED,
  thumb: THUMB,
  state: { screens: { 1: { by: DEVICE_ID } } },
});

/**
 * One realistic fixture per event type, each also carrying hostile
 * fields (sec S8). The catalogue test fails if a type has none.
 */
const FIXTURES = {
  'relay.boot': {
    data: {
      proto: 2,
      rev: 4,
      store: 'store',
      hostCheck: 'report',
      lanListening: true,
      retentionDays: 30,
      env: { FIRMS_KEY: TOKEN },
    },
  },
  'relay.stop': { data: { rev: 9, uptimeS: 60, setup: SETUP_TOKEN } },
  'store.error': {
    data: { what: 'saved_error', error: 'ENOSPC', to: `/Users/x/${PLANTED}` },
  },
  'log.opened': { data: { reason: 'day', prevFile: TOKEN } },
  'log.gap': {
    data: {
      since: '2026-10-23T21:00:00.000Z',
      downMs: 5000,
      lost: 3,
      error: 'EACCES',
    },
  },
  'log.pruned': {
    data: { files: 1, bytes: 100, trimmed: 2, names: [PLANTED] },
  },
  'audit.dropped': { data: { count: 7 } },
  'upgrade.refused': {
    data: {
      reason: 'origin',
      host: 'evil.example:4173',
      origin: `http://x/?t=${TOKEN}`,
    },
  },
  'http.refused': {
    data: {
      reason: 'local-host',
      path: `/api/twin-sync/log?token=${TOKEN}`,
      site: 'cross-site',
    },
  },
  'device.hello': {
    data: {
      outcome: 'denied',
      code: 'FORGOTTEN',
      kind: 'remote',
      viaToken: true,
      token: TOKEN,
      id: DEVICE_ID,
      name: PLANTED,
      setup: SETUP_TOKEN,
    },
  },
  'device.offline': { data: { kind: 'screen', slot: 2, id: DEVICE_ID } },
  'session.setup': {
    data: {
      ok: true,
      count: 4,
      tripId: 'trip-choir-austin',
      siteKey: 'austin-long-center',
      setup: SETUP_TOKEN,
    },
  },
  'device.paired': {
    data: {
      slot: 3,
      screenRef: 'D4',
      method: 'code',
      unpairedRefs: ['D2', DEVICE_ID],
      code: '4827',
      token: TOKEN,
    },
  },
  'pair.failed': {
    data: { reason: 'code', tries: 2, locked: false, code: '4827' },
  },
  'lease.granted': { data: { how: 'request', token: TOKEN } },
  'handover.requested': { data: { toRef: 'D3', fromName: PLANTED } },
  'handover.answered': { data: { ok: true, accept: true, fromRef: 'D5' } },
  'cmd.applied': {
    data: {
      type: 'session',
      target: null,
      fields: ['spotlight', 'report'],
      diffs: [
        {
          scope: 'session',
          field: 'spotlight',
          from: null,
          to: { kind: 'person', id: 'twin-OQ', name: PLANTED },
        },
        {
          scope: 'session',
          field: 'report',
          from: null,
          to: { id: 'op-17297', floor: 4, kind: PLANTED, note: PLANTED },
        },
        {
          scope: 'S1',
          field: 'frame',
          from: null,
          to: { subject: { kind: 'person', label: PLANTED }, nonce: 1 },
        },
        {
          scope: 'S2',
          field: 'layers',
          from: {},
          to: { radar: true, [PLANTED]: true },
        },
        { scope: 'session', field: 'tripId', from: null, to: DEVICE_ID },
      ],
      changed: ['session'],
      skipped: [],
      cmd: { patch: { spotlight: { name: PLANTED } } },
    },
  },
  'cmd.refused': {
    data: {
      type: 'screens',
      code: 'VALIDATION_COMMAND',
      field: 'by',
      error: `Not applied: ${PLANTED}`,
    },
  },
  'undo.applied': { data: { of: 12 } },
  'undo.refused': { data: { code: 'UNDO_EXPIRED' } },
  'confirm.asked': {
    corr: { confirmId: CONFIRM_ID },
    data: {
      parts: [
        {
          cmd: 'session',
          field: 'spotlight',
          person: 'twin-OQ',
          name: PLANTED,
          text: PLANTED,
        },
      ],
      text: `Spotlight ${PLANTED} on every wall?`,
      question: { text: `Spotlight ${PLANTED}?`, parts: [] },
      confirmId: CONFIRM_ID,
      applied: [1, 2],
      pinned: [3],
    },
  },
  'confirm.answered': {
    data: {
      parts: [{ cmd: 'returnLive' }],
      answer: 'confirm',
      waitedMs: 2100,
      confirmId: CONFIRM_ID,
    },
  },
  'confirm.expired': {
    data: { reason: 'timeout', waitedMs: 15000, text: PLANTED },
  },
  'confirm.stale': { data: { reason: 'stale', parts: [{ name: PLANTED }] } },
  'confirm.superseded': {
    data: { reason: 'superseded', confirmId: CONFIRM_ID },
  },
  'confirm.cancelled': {
    data: { answer: 'cancel', reason: 'cancelled', text: PLANTED },
  },
  'wall.hands': {
    data: {
      slot: 2,
      on: true,
      drift: false,
      reason: 'input',
      text: `hands-on · ${PLANTED}`,
    },
  },
  'wall.drift': {
    data: { slot: 1, on: true, reason: 'idle', text: 'drifting · idle camera' },
  },
  'wall.identify': { data: { ok: true, screens: 6 } },
  'review.set': { data: { on: true, item: 'hospital' } },
  'photo.set': { data: { action: 'keep', place: 'hotel' } },
  'camera.set': { data: { action: 'show', slot: 1 } },
  // K7: a limit (with what a flood would carry) and a message that threw.
  'limit.hit': {
    data: {
      limit: 'wrong-token',
      kind: 'remote',
      count: 10,
      retryAfterMs: 1000,
      dropped: 3,
      token: TOKEN,
      id: DEVICE_ID,
      code: '4827',
      ua: UA,
    },
  },
  'msg.error': {
    data: { type: 'cmd', error: `TypeError: ${PLANTED}`, raw: THUMB },
  },
};

test('K6 canary (catalogue): every event type has a fixture; with generated poison in every field, no secret, id, code, thumbnail, user agent or planted name reaches the folder', async () => {
  // A type with no fixture fails here (sec S8): fixtures follow the catalogue.
  assert.deepEqual(Object.keys(FIXTURES).sort(), [...AUDIT_EVENT_TYPES].sort());
  const dir = freshDir();
  const audit = createAuditLog({ dir, pruneEveryMs: 0 });
  let n = 0;
  for (const type of AUDIT_EVENT_TYPES) {
    const fx = FIXTURES[type];
    assert.ok(
      audit.emit(type, {
        ...extras(),
        ...fx,
        data: { ...fx.data, ...extras() },
      }),
      type,
    );
    n += 1;
    // Generated from the catalogue: each named field gets each poison
    // value. Header echoes (a refused peer's Host, path) are skipped:
    // they are recorded as received, on security events only (C38).
    for (const [k, kind] of Object.entries(AUDIT_EVENTS[type].data)) {
      if (kind.echo) continue;
      for (const p of POISON) {
        audit.emit(type, { ...extras(), data: { ...fx.data, [k]: p } });
        n += 1;
      }
    }
  }
  assert.equal(await audit.flush(), true);
  const text = folderText(dir);
  for (const needle of NEEDLES)
    assert.equal(text.includes(needle), false, `found ${needle}`);
  const lines = linesIn(dir);
  assert.equal(lines.length, n + 1, 'every event written (plus log.opened)');
  // The realistic values are still there: the allowlists keep what is fine.
  const first = (t) => lines.find((l) => l.type === t);
  assert.deepEqual(first('cmd.applied').data.diffs, [
    {
      scope: 'session',
      field: 'spotlight',
      from: null,
      to: { kind: 'person', id: 'twin-OQ' },
    },
    {
      scope: 'session',
      field: 'report',
      from: null,
      to: { id: 'op-17297', floor: 4 },
    },
    { scope: 'S1', field: 'frame', from: null, to: 'set' },
    { scope: 'S2', field: 'layers', from: {}, to: { radar: true } },
    { scope: 'session', field: 'tripId', from: null, to: '?' },
  ]);
  assert.deepEqual(first('confirm.asked').data, {
    parts: [{ cmd: 'session', field: 'spotlight', person: 'twin-OQ' }],
    applied: [1, 2],
    pinned: [3],
  });
  assert.deepEqual(first('confirm.asked').corr, {}, 'never the confirm id');
  assert.deepEqual(first('device.hello').actor, { ref: 'D7', kind: 'remote' });
  assert.equal(first('session.setup').data.tripId, 'trip-choir-austin');
  assert.equal(first('upgrade.refused').data.host, 'evil.example:4173');
  assert.equal(first('http.refused').data.path, '/api/twin-sync/log');
  // C38: the peer only where the catalogue allows it.
  for (const l of lines) {
    const entry = AUDIT_EVENTS[l.type];
    const refused = l.data.ok === false || l.data.outcome === 'denied';
    const allowed =
      entry.peer === 'always' || (entry.peer === 'refused' && refused);
    assert.equal('peer' in l, allowed, `${l.type} peer`);
    if (allowed) assert.deepEqual(l.peer, { ip: '192.168.1.44', local: false });
  }
  // A type outside the catalogue is never written.
  assert.equal(audit.emit('token.value', { data: { token: TOKEN } }), false);
  assert.equal(serialiseEvent('nope', {}), null);
});

test('K6 canary (relay run): after a full relay session, the folder holds no token, setup token, pairing code, device id, thumbnail or planted name', async () => {
  const dir = freshDir();
  const audit = createAuditLog({ dir, pruneEveryMs: 0 });
  const { secrets, ids } = goldenSession(audit);
  await audit.flush();
  const text = folderText(dir);
  assert.ok(secrets.size >= 7, `secrets seen: ${secrets.size}`);
  for (const s of [
    ...secrets,
    ...ids,
    'Ottoline',
    'Quarnby',
    'data:image',
    'Q0FOQVJZ',
  ])
    assert.equal(text.includes(s), false, `found ${s.slice(0, 12)}…`);
});

// ------------------------------------------------------------ storage
test('K6 T7.3: seq continues across a restart (a new log on the same folder) and is never reused', async () => {
  const dir = freshDir();
  const a = createAuditLog({ dir, pruneEveryMs: 0 });
  for (let i = 0; i < 5; i++) a.emit('audit.dropped', { data: { count: i } });
  await a.close();
  const last = linesIn(dir).at(-1).seq;
  // The last line torn by a crash is skipped when looking for the seq.
  fs.appendFileSync(
    path.join(dir, auditFiles(fs.readdirSync(dir))[0].name),
    '{"v":1,"seq":99',
  );
  const b = createAuditLog({ dir, pruneEveryMs: 0 });
  b.emit('audit.dropped', { data: { count: 9 } });
  await b.flush();
  const seqs = linesIn(dirFix(dir)).map((l) => l.seq);
  assert.ok(seqs.at(-1) > last);
  assert.equal(new Set(seqs).size, seqs.length, 'no seq twice');
  assert.notEqual(a.boot, b.boot);
});
/** The torn line is not JSON: drop it before parsing the folder. */
function dirFix(dir) {
  for (const f of auditFiles(fs.readdirSync(dir))) {
    const p = path.join(dir, f.name);
    const keep = fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => {
        try {
          JSON.parse(l);
          return true;
        } catch {
          return false;
        }
      });
    fs.writeFileSync(p, `${keep.join('\n')}\n`);
  }
  return dir;
}

test('K6 T7.4 retention: a 29-day file stays and a 31-day file goes; the 200 MB cap goes oldest first; would-refuse lines past 30 days are trimmed', async () => {
  const dir = freshDir();
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.parse('2026-10-23T12:00:00Z');
  const day = (n) => new Date(now - n * 86400000).toISOString().slice(0, 10);
  const put = (name, bytes = 10) =>
    fs.writeFileSync(path.join(dir, name), `${'x'.repeat(bytes - 1)}\n`);
  put(`audit-${day(31)}.jsonl`);
  put(`audit-${day(29)}.jsonl`);
  put(`audit-${day(29)}.2.jsonl`);
  put(`audit-${day(30)}.jsonl`);
  put('notes.txt');
  const old = new Date(now - 31 * 86400000).toISOString();
  const fresh = new Date(now - 2 * 86400000).toISOString();
  fs.writeFileSync(
    path.join(dir, 'would-refuse.jsonl'),
    `${JSON.stringify({ at: old, host: 'a' })}\n${JSON.stringify({ at: fresh, host: 'b' })}\n`,
  );
  const a = createAuditLog({ dir, now: () => now, pruneEveryMs: 0 });
  const r = await a.prune();
  assert.deepEqual(r, { files: 1, bytes: 10, trimmed: 1 });
  const left = fs.readdirSync(dir).sort();
  assert.ok(!left.includes(`audit-${day(31)}.jsonl`));
  for (const n of [
    `audit-${day(29)}.jsonl`,
    `audit-${day(30)}.jsonl`,
    'notes.txt',
  ])
    assert.ok(left.includes(n), n);
  const wr = fs.readFileSync(path.join(dir, 'would-refuse.jsonl'), 'utf8');
  assert.deepEqual(
    wr
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l).host),
    ['b'],
  );
  assert.equal(
    fs.statSync(path.join(dir, 'would-refuse.jsonl')).mode & 0o777,
    0o600,
  );
  await a.flush();
  assert.ok(
    linesIn(dir).some((l) => l.type === 'log.pruned' && l.data.files === 1),
  );
  // The cap: oldest first, never today's file.
  const b = createAuditLog({
    dir,
    now: () => now,
    pruneEveryMs: 0,
    maxTotalBytes: 25,
  });
  b.emit('audit.dropped', { data: { count: 1 } });
  await b.flush();
  const rb = await b.prune();
  assert.ok(rb.files >= 2, JSON.stringify(rb));
  const after = auditFiles(fs.readdirSync(dir)).map((f) => f.day);
  assert.deepEqual(after, [day(0)], 'only today is left');
});

test('K6 T7.7: the folder is 0700 and every file 0600; the default folder is ~/Library/Logs/trip-twin and is never used by tests', async () => {
  const dir = freshDir();
  const a = createAuditLog({ dir, pruneEveryMs: 0 });
  a.emit('audit.dropped', { data: { count: 1 } });
  await a.flush();
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  for (const f of fs.readdirSync(dir))
    assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600, f);
  assert.equal(defaultAuditDir('/Users/x'), '/Users/x/Library/Logs/trip-twin');
  assert.notEqual(process.env.TRIP_TWIN_AUDIT_DIR, defaultAuditDir());
});

// ----------------------------------------------------------- fail open
test('K6 T7.5 fail open: a sink that throws (ENOSPC) leaves commands working, flips health, and a gap row is written when it reopens', async () => {
  const dir = freshDir();
  let full = true;
  const sink = {
    ...fsp,
    appendFile: (...a) =>
      full
        ? Promise.reject(
            Object.assign(new Error('no space'), { code: 'ENOSPC' }),
          )
        : fsp.appendFile(...a),
  };
  const said = [];
  const audit = createAuditLog({
    dir,
    fs: sink,
    reopenMs: 30,
    pruneEveryMs: 0,
    log: (e, d) => said.push([e, d]),
  });
  const { socks, relay } = goldenSession(audit);
  assert.equal(await audit.flush(), false, 'not on disk');
  const h = audit.health();
  assert.equal(h.ok, false);
  assert.equal(h.lastError, 'ENOSPC');
  assert.ok(h.queued > 0 && h.downSince);
  assert.equal(
    said.filter(([e]) => e === 'audit.write_error').length,
    1,
    'one dev-log line, not one per try',
  );
  // Commands still work while the log is down.
  socks.V.say({
    t: 'cmd',
    reqId: 50,
    cmd: { type: 'screens', target: 1, patch: { pinned: true } },
  });
  assert.equal(socks.V.last('ack').ok, true);
  assert.equal(relay.health().counters.cmdApplied, 3);
  // The disk has room again: the queue is written after a gap row.
  full = false;
  await sleep(80);
  assert.equal(await audit.flush(), true);
  assert.equal(audit.health().ok, true);
  // Everything kept while it was down, then the gap row (at reopen).
  assert.deepEqual(typesIn(dir), [...GOLDEN, 'cmd.applied', 'log.gap']);
  const gap = linesIn(dir).find((l) => l.type === 'log.gap');
  assert.equal(gap.data.error, 'ENOSPC');
  assert.equal(gap.data.lost, 0);
  assert.ok(gap.data.downMs >= 30, `down ${gap.data.downMs} ms`);
});

test('K6 fail open: an unwritable folder (0500) does not stop commands; health says EACCES until it is writable again', async () => {
  const dir = freshDir();
  fs.mkdirSync(dir, { mode: 0o500 });
  fs.chmodSync(dir, 0o500);
  const audit = createAuditLog({
    dir: path.join(dir, 'logs'),
    reopenMs: 30,
    pruneEveryMs: 0,
  });
  const { socks } = goldenSession(audit);
  socks.V.say({
    t: 'cmd',
    reqId: 51,
    cmd: { type: 'screens', target: 2, patch: { pinned: true } },
  });
  assert.equal(socks.V.last('ack').ok, true);
  assert.equal(await audit.flush(), false);
  assert.equal(audit.health().ok, false);
  assert.equal(audit.health().lastError, 'EACCES');
  fs.chmodSync(dir, 0o700);
  await sleep(80);
  assert.equal(await audit.flush(), true);
  assert.equal(typesIn(path.join(dir, 'logs')).at(-1), 'log.gap');
});

// Worst lateness of a 5 ms heartbeat while `work` runs. On a busy machine
// the loop is late with or without the audit log, so each attempt also times
// a control (the same turns, no events) and the audit is charged only the
// difference; the best of three attempts counts, as a load spike is brief and
// a real regression shows in all three.
async function heartbeatLateness(work) {
  let worst = 0;
  let last = performance.now();
  const beat = setInterval(() => {
    const t = performance.now();
    worst = Math.max(worst, t - last - 5);
    last = t;
  }, 5);
  await sleep(20);
  worst = 0;
  last = performance.now();
  await work();
  clearInterval(beat);
  return worst;
}

test('K6 SEC-12: 10,000 events in a burst delay a heartbeat by at most 50 ms; past the queue cap they are counted and written as audit.dropped', async () => {
  const tries = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const dir = freshDir();
    const audit = createAuditLog({ dir, pruneEveryMs: 0 });
    await audit.flush(); // the boot line is on disk: all 10,000 fit the queue
    // The burst arrives as messages do: 100 to a turn of the event loop
    // (a full socket buffer), 10,000 in all, as fast as the loop allows.
    const burst = async (emit) => {
      for (let i = 0; i < 10000; i += 100) {
        if (emit)
          for (let j = i; j < i + 100; j++)
            audit.emit('cmd.applied', {
              actor: { ref: 'D3', kind: 'remote', name: 'iPad', via: 'touch' },
              rev: { before: j, after: j + 1 },
              data: {
                type: 'screens',
                target: 1,
                fields: ['layers'],
                diffs: [
                  {
                    scope: 'S1',
                    field: 'layers',
                    from: {},
                    to: { radar: true },
                  },
                ],
                changed: [1],
                skipped: [],
              },
            });
        await new Promise((r) => setImmediate(r));
      }
      if (emit) await audit.flush();
    };
    const control = await heartbeatLateness(() => burst(false));
    const t0 = performance.now();
    const worst = await heartbeatLateness(() => burst(true));
    const totalMs = performance.now() - t0;
    assert.equal(
      linesIn(dir).filter((l) => l.type === 'cmd.applied').length,
      10000,
    );
    tries.push({ added: worst - control, worst, control, totalMs });
    if (worst - control <= 50) break;
  }
  const best = tries.reduce((a, b) => (b.added < a.added ? b : a));
  assert.ok(
    best.added <= 50,
    `a heartbeat was ${best.added.toFixed(1)} ms later than the control in the best of ${tries.length} ` +
      `(${tries.map((t) => `${t.worst.toFixed(0)} vs ${t.control.toFixed(0)} ms, burst ${t.totalMs.toFixed(0)} ms`).join('; ')})`,
  );
  // The cap.
  const dir2 = freshDir();
  const small = createAuditLog({ dir: dir2, pruneEveryMs: 0, queueCap: 100 });
  let queued = 0;
  for (let i = 0; i < 150; i++)
    queued += small.emit('undo.applied', { data: { of: i } }) ? 1 : 0;
  // The boot line holds one of the 100 places.
  assert.equal(queued, 99);
  await small.flush();
  const tail = linesIn(dir2).at(-1);
  assert.equal(tail.type, 'audit.dropped');
  assert.deepEqual(tail.data, { count: 51 });
  assert.equal(small.health().dropped, 51);
});

// ---------------------------------------------------------- walls (BE-6)
test('K6 BE-6: drift and hands-on come from fields, one line per change; the text is never logged; a wall from before K6 logs hands-on only', async () => {
  const dir = freshDir();
  const audit = createAuditLog({ dir, pruneEveryMs: 0 });
  const { socks } = goldenSession(audit);
  await audit.flush();
  const before = linesIn(dir).length;
  const { S1 } = socks;
  S1.say({
    t: 'local',
    on: false,
    text: 'drifting',
    drift: true,
    driftReason: 'idle',
  });
  S1.say({
    t: 'local',
    on: false,
    text: 'drifting · x',
    drift: true,
    driftReason: 'idle',
  });
  // Hands on stops the drift: one line, the drift in it.
  S1.say({
    t: 'local',
    on: true,
    text: 'hands-on',
    drift: false,
    driftReason: 'input',
  });
  S1.say({
    t: 'local',
    on: true,
    text: 'hands-on',
    drift: 'yes',
    driftReason: 'made-up',
  });
  // An old wall: no drift field.
  S1.say({ t: 'local', on: false, text: 'drifting · idle camera' });
  await audit.flush();
  const rows = linesIn(dir).slice(before);
  assert.deepEqual(
    rows.map((l) => [l.type, l.data]),
    [
      ['wall.drift', { slot: 1, on: true, reason: 'idle' }],
      ['wall.hands', { slot: 1, on: true, drift: false, reason: 'input' }],
      ['wall.hands', { slot: 1, on: false, drift: false }],
    ],
  );
  assert.equal(rows[1].actor.via, 'touch');
  assert.equal(rows[0].actor.via, 'system');
  assert.equal(folderText(dir).includes('drifting'), false);
  // The wall's own rule (twinScreen.js): the first failing condition names it.
  assert.deepEqual(
    driftState([
      ['role', true],
      ['tier', true],
    ]),
    { drift: true, reason: 'idle' },
  );
  assert.deepEqual(
    driftState([
      ['role', true],
      ['input', false],
      ['incident', false],
    ]),
    { drift: false, reason: 'input' },
  );
  assert.ok(DRIFT_REASONS.includes('command'));
  // Remotes still get the text, and no new fields (no shape change).
  const remote = socks.V.all('local').at(-1);
  assert.deepEqual(Object.keys(remote).sort(), ['on', 'slot', 't', 'text']);
});

// -------------------------------------------------- health and the log
/** A request into a mounted middleware stack, as Vite would pass it. */
function call(app, url, { host, peer = '127.0.0.1', site, port = 4173 } = {}) {
  return new Promise((resolve) => {
    const req = {
      url,
      method: 'GET',
      headers: {
        host: host ?? `localhost:${port}`,
        ...(site ? { 'sec-fetch-site': site } : {}),
      },
      socket: { remoteAddress: peer, localPort: port, encrypted: false },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      writeHead(s, h = {}) {
        this.statusCode = s;
        for (const [k, v] of Object.entries(h)) this.setHeader(k, v);
      },
      end(body = '') {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = null;
        }
        resolve({ status: this.statusCode, json, body: String(body) });
      },
    };
    app.handle(req, res);
  });
}

test('K6 health (BE-10): GET /api/twin-sync/health on this computer says store, audit, host check, counters, timings and confirmBypass 0; no token, code or id in it', async () => {
  const dir = freshDir();
  const srv = await liveTwinServer({
    plugins: [twinSyncRelay()],
    before: (s) => {
      useAuditLog(s, createAuditLog({ dir, pruneEveryMs: 0 }));
      useHostCheck(
        s,
        createHostCheck({
          env: { TRIP_TWIN_AUDIT_DIR: dir },
          bonjour: () => null,
        }),
      );
    },
  });
  try {
    const r = await srv.request('/api/twin-sync/health', {
      headers: { host: `localhost:${srv.port}` },
    });
    assert.equal(r.status, 200, r.body);
    const h = r.json;
    assert.equal(h.audit.ok, true);
    assert.equal(h.store.ok, true);
    assert.equal(h.hostCheck.mode, 'report');
    assert.equal(h.counters.confirmBypass, 0);
    assert.equal(h.confirm, 'remote');
    assert.equal(h.proto, PROTO);
    assert.ok('applyToBroadcastMsP95' in h.timings);
    assert.equal(r.headers['cache-control'], 'no-store');
    // The relay booted into the log.
    await sleep(30);
    assert.equal(typesIn(dir)[0], 'relay.boot');
  } finally {
    await srv.close();
  }
  // The body after a real session: counters move, nothing secret in it.
  const audit = createAuditLog({ dir: freshDir(), pruneEveryMs: 0 });
  const { relay, secrets, ids } = goldenSession(audit);
  const body = healthOf({
    relay,
    audit,
    store: { status: () => ({ ok: true, dir: '/data', loaded: 'store' }) },
    check: { status: () => ({ mode: 'report' }) },
    startedAt: Date.now() - 5000,
  });
  assert.equal(body.counters.cmdApplied, 2);
  assert.deepEqual(body.counters.cmdRefused, { LEASE_NOT_CONTROLLER: 1 });
  assert.deepEqual(body.counters.undoRefused, { UNDO_EXPIRED: 1 });
  assert.deepEqual(body.counters.helloDenied, { NOT_TRUSTED: 1 });
  assert.deepEqual(body.counters.pairFailed, { code: 1 });
  assert.equal(body.counters.thumbs, 1);
  assert.equal(body.counters.confirmBypass, 0);
  assert.equal(body.timings.samples, 2);
  assert.equal(body.devices.screensPaired, 3);
  assert.equal(body.uptimeS, 5);
  const text = JSON.stringify(body);
  for (const s of [...secrets, ...ids])
    assert.equal(text.includes(s), false, s.slice(0, 12));
});

test('K6 §4.4: /health and /log are refused for a LAN Host, a non-loopback peer and a cross-site page, in report mode; each refusal is an audit event with the peer', async () => {
  const dir = freshDir();
  const audit = createAuditLog({ dir, pruneEveryMs: 0 });
  const check = createHostCheck({
    env: { TRIP_TWIN_AUDIT_DIR: dir },
    bonjour: () => null,
    audit,
    port: () => 4173,
  });
  const srv = await liveTwinServer({
    plugins: [twinSyncRelay()],
    before: (s) => {
      useAuditLog(s, audit);
      useHostCheck(s, check);
    },
  });
  try {
    const app = srv.server.middlewares;
    assert.equal(check.mode, 'report');
    for (const p of ['/api/twin-sync/health', '/api/twin-sync/log']) {
      assert.equal((await call(app, p)).status, 200, `${p} from this computer`);
      const lanHost = await call(app, p, { host: '192.168.1.3:4173' });
      assert.equal(lanHost.status, 403, `${p} LAN Host`);
      assert.equal(lanHost.json.ok, false);
      assert.equal('audit' in lanHost.json, false);
      assert.equal(
        (await call(app, p, { peer: '192.168.1.20' })).status,
        403,
        `${p} LAN peer`,
      );
      assert.equal(
        (await call(app, p, { peer: '::ffff:192.168.1.20' })).status,
        403,
        `${p} mapped LAN peer`,
      );
      assert.equal(
        (await call(app, p, { site: 'cross-site' })).status,
        403,
        `${p} cross-site`,
      );
    }
    await audit.flush();
    const refused = linesIn(dir).filter((l) => l.type === 'http.refused');
    assert.deepEqual(
      refused.map((l) => l.data.reason),
      [
        'local-host',
        'local-peer',
        'local-peer',
        'fetch-site',
        'local-host',
        'local-peer',
        'local-peer',
        'fetch-site',
      ],
    );
    assert.deepEqual(refused[1].peer, { ip: '192.168.1.20', local: false });
    assert.equal(refused[0].data.path, '/api/twin-sync/health');
  } finally {
    await srv.close();
  }
});

test('K6 /log (BE-11, lean): written events after `since`, in seq order, in the public form (no peer), paged by `next`', async () => {
  const dir = freshDir();
  const audit = createAuditLog({ dir, pruneEveryMs: 0 });
  goldenSession(audit);
  await audit.flush();
  const a = audit.tail(0, 5);
  assert.equal(a.events.length, 5);
  const b = audit.tail(a.next, 200);
  const all = [...a.events, ...b.events];
  assert.deepEqual(
    all.map((e) => e.seq),
    linesIn(dir).map((l) => l.seq),
  );
  for (const e of all) assert.equal('peer' in e, false);
  assert.deepEqual(audit.tail(b.next).events, []);
});

test('K6 C38: the peer is written for refusals and security events only; an accepted hello has none', async () => {
  const dir = freshDir();
  const audit = createAuditLog({ dir, pruneEveryMs: 0 });
  goldenSession(audit);
  await audit.flush();
  const lines = linesIn(dir);
  const hellos = lines.filter((l) => l.type === 'device.hello');
  assert.deepEqual(hellos[0].peer, { ip: '127.0.0.1', local: true });
  for (const h of hellos.slice(1))
    assert.equal('peer' in h, false, h.data.outcome);
  assert.deepEqual(lines.find((l) => l.type === 'pair.failed').peer, {
    ip: '192.168.1.44',
    local: false,
  });
  for (const l of lines.filter((x) =>
    ['cmd.applied', 'wall.hands', 'session.setup'].includes(x.type),
  ))
    assert.equal('peer' in l, false, l.type);
});

test('K6 host check: a refused upgrade and a cross-site GET are audit events with the peer and the Host clipped; past 60 a minute the next line counts the rest', async () => {
  const dir = freshDir();
  let t = 1_000_000;
  const audit = createAuditLog({ dir, pruneEveryMs: 0 });
  const check = createHostCheck({
    env: { TRIP_TWIN_AUDIT_DIR: dir },
    bonjour: () => null,
    audit,
    now: () => t,
  });
  for (let i = 0; i < 65; i++)
    check.note(
      'upgrade.refused',
      { reason: 'origin' },
      {
        peer: { ip: '192.168.1.9', local: false },
        secure: false,
        data: { host: `evil.example:4173${'x'.repeat(80)}` },
      },
    );
  t += 60_000;
  check.note(
    'upgrade.refused',
    { reason: 'origin' },
    { peer: { ip: '192.168.1.9', local: false } },
  );
  await audit.flush();
  const rows = linesIn(dir).filter((l) => l.type === 'upgrade.refused');
  assert.equal(rows.length, 61);
  assert.equal(rows[0].data.host.length, 64);
  assert.equal(rows[0].secure, false);
  assert.deepEqual(rows[0].peer, { ip: '192.168.1.9', local: false });
  assert.equal(rows.at(-1).data.dropped, 5);
});

test('K6 relay boot and stop: relay.boot then relay.stop through the Vite plugin; a store problem at start is a store.error line without paths', async () => {
  const dir = freshDir();
  const audit = createAuditLog({ dir, pruneEveryMs: 0 });
  const prev = process.env.TRIP_TWIN_DATA_DIR;
  // A data folder inside the repo is refused (S-1): the wall runs unsaved.
  process.env.TRIP_TWIN_DATA_DIR = REPO_DOCS;
  const srv = await liveTwinServer({
    plugins: [twinSyncRelay()],
    before: (s) => {
      useAuditLog(s, audit);
      useHostCheck(
        s,
        createHostCheck({
          env: { TRIP_TWIN_AUDIT_DIR: dir },
          bonjour: () => null,
        }),
      );
    },
  });
  process.env.TRIP_TWIN_DATA_DIR = prev;
  await srv.close();
  await audit.flush();
  const lines = linesIn(dir);
  const types = lines.map((l) => l.type).filter((x) => x !== 'log.opened');
  assert.deepEqual(types, [
    'store.error',
    'store.error',
    'relay.boot',
    'relay.stop',
  ]);
  assert.deepEqual(
    lines.filter((l) => l.type === 'store.error').map((l) => l.data.what),
    ['dir_refused', 'memory_only'],
  );
  assert.equal(folderText(dir).includes(REPO_DOCS), false, 'no path');
  const boot = lines.find((l) => l.type === 'relay.boot');
  assert.equal(boot.data.store, 'memory');
  assert.equal(boot.data.hostCheck, 'report');
  assert.equal(boot.data.proto, PROTO);
});
