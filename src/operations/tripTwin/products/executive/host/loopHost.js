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
//
// B4 (EP-31 §3, EP-33 §§2–3, 7, EP-38 #6/#8/#12): the desk's live actions
// and the presenter's two ORTEGA shortcuts pre-empt the scripted event
// they stand for. The host finds that event (same kind, same record, the
// current beat), sends its ids and payload at the current sim time with
// the desk's own choices on top, and marks it pre-empted: when the clock
// reaches it, it is skipped (a deterministic no-op, never a refusal). A
// system draft the action needs is pulled forward the same way. Reversals
// name what they reverse. Previous and Reset re-derive the pre-emptions
// from the live events they keep; Reset keeps none, so the script is back.
import { applyLoopEvent, createLoop } from '../loop/twinLoop.js';
import { selectMain, selectPhone } from '../loop/select.js';
import {
  LOOP_ACTIONS,
  PHONE_EVENTS,
  PRESENTER_EVENTS,
  PUSHABLE,
  UNDOABLE,
  UNDO_MS,
  actorRole,
} from '../loop/loopPolicy.js';
import { beatAt, buildTimeline } from '../timeline.js';
import { briefOf, geoOf, mainScene } from '../loop/wallData.js';
import { lz } from '../format.js';
import {
  CAUSE,
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
  SHORTCUTS,
  DESK_FIELDS,
  clockLabel,
  deskCmd,
  phoneEvent,
  presenterCmd,
  roleOfSlot,
  roomPreset,
  sessionPatchFor,
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

/**
 * B4: the record keys that make a scripted event the counterpart of a live
 * one (same type, same values; a key the live event leaves out matches
 * any value, so "call next" takes the next scripted step).
 */
export const PREEMPT_KEYS = Object.freeze({
  'verification.decide': ['sit_id'],
  'verification.countersign': ['sit_id'],
  'notify.send': ['sit_id'],
  'recommendation.draft': ['recommendation_id'],
  'recommendation.approve': ['recommendation_id'],
  'push.send': ['recommendation_id'],
  'intel.dismiss': ['bundle_id'],
  'intel.watch': ['bundle_id'],
  'message.send': ['sit_id', 'to'],
  'callback.step': ['push_id', 'step'],
  'posture.retier': ['person_id'],
  'sitrep.draft': ['sitrep_id'],
  'sitrep.sign': ['sitrep_id'],
  'situation.close': ['sit_id'],
  ack: ['push_id', 'participant_id', 'rung'],
  'dl.respond': ['push_id', 'participant_id'],
  'checkin.respond': ['person_id', 'kind'],
  'sharing.set': ['person_id'],
  'salute.file': ['person_id'],
});
/** Fields of a scripted event that are its own, never a live copy's. */
const SCRIPT_ONLY = [
  'id',
  'at',
  'by',
  'via',
  'beat',
  'tz',
  'decided_at',
  'version',
];
const payloadOf = (ev, { keepVersion = false } = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(ev))
    if (!SCRIPT_ONLY.includes(k) || (keepVersion && k === 'version'))
      out[k] = v;
  return out;
};

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
  /** B4: scripted event id → the live event that pre-empted it (this run). */
  let preempted = new Map();
  /** B4: scripted entries skipped because of it (this run), for the desk. */
  let skipped = [];
  /** B4 (EP-38 #12): phone modes by sim time; scripted unless set live. */
  let phoneModes = [];
  /** B4: scripted phone replies held while the phones are live. */
  let held = [];
  /** B4 (EP-33 §3): each desk device's last act-tier change, for 10 s. */
  const undos = new Map();
  let pullSeq = 0;
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

  const modeAt = (t) => {
    let m = 'scripted';
    for (const x of phoneModes) if (x.at <= t) m = x.mode;
    return m;
  };
  /** A scripted phone reply waits for the tap while the phones are live. */
  const heldForPhone = (e, t) =>
    PHONE_EVENTS.includes(e.ev.type) &&
    actorRole(loop, e.ev.by) === 'person' &&
    modeAt(t) === 'live';

  /** Apply every scripted entry at or before `target`, in order. */
  function foldTo(target) {
    while (cursor < T.length && tms[cursor] <= target) {
      const e = T[cursor];
      if (preempted.has(e.ev.id)) {
        skipped.push({
          run,
          seq: e.seq,
          id: e.ev.id,
          by: preempted.get(e.ev.id),
        });
        cursor += 1;
        continue;
      }
      if (heldForPhone(e, tms[cursor])) {
        held.push({ run, seq: e.seq, id: e.ev.id });
        cursor += 1;
        continue;
      }
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
    preempted = new Map();
    skipped = [];
    held = [];
    undos.clear();
    phoneModes = keepLive ? phoneModes.filter((m) => m.at <= target) : [];
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
        else {
          live.push(kept[j]);
          for (const id of kept[j].preempts || [])
            preempted.set(id, kept[j].ev.id);
        }
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
        // The relay applies the school session role the wall is built on.
        return done({
          session: { slot: cmd.slot, patch: sessionPatchFor(cmd.role) },
        });
      case 'phones.mode':
        phoneModes.push({ at: sim, mode: cmd.mode });
        return done();
      case 'ortega.countersign':
      case 'ortega.retier': {
        // EP-38 #8: ORTEGA's scripted event, sent now from the iPad; only
        // at its beat and while it is still to come; ask first.
        const sc = SHORTCUTS[cmd.type];
        if (beatAt(day, sim) !== sc.beat) return no(EXEC_CODE.WRONG_BEAT);
        const e = shortcutEntry(cmd.type);
        if (!e) return no(EXEC_CODE.NOT_PENDING);
        if (!confirmed) {
          const who = loop.people[e.ev.person_id]?.callsign;
          const sit = loop.situations[e.ev.sit_id];
          const text =
            cmd.type === 'ortega.retier'
              ? `Re-tier ${who ?? 'the person'} ${e.ev.from ?? ''} → ${e.ev.to ?? e.ev.protection} as ORTEGA now? The script has it at ${lz(e.at, e.ev.tz || tzOfBeat(sc.beat))}.`
              : `Countersign ${sit?.callsign ?? 'the item'} as ORTEGA now? The script has it at ${lz(e.at, e.ev.tz || tzOfBeat(sc.beat))}.`;
          return askFor(cmd, by, text.replace(/\s+/g, ' '), real);
        }
        const r = batch(
          [
            {
              fields: payloadOf(e.ev),
              by: sc.as,
              via: 'presenter',
              from: 'presenter',
              preempts: [e.ev.id],
            },
          ],
          real,
        );
        if (!r.ok) return no(r.code, { error: r.error });
        return done({
          events: [],
          shortcut: {
            type: sc.event,
            by: sc.as,
            sit_id: e.ev.sit_id ?? null,
            preempts: e.ev.id,
            id: r.ev.id,
          },
        });
      }
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

  // ------------------------------------------------- live events (B4)

  /** The first scripted entry still to come (not pre-empted) that passes `pred`. */
  function pendingEntry(pred) {
    for (let i = cursor; i < T.length; i++) {
      const e = T[i];
      if (!preempted.has(e.ev.id) && pred(e)) return e;
    }
    return null;
  }
  const nowBeat = () => beatAt(day, Math.max(lastSim, ms(loop.clock.simNow)));
  /**
   * The scripted event a live one stands for: same type, same record keys,
   * in the current beat, still to come. → timeline entry | null
   */
  function counterpart(fields) {
    const keys = PREEMPT_KEYS[fields.type];
    if (!keys) return null;
    const beat = nowBeat();
    return pendingEntry(
      (e) =>
        e.ev.type === fields.type &&
        e.beat === beat &&
        keys.every((k) =>
          k === 'kind'
            ? (e.ev.kind ?? 'checkin') === (fields.kind ?? 'checkin')
            : fields[k] == null || e.ev[k] === fields[k],
        ),
    );
  }
  /** ORTEGA's scripted event a presenter shortcut stands for (EP-38 #8). */
  function shortcutEntry(name) {
    const sc = SHORTCUTS[name];
    return pendingEntry(
      (e) => e.ev.type === sc.event && e.ev.by === sc.as && e.beat === sc.beat,
    );
  }
  /** The last record line of one of `types` for this record (what a reversal names). */
  function lastLog(types, match) {
    for (let i = loop.log.length - 1; i >= 0; i--) {
      const l = loop.log[i];
      if (!types.includes(l.type) || !l.id) continue;
      if (Object.entries(match).every(([k, v]) => l.ids?.[k] === v)) return l;
    }
    return null;
  }

  /**
   * Live events, all or none, at the current sim time. Each item:
   * {fields, by, via, device?, from, preempts?: [scripted ids], id?}.
   * → {ok, evs, ev} | {ok:false, code, error}
   */
  function batch(items, real = now()) {
    tick(real);
    const at = Math.max(simAt(real), ms(loop.clock.simNow));
    let l = loop;
    let seq = liveSeq;
    const evs = [];
    for (const it of items) {
      seq += 1;
      const ev = {
        ...it.fields,
        id: it.id || `e-live-${run}-${seq}`,
        at: iso(at),
        by: it.by,
        via: it.via,
        ...(it.device ? { device: it.device } : {}),
        ...(it.preempts?.length ? { preempts: it.preempts[0] } : {}),
      };
      const r = applyLoopEvent(l, ev);
      if (r.refused)
        return {
          ok: false,
          code: r.refused.code,
          error: r.refused.reason,
          type: ev.type,
        };
      l = r.loop;
      evs.push(ev);
    }
    liveSeq = seq;
    loop = l;
    items.forEach((it, i) => {
      live.push({ ev: evs[i], from: it.from, preempts: it.preempts || [] });
      for (const id of it.preempts || []) preempted.set(id, evs[i].id);
    });
    return { ok: true, evs, ev: evs[0] };
  }

  /**
   * A live event (a phone's) at the current sim time. `fields` carry no
   * id, at, by or device: they are stamped here. A phone's tap pre-empts
   * its scripted reply (EP-38 #12: a tap answers early). → {ok, ev?, code?}
   */
  function applyLive(fields, { by, via, device = null, from, real = now() }) {
    tick(real);
    const cp =
      from === 'phone' && PHONE_EVENTS.includes(fields.type)
        ? counterpart(fields)
        : null;
    const r = batch(
      [{ fields, by, via, device, from, preempts: cp ? [cp.ev.id] : [] }],
      real,
    );
    return r.ok ? { ok: true, ev: r.ev } : { ok: false, code: r.code };
  }

  /** A system draft (scripted) pulled forward because a live action needs it. */
  function pull(e) {
    pullSeq += 1;
    return {
      id: `e-pull-${run}-${pullSeq}`,
      fields: payloadOf(e.ev, { keepVersion: true }),
      by: e.ev.by,
      via: 'script',
      from: 'desk',
      preempts: [e.ev.id],
    };
  }
  const draftFor = (pred) =>
    pendingEntry((e) => e.ev.by === 'generator' && pred(e.ev));

  /**
   * The desk's intent → the live events it becomes, or a refusal code.
   * Every item carries the scripted event it pre-empts, if there is one.
   */
  function deskPlan(intent, by) {
    const { type } = intent;
    const fail = (code, error = null) => ({ code, error });
    const one = (fields, extra = {}) => ({
      items: [{ fields, by, via: 'touch', from: 'desk', ...extra }],
    });
    /** Merge onto the scripted counterpart (its ids and payload), if any. */
    const merged = (fields) => {
      const cp = counterpart(fields);
      const base = cp ? payloadOf(cp.ev) : {};
      return {
        fields: { ...base, ...fields },
        preempts: cp ? [cp.ev.id] : [],
        cp,
      };
    };
    switch (type) {
      case 'intel.restore': {
        const rv = lastLog(['intel.dismiss', 'intel.watch'], {
          bundle_id: intent.bundle_id,
        });
        if (!rv) return fail('NOT_FOUND');
        return one({ type, bundle_id: intent.bundle_id, reverses: rv.id });
      }
      case 'verification.reopen': {
        const rv = lastLog(['verification.decide'], { sit_id: intent.sit_id });
        if (!rv) return fail('NOT_FOUND');
        return one({ type, sit_id: intent.sit_id, reverses: rv.id });
      }
      case 'situation.reopen': {
        const rv = lastLog(['situation.close'], { sit_id: intent.sit_id });
        if (!rv) return fail('NOT_FOUND');
        return one({
          type,
          sit_id: intent.sit_id,
          reason: intent.reason,
          reverses: rv.id,
        });
      }
      case 'push.recall': {
        const rv = lastLog(['push.send'], { push_id: intent.push_id });
        if (!rv) return fail('NOT_FOUND');
        return one({
          type,
          push_id: intent.push_id,
          reason: intent.reason,
          reverses: rv.id,
        });
      }
      case 'posture.retier': {
        if (intent.back) {
          const rv = lastLog(['posture.retier'], {
            person_id: intent.person_id,
          });
          if (!rv) return fail('NOT_FOUND');
          return one({
            type,
            person_id: intent.person_id,
            to: intent.to,
            reason: intent.reason,
            reverses: rv.id,
          });
        }
        const m = merged({
          type,
          person_id: intent.person_id,
          ...(intent.to ? { to: intent.to } : {}),
          ...(intent.reason ? { reason: intent.reason } : {}),
        });
        if (intent.to) m.fields.protection = intent.to;
        return one(m.fields, { preempts: m.preempts });
      }
      case 'recommendation.edit':
        return one({
          type,
          recommendation_id: intent.recommendation_id,
          patch: { bluf: intent.bluf },
        });
      case 'push.send': {
        const rec =
          loop.recommendations[intent.recommendation_id] ||
          draftFor(
            (ev) =>
              ev.type === 'recommendation.draft' &&
              ev.recommendation_id === intent.recommendation_id,
          )?.ev;
        if (!rec) return fail('NOT_FOUND');
        const version = rec.version ?? 1;
        const sit = loop.situations[rec.sit_id];
        if (intent.supersede) {
          const cur = sit?.push_id && loop.pushes[sit.push_id];
          if (!cur) return fail('NOT_FOUND');
          const rv = lastLog(['push.send'], { push_id: cur.push_id });
          return one({
            type,
            recommendation_id: rec.id ?? intent.recommendation_id,
            push_id: `push-${rec.id}-v${version}`,
            supersedes: cur.push_id,
            ...(rv ? { reverses: rv.id } : {}),
            card: [`BLUF: ${rec.bluf}`],
            header: cur.header ?? null,
            phone: cur.phone ?? {},
          });
        }
        const m = merged({ type, recommendation_id: intent.recommendation_id });
        if (!m.cp)
          Object.assign(m.fields, {
            push_id: `push-${intent.recommendation_id}-v${version}`,
            card: [`BLUF: ${rec.bluf}`],
          });
        return one(m.fields, { preempts: m.preempts });
      }
      case 'message.send': {
        if (intent.text)
          return one({
            type,
            sit_id: intent.sit_id ?? null,
            to: intent.to,
            text: intent.text,
            kind: 'note',
          });
        const m = merged({ type, sit_id: intent.sit_id, to: intent.to });
        if (!m.cp) return fail(EXEC_CODE.NOT_PENDING);
        return one(m.fields, { preempts: m.preempts });
      }
      case 'callback.step': {
        const m = merged({
          type,
          push_id: intent.push_id,
          ...(intent.step ? { step: intent.step } : {}),
        });
        if (!m.cp) {
          const cb = loop.callbacks[intent.push_id];
          if (!cb) return fail('I9_CALLBACK_NOT_OPEN');
          const last = cb.steps.at(-1)?.step;
          m.fields.step = intent.step ?? (last ? last + 1 : cb.step);
          m.fields.outcome = intent.outcome ?? 'call placed';
        } else if (intent.outcome) m.fields.outcome = intent.outcome;
        return one(m.fields, { preempts: m.preempts });
      }
      case 'sitrep.sign': {
        const sit = intent.sit_id && loop.situations[intent.sit_id];
        const sitrepId =
          intent.sitrep_id ||
          sit?.sitrep_id ||
          draftFor(
            (ev) => ev.type === 'sitrep.draft' && ev.sit_id === intent.sit_id,
          )?.ev.sitrep_id;
        if (!sitrepId) return fail('NOT_FOUND');
        const sign = merged({ type, sitrep_id: sitrepId });
        const items = [
          {
            fields: sign.fields,
            by,
            via: 'touch',
            from: 'desk',
            preempts: sign.preempts,
          },
        ];
        const sitId = intent.sit_id || sign.fields.sit_id;
        if (intent.close && sitId) {
          const close = merged({ type: 'situation.close', sit_id: sitId });
          if (!close.fields.reason) close.fields.reason = 'clear';
          items.push({
            fields: close.fields,
            by,
            via: 'touch',
            from: 'desk',
            preempts: close.preempts,
          });
        }
        return { items };
      }
      default: {
        const fields = { ...intent };
        if (type === 'verification.decide' && intent.grade) {
          const cp = counterpart({ type, sit_id: intent.sit_id });
          const g = cp?.ev.grade;
          if (
            !g ||
            g.source !== intent.grade.source ||
            g.info !== intent.grade.info
          )
            fields.grade_token = `${intent.grade.source}${intent.grade.info}`;
        }
        const m = merged(fields);
        return one(m.fields, { preempts: m.preempts });
      }
    }
  }

  /**
   * The desk's way in (EP-31 §3, EP-33 §§1–3): a named watch member
   * only, desk intents only (execProtocol.js DESK_FIELDS). The live
   * events pre-empt their scripted counterparts; drafts they need are
   * pulled forward; the last act-tier change can be undone for 10 s.
   * → {ok, evs?, code?, error?}
   */
  function desk(intent, { by, device = null, real = now() }) {
    if (!loop.watch?.[by]) return { ok: false, code: 'ROLE' };
    if (!intent || !Object.hasOwn(DESK_FIELDS, intent.type))
      return { ok: false, code: 'UNKNOWN_EVENT' };
    tick(real);
    if (intent.type === 'undo') return undo(device, real);
    const plan = deskPlan(intent, by);
    if (plan.code) return { ok: false, code: plan.code, error: plan.error };
    const items = [...plan.items];
    // A record the action names that only the script has yet: pull its draft.
    const pulls = [];
    for (const it of items) {
      const f = it.fields;
      if (f.recommendation_id && !loop.recommendations[f.recommendation_id]) {
        const d = draftFor(
          (ev) =>
            ev.type === 'recommendation.draft' &&
            ev.recommendation_id === f.recommendation_id,
        );
        if (d && !pulls.some((p) => p.preempts[0] === d.ev.id))
          pulls.push(pull(d));
      }
      if (f.type === 'sitrep.sign' && !loop.sitreps[f.sitrep_id]) {
        const d = draftFor(
          (ev) => ev.type === 'sitrep.draft' && ev.sitrep_id === f.sitrep_id,
        );
        if (d) pulls.push(pull(d));
      }
    }
    // After a pushable decision the system drafts at once (EP-33 §1).
    const after = [];
    const main = items[0].fields;
    if (
      (main.type === 'verification.decide' &&
        PUSHABLE.includes(main.decision)) ||
      main.type === 'verification.countersign'
    ) {
      const sit = loop.situations[main.sit_id];
      if (sit && !sit.recommendation_id) {
        const d = draftFor(
          (ev) =>
            ev.type === 'recommendation.draft' && ev.sit_id === main.sit_id,
        );
        if (d) after.push(pull(d));
      }
    }
    const r = batch([...pulls, ...items, ...after], real);
    if (!r.ok) return r;
    const mine = r.evs.slice(pulls.length, pulls.length + items.length);
    if (device && UNDOABLE[mine[0].type])
      undos.set(device, { ev: mine[0], by, expires: real + UNDO_MS });
    else if (device) undos.delete(device);
    return { ok: true, evs: r.evs, ev: mine[0] };
  }

  /** EP-33 §3: this device's last act-tier change, within 10 s, as a reversal. */
  function undo(device, real) {
    const u = device && undos.get(device);
    if (!u) return { ok: false, code: EXEC_CODE.NOT_UNDOABLE };
    undos.delete(device);
    if (u.expires <= real) return { ok: false, code: EXEC_CODE.UNDO_EXPIRED };
    const type = UNDOABLE[u.ev.type];
    const fields =
      type === 'intel.restore'
        ? { type, bundle_id: u.ev.bundle_id, reverses: u.ev.id }
        : { type, sit_id: u.ev.sit_id, reverses: u.ev.id };
    const r = batch([{ fields, by: u.by, via: 'touch', from: 'desk' }], real);
    return r.ok ? { ok: true, evs: r.evs, ev: r.ev } : r;
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
      // B4: what the presenter needs beside the clock (no names, no text).
      phones: modeAt(sim),
      shortcuts: shortcutsAt(sim),
      roles: Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((n) => [n, roleOfSlot(n, wallRoles)]),
      ),
      setAside: setAside.length,
    };
  }
  /** Each ORTEGA shortcut: null outside its beat or once done; else when, and ready. */
  function shortcutsAt(sim) {
    const out = {};
    for (const name of Object.keys(SHORTCUTS)) {
      const sc = SHORTCUTS[name];
      const e = beatAt(day, sim) === sc.beat ? shortcutEntry(name) : null;
      if (!e) {
        out[name] = null;
        continue;
      }
      const ready =
        sc.event === 'verification.countersign'
          ? Boolean(
              loop.verifications[e.ev.verification_id] &&
              !loop.verifications[e.ev.verification_id].countersigned_by,
            )
          : Boolean(loop.situations[e.ev.sit_id]);
      out[name] = { at: e.at, sit_id: e.ev.sit_id ?? null, ready };
    }
    return out;
  }

  /**
   * What the desk sees beside the loop (B4): the scripted watch actions
   * still to come (their sample times, so a click visibly pre-empts
   * them), the pre-written drafts not yet on the record, and what the
   * run set aside or skipped. Built once per change.
   */
  let deskCache = { key: null, json: null };
  function deskData() {
    const pending = [];
    const drafts = {};
    for (let i = cursor; i < T.length; i++) {
      const e = T[i];
      const ev = e.ev;
      if (preempted.has(ev.id)) continue;
      if (
        ev.type === 'recommendation.draft' &&
        !loop.recommendations[ev.recommendation_id] &&
        !drafts[ev.sit_id]
      )
        drafts[ev.sit_id] = {
          at: e.at,
          ...payloadOf(ev, { keepVersion: true }),
        };
      if (loop.watch[ev.by] && pending.length < 80)
        pending.push({
          id: ev.id,
          at: e.at,
          beat: e.beat,
          type: ev.type,
          by: ev.by,
          sit_id: ev.sit_id ?? null,
          bundle_id: ev.bundle_id ?? null,
          push_id: ev.push_id ?? null,
          sitrep_id: ev.sitrep_id ?? null,
          recommendation_id: ev.recommendation_id ?? null,
          person_id: ev.person_id ?? null,
          decision: ev.decision ?? null,
          step: ev.step ?? null,
          to: ev.to ?? ev.protection ?? null,
          ...(ev.type === 'verification.decide'
            ? {
                grade: ev.grade ?? null,
                grade_token: ev.grade_token ?? null,
                checklist: ev.checklist ?? null,
              }
            : {}),
          ...(ev.type === 'posture.retier'
            ? { from: ev.from ?? null, reason: ev.reason ?? null }
            : {}),
          ...(ev.type === 'callback.step'
            ? { outcome: ev.outcome ?? null }
            : {}),
        });
    }
    return {
      run,
      beat: nowBeat(),
      pending,
      drafts,
      preempted: Object.fromEntries(preempted),
      skipped: skipped.slice(-20),
      setAside: setAside.length,
      scriptRefused: scriptRefused.filter((x) => x.run === run).slice(-10),
      held: held.length,
      live: live.length,
    };
  }
  function deskJson() {
    const key = `${revKey()}:${cursor}`;
    if (deskCache.key !== key)
      deskCache = { key, json: JSON.stringify(deskData()) };
    return deskCache.json;
  }
  function undoView(device, real = now()) {
    const u = device && undos.get(device);
    if (!u || u.expires <= real) return null;
    return {
      id: u.ev.id,
      type: u.ev.type,
      reversal: UNDOABLE[u.ev.type],
      inMs: u.expires - real,
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
    deskData,
    /** The desk's message text: the loop, the script ahead, its own undo. */
    deskText(clockNow, device, real = now()) {
      const key = revKey();
      if (loopCache.key !== key)
        loopCache = { key, json: JSON.stringify(loopView()) };
      return `{"t":"${EXEC_MSG.LOOP}","view":"desk","rev":${loop.rev},"run":${run},"clock":${JSON.stringify(clockNow)},"loop":${loopCache.json},"desk":${deskJson()},"undo":${JSON.stringify(undoView(device, real))}}`;
    },
    /** B4: the room preset for a fresh setup; the overrides go. */
    preset(count) {
      for (const k of Object.keys(wallRoles)) delete wallRoles[k];
      return roomPreset(count);
    },
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
    get preempted() {
      return Object.fromEntries(preempted);
    },
    get skipped() {
      return [...skipped];
    },
    get held() {
      return [...held];
    },
    phoneMode: () => modeAt(simAt(now())),
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
      // B4: the relay's own state broadcast (after a session command the
      // host applies for the room preset or a wall's executive role).
      broadcastState = () => {},
    } = api;
    const lh = loopHost || createLoopHost({ day, now, tokens });
    const execSockets = new Map(); // ws → {id, kind, participant_id?}
    const sent = new WeakMap(); // ws → {key, at}
    const rolesSent = new WeakMap(); // ws → `${slot}:${role}` (B3)
    let lastClockAt = -Infinity;
    /** B4: a setup's room preset, waiting for a remote in control. */
    let pendingPreset = null;

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
        ...(r.events && r.evs ? { events: r.evs.map((e) => e.id) } : {}),
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
          id: meta.id,
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
      for (const { ws, view, role, slot, pid, id } of targets()) {
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
        else if (view === 'desk') text = lh.deskText(clock, id, t);
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

    const loopAudit = (ev, from, actor = null) =>
      record('loop.event', {
        actor,
        data: {
          type: ev.type,
          by: ev.by,
          sit_id: ev.sit_id,
          push_id: ev.push_id,
          rung: ev.rung,
          answer: ev.answer,
          from,
          run: lh.run,
          reverses: ev.reverses,
          preempts: ev.preempts,
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
      if (m.kind === 'desk') {
        // The analyst's desk is the single view on this computer (EP-31 §3).
        if (!conn.isLocal) {
          deny(
            ws,
            DENY.NOT_TRUSTED,
            'The desk runs on the Trip Twin computer only',
          );
          return;
        }
        admit(conn);
        execSockets.set(ws, { id: String(m.id || 'desk'), kind: 'desk' });
        send(ws, {
          t: 'welcome',
          type: 'desk',
          proto: PROTO,
          exec: EXEC_PROTO,
          as: ['VALE', 'ORTEGA'],
          clock: lh.clockView(now()),
        });
        publish({ force: true });
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

    /** B4: the desk's live action (EP-31 §3, EP-33 §§1–3). */
    function deskCommand(ws, m, em) {
      const lim = limiter.command(em.id, now());
      if (!lim.ok) {
        limitHit('device-cmd', {
          kind: 'desk',
          retryAfterMs: lim.retryAfterMs,
        });
        refusedAudit(m.cmd?.type, EXEC_CODE.RATE_LIMITED, 'desk');
        ack(ws, m, { ok: false, code: EXEC_CODE.RATE_LIMITED });
        return;
      }
      const p = deskCmd(m.cmd, m.as);
      if (p.code) {
        refusedAudit(m.cmd?.type, p.code, 'desk');
        ack(ws, m, { ok: false, code: p.code });
        return;
      }
      const r = lh.desk(p.cmd, { by: m.as, device: em.id, real: now() });
      if (!r.ok) {
        refusedAudit(p.cmd.type, r.code, 'desk');
        ack(ws, m, r);
        return;
      }
      for (const ev of r.evs) loopAudit(ev, 'desk');
      ack(ws, m, { ok: true, events: true, evs: r.evs });
      publish({ force: true });
    }

    /** B4: a session command the host applies through the remote in control. */
    function sessionCmd(by, cmd) {
      const r = host.command({ by, cmd });
      if (r.ok)
        broadcastState({
          cause: CAUSE.CMD,
          changed: r.changed,
          skipped: r.skipped,
          by: host.actorOf?.(by) ?? null,
        });
      return r;
    }
    /** The room preset (B4): applied once per setup, by the remote in control. */
    function applyPreset() {
      if (!pendingPreset) return;
      let ctrl = null;
      for (const [, meta] of sockets)
        if (meta.kind === 'remote' && host.isController(meta.id))
          ctrl = meta.id;
      if (!ctrl) return;
      const plan = lh.preset(pendingPreset.count);
      pendingPreset = null;
      let slots = 0;
      for (const { slot, patch } of plan) {
        if (!host.state?.screens?.[slot]) continue;
        const r = sessionCmd(ctrl, { type: 'screens', target: slot, patch });
        if (r.ok) slots += 1;
      }
      record('room.preset', {
        actor: host.actorOf?.(ctrl) ?? null,
        data: { count: plan.length, slots },
      });
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
      // EP-38 #8: ORTEGA's event, sent from the iPad, on record as such.
      if (r.shortcut)
        record('loop.event', {
          actor,
          data: {
            type: r.shortcut.type,
            by: r.shortcut.by,
            sit_id: r.shortcut.sit_id,
            from: 'presenter',
            preempts: r.shortcut.preempts,
            run: lh.run,
          },
        });
      if (r.session)
        sessionCmd(me.id, {
          type: 'screens',
          target: r.session.slot,
          patch: r.session.patch,
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
          if (m.t === EXEC_MSG.DESK_CMD) {
            if (em.kind === 'desk') deskCommand(ws, m, em);
            else {
              refusedAudit(m.cmd?.type, EXEC_CODE.NOT_DESK, 'desk');
              ack(ws, m, { ok: false, code: EXEC_CODE.NOT_DESK });
            }
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
        if (m.t === EXEC_MSG.DESK_CMD) {
          // Only the desk socket on this computer acts for the watch.
          refusedAudit(
            m.cmd?.type,
            EXEC_CODE.NOT_DESK,
            'desk',
            host.actorOf?.(me.id) ?? null,
          );
          ack(ws, m, { ok: false, code: EXEC_CODE.NOT_DESK });
          return true;
        }
        return false;
      },
      /** B4: a room was set up; its preset waits for a remote in control. */
      setup(r) {
        pendingPreset = { count: r?.count ?? 6 };
        applyPreset();
      },
      release(ws) {
        execSockets.delete(ws);
      },
      tick() {
        applyPreset();
        lh.tick(now());
        publish();
        publishClock();
      },
      publish,
    };
  };
}
