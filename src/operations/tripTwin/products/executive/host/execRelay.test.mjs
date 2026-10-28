// SafeTrekr Executive B2: the relay with the loop beside the session
// (EP-35 §§7, 9 group 7; EP-33 §§1, 3, 7). Fake sockets, a fake clock, no
// network, no Vite, as twinRelay.test.mjs. With the executive seam off the
// relay is today's relay (phones and phone-cmd refused); with it on the
// relay runs the scripted day, a MAIN wall gets selectMain only, a phone
// only its own pushes, the remote only the clock, and the audit carries no
// free text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeSocket, setupOf } from '../../../twinTestKit.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-exec-relay-test-'));
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const { createRelay, EXECUTIVE } =
  await import('../../../../../../server/tripTwin/syncRelay.js');
const { auditCatalogue, createAuditLog, serialiseEvent, LOOP_AUDIT_EVENTS } =
  await import('../../../../../../server/tripTwin/auditLog.js');
const { TOKENS } =
  await import('../../../../../../server/tripTwin/twinTokens.js');
const { executiveRelay } = await import('./loopHost.js');

const day = JSON.parse(
  fs.readFileSync(new URL('../data/day.json', import.meta.url), 'utf8'),
);
const golden = JSON.parse(
  fs.readFileSync(
    new URL('../loop/replay.golden.json', import.meta.url),
    'utf8',
  ),
);
const C = (c) => [c.in, c.matched, c.raised, c.pushed, c.closed];
const G = (n) => C(golden.beats[n].counter);
const NO_TIMERS = Object.freeze({ set: () => null, clear: () => {} });

/** Strings MAIN must never carry (as select.test.mjs; EP-35 §9 group 5). */
function forbidden() {
  const out = new Set();
  for (const p of Object.values(day.people)) out.add(p.name);
  for (const s of day.watch.staff) out.add(s.name);
  for (const b of Object.values(day.bundles)) {
    if (b.title?.length >= 12) out.add(b.title);
    if (b.short_summary?.length >= 12) out.add(b.short_summary);
    for (const p of b.posts || []) out.add(p.text);
  }
  for (const e of day.events) {
    if (e.type === 'verification.decide' && e.note) out.add(e.note);
    if (e.type === 'dl.respond') out.add(e.reason);
    if (e.type === 'message.send' && e.text?.length >= 12) out.add(e.text);
  }
  return [...out].filter(Boolean);
}
const BAD = forbidden();

/** A room: launcher, walls 1 (main) and 2 (verify), the remote in control. */
function room({ exec = true, audit = null } = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (d) => (t += d) };
  const lines = [];
  const relay = createRelay({
    now: clock.now,
    timers: NO_TIMERS,
    audit: audit || {
      emit(type, ev) {
        const l = serialiseEvent(type, ev, t, auditCatalogue('executive'));
        if (l) lines.push(l);
        return Boolean(l);
      },
      health: () => ({ ok: true }),
    },
    exec: exec ? executiveRelay({ day, tokens: TOKENS }) : null,
  });
  const launcher = fakeSocket();
  relay.attach(launcher);
  launcher.say({ t: 'hello', id: 'L', kind: 'launcher' });
  launcher.say({ t: 'setup', count: 6 });
  const setup = setupOf(launcher);
  const sock = (hello, opts = {}) => {
    const s = fakeSocket();
    relay.attach(s, opts);
    s.say(hello);
    return s;
  };
  const wall = (slot) =>
    sock({ t: 'hello', id: `S${slot}`, kind: 'screen', setup, slot });
  const s1 = wall(1);
  const s2 = wall(2);
  const remote = sock({
    t: 'hello',
    id: 'R',
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  // The plugin's first clock tick: every socket on the wall gets its view.
  relay.exec?.tick();
  let req = 0;
  const loopCmd = (cmd, ws = remote) => {
    req += 1;
    ws.say({ t: 'loop-cmd', reqId: req, cmd });
    return ws.all('loop-ack').find((a) => a.reqId === req);
  };
  const phoneCmd = (ws, cmd) => {
    req += 1;
    ws.say({ t: 'phone-cmd', reqId: req, cmd });
    return ws.all('loop-ack').find((a) => a.reqId === req);
  };
  return {
    relay,
    clock,
    lines,
    launcher,
    setup,
    sock,
    s1,
    s2,
    remote,
    loopCmd,
    phoneCmd,
  };
}
const mains = (ws) => ws.all('loop').filter((m) => m.view === 'main');

test('B2 seam off: the relay is today’s relay — no phone kind, phone-cmd and loop-cmd do nothing', () => {
  assert.equal(EXECUTIVE, false, 'tests run without TRIP_TWIN_PRODUCT');
  const { relay, sock, s1, remote, loopCmd } = room({ exec: false });
  assert.equal(relay.exec, undefined);
  const phone = sock({
    t: 'hello',
    id: 'phone-1',
    kind: 'phone',
    participant_id: 'p-kestrel',
  });
  assert.equal(phone.last('welcome').type, 'denied');
  assert.equal(phone.last('welcome').code, 'UNKNOWN_KIND');
  const monitor = sock({ t: 'hello', id: 'm-1', kind: 'monitor' });
  assert.equal(monitor.last('welcome').code, 'UNKNOWN_KIND');
  const rev = relay.host.state.rev;
  remote.say({
    t: 'phone-cmd',
    reqId: 1,
    cmd: { type: 'ack', push_id: 'x', rung: 'read' },
  });
  assert.equal(loopCmd({ type: 'clock.start', rate: 10 }), undefined);
  assert.equal(remote.all('loop-ack').length, 0);
  assert.equal(relay.host.state.rev, rev);
  for (const ws of [s1, remote]) {
    assert.equal(ws.all('loop').length, 0);
    assert.equal(ws.all('loop-clock').length, 0);
  }
});

test('B2: a scripted run on the relay reaches the beat anchors’ counters; the MAIN wall sees them', () => {
  const { relay, clock, s1, remote, loopCmd } = room();
  assert.deepEqual(C(mains(s1).at(-1).main.counter), G(0));
  const a = loopCmd({ type: 'clock.start', rate: 60, auto: true });
  assert.equal(a.ok, true, JSON.stringify(a));
  // The remote gets the full loop; skip parsing ~0.5 MB a second here.
  remote.send = () => {};
  const lh = relay.exec.loopHost;
  let ticks = 0;
  while (!lh.clock.paused && ticks < 20_000) {
    clock.advance(500);
    relay.exec.tick();
    ticks += 1;
  }
  const seen = mains(s1).map((m) => C(m.main.counter));
  for (const n of ['1', '2', '3', '4'])
    assert.ok(
      seen.some((c) => JSON.stringify(c) === JSON.stringify(G(n))),
      `beat ${n} counter ${G(n)} reached the MAIN wall`,
    );
  assert.deepEqual(seen.at(-1), [214, 11, 6, 4, 6]);
  assert.equal(lh.clockView().held, 'end');
  assert.deepEqual(lh.scriptRefused, []);
  assert.ok(s1.all('loop-clock').length > 10, 'the clock reaches the walls');
});

test('B2 I3: a wall in role main receives selectMain only — no roster name, intel title, note or post, at any beat', () => {
  const { s1, s2, loopCmd } = room();
  for (let n = 1; n <= 5; n++) assert.ok(loopCmd({ type: 'beat.go', n }).ok);
  assert.ok(mains(s1).length >= 6);
  for (const m of s1.all('loop'))
    assert.equal(m.view, 'main', 'never the loop');
  const text = JSON.stringify(s1.out);
  for (const s of BAD)
    assert.ok(!text.includes(s), `MAIN carries "${s.slice(0, 50)}"`);
  // A main message has only the five MAIN fields per row.
  for (const m of mains(s1))
    for (const r of m.main.rows)
      assert.deepEqual(Object.keys(r).sort(), [
        'bluf',
        'callsign',
        'ladder',
        'leg',
        'next_update_at',
        'text',
      ]);
  // Wall 2 (verify) gets the loop.
  assert.equal(s2.all('loop').at(-1).view, 'loop');
  assert.ok(s2.all('loop').at(-1).loop.intel);
  assert.equal(
    s2.all('loop').at(-1).loop.base,
    undefined,
    'no fixture copy on the wire',
  );
});

test('B2: the remote in control may set a wall’s executive role; a wall turned main gets selectMain from then on', () => {
  const { s2, loopCmd } = room();
  assert.equal(loopCmd({ type: 'wall.role', slot: 2, role: 'main' }).ok, true);
  loopCmd({ type: 'beat.go', n: 1 });
  assert.equal(s2.all('loop').at(-1).view, 'main');
  assert.equal(
    loopCmd({ type: 'wall.role', slot: 2, role: 'kitchen' }).code,
    'BAD_ROLE',
  );
});

test('B3: each wall hears its executive role (loop-role) when it joins and when it changes; MAIN’s extras carry no name or intel', () => {
  const { s1, s2, loopCmd } = room();
  const roles = (ws) => ws.all('loop-role').map((m) => `${m.slot}:${m.role}`);
  assert.deepEqual(roles(s1), ['1:main']);
  assert.deepEqual(roles(s2), ['2:verify']);
  // The clock moving resends nothing; a role change sends one more.
  loopCmd({ type: 'beat.go', n: 1 });
  assert.deepEqual(roles(s2), ['2:verify']);
  assert.ok(loopCmd({ type: 'wall.role', slot: 2, role: 'intel' }).ok);
  assert.deepEqual(roles(s2), ['2:verify', '2:intel']);
  assert.deepEqual(roles(s1), ['1:main']);
  // MAIN's brief and scene: callsigns, venue and entrance only.
  assert.ok(loopCmd({ type: 'clock.jump', to: '2026-10-27T16:12:00Z' }).ok);
  const m = mains(s1).at(-1).main;
  assert.match(m.brief.header, /^DAILY BRIEF 1200Z · 7 LEGS TODAY$/);
  assert.equal(m.scene.callsign, 'KESTREL');
  assert.equal(m.scene.site, 'austin-long-center');
  assert.equal(m.scene.entrance.name, 'Barton Springs Rd side');
  const text = JSON.stringify(s1.out);
  for (const b of BAD)
    assert.ok(!text.includes(b), `MAIN carries "${b.slice(0, 50)}"`);
  assert.ok(!/"geo":/.test(text), 'MAIN gets no map data for paths');
  // The other walls get the map data with the loop.
  const g = s2.all('loop').at(-1).geo;
  assert.ok(g.paths.length >= 7);
  assert.match(g.attribution.text, /OpenStreetMap contributors/);
});

test('B2 I10: a phone gets only its participant’s pushes; a foreign or forged ack is refused', () => {
  const { sock, loopCmd, phoneCmd, lines } = room();
  const kestrel = sock({
    t: 'hello',
    id: 'phone-k',
    kind: 'phone',
    participant_id: 'p-kestrel',
  });
  const w = kestrel.last('welcome');
  assert.equal(w.type, 'phone');
  assert.equal(w.participant_id, 'p-kestrel');
  assert.equal(w.callsign, 'KESTREL');
  assert.ok(w.token);
  const atlas6 = sock({
    t: 'hello',
    id: 'phone-a6',
    kind: 'phone',
    participant_id: 'p-atlas6',
  });
  loopCmd({ type: 'beat.go', n: 1 });
  assert.ok(loopCmd({ type: 'clock.jump', to: '2026-10-27T16:05:30Z' }).ok);
  const view = kestrel.all('loop').at(-1);
  assert.equal(view.view, 'phone');
  assert.deepEqual(
    view.phone.alerts.map((a) => a.id),
    ['push-kestrel-01'],
  );
  assert.equal(atlas6.all('loop').at(-1).phone.alerts.length, 0);
  // Its own read: accepted, before the scripted one.
  assert.equal(
    phoneCmd(kestrel, { type: 'ack', push_id: 'push-kestrel-01', rung: 'read' })
      .ok,
    true,
  );
  // For someone else: refused at the relay (I10), and by its stamped fields.
  assert.equal(
    phoneCmd(kestrel, {
      type: 'ack',
      push_id: 'push-kestrel-01',
      participant_id: 'p-harrier',
      rung: 'read',
    }).code,
    'I10_NOT_BOUND',
  );
  assert.equal(
    phoneCmd(kestrel, {
      type: 'ack',
      push_id: 'push-kestrel-01',
      rung: 'accepted',
      by: 'p-harrier',
    }).code,
    'VALIDATION_COMMAND',
  );
  // Not a recipient of that push: refused by the reducer.
  loopCmd({ type: 'beat.go', n: 2 });
  loopCmd({ type: 'clock.jump', to: '2026-10-27T18:08:30Z' });
  assert.equal(
    phoneCmd(kestrel, { type: 'ack', push_id: 'push-atlas-01', rung: 'read' })
      .code,
    'NOT_RECIPIENT',
  );
  // Not a phone event, from a phone.
  assert.equal(
    phoneCmd(kestrel, { type: 'push.send', recommendation_id: 'x' }).code,
    'NOT_PHONE_EVENT',
  );
  // A phone never receives the session, presence or the loop.
  const types = new Set(kestrel.out.map((m) => m.t));
  assert.deepEqual([...types].sort(), [
    'loop',
    'loop-ack',
    'loop-clock',
    'welcome',
  ]);
  for (const m of kestrel.all('loop')) assert.equal(m.view, 'phone');
  const text = JSON.stringify(kestrel.out);
  for (const s of ['push-atlas-01', 'p-harrier', 'HARRIER', 'Everett Halden'])
    assert.ok(!text.includes(s), `the phone carries ${s}`);
  // ATLAS 6 sees the ATLAS push; its DL answer moves the ladder.
  assert.deepEqual(
    atlas6
      .all('loop')
      .at(-1)
      .phone.alerts.map((a) => a.id),
    ['push-atlas-01'],
  );
  // B7 #7: the NON-CONCUR waits for the advance's SALUTE (1812Z).
  const early = {
    type: 'dl.respond',
    push_id: 'push-atlas-01',
    answer: 'nonconcur',
    reason: 'covered',
    principal_informed: true,
  };
  assert.equal(phoneCmd(atlas6, early).code, 'SALUTE_FIRST');
  assert.ok(
    lines.some(
      (l) => l.type === 'loop.refused' && l.data.code === 'SALUTE_FIRST',
    ),
  );
  loopCmd({ type: 'clock.jump', to: '2026-10-27T18:12:30Z' });
  assert.equal(phoneCmd(atlas6, early).ok, true);
  assert.ok(
    lines.some(
      (l) =>
        l.type === 'loop.event' &&
        l.data.type === 'dl.respond' &&
        l.data.by === 'p-atlas6',
    ),
  );
  assert.ok(
    lines.some(
      (l) => l.type === 'loop.refused' && l.data.code === 'I10_NOT_BOUND',
    ),
  );
});

test('B2: phones from the LAN need the presenter’s ticket; the monitor is this computer’s only', () => {
  const { sock, loopCmd } = room();
  const lan = sock(
    { t: 'hello', id: 'phone-w', kind: 'phone', participant_id: 'p-wren' },
    { isLocal: false },
  );
  assert.equal(lan.last('welcome').code, 'NOT_TRUSTED');
  const t = loopCmd({ type: 'phone.ticket', participant_id: 'p-wren' });
  assert.equal(t.ok, true);
  const ok = sock(
    { t: 'hello', id: 'phone-w2', kind: 'phone', ticket: t.ticket },
    { isLocal: false },
  );
  assert.equal(ok.last('welcome').participant_id, 'p-wren');
  // The token rejoins; another socket with the same id replaces the old one.
  const again = sock(
    {
      t: 'hello',
      id: 'phone-w2',
      kind: 'phone',
      token: ok.last('welcome').token,
    },
    { isLocal: false },
  );
  assert.equal(again.last('welcome').type, 'phone');
  assert.equal(ok.last('replaced')?.t, 'replaced');
  const mon = sock(
    { t: 'hello', id: 'mon-lan', kind: 'monitor' },
    { isLocal: false },
  );
  assert.equal(mon.last('welcome').code, 'NOT_TRUSTED');
  const local = sock({ t: 'hello', id: 'mon', kind: 'monitor' });
  assert.equal(local.last('welcome').type, 'monitor');
  assert.equal(local.all('loop').at(-1).view, 'loop');
  // The monitor cannot act.
  local.say({ t: 'loop-cmd', reqId: 9, cmd: { type: 'clock.start' } });
  local.say({
    t: 'cmd',
    reqId: 10,
    cmd: { type: 'session', patch: { visitor: true } },
  });
  assert.equal(local.all('loop-ack').length, 0);
  assert.equal(local.all('ack').length, 0);
});

test('B2 EP-33 §1: the remote runs the clock only, never a loop decision; only the remote in control; not a phone', () => {
  const { relay, sock, setup, s1, remote, loopCmd } = room();
  const rev = relay.exec.loopHost.rev;
  assert.equal(
    loopCmd({ type: 'push.send', recommendation_id: 'r-kestrel-01' }).code,
    'NOT_PRESENTER',
  );
  assert.equal(
    loopCmd({ type: 'verification.decide', sit_id: 's-kestrel-01' }).code,
    'NOT_PRESENTER',
  );
  assert.equal(loopCmd({ type: 'ack', push_id: 'x' }).code, 'NOT_PRESENTER');
  // Through the school command, a loop event is the host's unknown command.
  remote.say({
    t: 'cmd',
    reqId: 77,
    cmd: { type: 'loop', event: { type: 'push.send' } },
  });
  assert.equal(remote.all('ack').find((a) => a.reqId === 77).ok, false);
  // As a phone: refused, it is not one.
  remote.say({
    t: 'phone-cmd',
    reqId: 78,
    cmd: { type: 'ack', push_id: 'x', rung: 'read' },
  });
  assert.equal(
    remote.all('loop-ack').find((a) => a.reqId === 78).code,
    'NOT_PHONE',
  );
  // A wall cannot run the clock.
  assert.equal(loopCmd({ type: 'clock.start' }, s1).code, 'NOT_REMOTE');
  // A second remote, not in control.
  const viewer = sock({
    t: 'hello',
    id: 'R2',
    kind: 'remote',
    setup,
    name: 'iPad',
  });
  assert.equal(viewer.last('welcome').controller, false);
  assert.equal(
    loopCmd({ type: 'clock.start' }, viewer).code,
    'LEASE_NOT_CONTROLLER',
  );
  assert.equal(relay.exec.loopHost.rev, rev, 'the loop never moved');
});

test('B2 EP-33 §7: Reset asks first and restores the script; a live phone action is set aside, not lost', () => {
  const { relay, sock, s1, loopCmd, phoneCmd, lines } = room();
  const kestrel = sock({
    t: 'hello',
    id: 'phone-k',
    kind: 'phone',
    participant_id: 'p-kestrel',
  });
  loopCmd({ type: 'beat.go', n: 1 });
  loopCmd({ type: 'clock.jump', to: '2026-10-27T16:05:30Z' });
  assert.equal(
    phoneCmd(kestrel, { type: 'ack', push_id: 'push-kestrel-01', rung: 'read' })
      .ok,
    true,
  );
  const ask = loopCmd({ type: 'reset' });
  assert.equal(ask.ok, false);
  assert.equal(ask.code, 'CONFIRM_REQUIRED');
  assert.match(ask.ask.text, /Reset the day to 0930L \(1430Z\)/);
  assert.equal(loopCmd({ type: 'confirm', id: ask.ask.id }).ok, true);
  const lh = relay.exec.loopHost;
  assert.equal(lh.run, 2);
  assert.equal(lh.loop.log[0].type, 'reset');
  assert.deepEqual(C(mains(s1).at(-1).main.counter), G(0));
  assert.equal(mains(s1).at(-1).run, 2);
  assert.equal(lh.setAside.length, 1);
  assert.equal(
    kestrel.all('loop').at(-1).phone.alerts.length,
    0,
    'the push is not there at 1430Z',
  );
  assert.ok(
    lines.some(
      (l) =>
        l.type === 'presenter.beat' &&
        l.data.how === 'reset' &&
        l.data.run === 2,
    ),
  );
});

test('B2 audit: one allowlisted line per accepted loop event, no free text; a school log writes none', async () => {
  const { sock, loopCmd, phoneCmd, lines } = room();
  const atlas6 = sock({
    t: 'hello',
    id: 'phone-a6',
    kind: 'phone',
    participant_id: 'p-atlas6',
  });
  loopCmd({ type: 'beat.go', n: 2 });
  loopCmd({ type: 'clock.jump', to: '2026-10-27T18:08:30Z' });
  const reason =
    'North door covered by venue security, Belvedere Road is clear';
  phoneCmd(atlas6, {
    type: 'salute.file',
    size: '1 male',
    activity: 'Filming the north entrance, left on approach',
    unit: 'none seen',
    equipment: 'phone',
  });
  phoneCmd(atlas6, {
    type: 'dl.respond',
    push_id: 'push-atlas-01',
    answer: 'nonconcur',
    reason,
    plan: 'original plan, +1 post',
    principal_informed: true,
  });
  phoneCmd(atlas6, {
    type: 'checkin.respond',
    status: 'ok',
    text: 'All good at the north door',
  });
  const loopLines = lines.filter(
    (l) => l.type.startsWith('loop.') || l.type === 'presenter.beat',
  );
  const accepted = loopLines.filter((l) => l.type === 'loop.event');
  // beat.go, clock.jump, then the three phone events.
  assert.deepEqual(
    accepted.map((l) => l.data.type),
    ['beat.go', 'clock.jump', 'salute.file', 'dl.respond', 'checkin.respond'],
  );
  const text = JSON.stringify(loopLines);
  for (const s of [
    reason,
    'original plan',
    'Filming',
    'All good',
    '1 male',
    'Everett Halden',
    'ATLAS 6',
  ])
    assert.ok(!text.includes(s), `the audit carries "${s}"`);
  for (const l of loopLines)
    for (const k of Object.keys(l.data))
      assert.ok(
        k in LOOP_AUDIT_EVENTS[l.type].data,
        `${l.type}.${k} is allowlisted`,
      );
  // A school log (no product) never writes a loop line.
  assert.equal(
    serialiseEvent('loop.event', { data: { type: 'ack' } }, Date.now()),
    null,
  );
  // And on disk, an executive log writes them with the same allowlist.
  const dir = fs.mkdtempSync(path.join(scratch, 'audit-'));
  const log = createAuditLog({ dir, product: 'executive' });
  assert.equal(
    log.emit('loop.event', {
      data: {
        type: 'ack',
        by: 'p-kestrel',
        rung: 'read',
        text: 'free text',
        reason,
      },
    }),
    true,
  );
  const school = createAuditLog({
    dir: fs.mkdtempSync(path.join(scratch, 'audit-')),
    product: null,
  });
  assert.equal(school.emit('loop.event', { data: { type: 'ack' } }), false);
  assert.equal(await log.flush(), true);
  const file = fs.readdirSync(dir).find((f) => f.startsWith('audit-'));
  const body = fs.readFileSync(path.join(dir, file), 'utf8');
  assert.match(body, /"type":"loop.event"/);
  assert.ok(!body.includes('free text') && !body.includes(reason));
  await log.close();
  await school.close();
});
