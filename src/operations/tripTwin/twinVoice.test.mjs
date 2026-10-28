// Voice platform pre-V1 carry-over (VOICE-CONTROL §3.2, §3.3, §3.6, §4;
// review/voice 03-security C2, 04-supervision #1, #3; review/voice/
// PRE-V1-NOTES.md): the relay's voice policy table is generated from the
// Fitzroy catalog; a voice proposal is submitted by the source device under
// its own identity and the relay stamps `via: 'voice'` only after the table
// passes it; incident actions are touch only; `voice.refused` is written
// with allowlisted fields and never a transcript; an ask-first voice
// command waits for the server's question (K10) with a strict revision.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clockHost, fakeSocket } from './twinTestKit.mjs';
import {
  CODE,
  PROTO,
  VOICE_CONFIRM_MS,
  VOICE_REFUSALS,
} from './twinProtocol.js';
import { FITZROY_COMMANDS } from './fitzroy/fitzroyCommands.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-voice-'));
process.env.TMPDIR = path.join(scratch, 'tmp');
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
fs.mkdirSync(process.env.TMPDIR);
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const { createRelay } = await import('../../../server/tripTwin/syncRelay.js');
const { createAuditLog } = await import('../../../server/tripTwin/auditLog.js');
const { voiceVerdict } =
  await import('../../../server/tripTwin/voicePolicy.js');
const { VOICE_POLICY, VOICE_INTENTS } =
  await import('../../../server/tripTwin/voicePolicy.table.js');
const { voicePolicyRows } =
  await import('../../../scripts/fitzroy-catalog-lib.mjs');

const INCIDENT = ['report_incident', 'clear_report', 'acknowledge_incident'];
const TIER_C = [
  ...INCIDENT,
  'visitor_off',
  'unpin_screen',
  'start_demo',
  'set_screen_count',
  'manage_devices',
  'remote_only',
  'clear_spotlight',
];

test('voice table: generated from the catalog (one row per entry, same tiers and emits); incident actions, pairing, Visitor off, unpin, demo start and the count are touch only (Tier C) with their words', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(VOICE_POLICY)),
    voicePolicyRows(FITZROY_COMMANDS),
  );
  assert.deepEqual(
    VOICE_INTENTS,
    FITZROY_COMMANDS.map((c) => c.tool.name),
  );
  for (const name of TIER_C) {
    const row = VOICE_POLICY[name];
    assert.equal(row.tier.one, 'touch', name);
    assert.equal(row.tier.all, 'touch', name);
    assert.equal(row.emits, null, name);
    assert.match(row.say, /^Touch only: /, name);
  }
  // Nothing the voice may emit touches incident fields, Visitor off or the
  // count (switch_trip writes report/incidentAck null only when they are
  // already null: its build refuses while a report is open).
  for (const [name, row] of Object.entries(VOICE_POLICY)) {
    if (row.effect !== 'relay' || !row.emits?.fields) continue;
    if (name === 'switch_trip') continue;
    for (const f of ['report', 'incidentAck', 'count', 'wallControls'])
      assert.ok(!row.emits.fields.includes(f), `${name} emits ${f}`);
  }
  assert.ok(Object.isFrozen(VOICE_POLICY.set_screen_layer.emits.fields));
});

const base = () => {
  const k = clockHost({ count: 6 });
  return k.host.state;
};
const verdict = (intent, cmd, state = base(), o = {}) =>
  voiceVerdict({
    voice: { intent },
    msg: cmd?.t === 'undo' ? cmd : { t: 'cmd', cmd },
    state,
    controller: o.controller ?? true,
    logOk: o.logOk ?? true,
  });

test('voice verdict: every refusal reason, the tiers, and raised (never lowered) questions', () => {
  const layer = {
    type: 'screens',
    target: 4,
    patch: { layers: { radar3d: true } },
  };
  assert.deepEqual(
    [
      verdict('set_screen_layer', layer).ok,
      verdict('set_screen_layer', layer).tier,
    ],
    [true, 'act'],
  );
  // Refusals.
  assert.equal(verdict('nope', layer).reason, 'unknown_intent');
  assert.equal(verdict('__proto__', layer).reason, 'unknown_intent');
  assert.equal(verdict('toString', layer).reason, 'unknown_intent');
  for (const name of TIER_C)
    assert.equal(verdict(name, layer).reason, 'touch_only', name);
  assert.equal(
    verdict('acknowledge_incident', layer).say,
    'Touch only: acknowledge on the remote, in Incident.',
  );
  assert.equal(verdict('mute_voice', layer).reason, 'not_a_command');
  assert.equal(verdict('reply_yes', layer).reason, 'not_a_command');
  const sneaky = {
    type: 'screens',
    target: 4,
    patch: { layers: { radar3d: true }, pinned: false },
  };
  assert.deepEqual(
    [
      verdict('set_screen_layer', sneaky).reason,
      verdict('set_screen_layer', sneaky).field,
    ],
    ['undeclared', 'pinned'],
  );
  assert.equal(
    verdict('set_screen_layer', {
      type: 'session',
      patch: { incidentAck: 'r1' },
    }).reason,
    'undeclared',
  );
  assert.equal(verdict('undo_last', layer).reason, 'undeclared');
  assert.equal(verdict('set_screen_layer', { t: 'undo' }).reason, 'undeclared');
  assert.equal(
    verdict('set_screen_layer', layer, base(), { logOk: false }).reason,
    'log_down',
  );
  assert.equal(
    verdict('set_screen_layer', layer, base(), { controller: false }).reason,
    'not_controller',
  );
  // Never less safe: switch_trip may not clear an open report.
  const k = clockHost({ count: 6 });
  k.host.hello({ id: 'r', kind: 'remote', setup: k.setup });
  k.host.command({
    by: 'r',
    cmd: {
      type: 'session',
      patch: { report: { id: 'r-1', floor: 3, kind: 'fire', at: 1 } },
    },
  });
  const sw = {
    type: 'session',
    patch: {
      tripId: 'trip-youth-london',
      siteKey: null,
      spotlight: null,
      report: null,
      incidentAck: null,
      simStorm: null,
      simFire: null,
      simCyclone: null,
    },
  };
  assert.equal(
    verdict('switch_trip', sw, k.host.state).reason,
    'lowers_protection',
  );
  // With an incident open, a safety layer stays on (Tier C by context).
  assert.equal(
    verdict(
      'set_screen_layer',
      { type: 'screens', target: 1, patch: { layers: { safety: false } } },
      k.host.state,
    ).reason,
    'lowers_protection',
  );
  // Tiers: ask for a trip switch (no report), Return all, a role on every
  // screen (needsConfirm), a pinned screen, the incident screen during a
  // report; act for the calming ones.
  assert.equal(verdict('switch_trip', sw).tier, 'ask');
  assert.equal(verdict('return_all_live', { type: 'returnLive' }).tier, 'ask');
  assert.equal(
    verdict('set_screen_role', {
      type: 'screens',
      target: 'all',
      patch: { role: 'weather' },
    }).tier,
    'ask',
  );
  k.host.command({
    by: 'r',
    cmd: { type: 'screens', target: 2, patch: { pinned: true } },
  });
  const pinned = verdict(
    'set_screen_layer',
    { type: 'screens', target: 2, patch: { layers: { radar3d: true } } },
    k.host.state,
  );
  assert.deepEqual([pinned.tier, pinned.why], ['ask', 'Screen 2 is pinned']);
  assert.equal(
    verdict(
      'set_screen_layer',
      { type: 'screens', target: 3, patch: { layers: { radar3d: true } } },
      k.host.state,
    ).tier,
    'ask',
  );
  assert.equal(
    verdict('visitor_on', { type: 'session', patch: { visitor: true } }).tier,
    'act',
  );
  assert.equal(
    verdict('stop_demo', {
      type: 'session',
      patch: { simStorm: null, simFire: null, simCyclone: null },
    }).tier,
    'act',
  );
  assert.equal(verdict('undo_last', { t: 'undo' }).tier, 'act');
});

/** A relay with the audit log on (voice needs it), a wall and the iPad. */
function relayRig({ logOk = true } = {}) {
  const k = clockHost({ count: 6 });
  const dir = fs.mkdtempSync(path.join(scratch, 'audit-'));
  const audit = createAuditLog({ dir, pruneEveryMs: 0 });
  const relay = createRelay({
    host: k.host,
    now: k.now,
    audit,
    healthFlags: () => ({ audit: logOk, store: true }),
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
  const ipad = fakeSocket();
  relay.attach(ipad, { isLocal: false, peer: '192.168.1.9' });
  ipad.say({
    t: 'hello',
    id: 'R',
    kind: 'remote',
    setup: k.setup,
    name: 'iPad',
    proto: PROTO,
  });
  const lines = async () => {
    await audit.flush();
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .flatMap((f) =>
        fs
          .readFileSync(path.join(dir, f), 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l)),
      );
  };
  const text = async () => {
    await audit.flush();
    return fs
      .readdirSync(dir)
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
  };
  return { ...k, relay, audit, wall, ipad, lines, text };
}

test('VIA.VOICE: a proposal the device submits with `voice {intent}` applies under its own identity; the relay stamps via voice on the broadcast and the log; an envelope `via` (or one inside cmd) is never taken from the page', async () => {
  const { ipad, wall, lines, host } = relayRig();
  ipad.say({
    t: 'cmd',
    reqId: 1,
    voice: {
      intent: 'set_screen_layer',
      transcript: 'storm radar on screen four',
      proposalId: 'p-1',
    },
    cmd: { type: 'screens', target: 4, patch: { layers: { radar3d: true } } },
  });
  assert.equal(ipad.last('ack').ok, true);
  const st = wall.last('state');
  assert.deepEqual(
    [st.by.name, st.by.via, st.by.kind],
    ['iPad', 'voice', 'remote'],
  );
  // The page cannot claim voice (or anything) without the envelope.
  ipad.say({
    t: 'cmd',
    reqId: 2,
    via: 'voice',
    cmd: { type: 'screens', target: 4, patch: { layers: { fires: true } } },
  });
  assert.equal(wall.last('state').by.via, 'touch');
  ipad.say({
    t: 'cmd',
    reqId: 3,
    cmd: { type: 'screens', target: 4, patch: {}, via: 'voice' },
  });
  assert.equal(ipad.last('ack').code, CODE.VALIDATION_COMMAND);
  const applied = (await lines()).filter((l) => l.type === 'cmd.applied');
  assert.deepEqual(
    applied.map((l) => l.actor.via),
    ['voice', 'touch'],
  );
  assert.equal(host.state.screens[4].meta.layers.by, applied[0].actor.ref);
});

test('voice.refused: a Tier C proposal (acknowledge) is refused VOICE_REFUSED with its words; the log line has the allowlisted fields only and no transcript, heard name or proposal id; the wall never moved', async () => {
  const { ipad, wall, lines, text, host } = relayRig();
  const rev = host.state.rev;
  const states = wall.all('state').length;
  ipad.say({
    t: 'cmd',
    reqId: 1,
    voice: {
      intent: 'acknowledge_incident',
      transcript: 'acknowledge Ottoline Quarnby',
      heard: 'Ottoline',
      proposalId: 'k6canarytokenzz9q8w7e6r5t',
    },
    cmd: { type: 'session', patch: { incidentAck: 'op-1' } },
  });
  const a = ipad.last('ack');
  assert.deepEqual(
    [a.ok, a.code, a.reason],
    [false, CODE.VOICE_REFUSED, 'touch_only'],
  );
  assert.equal(a.error, 'Touch only: acknowledge on the remote, in Incident.');
  assert.equal(host.state.rev, rev);
  assert.equal(wall.all('state').length, states);
  const [line] = (await lines()).filter((l) => l.type === 'voice.refused');
  assert.deepEqual(line.data, {
    intent: 'acknowledge_incident',
    reason: 'touch_only',
    cmdType: 'session',
    tier: 'touch',
  });
  assert.deepEqual([line.actor.name, line.actor.via], ['iPad', 'voice']);
  const all = await text();
  for (const needle of [
    'Ottoline',
    'Quarnby',
    'acknowledge Ottoline',
    'k6canarytoken',
    'transcript',
  ])
    assert.equal(all.includes(needle), false, needle);
  // An intent off the table is written as 'other', never as sent.
  ipad.say({
    t: 'cmd',
    reqId: 2,
    voice: { intent: 'Say Ottoline Quarnby' },
    cmd: { type: 'returnLive' },
  });
  const last = (await lines()).filter((l) => l.type === 'voice.refused').at(-1);
  assert.deepEqual(
    [last.data.intent, last.data.reason],
    ['other', 'unknown_intent'],
  );
  // Every refusal reason is in the closed list the log keeps.
  for (const l of (await lines()).filter((x) => x.type === 'voice.refused'))
    assert.ok(VOICE_REFUSALS.includes(l.data.reason));
});

test('K10 decision for voice: an ask-first voice command waits for the server question (reason voice, the voice window) from the same device; any change to the wall since the question makes it stale (strict rev), where a touch question would stand', () => {
  const { ipad, host } = relayRig();
  // A layer first, so Return all changes something.
  ipad.say({
    t: 'cmd',
    reqId: 1,
    cmd: { type: 'screens', target: 2, patch: { layers: { radar3d: true } } },
  });
  ipad.say({
    t: 'cmd',
    reqId: 2,
    voice: { intent: 'return_all_live' },
    cmd: { type: 'returnLive' },
  });
  const q = ipad.last('ack');
  assert.deepEqual(
    [q.code, q.reason, q.ttlMs],
    [CODE.CONFIRM_REQUIRED, 'voice', VOICE_CONFIRM_MS],
  );
  // An unrelated change (a layer on S5): not in Return all's preview for a
  // touch question, but the revision moved.
  ipad.say({
    t: 'cmd',
    reqId: 3,
    cmd: { type: 'screens', target: 5, patch: { textScale: 2 } },
  });
  const rev = host.state.rev;
  ipad.say({ t: 'confirm', reqId: 4, confirmId: q.confirmId });
  const st = ipad.last('ack');
  assert.equal(st.code, CODE.CONFIRM_STALE);
  assert.equal(host.state.rev, rev);
  // Re-asked in place; answered at once, it applies, by voice.
  ipad.say({ t: 'confirm', reqId: 5, confirmId: st.confirmId });
  assert.equal(ipad.last('ack').ok, true);
  assert.equal(ipad.last('ack').via, 'voice');
  // A Tier A voice command acts at once, no question.
  ipad.say({
    t: 'cmd',
    reqId: 6,
    voice: { intent: 'visitor_on' },
    cmd: { type: 'session', patch: { visitor: true } },
  });
  assert.equal(ipad.last('ack').ok, true);
});

test('voice undo: undo_last of a layer applies by voice; an undo whose inverse lowers protection (Visitor off) is touch only by voice (voice.refused undo_protective), and still asks first by touch', async () => {
  const { ipad, lines, host } = relayRig();
  ipad.say({
    t: 'cmd',
    reqId: 1,
    cmd: { type: 'screens', target: 2, patch: { layers: { radar3d: true } } },
  });
  const id = ipad.last('ack').undoId;
  ipad.say({ t: 'undo', reqId: 2, undoId: id, voice: { intent: 'undo_last' } });
  assert.equal(ipad.last('ack').ok, true);
  assert.equal(host.state.screens[2].layers.radar3d, undefined);
  ipad.say({
    t: 'cmd',
    reqId: 3,
    voice: { intent: 'visitor_on' },
    cmd: { type: 'session', patch: { visitor: true } },
  });
  const vid = ipad.last('ack').undoId;
  ipad.say({
    t: 'undo',
    reqId: 4,
    undoId: vid,
    voice: { intent: 'undo_last' },
  });
  assert.deepEqual(
    [ipad.last('ack').code, ipad.last('ack').reason],
    [CODE.VOICE_REFUSED, 'undo_protective'],
  );
  assert.equal(host.state.session.visitor, true);
  const line = (await lines()).filter((l) => l.type === 'voice.refused').at(-1);
  assert.deepEqual(line.data, {
    intent: 'undo_last',
    reason: 'undo_protective',
    cmdType: 'undo',
  });
  ipad.say({ t: 'undo', reqId: 5, undoId: vid });
  assert.equal(ipad.last('ack').code, CODE.CONFIRM_REQUIRED);
  // An undo sent as voice with another intent is refused.
  ipad.say({
    t: 'undo',
    reqId: 6,
    undoId: vid,
    voice: { intent: 'visitor_on' },
  });
  assert.equal(ipad.last('ack').reason, 'undeclared');
});

test('voice is refused while the audit log cannot write (CF-D9); touch keeps working', () => {
  const { ipad, relay } = relayRig({ logOk: false });
  ipad.say({
    t: 'cmd',
    reqId: 1,
    voice: { intent: 'visitor_on' },
    cmd: { type: 'session', patch: { visitor: true } },
  });
  assert.deepEqual(
    [ipad.last('ack').code, ipad.last('ack').reason],
    [CODE.VOICE_REFUSED, 'log_down'],
  );
  ipad.say({
    t: 'cmd',
    reqId: 2,
    cmd: { type: 'session', patch: { visitor: true } },
  });
  assert.equal(ipad.last('ack').ok, true);
  assert.equal(relay.health().counters.voiceRefused.log_down, 1);
});

test('voice end to end: every catalog example the guard proposes (act or ask), sent as-is by the device, passes the relay table at the same tier; every touch-only intent is refused there', async () => {
  const { createFitzroyCatalog } = await import('./fitzroy/fitzroyCatalog.js');
  const { DEMO_TRIPS } = await import('./demoTripList.js');
  const { createSession } = await import('./twinSession.js');
  const state = createSession({
    count: 6,
    tripId: DEMO_TRIPS[0].id,
    epochMs: 1,
  });
  const cat = createFitzroyCatalog({
    twin: {
      state: () => state,
      now: () => 1_000_000,
      lastUndo: () => ({ undoId: 'u1', before: state }),
      incidentOpen: () => false,
      tripDays: () => 3,
      reportedFloor: () => null,
      names: {
        person: () => 'Noah F.',
        place: () => 'the hospital',
        placeWord: () => 'hospital',
      },
    },
  });
  let checked = 0;
  for (const { tool, policy } of FITZROY_COMMANDS)
    for (const [, args] of policy.examples) {
      const p = await cat.propose(tool.name, args);
      if (p.tier === 'touch') {
        const v = voiceVerdict({
          voice: { intent: tool.name },
          msg: { t: 'cmd', cmd: { type: 'session', patch: {} } },
          state,
          controller: true,
          logOk: true,
        });
        assert.equal(v.reason, 'touch_only', tool.name);
        continue;
      }
      if (!p.message || !['act', 'ask'].includes(p.tier)) continue;
      assert.deepEqual(p.message.voice, { intent: tool.name });
      const v = voiceVerdict({
        voice: p.message.voice,
        msg: p.message,
        state,
        controller: true,
        logOk: true,
      });
      assert.equal(v.ok, true, `${tool.name}: ${v.reason}`);
      assert.equal(v.tier, p.tier, tool.name);
      checked += 1;
    }
  assert.ok(checked >= 15, `checked ${checked}`);
});
