// Fitzroy, 29 Oct 2026 (Jesse: "1-3"; FITZROY-V1-HOWTO.md): the default
// screen for a command that names none (talkingAbout, sent as
// context.default_target), the hands-free segmenter and its self-trigger
// mute, the relay's listening flag (it reaches the walls; no word ever
// does) and the dev route's new paths. The usage log, the name gate and
// the default-screen decisions are tested in voice-lab (src/v1/test_v1.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { clockHost, fakeSocket } from '../twinTestKit.mjs';
import { PROTO } from '../twinProtocol.js';
import { createSession } from '../twinSession.js';
import {
  SAY,
  TALK_IDLE_MS,
  logText,
  talkingAbout,
  talkingText,
  voiceContext,
} from './fitzroyVoice.js';
import {
  FOLLOW_MS,
  LISTEN,
  MUTE_TAIL_MS,
  WRONG_MS,
  createSegmenter,
} from './fitzroyListen.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-voice-listen-'));
process.env.TMPDIR = path.join(scratch, 'tmp');
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
fs.mkdirSync(process.env.TMPDIR);
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const { createRelay } =
  await import('../../../../server/tripTwin/syncRelay.js');
const { createAuditLog } =
  await import('../../../../server/tripTwin/auditLog.js');
const { voiceHandler } =
  await import('../../../../server/tripTwin/voiceProxy.js');

const NOW = Date.parse('2026-10-29T15:00:00Z');
const SCREENS = createSession({
  count: 6,
  tripId: 'trip-choir-austin',
}).screens;

test('Default screen: the TARGET the user tapped, or the last screen spoken to, whichever is newer; 10 minutes idle forgets the last one; a never-tapped TARGET does not count', () => {
  const at = (s, agoMs) => ({
    screen: s,
    kind: 'text',
    at: (NOW - agoMs) / 1000,
  });
  const base = { nowMs: NOW, screens: SCREENS };
  // Nothing tapped, nothing said: no default (Fitzroy asks "Which screen?").
  assert.equal(talkingAbout({ ...base, target: 1, targetAt: null }), null);
  // Tapped S2: S2.
  assert.deepEqual(talkingAbout({ ...base, target: 2, targetAt: NOW - 5000 }), {
    screen: 2,
    from: 'target',
  });
  // Tapped All: All (only a tap ever widens).
  assert.deepEqual(
    talkingAbout({ ...base, target: 'all', targetAt: NOW - 5000 }),
    { screen: 'all', from: 'target' },
  );
  // Tapped S2, then spoke to S4: S4 (newer).
  assert.deepEqual(
    talkingAbout({
      ...base,
      target: 2,
      targetAt: NOW - 60_000,
      lastTarget: at(4, 10_000),
    }),
    { screen: 4, from: 'last' },
  );
  // Spoke to S4, then tapped S2: S2.
  assert.deepEqual(
    talkingAbout({
      ...base,
      target: 2,
      targetAt: NOW - 1000,
      lastTarget: at(4, 10_000),
    }),
    { screen: 2, from: 'target' },
  );
  // The last screen alone, until 10 minutes with no turn.
  assert.deepEqual(talkingAbout({ ...base, lastTarget: at(3, 9 * 60e3) }), {
    screen: 3,
    from: 'last',
  });
  assert.equal(
    talkingAbout({ ...base, lastTarget: at(3, TALK_IDLE_MS + 1000) }),
    null,
  );
  assert.equal(TALK_IDLE_MS, 600_000);
  // A screen that is not on the wall is never the default.
  assert.equal(talkingAbout({ ...base, lastTarget: at(9, 1000) }), null);
  assert.equal(talkingText({ screen: 2, from: 'target' }), 'Talking about: S2');
  assert.equal(
    talkingText({ screen: 'all', from: 'target' }),
    'Talking about: All screens',
  );
  assert.equal(talkingText(null), '');
  assert.equal(logText({ on: true, keep_days: 14 }), 'Logging on · 14 days');
  assert.equal(logText({ on: false, keep_days: 14 }), 'Logging off');
  assert.equal(SAY.takeControl, 'Take control on the remote first.');
  // It travels in the context the voice service reads.
  const ctx = voiceContext(
    { session: { tripId: 'trip-choir-austin' }, screens: SCREENS },
    { defaultTarget: { screen: 2, from: 'target' }, nowMs: NOW },
  );
  assert.deepEqual(ctx.default_target, { screen: 2, from: 'target' });
  assert.equal(voiceContext({ session: {} }, {}).default_target, null);
});

/** 2048-sample frames at 48 kHz (~43 ms), as the remote's audio node. */
const RATE = 48000;
const FRAME_MS = (2048 / RATE) * 1000;
const tone = (amp) =>
  new Float32Array(2048).map((_, i) => amp * Math.sin(i / 3));
const quiet = () =>
  new Float32Array(2048).map(() => (Math.random() - 0.5) * 0.002);
/** Feed `ms` of frames from `make` starting at `t0`; → [segments, t]. */
function feed(seg, make, ms, t0) {
  const out = [];
  let t = t0;
  for (let n = 0; n < Math.round(ms / FRAME_MS); n += 1) {
    const s = seg.push(make(), t);
    if (s) out.push(s);
    t += FRAME_MS;
  }
  return [out, t];
}

test('Hands-free segmenter: one voiced segment per utterance, with its pre-roll; silence is never a segment; a click is dropped; a long one is cut at 8 s', () => {
  const seg = createSegmenter({ rate: RATE });
  let t = 0;
  let got;
  [got, t] = feed(seg, quiet, 2000, t);
  assert.equal(got.length, 0, 'room noise is never sent');
  [got, t] = feed(seg, () => tone(0.1), 1500, t);
  assert.equal(got.length, 0, 'nothing until the speech ends');
  [got, t] = feed(seg, quiet, 900, t);
  assert.equal(got.length, 1);
  const ms = (got[0].length * 2048 * 1000) / RATE;
  assert.ok(
    ms >= 1500 + LISTEN.endMs - FRAME_MS && ms <= 1500 + 300 + 900,
    `segment ${ms} ms holds the speech, its pre-roll and the end pause`,
  );
  // A 100 ms click: dropped.
  [got, t] = feed(seg, () => tone(0.2), 100, t);
  [got, t] = feed(seg, quiet, 900, t);
  assert.equal(got.length, 0);
  // 10 s without a pause: cut at 8 s.
  [got, t] = feed(seg, () => tone(0.1), 10_000, t);
  assert.equal(got.length, 1);
  assert.ok((got[0].length * 2048 * 1000) / RATE <= LISTEN.maxMs + FRAME_MS);
});

test('Hands-free self-trigger: no listening while Fitzroy speaks and for 300 ms after; a segment in progress when a reply starts is dropped', () => {
  const seg = createSegmenter({ rate: RATE });
  let t = 0;
  let got;
  [got, t] = feed(seg, quiet, 1000, t);
  // The reply starts (remoteVoice play): muted until it ends.
  seg.mute(Infinity);
  [got, t] = feed(seg, () => tone(0.1), 2000, t); // Fitzroy's own voice
  [got, t] = feed(seg, quiet, 900, t);
  assert.equal(got.length, 0, 'its own reply never becomes a segment');
  assert.equal(seg.muted(t), true);
  // The reply ends: 300 ms more.
  seg.mute(t + MUTE_TAIL_MS);
  assert.equal(MUTE_TAIL_MS, 300);
  [got, t] = feed(seg, () => tone(0.1), MUTE_TAIL_MS + FRAME_MS, t); // the echo tail
  assert.equal(seg.muted(t), false);
  [got, t] = feed(seg, quiet, 900, t);
  assert.equal(got.length, 0, 'the echo inside the tail is dropped');
  // After the tail, a person speaking is heard again.
  [got, t] = feed(seg, () => tone(0.1), 1200, t);
  [got, t] = feed(seg, quiet, 900, t);
  assert.equal(got.length, 1);
  // Speech in progress when a reply starts: dropped, not sent half-heard.
  [got, t] = feed(seg, () => tone(0.1), 800, t);
  seg.mute(t + 50);
  [got, t] = feed(seg, quiet, 900, t);
  assert.equal(got.length, 0);
  assert.equal(FOLLOW_MS, 6000);
  assert.equal(WRONG_MS, 15000);
});

/** A relay with the audit log on, two walls, the Mac's remote and an iPad. */
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
  const join = (id, kind, extra) => {
    const ws = fakeSocket();
    relay.attach(ws);
    ws.say({ t: 'hello', id, kind, setup: k.setup, proto: PROTO, ...extra });
    return ws;
  };
  const s1 = join('S1', 'screen', { slot: 1 });
  const s2 = join('S2', 'screen', { slot: 2 });
  const mac = join('R-mac', 'remote', { name: 'Laptop' });
  const ipad = join('R-ipad', 'remote', { name: 'iPad' });
  const text = async () => {
    await audit.flush();
    return fs
      .readdirSync(dir)
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
  };
  return { ...k, relay, s1, s2, mac, ipad, text };
}
const listeningOf = (ws) => ws.all('presence').at(-1)?.presence?.voice;

test('Relay: a remote’s listening flag reaches every wall as presence voice.listening (a boolean); closing its socket ends it; no word said beside it is read, logged or forwarded', async () => {
  const { s1, s2, mac, ipad, text, host } = rig();
  const SAID = 'Fitzroy show Ottoline Quist on the people screen';
  assert.deepEqual(s1.last('welcome').presence.voice, { listening: false });
  mac.say({ t: 'voice', listening: true, transcript: SAID, heard: SAID });
  for (const w of [s1, s2, ipad])
    assert.deepEqual(listeningOf(w), { listening: true }, 'every page sees it');
  // A second "on" changes nothing; the iPad turning off its own does not
  // end the Mac's.
  const n = s1.all('presence').length;
  mac.say({ t: 'voice', listening: true });
  ipad.say({ t: 'voice', listening: false });
  assert.equal(s1.all('presence').length, n, 'no presence for no change');
  assert.deepEqual(listeningOf(s1), { listening: true });
  // Walls cannot set it; anything but a boolean is ignored.
  s2.say({ t: 'voice', listening: false });
  mac.say({ t: 'voice', listening: 'yes' });
  assert.deepEqual(listeningOf(s1), { listening: true });
  // Off, then on again and the socket closes: off for the walls at once.
  mac.say({ t: 'voice', listening: false });
  assert.deepEqual(listeningOf(s1), { listening: false });
  mac.say({ t: 'voice', listening: true });
  assert.deepEqual(listeningOf(s2), { listening: true });
  mac.close();
  assert.deepEqual(listeningOf(s2), { listening: false });
  // The log keeps on/off only; nothing said reaches a log, a state or a page.
  const log = (await text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const lines = log.filter((l) => l.type === 'voice.listening');
  assert.deepEqual(
    lines.map((l) => l.data),
    [{ on: true }, { on: false }, { on: true }, { on: false }],
  );
  assert.equal(lines[0].actor.kind, 'remote');
  const all = [
    await text(),
    JSON.stringify(host.state),
    JSON.stringify(s1.out),
    JSON.stringify(s2.out),
    JSON.stringify(ipad.out),
  ].join('\n');
  for (const w of [SAID, 'Ottoline', 'Fitzroy', 'transcript', 'heard'])
    assert.equal(all.includes(w), false, w);
});

test('Dev route: /api/twin-voice also forwards /listen, /outcome and /flag to the loopback voice service as they are', async () => {
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
  const h = voiceHandler({ port: up.address().port });
  for (const [p, body] of [
    ['/listen', '{"audio":"UklGRg==","context":{"trip":"t"},"follow":false}'],
    ['/outcome', '{"id":"0123456789abcdef","event":"applied"}'],
    ['/flag', '{"id":"0123456789abcdef","how":"button"}'],
  ]) {
    assert.deepEqual((await call(h, 'POST', p, body)).body, {
      ok: true,
      path: p,
    });
    assert.deepEqual(seen.at(-1), ['POST', p, body]);
  }
  assert.equal((await call(h, 'GET', '/listen')).status, 404);
  await new Promise((r) => up.close(r));
});
