// SafeTrekr Executive B5: what one mock phone may see (EP-32 §4, EP-35 §7,
// EP-36 §2, EP-37 §§3–4, 8, 11). Pure: a function of the loop, the bound
// participant and the host's script hints; nothing is stored.
//
//   phoneViewModel(loop, participantId, {script, watchName}) → view | null
//
// Built on selectPhone (loop/select.js, read-only here) and adds what the
// Traveler app shows: the person's own name (names only on phones and the
// desk), the order fields of each push (EP-37 §3 phone order), the ladder
// as caption rows local first, recalled and superseded pushes shown as
// such (EP-33 §3), the privacy state (WREN's sharing is her own act), the
// call-back attempts made to this person only, own SALUTEs, own check-ins
// and, for a detail leader, the comms check. Every display string is made
// here, local first (`1215L (1715Z)`), so the page only sets textContent.
//
// I10 / privacy: nothing about another person leaves this function. A push
// appears only if this person is a recipient; a message only if it is
// addressed to them; a call-back step only if it called them; positions
// never (a phone shows its own sharing state, not a fix).
import { selectPhone } from '../loop/select.js';
import { localTime, lz, watchTime } from '../format.js';

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
const RUNGS = ['delivered', 'read', 'accepted', 'done'];
const RUNG_WORD = {
  delivered: 'Delivered',
  read: 'Read',
  accepted: 'Accepted',
  done: 'Done',
};
const DL_WORD = {
  concur: 'CONCUR',
  nonconcur: 'NON-CONCUR',
  executing: 'EXECUTING',
  request_support: 'REQUEST SUPPORT',
};
/** EP-32 §4: P1 critical, P2 danger, then the app's lower tiers. */
const SEVERITY = {
  P1: 'critical',
  P2: 'danger',
  P3: 'warning',
  P4: 'info',
  P5: 'ambient',
};
/** EP-37 §1: what a push is, per protection. */
const KIND = {
  DETAIL: ['recommendation', 'Recommendation to the detail leader'],
  REMOTE: ['instruction', 'Instruction from the watch'],
  MONITORED: ['advisory', 'Advisory from the watch'],
};
const PROTECTION_LINE = {
  DETAIL: 'Detail · the detail leader decides',
  REMOTE: 'Remote protection · the watch is your detail',
  MONITORED: 'Monitored · duty of care',
  ROUTINE: 'Routine',
};
/** The fields of a scripted phone event a hint may carry (its own data only). */
const HINT_FIELDS = {
  ack: ['push_id', 'sit_id', 'rung', 'source', 'reply_word'],
  'dl.respond': [
    'push_id',
    'sit_id',
    'answer',
    'reason',
    'plan',
    'principal_informed',
  ],
  'salute.file': [
    'sit_id',
    'size',
    'activity',
    'unit',
    'equipment',
    'time',
    'location',
  ],
  'checkin.respond': ['status', 'text', 'point', 'kind', 'push_id', 'sit_id'],
  'sharing.set': ['on', 'state'],
};
const PLACE_KEYS = ['name', 'lat', 'lon', 'accuracy_m', 'precision', 'mgrs'];

/**
 * A scripted phone event → the hint a phone pre-fills a form with (the
 * fields a phone may send, plus the scripted time for ordering).
 */
export function scriptHint(ev) {
  const keys = HINT_FIELDS[ev?.type];
  if (!keys) return null;
  const out = { type: ev.type, at: ev.at };
  for (const k of keys) {
    if (ev[k] === undefined || ev[k] === null) continue;
    if (k === 'location' && typeof ev[k] === 'object') {
      const p = {};
      for (const pk of PLACE_KEYS) if (ev[k][pk] != null) p[pk] = ev[k][pk];
      out[k] = p;
    } else out[k] = ev[k];
  }
  return out;
}

function sharingOf(me, retier) {
  const s = me.sharing;
  const every = me.checkin_every_min;
  const cadence = every ? `Check-ins every ${every / 60} h.` : null;
  switch (s) {
    case 'on':
      return {
        state: 'on',
        on: true,
        line: retier
          ? 'Location sharing on: watch level raised.'
          : 'Location sharing on',
        sub: cadence || 'You can pause it any time.',
      };
    case 'requested':
      return {
        state: 'requested',
        on: false,
        requested: true,
        line: 'The watch asks you to turn location sharing on',
        sub: 'Sharing stays off until you turn it on. You can pause it any time.',
      };
    case 'paused':
      return {
        state: 'paused',
        on: false,
        line: 'Location sharing paused',
        sub: 'You paused it. Check-ins still reach the watch.',
      };
    case 'check_in_only':
      return {
        state: 'check_in_only',
        on: false,
        line: 'Location sharing paused · shared at check-ins only',
        sub: 'Your position goes to the watch only when you check in.',
      };
    case 'continuous':
      return {
        state: 'continuous',
        on: true,
        line: 'Sharing location on travel days',
        sub: 'Agreed in your protection agreement (SAMPLE).',
      };
    case 'on_shift_only':
      return {
        state: 'on_shift_only',
        on: true,
        line: 'Sharing location on shift only',
        sub: 'Nothing is collected off shift.',
      };
    case 'detail_devices':
      return {
        state: 'detail_devices',
        on: false,
        line: 'Your detail carries the tracked devices',
        sub: 'This phone does not share your location.',
      };
    default:
      return { state: s ?? null, on: false, line: null, sub: null };
  }
}

function cardLine(card, prefix) {
  const l = (card || []).find((x) => String(x).startsWith(prefix));
  return l ? String(l).slice(prefix.length).trim() : null;
}

/** EP-37 §3: the phone order, every slot that has a value. */
function orderRows(rec, push, tz) {
  if (!rec) return [];
  const rows = [];
  const add = (k, v) => v && rows.push({ k, v });
  add(
    'ACTION',
    rec.action_display ||
      String(rec.action || '')
        .replace('_', ' ')
        .toUpperCase(),
  );
  add('BY', rec.by_when_display || (rec.by_when && lz(rec.by_when, tz)));
  add('WHERE', rec.destination?.name);
  add('REQUEST', rec.request);
  add('WHY', rec.why);
  add(
    'VALID UNTIL',
    rec.valid_until_display || (rec.valid_until && lz(rec.valid_until, tz)),
  );
  add('REPLY', rec.reply);
  add(
    'NEXT UPDATE',
    rec.next_update_display ||
      (rec.next_update_at && lz(rec.next_update_at, tz)),
  );
  add('KNOWN', rec.known);
  add('NOT KNOWN', rec.unknown);
  add(
    'OFFICIAL INSTRUCTION',
    cardLine(push.card, 'Official instruction:')?.replace(
      / · (Verified |[A-Z]{3,} \d{4}Z).*$/,
      '',
    ) || (rec.official_instruction === 'none on file' ? 'none on file' : null),
  );
  return rows;
}

function signedLine(v) {
  if (!v) return null;
  const hm = (t) =>
    new Date(ms(t)).toISOString().slice(11, 16).replace(':', '') + 'Z';
  const parts = [];
  if (v.verified_by && v.verified_at)
    parts.push(`Verified ${v.verified_by} ${hm(v.verified_at)}`);
  if (v.countersigned_by && v.countersigned_at)
    parts.push(`countersigned ${v.countersigned_by} ${hm(v.countersigned_at)}`);
  return parts.join(' · ') || null;
}

/**
 * The phone's view. `script`: the host's hints for this participant's
 * scripted replies still to come (scriptHint shapes). → null when the
 * participant is unknown.
 */
export function phoneViewModel(
  loop,
  participantId,
  { script = [], watchName = 'SafeTrekr Watch Floor' } = {},
) {
  const base = selectPhone(loop, participantId);
  if (!base) return null;
  const me = loop.people[participantId];
  const tz = me.tz || 'UTC';
  const L = (t) => (t ? lz(t, tz) : null);
  const nowMs = ms(loop.clock.simNow);
  const retier = (loop.retiers || []).filter(
    (r) => r.person_id === participantId && !r.reverses,
  );
  const detail = me.detail_id ? loop.details?.[me.detail_id] : null;

  const alerts = base.alerts.map((a) => {
    const push = loop.pushes[a.id];
    const r = push.recipients[participantId];
    const rec = loop.recommendations[push.recommendation_id];
    const sit = loop.situations[push.sit_id];
    const v = loop.verifications?.[push.verification_id];
    const tier = push.tier || sit?.tier;
    const [kind, kindLine] = KIND[tier] || KIND.MONITORED;
    const next = push.superseded_by && loop.pushes[push.superseded_by];
    const nextCard = next?.phone?.[participantId];
    const state = push.recalled_at
      ? 'recalled'
      : push.superseded_by
        ? 'superseded'
        : push.expired_at
          ? 'expired'
          : 'active';
    const dl = r.dl
      ? {
          answer: r.dl.answer,
          word: DL_WORD[r.dl.answer] || String(r.dl.answer).toUpperCase(),
          reason: r.dl.reason ?? null,
          plan: r.dl.plan ?? null,
          principalInformed: Boolean(r.dl.principal_informed),
          at: r.dl.at,
          line: L(r.dl.at),
        }
      : null;
    const ladder = RUNGS.map((g) => ({
      rung: g,
      word: g === 'accepted' && dl ? dl.word : RUNG_WORD[g],
      at: r.at[g] ?? null,
      line: L(r.at[g]),
    }));
    return {
      id: a.id,
      push_id: a.id,
      sit_id: push.sit_id,
      sample: true,
      kind,
      kindLine,
      tier,
      header: push.header || (a.unconfirmed ? 'UNCONFIRMED · SAMPLE' : null),
      unconfirmed: a.unconfirmed,
      title: a.title,
      body: a.message,
      buttons: a.buttons,
      toggle: a.toggle,
      priority: a.priority,
      severity: SEVERITY[a.priority] || 'warning',
      bluf: rec?.bluf ?? a.message,
      rows: orderRows(rec, push, tz),
      card: push.card ?? [],
      sender: `${push.sent_by} · ${watchName}`,
      signed: signedLine(v),
      sentAt: push.sent_at,
      sentLine: L(push.sent_at),
      role: r.role,
      replyWord: r.reply_word,
      requiredRung: r.required_rung,
      rung: r.rung,
      ladder,
      dl,
      state,
      canAct: state === 'active' && sit?.state !== 'CLOSED',
      closed: sit?.state === 'CLOSED',
      recalled: push.recalled_at
        ? {
            at: push.recalled_at,
            line: L(push.recalled_at),
            by: push.recalled_by ?? null,
            reason: push.recall_reason ?? null,
          }
        : null,
      superseded: push.superseded_by
        ? {
            at: push.superseded_at,
            line: L(push.superseded_at),
            by: push.superseded_by,
            byTitle: nextCard?.title ?? null,
          }
        : null,
      supersedes: push.supersedes ?? null,
      expired: push.expired_at
        ? { at: push.expired_at, line: L(push.expired_at) }
        : null,
    };
  });

  const sigs = new Map(
    loop.messages
      .filter((x) => x.to === participantId)
      .map((x) => [x.id, x.signature]),
  );
  const messages = base.messages.map((m) => ({
    id: m.id,
    at: m.at,
    atLine: L(m.at),
    kind: m.kind,
    text: m.text ?? null,
    from: m.from,
    fromLine: `${m.from} · ${watchName}`,
    signature: sigs.get(m.id) ?? m.from ?? null,
    card: m.phone
      ? {
          title: m.phone.title ?? null,
          body: m.phone.body ?? null,
          buttons: m.phone.buttons ?? [],
        }
      : null,
    sample: true,
  }));

  // Call-back attempts that called this person (never another contact's).
  const calls = [];
  for (const cb of Object.values(loop.callbacks || {}))
    for (const s of cb.steps || [])
      if (s.contact_ref === participantId)
        calls.push({
          at: s.at,
          atLine: L(s.at),
          outcome: s.outcome,
          line:
            s.outcome === 'reached'
              ? `Call from ${watchName}`
              : `Missed call · ${watchName}`,
          answered: Boolean(cb.resolved_at && ms(cb.resolved_at) <= nowMs),
        });

  const salutes = Object.values(loop.salutes || {})
    .filter((s) => s.person_id === participantId)
    .sort((a, b) => ms(b.filed_at) - ms(a.filed_at))
    .map((s) => ({
      id: s.salute_id,
      filedLine: L(s.filed_at),
      rows: [
        ['SIZE', s.size],
        ['ACTIVITY', s.activity],
        [
          'LOCATION',
          s.location
            ? [s.location.name, s.location.mgrs].filter(Boolean).join(' · ')
            : null,
        ],
        ['UNIT', s.unit],
        [
          'TIME',
          s.time ? `${watchTime(s.time)} (${localTime(s.time, tz)})` : null,
        ],
        ['EQUIPMENT', s.equipment],
      ].map(([k, v]) => ({ k, v: v || '—' })),
      tag: `HUMAN · ${s.source_rating ?? 'B'}${s.info_credibility ?? 2}`,
    }));

  const own = (loop.checkins || []).filter(
    (c) => c.person_id === participantId,
  );
  const stand = [...own].reverse().find((c) => c.status === 'stand_down');
  // Own check-ins by time only: their free text may name a companion.
  const lastCheckin = own.filter((c) => c.status !== 'stand_down').at(-1);
  let comms = null;
  if (detail && detail.leader === participantId) {
    const c = loop.commsChecks?.[detail.id];
    if (c)
      comms = {
        dueAt: c.due_at,
        dueLine: L(c.due_at),
        answered: Boolean(c.answered_at),
        overdue: Boolean(c.overdue),
        due: !c.answered_at && ms(c.due_at) <= nowMs,
      };
  }

  return {
    sample: true,
    sampleLine: 'SAMPLE · fictional people, places in use, messages',
    participant_id: participantId,
    callsign: me.callsign,
    name: me.name,
    initials: me.initials ?? null,
    role: me.title ?? me.role ?? null,
    protection: me.protection,
    protectionLine: PROTECTION_LINE[me.protection] ?? me.protection,
    tz,
    city: me.current_city ?? null,
    phoneLine: me.phone_display ?? null,
    watch: { name: watchName },
    now: loop.clock.simNow,
    nowLine: L(loop.clock.simNow),
    nowLocal: lz(loop.clock.simNow, tz).slice(0, 4),
    sharing: {
      ...sharingOf(me, retier.length > 0),
      canPause: me.consent?.can_pause !== false,
      setAt: me.sharing_set_at ?? null,
    },
    retier: retier.length
      ? {
          line: `Watch level raised · ${retier.at(-1).from} → ${retier.at(-1).to}`,
          untilLine: retier.at(-1).until ? L(retier.at(-1).until) : null,
          atLine: L(retier.at(-1).at),
        }
      : null,
    checkin: base.checkin
      ? {
          due_at: base.checkin.due_at,
          dueLine: L(base.checkin.due_at),
          point: base.checkin.point,
        }
      : null,
    nextCheckinLine: L(base.next_checkin_due_at),
    detail: detail
      ? {
          name: `${loop.people[detail.principal]?.callsign ?? ''} detail`.trim(),
          leader: detail.leader === participantId,
          advance: detail.advance_agent === participantId,
          roleLine:
            detail.leader === participantId
              ? 'Detail leader'
              : detail.advance_agent === participantId
                ? 'Advance agent'
                : 'Detail agent',
        }
      : null,
    comms,
    standDown: stand ? { atLine: L(stand.at), text: stand.text } : null,
    alerts,
    messages,
    calls,
    salutes,
    lastCheckinLine: lastCheckin ? L(lastCheckin.at) : null,
    script: script.filter(Boolean),
  };
}
