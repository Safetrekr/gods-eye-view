// SafeTrekr Executive B3: the five components (EP-32 §2) as DOM, from the
// plain data in views.js. Every string goes through textContent; nothing
// is parsed as HTML.

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
export const div = (cls, text) => el('div', cls, text);
export const span = (cls, text) => el('span', cls, text);

/** `.tt-grade`: mono, bordered, no fill; dashed for F or info ≥ 3. */
export function grade(g, extra = '') {
  if (!g) return span('tt-grade tt-grade-none', '—');
  return span(
    `tt-grade${g.dashed ? ' dashed' : ''}${extra ? ` ${extra}` : ''}`,
    g.text,
  );
}

/** `.tt-tag`: same recipe; amber dashed, dim, or a light plate (HUMAN). */
export function tag(t) {
  const o = typeof t === 'string' ? { text: t } : t;
  const tone =
    o.tone ||
    (/^HUMAN/.test(o.text)
      ? 'plate'
      : /^PARTNER/.test(o.text)
        ? 'dim'
        : /^LIVE/.test(o.text)
          ? 'live'
          : /^SAMPLE/.test(o.text)
            ? 'sample'
            : null);
  return span(
    `tt-tag${tone ? ` ${tone}` : ''}${o.dashed ? ' dashed' : ''}`,
    o.text,
  );
}

/** Posture as a stack of one to four bars, then (optionally) its word. */
export function bars(n, posture, { word = false } = {}) {
  const b = span(`tt-bars p-${String(posture || 'ROUTINE').toLowerCase()}`);
  b.setAttribute('aria-label', posture || 'ROUTINE');
  for (let i = 1; i <= 4; i++) b.append(span(i <= n ? 'on' : 'off'));
  if (!word) return b;
  const w = span('tt-posture');
  w.append(b, span('tt-posture-word', posture));
  return w;
}

/** `.tt-ladder`: four segments, the current one with the live dot. */
export function ladder(l, { big = false } = {}) {
  const gone = l.state && l.state !== 'live';
  const box = div(`tt-ladder${big ? ' big' : ''}${gone ? ` ${l.state}` : ''}`);
  if (l.who) box.append(div('tt-ladder-who', l.who));
  // A recalled or superseded push stays, greyed, with what happened to it.
  if (gone && l.note) box.append(div('tt-push-note', l.note));
  const row = div('tt-ladder-row');
  for (const r of l.rungs) {
    // A long word (NON-CONCUR, SUPPORT REQUESTED) takes a wider rung, so
    // it never runs into DONE (R12 S2-5).
    const seg = div(
      `tt-rung${r.done ? ' done' : ''}${r.current ? ' current' : ''}${r.tone ? ` ${r.tone}` : ''}${String(r.word).length > 8 ? ' wide' : ''}`,
    );
    seg.append(div('bar'));
    const w = div('word', r.word);
    if (r.current) w.prepend(span('tt-livedot'));
    seg.append(w, div('t', r.time));
    row.append(seg);
  }
  box.append(row);
  if (l.reason) box.append(div('tt-ladder-reason', l.reason));
  return box;
}

/** `.tt-chain`: the call-back chain, amber while it runs. */
export function chain(c) {
  const box = div(`tt-chain${c.running ? ' running' : ''}`);
  box.append(div('head', c.head));
  for (const s of c.steps) box.append(div('step', s));
  if (c.next) box.append(div('step next', c.next));
  return box;
}

/** `.tt-rec`: the order shape, every slot every time. */
export function recCard(r, { compact = false } = {}) {
  const box = div(
    `tt-rec${compact ? ' compact' : ''}${r.expired ? ' expired' : ''}`,
  );
  // The authority's instruction sits above ours, once (EP-33 §5).
  for (const o of r.official || []) {
    const off = div('tt-rec-official');
    off.append(span('k', 'OFFICIAL'), span('v', o));
    box.append(off);
  }
  box.append(div('tt-rec-k', r.kicker || 'RECOMMENDATION'));
  box.append(div('tt-rec-bluf', r.bluf));
  if (r.action || r.subordinate) {
    const a = div('tt-rec-acts');
    if (r.action) a.append(span('tt-rec-action', r.action.toUpperCase()));
    if (r.subordinate) a.append(span('tt-rec-sub', 'subordinate'));
    box.append(a);
  }
  if (!compact) {
    const dl = el('dl', 'tt-rec-rows');
    for (const [k, v] of r.rows)
      dl.append(el('dt', null, k), el('dd', null, v));
    box.append(dl);
  }
  for (const l of r.ladders) box.append(ladder(l));
  if (r.chain) box.append(chain(r.chain));
  box.append(div(`tt-sig${r.recalled ? ' amber' : ''}`, r.sig));
  return box;
}

/** `.tt-ev`: the evidence card, fixed order (EP-32 §2.2). */
export function evidenceCard(c) {
  const box = div('tt-ev tt-panel');
  const head = div('tt-ev-head');
  head.append(grade(c.grade, 'big'), span('tt-ev-src-cls', c.source));
  for (const t of c.tags) head.append(tag(t));
  head.append(span('tt-ev-id', c.id));
  box.append(head);
  if (c.gradeStep) box.append(div('tt-ev-step', c.gradeStep));
  box.append(div('tt-ev-why', c.why));
  box.append(div('tt-ev-times', c.times));
  const cols = div('tt-ev-cols');
  const left = div('tt-ev-left');
  const chk = div('tt-ev-check');
  chk.append(div('tt-k', 'CHECKLIST'));
  for (const x of c.checklist) {
    const r = div(`row${x.done ? ' done' : ''}`);
    r.append(
      span('mark', x.done ? '✓' : '—'),
      span('k', x.word),
      span('v', x.result),
    );
    chk.append(r);
  }
  left.append(chk);
  const src = div('tt-ev-src');
  src.append(div('tt-k', 'SOURCES'));
  for (const s of c.sources) {
    const r = div(`row${s.related ? ' related' : ''}`);
    r.append(
      grade(s.grade),
      span('cls', s.cls),
      span('at', s.at),
      span('txt', s.text),
      tag(s.tag),
    );
    if (s.step) r.append(span('step', s.step));
    src.append(r);
  }
  left.append(src);
  // The field report, attached under the item it answers (EP-37 §8).
  if (c.salute) {
    const sal = div('tt-salute');
    sal.append(div('tt-k', 'SALUTE · HUMAN'));
    for (const [k, v] of c.salute) {
      const r = div('row');
      r.append(span('k', k), span('v', v));
      sal.append(r);
    }
    left.append(sal);
  }
  const right = div('tt-ev-right');
  const dec = div('tt-ev-decision');
  dec.append(div('line', c.decision));
  if (c.countersign) dec.append(div('tt-countersign', c.countersign));
  for (const n of c.notified) dec.append(div('note', n));
  if (c.retier) dec.append(div('tt-retier', c.retier));
  right.append(dec);
  if (c.rec) {
    const rc = recCard(c.rec);
    // The watch's acknowledgement under the leader's answer (R11 S2-4).
    if (c.answers?.length) {
      const sig = rc.querySelector('.tt-sig');
      for (const a of c.answers) rc.insertBefore(div('tt-watch-ack', a), sig);
    }
    right.append(rc);
  }
  cols.append(left, right);
  box.append(cols);
  return box;
}

/**
 * `.tt-counter`: five figures (EP-32 §6) in MAIN's layout (B7 #11): IN
 * wider, a clear gap between figures, its sub-label under its own figure
 * only, so `186` and `7` never read as `1867`. A changed figure flashes.
 */
export function counterStrip(c, prev = null) {
  const box = div('tt-counter');
  const figs = [
    ['in', 'IN', 'INTAKE + PARTNER FEEDS'],
    ['matched', 'MATCHED'],
    ['raised', 'RAISED'],
    ['pushed', 'PUSHED'],
    ['closed', 'CLOSED'],
  ];
  for (const [k, label, sub] of figs) {
    const f = div(`fig f-${k}${prev && prev[k] !== c[k] ? ' tt-changed' : ''}`);
    const kk = div('k', label);
    if (sub) kk.append(span('sub', sub));
    f.append(div('n', k === 'closed' && !c[k] ? '—' : String(c[k])), kk);
    box.append(f);
  }
  return [box];
}

/** A protection kicker: mono, never a colour. */
export const protection = (p) => span('tt-prot', p);
