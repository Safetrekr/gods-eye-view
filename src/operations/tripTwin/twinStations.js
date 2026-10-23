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

const APERTURE_SVG =
  '<svg class="tt-ap" viewBox="0 0 34 34" aria-hidden="true">' +
  '<circle class="tt-ap-ring" cx="17" cy="17" r="15"/>' +
  '<circle class="tt-ap-scan" cx="17" cy="17" r="15"/>' +
  '<g class="tt-ap-nodes"><circle cx="17" cy="10.6" r="1.5"/>' +
  '<circle cx="11.5" cy="20.4" r="1.5"/><circle cx="22.5" cy="20.4" r="1.5"/></g>' +
  '<g class="tt-ap-rotor"><line class="tt-ap-baton" x1="6.4" y1="27.6" x2="27.6" y2="6.4"/>' +
  '<circle class="tt-ap-bead" cx="21.8" cy="12.2" r="2.2"/></g></svg>';

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
  ak.append(el('span', '', 'Active station'), status);
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
    t.append(el('span', 'num', num || ''), el('span', 'lab', label), pill);
    if (title) t.title = title;
    t.addEventListener('click', () => {
      if (!t.disabled) action();
    });
    return { t, pill };
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
      trail.textContent = inStation
        ? `Stations › ${s.num} ${s.label}`
        : 'Stations';
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
        const { t, pill } = cells.get(x.key);
        if (x.empty) continue;
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
