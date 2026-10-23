// Building cutaway: one bar per floor, top floor first (phase 2, ROUND-2 §2).
// Perspective-free floor read for the hotel card and the incident panel.
// Colours (Jesse): white = most likely here (estimate; faint = possibly here,
// the estimate range covers it), amber outline = assigned here, at the hotel,
// floor not known; pink = reported floor only. Never green/red on people;
// never "missing", "empty" or "clear".
import { floorRoster, footerLine } from './twinData.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const possibleN = (f) => f.possible.length + f.lastCovers.length;

/** Short state text inside a flagged bar: every count is named. */
export function floorBarText(f, { reportKind = null, compact = false } = {}) {
  const parts = [];
  if (f.state === 'reported')
    parts.push(
      compact
        ? 'Reported'
        : `Reported${reportKind ? `: ${reportKind}` : ''} · not verified`,
    );
  if (f.likely.length) parts.push(`${f.likely.length} likely`);
  if (possibleN(f)) parts.push(`${possibleN(f)} possible`);
  if (f.floorNotKnown.length)
    parts.push(`${f.floorNotKnown.length} floor not known`);
  if (!parts.length && f.state === 'lobby') parts.push('Lobby');
  return parts.join(' · ');
}

/** Hover / focus plate. */
export function floorPlate(f, { numbering = true } = {}) {
  const parts = [`${numbering ? 'Floor' : 'Level'} ${f.label}`];
  if (f.state === 'reported') parts.push('reported · not verified');
  parts.push(`${f.likely.length} most likely`);
  if (possibleN(f)) parts.push(`${possibleN(f)} possibly here`);
  if (f.floorNotKnown.length)
    parts.push(`${f.floorNotKnown.length} assigned, floor not known`);
  if (f.assigned.length) parts.push(`${f.assigned.length} assigned`);
  return parts.join(' · ');
}

/**
 * createCutaway({ compact, onPick }) → { el, render(occ, ctx), focus(label) }.
 * ctx = { numbering, reportKind, focusLabel }.
 */
export function createCutaway({ compact = false, onPick = () => {} } = {}) {
  const root = el('div', `tt-cut${compact ? ' compact' : ''}`);
  const list = el('div', 'tt-cut-list');
  list.setAttribute('role', 'group');
  list.setAttribute(
    'aria-label',
    'Floors, top to bottom. Arrow keys move, Enter opens the floor card.',
  );
  const plate = el('div', 'tt-cut-plate');
  plate.setAttribute('aria-live', 'off');
  const foot = el('div', 'tt-cut-foot');
  root.append(list, plate, foot);
  let buttons = [];
  let sig = '';
  let last = null;

  function setPlate(f) {
    plate.textContent = f
      ? floorPlate(f, last?.ctx)
      : compact
        ? ''
        : 'Select a floor to see who may be on it';
  }

  function move(from, dir) {
    const i = Math.max(
      0,
      Math.min(buttons.length - 1, buttons.indexOf(from) + dir),
    );
    for (const b of buttons) b.tabIndex = -1;
    buttons[i].tabIndex = 0;
    buttons[i].focus();
  }

  function render(occ, ctx = {}) {
    last = { occ, ctx };
    if (!occ.available) {
      const s = `na:${occ.reason}`;
      if (s === sig) return;
      sig = s;
      list.replaceChildren(el('div', 'tt-note', occ.reason));
      foot.textContent = footerLine(occ.footer);
      plate.textContent = '';
      buttons = [];
      return;
    }
    const s = JSON.stringify([
      occ.floors.map((f) => [
        f.label,
        f.state,
        f.amber,
        f.likely.length,
        possibleN(f),
        f.floorNotKnown.length,
        f.assigned.length,
      ]),
      footerLine(occ.footer),
      ctx.reportKind,
      ctx.focusLabel ?? null,
    ]);
    if (s === sig) return;
    sig = s;
    const n = occ.floors.length;
    const flagged = occ.floors.filter((f) => f.state !== 'quiet').length;
    const avail = compact ? 170 : 280;
    const tall = compact ? 14 : 16;
    const quiet = Math.max(
      compact ? 1 : 2,
      Math.min(8, (avail - flagged * tall) / Math.max(1, n - flagged)),
    );
    const flaggedLabels = new Set(
      occ.floors.filter((f) => f.state !== 'quiet').map((f) => f.label),
    );
    // Axis numbers never overprint: flagged first, then the top floor, then
    // every 5th, each at least 12 px from one already shown (review/phase5b).
    const yOf = new Map();
    let yAcc = 0;
    for (const f of occ.floors) {
      const hgt = f.state !== 'quiet' ? tall : quiet;
      yOf.set(f.label, yAcc + hgt / 2);
      yAcc += hgt;
    }
    const axis = new Set();
    const tryShow = (l) => {
      const y = yOf.get(l);
      if ([...axis].every((k) => Math.abs(yOf.get(k) - y) >= 12)) axis.add(l);
    };
    for (const l of flaggedLabels) axis.add(l);
    if (occ.floors[0]) tryShow(occ.floors[0].label);
    if (!compact)
      for (const f of occ.floors) if (f.label % 5 === 0) tryShow(f.label);
    const prevFocus = buttons.find((b) => b === document.activeElement)?.dataset
      .label;
    buttons = occ.floors.map((f) => {
      const b = el('button', 'tt-cut-floor');
      b.type = 'button';
      b.dataset.state = f.state;
      b.dataset.label = String(f.label);
      if (f.amber) b.classList.add('amber');
      if (ctx.focusLabel === f.label) b.classList.add('focus');
      const isFlagged = f.state !== 'quiet';
      b.style.height = `${isFlagged ? tall : quiet}px`;
      // Capped so white text keeps ≥ 6.4:1 on the busiest floor (UI P1-3).
      if (f.likely.length)
        b.style.setProperty(
          '--fill',
          String(Math.min(0.28, 0.14 + 0.05 * f.likely.length)),
        );
      const showNum = axis.has(f.label);
      if (!isFlagged) b.classList.add('quiet');
      b.append(
        el('span', 'g num', showNum ? String(f.label) : ''),
        el(
          'span',
          't',
          isFlagged
            ? floorBarText(f, { reportKind: ctx.reportKind, compact })
            : '',
        ),
      );
      b.setAttribute('aria-label', floorPlate(f, ctx));
      b.tabIndex = -1;
      b.addEventListener('mouseenter', () => setPlate(f));
      b.addEventListener('focus', () => setPlate(f));
      b.addEventListener('click', () => onPick(f.label));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          move(b, e.key === 'ArrowUp' ? -1 : 1);
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onPick(f.label);
        }
      });
      return b;
    });
    // Runs of 4+ quiet floors fold into one row (review/shell R2-6), worded
    // so it cannot be read as "floor clear": no estimates, not no one.
    const rows = [];
    let run = [];
    const flush = () => {
      if (run.length >= 4) {
        const top = run[0].dataset.label;
        const bottom = run[run.length - 1].dataset.label;
        const r = el('div', 'tt-cut-run');
        r.style.height = `${tall}px`;
        r.append(
          el('span', 'g num', ''),
          el('span', 't', `${bottom}–${top} · no estimates`),
        );
        r.setAttribute(
          'aria-label',
          `Floors ${bottom} to ${top}: no floor estimates · not a headcount`,
        );
        rows.push(r);
        for (const b of run) b.dataset.folded = '1';
      } else rows.push(...run);
      run = [];
    };
    for (const b of buttons) {
      if (b.classList.contains('quiet') && !b.classList.contains('focus'))
        run.push(b);
      else {
        flush();
        rows.push(b);
      }
    }
    flush();
    buttons = buttons.filter((b) => !b.dataset.folded);
    // One tab stop: the focused floor, else the reported floor, else the top.
    const stop =
      buttons.find((b) => b.dataset.label === prevFocus) ||
      buttons.find((b) => b.classList.contains('focus')) ||
      buttons.find((b) => b.dataset.state === 'reported') ||
      buttons[0];
    if (stop) stop.tabIndex = 0;
    list.replaceChildren(...rows);
    if (prevFocus) stop?.focus();
    foot.textContent = footerLine(occ.footer);
    setPlate(null);
  }
  list.addEventListener('mouseleave', () => setPlate(null));

  return {
    el: root,
    render,
    /** Move keyboard focus into the cutaway (H key). */
    focus(label) {
      const b =
        buttons.find((x) => x.dataset.label === String(label)) ||
        buttons.find((x) => x.tabIndex === 0) ||
        buttons[0];
      if (!b) return;
      for (const x of buttons) x.tabIndex = -1;
      b.tabIndex = 0;
      b.focus();
    },
  };
}

/**
 * Plain text for the hotel desk or responders: one floor. Cannot be read as
 * "floor clear": absolute time, scope, and a not-a-headcount line.
 * ctx = { hotelLabel, reportKind, asOf, atHotelNoFloor, numbering }.
 */
export function floorRosterText(occ, label, ctx = {}) {
  const r = floorRoster(occ, label, { numbering: ctx.numbering !== false });
  if (!r) return '';
  const unit = ctx.numbering === false ? 'Level' : 'Floor';
  const rel =
    r.floor.state === 'reported'
      ? ` · reported${ctx.reportKind ? `: ${ctx.reportKind}` : ''} · not verified`
      : '';
  const lines = [
    `${ctx.hotelLabel ? `${ctx.hotelLabel} · ` : ''}${unit} ${label}${rel}${ctx.asOf ? ` · as of ${ctx.asOf}` : ''}`,
    `Not a headcount. Phone-barometer estimates, not verified.${
      ctx.atHotelNoFloor
        ? ` ${ctx.atHotelNoFloor} ${ctx.atHotelNoFloor === 1 ? 'person' : 'people'} at the hotel have no floor estimate and could be on any floor.`
        : ''
    }`,
  ];
  for (const s of r.sections) {
    lines.push('', `${s.title} (${s.rows.length}):`);
    if (!s.rows.length && s.none) lines.push(`- ${s.none}`);
    for (const { row, note } of s.rows)
      lines.push(
        `- ${row.person.name}${row.person.role === 'chaperone' ? ' (chaperone)' : ''}${note ? `: ${note}` : ''}`,
      );
  }
  lines.push(
    '',
    footerLine(occ.footer),
    'Source: SafeTrekr Trip Twin (sample data, fictional people). Assignments are floor only.',
  );
  return lines.join('\n');
}
