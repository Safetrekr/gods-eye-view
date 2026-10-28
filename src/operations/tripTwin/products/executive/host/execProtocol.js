// SafeTrekr Executive: the executive relay's wire names and checks (EP-35
// §7, EP-33 §§1, 7). Pure: shared by the relay seam (loopHost.js), the
// diagnostic page and the phone page. The school protocol (twinProtocol.js,
// PROTO 6) is not changed: every name here is spoken only when the relay
// runs with TRIP_TWIN_PRODUCT=executive, and a school page never sees one
// (old pages ignore an unknown message type).
//
// Inbound (page → relay), executive mode only:
//   {t:'hello', kind:'phone', id, proto, participant_id?, ticket?, token?}
//   {t:'hello', kind:'monitor', id, proto}         this computer only
//   {t:'phone-cmd', reqId, cmd:{type, …}}           kind phone only
//   {t:'loop-cmd',  reqId, cmd:{type, …}}           the remote in control
//   {t:'hello', kind:'desk', id, proto}             this computer only (B4)
//   {t:'desk-cmd', reqId, as, cmd:{type, …}}        the desk: `as` VALE or
//                                                   ORTEGA (the visible
//                                                   supervisor switch)
// Outbound (relay → page):
//   {t:'welcome', type:'phone'|'monitor', …}        accepted hello
//   {t:'loop', view:'loop'|'main'|'phone', rev, clock, loop|main|phone}
//   {t:'loop-clock', clock}                         the clock, every second
//   {t:'loop-role', slot, role}                     a wall's executive role,
//                                                   when it joins or changes (B3)
//   {t:'loop', view:'desk', …, loop, desk, undo}     the desk's view (B4)
//   {t:'loop-ack', reqId, ok, code?, error?, ask?, ticket?, events?}
import { CODE, DENY } from '../../../twinProtocol.js';
import {
  CLOSE_REASONS,
  DECISIONS,
  DL_ANSWERS,
  LOOP_ACTIONS,
  PHONE_EVENTS,
  PRESENTER_EVENTS,
  PROTECTIONS,
  REOPEN_REASONS,
  RUNGS,
  lowersSupervision,
} from '../loop/loopPolicy.js';

/** The executive sub-protocol, beside PROTO (which stays 6). */
export const EXEC_PROTO = 1;

/** Device kinds the executive relay adds (the session host never sees them). */
export const EXEC_KINDS = Object.freeze(['phone', 'monitor', 'desk']);

/** Messages the executive relay adds. */
export const EXEC_MSG = Object.freeze({
  PHONE_CMD: 'phone-cmd',
  LOOP_CMD: 'loop-cmd',
  LOOP: 'loop',
  CLOCK: 'loop-clock',
  ACK: 'loop-ack',
  ROLE: 'loop-role',
  DESK_CMD: 'desk-cmd',
});

/**
 * Executive wall roles in slot order (EP-35 §6, EP-50 B3). The session's
 * own screen role stays a school role (screenDefaults maps any other key
 * to 'site'), so the executive role of a slot is held by the loop host.
 */
export const EXEC_ROLE_ORDER = Object.freeze([
  'main',
  'verify',
  'intel',
  'roster',
  'principal',
  'trips',
]);

/** Refusal codes the executive relay adds (the reducer's own are in twinLoop.js CODES). */
export const EXEC_CODE = Object.freeze({
  NOT_PHONE: 'NOT_PHONE',
  NOT_PHONE_EVENT: 'NOT_PHONE_EVENT',
  I10_NOT_BOUND: 'I10_NOT_BOUND',
  NOT_PRESENTER: 'NOT_PRESENTER',
  NOT_REMOTE: 'NOT_REMOTE',
  BAD_RATE: 'BAD_RATE',
  BAD_BEAT: 'BAD_BEAT',
  NO_CHECKPOINT: 'NO_CHECKPOINT',
  I12_TIME: 'I12_TIME',
  UNKNOWN_PERSON: 'UNKNOWN_PERSON',
  BAD_ROLE: 'BAD_ROLE',
  LOCAL_ONLY: 'LOCAL_ONLY',
  // B4: the desk and the presenter's shortcuts.
  NOT_DESK: 'NOT_DESK',
  BAD_AS: 'BAD_AS',
  WRONG_BEAT: 'WRONG_BEAT',
  NOT_PENDING: 'NOT_PENDING',
  UNDO_EXPIRED: 'UNDO_EXPIRED',
  NOT_UNDOABLE: 'NOT_UNDOABLE',
  BAD_MODE: 'BAD_MODE',
  // Shared with the school protocol (same words, same meaning).
  VALIDATION_COMMAND: CODE.VALIDATION_COMMAND,
  RATE_LIMITED: CODE.RATE_LIMITED,
  LEASE_NOT_CONTROLLER: CODE.LEASE_NOT_CONTROLLER,
  CONFIRM_REQUIRED: CODE.CONFIRM_REQUIRED,
  CONFIRM_UNKNOWN: CODE.CONFIRM_UNKNOWN,
  CONFIRM_NOT_YOURS: CODE.CONFIRM_NOT_YOURS,
  CONFIRM_STALE: CODE.CONFIRM_STALE,
});

/** Hello refusals for phones (the school DENY words where they fit). */
export const PHONE_DENY = Object.freeze({
  NO_ID: DENY.NO_ID,
  NOT_TRUSTED: DENY.NOT_TRUSTED,
  TICKET_EXPIRED: DENY.TICKET_EXPIRED,
  ID_IN_USE: DENY.ID_IN_USE,
  I10_NOT_BOUND: 'I10_NOT_BOUND',
  UNKNOWN_PERSON: 'UNKNOWN_PERSON',
});

/** The clock rates a presenter may pick (EP-33 §7). */
export const RATES = Object.freeze([1, 10, 60]);

/**
 * Presenter commands (EP-33 §7), the iPad's only way into the loop. `tier`
 * follows LOOP_ACTIONS: act, or ask first (one closed question, 10 s).
 * `event` names the reducer event the command becomes, when it is one.
 */
export const PRESENTER_CMDS = Object.freeze({
  'clock.start': { tier: 'act', event: 'clock.start' },
  'clock.pause': { tier: 'act', event: 'clock.pause' },
  'clock.resume': { tier: 'act', event: 'clock.resume' },
  'clock.rate': { tier: 'act', event: 'clock.start' },
  'clock.jump': { tier: 'act', event: 'clock.jump' },
  'clock.auto': { tier: 'act', event: null },
  'beat.go': { tier: 'act', event: 'beat.go', backward: 'ask' },
  next: { tier: 'act', event: 'beat.go' },
  previous: { tier: 'ask', event: 'reset' },
  reset: { tier: LOOP_ACTIONS.reset.tier, event: 'reset' },
  confirm: { tier: 'act', event: null },
  cancel: { tier: 'act', event: null },
  // Room setup, not loop decisions: which executive role a wall shows, and
  // a pairing ticket for one participant's phone.
  'wall.role': { tier: 'act', event: null },
  'phone.ticket': { tier: 'act', event: null },
  // EP-38 #8: the only two loop decisions the iPad may cause, each at its
  // own beat, ask first, and only while ORTEGA's scripted event is still
  // to come. The host sends ORTEGA's scripted event at the current sim
  // time (via 'presenter', audited); at any other beat it is refused.
  'ortega.countersign': {
    tier: 'ask',
    event: 'verification.countersign',
    as: 'ORTEGA',
    beat: 2,
  },
  'ortega.retier': {
    tier: 'ask',
    event: 'posture.retier',
    as: 'ORTEGA',
    beat: 3,
  },
  // EP-38 #12: scripted phone replies fire on time, or wait for a tap.
  'phones.mode': { tier: 'act', event: null },
});

/** The presenter's ORTEGA shortcuts (EP-38 #8), from PRESENTER_CMDS. */
export const SHORTCUTS = Object.freeze(
  Object.fromEntries(
    Object.entries(PRESENTER_CMDS).filter(([, row]) => row.as === 'ORTEGA'),
  ),
);
/** Phone modes (EP-38 #12). */
export const PHONE_MODES = Object.freeze(['scripted', 'live']);

/**
 * The room preset (B4): when a room is set up, the host gives each slot
 * its executive role, the school session role its wall is built on
 * (EP-51: site for MAIN and Principal, trips for the flat walls), the
 * school layers the 3D walls draw and MAIN's room text scale.
 */
export const SITE_LAYERS = Object.freeze({
  paths: false,
  savedPaths: false,
  avoidAreas: false,
  corridors: false,
  safety: false,
  floors: false,
  streetPhoto: false,
  streets: true,
  walkways: true,
});
export const MAIN_TEXT_SCALE = 2;
/** The school session patch a wall of this executive role needs. */
export function sessionPatchFor(exRole) {
  if (exRole === 'main')
    return {
      role: 'site',
      layers: { ...SITE_LAYERS },
      textScale: MAIN_TEXT_SCALE,
    };
  if (exRole === 'principal')
    return { role: 'site', layers: { ...SITE_LAYERS } };
  return { role: 'trips' };
}
/** [{slot, role, patch}] for a room of `count` walls, in slot order. */
export function roomPreset(count = 6) {
  const n = Math.max(1, Math.min(6, Math.round(Number(count) || 1)));
  return EXEC_ROLE_ORDER.slice(0, n).map((role, i) => ({
    slot: i + 1,
    role,
    patch: sessionPatchFor(role),
  }));
}

/** An ask-first question lives this long (Fitzroy's 10 s). */
export const ASK_MS = 10_000;
/** A phone pairing ticket lives this long, and is used once. */
export const PHONE_TICKET_MS = 10 * 60e3;

/**
 * What one socket may receive of the loop (EP-35 §7, I3): a phone its own
 * selection, a wall in role `main` selectMain only, other walls, remotes
 * and this computer's monitor the loop; a launcher nothing (SEC-7).
 */
export function viewFor({ kind, role = null }) {
  if (kind === 'phone') return 'phone';
  if (kind === 'desk') return 'desk';
  if (kind === 'screen') return role === 'main' ? 'main' : 'loop';
  if (kind === 'remote' || kind === 'monitor') return 'loop';
  return null;
}

/** The executive role of a slot: an override, else the slot order. */
export function roleOfSlot(slot, overrides = {}) {
  const n = Number(slot);
  if (!Number.isInteger(n) || n < 1 || n > 6) return 'main';
  return overrides[n] ?? EXEC_ROLE_ORDER[n - 1];
}

// ------------------------------------------------------------ phone events

const ID_RE = /^[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/;
const CTRL = /[\u0000-\u001f\u007f]/;
const kinds = {
  id: (v) =>
    typeof v === 'string' && v.length <= 64 && ID_RE.test(v) ? v : undefined,
  word: (v) =>
    typeof v === 'string' && v.length <= 40 && !CTRL.test(v) ? v : undefined,
  text: (v) =>
    typeof v === 'string' && v.length <= 280 && !CTRL.test(v) ? v : undefined,
  bool: (v) => (typeof v === 'boolean' ? v : undefined),
  iso: (v) => (typeof v === 'string' && ISO_RE.test(v) ? v : undefined),
  oneOf: (list) => (v) => (list.includes(v) ? v : undefined),
  place: (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {};
    if (kinds.text(v.name)) out.name = v.name;
    for (const k of ['lat', 'lon', 'accuracy_m'])
      if (typeof v[k] === 'number' && Number.isFinite(v[k])) out[k] = v[k];
    if (['point', 'area', 'region'].includes(v.precision))
      out.precision = v.precision;
    return Object.keys(out).length ? out : undefined;
  },
  agents: (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {};
    for (const [k, x] of Object.entries(v).slice(0, 12))
      if (kinds.id(k) && kinds.word(x)) out[k] = x;
    return out;
  },
};

/**
 * The fields a phone may send per event (EP-35 §1). Anything else is
 * dropped; actor fields, `at`, `device` and `id` are refused: the relay
 * stamps who, when and which device, never the page.
 */
export const PHONE_FIELDS = Object.freeze({
  ack: {
    push_id: kinds.id,
    sit_id: kinds.id,
    rung: kinds.oneOf(RUNGS),
    source: kinds.oneOf(['app open', 'reply word', 'reply']),
    reply_word: kinds.word,
  },
  'dl.respond': {
    push_id: kinds.id,
    sit_id: kinds.id,
    answer: kinds.oneOf(DL_ANSWERS),
    reason: kinds.text,
    plan: kinds.text,
    principal_informed: kinds.bool,
  },
  'salute.file': {
    sit_id: kinds.id,
    size: kinds.text,
    activity: kinds.text,
    unit: kinds.text,
    equipment: kinds.text,
    time: kinds.iso,
    location: kinds.place,
  },
  'checkin.respond': {
    status: kinds.word,
    text: kinds.text,
    point: kinds.id,
    kind: kinds.oneOf(['checkin', 'comms_check']),
    detail_id: kinds.id,
    agents: kinds.agents,
    push_id: kinds.id,
    sit_id: kinds.id,
  },
  'sharing.set': {
    on: kinds.bool,
    state: kinds.oneOf(['sharing_on', 'check_in_only', 'paused']),
  },
});

/** Never from a page, inside the event (S-18's rule, here for phones). */
export const STAMPED_FIELDS = Object.freeze([
  'by',
  'via',
  'name',
  'actor',
  'ref',
  'proposalId',
  'at',
  'id',
  'device',
]);

/**
 * A phone's command, checked against the device's bound participant (I10).
 * → {event} (fields only; the relay stamps id, at, by, via, device) or
 *   {code}. Pure.
 */
export function phoneEvent(cmd, bound) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd))
    return { code: EXEC_CODE.VALIDATION_COMMAND };
  if (!PHONE_EVENTS.includes(cmd.type))
    return { code: EXEC_CODE.NOT_PHONE_EVENT };
  for (const k of STAMPED_FIELDS)
    if (Object.hasOwn(cmd, k)) return { code: EXEC_CODE.VALIDATION_COMMAND };
  // I10: a phone speaks for its bound participant only.
  for (const k of ['participant_id', 'person_id'])
    if (cmd[k] != null && cmd[k] !== bound)
      return { code: EXEC_CODE.I10_NOT_BOUND };
  const spec = PHONE_FIELDS[cmd.type];
  const event = { type: cmd.type };
  for (const [k, f] of Object.entries(spec)) {
    if (!Object.hasOwn(cmd, k)) continue;
    const v = f(cmd[k]);
    if (v === undefined) return { code: EXEC_CODE.VALIDATION_COMMAND };
    event[k] = v;
  }
  if (cmd.type === 'ack' || cmd.type === 'dl.respond')
    event.participant_id = bound;
  else event.person_id = bound;
  return { event };
}

// ------------------------------------------------------------ presenter

/**
 * A presenter command from the remote. → {cmd} (normalised) or {code}.
 * A loop decision (anything the desk or a phone does) is refused here, so
 * the iPad can never verify, push, re-tier or answer (EP-33 §1).
 */
export function presenterCmd(cmd) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd))
    return { code: EXEC_CODE.VALIDATION_COMMAND };
  const type = cmd.type;
  if (!Object.hasOwn(PRESENTER_CMDS, type)) {
    const why = LOOP_ACTIONS[type]
      ? lowersSupervision({ type }, { from: 'presenter' })
      : null;
    return {
      code: EXEC_CODE.NOT_PRESENTER,
      reason: why || 'not a presenter command',
    };
  }
  for (const k of STAMPED_FIELDS)
    if (k !== 'id' && Object.hasOwn(cmd, k))
      return { code: EXEC_CODE.VALIDATION_COMMAND };
  const out = { type };
  if (type === 'clock.start' || type === 'clock.rate') {
    if (cmd.rate != null || type === 'clock.rate') {
      if (!RATES.includes(cmd.rate)) return { code: EXEC_CODE.BAD_RATE };
      out.rate = cmd.rate;
    }
    if (cmd.auto != null) {
      if (typeof cmd.auto !== 'boolean')
        return { code: EXEC_CODE.VALIDATION_COMMAND };
      out.auto = cmd.auto;
    }
  }
  if (type === 'clock.auto') {
    if (typeof cmd.on !== 'boolean')
      return { code: EXEC_CODE.VALIDATION_COMMAND };
    out.on = cmd.on;
  }
  if (type === 'clock.jump') {
    if (!kinds.iso(cmd.to)) return { code: EXEC_CODE.VALIDATION_COMMAND };
    out.to = cmd.to;
  }
  if (type === 'beat.go') {
    if (!Number.isInteger(cmd.n) || cmd.n < 0 || cmd.n > 9)
      return { code: EXEC_CODE.BAD_BEAT };
    out.n = cmd.n;
  }
  if (type === 'confirm' || type === 'cancel') {
    if (typeof cmd.id !== 'string' || !/^[0-9a-f]{8,32}$/.test(cmd.id))
      return { code: EXEC_CODE.CONFIRM_UNKNOWN };
    out.id = cmd.id;
  }
  if (type === 'wall.role') {
    const slot = Number(cmd.slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > 6)
      return { code: EXEC_CODE.VALIDATION_COMMAND };
    if (!EXEC_ROLE_ORDER.includes(cmd.role))
      return { code: EXEC_CODE.BAD_ROLE };
    out.slot = slot;
    out.role = cmd.role;
  }
  if (type === 'phone.ticket') {
    if (!kinds.id(cmd.participant_id))
      return { code: EXEC_CODE.VALIDATION_COMMAND };
    out.participant_id = cmd.participant_id;
  }
  if (type === 'phones.mode') {
    if (!PHONE_MODES.includes(cmd.mode)) return { code: EXEC_CODE.BAD_MODE };
    out.mode = cmd.mode;
  }
  return { cmd: out };
}

// ------------------------------------------------------------ the desk

/** Who the desk acts as: the analyst, or the supervisor by the visible switch. */
export const DESK_AS = Object.freeze(['VALE', 'ORTEGA']);
const grade = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const source = String(v.source || '');
  const info = Number(v.info);
  return /^[A-F]$/.test(source) &&
    Number.isInteger(info) &&
    info >= 1 &&
    info <= 6
    ? { source, info }
    : undefined;
};
const step = (v) => (Number.isInteger(v) && v >= 1 && v <= 6 ? v : undefined);

/**
 * What the desk may send (EP-31 §3, EP-33 §§1–3, EP-34 §4): the intent
 * only. The host stamps id, at, by and via, picks the scripted event it
 * pre-empts (its ids, drafts and payload), and names what a reversal
 * reverses; the page never does.
 */
export const DESK_FIELDS = Object.freeze({
  'intel.dismiss': { bundle_id: kinds.id, reason: kinds.text },
  'intel.watch': { bundle_id: kinds.id, reason: kinds.text },
  'intel.restore': { bundle_id: kinds.id },
  'verification.decide': {
    sit_id: kinds.id,
    decision: kinds.oneOf(Object.keys(DECISIONS)),
    grade,
    note: kinds.text,
  },
  'verification.countersign': { sit_id: kinds.id },
  'verification.reopen': { sit_id: kinds.id },
  'notify.send': { sit_id: kinds.id },
  'recommendation.edit': { recommendation_id: kinds.id, bluf: kinds.text },
  'recommendation.approve': { recommendation_id: kinds.id },
  'push.send': { recommendation_id: kinds.id, supersede: kinds.bool },
  'push.recall': { push_id: kinds.id, reason: kinds.text },
  'message.send': { sit_id: kinds.id, to: kinds.id, text: kinds.text },
  'callback.step': { push_id: kinds.id, step, outcome: kinds.word },
  'posture.retier': {
    person_id: kinds.id,
    to: kinds.oneOf(PROTECTIONS),
    reason: kinds.text,
    back: kinds.bool,
  },
  'sitrep.sign': { sit_id: kinds.id, sitrep_id: kinds.id, close: kinds.bool },
  'situation.close': { sit_id: kinds.id, reason: kinds.oneOf(CLOSE_REASONS) },
  'situation.reopen': {
    sit_id: kinds.id,
    reason: kinds.oneOf(REOPEN_REASONS),
  },
  undo: {},
});
/** Never from the desk page either: the host decides these. */
export const HOST_FIELDS = Object.freeze([
  ...STAMPED_FIELDS,
  'reverses',
  'preempts',
  'supersedes',
  'push_id_new',
  'version',
]);

/** A desk command → {cmd} (normalised, fields only) or {code}. Pure. */
export function deskCmd(cmd, as) {
  if (!DESK_AS.includes(as)) return { code: EXEC_CODE.BAD_AS };
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd))
    return { code: EXEC_CODE.VALIDATION_COMMAND };
  if (!Object.hasOwn(DESK_FIELDS, cmd.type))
    return {
      code:
        PHONE_EVENTS.includes(cmd.type) || PRESENTER_EVENTS.includes(cmd.type)
          ? EXEC_CODE.NOT_DESK
          : EXEC_CODE.VALIDATION_COMMAND,
    };
  for (const k of HOST_FIELDS)
    if (Object.hasOwn(cmd, k)) return { code: EXEC_CODE.VALIDATION_COMMAND };
  const out = { type: cmd.type };
  for (const [k, f] of Object.entries(DESK_FIELDS[cmd.type])) {
    if (!Object.hasOwn(cmd, k)) continue;
    const v = f(cmd[k]);
    if (v === undefined) return { code: EXEC_CODE.VALIDATION_COMMAND };
    out[k] = v;
  }
  return { cmd: out };
}

/** True for a reducer event the presenter may cause (PRESENTER_EVENTS). */
export const presenterEvent = (type) => PRESENTER_EVENTS.includes(type);

/** `SAMPLE · accelerated ×10` (EP-33 §7); `SAMPLE` at ×1. */
export function clockLabel(rate) {
  return Number(rate) > 1 ? `SAMPLE · accelerated ×${rate}` : 'SAMPLE';
}
