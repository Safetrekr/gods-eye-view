// SafeTrekr Executive B6: the desk's Record card (K, EP-34 §4, §6). The
// desk is this computer's analyst, so the audience is the office: the
// person's name is added in the header only (EP-34 §2). With a situation
// selected, its record and timeline; with none, the day's record (the
// summary reconciled to the close counter, then each situation).
import { assembleRecord } from '../loop/record.js';
import {
  h,
  situationNode,
  situationRows,
  summaryNode,
  timelineNode,
  touchedNode,
} from '../record/recordView.js';

/** The record of one situation, as a node for #dk-record-slot. */
export function deskRecordNode(loop, sitId) {
  const r = assembleRecord(loop, { sitId, audience: 'office' });
  const s = r.situations[0];
  return h(
    'div',
    'rc-desk dk-rc',
    h('header', 'dk-k', `${r.title} · ${r.dtg}`),
    situationNode(s, r, { variant: 'desk' }),
    h('header', 'dk-k', 'TIMELINE · Z first, local beside'),
    timelineNode(s),
    h('footer', 'rc-line rc-dim', r.generated),
  );
}

/** The day's record (K with nothing selected). */
export function deskDayNode(loop) {
  const r = assembleRecord(loop, { audience: 'office' });
  return h(
    'article',
    'dk-card dk-record rc-desk dk-rc',
    h('header', 'dk-k', `${r.title} · ${r.dtg}`),
    h('div', 'rc-line rc-mono', r.watch.line),
    summaryNode(r),
    h('header', 'dk-k', `SITUATIONS · ${r.situations.length}`),
    situationRows(r),
    r.daily
      ? [
          h('header', 'dk-k', r.daily.header),
          r.daily.body.map((b) => h('div', 'rc-sitrep-line', b)),
          h('div', 'rc-sitrep-sig', r.daily.signed),
        ]
      : null,
    h('header', 'dk-k', 'DECIDED BY A HUMAN, NOT RAISED'),
    touchedNode(r, { limit: 8 }),
    h('header', 'dk-k', 'ACCESS'),
    h('div', 'rc-line', `${r.access.line} ${r.access.retention}`),
    h('footer', 'rc-line rc-dim', r.generated),
  );
}
