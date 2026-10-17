// Trip Twin remote stations (phase 10; review/phase10 R2, R13, R16).
// 01 Incident · 02 People · 03 Weather (next phase) · 04 Trip · 05 Screens ·
// 06 Layers. Every section says its scope: the target (S2 / all screens) or
// EVERY SCREEN for wall-wide items. Each station renders the left-hand
// content and, when it has one, its level-2 list in the rail.
import {
  LAYER_CATALOG,
  ROLES,
  ROLE_ORDER,
  screenSummary,
} from '../twinScreenRoles.js';
import { DEMO_TRIPS, tripById } from '../demoTrips.js';
import { formatAge, positionState } from '../twinData.js';
import { MOTION_TIERS } from '../twinMotion.js';

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
        'Copied text stays on this device; it is never shown on a wall. Who may still be inside, by floor, is on the Incident & attention screen.',
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
  const out = [...head('Trip in focus', `${t.title} · ${t.org}`)];
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
            ? 'REPORTED · FOCUS'
            : 'FOCUS',
        () =>
          x.id !== t.id &&
          ctx.send(
            {
              type: 'session',
              patch: { tripId: x.id, siteKey: null, spotlight: null },
            },
            `Every screen → ${x.title} (screens reload into its city)`,
          ),
        x.id === t.id,
      ),
    );
  out.push(trips);
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
    out.push(kick(`To check · ${day.flags.length}`));
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
function tripContext(ctx) {
  const t = tripById(ctx.state.session.tripId);
  const data = ctx.tripData(t);
  if (!data) return [];
  const pick = ctx.ui.day ?? data.today;
  return data.days.map((d) =>
    row(
      `D${d.day}`,
      `Day ${d.day} · ${dayText(d.date)}${d.day === data.today ? ' · today' : ''}`,
      `${d.events.length} event${d.events.length === 1 ? '' : 's'}${d.flags.length ? ` · ${d.flags.length} to check` : ''}`,
      '',
      () => ctx.pickDay(d.day),
      d.day === pick,
    ),
  );
}

// ---------------------------------------------------------------- 05 Screens
function screens(ctx) {
  const { state, presence, target } = ctx;
  const out = [
    ...head(
      'Screens',
      `Wall · ${state.count} screen${state.count > 1 ? 's' : ''} · target ${tgtName(target)}`,
    ),
  ];
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
  const code = el('input', 'rm-input');
  code.inputMode = 'numeric';
  code.maxLength = 4;
  code.placeholder = '0000';
  code.setAttribute('aria-label', 'Pairing code');
  const slotSel = el('select', 'rm-input');
  slotSel.setAttribute('aria-label', 'Screen number');
  for (let n = 1; n <= 6; n++) slotSel.append(new Option(`S${n}`, String(n)));
  slotSel.value = String(Math.min(6, state.count + 1));
  pair.append(
    code,
    slotSel,
    btn('rm-btn', 'Pair', async () => {
      const r = await ctx.sync.request({
        t: 'pair',
        code: code.value.trim(),
        slot: Number(slotSel.value),
      });
      ctx.notify(r.ok ? `Paired S${r.slot}` : r.error, !r.ok);
    }),
  );
  out.push(pair);
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
    const ts = Number(s?.textScale || 2);
    a.append(
      btn('rm-btn', 'Text −', () =>
        ctx.send(
          {
            type: 'screens',
            target,
            patch: { textScale: Math.max(1, ts - 0.25) },
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
            patch: { textScale: Math.min(3.5, ts + 0.25) },
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
        { 'aria-pressed': String(Boolean(s?.pinned)) },
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
    btn('rm-btn', 'Return all to Live + defaults', () =>
      ctx.send(
        { type: 'returnLive' },
        'Every screen, pinned ones too, back to Live and its role defaults',
      ),
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
    el('span', 'rm-note', 'Wall motion is set per screen under 06 Layers.'),
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
  const value = (key, def) => {
    const vals = slots.map((s) => state.screens[s]?.layers?.[key] ?? def);
    return vals.every((v) => v === vals[0]) ? vals[0] : null;
  };
  const out = [...head('Layers & display', `Applies to ${tgtName(target)}`)];
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
  for (const g of LAYER_CATALOG) {
    out.push(kick(g.group, scopeOf(target)));
    for (const L of g.layers) {
      const v = value(L.key, L.def);
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
            { 'aria-pressed': String(v === on) },
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
  return out;
}

const later = (title) => () => [
  ...head(title, 'Next phase'),
  el(
    'div',
    'rm-note',
    'This station comes next phase. The Weather & alerts screen already shows official alerts, sensed hazards and the time.',
  ),
];

export const STATIONS = [
  {
    id: 'incident',
    num: '01',
    label: 'Incident',
    sub: 'Report, board & responders',
    icon: ICON.incident,
    render: incident,
  },
  {
    id: 'people',
    num: '02',
    label: 'People',
    sub: 'Roster & spotlight',
    icon: ICON.people,
    render: people,
  },
  {
    id: 'weather',
    num: '03',
    label: 'Weather',
    sub: 'Next phase',
    icon: ICON.weather,
    render: later('Weather'),
    later: true,
  },
  {
    id: 'trip',
    num: '04',
    label: 'Trip',
    sub: 'Days, plan & places',
    icon: ICON.trip,
    render: trip,
    context: tripContext,
  },
  {
    id: 'screens',
    num: '05',
    label: 'Screens',
    sub: 'Wall screens & roles',
    icon: ICON.screens,
    render: screens,
  },
  {
    id: 'layers',
    num: '06',
    label: 'Layers',
    sub: 'Layers, scale & display',
    icon: ICON.layers,
    render: layers,
  },
];
