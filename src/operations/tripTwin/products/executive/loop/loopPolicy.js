// SafeTrekr Executive: who may do what in the loop, as data (EP-33 §1 the
// delegation tiers; EP-37 §§1, 4–7 the per-protection authority), merged
// into one file per EP-38. Pure. The reducer (twinLoop.js) asks this file;
// it never decides on its own who may act.
//
// One rule, enforced in data (EP-33): the system matches, counts, drafts
// and times. A named human verifies, countersigns, pushes, re-tiers,
// reverses and closes.

/** Roles an actor (`by`) resolves to. */
export const ROLES = Object.freeze([
  'generator',
  'analyst',
  'supervisor',
  'person',
  'presenter',
]);

/**
 * One row per loop event: who may emit it and its tier (EP-33 §1: act,
 * ask first, desk only; `system` for the generator's own events).
 */
export const LOOP_ACTIONS = Object.freeze({
  'intel.received': { who: ['generator'], tier: 'system' },
  'intel.raise': { who: ['generator'], tier: 'system' },
  'position.fix': { who: ['generator'], tier: 'system' },
  'leg.changed': { who: ['generator', 'analyst'], tier: 'system' },
  'checkin.due': { who: ['generator'], tier: 'system' },
  'comms.due': { who: ['generator'], tier: 'system' },
  'comms.overdue': { who: ['generator'], tier: 'system' },
  'recommendation.draft': { who: ['generator', 'analyst'], tier: 'system' },
  'sitrep.draft': { who: ['generator', 'analyst'], tier: 'system' },
  'intel.dismiss': {
    who: ['analyst', 'supervisor'],
    tier: 'act',
    undo: 'restore',
  },
  'intel.watch': { who: ['analyst', 'supervisor'], tier: 'act' },
  'verification.decide': { who: ['analyst', 'supervisor'], tier: 'act' },
  'verification.countersign': { who: ['supervisor'], tier: 'ask' },
  'notify.send': { who: ['analyst', 'supervisor'], tier: 'ask' },
  'recommendation.edit': { who: ['analyst', 'supervisor'], tier: 'ask' },
  'recommendation.approve': { who: ['analyst', 'supervisor'], tier: 'ask' },
  'push.send': { who: ['analyst'], tier: 'ask', undo: 'recall / supersede' },
  'message.send': { who: ['analyst', 'supervisor'], tier: 'act' },
  'callback.step': { who: ['analyst', 'supervisor'], tier: 'act' },
  'posture.retier': { who: ['supervisor'], tier: 'desk' },
  'sitrep.sign': {
    who: ['analyst', 'supervisor'],
    tier: 'ask',
    undo: 'reopen',
  },
  'situation.close': {
    who: ['analyst', 'supervisor'],
    tier: 'ask',
    undo: 'reopen',
  },
  ack: { who: ['person', 'generator'], tier: 'act' },
  'dl.respond': { who: ['person'], tier: 'act' },
  'salute.file': { who: ['person'], tier: 'act' },
  'checkin.respond': { who: ['person'], tier: 'act' },
  'sharing.set': { who: ['person'], tier: 'act' },
  'clock.start': { who: ['presenter'], tier: 'act' },
  'clock.pause': { who: ['presenter'], tier: 'act' },
  'clock.resume': { who: ['presenter'], tier: 'act' },
  'clock.jump': { who: ['presenter', 'generator'], tier: 'act' },
  'beat.go': { who: ['presenter'], tier: 'act' },
  reset: { who: ['presenter'], tier: 'ask' },
});

/** The only events a phone may send (EP-35 §7). */
export const PHONE_EVENTS = Object.freeze([
  'ack',
  'dl.respond',
  'salute.file',
  'checkin.respond',
  'sharing.set',
]);
/** The only events the presenter or a voice command may send (EP-35 §8). */
export const PRESENTER_EVENTS = Object.freeze([
  'clock.start',
  'clock.pause',
  'clock.resume',
  'clock.jump',
  'beat.go',
  'reset',
]);

/** EP-37 §1 and EP-35 §6: per protection level. */
export const AUTHORITY = Object.freeze({
  DETAIL: Object.freeze({
    tier: 1,
    decides: 'detail leader',
    push: 'recommendation',
    verifyBy: 'analyst+supervisor',
    closeBy: 'detail leader stand-down, then the analyst',
    readTimeoutMin: 5,
    pushSlaMin: 5,
    verbs: ['Recommend', 'Request'],
  }),
  REMOTE: Object.freeze({
    tier: 2,
    decides: 'watch',
    push: 'instruction',
    verifyBy: 'analyst',
    closeBy: 'analyst, on position or reply',
    readTimeoutMin: 10,
    pushSlaMin: 10,
  }),
  MONITORED: Object.freeze({
    tier: 3,
    decides: 'person',
    push: 'advisory',
    verifyBy: 'analyst',
    closeBy: 'analyst, on check-in',
    readTimeoutMin: 30,
    pushSlaMin: 30,
  }),
});
export const TIERS = AUTHORITY;
export const PROTECTIONS = Object.freeze(Object.keys(AUTHORITY));

/**
 * What a re-tier changes (EP-37 §6); the event's own `effects` win. The
 * watch radius widens the reach of every leg of the person; sharing is
 * only requested: the person turns it on (EP-38, consent).
 */
export const RETIER_EFFECTS = Object.freeze({
  DETAIL: Object.freeze({
    watch_radius_m: null,
    checkin_every_min: null,
    read_timeout_min: 5,
    sharing: 'requested',
  }),
  REMOTE: Object.freeze({
    watch_radius_m: 3000,
    checkin_every_min: 120,
    read_timeout_min: 10,
    sharing: 'requested',
  }),
  MONITORED: Object.freeze({
    watch_radius_m: 1000,
    checkin_every_min: null,
    read_timeout_min: 30,
    sharing: null,
  }),
});

export const readTimeoutMin = (protection) =>
  AUTHORITY[protection]?.readTimeoutMin ?? 10;

/** Verification decisions, with the state each one sets (EP-35 §1). */
export const DECISIONS = Object.freeze({
  verified: 'VERIFIED',
  unconfirmed_actionable: 'UNCONFIRMED',
  watch: 'WATCH',
  dismissed: 'DISMISSED',
});
/** Decisions a push may rest on (I1). */
export const PUSHABLE = Object.freeze(['verified', 'unconfirmed_actionable']);
export const ACTIONS = Object.freeze([
  'advisory',
  'confirm_safe',
  'hold',
  'reroute',
  'move',
  'shelter',
  'evacuate',
  'no_change',
]);
export const DL_ANSWERS = Object.freeze([
  'concur',
  'nonconcur',
  'executing',
  'request_support',
]);
export const CLOSE_REASONS = Object.freeze([
  'clear',
  'stand_down',
  'expired',
  'dismissed',
  'superseded',
]);
export const RUNGS = Object.freeze(['delivered', 'read', 'accepted', 'done']);

/**
 * The raise rule after a hit (EP-35 §3): DETAIL raises P1–P3 and every
 * mention; REMOTE raises P1–P2 (P3 → watch; P3 raised when ELEVATED, as
 * the roster's protection rules say); MONITORED raises P1, and a
 * hazard-area P2 as an advisory. A duplicate never raises.
 * → 'raise' | 'advisory' | 'watch' | null
 */
export function raiseFor(person, bundle) {
  if (!person || bundle.duplicate_of) return null;
  const p = Number(String(bundle.operational_priority || 'P4').slice(1));
  const mention = bundle.source_kind === 'mention';
  switch (person.protection) {
    case 'DETAIL':
      return p <= 3 || mention ? 'raise' : null;
    case 'REMOTE':
      if (p <= 2) return 'raise';
      if (p === 3) return person.posture === 'ELEVATED' ? 'raise' : 'watch';
      return null;
    case 'MONITORED':
      if (p === 1) return 'raise';
      if (p === 2 && bundle.hazard_area) return 'advisory';
      return null;
    default:
      return null;
  }
}

/** The role behind an actor ref: watch callsign, participant, generator. */
export function actorRole(loop, by) {
  if (by === 'generator') return 'generator';
  if (by === 'presenter') return 'presenter';
  const staff = loop.watch?.[by];
  if (staff) return staff.role;
  if (loop.people?.[by]) return 'person';
  return null;
}

/** May this role emit this event type? */
export function allowed(type, role) {
  const row = LOOP_ACTIONS[type];
  return Boolean(row && role && row.who.includes(role));
}

/**
 * EP-33 §1's "never less supervised", fails closed: the reason an event
 * would lower supervision, or null. The reducer checks the invariants in
 * full; this is the quick screen a host runs before it forwards an event
 * from a remote, a voice command or a phone.
 */
export function lowersSupervision(ev, { from = 'desk' } = {}) {
  if (!ev || !LOOP_ACTIONS[ev.type]) return 'unknown event';
  if (
    (from === 'presenter' || from === 'voice') &&
    !PRESENTER_EVENTS.includes(ev.type)
  )
    return 'loop action from the presenter';
  if (from === 'phone' && !PHONE_EVENTS.includes(ev.type))
    return 'not a phone event';
  if (ev.type === 'push.send' && !ev.recommendation_id)
    return 'push without a recommendation';
  if (ev.type === 'posture.retier' && !String(ev.reason || '').trim())
    return 're-tier without a reason';
  return null;
}
