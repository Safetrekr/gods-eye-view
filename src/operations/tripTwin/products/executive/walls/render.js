// SafeTrekr Executive B3: the six walls as DOM (EP-32 §3), from views.js.
// Each render replaces its stage's children; nothing here keeps state.
import {
  bars,
  chain,
  counterStrip,
  div,
  el,
  evidenceCard,
  grade,
  ladder,
  protection,
  recCard,
  span,
  tag,
} from './dom.js';
import {
  flatPrincipal,
  osmNotice,
  rosterLegend,
  rosterMap,
} from './flatmap.js';

const panel = (cls = '') => div(`ex-panel tt-panel ${cls}`.trim());
const kicker = (text) => div('ex-k', text);

/** MAIN: three changes only (EP-31 §2). Left: the summary; right: decisions. */
export function renderMain(stage, v, { prevCounter = null, strip = '' } = {}) {
  const left = panel('ex-main-left');
  left.append(div('tt-watch', v.watch));
  left.append(div('tt-lastv', v.verified));
  left.append(
    div(`tt-queue-line${/overdue/.test(v.queue) ? ' amber' : ''}`, v.queue),
  );
  left.append(...counterStrip(v.counter, prevCounter));
  left.append(div('ex-main-cline', v.counterLine));
  const right = panel('ex-main-board');
  if (v.bands.length)
    for (const b of v.bands) right.append(div('tt-comms late', b.text));
  if (v.rows.length) {
    right.append(kicker(`ACTIVE SITUATIONS · ${v.rows.length}`));
    for (const r of v.rows) {
      const row = div(`tt-main-row${r.tone ? ` ${r.tone}` : ''}`);
      const l1 = div('l1');
      l1.append(span('cs', r.callsign), span('leg', r.leg));
      const l2 = div('l2', r.bluf || '');
      const l3 = div('l3');
      l3.append(
        span(`tt-ladder-word${r.tone ? ` ${r.tone}` : ''}`, r.ladder || ''),
      );
      if (r.next) l3.append(span('next', r.next));
      row.append(l1, l2, l3);
      right.append(row);
    }
    if (v.more) right.append(div('ex-more', v.more));
  } else if (v.brief) {
    right.append(kicker(v.brief.header));
    right.append(div('ex-brief-counts', v.brief.counts));
    for (const r of v.brief.rows) right.append(div('ex-brief-row', r));
    right.append(div('ex-empty', v.empty));
  } else if (v.closed.length) {
    right.append(kicker(`CLOSED TODAY · ${v.closed.length}`));
    for (const c of v.closed) right.append(div('ex-closed-row', c.text));
    right.append(div('ex-empty small', v.empty));
  } else right.append(div('ex-empty', v.empty));
  const foot = div('ex-main-strip');
  void strip;
  foot.append(
    span(
      'room',
      'SAMPLE · fictional Halden family enterprise · no real people, companies, handles or addresses',
    ),
  );
  stage.replaceChildren(left, right, foot);
}

/** Verify (EP-32 §3.3): the queue by time to exposure, the evidence card. */
export function renderVerify(stage, v) {
  const left = panel('ex-vq');
  left.append(kicker(v.head));
  if (!v.rows.length) left.append(div('ex-empty small', 'Queue: empty'));
  for (const r of v.rows) {
    const row = div(`ex-vq-row${r.overdue ? ' amber' : ''}`);
    row.append(grade(r.grade));
    const mid = div('mid');
    mid.append(span('cs', r.callsign), span('why', r.why));
    if (r.kicker) mid.append(span('tt-tag', r.kicker));
    row.append(mid, span('age', r.age));
    left.append(row);
  }
  if (v.decided.length) {
    left.append(kicker('DECIDED TODAY'));
    for (const d of v.decided) {
      const row = div('ex-vq-row dim');
      row.append(grade(d.grade));
      const mid = div('mid');
      mid.append(span('cs', d.callsign), span('why', d.line));
      row.append(mid);
      left.append(row);
    }
  }
  const right = div('ex-vcard');
  if (v.card) {
    right.append(kicker(`EVIDENCE · ${v.cardWhy}`));
    right.append(evidenceCard(v.card));
  } else right.append(div('ex-empty', 'Nothing raised today'));
  stage.replaceChildren(left, right);
}

/** Intel feed (EP-32 §3.4): newest first, every item with its status line. */
export function renderIntel(stage, v, { prevCounter = null } = {}) {
  const left = panel('ex-feed-left');
  left.append(kicker('INTAKE TODAY'));
  left.append(...counterStrip(v.counter, prevCounter));
  left.append(div('ex-last10', v.last10));
  left.append(
    div(
      'ex-note',
      'Every item is read against every leg. Not raised: the reason and who decided.',
    ),
  );
  const right = div('ex-feed');
  for (const b of v.banners) {
    const n = div('ex-banner');
    n.append(tag(b.tag), span('t', b.text));
    right.append(n);
  }
  const list = div('ex-feed-list');
  for (const f of v.items) {
    const row = div(
      `tt-feed-row${f.dim ? ' dim' : ''}${f.raised ? ' raised' : ''}${f.human ? ' human' : ''}`,
    );
    row.append(span('at', f.at));
    const cls = div('cls');
    cls.append(span('c', f.cls), tag(f.tag));
    row.append(cls, grade(f.grade));
    const body = div('body');
    const t = div('t', f.text);
    if (f.collapse) t.prepend(span('tt-tag plate x', `×${f.collapse}`));
    body.append(t, div('line', f.line));
    row.append(body);
    list.append(row);
  }
  right.append(list);
  stage.replaceChildren(left, right);
}

/** Roster map (EP-32 §3.5): flat, the seven cities, callsigns only. */
export function renderRoster(stage, v) {
  const left = panel('ex-roster-left');
  left.append(kicker('ROSTER'));
  const hero = div('ex-hero');
  hero.append(span('n', String(v.total)), span('k', 'people on watch'));
  left.append(hero);
  left.append(div('ex-prot-line', v.protection));
  for (const c of v.counts) {
    const r = div('ex-posture-row');
    r.append(
      bars(c.bars, c.posture),
      span('w', c.posture),
      span('n', String(c.n)),
    );
    left.append(r);
  }
  left.append(kicker(`RAISED · ${v.raised.length}`));
  if (!v.raised.length) left.append(div('ex-empty small', 'No one raised'));
  for (const r of v.raised) {
    const row = div('tt-raised');
    row.append(span('cs', r.callsign), span('why', r.why), span('age', r.age));
    left.append(row);
  }
  if (v.retiers.length) {
    left.append(kicker('RE-TIER TODAY'));
    for (const t of v.retiers) left.append(div('tt-retier', t));
  }
  const right = div('ex-roster-map');
  right.append(rosterMap(v), rosterLegend());
  stage.replaceChildren(left, right);
}

/** Roster by trip (EP-32 §3.7): trips, legs, check-ins, overdue. */
export function renderTrips(stage, v) {
  const head = div('ex-trips-head', v.head);
  const grid = div('ex-trips');
  for (const c of v.cards) {
    const card = div(
      `ex-trip tt-panel${c.overdue ? ' overdue' : ''}${c.raised ? ' raised' : ''}`,
    );
    const top = div('top');
    top.append(
      span('cs', c.callsign),
      protection(c.protection),
      bars(c.bars, c.posture),
    );
    card.append(top);
    card.append(div('name', `${c.name} · ${c.city}`));
    const clock = div('clock');
    clock.append(span('l', c.clock), span('z', c.zulu));
    card.append(clock);
    if (c.raised) card.append(div('raised-line', `RAISED · ${c.raised}`));
    card.append(div(`tt-checkin${c.overdue ? ' amber' : ''}`, c.checkin));
    const legs = div('legs');
    for (const l of c.legs) {
      const row = div(
        `ex-legrow${l.done ? ' done' : ''}${l.now ? ' now' : ''}`,
      );
      row.append(
        span('t', l.line),
        span('m', l.done ? '✓' : l.now ? 'now' : ''),
      );
      legs.append(row);
    }
    card.append(legs);
    grid.append(card);
  }
  stage.replaceChildren(head, grid);
}

/** Principal view (EP-32 §3.6): the sitrep card; the map is the twin (or flat). */
export function renderPrincipal(
  stage,
  v,
  overlay,
  { places = [], notice } = {},
) {
  const left = panel('ex-principal-left');
  const head = div('tt-sitrep-head');
  head.append(
    span('cs', v.callsign),
    protection(v.protection),
    bars(v.bars, v.posture, { word: true }),
  );
  left.append(head);
  left.append(div('ex-leg', v.leg));
  const dl = el('dl', 'tt-sitrep');
  for (const [k, val] of v.slots)
    dl.append(el('dt', null, k), el('dd', null, val));
  left.append(dl);
  if (v.detail) {
    const d = div('tt-detail');
    d.append(
      kicker('DETAIL'),
      div('line', v.detail.line),
      div('comms', v.detail.comms),
    );
    left.append(d);
  }
  if (v.rec && v.open) left.append(recCard(v.rec, { compact: true }));
  else if (v.rec) {
    const r = div('ex-closed-rec');
    r.append(kicker('LAST RECOMMENDATION'), div('bluf', v.rec.bluf));
    for (const l of v.rec.ladders) r.append(ladder(l));
    if (v.rec.chain) r.append(chain(v.rec.chain));
    left.append(r);
  }
  const children = [left];
  if (v.flat) {
    const f = flatPrincipal(overlay, places);
    f.prepend(
      div(
        'ex-flat-note',
        `${v.venue?.name ?? 'This venue'}: no 3D site twin · flat map`,
      ),
    );
    children.push(f);
  }
  const legend = div('ex-map-legend');
  legend.append(
    span('i route', 'route'),
    span('i planned', 'planned, superseded'),
    span('i area', 'closure / incident area'),
    span('i ent', 'entrance'),
  );
  children.push(legend, notice || osmNotice());
  stage.replaceChildren(...children);
}
