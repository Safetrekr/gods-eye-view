// SafeTrekr Executive B6: the day's record as DOM (EP-34 §6, EP-36 §7A),
// from assembleRecord (loop/record.js). One set of builders for the three
// places the record shows: a wall at beat 5 (`rc-wall`), the analyst's
// desk (`rc-desk`, K) and the printed leave-behind (`rc-print`). Every
// string goes through textContent; nothing is parsed as HTML. The slots
// are fixed and always present: an empty slot reads `—` (EP-36 §7A).

/** h('div', 'cls', child…): children are strings, nodes, arrays or null. */
export function h(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  const add = (k) => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) k.forEach(add);
    else e.append(k instanceof Node ? k : String(k));
  };
  kids.forEach(add);
  return e;
}
const dash = (v) => (v == null || v === '' ? '—' : v);
const isEmpty = (v) =>
  v == null || v === '' || (Array.isArray(v) && v.length === 0);

/** One fixed slot: the kicker, then its value (or `—`). */
export function slot(k, v, cls = '') {
  return h(
    'div',
    `rc-slot${cls ? ` ${cls}` : ''}`,
    h('div', 'rc-k', k),
    h('div', `rc-v${isEmpty(v) ? ' rc-none' : ''}`, isEmpty(v) ? '—' : v),
  );
}
const lines = (arr, cls = 'rc-line') =>
  arr.map((x) => h('div', cls, typeof x === 'string' ? x : x));

/** `ATLAS · Everett Halden` (the name only when the audience is the office). */
function whoLine(s) {
  return h(
    'span',
    'rc-who',
    h('span', 'rc-cs', s.callsign),
    s.name ? h('span', 'rc-name', s.name) : null,
  );
}

/** The ladder: four rungs, the DL's word in place of ACCEPTED. */
export function ladderNode(l) {
  return h(
    'div',
    `rc-ladder${l.state !== 'live' ? ` ${l.state}` : ''}`,
    h(
      'div',
      'rc-ladder-who',
      `${l.who}${l.role && l.role !== 'person' ? ` · ${l.role}` : ''}${l.state !== 'live' ? ` · ${l.state.toUpperCase()}` : ''}`,
    ),
    h(
      'div',
      'rc-rungs',
      l.rungs.map((r) =>
        h(
          'span',
          `rc-rung${r.at ? ' on' : ''}${/NON-CONCUR/.test(r.word) ? ' amber' : ''}`,
          h('b', null, r.word),
          h('i', null, r.time),
        ),
      ),
    ),
  );
}

/** The SITREP (current version, earlier ones listed above it). */
export function sitrepNode(s, { body = true } = {}) {
  if (!s.sitreps.length) return h('div', 'rc-v rc-none', '—');
  const cur = s.sitreps.at(-1);
  return h(
    'div',
    'rc-sitrep',
    s.sitreps.length > 1
      ? s.sitreps
          .slice(0, -1)
          .map((v) =>
            h(
              'div',
              'rc-line rc-dim',
              `v${v.version} · ${v.signed} · kept on the record`,
            ),
          )
      : null,
    h('div', 'rc-sitrep-head', cur.header),
    body && cur.body.length ? lines(cur.body, 'rc-sitrep-line') : null,
    !body && cur.card
      ? h(
          'dl',
          'rc-card',
          cur.card
            .filter(([k]) => k !== 'SIGNED')
            .map(([k, v]) => [h('dt', null, k), h('dd', null, v)]),
        )
      : null,
    h(
      'div',
      `rc-sitrep-sig${cur.signedAt ? '' : ' amber'}`,
      `${cur.drafted ? `${cur.drafted} · ` : ''}${cur.signed}`,
    ),
  );
}

/** The access block (privacy review 2): log, disclosures, retention. */
export function accessNode(s, record, { compact = false } = {}) {
  return h(
    'div',
    'rc-access',
    h('div', 'rc-k', 'ACCESS LOG'),
    lines(
      s.access.log.map((a) =>
        compact
          ? `${a.time} · ${a.who} · ${a.action}`
          : `${a.time} · ${a.who} (${a.role}) · ${a.action}${a.via ? ` · ${a.via}` : ''}`,
      ),
      'rc-line rc-mono',
    ),
    h('div', 'rc-k', 'SHARED OUTSIDE THE RECORD'),
    s.access.disclosures.length
      ? lines(
          s.access.disclosures.map((d) =>
            compact
              ? `${d.time} · ${d.to}${d.external ? ' · outside' : ` · ${d.kind}`}`
              : `${d.time} · ${d.to} · ${d.kind}${d.external ? ' · outside the watch' : ''}`,
          ),
          'rc-line rc-mono',
        )
      : h('div', 'rc-line rc-none', '—'),
    h('div', 'rc-k', 'RETENTION'),
    h(
      'div',
      'rc-line',
      compact
        ? `Situation and SITREP per agreement · legal hold ${s.access.legalHold ? 'on' : 'on request'} (SAMPLE policy).`
        : `${s.access.line} ${record.access.retention} Legal hold: ${s.access.legalHold ? 'on' : 'none'}.`,
    ),
  );
}

/**
 * One situation in fixed slots (EP-36 §7A): WHO · LEG · RAISED · GRADE ·
 * VERIFIED · COUNTERSIGNED · NOTIFIED · RECOMMENDATION · PUSHES · FIELD ·
 * ANSWER · LADDER · WATCH · FOLLOW-UP · CLOSED (SITREP) · SEEN BY. The
 * wall groups them in three columns; the desk and the print in a grid.
 */
export function situationNode(s, record, { variant = 'desk' } = {}) {
  const v = s.verification;
  const rec = s.recommendation;
  const groups = {
    raised: [
      slot('WHO', [
        whoLine(s),
        h('span', 'rc-tag', s.protection),
        s.posture ? h('span', 'rc-tag rc-dimtag', s.posture) : null,
      ]),
      slot(
        'LEG',
        s.leg
          ? `${s.leg.label}${s.leg.place && !s.leg.label.includes(s.leg.place) ? ` · ${s.leg.place}` : ''} · ${s.leg.start}`
          : null,
      ),
      slot('RAISED', [
        h('span', 'rc-mono', s.raised.when),
        ' · ',
        s.raised.why,
      ]),
      slot('GRADE', [
        h('span', 'rc-grade', s.grade.token ?? '—'),
        s.grade.word && s.grade.word !== s.grade.token
          ? ` ${s.grade.word.replace(`${s.grade.token} · `, '')}`
          : null,
        s.grade.history ? ` · ${s.grade.history}` : null,
        variant !== 'wall'
          ? h(
              'div',
              'rc-sources',
              s.sources.map((x) =>
                h(
                  'div',
                  'rc-line rc-mono rc-dim',
                  `${x.part === 'related' ? 'related · ' : ''}${x.grade ?? '—'} · ${x.cls} · observed ${x.observed} · received ${x.received}${x.kind ? ` · ${x.kind}` : ''} · ${x.tag}`,
                ),
              ),
            )
          : null,
      ]),
      slot(
        'VERIFIED',
        v
          ? [
              `${v.decision} · ${v.by} `,
              h('span', 'rc-mono', v.when),
              v.reversed ? h('div', 'rc-line amber', v.reversed) : null,
              v.earlier.length ? lines(v.earlier, 'rc-line rc-dim') : null,
            ]
          : null,
      ),
      slot(
        'COUNTERSIGNED',
        v?.countersigned
          ? `${v.countersigned}${v.twoPerson ? ' · two-person' : ''}`
          : v?.twoPerson
            ? 'awaiting ORTEGA'
            : null,
      ),
      slot(
        'NOTIFIED',
        s.notified.map((n) =>
          h('div', 'rc-line', `${n.parties.join(' · ')} · ${n.by} ${n.when}`),
        ),
      ),
    ],
    decided: [
      slot(
        'RECOMMENDATION',
        rec
          ? [
              // The authority's instruction first, ours subordinate (B7 #10).
              rec.subordinate
                ? h(
                    'div',
                    'rc-line rc-official',
                    h('span', 'rc-mono', 'OFFICIAL '),
                    `${rec.official} · our recommendation is subordinate`,
                  )
                : null,
              rec.detail ? h('div', 'rc-line rc-dim', rec.kicker) : null,
              h('div', 'rc-bluf', rec.bluf),
              // A DETAIL push: no ACTION, no ACK (B7 #8).
              h(
                'div',
                'rc-line rc-mono',
                `${rec.action ? `${rec.action} · ` : ''}BY ${rec.by} · VALID UNTIL ${rec.validUntil}`,
              ),
              h('div', 'rc-line', `TO ${rec.to}`),
              rec.request
                ? h('div', 'rc-line', `REQUEST ${rec.request}`)
                : null,
              rec.detail && rec.reply
                ? h('div', 'rc-line', `REPLY ${rec.reply}`)
                : null,
              variant !== 'wall'
                ? h(
                    'div',
                    'rc-line rc-dim',
                    `v${rec.version} · draft ${rec.draftedBy === 'system' ? 'by the system' : `by ${rec.draftedBy}`}${rec.approved ? ` · approved ${rec.approved}` : ''}${rec.subordinate ? '' : ` · ${rec.official.replace(/^No official/, 'no official')}`}`,
                  )
                : null,
            ]
          : null,
      ),
      slot(
        'PUSHES',
        s.pushes.map((p) =>
          h(
            'div',
            `rc-line rc-push ${p.state}`,
            h('span', 'rc-mono', `${p.id}`),
            ` · ${p.by} ${p.when} → ${p.to.join(', ')}`,
            p.supersedes ? ` · supersedes ${p.supersedes}` : null,
            p.status ? h('span', 'rc-push-state', ` · ${p.status}`) : null,
          ),
        ),
      ),
      slot(
        'FIELD',
        s.field.length
          ? s.field.map((f) =>
              h(
                'div',
                'rc-salute',
                h(
                  'div',
                  'rc-line rc-mono',
                  `SALUTE · HUMAN · ${f.by} · ${f.grade} · ${f.when}`,
                ),
                h(
                  'dl',
                  'rc-card',
                  f.rows.map(([k, val]) => [
                    h('dt', null, k),
                    h('dd', null, val),
                  ]),
                ),
              ),
            )
          : null,
      ),
      slot(
        'ANSWER',
        s.answers.map((a) =>
          h(
            'div',
            'rc-answer',
            h(
              'div',
              'rc-line rc-mono amber',
              `DL: ${a.word} · ${a.who} ${a.when}`,
            ),
            a.text ? h('div', 'rc-quote', `“${a.text}”`) : null,
            a.plan ? h('div', 'rc-line rc-dim', `plan: ${a.plan}`) : null,
          ),
        ),
      ),
      slot(
        'LADDER',
        s.ladders.map((l) => ladderNode(l)),
      ),
    ],
    followed: [
      slot('WATCH', [
        // The wall keeps the watch's acknowledgements; the rest is counted.
        (variant === 'wall'
          ? s.messages.filter((m) => m.kind === 'watch acknowledgement')
          : s.messages
        ).map((m) =>
          h(
            'div',
            'rc-line',
            h('span', 'rc-mono', `${m.when.slice(0, 5)} `),
            `${m.kind} · ${m.by} → ${m.to}: ${m.text ?? ''}`,
          ),
        ),
        variant === 'wall' &&
        s.messages.some((m) => m.kind !== 'watch acknowledgement')
          ? h(
              'div',
              'rc-line rc-dim',
              `+ ${s.messages.filter((m) => m.kind !== 'watch acknowledgement').length} updates and requests on the record`,
            )
          : null,
      ]),
      slot('FOLLOW-UP', [
        ...s.retiers.map((r) =>
          h(
            'div',
            'rc-line',
            `RE-TIER ${r.line}${r.effect ? ` · ${r.effect}` : ''}`,
          ),
        ),
        s.callback
          ? h(
              'div',
              'rc-callback',
              h(
                'div',
                'rc-line',
                `call-back from ${s.callback.started} · ${s.callback.resolved}`,
              ),
              lines(
                s.callback.steps.map((x) => x.line),
                'rc-line rc-mono rc-dim',
              ),
            )
          : null,
        s.comms ? h('div', 'rc-line rc-mono', s.comms.line) : null,
        s.standDown
          ? h(
              'div',
              'rc-line',
              `STAND-DOWN ${s.standDown.by} ${s.standDown.when}${s.standDown.text ? `: ${s.standDown.text}` : ''}`,
            )
          : null,
        variant === 'print' || variant === 'desk'
          ? lines(
              s.followup
                .filter(
                  (c) =>
                    c.kind !== 'stand_down' &&
                    !(c.kind === 'comms_check' && /^COMMS OK$/.test(c.text)),
                )
                .map(
                  (c) =>
                    `${c.when.slice(0, 5)} ${c.who}: ${c.text ?? c.status}`,
                ),
              'rc-line rc-dim',
            )
          : null,
        s.reopened.length
          ? lines(
              s.reopened.map((r) => `REOPENED ${r}`),
              'rc-line amber',
            )
          : null,
      ]),
      slot('CLOSED', [
        s.closed
          ? h(
              'div',
              'rc-line',
              `${s.closed.reason} · ${s.closed.by ?? '—'} ${s.closed.when}`,
            )
          : h('div', 'rc-line amber', 'open'),
        sitrepNode(s, { body: variant !== 'wall' }),
      ]),
    ],
  };
  const head = h(
    'div',
    'rc-sit-head',
    whoLine(s),
    h('span', 'rc-mono rc-dim', ` ${s.sit_id} · raised ${s.raised.dtg}`),
  );
  if (variant === 'wall')
    return h(
      'div',
      'rc-sit rc-sit-wall',
      head,
      h(
        'div',
        'rc-cols',
        // One slot order on every surface (R14 S2-5): raised → decided →
        // followed → CLOSED → SEEN BY, read down the three columns.
        h('div', 'rc-col', groups.raised, groups.decided.slice(0, 2)),
        h('div', 'rc-col', groups.decided.slice(2), groups.followed[0]),
        h(
          'div',
          'rc-col',
          groups.followed.slice(1),
          slot('SEEN BY', accessNode(s, record, { compact: true }), 'rc-seen'),
        ),
      ),
    );
  return h(
    'div',
    `rc-sit rc-sit-${variant}`,
    head,
    h('div', 'rc-grid', groups.raised, groups.decided, groups.followed),
    slot('SEEN BY', accessNode(s, record), 'rc-seen'),
  );
}

/** The timeline of one situation, Z first, reversals beside what they reverse. */
export function timelineNode(s) {
  return h(
    'ol',
    'rc-tl',
    s.timeline.map((l) =>
      h(
        'li',
        `${l.reverses ? 'rev' : ''}${l.reversed ? ' reversed' : ''}`.trim() ||
          null,
        h('span', 'rc-mono', l.when),
        h('span', 'rc-cs', l.who),
        h(
          'span',
          null,
          l.what,
          l.reversed ? h('em', 'rc-rev', ` · ${l.reversed}`) : null,
        ),
      ),
    ),
  );
}

/** The day summary: the counter, counted from the record, reconciled. */
export function summaryNode(
  record,
  { compact = false, reconcile = true } = {},
) {
  const c = record.summary.counter;
  const k = record.summary.counted;
  const figs = [
    ['in', 'IN (INTAKE + PARTNER FEEDS)'],
    ['matched', 'MATCHED'],
    ['raised', 'RAISED'],
    ['pushed', 'PUSHED'],
    ['closed', 'CLOSED'],
  ];
  return h(
    'div',
    'rc-summary',
    h(
      'div',
      'rc-figs',
      figs.map(([key, word]) =>
        h(
          'div',
          `rc-fig${c[key] !== k[key] ? ' amber' : ''}`,
          h('b', null, String(c[key])),
          h('i', null, word),
        ),
      ),
    ),
    !reconcile && record.summary.reconciled
      ? null
      : h(
          'div',
          `rc-line rc-mono${record.summary.reconciled ? '' : ' amber'}`,
          record.summary.reconciled
            ? `Counted from this record: ${k.in} · ${k.matched} · ${k.raised} · ${k.pushed} · ${k.closed}. Matches the close counter.`
            : `Does not match the close counter: ${record.summary.mismatches.join(', ')}`,
        ),
    compact
      ? null
      : h(
          'div',
          'rc-line',
          `Not raised: ${record.summary.notRaised} items, each with its reason on the Intel feed; matched and not raised: ${record.summary.matchedNotRaised}. Pushes: ${record.summary.pushes.total}${record.summary.pushes.recalled ? `, ${record.summary.pushes.recalled} recalled` : ''}${record.summary.pushes.superseded ? `, ${record.summary.pushes.superseded} superseded` : ''}${record.summary.pushes.expired ? `, ${record.summary.pushes.expired} expired` : ''}. Open: ${record.summary.open.length ? record.summary.open.join(', ') : 'none'}.`,
        ),
  );
}

/** One row per situation: callsign · state · SITREP. */
export function situationRows(record, { mark = null } = {}) {
  return h(
    'div',
    'rc-rows',
    record.situations.map((s) => {
      const cur = s.sitreps.at(-1);
      return h(
        'div',
        `rc-row${s.sit_id === mark ? ' mark' : ''}`,
        h('span', 'rc-cs', s.callsign),
        h(
          'span',
          'rc-mono',
          s.closed
            ? `CLOSED ${s.closed.when.slice(0, 5)} · SITREP ${cur?.signedBy ?? '—'}`
            : `${s.state} · open`,
        ),
        h('span', 'rc-dim', s.leg?.label ?? ''),
      );
    }),
  );
}

/** The touched-not-raised list (EP-34 §6.4): reason and initials. */
export function touchedNode(record, { limit = Infinity } = {}) {
  const t = record.touched.slice(0, limit);
  return h(
    'div',
    'rc-touched',
    t.length
      ? t.map((x) =>
          h(
            'div',
            'rc-line rc-mono',
            `${x.time} · ${x.callsign ?? '—'} · ${x.cls} · ${x.grade ?? '—'} · ${x.decision}: ${x.reason} · ${x.by}`,
          ),
        )
      : h('div', 'rc-line rc-none', '—'),
    record.touched.length > t.length
      ? h('div', 'rc-line rc-dim', `+${record.touched.length - t.length} more`)
      : null,
  );
}

/** Retention by record class, under its policy label. */
export function retentionNode(record) {
  return h(
    'div',
    'rc-retention',
    h(
      'dl',
      'rc-card',
      record.retention.classes.map(([k, v]) => [
        h('dt', null, k),
        h('dd', null, v),
      ]),
    ),
    h(
      'div',
      'rc-line',
      `Legal hold: supported, ${record.retention.legalHold.note} (${record.retention.policy}).`,
    ),
  );
}

export { dash };
