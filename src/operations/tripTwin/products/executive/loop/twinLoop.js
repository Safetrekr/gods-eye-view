// SafeTrekr Executive: the loop as one pure reducer (EP-35 §1).
//   createLoop({fixtures, t0})      → loop
//   applyLoopEvent(loop, ev)        → {loop, changed, refused?}
// No Date.now(), no randomness: every event carries `at` (sim time, ISO
// UTC) and `by` (VALE, ORTEGA, a participant id, generator, presenter).
// Same discipline as twinSession.applyCommand: a new state per accepted
// event, rev + 1, `meta {rev, by, at}` on every record written; a refusal
// returns a code and changes nothing (the input object is never touched).
// Records are copied on write, so a fold over the day stays fast.
//
// Time-driven effects (I8 expiry, I9 call-back opening, the comms-check
// overdue band) are applied at the next event ("on the next tick"), each
// stamped with its own due time, so replay from any point is identical.
import { STALE_AFTER_H, insideWhere, matchLegs } from './match.js';
import {
  CLOSE_REASONS,
  DECISIONS,
  DL_ANSWERS,
  MAY_REVERSE,
  PHONE_EVENTS,
  PROTECTIONS,
  PUSHABLE,
  REOPEN_REASONS,
  RETIER_EFFECTS,
  REVERSALS,
  RUNGS,
  ACTIONS,
  actorRole,
  allowed,
  raiseFor,
  readTimeoutMin,
  AUTHORITY,
} from './loopPolicy.js';
import {
  CAPS,
  HAZARD_NOUN,
  bluf as checkBluf,
  legShort,
  legTitle,
  plainBreach,
  whyRaised,
} from '../format.js';

/** Refusal codes, one per rule (EP-35 §1 I1–I12, EP-37 §12, EP-33). */
export const CODES = Object.freeze({
  I1_NO_VERIFICATION: 'No push without a verification',
  I1_NOT_APPROVED: 'A push needs an approved recommendation',
  I2_NO_COUNTERSIGN: 'DETAIL needs a countersign before approval',
  I2_SAME_PERSON: 'The countersign must be another person',
  I3_NOT_ON_MAIN: 'MAIN shows verified situations only',
  I4_UNCONFIRMED_NOT_DETAIL: 'Unconfirmed, actionable is for DETAIL only',
  I5_NOT_DETAIL: 'A detail leader answers DETAIL situations only',
  I5_NOT_DETAIL_LEADER: 'Only this detail’s leader answers',
  I5_DL_ANSWERS:
    'On a DETAIL ladder the detail leader answers in place of accepted',
  I6_NOT_SUPERVISOR: 'Only the supervisor re-tiers',
  I6_NO_REASON: 'A re-tier needs a reason',
  I7_NO_SITREP: 'A close needs a signed SITREP',
  I7_OPEN_LADDER:
    'A close needs every required rung, a stand-down, expiry or dismissal',
  I8_EXPIRED: 'Past valid until',
  I8_NEEDS_APPROVAL: 'A new push needs a new approval',
  I9_LADDER: 'Ladder rungs only move up',
  I9_CALLBACK_NOT_OPEN: 'No call-back is open for this push',
  I10_NOT_BOUND: 'A phone event must come from its bound participant',
  I11_EDIT_IN_PLACE: 'Nothing is edited in place: send a new version',
  I12_TIME: 'Sim time only moves forward (except reset)',
  A1_PRINCIPAL: 'A DETAIL push goes to the detail leader, never the principal',
  BLUF: 'BLUF over 90 characters, not one line, or not plain',
  CAP: 'Text over its cap',
  ROLE: 'This actor may not send this event',
  UNKNOWN_EVENT: 'Unknown event',
  BAD_EVENT: 'Malformed event',
  NOT_FOUND: 'Unknown id',
  NOT_RAISABLE: 'This bundle does not meet the raise rule',
  NOT_RECIPIENT: 'Not a recipient of this push',
  NOT_DRAFT: 'Only a draft is approved',
  STALE: 'The item changed. Assess again',
  ALREADY: 'Already done',
  CLOSED: 'The situation is closed',
  BAD_VALUE: 'A field has a value outside its set',
  DONE_NOT_AT_PLACE:
    'Two fixes inside the place are needed for done by position',
  CALLBACK_ORDER: 'Call-back steps follow the escalation chain in order',
  CALLBACK_RESOLVED: 'The call-back chain is resolved',
  CALLBACK_NEEDS_COUNTERSIGN:
    'This call-back step needs a countersign from another supervisor',
  NOT_VIEWER: 'Only the client viewer opens the record this way',
  SALUTE_IMMUTABLE: 'A SALUTE is never edited',
  // EP-33 §3, the reversals (B4).
  REVERSES_MISMATCH: 'A reversal names an event of another kind or record',
  RECALL_AFTER_READ: 'Read already: supersede instead of recalling',
  SUPERSEDE_BEFORE_READ: 'Not read yet: recall instead of superseding',
  SUPERSEDE_REQUIRED: 'This situation has a live push: supersede it',
  RECALLED: 'This push was recalled',
  SUPERSEDED: 'This push was superseded',
  UNDO_LOWERS:
    'A pushed item keeps its human decision: recall or supersede first',
  NOT_CLOSED: 'Only a closed situation is reopened',
  NO_REASON: 'A reason is needed',
});

const CLOSED_STATES = new Set(['CLOSED']);
const OPEN_PUSH_STATES = new Set(['PUSHED', 'ACKED']);
const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
const iso = (t) => new Date(ms(t)).toISOString().replace('.000Z', 'Z');
const clone = (x) => JSON.parse(JSON.stringify(x));
const rungIdx = (r) => (r ? RUNGS.indexOf(r) : -1);

/** A new loop at t0: people, legs and details from the fixtures; no intel. */
export function createLoop({ fixtures, t0 = fixtures?.t0 } = {}) {
  const f = fixtures || {};
  const people = {};
  for (const [id, p] of Object.entries(f.people || {}))
    people[id] = {
      ...clone(p),
      radius_m: null,
      read_timeout_min: readTimeoutMin(p.protection),
      last_checkin_at: null,
      next_checkin_due_at: null,
    };
  const legs = {};
  for (const [id, l] of Object.entries(f.legs || {}))
    legs[id] = {
      ...clone(l),
      official_instructions: clone(l.official_instructions || []),
    };
  const watch = {};
  for (const s of f.watch?.staff || [])
    watch[s.callsign] = { id: s.id, callsign: s.callsign, role: s.role };
  const base = {
    people,
    legs,
    details: clone(f.details || {}),
    watch,
    beats: { ...(f.beats || {}) },
    // B7 (fix list #14): the client's security lead, read-only (record.view).
    client_viewer: f.watch?.client_viewer?.ref ?? null,
  };
  return fresh(base, iso(t0), 0, f.sample !== false);
}

function fresh(base, t0, rev, sample) {
  return {
    sample,
    rev,
    clock: {
      t0,
      simNow: t0,
      rate: 1,
      paused: true,
      beat: null,
      phones: 'scripted',
    },
    beats: clone(base.beats),
    watch: clone(base.watch),
    people: clone(base.people),
    legs: clone(base.legs),
    details: clone(base.details),
    intel: {},
    situations: {},
    verifications: {},
    recommendations: {},
    pushes: {},
    sitreps: {},
    salutes: {},
    acks: [],
    messages: [],
    retiers: [],
    checkins: [],
    notifications: [],
    callbacks: {},
    commsChecks: {},
    checkinRequests: {},
    positions: {},
    lastHuman: null,
    // B7 (fix list #14): the client viewer's opens of a record, in order.
    clientViewer: base.client_viewer ?? null,
    views: [],
    log: [],
    base: clone(base),
  };
}

/** Copy-on-write view of one transition. */
class Cx {
  constructor(loop, ev, at) {
    this.prev = loop;
    this.next = { ...loop };
    this.ev = ev;
    this.at = at;
    this.rev = loop.rev + 1;
    this.changed = new Set();
    this.owned = new Set();
  }
  meta() {
    return { rev: this.rev, by: this.ev.by ?? null, at: iso(this.at) };
  }
  coll(name) {
    if (!this.owned.has(name)) {
      const v = this.next[name];
      this.next[name] = Array.isArray(v) ? [...v] : { ...v };
      this.owned.add(name);
    }
    this.changed.add(name);
    return this.next[name];
  }
  get(name, id) {
    return this.next[name]?.[id];
  }
  set(name, id, rec) {
    this.coll(name)[id] = { ...rec, meta: this.meta() };
    return this.coll(name)[id];
  }
  patch(name, id, fields) {
    return this.set(name, id, { ...this.get(name, id), ...fields });
  }
  append(name, item) {
    this.coll(name).push(item);
  }
  put(key, value) {
    this.next[key] = value;
    this.changed.add(key);
  }
}

const refuse = (loop, code, detail = null) => ({
  loop,
  changed: [],
  refused: { code, reason: CODES[code] || code, ...(detail ? { detail } : {}) },
});

/** Apply one event. Returns {loop, changed, refused?}. */
export function applyLoopEvent(loop, ev) {
  if (!ev || typeof ev.type !== 'string') return refuse(loop, 'BAD_EVENT');
  const at = ms(ev.at);
  if (!Number.isFinite(at)) return refuse(loop, 'BAD_EVENT', 'at');
  const role = actorRole(loop, ev.by);
  if (!HANDLERS[ev.type]) return refuse(loop, 'UNKNOWN_EVENT');
  if (!allowed(ev.type, role))
    return refuse(
      loop,
      ev.type === 'posture.retier' ? 'I6_NOT_SUPERVISOR' : 'ROLE',
    );
  if (ev.type === 'reset') return reset(loop, ev, at);
  if (at < ms(loop.clock.simNow)) return refuse(loop, 'I12_TIME');
  // I10: a phone event names its own participant, and a bound device too.
  if (PHONE_EVENTS.includes(ev.type) && role === 'person') {
    const who = ev.participant_id ?? ev.person_id;
    if (who !== ev.by) return refuse(loop, 'I10_NOT_BOUND');
    if ((ev.via === 'phone' || ev.device) && ev.device?.participant_id !== who)
      return refuse(loop, 'I10_NOT_BOUND');
  }
  // EP-33 §3: a reversal says what it reverses, and only an event of the
  // kind (and the record) it may reverse; the reversed event stays put.
  const rv = REVERSALS[ev.type] || MAY_REVERSE[ev.type];
  if (REVERSALS[ev.type] && !ev.reverses)
    return refuse(loop, 'BAD_EVENT', 'reverses');
  if (ev.reverses != null) {
    if (!rv || typeof ev.reverses !== 'string')
      return refuse(loop, 'BAD_EVENT', 'reverses');
    const target = loop.log.find((l) => l.id === ev.reverses);
    if (!target) return refuse(loop, 'NOT_FOUND', 'reverses');
    if (!rv.includes(target.type)) return refuse(loop, 'REVERSES_MISMATCH');
    for (const k of ['bundle_id', 'sit_id', 'push_id', 'person_id']) {
      const mine =
        k === 'push_id' && ev.type === 'push.send' ? ev.supersedes : ev[k];
      if (mine && target.ids[k] && mine !== target.ids[k])
        return refuse(loop, 'REVERSES_MISMATCH');
    }
  }
  const cx = new Cx(loop, ev, at);
  tick(cx, at);
  const code = HANDLERS[ev.type](cx, ev, at, role);
  if (code) return refuse(loop, code);
  const n = cx.next;
  if (!cx.changed.has('clock') || ms(n.clock.simNow) < at)
    cx.put('clock', {
      ...n.clock,
      simNow: iso(Math.max(at, ms(n.clock.simNow))),
    });
  n.rev = cx.rev;
  const ids = {};
  for (const k of [
    'sit_id',
    'bundle_id',
    'push_id',
    'recommendation_id',
    'verification_id',
    'sitrep_id',
    'person_id',
    'participant_id',
    'leg_id',
    'detail_id',
  ])
    if (ev[k]) ids[k] = ev[k];
  if (ev.bundle?.bundle_id) ids.bundle_id = ev.bundle.bundle_id;
  cx.append('log', {
    seq: n.log.length + 1,
    at: iso(at),
    type: ev.type,
    by: ev.by ?? null,
    rev: cx.rev,
    id: ev.id ?? null,
    ids,
    ...(ev.reverses ? { reverses: ev.reverses } : {}),
    ...(ev.supersedes ? { supersedes: ev.supersedes } : {}),
    ...(ev.preempts ? { preempts: ev.preempts } : {}),
    ...(ev.via && ev.via !== 'script' ? { via: ev.via } : {}),
  });
  return { loop: n, changed: [...cx.changed].sort() };
}

function reset(loop, ev, at) {
  const next = fresh(loop.base, loop.clock.t0, loop.rev + 1, loop.sample);
  next.log = [
    {
      seq: 1,
      at: iso(at),
      type: 'reset',
      by: ev.by,
      rev: next.rev,
      id: ev.id ?? null,
      ids: {},
    },
  ];
  return { loop: next, changed: ['all'] };
}

// ------------------------------------------------------------------ timers

function tick(cx, at) {
  // I8: past valid_until and not done → EXPIRED, off MAIN.
  for (const p of Object.values(cx.next.pushes)) {
    const sit = cx.get('situations', p.sit_id);
    if (!sit || !OPEN_PUSH_STATES.has(sit.state) || p.expired_at) continue;
    if (p.recalled_at || p.superseded_by) continue;
    if (p.valid_until && ms(p.valid_until) <= at) {
      cx.patch('pushes', p.push_id, { expired_at: p.valid_until });
      cx.patch('situations', sit.sit_id, {
        state: 'EXPIRED',
        expired_at: p.valid_until,
      });
      const rec = cx.get('recommendations', p.recommendation_id);
      if (rec) cx.patch('recommendations', rec.id, { status: 'expired' });
    }
  }
  // I9: no read within the read timeout opens the call-back at step 1.
  for (const p of Object.values(cx.next.pushes)) {
    if (p.expired_at || cx.next.callbacks[p.push_id]) continue;
    if (p.recalled_at || p.superseded_by) continue;
    const sit = cx.get('situations', p.sit_id);
    if (!sit || !OPEN_PUSH_STATES.has(sit.state)) continue;
    const due = ms(p.sent_at) + p.read_timeout_min * 60e3;
    if (due > at) continue;
    const unread = p.order.find(
      (pid) => rungIdx(p.recipients[pid].rung) < rungIdx('read'),
    );
    if (!unread) continue;
    const person = cx.get('people', unread);
    cx.set('callbacks', p.push_id, {
      push_id: p.push_id,
      sit_id: p.sit_id,
      person_id: unread,
      started_at: iso(due),
      step: 1,
      chain: clone(person?.escalation || []),
      steps: [],
      resolved_at: null,
      resolved_by: null,
      outcome: null,
    });
  }
  // EP-37 §7: a comms check unanswered (or short an agent) +5 min → overdue.
  for (const [id, c] of Object.entries(cx.next.commsChecks)) {
    if (c.overdue || !c.due_at) continue;
    const late = ms(c.due_at) + (c.overdue_after_min ?? 5) * 60e3;
    if (late <= at && (!c.answered_at || c.missing.length))
      cx.patch('commsChecks', id, { overdue: true, overdue_at: iso(late) });
  }
}

// ------------------------------------------------------------------ helpers

/**
 * "Last verified by a human" (EP-33): every decision a named watch member
 * signs moves it (B7, review R13 S1-1: approve, push, notify, call-back,
 * re-tier, SITREP sign and close too). `via: 'presenter'` when the act was
 * sent from the presenter's iPad on the member's behalf (EP-38 #8).
 */
const human = (cx, ev, at) =>
  cx.put('lastHuman', {
    by: ev.by,
    at: iso(at),
    type: ev.type,
    ...(ev.via === 'presenter' ? { via: 'presenter' } : {}),
  });

function computeWhy(loop, bundle, m) {
  const leg = loop.legs[m.leg_id];
  try {
    return whyRaised({
      callsign: m.callsign,
      title: m.named ? legShort(leg) : legTitle(leg),
      distanceM: m.distance_m,
      bearing: m.bearing,
      window: m.window,
      timeToExposureS: m.time_to_exposure_s,
      named: Boolean(m.named),
      hazard: bundle.hazard_area
        ? HAZARD_NOUN[bundle.event_type] || 'hazard area'
        : null,
    });
  } catch {
    return null;
  }
}

function openSituation(cx, rec, sitId, at, advisory) {
  const m = rec.match;
  const person = cx.get('people', m.person_id);
  const leg = cx.get('legs', m.leg_id);
  const id = sitId || `s-${rec.bundle_id}`;
  if (cx.get('situations', id)) return 'ALREADY';
  const why = computeWhy(cx.next, rec, m);
  cx.set('situations', id, {
    sit_id: id,
    sample: true,
    person_id: m.person_id,
    leg_id: m.leg_id,
    callsign: m.callsign,
    intel_ids: [rec.bundle_id],
    related_intel_ids: [],
    salute_ids: [],
    tier: person?.protection,
    raised_tier: person?.protection,
    advisory: Boolean(advisory),
    state: 'RAISED',
    raised_at: iso(at),
    exposure_at: leg?.start ?? null,
    time_to_exposure_s: m.time_to_exposure_s,
    why_raised: rec.why_raised_text || why,
    why_raised_engine: why,
    match: m,
    grade: rec.grade,
    priority: rec.operational_priority,
    verification_id: null,
    recommendation_id: null,
    push_id: null,
    next_update_at: null,
    stand_down_at: null,
    closed_at: null,
    close_reason: null,
    sitrep_id: null,
  });
  cx.patch('intel', rec.bundle_id, {
    status: 'raised',
    sit_id: id,
    raise_pending: false,
  });
  return null;
}

function openSituationFor(cx, personId, legId = null) {
  return Object.values(cx.next.situations)
    .filter(
      (s) =>
        !CLOSED_STATES.has(s.state) &&
        (s.person_id === personId ||
          (personId &&
            cx.get('details', cx.get('people', personId)?.detail_id)
              ?.principal === s.person_id)) &&
        (!legId || s.leg_id === legId),
    )
    .sort((a, b) => ms(b.raised_at) - ms(a.raised_at))[0];
}

/** Match a bundle (new or grown) and set its status; maybe raise. */
function matchAndRaise(
  cx,
  bundleId,
  at,
  { sitId = null, defer = false, legIds = null } = {},
) {
  const rec = cx.get('intel', bundleId);
  const r = matchLegs(rec, cx.next.legs, cx.next.people, at);
  // A re-match of some legs counts only when the bundle's own best leg is
  // one of them (a mention keeps its claimed leg).
  if (legIds && !(r.match && legIds.includes(r.match.leg_id))) return;
  if (r.reason === 'linked') {
    const rel = rec.related_to;
    const sit =
      typeof rel === 'string'
        ? Object.values(cx.next.situations).find(
            (s) => s.intel_ids.includes(rel) && !CLOSED_STATES.has(s.state),
          )
        : rel && openSituationFor(cx, rel.person_id, rel.leg_id);
    cx.patch('intel', bundleId, {
      status: 'linked',
      linked_to: sit?.sit_id ?? rec.linked_to ?? null,
      not_raised_reason: null,
    });
    if (sit && !sit.related_intel_ids.includes(bundleId))
      cx.patch('situations', sit.sit_id, {
        related_intel_ids: [...sit.related_intel_ids, bundleId],
      });
    return;
  }
  if (!r.match) {
    const status = ['dismissed', 'watch'].includes(rec.status)
      ? rec.status
      : r.banner
        ? 'banner'
        : 'feed';
    cx.patch('intel', bundleId, {
      status,
      banner: r.banner,
      reason_engine: r.reason,
      not_raised_reason: rec.decided?.reason || rec.intake_reason || r.reason,
    });
    return;
  }
  const m = r.match;
  const person = cx.get('people', m.person_id);
  const decision = raiseFor(person, rec);
  const fields = {
    match: m,
    matched_at: rec.matched_at || iso(at),
    banner: null,
    reason_engine: null,
  };
  if (rec.sit_id) {
    // A grown bundle extends its open situation (EP-35 §1).
    cx.patch('intel', bundleId, fields);
    const sit = cx.get('situations', rec.sit_id);
    if (sit && !CLOSED_STATES.has(sit.state))
      cx.patch('situations', sit.sit_id, {
        grade: rec.grade,
        priority: rec.operational_priority,
        match: m,
      });
    return;
  }
  if (decision === 'raise' || decision === 'advisory') {
    if (defer) {
      cx.patch('intel', bundleId, {
        ...fields,
        status: 'matched',
        raise_pending: decision,
        not_raised_reason: null,
      });
      return;
    }
    cx.patch('intel', bundleId, fields);
    openSituation(
      cx,
      cx.get('intel', bundleId),
      sitId,
      at,
      decision === 'advisory',
    );
    return;
  }
  const why = rec.duplicate_of
    ? `duplicate of ${rec.duplicate_of_intel || rec.duplicate_of}`
    : decision === 'watch'
      ? `${rec.operational_priority}, ${person.protection}: watch`
      : 'below the raise rule';
  cx.patch('intel', bundleId, {
    ...fields,
    status: ['dismissed', 'watch'].includes(rec.status)
      ? rec.status
      : 'matched',
    raise_pending: false,
    not_raised_reason: rec.decided?.reason || rec.intake_reason || why,
  });
}

/**
 * A changed leg or a re-tier re-matches open intel (EP-35 §1): items not
 * yet matched that are still current, i.e. not past `expires_at`, or,
 * with no expiry, observed within the stale limit (the same 4 h as at
 * ingest).
 */
function rematchLegs(cx, at, legIds) {
  for (const rec of Object.values(cx.next.intel)) {
    if (['dismissed', 'linked', 'raised'].includes(rec.status) || rec.sit_id)
      continue;
    if (rec.matched_at) continue;
    const current = rec.expires_at
      ? ms(rec.expires_at) > at
      : at - ms(rec.sent_at) <= STALE_AFTER_H * 3600e3;
    if (!current) continue;
    matchAndRaise(cx, rec.bundle_id, at, { legIds });
  }
}

const required = (r) => {
  switch (r.required_rung) {
    case 'done':
      return r.rung === 'done';
    case 'read':
      return rungIdx(r.rung) >= rungIdx('read');
    case 'dl_answer':
      return Boolean(r.dl);
    default:
      return rungIdx(r.rung) >= rungIdx('accepted');
  }
};

function sitStateFor(sit, push) {
  if (['CLOSED', 'EXPIRED', 'NONCONCUR'].includes(sit.state)) return sit.state;
  const rs = push.order.map((pid) => push.recipients[pid]);
  if (rs.every(required)) return 'DONE';
  if (
    rs.some(
      (r) =>
        rungIdx(r.rung) >= rungIdx('accepted') ||
        (r.dl && r.dl.answer !== 'nonconcur'),
    )
  )
    return 'ACKED';
  return 'PUSHED';
}

function resolveCallback(cx, pushId, pid, at) {
  const cb = cx.get('callbacks', pushId);
  if (cb && !cb.resolved_at && cb.person_id === pid)
    cx.patch('callbacks', pushId, {
      resolved_at: iso(at),
      resolved_by: pid,
      outcome: 'resolved',
    });
}

/** I7: the ladder (or a stand-down, expiry, dismissal) lets this situation close. */
function closable(cx, sit) {
  const push = sit.push_id && cx.get('pushes', sit.push_id);
  const live = push && !push.recalled_at ? push : null;
  if (sit.state === 'EXPIRED' || sit.state === 'DISMISSED') return true;
  if (!live) return ['VERIFIED', 'UNCONFIRMED', 'WATCH'].includes(sit.state);
  if (live.tier === 'DETAIL') return Boolean(sit.stand_down_at);
  if (sit.state === 'NONCONCUR') return Boolean(sit.stand_down_at);
  return live.order.every((pid) => required(live.recipients[pid]));
}

/** The state a reopened situation returns to: what its record says now. */
function reopenState(cx, sit) {
  const v = sit.verification_id && cx.get('verifications', sit.verification_id);
  const push = sit.push_id && cx.get('pushes', sit.push_id);
  if (!push || push.recalled_at) return v ? DECISIONS[v.decision] : 'RAISED';
  if (push.expired_at) return 'EXPIRED';
  const rs = push.order.map((pid) => push.recipients[pid]);
  if (rs.some((r) => r.dl?.answer === 'nonconcur')) return 'NONCONCUR';
  return sitStateFor({ ...sit, state: 'PUSHED' }, push);
}

const reading = (p) =>
  p.order.some(
    (pid) =>
      rungIdx(p.recipients[pid].rung) >= rungIdx('read') ||
      Boolean(p.recipients[pid].dl),
  );

const capBreach = (kind, text) =>
  typeof text === 'string' && [...text].length > CAPS[kind];

// ------------------------------------------------------------------ handlers

const HANDLERS = {
  'intel.received'(cx, ev, at) {
    const b = ev.bundle;
    if (!b?.bundle_id) return 'BAD_EVENT';
    const prev = cx.get('intel', b.bundle_id);
    const rec = prev
      ? { ...prev, ...b, versions: (prev.versions || 1) + 1 }
      : {
          ...b,
          status: 'feed',
          match: null,
          matched_at: null,
          banner: null,
          raise_pending: false,
          sit_id: null,
          linked_to: null,
          decided: null,
          not_raised_reason: null,
          versions: 1,
        };
    cx.set('intel', b.bundle_id, rec);
    matchAndRaise(cx, b.bundle_id, at, {
      sitId: ev.sit_id ?? null,
      defer: Boolean(ev.defer_raise),
    });
    return null;
  },

  'intel.raise'(cx, ev, at) {
    const rec = cx.get('intel', ev.bundle_id);
    if (!rec) return 'NOT_FOUND';
    if (!rec.raise_pending || !rec.match) return 'NOT_RAISABLE';
    return openSituation(
      cx,
      rec,
      ev.sit_id,
      at,
      rec.raise_pending === 'advisory',
    );
  },

  'position.fix'(cx, ev, at) {
    const id = ev.person_id;
    if (!id) return 'BAD_EVENT';
    const prev = cx.get('positions', id);
    const fix = {
      fix_id: ev.fix_id ?? ev.id ?? null,
      at: iso(at),
      lat: ev.lat,
      lon: ev.lon,
      accuracy_m: ev.accuracy_m ?? null,
      precision: ev.precision ?? null,
      mgrs: ev.mgrs ?? null,
      source: ev.source ?? null,
      via: ev.via_subject ?? null,
      place_id: ev.place_id ?? null,
      activity: ev.activity ?? null,
      privacy: ev.privacy ?? null,
    };
    cx.set('positions', id, {
      person_id: id,
      ...fix,
      recent: [
        ...(prev?.recent || []).slice(-1),
        { at: fix.at, lat: fix.lat, lon: fix.lon, activity: fix.activity },
      ],
    });
    return null;
  },

  'leg.changed'(cx, ev, at) {
    const leg = cx.get('legs', ev.leg_id);
    if (!leg) return 'NOT_FOUND';
    cx.patch('legs', ev.leg_id, {
      ...clone(ev.patch || {}),
      changed_at: iso(at),
    });
    rematchLegs(cx, at, [ev.leg_id]);
    return null;
  },

  'checkin.due'(cx, ev, at) {
    if (!cx.get('people', ev.person_id)) return 'NOT_FOUND';
    cx.set('checkinRequests', ev.person_id, {
      person_id: ev.person_id,
      due_at: iso(at),
      point: ev.point ?? null,
      answered_at: null,
    });
    cx.patch('people', ev.person_id, { next_checkin_due_at: iso(at) });
    return null;
  },

  'comms.due'(cx, ev, at) {
    if (!cx.get('details', ev.detail_id)) return 'NOT_FOUND';
    cx.set('commsChecks', ev.detail_id, {
      detail_id: ev.detail_id,
      due_at: ev.due_at ? iso(ev.due_at) : iso(at),
      overdue_after_min: ev.overdue_after_min ?? 5,
      answered_at: null,
      answered_by: null,
      missing: [],
      overdue: false,
      overdue_at: null,
    });
    return null;
  },

  'comms.overdue'(cx, ev, at) {
    const c = cx.get('commsChecks', ev.detail_id);
    if (!c) return 'NOT_FOUND';
    const missing =
      ev.person_id && !c.missing.includes(ev.person_id)
        ? [...c.missing, ev.person_id]
        : c.missing;
    cx.patch('commsChecks', ev.detail_id, {
      overdue: true,
      overdue_at: c.overdue_at || iso(at),
      missing,
    });
    return null;
  },

  'intel.dismiss'(cx, ev, at) {
    const rec = cx.get('intel', ev.bundle_id);
    if (!rec) return 'NOT_FOUND';
    if (!String(ev.reason || '').trim()) return 'BAD_VALUE';
    if (capBreach('dismissalReason', ev.reason)) return 'CAP';
    cx.patch('intel', ev.bundle_id, {
      status: 'dismissed',
      not_raised_reason: ev.reason,
      decided: { kind: 'dismiss', by: ev.by, at: iso(at), reason: ev.reason },
    });
    human(cx, ev, at);
    return null;
  },

  'intel.watch'(cx, ev, at) {
    const rec = cx.get('intel', ev.bundle_id);
    if (!rec) return 'NOT_FOUND';
    const reason = ev.reason || ev.note || null;
    cx.patch('intel', ev.bundle_id, {
      status: rec.sit_id ? rec.status : 'watch',
      decided: { kind: 'watch', by: ev.by, at: iso(at), reason },
      not_raised_reason: rec.sit_id ? null : reason || rec.not_raised_reason,
    });
    human(cx, ev, at);
    return null;
  },

  'verification.decide'(cx, ev, at) {
    const sit = cx.get('situations', ev.sit_id);
    if (!sit) return 'NOT_FOUND';
    if (CLOSED_STATES.has(sit.state)) return 'CLOSED';
    if (!DECISIONS[ev.decision]) return 'BAD_VALUE';
    if (ev.decision === 'unconfirmed_actionable' && sit.tier !== 'DETAIL')
      return 'I4_UNCONFIRMED_NOT_DETAIL';
    const id =
      ev.verification_id ||
      sit.verification_id ||
      sit.last_verification_id ||
      `v-${sit.sit_id}`;
    const old = cx.get('verifications', id);
    const version = ev.version ?? (old ? old.version + 1 : 1);
    if (old && version <= old.version) return 'I11_EDIT_IN_PLACE';
    // B4: the same decision again, unversioned, is a no-op ("already
    // verified 1604Z"): a click that comes after the script acted.
    if (
      old &&
      !old.reversed_at &&
      ev.version == null &&
      old.decision === ev.decision
    )
      return 'ALREADY';
    const { meta: _m, versions: oldVersions = [], ...oldRest } = old || {};
    cx.set('verifications', id, {
      id,
      sit_id: sit.sit_id,
      version,
      decision: ev.decision,
      grade: clone(ev.grade ?? null),
      grade_token: ev.grade_token ?? null,
      basis: clone(ev.basis || sit.intel_ids),
      corroborated_by: clone(ev.corroborated_by || []),
      related: clone(ev.related || []),
      note: ev.note ?? null,
      checklist: clone(ev.checklist ?? null),
      verified_by: ev.by,
      verified_at: iso(at),
      countersigned_by: null,
      countersigned_at: null,
      notified: [],
      versions: old ? [...oldVersions, oldRest] : [],
    });
    const related = [
      ...new Set([...sit.related_intel_ids, ...(ev.related || [])]),
    ];
    cx.patch('situations', sit.sit_id, {
      state: DECISIONS[ev.decision],
      verification_id: id,
      related_intel_ids: related,
    });
    for (const bid of ev.related || []) {
      const rec = cx.get('intel', bid);
      if (rec && !rec.sit_id)
        cx.patch('intel', bid, { status: 'linked', linked_to: sit.sit_id });
    }
    human(cx, ev, at);
    return null;
  },

  'verification.countersign'(cx, ev, at) {
    const sit = cx.get('situations', ev.sit_id);
    const v = cx.get(
      'verifications',
      ev.verification_id || sit?.verification_id,
    );
    if (!sit || !v) return 'NOT_FOUND';
    if (v.verified_by === ev.by) return 'I2_SAME_PERSON';
    if (v.reversed_at) return 'STALE';
    if (ev.version != null && ev.version !== v.version) return 'STALE';
    if (v.countersigned_by) return 'ALREADY';
    cx.patch('verifications', v.id, {
      countersigned_by: ev.by,
      countersigned_at: iso(at),
      // B7 (review R13 S2-4): on the record as sent from the presenter.
      countersigned_via: ev.via === 'presenter' ? 'presenter' : null,
    });
    human(cx, ev, at);
    return null;
  },

  'notify.send'(cx, ev, at) {
    const sit = cx.get('situations', ev.sit_id);
    const v = cx.get(
      'verifications',
      ev.verification_id || sit?.verification_id,
    );
    if (!sit || !v) return 'NOT_FOUND';
    const note = {
      at: iso(at),
      by: ev.by,
      parties: clone(ev.parties || []),
      text: ev.text ?? null,
    };
    cx.patch('verifications', v.id, { notified: [...v.notified, note] });
    cx.append('notifications', { sit_id: sit.sit_id, ...note });
    human(cx, ev, at);
    return null;
  },

  'recommendation.draft'(cx, ev, at) {
    const sit = cx.get('situations', ev.sit_id);
    if (!sit) return 'NOT_FOUND';
    const id = ev.recommendation_id || `r-${sit.sit_id}`;
    if (cx.get('recommendations', id)) return 'I11_EDIT_IN_PLACE';
    const code = checkRecommendation(cx, sit, ev);
    if (code) return code;
    cx.set('recommendations', id, {
      id,
      sit_id: sit.sit_id,
      version: 1,
      status: 'draft',
      ...recFields(ev),
      verification_id: ev.verification_id ?? sit.verification_id,
      drafted_by: ev.drafted_by ?? ev.by,
      drafted_at: iso(at),
      approved_by: null,
      approved_at: null,
      push_id: null,
      versions: [],
    });
    cx.patch('situations', sit.sit_id, { recommendation_id: id });
    return null;
  },

  'recommendation.edit'(cx, ev, at) {
    const rec = cx.get('recommendations', ev.recommendation_id ?? ev.id);
    if (!rec) return 'NOT_FOUND';
    const sit = cx.get('situations', rec.sit_id);
    const merged = { ...rec, ...(ev.patch || {}) };
    const code = checkRecommendation(cx, sit, merged);
    if (code) return code;
    const { meta: _m, versions = [], ...old } = rec;
    cx.set('recommendations', rec.id, {
      ...old,
      ...recFields(merged),
      version: rec.version + 1,
      status: 'draft',
      approved_by: null,
      approved_at: null,
      push_id: null,
      edited_by: ev.by,
      edited_at: iso(at),
      versions: [...versions, old],
    });
    return null;
  },

  'recommendation.approve'(cx, ev, at) {
    const rec = cx.get('recommendations', ev.recommendation_id ?? ev.id);
    if (!rec) return 'NOT_FOUND';
    if (ev.version != null && ev.version !== rec.version) return 'STALE';
    if (rec.status !== 'draft')
      return rec.status === 'approved' ? 'ALREADY' : 'NOT_DRAFT';
    const sit = cx.get('situations', rec.sit_id);
    const v = cx.get(
      'verifications',
      sit?.verification_id || rec.verification_id,
    );
    if (!v || v.reversed_at || !PUSHABLE.includes(v.decision))
      return 'I1_NO_VERIFICATION';
    if (
      sit.tier === 'DETAIL' &&
      !(v.countersigned_by && v.countersigned_by !== v.verified_by)
    )
      return 'I2_NO_COUNTERSIGN';
    if (rec.valid_until && ms(rec.valid_until) <= at) return 'I8_EXPIRED';
    cx.patch('recommendations', rec.id, {
      status: 'approved',
      approved_by: ev.by,
      approved_at: iso(at),
      verification_id: v.id,
    });
    human(cx, ev, at);
    return null;
  },

  'push.send'(cx, ev, at) {
    const rec = cx.get('recommendations', ev.recommendation_id);
    if (!rec) return 'NOT_FOUND';
    const sit = cx.get('situations', rec.sit_id);
    if (!sit) return 'NOT_FOUND';
    if (CLOSED_STATES.has(sit.state)) return 'CLOSED';
    const v = cx.get(
      'verifications',
      sit.verification_id || rec.verification_id,
    );
    if (!v || v.reversed_at || !PUSHABLE.includes(v.decision))
      return 'I1_NO_VERIFICATION';
    if (rec.status === 'pushed' || rec.status === 'expired')
      return 'I8_NEEDS_APPROVAL';
    // EP-33 §3: one live push per situation; a new one supersedes it
    // (after a read; before a read the old one is recalled instead).
    const prior = ev.supersedes && cx.get('pushes', ev.supersedes);
    if (ev.supersedes) {
      if (!prior || prior.sit_id !== sit.sit_id) return 'NOT_FOUND';
      if (prior.recalled_at || prior.superseded_by) return 'ALREADY';
      if (!reading(prior)) return 'SUPERSEDE_BEFORE_READ';
    } else if (sit.push_id) {
      const cur = cx.get('pushes', sit.push_id);
      if (cur && !cur.recalled_at && !cur.superseded_by && !cur.expired_at)
        return 'SUPERSEDE_REQUIRED';
    }
    if (rec.status !== 'approved') return 'I1_NOT_APPROVED';
    if (rec.valid_until && ms(rec.valid_until) <= at) return 'I8_EXPIRED';
    const code = checkRecommendation(cx, sit, rec);
    if (code) return code;
    const person = cx.get('people', sit.person_id);
    const tier = person?.protection || sit.tier;
    const id = ev.push_id || `push-${rec.id}-v${rec.version}`;
    if (cx.get('pushes', id)) return 'ALREADY';
    const recipients = {};
    const order = [];
    for (const r of rec.recipients) {
      order.push(r.participant_id);
      recipients[r.participant_id] = {
        participant_id: r.participant_id,
        role: r.role ?? null,
        required_rung: r.required_rung,
        reply_word: r.reply_word ?? null,
        rung: null,
        at: {},
        dl: null,
      };
    }
    cx.set('pushes', id, {
      push_id: id,
      sample: true,
      sit_id: sit.sit_id,
      recommendation_id: rec.id,
      version: rec.version,
      verification_id: v.id,
      sent_at: iso(at),
      sent_by: ev.by,
      tier,
      read_timeout_min:
        ev.read_timeout_min ?? person?.read_timeout_min ?? readTimeoutMin(tier),
      unconfirmed: v.decision === 'unconfirmed_actionable',
      valid_until: rec.valid_until ?? null,
      next_update_at: rec.next_update_at ?? null,
      recipients,
      order,
      header: ev.header ?? null,
      card: clone(ev.card ?? null),
      phone: clone(ev.phone ?? {}),
      expired_at: null,
      ...(prior ? { supersedes: prior.push_id } : {}),
    });
    if (prior) {
      cx.patch('pushes', prior.push_id, {
        superseded_by: id,
        superseded_at: iso(at),
      });
      const cb = cx.get('callbacks', prior.push_id);
      if (cb && !cb.resolved_at)
        cx.patch('callbacks', prior.push_id, {
          resolved_at: iso(at),
          resolved_by: ev.by,
          outcome: 'superseded',
        });
    }
    cx.patch('recommendations', rec.id, { status: 'pushed', push_id: id });
    cx.patch('situations', sit.sit_id, {
      push_id: id,
      state: 'PUSHED',
      expired_at: null,
      next_update_at: rec.next_update_at ?? null,
    });
    human(cx, ev, at);
    return null;
  },

  ack(cx, ev, at, role) {
    const p = cx.get('pushes', ev.push_id);
    if (!p) return 'NOT_FOUND';
    const r = p.recipients[ev.participant_id];
    if (!r) return 'NOT_RECIPIENT';
    if (
      role === 'generator' &&
      !(
        ev.rung === 'delivered' ||
        (ev.rung === 'done' && ev.source === 'position')
      )
    )
      return 'I10_NOT_BOUND';
    if (!RUNGS.includes(ev.rung)) return 'BAD_VALUE';
    if (p.recalled_at) return 'RECALLED';
    if (p.superseded_by) return 'SUPERSEDED';
    if (p.expired_at) return 'I8_EXPIRED';
    if (rungIdx(ev.rung) <= rungIdx(r.rung)) return 'I9_LADDER';
    if (ev.rung === 'accepted' && p.tier === 'DETAIL') return 'I5_DL_ANSWERS';
    if (ev.rung === 'done' && ev.source === 'position') {
      const rec = cx.get('recommendations', p.recommendation_id);
      const where = rec?.destination;
      const pos = cx.get('positions', ev.participant_id);
      const two =
        pos?.recent?.length === 2 &&
        pos.recent.every((f) => insideWhere(f, where));
      if (!two) return 'DONE_NOT_AT_PLACE';
    }
    const nr = { ...r, rung: ev.rung, at: { ...r.at, [ev.rung]: iso(at) } };
    const push = cx.patch('pushes', p.push_id, {
      recipients: { ...p.recipients, [ev.participant_id]: nr },
    });
    cx.append('acks', {
      push_id: p.push_id,
      participant_id: ev.participant_id,
      rung: ev.rung,
      at: iso(at),
      by: ev.by,
      source: ev.source ?? null,
    });
    if (rungIdx(ev.rung) >= rungIdx('read'))
      resolveCallback(cx, p.push_id, ev.participant_id, at);
    const sit = cx.get('situations', p.sit_id);
    const state = sitStateFor(sit, push);
    if (state !== sit.state)
      cx.patch('situations', sit.sit_id, {
        state,
        ...(state === 'DONE' ? { done_at: iso(at) } : {}),
      });
    return null;
  },

  'dl.respond'(cx, ev, at) {
    const p = cx.get('pushes', ev.push_id);
    if (!p) return 'NOT_FOUND';
    const sit = cx.get('situations', p.sit_id);
    if (p.recalled_at) return 'RECALLED';
    if (p.superseded_by) return 'SUPERSEDED';
    if (sit.tier !== 'DETAIL') return 'I5_NOT_DETAIL';
    const detail = cx.get(
      'details',
      cx.get('people', sit.person_id)?.detail_id,
    );
    if (!detail || detail.leader !== ev.participant_id)
      return 'I5_NOT_DETAIL_LEADER';
    const r = p.recipients[ev.participant_id];
    if (!r) return 'NOT_RECIPIENT';
    if (!DL_ANSWERS.includes(ev.answer)) return 'BAD_VALUE';
    if (capBreach('dlAnswer', ev.reason)) return 'CAP';
    if (r.dl) return 'I11_EDIT_IN_PLACE';
    const dl = {
      answer: ev.answer,
      reason: ev.reason ?? null,
      plan: ev.plan ?? null,
      principal_informed: Boolean(ev.principal_informed),
      at: iso(at),
    };
    const nr = {
      ...r,
      dl,
      rung: rungIdx(r.rung) < rungIdx('accepted') ? 'accepted' : r.rung,
      at: { ...r.at, accepted: iso(at) },
    };
    cx.patch('pushes', p.push_id, {
      recipients: { ...p.recipients, [ev.participant_id]: nr },
    });
    cx.append('acks', {
      push_id: p.push_id,
      participant_id: ev.participant_id,
      rung: 'accepted',
      dl: ev.answer,
      at: iso(at),
      by: ev.by,
      source: 'dl',
    });
    resolveCallback(cx, p.push_id, ev.participant_id, at);
    const state = ev.answer === 'nonconcur' ? 'NONCONCUR' : 'ACKED';
    cx.patch('situations', sit.sit_id, {
      state,
      support_requested: ev.answer === 'request_support' || undefined,
    });
    return null;
  },

  'salute.file'(cx, ev, at) {
    const id = ev.salute_id || `sal-${ev.person_id}-${cx.next.log.length + 1}`;
    if (cx.get('salutes', id)) return 'SALUTE_IMMUTABLE';
    const sit =
      (ev.sit_id && cx.get('situations', ev.sit_id)) ||
      openSituationFor(cx, ev.person_id);
    cx.set('salutes', id, {
      salute_id: id,
      sample: true,
      person_id: ev.person_id,
      sit_id: sit?.sit_id ?? null,
      size: ev.size ?? null,
      activity: ev.activity ?? null,
      location: clone(ev.location ?? null),
      unit: ev.unit ?? null,
      time: ev.time ? iso(ev.time) : iso(at),
      equipment: ev.equipment ?? null,
      card: clone(ev.card ?? null),
      feed_tag: ev.feed_tag ?? null,
      source_kind: 'human',
      source_rating: ev.source_rating ?? 'B',
      info_credibility: ev.info_credibility ?? 2,
      filed_at: iso(at),
    });
    if (sit)
      cx.patch('situations', sit.sit_id, {
        salute_ids: [...sit.salute_ids, id],
      });
    return null;
  },

  'message.send'(cx, ev, at) {
    if (!ev.to) return 'BAD_EVENT';
    cx.append('messages', {
      id: ev.id ?? `m-${cx.next.messages.length + 1}`,
      at: iso(at),
      by: ev.by,
      sit_id: ev.sit_id ?? null,
      to: ev.to,
      kind: ev.kind ?? 'note',
      text: ev.text ?? null,
      signature: ev.signature ?? null,
      answers: ev.answers ?? null,
      update_of: ev.update_of ?? null,
      phone: clone(ev.phone ?? null),
    });
    const sit = ev.sit_id && cx.get('situations', ev.sit_id);
    if (sit && ev.next_update_at !== undefined && ev.update_of)
      cx.patch('situations', sit.sit_id, { next_update_at: ev.next_update_at });
    return null;
  },

  'callback.step'(cx, ev, at) {
    const cb = cx.get('callbacks', ev.push_id);
    if (!cb) return 'I9_CALLBACK_NOT_OPEN';
    const step = Number(ev.step);
    const link = cb.chain[step - 1];
    if (!link) return 'CALLBACK_ORDER';
    if (cb.resolved_at) {
      if (ev.outcome !== 'not taken') return 'CALLBACK_RESOLVED';
      if (step <= (cb.steps.at(-1)?.step ?? 0)) return 'CALLBACK_ORDER';
    } else if (
      !(step === cb.step || step === cb.step + 1) ||
      (step === cb.step + 1 && !cb.steps.length)
    )
      return 'CALLBACK_ORDER';
    if (
      link.participant_id &&
      ev.contact_ref &&
      link.participant_id !== ev.contact_ref
    )
      return 'CALLBACK_ORDER';
    // B7 (review R13 S2-2): a step the chain marks `needs: countersign`
    // (the police welfare check) is placed only with a second person's
    // countersign; logging it as not taken needs none.
    const needs = link.needs ?? ev.needs ?? null;
    const cs = ev.countersigned_by ?? null;
    if (needs === 'countersign' && ev.outcome !== 'not taken') {
      const role = cs ? cx.next.watch?.[cs]?.role : null;
      if (!cs || cs === ev.by || role !== 'supervisor')
        return 'CALLBACK_NEEDS_COUNTERSIGN';
    }
    cx.patch('callbacks', ev.push_id, {
      step,
      steps: [
        ...cb.steps,
        {
          step,
          attempt: ev.attempt ?? 1,
          role: link.role,
          contact_ref: link.participant_id ?? null,
          outcome: ev.outcome ?? null,
          needs,
          countersigned_by:
            needs === 'countersign' && ev.outcome !== 'not taken' ? cs : null,
          at: iso(at),
          by: ev.by,
        },
      ],
    });
    human(cx, ev, at);
    return null;
  },

  'posture.retier'(cx, ev, at) {
    const p = cx.get('people', ev.person_id);
    if (!p) return 'NOT_FOUND';
    const reason = String(ev.reason || '').trim();
    if (!reason) return 'I6_NO_REASON';
    if (capBreach('retierReason', reason)) return 'CAP';
    const to = ev.to || ev.protection;
    if (!PROTECTIONS.includes(to)) return 'BAD_VALUE';
    const effects = { ...RETIER_EFFECTS[to], ...(ev.effects || {}) };
    const sharing =
      effects.sharing === 'requested' && p.sharing !== 'on'
        ? 'requested'
        : (effects.sharing ?? p.sharing);
    const every = effects.checkin_every_min ?? null;
    cx.patch('people', p.id, {
      protection: to,
      tier: AUTHORITY[to].tier,
      radius_m: effects.watch_radius_m ?? null,
      checkin_every_min: every,
      read_timeout_min: effects.read_timeout_min ?? readTimeoutMin(to),
      sharing,
      retier_id: ev.retier_id ?? null,
      retiered_until: ev.until ? iso(ev.until) : null,
      next_checkin_due_at: every
        ? iso(at + every * 60e3)
        : p.next_checkin_due_at,
    });
    cx.append('retiers', {
      id: ev.retier_id ?? `rt-${p.id}-${cx.next.retiers.length + 1}`,
      person_id: p.id,
      from: p.protection,
      to,
      reason,
      by: ev.by,
      at: iso(at),
      until: ev.until ? iso(ev.until) : null,
      effects,
      proposed_by: ev.proposed_by ?? null,
      ...(ev.reverses ? { reverses: ev.reverses } : {}),
      // B7 (review R13 S2-4): sent from the presenter's iPad (EP-38 #8).
      ...(ev.via === 'presenter' ? { via: 'presenter' } : {}),
    });
    for (const s of Object.values(cx.next.situations))
      if (s.person_id === p.id && !CLOSED_STATES.has(s.state)) {
        cx.patch('situations', s.sit_id, { tier: to, retiered: true });
        const rec =
          s.recommendation_id && cx.get('recommendations', s.recommendation_id);
        if (rec && rec.status !== 'expired')
          cx.patch('recommendations', rec.id, { retiered_review: true });
      }
    const legIds = Object.values(cx.next.legs)
      .filter(
        (l) => l.person_id === p.id || (l.participants || []).includes(p.id),
      )
      .map((l) => l.id);
    rematchLegs(cx, at, legIds);
    human(cx, ev, at);
    return null;
  },

  'sharing.set'(cx, ev, at) {
    const p = cx.get('people', ev.person_id);
    if (!p) return 'NOT_FOUND';
    const sharing = ev.on
      ? 'on'
      : ev.state || (p.sharing === 'on' ? 'paused' : p.sharing);
    cx.patch('people', p.id, { sharing, sharing_set_at: iso(at) });
    return null;
  },

  'checkin.respond'(cx, ev, at) {
    const p = cx.get('people', ev.person_id);
    if (!p) return 'NOT_FOUND';
    cx.append('checkins', {
      id: ev.id ?? null,
      at: iso(at),
      person_id: p.id,
      kind: ev.kind ?? 'checkin',
      status: ev.status ?? null,
      text: ev.text ?? null,
      push_id: ev.push_id ?? null,
      sit_id: ev.sit_id ?? null,
      // B7: a post taken up (ATLAS 4's +1 post at the north door).
      ...(ev.post ? { post: clone(ev.post) } : {}),
    });
    cx.patch('people', p.id, {
      last_checkin_at: iso(at),
      next_checkin_due_at: p.checkin_every_min
        ? iso(at + p.checkin_every_min * 60e3)
        : null,
    });
    const req = cx.get('checkinRequests', p.id);
    if (req && !req.answered_at)
      cx.patch('checkinRequests', p.id, { answered_at: iso(at) });
    if (ev.kind === 'comms_check') {
      const c = cx.get('commsChecks', ev.detail_id || p.detail_id);
      if (c) {
        const d = cx.get('details', c.detail_id);
        if (d?.leader === p.id || !c.answered_at) {
          const missing = Object.entries(ev.agents || {})
            .filter(([, v]) => v !== 'ok')
            .map(([k]) => k);
          cx.patch('commsChecks', c.detail_id, {
            answered_at: iso(at),
            answered_by: p.id,
            missing,
            overdue: missing.length ? c.overdue : false,
          });
        } else {
          const missing = c.missing.filter((x) => x !== p.id);
          cx.patch('commsChecks', c.detail_id, {
            missing,
            overdue: missing.length ? c.overdue : false,
            cleared_at: iso(at),
          });
        }
      }
    }
    if (ev.status === 'stand_down') {
      const sit =
        (ev.sit_id && cx.get('situations', ev.sit_id)) ||
        openSituationFor(cx, p.id);
      if (sit)
        cx.patch('situations', sit.sit_id, {
          stand_down_at: iso(at),
          stand_down_by: p.id,
        });
    }
    if (ev.push_id) resolveCallback(cx, ev.push_id, p.id, at);
    return null;
  },

  'sitrep.draft'(cx, ev, at) {
    const id = ev.sitrep_id;
    if (!id) return 'BAD_EVENT';
    const old = cx.get('sitreps', id);
    const version = ev.version ?? (old ? old.version + 1 : 1);
    if (old && version <= old.version) return 'I11_EDIT_IN_PLACE';
    const sit = ev.sit_id && cx.get('situations', ev.sit_id);
    if (ev.sit_id && !sit) return 'NOT_FOUND';
    for (const line of [...(ev.body || []), ...Object.values(ev.card || {})])
      if (plainBreach(line)) return 'BAD_VALUE';
    const { meta: _m, versions = [], ...oldRest } = old || {};
    cx.set('sitreps', id, {
      id,
      sit_id: ev.sit_id ?? null,
      daily: Boolean(ev.daily),
      version,
      header: ev.header ?? null,
      body: clone(ev.body ?? []),
      card: clone(ev.card ?? null),
      drafted_by: ev.drafted_by ?? ev.by,
      drafted_at: iso(at),
      signed_by: null,
      signed_at: null,
      signed: null,
      versions: old ? [...versions, oldRest] : [],
    });
    if (sit) cx.patch('situations', sit.sit_id, { sitrep_id: id });
    return null;
  },

  'sitrep.sign'(cx, ev, at) {
    const s = cx.get('sitreps', ev.sitrep_id);
    if (!s) return 'NOT_FOUND';
    if (ev.version != null && ev.version !== s.version) return 'STALE';
    if (s.signed_at) return 'ALREADY';
    cx.patch('sitreps', s.id, {
      signed_by: ev.by,
      signed_at: iso(at),
      signed: ev.signed ?? null,
    });
    human(cx, ev, at);
    return null;
  },

  'situation.close'(cx, ev, at) {
    const sit = cx.get('situations', ev.sit_id);
    if (!sit) return 'NOT_FOUND';
    if (CLOSED_STATES.has(sit.state)) return 'ALREADY';
    if (!CLOSE_REASONS.includes(ev.reason)) return 'BAD_VALUE';
    const rep = sit.sitrep_id && cx.get('sitreps', sit.sitrep_id);
    if (!rep?.signed_at) return 'I7_NO_SITREP';
    if (!closable(cx, sit)) return 'I7_OPEN_LADDER';
    cx.patch('situations', sit.sit_id, {
      state: 'CLOSED',
      closed_at: iso(at),
      closed_by: ev.by,
      close_reason: ev.reason,
      decided_at: ev.decided_at ? iso(ev.decided_at) : undefined,
    });
    human(cx, ev, at);
    return null;
  },

  /**
   * B7 (review R13 S2-5): the supervisor countersigns a watch message
   * (`VALE / ORTEGA` on a DETAIL reply) with an event of his own.
   */
  'message.countersign'(cx, ev, at) {
    const i = cx.next.messages.findIndex((m) => m.id === ev.message_id);
    if (i < 0) return 'NOT_FOUND';
    const m = cx.next.messages[i];
    if (m.by === ev.by) return 'I2_SAME_PERSON';
    if (m.countersigned_by) return 'ALREADY';
    const list = cx.coll('messages');
    list[i] = { ...m, countersigned_by: ev.by, countersigned_at: iso(at) };
    human(cx, ev, at);
    return null;
  },

  /**
   * B7 (fix list #14): the client's security lead opens a record on the
   * client viewer screen. Read-only: it changes nothing but the access log.
   */
  'record.view'(cx, ev, at) {
    if (!cx.next.clientViewer || ev.by !== cx.next.clientViewer)
      return 'NOT_VIEWER';
    if (ev.sit_id && !cx.get('situations', ev.sit_id)) return 'NOT_FOUND';
    if (ev.sitrep_id && !cx.get('sitreps', ev.sitrep_id)) return 'NOT_FOUND';
    cx.append('views', {
      id: ev.id ?? null,
      at: iso(at),
      by: ev.by,
      record: ev.record ?? (ev.sit_id ? 'situation' : 'daily'),
      sit_id: ev.sit_id ?? null,
      sitrep_id: ev.sitrep_id ?? null,
      surface: ev.surface ?? 'client viewer screen',
    });
    return null;
  },

  // ---------------------------------------------- reversals (EP-33 §3, B4)

  'intel.restore'(cx, ev, at) {
    const rec = cx.get('intel', ev.bundle_id);
    if (!rec) return 'NOT_FOUND';
    if (!rec.decided || !['dismiss', 'watch'].includes(rec.decided.kind))
      return 'ALREADY';
    cx.patch('intel', rec.bundle_id, {
      status: rec.sit_id
        ? 'raised'
        : rec.match
          ? 'matched'
          : rec.banner
            ? 'banner'
            : 'feed',
      decided: null,
      not_raised_reason: rec.sit_id
        ? null
        : rec.intake_reason || (rec.match ? 'restored' : rec.reason_engine),
      restored: {
        by: ev.by,
        at: iso(at),
        reverses: ev.reverses,
        of: clone(rec.decided),
      },
    });
    human(cx, ev, at);
    return null;
  },

  'verification.reopen'(cx, ev, at) {
    const sit = cx.get('situations', ev.sit_id);
    if (!sit) return 'NOT_FOUND';
    if (CLOSED_STATES.has(sit.state)) return 'CLOSED';
    const v =
      sit.verification_id && cx.get('verifications', sit.verification_id);
    if (!v) return 'NOT_FOUND';
    const push = sit.push_id && cx.get('pushes', sit.push_id);
    if (push && !push.recalled_at) return 'UNDO_LOWERS';
    cx.patch('verifications', v.id, {
      reversed_at: iso(at),
      reversed_by: ev.by,
      reversed_event: ev.reverses,
    });
    cx.patch('situations', sit.sit_id, {
      state: 'RAISED',
      verification_id: null,
      last_verification_id: v.id,
    });
    const rec =
      sit.recommendation_id && cx.get('recommendations', sit.recommendation_id);
    if (rec?.status === 'approved')
      cx.patch('recommendations', rec.id, {
        status: 'draft',
        approved_by: null,
        approved_at: null,
      });
    human(cx, ev, at);
    return null;
  },

  'push.recall'(cx, ev, at) {
    const p = cx.get('pushes', ev.push_id);
    if (!p) return 'NOT_FOUND';
    const sit = cx.get('situations', p.sit_id);
    if (!sit) return 'NOT_FOUND';
    if (CLOSED_STATES.has(sit.state)) return 'CLOSED';
    if (p.recalled_at || p.superseded_by) return 'ALREADY';
    if (reading(p)) return 'RECALL_AFTER_READ';
    const reason = String(ev.reason || '').trim();
    if (!reason) return 'NO_REASON';
    if (capBreach('dismissalReason', reason)) return 'CAP';
    cx.patch('pushes', p.push_id, {
      recalled_at: iso(at),
      recalled_by: ev.by,
      recall_reason: reason,
    });
    const rec = cx.get('recommendations', p.recommendation_id);
    if (rec) cx.patch('recommendations', rec.id, { status: 'recalled' });
    const v =
      sit.verification_id && cx.get('verifications', sit.verification_id);
    cx.patch('situations', sit.sit_id, {
      state: v ? DECISIONS[v.decision] : 'RAISED',
      next_update_at: null,
    });
    const cb = cx.get('callbacks', p.push_id);
    if (cb && !cb.resolved_at)
      cx.patch('callbacks', p.push_id, {
        resolved_at: iso(at),
        resolved_by: ev.by,
        outcome: 'recalled',
      });
    human(cx, ev, at);
    return null;
  },

  'situation.reopen'(cx, ev, at) {
    const sit = cx.get('situations', ev.sit_id);
    if (!sit) return 'NOT_FOUND';
    if (!CLOSED_STATES.has(sit.state)) return 'NOT_CLOSED';
    if (!REOPEN_REASONS.includes(ev.reason)) return 'BAD_VALUE';
    cx.patch('situations', sit.sit_id, {
      state: reopenState(cx, sit),
      closed_at: null,
      closed_by: null,
      close_reason: null,
      decided_at: undefined,
      reopened: [
        ...(sit.reopened || []),
        { at: iso(at), by: ev.by, reason: ev.reason, reverses: ev.reverses },
      ],
    });
    // The SITREP keeps v1 and gains an unsigned v2 (EP-33 §3).
    const rep = sit.sitrep_id && cx.get('sitreps', sit.sitrep_id);
    if (rep) {
      const { meta: _m, versions = [], ...old } = rep;
      cx.set('sitreps', rep.id, {
        ...old,
        version: rep.version + 1,
        drafted_by: ev.by,
        drafted_at: iso(at),
        signed_by: null,
        signed_at: null,
        signed: null,
        reopened_from: rep.version,
        versions: [...versions, old],
      });
    }
    human(cx, ev, at);
    return null;
  },

  'clock.start'(cx, ev) {
    cx.put('clock', {
      ...cx.next.clock,
      paused: false,
      rate: Number(ev.rate) || cx.next.clock.rate,
    });
    return null;
  },
  'clock.pause'(cx) {
    cx.put('clock', { ...cx.next.clock, paused: true });
    return null;
  },
  'clock.resume'(cx) {
    cx.put('clock', { ...cx.next.clock, paused: false });
    return null;
  },
  'clock.jump'(cx, ev, at) {
    const to = ms(ev.to);
    if (!Number.isFinite(to)) return 'BAD_EVENT';
    if (to < ms(cx.prev.clock.simNow)) return 'I12_TIME';
    tick(cx, to);
    cx.put('clock', { ...cx.next.clock, simNow: iso(Math.max(to, at)) });
    return null;
  },
  'beat.go'(cx, ev, at) {
    const anchor = cx.next.beats[ev.n];
    if (!anchor) return 'NOT_FOUND';
    if (ms(anchor) < ms(cx.prev.clock.simNow)) return 'I12_TIME';
    tick(cx, ms(anchor));
    cx.put('clock', {
      ...cx.next.clock,
      simNow: iso(Math.max(ms(anchor), at)),
      beat: Number(ev.n),
    });
    return null;
  },
  reset() {
    return null;
  },
};

function recFields(ev) {
  const out = {};
  for (const k of [
    'bluf',
    'action',
    'secondary_action',
    'action_display',
    'by_when',
    'by_when_display',
    'destination',
    'why',
    'request',
    'note',
    'valid_until',
    'valid_until_display',
    'requires_ack',
    'reply',
    'known',
    'unknown',
    'next_update_at',
    'next_update_display',
    'official_instruction',
    'subordinate',
    'conflicts_official',
    'unconfirmed',
    'sources_cited',
    'mode_change',
    'main_short',
    'callback_chain',
    'read_timeout_min',
  ])
    if (ev[k] !== undefined) out[k] = clone(ev[k]);
  out.recipients = (ev.recipients || []).map((r) =>
    typeof r === 'string'
      ? { participant_id: r, role: null, required_rung: 'accepted' }
      : { ...r, required_rung: r.required_rung || 'accepted' },
  );
  return out;
}

function checkRecommendation(cx, sit, rec) {
  try {
    checkBluf(rec.bluf);
  } catch {
    return 'BLUF';
  }
  if (rec.action && !ACTIONS.includes(rec.action)) return 'BAD_VALUE';
  const list = (rec.recipients || []).map((r) =>
    typeof r === 'string' ? r : r.participant_id,
  );
  if (!list.length) return 'BAD_VALUE';
  for (const pid of list) if (!cx.get('people', pid)) return 'NOT_FOUND';
  if (sit.tier === 'DETAIL') {
    const d = cx.get('details', cx.get('people', sit.person_id)?.detail_id);
    if (
      list.includes(sit.person_id) ||
      (d && list.some((pid) => pid === d.principal || pid === d.also_covers))
    )
      return 'A1_PRINCIPAL';
  }
  return null;
}
