// SafeTrekr Executive B6: the day's record, assembled from the loop
// (EP-33 §8, EP-34 §6, EP-36 §7, privacy review item 2).
//   assembleRecord(loop, {sitId?, personId?, audience}) → the record
// Pure and deterministic: a function of the loop state only (the same
// state the desk and the non-MAIN walls receive), no clock, no fixture
// read. With sitId, one situation; with personId, that person's
// situations; with neither, the day: every situation in raise order and
// the day summary, whose totals are counted from the record itself and
// reconciled to the close counter (selectCounter).
//
// What the record never carries, for any audience: post text, a handle,
// a mention's member texts, the leak's origin person, an address. For
// audience 'room' (walls) every person is a callsign; for 'office' (the
// desk, the printed leave-behind) the person's name is added in the
// header only (EP-34 §2). Free text from the loop passes scrubName, so a
// roster name inside a note becomes the callsign.
//
// Access (privacy review 2): each situation's access log is built from
// what the loop holds (the client viewer's read-only screen from the
// raise, each human action on the record, any `record.view` line), with
// its disclosures (pushes, notifications, a reached call-back contact,
// a recipient who informed a third party) and retention by record class
// with legal hold. No "no one else" claim.
import {
  counter as counterLine,
  dtg,
  legShort,
  watchTime,
  zl,
} from '../format.js';
import { selectCounter } from './select.js';

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
const MONTHS = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');

export const AUDIENCES = Object.freeze(['room', 'office']);

/** Retention by record class (loop.json `retention`, SAMPLE policy). */
export const RETENTION = Object.freeze({
  policy: 'SAMPLE policy',
  classes: Object.freeze([
    ['positions', '30 days'],
    ['check-ins', '30 days'],
    ['situations', 'per agreement'],
    ['SITREPs', 'per agreement'],
    ['archived posts', 'hash + text, per agreement'],
    ['access log', 'per agreement'],
    ['events', 'per agreement'],
  ]),
  legalHold: Object.freeze({
    supported: true,
    note: 'on request; suspends deletion of the named records',
  }),
});
/** The retention line (privacy review 2): never days without the policy label. */
export const RETENTION_LINE =
  'Retention: positions 30 days · situations, SITREPs and archived posts per agreement, legal hold on request (SAMPLE policy).';
/** Footer on every printed page (EP-36 §7A). */
export const SAMPLE_FOOTER =
  'Fictional family, people, posts and incidents. Live weather feeds were real. SAMPLE.';
export const WATCH_NAME = 'SafeTrekr Watch Floor';

const DECISION_WORD = Object.freeze({
  verified: 'VERIFIED',
  unconfirmed_actionable: 'UNCONFIRMED · actionable',
  watch: 'WATCH',
  dismissed: 'DISMISSED',
});
const DL_WORD = Object.freeze({
  concur: 'CONCUR',
  nonconcur: 'NON-CONCUR',
  executing: 'EXECUTING',
  request_support: 'SUPPORT REQUESTED',
});
const RUNGS = ['delivered', 'read', 'accepted', 'done'];
const CLOSE_WORD = Object.freeze({
  clear: 'clear',
  stand_down: 'stand-down',
  expired: 'expired',
  dismissed: 'dismissed',
  watch: 'watch',
});
const REOPEN_WORD = Object.freeze({
  new_report: 'new report',
  signed_in_error: 'signed in error',
  instruction_changed: 'instruction changed',
});
const MESSAGE_WORD = Object.freeze({
  watch_ack: 'watch acknowledgement',
  note: 'update',
  request: 'request',
  inform: 'inform',
});
const CALLEE = Object.freeze({
  'family office security lead': 'security lead',
  'designated local contact': 'local contact',
  'police welfare check': 'police welfare check',
});

/** `27 OCT 26` from an instant. */
export function dayWord(t) {
  const d = new Date(ms(t));
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear() % 100).padStart(2, '0')}`;
}

/** The person whose read-only screen shows everything the watch sees. */
export function clientViewerOf(loop) {
  return (
    Object.values(loop.people || {}).find((p) =>
      /security lead/i.test(p.role || ''),
    ) || null
  );
}

/** A callsign for a participant, a watch callsign, or `system`. Never a name. */
export function whoOf(loop, id) {
  if (id == null) return '—';
  if (id === 'generator' || id === 'system') return 'system';
  if (loop.watch?.[id]) return id;
  const p = loop.people?.[id];
  if (p) return p.callsign;
  const w = Object.values(loop.watch || {}).find((x) => x.id === id);
  if (w) return w.callsign;
  return /^[A-Z][A-Z0-9 –-]*$/.test(id) ? id : '—';
}
function roleOf(loop, id, viewer) {
  if (loop.watch?.[id]) return loop.watch[id].role;
  if (viewer && id === viewer.id) return 'your security lead';
  const p = loop.people?.[id];
  return p ? String(p.role || '').toLowerCase() || 'person' : '—';
}

/** The four answers of a detail leader, in his words (B7 #8). */
export const DL_REPLY = 'Concur / Non-concur / Executing / Request support';

/**
 * An official instruction as the authority wrote it (B7 #10): the id
 * resolved against every leg's `official_instructions`, its `line`; never
 * the raw id on a page.
 */
export function officialText(loop, id, scrub = (t) => t) {
  if (!id || id === 'none on file') return 'No official instruction on file';
  for (const l of Object.values(loop.legs || {}))
    for (const o of l.official_instructions || [])
      if (o.id === id)
        return scrub(
          String(o.line || '').replace(/^OFFICIAL · /, '') ||
            [
              o.kind === 'road_closure' ? 'Road closure' : 'Official',
              o.place?.name,
              o.authority_class,
            ]
              .filter(Boolean)
              .join(' · '),
        );
  return /^oi-/.test(String(id)) ? 'Official instruction on file' : id;
}

function isViewer(loop, viewer, by) {
  return by === viewer.id || by === viewer.callsign;
}
/**
 * The client viewer's opens of a situation (B7 #14): the loop's `views`
 * (the reducer's `record.view`), else `record.view` lines on its log.
 * The first open at or after the raise.
 */
function viewerEvents(loop, viewer, s) {
  const src = Array.isArray(loop.views)
    ? loop.views
    : (loop.log || []).filter((l) =>
        /^(record\.view|client\.view)/.test(l.type || ''),
      );
  return src
    .filter(
      (l) =>
        isViewer(loop, viewer, l.by) &&
        (l.sit_id ?? l.ids?.sit_id) === s.sit_id &&
        l.at &&
        ms(l.at) >= ms(s.raised_at),
    )
    .sort((a, b) => ms(a.at) - ms(b.at))
    .slice(0, 1)
    .map((l) => ({ at: l.at, via: null }));
}

/** Every roster name, longest first. */
function namesOf(loop) {
  return Object.values(loop.people || {})
    .filter((p) => p.name)
    .map((p) => [p.name, p.callsign])
    .sort((a, b) => b[0].length - a[0].length);
}
/** Free text from the loop: a roster name becomes the person's callsign. */
export function scrubName(names, text) {
  if (text == null) return null;
  let s = String(text);
  for (const [name, cs] of names)
    if (s.includes(name)) s = s.split(name).join(cs);
  return s;
}

const tzOf = (loop, s) =>
  loop.legs?.[s.leg_id]?.tz || loop.people?.[s.person_id]?.tz || 'UTC';
const when = (t, tz) => (t ? zl(t, tz) : '—');

/** One timeline line, sortable: {at, rank, what, who, …}. */
const line = (at, rank, what, who, extra = {}) => ({
  at,
  rank,
  z: watchTime(at),
  what,
  who,
  ...extra,
});

/** The record of one situation (fixed slots, EP-34 §6 section 3). */
function situationRecord(loop, s, ctx) {
  const { names, viewer, audience } = ctx;
  const scrub = (t) => scrubName(names, t);
  const tz = tzOf(loop, s);
  const person = loop.people?.[s.person_id];
  const leg = loop.legs?.[s.leg_id];
  const lines = [];
  const access = [];
  const disclosures = [];

  // -- raised, the items, the grade
  const bundles = (s.intel_ids || []).map((id) => loop.intel?.[id]);
  const related = (s.related_intel_ids || []).map((id) => loop.intel?.[id]);
  const vId = s.verification_id || s.last_verification_id;
  const v = vId ? loop.verifications?.[vId] : null;
  const corroborates = new Set(v?.corroborated_by || []);
  const sources = [
    ...bundles.filter(Boolean).map((b) => ({ b, part: 'basis' })),
    ...related.filter(Boolean).map((b) => ({ b, part: 'related' })),
  ].map(({ b, part }) => ({
    id: b.bundle_id,
    part,
    grade: b.grade ?? null,
    cls: b.source_class ?? '—',
    observed: b.sent_at ? watchTime(b.sent_at) : '—',
    received: b.received_at ? watchTime(b.received_at) : '—',
    title: scrub(b.title) ?? '—',
    tag: b.partner_feed ? 'PARTNER FEED' : b.source_tag || 'SAMPLE',
    kind: b.mention_class ? `mention · ${b.mention_class}` : null,
  }));
  const head = bundles[0];
  const first = head?.members?.[0]?.grade;
  const gradeNow = v?.grade
    ? `${v.grade.source}${v.grade.info}`
    : (s.grade ?? head?.grade ?? null);
  const corroborated = Boolean(
    v?.corroborated_by?.length ||
    (head?.members || []).some((m) => corroborates.has(m.intel_id)),
  );
  const grade = {
    token: gradeNow,
    word: v?.grade_token ?? gradeNow,
    history:
      first && gradeNow && first !== gradeNow
        ? `${first} → ${gradeNow}${corroborated ? ' · corroborated' : ''}`
        : null,
    corroborated,
  };
  for (const { b, part } of [
    ...bundles.filter(Boolean).map((b) => ({ b, part: 'basis' })),
    ...related.filter(Boolean).map((b) => ({ b, part: 'related' })),
  ])
    if (b.received_at)
      lines.push(
        line(
          b.received_at,
          0,
          `${part === 'related' ? 'related item' : 'received'} · ${b.source_class} · ${b.grade}`,
          'system',
        ),
      );
  lines.push(
    line(s.raised_at, 1, `raised · ${scrub(s.why_raised) ?? '—'}`, 'system'),
  );
  // The client's security lead (B7 #14): `viewing`, from a real viewer
  // event on the loop's log when the relay records one (record.view,
  // client.view); until then from the read-only viewer screen, open from
  // the raise, and said so. Never `opened` at the raise instant.
  if (viewer) {
    const seen = viewerEvents(loop, viewer, s);
    if (seen.length)
      for (const l of seen)
        access.push({
          who: viewer.callsign,
          role: 'your security lead',
          at: l.at,
          action: 'viewing',
          via: l.via ?? null,
        });
    else
      access.push({
        who: viewer.callsign,
        role: 'your security lead',
        at: s.raised_at,
        action: 'viewing',
        via: 'read-only screen, open from the raise',
      });
  }

  // -- verification (every version; a reopened decision stays beside it)
  const versions = v ? [...(v.versions || []), v] : [];
  const verification = v
    ? {
        decision: DECISION_WORD[v.decision] || v.decision,
        by: v.verified_by,
        at: v.verified_at,
        when: when(v.verified_at, tz),
        version: v.version,
        countersignedBy: v.countersigned_by ?? null,
        countersignedAt: v.countersigned_at ?? null,
        // A presenter shortcut says so on the record (S2, F1's _via).
        countersigned: v.countersigned_at
          ? `${v.countersigned_by} ${when(v.countersigned_at, tz)}${v.countersigned_via === 'presenter' ? " · from the presenter's iPad" : ''}`
          : null,
        twoPerson: s.raised_tier === 'DETAIL' || s.tier === 'DETAIL',
        note: scrub(v.note),
        reversed: v.reversed_at
          ? `decision reopened ${watchTime(v.reversed_at)} ${v.reversed_by}`
          : null,
        earlier: (v.versions || []).map(
          (x) =>
            `v${x.version} ${DECISION_WORD[x.decision] || x.decision} · ${x.verified_by} ${watchTime(x.verified_at)}${x.reversed_at ? ` · reopened ${watchTime(x.reversed_at)} ${x.reversed_by}` : ''}`,
        ),
      }
    : null;
  for (const x of versions) {
    lines.push(
      line(
        x.verified_at,
        2,
        `${versions.length > 1 ? `v${x.version} ` : ''}${DECISION_WORD[x.decision] || x.decision}${x.grade ? ` · ${x.grade.source}${x.grade.info}` : ''}`,
        x.verified_by,
        x.reversed_at
          ? {
              reversed: `reopened ${watchTime(x.reversed_at)} ${x.reversed_by}`,
            }
          : {},
      ),
    );
    access.push({
      who: x.verified_by,
      role: roleOf(loop, x.verified_by, viewer),
      at: x.verified_at,
      action: 'assessed',
      via: 'verification',
    });
    if (x.countersigned_at) {
      lines.push(
        line(x.countersigned_at, 3, 'countersigned', x.countersigned_by),
      );
      access.push({
        who: x.countersigned_by,
        role: roleOf(loop, x.countersigned_by, viewer),
        at: x.countersigned_at,
        action: 'countersigned',
        via: 'verification',
      });
    }
    if (x.reversed_at) {
      lines.push(
        line(x.reversed_at, 3, 'decision reopened', x.reversed_by, {
          reverses: x.reversed_event ?? true,
        }),
      );
      access.push({
        who: x.reversed_by,
        role: roleOf(loop, x.reversed_by, viewer),
        at: x.reversed_at,
        action: 'reopened the decision',
        via: 'verification',
      });
    }
  }

  // -- notified (outside the watch: disclosures)
  const notified = [];
  for (const n of v?.notified || []) {
    const parties = (n.parties || []).map((p) => ({
      party: p.party,
      external: Boolean(p.external),
    }));
    notified.push({
      at: n.at,
      when: when(n.at, tz),
      by: n.by,
      parties: parties.map((p) => p.party),
      text: scrub(n.text),
    });
    lines.push(line(n.at, 4, scrub(n.text) || 'notified', n.by));
    for (const p of parties)
      disclosures.push({
        to: p.party,
        at: n.at,
        kind: 'notified',
        external: p.external,
      });
  }

  // -- recommendation and its pushes (recalled and superseded stay)
  const rec = s.recommendation_id
    ? loop.recommendations?.[s.recommendation_id]
    : null;
  const recipients = (rec?.recipients || []).map((r) => ({
    who: whoOf(loop, r.participant_id),
    role: r.role ?? null,
  }));
  // A DETAIL push is a recommendation, the detail leader's decision (B7
  // #8): no ACTION and no ACK; his four answers as the reply.
  const recDetail =
    s.tier === 'DETAIL' ||
    (s.push_id && loop.pushes?.[s.push_id]?.tier === 'DETAIL');
  const recommendation = rec
    ? {
        detail: Boolean(recDetail),
        kicker: recDetail
          ? "Recommendation · the detail leader's decision"
          : 'Recommendation',
        bluf: scrub(rec.bluf),
        action: recDetail
          ? null
          : rec.action_display || String(rec.action || '').toUpperCase(),
        reply: recDetail ? DL_REPLY : (rec.reply ?? null),
        by: rec.by_when ? when(rec.by_when, tz) : '—',
        validUntil: rec.valid_until ? when(rec.valid_until, tz) : '—',
        to: recipients
          .map((r) =>
            r.role && r.role !== 'person' ? `${r.who} (${r.role})` : r.who,
          )
          .join(' · '),
        request: scrub(rec.request) ?? null,
        official: officialText(loop, rec.official_instruction, scrub),
        subordinate: Boolean(
          rec.subordinate &&
          rec.official_instruction &&
          rec.official_instruction !== 'none on file',
        ),
        version: rec.version,
        status: rec.status,
        draftedBy:
          rec.drafted_by === 'generator'
            ? 'system'
            : (rec.drafted_by ?? 'system'),
        approved: rec.approved_by
          ? `${rec.approved_by} ${watchTime(rec.approved_at)}`
          : null,
      }
    : null;
  if (rec) {
    for (const old of rec.versions || [])
      if (old.drafted_at)
        lines.push(
          line(
            old.drafted_at,
            5,
            `recommendation v${old.version} drafted`,
            'system',
          ),
        );
    if (rec.drafted_at)
      lines.push(
        line(
          rec.drafted_at,
          5,
          `recommendation${rec.version > 1 ? ` v1` : ''} drafted`,
          'system',
        ),
      );
    if (rec.edited_at)
      lines.push(
        line(
          rec.edited_at,
          5,
          `recommendation v${rec.version} · BLUF edited`,
          rec.edited_by,
        ),
      );
    if (rec.approved_at)
      lines.push(
        line(rec.approved_at, 6, `approved v${rec.version}`, rec.approved_by),
      );
  }
  const pushes = Object.values(loop.pushes || {})
    .filter((p) => p.sit_id === s.sit_id)
    .sort((a, b) => ms(a.sent_at) - ms(b.sent_at));
  const pushRows = [];
  const ladders = [];
  const answers = [];
  for (const p of pushes) {
    const to = p.order.map((pid) => whoOf(loop, pid));
    const state = p.recalled_at
      ? 'recalled'
      : p.superseded_by
        ? 'superseded'
        : p.expired_at
          ? 'expired'
          : 'live';
    const status =
      state === 'recalled'
        ? `RECALLED ${watchTime(p.recalled_at)} ${p.recalled_by} · reason: ${scrub(p.recall_reason)}`
        : state === 'superseded'
          ? `SUPERSEDED ${watchTime(p.superseded_at)} · see ${p.superseded_by}`
          : state === 'expired'
            ? `EXPIRED ${watchTime(p.expired_at)}`
            : null;
    pushRows.push({
      id: p.push_id,
      at: p.sent_at,
      when: when(p.sent_at, tz),
      by: p.sent_by,
      to,
      state,
      status,
      supersedes: p.supersedes ?? null,
      line: `${p.push_id} · pushed ${watchTime(p.sent_at)} ${p.sent_by} to ${to.join(', ')}${p.supersedes ? ` · supersedes ${p.supersedes}` : ''}${status ? ` · ${status}` : ''}`,
    });
    lines.push(
      line(
        p.sent_at,
        7,
        `pushed to ${to.join(', ')}${p.supersedes ? ` · supersedes ${p.supersedes}` : ''}`,
        p.sent_by,
        state === 'live' ? {} : { reversed: status },
      ),
    );
    access.push({
      who: p.sent_by,
      role: roleOf(loop, p.sent_by, viewer),
      at: p.sent_at,
      action: 'pushed',
      via: p.push_id,
    });
    for (const pid of p.order)
      disclosures.push({
        to: whoOf(loop, pid),
        at: p.sent_at,
        kind: 'push',
        external: false,
      });
    if (p.recalled_at) {
      lines.push(
        line(
          p.recalled_at,
          7,
          `recalled · reason: ${scrub(p.recall_reason)}`,
          p.recalled_by,
          {
            reverses: p.push_id,
          },
        ),
      );
      access.push({
        who: p.recalled_by,
        role: roleOf(loop, p.recalled_by, viewer),
        at: p.recalled_at,
        action: 'recalled',
        via: p.push_id,
      });
    }
    for (const pid of p.order) {
      const r = p.recipients[pid];
      const rungs = RUNGS.map((k) => {
        let word = k.toUpperCase();
        let at = r.at?.[k] ?? null;
        if (k === 'accepted' && r.dl) {
          word = DL_WORD[r.dl.answer] || word;
          at = r.dl.at ?? at;
        }
        return { word, at, time: at ? watchTime(at) : '—' };
      });
      ladders.push({
        push: p.push_id,
        state,
        who: whoOf(loop, pid),
        role: r.role ?? null,
        rungs,
        text: rungs.map((x) => `${x.word} ${x.time}`).join(' · '),
      });
      if (r.dl) {
        answers.push({
          who: whoOf(loop, pid),
          word: DL_WORD[r.dl.answer] || r.dl.answer,
          text: scrub(r.dl.reason),
          plan: scrub(r.dl.plan),
          principalInformed: Boolean(r.dl.principal_informed),
          at: r.dl.at,
          when: when(r.dl.at, tz),
        });
        lines.push(
          line(
            r.dl.at,
            9,
            `DL: ${DL_WORD[r.dl.answer] || r.dl.answer}${r.dl.reason ? ` · “${scrub(r.dl.reason)}”` : ''}`,
            whoOf(loop, pid),
          ),
        );
      }
    }
  }
  for (const a of loop.acks || []) {
    if (!pushes.some((p) => p.push_id === a.push_id) || a.dl) continue;
    lines.push(
      line(
        a.at,
        8,
        `${a.rung}${a.source ? ` · ${a.source}` : ''}`,
        whoOf(loop, a.participant_id),
      ),
    );
  }

  // -- field reports (SALUTE, HUMAN), messages, call-back, re-tier, check-ins
  const field = (s.salute_ids || [])
    .map((id) => loop.salutes?.[id])
    .filter(Boolean)
    .map((x) => {
      const rows = [
        ['SIZE', x.size],
        ['ACTIVITY', x.activity],
        [
          'LOCATION',
          x.location
            ? [x.location.name, x.location.mgrs].filter(Boolean).join(' · ')
            : null,
        ],
        ['UNIT', x.unit],
        ['TIME', x.time ? zl(x.time, tz) : null],
        ['EQUIPMENT', x.equipment],
      ].map(([k, val]) => [k, scrub(val) || '—']);
      lines.push(
        line(
          x.filed_at,
          8,
          `SALUTE filed · HUMAN · ${x.source_rating}${x.info_credibility}`,
          whoOf(loop, x.person_id),
        ),
      );
      return {
        by: whoOf(loop, x.person_id),
        at: x.filed_at,
        when: when(x.filed_at, tz),
        grade: `${x.source_rating}${x.info_credibility}`,
        rows,
      };
    });
  const pushIds = new Set(pushes.map((p) => p.push_id));
  const messages = (loop.messages || [])
    .filter((m) => m.sit_id === s.sit_id)
    .map((m) => {
      const kind = MESSAGE_WORD[m.kind] || m.kind;
      const to = whoOf(loop, m.to);
      lines.push(
        line(
          m.at,
          10,
          `${kind} to ${to} · ${scrub(m.text) ?? ''}`.trim(),
          m.by,
        ),
      );
      // A message to someone the push did not reach is a disclosure too.
      if (
        loop.people?.[m.to] &&
        !pushes.some((p) => p.recipients[m.to]) &&
        !disclosures.some((d) => d.to === to)
      )
        disclosures.push({ to, at: m.at, kind: 'message', external: false });
      return {
        at: m.at,
        when: when(m.at, tz),
        by: m.signature || m.by,
        to,
        kind,
        text: scrub(m.text),
      };
    });
  const followup = (loop.checkins || [])
    .filter(
      (c) =>
        c.sit_id === s.sit_id ||
        (c.push_id && pushIds.has(c.push_id)) ||
        (c.kind === 'stand_down' && s.stand_down_at === c.at),
    )
    .map((c) => {
      lines.push(
        line(
          c.at,
          11,
          `${c.kind === 'comms_check' ? 'comms check' : c.kind === 'stand_down' ? 'stand-down' : 'check-in'} · ${scrub(c.text) ?? c.status ?? ''}`,
          whoOf(loop, c.person_id),
        ),
      );
      return {
        at: c.at,
        when: when(c.at, tz),
        who: whoOf(loop, c.person_id),
        kind: c.kind,
        status: c.status ?? null,
        text: scrub(c.text),
      };
    });
  // A recipient who told a third party (HARRIER: "car service informed").
  for (const p of pushes)
    for (const pid of p.order) {
      const r = p.recipients[pid];
      if (!r.role || r.role === 'person' || r.role === 'detail leader')
        continue;
      const told = followup.find(
        (c) => c.who === whoOf(loop, pid) && c.status === 'informed',
      );
      if (told)
        disclosures.push({
          to: `${String(r.role).replace(/^inform /, '')} (via ${whoOf(loop, pid)})`,
          at: told.at,
          kind: 'informed',
          external: true,
        });
    }
  let callback = null;
  for (const p of pushes) {
    const cb = loop.callbacks?.[p.push_id];
    if (!cb) continue;
    const steps = (cb.steps || []).map((x) => {
      const callee =
        x.role === 'person'
          ? whoOf(loop, x.contact_ref)
          : CALLEE[x.role] || x.role;
      if (x.outcome !== 'not taken')
        lines.push(
          line(
            x.at,
            12,
            `call-back ${x.step} · ${callee} · ${x.outcome ?? '—'}`,
            x.by,
          ),
        );
      if (x.outcome === 'reached' && x.role !== 'person')
        disclosures.push({
          to: x.contact_ref ? whoOf(loop, x.contact_ref) : callee,
          at: x.at,
          kind: 'call-back',
          external: !x.contact_ref,
        });
      return {
        step: x.step,
        attempt: x.attempt ?? 1,
        callee,
        outcome: x.outcome ?? '—',
        at: x.at,
        time: watchTime(x.at),
        by: x.by,
        needs: x.needs ?? null,
        line: `${x.step} · ${callee} · ${x.outcome === 'not taken' ? `not taken${x.needs ? ` · needs ${x.needs}` : ''}` : `${x.outcome ?? '—'} · ${watchTime(x.at)} · ${x.by}`}`,
      };
    });
    lines.push(
      line(
        cb.started_at,
        12,
        `no read ${p.read_timeout_min} min · call-back opened`,
        'system',
      ),
    );
    callback = {
      push: p.push_id,
      started: when(cb.started_at, tz),
      steps,
      resolved: cb.resolved_at
        ? `resolved ${watchTime(cb.resolved_at)} · ${cb.outcome}${cb.resolved_by ? ` · ${whoOf(loop, cb.resolved_by)}` : ''}`
        : 'running',
    };
  }
  const raisedAt = ms(s.raised_at);
  const endAt = s.closed_at ? ms(s.closed_at) : Infinity;
  const retiers = (loop.retiers || [])
    .filter(
      (r) =>
        r.person_id === s.person_id &&
        ms(r.at) >= raisedAt &&
        ms(r.at) <= endAt,
    )
    .map((r) => {
      lines.push(
        line(
          r.at,
          4,
          `re-tier ${r.from} → ${r.to} · reason: ${scrub(r.reason)}${r.via === 'presenter' ? " · from the presenter's iPad" : ''}`,
          r.by,
          r.reverses ? { reverses: r.reverses } : {},
        ),
      );
      access.push({
        who: r.by,
        role: roleOf(loop, r.by, viewer),
        at: r.at,
        action: 're-tiered',
        via: 'roster',
      });
      const e = r.effects || {};
      return {
        from: r.from,
        to: r.to,
        reason: scrub(r.reason),
        by: r.by,
        at: r.at,
        when: when(r.at, tz),
        until: r.until ? when(r.until, tz) : null,
        effect: [
          e.watch_radius_m
            ? `watch radius ${e.watch_radius_m >= 1000 ? `${e.watch_radius_m / 1000} km` : `${e.watch_radius_m} m`}`
            : null,
          e.checkin_every_min
            ? `check-ins every ${e.checkin_every_min >= 60 ? `${e.checkin_every_min / 60} h` : `${e.checkin_every_min} min`}`
            : null,
          e.sharing === 'requested' ? 'location sharing requested' : null,
        ]
          .filter(Boolean)
          .join(' · '),
        line: `${r.from} → ${r.to} · ${r.by} ${watchTime(r.at)}${r.via === 'presenter' ? " · from the presenter's iPad" : ''} · reason: ${scrub(r.reason)}`,
      };
    });
  // The comms checks while a DETAIL situation was open (EP-37 §7).
  let comms = null;
  if (person?.detail_id) {
    const inWindow = (t) => ms(t) >= raisedAt && ms(t) <= endAt;
    const due = loop.log.filter(
      (l) =>
        l.type === 'comms.due' &&
        l.ids?.detail_id === person.detail_id &&
        inWindow(l.at),
    ).length;
    const overdue = loop.log
      .filter(
        (l) =>
          l.type === 'comms.overdue' &&
          l.ids?.detail_id === person.detail_id &&
          inWindow(l.at),
      )
      .map((l) => {
        lines.push(line(l.at, 11, 'comms check overdue', 'system'));
        return watchTime(l.at);
      });
    if (due || overdue.length)
      comms = {
        due,
        overdue,
        line: `${due} comms check${due === 1 ? '' : 's'} due · ${overdue.length ? `${overdue.length} overdue at ${overdue.join(', ')}` : 'none overdue'}`,
      };
  }

  // -- stand-down, SITREP (every version), close, reopen
  const standDown = s.stand_down_at
    ? {
        at: s.stand_down_at,
        when: when(s.stand_down_at, tz),
        by: whoOf(loop, s.stand_down_by),
        text:
          scrub(
            followup.find(
              (c) => c.kind === 'stand_down' || c.status === 'stand_down',
            )?.text,
          ) ?? null,
      }
    : null;
  const rep = s.sitrep_id ? loop.sitreps?.[s.sitrep_id] : null;
  const sitreps = rep
    ? [...(rep.versions || []), rep].map((x, i, all) => {
        if (x.drafted_at)
          lines.push(
            line(
              x.drafted_at,
              13,
              `SITREP v${x.version} drafted`,
              x.drafted_by === 'generator' || x.drafted_by === 'system'
                ? 'system'
                : x.drafted_by,
            ),
          );
        if (x.signed_at) {
          lines.push(
            line(x.signed_at, 14, `SITREP v${x.version} signed`, x.signed_by),
          );
          access.push({
            who: x.signed_by,
            role: roleOf(loop, x.signed_by, viewer),
            at: x.signed_at,
            action: `signed SITREP v${x.version}`,
            via: 'SITREP',
          });
        }
        return {
          id: x.id,
          version: x.version,
          current: i === all.length - 1,
          header:
            x.header ??
            `SITREP ${s.callsign} · ${s.sit_id}${x.signed_at ? ` · ${dtg(x.signed_at)}` : ''}`,
          body: (x.body || []).map(scrub),
          card: x.card
            ? Object.entries(x.card).map(([k, val]) => [
                k.replace(/_/g, ' '),
                scrub(val) || '—',
              ])
            : null,
          // `draft 2107Z · signed VALE …`: never "drafted system" (R15 S2-8).
          drafted: x.drafted_at
            ? `Draft ${x.drafted_by === 'generator' || x.drafted_by === 'system' ? '' : `${x.drafted_by} `}${watchTime(x.drafted_at)}`
            : null,
          signed: x.signed_at
            ? `Signed ${x.signed_by} ${dtg(x.signed_at)}`
            : 'not signed',
          signedBy: x.signed_by ?? null,
          signedAt: x.signed_at ?? null,
        };
      })
    : [];
  const closed =
    s.state === 'CLOSED'
      ? {
          at: s.closed_at,
          when: when(s.closed_at, tz),
          by: s.closed_by ?? null,
          reason: CLOSE_WORD[s.close_reason] || s.close_reason || '—',
        }
      : null;
  if (closed)
    lines.push(
      line(s.closed_at, 15, `closed · ${closed.reason}`, closed.by || 'system'),
    );
  const reopened = (s.reopened || []).map((r) => {
    lines.push(
      line(r.at, 15, `reopened · ${REOPEN_WORD[r.reason] || r.reason}`, r.by, {
        reverses: r.reverses ?? true,
      }),
    );
    access.push({
      who: r.by,
      role: roleOf(loop, r.by, viewer),
      at: r.at,
      action: 'reopened',
      via: 'situation',
    });
    return `${REOPEN_WORD[r.reason] || r.reason} · ${r.by} ${watchTime(r.at)}`;
  });

  // -- opened from a surface (a `record.view` line, when the relay logs one)
  for (const l of loop.log || [])
    if (
      l.type === 'record.view' &&
      l.ids?.sit_id === s.sit_id &&
      !(viewer && isViewer(loop, viewer, l.by))
    )
      access.push({
        who: whoOf(loop, l.by),
        role: roleOf(loop, l.by, viewer),
        at: l.at,
        action: 'opened',
        via: 'record',
      });

  const timeline = lines
    .filter((x) => x.at)
    .sort((a, b) => ms(a.at) - ms(b.at) || a.rank - b.rank)
    .map(({ rank: _r, ...x }) => ({ ...x, when: when(x.at, tz) }));

  const accessLog = access
    .filter((a) => a.at)
    .sort((a, b) => ms(a.at) - ms(b.at))
    .map((a) => ({
      ...a,
      time: watchTime(a.at),
      line: `${watchTime(a.at)} · ${a.who} (${a.role}) · ${a.action}${a.via ? ` · ${a.via}` : ''}`,
    }));
  const disclosed = disclosures
    .filter((d) => d.at)
    .sort((a, b) => ms(a.at) - ms(b.at))
    .map((d) => ({
      ...d,
      time: watchTime(d.at),
      line: `${watchTime(d.at)} · ${d.to} · ${d.kind}${d.external ? ' · outside the watch' : ''}`,
    }));
  const people = [...new Set(accessLog.map((a) => a.who))];

  return {
    sit_id: s.sit_id,
    sample: true,
    callsign: s.callsign,
    ...(audience === 'office' && person?.name ? { name: person.name } : {}),
    person_id: s.person_id,
    protection:
      s.raised_tier && s.raised_tier !== s.tier
        ? `${s.raised_tier} → ${s.tier}`
        : s.tier,
    posture: person?.posture ?? null,
    tz,
    state: s.state,
    leg: leg
      ? {
          label: legShort(leg),
          place: leg.place?.name ?? leg.destination?.name ?? null,
          start: when(leg.start, tz),
        }
      : null,
    raised: {
      at: s.raised_at,
      when: when(s.raised_at, tz),
      dtg: dtg(s.raised_at),
      why: scrub(s.why_raised),
    },
    grade,
    sources,
    verification,
    notified,
    recommendation,
    pushes: pushRows,
    ladders,
    field,
    answers,
    messages,
    callback,
    retiers,
    comms,
    followup,
    standDown,
    sitreps,
    closed,
    reopened,
    timeline,
    access: {
      log: accessLog,
      disclosures: disclosed,
      people,
      line: `Access: ${people.join(', ')}. Access log on record.`,
      retention: 'situation and SITREP per agreement',
      legalHold: Boolean(s.legal_hold),
    },
    counts: {
      raised: true,
      pushed: pushes.length > 0,
      closed: Boolean(sitreps.at(-1)?.signedAt),
    },
  };
}

/** Items matched to the people in the record and cleared by a human (EP-34 §6.4). */
function touched(loop, personIds, names) {
  return Object.values(loop.intel || {})
    .filter(
      (b) =>
        b.decided &&
        ['dismiss', 'watch'].includes(b.decided.kind) &&
        !b.sit_id &&
        (personIds == null || personIds.has(b.match?.person_id)),
    )
    .sort((a, b) => ms(a.decided.at) - ms(b.decided.at))
    .map((b) => ({
      at: b.decided.at,
      time: watchTime(b.decided.at),
      callsign: b.match?.person_id ? whoOf(loop, b.match.person_id) : null,
      cls: b.source_class ?? '—',
      grade: b.grade ?? null,
      decision: b.decided.kind === 'dismiss' ? 'dismissed' : 'watch',
      reason: scrubName(names, b.decided.reason || b.not_raised_reason) ?? '—',
      by: b.decided.by,
    }));
}

/** The person's legs, L and Z (EP-34 §6.2). */
function legsOf(loop, personId) {
  return Object.values(loop.legs || {})
    .filter(
      (l) =>
        l.person_id === personId || (l.participants || []).includes(personId),
    )
    .sort((a, b) => ms(a.start) - ms(b.start))
    .map((l) => ({
      label: legShort(l),
      place:
        l.place?.name ??
        (l.origin && l.destination
          ? `${l.origin.name} → ${l.destination.name}`
          : null),
      start: zl(l.start, l.tz || 'UTC'),
    }));
}

/**
 * The record. opts: {sitId?, personId?, audience: 'room'|'office'}.
 * Throws on an unknown audience or id (a caller error, not a state).
 */
export function assembleRecord(
  loop,
  { sitId = null, personId = null, audience = 'room' } = {},
) {
  if (!AUDIENCES.includes(audience))
    throw new Error(`record: audience ${audience}`);
  const at = loop.clock?.simNow;
  const names = namesOf(loop);
  const viewer = clientViewerOf(loop);
  const ctx = { names, viewer, audience };
  let sits = Object.values(loop.situations || {});
  let kind = 'day';
  if (sitId) {
    const s = loop.situations?.[sitId];
    if (!s) throw new Error(`record: no situation ${sitId}`);
    sits = [s];
    kind = 'situation';
    personId = s.person_id;
  } else if (personId) {
    if (!loop.people?.[personId])
      throw new Error(`record: no person ${personId}`);
    sits = sits.filter((s) => s.person_id === personId);
    kind = 'person';
  }
  sits.sort(
    (a, b) =>
      ms(a.raised_at) - ms(b.raised_at) || (a.sit_id < b.sit_id ? -1 : 1),
  );
  const situations = sits.map((s) => situationRecord(loop, s, ctx));
  const person = personId ? loop.people[personId] : null;
  const date = dayWord(loop.clock?.t0 || at);
  const subject = person ? person.callsign : 'THE DAY';

  // The day summary: counted from the record, reconciled to the counter.
  const counter = selectCounter(loop);
  const t = ms(at);
  const counted = {
    in: Object.values(loop.intel || {}).filter((b) => ms(b.ingested_at) <= t)
      .length,
    matched: Object.values(loop.intel || {}).filter(
      (b) => b.matched_at && ms(b.matched_at) <= t,
    ).length,
    raised: situations.length,
    pushed: situations.filter((x) => x.counts.pushed).length,
    closed: situations.filter((x) => x.counts.closed).length,
  };
  const mismatches =
    kind === 'day'
      ? Object.keys(counter).filter((k) => counter[k] !== counted[k])
      : [];
  const daily = Object.values(loop.sitreps || {}).find((r) => r.daily);
  const allPushes = situations.flatMap((x) => x.pushes);
  const viewers = [...new Set(situations.flatMap((x) => x.access.people))];
  const externals = situations.flatMap((x) =>
    x.access.disclosures
      .filter((d) => d.external)
      .map((d) => `${d.to} ${d.time}`),
  );
  const personIds = person ? new Set([personId]) : null;

  return {
    sample: true,
    kind,
    audience,
    id:
      kind === 'situation'
        ? `rec-${sitId}`
        : kind === 'person'
          ? `rec-${personId}-${loop.clock?.t0?.slice(0, 10) ?? ''}`
          : `rec-day-${loop.clock?.t0?.slice(0, 10) ?? ''}`,
    title: `RECORD · ${subject} · ${date} · SAMPLE`,
    date,
    at,
    generated: at
      ? `Generated ${watchTime(at)} · ${WATCH_NAME} · SAMPLE`
      : null,
    dtg: at ? dtg(at) : null,
    who: person
      ? {
          callsign: person.callsign,
          ...(audience === 'office' && person.name
            ? { name: person.name }
            : {}),
          protection: person.protection,
          posture: person.posture,
        }
      : null,
    watch: {
      name: WATCH_NAME,
      line: `Watch: ${WATCH_NAME} · ${Object.keys(loop.watch || {}).join(' · ')}${viewer ? ` · Your lead: ${viewer.callsign} viewing` : ''}`,
      lastHuman: loop.lastHuman
        ? `Last verified by a human ${watchTime(loop.lastHuman.at)} · ${loop.lastHuman.by}`
        : null,
    },
    legs: person ? legsOf(loop, personId) : null,
    situations,
    touched: touched(loop, personIds, names),
    summary: {
      counter,
      counted,
      reconciled: mismatches.length === 0,
      mismatches,
      line: counterLine(counter),
      notRaised: counter.in - counter.raised,
      matchedNotRaised: counter.matched - counter.raised,
      pushes: {
        total: allPushes.length,
        live: allPushes.filter((p) => p.state === 'live').length,
        recalled: allPushes.filter((p) => p.state === 'recalled').length,
        superseded: allPushes.filter((p) => p.state === 'superseded').length,
        expired: allPushes.filter((p) => p.state === 'expired').length,
      },
      open: situations.filter((x) => !x.closed).map((x) => x.callsign),
    },
    daily: daily
      ? {
          header: daily.header,
          body: (daily.body || []).map((b) => scrubName(names, b)),
          signed: daily.signed_at
            ? `Signed ${daily.signed_by} ${dtg(daily.signed_at)}`
            : 'not signed',
          signedAt: daily.signed_at ?? null,
        }
      : null,
    access: {
      viewers,
      external: externals,
      line: `Access: ${viewers.join(', ')}. Access log on record per situation.`,
      retention: RETENTION_LINE,
    },
    retention: RETENTION,
    footer: SAMPLE_FOOTER,
  };
}
