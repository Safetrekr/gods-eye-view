// SafeTrekr Executive B4a: MAIN as its own page (EP-52). Not the
// All-in-one with regions hidden: every region here is MAIN's own DOM,
// drawn from mainView (views.js), which is drawn only from selectMain.
// Of the school wall it keeps three things: the 3D canvas (placed in
// MAIN's map region by executive.css), the data attribution line and the
// relay-lost band. Every string goes through textContent.
//
//   ┌ bar: SAFETREKR | Executive · SAMPLE · ACCELERATED ·  time strip ┐
//   │ board: ACTIVE SITUATIONS · n            │ map: the top row's    │
//   │   CALLSIGN  leg (Z)                     │ site twin, flat map,  │
//   │   decision line (BLUF / DL's own line)  │ or the neutral field  │
//   │   [LADDER WORD]  next update HHMML      │                       │
//   ├ foot: watch line · last verified · queue │ one counter           ┤
import { div, span } from '../walls/dom.js';
import { venueField, worldField } from '../walls/flatmap.js';

/** A line that may break only at its ` · ` separators (never mid-phrase). */
export function dotLine(cls, text) {
  const line = div(`${cls} exm-dots`);
  const parts = String(text || '').split(' · ');
  parts.forEach((p, i) => {
    const seg = span('seg', i < parts.length - 1 ? `${p} ·` : p);
    line.append(seg);
    if (i < parts.length - 1) line.append(document.createTextNode(' '));
  });
  return line;
}

const FIGURES = [
  ['in', 'IN', 'INTAKE + PARTNER FEEDS'],
  ['matched', 'MATCHED'],
  ['raised', 'RAISED'],
  ['pushed', 'PUSHED'],
  ['closed', 'CLOSED'],
];

/** The one counter (EP-32 §6): five figures, a changed one flashes once. */
export function counterFigures(c, prev, label) {
  const box = div('exm-counter');
  box.setAttribute('role', 'group');
  if (label) box.setAttribute('aria-label', label);
  for (const [k, word, sub] of FIGURES) {
    const v = c?.[k];
    const fig = div(`fig f-${k}`);
    if (prev && prev[k] !== v) fig.classList.add('tt-changed');
    fig.append(span('n', k === 'closed' && !v ? '—' : String(v ?? '—')));
    const kk = div('k', word);
    if (sub) kk.append(span('sub', sub));
    fig.append(kk);
    box.append(fig);
  }
  return box;
}

function row(r) {
  const el = div(
    `exm-row${r.tone ? ` ${r.tone}` : ''}${r.detail ? ' detail' : ''}`,
  );
  const l1 = div('l1');
  l1.append(span('cs', r.callsign), span('leg', r.leg), span('z', r.z));
  const l2 = div('l2');
  const l3 = div('l3');
  const chip = span(`exm-chip${r.tone ? ` ${r.tone}` : ''}`, r.ladder);
  if (r.detail) {
    // The detail leader decides: his answer first, then his own line.
    l2.append(chip, span('t', r.line));
  } else {
    l2.append(span('t', r.line));
    l3.append(chip);
  }
  if (r.next) l3.append(span('next', r.next));
  el.append(l1, l2, l3);
  return el;
}

function board(v) {
  const b = div('exm-board');
  for (const band of v.bands) b.append(div('exm-band', band.text));
  if (v.rows.length) {
    b.append(div('exm-k', `ACTIVE SITUATIONS · ${v.rows.length}`));
    const list = div(`exm-rows n${Math.min(v.rows.length, 4)}`);
    for (const r of v.rows) list.append(row(r));
    b.append(list);
    if (v.more) b.append(div('exm-more', v.more));
  } else if (v.brief) {
    b.append(div('exm-k', v.brief.header));
    b.append(div('exm-brief-counts', v.brief.counts));
    const list = div('exm-brief');
    for (const r of v.brief.rows) list.append(dotLine('exm-brief-row', r));
    b.append(list);
    b.append(div('exm-empty', v.empty));
  } else if (v.closed.length) {
    b.append(div('exm-k', `CLOSED TODAY · ${v.closed.length}`));
    const list = div('exm-closed');
    for (const c of v.closed) list.append(dotLine('exm-closed-row', c.text));
    b.append(list);
    b.append(div('exm-empty small', v.empty));
  } else b.append(div('exm-empty', v.empty));
  return b;
}

/**
 * The map region. '3d': transparent, the site twin shows through (the
 * canvas sits exactly here); 'flat': the venue and the person on a plain
 * field (no site twin, so never the previous site); 'field': the land and
 * today's cities with their local times.
 */
function mapRegion(v, { cities = [] } = {}) {
  const m = div(`exm-map mode-${v.map.mode}`);
  if (v.map.mode === 'flat' && v.scene) {
    const sc = v.scene;
    const places = sc.venue
      ? [{ name: sc.venue.name, lat: sc.venue.lat, lon: sc.venue.lon }]
      : [];
    const marks = sc.person
      ? [
          {
            kind: 'person',
            label: sc.callsign,
            lat: sc.person.lat,
            lon: sc.person.lon,
          },
        ]
      : [];
    m.append(venueField({ places, marks }));
  } else if (v.map.mode === 'field') {
    m.append(worldField(cities));
    m.append(div('exm-map-credit', 'Land: Natural Earth'));
  }
  if (v.map.mode !== 'field') {
    const cap = div('exm-map-cap');
    if (v.map.leg) cap.append(div('who', v.map.leg));
    const where = [v.map.title, v.map.entrance].filter(Boolean).join(' · ');
    if (where) cap.append(dotLine('where', where));
    if (v.map.note) cap.append(div('note', v.map.note));
    m.append(cap);
  } else {
    m.append(div('exm-map-cap field', 'Legs today · local time'));
  }
  return m;
}

function foot(v, prevCounter) {
  const f = div('exm-foot');
  const st = div('exm-status');
  st.append(
    dotLine('exm-watch', v.watch),
    dotLine('exm-lastv', v.verified),
    dotLine(
      `exm-queue${/overdue/.test(v.queue || '') ? ' amber' : ''}`,
      v.queue,
    ),
  );
  f.append(st, counterFigures(v.counter, prevCounter, v.counterLine));
  return f;
}

/** MAIN, drawn whole on each render (no state kept here). */
export function renderMainPage(
  stage,
  v,
  { prevCounter = null, cities = [] } = {},
) {
  const page = div('exm');
  page.append(board(v), mapRegion(v, { cities }), foot(v, prevCounter));
  stage.replaceChildren(page);
}
