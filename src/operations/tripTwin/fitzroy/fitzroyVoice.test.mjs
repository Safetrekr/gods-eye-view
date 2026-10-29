// Fitzroy V1 (plans/trip-twin/FITZROY-V1-HOWTO.md; VOICE-CONTROL §2–§3):
// the remote's voice glue (decision → catalog proposal → the exact relay
// message, the tiers, the context), the relay with a proposal the remote
// submits (VIA.VOICE, Tier B waits for the server's confirm, Tier C is
// refused, nothing of the utterance reaches the log or the session), the
// push-to-talk WAV encoder and the dev server's voice route.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { clockHost, fakeSocket } from '../twinTestKit.mjs';
import { CODE, PROTO, VOICE_CONFIRM_MS } from '../twinProtocol.js';
import { applyCommand, createSession } from '../twinSession.js';
import { tripTwinDemoSnapshot } from '../demoTripTwin.js';
import { tripById } from '../demoTripList.js';
import { createFitzroyCatalog } from './fitzroyCatalog.js';
import {
  SAY,
  callsFor,
  controlSay,
  placeCategory,
  planTurn,
  remoteTwin,
  sayAfter,
  voiceContext,
  voiceFlag,
  voiceMessage,
} from './fitzroyVoice.js';
import { encodeWav, fromB64, toB64 } from '../remote/voiceAudio.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-voice-v1-'));
process.env.TMPDIR = path.join(scratch, 'tmp');
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
fs.mkdirSync(process.env.TMPDIR);
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const { createRelay } =
  await import('../../../../server/tripTwin/syncRelay.js');
const { createAuditLog } =
  await import('../../../../server/tripTwin/auditLog.js');
const { twinVoiceProxy, voiceHandler } =
  await import('../../../../server/tripTwin/voiceProxy.js');

const NOW = Date.parse('2026-10-22T15:00:00Z');
const TRIP = 'trip-choir-austin';
const fresh = () => createSession({ count: 6, tripId: TRIP, epochMs: NOW });
const at = (state, cmd) => applyCommand(state, cmd, { at: NOW }).state;
const snap = (() => {
  const t = tripById(TRIP);
  return tripTwinDemoSnapshot(t.city, t.scenario, { startMs: NOW });
})();

/** A catalog on `get()` with this remote's twin service (as remoteVoice). */
function catalogOn(get, last = () => null) {
  return createFitzroyCatalog({
    twin: remoteTwin({
      state: get,
      now: () => NOW,
      lastUndo: last,
      incidentOpen: () => Boolean(get()?.session?.report),
      tripDays: () => 3,
      snapshot: () => snap,
    }),
  });
}
/** A turn as the voice service returns it (voice-lab/src/v1/service.py). */
const turn = (
  decision,
  transcript = 'storm radar on screen four',
  extra = {},
) => ({
  transcript,
  decision,
  tier: 'A',
  readback: '',
  ...extra,
});

test('V1 flag and context: ?voice=1 only; the decision context comes from the remote’s own session (trip, the hotel as default site, screens with pins and scale, report, visitor, memory, seconds)', () => {
  assert.equal(voiceFlag('?voice=1'), true);
  for (const s of ['', '?voice=0', '?voice=true', '?setup=x'])
    assert.equal(voiceFlag(s), false, s);
  let st = fresh();
  st = at(st, { type: 'screens', target: 3, patch: { pinned: true } });
  st = at(st, { type: 'session', patch: { visitor: true } });
  const ctx = voiceContext(st, {
    pending: 'Switch now?',
    lastTarget: { screen: 2, kind: 'text', at: 1 },
    nowMs: NOW,
    source: 'mac-remote',
  });
  assert.equal(ctx.trip, TRIP);
  assert.equal(ctx.site, tripById(TRIP).city);
  assert.equal(ctx.screens.length, 6);
  assert.deepEqual(
    ctx.screens.map((s) => s.slot),
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(ctx.screens[2].pinned, true);
  assert.equal(ctx.screens[0].pinned, undefined);
  assert.equal(ctx.screens[3].role, 'weather');
  assert.deepEqual(
    [ctx.pending, ctx.report, ctx.visitor, ctx.now, ctx.source],
    ['Switch now?', false, true, NOW / 1000, 'mac-remote'],
  );
  assert.deepEqual(ctx.last_target, { screen: 2, kind: 'text', at: 1 });
  // A report open (or the trip data's incident) raises the report flag.
  assert.equal(voiceContext(st, { reportOpen: true }).report, true);
  st = at(st, { type: 'session', patch: { siteKey: 'austin-long-center' } });
  assert.equal(voiceContext(st).site, 'austin-long-center');
});

test('V1 mapping: every rules-v2 decision shape → its catalog entry and arguments, or a question, a control, a touch-only line, a later feature or nothing', () => {
  const one = (d) => callsFor(d).calls?.[0];
  assert.deepEqual(one({ op: 'layer', target: 4, key: 'radar3d', on: true }), {
    name: 'set_screen_layer',
    args: { screen: '4', layer: 'radar3d', on: true },
  });
  assert.deepEqual(
    one({ op: 'layer', target: 'all', key: 'clouds', on: false }).args,
    {
      screen: 'all',
      layer: 'clouds',
      on: false,
    },
  );
  assert.deepEqual(one({ op: 'text', target: 2, dir: -1 }), {
    name: 'step_screen_text',
    args: { screen: '2', direction: 'down' },
  });
  assert.deepEqual(one({ op: 'scale', target: 1, value: 'city' }).args, {
    screen: '1',
    scale: 'city',
  });
  assert.equal(
    one({ op: 'role', target: 3, value: 'travelers' }).name,
    'set_screen_role',
  );
  assert.deepEqual(one({ op: 'pin', target: 6 }), {
    name: 'pin_screen',
    args: { screen: '6' },
  });
  assert.deepEqual(one({ op: 'advance', target: 'all', day: 2 }).args, {
    screen: 'all',
    day: 2,
  });
  assert.deepEqual(one({ op: 'reset' }).args, { screen: 'all' });
  assert.deepEqual(one({ op: 'spotlight', kind: 'person', id: 'twin-NF' }), {
    name: 'spotlight_person',
    args: { person: 'twin-NF' },
  });
  assert.deepEqual(
    one({ op: 'spotlight', kind: 'place', id: 'sp-austin-hospital' }),
    {
      name: 'spotlight_place',
      args: { place: 'hospital' },
    },
  );
  assert.equal(placeCategory('sp-austin-rally-2'), 'rally_secondary');
  assert.equal(placeCategory('sp-london-safe-house'), 'safe_house');
  assert.equal(placeCategory('nope'), null);
  assert.equal(one({ op: 'wx', minutes: null }).name, 'set_weather_now');
  assert.deepEqual(one({ op: 'wx', minutes: 30 }).args, { minutes: 30 });
  assert.deepEqual(one({ op: 'trip', id: 'trip-youth-london' }).args, {
    trip: 'trip-youth-london',
  });
  assert.deepEqual(one({ op: 'site', key: 'austin-long-center' }).args, {
    site: 'austin-long-center',
  });
  assert.equal(one({ op: 'returnLive' }).name, 'return_all_live');
  assert.equal(one({ op: 'visitor', on: true }).name, 'visitor_on');
  assert.deepEqual(one({ op: 'simStorm', on: false }).args, {
    hazard: 'storm',
  });
  assert.equal(one({ op: 'undo' }).name, 'undo_last');
  // Never the less-safe direction, even if a decision said so.
  assert.equal(callsFor({ op: 'visitor', on: false }).kind, 'question');
  assert.equal(callsFor({ op: 'simStorm', on: true }).kind, 'question');
  const multi = callsFor({
    op: 'multi',
    ops: [
      { op: 'layer', target: 4, key: 'radar3d', on: true },
      { op: 'text', target: 2, dir: 1 },
    ],
  });
  assert.deepEqual(
    multi.calls.map((c) => c.name),
    ['set_screen_layer', 'step_screen_text'],
  );
  assert.deepEqual(callsFor({ ask: 'screen' }, 'Which screen?'), {
    kind: 'question',
    say: 'Which screen?',
  });
  assert.deepEqual(callsFor({ ctl: 'yes' }), {
    kind: 'control',
    control: 'yes',
  });
  assert.deepEqual(callsFor({ op: 'voiceMute' }), {
    kind: 'control',
    control: 'mute',
  });
  assert.deepEqual(
    callsFor({ op: 'route', from: 'a', to: 'b', mode: 'walk' }),
    {
      kind: 'later',
      say: SAY.routes,
    },
  );
  assert.deepEqual(callsFor({ answer: 'stormEta' }), {
    kind: 'later',
    say: SAY.questions,
  });
  assert.deepEqual(callsFor({ none: true }), { kind: 'none', say: '' });
  // Tier C refusals carry the catalog's own touch-only words.
  for (const [refuse, intent] of [
    ['incidentAck', 'acknowledge_incident'],
    ['visitorOff', 'visitor_off'],
    ['simStormStart', 'start_demo'],
    ['count', 'set_screen_count'],
    ['report', 'report_incident'],
  ]) {
    const c = callsFor({ refuse });
    assert.equal(c.kind, 'touch');
    assert.equal(c.intent, intent);
    assert.match(c.say, /^Touch only: .+ on the remote/);
  }
});

test('V1 proposals: Tier A acts with the catalog’s read-back, Tier B asks with its closed question, Tier C is touch only, the guard refuses what lowers protection; the relay message is the catalog’s with an envelope of the intent alone', async () => {
  let st = fresh();
  const cat = catalogOn(() => st);
  const a = await planTurn(
    cat,
    turn({ op: 'layer', target: 4, key: 'radar3d', on: true }),
  );
  assert.deepEqual([a.kind, a.tier], ['act', 'A']);
  assert.equal(a.say, 'Screen 4, Weather: storm shells on.');
  const m = voiceMessage(a.proposals[0]);
  assert.deepEqual(m, {
    t: 'cmd',
    cmd: { type: 'screens', target: 4, patch: { layers: { radar3d: true } } },
    voice: { intent: 'set_screen_layer' },
  });
  const b = await planTurn(cat, turn({ op: 'trip', id: 'trip-youth-london' }));
  assert.deepEqual([b.kind, b.tier], ['ask', 'B']);
  assert.match(b.say, /Switch now\?$/);
  assert.equal(voiceMessage(b.proposals[0]).voice.intent, 'switch_trip');
  const c = await planTurn(cat, turn({ refuse: 'visitorOff' }));
  assert.deepEqual([c.kind, c.tier, c.intent], ['touch', 'C', 'visitor_off']);
  assert.equal(c.proposals.length, 0);
  // Return all asks (once there is something to return); the calming ones act.
  assert.equal(
    (await planTurn(cat, turn({ op: 'returnLive' }))).say,
    'Nothing changed.',
  );
  st = at(st, m.cmd);
  assert.equal((await planTurn(cat, turn({ op: 'returnLive' }))).kind, 'ask');
  assert.equal(
    (await planTurn(cat, turn({ op: 'visitor', on: true }))).kind,
    'act',
  );
  // The guard: a safety layer stays on while an incident is open.
  st = at(st, {
    type: 'session',
    patch: { report: { id: 'r1', floor: 3, kind: 'fire', at: NOW } },
  });
  const r = await planTurn(
    cat,
    turn({ op: 'layer', target: 1, key: 'safety', on: false }),
  );
  assert.equal(r.kind, 'refused');
  assert.equal(r.say, 'That layer stays on while an incident is open.');
  // A screen that is not there is said, never clamped.
  st = createSession({ count: 4, tripId: TRIP, epochMs: NOW });
  const no = await planTurn(cat, turn({ op: 'pin', target: 6 }));
  assert.deepEqual([no.kind, no.say], ['refused', 'There is no screen 6.']);
  // The envelope never carries anything but the intent.
  const sneaky = {
    message: {
      t: 'cmd',
      cmd: { type: 'session', patch: { visitor: true } },
      voice: {
        intent: 'visitor_on',
        transcript: 'visitors are in',
        heard: 'x',
      },
    },
  };
  assert.deepEqual(voiceMessage(sneaky).voice, { intent: 'visitor_on' });
  assert.equal(voiceMessage({ message: null }), null);
  assert.equal(voiceMessage({ message: { t: 'cmd', cmd: {} } }), null);
});

test('V1 two changes, undo and words: two Tier A changes go together; one that would ask makes it "say them one at a time"; undo needs this remote’s own last change; the words after the relay answers', async () => {
  const st = fresh();
  let last = null;
  const cat = catalogOn(
    () => st,
    () => last,
  );
  const two = await planTurn(
    cat,
    turn({
      op: 'multi',
      ops: [
        { op: 'layer', target: 4, key: 'radar3d', on: true },
        { op: 'layer', target: 1, key: 'streets', on: true },
      ],
    }),
  );
  assert.deepEqual([two.kind, two.proposals.length], ['act', 2]);
  const mixed = await planTurn(
    cat,
    turn({
      op: 'multi',
      ops: [
        { op: 'layer', target: 4, key: 'radar3d', on: true },
        { op: 'trip', id: 'trip-youth-london' },
      ],
    }),
  );
  assert.deepEqual(
    [mixed.kind, mixed.say, mixed.proposals.length],
    ['question', SAY.twoChanges, 0],
  );
  const none = await planTurn(cat, turn({ op: 'undo' }));
  assert.deepEqual([none.kind, none.say], ['refused', 'Nothing to undo.']);
  last = { undoId: 'u-7', before: st };
  const undo = await planTurn(cat, turn({ op: 'undo' }));
  assert.equal(undo.kind, 'undo');
  assert.deepEqual(voiceMessage(undo.proposals[0]), {
    t: 'undo',
    undoId: 'u-7',
    voice: { intent: 'undo_last' },
  });
  // Words after the relay's answer.
  const p = {
    readBack: 'Screen 4, Weather: storm shells on.',
    question: 'Switch now?',
  };
  assert.equal(sayAfter({ kind: 'act' }, p, { ok: true }), p.readBack);
  assert.equal(
    sayAfter({ kind: 'ask' }, p, { ok: false, code: CODE.CONFIRM_REQUIRED }),
    'Switch now?',
  );
  assert.equal(
    sayAfter({ kind: 'act' }, p, {
      ok: false,
      code: CODE.VOICE_REFUSED,
      error: 'Touch only: x.',
    }),
    'Touch only: x.',
  );
  assert.equal(sayAfter({ kind: 'act' }, p, undefined), SAY.notController);
  assert.equal(
    sayAfter({ kind: 'undo' }, p, { ok: true, restored: [{}] }),
    SAY.undone,
  );
  assert.equal(
    sayAfter({ kind: 'undo' }, p, { ok: true, restored: [] }),
    SAY.nothingUndone,
  );
  // The spoken yes is touch until the speaker check (A15); cancel works.
  assert.equal(controlSay('yes', { pending: true }), SAY.tapConfirm);
  assert.equal(controlSay('yes', { pending: false }), '');
  assert.equal(controlSay('no', { pending: true }), SAY.cancelled);
  assert.equal(controlSay('mute'), SAY.muted);
});

/** A relay with the audit log on, a wall, and this Mac's remote. */
function rig() {
  const k = clockHost({ count: 6 });
  const dir = fs.mkdtempSync(path.join(scratch, 'audit-'));
  const audit = createAuditLog({ dir, pruneEveryMs: 0 });
  const relay = createRelay({
    host: k.host,
    now: k.now,
    audit,
    healthFlags: () => ({ audit: true, store: true }),
  });
  const wall = fakeSocket();
  relay.attach(wall);
  wall.say({
    t: 'hello',
    id: 'S1',
    kind: 'screen',
    setup: k.setup,
    slot: 1,
    proto: PROTO,
  });
  const mac = fakeSocket();
  relay.attach(mac);
  mac.say({
    t: 'hello',
    id: 'R-mac',
    kind: 'remote',
    setup: k.setup,
    name: 'Laptop',
    proto: PROTO,
  });
  let req = 100;
  /** Submit as remoteVoice does (the remote's own socket); → the ack. */
  const submit = (msg) => {
    mac.say({ ...msg, reqId: ++req });
    return mac.last('ack');
  };
  const text = async () => {
    await audit.flush();
    return fs
      .readdirSync(dir)
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
  };
  const lines = async () =>
    (await text())
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  return { ...k, wall, mac, submit, text, lines };
}

test('V1 relay: a proposal the Mac remote builds from a heard turn and submits on its own socket is stamped VIA.VOICE; Tier B waits for the server’s confirm (reason voice) and applies only on this remote’s confirm; Tier C is refused VOICE_REFUSED and logged; no transcript reaches the log or the session', async () => {
  const { host, wall, mac, submit, text, lines } = rig();
  const cat = catalogOn(() => host.state);
  const HEARD = [
    'Fitzroy storm radar on the weather screen please',
    'Fitzroy switch to the London youth choir',
    'Fitzroy bring the names back Ottoline',
  ];
  // Tier A: acts at once, by voice, under the Mac's identity.
  const a = await planTurn(
    cat,
    turn({ op: 'layer', target: 4, key: 'radar3d', on: true }, HEARD[0]),
  );
  const ackA = submit(voiceMessage(a.proposals[0]));
  assert.equal(ackA.ok, true);
  assert.ok(ackA.undoId, 'Tier A comes back with its undo');
  const st = wall.last('state');
  // The relay names this computer's own remote itself (never the page).
  assert.deepEqual([st.by.via, st.by.kind], ['voice', 'remote']);
  assert.equal(st.by.ref, host.actorOf('R-mac', 'voice').ref);
  assert.equal(host.state.screens[4].layers.radar3d, true);
  assert.equal(
    sayAfter(a, a.proposals[0], ackA),
    'Screen 4, Weather: storm shells on.',
  );
  // Tier B: the server asks; nothing changes until this remote confirms.
  const b = await planTurn(
    cat,
    turn({ op: 'trip', id: 'trip-youth-london' }, HEARD[1]),
  );
  assert.equal(b.kind, 'ask');
  const rev = host.state.rev;
  const trip0 = host.state.session.tripId;
  const q = submit(voiceMessage(b.proposals[0]));
  assert.deepEqual(
    [q.code, q.reason, q.ttlMs],
    [CODE.CONFIRM_REQUIRED, 'voice', VOICE_CONFIRM_MS],
  );
  assert.equal(host.state.rev, rev);
  assert.equal(host.state.session.tripId, trip0);
  assert.match(sayAfter(b, b.proposals[0], q), /Switch now\?$/);
  const yes = submit({ t: 'confirm', confirmId: q.confirmId });
  assert.deepEqual([yes.ok, yes.via], [true, 'voice']);
  assert.equal(host.state.session.tripId, 'trip-youth-london');
  assert.equal(wall.last('state').by.via, 'voice');
  // Tier C: said on the remote; the relay refuses it and logs the intent.
  const c = await planTurn(cat, turn({ refuse: 'visitorOff' }, HEARD[2]));
  const before = host.state.rev;
  const no = submit({ t: 'cmd', cmd: null, voice: { intent: c.intent } });
  assert.deepEqual(
    [no.ok, no.code, no.reason],
    [false, CODE.VOICE_REFUSED, 'touch_only'],
  );
  assert.equal(no.error, c.say);
  assert.equal(host.state.rev, before);
  const log = await lines();
  const refused = log.filter((l) => l.type === 'voice.refused');
  assert.equal(refused.length, 1);
  assert.deepEqual(
    [refused[0].data.intent, refused[0].data.reason, refused[0].actor.via],
    ['visitor_off', 'touch_only', 'voice'],
  );
  assert.ok(
    log.some((l) => l.type === 'cmd.applied' && l.actor.via === 'voice'),
  );
  // Nothing of the utterance anywhere: the log, the session, the walls.
  const all = [
    await text(),
    JSON.stringify(host.state),
    JSON.stringify(wall.out),
    JSON.stringify(mac.out),
  ].join('\n');
  for (const h of HEARD) assert.equal(all.includes(h), false, h);
  for (const w of ['Fitzroy', 'Ottoline', 'please', 'transcript'])
    assert.equal(all.includes(w), false, w);
});

test('V1 relay: "undo" from the remote that made the change takes it back by voice (revision-checked), with the relay’s own answer', async () => {
  const { host, submit, wall } = rig();
  const cat = catalogOn(() => host.state);
  const was = host.state.screens[2].layers.radar3d;
  const a = await planTurn(
    cat,
    turn({ op: 'layer', target: 2, key: 'radar3d', on: true }),
  );
  const ack = submit(voiceMessage(a.proposals[0]));
  const cat2 = catalogOn(
    () => host.state,
    () => ({ undoId: ack.undoId, before: host.state }),
  );
  const u = await planTurn(cat2, turn({ op: 'undo' }));
  const r = submit(voiceMessage(u.proposals[0]));
  assert.equal(r.ok, true);
  assert.equal(r.restored.length > 0, true);
  assert.equal(host.state.screens[2].layers.radar3d, was);
  assert.equal(sayAfter(u, u.proposals[0], r), SAY.undone);
  assert.equal(wall.last('state').by.via, 'voice');
});

test('V1 audio: the push-to-talk encoder writes a 16 kHz mono 16-bit WAV from 48 kHz chunks (box-averaged, clipped); base64 round-trips', () => {
  const rate = 48000;
  const sine = new Float32Array(rate / 2).map(
    (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate),
  );
  const loud = new Float32Array(300).fill(2);
  const wav = encodeWav([sine, loud], rate);
  const dv = new DataView(wav.buffer);
  const str = (o, n) => String.fromCharCode(...wav.subarray(o, o + n));
  assert.deepEqual(
    [str(0, 4), str(8, 4), str(12, 4), str(36, 4)],
    ['RIFF', 'WAVE', 'fmt ', 'data'],
  );
  assert.deepEqual(
    [
      dv.getUint16(20, true),
      dv.getUint16(22, true),
      dv.getUint32(24, true),
      dv.getUint16(34, true),
    ],
    [1, 1, 16000, 16],
  );
  const samples = Math.floor((rate / 2 + 300) / 3);
  assert.equal(dv.getUint32(40, true), samples * 2);
  assert.equal(wav.length, 44 + samples * 2);
  assert.equal(dv.getInt16(44 + (samples - 1) * 2, true), 0x7fff);
  assert.deepEqual(fromB64(toB64(wav)), wav);
});

test('V1 dev route: /api/twin-voice forwards the four paths to the loopback voice service as they are, answers 404 for anything else and "Voice down" when the service is not running; dev server only', async () => {
  const seen = [];
  const up = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push([req.method, req.url, body]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
  });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const port = up.address().port;
  const call = (handler, method, url, body = '') =>
    new Promise((resolve) => {
      const req = Object.assign(
        (async function* () {
          if (body) yield Buffer.from(body);
        })(),
        { method, url },
      );
      const res = {
        writeHead(status) {
          this.status = status;
        },
        end(b) {
          resolve({ status: this.status, body: JSON.parse(String(b)) });
        },
      };
      handler(req, res);
    });
  const h = voiceHandler({ port });
  const turnBody = JSON.stringify({
    audio: 'UklGRg==',
    context: { trip: TRIP },
  });
  assert.deepEqual((await call(h, 'POST', '/turn', turnBody)).body, {
    ok: true,
    path: '/turn',
  });
  assert.deepEqual(seen.at(-1), ['POST', '/turn', turnBody]);
  assert.equal((await call(h, 'GET', '/health')).status, 200);
  assert.equal(
    (await call(h, 'POST', '/speak', '{"text":"Undone."}')).body.path,
    '/speak',
  );
  assert.equal((await call(h, 'POST', '/reset', '{}')).body.path, '/reset');
  assert.equal((await call(h, 'GET', '/turn')).status, 404);
  assert.equal((await call(h, 'POST', '/decide', '{}')).status, 404);
  await new Promise((r) => up.close(r));
  const down = await call(h, 'GET', '/health');
  assert.deepEqual([down.status, down.body.error], [503, 'Voice down']);
  assert.equal(twinVoiceProxy().apply, 'serve');
});
