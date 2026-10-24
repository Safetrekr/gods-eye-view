// Trip Twin describer and operator copy (Phase CF K8; cf/05-supervision.md
// SUP-1 golden table, SUP-4, SUP-5; cf/04-client.md CL-11 byText,
// chipText; cf/06-qa.md QA-8 E8.1; PHASE-CF-PLAN Appendix D, C65). Pure,
// plus one relay run with fake sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeSocket } from './twinTestKit.mjs';
import { applyCommand, applyUndo, createSession } from './twinSession.js';
import { createSessionHost } from './twinSessionHost.js';
import { LAYER_CATALOG, ROLES } from './twinScreenRoles.js';
import { DEMO_TRIPS } from './demoTrips.js';
import {
  CHIP_MAX,
  FIELD_LABELS,
  SCREEN_KEYS,
  SESSION_KEYS,
  STATUS,
  byText,
  chipText,
  forText,
  controlText,
  describeChange,
  describeCommand,
  diffParts,
  hhmm,
  lastChangeOf,
  metaPhrase,
  render,
  scopeLine,
  wallCard,
} from './twinDescribe.js';
import {
  HOST_NAME,
  pairLockedText,
  pairPausedUntil,
  pairWrongText,
  reloadText,
} from './twinProtocol.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-describe-test-'));
process.env.TMPDIR = path.join(scratch, 'tmp');
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
fs.mkdirSync(process.env.TMPDIR);
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const { createRelay } = await import('../../../server/tripTwin/syncRelay.js');

// 21:32:05 CDT on 23 Oct 2026, the golden table's time.
const TZ = 'America/Chicago';
const AT = Date.UTC(2026, 9, 24, 2, 32, 5);
const clock = (ms) => hhmm(ms, TZ);
const IPAD = { ref: 'D3', kind: 'remote', name: 'iPad', via: 'touch' };
const NAMES = {
  person: (id) => (id === 'p17' ? 'Jay Patel' : null),
  place: (id) => (id === 'pl1' ? 'Rally point' : null),
};
/** Five screens, S3 pinned (the golden table's wall). */
function wall5() {
  let s = createSession({ count: 5, tripId: 'trip-choir-austin' });
  s = applyCommand(s, {
    type: 'screens',
    target: 3,
    patch: { pinned: true },
  }).state;
  return s;
}
/** The chip a wall shows in the first 3 s of a change. */
function chipFor(change, slot, o = {}) {
  const summary = render(change, {
    audience: 'wall',
    slot,
    names: NAMES,
    ...o,
  });
  return chipText({
    slot,
    online: true,
    controller: 'iPad',
    change: { summary, byName: byText(change.by), at: change.at },
    clock,
  });
}
const WORDING = /\bsafe\b|all clear|recommended/i;

test('K8 SUP-1 golden table: the remote result, the wall chip (3 s) and the log row for the four golden commands (CF-D8: "iPad")', () => {
  const s = wall5();
  const rows = [
    {
      cmd: { type: 'screens', target: 4, patch: { layers: { radar: true } } },
      remote: 'S4: radar on',
      chip: [4, 'S4 · Radar on · by iPad · 21:32'],
      log: '21:32:05 · iPad · S4: radar on',
    },
    {
      cmd: {
        type: 'screens',
        target: 'all',
        patch: { mode: 'advance', day: 2 },
      },
      remote: 'S1, S2, S4, S5: Advance · Day 2 · S3 pinned, unchanged',
      chip: [3, 'S3 · Pinned: kept as it is · push by iPad · 21:32'],
      log: '21:32:05 · iPad · All: Advance · Day 2 · applied S1, S2, S4, S5 · S3 pinned',
    },
    {
      cmd: {
        type: 'session',
        patch: { spotlight: { kind: 'person', id: 'p17' } },
      },
      remote: 'Every screen: spotlight Jay Patel',
      chip: [2, 'S2 · Every screen: spotlight Jay P. · by iPad · 21:32'],
      log: '21:32:05 · iPad · Every screen: spotlight person p17',
    },
    {
      cmd: { type: 'returnLive' },
      before: applyCommand(s, {
        type: 'session',
        patch: { simStorm: AT - 60e3, wxAt: AT + 30 * 60e3 },
      }).state,
      remote:
        'Every screen back to Live and role defaults · pinned too · demo storm ended',
      chip: [1, 'S1 · Every screen: back to Live · by iPad · 21:32'],
      log: '21:32:05 · iPad · Return all · ended: demo storm, lens',
    },
  ];
  for (const r of rows) {
    const c = describeCommand(r.cmd, r.before || s, { at: AT, by: IPAD });
    assert.equal(render(c, { audience: 'remote', names: NAMES }), r.remote);
    assert.equal(render(c, { audience: 'voice', names: NAMES }), r.remote);
    assert.equal(chipFor(c, r.chip[0]), r.chip[1]);
    assert.equal(
      render(c, { audience: 'log', names: NAMES, timeZone: TZ }),
      r.log,
    );
  }
  // Visitor mode: initials on the walls; the remote keeps the full name.
  const sp = describeCommand(rows[2].cmd, s, { at: AT, by: IPAD });
  assert.equal(
    chipFor(sp, 2, { visitor: true }),
    'S2 · Every screen: spotlight JP · by iPad · 21:32',
  );
});

test('K8 SUP-1: the dry run names exactly the screens and fields the reducer changes, for 200 seeded commands on changing walls', () => {
  let seed = 12345;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const pick = (xs) => xs[rnd(xs.length)];
  const layerKeys = LAYER_CATALOG.flatMap((g) => g.layers.map((L) => L.key));
  const roles = Object.keys(ROLES);
  const gen = (state) => {
    const slots = Object.keys(state.screens).map(Number);
    const target = rnd(3) ? pick(slots) : 'all';
    switch (rnd(7)) {
      case 0:
        return { type: 'screens', target, patch: { role: pick(roles) } };
      case 1:
        return {
          type: 'screens',
          target,
          patch: { layers: { [pick(layerKeys)]: Boolean(rnd(2)) } },
        };
      case 2:
        return {
          type: 'screens',
          target,
          patch: { mode: pick(['live', 'advance']), day: pick([null, 1, 2]) },
        };
      case 3:
        return { type: 'screens', target, patch: { pinned: Boolean(rnd(2)) } };
      case 4:
        return {
          type: 'session',
          patch: pick([
            { visitor: Boolean(rnd(2)) },
            { tripId: pick(DEMO_TRIPS).id },
            { spotlight: rnd(2) ? { kind: 'person', id: 'p17' } : null },
            { report: rnd(2) ? { id: 'r', floor: 9, kind: 'smoke' } : null },
          ]),
        };
      case 5:
        return { type: 'reset', target };
      default:
        return { type: 'count', n: 1 + rnd(6) };
    }
  };
  let state = wall5();
  let checked = 0;
  for (let i = 0; i < 200; i += 1) {
    const cmd = gen(state);
    const r = applyCommand(state, cmd, { at: AT });
    const c = describeCommand(cmd, state, { at: AT });
    // Slots whose words changed, against slots whose fields really did.
    const real = new Set();
    for (const slot of Object.keys(r.state.screens).map(Number)) {
      const a = state.screens[slot];
      const b = r.state.screens[slot];
      if (
        !a ||
        SCREEN_KEYS.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
      )
        real.add(slot);
    }
    const realWall =
      SESSION_KEYS.some(
        (k) =>
          JSON.stringify(state.session[k] ?? null) !==
          JSON.stringify(r.state.session[k] ?? null),
      ) || state.count !== r.state.count;
    const said = new Set(
      (c?.parts || []).map((p) => p.scope).filter((x) => x !== 'wall'),
    );
    const saidWall = (c?.parts || []).some((p) => p.scope === 'wall');
    assert.deepEqual(
      [...said].sort(),
      [...real].sort(),
      `${JSON.stringify(cmd)}: said ${[...said]} changed ${[...real]}`,
    );
    assert.equal(saidWall, realWall, JSON.stringify(cmd));
    assert.deepEqual(c?.pinned ?? [], r.skipped, 'pinned = skipped');
    for (const t of [
      render(c, { audience: 'remote', names: NAMES }),
      render(c, { audience: 'log', names: NAMES, timeZone: TZ }),
    ])
      assert.doesNotMatch(t, WORDING);
    if (c) checked += 1;
    state = r.state;
  }
  assert.ok(checked > 80, `${checked} commands changed something`);
});

test('K8 SUP-1: the field-label table names every field the reducer writes, and the number of screens', () => {
  for (const k of [...SESSION_KEYS, ...SCREEN_KEYS, 'count'])
    assert.ok(FIELD_LABELS[k], `no label for ${k}`);
  assert.equal(FIELD_LABELS.textScale, 'text size');
  assert.equal(FIELD_LABELS.wxAt, 'time lens');
  assert.equal(FIELD_LABELS.visitor, 'Visitor mode');
});

test('K8 SUP-1: the log names ids only, never a person or a device id; an unknown person is "a person" on the walls, never the id', () => {
  const s = wall5();
  const c = describeCommand(
    { type: 'session', patch: { spotlight: { kind: 'person', id: 'p99' } } },
    s,
    { at: AT, by: IPAD },
  );
  assert.equal(
    render(c, { audience: 'wall', slot: 1, names: NAMES }),
    'Every screen: spotlight a person',
  );
  assert.equal(
    render(c, { audience: 'remote', names: NAMES }),
    'Every screen: spotlight a person',
  );
  const log = render(
    describeCommand(
      { type: 'session', patch: { spotlight: { kind: 'person', id: 'p17' } } },
      s,
      { at: AT, by: IPAD },
    ),
    { audience: 'log', names: NAMES, timeZone: TZ },
  );
  assert.doesNotMatch(log, /Jay|Patel/);
  assert.match(log, /person p17$/);
  // A change knows the device by its actor only (no id field to leak).
  assert.deepEqual(Object.keys(c.by).sort(), ['kind', 'name', 'ref', 'via']);
});

test('K8 SUP-1: one change, each field in words: a role says the role only, a reset says defaults, a frame says what it frames, a join says nothing', () => {
  const s = wall5();
  const say = (cmd, before = s) =>
    render(describeCommand(cmd, before, { at: AT }), { audience: 'remote' });
  assert.equal(
    say({ type: 'screens', target: 2, patch: { role: 'day' } }),
    'S2: Day plan',
  );
  const changed = applyCommand(s, {
    type: 'screens',
    target: 2,
    patch: { textScale: 3, layers: { streets: true } },
  }).state;
  assert.equal(
    say({ type: 'screens', target: 2, patch: { textScale: 3 } }),
    'S2: text ×3',
  );
  assert.equal(
    say({ type: 'reset', target: 2 }, changed),
    'S2: back to role defaults',
  );
  assert.equal(
    say({
      type: 'screens',
      target: 1,
      patch: { frame: { subject: { kind: 'floor', label: 9 }, nonce: 7 } },
    }),
    'S1: frames floor 9',
  );
  assert.equal(
    say({ type: 'session', patch: { tripId: 'trip-youth-london' } }),
    'Every screen: Youth choir tour',
  );
  assert.equal(
    say({ type: 'session', patch: { wxAt: AT + 30 * 60e3 } }),
    'Every screen: weather +30 min',
  );
  assert.equal(
    say({ type: 'session', patch: { report: { id: 'x', floor: 9 } } }),
    'Every screen: reported floor 9',
  );
  assert.equal(
    say({ type: 'count', n: 6 }),
    'Every screen: 6 screens · S6: added',
  );
  assert.equal(
    say({ type: 'screens', target: 4, patch: { motion: { cine: false } } }),
    'S4: Cinematic motion off',
  );
  // Nothing changed (a join, an echo): no words at all.
  assert.equal(describeChange(s, s, { cause: 'join' }), null);
  assert.deepEqual(diffParts(s, s), []);
});

test('K8 SUP-3 (chip part): an undo reads "Undone: radar off" on that wall; an undo is never "back to role defaults"', () => {
  const s = wall5();
  const r = applyCommand(
    s,
    { type: 'screens', target: 4, patch: { layers: { radar: true } } },
    { by: 'D3', at: AT },
  );
  // The reducer's own undo restores fields without stamping them: the
  // describer must not read that as a reset.
  const undone = applyUndo(r.state, r.undo, { by: 'D3', at: AT });
  const c = describeChange(r.state, undone, { cause: 'undo', by: IPAD }, AT);
  assert.equal(chipFor(c, 4), 'S4 · Undone: radar off · by iPad · 21:32');
  assert.equal(render(c, { audience: 'remote' }), 'Undone on S4: radar off');
  assert.deepEqual(scopeLine(c, 4), { on: 'S4', text: 'undone: radar off' });
});

test('K8 SUP-4 chip rows: idle, idle by another device, a change, a wall-wide change, a pinned wall, remote offline, not connected, hands-on', () => {
  const base = { slot: 4, online: true, controller: 'iPad', now: AT, clock };
  assert.equal(chipText(base), 'S4 · Remote: iPad');
  assert.equal(
    chipText({ ...base, last: { at: AT - 134e3, byName: 'iPad' } }),
    'S4 · Remote: iPad · last change 2:14 ago',
  );
  assert.equal(
    chipText({ ...base, last: { at: AT - 134e3, byName: 'Laptop' } }),
    'S4 · Remote: iPad · last change 2:14 ago by Laptop',
  );
  assert.equal(
    chipText({ ...base, last: { at: AT - 3725e3, byName: 'iPad' } }),
    'S4 · Remote: iPad · last change 1 h 02 min ago',
  );
  assert.equal(
    chipText({
      ...base,
      change: {
        summary: 'Every screen: Youth choir tour',
        byName: 'iPad',
        at: AT,
      },
    }),
    'S4 · Every screen: Youth choir tour · by iPad · 21:32',
  );
  assert.equal(
    chipText({
      ...base,
      slot: 3,
      change: { summary: 'Pinned: kept as it is', byName: 'iPad', at: AT },
    }),
    'S3 · Pinned: kept as it is · push by iPad · 21:32',
  );
  assert.equal(
    chipText({
      ...base,
      controller: null,
      lastController: 'iPad',
      remoteGoneAt: AT - 120e3,
    }),
    'S4 · Remote offline (iPad) · since 21:30',
  );
  assert.equal(chipText({ ...base, online: false }), 'S4 · not connected');
  assert.equal(
    chipText({ ...base, suffix: ' · pinned · hands-on' }),
    'S4 · Remote: iPad · pinned · hands-on',
  );
});

test('walls-live W5: a wall chip carries ages, never a clock time', () => {
  const base = { slot: 4, online: true, controller: 'iPad', now: AT, clock };
  const gone = {
    ...base,
    controller: null,
    lastController: 'iPad',
    ages: true,
  };
  assert.equal(
    chipText({ ...gone, remoteGoneAt: AT - 45e3 }),
    'S4 · Remote offline (iPad) · 45 s',
  );
  assert.equal(
    chipText({ ...gone, remoteGoneAt: AT - 12 * 60e3 }),
    'S4 · Remote offline (iPad) · 12 min',
  );
  assert.equal(
    chipText({ ...gone, remoteGoneAt: AT - 62 * 60e3 }),
    'S4 · Remote offline (iPad) · 1 h 02 min',
  );
  assert.equal(
    chipText({
      ...base,
      ages: true,
      change: { summary: 'Radar on', byName: 'iPad', at: AT },
    }),
    'S4 · Radar on · by iPad',
  );
  assert.equal(forText(0), '0 s');
});

test('K8 SUP-4: the chip fits 56 characters with the longest trip title, every host-given name, every role and layer; the time goes first, then the summary is cut; the name never is', () => {
  const names = [
    'iPad',
    'iPad 2',
    'Phone',
    'Laptop',
    HOST_NAME,
    `${HOST_NAME} 2`,
    'S6 keyboard', // a wall's own L / D sheet (shell D5)
  ];
  const longestTrip = [...DEMO_TRIPS].sort(
    (a, b) => b.title.length - a.title.length,
  )[0];
  const s = wall5();
  const summaries = [
    render(
      describeCommand(
        { type: 'session', patch: { tripId: longestTrip.id } },
        { ...s, session: { ...s.session, tripId: 'x' } },
        { at: AT },
      ),
      { audience: 'wall', slot: 6 },
    ),
    ...Object.values(ROLES).map((r) => r.label),
    ...LAYER_CATALOG.flatMap((g) => g.layers.map((L) => `${L.label} off`)),
    'Pinned: kept as it is',
    'Every screen: back to Live',
  ];
  assert.equal(summaries[0], `Every screen: ${longestTrip.title}`);
  for (const byName of names)
    for (const summary of summaries)
      for (const suffix of ['', ' · pinned · hands-on']) {
        const t = chipText({
          slot: 6,
          online: true,
          controller: byName,
          change: { summary, byName, at: AT },
          suffix,
          clock,
        });
        assert.ok(t.length <= CHIP_MAX, `${t.length}: ${t}`);
        assert.ok(t.includes(`by ${byName}`), `name cut: ${t}`);
        const full = `S6 · ${summary}${summary.startsWith('Pinned') ? ' · push' : ' ·'} by ${byName} · 21:32${suffix}`;
        if (full.length <= CHIP_MAX) assert.equal(t, full);
        else assert.doesNotMatch(t, /21:32/, `time kept in a cut chip: ${t}`);
        const idle = chipText({
          slot: 6,
          online: true,
          controller: byName,
          last: { at: AT - 754e3, byName: names.at(-1) },
          now: AT,
          suffix,
          clock,
        });
        assert.ok(idle.length <= CHIP_MAX, `${idle.length}: ${idle}`);
        assert.ok(idle.includes(`Remote: ${byName}`), idle);
      }
  // With the iPad the longest trip fits whole, time and all.
  assert.equal(
    chipText({
      slot: 4,
      online: true,
      controller: 'iPad',
      change: { summary: summaries[0], byName: 'iPad', at: AT },
      clock,
    }),
    `S4 · Every screen: ${longestTrip.title} · by iPad · 21:32`,
  );
});

test('K8 CL-11 byText: a name from the actor or its ref; "another device" when unknown; never an id; V1 prefixes Voice', () => {
  const actors = [{ ref: 'D3', kind: 'remote', name: 'iPad 2' }];
  assert.equal(byText(IPAD), 'iPad');
  assert.equal(byText('D3', actors), 'iPad 2');
  assert.equal(byText('D9', actors), 'another device');
  assert.equal(byText(null), 'another device');
  assert.equal(byText({ ref: 'D4', id: 'remote-abc123' }), 'another device');
  assert.equal(byText({ ...IPAD, via: 'voice' }), 'Voice · iPad');
  // A wall acts only from its own keyboard sheet (shell D5).
  assert.equal(
    byText({ ref: 'D6', kind: 'screen', name: 'S4', slot: 4, via: 'keyboard' }),
    'S4 keyboard',
  );
  assert.equal(
    byText('D6', [{ ref: 'D6', kind: 'screen', name: 'S4', slot: 4 }]),
    'S4 keyboard',
  );
});

test('K8 SUP-4 status strip control cell: in control, view only with since, no remote in control, not connected, and after 15 s can’t reach (Appendix D 2d)', () => {
  const o = { link: 'online', host: '192.168.1.20:4173', clock };
  assert.equal(
    controlText({ ...o, controller: true, me: 'iPad' }),
    'In control · this remote (iPad)',
  );
  assert.equal(
    controlText({ ...o, ctl: 'iPad', since: AT - 12 * 60e3 }),
    'View only · iPad in control since 21:20',
  );
  assert.equal(controlText(o), 'View only · no remote in control');
  assert.equal(
    controlText({ ...o, link: 'offline', offlineMs: 14000 }),
    'Not connected · retrying',
  );
  assert.equal(
    controlText({ ...o, link: 'connecting', offlineMs: 15000 }),
    "Can't reach the Trip Twin computer from 192.168.1.20:4173 · retrying",
  );
});

test('K8 Appendix D: every wall card string (1a, 6b, 6c, 6d, 7, 7a; SUP-5 pairing, lost, link used), steel words, no code on the cards that replace the scene', () => {
  const d = {
    slot: 3,
    at: AT + 8 * 60e3 - 5000, // 21:40
    until: AT + 2 * 60e3 - 5000, // 21:34
    code: '4821',
    expires: AT + 10 * 60e3 - 5000, // 21:42
    host: 'localhost:4181',
    clock,
  };
  const c = (k, x = {}) => wallCard(k, { ...d, ...x });
  const pair = c('pair');
  assert.equal(pair.kicker, 'PAIR THIS SCREEN');
  assert.equal(pair.code, '4821');
  assert.equal(
    pair.how,
    'On the remote in control: Screens & devices › Pair a screen. Enter this code and pick the screen number.',
  );
  assert.equal(pair.valid, 'Code valid until 21:42 · a new one appears then');
  assert.equal(
    pair.foot,
    'localhost:4181 · this window shows nothing from the wall until it is paired',
  );
  assert.deepEqual(c('link-expired').lines, [
    'This screen link was already used or has expired · pair with the code below',
  ]);
  assert.equal(c('lost').kicker, 'PAIR THIS SCREEN AGAIN');
  assert.deepEqual(c('lost', { at: AT - 125e3 }).lines, [
    'This window lost its pairing at 21:30: another window took it over.',
  ]);
  assert.deepEqual(c('slot-taken').lines, [
    'S3 moved to another device at 21:40. Pair this window again with this code if you need it.',
  ]);
  assert.equal(c('slot-taken').code, '4821');
  assert.deepEqual(c('token-expired').lines, [
    'its pairing ended after 30 days without use · enter this code on the remote',
  ]);
  // Cards with no code: they replace the scene.
  const replaced = c('replaced');
  assert.equal(replaced.kicker, 'S3 IS SHOWN IN ANOTHER WINDOW');
  assert.deepEqual(replaced.lines, ['since 21:40 · this window can be closed']);
  assert.equal(replaced.button, 'Use this window instead');
  const reload = c('reload');
  assert.equal(reload.kicker, 'THIS SCREEN NEEDS A RELOAD');
  assert.deepEqual(reload.lines, [
    'refused as out of date at 21:40 · it shows nothing from the wall until reloaded',
  ]);
  assert.deepEqual(c('rate-limited').lines, [
    'Rejoining paused on this computer until 21:34 · too many tries · screens already on the wall are not affected',
  ]);
  assert.deepEqual(c('busy', { retryAfterMs: 42000 }).lines, [
    'Too many screens are waiting to pair · trying again in 1 min',
  ]);
  assert.deepEqual(c('busy', { retryAfterMs: 4 * 60e3 }).lines, [
    'Too many screens are waiting to pair · trying again in 4 min',
  ]);
  assert.match(
    c('nope', { error: 'Unknown device' }).lines[0],
    /^Unknown device · it shows nothing/,
  );
  for (const k of ['replaced', 'reload', 'rate-limited', 'busy', 'denied'])
    assert.equal(c(k).code, undefined, `${k} shows no code`);
  for (const k of [
    'pair',
    'link-expired',
    'lost',
    'slot-taken',
    'replaced',
    'reload',
    'rate-limited',
    'busy',
  ])
    for (const t of [c(k).kicker, ...c(k).lines])
      assert.doesNotMatch(t, WORDING);
});

test('K8 Appendix D: remote and launcher status-strip strings (1, 1c, 3) and the out-of-date text an old page shows', () => {
  assert.equal(STATUS.LOG, 'Log not writing');
  assert.equal(
    STATUS.RELOAD_REMOTE,
    'This remote page is out of date · nothing was sent',
  );
  assert.equal(STATUS.RELOAD_PAGE, 'This page is out of date');
  assert.equal(STATUS.RELOAD, 'Reload');
  // The relay's own text for an old page is the same sentence plus Reload.
  assert.equal(
    reloadText('remote'),
    `${STATUS.RELOAD_REMOTE} · ${STATUS.RELOAD}`,
  );
  assert.equal(
    reloadText('launcher'),
    `${STATUS.RELOAD_PAGE} · ${STATUS.RELOAD}`,
  );
});

test('K8 SUP-5: pairing refusals from the host: tries left before the 1-minute pause, then when the pause ends; the remote reads the end back', () => {
  let t = Date.UTC(2026, 9, 24, 2, 32, 10);
  const host = createSessionHost({ now: () => t });
  const setup = host.setup({ count: 3 }).setup;
  host.hello({ id: 'r1', kind: 'remote', setup, name: 'iPad' });
  const said = [];
  for (let i = 0; i < 5; i += 1)
    said.push(host.pair({ by: 'r1', code: 'xxxx', slot: 3 }).error);
  assert.deepEqual(said.slice(0, 4), [
    pairWrongText(4),
    pairWrongText(3),
    pairWrongText(2),
    pairWrongText(1),
  ]);
  assert.equal(
    said[1],
    'Code not recognised or expired · 3 tries left before a 1-minute pause',
  );
  assert.equal(
    said[3],
    'Code not recognised or expired · 1 try left before a 1-minute pause',
  );
  assert.equal(said[4], pairLockedText(t + 60000));
  assert.match(
    said[4],
    /^Pairing paused until \d\d:\d\d:\d\d after 5 wrong codes · screens already paired are not affected$/,
  );
  // A good code during the pause is refused with the same words.
  const scr = host.hello({ id: 's9', kind: 'screen' });
  t += 12000;
  assert.equal(host.pair({ by: 'r1', code: scr.code, slot: 3 }).error, said[4]);
  // The remote's Pair button counts down to the end it reads back.
  assert.equal(pairPausedUntil(said[4], t), t - 12000 + 60000);
  assert.equal(pairPausedUntil(said[0], t), null);
  t += 49000;
  host.beat('r1');
  assert.equal(host.pair({ by: 'r1', code: scr.code, slot: 3 }).ok, true);
});

test('K8 SUP-4: the last change from meta (a page opened after it): the newest field on that wall or the wall-wide ones, in words where the value says it', () => {
  let s = wall5();
  s = applyCommand(
    s,
    { type: 'screens', target: 2, patch: { mode: 'advance' } },
    { by: 'D3', at: AT - 60e3 },
  ).state;
  s = applyCommand(
    s,
    { type: 'screens', target: 4, patch: { layers: { radar: true } } },
    { by: 'D5', at: AT },
  ).state;
  const l2 = lastChangeOf(s, 2);
  assert.deepEqual([l2.scope, l2.field, l2.ref], [2, 'mode', 'D3']);
  assert.equal(metaPhrase(s, l2), 'Advance');
  const l4 = lastChangeOf(s, 4);
  assert.equal(metaPhrase(s, l4), 'layer', 'which layer is not in meta');
  assert.equal(lastChangeOf(s).scope, 4, 'anywhere: the newest');
  s = applyCommand(
    s,
    { type: 'session', patch: { visitor: true } },
    { by: 'D5', at: AT + 1000 },
  ).state;
  const lw = lastChangeOf(s, 2);
  assert.deepEqual([lw.scope, lw.field], ['wall', 'visitor']);
  assert.equal(metaPhrase(s, lw), 'Visitor mode on');
});

test('K8 E8.1 (relay part): a LAN remote named "iPad" changes S2; from its own messages the S2 wall names the iPad in the chip, then "last change … by iPad" while the Laptop is in control', () => {
  let t = Date.UTC(2026, 9, 24, 2, 32, 5);
  const host = createSessionHost({ now: () => t });
  const relay = createRelay({ host });
  const launcher = fakeSocket();
  relay.attach(launcher, { isLocal: true });
  launcher.say({ t: 'hello', id: 'launcher-k8', kind: 'launcher' });
  launcher.say({ t: 'setup', count: 3 });
  const setup = launcher.last('setup').setup;
  const s2 = fakeSocket();
  relay.attach(s2, { isLocal: true });
  s2.say({ t: 'hello', id: 'screen-k8-s2', kind: 'screen', setup, slot: 2 });
  const ipad = fakeSocket();
  relay.attach(ipad, { isLocal: false, peer: '192.168.1.20' });
  ipad.say({
    t: 'hello',
    id: 'remote-k8-ipad',
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  assert.equal(ipad.last('welcome').controller, true);
  const before = s2.all('state').at(-1)?.state || s2.last('welcome').state;
  ipad.say({
    t: 'cmd',
    reqId: 1,
    cmd: { type: 'screens', target: 2, patch: { layers: { streets: true } } },
  });
  const m = s2.last('state');
  assert.equal(m.by.name, 'iPad');
  const c = describeChange(before, m.state, m, t);
  const chip = chipText({
    slot: 2,
    online: true,
    controller: m.presence.remotes.find((r) => r.controller).name,
    change: {
      summary: render(c, { audience: 'wall', slot: 2 }),
      byName: byText(m.by, m.presence.actors),
      at: t,
    },
    clock,
  });
  assert.equal(chip, 'S2 · Streets on · by iPad · 21:32');
  // A laptop takes over; the S2 chip keeps naming the iPad for that change.
  const laptop = fakeSocket();
  relay.attach(laptop, { isLocal: false, peer: '192.168.1.21' });
  laptop.say({
    t: 'hello',
    id: 'remote-k8-laptop',
    kind: 'remote',
    setup,
    name: 'Laptop',
  });
  laptop.say({ t: 'request-control' });
  ipad.say({ t: 'handover', accept: true });
  t += 134000;
  const p = s2.last('presence').presence;
  const last = lastChangeOf(s2.last('state').state, 2);
  assert.equal(
    chipText({
      slot: 2,
      online: true,
      controller: p.remotes.find((r) => r.controller).name,
      last: { at: last.at, byName: byText(last.ref, p.actors) },
      now: t,
      clock,
    }),
    'S2 · Remote: Laptop · last change 2:14 ago by iPad',
  );
  // No device id in anything the wall heard.
  const heard = JSON.stringify(s2.out);
  for (const id of ['remote-k8-ipad', 'remote-k8-laptop', 'launcher-k8'])
    assert.ok(!heard.includes(id), id);
});
