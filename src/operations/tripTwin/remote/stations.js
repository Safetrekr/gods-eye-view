// Trip Twin remote stations (phase 10; review/phase10 R2, R13, R16).
// Shell step C (23 Oct 2026): the remote's stations are the wall roles, in
// wall order, like the All-in-one rail (twinStations.js): 01 Site (scale,
// layers, display) · 02 People · 03 Incident & attention · 04 Weather &
// alerts · 05 Day plan · 06 Trips on watch. Screens sits in the rail foot. Every section says its scope: the target (S2 / all screens) or
// EVERY SCREEN for wall-wide items. Each station renders the left-hand
// content and, when it has one, its level-2 list in the rail.
// Phase CF K8 (PHASE-CF-PLAN §3.2 a, §3.3; SUP-5): the rail foot's
// Screens becomes Screens & devices: the screens list, Pair a screen with
// the host's own words for a wrong code and the 1-minute pause (the Pair
// button counts down), then the target's role and display.
import {
  LAYER_CATALOG,
  ROLES,
  ROLE_ORDER,
  CARD_CATALOG,
  layerValue,
  WALL_TEXT_MAX,
  WALL_TEXT_MIN,
  layoutChanged,
  layoutValue,
  screenSummary,
  wallShellOn,
} from '../twinScreenRoles.js';
import { DEMO_TRIPS, tripById } from '../demoTrips.js';
import { formatAge, positionState } from '../twinData.js';
import { MOTION_TIERS } from '../twinMotion.js';
import { STATIONS as WALL_STATIONS } from '../twinStations.js';

const ICON = {
  screens:
    '<svg viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="10" rx="1.5"/><path d="M7 16.5h6M10 13.5v3"/></svg>',
  trip: '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14M7 2.5v3M13 2.5v3"/></svg>',
  incident:
    '<svg viewBox="0 0 20 20"><path d="M10 3 2.8 16h14.4z"/><path d="M10 8v4M10 14.2v.3"/></svg>',
  layers:
    '<svg viewBox="0 0 20 20"><path d="m10 3 7 4-7 4-7-4z"/><path d="m3 11 7 4 7-4"/></svg>',
  people:
    '<svg viewBox="0 0 20 20"><circle cx="7.5" cy="7" r="2.5"/><circle cx="13.5" cy="8" r="2"/><path d="M3 16c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4M12 13.2c.5-.7 1.4-1.2 2.4-1.2 1.6 0 2.8 1.2 3.1 3"/></svg>',
  weather:
    '<svg viewBox="0 0 20 20"><path d="M6 14.5h8.5a3 3 0 0 0 .3-6 4.5 4.5 0 0 0-8.6-.8A3.4 3.4 0 0 0 6 14.5z"/><path d="m9 16-1 2M12.5 16l-1 2"/></svg>',
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
export const btn = (cls, text, fn, attrs = {}) => {
  const b = el('button', cls, text);
  b.type = 'button';
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  b.addEventListener('click', fn);
  return b;
};
const row = (n, t, s, r, fn, current = false) => {
  const b = btn('rm-row', '', fn);
  if (current) b.setAttribute('aria-current', 'true');
  const mid = el('div');
  mid.append(el('div', 't', t));
  if (s) mid.append(el('div', 's', s));
  b.append(el('span', 'n', n || ''), mid, el('span', 'r', r || ''));
  return b;
};
const head = (title, sub) => [
  el('h1', 'rm-title', title),
  el('div', 'rm-sub', sub),
];
const tgtName = (t) => (t === 'all' ? 'all screens' : `S${t}`);
/** Section kicker with its scope (review/phase10 R16). */
const kick = (text, scope) =>
  el('div', 'rm-k', `${text}${scope ? ` · ${scope}` : ''}`);
const scopeOf = (t) => (t === 'all' ? 'ALL SCREENS' : `S${t}`);
const WALL = 'EVERY SCREEN';
/** The screen showing a role (first one), for role-based actions. */
const slotWithRole = (state, role) =>
  Number(
    Object.keys(state.screens).find((k) => state.screens[k].role === role),
  ) || null;
/** Where Incident & attention is shown: its own wall, else the wall that
 *  carries it (one or two screens; screens/70-S2-FIX-LIST IA round 2). */
export const attentionScreen = (state) => {
  const own = slotWithRole(state, 'incident');
  if (own) return `S${own} Incident & attention`;
  const k = Object.keys(state?.screens || {}).find((n) =>
    (state.screens[n].merged || []).includes('incident'),
  );
  return k
    ? `S${k} ${ROLES[state.screens[k].role]?.label || ''} (Needs attention)`
    : 'the Needs attention list';
};
const dayText = (date) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** The report the walls show: the operator's, else the trip data's. */
export function currentReport(state, data) {
  const ss = state.session;
  if (ss.report) return { ...ss.report, source: 'operator entry' };
  const r = data?.snapshot?.reported_incidents?.[0];
  return r
    ? {
        id: r.id,
        floor: r.floor_label,
        kind: r.kind,
        source: r.source,
        at: Date.parse(r.reported_at),
      }
    : null;
}

// --------------------------------------------------------------- 01 Incident
function incident(ctx) {
  const { state, target } = ctx;
  const ss = state.session;
  const t = tripById(ss.tripId);
  const data = ctx.tripData(t);
  const report = currentReport(state, data);
  const out = [
    ...head(
      'Incident',
      `${t.title} · ${report ? 'reported · not verified' : 'no incident reported'}`,
    ),
  ];
  if (report) {
    out.push(
      el(
        'div',
        'rm-flag rm-hazard',
        `Reported: ${report.kind || 'incident'} · floor ${report.floor}${report.source ? ` · ${report.source}` : ''}${Number.isFinite(report.at) ? ` · ${formatAge((Date.now() - report.at) / 1000)} ago` : ''} · not verified`,
      ),
    );
    const acked = ss.incidentAck && ss.incidentAck === report.id;
    const site = slotWithRole(state, 'site');
    const a = el('div', 'rm-actions');
    a.append(
      btn(
        'rm-btn primary',
        acked ? 'Acknowledged' : 'Acknowledge (the wall banner shrinks)',
        () =>
          !acked &&
          ctx.send(
            { type: 'session', patch: { incidentAck: report.id } },
            'Incident acknowledged',
          ),
        acked ? { disabled: 'true' } : {},
      ),
    );
    if (site)
      a.append(
        btn('rm-btn', `Frame floor ${report.floor} on Site (S${site})`, () =>
          ctx.send(
            {
              type: 'screens',
              target: site,
              patch: {
                frame: {
                  subject: { kind: 'floor', label: report.floor },
                  nonce: Date.now(),
                },
              },
            },
            `S${site} frames floor ${report.floor}`,
          ),
        ),
      );
    if (target !== 'all')
      a.append(
        btn('rm-btn', `Make S${target} the incident screen`, () =>
          ctx.send(
            { type: 'screens', target, patch: { role: 'incident' } },
            `S${target} → Incident & attention`,
          ),
        ),
      );
    a.append(
      btn('rm-btn', 'Copy for responders', () => ctx.copyResponders(report)),
    );
    out.push(a);
    if (ss.report)
      out.push(
        btn('rm-btn', 'Clear my reported floor', () =>
          ctx.send(
            { type: 'session', patch: { report: null } },
            'Clear the reported floor on every screen',
          ),
        ),
      );
    out.push(
      el(
        'div',
        'rm-note',
        `Copied text stays on this device; it is never shown on a wall. Who may still be inside, by floor, is on ${attentionScreen(state)}.`,
      ),
    );
  }
  out.push(kick('Add reported floor', WALL));
  const f = el('div', 'rm-actions');
  const floor = el('input', 'rm-input');
  floor.inputMode = 'numeric';
  floor.placeholder = 'Floor';
  floor.setAttribute('aria-label', 'Reported floor');
  const kind = el('select', 'rm-input');
  kind.setAttribute('aria-label', 'What was reported');
  for (const k of ['smoke', 'fire', 'medical', 'security', 'other'])
    kind.append(new Option(k, k));
  f.append(
    floor,
    kind,
    btn('rm-btn', 'Add reported floor', () => {
      const n = Number(floor.value);
      if (!Number.isFinite(n) || floor.value === '')
        return ctx.notify('Enter a floor number', true);
      const cmd = {
        type: 'session',
        patch: {
          report: {
            id: `op-${Date.now()}`,
            floor: Math.round(n),
            kind: kind.value,
            at: Date.now(),
          },
        },
      };
      const label = `Reported floor ${Math.round(n)} on every screen`;
      // Replacing an open report asks first (review R13).
      if (ss.report)
        ctx.ask(
          cmd,
          `Replace the reported floor ${ss.report.floor} with floor ${Math.round(n)} on every screen`,
          label,
        );
      else ctx.send(cmd, label);
    }),
  );
  out.push(f);
  return out;
}

// ----------------------------------------------------------------- 02 People
function people(ctx) {
  const t = tripById(ctx.state.session.tripId);
  const data = ctx.tripData(t);
  const out = [
    ...head('People', `${t.title} · full names on this device only`),
  ];
  if (!data?.snapshot) {
    out.push(el('div', 'rm-note', 'Loading the roster…'));
    return out;
  }
  const list = data.snapshot.participants || [];
  out.push(kick(`Travelers and chaperones · ${list.length}`, WALL));
  out.push(
    el(
      'div',
      'rm-note',
      'Spotlight selects the person on the walls (first name and initial there; initials in visitor mode).',
    ),
  );
  // The spotlighted person, framed on the Site wall on request (the walls
  // never move their camera on their own).
  const sp = ctx.state.session.spotlight;
  const who = sp?.kind === 'person' && list.find((p) => p.id === sp.id);
  const site = slotWithRole(ctx.state, 'site');
  if (who && site) {
    const a = el('div', 'rm-actions');
    a.append(
      btn(
        'rm-btn primary',
        `Frame ${who.name.split(' ')[0]} on Site (S${site})`,
        () =>
          ctx.send(
            {
              type: 'screens',
              target: site,
              patch: {
                frame: {
                  subject: { kind: 'person', id: who.id },
                  nonce: Date.now(),
                },
              },
            },
            `S${site} frames ${who.name.split(' ')[0]}`,
          ),
      ),
    );
    out.push(a);
  }
  const l = el('div', 'rm-list');
  const sorted = [...list]
    .map((p) => ({ p, pos: positionState(p, 0) }))
    .sort((a, b) => Number(a.pos.current) - Number(b.pos.current));
  for (const { p, pos } of sorted)
    l.append(
      row(
        p.role === 'chaperone' ? 'C' : '',
        p.name,
        pos.label.startsWith(pos.chip)
          ? pos.label
          : `${pos.chip} · ${pos.label}`,
        'SPOTLIGHT',
        () =>
          ctx.send(
            {
              type: 'session',
              patch: { spotlight: { kind: 'person', id: p.id } },
            },
            `Spotlight ${p.name.split(' ')[0]} on every screen`,
          ),
      ),
    );
  out.push(l);
  return out;
}

// ------------------------------------------------------------------- 04 Trip
function trip(ctx) {
  const { state, target } = ctx;
  const ss = state.session;
  const t = tripById(ss.tripId);
  const data = ctx.tripData(t);
  const out = [...head('Day plan', `${t.title} · ${t.org}`)];
  // Live / Advance: per screen, pins respected (review R2).
  out.push(kick('Live or Advance', scopeOf(target)));
  const cur = target === 'all' ? null : state.screens[target]?.mode || 'live';
  const seg = el('div', 'rm-actions');
  for (const [k, label] of [
    ['live', 'Live'],
    ['advance', 'Advance (planning)'],
  ])
    seg.append(
      btn(`rm-btn${cur === k ? ' on' : ''}`, label, () => ctx.setMode(k), {
        'aria-pressed': String(cur === k),
      }),
    );
  out.push(seg);
  if (!data) {
    out.push(el('div', 'rm-note', 'Loading the trip plan…'));
    return out;
  }
  const pick = ctx.ui.day ?? data.today;
  const day = data.days.find((d) => d.day === pick) || data.days[0];
  if (!day) return out;
  out.push(
    kick(
      `Day ${day.day} · ${dayText(day.date)}${day.day === data.today ? ' · today' : ''}`,
      scopeOf(target),
    ),
  );
  out.push(el('div', 'rm-note', 'Pick another day in the list on the right.'));
  const show = el('div', 'rm-actions');
  show.append(
    btn(
      'rm-btn primary',
      target === 'all'
        ? `Plan Day ${day.day} on all screens (Advance)`
        : `Show Day ${day.day} on S${target} (day plan)`,
      () => ctx.showDay(day.day),
    ),
  );
  out.push(show);
  for (const e of day.events)
    out.push(
      row(
        e.start,
        e.title,
        `${e.site}${e.end ? ` · until ${e.end}` : ''}`,
        'GO TO SITE',
        () =>
          ctx.send(
            { type: 'session', patch: { siteKey: e.siteKey } },
            `Every screen → ${e.site}`,
          ),
      ),
    );
  if (!day.events.length)
    out.push(el('div', 'rm-note', 'No events on the plan for this day.'));
  if (day.flags.length) {
    out.push(kick(`Plan checks · ${day.flags.length}`));
    for (const fl of day.flags) out.push(el('div', 'rm-flag', fl));
  }
  out.push(kick(`Sites & places · sunset ${day.sunset || '—'}`, WALL));
  for (const s of day.sites) {
    out.push(el('div', 'rm-note', s.label));
    const pl = el('div', 'rm-list');
    for (const p of s.places)
      pl.append(
        row(
          '',
          p.label,
          p.name,
          p.draft ? 'DRAFT · NOT APPROVED' : 'SPOTLIGHT',
          () =>
            ctx.send(
              {
                type: 'session',
                patch: { spotlight: { kind: 'place', id: p.id } },
              },
              `Spotlight ${p.label} on every screen`,
            ),
        ),
      );
    if (!s.places.length)
      pl.append(el('div', 'rm-note', 'No places recorded for this site'));
    out.push(pl);
  }
  out.push(
    el(
      'div',
      'rm-note',
      'Paths for the day are drawn on the Day plan screen (saved and suggested paths with their checks).',
    ),
  );
  return out;
}
// ------------------------------------------------------- 06 Trips on watch
function tripsOnWatch(ctx) {
  const t = tripById(ctx.state.session.tripId);
  const out = [...head('Trips on watch', `In focus: ${t.title} · ${t.org}`)];
  out.push(kick('Trips on watch', WALL));
  const trips = el('div', 'rm-list');
  for (const x of DEMO_TRIPS)
    trips.append(
      row(
        x.orgShort,
        x.title,
        x.org,
        x.id === t.id
          ? 'IN FOCUS'
          : ctx.tripData(x)?.snapshot?.reported_incidents?.length
            ? 'REPORTED · SWITCH ALL SCREENS'
            : 'SWITCH ALL SCREENS',
        () =>
          x.id !== t.id &&
          ctx.send(
            {
              type: 'session',
              // A report, its acknowledgement and the demo storm belong to
              // the trip being left: never carried onto the next one.
              patch: {
                tripId: x.id,
                siteKey: null,
                spotlight: null,
                report: null,
                incidentAck: null,
                simStorm: null,
              },
            },
            `Every screen → ${x.title} (screens reload into its city)`,
          ),
        x.id === t.id,
      ),
    );
  out.push(trips);
  return out;
}

function tripContext(ctx) {
  const t = tripById(ctx.state.session.tripId);
  const data = ctx.tripData(t);
  if (!data) return [];
  const pick = ctx.ui.day ?? data.today;
  return data.days.map((d) =>
    row(
      `D${d.day}`,
      `Day ${d.day} · ${dayText(d.date)}${d.day === data.today ? ' · today' : ''}`,
      `${d.events.length} event${d.events.length === 1 ? '' : 's'}${d.flags.length ? ` · ${d.flags.length} plan check${d.flags.length === 1 ? '' : 's'}` : ''}`,
      '',
      () => ctx.pickDay(d.day),
      d.day === pick,
    ),
  );
}

// ------------------------------------- Screens & devices (the rail foot)
function screens(ctx) {
  const { state, presence, target } = ctx;
  const out = [
    ...head(
      'Screens & devices',
      `Wall · ${state.count} screen${state.count > 1 ? 's' : ''} · target ${tgtName(target)}`,
    ),
  ];
  out.push(kick('Screens on the wall'));
  const grid = el('div', 'rm-screens');
  for (const slot of Object.keys(state.screens).map(Number)) {
    const s = state.screens[slot];
    const p = presence?.screens?.[slot];
    const card = btn(`rm-screen${p?.online ? '' : ' offline'}`, '', () =>
      ctx.setTarget(slot),
    );
    if (target === slot) card.setAttribute('aria-current', 'true');
    const th = ctx.thumbs[slot];
    if (th) {
      const img = el('img');
      img.dataset.thumb = String(slot);
      img.alt = `Screen ${slot} snapshot`;
      img.src = th;
      card.append(img);
    } else
      card.append(el('div', 'ph', p ? 'Waiting for a snapshot' : 'Not paired'));
    card.append(
      el(
        'div',
        'sum',
        `${screenSummary(slot, s, {
          online: Boolean(p?.online),
          ageS: p?.lastSeen ? (Date.now() - p.lastSeen) / 1000 : null,
        })}${s.mode === 'advance' ? ` · ADVANCE${s.day ? ` DAY ${s.day}` : ''}` : ''}`,
      ),
    );
    const at = ctx.local?.[slot];
    if (at?.text)
      card.append(
        el('div', `sum${at.on ? ' hands' : ''}`, `At the wall: ${at.text}`),
      );
    // Only when another device made it: you know what you did (SUP-4).
    const by = ctx.lastBy?.(slot);
    if (by) card.append(el('div', 'sum', `Last change by ${by}`));
    card.dataset.ttScreen = String(slot);
    grid.append(card);
  }
  out.push(grid);
  // A slot with no live window: say so and offer pairing right here.
  const missing = Object.keys(state.screens)
    .map(Number)
    .filter((slot) => !presence?.screens?.[slot]?.online);
  if (missing.length)
    out.push(
      el(
        'div',
        'rm-flag',
        `${missing.map((n) => `S${n}`).join(', ')} ${missing.length > 1 ? 'have' : 'has'} no screen connected · if a screen shows a 4-digit code, pair it below`,
      ),
    );
  out.push(kick('Pair a screen'));
  out.push(
    el(
      'div',
      'rm-note',
      'On the new screen open twin.html?view=screen — it shows a 4-digit code. Enter it here and pick its number.',
    ),
  );
  const pair = el('div', 'rm-actions');
  pair.dataset.ttPair = '';
  const code = el('input', 'rm-input');
  code.inputMode = 'numeric';
  code.maxLength = 4;
  code.placeholder = '0000';
  code.setAttribute('aria-label', 'Pairing code');
  const slotSel = el('select', 'rm-input');
  slotSel.setAttribute('aria-label', 'Screen number');
  for (let n = 1; n <= 6; n++) slotSel.append(new Option(`S${n}`, String(n)));
  slotSel.value = String(Math.min(6, state.count + 1));
  // After 5 wrong codes pairing pauses for a minute: the button says how
  // long is left, and is off until then.
  const p = ctx.ui.pair;
  const left = p?.until ? Math.ceil((p.until - Date.now()) / 1000) : 0;
  const pairBtn = btn(
    'rm-btn',
    left > 0
      ? `Pair (${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')})`
      : 'Pair',
    () => ctx.pairScreen(code.value.trim(), Number(slotSel.value)),
    { 'data-tt-pair-go': '', ...(left > 0 ? { disabled: 'true' } : {}) },
  );
  pair.append(code, slotSel, pairBtn);
  out.push(pair);
  if (p?.text) {
    const msg = el('div', p.err ? 'rm-flag' : 'rm-note', p.text);
    msg.dataset.ttPairResult = p.err ? 'refused' : 'ok';
    out.push(msg);
  }
  if (target === 'all') {
    out.push(
      kick('All screens'),
      el(
        'div',
        'rm-note',
        'Pick one screen above (or S1–S6 at the top) to change its role, pin it or size its text.',
      ),
    );
    const a = el('div', 'rm-actions');
    a.append(
      btn('rm-btn', 'Reset every screen to its role defaults', () =>
        ctx.send({ type: 'reset', target: 'all' }, 'Reset to role defaults'),
      ),
      btn('rm-btn', 'Identify screens', () => ctx.sync.send({ t: 'identify' })),
    );
    out.push(a);
  } else {
    const s = state.screens[target];
    out.push(kick('Role', `S${target}`));
    const roles = el('div', 'rm-list');
    for (const key of ROLE_ORDER)
      roles.append(
        row(
          '',
          ROLES[key].label,
          ROLES[key].sub,
          s?.role === key ? 'ON THIS SCREEN' : '',
          () =>
            ctx.send(
              { type: 'screens', target, patch: { role: key } },
              `S${target} → ${ROLES[key].label}`,
            ),
          s?.role === key,
        ),
      );
    out.push(roles);
    out.push(kick('Display', `S${target}`));
    const a = el('div', 'rm-actions');
    // A wall's text size stays where the type rule holds (screens F12).
    const ts = Math.max(
      WALL_TEXT_MIN,
      Math.min(WALL_TEXT_MAX, Number(s?.textScale || 1.75)),
    );
    a.append(
      btn('rm-btn', 'Text −', () =>
        ctx.send(
          {
            type: 'screens',
            target,
            patch: { textScale: Math.max(WALL_TEXT_MIN, ts - 0.25) },
          },
          `S${target} text smaller`,
        ),
      ),
      el('span', 'rm-note', `Text ×${ts}`),
      btn('rm-btn', 'Text +', () =>
        ctx.send(
          {
            type: 'screens',
            target,
            patch: { textScale: Math.min(WALL_TEXT_MAX, ts + 0.25) },
          },
          `S${target} text larger`,
        ),
      ),
      btn(
        `rm-btn${s?.pinned ? ' on' : ''}`,
        s?.pinned ? 'Pinned · unpin' : 'Pin (All leaves it as it is)',
        () =>
          ctx.send(
            { type: 'screens', target, patch: { pinned: !s?.pinned } },
            s?.pinned ? `S${target} unpinned` : `S${target} pinned`,
          ),
        { 'aria-pressed': String(Boolean(s?.pinned)), 'data-tt-pin': '' },
      ),
      btn('rm-btn', 'Clear the wall’s own selection', () =>
        ctx.send(
          {
            type: 'screens',
            target,
            patch: {
              frame: { subject: { kind: 'clear' }, nonce: Date.now() },
            },
          },
          `S${target} selection cleared`,
        ),
      ),
      btn('rm-btn', 'Reset to role defaults', () =>
        ctx.send({ type: 'reset', target }, `S${target} reset`),
      ),
      btn('rm-btn', 'Identify screens', () => ctx.sync.send({ t: 'identify' })),
    );
    out.push(a);
    // A wall's layout (screens/05-S1-PLAN §13): set here or at the wall,
    // only on a wall already in the new frame (F18).
    const l = layoutValue(s || {});
    const shell = wallShellOn(s || {});
    const mapRole = ROLES[s?.role]?.canvas;
    const lay = el('div', 'rm-actions');
    const pick = (patch, label) =>
      ctx.send({ type: 'screens', target, patch: { layout: patch } }, label);
    if (mapRole)
      lay.append(
        btn(
          `rm-btn${l.cards === 'shown' ? ' on' : ''}`,
          'Cards shown',
          () => pick({ cards: 'shown' }, `S${target} cards shown`),
          { 'aria-pressed': String(l.cards === 'shown') },
        ),
        btn(
          `rm-btn${l.cards === 'map' ? ' on' : ''}`,
          'Map only',
          () => pick({ cards: 'map' }, `S${target} map only`),
          { 'aria-pressed': String(l.cards === 'map') },
        ),
      );
    lay.append(
      btn(
        `rm-btn${l.width === 'standard' ? ' on' : ''}`,
        'Standard column',
        () => pick({ width: 'standard' }, `S${target} standard column`),
        { 'aria-pressed': String(l.width === 'standard') },
      ),
      btn(
        `rm-btn${l.width === 'wide' ? ' on' : ''}`,
        'Wide column',
        () => pick({ width: 'wide' }, `S${target} wide column`),
        { 'aria-pressed': String(l.width === 'wide') },
      ),
    );
    for (const c of (CARD_CATALOG[s?.role] || []).filter((x) => !x.lock))
      if ((CARD_CATALOG[s?.role] || []).filter((x) => !x.lock).length > 1) {
        const hidden = l.off.includes(c.key);
        lay.append(
          btn(
            `rm-btn${hidden ? '' : ' on'}`,
            `${c.label} ${hidden ? 'off' : 'on'}`,
            () =>
              pick(
                {
                  off: hidden
                    ? l.off.filter((k) => k !== c.key)
                    : [...l.off, c.key],
                },
                `S${target} ${c.label} ${hidden ? 'on' : 'off'}`,
              ),
            { 'aria-pressed': String(!hidden) },
          ),
        );
      }
    if (shell)
      out.push(
        kick(
          'Layout',
          `S${target}${layoutChanged(s || {}) ? ' · CHANGED' : ''}`,
        ),
        lay,
      );
  }
  out.push(kick('Whole wall', `${WALL}, PINS INCLUDED`));
  const w = el('div', 'rm-actions');
  w.append(
    btn(
      `rm-btn${state.session.visitor ? ' on' : ''}`,
      state.session.visitor
        ? 'Visitor mode on · turn off'
        : 'Visitor mode (initials and counts only)',
      () =>
        ctx.send(
          { type: 'session', patch: { visitor: !state.session.visitor } },
          state.session.visitor
            ? 'Visitor mode off: names back on every wall'
            : 'Visitor mode on',
        ),
      { 'aria-pressed': String(Boolean(state.session.visitor)) },
    ),
    // Every wall view only, in one press (screens Q2): no menu or sheets
    // at the walls, nothing saved there; camera moves by hand still work.
    btn(
      `rm-btn${state.session.wallControls === false ? ' on' : ''}`,
      state.session.wallControls === false
        ? 'Walls view only · turn wall controls on'
        : 'Wall controls on · set every wall view only',
      () =>
        ctx.send(
          {
            type: 'session',
            patch: { wallControls: state.session.wallControls === false },
          },
          state.session.wallControls === false
            ? 'Wall controls on: each wall has its menu again'
            : 'Every wall view only: no menu or settings at the walls',
        ),
      {
        'aria-pressed': String(state.session.wallControls === false),
        'data-tt-wall-controls': '',
      },
    ),
    btn(
      'rm-btn',
      'Return all to Live + defaults',
      () =>
        ctx.send(
          { type: 'returnLive' },
          'Every screen, pinned ones too, back to Live and its role defaults',
        ),
      { 'data-tt-return-all': '' },
    ),
  );
  out.push(w);
  out.push(kick('This remote'));
  const rm = el('div', 'rm-actions');
  const on = ctx.remoteMotion?.() !== false;
  rm.append(
    btn(
      `rm-btn${on ? ' on' : ''}`,
      on ? 'Remote animation on · turn off' : 'Remote animation off · turn on',
      () => ctx.setRemoteMotion?.(!on),
      { 'aria-pressed': String(on) },
    ),
    el('span', 'rm-note', 'Wall motion is set per screen in Layers & display.'),
  );
  out.push(rm);
  out.push(kick('Number of screens', WALL));
  const cnt = el('div', 'rm-actions');
  for (let n = 1; n <= 6; n++)
    cnt.append(
      btn(
        `rm-btn${state.count === n ? ' on' : ''}`,
        String(n),
        () => ctx.send({ type: 'count', n }, `${n} screen${n > 1 ? 's' : ''}`),
        { 'aria-pressed': String(state.count === n) },
      ),
    );
  out.push(cnt);
  return out;
}

// ----------------------------------------------------------------- 06 Layers
function layers(ctx) {
  const { state, target } = ctx;
  const slots =
    target === 'all' ? Object.keys(state.screens).map(Number) : [target];
  // What each wall shows, role defaults included (the wall's L sheet agrees).
  const value = (key) => {
    const vals = slots.map((s) => layerValue(state.screens[s], key));
    return vals.every((v) => v === vals[0]) ? vals[0] : null;
  };
  const out = [...head('Layers & display', `Applies to ${tgtName(target)}`)];
  layersAndDisplay(ctx, out, value, slots);
  return out;
}

/** 01 Site: the scale of the 3D site picture (review/shell D5). */
function site(ctx) {
  const { state, target } = ctx;
  const out = [...head('Site', `3D site picture · ${tgtName(target)}`)];
  out.push(kick('Scale', scopeOf(target)));
  const sc = el('div', 'rm-actions');
  const cur = target === 'all' ? null : state.screens[target]?.scale;
  for (const [k, label] of [
    ['building', 'Building'],
    ['neighborhood', 'Neighborhood'],
    ['city', 'City'],
  ])
    sc.append(
      btn(
        `rm-btn${cur === k ? ' on' : ''}`,
        label,
        () =>
          ctx.send(
            { type: 'screens', target, patch: { scale: k } },
            `${tgtName(target)} → ${label}`,
          ),
        { 'aria-pressed': String(cur === k) },
      ),
    );
  out.push(sc);
  out.push(
    el(
      'div',
      'rm-note',
      'Layers, display and motion are in Layers & display, at the foot of the stations.',
    ),
  );
  const a = el('div', 'rm-actions');
  a.append(
    btn('rm-btn', `Reset ${tgtName(target)} to role defaults`, () =>
      ctx.send({ type: 'reset', target }, `${tgtName(target)} reset`),
    ),
  );
  out.push(a);
  return out;
}

function layersAndDisplay(ctx, out, value, slots) {
  const { state, target } = ctx;
  for (const g of LAYER_CATALOG) {
    out.push(kick(g.group, scopeOf(target)));
    for (const L of g.layers) {
      const v = value(L.key);
      const r = el('div', 'rm-layer');
      const lab = el('div', 'lab', L.label);
      if (v === null) lab.append(el('small', '', 'differs between screens'));
      const seg = el('div', 'rm-seg');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', L.label);
      for (const [on, tx] of [
        [true, 'On'],
        [false, 'Off'],
      ])
        seg.append(
          btn(
            '',
            tx,
            () =>
              ctx.send(
                {
                  type: 'screens',
                  target,
                  patch: { layers: { [L.key]: on } },
                },
                `${L.label} ${on ? 'on' : 'off'}`,
              ),
            {
              'aria-pressed': String(v === on),
              'data-tt-layer': `${L.key}:${on ? 'on' : 'off'}`,
            },
          ),
        );
      r.append(lab, seg);
      out.push(r);
    }
  }
  // Motion tiers (phase 11): each has its own switch, per wall or for all.
  out.push(kick('Display · Motion', scopeOf(target)));
  const mvalue = (key) => {
    const vals = slots.map((s) => state.screens[s]?.motion?.[key] !== false);
    return vals.every((v) => v === vals[0]) ? vals[0] : null;
  };
  for (const T of MOTION_TIERS) {
    const v = mvalue(T.key);
    const r = el('div', 'rm-layer');
    const lab = el('div', 'lab', T.label);
    lab.append(el('small', '', v === null ? 'differs between screens' : T.sub));
    const seg = el('div', 'rm-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', `${T.label} motion`);
    for (const [on, tx] of [
      [true, 'On'],
      [false, 'Off'],
    ])
      seg.append(
        btn(
          '',
          tx,
          () =>
            ctx.send(
              { type: 'screens', target, patch: { motion: { [T.key]: on } } },
              `${T.label} motion ${on ? 'on' : 'off'}`,
            ),
          { 'aria-pressed': String(v === on) },
        ),
      );
    r.append(lab, seg);
    out.push(r);
  }
  out.push(
    el(
      'div',
      'rm-note',
      'A wall whose system asks for reduced motion stays still whatever these say.',
    ),
  );
  const a = el('div', 'rm-actions');
  a.append(
    btn('rm-btn', `Reset ${tgtName(target)} to role defaults`, () =>
      ctx.send({ type: 'reset', target }, `${tgtName(target)} reset`),
    ),
  );
  out.push(a);
}

// --------------------------------------------------------------- 03 Weather
/** See it coming: the approach, the time lens, official alerts, lightning. */
/** The same lens words as the walls (QA D18). */
function lensKind(wx, at, now) {
  if (wx?.sim) return 'SIMULATED storm';
  if (at <= now)
    return wx?.positionOnly ? 'satellite estimate' : 'observed radar';
  const moving = wx?.motion && !wx.motion.unmeasured && !wx.positionOnly;
  return moving && at - now <= 60 * 60e3
    ? 'projection on the current track, not a forecast model'
    : 'forecast';
}
function weather(ctx) {
  const { state } = ctx;
  const ss = state.session;
  const t = tripById(ss.tripId);
  const wx = ctx.ui.wx;
  const out = [...head('Weather', `${t.title} · see it coming`)];
  out.push(
    kick(`Storm approach · radar track${wx?.sim ? ' · simulated' : ''}`, WALL),
  );
  if (!wx) {
    out.push(el('div', 'rm-note', 'Radar loading…'));
  } else {
    const tiers = el('div', `rm-wx-tiers ${wx.text.level || 'info'}`);
    if (wx.text.lead) tiers.append(el('div', 'lead', wx.text.lead));
    tiers.append(el('div', 'claim', wx.text.claim || wx.text.text));
    if (wx.text.detail) tiers.append(el('div', 'detail', wx.text.detail));
    out.push(tiers);
    if (wx.realText)
      out.push(
        el('div', 'rm-note', `Real radar under the demo: ${wx.realText.text}`),
      );
    out.push(
      el(
        'div',
        'rm-note',
        wx.sim
          ? 'SIMULATED storm (prototype) · every wall shows it labelled SIMULATED and badged DEMO STORM. It ends itself after 45 min, and Return all ends it.'
          : wx.positionOnly
            ? 'Satellite rain estimate, about 65 min behind · position only, no arrival time.'
            : wx.motion && !wx.motion.unmeasured
              ? 'Observed motion from two radar frames 20 min apart. A track, not a forecast model. Times count from now and are shown as a range.'
              : 'Motion needs storm echo in both frames; until then only the position is known.',
      ),
    );
  }
  // Time lens: one time for every wall (session wxAt); people stay live.
  out.push(kick('Time lens', WALL));
  const now = Date.now();
  const at = ss.wxAt;
  const lens = el('div', 'rm-actions');
  for (const [label, min] of [
    ['−30 min', -30],
    ['Now', null],
    ['+15 min', 15],
    ['+30 min', 30],
    ['+45 min', 45],
    ['+60 min', 60],
  ]) {
    const target = min == null ? null : now + min * 60e3;
    const on =
      min == null ? at == null : at != null && Math.abs(at - target) < 4 * 60e3;
    lens.append(
      btn(
        `rm-btn${on ? ' on' : ''}`,
        label,
        () =>
          ctx.send(
            { type: 'session', patch: { wxAt: target } },
            min == null
              ? 'Every wall: weather now'
              : `Every wall: weather ${label}`,
          ),
        { 'aria-pressed': String(on) },
      ),
    );
  }
  out.push(lens);
  out.push(
    el(
      'div',
      'rm-note',
      at == null
        ? 'Walls show the weather now.'
        : `Walls show ${wx?.clock ? wx.clock(at) : 'another time'} · ${lensKind(wx, at, now)} · people and incidents stay live.`,
    ),
  );
  out.push(kick('Official alerts', WALL));
  for (const l of wx?.lines || [])
    out.push(
      el(
        'div',
        `rm-wx-alert${l.sim ? ' sim' : l.official ? ' official' : l.warn ? ' warn' : ''}`,
        l.text,
      ),
    );
  out.push(kick('Lightning', WALL));
  out.push(el('div', 'rm-note', wx?.ltgText || 'Lightning grid loading…'));
  out.push(kick('Demo', WALL));
  const demo = el('div', 'rm-actions');
  demo.append(
    btn(
      `rm-btn${ss.simStorm ? ' on' : ''}`,
      ss.simStorm
        ? 'Simulated storm on · stop'
        : 'Simulated storm approaching · start (every wall)',
      () =>
        ctx.send(
          {
            type: 'session',
            patch: { simStorm: ss.simStorm ? null : Date.now() },
          },
          ss.simStorm
            ? 'Simulated storm stopped'
            : 'Simulated storm started (labelled SIMULATED)',
        ),
      { 'aria-pressed': String(Boolean(ss.simStorm)) },
    ),
    btn('rm-btn', 'Refresh', () => ctx.wxRefresh?.()),
  );
  out.push(demo);
  // Frame the storm on the Weather wall (an operator's camera request).
  const wxSlot = slotWithRole(state, 'weather');
  if (
    wxSlot &&
    ['arriving', 'near', 'over', 'passing'].includes(wx?.text?.status)
  )
    out.splice(
      out.indexOf(lens) - 1,
      0,
      (() => {
        const a = el('div', 'rm-actions');
        a.append(
          btn('rm-btn primary', `Frame the storm on S${wxSlot} (Weather)`, () =>
            ctx.send(
              {
                type: 'screens',
                target: wxSlot,
                patch: {
                  frame: { subject: { kind: 'storm' }, nonce: Date.now() },
                },
              },
              `S${wxSlot} frames the storm`,
            ),
          ),
        );
        return a;
      })(),
    );
  return out;
}

const RENDER = {
  site,
  travelers: people,
  incident,
  weather,
  day: trip,
  trips: tripsOnWatch,
};
export const STATIONS = WALL_STATIONS.map((s) => ({
  ...s,
  // One subtitle per station on every screen (review/shell R2-4).
  sub: s.sub,
  render: RENDER[s.id],
  context: s.id === 'day' ? tripContext : undefined,
}));
/** Stations reached from the rail foot, not a tile. */
export const FOOT_STATIONS = [
  {
    id: 'layers',
    num: '',
    label: 'Layers & display',
    sub: 'Layers, display & motion',
    icon: ICON.layers,
    render: layers,
  },
  {
    id: 'screens',
    num: '',
    label: 'Screens & devices',
    sub: 'Wall screens, pairing & roles',
    icon: ICON.screens,
    render: screens,
  },
];
export const stationOf = (id) =>
  [...STATIONS, ...FOOT_STATIONS].find((s) => s.id === id) || STATIONS[0];
