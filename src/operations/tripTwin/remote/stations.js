// Trip Twin remote stations (phase 10). 01 Screens · 02 Trip · 03 Incident
// · 04 Layers & display live; 05 People and 06 Alerts & feeds next phase.
// Each station renders the left-hand content for the current target and,
// when it has one, its level-2 list in the rail (tarva.network pattern).
import {
  LAYER_CATALOG,
  ROLES,
  ROLE_ORDER,
  screenSummary,
} from '../twinScreenRoles.js';
import { DEMO_TRIPS, tripById } from '../demoTrips.js';
import { formatAge, positionState } from '../twinData.js';

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
  alerts:
    '<svg viewBox="0 0 20 20"><path d="M10 3a4.5 4.5 0 0 0-4.5 4.5V11L4 13.5h12L14.5 11V7.5A4.5 4.5 0 0 0 10 3z"/><path d="M8.5 16a1.6 1.6 0 0 0 3 0"/></svg>',
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

// ---------------------------------------------------------------- 01 Screens
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
        screenSummary(slot, s, {
          online: Boolean(p?.online),
          ageS: p?.lastSeen ? (Date.now() - p.lastSeen) / 1000 : null,
        }),
      ),
    );
    // Someone working at that wall by hand (hands-on) and what they picked.
    const at = ctx.local?.[slot];
    if (at?.text)
      card.append(
        el('div', `sum${at.on ? ' hands' : ''}`, `At the wall: ${at.text}`),
      );
    grid.append(card);
  }
  out.push(grid);
  if (target === 'all') {
    out.push(
      el('div', 'rm-k', 'All screens'),
      el(
        'div',
        'rm-note',
        'Pick one screen above to change its role, pin it or size its text.',
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
    out.push(el('div', 'rm-k', `S${target} · role`));
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
    out.push(el('div', 'rm-k', `S${target} · display`));
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
      el('span', 'rm-note', `Text ×${ts.toFixed(2).replace(/0$/, '')}`),
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
        s?.pinned ? 'Pinned · unpin' : 'Pin (All skips it)',
        () =>
          ctx.send(
            { type: 'screens', target, patch: { pinned: !s?.pinned } },
            s?.pinned ? `S${target} unpinned` : `S${target} pinned`,
          ),
        { 'aria-pressed': String(Boolean(s?.pinned)) },
      ),
      btn('rm-btn', 'Reset to role defaults', () =>
        ctx.send({ type: 'reset', target }, `S${target} reset`),
      ),
      btn('rm-btn', 'Identify screens', () => ctx.sync.send({ t: 'identify' })),
    );
    out.push(a);
  }
  // Session-wide.
  out.push(el('div', 'rm-k', 'Whole wall'));
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
          state.session.visitor ? 'Visitor mode off' : 'Visitor mode on',
        ),
      { 'aria-pressed': String(Boolean(state.session.visitor)) },
    ),
    btn('rm-btn', 'Return all to Live + defaults', () =>
      ctx.send(
        { type: 'returnLive' },
        'All screens back to Live and their defaults',
      ),
    ),
  );
  out.push(w);
  out.push(el('div', 'rm-k', 'Number of screens'));
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
  // Pairing a screen on another device.
  out.push(el('div', 'rm-k', 'Pair a screen'));
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
    btn('rm-btn primary', 'Pair', async () => {
      const r = await ctx.sync.request({
        t: 'pair',
        code: code.value.trim(),
        slot: Number(slotSel.value),
      });
      ctx.notify(r.ok ? `Paired S${r.slot}` : r.error, !r.ok);
    }),
  );
  out.push(pair);
  return out;
}
function screensContext(ctx) {
  const { state, presence } = ctx;
  const list = [
    row(
      '',
      'All screens',
      'Shared context',
      '',
      () => ctx.setTarget('all'),
      ctx.target === 'all',
    ),
  ];
  for (const slot of Object.keys(state.screens).map(Number)) {
    const p = presence?.screens?.[slot];
    list.push(
      row(
        `S${slot}`,
        ROLES[state.screens[slot].role]?.label || '',
        ctx.local?.[slot]?.on
          ? 'hands-on at the wall'
          : p?.online
            ? 'online'
            : 'not connected',
        state.screens[slot].pinned ? 'PIN' : '',
        () => ctx.setTarget(slot),
        ctx.target === slot,
      ),
    );
  }
  return list;
}

// ------------------------------------------------------------------ 02 Trip
function trip(ctx) {
  const { state } = ctx;
  const ss = state.session;
  const t = tripById(ss.tripId);
  const data = ctx.tripData(t);
  const out = [
    ...head(
      t.title,
      `${t.org} · ${ss.mode === 'advance' ? 'Advance (planning)' : 'Live'}`,
    ),
  ];
  out.push(el('div', 'rm-k', 'Trips on watch'));
  const trips = el('div', 'rm-list');
  for (const x of DEMO_TRIPS)
    trips.append(
      row(
        x.orgShort,
        x.title,
        x.org,
        x.id === t.id ? 'IN FOCUS' : '',
        () =>
          x.id !== t.id &&
          ctx.send(
            {
              type: 'session',
              patch: { tripId: x.id, siteKey: null, day: null },
            },
            `Focus: ${x.title}`,
          ),
        x.id === t.id,
      ),
    );
  out.push(trips);
  out.push(el('div', 'rm-k', 'Mode (every screen)'));
  const seg = el('div', 'rm-actions');
  for (const [k, label] of [
    ['live', 'Live'],
    ['advance', 'Advance (planning)'],
  ])
    seg.append(
      btn(
        `rm-btn${ss.mode === k ? ' on' : ''}`,
        label,
        () =>
          ss.mode !== k &&
          ctx.send(
            { type: 'session', patch: { mode: k } },
            `${label} on every screen`,
          ),
        { 'aria-pressed': String(ss.mode === k) },
      ),
    );
  out.push(seg);
  if (!data) {
    out.push(el('div', 'rm-note', 'Loading the trip plan…'));
    return out;
  }
  const days = data.days;
  const pick = ctx.ui.day ?? ss.day ?? data.today;
  out.push(
    el(
      'div',
      'rm-k',
      `Days · ${days.length}${ss.mode === 'live' ? ` · today is Day ${data.today}` : ''}`,
    ),
  );
  const dl = el('div', 'rm-list');
  for (const d of days)
    dl.append(
      row(
        `D${d.day}`,
        `Day ${d.day} · ${new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`,
        d.events.map((e) => `${e.start} ${e.title}`).join(' · ') ||
          'No events on the plan',
        `${d.events.length} event${d.events.length === 1 ? '' : 's'}${d.flags.length ? ` · ${d.flags.length} to check` : ''}`,
        () => ctx.pickDay(d.day),
        d.day === pick,
      ),
    );
  out.push(dl);
  const day = days.find((d) => d.day === pick);
  if (day) {
    out.push(el('div', 'rm-k', `Day ${day.day} · plan`));
    const show = el('div', 'rm-actions');
    show.append(
      btn(
        'rm-btn primary',
        `Show Day ${day.day} on ${tgtName(ctx.target)}`,
        () => ctx.showDay(day.day),
      ),
    );
    out.push(show);
    for (const e of day.events) {
      const r = row(
        e.start,
        e.title,
        `${e.site}${e.end ? ` · until ${e.end}` : ''}`,
        'GO TO SITE',
        () =>
          ctx.send(
            { type: 'session', patch: { siteKey: e.siteKey } },
            `Every screen → ${e.site}`,
          ),
      );
      out.push(r);
    }
    if (day.flags.length) {
      out.push(el('div', 'rm-k', 'To check'));
      for (const f of day.flags) out.push(el('div', 'rm-flag', f));
    }
    out.push(el('div', 'rm-k', `Sites & places · sunset ${day.sunset || '—'}`));
    for (const s of day.sites) {
      out.push(el('div', 'rm-note', s.label));
      const pl = el('div', 'rm-list');
      for (const p of s.places)
        pl.append(
          row('', p.label, p.name, p.draft ? 'DRAFT · NOT APPROVED' : '', () =>
            ctx.send(
              {
                type: 'session',
                patch: {
                  siteKey: s.key,
                  spotlight: { kind: 'place', id: p.id },
                },
              },
              `Every screen → ${p.label}`,
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
        'Paths for the day are drawn on The day screen (saved paths, suggested paths and their checks).',
      ),
    );
  }
  return out;
}
function tripContext(ctx) {
  const t = tripById(ctx.state.session.tripId);
  const data = ctx.tripData(t);
  if (!data) return [];
  const pick = ctx.ui.day ?? ctx.state.session.day ?? data.today;
  return data.days.map((d) =>
    row(
      `D${d.day}`,
      `Day ${d.day}`,
      `${d.events.length} event${d.events.length === 1 ? '' : 's'}`,
      d.flags.length ? '!' : '',
      () => ctx.pickDay(d.day),
      d.day === pick,
    ),
  );
}

// -------------------------------------------------------------- 03 Incident
function incident(ctx) {
  const { state } = ctx;
  const ss = state.session;
  const t = tripById(ss.tripId);
  const data = ctx.tripData(t);
  const fromData = data?.snapshot?.reported_incidents?.[0] || null;
  const report =
    ss.report ||
    (fromData && {
      floor: fromData.floor_label,
      kind: fromData.kind,
      source: fromData.source,
      at: fromData.reported_at,
    });
  const out = [
    ...head(
      'Incident',
      report ? 'Reported · not verified' : 'No incident open',
    ),
  ];
  if (report) {
    out.push(
      el(
        'div',
        'rm-flag rm-hazard',
        `Reported: ${report.kind || 'incident'} · floor ${report.floor}${report.source ? ` · ${report.source}` : ''}${report.at ? ` · ${formatAge((Date.now() - Date.parse(report.at)) / 1000)} ago` : ''} · not verified`,
      ),
    );
    const a = el('div', 'rm-actions');
    a.append(
      btn(
        'rm-btn primary',
        ss.incidentAck
          ? 'Acknowledged'
          : 'Acknowledge (banner shrinks on the wall)',
        () =>
          ctx.send(
            { type: 'session', patch: { incidentAck: true } },
            'Incident acknowledged',
          ),
      ),
      btn('rm-btn', 'Frame reported floor on S1', () =>
        ctx.send(
          {
            type: 'screens',
            target: 1,
            patch: {
              frame: {
                subject: { kind: 'floor', label: report.floor },
                nonce: Date.now(),
              },
            },
          },
          `S1 frames floor ${report.floor}`,
        ),
      ),
      btn('rm-btn', 'Make S3 the incident screen', () =>
        ctx.send(
          { type: 'screens', target: 3, patch: { role: 'incident' } },
          'S3 → Incident & attention',
        ),
      ),
      btn('rm-btn', 'Copy for responders', () => ctx.copyResponders(report)),
    );
    if (ss.report)
      a.append(
        btn('rm-btn danger', 'Clear the reported floor', () =>
          ctx.send(
            { type: 'session', patch: { report: null } },
            'Reported floor cleared',
          ),
        ),
      );
    out.push(a);
    out.push(
      el(
        'div',
        'rm-note',
        'Copied text stays on this device; it is never shown on a wall.',
      ),
    );
  }
  out.push(el('div', 'rm-k', 'Report a floor'));
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
    btn('rm-btn primary', 'Report on every screen', () => {
      const n = Number(floor.value);
      if (!Number.isFinite(n) || floor.value === '')
        return ctx.notify('Enter a floor number', true);
      ctx.send(
        {
          type: 'session',
          patch: { report: { floor: Math.round(n), kind: kind.value } },
        },
        `Reported floor ${Math.round(n)} on every screen`,
      );
    }),
  );
  out.push(f);
  // Full names stay on the remote (walls show first name + initial).
  if (data?.snapshot) {
    const el2 = data.snapshot.scenario?.elapsed_s ?? 0;
    const people = data.snapshot.participants || [];
    out.push(
      el(
        'div',
        'rm-k',
        `Travelers · ${people.length} · full names on this device only`,
      ),
    );
    const l = el('div', 'rm-list');
    const sorted = [...people]
      .map((p) => ({ p, pos: positionState(p, el2) }))
      .sort((a, b) => Number(a.pos.current) - Number(b.pos.current));
    for (const { p, pos } of sorted)
      l.append(
        row(
          p.role === 'chaperone' ? 'C' : '',
          p.name,
          `${pos.chip} · ${pos.label}`,
          'SPOTLIGHT',
          () =>
            ctx.send(
              {
                type: 'session',
                patch: { spotlight: { kind: 'person', id: p.id } },
              },
              `Spotlight ${p.name.split(' ')[0]}`,
            ),
        ),
      );
    out.push(l);
    out.push(
      el(
        'div',
        'rm-note',
        'Who may still be inside, by floor, is on the Incident & attention screen.',
      ),
    );
  }
  return out;
}

// ------------------------------------------------------- 04 Layers & display
function layers(ctx) {
  const { state, target } = ctx;
  const slots =
    target === 'all' ? Object.keys(state.screens).map(Number) : [target];
  const value = (key, def) => {
    const vals = slots.map((s) => state.screens[s]?.layers?.[key] ?? def);
    return vals.every((v) => v === vals[0]) ? vals[0] : null;
  };
  const out = [...head('Layers & display', `Applies to ${tgtName(target)}`)];
  out.push(el('div', 'rm-k', 'Scale'));
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
    out.push(el('div', 'rm-k', g.group));
    for (const L of g.layers) {
      const v = value(L.key, L.def);
      const r = el('div', 'rm-layer');
      const lab = el('div', 'lab', L.label);
      if (v === null) lab.append(el('small', '', 'differs between screens'));
      const seg = el('div', 'rm-seg');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', L.label);
      for (const [on, t] of [
        [true, 'On'],
        [false, 'Off'],
      ])
        seg.append(
          btn(
            '',
            t,
            () =>
              ctx.send(
                { type: 'screens', target, patch: { layers: { [L.key]: on } } },
                `${L.label} ${on ? 'on' : 'off'} · ${tgtName(target)}`,
              ),
            { 'aria-pressed': String(v === on) },
          ),
        );
      r.append(lab, seg);
      out.push(r);
    }
  }
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
    'This station comes in the next phase. The wall already shows this content on its screens.',
  ),
];

export const STATIONS = [
  {
    id: 'screens',
    num: '01',
    label: 'Screens',
    sub: 'Wall screens & roles',
    icon: ICON.screens,
    render: screens,
    context: screensContext,
  },
  {
    id: 'trip',
    num: '02',
    label: 'Trip',
    sub: 'Days, plan & places',
    icon: ICON.trip,
    render: trip,
    context: tripContext,
  },
  {
    id: 'incident',
    num: '03',
    label: 'Incident',
    sub: 'Report, board & responders',
    icon: ICON.incident,
    render: incident,
  },
  {
    id: 'layers',
    num: '04',
    label: 'Layers',
    sub: 'Layers, scale & display',
    icon: ICON.layers,
    render: layers,
  },
  {
    id: 'people',
    num: '05',
    label: 'People',
    sub: 'Next phase',
    icon: ICON.people,
    render: later('People'),
    later: true,
  },
  {
    id: 'alerts',
    num: '06',
    label: 'Alerts',
    sub: 'Next phase',
    icon: ICON.alerts,
    render: later('Alerts & feeds'),
    later: true,
  },
];
