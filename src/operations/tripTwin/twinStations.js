// Trip Twin stations rail (shell steps B–C, 23 Oct 2026; review/shell).
// The Serras station rail in Instrument styling: a docked right-hand rail
// with the active station on top, the selection card or the station's own
// panel in the middle and a 2×3 grid of tiles at the bottom, opened and
// closed by the Signal Aperture at bottom right. The six stations are the
// six wall roles, in wall order, so "03" means Incident & attention on
// every screen, the remote included.
//
// The grid has two levels (Jesse, 23 Oct): the station picker, and inside
// a station that station's own tiles with Back always first. Badges move
// onto Back while the picker is not showing, so nothing hides an incident.
// Pure DOM; no Cesium. The page decides what a station redraws.
import { ROLES, ROLE_ORDER } from './twinScreenRoles.js';

const svg = (d) => `<svg viewBox="0 0 20 20">${d}</svg>`;
export const ICON = {
  site: svg(
    '<path d="M4 17V6.5L10 3l6 3.5V17"/><path d="M2.5 17h15M8 17v-4h4v4M7.5 8h1M11.5 8h1M7.5 10.8h1M11.5 10.8h1"/>',
  ),
  travelers: svg(
    '<circle cx="7.5" cy="7" r="2.5"/><circle cx="13.5" cy="8" r="2"/><path d="M3 16c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4M12 13.2c.5-.7 1.4-1.2 2.4-1.2 1.6 0 2.8 1.2 3.1 3"/>',
  ),
  incident: svg('<path d="M10 3 2.8 16h14.4z"/><path d="M10 8v4M10 14.2v.3"/>'),
  weather: svg(
    '<path d="M6 14.5h8.5a3 3 0 0 0 .3-6 4.5 4.5 0 0 0-8.6-.8A3.4 3.4 0 0 0 6 14.5z"/><path d="m9 16-1 2M12.5 16l-1 2"/>',
  ),
  day: svg(
    '<rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14M7 2.5v3M13 2.5v3M6.5 11.5h3M6.5 14h6"/>',
  ),
  trips: svg(
    '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2 2.8 4.4 2.8 7S12 15 10 17M10 3C8 5 7.2 7.4 7.2 10S8 15 10 17"/>',
  ),
  back: svg('<path d="M8.5 5 3.5 10l5 5"/><path d="M4 10h12.5"/>'),
  building: svg(
    '<rect x="6" y="2.5" width="8" height="15" rx="1"/><path d="M8.5 6h3M8.5 9h3M8.5 12h3M9 17.5v-2.5h2v2.5"/>',
  ),
  neighborhood: svg(
    '<path d="M2.5 17V9l4-2.5 4 2.5v8M10.5 17V5.5l3.5-2 3.5 2V17M1.5 17h17"/>',
  ),
  city: svg(
    '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3.5"/><circle cx="10" cy="10" r=".6"/>',
  ),
  waysOut: svg(
    '<path d="M11 3.5H4.5v13H11"/><path d="M8.5 10h9M14.5 7l3 3-3 3"/>',
  ),
  layers: svg('<path d="m10 3 7 4-7 4-7-4z"/><path d="m3 11 7 4 7-4"/>'),
  find: svg('<circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 4.5 4.5"/>'),
  next: svg(
    '<circle cx="8" cy="7" r="3"/><path d="M2.5 17c.7-3 2.8-4.5 5.5-4.5M13 10.5l3.5 3.5-3.5 3.5"/>',
  ),
  topdown: svg(
    '<circle cx="10" cy="10" r="6.5"/><path d="M10 1.5v4M10 14.5v4M1.5 10h4M14.5 10h4"/>',
  ),
  clear: svg('<path d="m5 5 10 10M15 5 5 15"/>'),
  report: svg(
    '<path d="M4.5 17.5V3"/><path d="M4.5 3.5h10l-2.5 3.5 2.5 3.5h-10"/>',
  ),
  copy: svg(
    '<rect x="6.5" y="6.5" width="10" height="11" rx="1.5"/><path d="M13.5 6.5V4a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v8.5A1.5 1.5 0 0 0 5 14h1.5"/>',
  ),
  storm: svg(
    '<circle cx="10" cy="10" r="7"/><path d="M10 10 15 5"/><circle cx="13" cy="12.5" r="1.4"/>',
  ),
  timeline: svg('<circle cx="10" cy="10" r="7"/><path d="M10 5.5V10l3 2"/>'),
  lightning: svg('<path d="M11 2.5 4.5 11h5L8.5 17.5 15.5 9h-5z"/>'),
  radar: svg(
    '<path d="M3 15.5a9 9 0 0 1 14 0"/><path d="M6 15.5a5 5 0 0 1 8 0"/><circle cx="10" cy="15.5" r="1"/>',
  ),
  advance: svg(
    '<rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14M7 2.5v3M13 2.5v3M8 12.5h4M10.5 10.5l2 2-2 2"/>',
  ),
  sites: svg(
    '<path d="M10 17.5s5.5-5.2 5.5-9.2a5.5 5.5 0 0 0-11 0c0 4 5.5 9.2 5.5 9.2z"/><circle cx="10" cy="8.3" r="2"/>',
  ),
  paths: svg(
    '<circle cx="4.5" cy="15.5" r="1.8"/><circle cx="15.5" cy="4.5" r="1.8"/><path d="M6.3 15.5H12a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h5.7"/>',
  ),
};

/** Short tile labels (review/shell D8); the full name is in the pane. */
const SHORT = {
  site: 'Site',
  travelers: 'People',
  incident: 'Incident',
  weather: 'Weather',
  day: 'Day plan',
  trips: 'Trips',
};
/** The six stations: id = wall role key, number = wall slot order. */
export const STATIONS = Object.freeze(
  ROLE_ORDER.map((id, i) => ({
    id,
    num: String(i + 1).padStart(2, '0'),
    label: ROLES[id].label,
    short: SHORT[id],
    sub: ROLES[id].sub,
    icon: ICON[id],
  })),
);
export const stationById = (id) => STATIONS.find((s) => s.id === id) || null;

/** Option/Alt + 1–6 picks a station, + 0 goes back or closes; e.code so
 *  the Option symbols on a Mac keyboard still count. */
export function stationKey(e) {
  if (!e.altKey || e.metaKey || e.ctrlKey) return null;
  const m = /^Digit([0-6])$/.exec(e.code || '');
  if (!m) return null;
  return m[1] === '0' ? 'rail' : STATIONS[Number(m[1]) - 1].id;
}

/**
 * The storm's time pill, shared by the All-in-one and the remote: the same
 * time as the big figure (the core within 6 mi / 10 km). "" when none.
 */
export function weatherPill(t, sim, us = true) {
  if (!t) return '';
  const m = t.nearMin ?? t.overMin;
  let p = '';
  if (t.status === 'over') p = 'OVERHEAD';
  else if (t.status === 'near') p = us ? 'WITHIN 6 MI' : 'WITHIN 10 KM';
  else if (t.status === 'arriving' && m != null && m <= 90)
    p = `IN ~${Math.max(5, Math.round(m / 5) * 5)} MIN`;
  if (!p) return '';
  return sim ? `SIM ${p.replace(/ MIN$/, '')}` : p;
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// The SafeTrekr shield (public/safetrekr-logo.svg, first path; 77 x 90).
export const SHIELD_PATH =
  'M36.55 0.800092C37.62 0.700092 39.47 0.720086 40.54 0.810086C49.46 1.65009 57.6 2.4501 66.52 3.3501C68.07 3.5301 69.6798 3.52008 71.1298 4.15008C73.5798 5.21008 75.42 7.49009 76.07 10.0601C76.43 11.5001 76.32 12.9901 76.33 14.4501C76.33 25.4301 76.33 36.4001 76.33 47.3801C76.33 49.8001 76.4199 52.2201 76.1699 54.6301C75.5399 59.7201 73.4 64.6001 70.1 68.5301C67.83 71.3401 64.97 73.6101 62.04 75.6901C55.33 80.4101 47.71 84.7001 40.55 88.6701C39.37 89.4201 37.7299 89.3901 36.5099 88.6301C31.2199 85.9401 26.63 83.0601 21.55 80.0001C18.12 78.0201 14.7899 75.8501 11.6999 73.3801C4.65988 68.0001 0.379943 59.1901 0.759943 50.3001C0.769943 37.6501 0.739953 25.0001 0.769953 12.3601C0.769953 8.35009 3.78986 4.27008 7.91986 3.87008C17.4499 2.80008 27 1.84009 36.53 0.800092H36.55ZM9.07 8.77009C6.97 8.89009 5.50989 10.5601 5.70989 12.5701C5.72989 24.2601 5.70997 36.3601 5.78997 48.0401C6.77997 47.2001 7.65999 46.2501 8.55999 45.3201C17.69 36.0401 27.4 26.3001 36.53 17.0101C37.14 16.4001 37.66 16.0501 38.56 16.0501C39.55 16.0501 39.94 16.3101 40.59 16.9901C44.2 20.8801 48.0399 24.7501 51.6999 28.6001C52.3199 29.2201 52.9099 29.9301 53.7199 30.3201C54.9999 30.8801 56.4699 30.0701 57.7299 30.7101C58.7299 31.2701 59.4399 32.1901 60.2499 32.9801C63.9599 36.7501 67.5398 40.6601 71.3798 44.3001C71.4198 33.7901 71.3798 23.0301 71.3998 12.5201C71.4398 11.3301 71.0799 10.3201 70.1699 9.51008C69.3499 8.71008 68.16 8.54008 67.07 8.43008C59.22 7.68008 49.45 6.71009 41.6 5.95009C39.17 5.64009 38.1299 5.64009 35.4399 5.95009C26.6499 6.88009 17.87 7.84008 9.09002 8.76008L9.07 8.77009ZM34.1699 81.3701C35.3599 82.0901 36.8801 83.0201 38.6201 83.0201C40.2501 83.0201 41.7699 82.1001 42.9599 81.3701C46.4299 78.7601 49.0099 76.2201 52.2299 73.3001C54.1799 71.5001 55.5998 69.5501 56.8898 67.1901C58.3798 64.5301 58.3298 60.9301 56.3798 58.5101C54.4098 56.0001 51.3599 54.7801 48.4599 53.7101C45.5599 52.5501 42.4799 51.8101 39.6799 50.4001C38.8899 49.9601 37.81 49.3001 38.04 48.2301C38.36 47.0301 39.57 46.4201 40.56 45.8501C42.39 44.8001 44.27 44.7001 46.36 43.4701C45.4 43.3901 44.7699 43.4001 43.4899 43.5501C40.5899 43.9701 37.69 44.4001 34.85 45.1401C33.15 45.6101 31.4098 46.2501 30.1498 47.5201C29.4398 48.2201 29.08 49.3701 29.56 50.2901C30.11 51.3201 31.1799 51.9201 32.1699 52.4701C34.2299 53.5401 36.34 54.5101 38.35 55.6801C39.67 56.4501 41.0598 57.3701 41.6498 58.8401C42.2098 60.3101 41.65 61.9301 40.81 63.1701C39.43 65.1501 37.28 66.3801 35.31 67.6801C31.02 70.4501 27.1898 72.0601 22.6398 74.3401L34.1899 81.3401L34.1699 81.3701Z';

// Signal Aperture, SafeTrekr's own (review/shell D7): the shield in steel
// inside a hairline ring, and one signal bead at its shoulder — steel when
// calm, amber for attention, red for an incident. No Serras baton.
const APERTURE_SVG =
  '<svg class="tt-ap" viewBox="0 0 34 34" aria-hidden="true">' +
  '<circle class="tt-ap-ring" cx="17" cy="17" r="15.5"/>' +
  '<circle class="tt-ap-scan" cx="17" cy="17" r="15.5"/>' +
  '<g class="tt-ap-shield" transform="translate(8.5 7.1) scale(0.22)">' +
  `<path d="${SHIELD_PATH}"/></g>` +
  '<circle class="tt-ap-bead" cx="25.4" cy="8.6" r="3.3"/></svg>';

/**
 * Build the rail and the aperture. `onPick(id)` when a station tile is
 * pressed, `onBack()` for Back, `onToggle(open)` for the aperture, and
 * `menu` = [{ label, key, action }] for the rail foot (Layers, Display…).
 */
export function createStationRail({ onPick, onBack, onToggle, menu = [] }) {
  const rail = el('aside', 'tt-st');
  rail.id = 'tt-st';
  rail.setAttribute('aria-label', 'Stations');
  const head = el('div', 'tt-st-head');
  const trail = el('span', 'tt-st-trail');
  head.append(trail);
  const active = el('div', 'tt-st-active');
  const ak = el('div', 'tt-st-k');
  const status = el('span', 'tt-st-status');
  const akLabel = el('span', '', 'Active station');
  ak.append(akLabel, status);
  const name = el('div', 'tt-st-name');
  const sub = el('div', 'tt-st-sub');
  active.append(ak, name, sub);
  const top = el('div', 'tt-st-top');
  top.append(head, active);
  // The middle shows the selection card (#tt-rcol, laid over it from
  // outside so its own code is untouched) or, when nothing is selected,
  // the station's panel.
  const middle = el('div', 'tt-st-middle');
  const panel = el('div', 'tt-st-panel');
  panel.setAttribute('aria-live', 'off');
  middle.append(panel);
  const grid = el('div', 'tt-st-grid');
  grid.setAttribute('role', 'group');
  const foot = el('div', 'tt-st-foot');
  for (const m of menu) {
    const b = el('button', 'tt-st-foot-btn', m.label);
    b.type = 'button';
    if (m.key) b.append(el('span', 'kbd', m.key));
    b.addEventListener('click', m.action);
    foot.append(b);
  }
  const bottom = el('div', 'tt-st-bottom');
  bottom.append(grid, foot);
  rail.append(top, middle, bottom);

  const aperture = el('button', 'tt-aperture');
  aperture.type = 'button';
  aperture.id = 'tt-aperture';
  aperture.setAttribute('aria-controls', 'tt-st');
  aperture.innerHTML = APERTURE_SVG;
  aperture.addEventListener('click', () =>
    onToggle(!document.body.classList.contains('tt-st-open')),
  );
  document.body.append(rail, aperture);

  // The selection card fits between the active pane and the tiles.
  const root = document.documentElement;
  const measure = () => {
    root.style.setProperty('--st-top', `${top.offsetHeight}px`);
    root.style.setProperty('--st-grid', `${bottom.offsetHeight}px`);
  };
  const ro = new ResizeObserver(measure);
  ro.observe(top);
  ro.observe(bottom);

  /** One tile: icon, number or nothing top-right, label bottom-left. */
  function tile({ key, label, icon, num, title, action, empty }) {
    const t = el('button', `tt-st-tile${empty ? ' empty' : ''}`);
    if (empty) {
      // A fixed slot with nothing in it: positions never move.
      t.type = 'button';
      t.disabled = true;
      t.dataset.tile = key;
      t.setAttribute('aria-hidden', 'true');
      t.tabIndex = -1;
      return { t, pill: el('span', 'tt-st-pill') };
    }
    t.type = 'button';
    t.dataset.tile = key;
    t.innerHTML = icon || '';
    const pill = el('span', 'tt-st-pill');
    pill.hidden = true;
    // A disabled tile says why (visual pass, 12-ui §14).
    const why = el('span', 'why');
    t.append(el('span', 'num', num || ''), el('span', 'lab', label), why, pill);
    if (title) t.title = title;
    t.addEventListener('click', () => {
      if (!t.disabled) action();
    });
    return { t, pill, why };
  }
  let gridKey = '';
  let cells = new Map();
  let wave = null;
  function waveIn() {
    rail.classList.add('tt-st-wave');
    clearTimeout(wave);
    wave = setTimeout(() => rail.classList.remove('tt-st-wave'), 900);
  }
  return {
    rail,
    aperture,
    panel,
    /**
     * state: { station, mode ('picker' | 'station'), tiles (station mode:
     * [{ key, label, icon, on, disabled, title, action }]), panelBusy,
     * open, statusText, statusLevel ('live' | 'stale' | 'advance'),
     * badges: { [stationId]: { text, level } }, signal ('calm' |
     * 'attention' | 'incident'), signalText }
     */
    render(state) {
      const s = stationById(state.station) || STATIONS[0];
      const inStation = state.mode === 'station';
      document.body.classList.toggle('tt-st-open', state.open);
      rail.hidden = !state.open;
      rail.classList.toggle('busy', Boolean(state.panelBusy));
      // Head: "Stations" and the active number; the trail lives in the
      // active strip's kicker (review/shell 12-ui §12).
      trail.textContent = `Stations · ${s.num} / ${String(STATIONS.length).padStart(2, '0')}`;
      akLabel.textContent = `Active · ${s.num} ${s.short}`;
      name.textContent = s.label;
      sub.textContent = s.sub;
      status.textContent = state.statusText;
      status.className = `tt-st-status ${state.statusLevel}`;
      // Rebuild the grid only when its set of tiles changes, so a focused
      // tile keeps focus through the 5 s refresh.
      const list = inStation
        ? [
            {
              key: 'back',
              label: 'Stations',
              icon: ICON.back,
              title: 'Back to the stations (⌥0)',
              action: onBack,
            },
            ...(state.tiles || []).slice(0, 5),
          ]
        : STATIONS.map((st, i) => ({
            key: st.id,
            label: st.short,
            icon: st.icon,
            num: st.num,
            title: `${st.label} · ${st.sub} (⌥${i + 1})`,
            action: () => onPick(st.id),
          }));
      // Always six slots (review/shell X15).
      while (list.length < 6)
        list.push({ key: `empty${list.length}`, label: '', empty: true });
      const key = `${state.mode}|${s.id}|${list.map((x) => x.key).join(',')}`;
      // No rail or tile animation while a red or amber signal shows: the
      // badge must arrive at once (review/shell X12).
      document.body.classList.toggle('tt-st-alert', state.signal !== 'calm');
      if (key !== gridKey) {
        const changed = gridKey !== '';
        gridKey = key;
        cells = new Map();
        grid.replaceChildren();
        list.forEach((x, i) => {
          const c = tile(x);
          c.t.style.setProperty('--rd', `${(list.length - 1 - i) * 0.05}s`);
          cells.set(x.key, c);
          grid.append(c.t);
        });
        grid.setAttribute(
          'aria-label',
          inStation ? `${s.label} tiles` : 'Stations',
        );
        if (changed) waveIn();
      }
      // Badges: station tiles in the picker; the worst signal on Back
      // while inside a station, so nothing hides behind a station.
      const signalBadge = state.backBadge || null;
      for (const x of list) {
        const { t, pill, why } = cells.get(x.key);
        if (x.empty) continue;
        why.textContent = x.disabled && x.reason ? x.reason : '';
        const on = inStation ? Boolean(x.on) : x.key === s.id;
        if (on) t.setAttribute('aria-current', 'true');
        else t.removeAttribute('aria-current');
        t.disabled = Boolean(x.disabled);
        const b = inStation
          ? x.key === 'back'
            ? signalBadge
            : null
          : state.badges?.[x.key];
        pill.hidden = !b;
        pill.textContent = b?.text || '';
        pill.className = `tt-st-pill ${b?.level || ''}`;
        t.setAttribute(
          'aria-label',
          `${x.num ? `Station ${x.num}, ` : ''}${x.label}${on ? (inStation ? ', on' : ', active') : ''}${b ? `, ${b.text}` : ''}${x.disabled ? ', not available' : ''}`,
        );
      }
      aperture.dataset.signal = state.signal;
      aperture.setAttribute('aria-expanded', String(state.open));
      aperture.setAttribute(
        'aria-label',
        `${state.open ? 'Close' : 'Open'} stations · ${s.num} ${s.label} active${state.signalText ? ` · ${state.signalText}` : ''} (⌥0)`,
      );
      aperture.title = aperture.getAttribute('aria-label');
      if (state.open) measure();
    },
    focusTile(key) {
      cells.get(key)?.t.focus();
    },
    dispose() {
      ro.disconnect();
      clearTimeout(wave);
      rail.remove();
      aperture.remove();
    },
  };
}
