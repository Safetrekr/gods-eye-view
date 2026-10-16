// Trip Twin DOM chrome after the cleanup pass (review/00-FIX-LIST.md):
// one top line per mode, roster + find fixed, Needs attention grouped and
// capped, safety/hazards/sources one click away; incident panel with names,
// copy, official slot and paths; selection card only re-renders on change.
import { ROSTER_BUCKETS, bearingLabel, formatDistance } from './twinData.js';
import { UNKNOWN_TEXT, floorText, initialsOf } from './twinPeople.js';
import { arriveBy, HAZARD_NEAR_M } from './twinPaths.js';
import { ringKind } from './twinPins.js';
import { avoidCrossings } from './twinCustomPaths.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
};

const CALM_CAP = 5;
const INCIDENT_GROUP_CAP = 3;

export function verdictLongForm(row, site) {
  const v = row.verdict;
  const c = row.person.coordinates;
  const where = () => {
    if (!c) return '';
    const p = { lat: c.lat, lon: c.lng };
    return `${formatDistance(v.distM || 0)} ${bearingLabel(site.hotelPoint, p)}`;
  };
  const noun = site.noun || 'hotel';
  const text = {
    'HTL-01': `Inside ${noun} (likely)`,
    'HTL-02': `At ${noun} · inside or outside undetermined`,
    'HTL-03': `Outside ${noun} · ${where()}`,
    'HTL-04': `Away · ${where()} of ${noun}`,
  }[v.lastVerdict || v.id];
  if (v.bucket === 'Not located') return 'No location reported';
  if (v.bucket === 'Not current')
    return `Last known position: ${text?.replace(/^./, (m) => m.toLowerCase())}`;
  return text || '';
}

function rowReason(row, groupKey, ctx) {
  if (groupKey === 'elsewhere_above' && row.elsewhereReason)
    return row.elsewhereReason;
  if (groupKey === 'at_or_above' && ctx.mode?.assignedAbove?.has(row.person.id))
    return `Assigned floor ${row.assigned} · floor not detected — ${
      row.floor.kind === 'not_shared'
        ? 'floor not shared'
        : UNKNOWN_TEXT[row.floor.reason] || 'no estimate'
    }`;
  if (groupKey === 'at_or_above' || groupKey === 'in_building') {
    const ft = floorText(row.floor, { numbering: ctx.numbering });
    return ft || 'Floor unknown';
  }
  if (groupKey === 'not_located') return 'No location reported';
  if (groupKey === 'alone')
    return row.person.unaccompanied
      ? 'Unaccompanied · outside group zone'
      : 'Outside group zone';
  return row.pos.label;
}

function initialsBadge(row) {
  const kind = ringKind(row.pos);
  return el(
    'span',
    `ini ${kind === 'aging' ? 'aging' : kind === 'last' || kind === 'unknown' ? 'last' : ''}`,
    initialsOf(row.person.name).replace(/\./g, ''),
  );
}

/** Path cards: clear paths first; a path within 1 km of a heat detection is flagged. */
export function pathCards(
  paths = [],
  {
    night = false,
    incident = false,
    simulated = false,
    pace = null,
    areas = [],
  } = {},
) {
  const cards = paths.map((p) => {
    const flagged =
      p.kind !== 'unavailable' &&
      p.hazard?.hazard &&
      p.hazard.distanceM <= HAZARD_NEAR_M;
    const entered =
      p.kind !== 'unavailable' ? avoidCrossings(p.geometry || [], areas) : [];
    return {
      p,
      flagged: Boolean(flagged) || entered.length > 0,
      heat: Boolean(flagged),
      entered,
    };
  });
  cards.sort(
    (a, b) =>
      Number(a.flagged) - Number(b.flagged) ||
      (a.p.kind === 'primary' ? -1 : 1),
  );
  let arriveShown = false;
  return cards.map(({ p, flagged, entered, heat }) => {
    const name =
      p.kind === 'alternate'
        ? 'Alternate path'
        : 'Path to rally point (primary)';
    if (p.kind === 'unavailable')
      return {
        flagged: true,
        title: `${name} · walking path unavailable`,
        lines: [`${formatDistance(p.distanceM)} straight line shown`],
      };
    const lines = [
      'Suggested · unverified · not checked for closures, crowds or lighting',
    ];
    if (heat)
      lines.push(
        `Within 1 km of a ${simulated ? 'SIMULATED ' : ''}heat detection (${formatDistance(p.hazard.distanceM)} ${bearingLabel(p.geometry[p.hazard.index], p.hazard.hazard)}) — check before use`,
      );
    if (p.kind === 'alternate' && p.sharedStartM > 40)
      lines.push(`Shares the first ${p.sharedStartM} m with the primary path`);
    if (entered?.length)
      lines.push(
        `Enters avoid-area: ${entered.map((a) => a.reason).join(', ')} — plan your own path to go around it`,
      );
    if (pace && p.walk)
      lines.push(
        `${pace.simulated ? 'SIMULATED ' : ''}${pace.band} rain: allow +${pace.pct}% walking time → ${Math.ceil(p.walk[0] * pace.factor)}–${Math.ceil(p.walk[1] * pace.factor)} min`.replace(
          /^./,
          (m) => m.toUpperCase(),
        ),
      );
    if (incident && !flagged && !arriveShown) {
      lines.push(
        `Suggested arrive-by: ${arriveBy(p.distanceM, { night }).total} min`,
      );
      arriveShown = true;
    }
    return {
      flagged,
      title: `${name} · ${formatDistance(p.distanceM)} · walk ${p.walk[0]}–${p.walk[1]} min`,
      lines,
    };
  });
}

function cardEl(card) {
  const c = el('div', `tt-path-card${card.flagged ? ' flag' : ''}`);
  c.append(el('div', 't', card.title));
  for (const l of card.lines) c.append(el('div', 'l', l));
  return c;
}

export function createHud({
  rail,
  incident,
  onSelectPerson,
  onDismissReport,
  onUndoDismiss,
  onCopy,
  onOpenFloor = () => {},
  onSetNumbering = () => {},
}) {
  // Persistent rail skeleton: the find input is never re-created.
  const head = el('div', 'tt-rail-head');
  const fixed = el('div', 'tt-rail-fixed');
  const scroll = el('div', 'tt-rail-scroll');
  rail.replaceChildren(head, fixed, scroll);
  const peopleHead = el('div', 'tt-section-head');
  const roster = el('div', 'tt-roster');
  const zone = el('div', 'tt-line');
  const chap = el('div', 'tt-line');
  const find = el('div', 'tt-find');
  const findInput = el('input');
  findInput.type = 'search';
  findInput.placeholder = 'Find a person  ( / )';
  findInput.setAttribute('aria-label', 'Find a person');
  findInput.id = 'tt-find';
  const findList = el('ul', 'tt-find-list');
  findList.hidden = true;
  find.append(findInput, findList);
  fixed.append(peopleHead, roster, zone, chap, find);

  let last = null;
  const showAll = new Set();
  let dismissStep = 0;

  const matches = (q) => {
    const s = q.trim().toLowerCase();
    if (!s || !last) return [];
    return last.a.rows.filter(
      (r) =>
        r.person.name.toLowerCase().includes(s) ||
        initialsOf(r.person.name).toLowerCase().replace(/\./g, '') ===
          s.replace(/\./g, ''),
    );
  };
  function renderFind() {
    const rows = matches(findInput.value);
    if (!findInput.value.trim()) {
      findList.hidden = true;
      return;
    }
    findList.replaceChildren(
      ...(rows.length
        ? rows.slice(0, 12).map((r, i) => {
            const li = el('li');
            const b = el('button', i === 0 ? 'on' : '');
            b.type = 'button';
            b.append(
              el('span', '', r.person.name),
              el('span', 'tt-dim', r.verdict.bucket),
            );
            b.addEventListener('mousedown', (e) => {
              e.preventDefault();
              pick(r.person.id);
            });
            li.append(b);
            return li;
          })
        : [el('li', 'tt-note', 'No one with that name is loaded')]),
    );
    findList.hidden = false;
  }
  function pick(id) {
    findInput.value = '';
    findList.hidden = true;
    findInput.blur();
    onSelectPerson(id, { frame: true });
  }
  findInput.addEventListener('input', renderFind);
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = matches(findInput.value)[0];
      if (first) pick(first.person.id);
    }
    if (e.key === 'Escape') {
      findInput.value = '';
      findList.hidden = true;
      findInput.blur();
      e.stopPropagation();
    }
  });
  findInput.addEventListener('blur', () =>
    setTimeout(() => (findList.hidden = true), 150),
  );

  function disclose(label, key, ctx, children) {
    const d = el('details', 'tt-disclose');
    d.open = Boolean(ctx.open[key]);
    d.addEventListener('toggle', () => (ctx.open[key] = d.open));
    d.append(el('summary', '', label), ...children);
    return d;
  }

  function renderRail(a, ctx) {
    const m = ctx.mode;
    head.replaceChildren(el('div', `tt-topline ${m.mode}`, m.topLine));
    if (m.subLine) head.append(el('div', 'tt-subline', m.subLine));
    if (ctx.siteLine)
      head.append(el('div', 'tt-subline tt-site-line', ctx.siteLine));
    if (m.mode !== 'incident')
      for (const o of ctx.weather?.official || [])
        head.append(el('div', 'tt-subline tt-wx-official', o));

    peopleHead.replaceChildren(
      el('span', 'tt-kicker', 'PEOPLE'),
      el('span', 'tt-kicker num', `of ${a.rows.length} loaded`),
    );
    roster.replaceChildren();
    roster.setAttribute('aria-label', a.rosterText);
    for (const b of ROSTER_BUCKETS) {
      const n =
        b === 'Inside (likely)' && ctx.hotelApproximate ? '—' : a.counts[b];
      const zero = n === 0;
      const warn = !zero && (b === 'Not current' || b === 'Not located');
      roster.append(
        el(
          'span',
          `lbl${zero ? ' zero' : ''}`,
          b === 'Away'
            ? 'Away from this site'
            : b.replace('hotel', ctx.siteNoun || 'hotel'),
        ),
        el(
          'span',
          `cnt${zero ? ' zero' : ''}${warn ? ' warn' : ''}`,
          String(n),
        ),
      );
    }
    zone.textContent = a.zone.text;
    const ch = a.chaperones;
    const cur = ch.filter((r) => r.pos.current).length;
    chap.textContent = `Chaperones ${ch.length} · ${cur} current${ch.length - cur ? ` · ${ch.length - cur} not current` : ''}`;

    const top = scroll.scrollTop;
    scroll.replaceChildren();
    const needsHead = el('div', 'tt-section-head');
    needsHead.append(
      el('span', 'tt-kicker', 'NEEDS ATTENTION'),
      el('span', 'tt-kicker num', String(m.total).padStart(2, '0')),
    );
    scroll.append(needsHead);
    if (!m.groups.length)
      scroll.append(
        el(
          'div',
          'tt-note',
          'No one needs a check-in right now, based on the traveler data shown.',
        ),
      );
    let shown = 0;
    for (const g of m.groups) {
      const incidentMode = m.mode === 'incident';
      const cap = incidentMode
        ? g.key === 'at_or_above'
          ? Infinity
          : INCIDENT_GROUP_CAP
        : Math.max(1, CALM_CAP - shown);
      const all = showAll.has(g.key);
      const rows = all ? g.rows : g.rows.slice(0, cap);
      const box = el('div', `tt-group${g.key === 'at_or_above' ? ' p1' : ''}`);
      const gh = el('div', 'tt-group-head');
      gh.append(
        el('span', '', g.label),
        el('span', 'num', String(g.rows.length)),
      );
      box.append(gh);
      for (const r of rows) {
        const b = el(
          'button',
          `tt-rowbtn${ctx.selectedPersonId === r.person.id ? ' on' : ''}`,
        );
        b.type = 'button';
        b.dataset.personId = r.person.id;
        const text = el('span');
        text.append(
          el(
            'div',
            'who',
            r.person.name + (r.person.role === 'chaperone' ? ' (C)' : ''),
          ),
          el('div', 'why', rowReason(r, g.key, ctx)),
        );
        b.append(initialsBadge(r), text);
        b.addEventListener('click', () =>
          onSelectPerson(r.person.id, { frame: true }),
        );
        box.append(b);
      }
      if (g.rows.length > rows.length || all) {
        const more = el(
          'button',
          'tt-more',
          all ? 'Show fewer' : `Show all ${g.rows.length}`,
        );
        more.type = 'button';
        more.addEventListener('click', () => {
          if (all) showAll.delete(g.key);
          else showAll.add(g.key);
          renderRail(last.a, last.ctx);
        });
        box.append(more);
      }
      shown += rows.length;
      scroll.append(box);
    }

    if (m.mode !== 'incident') {
      const cards = pathCards(ctx.paths, {
        night: ctx.night,
        simulated: ctx.fires?.simulated,
        pace: ctx.weather?.pace,
        areas: ctx.avoidAreas || [],
      });
      const first = cards[0];
      scroll.append(
        el(
          'div',
          'tt-safety-line',
          first
            ? first.title
            : ctx.pathsLoading
              ? 'Planning walking paths…'
              : 'No rally point path yet',
        ),
        disclose('Safety & paths', 'safety', ctx, [
          ...cards.map(cardEl),
          ...(ctx.safetyLines || []).map((l) => el('div', 'tt-line', l)),
        ]),
      );
    }
    scroll.append(
      el(
        'div',
        'tt-line',
        ctx.fires?.line || 'Satellite heat detections · loading',
      ),
      disclose(
        'Hazards',
        'hazards',
        ctx,
        (ctx.fires?.details || []).map((l) => el('div', 'tt-line', l)),
      ),
      disclose(
        'Sources',
        'sources',
        ctx,
        ctx.sources.map((l) => el('div', 'tt-line', l)),
      ),
    );
    scroll.scrollTop = top;
  }

  function renderIncident(a, ctx) {
    const m = ctx.mode;
    if (m.mode !== 'incident') {
      dismissStep = 0;
      incident.hidden = !ctx.dismissed;
      if (ctx.dismissed) {
        const undo = el('button', 'tt-btn', 'Undo');
        undo.type = 'button';
        undo.addEventListener('click', onUndoDismiss);
        incident.replaceChildren(
          el('div', 'tt-kicker', 'REPORT DISMISSED'),
          el('div', 'tt-line', `${ctx.dismissed.reason} · ${ctx.dismissed.at}`),
          undo,
        );
      }
      return;
    }
    incident.hidden = false;
    incident.replaceChildren();
    const inc = ctx.incident;
    // Order (review/phase2 F10): title → hero + breakdown → names → Copy →
    // weather → floors → official block → paths.
    const title = el('div', 'tt-inc-title');
    const floorBtn = el(
      'button',
      'tt-inline-link',
      `floor ${ctx.reportedLabel}`,
    );
    floorBtn.type = 'button';
    floorBtn.title = 'Open the floor card';
    floorBtn.addEventListener('click', () => onOpenFloor(ctx.reportedLabel));
    if (inc)
      title.append(
        `${inc.kind.replace(/^./, (x) => x.toUpperCase())} · `,
        floorBtn,
        ` · ${inc.source} · ${inc.clock}`,
      );
    else title.append(floorBtn, ' · operator entry');
    incident.append(
      el(
        'div',
        'tt-kicker',
        `REPORTED · NOT VERIFIED${ctx.night ? ' · NIGHT' : ''}`,
      ),
      title,
    );
    const g1 = m.groups.find((g) => g.key === 'at_or_above');
    if (m.comparable === false) {
      incident.append(
        el(
          'div',
          'tt-hero-note',
          m.outOfRange
            ? `Reported floor ${ctx.reportedLabel} is outside this building's floors (${m.outOfRange.ground}–${m.outOfRange.top}${m.numberingSource === 'operator' ? ', from the operator entry' : ''}). No count is shown — check the floor numbering. Everyone inside is listed under "May still be in the building".`
            : `Floor estimates can't be matched to floor ${ctx.reportedLabel} here (floor numbering not mapped). Everyone inside is listed under "May still be in the building".`,
        ),
      );
      const set = el('button', 'tt-link', 'Set floor numbering');
      set.type = 'button';
      set.addEventListener('click', () => onSetNumbering());
      incident.append(set);
    } else {
      const hero = el('div', 'tt-hero');
      hero.append(
        el('span', 'n', String(g1?.rows.length || 0)),
        el('span', 'lbl', `may be at or above floor ${ctx.reportedLabel}`),
      );
      incident.append(hero);
      if (m.breakdown?.text)
        incident.append(el('div', 'tt-line tt-hero-sub', m.breakdown.text));
      // Never a bare zero: say who could still be anywhere (review/phase3 G1).
      if (!g1?.rows.length && m.breakdown?.noFloor)
        incident.append(
          el(
            'div',
            'tt-line tt-hero-sub tt-hero-warn',
            `${m.breakdown.noFloor} inside without a current floor estimate — could be on any floor, including ${ctx.reportedLabel} and above`,
          ),
        );
      if (m.numberingSource === 'operator')
        incident.append(
          el(
            'div',
            'tt-line tt-hero-sub tt-op-numbering',
            'Floor numbering from operator entry · not verified',
          ),
        );
    }
    const names = el('ul', 'tt-inc-names');
    for (const r of g1?.rows || []) {
      const li = el('li');
      const b = el('button');
      b.type = 'button';
      b.append(
        el('span', '', r.person.name),
        el('span', 'band', rowReason(r, 'at_or_above', ctx)),
      );
      b.addEventListener('click', () =>
        onSelectPerson(r.person.id, { frame: true }),
      );
      li.append(b);
      names.append(li);
    }
    incident.append(names);
    const inB = m.groups.find((g) => g.key === 'in_building');
    if (inB)
      incident.append(
        el(
          'div',
          'tt-line',
          `${inB.rows.length} ${m.comparable === false ? '' : 'more '}may still be inside · listed in the rail`,
        ),
      );
    const copy = el('button', 'tt-btn primary', 'Copy for responders');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      const ok = await onCopy();
      copy.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => (copy.textContent = 'Copy for responders'), 1600);
    });
    const actions = el('div', 'tt-actions');
    actions.append(copy);
    incident.append(actions);
    for (const w of [
      ctx.weather?.lightning,
      ctx.weather?.lightningDown,
      ctx.weather?.exposure,
    ])
      if (w) incident.append(el('div', 'tt-line tt-wx-line', w.text));
    if (ctx.dockedCutaway) {
      incident.append(
        el(
          'div',
          'tt-kicker tt-cut-kicker',
          'FLOORS — SELECT ONE TO SEE WHO MAY BE ON IT',
        ),
        ctx.dockedCutaway,
      );
    }
    const official = el('div', 'tt-official');
    official.append(
      el('div', 'tt-kicker', 'OFFICIAL'),
      el('div', '', m.subLine),
    );
    for (const o of ctx.weather?.official || [])
      official.append(el('div', 'tt-official-wx', o));
    incident.append(official);
    incident.append(el('div', 'tt-kicker', 'IF THE GROUP MUST MOVE'));
    for (const c of pathCards(ctx.paths, {
      night: ctx.night,
      incident: true,
      simulated: ctx.fires?.simulated,
      pace: ctx.weather?.pace,
      areas: ctx.avoidAreas || [],
    }))
      incident.append(cardEl(c));
    incident.append(
      el(
        'div',
        'tt-shelter',
        'Shelter in place: stay inside, away from windows and the lobby. An option, not a verdict.',
      ),
    );
    const whyLines = [
      a.partitionText,
      'At or above = the floor band overlaps the reported floor or is above it. Floor estimates come from phone barometers and are not verified.',
    ];
    const primary = (ctx.paths || []).find((p) => p.kind === 'primary');
    if (primary) {
      const ab = arriveBy(primary.distanceM, { night: ctx.night });
      whyLines.push(
        `Arrive-by ${ab.total} min = ${ab.prepare} prepare + ${ab.walk} walk (group pace) + ${ab.buffer} buffer`,
      );
    }
    incident.append(
      disclose(
        'Why these numbers?',
        'why',
        ctx,
        whyLines.map((l) => el('div', 'tt-line', l)),
      ),
    );
    const hc = ctx.hotelCard;
    if (hc)
      incident.append(
        disclose('Hotel card', 'hotelCard', ctx, [
          el(
            'div',
            'tt-line',
            `Group floors ${hc.group_floors.join(', ')} · chaperones on ${hc.chaperone_floors.join(', ')}`,
          ),
          el('div', 'tt-line', hc.assembly_point.label),
          el('div', 'tt-line', `Needs stair help: ${hc.stair_help}`),
          el('div', 'tt-line', `Hotel card ${hc.provenance}`),
        ]),
      );
    // Dismiss: two steps with a reason, Undo afterwards (review/03 §5).
    const d = el('div', 'tt-dismiss');
    if (dismissStep === 0) {
      const b = el(
        'button',
        'tt-btn',
        inc ? 'Dismiss report…' : 'Clear my reported floor',
      );
      b.type = 'button';
      b.addEventListener('click', () => {
        if (!inc) return onDismissReport('Cleared by operator');
        dismissStep = 1;
        renderIncident(last.a, last.ctx);
      });
      d.append(b);
    } else {
      d.append(el('span', 'tt-line', 'Why dismiss?'));
      for (const reason of [
        'False alarm (hotel)',
        'Resolved by hotel',
        'Duplicate report',
      ]) {
        const b = el('button', 'tt-btn danger', reason);
        b.type = 'button';
        b.addEventListener('click', () => {
          dismissStep = 0;
          onDismissReport(reason);
        });
        d.append(b);
      }
      const keep = el('button', 'tt-btn', 'Keep report');
      keep.type = 'button';
      keep.addEventListener('click', () => {
        dismissStep = 0;
        renderIncident(last.a, last.ctx);
      });
      d.append(keep);
    }
    incident.append(
      d,
      el('div', 'tt-note', 'Session only · nothing here is sent to anyone.'),
    );
  }

  return {
    render(a, ctx) {
      last = { a, ctx };
      renderRail(a, ctx);
      // Do not rebuild the incident panel while the operator is mid-dismiss.
      renderIncident(a, ctx);
      if (document.activeElement === findInput) renderFind();
    },
    focusFind() {
      findInput.focus();
    },
  };
}

/** Plain text for "Copy for responders". */
export function responderText(ctx) {
  const m = ctx.mode;
  const lines = [
    m.topLine,
    m.subLine,
    ctx.asOf ? `As of ${ctx.asOf} (sample clock)` : null,
    ctx.weather?.lightning?.text,
    ctx.weather?.lightningDown?.text,
    ctx.weather?.exposure?.text,
    ...(ctx.weather?.official || []),
  ].filter(Boolean);
  for (const g of m.groups) {
    lines.push('', `${g.label} (${g.rows.length}):`);
    for (const r of g.rows)
      lines.push(
        `- ${r.person.name}${r.person.role === 'chaperone' ? ' (chaperone)' : ''}: ${rowReason(r, g.key, ctx)}`,
      );
  }
  const p = pathCards(ctx.paths, {
    night: ctx.night,
    incident: true,
    simulated: ctx.fires?.simulated,
    pace: ctx.weather?.pace,
    areas: ctx.avoidAreas || [],
  })[0];
  if (p) lines.push('', p.title, ...p.lines);
  lines.push(
    '',
    'Source: SafeTrekr Trip Twin (sample data, fictional people). Floor estimates are phone-barometer estimates, not verified.',
  );
  return lines.join('\n');
}

/** Selection card: re-renders only when its text changes (no re-announce churn). */
export function createCard(card, { onClose }) {
  let sig = '';
  function frame(kind, name, lines, top = [], back = null, bottom = []) {
    const next = JSON.stringify([
      kind,
      name,
      lines,
      top.map((n) => n.className),
      back?.label,
      bottom.map((n) => n.className),
    ]);
    if (next === sig && !card.hidden) return;
    sig = next;
    const head = el('div', 'tt-card-head');
    const left = el('div');
    if (back) {
      const b = el('button', 'tt-link', back.label);
      b.type = 'button';
      b.addEventListener('click', back.onClick);
      left.append(b);
    }
    left.append(
      el('div', 'tt-card-kind', kind),
      el('div', 'tt-card-name', name),
    );
    const x = el('button', 'tt-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', onClose);
    head.append(left, x);
    card.replaceChildren(
      head,
      ...top,
      ...lines.map(([cls, t]) => el('div', `tt-card-line ${cls || ''}`, t)),
      ...bottom,
    );
    card.classList.remove('floor-view');
    card.hidden = false;
  }
  const expanded = new Set();
  let expandedFor = null;
  return {
    person(row, site, ctx, back = null, bottom = []) {
      const p = row.person;
      const state = row.pos.label.startsWith(row.pos.chip)
        ? row.pos.label
        : `${row.pos.chip} · ${row.pos.label}`;
      const acc = Number.isFinite(p.accuracy_m)
        ? ` · ±${Math.round(p.accuracy_m)} m`
        : row.pos.located
          ? ' · Accuracy unknown'
          : '';
      const lines = [
        ['', `${state}${acc}`],
        ['', verdictLongForm(row, site)],
      ];
      const ft = floorText(row.floor, { numbering: ctx.numbering });
      if (ft) lines.push(['', ft]);
      if (row.pos.located) {
        const zone =
          p.group_zone_state === 'outside'
            ? 'Outside group zone'
            : p.group_zone_state === 'inside'
              ? 'Inside group zone'
              : 'Zone unknown';
        const charge =
          p.battery_state === 'discharging'
            ? 'discharging'
            : p.battery_state === 'charging'
              ? 'charging'
              : 'not charging';
        lines.push([
          'tt-dim',
          `${zone} · Battery ${Math.round((p.battery_level ?? 0) * 100)}% · ${charge}`,
        ]);
      }
      lines.push(['tt-dim', 'Sample trip · fictional person']);
      frame(
        p.role === 'chaperone' ? 'CHAPERONE' : 'TRAVELER',
        p.name,
        lines,
        [],
        back,
        bottom,
      );
    },
    /** A clicked place (hospital, police, rally point, …) — phase 3 Part C. */
    place(info, bottom = []) {
      frame(info.kind, info.name, info.lines, [], null, bottom);
    },
    /** Per-floor roster (phase 2): three sections, 5 rows each then Show all. */
    floor(roster, ctx, { onBack, onPerson, onCopy }) {
      const f = roster.floor;
      if (expandedFor !== f.label) {
        expanded.clear();
        expandedFor = f.label;
      }
      const next = JSON.stringify([
        'floor',
        f.label,
        f.state,
        roster.sections.map((x) => [
          x.key,
          x.rows.map((r) => [r.row.person.id, r.note]),
        ]),
        [...expanded],
        ctx.footer,
        ctx.canCopy,
        ctx.reportedLabel ?? null,
        (ctx.top || []).length,
      ]);
      if (next === sig && !card.hidden) return;
      sig = next;
      const head = el('div', 'tt-card-head');
      const left = el('div');
      const back = el('button', 'tt-link', `‹ ${ctx.siteShort || 'Hotel'}`);
      back.type = 'button';
      back.addEventListener('click', onBack);
      left.append(
        back,
        el(
          'div',
          'tt-card-kind',
          f.state === 'reported'
            ? 'REPORTED FLOOR · NOT VERIFIED'
            : Number.isFinite(ctx.reportedLabel)
              ? `${f.label > ctx.reportedLabel ? 'ABOVE' : 'BELOW'} REPORTED FLOOR ${ctx.reportedLabel}`
              : 'FLOOR · ESTIMATES',
        ),
        el(
          'div',
          'tt-card-name',
          `${ctx.numbering ? 'Floor' : 'Level'} ${f.label}`,
        ),
      );
      const x = el('button', 'tt-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', onClose);
      head.append(left, x);
      const body = [head];
      // Copy sits right under the heading; only during an incident (A-2: no
      // calm bed-check export).
      if (ctx.canCopy) {
        const copy = el(
          'button',
          'tt-btn primary',
          'Copy floor for hotel desk',
        );
        copy.type = 'button';
        copy.addEventListener('click', async () => {
          const ok = await onCopy();
          copy.textContent = ok ? 'Copied' : 'Copy failed';
          setTimeout(
            () => (copy.textContent = 'Copy floor for hotel desk'),
            1600,
          );
        });
        const actions = el('div', 'tt-actions');
        actions.append(copy);
        body.push(actions);
      }
      for (const sec of roster.sections) {
        const box = el('section', `tt-floor-sec ${sec.key}`);
        box.append(el('div', 'tt-kicker', `${sec.title} · ${sec.rows.length}`));
        if (!sec.rows.length && sec.none)
          box.append(el('div', 'tt-card-line tt-dim', sec.none));
        const open = expanded.has(sec.key);
        const limit = sec.collapsed ? 0 : 5;
        const shown = open ? sec.rows : sec.rows.slice(0, limit);
        const ul = el('ul', 'tt-floor-list');
        for (const { row, note } of shown) {
          const li = el('li');
          const b = el('button');
          b.type = 'button';
          b.append(
            el(
              'span',
              '',
              `${row.person.name}${row.person.role === 'chaperone' ? ' · chaperone' : ''}`,
            ),
            el('span', 'why', note),
          );
          b.addEventListener('click', () => onPerson(row.person.id));
          li.append(b);
          ul.append(li);
        }
        box.append(ul);
        if (sec.rows.length > limit) {
          const more = el(
            'button',
            'tt-link',
            open
              ? sec.collapsed
                ? 'Hide'
                : 'Show fewer'
              : `Show ${sec.collapsed ? '' : 'all '}${sec.rows.length}`,
          );
          more.type = 'button';
          more.addEventListener('click', () => {
            if (open) expanded.delete(sec.key);
            else expanded.add(sec.key);
            sig = '';
            this.floor(roster, ctx, { onBack, onPerson, onCopy });
          });
          box.append(more);
        }
        body.push(box);
      }
      // Compact floors (incident) sit under the list: the roster comes first.
      body.push(...(ctx.top || []));
      body.push(
        el('div', 'tt-card-line tt-dim', ctx.footer),
        el(
          'div',
          'tt-card-line tt-dim',
          'Not a headcount · phone-barometer estimates, not verified · assignments are floor only',
        ),
      );
      card.replaceChildren(...body);
      card.classList.add('floor-view');
      card.hidden = false;
    },
    building(geom, ctx, top = [], bottom = []) {
      const b = geom.building;
      const lines = [
        [
          '',
          b.source === 'height'
            ? `Height ${Math.round(b.heightM)} m (mapped)`
            : b.source === 'levels'
              ? `Height ~${Math.round(b.heightM)} m · from ${b.levels} mapped levels`
              : 'Height not mapped · drawn approximate',
        ],
      ];
      if (geom.isHotel)
        lines.push([
          '',
          ctx.numbering
            ? `${b.levels || '?'} floors · ${ctx.groundLabel === 1 ? 'US numbering · lobby = 1' : 'ground floor = 0'}`
            : 'Floor numbering not verified',
        ]);
      if (ctx.showOsmIds)
        lines.push([
          'tt-dim num',
          b.id === 'synthesized'
            ? 'Outline approximate'
            : `OpenStreetMap ${b.id}`,
        ]);
      frame(
        geom.isHotel
          ? ctx.siteKind === 'venue'
            ? `TRIP VENUE${ctx.siteWhen ? ` · ${ctx.siteWhen}` : ''}`
            : 'GROUP HOTEL'
          : 'BUILDING',
        b.name || (geom.isHotel ? ctx.hotelLabel : 'Unnamed building'),
        lines,
        top,
        null,
        bottom,
      );
    },
    hide() {
      card.hidden = true;
      sig = '';
    },
  };
}

/**
 * Route section for a card (phase 3 Part C). Rebuilt in place by the page.
 * model = { title, origins: [{key, label, disabled}], originKey, profile,
 *           status: 'idle'|'loading'|'ready'|'error', cards, error }
 */
export function renderRouteSection(
  node,
  model,
  { onOrigin, onMode, onClear, onFrame, onEdit },
) {
  node.replaceChildren();
  node.append(el('div', 'tt-kicker', model.title));
  const seg = (items, active, onPick, cls) => {
    const g = el('div', `tt-route-seg ${cls}`);
    g.setAttribute('role', 'group');
    for (const it of items) {
      const b = el(
        'button',
        `tt-tb${it.key === active ? ' on' : ''}`,
        it.label,
      );
      b.type = 'button';
      b.disabled = Boolean(it.disabled);
      if (it.title) b.title = it.title;
      b.setAttribute('aria-pressed', String(it.key === active));
      b.addEventListener('click', () => onPick(it.key));
      g.append(b);
    }
    return g;
  };
  node.append(
    seg(model.origins, model.originKey, onOrigin, 'from'),
    seg(
      [
        { key: 'foot', label: 'Walk' },
        { key: 'car', label: 'Drive' },
      ],
      model.status === 'idle' ? null : model.profile,
      onMode,
      'mode',
    ),
  );
  if (model.status === 'idle' && onEdit) {
    const draw = el('button', 'tt-btn', 'Plan your own path');
    draw.type = 'button';
    draw.addEventListener('click', onEdit);
    node.append(draw);
  }
  if (model.status === 'idle')
    node.append(
      el(
        'div',
        'tt-note',
        'Pick where from, then Walk or Drive for a suggested path — or plan your own.',
      ),
    );
  if (model.status === 'loading')
    node.append(el('div', 'tt-note', 'Asking OpenStreetMap routing…'));
  if (model.status === 'error')
    node.append(
      el(
        'div',
        'tt-note',
        `Path unavailable right now (${model.error}). Straight-line distance: ${model.straight}`,
      ),
    );
  if (model.status === 'ready') {
    for (const c of model.cards) node.append(cardEl(c));
    const acts = el('div', 'tt-actions');
    const frame = el('button', 'tt-link', 'Frame path');
    frame.type = 'button';
    frame.addEventListener('click', onFrame);
    const clear = el('button', 'tt-link', 'Clear path (Esc)');
    clear.type = 'button';
    clear.addEventListener('click', onClear);
    acts.append(frame, clear);
    if (onEdit) {
      const edit = el('button', 'tt-link', 'Plan your own path');
      edit.type = 'button';
      edit.addEventListener('click', onEdit);
      acts.prepend(edit);
    }
    node.append(acts);
  }
}
