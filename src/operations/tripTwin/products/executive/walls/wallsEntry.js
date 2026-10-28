// SafeTrekr Executive B3: a wall (twin-executive.html?view=screen&slot=N).
// EP-51's path, in order:
//   1. the WebSocket tap goes in (tap.js);
//   2. ?freeze is set, so page.js feeds its demo snapshot once only;
//   3. page.js is imported, unchanged: the wall frame, pairing, the
//      session role (site for MAIN and Principal, trips for the flat walls);
//   4. the executive overlay draws on top, keyed on body[data-ex-role],
//      from the relay's loop messages: {t:'loop-role'} names the wall's
//      executive role, {t:'loop'} carries selectMain (MAIN) or the loop
//      and its map data (the others), {t:'loop-clock'} the sample clock.
import '../executive.css';
import '../record/record.css';
import { EXEC_ROLE_ORDER } from '../host/execProtocol.js';
import { dtg, localTime, lz, watchTime } from '../format.js';
import { ACTIVE_CITIES, beatOf, CITIES, timeStrip } from '../loop/wallData.js';
import { renderMainPage } from '../main/mainPage.js';
import { installTap } from './tap.js';
import { div, el, span } from './dom.js';
import {
  intelView,
  mainView,
  principalOverlay,
  principalView,
  rosterView,
  ROLE_NAMES,
  tripsView,
  verifyView,
} from './views.js';
import {
  renderIntel,
  renderPrincipal,
  renderRoster,
  renderTrips,
  renderVerify,
} from './render.js';
import { osmNotice } from './flatmap.js';
import { createScene } from './scene3d.js';

const params = new URLSearchParams(location.search);
const slot = Number(params.get('slot')) || null;
const cityKey = params.get('city') || 'austin';

// page.js reads ?freeze when it loads: its demo feed then runs once.
if (!params.has('freeze')) {
  params.set('freeze', '1');
  history.replaceState(null, '', `?${params}`);
}

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
const body = document.body;

// ------------------------------------------------------------ the frame
const root = div('ex-root');
root.setAttribute('aria-live', 'off');
const bar = el('header', 'ex-bar');
const barIn = div('ex-bar-in');
const brand = span('ex-brand');
const mark = el('img', 'tt-brand-mark');
mark.src = '/safetrekr-logo.svg';
mark.alt = 'SafeTrekr';
const sep = span('tt-brand-sep');
const slotK = span('ex-slot');
const roleN = span('ex-role');
brand.append(mark, sep, slotK, roleN);
const chip = span('tt-wall-tag sample ex-sample', 'SAMPLE · ACCELERATED');
const clockEl = span('ex-clock');
const linkEl = span('ex-link');
const mid = div('ex-bar-mid');
mid.append(chip);
const right = div('ex-bar-right');
right.append(clockEl, linkEl);
barIn.append(brand, mid, right);
bar.append(barIn);
const stage = div('ex-stage');
const stageIn = div('ex-stage-in');
stage.append(stageIn);
const wait = div('ex-wait', 'Waiting for the Trip Twin computer');
root.append(bar, stage, wait);

// ------------------------------------------------------------ the state
let role = null; // the executive role (loop-role, else the slot's)
let roleFromRelay = false;
let loop = null;
let geo = null;
let main = null;
let clock = null;
let clockAt = 0;
let prevCounter = null;
let dirty = true;
let scene = null;

const simNow = () => {
  if (!clock) return loop?.clock?.simNow ?? main?.at ?? null;
  const base = ms(clock.simNow);
  return clock.paused ? base : base + (Date.now() - clockAt) * clock.rate;
};

function setRole(r) {
  if (!r || r === role) return;
  role = r;
  body.dataset.exRole = r;
  body.classList.toggle('ex-3d', r === 'main' || r === 'principal');
  slotK.textContent = r === 'main' ? '' : slot ? `S${slot}` : '';
  roleN.textContent = r === 'main' ? 'Executive' : ROLE_NAMES[r] || r;
  document.title = `SafeTrekr Executive · ${ROLE_NAMES[r] || r} (SAMPLE)`;
  if ((r === 'main' || r === 'principal') && !scene)
    scene = createScene({ cityKey });
  if (r !== 'main' && r !== 'principal') scene?.clear();
  prevCounter = null;
  dirty = true;
}

function onMessage(m) {
  if (m.t === 'loop-role') {
    if (Number(m.slot) === slot) {
      roleFromRelay = true;
      setRole(m.role);
    }
    return;
  }
  if (m.t === 'loop-clock') {
    clock = m.clock;
    clockAt = Date.now();
    return;
  }
  if (m.t !== 'loop') return;
  if (m.clock) {
    clock = m.clock;
    clockAt = Date.now();
  }
  if (m.view === 'main') {
    main = m.main;
    if (!roleFromRelay) setRole('main');
  } else if (m.view === 'loop') {
    loop = m.loop;
    if (m.geo) geo = m.geo;
    if (!roleFromRelay)
      setRole(slot ? EXEC_ROLE_ORDER[slot - 1] || 'verify' : 'verify');
  }
  dirty = true;
}

installTap(onMessage);

// ------------------------------------------------------------ the header
function renderHeader() {
  const t = simNow();
  // On stage the chip says the clock is sample and how fast it runs; PAUSED
  // is for the presenter and the desk only (R15 S2-4).
  const rate = Number(clock?.rate);
  const rest = `· ACCELERATED${rate > 1 ? ` ×${rate}` : ''}`;
  if (role === 'main') {
    // MAIN reads SAMPLE from the back of the room (EP-52: 10 m tier).
    if (chip.dataset.k !== rest) {
      chip.replaceChildren(span('big', 'SAMPLE'), span('rest', rest));
      chip.dataset.k = rest;
    }
  } else if (chip.dataset.k !== `t${rest}`) {
    chip.textContent = `SAMPLE ${rest}`;
    chip.dataset.k = `t${rest}`;
  }
  if (!t) {
    clockEl.textContent = '';
    return;
  }
  if (role === 'main') clockEl.textContent = timeStrip(t);
  else if (role === 'principal' && loop) {
    const pv = principalView(loop, geo);
    const tz = loop.people[pv.person_id]?.tz || 'UTC';
    clockEl.textContent = lz(t, tz);
  } else {
    // Analyst walls: Zulu first, the day's DTG, with the beat's city local.
    const city = CITIES.find((c) => c.name === focusCity()) || CITIES[0];
    clockEl.textContent = `${dtg(t)} · ${localTime(t, city.tz)} ${city.short}`;
  }
}
function focusCity() {
  if (!loop) return 'Austin';
  const b = beatOf(loop);
  return (
    {
      0: 'Austin',
      1: 'Austin',
      2: 'London',
      3: 'Washington DC',
      4: 'Washington DC',
      5: 'London',
    }[b] || 'Austin'
  );
}

// ------------------------------------------------------------ the walls
function render() {
  if (!role) return;
  const t = simNow();
  if (role === 'main') {
    if (!main) return;
    const v = mainView(main, { at: main.at, beat: beatFromMain() });
    renderMainPage(stageIn, v, {
      prevCounter,
      cities: mainFieldCities(main.at),
    });
    prevCounter = v.counter;
    // The map region: the top row's site twin, else no 3D at all (a flat
    // map or the neutral field), so a previous site never lingers (EP-52).
    const sc = v.scene;
    body.dataset.exMainMap = v.map.mode;
    body.classList.toggle('ex-flat-on', v.map.mode !== '3d');
    if (scene) {
      if (v.map.mode === '3d') {
        scene.site(v.map.site);
        const dl = v.map.dl;
        scene.draw({
          // After a DL NON-CONCUR: his door and the posts, the watch's
          // entrance greyed as superseded (F2 S2).
          entrances: dl
            ? [
                ...(dl.door ? [dl.door] : []),
                ...(sc.entrance ? [{ ...sc.entrance, superseded: true }] : []),
              ]
            : sc.entrance
              ? [sc.entrance]
              : [],
          posts: dl && Array.isArray(sc.posts) ? sc.posts : [],
          focusEntrance: dl ? dl.door?.name : sc.entrance?.name,
          // The person only when near the venue (a fix in another city is
          // not this site's: depth-test-free marks would show through).
          marks:
            sc.person &&
            sc.venue &&
            Math.abs(sc.person.lat - sc.venue.lat) < 0.05 &&
            Math.abs(sc.person.lon - sc.venue.lon) < 0.07
              ? [
                  {
                    kind: 'person',
                    label: sc.callsign,
                    lat: sc.person.lat,
                    lon: sc.person.lon,
                    fresh: 'fresh',
                  },
                ]
              : [],
        });
      } else scene.clear();
    }
    body.dataset.exPaths = '0';
  } else if (!loop) return;
  else if (role === 'verify') {
    const vv = verifyView(loop);
    renderVerify(stageIn, vv);
    // A wall showing the record is labelled Record (R14 S2-8).
    roleN.textContent = vv.record ? 'Record' : ROLE_NAMES.verify;
  } else if (role === 'intel') {
    const v = intelView(loop);
    renderIntel(stageIn, v, { prevCounter });
    prevCounter = v.counter;
  } else if (role === 'roster')
    renderRoster(stageIn, rosterView(loop, CITIES, { at: t }));
  else if (role === 'trips')
    renderTrips(stageIn, tripsView(loop, geo?.trips || [], { at: t }));
  else if (role === 'principal') {
    const v = principalView(loop, geo);
    const o = principalOverlay(loop, geo, v);
    const places = v.flat
      ? [
          geo?.places?.['pl-westin-dulles'],
          geo?.places?.['pl-iad'],
          v.venue && geo?.places?.[v.venue.place_id],
        ].filter((p, i, a) => p && a.indexOf(p) === i)
      : [];
    renderPrincipal(stageIn, v, o, {
      places,
      notice: osmNotice(geo?.attribution?.text),
    });
    body.classList.toggle('ex-flat-on', v.flat);
    if (scene) {
      if (!v.flat) {
        scene.site(v.site);
        scene.draw({
          ...o,
          focusEntrance:
            o.focusEntrance ?? v.rec?.rows.find(([k]) => k === 'WHERE')?.[1],
        });
      } else scene.clear();
    }
    body.dataset.exPaths = o.routes.length ? '1' : '0';
  }
  if (role !== 'main' && role !== 'principal') body.dataset.exPaths = '0';
  wait.hidden = true;
  body.dataset.exSim = new Date(Math.round(ms(t) / 60e3) * 60e3)
    .toISOString()
    .replace('.000Z', 'Z');
}
/** MAIN's neutral field: the cities with a leg today, local time beside. */
function mainFieldCities(at) {
  return ACTIVE_CITIES.map((n) => CITIES.find((c) => c.name === n)).map(
    (c) => ({
      lat: c.lat,
      lon: c.lon,
      label: `${c.short} ${localTime(at, c.tz)}`,
      anchor: c.name === 'London' ? 'end' : 'start',
    }),
  );
}
function beatFromMain() {
  // MAIN gets no loop: its beat from the clock (the relay's clock view).
  if (clock && Number.isFinite(clock.beat)) return clock.beat;
  return 0;
}

setInterval(() => {
  renderHeader();
  if (dirty) {
    dirty = false;
    try {
      render();
    } catch (err) {
      console.error('executive wall', err);
    }
  }
}, 400);
// The sample clock moves time-based lines (ages, the counter's window).
setInterval(() => (dirty = true), 5000);

// MAIN's hidden share (EP-51 open item 4) was measured in B3 (50–71 %, over
// the 40 % line), so MAIN is its own page in B4a (EP-52): it hides no
// school region to make room, and the share hook is gone.

// ------------------------------------------------------------ page.js
// The tap is in place: now the wall itself (pairing, frame, twin).
import('../../../page.js').then(() => {
  document.body.append(root);
  if (!role && slot) {
    // Until the relay names the role: the slot's place in the room.
    slotK.textContent = `S${slot}`;
  }
  void watchTime;
});
