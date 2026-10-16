// Trip Twin remote (phase 10): the iPad / laptop that drives the wall.
// Right: the STATIONS rail. Left: the target picker (S1–S6 · All), a live
// snapshot of the target, then the station's controls. Every setting for
// the walls lives here; the walls are display only.
import './remote.css';
import { connectSync } from '../twinSync.js';
import { ROLES, screenSummary } from '../twinScreenRoles.js';
import { needsConfirm, previewAll } from '../twinSession.js';
import { tripById, tripDays } from '../demoTrips.js';
import { tripTwinDemoSnapshot } from '../demoTripTwin.js';
import { sitesForCity } from '../twinSites.js';
import { STATIONS, btn } from './stations.js';

const params = new URLSearchParams(location.search);
const app = document.getElementById('rm-app');
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const ss = {
  get(k, d) {
    try {
      return sessionStorage.getItem(`tripTwin.remote.${k}`) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      sessionStorage.setItem(`tripTwin.remote.${k}`, String(v));
    } catch {
      /* ignore */
    }
  },
};

const ui = {
  state: null,
  presence: null,
  controller: false,
  thumbs: {},
  thumbAt: {},
  local: {}, // slot → {on, text}: hands-on at the wall, what was picked

  target:
    ss.get('target', '1') === 'all' ? 'all' : Number(ss.get('target', '1')),
  station: ss.get('station', 'incident'),
  day: null,
  confirm: null, // {cmd, label, text}
  bar: null, // {kind: 'undo'|'err'|'ok', text, undoId, until}
  link: 'connecting',
  denied: null,
};

const device =
  /iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1
    ? 'iPad'
    : /iPhone|Android/.test(navigator.userAgent)
      ? 'Phone'
      : 'Laptop';

// ---- trip data (no Cesium): the snapshot + its days, per trip ----
const tripCache = new Map();
const poisCache = new Map();
function tripData(t) {
  const epoch = ui.state?.session?.epochMs || null;
  const key = `${t.id}:${epoch}`;
  if (!poisCache.has(t.city)) {
    poisCache.set(t.city, null);
    Promise.all(
      sitesForCity(t.city).map(async (s) => {
        const r = await fetch(
          `/scripts/fixtures/trip-twin/${s.key}.pois.json`,
        ).catch(() => null);
        return [s.key, r?.ok ? (await r.json()).pois : []];
      }),
    ).then((list) => {
      poisCache.set(t.city, Object.fromEntries(list));
      tripCache.clear();
      renderContent(true);
      renderRail();
    });
  }
  const pois = poisCache.get(t.city);
  if (!pois) return null;
  // One snapshot per minute is plenty for the plan and the names.
  const minute = Math.floor(Date.now() / 60000);
  const hit = tripCache.get(key);
  if (hit && hit.minute === minute) return hit;
  const snapshot = tripTwinDemoSnapshot(t.city, t.scenario, {
    pois: pois[t.city] || [],
    poisBySite: pois,
    startMs: epoch,
  });
  const days = tripDays(t, snapshot);
  const start = snapshot.trips?.[0]?.start_date;
  const today = start
    ? Math.floor(
        (Date.parse(new Date().toISOString().slice(0, 10)) -
          Date.parse(start)) /
          86400000,
      ) + 1
    : 1;
  const data = { snapshot, days, today, minute };
  tripCache.set(key, data);
  return data;
}

// ---- commands: confirm, send, undo ----
function notify(text, err = false) {
  ui.bar = { kind: err ? 'err' : 'ok', text, until: Date.now() + 5000 };
  renderBar();
}
/** Ask before running a command, with this text (review R11/R13). */
function ask(cmd, text, label = '') {
  ui.confirm = { cmd, label, text, until: Date.now() + 15000 };
  renderBar();
}
async function send(cmd, label = '') {
  if (!ui.controller)
    return notify('View only — take control first (top bar)', true);
  if (needsConfirm(cmd) && ui.confirm?.cmd !== cmd)
    return ask(
      cmd,
      cmd.type === 'screens' && cmd.target === 'all'
        ? `${label} · ${previewAll(ui.state, cmd.patch).text.replace(/^[^→]*→ /, 'on ')}`
        : label || 'Change every screen',
      label,
    );
  ui.confirm = null;
  const r = await sync.request({ t: 'cmd', cmd });
  if (!r.ok) return notify(r.error || 'Not applied', true);
  const applied = (r.changed || [])
    .filter((c) => c !== 'session')
    .map((s) => `S${s}`);
  const skipped = (r.skipped || []).map((s) => `S${s}`);
  // Name the screens only for an All push; a single target is in the label.
  const all = cmd.target === 'all' || cmd.type === 'returnLive';
  ui.bar = {
    kind: 'undo',
    undoId: r.undoId,
    text: `${label || 'Applied'}${all && applied.length ? ` · ${applied.join(', ')}` : ''}${skipped.length ? ` · ${skipped.join(', ')} pinned, unchanged` : ''}`,
    until: Date.now() + 10000,
  };
  renderBar();
}
function setTarget(t) {
  ui.target = t;
  ss.set('target', t);
  renderTargets();
  renderPreview();
  renderContent(true);
  renderRail();
}
function setStation(id) {
  if (ui.station === id) return;
  ui.station = id;
  ss.set('station', id);
  document.body.classList.remove('rm-menu');
  swap();
  renderRail();
}
function pickDay(day) {
  ui.day = day;
  renderContent(true);
  renderRail();
}
/** Is an incident open (the operator's report or the trip data's)? */
function incidentOpen() {
  const t = tripById(ui.state?.session?.tripId);
  return Boolean(
    ui.state?.session?.report ||
    tripData(t)?.snapshot?.reported_incidents?.length,
  );
}
/** Live / Advance for the target; pinned screens stay as they are (R2). */
function setMode(mode) {
  const target = ui.target;
  const cmd = { type: 'screens', target, patch: { mode } };
  const label =
    mode === 'advance'
      ? `${target === 'all' ? 'All screens' : `S${target}`} → Advance`
      : `${target === 'all' ? 'All screens' : `S${target}`} → Live`;
  if (mode === 'advance' && incidentOpen()) {
    const p = target === 'all' ? previewAll(ui.state, cmd.patch) : null;
    return ask(
      cmd,
      `Incident open · Advance hides traveler positions on ${p ? p.applied.map((s) => `S${s}`).join(', ') : `S${target}`}${p?.pinned.length ? ` · ${p.pinned.map((s) => `S${s}`).join(', ')} pinned, stays as it is` : ''}`,
      label,
    );
  }
  send(cmd, label);
}
/** One command per action (R12): S5 → day plan for Day n; All → Advance. */
function showDay(day) {
  ui.day = day;
  const target = ui.target;
  if (target !== 'all')
    return send(
      { type: 'screens', target, patch: { role: 'day', day } },
      `S${target} → Day plan · Day ${day}`,
    );
  const cmd = {
    type: 'screens',
    target: 'all',
    patch: { mode: 'advance', day },
  };
  const p = previewAll(ui.state, cmd.patch);
  ask(
    cmd,
    `${incidentOpen() ? 'Incident open · traveler positions leave those walls · ' : ''}Advance · Day ${day} on ${p.applied.map((s) => `S${s}`).join(', ')}${p.pinned.length ? ` · ${p.pinned.map((s) => `S${s}`).join(', ')} pinned, stays as it is` : ''}`,
    `Advance · Day ${day} on all screens`,
  );
}
async function copyResponders(report) {
  const t = tripById(ui.state.session.tripId);
  const data = tripData(t);
  const people = data?.snapshot?.participants || [];
  const text = [
    `${t.title} — reported ${report.kind || 'incident'}, floor ${report.floor} (not verified)`,
    `Site: ${data?.snapshot?.trips?.[0]?.destination || ''}`,
    `Group: ${people.length} people (sample trip, fictional)`,
    'Floor estimates and who may still be inside: see the Incident & attention screen.',
  ].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    notify('Copied for responders (stays on this device)');
  } catch {
    notify('Copy failed — clipboard blocked', true);
  }
}

// ---- shell ----
const head = el('header', 'rm-head');
const grid = el('div', 'rm-body-grid');
const main = el('main', 'rm-main');
const targets = el('div', 'rm-targets');
targets.setAttribute('role', 'radiogroup');
targets.setAttribute('aria-label', 'Target screen');
const bar = el('div', 'rm-bar');
bar.hidden = true;
bar.setAttribute('role', 'status');
const stage = el('div', 'rm-stage');
const preview = el('section', 'rm-preview');
const content = el('section', 'rm-content');
content.setAttribute('aria-live', 'polite');
stage.append(preview, content);
main.append(targets, bar, stage);
const rail = el('aside', 'rm-rail');
rail.setAttribute('aria-label', 'Stations');
grid.append(main, rail);
const aperture = btn('rm-aperture', 'MENU', () =>
  document.body.classList.toggle('rm-menu'),
);
aperture.setAttribute('aria-controls', 'rm-rail');
rail.id = 'rm-rail';
app.append(head, grid, aperture);

function renderHead() {
  const t = tripById(ui.state?.session?.tripId);
  const plate = el('div', 'rm-plate');
  plate.append(
    el('span', 'mono', t.orgShort),
    el('span', 'org', `${t.org} · ${t.title}`),
  );
  const ctl = ui.presence?.remotes?.find((r) => r.controller && !r.you);
  const link = el(
    'div',
    `rm-link ${ui.link === 'online' ? (ui.controller ? 'ok' : 'warn') : 'warn'}`,
    ui.link !== 'online'
      ? 'Not connected · retrying'
      : ui.controller
        ? `In control · ${device}`
        : `View only · ${ctl ? `${ctl.name || 'another remote'} in control` : 'no remote in control'}`,
  );
  const extra = [];
  const ho = ui.presence?.handover;
  if (ui.link === 'online' && !ui.controller)
    extra.push(
      btn(
        'rm-btn',
        ui.presence?.anyController
          ? ho?.you
            ? 'Asked for control…'
            : 'Ask for control'
          : 'Take control',
        () => sync.send({ t: 'request-control' }),
      ),
    );
  // Never silent (R14): the controller sees who asks and decides.
  if (ui.controller && ho && !ho.you)
    extra.push(
      el('span', 'rm-link warn', `${ho.fromName} asks for control`),
      btn('rm-btn', 'Hand over', () =>
        sync.send({ t: 'handover', accept: true }),
      ),
      btn('rm-btn', 'Keep control', () =>
        sync.send({ t: 'handover', accept: false }),
      ),
    );
  head.replaceChildren(plate, link, ...extra, el('span', 'rm-seal', 'OP'));
}
function renderTargets() {
  if (!ui.state) return;
  const slots = Object.keys(ui.state.screens).map(Number);
  const items = [...slots, 'all'];
  targets.replaceChildren(el('span', 'k', 'TARGET'));
  for (const t of items) {
    const on = ui.target === t;
    const online = t === 'all' || ui.presence?.screens?.[t]?.online;
    const b = btn(
      `rm-target${online ? '' : ' off'}`,
      t === 'all' ? 'All' : `S${t}`,
      () => setTarget(t),
      {
        role: 'radio',
        'aria-checked': String(on),
        tabindex: on ? '0' : '-1',
        title:
          t === 'all'
            ? 'Every screen'
            : `${ROLES[ui.state.screens[t].role]?.label} · ${online ? 'online' : 'not connected'}`,
      },
    );
    b.addEventListener('keydown', (e) => {
      const i = items.indexOf(t);
      const d =
        e.key === 'ArrowRight' || e.key === 'ArrowDown'
          ? 1
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
            ? -1
            : 0;
      if (!d) return;
      e.preventDefault();
      setTarget(items[(i + d + items.length) % items.length]);
      targets.querySelector('[aria-checked="true"]')?.focus();
    });
    targets.append(b);
  }
}
function renderPreview() {
  if (!ui.state) return;
  const t = ui.target;
  const slot = t === 'all' ? Number(Object.keys(ui.state.screens)[0]) : t;
  const s = ui.state.screens[slot];
  const p = ui.presence?.screens?.[slot];
  const at = ui.thumbAt[slot];
  const age = at ? (Date.now() - at) / 1000 : null;
  preview.classList.toggle('stale', age != null && age > 15);
  const k = el(
    'div',
    'k',
    t === 'all' ? `PREVIEW · S${slot} (of all)` : `PREVIEW · S${slot}`,
  );
  const img = ui.thumbs[slot]
    ? Object.assign(el('img'), {
        src: ui.thumbs[slot],
        alt: `Screen ${slot} as it is now`,
      })
    : el(
        'div',
        'ph',
        p?.online ? 'Waiting for a snapshot' : 'Screen not connected',
      );
  if (img.tagName === 'IMG') img.dataset.thumb = String(slot);
  preview.replaceChildren(
    k,
    img,
    el(
      'div',
      'sum',
      s
        ? screenSummary(slot, s, {
            online: Boolean(p?.online),
            ageS: p?.lastSeen ? (Date.now() - p.lastSeen) / 1000 : null,
          })
        : '',
    ),
    ...(ui.local[slot]?.text
      ? [
          el(
            'div',
            `age${ui.local[slot].on ? ' hands' : ''}`,
            `At the wall: ${ui.local[slot].text}`,
          ),
        ]
      : []),
    el(
      'div',
      'age',
      age == null
        ? ''
        : age > 15
          ? `Snapshot ${Math.round(age)} s old · link may be down`
          : `Snapshot ${Math.round(age)} s ago`,
    ),
  );
}
function ctx() {
  return {
    ui,
    state: ui.state,
    presence: ui.presence,
    target: ui.target,
    thumbs: ui.thumbs,
    local: ui.local,
    sync,
    send,
    ask,
    notify,
    setTarget,
    setMode,
    pickDay,
    showDay,
    tripData,
    copyResponders,
  };
}
let contentKey = '';
function renderContent(force = false) {
  if (!ui.state) return;
  const st = STATIONS.find((s) => s.id === ui.station) || STATIONS[0];
  const key = JSON.stringify([
    st.id,
    ui.state.rev,
    ui.target,
    ui.day,
    ui.presence?.screens && Object.keys(ui.presence.screens).length,
  ]);
  if (!force && key === contentKey) return;
  contentKey = key;
  const scroll = content.scrollTop;
  const focusText = content.contains(document.activeElement)
    ? document.activeElement.textContent
    : null;
  const keepInputs = [...content.querySelectorAll('input, select')].map((i) => [
    i.getAttribute('aria-label'),
    i.value,
  ]);
  content.replaceChildren(...st.render(ctx()));
  for (const [label, value] of keepInputs) {
    const i = content.querySelector(
      `[aria-label="${CSS.escape(label || '')}"]`,
    );
    if (i && value) i.value = value;
  }
  content.scrollTop = scroll;
  if (focusText)
    [...content.querySelectorAll('button')]
      .find((b) => b.textContent === focusText)
      ?.focus();
}
function swap() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches)
    return renderContent(true);
  content.classList.add('sw-out');
  setTimeout(() => {
    content.classList.remove('sw-out');
    renderContent(true);
    content.scrollTop = 0;
    content.classList.add('sw-in');
    setTimeout(() => content.classList.remove('sw-in'), 340);
  }, 230);
}
function renderRail() {
  if (!ui.state) return;
  const st = STATIONS.find((s) => s.id === ui.station) || STATIONS[0];
  const h = el('div', 'r-head');
  h.append(
    'Stations',
    el('span', 'cnt', String(STATIONS.length).padStart(2, '0')),
  );
  const active = el('div', 'r-active');
  const k = el('div', 'k');
  const online = ui.link === 'online';
  k.append(
    'Active station',
    el('span', `st${online ? '' : ' warn'}`, online ? '● ONLINE' : '● OFFLINE'),
  );
  active.append(k, el('div', 'v', st.label), el('div', 's', st.sub));
  const list = el('div', 'r-context');
  if (st.context) list.append(...st.context(ctx()));
  const g = el('div', 'r-grid');
  const incidentOpen =
    Boolean(ui.state.session.report) && !ui.state.session.incidentAck;
  for (const s of STATIONS) {
    const t = btn(
      `rm-tile${s.later ? ' later' : ''}`,
      '',
      () => setStation(s.id),
      {
        'aria-label': `Station ${s.num}, ${s.label}${s.later ? ' (next phase)' : ''}`,
      },
    );
    if (s.id === ui.station) t.setAttribute('aria-current', 'true');
    t.innerHTML = s.icon;
    t.append(el('span', 'num', s.num), el('span', 'lab', s.label));
    if (s.id === 'incident' && incidentOpen)
      t.append(el('span', 'pill', 'OPEN'));
    g.append(t);
  }
  rail.replaceChildren(h, active, list, g);
}
function renderBar() {
  const b = ui.bar;
  // A confirm that nobody answers goes away after 15 s (R11).
  if (ui.confirm && Date.now() > ui.confirm.until) ui.confirm = null;
  if (ui.confirm) {
    bar.hidden = false;
    bar.className = 'rm-bar ask';
    bar.replaceChildren(
      el('span', 't', `Confirm: ${ui.confirm.text}`),
      btn('rm-btn primary', 'Confirm', () =>
        send(ui.confirm.cmd, ui.confirm.label),
      ),
      btn('rm-btn', 'Cancel', () => {
        ui.confirm = null;
        renderBar();
      }),
    );
    // Focus the new question once; the 1 s repaint must not steal focus.
    if (!ui.confirm.focused) {
      ui.confirm.focused = true;
      bar.querySelector('.primary')?.focus();
    }
    return;
  }
  if (!b || Date.now() > b.until) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.className = `rm-bar${b.kind === 'err' ? ' err' : ''}`;
  const left = Math.ceil((b.until - Date.now()) / 1000);
  bar.replaceChildren(el('span', 't', b.text));
  if (b.kind === 'undo')
    bar.append(
      btn('rm-btn', `Undo (${left} s)`, async () => {
        const r = await sync.request({ t: 'undo', undoId: b.undoId });
        ui.bar = null;
        notify(r.ok ? 'Undone' : r.error, !r.ok);
      }),
    );
}
function renderAll() {
  renderHead();
  renderTargets();
  renderPreview();
  renderRail();
  renderContent();
  renderBar();
}
function renderDenied(text) {
  app.replaceChildren(
    (() => {
      const d = el('div', 'rm-denied rm-content');
      d.append(
        el('h1', 'rm-title', 'Pair this remote'),
        el('div', 'rm-sub', 'Trip Twin · multi-view'),
        el('p', '', text),
        el(
          'p',
          'rm-note',
          'On the Trip Twin computer choose Multi-view, then scan the QR code with this device.',
        ),
      );
      return d;
    })(),
  );
}

// ---- connection ----
const sync = connectSync({
  kind: 'remote',
  setup: params.get('setup'),
  name: device,
  on: {
    welcome(m) {
      if (m.type === 'denied') return renderDenied(m.error);
      // The QR's setup code has done its job; the token rejoins from now on.
      if (params.has('setup')) {
        params.delete('setup');
        history.replaceState(null, '', `?${params}`);
      }
      ui.controller = Boolean(m.controller);
      ui.state = m.state;
      ui.presence = m.presence;
      ui.presence = m.presence;
      if (ui.target !== 'all' && !ui.state.screens[ui.target])
        ui.target = 'all';
      renderAll();
    },
    state(m) {
      ui.state = m.state;
      ui.presence = m.presence || ui.presence;
      ui.controller = Boolean(ui.presence?.youControl);
      if (ui.target !== 'all' && !ui.state.screens[ui.target]) setTarget('all');
      renderAll();
    },
    presence(m) {
      ui.presence = m.presence;
      ui.controller = Boolean(m.presence?.youControl);
      renderHead();
      renderTargets();
      renderPreview();
      renderRail();
      if (ui.station === 'screens') renderContent();
    },
    control(m) {
      if (m.granted) ui.controller = true;
      notify(
        m.granted
          ? 'You are in control'
          : 'Asked for control · the remote in control decides',
      );
      renderHead();
    },
    local(m) {
      ui.local[m.slot] = { on: m.on, text: m.text };
      renderPreview();
      if (ui.station === 'screens') renderContent(true);
      renderRail();
    },
    thumb(m) {
      ui.thumbs[m.slot] = m.data;
      ui.thumbAt[m.slot] = Date.now();
      // Swap images in place: no re-render, no lost scroll.
      for (const img of document.querySelectorAll(
        `img[data-thumb="${m.slot}"]`,
      ))
        img.src = m.data;
      const shown =
        ui.target === 'all'
          ? Number(Object.keys(ui.state?.screens || { 1: 0 })[0])
          : ui.target;
      if (m.slot === shown && !preview.querySelector('img')) renderPreview();
      if (
        ui.station === 'screens' &&
        !content.querySelector(`img[data-thumb="${m.slot}"]`)
      )
        renderContent(true);
    },
    status(s) {
      ui.link = s;
      if (ui.state) renderHead();
    },
  },
});
// Laptop keys: Alt+1–6 / Alt+A target, Esc cancels a confirm.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.confirm) {
    ui.confirm = null;
    return renderBar();
  }
  if (!e.altKey || !ui.state) return;
  if (/^[1-6]$/.test(e.key) && ui.state.screens[Number(e.key)])
    setTarget(Number(e.key));
  if (e.key === 'a' || e.key === 'A' || e.code === 'KeyA') setTarget('all');
});
setInterval(() => {
  renderBar();
  renderPreview();
}, 1000);
app.replaceChildren(head, grid, aperture);
head.append(el('span', 'rm-note', 'Connecting to the Trip Twin computer…'));
