// SafeTrekr Executive B6: the leave-behind as pages (EP-36 §7). Pure DOM
// from an office-audience day record (loop/record.js): the cover, one
// fixed-slot page per situation (Z first, local beside), the day summary
// and the one-page white-label sheet. Every page carries the SAMPLE
// footer and its number. The page size (A4 or US Letter) is the
// stylesheet's; nothing here measures.
import {
  h,
  retentionNode,
  situationNode,
  situationRows,
  summaryNode,
  touchedNode,
} from './recordView.js';

/** The service's names (EP-38 #13, #14: Jesse's calls). */
export const BRAND = Object.freeze({
  watch: 'SafeTrekr Watch Floor',
  product: 'Executive',
  whiteLabel: '[Your family office] Watch Floor',
  endorsement: 'Operated with SafeTrekr',
});

/** The ask, verbatim (EP-20 beat 5, EP-36 §2.7). */
export const ASK =
  "We'd like a conversation with your head of security, or your head of office if you don't have one, to run this for one travel day, five people, two weeks.";

/** The printed record is itself sensitive (R17 S2-6): its handling line. */
export const HANDLING =
  'Restricted: the family office’s security lead and principal.';

/** Who to call (Jesse, 28 Oct 2026). No person's name was given; none is invented. */
export const CONTACT = 'Contact: mike@safetrekr.com · 903.805.9225';

/**
 * The two-week pilot (B7 #16, R17 S1-3): what we need, what we do, how
 * the data is handled (the record's SAMPLE policy wording). No price.
 */
export const PILOT = Object.freeze([
  [
    'What we need from you',
    'Five people you choose, each with their consent. The itinerary for at least one travel day each within the two weeks. Your head of security, or your head of office, as the lead in the read-only seat.',
  ],
  [
    'What we do',
    'The SafeTrekr Watch Floor watches those five through their travel days for two weeks, around the clock: every item read against every leg, a named analyst verifies, pushes and closes, a supervisor countersigns. Your lead sees what we see. You get each day’s record, and we review it together at the end.',
  ],
  [
    'How the data is handled',
    'Every record carries its access log and what was shared outside it. Location sharing is each person’s own choice: the watch can ask, never switch it on. Retention: positions 30 days · situations, SITREPs and archived posts per agreement, legal hold on request (SAMPLE policy).',
  ],
]);

/** The white-label sheet's five blocks (EP-36 §7B). */
export const WHITE_LABEL = Object.freeze([
  [
    'What stays',
    [
      'The loop: every item is read against every leg; a named human verifies, pushes and closes.',
      'The watch floor, staffed around the clock by a SafeTrekr analyst and a supervisor.',
      'The record of each situation, with its access log.',
      'The detail leader’s decision: the watch advises, the detail decides.',
    ],
  ],
  [
    'What changes',
    [
      'Your mark and name on the walls, MAIN, the phones and the record header.',
      'Your retention period, by record class, with legal hold on request.',
      'Your security lead’s seat: read-only, everything the watch sees.',
    ],
  ],
  [
    'What we never do',
    [
      'No decision by a machine.',
      'No push without a named human.',
      'No message to a detail that reads as an order.',
      'No word that promises an outcome: we record what was done, when and by whom.',
    ],
  ],
  [
    'What you see',
    [
      'Everything the watch sees, as it sees it: the queue, the evidence, the decisions, the record.',
    ],
  ],
  ['Next', [ASK, CONTACT]],
]);

/** The ask and the contact, as a block (the cover and the white-label page). */
function askNode() {
  return h(
    'div',
    'pr-ask',
    h('div', 'rc-k', 'NEXT'),
    h('div', 'pr-ask-line', ASK),
    h('div', 'pr-ask-contact rc-mono', CONTACT),
  );
}

/** The two-week pilot, three short paragraphs and the contact. */
function pilotNode() {
  return h(
    'div',
    'pr-pilot',
    h('div', 'rc-k', 'THE TWO-WEEK PILOT'),
    h(
      'div',
      'pr-pilot-grid',
      PILOT.map(([k, v]) =>
        h(
          'div',
          'pr-pilot-item',
          h('div', 'pr-pilot-k', k),
          h('div', 'rc-line', v),
        ),
      ),
    ),
  );
}

function lockup({ name = BRAND.product, small = false } = {}) {
  const img = document.createElement('img');
  img.src = '/safetrekr-logo.svg';
  img.alt = 'SafeTrekr';
  img.className = 'pr-mark';
  return h(
    'span',
    `pr-lockup${small ? ' small' : ''}`,
    img,
    h('span', 'pr-sep'),
    h('span', 'pr-name', name),
  );
}

function page(n, total, title, record, ...body) {
  return h(
    'section',
    'pg',
    h(
      'header',
      'pg-head',
      lockup({ small: true }),
      h('span', 'pg-title', title),
      h('span', 'pg-chip', 'SAMPLE'),
    ),
    h('div', 'pg-body', body),
    h(
      'footer',
      'pg-foot',
      h('span', null, `${record.footer} ${HANDLING}`),
      h('span', 'rc-mono', `${record.id} · ${n} / ${total}`),
    ),
  );
}

/** The leave-behind: [cover, …situations, summary, white label] as sections. */
export function printPages(record, { source = null } = {}) {
  const sits = record.situations;
  const total = sits.length + 3;
  const head = `The day's record · ${record.date} · SAMPLE`;
  const cover = page(
    1,
    total,
    head,
    record,
    h(
      'div',
      'pr-cover',
      lockup(),
      h('h1', 'pr-h1', "The day's record"),
      h('div', 'pr-sub', `${record.date} · ${BRAND.watch} · SAMPLE`),
      h('div', 'rc-line rc-mono', record.watch.line),
      record.watch.lastHuman
        ? h('div', 'rc-line rc-mono', record.watch.lastHuman)
        : null,
    ),
    // The ask on the cover (B7 #16): the room's next step, and who to call.
    askNode(),
    h('div', 'rc-k', 'THE CLOSE · 0100Z COUNTER'),
    summaryNode(record, { compact: true, reconcile: false }),
    h('div', 'rc-k', `PEOPLE RAISED TODAY · ${sits.length} SITUATIONS`),
    h(
      'div',
      'pr-brief',
      sits.map((s, i) =>
        h(
          'div',
          'pr-brief-row',
          h('span', 'rc-mono', `p. ${i + 2}`),
          h('span', 'rc-cs', s.callsign),
          h('span', 'rc-name', s.name ?? ''),
          h('span', 'rc-tag', s.protection),
          h(
            'span',
            null,
            `${s.leg?.label ?? '—'}${s.leg?.place && !s.leg.label.includes(s.leg.place) ? ` · ${s.leg.place}` : ''}`,
          ),
          h('span', 'rc-mono', `raised ${s.raised.when}`),
        ),
      ),
    ),
    record.daily
      ? h(
          'div',
          'pr-daily',
          h('div', 'rc-k', 'DAILY SITREP'),
          h('div', 'rc-sitrep-head', record.daily.header),
          record.daily.body.map((b) => h('div', 'rc-sitrep-line', b)),
          h('div', 'rc-sitrep-sig', record.daily.signed),
        )
      : null,
    h('div', 'rc-k', 'ACCESS AND RETENTION'),
    h('div', 'rc-line', record.access.line),
    h('div', 'rc-line', record.access.retention),
    // No build notes on page 1 (B7 #16): what the page is, in one line.
    h(
      'div',
      'rc-line rc-dim',
      `${record.generated} · times Z first, local beside · callsigns throughout, names in each page's header.`,
    ),
  );
  void source;
  const pages = sits.map((s, i) =>
    page(
      i + 2,
      total,
      `${head} · situation ${i + 1} of ${sits.length}`,
      record,
      situationNode(s, record, { variant: 'print' }),
    ),
  );
  const summary = page(
    sits.length + 2,
    total,
    `${head} · the day summary`,
    record,
    h('h2', 'pr-h2', 'The day summary'),
    summaryNode(record),
    h('div', 'rc-k', 'SITUATIONS'),
    situationRows(record),
    h('div', 'rc-k', 'ACCESS PER SITUATION'),
    sits.map((s) =>
      h(
        'div',
        'rc-line',
        h('span', 'rc-cs', `${s.callsign} `),
        `${s.access.people.join(', ')} · shared outside the watch: ${
          s.access.disclosures
            .filter((d) => d.external)
            .map((d) => `${d.to} ${d.time}`)
            .join(', ') || 'none'
        }`,
      ),
    ),
    h('div', 'rc-k', 'DECIDED BY A HUMAN, NOT RAISED'),
    touchedNode(record, { limit: 16 }),
    h('div', 'rc-k', `RETENTION BY RECORD CLASS (${record.retention.policy})`),
    retentionNode(record),
  );
  const white = h(
    'section',
    'pg pg-white',
    h(
      'header',
      'wl-head',
      h('span', 'wl-mark', 'YOUR MARK'),
      h(
        'span',
        'wl-names',
        h('span', 'wl-name', BRAND.whiteLabel),
        h('span', 'wl-endorse', BRAND.endorsement),
      ),
      h('span', 'pg-chip', 'SAMPLE'),
    ),
    h(
      'div',
      'pg-body',
      h('h2', 'pr-h2', 'Under your name'),
      h(
        'div',
        'rc-line',
        'The same watch, the same loop and the same record, under your family office’s name. SafeTrekr operates it.',
      ),
      h(
        'div',
        'wl-blocks',
        WHITE_LABEL.map(([k, items]) =>
          h(
            'div',
            `wl-block${k === 'Next' ? ' next' : ''}`,
            h('div', 'rc-k', k),
            items.map((x) => h('div', 'wl-item', x)),
          ),
        ),
      ),
      pilotNode(),
    ),
    h(
      'footer',
      'pg-foot',
      h('span', null, `${record.footer} ${HANDLING}`),
      h('span', 'rc-mono', `${record.id} · ${total} / ${total}`),
    ),
  );
  return [cover, ...pages, summary, white];
}
