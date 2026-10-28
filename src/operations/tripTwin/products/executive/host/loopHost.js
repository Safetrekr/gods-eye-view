// SafeTrekr Executive: the loop held beside the session on the relay
// (EP-35 §§1, 5, 7; EP-33 §§1, 3, 7). Loaded by server/tripTwin/
// syncRelay.js only when TRIP_TWIN_PRODUCT=executive; the school relay
// never imports this file.
//
//   createLoopHost({day, now, tokens}) → the loop, its clock and the script
//   executiveRelay({day, tokens, now}) → the relay seam (createRelay's `exec`)
//
// The clock: simNow = anchorSim + (realNow − anchorReal) × rate. Every tick
// applies the scripted timeline entries with at ≤ simNow, in order, through
// applyLoopEvent; the presenter never fires a loop event, the clock does.
// Checkpoints (day.checkpoints) hold the clock at their end; Next cuts to
// the next one; with `auto` on, the host cuts by itself, so the relay runs
// the whole day on its own. Live phone (and later desk) events go through
// applyLoopEvent at the current sim time and are kept, so Previous and
// Reset re-derive the loop from the script plus the live events they keep
// (EP-33 §7: replay without corrupting the record). Nothing is edited in
// place and nothing is written to the school session store; the loop lives
// in memory (a restart folds the script back to beat 0).
//
// No node: imports (src/ is checked as browser code): ids come from Web
// Crypto, token hashes from the relay's own TOKENS (twinTokens.js).
import { applyLoopEvent, createLoop } from '../loop/twinLoop.js';
import { selectMain, selectPhone } from '../loop/select.js';
import {
  LOOP_ACTIONS,
  PHONE_EVENTS,
  PRESENTER_EVENTS,
} from '../loop/loopPolicy.js';
import { beatAt, buildTimeline } from '../timeline.js';
import { briefOf, geoOf, mainScene } from '../loop/wallData.js';
import { lz } from '../format.js';
import {
  CLOSE,
  DENY,
  PROTO,
  REPLACED,
  protoOk,
  reloadText,
} from '../../../twinProtocol.js';
import {
  ASK_MS,
  EXEC_CODE,
  EXEC_KINDS,
  EXEC_MSG,
  EXEC_PROTO,
  PHONE_DENY,
  PHONE_TICKET_MS,
  PRESENTER_CMDS,
  clockLabel,
  phoneEvent,
  presenterCmd,
  roleOfSlot,
  viewFor,
} from './execProtocol.js';

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
const iso = (t) => new Date(ms(t)).toISOString().replace('.000Z', 'Z');

/** A generator clock jump at most every this much sim time while running. */
export const JUMP_EVERY_MS = 30_000;
/** The relay sends the clock this often, and a full loop no more often. */
export const CLOCK_EVERY_MS = 1000;
export const LOOP_EVERY_MS = 1000;
/** The relay's clock tick (plugin interval). */
export const TICK_MS = 250;

/** Hex from Web Crypto (Node 24 and browsers): never Math.random. */
export function randomHex(bytes = 16) {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * The loop host. `now` is the real clock (ms); `tokens` {hash, same} hash
 * phone tokens (the relay passes twinTokens.js TOKENS); `randomId(bytes)`.
 */
export function createLoopHost({
  day,
  now = Date.now,
  tokens = null,
  randomId = randomHex,
  timeline = buildTimeline(day),
} = {}) {
  if (!day) throw new Error('createLoopHost needs the day');
  const T = timeline;
  const tms = T.map((e) => ms(e.at));
  const cps = (day.checkpoints || []).map((c) => ({
    ...c,
    f: ms(c.from),
    t: ms(c.to),
  }));
  const beats = day.beats || {};
  const endMs = ms(day.end);
  const beat0 = ms(beats[0]);

  let loop = createLoop({ fixtures: day, t0: day.t0 });
  let cursor = 0;
  let run = 1;
  let liveSeq = 0;
  let clockSeq = 0;
  /** Accepted live events, in order: [{ev, from}]. */
  let live = [];
  /** Live events set aside by Previous or Reset: [{ev, from, run}]. */
  const setAside = [];
  /** Scripted entries the reducer refused (a live event got there first). */
  const scriptRefused = [];
  const clock = {
    anchorSim: beat0,
    anchorReal: now(),
    rate: 1,
    paused: true,
    auto: false,
    held: null, // 'checkpoint' | 'end' | null
  };
  let lastSim = beat0;
  const asks = new Map(); // id → {by, cmd, expires, text}
  const wallRoles = {}; // slot → executive role
  const phones = new Map(); // device id → {participant_id, tokenHash}
  const tickets = new Map(); // ticket hash → {participant_id, expires}

  const apply = (ev) => {
    const r = applyLoopEvent(loop, ev);
    if (!r.refused) loop = r.loop;
    return r;
  };
  const simAt = (real) =>
    clock.paused
      ? clock.anchorSim
      : clock.anchorSim + (real - clock.anchorReal) * clock.rate;
  const anchor = (sim, real) => {
    clock.anchorSim = sim;
    clock.anchorReal = real;
    lastSim = sim;
  };
  const cpIndexAt = (t) => cps.findIndex((c) => c.f <= t && t < c.t);
  const nextCpIndex = (t) => cps.findIndex((c) => c.f > t);
  /** The rate of the checkpoint holding t, else the next one, else 1. */
  const rateAt = (t) => {
    const i = cpIndexAt(t);
    const c = cps[i >= 0 ? i : nextCpIndex(t)];
    return c ? c.rate : 1;
  };
  /** The zone the day's beat is told in (its first scripted event's). */
  /** The zone a beat is told in: its first local (non-UTC) event's, else the next beat's. */
  const tzOfBeat = (n) => {
    for (let b = Number(n); b <= 9; b++) {
      const e = day.events.find((x) => x.beat === b && x.tz && x.tz !== 'UTC');
      if (e) return e.tz;
    }
    return 'UTC';
  };

  /** Apply every scripted entry at or before `target`, in order. */
  function foldTo(target) {
    while (cursor < T.length && tms[cursor] <= target) {
      const e = T[cursor];
      const r = apply(e.ev);
      if (r.refused)
        scriptRefused.push({
          run,
          seq: e.seq,
          id: e.ev.id,
          code: r.refused.code,
        });
      cursor += 1;
    }
  }
  /** The record's clock moves to `target` (timers fire "on the next tick"). */
  function jump(target) {
    if (target <= ms(loop.clock.simNow)) return;
    clockSeq += 1;
    apply({
      id: `e-clk-${run}-${clockSeq}`,
      type: 'clock.jump',
      by: 'generator',
      at: iso(target),
      to: iso(target),
    });
  }
  function advance(target, force = false) {
    foldTo(target);
    if (force || target - ms(loop.clock.simNow) >= JUMP_EVERY_MS) jump(target);
    lastSim = target;
  }
  /** A presenter clock event on the record (EP-33 §7: a rewind is on record too). */
  function presenterEvent(type, fields = {}) {
    clockSeq += 1;
    return apply({
      id: `e-pr-${run}-${clockSeq}`,
      type,
      by: 'presenter',
      at: iso(Math.max(lastSim, ms(loop.clock.simNow))),
      ...fields,
    });
  }
  function cut(i, real) {
    const c = cps[i];
    advance(c.f, true);
    clock.rate = c.rate;
    clock.paused = false;
    clock.held = null;
    anchor(c.f, real);
  }
  function hold(t, real, why) {
    advance(t, true);
    clock.paused = true;
    clock.held = why;
    anchor(t, real);
  }

  /** Move the script to the clock. → {changed} */
  function tick(real = now()) {
    if (clock.paused) return { changed: false };
    const rev0 = loop.rev;
    const target = simAt(real);
    const ci = cpIndexAt(lastSim);
    if (clock.auto && ci < 0) {
      const ni = nextCpIndex(lastSim);
      if (ni >= 0) cut(ni, real);
      else hold(Math.min(Math.max(target, lastSim), endMs), real, 'end');
    } else if (ci >= 0 && target >= cps[ci].t) {
      if (clock.auto && cps[ci + 1]) cut(ci + 1, real);
      else hold(cps[ci].t, real, cps[ci + 1] ? 'checkpoint' : 'end');
    } else if (target >= endMs) hold(endMs, real, 'end');
    else advance(target);
    return { changed: loop.rev !== rev0 };
  }

  /**
   * Re-derive the loop up to `target` from the script and the live events
   * at or before it (EP-33 §7). Live events after it are set aside, never
   * dropped; the run number goes up; the reducer's own `reset` starts the
   * record, so nothing is edited in place.
   */
  function rederive(target, { keepLive = true } = {}) {
    const kept = keepLive ? live.filter((l) => ms(l.ev.at) <= target) : [];
    for (const l of live) if (!kept.includes(l)) setAside.push({ ...l, run });
    run += 1;
    apply({
      id: `e-reset-${run}`,
      type: 'reset',
      by: 'presenter',
      at: iso(Math.max(lastSim, ms(loop.clock.simNow))),
    });
    cursor = 0;
    live = [];
    let j = 0;
    while (true) {
      const s = cursor < T.length && tms[cursor] <= target ? tms[cursor] : null;
      const l = j < kept.length ? ms(kept[j].ev.at) : null;
      if (s == null && l == null) break;
      if (s != null && (l == null || s <= l)) foldTo(s);
      else {
        const r = apply(kept[j].ev);
        if (r.refused)
          setAside.push({ ...kept[j], run: run - 1, code: r.refused.code });
        else live.push(kept[j]);
        j += 1;
      }
    }
  }

  function askFor(cmd, by, text, real) {
    for (const [k, a] of asks) if (a.expires <= real) asks.delete(k);
    const id = randomId(8);
    asks.set(id, { by, cmd, text, expires: real + ASK_MS });
    return {
      ok: false,
      code: EXEC_CODE.CONFIRM_REQUIRED,
      ask: { id, text, expiresInMs: ASK_MS },
    };
  }

  const done = (extra = {}) => ({ ok: true, changed: true, ...extra });
  const no = (code, extra = {}) => ({ ok: false, code, ...extra });

  /**
   * A presenter command (already checked by execProtocol.presenterCmd).
   * `by` is the remote's device id (asks are answered by the same device).
   * → {ok, code?, ask?, events?: [type], beat?: {from, to, how}, ticket?}
   */
  function presenter(cmd, { by = null, real = now(), confirmed = false } = {}) {
    tick(real);
    const sim = simAt(real);
    const row = PRESENTER_CMDS[cmd.type];
    if (!row) return no(EXEC_CODE.NOT_PRESENTER);
    switch (cmd.type) {
      case 'clock.start': {
        if (cmd.rate) clock.rate = cmd.rate;
        if (cmd.auto != null) clock.auto = cmd.auto;
        anchor(sim, real);
        clock.paused = false;
        clock.held = null;
        presenterEvent('clock.start', { rate: clock.rate });
        return done({ events: ['clock.start'] });
      }
      case 'clock.pause':
        anchor(sim, real);
        clock.paused = true;
        presenterEvent('clock.pause');
        return done({ events: ['clock.pause'] });
      case 'clock.resume':
        anchor(sim, real);
        clock.paused = false;
        clock.held = null;
        presenterEvent('clock.resume');
        return done({ events: ['clock.resume'] });
      case 'clock.rate':
        anchor(sim, real);
        clock.rate = cmd.rate;
        if (!clock.paused) presenterEvent('clock.start', { rate: cmd.rate });
        return done({ events: clock.paused ? [] : ['clock.start'] });
      case 'clock.auto':
        clock.auto = cmd.on;
        return done();
      case 'clock.jump': {
        const to = ms(cmd.to);
        if (to < sim) return no(EXEC_CODE.I12_TIME);
        advance(Math.min(to, endMs), true);
        anchor(Math.min(to, endMs), real);
        return done({
          events: ['clock.jump'],
          beat: { from: iso(sim), to: iso(to), how: 'jump' },
        });
      }
      case 'next': {
        const ci = cpIndexAt(sim);
        const ni = ci >= 0 ? (cps[ci + 1] ? ci + 1 : -1) : nextCpIndex(sim);
        if (ni < 0) return no(EXEC_CODE.NO_CHECKPOINT);
        cut(ni, real);
        return done({
          events: ['clock.jump'],
          beat: { from: iso(sim), to: iso(cps[ni].f), how: 'next' },
        });
      }
      case 'beat.go': {
        const a = beats[cmd.n];
        if (!a) return no(EXEC_CODE.BAD_BEAT);
        const t = ms(a);
        if (t < sim && !confirmed)
          return askFor(
            cmd,
            by,
            `Back to beat ${cmd.n}, ${lz(t, tzOfBeat(cmd.n))}? Live desk actions after it are set aside.`,
            real,
          );
        if (t < sim) rederive(t);
        else foldTo(t);
        const r = presenterEvent('beat.go', { n: cmd.n, at: a });
        if (r.refused) return no(r.refused.code);
        clock.rate = rateAt(t);
        clock.held = null;
        anchor(t, real);
        return done({
          events: ['beat.go'],
          beat: {
            from: iso(sim),
            to: iso(t),
            how: t < sim ? 'previous' : 'beat',
          },
        });
      }
      case 'previous': {
        const ci = cpIndexAt(sim);
        // The checkpoint before the one we are in (or the last one passed).
        let pi = ci >= 0 ? ci - 1 : -1;
        if (ci < 0)
          for (let i = cps.length - 1; i >= 0; i--)
            if (cps[i].t <= sim) {
              pi = i;
              break;
            }
        if (pi < 0) return no(EXEC_CODE.NO_CHECKPOINT);
        const c = cps[pi];
        if (!confirmed)
          return askFor(
            cmd,
            by,
            `Back to beat ${c.beat}, ${lz(c.f, tzOfBeat(c.beat))}? Live desk actions after it are set aside.`,
            real,
          );
        rederive(c.f);
        jump(c.f);
        clock.rate = c.rate;
        clock.paused = true;
        clock.held = null;
        anchor(c.f, real);
        return done({
          events: ['reset', 'clock.jump'],
          beat: { from: iso(sim), to: iso(c.f), how: 'previous' },
        });
      }
      case 'reset': {
        if (!confirmed)
          return askFor(
            cmd,
            by,
            `Reset the day to ${lz(beat0, tzOfBeat(0))}? The run’s live actions are set aside.`,
            real,
          );
        rederive(beat0, { keepLive: false });
        presenterEvent('beat.go', { n: 0, at: beats[0] });
        clock.rate = rateAt(beat0);
        clock.paused = true;
        clock.auto = false;
        clock.held = null;
        anchor(beat0, real);
        return done({
          events: ['reset', 'beat.go'],
          beat: { from: iso(sim), to: iso(beat0), how: 'reset' },
        });
      }
      case 'confirm': {
        const a = asks.get(cmd.id);
        if (!a) return no(EXEC_CODE.CONFIRM_UNKNOWN);
        if (a.by !== by) return no(EXEC_CODE.CONFIRM_NOT_YOURS);
        asks.delete(cmd.id);
        if (a.expires <= real) return no(EXEC_CODE.CONFIRM_STALE);
        return presenter(a.cmd, { by, real, confirmed: true });
      }
      case 'cancel': {
        const a = asks.get(cmd.id);
        if (!a) return no(EXEC_CODE.CONFIRM_UNKNOWN);
        if (a.by !== by) return no(EXEC_CODE.CONFIRM_NOT_YOURS);
        asks.delete(cmd.id);
        return { ok: true, changed: false };
      }
      case 'wall.role':
        wallRoles[cmd.slot] = cmd.role;
        return done();
      case 'phone.ticket': {
        if (!day.people?.[cmd.participant_id])
          return no(EXEC_CODE.UNKNOWN_PERSON);
        if (!tokens) return no(EXEC_CODE.NOT_PHONE);
        const ticket = randomId(16);
        for (const [k, t] of tickets) if (t.expires <= real) tickets.delete(k);
        tickets.set(tokens.hash(ticket), {
          participant_id: cmd.participant_id,
          expires: real + PHONE_TICKET_MS,
        });
        return { ok: true, changed: false, ticket, ttlMs: PHONE_TICKET_MS };
      }
      default:
        return no(EXEC_CODE.NOT_PRESENTER);
    }
  }

  /**
   * A live event (a phone's, later the desk's) at the current sim time.
   * `fields` carry no id, at, by or device: they are stamped here.
   * → {ok, ev?, code?}
   */
  function applyLive(fields, { by, via, device = null, from, real = now() }) {
    tick(real);
    const at = Math.max(simAt(real), ms(loop.clock.simNow));
    liveSeq += 1;
    const ev = {
      ...fields,
      id: `e-live-${run}-${liveSeq}`,
      at: iso(at),
      by,
      via,
      ...(device ? { device } : {}),
    };
    const r = apply(ev);
    if (r.refused) return { ok: false, code: r.refused.code };
    live.push({ ev, from });
    return { ok: true, ev };
  }

  /** The desk's way in (B4 wires a socket to it): a named watch member only. */
  function desk(fields, { by, real = now() }) {
    if (!loop.watch?.[by]) return { ok: false, code: 'ROLE' };
    if (
      !LOOP_ACTIONS[fields?.type] ||
      PHONE_EVENTS.includes(fields.type) ||
      PRESENTER_EVENTS.includes(fields.type)
    )
      return { ok: false, code: 'UNKNOWN_EVENT' };
    const { id: _i, at: _a, by: _b, via: _v, device: _d, ...rest } = fields;
    void _i;
    void _a;
    void _b;
    void _v;
    void _d;
    return applyLive(rest, { by, via: 'touch', from: 'desk', real });
  }

  // -------------------------------------------------------------- phones

  /**
   * A phone's hello (EP-35 §7): bound by a ticket from the remote in
   * control, by its own token afterwards, or, on this computer only, to
   * the participant it names. The binding is the host's, never the page's.
   * → {ok, participant_id, token} | {ok:false, code, error}
   */
  function phoneHello({
    id,
    participant_id = null,
    ticket = null,
    token = null,
    local = false,
    real = now(),
  }) {
    const deny = (code, error) => ({ ok: false, code, error });
    if (!id || typeof id !== 'string' || id.length > 64)
      return deny(PHONE_DENY.NO_ID, 'No device id');
    if (!tokens)
      return deny(
        PHONE_DENY.NOT_TRUSTED,
        'Phones are not set up on this relay',
      );
    const known = phones.get(id);
    if (known) {
      if (!token || !tokens.same(token, known.tokenHash))
        return deny(PHONE_DENY.ID_IN_USE, 'This phone id is already in use');
      if (participant_id && participant_id !== known.participant_id)
        return deny(
          PHONE_DENY.I10_NOT_BOUND,
          'This phone is paired to someone else',
        );
      return { ok: true, participant_id: known.participant_id, token };
    }
    let pid = null;
    if (ticket) {
      const h = tokens.hash(String(ticket));
      const t = tickets.get(h);
      if (!t || t.expires <= real) {
        tickets.delete(h);
        return deny(
          PHONE_DENY.TICKET_EXPIRED,
          'This phone link has expired · ask the presenter for a new one',
        );
      }
      if (participant_id && participant_id !== t.participant_id)
        return deny(
          PHONE_DENY.I10_NOT_BOUND,
          'This phone link is for someone else',
        );
      tickets.delete(h);
      pid = t.participant_id;
    } else if (local && participant_id) pid = participant_id;
    else
      return deny(
        PHONE_DENY.NOT_TRUSTED,
        'Open the phone link from the presenter to pair this phone',
      );
    if (!day.people?.[pid])
      return deny(PHONE_DENY.UNKNOWN_PERSON, 'No such participant');
    const tk = randomId(16);
    phones.set(id, { participant_id: pid, tokenHash: tokens.hash(tk) });
    return { ok: true, participant_id: pid, token: tk, paired: true };
  }

  // -------------------------------------------------------------- views

  // The day starts as Reset leaves it: the script folded to beat 0, paused.
  foldTo(beat0);
  presenterEvent('beat.go', { n: 0, at: beats[0] });
  clock.rate = rateAt(beat0);

  // B3: MAIN's brief and the walls' map data never change during a run.
  const brief = briefOf(day);
  const geoJson = JSON.stringify(geoOf(day));
  let loopCache = { key: null, json: null };
  const revKey = () => `${run}:${loop.rev}`;
  /** The loop as other walls, the remote and the monitor get it (no fixture copy). */
  function loopView() {
    const { base: _b, ...rest } = loop;
    void _b;
    return rest;
  }
  function clockView(real = now()) {
    const sim = Math.min(simAt(real), endMs);
    const ci = cpIndexAt(sim);
    const c = cps[ci];
    return {
      sample: true,
      run,
      simNow: iso(Math.round(sim / 1000) * 1000),
      rate: clock.rate,
      paused: clock.paused,
      auto: clock.auto,
      held: clock.held,
      beat: beatAt(day, sim),
      checkpoint: c
        ? { beat: c.beat, checkpoint: c.checkpoint, from: c.from, to: c.to }
        : null,
      label: clockLabel(clock.rate),
      at: real,
    };
  }

  return {
    tick,
    presenter,
    applyLive,
    desk,
    phoneHello,
    clockView,
    loopView,
    /** The full-loop message text, built once per change. */
    loopText(clockNow) {
      const key = revKey();
      if (loopCache.key !== key)
        loopCache = { key, json: JSON.stringify(loopView()) };
      return `{"t":"${EXEC_MSG.LOOP}","view":"loop","rev":${loop.rev},"run":${run},"clock":${JSON.stringify(clockNow)},"loop":${loopCache.json},"geo":${geoJson}}`;
    },
    /** MAIN gets selectMain, the brief and where its map goes: never the loop (I3). */
    mainView: () => ({ ...selectMain(loop), brief, scene: mainScene(loop) }),
    phoneView: (pid) => selectPhone(loop, pid),
    wallRole: (slot) => roleOfSlot(slot, wallRoles),
    get loop() {
      return loop;
    },
    get rev() {
      return revKey();
    },
    get run() {
      return run;
    },
    get clock() {
      return { ...clock, simNow: iso(simAt(now())) };
    },
    get live() {
      return live.map((l) => l.ev);
    },
    get setAside() {
      return setAside.map((l) => ({ ...l.ev, run: l.run }));
    },
    get scriptRefused() {
      return [...scriptRefused];
    },
    callsignOf: (pid) => loop.people?.[pid]?.callsign ?? null,
  };
}

// ------------------------------------------------------------------ relay

/**
 * The relay seam (EP-35 §7). `executiveRelay(opts)` returns the factory
 * createRelay calls with its own internals; the hooks it returns are the
 * only executive code the relay runs:
 *   meta(ws)             a phone's or monitor's socket, else undefined
 *   handle(ws, m, me, conn) true when the message was the executive's
 *   release(ws)          a socket is gone
 *   tick()               the clock, and the per-socket loop it sends
 * Phones and monitors are never in the relay's `sockets` map, so the
 * session state, presence and thumbnails never reach them.
 */
export function executiveRelay({
  day,
  tokens = null,
  now: nowOpt = null,
  loopHost = null,
} = {}) {
  return function wire(api) {
    const {
      host,
      sockets,
      record,
      limiter,
      limitHit,
      release,
      timers,
      limits,
      now = nowOpt || Date.now,
    } = api;
    const lh = loopHost || createLoopHost({ day, now, tokens });
    const execSockets = new Map(); // ws → {id, kind, participant_id?}
    const sent = new WeakMap(); // ws → {key, at}
    const rolesSent = new WeakMap(); // ws → `${slot}:${role}` (B3)
    let lastClockAt = -Infinity;

    const raw = (ws, text) => {
      if (ws.readyState === 1) ws.send(text);
    };
    const send = (ws, msg) => raw(ws, JSON.stringify(msg));
    const ack = (ws, m, r) =>
      send(ws, {
        t: EXEC_MSG.ACK,
        reqId: m.reqId,
        ok: Boolean(r.ok),
        ...(r.code ? { code: r.code } : {}),
        ...(r.error ? { error: r.error } : {}),
        ...(r.ask ? { ask: r.ask } : {}),
        ...(r.ticket ? { ticket: r.ticket, ttlMs: r.ttlMs } : {}),
      });
    const admit = (conn) => {
      timers.clear(conn.deadline);
      conn.deadline = null;
      conn.state = 'paired';
    };
    const deny = (ws, code, error) =>
      send(ws, { t: 'welcome', type: 'denied', code, error, proto: PROTO });

    /** Every socket that receives a view of the loop, with that view. */
    function targets() {
      const out = [];
      for (const [ws, meta] of sockets) {
        const slot =
          meta.kind === 'screen'
            ? (meta.place ?? host.slotOf?.(meta.id) ?? null)
            : null;
        const role = meta.kind === 'screen' ? lh.wallRole(slot) : null;
        const view = viewFor({ kind: meta.kind, role });
        if (view) out.push({ ws, view, role, slot });
      }
      for (const [ws, meta] of execSockets)
        out.push({
          ws,
          view: viewFor({ kind: meta.kind }),
          pid: meta.participant_id,
        });
      return out;
    }

    /** Send each socket its view when it changed (a full loop at most once a second). */
    function publish({ force = false } = {}) {
      const t = now();
      const clock = lh.clockView(t);
      const rev = lh.rev;
      let main = null;
      const phones = new Map();
      for (const { ws, view, role, slot, pid } of targets()) {
        // B3: a wall hears its executive role when it joins or it changes
        // (EP-51: the session only knows school roles).
        if (role && slot != null && rolesSent.get(ws) !== `${slot}:${role}`) {
          send(ws, { t: EXEC_MSG.ROLE, slot: Number(slot), role });
          rolesSent.set(ws, `${slot}:${role}`);
        }
        const key = `${view}:${role ?? ''}:${pid ?? ''}:${rev}`;
        const last = sent.get(ws);
        if (last?.key === key) continue;
        if (view === 'loop' && !force && last && t - last.at < LOOP_EVERY_MS)
          continue;
        let text;
        if (view === 'loop') text = lh.loopText(clock);
        else if (view === 'main') {
          main ??= JSON.stringify({
            t: EXEC_MSG.LOOP,
            view: 'main',
            rev: lh.loop.rev,
            run: lh.run,
            clock,
            main: lh.mainView(),
          });
          text = main;
        } else {
          if (!phones.has(pid))
            phones.set(
              pid,
              JSON.stringify({
                t: EXEC_MSG.LOOP,
                view: 'phone',
                rev: lh.loop.rev,
                run: lh.run,
                clock,
                phone: lh.phoneView(pid),
              }),
            );
          text = phones.get(pid);
        }
        raw(ws, text);
        sent.set(ws, { key, at: t });
      }
    }
    function publishClock(force = false) {
      const t = now();
      if (!force && t - lastClockAt < CLOCK_EVERY_MS) return;
      lastClockAt = t;
      const text = JSON.stringify({
        t: EXEC_MSG.CLOCK,
        clock: lh.clockView(t),
      });
      for (const { ws } of targets()) raw(ws, text);
    }

    const loopAudit = (ev, from) =>
      record('loop.event', {
        data: {
          type: ev.type,
          by: ev.by,
          sit_id: ev.sit_id,
          push_id: ev.push_id,
          rung: ev.rung,
          answer: ev.answer,
          from,
          run: lh.run,
        },
      });
    const refusedAudit = (type, code, from, actor = null) =>
      record('loop.refused', { actor, data: { type, code, from } });

    function hello(ws, m, conn) {
      conn.hellos += 1;
      if (conn.hellos > limits.hellosPerSocket) {
        limitHit('hellos', { kind: m.kind });
        deny(ws, DENY.RATE_LIMITED, 'Too many tries');
        release(ws);
        ws.close(CLOSE.TRY_LATER, 'too many hellos');
        return;
      }
      conn.proto = m.proto;
      if (!protoOk(m.proto)) {
        deny(ws, DENY.RELOAD, reloadText(m.kind));
        return;
      }
      if (m.kind === 'monitor') {
        // Read-only, and only on the Trip Twin computer itself.
        if (!conn.isLocal) {
          deny(
            ws,
            DENY.NOT_TRUSTED,
            'The monitor runs on the Trip Twin computer only',
          );
          return;
        }
        admit(conn);
        execSockets.set(ws, { id: String(m.id || 'monitor'), kind: 'monitor' });
        send(ws, {
          t: 'welcome',
          type: 'monitor',
          proto: PROTO,
          exec: EXEC_PROTO,
          clock: lh.clockView(now()),
        });
        publish({ force: true });
        return;
      }
      const r = lh.phoneHello({
        id: typeof m.id === 'string' ? m.id : '',
        participant_id:
          typeof m.participant_id === 'string' ? m.participant_id : null,
        ticket: typeof m.ticket === 'string' ? m.ticket : null,
        token: typeof m.token === 'string' ? m.token : null,
        local: Boolean(conn.isLocal),
        real: now(),
      });
      if (!r.ok) {
        record('device.hello', {
          data: {
            outcome: 'denied',
            code: r.code,
            kind: 'phone',
            proto: m.proto,
          },
        });
        deny(ws, r.code, r.error);
        return;
      }
      // One live socket per phone id: the newer window is the phone.
      for (const [w, meta] of execSockets)
        if (w !== ws && meta.kind === 'phone' && meta.id === m.id) {
          execSockets.delete(w);
          send(w, { t: REPLACED });
          w.close(CLOSE.REPLACED, 'replaced');
        }
      admit(conn);
      execSockets.set(ws, {
        id: m.id,
        kind: 'phone',
        participant_id: r.participant_id,
      });
      send(ws, {
        t: 'welcome',
        type: 'phone',
        proto: PROTO,
        exec: EXEC_PROTO,
        participant_id: r.participant_id,
        callsign: lh.callsignOf(r.participant_id),
        token: r.token,
        clock: lh.clockView(now()),
      });
      publish({ force: true });
    }

    function phoneCmd(ws, m, em) {
      const lim = limiter.command(em.id, now());
      if (!lim.ok) {
        limitHit('device-cmd', {
          kind: 'phone',
          retryAfterMs: lim.retryAfterMs,
        });
        refusedAudit(m.cmd?.type, EXEC_CODE.RATE_LIMITED, 'phone');
        ack(ws, m, {
          ok: false,
          code: EXEC_CODE.RATE_LIMITED,
          error: 'Too many at once · nothing changed · try again',
        });
        return;
      }
      const p = phoneEvent(m.cmd, em.participant_id);
      if (p.code) {
        refusedAudit(m.cmd?.type, p.code, 'phone');
        ack(ws, m, { ok: false, code: p.code });
        return;
      }
      const r = lh.applyLive(p.event, {
        by: em.participant_id,
        via: 'phone',
        device: { participant_id: em.participant_id },
        from: 'phone',
        real: now(),
      });
      if (!r.ok) {
        refusedAudit(p.event.type, r.code, 'phone');
        ack(ws, m, r);
        return;
      }
      loopAudit(r.ev, 'phone');
      ack(ws, m, { ok: true });
      publish({ force: true });
    }

    function loopCmd(ws, m, me) {
      const actor = host.actorOf?.(me.id) ?? null;
      if (me.kind !== 'remote') {
        refusedAudit(m.cmd?.type, EXEC_CODE.NOT_REMOTE, 'presenter', actor);
        ack(ws, m, { ok: false, code: EXEC_CODE.NOT_REMOTE });
        return;
      }
      const lim = limiter.command(me.id, now());
      if (!lim.ok) {
        limitHit('device-cmd', {
          kind: me.kind,
          retryAfterMs: lim.retryAfterMs,
        });
        refusedAudit(m.cmd?.type, EXEC_CODE.RATE_LIMITED, 'presenter', actor);
        ack(ws, m, { ok: false, code: EXEC_CODE.RATE_LIMITED });
        return;
      }
      if (!host.isController(me.id)) {
        refusedAudit(
          m.cmd?.type,
          EXEC_CODE.LEASE_NOT_CONTROLLER,
          'presenter',
          actor,
        );
        ack(ws, m, {
          ok: false,
          code: EXEC_CODE.LEASE_NOT_CONTROLLER,
          error: 'Only the remote in control runs the clock',
        });
        return;
      }
      const p = presenterCmd(m.cmd);
      if (p.code) {
        refusedAudit(m.cmd?.type, p.code, 'presenter', actor);
        ack(ws, m, { ok: false, code: p.code, error: p.reason });
        return;
      }
      const r = lh.presenter(p.cmd, { by: me.id, real: now() });
      ack(ws, m, r);
      if (!r.ok) {
        if (r.code !== EXEC_CODE.CONFIRM_REQUIRED)
          refusedAudit(p.cmd.type, r.code, 'presenter', actor);
        return;
      }
      for (const type of r.events || [])
        record('loop.event', {
          actor,
          data: { type, by: 'presenter', from: 'presenter', run: lh.run },
        });
      if (r.beat)
        record('presenter.beat', { actor, data: { ...r.beat, run: lh.run } });
      if (r.changed) {
        publish({ force: true });
        publishClock(true);
      }
    }

    return {
      loopHost: lh,
      meta: (ws) => execSockets.get(ws),
      handle(ws, m, me, conn) {
        const em = execSockets.get(ws);
        if (m.t === 'hello') {
          if (em) {
            deny(
              ws,
              DENY.ALREADY_IDENTIFIED,
              'This connection has already said hello',
            );
            ws.close(CLOSE.ALREADY_IDENTIFIED, 'already identified');
            return true;
          }
          if (me || !EXEC_KINDS.includes(m.kind)) return false;
          hello(ws, m, conn);
          return true;
        }
        if (em) {
          // A phone or the monitor is not on the wall: its heartbeat and
          // its own command only; everything else is dropped.
          if (m.t === EXEC_MSG.PHONE_CMD) {
            if (em.kind === 'phone') phoneCmd(ws, m, em);
            else ack(ws, m, { ok: false, code: EXEC_CODE.NOT_PHONE });
          }
          return true;
        }
        if (m.t === EXEC_MSG.PHONE_CMD) {
          refusedAudit(
            m.cmd?.type,
            EXEC_CODE.NOT_PHONE,
            'phone',
            host.actorOf?.(me.id) ?? null,
          );
          ack(ws, m, { ok: false, code: EXEC_CODE.NOT_PHONE });
          return true;
        }
        if (m.t === EXEC_MSG.LOOP_CMD) {
          loopCmd(ws, m, me);
          return true;
        }
        return false;
      },
      release(ws) {
        execSockets.delete(ws);
      },
      tick() {
        lh.tick(now());
        publish();
        publishClock();
      },
      publish,
    };
  };
}
