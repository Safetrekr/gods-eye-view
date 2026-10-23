// Trip Twin DOM chrome after the cleanup pass (review/00-FIX-LIST.md):
// one top line per mode, roster + find fixed, Needs attention grouped and
// capped, safety/hazards/sources one click away; incident panel with names,
// copy, official slot and paths; selection card only re-renders on change.
import {
  ROSTER_BUCKETS,
  bearingLabel,
  formatDistance,
  formatRadius,
  formatShort,
  spokenAges,
} from './twinData.js';
import { UNKNOWN_TEXT, floorText, initialsOf } from './twinPeople.js';
import { arriveBy, HAZARD_NEAR_M } from './twinPaths.js';
import { ringKind } from './twinPins.js';
import { avoidCrossings } from './twinCustomPaths.js';

// SOC walls (phase 10): names as "Emi S."; visitor mode, initials only.
// The console keeps full names (identity function).
let nameStyle = (n) => n;
export function setNameStyle(fn) {
  nameStyle = typeof fn === 'function' ? fn : (n) => n;
}
const nm = (n) => nameStyle(String(n || ''));

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
    // Paths rank Main / Alternate; "primary" is a rally point's rank
    // (review/phase9 O9).
    const name =
      p.kind === 'alternate'
        ? 'Alternate path to Rally point (primary)'
        : 'Main path to Rally point (primary)';
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
        `Within ${formatRadius(1000)} of a ${simulated ? 'SIMULATED ' : ''}heat detection (${formatDistance(p.hazard.distanceM)} ${bearingLabel(p.geometry[p.hazard.index], p.hazard.hazard)}) — check before use`,
      );
    if (p.kind === 'alternate' && p.sharedStartM > 40)
      lines.push(
        `Shares the first ${formatShort(p.sharedStartM)} with the primary path`,
      );
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
      kind: p.kind,
      title: `${name} · ${formatDistance(p.distanceM)} · walk ${p.walk[0]}–${p.walk[1]} min`,
      lines,
    };
  });
}

function cardEl(card) {
  const c = el('div', `tt-path-card${card.flagged ? ' flag' : ''}`);
  if (card.kind === 'primary' || card.kind === 'alternate') {
    // The title opens the path's card (review/phase9 O9).
    const t = el('button', 't tt-path-open', `${card.title} ›`);
    t.type = 'button';
    t.dataset.kind = card.kind;
    c.append(t);
  } else c.append(el('div', 't', card.title));
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
  onCardToggle = () => {},
}) {
  // Persistent rail skeleton: the Summary stays pinned, every other section
  // is a collapsible card in one scroll column (shell review, 23 Oct 2026).
  // The cards and the find input are never re-created; only bodies refill.
  const head = el('div', 'tt-rail-head');
  const scroll = el('div', 'tt-rail-scroll');
  rail.replaceChildren(head, scroll);
  // The summary text is rebuilt each render; the find box beside it is not.
  const sum = el('div', 'tt-sum');
  head.append(sum);
  const wall = () => document.body.dataset.view === 'screen';
  const onWall = new URLSearchParams(location.search).get('view') === 'screen';
  let openState = {};
  let incidentNow = false;
  const cards = {};
  function card(key, title) {
    const sec = el('section', `tt-sec tt-sec-${key}`);
    const hd = el('button', 'tt-sec-head');
    hd.type = 'button';
    const cnt = el('span', 'tt-sec-count num');
    hd.append(
      el('span', 'tt-sec-title', title),
      cnt,
      el('span', 'tt-sec-chev'),
    );
    const line = el('div', 'tt-sec-line');
    const body = el('div', 'tt-sec-body');
    body.id = `tt-sec-${key}`;
    hd.setAttribute('aria-controls', body.id);
    sec.append(hd, line, body);
    const c = { key, sec, hd, cnt, line, body };
    hd.addEventListener('click', () => {
      // Needs attention never closes during an incident.
      if (key === 'needs' && incidentNow) return;
      openState[key] = !isOpen(c);
      if (key !== 'needs') onCardToggle(key, openState[key]);
      applyCard(c);
    });
    cards[key] = c;
    return c;
  }
  function isOpen(c) {
    if (c.key === 'needs' && incidentNow) return true;
    // Walls are display-only: their People and Needs attention stay open.
    if (wall() && (c.key === 'needs' || c.key === 'people')) return true;
    return Boolean(openState[c.key]);
  }
  function applyCard(c) {
    const on = isOpen(c);
    c.sec.classList.toggle('open', on);
    c.hd.setAttribute('aria-expanded', String(on));
    const locked = c.key === 'needs' && incidentNow;
    c.hd.setAttribute('aria-disabled', String(locked));
    c.hd.title = locked ? 'Stays open during an incident' : '';
    c.body.hidden = !on;
    c.line.hidden = on || !c.line.textContent;
  }
  const needsCard = card('needs', 'Needs attention');
  const peopleCard = card('people', 'People');
  const hazardsCard = card('hazards', 'Hazards');
  const safetyCard = card('safety', 'Safety & paths');
  const sourcesCard = card('sources', 'Sources');
  scroll.append(
    needsCard.sec,
    peopleCard.sec,
    hazardsCard.sec,
    safetyCard.sec,
    sourcesCard.sec,
  );
  // People body keeps the old class so the wall role rules still apply.
  const fixed = el('div', 'tt-rail-fixed');
  peopleCard.body.append(fixed);
  const peopleHead = el('div', 'tt-line tt-people-asof');
  const siteSplit = el('div', 'tt-line tt-site-line');
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
  // All-in-one: Find a person lives in the pinned Summary card so its
  // results drop over the column instead of being cut off inside People
  // (Jesse, 23 Oct). Walls keep it in People.
  fixed.append(peopleHead, roster, zone, chap, siteSplit);
  if (onWall) fixed.append(find);
  else head.append(find);

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
              el('span', '', nm(r.person.name)),
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

  const prevCounts = new Map();
  let prevNeeds = null;
  function renderSummary(m, ctx) {
    // The top line reads in two lines: the state, then who / what first.
    // "First: Name" is a button, like the A key (review/phase5 J12).
    const [status, ...rest] = m.topLine.split(' — ');
    const detail = rest.join(' — ');
    // All-in-one: a big thin count leads the calm and watch states (shell
    // review 02-ui §5). Incident, delayed data and walls keep the sentence.
    const hero = !wall() && m.mode !== 'incident' && !m.degraded && m.total > 0;
    if (hero) {
      const box = el('div', `tt-sum-hero ${m.mode}`);
      const n = el('span', 'tt-sum-n', String(m.total));
      const txt = el('div', 'tt-sum-txt');
      txt.append(
        el('div', 'tt-sum-k', 'to check on'),
        el(
          'div',
          `tt-topline ${m.mode}`,
          m.mode === 'watch' ? status : status.split(' · ')[0],
        ),
      );
      box.append(n, txt);
      sum.replaceChildren(box);
    } else if (!wall() && m.mode === 'incident') {
      // Incident: a red numeral leads, the sentence below in plain weight
      // (review/shell 12-ui §9). Red stays on the numeral and the border.
      const above = m.groups.find((g) => g.key === 'at_or_above');
      const box = el('div', 'tt-sum-hero incident');
      const txt = el('div', 'tt-sum-txt');
      txt.append(
        el(
          'div',
          'tt-sum-k',
          above
            ? `may be at or above floor ${ctx.reportedLabel}`
            : 'incident reported',
        ),
        el('div', 'tt-topline incident', status),
      );
      box.append(
        el('span', 'tt-sum-n', String(above ? above.rows.length : m.total)),
        txt,
      );
      sum.replaceChildren(box);
    } else sum.replaceChildren(el('div', `tt-topline ${m.mode}`, status));
    if (detail) {
      const d = el('div', 'tt-topdetail');
      const first = m.groups?.[0]?.rows?.[0]?.person;
      if (first && detail.startsWith(`first: ${first.name}`)) {
        const b = el('button', 'tt-namebtn', nm(first.name));
        b.type = 'button';
        b.title = 'Select and frame (A)';
        b.addEventListener('click', () =>
          onSelectPerson(first.id, { frame: true }),
        );
        d.append('First: ', b, detail.slice(`first: ${first.name}`.length));
        d.append(el('span', 'kbd', 'A'));
      } else d.textContent = detail.replace(/^./, (c) => c.toUpperCase());
      sum.append(d);
    }
    if (m.subLine) sum.append(el('div', 'tt-subline', m.subLine));
    // Walls keep the group split in the head; the All-in-one moves it into
    // People, where the counts it repeats live (04-ia §2).
    if (ctx.siteLine && wall())
      sum.append(el('div', 'tt-subline tt-site-line', ctx.siteLine));
    if (ctx.weather?.approach)
      sum.append(
        el(
          'div',
          `tt-subline tt-wx-approach ${ctx.weather.approach.level}`,
          ctx.weather.approach.text,
        ),
      );
    if (m.mode !== 'incident')
      for (const o of ctx.weather?.official || [])
        sum.append(el('div', 'tt-subline tt-wx-official', o));
  }

  function renderRail(a, ctx) {
    const m = ctx.mode;
    openState = ctx.open;
    incidentNow = m.mode === 'incident';
    // Needs attention opens on every load and reopens once when it grows.
    if (prevNeeds !== null && m.total > prevNeeds) openState.needs = true;
    prevNeeds = m.total;
    renderSummary(m, ctx);
    const top = scroll.scrollTop;

    // ---- People ----
    peopleHead.textContent = `${a.rows.length} loaded${ctx.asOf ? ` · as of ${ctx.asOf}` : ''}`;
    peopleCard.cnt.textContent = String(a.rows.length);
    roster.replaceChildren();
    roster.setAttribute('aria-label', a.rosterText);
    for (const b of ROSTER_BUCKETS) {
      const n =
        b === 'Inside (likely)' && ctx.hotelApproximate ? '—' : a.counts[b];
      const zero = n === 0;
      const warn = !zero && (b === 'Not current' || b === 'Not located');
      const cnt = el(
        'span',
        `cnt${zero ? ' zero' : ''}${warn ? ' warn' : ''}`,
        String(n),
      );
      // A changed count announces itself once (Event tier, phase 11).
      if (prevCounts.has(b) && prevCounts.get(b) !== n)
        cnt.classList.add('tt-changed');
      prevCounts.set(b, n);
      roster.append(
        el(
          'span',
          `lbl${zero ? ' zero' : ''}`,
          b === 'Away'
            ? 'Away from this site'
            : b.replace('hotel', ctx.siteNoun || 'hotel'),
        ),
        cnt,
      );
    }
    zone.textContent = a.zone.text;
    const ch = a.chaperones;
    const cur = ch.filter((r) => r.pos.current).length;
    chap.textContent = `Chaperones ${ch.length} · ${cur} current${ch.length - cur ? ` · ${ch.length - cur} not current` : ''}`;
    siteSplit.textContent = !wall() && ctx.siteLine ? ctx.siteLine : '';
    siteSplit.hidden = !siteSplit.textContent;
    {
      const c = a.counts;
      const inside = ctx.hotelApproximate ? '—' : c['Inside (likely)'];
      const line = peopleCard.line;
      line.replaceChildren(`${inside} inside · `);
      for (const [b, label] of [
        ['Not current', 'not current'],
        ['Not located', 'not located'],
      ]) {
        const s = el('span', c[b] ? 'warn' : '', `${c[b]} ${label}`);
        line.append(s, b === 'Not current' ? ' · ' : '');
      }
    }

    // ---- Needs attention ----
    needsCard.cnt.textContent = String(m.total);
    needsCard.sec.classList.toggle('has-items', m.total > 0);
    {
      const g = m.groups[0];
      const r = g?.rows[0];
      needsCard.line.textContent = r
        ? `${nm(r.person.name)} · ${rowReason(r, g.key, ctx)}${m.total > 1 ? ` · +${m.total - 1} more` : ''}`
        : 'No one needs a check-in right now';
    }
    const needs = needsCard.body;
    needs.replaceChildren();
    if (!m.groups.length)
      needs.append(
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
            nm(r.person.name) + (r.person.role === 'chaperone' ? ' (C)' : ''),
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
      needs.append(box);
    }

    // ---- Hazards (above Safety & paths, as in Layers; 04-ia §4) ----
    hazardsCard.line.textContent =
      ctx.fires?.line || 'Satellite heat detections · loading';
    hazardsCard.body.replaceChildren(
      el('div', 'tt-line', hazardsCard.line.textContent),
      ...(ctx.fires?.details || []).map((l) => el('div', 'tt-line', l)),
    );

    // ---- Safety & paths (hidden during an incident, as before) ----
    safetyCard.sec.hidden = m.mode === 'incident';
    if (m.mode !== 'incident') {
      const pc = pathCards(ctx.paths, {
        night: ctx.night,
        simulated: ctx.fires?.simulated,
        pace: ctx.weather?.pace,
        areas: ctx.avoidAreas || [],
      });
      safetyCard.cnt.textContent = pc.length ? String(pc.length) : '';
      safetyCard.line.textContent = pc[0]
        ? pc[0].title
        : ctx.pathsLoading
          ? 'Planning walking paths…'
          : 'No rally point path yet';
      safetyCard.body.replaceChildren(
        ...pc.map(cardEl),
        ...(ctx.safetyLines || []).map((l) => el('div', 'tt-line', l)),
      );
    }

    // ---- Sources ----
    sourcesCard.cnt.textContent = String(ctx.sources.length);
    sourcesCard.line.textContent = ctx.sources[0] || '';
    sourcesCard.body.replaceChildren(
      ...ctx.sources.map((l) => el('div', 'tt-line', l)),
    );

    // Card status (Jesse, 23 Oct): an urgent card is outlined and glows
    // red, a card needing attention amber; calm cards stay steel.
    {
      const c = a.counts;
      const hasNear = (ctx.fires?.details || []).some((d) =>
        // Only an actual detection with a distance ("Heat detection 1.2 mi
        // NE"), not the source or caveat lines.
        /\bheat detection [\d.]/i.test(
          typeof d === 'string' ? d : d?.text || '',
        ),
      );
      const wxAttn = Boolean(
        ctx.weather?.approach || ctx.weather?.official?.length,
      );
      const state = {
        needs: incidentNow ? 'hazard' : m.total ? 'attention' : '',
        people: c['Not current'] || c['Not located'] ? 'attention' : '',
        hazards: hasNear || wxAttn ? 'attention' : '',
        safety: '',
        sources: m.degraded ? 'attention' : '',
      };
      for (const [k, v] of Object.entries(state))
        cards[k].sec.dataset.state = v;
      head.dataset.state = incidentNow
        ? 'hazard'
        : m.mode === 'watch' || wxAttn || m.degraded
          ? 'attention'
          : '';
    }
    for (const c of Object.values(cards)) applyCard(c);
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
    // A wall lists six names and says how many more; the roster has them.
    const wall = document.body.dataset.view === 'screen';
    const allRows = g1?.rows || [];
    const shownRows = wall ? allRows.slice(0, 6) : allRows;
    for (const r of shownRows) {
      const li = el('li');
      const b = el('button');
      b.type = 'button';
      b.append(
        el('span', '', nm(r.person.name)),
        el('span', 'band', rowReason(r, 'at_or_above', ctx)),
      );
      b.addEventListener('click', () =>
        onSelectPerson(r.person.id, { frame: true }),
      );
      li.append(b);
      names.append(li);
    }
    if (allRows.length > shownRows.length)
      names.append(
        el(
          'li',
          'more',
          `+${allRows.length - shownRows.length} more · listed under Needs attention`,
        ),
      );
    incident.append(names);
    const inB = m.groups.find((g) => g.key === 'in_building');
    if (inB)
      incident.append(
        el(
          'div',
          'tt-line',
          `${inB.rows.length} ${m.comparable === false ? '' : 'more '}may still be inside · listed under Needs attention`,
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
    // Official sits under the hero (06), then a one-line move summary, then
    // the floors, then the full move section (review/phase5 J13).
    const official = el('div', 'tt-official');
    official.append(
      el('div', 'tt-kicker', 'OFFICIAL'),
      el('div', '', m.subLine),
    );
    for (const o of ctx.weather?.official || [])
      official.append(el('div', 'tt-official-wx', o));
    incident.append(official);
    const moveCards = pathCards(ctx.paths, {
      night: ctx.night,
      incident: true,
      simulated: ctx.fires?.simulated,
      pace: ctx.weather?.pace,
      areas: ctx.avoidAreas || [],
    });
    if (moveCards[0])
      incident.append(
        el(
          'div',
          `tt-move-sum${moveCards[0].flagged ? ' flag' : ''}`,
          `If the group must move: ${moveCards[0].title.replace(/^(Main|Alternate) path/, (m) => m.toLowerCase())} · details below`,
        ),
      );
    if (moveCards[0]) {
      // Streets and walkways around the hotel (phase 7): the operator's call.
      const w = el('button', 'tt-link tt-ways-btn', 'Ways out view (W)');
      w.type = 'button';
      incident.append(w);
    }
    if (ctx.dockedCutaway) {
      incident.append(
        el('div', 'tt-kicker tt-cut-kicker', 'FLOORS'),
        el('div', 'tt-note', 'Select a floor to see who may be on it'),
        ctx.dockedCutaway,
      );
    }
    incident.append(el('div', 'tt-kicker', 'IF THE GROUP MUST MOVE'));
    for (const c of moveCards) incident.append(cardEl(c));
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
      // Do not rebuild the incident panel while the operator is mid-dismiss,
      // or while typing in it (Go to floor, review/phase5b).
      const typing =
        incident.contains(document.activeElement) &&
        document.activeElement.matches('input, select, textarea');
      if (!typing) renderIncident(a, ctx);
      if (document.activeElement === findInput) renderFind();
    },
    /** Open a rail card and bring it into view (a station was picked). */
    openCard(key) {
      const c = cards[key];
      if (!c) return;
      if (!isOpen(c)) {
        openState[key] = true;
        if (key !== 'needs') onCardToggle(key, true);
        applyCard(c);
      }
      // No scrolling: Needs attention must stay in view (review/shell X9).
    },
    focusFind() {
      // Walls keep the box in People: "/" opens People first there.
      if (onWall && !isOpen(peopleCard)) {
        openState.people = true;
        applyCard(peopleCard);
      }
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
  return spokenAges(lines.join('\n'));
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
    card.classList.remove('floor-view', 'compact', 'path-view');
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
        ? ` · ±${formatShort(p.accuracy_m)}`
        : row.pos.located
          ? ' · Accuracy unknown'
          : '';
      // Lead with the verdict, then the facts, then provenance (J11).
      const lines = [
        ['lead', verdictLongForm(row, site)],
        ['', `${state}${acc}`],
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
          '',
          `${zone} · Battery ${Math.round((p.battery_level ?? 0) * 100)}% · ${charge}`,
        ]);
      }
      lines.push(['foot', 'Sample trip · fictional person']);
      frame(
        p.role === 'chaperone' ? 'CHAPERONE' : 'TRAVELER',
        nm(p.name),
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
    /**
     * A drawn suggested path (review/phase9 O8): the result block, then the
     * details. Always re-renders (the page keys it); focus stays on the
     * button that had it.
     */
    path(info, { back = null, top = [], bottom = [] } = {}) {
      const had = card.contains(document.activeElement)
        ? document.activeElement.textContent
        : null;
      sig = '';
      frame(info.kind, info.name, info.lines, top, back, bottom);
      card.classList.add('path-view');
      if (had)
        [...card.querySelectorAll('button')]
          .find((b) => b.textContent === had)
          ?.focus();
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
              `${nm(row.person.name)}${row.person.role === 'chaperone' ? ' · chaperone' : ''}`,
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
      card.classList.remove('compact');
      card.classList.add('floor-view');
      card.hidden = false;
    },
    building(geom, ctx, top = [], bottom = []) {
      const b = geom.building;
      const lines = [
        [
          '',
          b.source === 'height'
            ? `Height ${formatShort(b.heightM)} (mapped)`
            : b.source === 'levels'
              ? `Height ~${formatShort(b.heightM)} · from ${b.levels} mapped levels`
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
      // Doors (phase 7): only what OpenStreetMap maps; never "exit".
      if (geom.isHotel && ctx.doors)
        lines.push([
          'foot',
          ctx.doors.hotelDoors
            ? `Mapped entrances: ${ctx.doors.hotelDoors}${ctx.doors.hotelMain ? ` (${ctx.doors.hotelMain} main)` : ''} · OpenStreetMap, unverified · fire exits are not mapped`
            : 'No entrances mapped at this building in OpenStreetMap · fire exits are not mapped',
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
        [],
        null,
        // Building facts first, then the floor stack and sections (J11).
        [...top, ...bottom],
      );
      card.classList.toggle('compact', Boolean(ctx.compact));
    },
    hide() {
      card.hidden = true;
      sig = '';
    },
  };
}

/** Choice rows (review/phase5 J10): a radiogroup with arrow keys. */
export function choiceList(items, active, onPick, label) {
  const g = el('div', 'tt-choices');
  g.setAttribute('role', 'radiogroup');
  if (label) g.setAttribute('aria-label', label);
  const btns = [];
  for (const it of items) {
    const on = it.key === active;
    const b = el('button', `tt-choice${on ? ' on' : ''}`);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    b.disabled = Boolean(it.disabled);
    b.tabIndex = on || (!active && btns.length === 0) ? 0 : -1;
    if (it.title) b.title = it.title;
    b.append(el('span', 'dot'));
    const txt = el('span', 'txt');
    const lab = el('span', 'lab', it.label);
    if (it.tag) lab.append(el('span', 'tt-tag', it.tag));
    txt.append(lab);
    if (it.meta) txt.append(el('span', 'meta', it.meta));
    b.append(txt);
    b.addEventListener('click', () => onPick(it.key));
    btns.push(b);
    g.append(b);
  }
  g.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const live = btns.filter((b) => !b.disabled);
    const i = live.indexOf(document.activeElement);
    const next =
      live[(i + (e.key === 'ArrowDown' ? 1 : -1) + live.length) % live.length];
    next?.focus();
  });
  return g;
}

/** Segmented single choice (review/phase5 J10): selected = tint, border, ✓. */
export function segmented(items, active, onPick, label) {
  const g = el('div', 'tt-seg2');
  g.setAttribute('role', 'group');
  if (label) g.setAttribute('aria-label', label);
  for (const it of items) {
    const on = it.key === active;
    const b = el('button', on ? 'on' : '');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.disabled = Boolean(it.disabled);
    if (it.title) b.title = it.title;
    b.append(el('span', 'lab', it.label));
    if (it.meta) b.append(el('span', 'meta', it.meta));
    b.addEventListener('click', () => onPick(it.key));
    g.append(b);
  }
  return g;
}

const step = (n, label) => {
  const s = el('div', 'tt-step');
  s.append(el('span', 'n', String(n)), el('span', 'lab', label));
  return s;
};

/** The result block for one suggested path (review/phase5 J3). */
export function resultEl(card, compact = false) {
  const c = el(
    'div',
    `tt-result${card.flagged ? ' flag' : ''}${compact ? ' alt' : ''}`,
  );
  if (card.kicker) c.append(el('div', 'k', card.kicker));
  const m = el('div', 'm', card.metric || card.title);
  if (card.metricNote) m.append(el('span', 'note', ` ${card.metricNote}`));
  c.append(m);
  if (card.route && !compact) c.append(el('div', 'r', card.route));
  for (const w of card.warnings || []) c.append(el('div', 'w', `⚠ ${w}`));
  for (const l of card.notes || card.lines || []) c.append(el('div', 'l', l));
  return c;
}

/**
 * Path section for a person or place card (phase 3 Part C, rebuilt in
 * review/phase5 J1–J5): 1 To / From → 2 How → the result → or plan your own.
 * model = { title, stepLabel, idleHint, origins: [{key, label, meta, tag,
 *   disabled, title}], originKey, profile, times, reason, status, cards,
 *   stale, extras, error, straight }
 */
export function renderRouteSection(
  node,
  model,
  { onOrigin, onMode, onClear, onFrame, onEdit, onCopy, onReplan },
) {
  node.replaceChildren();
  node.append(el('div', 'tt-kicker tt-sec-k', model.title));
  node.append(
    step(1, model.stepLabel),
    choiceList(model.origins, model.originKey, onOrigin, model.stepLabel),
    step(2, 'How'),
    segmented(
      [
        { key: 'foot', label: 'Walk', meta: model.times?.foot || '' },
        { key: 'car', label: 'Drive', meta: model.times?.car || '' },
      ],
      model.originKey ? model.profile : model.chosen ? model.profile : null,
      onMode,
      'How',
    ),
  );
  const out = el('div', 'tt-route-out');
  out.setAttribute('aria-live', 'polite');
  if (model.status === 'idle') out.append(el('div', 'tt-note', model.idleHint));
  if (model.status === 'loading')
    out.append(el('div', 'tt-note', 'Finding a suggested path…'));
  if (model.status === 'error')
    out.append(
      el(
        'div',
        'tt-note',
        `Path unavailable right now (${model.error}). Straight-line distance: ${model.straight}`,
      ),
    );
  if (model.status === 'ready') {
    if (model.reason) out.append(el('div', 'tt-note', model.reason));
    if (model.stale) {
      const st = el('div', 'tt-stale');
      st.append(el('span', '', model.stale));
      const b = el('button', 'tt-btn sm', 'Re-plan from the current position');
      b.type = 'button';
      b.addEventListener('click', onReplan);
      st.append(b);
      out.append(st);
    }
    model.cards.forEach((c, i) => out.append(resultEl(c, i > 0)));
    for (const l of model.extras || [])
      out.append(el('div', 'tt-card-line tt-route-extra', l));
    const copy = el('button', 'tt-btn primary block', 'Copy path summary');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      const ok = await onCopy();
      copy.textContent = ok ? 'Copied' : 'Copy failed — clipboard blocked';
    });
    const tools = el('div', 'tt-actions tt-tools');
    const frame = el('button', 'tt-btn sm', 'Frame path');
    frame.type = 'button';
    frame.addEventListener('click', onFrame);
    const clear = el('button', 'tt-btn sm', 'Remove path');
    clear.append(el('span', 'kbd', 'Esc'));
    clear.type = 'button';
    clear.addEventListener('click', onClear);
    tools.append(frame, clear);
    out.append(copy, tools);
  }
  node.append(out);
  if (onEdit) {
    const or = el('div', 'tt-or');
    or.append(el('span', '', 'or '));
    const edit = el('button', 'tt-link', 'Plan your own path');
    edit.type = 'button';
    edit.addEventListener('click', onEdit);
    or.append(edit);
    node.append(or);
  }
}
