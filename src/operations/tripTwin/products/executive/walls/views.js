// SafeTrekr Executive B3: what each wall shows, as plain data (no DOM).
// Pure functions of the loop (and the walls' map data); walls.test.mjs runs
// them over the scripted day. Walls show callsigns, never names (EP-38 #3):
// every free text from the data passes scrub(), which puts a callsign where
// a roster name stands. Times follow EP-34 §2: Zulu first on the analyst
// walls, local first on MAIN and the Principal view.
import {
  counter as counterLine,
  distance,
  dtg,
  legShort,
  localTime,
  lz,
  watchTime,
  zl,
} from '../format.js';
import {
  queueLine,
  selectCounter,
  selectFeed,
  selectQueue,
} from '../loop/select.js';
import {
  beatOf,
  focusOf,
  legAt,
  postureCounts,
  SITE_OF_PLACE,
} from '../loop/wallData.js';
import { assembleRecord } from '../loop/record.js';

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
const now = (loop) => ms(loop.clock.simNow);

/** Executive wall roles and what each is called on its wall (EP-36 §2.1). */
export const ROLE_NAMES = Object.freeze({
  main: 'Main',
  verify: 'Verify',
  intel: 'Intel feed',
  roster: 'Roster map',
  principal: 'Principal view',
  trips: 'Roster by trip',
});
/** The school session role each executive wall runs on (EP-51 §"The path"). */
export const SESSION_ROLE = Object.freeze({
  main: 'site',
  verify: 'trips',
  intel: 'trips',
  roster: 'trips',
  principal: 'site',
  trips: 'trips',
});

export const POSTURES = Object.freeze([
  'ROUTINE',
  'ELEVATED',
  'HIGH',
  'CRITICAL',
]);
/** One to four bars (EP-32 §1); CRITICAL is amber with four (EP-38 #10). */
export const barsOf = (posture) => Math.max(1, POSTURES.indexOf(posture) + 1);

const RUNGS = ['delivered', 'read', 'accepted', 'done'];
const DL_WORD = {
  concur: 'CONCUR',
  nonconcur: 'NON-CONCUR',
  executing: 'EXECUTING',
  request_support: 'SUPPORT REQUESTED',
};
const ACTION_WORD = {
  advisory: 'Advisory',
  confirm_status: 'Confirm status',
  hold: 'Hold',
  reroute: 'Reroute',
  move: 'Move',
  shelter: 'Shelter',
  evacuate: 'Evacuate',
  no_change: 'No change: monitor',
};
const CHECKS = [
  ['archived', 'ARCHIVED'],
  ['identity', 'IDENTITY'],
  ['account', 'ACCOUNT'],
  ['corroboration', 'CORROBORATION'],
  ['place', 'PLACE'],
  ['schedule', 'SCHEDULE'],
  ['coordination', 'COORDINATION'],
];

/** Callsign of a participant (or a vehicle / watch callsign), never a name. */
export function callsignOf(loop, id) {
  if (!id) return '—';
  return (
    loop.people[id]?.callsign ??
    loop.watch?.[id]?.callsign ??
    (/^[A-Z][A-Z0-9 –-]*$/.test(id) ? id : '—')
  );
}

/** Every roster and watch name, longest first (the scrubber's list). */
function namesOf(loop) {
  if (loop.__names) return loop.__names;
  const out = [];
  for (const p of Object.values(loop.people || {}))
    if (p.name) out.push([p.name, p.callsign]);
  out.sort((a, b) => b[0].length - a[0].length);
  Object.defineProperty(loop, '__names', { value: out, enumerable: false });
  return out;
}
/** Free text for a wall: a roster name becomes the person's callsign. */
export function scrub(loop, text) {
  if (text == null) return '';
  let s = String(text);
  for (const [name, cs] of namesOf(loop))
    if (s.includes(name)) s = s.split(name).join(cs);
  return s;
}

/** A grade token: `C2`; dashed when the source is F or the information ≥ 3. */
export function gradeToken(g) {
  if (!g) return null;
  const text = typeof g === 'string' ? g : `${g.source}${g.info}`;
  const m = /^([A-F])([1-6])/.exec(text);
  return {
    text: text.slice(0, 2),
    dashed: Boolean(m && (m[1] === 'F' || Number(m[2]) >= 3)),
  };
}

const tzOfPerson = (loop, pid) => loop.people[pid]?.tz || 'UTC';

/** One recipient's ladder: four rungs, the DL's word in place of ACCEPTED. */
export function ladderOf(loop, push, pid) {
  const r = push.recipients[pid];
  const tz = tzOfPerson(loop, pid);
  const rungs = RUNGS.map((k) => {
    let word = k.toUpperCase();
    let at = r.at?.[k] ?? null;
    let tone = null;
    if (k === 'accepted' && r.dl) {
      word = DL_WORD[r.dl.answer] || word;
      at = r.dl.at ?? at;
      if (r.dl.answer === 'nonconcur') tone = 'amber';
    }
    return {
      word,
      at,
      time: at ? localTime(at, tz) : '—',
      done: Boolean(at),
      tone,
    };
  });
  const cur = rungs.findLastIndex((x) => x.done);
  return {
    who: `${callsignOf(loop, pid)} · ${r.role}`,
    rungs: rungs.map((x, i) => ({ ...x, current: i === cur })),
    reason: r.dl?.reason ? scrub(loop, r.dl.reason) : null,
  };
}

/** The call-back chain of a push, if one runs (EP-32 §2.4). */
export function chainOf(loop, push) {
  const cb = loop.callbacks[push.push_id];
  if (!cb) return null;
  const steps = (cb.steps || []).map(
    (s) =>
      `${s.role === 'person' ? `Called ${callsignOf(loop, s.contact_ref)}` : `Called ${s.role}`} · ${s.outcome} · ${watchTime(s.at)}`,
  );
  const next = cb.resolved_at
    ? null
    : cb.chain.find((c) => !cb.steps.some((s) => s.step === c.step));
  return {
    running: !cb.resolved_at,
    head: cb.resolved_at
      ? `call-back closed ${watchTime(cb.resolved_at)} · ${cb.outcome || 'answered'}`
      : `no read ${push.read_timeout_min} min · calling`,
    steps,
    next: next ? `next: ${next.role}` : null,
  };
}

/** The four answers of a detail leader, in his words (B7 #8). */
export const DL_REPLY = 'Concur / Non-concur / Executing / Request support';

/**
 * The official instructions a situation sits under (EP-33 §5, EP-38 #5):
 * the leg's, else any leg's with the recommendation's id; each `line` as
 * the authority wrote it. Ours is subordinate to them.
 */
export function officialsOf(loop, s, rec) {
  const own = loop.legs[s?.leg_id]?.official_instructions || [];
  const id = rec?.official_instruction;
  const out = [...own];
  if (id && !out.some((o) => o.id === id))
    for (const l of Object.values(loop.legs || {}))
      for (const o of l.official_instructions || [])
        if (o.id === id && !out.some((x) => x.id === id)) out.push(o);
  return out.map((o) => ({
    id: o.id,
    // The kicker says OFFICIAL once; the line need not repeat it.
    line: scrub(
      loop,
      String(o.line || '').replace(/^OFFICIAL · /, '') ||
        [
          o.kind === 'road_closure' ? 'Road closure' : 'Official',
          o.place?.name,
          o.authority_class,
        ]
          .filter(Boolean)
          .join(' · '),
    ),
  }));
}

/** The recommendation card (EP-32 §2.3): every slot, every time. */
export function recOf(loop, s) {
  const push = s.push_id ? loop.pushes[s.push_id] : null;
  const rec = loop.recommendations[s.recommendation_id];
  if (!rec) return null;
  const leg = loop.legs[s.leg_id];
  const tz = leg?.tz || 'UTC';
  const v = s.verification_id ? loop.verifications[s.verification_id] : null;
  // A DETAIL push is a recommendation, the detail leader's decision (B7
  // #8): no ACTION chip, no ACK line; his four answers as the reply.
  const detail = (push?.tier || s.tier) === 'DETAIL';
  const recips = (rec.recipients || []).map(
    (r) =>
      `${callsignOf(loop, r.participant_id)}${r.role && r.role !== 'person' ? ` (${r.role})` : ''}`,
  );
  const officials = officialsOf(loop, s, rec);
  return {
    detail,
    kicker: detail
      ? "RECOMMENDATION · THE DETAIL LEADER'S DECISION"
      : 'RECOMMENDATION',
    bluf: scrub(loop, rec.bluf),
    action: detail
      ? null
      : rec.action_display || ACTION_WORD[rec.action] || rec.action,
    official: officials.map((o) => o.line),
    subordinate: officials.length > 0,
    rows: [
      ['BY', rec.by_when ? lz(rec.by_when, tz) : '—'],
      ['WHERE', rec.destination?.name ?? '—'],
      ['TO', recips.join(' · ') || '—'],
      ['VALID UNTIL', rec.valid_until ? lz(rec.valid_until, tz) : '—'],
      [
        'REPLY',
        detail
          ? DL_REPLY
          : rec.reply || (rec.requires_ack ? 'required' : 'read only'),
      ],
      ...(rec.request ? [['REQUEST', scrub(loop, rec.request)]] : []),
      ['KNOWN', scrub(loop, rec.known) || '—'],
      ['NOT KNOWN', scrub(loop, rec.unknown) || '—'],
      [
        'NEXT UPDATE',
        rec.next_update_at ? localTime(rec.next_update_at, tz) : '—',
      ],
    ],
    sig: [
      v?.verified_by
        ? `verified ${v.verified_by} ${watchTime(v.verified_at)}`
        : null,
      v?.countersigned_by
        ? `countersigned ${v.countersigned_by} ${watchTime(v.countersigned_at)}`
        : null,
      push
        ? `pushed ${watchTime(push.sent_at)} · ${push.sent_by}`
        : 'not pushed',
      push?.recalled_at
        ? `RECALLED ${watchTime(push.recalled_at)} ${push.recalled_by} · reason: ${scrub(loop, push.recall_reason)}`
        : null,
    ]
      .filter(Boolean)
      .join(' · '),
    // Every push of the situation, newest first: a superseded card stays,
    // greyed, under the one that replaced it; a recalled one says so
    // (EP-33 §3, B4b request 1–2).
    ladders: pushesOf(loop, s).flatMap((p) =>
      p.order.map((pid) => ({
        ...ladderOf(loop, p, pid),
        state: pushState(p),
        note: pushNote(loop, p),
      })),
    ),
    pushes: pushesOf(loop, s).map((p) => ({
      id: p.push_id,
      state: pushState(p),
      text: `${p.push_id} · pushed ${watchTime(p.sent_at)} ${p.sent_by}${p.supersedes ? ` · supersedes ${p.supersedes}` : ''}${pushNote(loop, p) ? ` · ${pushNote(loop, p)}` : ''}`,
    })),
    recalled: Boolean(push?.recalled_at),
    chain: push ? chainOf(loop, push) : null,
    expired: Boolean(push?.expired_at),
  };
}

/** The pushes of a situation, newest first. */
export function pushesOf(loop, s) {
  return Object.values(loop.pushes || {})
    .filter((p) => p.sit_id === s.sit_id)
    .sort((a, b) => ms(b.sent_at) - ms(a.sent_at));
}
/** live · recalled · superseded · expired. */
export const pushState = (p) =>
  p.recalled_at
    ? 'recalled'
    : p.superseded_by
      ? 'superseded'
      : p.expired_at
        ? 'expired'
        : 'live';
/** `RECALLED 1605Z VALE · reason: …` / `SUPERSEDED 1607Z · see push-…`. */
export function pushNote(loop, p) {
  if (p.recalled_at)
    return `RECALLED ${watchTime(p.recalled_at)} ${p.recalled_by} · reason: ${scrub(loop, p.recall_reason)}`;
  if (p.superseded_by)
    return `SUPERSEDED ${watchTime(p.superseded_at)} · see ${p.superseded_by}`;
  if (p.expired_at) return `EXPIRED ${watchTime(p.expired_at)}`;
  return null;
}

const DECISION = {
  verified: 'VERIFIED',
  unconfirmed_actionable: 'UNCONFIRMED · ACTIONABLE',
  watch: 'WATCH',
  dismissed: 'DISMISSED',
};

/** The evidence card for one situation (EP-32 §2.2), Zulu first. */
export function evidenceOf(loop, s) {
  const t = now(loop);
  const v = s.verification_id ? loop.verifications[s.verification_id] : null;
  const bundles = (s.intel_ids || [])
    .map((id) => loop.intel[id])
    .filter(Boolean);
  const related = (s.related_intel_ids || [])
    .map((id) => loop.intel[id])
    .filter(Boolean);
  const head = bundles[0];
  const tags = [];
  if (v?.corroborated_by?.length) tags.push({ text: 'CORROBORATED' });
  if (v?.decision === 'unconfirmed_actionable')
    tags.push({
      text: 'UNCONFIRMED · ACTIONABLE',
      tone: 'amber',
      dashed: true,
    });
  if (bundles.some((b) => b.partner_feed))
    tags.push({ text: 'PARTNER FEED', tone: 'dim' });
  // HUMAN belongs to the SALUTE block (headed `SALUTE · HUMAN`), not to
  // the bundle's head, which is the social post (R16 S2-8, R18 S3-7).
  const sal = (s.salute_ids || []).map((id) => loop.salutes[id]).find(Boolean);
  const evidence = head?.evidence || {};
  const grade = gradeToken(v?.grade || s.grade);
  const sources = [...bundles, ...related].map((b) => {
    const corroborates = (v?.corroborated_by || []).includes(b.bundle_id);
    return {
      grade: gradeToken(b.grade),
      cls: b.source_class,
      at: watchTime(b.sent_at || b.received_at),
      text: scrub(loop, b.title),
      tag: b.partner_feed ? 'PARTNER FEED' : b.source_tag || 'SAMPLE',
      step: corroborates ? 'corroborates' : null,
      related: related.includes(b),
    };
  });
  if (sal)
    sources.push({
      grade: gradeToken(`${sal.source_rating}${sal.info_credibility}`),
      cls: 'Field report',
      at: watchTime(sal.filed_at),
      text: scrub(loop, sal.activity),
      tag: sal.feed_tag || 'HUMAN',
      human: true,
    });
  const raised = s.raised_at;
  const cs = v?.countersigned_at;
  const countersign =
    s.tier === 'DETAIL' && v
      ? cs
        ? `raised ${watchTime(raised)} → countersigned ${v.countersigned_by} ${watchTime(cs)} · +${Math.round((ms(cs) - ms(raised)) / 60e3)} min${v.countersigned_via === 'presenter' ? " · from the presenter's iPad" : ''}`
        : `raised ${watchTime(raised)} · awaiting ORTEGA · ${Math.max(0, Math.floor((t - ms(raised)) / 60e3))} min`
      : null;
  const retier = loop.retiers.find((r) => r.person_id === s.person_id);
  return {
    sit_id: s.sit_id,
    tier: s.tier,
    grade,
    gradeStep: (() => {
      const first = head?.members?.[0]?.grade || head?.grade;
      return v?.corroborated_by?.length && first && first !== grade?.text
        ? `${first} → ${grade?.text} · corroborated`
        : null;
    })(),
    source: head?.source_class ?? '—',
    tags,
    id: head?.bundle_id ?? s.sit_id,
    why: scrub(loop, s.why_raised),
    times: head
      ? `observed ${dtg(head.sent_at)} · received ${dtg(head.received_at).slice(0, 7)} · age ${Math.max(0, Math.round((t - ms(head.received_at)) / 60e3))} min`
      : '—',
    salute: sal
      ? (sal.card || []).map((line) => {
          const [k, ...rest] = line.split(' ');
          return [k, scrub(loop, rest.join(' ')) || '—'];
        })
      : null,
    checklist: CHECKS.map(([k, word]) => ({
      word,
      done: v?.checklist?.[k] === true,
      result: scrub(loop, shortWord(evidence[k])),
    })),
    sources,
    decision: v
      ? `${DECISION[v.decision] || v.decision.toUpperCase()} · ${v.verified_by} ${watchTime(v.verified_at)}`
      : s.state === 'RAISED' || s.state === 'VERIFYING'
        ? 'VALE assessing'
        : '—',
    countersign,
    notified: (v?.notified || []).map((n) => scrub(loop, n.text)),
    // The watch's own answers on the item (R11 S2-4, R13 S3): signed as sent.
    answers: (loop.messages || [])
      .filter(
        (m) => m.sit_id === s.sit_id && m.kind === 'watch_ack' && ms(m.at) <= t,
      )
      .map(
        (m) =>
          `WATCH ${watchTime(m.at)} · ${m.signature || callsignOf(loop, m.by)} · ${scrub(loop, m.text)}`,
      ),
    retier: retier
      ? `RE-TIER · ${retier.from} → ${retier.to} · ${retier.by} ${watchTime(retier.at)}${retier.via === 'presenter' ? " · from the presenter's iPad" : ''} · reason: ${scrub(loop, retier.reason)}`
      : null,
    rec: recOf(loop, s),
  };
}

/**
 * A short result from an evidence note (the checklist column): its first
 * clause, whole. Nothing truncates on a wall (EP-36 §4); the column wraps.
 */
export function shortWord(text) {
  if (!text) return '—';
  const s = String(text)
    .replace(/\b[lpbsv]-[a-z0-9-]+\b\s*/g, '')
    .split(/[;(]/)[0]
    .trim();
  return s || '—';
}

/** The situation a wall shows when nothing waits: the active one, else the latest today. */
export function beatSituation(loop) {
  const f = focusOf(loop);
  if (f.sit_id) return loop.situations[f.sit_id];
  const sits = Object.values(loop.situations)
    .filter((s) => !/^s-intel/.test(s.sit_id))
    .sort((a, b) => ms(b.raised_at) - ms(a.raised_at));
  return sits[0] || null;
}

/** The Verify wall (EP-32 §3.3). */
export function verifyView(loop) {
  const t = now(loop);
  const q = selectQueue(loop);
  const oldest = q.length ? Math.max(...q.map((i) => i.age_min)) : 0;
  const rows = q.map((i) => {
    const s = loop.situations[i.sit_id];
    return {
      grade: gradeToken(s.grade),
      callsign: i.callsign,
      why: scrub(loop, i.why_raised),
      age: `${i.age_min} min`,
      kicker: s.tier === 'DETAIL' ? '2-PERSON' : null,
      awaiting:
        i.awaiting === 'countersign'
          ? 'awaiting countersign'
          : 'awaiting verification',
      overdue: i.overdue,
    };
  });
  // Recalled pushes: back on Verify for a decision (B4b request 2); the
  // situation keeps its push id, so the queue itself skips it.
  const recalledSits = Object.values(loop.situations)
    .filter(
      (s) =>
        s.state !== 'CLOSED' &&
        s.push_id &&
        loop.pushes[s.push_id]?.recalled_at,
    )
    .sort((a, b) => ms(b.raised_at) - ms(a.raised_at));
  const recalled = recalledSits.map((s) => ({
    grade: gradeToken(s.grade),
    callsign: s.callsign,
    why: scrub(loop, s.why_raised),
    line: pushNote(loop, loop.pushes[s.push_id]),
  }));
  // Decided today, newest first (the queue's history, for the room).
  const decided = Object.values(loop.situations)
    .filter(
      (s) =>
        s.verification_id &&
        !q.some((i) => i.sit_id === s.sit_id) &&
        !recalledSits.includes(s),
    )
    .sort((a, b) => ms(b.raised_at) - ms(a.raised_at))
    .slice(0, 6)
    .map((s) => {
      const v = loop.verifications[s.verification_id];
      const replaced = pushesOf(loop, s).filter((p) => p.superseded_by).length;
      return {
        grade: gradeToken(v?.grade || s.grade),
        callsign: s.callsign,
        line: `${DECISION[v?.decision] || '—'} · ${v?.verified_by ?? ''} ${v?.verified_at ? watchTime(v.verified_at) : ''}${replaced ? ` · ${replaced} superseded` : ''}${s.state === 'CLOSED' ? ' · closed' : ''}`,
      };
    });
  const pick = q[0]
    ? loop.situations[q[0].sit_id]
    : recalledSits[0] || beatSituation(loop);
  // Beat 5 (EP-20): nothing waits, so the record of the beat's person
  // opens here, with the day summary beside it (EP-33 §8, privacy 2).
  const closing = beatOf(loop) >= 5 && !q.length && !recalledSits.length;
  const focus = closing ? focusOf(loop).sit_id : null;
  return {
    head: `NEEDS VERIFICATION · ${q.length}${q.length ? ` · oldest ${oldest} min` : ''}`,
    line: queueLine(q),
    rows,
    decided,
    recalled,
    card: pick ? evidenceOf(loop, pick) : null,
    cardWhy: q[0]
      ? 'oldest in the queue'
      : recalledSits[0]
        ? 'recalled · awaiting a new push'
        : pick
          ? pick.state === 'CLOSED'
            ? 'last decided today'
            : 'active situation'
          : null,
    record:
      focus && loop.situations[focus]
        ? assembleRecord(loop, { sitId: focus, audience: 'room' })
        : null,
    day: focus ? assembleRecord(loop, { audience: 'room' }) : null,
    at: t,
  };
}

/** Banners: region items within the last six hours (never a pin). */
function bannersOf(loop) {
  const t = now(loop);
  return Object.values(loop.intel)
    .filter(
      (b) =>
        b.status === 'banner' &&
        ms(b.ingested_at) <= t &&
        t - ms(b.ingested_at) < 6 * 3600e3,
    )
    .sort((a, b) => ms(b.ingested_at) - ms(a.ingested_at))
    .slice(0, 2)
    .map((b) => ({
      tag:
        b.live_stand_in && b.source_tag === 'LIVE'
          ? b.live_stand_in
          : b.source_tag || 'SAMPLE',
      text: `${watchTime(b.ingested_at)} · REGION · ${scrub(loop, b.title)} · ${(b.banner || b.region_cities || []).join(', ')}`,
    }));
}

/** The Intel feed (EP-32 §3.4): by received time, newest first. */
export function intelView(loop, { limit = 40 } = {}) {
  const t = now(loop);
  const items = selectFeed(loop, { limit }).map((f) => ({
    at: watchTime(f.at),
    cls: f.kind === 'salute' ? 'Field report' : f.source_class || '—',
    tag: f.tag,
    live: /^LIVE/.test(f.tag || ''),
    grade: gradeToken(f.grade),
    text: scrub(loop, f.title),
    line: scrub(loop, f.line),
    raised: f.status === 'raised',
    human: f.kind === 'salute',
    dim:
      /^not raised|^dismissed/.test(f.line || '') || f.status === 'dismissed',
    collapse: f.collapse
      ? f.collapse.replace(/ re-shares · one item$/, '')
      : null,
  }));
  const last10 = Object.values(loop.intel).filter(
    (b) => ms(b.ingested_at) <= t && t - ms(b.ingested_at) <= 10 * 60e3,
  );
  const c = selectCounter(loop);
  return {
    counter: c,
    counterLine: counterLine(c),
    last10: `last 10 min: ${last10.length} in · ${last10.filter((b) => b.status === 'raised').length} raised`,
    banners: bannersOf(loop),
    items,
  };
}

/** Freshness of a person's position (EP-31 §5). */
export function freshnessOf(loop, pid) {
  const p = loop.people[pid];
  const fix = loop.positions[pid];
  if (p?.sharing === 'paused') return 'paused';
  // A detail checks in on its comms check (every 30 min): an answered
  // check is its freshness, so the detail is not "stale" all day (R12 S2-7).
  const d = p?.detail_id ? loop.details?.[p.detail_id] : null;
  if (d) {
    const t = now(loop);
    const every = (d.comms_check?.interval_min || 30) * 60e3;
    const last = Object.values(loop.commsChecks || {})
      .filter(
        (c) => c.detail_id === d.id && c.answered_at && ms(c.answered_at) <= t,
      )
      .reduce((m, c) => Math.max(m, ms(c.answered_at)), 0);
    if (last && t - last <= every + 5 * 60e3) return 'fresh';
    if (last && t - last <= 2 * every) return 'aging';
    // No check on file yet (off shift, or before the day's first): the
    // detail is where its schedule puts it, said so, never "stale".
    if (!last && (!fix || t - ms(fix.at) > 600e3)) return 'schedule';
  }
  if (!fix) return p?.position_source === 'schedule' ? 'schedule' : 'unknown';
  const age = (now(loop) - ms(fix.at)) / 1000;
  if (fix.precision === 'area' && p?.position_source === 'schedule')
    return 'schedule';
  if (age <= 120) return 'fresh';
  if (age <= 600) return 'aging';
  return 'stale';
}

/** People raised now (an open situation), callsign → why. */
function raisedNow(loop) {
  const out = new Map();
  for (const s of Object.values(loop.situations))
    if (s.state !== 'CLOSED' && s.state !== 'EXPIRED') out.set(s.person_id, s);
  return out;
}

/** The roster map (EP-32 §3.5): seven cities, ~40 people, callsigns only. */
export function rosterView(loop, cities, { at = null } = {}) {
  // The city clocks read the wall's extrapolated clock (R19 S3-1), display only.
  const shown = at ?? loop.clock.simNow;
  const raised = raisedNow(loop);
  const people = Object.values(loop.people).filter((p) => p.callsign);
  const byCity = new Map(cities.map((c) => [c.name, []]));
  const rank = (p) =>
    -POSTURES.indexOf(p.posture) * 100 +
    (raised.has(p.id) ? -50 : 0) +
    (p.protection === 'DETAIL' ? -5 : p.protection === 'REMOTE' ? -3 : 0);
  for (const p of people) {
    const city = byCity.has(p.current_city) ? p.current_city : null;
    if (!city) continue;
    byCity.get(city).push({
      id: p.id,
      callsign: p.callsign,
      posture: p.posture,
      bars: barsOf(p.posture),
      protection: p.protection,
      detailAgent: Boolean(p.detail_of || /^p-atlas\d$/.test(p.id)),
      raised: raised.has(p.id),
      fresh: freshnessOf(loop, p.id),
      checkin: p.next_checkin_due_at
        ? `${p.next_checkin_due_at && ms(p.next_checkin_due_at) < now(loop) ? 'overdue' : 'next'} ${zl(p.next_checkin_due_at, p.tz || 'UTC')}`
        : null,
    });
  }
  for (const list of byCity.values())
    list.sort(
      (a, b) =>
        rank(loop.people[a.id]) - rank(loop.people[b.id]) ||
        (a.callsign < b.callsign ? -1 : 1),
    );
  const counts = Object.fromEntries(POSTURES.map((k) => [k, 0]));
  for (const p of people) counts[p.posture] = (counts[p.posture] || 0) + 1;
  return {
    total: people.length,
    counts: POSTURES.slice()
      .reverse()
      .map((k) => ({ posture: k, bars: barsOf(k), n: counts[k] || 0 })),
    // One count on MAIN and the roster (F1's postureCounts, R11 S2-6).
    protection: postureCounts(loop.people, loop.details).line.replace(
      / · \d+ ON WATCH$/,
      '',
    ),
    raised: [...raised.values()].map((s) => ({
      callsign: s.callsign,
      // The callsign heads the row already: the why without it.
      why: scrub(loop, s.why_raised).replace(`${s.callsign} · `, ''),
      age: `${Math.max(0, Math.floor((now(loop) - ms(s.raised_at)) / 60e3))} min`,
    })),
    retiers: loop.retiers.map(
      (r) =>
        `${callsignOf(loop, r.person_id)} ${r.from} → ${r.to} · ${r.by} ${watchTime(r.at)}`,
    ),
    cities: cities.map((c) => ({
      ...c,
      local: localTime(shown, c.tz),
      people: byCity.get(c.name) || [],
    })),
  };
}

/** Roster by trip (EP-32 §3.7): trips, legs, check-ins, overdue. */
export function tripsView(loop, trips = [], { at = null } = {}) {
  const t = now(loop);
  // The card clocks read the wall's extrapolated clock (R19 S3-1).
  const shown = at ?? loop.clock.simNow;
  const cards = trips.map((trip) => {
    const lead = loop.people[trip.lead_person];
    const tz = lead?.tz || 'UTC';
    const legs = (trip.leg_ids || [])
      .map((id) => loop.legs[id])
      .filter(Boolean)
      .sort((a, b) => ms(a.start) - ms(b.start))
      .map((l) => ({
        // Z first, as the wall's header (R14 S2-6); a leg that does not
        // start today carries its date (R14 S2-7).
        line: `${dayPrefix(l.start, t, l.tz || tz)}${zl(l.start, l.tz || tz)} · ${legLine(l)}`,
        done: ms(l.end) <= t,
        now: ms(l.start) <= t && t < ms(l.end),
      }));
    const due = lead?.next_checkin_due_at;
    const last = lead?.last_checkin_at;
    const over =
      due && ms(due) + (lead?.checkin_overdue_after_min || 0) * 60e3 < t;
    const overMin = over ? Math.floor((t - ms(due)) / 60e3) : 0;
    const raised = raisedNow(loop).get(trip.lead_person);
    // A principal with a detail: the detail's comms check, not a phone
    // check-in he never makes (R11 S2-11, R12 S2-13).
    const det = lead?.detail_id ? loop.details?.[lead.detail_id] : null;
    const comms = det
      ? Object.values(loop.commsChecks || {})
          .filter(
            (c) =>
              c.detail_id === det.id && c.answered_at && ms(c.answered_at) <= t,
          )
          .sort((a, b) => ms(b.answered_at) - ms(a.answered_at))[0]
      : null;
    const commsLine = det
      ? comms
        ? `comms check ${watchTime(comms.answered_at)} · next ${watchTime(ms(comms.due_at) + (det.comms_check?.interval_min || 30) * 60e3)}`
        : `comms check every ${det.comms_check?.interval_min || 30} min`
      : null;
    return {
      id: trip.id,
      callsign: lead?.callsign ?? '—',
      name: trip.name,
      city: trip.city,
      protection: trip.protection || lead?.protection,
      posture: lead?.posture,
      bars: barsOf(lead?.posture),
      // Z first, local beside (R14 S2-6).
      clock: watchTime(shown),
      zulu: `${localTime(shown, tz)} ${trip.city}`,
      tzName: trip.city,
      checkin: over
        ? `overdue ${overMin} min`
        : commsLine ||
          `${last ? `checked in ${zl(last, tz)}` : 'no check-in yet'}${due && (!last || ms(due) > ms(last)) ? ` · next ${zl(due, tz)}` : ''}`,
      overdue: Boolean(over),
      raised: raised ? scrub(loop, raised.why_raised) : null,
      legs,
      need:
        -POSTURES.indexOf(lead?.posture) * 1e9 +
        (raised ? -5e8 : 0) +
        (over ? -1e8 : 0) +
        (legs.find((l) => !l.done) ? 0 : 1e7),
    };
  });
  cards.sort((a, b) => a.need - b.need || (a.callsign < b.callsign ? -1 : 1));
  const overdue = cards.filter((c) => c.overdue).length;
  return {
    head: `ROSTER BY TRIP · ${cards.length} · ${overdue ? `${overdue} overdue` : 'no one overdue'}`,
    cards,
  };
}

const MON = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
const localDay = (t, tz) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(t));
/**
 * `26 OCT ` for a leg that starts on another local day than now (in the
 * leg's own zone: SWIFT's 2030L move is today's, though it is 0030Z
 * tomorrow), else ''.
 */
export function dayPrefix(start, t, tz = 'UTC') {
  const a = localDay(ms(start), tz);
  if (a === localDay(t, tz)) return '';
  return `${a.slice(8, 10)} ${MON[Number(a.slice(5, 7)) - 1]} `;
}

/** A leg's words without its time (the time is shown beside it). */
const legWords = (l) => legShort(l).replace(/ \d{4}L$/, '');
function legLine(l) {
  if (l.kind === 'hotel') return l.place?.name || l.label;
  if (l.kind === 'ground' && l.origin?.name && l.destination?.name)
    return `${l.origin.name} → ${l.destination.name}`;
  if (l.kind === 'ground' || l.kind === 'flight') return l.label;
  const w = legWords(l);
  return l.place?.name && !w.includes(l.place.name)
    ? `${w} · ${l.place.name}`
    : w;
}
const STATE_WORD = {
  RAISED: 'raised',
  VERIFYING: 'verifying',
  VERIFIED: 'verified',
  UNCONFIRMED: 'unconfirmed, actionable',
  PUSHED: 'pushed',
  ACKED: 'accepted',
  NONCONCUR: 'DL: NON-CONCUR · monitoring',
  DONE: 'done',
  EXPIRED: 'expired',
};

/** The Principal view (EP-32 §3.6): one person, their leg, their venue. */
export function principalView(loop, geo) {
  const t = now(loop);
  const f = focusOf(loop);
  const p = loop.people[f.person_id];
  const s = f.sit_id ? loop.situations[f.sit_id] : null;
  const leg =
    s && s.state !== 'CLOSED'
      ? loop.legs[s.leg_id]
      : legAt(loop, f.person_id, t);
  const tz = p?.tz || 'UTC';
  const fix = loop.positions[f.person_id];
  const fixPlace = fix?.place_id ? geo?.places?.[fix.place_id] : null;
  const venue = leg?.place || null;
  // A ground move shows its destination; the stay at the hotel shows the hotel.
  const placeId =
    s && s.state !== 'CLOSED'
      ? venue?.place_id
      : SITE_OF_PLACE[fix?.place_id]
        ? fix.place_id
        : venue?.place_id;
  const site = SITE_OF_PLACE[placeId] ?? null;
  const d = p?.detail_id ? loop.details[p.detail_id] : null;
  const lastComms = d
    ? Object.values(loop.commsChecks)
        .filter(
          (c) =>
            c.detail_id === d.id && c.answered_at && ms(c.answered_at) <= t,
        )
        .sort((a, b) => ms(b.answered_at) - ms(a.answered_at))[0]
    : null;
  const nextLeg = Object.values(loop.legs)
    .filter(
      (l) =>
        (l.person_id === f.person_id ||
          l.participants?.includes(f.person_id)) &&
        ms(l.start) > t &&
        l.kind !== 'hotel',
    )
    .sort((a, b) => ms(a.start) - ms(b.start))[0];
  const rec = s ? recOf(loop, s) : null;
  const sitrep = s?.sitrep_id ? loop.sitreps[s.sitrep_id] : null;
  const dlPlan = dlPlanOf(loop, s, venue);
  const open = Object.values(loop.situations).filter(
    (x) => x.person_id === f.person_id && x.state !== 'CLOSED',
  );
  const lastAck = (loop.acks || [])
    .filter(
      (a) =>
        a.participant_id === f.person_id ||
        (d && d.leader === a.participant_id),
    )
    .sort((a, b) => ms(b.at) - ms(a.at))[0];
  const where = fixPlace?.name || venue?.name || '—';
  return {
    person_id: f.person_id,
    callsign: p?.callsign ?? '—',
    protection: p?.protection ?? '—',
    posture: p?.posture ?? 'ROUTINE',
    bars: barsOf(p?.posture),
    leg: leg ? `${legWords(leg)} · ${lz(leg.start, leg.tz || tz)}` : '—',
    venue: venue
      ? {
          place_id: venue.place_id,
          name: venue.name,
          lat: venue.lat,
          lon: venue.lon,
          entrances: venue.entrances || [],
        }
      : null,
    place_id: placeId,
    site,
    flat: !site,
    slots: [
      ['WHERE', where],
      [
        'STATUS',
        s
          ? s.state === 'CLOSED'
            ? `closed ${sitrep?.signed_at ? watchTime(sitrep.signed_at) : ''} · SITREP ${sitrep?.signed_by ?? ''}`.trim()
            : `${STATE_WORD[s.state] || s.state.toLowerCase()} · next update ${s.next_update_at ? localTime(s.next_update_at, tz) : '—'}`
          : 'no active situation',
      ],
      [
        'LAST CONTACT',
        lastAck
          ? `${callsignOf(loop, lastAck.participant_id)} ${lz(lastAck.at, tz)}`
          : fix
            ? `position ${lz(fix.at, tz)}`
            : '—',
      ],
      [
        'NEXT EVENT',
        nextLeg ? `${legShort(nextLeg)} (${watchTime(nextLeg.start)})` : '—',
      ],
      [
        'OPEN ITEMS',
        open.length ? open.map((x) => x.callsign).join(' · ') : 'none',
      ],
    ],
    detail: d
      ? {
          line: `${callsignOf(loop, d.leader)} · ${d.agents.map((a) => callsignOf(loop, a).replace(/^ATLAS /, '')).join('–')} · ${callsignOf(loop, d.advance_agent).replace(/^ATLAS /, '')} ADVANCE`,
          comms: lastComms
            ? `comms check ${watchTime(lastComms.answered_at)} · next ${watchTime(ms(lastComms.due_at) + (d.comms_check?.interval_min || 30) * 60e3)}`
            : 'comms check —',
          agents: [d.leader, ...d.agents, ...(d.vehicles || [])],
        }
      : null,
    rec,
    dlPlan,
    open: Boolean(s && s.state !== 'CLOSED'),
    sit: s,
  };
}

/**
 * The detail leader's plan when he non-concurred (F2 S2): the entrance his
 * plan names (else the venue's north door), and the one the watch had
 * recommended, now superseded. Null otherwise.
 */
export function dlPlanOf(loop, s, venue) {
  if (!s?.push_id) return null;
  const push = loop.pushes[s.push_id];
  if (!push || push.tier !== 'DETAIL') return null;
  const r = Object.values(push.recipients || {}).find(
    (x) => x.dl?.answer === 'nonconcur',
  );
  if (!r) return null;
  const rec = loop.recommendations[push.recommendation_id];
  const ents = venue?.entrances || [];
  const plan = String(r.dl.plan || '').toLowerCase();
  const named =
    ents.find((e) => plan && plan.includes(e.name.toLowerCase())) ||
    ents.find((e) => /north/i.test(e.name) && /north/.test(plan)) ||
    ents.find((e) => e.side === 'N') ||
    null;
  return {
    entrance: named?.name ?? null,
    rejected: rec?.destination?.name ?? null,
    plan: r.dl.plan ? scrub(loop, r.dl.plan) : null,
  };
}

/** Markers, routes and areas the Principal map draws (3D or flat). */
export function principalOverlay(loop, geo, view) {
  const t = now(loop);
  const pid = view.person_id;
  const marks = [];
  const add = (id, kind) => {
    const fix = loop.positions[id];
    if (!fix || fix.precision !== 'point') return;
    marks.push({
      id,
      kind,
      label:
        callsignOf(loop, id) === '—'
          ? id.replace(/^v-atlas-/, 'ATLAS V')
          : callsignOf(loop, id),
      lat: fix.lat,
      lon: fix.lon,
      fresh: freshnessOf(loop, id),
      at: fix.at,
    });
  };
  add(pid, 'person');
  if (view.detail)
    for (const a of view.detail.agents)
      add(a, a.startsWith('v-') ? 'vehicle' : 'agent');
  const s = view.sit;
  // Routes: this person's paths on today's legs near the venue.
  const v = view.venue;
  const near = (c) =>
    v && Math.abs(c[0] - v.lat) < 0.06 && Math.abs(c[1] - v.lon) < 0.08;
  const routes = (geo?.paths || [])
    .filter((p) => p.subjects.includes(pid) && p.coords.some(near))
    .map((p) => ({
      id: p.id,
      planned: p.planned,
      label: p.planned
        ? 'planned route (superseded)'
        : p.departed && ms(p.departed) > t
          ? 'route'
          : 'route driven',
      coords: p.coords,
    }));
  const areas = [];
  const posts = [];
  if (s) {
    const leg = loop.legs[s.leg_id];
    for (const oi of leg?.official_instructions || [])
      if (oi.place && ms(oi.effective_at) <= t + 6 * 3600e3)
        areas.push({
          kind: 'closure',
          label: `${oi.kind === 'road_closure' ? 'Road closure' : 'Official'} · ${oi.place.name}`,
          lat: oi.place.lat,
          lon: oi.place.lon,
          // The closed segment, not the whole venue (B7 #13).
          r: Math.min(150, oi.place.accuracy_m || 150),
        });
    // A hazard area on the situation's intel (the storm line, B7 #12):
    // its polygon, hatched, on the flat map.
    for (const id of s.intel_ids || []) {
      const g = loop.intel[id]?.geo;
      if (g?.polygon?.length > 2 && loop.intel[id]?.hazard_area !== false)
        areas.push({
          kind: 'weather',
          label: scrub(loop, g.name || 'hazard area'),
          lat: g.lat,
          lon: g.lon,
          polygon: g.polygon,
          r: Math.min(400, g.accuracy_m || 300),
        });
    }
    for (const id of s.salute_ids || []) {
      const sal = loop.salutes[id];
      if (sal?.location)
        posts.push({
          label: `${callsignOf(loop, sal.person_id)} · advance`,
          lat: sal.location.lat,
          lon: sal.location.lon,
        });
    }
  }
  // After the detail leader's NON-CONCUR the original plan stands: the
  // watch's entrance is greyed as superseded and his door is the focus.
  const dl = view.dlPlan;
  return {
    marks,
    routes,
    // A polygon area belongs to the flat map; the 3D twin draws discs only.
    areas: view.flat ? areas : areas.filter((a) => !a.polygon),
    posts,
    entrances: (v?.entrances || []).map((e) => ({
      ...e,
      superseded: Boolean(dl && e.name === dl.rejected),
    })),
    focusEntrance: dl ? dl.entrance : null,
    venue: v,
  };
}

/**
 * MAIN (EP-52): only what selectMain sent, plus the clock. Rows read as
 * the storyboard (EP-20): line 1 callsign · leg (Z); line 2 the decision
 * (a DETAIL row: the leader's own short line; otherwise the BLUF); line 3
 * the ladder word in capitals and the next update. One counter. The map
 * follows the top row: its site twin, a flat map when the venue has none
 * (SWIFT at IAD), the neutral field when nothing is active.
 */
export function mainView(main, { at, beat }) {
  const all = main.rows || [];
  const rows = all.slice(0, 4).map((r) => ({
    callsign: r.callsign,
    tier: r.tier ?? null,
    leg: r.leg,
    z: r.leg_z ? `(${r.leg_z})` : '',
    line: r.line ?? r.bluf ?? '',
    detail: r.tier === 'DETAIL',
    ladder: r.word ?? r.ladder ?? '',
    tone: r.tone ?? null,
    next: r.next ?? null,
    text: r.text,
  }));
  const sc = main.scene || null;
  const map = !rows.length
    ? { mode: 'field' }
    : sc?.site
      ? { mode: '3d', site: sc.site }
      : sc
        ? { mode: 'flat' }
        : { mode: 'field' };
  // After the detail leader's NON-CONCUR the original plan stands: MAIN
  // does not show the watch's rejected entrance (F2 S2). His door, when
  // the host sends the venue's entrances, else the plan's own words.
  const dlNo = rows[0]?.detail && /NON-CONCUR/.test(rows[0].ladder || '');
  const dlDoor = dlNo
    ? (sc?.entrances || []).find(
        (e) =>
          e.name !== sc?.entrance?.name &&
          (/north/i.test(e.name) || e.side === 'N'),
      ) || null
    : null;
  if (sc && rows.length)
    Object.assign(map, {
      callsign: sc.callsign,
      title: sc.venue?.name ?? null,
      entrance: dlNo
        ? dlDoor
          ? `${dlDoor.name} (DL plan)`
          : 'original plan (DL)'
        : (sc.entrance?.name ?? null),
      dl: dlNo ? { door: dlDoor, rejected: sc.entrance?.name ?? null } : null,
      leg:
        sc.leg && sc.at
          ? `${sc.callsign} · ${sc.leg.replace(/ \d{4}L$/, '')} ${sc.at}`
          : null,
      note: map.mode === 'flat' ? 'no 3D site twin · flat map' : null,
    });
  return {
    watch: 'Watch: SafeTrekr Watch Floor · VALE · Your lead: viewing',
    verified: main.verifiedLine || 'Last verified by a human —',
    queue: main.queueLine,
    counter: main.counter,
    counterLine: main.counterLine,
    rows,
    more: all.length > 4 ? `+${all.length - 4} more · Verify wall` : null,
    empty: rows.length ? null : 'No active situations',
    brief: !rows.length && beat === 0 ? main.brief : null,
    closed: !rows.length && beat >= 5 ? main.closed : [],
    closedCount: (main.closed || []).length,
    bands: (main.bands || []).map((b) => ({
      kind: b.kind,
      text: `COMMS CHECK OVERDUE · ${b.missing?.length ? b.missing.join(' · ') : b.callsign} · ${b.minutes ?? '—'} min · due ${b.due ?? '—'}`,
    })),
    scene: sc,
    map,
    at,
  };
}

/** A distance word for a marker list. */
export const near = distance;
