// SafeTrekr Executive: what each surface may see of the loop (EP-35 §§1,
// 4, 7). Pure selectors; nothing here is stored. The relay sends a `main`
// wall selectMain(loop), a phone selectPhone(loop, its participant), and
// other walls the loop itself.
//
// I3: MAIN sees verified situations only, and only callsign, leg, BLUF,
// ladder and next update. It never reads `intel`, a name or a note.
import {
  counter as counterLine,
  legShort,
  localTime,
  mainRow as formatMainRow,
  watchTime,
} from '../format.js';
import { legWindow } from './match.js';

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
const now = (loop) => ms(loop.clock.simNow);
const RUNG_WORD = {
  delivered: 'DELIVERED',
  read: 'READ',
  accepted: 'ACCEPTED',
  done: 'DONE',
};
const RUNG_ORDER = ['delivered', 'read', 'accepted', 'done'];
/** States in which a verified situation is on MAIN (I3). */
export const MAIN_STATES = Object.freeze([
  'PUSHED',
  'ACKED',
  'NONCONCUR',
  'DONE',
]);

/** EP-35 §4: all five are selectors, never stored. */
export function selectCounter(loop) {
  const t = now(loop);
  const intel = Object.values(loop.intel);
  const sits = Object.values(loop.situations);
  return {
    in: intel.filter((b) => ms(b.ingested_at) <= t).length,
    matched: intel.filter((b) => b.matched_at && ms(b.matched_at) <= t).length,
    raised: sits.length,
    pushed: sits.filter((s) => s.push_id).length,
    closed: sits.filter(
      (s) => s.sitrep_id && loop.sitreps[s.sitrep_id]?.signed_at,
    ).length,
  };
}

/** The queue: raised and not yet verified, or a DETAIL item awaiting its countersign. */
export function selectQueue(loop) {
  const t = now(loop);
  const items = [];
  for (const s of Object.values(loop.situations)) {
    if (s.state === 'CLOSED' || s.push_id) continue;
    const v = s.verification_id && loop.verifications[s.verification_id];
    let awaiting = null;
    if (s.state === 'RAISED' || s.state === 'VERIFYING')
      awaiting = 'verification';
    else if (
      s.tier === 'DETAIL' &&
      v &&
      !v.countersigned_by &&
      ['VERIFIED', 'UNCONFIRMED'].includes(s.state)
    )
      awaiting = 'countersign';
    if (!awaiting) continue;
    const leg = loop.legs[s.leg_id];
    const [ws] = leg ? legWindow(leg) : [Infinity];
    items.push({
      sit_id: s.sit_id,
      callsign: s.callsign,
      leg_id: s.leg_id,
      why_raised: s.why_raised,
      raised_at: s.raised_at,
      awaiting,
      time_to_exposure_s: s.exposure_at
        ? Math.max(0, Math.round((ms(s.exposure_at) - t) / 1000))
        : null,
      overdue: awaiting === 'verification' && ws <= t,
      age_min: Math.floor((t - ms(s.raised_at)) / 60e3),
    });
  }
  return items.sort(
    (a, b) =>
      (a.time_to_exposure_s ?? Infinity) - (b.time_to_exposure_s ?? Infinity) ||
      ms(a.raised_at) - ms(b.raised_at),
  );
}

/** `Queue: 3 awaiting · oldest 4 min[ · 1 overdue][ · 1 awaiting countersign]`. */
export function queueLine(items) {
  if (!items.length) return 'Queue: empty';
  const oldest = Math.max(...items.map((i) => i.age_min));
  const over = items.filter((i) => i.overdue).length;
  const cs = items.filter((i) => i.awaiting === 'countersign').length;
  return `Queue: ${items.length} awaiting · oldest ${oldest} min${over ? ` · ${over} overdue` : ''}${cs ? ` · ${cs} awaiting countersign` : ''}`;
}

/**
 * The rung a MAIN row shows: the furthest rung the people the push is for
 * have reached (a support recipient, such as the car-service contact, does
 * not move it), timed when the last of them reached it.
 */
function ladderWord(loop, s, push) {
  const cb = loop.callbacks[push.push_id];
  if (cb && !cb.resolved_at)
    return { callback: { minutes: push.read_timeout_min } };
  if (s.state === 'EXPIRED') return { state: 'EXPIRED' };
  const all = push.order.map((pid) => push.recipients[pid]);
  const people = all.filter((r) => r.role === 'person');
  const rs = people.length ? people : all;
  const top = Math.max(...rs.map((r) => RUNG_ORDER.indexOf(r.rung)));
  if (top < 0) return { state: 'PUSHED' };
  const rung = RUNG_ORDER[top];
  const at = rs
    .filter((r) => r.rung === rung)
    .map((r) => r.at[rung])
    .sort()
    .pop();
  return { state: RUNG_WORD[rung], stateAt: at };
}

/**
 * One MAIN row for a situation, or a refusal (I3): only a verified
 * situation in a MAIN state, and a DETAIL item once its leader answers.
 */
export function mainRowFor(loop, sitId) {
  const s = loop.situations[sitId];
  if (!s) return { refused: { code: 'NOT_FOUND' } };
  const v = s.verification_id && loop.verifications[s.verification_id];
  const push = s.push_id && loop.pushes[s.push_id];
  if (!v || !push || !MAIN_STATES.includes(s.state))
    return { refused: { code: 'I3_NOT_ON_MAIN' } };
  const dlRec =
    push.tier === 'DETAIL' ? push.recipients[push.order[0]]?.dl : null;
  if (push.tier === 'DETAIL' && !dlRec)
    return { refused: { code: 'I3_NOT_ON_MAIN' } };
  const rec = loop.recommendations[push.recommendation_id];
  const leg = loop.legs[s.leg_id];
  const parts = {
    callsign: s.callsign,
    leg: legShort(leg),
    short: rec?.main_short ?? null,
    tz: leg?.tz,
    nextUpdateAt: s.next_update_at,
    ...(dlRec
      ? { dl: { answer: dlRec.answer, plan: dlRec.plan } }
      : ladderWord(loop, s, push)),
  };
  let row = null;
  try {
    row = formatMainRow(parts);
  } catch {
    row = null;
  }
  return {
    row: {
      callsign: s.callsign,
      leg: parts.leg,
      bluf: rec?.bluf ?? null,
      ladder: dlRec
        ? `DL: ${dlRec.answer}`
        : parts.callback
          ? 'calling'
          : (parts.state ?? null),
      next_update_at: s.next_update_at ?? null,
      text: row,
    },
  };
}

function mmss(msDiff) {
  const s = Math.max(0, Math.floor(msDiff / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Everything a `main` wall receives. Never the loop. */
export function selectMain(loop) {
  const t = now(loop);
  const rows = [];
  for (const s of Object.values(loop.situations)) {
    const r = mainRowFor(loop, s.sit_id);
    if (r.row) rows.push({ ...r.row, raised_at: s.raised_at });
  }
  rows.sort((a, b) => ms(a.raised_at) - ms(b.raised_at));
  for (const r of rows) delete r.raised_at;
  const closed = Object.values(loop.situations)
    .filter((s) => s.state === 'CLOSED' && s.verification_id)
    .map((s) => {
      const signer = loop.sitreps[s.sitrep_id]?.signed_by ?? null;
      const at = s.decided_at || s.closed_at;
      return {
        callsign: s.callsign,
        closed_at: at,
        signed_by: signer,
        text: `${s.callsign} · CLOSED ${watchTime(at)} · SITREP ${signer}`,
      };
    })
    .sort((a, b) => ms(a.closed_at) - ms(b.closed_at));
  const bands = [];
  for (const c of Object.values(loop.commsChecks))
    if (c.overdue) {
      const d = loop.details[c.detail_id];
      const cs = loop.people[d?.principal]?.callsign ?? null;
      bands.push({
        kind: 'comms_overdue',
        callsign: cs,
        text: `${cs} · comms check overdue ${mmss(t - ms(c.due_at))}`,
      });
    }
  const c = selectCounter(loop);
  const q = selectQueue(loop);
  const h = loop.lastHuman;
  return {
    sample: true,
    at: loop.clock.simNow,
    rows,
    empty: rows.length ? null : 'No active situations',
    closed,
    bands,
    counter: c,
    counterLine: counterLine(c),
    queueLine: queueLine(q),
    verifiedLine: h
      ? `Last verified by a human ${watchTime(h.at)} · ${h.by}`
      : null,
  };
}

const ALERT_PRIORITY = { P1: 'P1', P2: 'P2', P3: 'P3', P4: 'P4', P5: 'P5' };

/** A phone gets its own pushes (as the mobile `Alert`), messages and check-in state. */
export function selectPhone(loop, participantId) {
  const me = loop.people[participantId];
  if (!me) return null;
  const alerts = [];
  for (const p of Object.values(loop.pushes)) {
    const r = p.recipients[participantId];
    if (!r) continue;
    const s = loop.situations[p.sit_id];
    const rec = loop.recommendations[p.recommendation_id];
    const leg = loop.legs[s.leg_id];
    const card = p.phone?.[participantId] || {};
    alerts.push({
      id: p.push_id,
      tripId: leg?.trip_id ?? null,
      title:
        card.title ??
        `${(rec?.action || 'advisory').replace('_', ' ')} · ${legShort(leg)}`,
      message: card.body ?? rec?.bluf ?? '',
      buttons: card.buttons ?? [],
      toggle: card.toggle ?? null,
      priority: ALERT_PRIORITY[s.priority] ?? 'P3',
      category: rec?.action ?? null,
      createdAt: p.sent_at,
      expiresAt: p.valid_until,
      requiresAcknowledgment: Boolean(rec?.requires_ack),
      acknowledgedAt: r.at.accepted ?? null,
      acknowledgedByName: r.at.accepted ? me.callsign : null,
      arriveBy: rec?.by_when ?? null,
      readAt: r.at.read ?? null,
      createdBy: { name: p.sent_by, role: loop.watch[p.sent_by]?.role ?? null },
      bluf: rec?.bluf ?? null,
      action: rec?.action ?? null,
      unconfirmed: Boolean(p.unconfirmed),
      header: p.unconfirmed ? p.header : null,
      rung: r.rung,
      dl: r.dl ? { answer: r.dl.answer } : null,
      expired: Boolean(p.expired_at),
      expiredAt: p.expired_at,
      sample: true,
    });
  }
  alerts.sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const messages = loop.messages
    .filter((m) => m.to === participantId)
    .map((m) => ({
      id: m.id,
      at: m.at,
      kind: m.kind,
      text: m.text,
      phone: m.phone ?? null,
      from: m.by,
    }));
  const req = loop.checkinRequests[participantId];
  return {
    sample: true,
    participant_id: participantId,
    callsign: me.callsign,
    tz: me.tz,
    sharing: me.sharing,
    alerts,
    messages,
    checkin:
      req && !req.answered_at ? { due_at: req.due_at, point: req.point } : null,
    next_checkin_due_at: me.next_checkin_due_at ?? null,
  };
}

const TAG = (b) =>
  b.live_stand_in && b.source_tag === 'LIVE'
    ? b.live_stand_in
    : b.partner_feed
      ? 'PARTNER FEED'
      : b.source_tag || 'SAMPLE';

/** The Intel feed: newest first; each with its status line. */
export function selectFeed(loop, { limit = 50 } = {}) {
  const t = now(loop);
  const items = Object.values(loop.intel)
    .filter((b) => ms(b.ingested_at) <= t)
    .map((b) => {
      let line;
      if (b.status === 'raised')
        line = `RAISED · ${loop.situations[b.sit_id]?.why_raised ?? ''}`;
      else if (b.status === 'linked')
        line = `linked · ${loop.situations[b.linked_to]?.callsign ?? 'situation'}`;
      else if (b.status === 'banner')
        line = `not raised: region, banner only · ${(b.banner || []).join(', ')}`;
      else if (b.not_raised_reason)
        line = `not raised: ${b.not_raised_reason}${b.decided ? ` · ${b.decided.by}` : ''}`;
      else line = b.status;
      return {
        kind: 'bundle',
        bundle_id: b.bundle_id,
        at: b.ingested_at,
        title: b.title,
        source_class: b.source_class,
        tag: TAG(b),
        grade: b.grade,
        priority: b.operational_priority,
        status: b.status,
        line,
        collapse:
          b.file === 'mentions' && b.source_count > 1
            ? `${b.source_count} re-shares · one item`
            : null,
        sample: true,
      };
    });
  for (const s of Object.values(loop.salutes))
    items.push({
      kind: 'salute',
      salute_id: s.salute_id,
      at: s.filed_at,
      title: s.activity,
      tag: s.feed_tag ?? `HUMAN · ${loop.people[s.person_id]?.callsign ?? ''}`,
      grade: `${s.source_rating}${s.info_credibility}`,
      status: 'human',
      line: s.sit_id
        ? `HUMAN · inside ${loop.situations[s.sit_id]?.callsign ?? ''}`
        : 'HUMAN',
      sample: true,
    });
  return items
    .sort(
      (a, b) =>
        ms(b.at) - ms(a.at) ||
        ((a.bundle_id || a.salute_id) < (b.bundle_id || b.salute_id) ? 1 : -1),
    )
    .slice(0, limit);
}

/** The local time strip for MAIN: active cities only (EP-36 §2.1). */
export function selectTimeStrip(loop, cities) {
  const t = loop.clock.simNow;
  return `${cities.map(([name, tz]) => `${name.toUpperCase()} ${localTime(t, tz)}`).join(' · ')} · ${watchTime(t)}`;
}
