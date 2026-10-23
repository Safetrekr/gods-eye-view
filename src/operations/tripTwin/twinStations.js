// Trip Twin stations rail (shell step B, 23 Oct 2026; review/shell).
// The Serras station rail in Instrument styling: a docked right-hand rail
// with the active station on top, the selection card in the middle and a
// 2×3 grid of station tiles at the bottom, opened and closed by the Signal
// Aperture at bottom right. The six stations are the six wall roles, in
// wall order, so "03" means Incident & attention on every screen.
// Pure DOM; no Cesium. The page decides what a station redraws.
import { ROLES, ROLE_ORDER } from './twinScreenRoles.js';

const ICON = {
  site: '<svg viewBox="0 0 20 20"><path d="M4 17V6.5L10 3l6 3.5V17"/><path d="M2.5 17h15M8 17v-4h4v4M7.5 8h1M11.5 8h1M7.5 10.8h1M11.5 10.8h1"/></svg>',
  travelers:
    '<svg viewBox="0 0 20 20"><circle cx="7.5" cy="7" r="2.5"/><circle cx="13.5" cy="8" r="2"/><path d="M3 16c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4M12 13.2c.5-.7 1.4-1.2 2.4-1.2 1.6 0 2.8 1.2 3.1 3"/></svg>',
  incident:
    '<svg viewBox="0 0 20 20"><path d="M10 3 2.8 16h14.4z"/><path d="M10 8v4M10 14.2v.3"/></svg>',
  weather:
    '<svg viewBox="0 0 20 20"><path d="M6 14.5h8.5a3 3 0 0 0 .3-6 4.5 4.5 0 0 0-8.6-.8A3.4 3.4 0 0 0 6 14.5z"/><path d="m9 16-1 2M12.5 16l-1 2"/></svg>',
  day: '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14M7 2.5v3M13 2.5v3M6.5 11.5h3M6.5 14h6"/></svg>',
  trips:
    '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2 2.8 4.4 2.8 7S12 15 10 17M10 3C8 5 7.2 7.4 7.2 10S8 15 10 17"/></svg>',
};

/** The six stations: id = wall role key, number = wall slot order. */
export const STATIONS = Object.freeze(
  ROLE_ORDER.map((id, i) => ({
    id,
    num: String(i + 1).padStart(2, '0'),
    label: ROLES[id].label,
    sub: ROLES[id].sub,
    icon: ICON[id],
  })),
);
export const stationById = (id) => STATIONS.find((s) => s.id === id) || null;

/** Option/Alt + 1–6 picks a station; uses e.code so Option symbols work. */
export function stationKey(e) {
  if (!e.altKey || e.metaKey || e.ctrlKey) return null;
  const m = /^Digit([0-6])$/.exec(e.code || '');
  if (!m) return null;
  return m[1] === '0' ? 'rail' : STATIONS[Number(m[1]) - 1].id;
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
 * Build the rail and the aperture. `onPick(id)` when a tile is pressed,
 * `onToggle(open)` when the aperture opens or closes the rail.
 */
export function createStationRail({ onPick, onToggle }) {
  const rail = el('aside', 'tt-st');
  rail.id = 'tt-st';
  rail.setAttribute('aria-label', 'Stations');
  const head = el('div', 'tt-st-head');
  head.append(
    el('span', '', 'Stations'),
    el('span', 'num', String(STATIONS.length).padStart(2, '0')),
  );
  const active = el('div', 'tt-st-active');
  const ak = el('div', 'tt-st-k');
  const akLabel = el('span', '', 'Active station');
  const status = el('span', 'tt-st-status');
  ak.append(akLabel, status);
  const name = el('div', 'tt-st-name');
  const sub = el('div', 'tt-st-sub');
  active.append(ak, name, sub);
  const top = el('div', 'tt-st-top');
  top.append(head, active);
  // The selection card (#tt-rcol) sits over this gap; it stays a sibling
  // so its fixed positioning and the panels' code are untouched.
  const middle = el('div', 'tt-st-middle');
  const grid = el('div', 'tt-st-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Stations');
  const tiles = new Map();
  STATIONS.forEach((s, i) => {
    const t = el('button', 'tt-st-tile');
    t.type = 'button';
    t.dataset.station = s.id;
    t.innerHTML = s.icon;
    t.style.setProperty('--rd', `${(STATIONS.length - 1 - i) * 0.05}s`);
    const pill = el('span', 'tt-st-pill');
    pill.hidden = true;
    t.append(el('span', 'num', s.num), el('span', 'lab', s.label), pill);
    t.title = `${s.label} · ${s.sub} (⌥${i + 1})`;
    t.addEventListener('click', () => onPick(s.id));
    tiles.set(s.id, { t, pill });
    grid.append(t);
  });
  rail.append(top, middle, grid);

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
    root.style.setProperty('--st-grid', `${grid.offsetHeight}px`);
  };
  const ro = new ResizeObserver(measure);
  ro.observe(top);
  ro.observe(grid);

  let wave = null;
  return {
    rail,
    aperture,
    /**
     * state: { station, open, statusText, statusLevel ('live' | 'stale' |
     * 'advance'), badges: { [id]: { text, level } }, signal: 'calm' |
     * 'attention' | 'incident', signalText }
     */
    render(state) {
      const s = stationById(state.station) || STATIONS[0];
      document.body.classList.toggle('tt-st-open', state.open);
      rail.hidden = !state.open;
      rail.setAttribute('aria-hidden', String(!state.open));
      name.textContent = s.label;
      sub.textContent = s.sub;
      status.textContent = state.statusText;
      status.className = `tt-st-status ${state.statusLevel}`;
      for (const st of STATIONS) {
        const { t, pill } = tiles.get(st.id);
        const on = st.id === s.id;
        if (on) t.setAttribute('aria-current', 'true');
        else t.removeAttribute('aria-current');
        const b = state.badges?.[st.id];
        pill.hidden = !b;
        pill.textContent = b?.text || '';
        pill.className = `tt-st-pill ${b?.level || ''}`;
        t.setAttribute(
          'aria-label',
          `Station ${st.num}, ${st.label}${on ? ', active' : ''}${b ? `, ${b.text}` : ''}`,
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
    /** Tiles arrive as a wavefront after a station change (Event tier). */
    wave() {
      rail.classList.add('tt-st-wave');
      clearTimeout(wave);
      wave = setTimeout(() => rail.classList.remove('tt-st-wave'), 900);
    },
    focusTile(id) {
      tiles.get(id)?.t.focus();
    },
    dispose() {
      ro.disconnect();
      rail.remove();
      aperture.remove();
    },
  };
}
