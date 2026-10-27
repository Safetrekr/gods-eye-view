// Trip Twin remote (phase 10): the iPad / laptop that drives the wall.
// Right: the STATIONS rail. Left: the target picker (S1–S6 · All), a live
// snapshot of the target, then the station's controls. Every setting for
// the walls lives here; the walls are display only.
// Phase CF K8 (SUP-1, SUP-4, CL-11, Appendix D 1, 2d, 3): the status strip
// (the top bar) says who is in control and since when, "Log not writing"
// when the audit log stops, and that an out-of-date page sent nothing; the
// active-station card names the last change on the target and its device;
// result lines come from twinDescribe.js (a dry run of the reducer).
// Pairing and the screens list live in the rail foot's Screens & devices.
// data-tt-* hooks are for the harness (PHASE-CF-PLAN §3.2 c).
import './remote.css';
import './remote.instrument.css';
import { connectSync } from '../twinSync.js';
import { ROLES, screenSummary } from '../twinScreenRoles.js';
import { needsConfirm, previewAll } from '../twinSession.js';
import { DEMO_TRIPS, tripById, tripDays } from '../demoTrips.js';
import { tripTwinDemoSnapshot } from '../demoTripTwin.js';
import { siteConfig, sitesForCity } from '../twinSites.js';
import { approachNow, approachText } from '../twinNowcast.js';
import { createHazardLoad } from '../twinHazardLoad.js';
import {
  photoCredit,
  photoLines,
  photoTarget,
  photoUrl,
  pickPhoto,
  rankPhotos,
} from '../twinStreetPhotos.js';
import { createPhotoLoader } from '../twinStreetPhotoLoad.js';
import { cameraCredit, cameraName } from '../twinCameras.js';
import {
  assessFires,
  assessTropical,
  fireLines,
  hazardCoverage,
  hazardPicture,
  nearestFire,
  tropicalLines,
} from '../twinHazards.js';
import {
  loadAlertAreas,
  loadLightningNearest,
  loadNwsAlerts,
  regionOf,
  runNowcast,
  simNowcast,
  simulatedAlert,
} from '../twinNowcastLoad.js';
import {
  STATIONS,
  FOOT_STATIONS,
  attentionScreen,
  btn,
  stationOf,
} from './stations.js';
import { weatherPill } from '../twinStations.js';
import {
  STATUS,
  byText,
  controlText,
  describeChange,
  describeCommand,
  hhmm,
  lastChangeOf,
  metaPhrase,
  render,
  scopeLine,
} from '../twinDescribe.js';
import { DENY, VIA, pairPausedUntil } from '../twinProtocol.js';

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
  wx: null, // phase 12: the nowcast for the trip in focus (same as the walls)
  hz: null, // fire boundaries and hurricanes for the trip in focus (hazards H5)
  // K8: since when the link is down; the page is out of date (RELOAD);
  // the newest change seen per scope (slot or 'wall') and anywhere;
  // pairing's last answer and pause; an undo waiting for its broadcast.
  offlineSince: Date.now(),
  outOfDate: null,
  seen: {},
  seenAny: null,
  pair: null, // {text, err, until}
  awaitUndo: false,
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
  if (ui.outOfDate) return notify(STATUS.RELOAD_REMOTE, true);
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
  // What will change, from a dry run of the same reducer (SUP-1, G2).
  const before = ui.state;
  const r = await sync.request({ t: 'cmd', cmd });
  if (!r.ok) return notify(r.error || 'Not applied', true);
  const said = render(describeCommand(cmd, before), {
    audience: 'remote',
    names: personNames(),
  });
  ui.bar = {
    kind: 'undo',
    undoId: r.undoId,
    // Every end state says whether the wall changed (G1).
    text: said || `${label ? `${label} · ` : ''}nothing changed on the walls`,
    until: Date.now() + 10000,
  };
  renderBar();
}
/** Full names on this device only (the walls show their own forms). */
function personNames() {
  const data = tripData(tripById(ui.state?.session?.tripId));
  const snap = data?.snapshot;
  return {
    person: (id) =>
      (snap?.participants || []).find((p) => p.id === id)?.name || null,
    place: (id) => {
      for (const d of data?.days || [])
        for (const st of d.sites || [])
          for (const p of st.places || []) if (p.id === id) return p.label;
      return null;
    },
  };
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
  // The rail's tiles arrive as a wavefront on a station change (phase 11).
  rail.classList.add('rm-wave');
  clearTimeout(waveTimer);
  waveTimer = setTimeout(() => rail.classList.remove('rm-wave'), 900);
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
    `Floor estimates and who may still be inside: see ${attentionScreen(ui.state)}.`,
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
head.dataset.ttStatus = '';
const targets = el('div', 'rm-targets');
targets.setAttribute('role', 'radiogroup');
targets.setAttribute('aria-label', 'Target screen');
const bar = el('div', 'rm-bar');
bar.hidden = true;
bar.setAttribute('role', 'status');
bar.dataset.ttBar = '';
const stage = el('div', 'rm-stage');
const preview = el('section', 'rm-preview');
const content = el('section', 'rm-content');
content.setAttribute('aria-live', 'polite');
stage.append(preview, content);
main.append(targets, bar, stage);
const rail = el('aside', 'rm-rail');
rail.dataset.ttRail = '';
let waveTimer = null;
// This remote's own animation (its device, its choice); reduced motion wins.
const remoteMotion = () => {
  try {
    return localStorage.getItem('tripTwin.remote.motion') !== '0';
  } catch {
    return true;
  }
};
const applyRemoteMotion = () =>
  document.body.classList.toggle(
    'rm-m-cine',
    remoteMotion() && !matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
applyRemoteMotion();
rail.setAttribute('aria-label', 'Stations');
grid.append(main, rail);
const aperture = btn('rm-aperture', 'MENU', () =>
  document.body.classList.toggle('rm-menu'),
);
aperture.setAttribute('aria-controls', 'rm-rail');
aperture.dataset.ttAperture = '';
rail.id = 'rm-rail';
app.append(head, grid, aperture);

function renderHead() {
  const t = tripById(ui.state?.session?.tripId);
  const plate = el('div', 'rm-plate');
  // The SafeTrekr shield leads the remote too (review/shell R2-4).
  const brand = el('span', 'rm-brand');
  const logo = document.createElement('img');
  logo.src = '/safetrekr-logo.svg';
  logo.alt = 'SafeTrekr';
  logo.width = 89;
  logo.height = 16;
  brand.append(logo);
  plate.append(
    brand,
    el('span', 'mono', t.orgShort),
    el('span', 'org', `${t.title} · ${t.org}`),
  );
  // The control cell (K8, SUP-4): who is in control, and since when.
  const ctl = ui.presence?.remotes?.find((r) => r.controller && !r.you);
  const me = ui.presence?.remotes?.find((r) => r.you);
  const online = ui.link === 'online';
  const link = el(
    'div',
    `rm-link ${online ? (ui.controller ? 'ok' : 'warn') : 'warn'}`,
    controlText({
      link: ui.link,
      offlineMs: online ? 0 : Date.now() - ui.offlineSince,
      host: location.host,
      controller: ui.controller,
      me: me?.name || device,
      ctl: ctl ? ctl.name || 'another remote' : null,
      since: ctl?.controlSince,
    }),
  );
  link.dataset.ttControl = ui.controller ? 'in-control' : 'view-only';
  // Status items (Appendix D 1, 3): steel, the log in dim amber text.
  const items = [];
  if (ui.outOfDate) {
    const o = el('span', 'rm-status err', STATUS.RELOAD_REMOTE);
    o.dataset.ttStatusItem = 'reload';
    items.push(
      o,
      btn('rm-btn', STATUS.RELOAD, () => location.reload(), {
        'data-tt-reload': '',
      }),
    );
  }
  if (online && ui.presence?.health && ui.presence.health.audit === false) {
    const l = el('span', 'rm-status attn', STATUS.LOG);
    l.dataset.ttStatusItem = 'log';
    items.push(l);
  }
  const extra = [];
  const ho = ui.presence?.handover;
  if (online && !ui.controller && !ui.outOfDate)
    extra.push(
      btn(
        'rm-btn',
        ui.presence?.anyController
          ? ho?.you
            ? 'Asked for control…'
            : 'Ask for control'
          : 'Take control',
        () => sync.send({ t: 'request-control' }),
        { 'data-tt-ask-control': '' },
      ),
    );
  // Never silent (R14): the controller sees who asks and decides.
  if (ui.controller && ho && !ho.you)
    extra.push(
      el('span', 'rm-link warn', `${ho.fromName} asks for control`),
      btn(
        'rm-btn',
        'Hand over',
        () => sync.send({ t: 'handover', accept: true }),
        { 'data-tt-handover': 'accept' },
      ),
      btn(
        'rm-btn',
        'Keep control',
        () => sync.send({ t: 'handover', accept: false }),
        { 'data-tt-handover': 'keep' },
      ),
    );
  // Out of date before any presence: who is in control is not known here.
  head.replaceChildren(
    plate,
    ...(ui.outOfDate && !ui.presence ? [] : [link]),
    ...items,
    ...extra,
    el('span', 'rm-seal', 'OP'),
  );
  // Write controls dim while this remote only views (F20).
  document.body.classList.toggle('rm-viewonly', !ui.controller);
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
        'data-tt-target': String(t),
        title:
          t === 'all'
            ? 'Every screen'
            : `${ROLES[ui.state.screens[t].role]?.label} · ${online ? 'online' : 'not connected'}`,
      },
    );
    if (t !== 'all')
      b.append(
        el(
          'small',
          '',
          (ROLES[ui.state.screens[t].role] || ROLES.site).kicker.split(' ')[0],
        ),
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
  // The role and badge sit in a strip above the snapshot, never over the
  // wall's own header (F7).
  const strip = el('div', 'strip');
  strip.append(
    k,
    el('span', 'role', s ? (ROLES[s.role] || ROLES.site).kicker : ''),
    el(
      'span',
      'ovb',
      s?.mode === 'advance'
        ? `ADVANCE${s.day ? ` · DAY ${s.day}` : ''}`
        : s?.role === 'day'
          ? 'PLAN'
          : 'LIVE',
    ),
  );
  preview.replaceChildren(
    strip,
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
    /** Send a traffic camera to a wall (Jesse, 27 Oct), or stop it. */
    sendCamera: (c) => sync.send({ t: 'camera', ...c }),
    ask,
    notify,
    setTarget,
    setMode,
    pickDay,
    showDay,
    tripData,
    copyResponders,
    wxRefresh: () => refreshWx(true),
    /** Pair a screen by its code (Screens & devices; SUP-5 copy). */
    async pairScreen(code, slot) {
      if (ui.outOfDate) return notify(STATUS.RELOAD_REMOTE, true);
      const r = await sync.request({ t: 'pair', code, slot });
      ui.pair = r.ok
        ? {
            text: `Paired S${r.slot} · it shows S${r.slot}'s role now`,
            err: false,
          }
        : { text: r.error, err: true, until: pairPausedUntil(r.error) };
      notify(ui.pair.text, !r.ok);
      renderContent(true);
    },
    /** Who last changed a screen, when it was not this remote (SUP-4). */
    lastBy(slot) {
      const myRef = ui.presence?.remotes?.find((r) => r.you)?.ref ?? null;
      const seen = ui.seen[slot];
      const meta = lastChangeOf(
        { session: {}, screens: { [slot]: ui.state?.screens?.[slot] } },
        slot,
      );
      const ref =
        seen && (!meta || seen.rev >= meta.rev) ? seen.byRef : meta?.ref;
      if (!ref || ref === myRef) return null;
      return byText(ref, ui.presence?.actors);
    },
    remoteMotion,
    setRemoteMotion(on) {
      try {
        localStorage.setItem('tripTwin.remote.motion', on ? '1' : '0');
      } catch {
        /* ignore */
      }
      applyRemoteMotion();
      renderContent(true);
    },
  };
}
let contentKey = '';
function renderContent(force = false) {
  if (!ui.state) return;
  const st = stationOf(ui.station);
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
  // Information never waits for motion (05 P1): the new content lands at
  // once; only the fog-in plays, and only with this remote's animation on.
  renderContent(true);
  content.scrollTop = 0;
  if (!document.body.classList.contains('rm-m-cine')) return;
  content.classList.remove('sw-in');
  void content.offsetWidth;
  content.classList.add('sw-in');
  setTimeout(() => content.classList.remove('sw-in'), 340);
}
/** A report open on a trip that is not in focus (S6 shows it; so must we). */
function otherTripIncident() {
  const id = ui.state?.session?.tripId;
  return DEMO_TRIPS.some(
    (x) => x.id !== id && tripData(x)?.snapshot?.reported_incidents?.length,
  );
}
/** The target's card for the rail when a station has no list (F19). */
function targetCard() {
  const t = ui.target;
  const c = el('div', 'r-card');
  if (t === 'all') {
    c.append(
      el('div', 'k', 'TARGET · ALL SCREENS'),
      el('div', 'v', `${Object.keys(ui.state.screens).length} screens`),
      el('div', 's', 'Pinned screens are left as they are'),
    );
    return c;
  }
  const s = ui.state.screens[t];
  const p = ui.presence?.screens?.[t];
  const role = ROLES[s?.role] || ROLES.site;
  const m = s?.motion || {};
  const tiers =
    ['live', 'event', 'cine']
      .filter((k) => m[k] !== false)
      .map((k) => (k === 'cine' ? 'cinematic' : k))
      .join(' · ') || 'none';
  const local = ui.local[t]?.text;
  c.append(
    el('div', 'k', `TARGET · S${t}`),
    el('div', 'v', role.label),
    el(
      'div',
      's',
      `${s?.mode === 'advance' ? `Advance${s.day ? ` · Day ${s.day}` : ''}` : 'Live'}${s?.pinned ? ' · pinned' : ''}`,
    ),
    el('div', 's', `Motion: ${tiers}`),
    el(
      'div',
      's',
      p?.online
        ? `Link · ${p.lastSeen ? `${Math.round((Date.now() - p.lastSeen) / 1000)} s ago` : 'now'}`
        : 'Not connected',
    ),
    ...(local ? [el('div', 's', `At the wall: ${local}`)] : []),
  );
  return c;
}
// ---- phase 12: see it coming, computed here from the same sources ----
// Real radar every 3 min (never replaced by the demo); the demo storm is
// computed here on top; every 20 s the arrival counts down from now.
let wxSeq = 0;
let wxKey = '';
let wxAt = 0;
let wxReal = null; // {nc, alerts, alertsAt, ltg}
// Fire boundaries and hurricanes for the trip in focus (review/hazards H5):
// the same feeds, rules and demos as the walls, so the words agree.
let hzLoad = null;
let hzAbort = null;
let hzWhere = '';
const llOf = (p) => ({ lat: p.lat, lon: p.lon ?? p.lng });
/**
 * The walls' own check: the site shown, the trip's other stops, demos at
 * the trip's hotel (hazards X18). People stay on the walls: the remote
 * holds no positions.
 */
function updateHazards(center, ss, trip, siteKey) {
  const sites = sitesForCity(trip.city);
  const hotel = llOf(sites[0]?.center || center);
  const key = `${trip.id}`;
  if (key !== hzWhere) {
    hzAbort?.abort();
    hzAbort = new AbortController();
    hzWhere = key;
    hzLoad = createHazardLoad({
      center: hotel,
      signal: hzAbort.signal,
      onChange: () => hazardsNow(),
    });
  }
  hzCtx = {
    center,
    stops: sites
      .filter((s2) => s2.key !== siteKey)
      .map((s2) => ({
        label: s2.short,
        ...llOf(s2.anchors?.inside || s2.center),
      })),
    people: [],
  };
  hzLoad.setSim('fire', ss.simFire || null);
  hzLoad.setSim('cyclone', ss.simCyclone || null);
  hazardsNow();
}
let hzCtx = null;
function hazardsNow() {
  if (!hzLoad || !hzCtx) return;
  const now = Date.now();
  const d = hzLoad.data(now);
  const c = hzCtx;
  const center = c.center;
  const pic = hazardPicture({
    fires: assessFires(d.rows, c, now),
    tropical: assessTropical(d.storms, c),
    coverage: hazardCoverage(center),
    firesFeed: d.firesFeed,
    tropicalFeed: d.tropicalFeed,
    storms: d.realStorms,
    nearest: nearestFire(d.realRows, center),
    now,
    demo: d.demo,
  });
  ui.hz = {
    pic,
    coverage: hazardCoverage(center),
    fire: pic.fires.slice(0, 2).flatMap((f) => fireLines(f)),
    tropical: pic.tropical.slice(0, 2).flatMap((t) => tropicalLines(t, now)),
    advisories: pic.tropical
      .filter((t) => t.storm.advisoryUrl)
      .map((t) => ({ title: t.title, url: t.storm.advisoryUrl })),
  };
  if (ui.station === 'weather') renderContent(true);
}

// Street photo of the hotel (review/street-photos P5): what S1 shows, with
// the session's kept photo. Read-only here: picks are made at the All-in-one.
let photoLoad = null;
function updatePhoto() {
  const ss = ui.state?.session;
  if (!ss) return;
  const trip = tripById(ss.tripId);
  const hotel = sitesForCity(trip.city)[0];
  if (!hotel) return;
  photoLoad ??= createPhotoLoader({ onChange: () => updatePhoto() });
  const target = photoTarget({ kind: 'hotel', site: hotel });
  photoLoad.want(target);
  const search = photoLoad.get(target);
  const kept = ss.photos?.[`${ss.tripId}|${target.key}`] || null;
  const pick = pickPhoto(
    rankPhotos(search?.items || [], target, { keep: kept }),
    target,
    kept,
  );
  ui.photo = {
    name: hotel.short || hotel.label,
    // The walls' default unit (every-time P2-4).
    lines: photoLines({
      search,
      pick,
      target,
      now: Date.now(),
      unit: hotel.timezone?.startsWith('America') ? 'ft' : 'm',
    }),
    url: photoUrl(pick, 480),
    kept,
    pick,
    credit: photoCredit(pick.photo),
  };
  if (ui.station === 'site') renderContent(true);
}

// The traffic camera on the walls (review/traffic-cameras round 1): its
// name and credit for the Site and Incident stations, and a refresh of the
// still and the minutes left every 30 s while one is up.
let camKey = '';
async function updateCamera() {
  const ss = ui.state?.session;
  updateCameraList(ss);
  const sc = ss?.camera;
  if (!sc) {
    ui.camera = null;
    ui.cameraFrame = null;
    camKey = '';
    return;
  }
  const key = `${sc.place}|${sc.id}|${sc.at}`;
  if (key === camKey) return;
  camKey = key;
  // The old camera's still never shows under the new one's name.
  ui.cameraFrame = null;
  pullCameraFrame();
  const trip = tripById(ss.tripId);
  const siteKey = String(sc.place).split(':')[1];
  const site = sitesForCity(trip.city).find((x) => x.key === siteKey);
  if (!site) return;
  try {
    const res = await fetch(
      `/api/twin-cameras/near?lat=${site.center.lat}&lon=${site.center.lon ?? site.center.lng}&r=1000`,
    );
    const json = await res.json();
    const c = (json.cameras || []).find((x) => x.id === sc.id);
    ui.camera = c
      ? { name: cameraName(c.name), credit: cameraCredit(c) }
      : null;
  } catch {
    ui.camera = null;
  }
  if (['site', 'incident'].includes(ui.station)) renderContent(true);
}
/** The still as the walls get it: dimmed and dated when held over. */
let camUrl = null;
async function pullCameraFrame() {
  const sc = ui.state?.session?.camera;
  if (!sc) {
    ui.cameraFrame = null;
    return;
  }
  const want = `${sc.id}|${sc.at}`;
  try {
    const res = await fetch(
      `/api/twin-cameras/frame?id=${encodeURIComponent(sc.id)}&t=${Date.now()}`,
    );
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const now = ui.state?.session?.camera;
    if (!now || `${now.id}|${now.at}` !== want) return;
    const url = URL.createObjectURL(blob);
    if (camUrl) URL.revokeObjectURL(camUrl);
    camUrl = url;
    ui.cameraFrame = {
      url,
      fetchedAt: Number(res.headers.get('x-twin-fetched')) || Date.now(),
      stale: res.headers.get('x-twin-stale') === '1',
    };
  } catch {
    ui.cameraFrame = ui.cameraFrame
      ? { ...ui.cameraFrame, stale: true }
      : { failed: true };
  }
  if (['site', 'incident'].includes(ui.station)) renderContent(true);
}
setInterval(() => {
  updateCamera();
  pullCameraFrame();
}, 30e3);
/**
 * The cameras near the site on screen, for sending from the remote: the
 * hotel or a stop, or the Incident wall while a report is open there.
 */
let listKey = '';
async function updateCameraList(ss) {
  if (!ss?.tripId) return;
  const trip = tripById(ss.tripId);
  const sites = sitesForCity(trip.city);
  const site = sites.find((x) => x.key === ss.siteKey) || sites[0];
  if (!site) return;
  const incident = Boolean(ss.report);
  const kind = incident
    ? 'incident'
    : site.key === sites[0].key
      ? 'hotel'
      : 'stop';
  const role = incident ? 'incident' : kind === 'hotel' ? 'site' : 'day';
  const key = `${ss.tripId}|${kind}:${site.key}`;
  if (key === listKey) return;
  listKey = key;
  try {
    const res = await fetch(
      `/api/twin-cameras/near?lat=${site.center.lat}&lon=${site.center.lon ?? site.center.lng}&r=${incident ? 1000 : 500}`,
    );
    const json = await res.json();
    ui.cameraList = {
      place: `${kind}:${site.key}`,
      role,
      tripId: ss.tripId,
      cameras: (json.cameras || []).slice(0, 3).map((c) => ({
        id: c.id,
        name: cameraName(c.name),
        d: c.d,
      })),
    };
  } catch {
    ui.cameraList = null;
    listKey = '';
  }
  if (['site', 'incident'].includes(ui.station)) renderContent(true);
}

async function refreshWx(force = false) {
  const ss = ui.state?.session;
  if (!ss) return;
  const t = tripById(ss.tripId);
  const site = siteConfig(ss.siteKey || t.city) || siteConfig(t.city);
  if (!site) return;
  const key = `${t.id}:${site.key}`;
  const center = {
    lat: site.center.lat,
    lon: site.center.lon ?? site.center.lng,
  };
  const region = regionOf(site.timezone);
  const us = region === 'us';
  updateHazards(center, ss, t, site.key);
  updatePhoto();
  updateCamera();
  if (ui.state?.session?.camera && !ui.cameraFrame) pullCameraFrame();
  if (force || key !== wxKey || Date.now() - wxAt > 180e3) {
    if (key !== wxKey) wxReal = null;
    wxKey = key;
    wxAt = Date.now();
    const seq = ++wxSeq;
    const [nc, alerts, ltg] = await Promise.all([
      runNowcast({ center, region }).catch(() => null),
      us
        ? loadNwsAlerts(center)
            .then((list) => loadAlertAreas(list, center))
            .catch(() => 'unavailable')
        : Promise.resolve([]),
      loadLightningNearest(region, center).catch(() => 'unavailable'),
    ]);
    if (seq !== wxSeq) return;
    wxReal = { nc, alerts, alertsAt: Date.now(), ltg };
  }
  if (!wxReal) return;
  const { nc, alerts, alertsAt, ltg } = wxReal;
  const dist = (m) =>
    us
      ? `${(m / 1609.344).toFixed(1)} mi`
      : m < 1000
        ? `${Math.round(m)} m`
        : `${(m / 1000).toFixed(1)} km`;
  const speed = (k) =>
    us ? `${Math.round(k / 1.609)} mph` : `${Math.round(k)} km/h`;
  const clock = (ms) =>
    ms
      ? new Date(ms).toLocaleTimeString('en-US', {
          timeZone: site.timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZoneName: 'short',
        })
      : '';
  // "20:21 CDT, 3 min ago" / "21:35 CDT, in 1 h 13 min".
  const ago = (ms) => {
    const m = Math.round((Date.now() - ms) / 60e3);
    if (m >= 0) return `${clock(ms)}, ${m} min ago`;
    const h = Math.floor(-m / 60);
    return `${clock(ms)}, in ${h ? `${h} h ` : ''}${-m % 60} min`;
  };
  const noun = site.kind === 'lodging' ? 'hotel' : 'venue';
  const SIM_MAX = 45 * 60e3;
  const simOn = Boolean(ss.simStorm) && Date.now() - ss.simStorm < SIM_MAX;
  const sim = simOn ? simNowcast({ center, simStart: ss.simStorm }) : null;
  const lineOf = (r) => {
    if (!r || r.status !== 'live') {
      const tx = `Storm approach unavailable · the ${r?.source || 'radar'} frame did not load`;
      return {
        status: 'unavailable',
        level: 'info',
        lead: '',
        claim: tx,
        detail: '',
        text: tx,
        short: '',
      };
    }
    const age = r.simulated ? 0 : (Date.now() - r.frameAt) / 60e3;
    const ap = r.simulated ? r.ap : approachNow(r.apFrame || r.ap, age);
    return {
      ...approachText(ap, {
        dist,
        speed,
        siteNoun: noun,
        frame: clock(r.frameAt),
        frameAge: r.simulated ? null : age,
        source: r.source,
        simulated: r.simulated,
        positionOnly: r.positionOnly,
        unmeasured: r.motion?.unmeasured,
        boxText: us ? '50 mi' : '80 km',
        nearText: us ? '6 mi' : '10 km',
      }),
      overMin: ap.overMin,
      nearMin: ap.nearMin,
    };
  };
  const text = lineOf(sim || nc);
  const realText = sim ? lineOf(nc) : null;
  const lines = [];
  if (sim) {
    const a = simulatedAlert(center, Date.now(), ss.simStorm);
    lines.push({
      text: `SIMULATED (demo) · ${a.event} · until ${ago(Date.parse(a.ends))}${a.inside ? ` · the ${noun} is inside the area` : ''}`,
      sim: true,
    });
  }
  if (alerts === 'unavailable')
    lines.push({
      text: 'NWS alerts unavailable right now · not checked',
      warn: true,
    });
  else if (us && !alerts.length)
    lines.push({
      // Under the demo the real check is a note, as on the walls (S4).
      text: lines.some((l) => l.sim)
        ? `Real NWS under the demo: no active alerts returned · checked ${ago(alertsAt)}`
        : `NWS checked ${ago(alertsAt)}: no active alerts returned for this point`,
    });
  else if (!us)
    lines.push({
      text: 'MeteoAlarm alerts are on the walls (no area shapes in Europe)',
    });
  for (const a of Array.isArray(alerts) ? alerts : [])
    lines.push({
      official: true,
      text: `NWS: ${a.event}${a.ends ? ` · until ${ago(Date.parse(a.ends))}` : ''}${a.inside ? ` · the ${noun} is inside the area` : ''}`,
    });
  let ltgText = '';
  if (sim?.strikes?.length)
    ltgText = 'SIMULATED lightning rides with the storm (on the walls)';
  else if (ltg === 'unavailable')
    ltgText = 'Lightning grid unavailable right now';
  else if (ltg)
    ltgText = `Lightning · nearest grid cell ${dist(ltg.distKm * 1000)} ${ltg.dir}${ltg.distKm <= 10 ? ` · inside ${us ? '6 mi' : '10 km'}` : ''} · ${ltg.source} 15-min density, fetched ${ago(ltg.at)}`;
  else
    ltgText = `Lightning · none within ${us ? '25 mi' : '40 km'} in the latest grid`;
  ui.wx = {
    text,
    realText,
    lines,
    ltgText,
    sim: Boolean(sim),
    clock,
    site,
    frameAt: (sim || nc)?.frameAt,
    motion: (sim || nc)?.motion,
    positionOnly: !sim && nc?.positionOnly,
  };
  renderRail();
  if (ui.station === 'weather') renderContent(true);
}
function renderRail() {
  if (!ui.state) return;
  const st = stationOf(ui.station);
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
    el('span', `st${online ? '' : ' warn'}`, online ? '● LIVE' : '● OFFLINE'),
  );
  active.dataset.ttActive = st.id;
  active.append(k, el('div', 'v', st.label), el('div', 's', st.sub));
  // The last change on the target, and which device made it (SUP-4).
  const last = lastChangeLine();
  if (last) {
    const l = el('div', 's last', last);
    l.dataset.ttLastChange = '';
    active.append(l);
  }
  const list = el('div', 'r-context');
  if (st.context) list.append(...st.context(ctx()));
  else list.append(targetCard());
  const g = el('div', 'r-grid');
  // Same rules as the All-in-one (review/shell X1, X4): 03 carries the
  // trip in focus only (the operator's report or its own data, acknowledged
  // or not); another trip's report lights 06 Trips on watch.
  const focusIncident = incidentOpen();
  const otherIncident = otherTripIncident();
  document.body.classList.toggle('rm-alert', focusIncident || otherIncident);
  const wxT = ui.wx?.text;
  for (const s of STATIONS) {
    const t = btn(
      `rm-tile${s.later ? ' later' : ''}`,
      '',
      () => setStation(s.id),
      {
        'aria-label': `Station ${s.num}, ${s.label}${s.later ? ' (next phase)' : ''}`,
        'data-tt-station': s.id,
      },
    );
    if (s.id === ui.station) t.setAttribute('aria-current', 'true');
    t.innerHTML = s.icon;
    t.style.setProperty(
      '--rd',
      `${(STATIONS.length - 1 - STATIONS.indexOf(s)) * 0.05}s`,
    );
    t.append(el('span', 'num', s.num), el('span', 'lab', s.label));
    if (s.id === 'incident' && focusIncident)
      t.append(el('span', 'pill', 'REPORTED'));
    if (s.id === 'trips' && otherIncident)
      t.append(el('span', 'pill', 'REPORTED'));
    // A core on its way to the site shows on the Weather tile (amber).
    // Same order as the All-in-one: an official warning, the demo
    // warning, then the storm's time pill (review/shell R2-4).
    const lines = ui.wx?.lines || [];
    const pill =
      s.id !== 'weather'
        ? ''
        : lines.some((l) => l.official)
          ? 'WARNING'
          : lines.some((l) => l.sim)
            ? 'SIM WARNING'
            : weatherPill(
                wxT,
                ui.wx?.sim,
                regionOf(ui.wx?.site?.timezone) === 'us',
              );
    if (pill)
      t.append(
        el(
          'span',
          `pill ${/WARNING/.test(pill) || wxT?.level === 'attention' ? 'attn' : 'watch'}`,
          pill,
        ),
      );
    g.append(t);
  }
  // Screens is reached from the rail foot (shell step C, 23 Oct 2026).
  const foot = el('div', 'r-foot');
  for (const s of FOOT_STATIONS) {
    const b = btn('rm-foot-btn', s.label, () => setStation(s.id), {
      'aria-label': `${s.label} · ${s.sub}`,
      'data-tt-station': s.id,
    });
    if (s.id === ui.station) b.setAttribute('aria-current', 'true');
    foot.append(b);
  }
  foot.dataset.ttFoot = '';
  rail.replaceChildren(h, active, list, g, foot);
}
/**
 * "Last change on S4 · 21:32 · radar on · by Laptop": the newest change on
 * the target (or anywhere, for All) that this remote saw arrive, else the
 * state's field meta (a page opened after it).
 */
function lastChangeLine() {
  if (!ui.state) return '';
  const t = ui.target;
  const pick = (a, b) => (!a ? b : !b ? a : b.rev > a.rev ? b : a);
  const seen = t === 'all' ? ui.seenAny : pick(ui.seen[t], ui.seen.wall);
  const meta = lastChangeOf(ui.state, t === 'all' ? null : t);
  if (seen && (!meta || seen.rev >= meta.rev))
    return seen.on
      ? `Last change on ${seen.on} · ${hhmm(seen.at)} · ${seen.text} · by ${seen.byName}`
      : `Last change · ${hhmm(seen.at)} · ${seen.text} · by ${seen.byName}`;
  if (!meta) return '';
  const on = meta.scope === 'wall' ? 'every screen' : `S${meta.scope}`;
  const what = metaPhrase(ui.state, meta, { names: personNames() });
  return `Last change on ${on} · ${hhmm(meta.at)} · ${what} · by ${byText(meta.ref, ui.presence?.actors)}`;
}
/** Remember a change from a state broadcast, per scope (K8). */
function noteChange(prev, m) {
  if (!prev || !m.by) return;
  const at = Date.now();
  const c = describeChange(prev, m.state, m, at);
  if (!c) return;
  const byName = byText(m.by, ui.presence?.actors);
  const o = { names: personNames() };
  const slots = new Set([
    ...c.parts.map((p) => p.scope).filter((x) => x !== 'wall'),
    ...c.pinned,
  ]);
  for (const slot of slots) {
    const line = scopeLine(c, slot, o);
    if (line)
      ui.seen[slot] = { ...line, at, rev: c.rev, byName, byRef: m.by.ref };
  }
  if (c.parts.some((p) => p.scope === 'wall') || c.returnAll)
    ui.seen.wall = {
      on: 'every screen',
      text: scopeLine(c, null, o)?.text || '',
      at,
      rev: c.rev,
      byName,
      byRef: m.by.ref,
    };
  const all = render(c, { audience: 'remote', ...o });
  ui.seenAny = {
    on: null,
    text: all,
    at,
    rev: c.rev,
    byName,
    byRef: m.by.ref,
  };
  if (ui.awaitUndo && m.cause === 'undo') {
    ui.awaitUndo = false;
    notify(render(c, { audience: 'remote', ...o }));
  }
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
      btn(
        'rm-btn primary',
        'Confirm',
        () => send(ui.confirm.cmd, ui.confirm.label),
        { 'data-tt-confirm': 'yes' },
      ),
      btn(
        'rm-btn',
        'Cancel',
        () => {
          ui.confirm = null;
          renderBar();
        },
        { 'data-tt-confirm': 'no' },
      ),
    );
    // Focus the new question once; the 1 s repaint must not steal focus.
    // The bar also scrolls into view, so a question is never off screen.
    if (!ui.confirm.focused) {
      ui.confirm.focused = true;
      bar.scrollIntoView?.({ block: 'nearest' });
      bar.querySelector('.primary')?.focus();
    }
    return;
  }
  // Out of date: nothing is sent until the page reloads (Appendix D 1).
  if (ui.outOfDate) {
    bar.hidden = false;
    bar.className = 'rm-bar err';
    bar.dataset.ttBar = 'reload';
    bar.replaceChildren(
      el('span', 't', STATUS.RELOAD_REMOTE),
      btn('rm-btn', STATUS.RELOAD, () => location.reload()),
    );
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
      btn(
        'rm-btn',
        `Undo (${left} s)`,
        async () => {
          ui.awaitUndo = true;
          const r = await sync.request({ t: 'undo', undoId: b.undoId });
          ui.bar = null;
          // The words come with the undone state (what really went back).
          if (!r.ok) {
            ui.awaitUndo = false;
            notify(r.error, true);
          } else if (ui.awaitUndo) notify('Undone');
        },
        { 'data-tt-undo': '' },
      ),
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
      // Out of date (RELOAD, Appendix D 1): keep the page, send nothing.
      if (m.type === 'denied' && m.code === DENY.RELOAD) {
        ui.outOfDate = { at: Date.now() };
        renderHead();
        return renderBar();
      }
      if (m.type === 'denied') return renderDenied(m.error);
      ui.outOfDate = null;
      // The QR's setup code has done its job; the token rejoins from now on.
      if (params.has('setup')) {
        params.delete('setup');
        history.replaceState(null, '', `?${params}`);
      }
      ui.controller = Boolean(m.controller);
      ui.state = m.state;
      setTimeout(() => refreshWx(true), 0);
      ui.presence = m.presence;
      ui.presence = m.presence;
      if (ui.target !== 'all' && !ui.state.screens[ui.target])
        ui.target = 'all';
      renderAll();
    },
    state(m) {
      noteChange(ui.state, m);
      ui.state = m.state;
      // A change made at a wall (its L / D sheet) is named here (D5),
      // never over a live Undo. The words are the describer's (K8).
      const undoLive = ui.bar?.kind === 'undo' && ui.bar.until > Date.now();
      const atWall = m.by?.via === VIA.KEYBOARD && m.by.slot;
      if (atWall && !undoLive)
        notify(
          `S${m.by.slot} · ${ui.seen[m.by.slot]?.text || 'display changed'} · set at the screen`,
        );
      setTimeout(() => refreshWx(), 0);
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
      if (s !== 'online' && ui.link === 'online') ui.offlineSince = Date.now();
      ui.link = s;
      if (ui.state || ui.outOfDate) renderHead();
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
  // "Can't reach … · retrying" after 15 s offline (Appendix D 2d).
  if (ui.link !== 'online' && (ui.state || ui.outOfDate)) renderHead();
  // The Pair button counts down a pairing pause, then comes back.
  if (ui.pair?.until && ui.station === 'screens') {
    if (Date.now() >= ui.pair.until) ui.pair = { ...ui.pair, until: null };
    renderContent(true);
  }
}, 1000);
setInterval(() => refreshWx(), 20e3);
app.replaceChildren(head, grid, aperture);
head.append(el('span', 'rm-note', 'Connecting to the Trip Twin computer…'));
