// Fitzroy V1 voice glue (plans/trip-twin/VOICE-CONTROL.md §2–§3, §7 V1;
// plans/trip-twin/FITZROY-V1-HOWTO.md). Pure: no DOM, no network.
//
// The local voice service (voice-lab/src/v1/service.py) hears a push-to-talk
// turn and returns the frozen rules-v2 decision ({op, …}, {ask}, {refuse},
// {ctl}, {answer}, {none}). This module turns it into catalog proposals
// (fitzroyCatalog.js: the Trip Twin wording, the guard, the tier) and the
// exact relay message the remote submits under its own identity:
// `{t:'cmd', cmd, voice:{intent}}` or `{t:'undo', undoId, voice:{intent}}`.
// The envelope holds the intent and nothing else: no transcript, heard word
// or audio ever rides on the relay socket (§3.6; the relay reads only the
// intent anyway, voicePolicy.js).
//
// The service's tier is advisory (voice-lab/src/v2/README.md). The tier
// spoken and shown here is the catalog's, which is the relay's own
// (voicePolicy.table.js is generated from the same catalog), and the relay
// still decides: Tier B comes back CONFIRM_REQUIRED (K10) and Tier C is
// refused VOICE_REFUSED with its touch-only words.
import { tripById } from '../demoTripList.js';
import { CODE } from '../twinProtocol.js';
import { FITZROY_POLICY } from './fitzroyCommand.js';
import { PLACES, SPOKEN } from './fitzroyCommands.js';

/** The remote shows voice only with `?voice=1` (nothing changes without it). */
export const voiceFlag = (search) =>
  new URLSearchParams(search || '').get('voice') === '1';

/** Words the remote says itself (templates; never generated). */
export const SAY = Object.freeze({
  notHeard: '',
  twoChanges: 'That was two changes. Say them one at a time.',
  questions: 'Questions are not on yet. Nothing changed.',
  routes: 'Routes come later. Nothing changed.',
  // The spoken yes waits for the speaker check (VOICE-CONTROL §3.1, A15):
  // until then a question is confirmed by touch, and "cancel" may be said.
  tapConfirm: 'Tap Confirm on the remote, or say cancel.',
  cancelled: 'Cancelled. Nothing changed.',
  muted: 'Voice muted. Unmute on the remote.',
  notController: 'This device is not in control. Nothing changed.',
  undone: 'Undone.',
  nothingUndone: 'Nothing undone.',
  notApplied: 'Not applied. Nothing changed.',
  unclear: "I didn't catch a command.",
});

/** Rules v2 refusals → the catalog's touch-only entry (its words). */
const REFUSE_ENTRY = Object.freeze({
  incidentAck: 'acknowledge_incident',
  visitorOff: 'visitor_off',
  simStormStart: 'start_demo',
  count: 'set_screen_count',
  report: 'report_incident',
});

const screenArg = (t) => (t === 'all' ? 'all' : String(t));

/** A demo place id (`sp-<site>-<suffix>`) → its catalog category. */
export function placeCategory(id) {
  if (typeof id !== 'string') return null;
  for (const [cat, suffix] of Object.entries(PLACES))
    if (id.endsWith(`-${suffix}`)) return cat;
  return null;
}

/**
 * The context the decision service reads (voice-lab/src/v2/README.md), from
 * this remote's own session state. o: {pending (the open question's words),
 * lastTarget (this remote's memory), reportOpen, nowMs, source}.
 */
export function voiceContext(state, o = {}) {
  const s = state?.session || {};
  const trip = tripById(s.tripId);
  const screens = Object.entries(state?.screens || {})
    .map(([slot, sc]) => ({
      slot: Number(slot),
      role: sc?.role || null,
      ...(sc?.pinned ? { pinned: true } : {}),
      ...(sc?.scale ? { scale: sc.scale } : {}),
    }))
    .sort((a, b) => a.slot - b.slot);
  return {
    trip: s.tripId || null,
    site: s.siteKey || trip?.city || null,
    screens,
    pending: o.pending || null,
    report: Boolean(o.reportOpen ?? s.report),
    visitor: Boolean(s.visitor),
    last_target: o.lastTarget || null,
    now: (o.nowMs ?? Date.now()) / 1000,
    source: o.source || 'remote',
  };
}

/** One change op → {name, args} for the catalog, or null. */
function callOf(d) {
  switch (d?.op) {
    case 'layer':
      return {
        name: 'set_screen_layer',
        args: { screen: screenArg(d.target), layer: d.key, on: d.on },
      };
    case 'text':
      return {
        name: 'step_screen_text',
        args: {
          screen: screenArg(d.target),
          direction: d.dir > 0 ? 'up' : 'down',
        },
      };
    case 'scale':
      return {
        name: 'set_screen_scale',
        args: { screen: screenArg(d.target), scale: d.value },
      };
    case 'role':
      return {
        name: 'set_screen_role',
        args: { screen: screenArg(d.target), role: d.value },
      };
    case 'pin':
      return { name: 'pin_screen', args: { screen: screenArg(d.target) } };
    case 'advance':
      return {
        name: 'set_screen_advance',
        args: {
          screen: screenArg(d.target),
          ...(d.day != null ? { day: d.day } : {}),
        },
      };
    case 'reset':
      return {
        name: 'reset_screen',
        args: { screen: screenArg(d.target ?? 'all') },
      };
    case 'spotlight':
      if (d.kind === 'person')
        return { name: 'spotlight_person', args: { person: d.id } };
      return { name: 'spotlight_place', args: { place: placeCategory(d.id) } };
    case 'wx':
      return d.minutes == null
        ? { name: 'set_weather_now', args: {} }
        : { name: 'set_weather_time', args: { minutes: d.minutes } };
    case 'trip':
      return { name: 'switch_trip', args: { trip: d.id } };
    case 'site':
      return { name: 'go_to_site', args: { site: d.key } };
    case 'returnLive':
      return { name: 'return_all_live', args: {} };
    case 'visitor':
      return d.on === true ? { name: 'visitor_on', args: {} } : null;
    case 'simStorm':
      return d.on === false
        ? { name: 'stop_demo', args: { hazard: 'storm' } }
        : null;
    case 'undo':
      return { name: 'undo_last', args: {} };
    default:
      return null;
  }
}

/**
 * A decision → what kind of turn it is. kind: 'calls' ({calls}), 'touch'
 * ({intent, say}), 'question' (a question back), 'control' ({control:
 * 'yes'|'no'|'notYes'|'stop'|'mute'}), 'later' (V2 answers, V4 routes) or
 * 'none'.
 */
export function callsFor(decision, readback = '') {
  const d = decision && typeof decision === 'object' ? decision : {};
  if ('refuse' in d) {
    const intent = REFUSE_ENTRY[d.refuse] || 'remote_only';
    return {
      kind: 'touch',
      intent,
      say: FITZROY_POLICY.get(intent)?.refusal?.say || 'Touch only.',
    };
  }
  if ('ask' in d)
    return { kind: 'question', say: readback || 'Say that again?' };
  if ('ctl' in d) return { kind: 'control', control: d.ctl };
  if ('answer' in d) return { kind: 'later', say: SAY.questions };
  if (d.none) return { kind: 'none', say: d.question ? SAY.questions : '' };
  if (d.op === 'voiceMute') return { kind: 'control', control: 'mute' };
  if (d.op === 'route') return { kind: 'later', say: SAY.routes };
  const ops = d.op === 'multi' ? (d.ops || []).slice(0, 2) : [d];
  const calls = ops.map(callOf);
  if (!calls.length || calls.some((c) => !c))
    return { kind: 'question', say: SAY.unclear };
  return { kind: 'calls', calls };
}

/**
 * The relay message for a proposal, exactly as the catalog built it; the
 * envelope keeps the intent only. null when there is nothing to send.
 */
export function voiceMessage(proposal) {
  const m = proposal?.message;
  if (!m || typeof m.voice?.intent !== 'string') return null;
  const voice = { intent: m.voice.intent };
  if (m.t === 'undo') return { t: 'undo', undoId: m.undoId, voice };
  if (m.t === 'cmd' && m.cmd && typeof m.cmd === 'object')
    return { t: 'cmd', cmd: JSON.parse(JSON.stringify(m.cmd)), voice };
  return null;
}

/**
 * Plan one turn: the decision through the catalog. → {kind, proposals,
 * say, intent?, control?, tier}. kind: 'act' | 'ask' (Tier B: the relay
 * asks) | 'touch' (Tier C) | 'refused' (the guard said why) | 'undo' |
 * 'question' | 'control' | 'later' | 'none'. Nothing is sent here.
 */
export async function planTurn(catalog, turn) {
  const c = callsFor(turn?.decision, turn?.readback);
  if (c.kind === 'touch') return { ...c, tier: 'C', proposals: [] };
  if (c.kind !== 'calls')
    return { ...c, tier: c.kind === 'question' ? 'Q' : '-', proposals: [] };
  const proposals = [];
  for (const call of c.calls)
    proposals.push(await catalog.propose(call.name, call.args));
  if (proposals.length > 1) {
    // Two changes in one sentence: both, when each acts on its own (rules
    // v2); otherwise neither, and say so (never one silently).
    if (!proposals.every((p) => p.tier === 'act' && voiceMessage(p)))
      return {
        kind: 'question',
        tier: 'Q',
        say: SAY.twoChanges,
        proposals: [],
      };
    return {
      kind: 'act',
      tier: 'A',
      proposals,
      say: proposals.map((p) => p.readBack).join(' '),
    };
  }
  const p = proposals[0];
  if (!voiceMessage(p))
    return {
      kind: p.tier === 'touch' ? 'touch' : 'refused',
      tier: p.tier === 'touch' ? 'C' : '-',
      intent: p.name,
      say: p.say || SAY.notApplied,
      proposals,
    };
  if (p.message.t === 'undo')
    return { kind: 'undo', tier: 'A', proposals, say: SAY.undone };
  return p.tier === 'ask'
    ? { kind: 'ask', tier: 'B', proposals, say: p.question || p.say }
    : { kind: 'act', tier: 'A', proposals, say: p.readBack || p.say };
}

/**
 * What Fitzroy says once the relay has answered a submitted proposal. r:
 * the ack (or undefined when the page sent nothing).
 */
export function sayAfter(plan, proposal, r) {
  if (!r) return SAY.notController;
  if (r.code === CODE.CONFIRM_REQUIRED)
    return proposal?.question || r.question?.text || SAY.notApplied;
  if (r.code === CODE.VOICE_REFUSED) return r.error || SAY.notApplied;
  if (!r.ok) return r.error || SAY.notApplied;
  if (plan?.kind === 'undo')
    return r.restored?.length ? SAY.undone : SAY.nothingUndone;
  return proposal?.readBack || proposal?.say || '';
}

/** The words for a control word, given whether a question is open. */
export function controlSay(control, { pending = false } = {}) {
  switch (control) {
    case 'yes':
      // Nothing pending from this device: no effect, no reply (card 37).
      return pending ? SAY.tapConfirm : '';
    case 'no':
      return pending ? SAY.cancelled : '';
    case 'notYes':
      return pending ? SAY.tapConfirm : '';
    case 'mute':
      return SAY.muted;
    default:
      return '';
  }
}

/**
 * The catalog's twin service for this remote (fitzroyCatalog.js
 * createFitzroyCatalog): the session state, the trip's names, and this
 * device's last voice change for undo. src: {state(), now(), lastUndo(),
 * incidentOpen(), tripDays(), snapshot()} where snapshot() is the trip's
 * demo snapshot (participants, safety_points) or null.
 */
export function remoteTwin(src) {
  const people = () => src.snapshot()?.participants || [];
  const places = () => src.snapshot()?.safety_points || [];
  return {
    state: src.state,
    now: src.now,
    lastUndo: src.lastUndo,
    incidentOpen: src.incidentOpen,
    tripDays: src.tripDays,
    reportedFloor: () => src.state()?.session?.report?.floor ?? null,
    names: {
      person: (id) => {
        const p = people().find((x) => x.id === id);
        return p
          ? p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim()
          : null;
      },
      place: (id) => places().find((x) => x.id === id)?.name || null,
      placeWord: (id) => {
        const p = places().find((x) => x.id === id);
        return p ? SPOKEN.place[p.category] || null : null;
      },
    },
  };
}
