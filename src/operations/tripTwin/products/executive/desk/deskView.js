// SafeTrekr Executive B4: the analyst's desk, as data and HTML (EP-31 §3,
// EP-32 §§2.2–2.4, 3.2, EP-33 §§2–3, EP-34 §§2, 4, EP-36 §2.8). Pure: the
// entry (deskEntry.js) owns the socket, the keys and the DOM. Z first,
// names with callsigns (names live on the desk and phones only).
//
// deskLists(loop)                    → {queue, situations, closed, decided}
// deskActions(loop, desk, sitId, as) → [{id, key, label, …}] for the card
// evidenceHtml / recommendationHtml / recordHtml(loop, desk, sitId)
import { selectCounter, selectQueue, queueLine } from '../loop/select.js';
import { PUSHABLE } from '../loop/loopPolicy.js';
import { dtg, legShort, watchTime, zl } from '../format.js';

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const RUNGS = ['delivered', 'read', 'accepted', 'done'];
const DL = {
  concur: 'CONCUR',
  nonconcur: 'NON-CONCUR',
  executing: 'EXECUTING',
  request_support: 'SUPPORT REQUESTED',
};

/** `Nikhil Varga · KESTREL`: the name in Inter, the callsign in mono after. */
export function who(loop, pid) {
  const p = loop.people?.[pid];
  if (!p) return esc(pid ?? '—');
  return `<span class="dk-name">${esc(p.name)}</span> <span class="dk-cs">${esc(p.callsign)}</span>`;
}
export const tzOf = (loop, sit) => loop.legs?.[sit?.leg_id]?.tz || 'UTC';
/** Minutes to exposure: `T−1 h 27 min` / `T−8 min` / `under way`. */
export function tte(s) {
  if (s == null) return '—';
  if (s <= 0) return 'under way';
  const m = Math.round(s / 60);
  return m >= 60 ? `T−${Math.floor(m / 60)} h ${m % 60} min` : `T−${m} min`;
}

/** The lists in the left column (EP-34 §5 orders). */
export function deskLists(loop) {
  const t = ms(loop.clock.simNow);
  const queue = selectQueue(loop);
  const inQueue = new Set(queue.map((q) => q.sit_id));
  const sits = Object.values(loop.situations);
  const situations = sits
    .filter((s) => s.state !== 'CLOSED' && !inQueue.has(s.sit_id))
    .map((s) => ({
      sit_id: s.sit_id,
      callsign: s.callsign,
      person_id: s.person_id,
      state: s.state,
      exposure: s.exposure_at ? (ms(s.exposure_at) - t) / 1000 : null,
      raised_at: s.raised_at,
    }))
    .sort(
      (a, b) =>
        (a.exposure ?? Infinity) - (b.exposure ?? Infinity) ||
        ms(a.raised_at) - ms(b.raised_at),
    );
  const closed = sits
    .filter((s) => s.state === 'CLOSED')
    .sort((a, b) => ms(a.closed_at) - ms(b.closed_at));
  const decided = Object.values(loop.intel)
    .filter((b) => b.decided && ['dismiss', 'watch'].includes(b.decided.kind))
    .sort((a, b) => ms(b.decided.at) - ms(a.decided.at))
    .slice(0, 5);
  return {
    queue,
    queueLine: queueLine(queue),
    situations,
    closed,
    decided,
    counter: selectCounter(loop),
  };
}

/** The state word a situation row shows (the ladder's deepest rung). */
export function stateWord(loop, sit) {
  const push = sit.push_id && loop.pushes[sit.push_id];
  if (push?.recalled_at) return `RECALLED ${watchTime(push.recalled_at)}`;
  if (sit.state === 'CLOSED')
    return `CLOSED ${watchTime(sit.closed_at)} · SITREP ${loop.sitreps[sit.sitrep_id]?.signed_by ?? ''}`;
  if (!push) return sit.state;
  const cb = loop.callbacks[push.push_id];
  if (cb && !cb.resolved_at)
    return `NO READ · call-back ${cb.step}/${cb.chain.length}`;
  const dl = push.order.map((pid) => push.recipients[pid].dl).find(Boolean);
  if (dl) return `DL: ${DL[dl.answer]}`;
  let top = -1;
  let at = null;
  for (const pid of push.order) {
    const r = push.recipients[pid];
    const i = RUNGS.indexOf(r.rung);
    if (i > top) {
      top = i;
      at = r.at[r.rung];
    }
  }
  if (sit.state === 'EXPIRED') return 'EXPIRED';
  return top < 0
    ? `PUSHED ${watchTime(push.sent_at)}`
    : `${RUNGS[top].toUpperCase()} ${watchTime(at)}`;
}

/** The scripted watch actions still to come for this situation. */
export const scriptFor = (desk, sit) =>
  (desk?.pending || []).filter(
    (p) =>
      p.sit_id === sit.sit_id ||
      (p.type === 'posture.retier' && p.person_id === sit.person_id),
  );
const scriptAt = (desk, sit, type) =>
  scriptFor(desk, sit).find((p) => p.type === type);
const at = (p) => (p ? ` · script ${watchTime(p.at)}` : '');

/**
 * The card's actions, in the order they read (EP-36 §2.8 words). Each:
 * {id, key, label, cmds: [desk cmd] | null, sheet: {…} | null, confirm:
 * text | null, needs: 'ORTEGA' | null, primary: bool, disabled: text|null}.
 */
export function deskActions(loop, desk, sitId, as = 'VALE') {
  const sit = loop.situations[sitId];
  if (!sit) return [];
  const out = [];
  const add = (a) =>
    out.push({
      cmds: null,
      sheet: null,
      confirm: null,
      needs: null,
      primary: false,
      disabled: null,
      ...a,
    });
  const v = sit.verification_id && loop.verifications[sit.verification_id];
  const rec =
    sit.recommendation_id && loop.recommendations[sit.recommendation_id];
  const draft = desk?.drafts?.[sitId] || null;
  const push = sit.push_id && loop.pushes[sit.push_id];
  const live = push && !push.recalled_at && !push.superseded_by ? push : null;
  const read =
    live &&
    live.order.some(
      (pid) =>
        RUNGS.indexOf(live.recipients[pid].rung) >= 1 ||
        live.recipients[pid].dl,
    );
  const cb = live && loop.callbacks[live.push_id];
  const detail = sit.tier === 'DETAIL';
  const person = loop.people[sit.person_id];
  const recId = rec?.id || draft?.recommendation_id || null;
  const bluf = rec?.bluf || draft?.bluf || '';
  const names = (rec || draft)?.recipients
    ?.map((r) => loop.people[r.participant_id ?? r]?.callsign)
    .filter(Boolean)
    .join(', ');

  if (sit.state === 'CLOSED') {
    add({
      id: 'reopen',
      key: 'O',
      label: 'Reopen with reason',
      sheet: {
        title: `Reopen ${sit.callsign}? The SITREP keeps v1 and gains v2.`,
        fields: [
          {
            name: 'reason',
            kind: 'select',
            options: [
              ['new_report', 'new report'],
              ['signed_in_error', 'signed in error'],
              ['instruction_changed', 'instruction changed'],
            ],
          },
        ],
        build: (f) => [
          { type: 'situation.reopen', sit_id: sitId, reason: f.reason },
        ],
      },
    });
    return out;
  }

  const decide = scriptAt(desk, sit, 'verification.decide');
  if (sit.state === 'RAISED' || sit.state === 'VERIFYING') {
    const g = decide?.grade || gradeOf(sit.grade);
    add({
      id: 'verify',
      key: 'V',
      label: `Verify${at(decide)}`,
      primary: !detail,
      sheet: {
        title: `Verify ${sit.callsign}: decision and grade`,
        fields: [
          {
            name: 'source',
            kind: 'select',
            value: g?.source,
            options: 'ABCDEF'.split('').map((x) => [x, x]),
          },
          {
            name: 'info',
            kind: 'select',
            value: String(g?.info ?? ''),
            options: '123456'.split('').map((x) => [x, x]),
          },
        ],
        build: (f) => [
          {
            type: 'verification.decide',
            sit_id: sitId,
            decision: 'verified',
            grade: { source: f.source, info: Number(f.info) },
          },
        ],
      },
    });
    if (detail)
      add({
        id: 'unconfirmed',
        key: 'U',
        label: `Mark unconfirmed, actionable${at(decide)}`,
        primary: true,
        sheet: {
          title: `${sit.callsign}: UNCONFIRMED · actionable (DETAIL). Why?`,
          fields: [
            {
              name: 'note',
              kind: 'text',
              value: 'Actionable at DETAIL; no corroboration yet',
            },
          ],
          build: (f) => [
            {
              type: 'verification.decide',
              sit_id: sitId,
              decision: 'unconfirmed_actionable',
              ...(g ? { grade: g } : {}),
              ...(f.note ? { note: f.note } : {}),
            },
          ],
        },
      });
    add({
      id: 'watch',
      key: 'W',
      label: 'Watch',
      cmds: [{ type: 'verification.decide', sit_id: sitId, decision: 'watch' }],
    });
    add({
      id: 'dismiss',
      key: 'D',
      label: 'Dismiss with reason',
      sheet: {
        title: `Dismiss ${sit.callsign}? A reason is needed.`,
        fields: [{ name: 'note', kind: 'text', value: '' }],
        require: ['note'],
        build: (f) => [
          {
            type: 'verification.decide',
            sit_id: sitId,
            decision: 'dismissed',
            note: f.note,
          },
        ],
      },
    });
  }

  if (
    v &&
    !live &&
    ['VERIFIED', 'UNCONFIRMED', 'WATCH', 'DISMISSED'].includes(sit.state)
  )
    add({
      id: 'reopen-decision',
      key: null,
      label: 'Reopen the decision',
      cmds: [{ type: 'verification.reopen', sit_id: sitId }],
    });

  const pushable = v && PUSHABLE.includes(v.decision);
  if (detail && pushable && !v.countersigned_by) {
    const cs = scriptAt(desk, sit, 'verification.countersign');
    add({
      id: 'countersign',
      key: 'G',
      label: `Countersign${at(cs)}`,
      needs: 'ORTEGA',
      primary: as === 'ORTEGA',
      confirm: `Countersign ${sit.callsign} as ORTEGA (assessed ${watchTime(v.verified_at)} VALE)?`,
      cmds: [{ type: 'verification.countersign', sit_id: sitId }],
    });
  }
  const signedOff = pushable && (!detail || v.countersigned_by);
  const notify = scriptAt(desk, sit, 'notify.send');
  if (notify && pushable)
    add({
      id: 'notify',
      key: null,
      label: `Notify venue and police${at(notify)}`,
      confirm: 'Notify venue security and local police (SAMPLE)?',
      cmds: [{ type: 'notify.send', sit_id: sitId }],
    });
  if (recId && pushable && !live) {
    const approved = rec?.status === 'approved';
    const push = scriptAt(desk, sit, 'push.send');
    add({
      id: 'push',
      key: 'Enter',
      label: signedOff
        ? `${approved ? 'Push to recipients' : 'Approve and push'}${at(push)}`
        : 'Push · needs countersign',
      primary: true,
      // The push is the analyst's (EP-33 §1), never the supervisor's.
      needs: 'VALE',
      disabled: signedOff ? null : 'needs countersign',
      confirm: `Push to ${names || 'the recipients'}? “${bluf}”`,
      cmds: [
        ...(approved
          ? []
          : [{ type: 'recommendation.approve', recommendation_id: recId }]),
        { type: 'push.send', recommendation_id: recId },
      ],
    });
  }
  if (recId && (!live || read))
    add({
      id: 'edit',
      key: 'B',
      label: live ? 'Supersede with a new BLUF' : 'Edit the BLUF',
      sheet: {
        title: live
          ? `Supersede the push to ${names}: the new version replaces it (read already)`
          : 'Edit the BLUF (one line, at most 90 characters, plain)',
        fields: [{ name: 'bluf', kind: 'text', value: bluf, max: 90 }],
        require: ['bluf'],
        build: (f) =>
          live
            ? [
                {
                  type: 'recommendation.edit',
                  recommendation_id: recId,
                  bluf: f.bluf,
                },
                { type: 'recommendation.approve', recommendation_id: recId },
                {
                  type: 'push.send',
                  recommendation_id: recId,
                  supersede: true,
                },
              ]
            : [
                {
                  type: 'recommendation.edit',
                  recommendation_id: recId,
                  bluf: f.bluf,
                },
              ],
      },
    });
  if (live && !read)
    add({
      id: 'recall',
      key: 'X',
      label: 'Recall (not read yet)',
      sheet: {
        title: `Recall the push to ${names}? Phones show RECALLED; MAIN drops the row.`,
        fields: [{ name: 'reason', kind: 'text', value: 'wrong recipient' }],
        require: ['reason'],
        build: (f) => [
          { type: 'push.recall', push_id: live.push_id, reason: f.reason },
        ],
      },
    });
  if (cb && !cb.resolved_at) {
    const step = scriptAt(desk, sit, 'callback.step');
    const next =
      cb.chain[cb.steps.at(-1)?.step ?? cb.step - 1] || cb.chain[cb.step - 1];
    add({
      id: 'call',
      key: 'C',
      label: `Call next${next ? ` · ${next.role}` : ''}${at(step)}`,
      primary: true,
      cmds: [{ type: 'callback.step', push_id: live.push_id }],
    });
  }
  const msg = scriptAt(desk, sit, 'message.send');
  if (sit.state === 'NONCONCUR' && msg)
    add({
      id: 'ack-dl',
      key: 'N',
      label: `Acknowledge the non-concur${at(msg)}`,
      primary: true,
      cmds: [{ type: 'message.send', sit_id: sitId, to: msg.to }],
    });
  if (live)
    add({
      id: 'message',
      key: 'M',
      label: 'Message',
      sheet: {
        title: `Message to ${names}`,
        fields: [
          {
            name: 'to',
            kind: 'select',
            options: live.order.map((pid) => [
              pid,
              loop.people[pid]?.callsign ?? pid,
            ]),
          },
          { name: 'text', kind: 'text', value: '' },
        ],
        require: ['text'],
        build: (f) => [
          { type: 'message.send', sit_id: sitId, to: f.to, text: f.text },
        ],
      },
    });
  const sign = scriptAt(desk, sit, 'sitrep.sign');
  const rep = sit.sitrep_id && loop.sitreps[sit.sitrep_id];
  // Only once the situation may close (I7): done, expired, dismissed,
  // watched, stood down, or decided with nothing to push.
  const closable =
    ['DONE', 'EXPIRED', 'DISMISSED', 'WATCH'].includes(sit.state) ||
    Boolean(sit.stand_down_at) ||
    (v && !sit.push_id && !rec && !draft);
  if (closable && (sign || (rep && !rep.signed_at)))
    add({
      id: 'sign',
      key: 'S',
      label: `Sign SITREP and close${at(sign)}`,
      confirm: `Sign the SITREP for ${sit.callsign} and close the situation?`,
      cmds: [{ type: 'sitrep.sign', sit_id: sitId, close: true }],
    });
  const rt = scriptAt(desk, sit, 'posture.retier');
  if (rt && person)
    add({
      id: 'retier',
      key: 'T',
      label: `Re-tier ${person.protection} → ${rt.to}${at(rt)}`,
      needs: 'ORTEGA',
      primary: as === 'ORTEGA',
      sheet: {
        title: `Re-tier ${person.callsign}: ${person.protection} → ${rt.to} (supervisor)`,
        fields: [{ name: 'reason', kind: 'text', value: rt.reason ?? '' }],
        require: ['reason'],
        build: (f) => [
          {
            type: 'posture.retier',
            person_id: person.id,
            to: rt.to,
            reason: f.reason,
          },
        ],
      },
    });
  const last = [...(loop.retiers || [])]
    .reverse()
    .find((r) => r.person_id === sit.person_id);
  if (!rt && last && person && last.to === person.protection)
    add({
      id: 'retier-back',
      key: null,
      label: `Re-tier back ${last.to} → ${last.from}`,
      needs: 'ORTEGA',
      sheet: {
        title: `Re-tier ${person.callsign} back: ${last.to} → ${last.from} (supervisor)`,
        fields: [{ name: 'reason', kind: 'text', value: '' }],
        require: ['reason'],
        build: (f) => [
          {
            type: 'posture.retier',
            person_id: person.id,
            to: last.from,
            reason: f.reason,
            back: true,
          },
        ],
      },
    });
  for (const a of out)
    if (a.needs && a.needs !== as && !a.disabled)
      a.disabled = `acting as ${as}: switch to ${a.needs}`;
  return out;
}

function gradeOf(g) {
  const m = /^([A-F])([1-6])$/.exec(String(g || ''));
  return m ? { source: m[1], info: Number(m[2]) } : null;
}

const CHECK = [
  ['archived', 'archive'],
  ['identity', 'identity'],
  ['account', 'account'],
  ['corroboration', 'corroboration'],
  ['place', 'geolocation'],
  ['schedule', 'schedule'],
  ['coordination', 'coordination'],
];
const row = (k, v) =>
  `<div class="dk-row"><span class="dk-k">${esc(k)}</span><span class="dk-v">${v}</span></div>`;

/** The evidence card (EP-31 §3 fixed order; EP-32 §2.2). */
export function evidenceHtml(loop, desk, sitId) {
  const sit = loop.situations[sitId];
  if (!sit) return '';
  const tz = tzOf(loop, sit);
  const v = sit.verification_id && loop.verifications[sit.verification_id];
  const rec =
    sit.recommendation_id && loop.recommendations[sit.recommendation_id];
  const draft = desk?.drafts?.[sitId];
  const items = [...sit.intel_ids, ...sit.related_intel_ids]
    .map((id) => loop.intel[id])
    .filter(Boolean);
  const head = items[0];
  const decide = scriptAt(desk, sit, 'verification.decide');
  const leg = loop.legs[sit.leg_id];
  const tags = [];
  if (v?.decision === 'unconfirmed_actionable')
    tags.push('<span class="dk-tag amber">UNCONFIRMED · ACTIONABLE</span>');
  if (v?.corroborated_by?.length)
    tags.push('<span class="dk-tag">CORROBORATED</span>');
  if (sit.salute_ids.length)
    tags.push('<span class="dk-tag light">HUMAN</span>');
  if (head?.partner_feed)
    tags.push('<span class="dk-tag dim">PARTNER FEED</span>');
  if (sit.tier === 'DETAIL') tags.push('<span class="dk-tag">2-PERSON</span>');
  const grade = v?.grade_token || sit.grade || head?.grade || '—';
  const official = (leg?.official_instructions || [])
    .map(
      (o) =>
        `<div class="dk-official">${esc(o.line || `OFFICIAL · ${o.kind}`)}</div>`,
    )
    .join('');
  const sources = items
    .map(
      (b) =>
        `<div class="dk-src"><span class="dk-grade${/^[A-F][3-6]|^F/.test(b.grade) ? ' dashed' : ''}">${esc(b.grade)}</span><span class="dk-src-class">${esc(b.source_class)}</span><span class="dk-mono">${esc(watchTime(b.sent_at))}</span><span class="dk-src-t">${esc(b.title || b.short_summary || '')}</span></div>`,
    )
    .join('');
  const sal = sit.salute_ids.map((id) => loop.salutes[id]).filter(Boolean)[0];
  const SAL = [
    ['SIZE', sal?.size],
    ['ACTIVITY', sal?.activity],
    ['LOCATION', sal?.location?.name ?? sal?.location],
    ['UNIT', sal?.unit],
    ['TIME', sal?.time ? zl(sal.time, tz) : null],
    ['EQUIPMENT', sal?.equipment],
  ];
  const checklist = v?.checklist || decide?.checklist || null;
  const checks = CHECK.map(([k, word]) => {
    const val = checklist?.[k];
    return `<li class="${val ? 'done' : ''}"><span>${val ? '✓' : '—'}</span>${esc(word)}</li>`;
  }).join('');
  let decision;
  if (v) {
    const word = {
      verified: 'VERIFIED',
      unconfirmed_actionable: 'UNCONFIRMED · actionable',
      watch: 'WATCH',
      dismissed: 'DISMISSED',
    }[v.decision];
    decision = `${word} · ${esc(v.verified_by)} ${watchTime(v.verified_at)}`;
    if (sit.tier === 'DETAIL') {
      const t = ms(loop.clock.simNow);
      decision += v.countersigned_by
        ? `<div class="dk-sig">assessed ${watchTime(v.verified_at)} ${esc(v.verified_by)} · countersigned ${watchTime(v.countersigned_at)} ${esc(v.countersigned_by)}</div>`
        : `<div class="dk-sig amber">DETAIL · two-person · countersign: awaiting ORTEGA · ${Math.max(0, Math.floor((t - ms(v.verified_at)) / 60e3))} min</div>`;
    }
  } else
    decision = `<span class="dk-dim">Not decided${decide ? ` · the script decides ${esc(decide.decision)} at ${watchTime(decide.at)} unless you act first` : ''}</span>`;
  return `<article class="dk-card dk-ev">
    <header class="dk-ev-head"><span class="dk-grade big">${esc(grade)}</span><span class="dk-src-class">${esc(head?.source_class ?? '')}</span>${tags.join('')}<span class="dk-id">${esc(sit.sit_id)}</span></header>
    ${official}
    ${row('BLUF', esc(rec?.bluf || draft?.bluf || '—') + (rec ? '' : draft ? ' <span class="dk-tag dim">draft · system</span>' : ''))}
    <div class="dk-why">${esc(sit.why_raised || '')}</div>
    ${row('SOURCE AND GRADE', `${esc(grade)}${v?.corroborated_by?.length ? ' · corroborated' : ''}`)}
    <div class="dk-srcs">${sources}</div>
    ${row('TIMES', `<span class="dk-mono">observed ${head ? dtg(head.sent_at) : '—'} · received ${head ? watchTime(head.received_at) : '—'} · raised ${watchTime(sit.raised_at)}</span>`)}
    <div class="dk-salute">${SAL.map(([k, x]) => `<span class="dk-k">${k}</span><span>${esc(x ?? '—')}</span>`).join('')}</div>
    <ul class="dk-check">${checks}</ul>
    <div class="dk-decision">${decision}</div>
    ${ladderHtml(loop, sit)}
  </article>`;
}

/** The ladder per recipient, the DL's answer, the call-back chain. */
export function ladderHtml(loop, sit) {
  const push = sit.push_id && loop.pushes[sit.push_id];
  if (!push) return '';
  const lines = push.order.map((pid) => {
    const r = push.recipients[pid];
    const cells = RUNGS.map((g, i) => {
      let word = g.toUpperCase();
      let t = r.at[g];
      if (g === 'accepted' && r.dl) {
        word = DL[r.dl.answer];
        t = r.dl.at;
      }
      const on = t ? ' on' : '';
      const cur = RUNGS.indexOf(r.rung) === i ? ' cur' : '';
      return `<span class="dk-rung${on}${cur}"><i></i><b>${word}</b><em>${t ? watchTime(t) : '—'}</em></span>`;
    }).join('');
    return `<div class="dk-ladder"><span class="dk-ladder-who">${who(loop, pid)}</span>${cells}</div>${r.dl?.reason ? `<div class="dk-dl">“${esc(r.dl.reason)}”${r.dl.plan ? ` · ${esc(r.dl.plan)}` : ''}</div>` : ''}`;
  });
  const cb = loop.callbacks[push.push_id];
  const chain = cb
    ? `<div class="dk-chain${cb.resolved_at ? '' : ' amber'}">call-back · ${cb.steps.map((s) => `${s.step} ${esc(s.role)} · ${esc(s.outcome ?? '')} ${watchTime(s.at)}`).join(' · ') || `no read ${push.read_timeout_min} min`}${cb.resolved_at ? ` · resolved ${watchTime(cb.resolved_at)}` : ''}</div>`
    : '';
  const state = push.recalled_at
    ? `<div class="dk-chain">RECALLED ${watchTime(push.recalled_at)} ${esc(push.recalled_by)} · reason: ${esc(push.recall_reason)}</div>`
    : '';
  return `<div class="dk-ladders">${lines.join('')}${chain}${state}</div>`;
}

/** The recommendation card (EP-32 §2.3: every slot, every time). */
export function recommendationHtml(loop, desk, sitId) {
  const sit = loop.situations[sitId];
  if (!sit) return '';
  const tz = tzOf(loop, sit);
  const rec =
    sit.recommendation_id && loop.recommendations[sit.recommendation_id];
  const r = rec || desk?.drafts?.[sitId];
  if (!r)
    return `<article class="dk-card"><p class="dk-dim">No draft yet. The system drafts once the item is verified.</p></article>`;
  const v = sit.verification_id && loop.verifications[sit.verification_id];
  const recips = (r.recipients || [])
    .map(
      (x) =>
        `${who(loop, x.participant_id ?? x)}${x.role ? ` <span class="dk-dim">(${esc(x.role)})</span>` : ''}`,
    )
    .join(' · ');
  const status = rec
    ? `${esc(rec.status)} · v${rec.version}${rec.approved_by ? ` · approved ${esc(rec.approved_by)} ${watchTime(rec.approved_at)}` : ''}${rec.edited_by ? ` · edited ${esc(rec.edited_by)} ${watchTime(rec.edited_at)}` : ''}`
    : `draft · system · on the record when verified (script ${watchTime(r.at)})`;
  const len = [...(r.bluf || '')].length;
  return `<article class="dk-card dk-rec">
    <div class="dk-rec-bluf">${esc(r.bluf)}</div>
    <div class="dk-dim dk-mono">${len}/90 · ${status}</div>
    ${row('ACTION', `<b class="dk-mono">${esc((r.action_display || r.action || '').toUpperCase())}</b>`)}
    ${row('BY', esc(r.by_when_display || (r.by_when ? zl(r.by_when, tz) : '—')))}
    ${row('TO', esc(r.destination?.name || '—'))}
    ${row('TO WHOM', recips || '—')}
    ${row('VALID UNTIL', esc(r.valid_until_display || (r.valid_until ? zl(r.valid_until, tz) : '—')))}
    ${row('ACK', r.requires_ack ? `required · reply ${esc(r.reply || '')}` : 'not required')}
    ${row('KNOWN', esc(r.known || '—'))}
    ${row('NOT KNOWN', esc(r.unknown || '—'))}
    ${row('NEXT UPDATE', esc(r.next_update_display || (r.next_update_at ? zl(r.next_update_at, tz) : '—')))}
    ${r.request ? row('REQUEST', esc(r.request)) : ''}
    ${row('OFFICIAL', esc(r.official_instruction || 'No official instruction on file.'))}
    <div class="dk-sig">${v ? `verified ${esc(v.verified_by)} ${watchTime(v.verified_at)}${v.countersigned_by ? ` · countersigned ${esc(v.countersigned_by)} ${watchTime(v.countersigned_at)}` : ''}` : 'not verified'}</div>
    ${ladderHtml(loop, sit)}
  </article>`;
}

const WORDS = {
  'intel.received': 'received',
  'intel.raise': 'raised',
  'intel.dismiss': 'dismissed',
  'intel.watch': 'watch',
  'intel.restore': 'restored',
  'verification.decide': 'decision',
  'verification.countersign': 'countersigned',
  'verification.reopen': 'decision reopened',
  'notify.send': 'venue and police notified',
  'recommendation.draft': 'draft (system)',
  'recommendation.edit': 'draft edited',
  'recommendation.approve': 'approved',
  'push.send': 'pushed',
  'push.recall': 'recalled',
  ack: 'receipt',
  'dl.respond': 'DL answer',
  'message.send': 'message',
  'callback.step': 'call-back step',
  'posture.retier': 're-tier',
  'sitrep.draft': 'SITREP drafted',
  'sitrep.sign': 'SITREP signed',
  'situation.close': 'closed',
  'situation.reopen': 'reopened',
  'salute.file': 'SALUTE filed (HUMAN)',
  'checkin.respond': 'check-in',
};

/** The record so far (K): every line for this situation, reversals beside what they reverse. */
export function recordHtml(loop, desk, sitId) {
  const sit = loop.situations[sitId];
  if (!sit) return '';
  const pushIds = new Set(
    Object.values(loop.pushes)
      .filter((p) => p.sit_id === sitId)
      .map((p) => p.push_id),
  );
  const bundles = new Set([...sit.intel_ids, ...sit.related_intel_ids]);
  const lines = loop.log.filter((l) => {
    const i = l.ids || {};
    return (
      i.sit_id === sitId ||
      (i.push_id && pushIds.has(i.push_id)) ||
      (i.bundle_id &&
        bundles.has(i.bundle_id) &&
        l.type !== 'intel.received') ||
      (l.type === 'posture.retier' && i.person_id === sit.person_id) ||
      (i.sitrep_id && i.sitrep_id === sit.sitrep_id)
    );
  });
  const items = lines
    .map(
      (l) =>
        `<li class="${l.reverses ? 'rev' : ''}"><span class="dk-mono">${watchTime(l.at)}</span><span>${esc(WORDS[l.type] || l.type)}</span><span class="dk-cs">${esc(l.by ?? '')}</span><span class="dk-dim">${l.via ? esc(l.via) : 'script'}${l.reverses ? ` · reverses ${esc(l.reverses)}` : ''}${l.preempts ? ` · in place of ${esc(l.preempts)}` : ''}</span></li>`,
    )
    .join('');
  const ahead = scriptFor(desk, sit)
    .map(
      (p) =>
        `<li class="ahead"><span class="dk-mono">${watchTime(p.at)}</span><span>${esc(WORDS[p.type] || p.type)}</span><span class="dk-cs">${esc(p.by)}</span><span class="dk-dim">script · a click now takes its place</span></li>`,
    )
    .join('');
  return `<article class="dk-card dk-record">
    <header class="dk-k">RECORD · ${esc(sit.callsign)} · ${esc(sit.sit_id)} · SAMPLE</header>
    <ol>${items}</ol>
    ${ahead ? `<header class="dk-k">SCRIPT AHEAD</header><ol>${ahead}</ol>` : ''}
    <footer class="dk-dim">Seen by VALE and ORTEGA (SafeTrekr Watch) and your security lead. No one else. Retained 90 days (SAMPLE policy).</footer>
  </article>`;
}

/** The breadcrumb: `KESTREL › Lunch 1230L › Evidence` (EP-34 §4). */
export function crumb(loop, sitId, tab) {
  const sit = loop.situations[sitId];
  if (!sit) return 'Queue';
  const leg = loop.legs[sit.leg_id];
  const word = {
    evidence: 'Evidence',
    rec: 'Recommendation',
    record: 'Record',
  }[tab];
  return `${esc(sit.callsign)} › ${esc(leg ? legShort(leg) : '—')} › ${word}`;
}
