// A wall's own right-hand menu (Jesse, 25 Oct 2026: "each screen should
// have its own right hand nav … collapsed on load (so just that little
// menu toggle on the far right hand side) … settings and layout options
// and appropriate page options"; plans/trip-twin/review/screens/05-S1-PLAN).
// The All-in-one's rail in the same dress (.tt-st*), opened and closed by
// the same Signal Aperture, but for this screen only: no station picker
// and no Back — a wall's role is set on the remote.
//   head      SCREEN · S1
//   active    S1 · Site, read-only, with Live/data age and who decides
//   middle    This screen: options saved through the session, then the
//             control detail the top bar no longer carries
//   grid      six view moves: the camera only, never saved
//   foot      Layers L · Display D · Keys K (the wall sheets)
// Pure DOM; twinScreen.js decides what each part holds.
import { APERTURE_SVG } from './twinStations.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * createWallRail({onToggle(open), menu: [{label, key, action}]})
 * → {rail, aperture, render(state), wake(), focusAperture(), contains(n)}
 */
export function createWallRail({ onToggle, onKeep = () => {}, menu = [] }) {
  const rail = el('aside', 'tt-st tt-wst');
  rail.id = 'tt-wst';
  rail.hidden = true;
  rail.dataset.ttRail = 'wall';
  rail.setAttribute('role', 'region');
  const head = el('div', 'tt-st-head');
  const headL = el('span', 'tt-st-trail');
  // "Closing in 5 s" and a Keep open button, where the eye is (ux P1-3).
  const headR = el('span', 'tt-wst-count');
  headR.setAttribute('aria-live', 'polite');
  const keep = el('button', 'tt-wst-keep', 'Keep open');
  keep.type = 'button';
  keep.hidden = true;
  keep.addEventListener('click', () => onKeep());
  head.append(headL, headR, keep);
  const active = el('div', 'tt-st-active');
  active.dataset.ttActive = '';
  const ak = el('div', 'tt-st-k');
  const akLabel = el('span');
  const status = el('span', 'tt-st-status');
  ak.append(akLabel, status);
  const name = el('div', 'tt-st-name');
  name.tabIndex = -1;
  const sub = el('div', 'tt-st-sub');
  const who = el('div', 'tt-wst-who');
  active.append(ak, name, sub, who);
  const top = el('div', 'tt-st-top');
  top.append(head, active);
  const middle = el('div', 'tt-st-middle');
  // Fades only where there is more to scroll to (shell R2-1).
  const edges = () => {
    const more = middle.scrollHeight - middle.clientHeight;
    middle.classList.toggle('more-above', more > 2 && middle.scrollTop > 2);
    middle.classList.toggle(
      'more-below',
      more > 2 && middle.scrollTop < more - 2,
    );
  };
  middle.addEventListener('scroll', edges, { passive: true });
  const panel = el('div', 'tt-st-panel tt-wst-panel');
  middle.append(panel);
  const note = el('div', 'tt-wst-note');
  note.setAttribute('role', 'status');
  note.hidden = true;
  const gridK = el('div', 'tt-wst-gridk');
  const grid = el('div', 'tt-st-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Move the view');
  const foot = el('div', 'tt-st-foot');
  foot.dataset.ttFoot = '';
  for (const m of menu) {
    const b = el('button', 'tt-st-foot-btn', m.label);
    b.type = 'button';
    b.dataset.ttMenu = m.label.toLowerCase();
    if (m.key) b.append(el('span', 'kbd', m.key));
    b.addEventListener('click', m.action);
    foot.append(b);
  }
  const footK = el('div', 'tt-wst-gridk tt-wst-footk', 'Settings');
  const bottom = el('div', 'tt-st-bottom');
  bottom.append(note, gridK, grid, footK, foot);
  rail.append(top, middle, bottom);

  const aperture = el('button', 'tt-aperture tt-wst-ap');
  aperture.type = 'button';
  aperture.id = 'tt-wst-ap';
  aperture.dataset.ttAperture = 'wall';
  aperture.setAttribute('aria-controls', 'tt-wst');
  aperture.innerHTML = APERTURE_SVG;
  // The first-time cue: the cursor shows, the toggle names itself (UX §4).
  const hint = el('span', 'tt-wst-hint', 'Menu');
  hint.append(el('span', 'kbd', 'M'));
  hint.hidden = true;
  // A save's note while the menu is closed (20-S1-FIX-LIST F14).
  const toast = el('div', 'tt-wst-toast');
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  aperture.addEventListener('click', () =>
    onToggle(!document.body.classList.contains('tt-wst-open')),
  );
  document.body.append(rail, aperture, hint, toast);

  let tilesKey = '';
  let tileCells = new Map();
  let panelKey = '';
  let hintTimer = 0;

  /** One option row: a segmented choice or an on/off switch. */
  function option(o) {
    const row = el('div', 'tt-wst-opt');
    row.dataset.opt = o.key;
    const lab = el('div', 'tt-wst-optk', o.label);
    row.append(lab);
    const seg = el('div', 'tt-wall-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', o.label);
    for (const c of o.choices) {
      const b = el('button', c.value === o.value ? 'on' : '', c.label);
      b.type = 'button';
      b.dataset.focus = `${o.key}:${c.value}`;
      b.setAttribute('aria-pressed', String(c.value === o.value));
      b.disabled = Boolean(o.disabled);
      if (o.pending === c.value) b.classList.add('pending');
      b.addEventListener('click', () => {
        if (c.value !== o.value) o.pick(c.value);
      });
      seg.append(b);
    }
    row.append(seg);
    if (o.reason) row.append(el('div', 'tt-wst-why', o.reason));
    else if (o.note) row.append(el('div', 'tt-wst-why', o.note));
    return row;
  }

  function renderPanel(s) {
    // Rebuild only when something shown changes, so focus survives the
    // once-a-second repaint.
    const key = JSON.stringify([
      s.groups.map((g) => [
        g.title,
        g.options.map((o) => [
          o.key,
          o.value,
          o.disabled,
          o.reason,
          o.note,
          o.pending,
        ]),
      ]),
      s.control,
    ]);
    if (key === panelKey) return;
    panelKey = key;
    const focused = document.activeElement?.dataset?.focus;
    const parts = [];
    for (const g of s.groups) {
      const box = el('div', 'tt-wst-group');
      box.append(el('div', 'tt-kicker', g.title));
      if (g.note) box.append(el('div', 'tt-wst-gnote', g.note));
      for (const o of g.options) box.append(option(o));
      parts.push(box);
    }
    if (s.control.length) {
      const ctl = el('div', 'tt-wst-group tt-wst-ctl');
      ctl.append(el('div', 'tt-kicker', 'CONTROL'));
      for (const line of s.control) ctl.append(el('div', 'tt-wst-line', line));
      parts.push(ctl);
    }
    panel.replaceChildren(...parts);
    const again = focused && panel.querySelector(`[data-focus="${focused}"]`);
    if (again) again.focus();
  }

  function tile(x) {
    const t = el('button', 'tt-st-tile');
    t.type = 'button';
    t.dataset.tile = x.key;
    t.innerHTML = x.icon || '';
    const why = el('span', 'why');
    const lab = el('span', 'lab', x.label);
    t.append(el('span', 'num', x.kbd || ''), lab, why);
    // The latest tile's action and label ("Next to check · 2 of 6").
    const c = { t, why, lab, x };
    t.addEventListener('click', () => {
      if (!t.disabled) c.x.action();
    });
    return c;
  }

  function renderTiles(tiles) {
    const list = tiles.slice(0, 6);
    // Fixed slots in rows of three; a board's one row has no empty row.
    while (list.length % 3) list.push({ key: `empty${list.length}` });
    const key = list.map((x) => x.key).join(',');
    if (key !== tilesKey) {
      tilesKey = key;
      tileCells = new Map();
      grid.replaceChildren();
      for (const x of list) {
        if (!x.label) {
          // A fixed slot with nothing in it: positions never move.
          const t = el('button', 'tt-st-tile empty');
          t.type = 'button';
          t.disabled = true;
          t.tabIndex = -1;
          t.setAttribute('aria-hidden', 'true');
          grid.append(t);
          continue;
        }
        const c = tile(x);
        tileCells.set(x.key, c);
        grid.append(c.t);
      }
    }
    for (const x of list) {
      const c = tileCells.get(x.key);
      if (!c) continue;
      c.x = x;
      if (c.lab.textContent !== x.label) c.lab.textContent = x.label;
      c.t.disabled = Boolean(x.disabled);
      c.why.textContent = x.disabled && x.reason ? x.reason : '';
      c.t.title = x.title || x.label;
      c.t.setAttribute(
        'aria-label',
        `${x.label}${x.kbd ? ` (${x.kbd})` : ''} · not saved${x.disabled ? `, not available: ${x.reason || ''}` : ''}`,
      );
    }
  }

  return {
    rail,
    aperture,
    /**
     * state: {open, slot, role, sub, statusText, statusLevel, who,
     *   groups: [{title, note, options: [{key, label, value, choices,
     *   disabled, reason, note, pending, pick}]}], control: [line],
     *   who: [line], note: {text, level, undo} | null, toast (the same,
     *   shown while closed), tiles: [{key, label, icon, kbd, action,
     *   disabled, reason}], tilesTitle, closingIn (s) | null, signal,
     *   signalText, stale}
     */
    render(s) {
      const b = document.body;
      b.classList.toggle('tt-wst-open', s.open);
      rail.hidden = !s.open;
      aperture.dataset.signal = s.signal;
      aperture.dataset.stale = s.stale ? '1' : '';
      // While closed, a save's note shows by the aperture (F14).
      const t = !s.open && s.toast ? s.toast : null;
      toast.hidden = !t;
      if (t) {
        // Each note is its own: a repeated action brings its own Undo.
        const key = `${t.id}|${t.text}|${Boolean(t.undo)}|${t.level}`;
        if (toast.dataset.key !== key) {
          toast.dataset.key = key;
          toast.className = `tt-wst-toast ${t.level || ''}`;
          toast.replaceChildren(el('span', 't', t.text));
          if (t.undo) {
            const u = el('button', 'tt-wst-undo', 'Undo');
            u.type = 'button';
            u.addEventListener('click', t.undo);
            toast.append(u);
          }
        }
      } else delete toast.dataset.key;
      aperture.setAttribute('aria-expanded', String(s.open));
      const label = `${s.open ? 'Close' : 'Open'} the S${s.slot} menu${s.signalText ? ` · ${s.signalText}` : ''} (M)`;
      aperture.setAttribute('aria-label', label);
      aperture.title = label;
      rail.setAttribute('aria-label', `S${s.slot} ${s.role} · screen menu`);
      if (!s.open) return;
      headL.textContent = `Screen · S${s.slot}`;
      headR.textContent =
        s.closingIn != null ? `Closing in ${s.closingIn} s` : '';
      keep.hidden = s.closingIn == null;
      akLabel.textContent = 'Role';
      status.textContent = s.statusText;
      status.className = `tt-st-status ${s.statusLevel}`;
      name.textContent = s.role;
      sub.textContent = s.sub;
      const whoKey = (s.who || []).join('\n');
      if (who.dataset.key !== whoKey) {
        who.dataset.key = whoKey;
        who.replaceChildren(
          ...(s.who || []).map((line, i, a) =>
            el('div', i === a.length - 1 ? 'tt-wst-ro' : 'tt-wst-wline', line),
          ),
        );
      }
      renderPanel(s);
      note.hidden = !s.note;
      if (s.note) {
        note.className = `tt-wst-note ${s.note.level || ''}`;
        const key = `${s.note.id}|${s.note.text}|${Boolean(s.note.undo)}`;
        if (note.dataset.key !== key) {
          note.dataset.key = key;
          note.replaceChildren(el('span', 't', s.note.text));
          if (s.note.undo) {
            const u = el('button', 'tt-wst-undo', 'Undo');
            u.type = 'button';
            u.addEventListener('click', s.note.undo);
            note.append(u);
          }
        }
      } else delete note.dataset.key;
      // No grid on a screen with nothing to move (F16).
      const hasTiles = (s.tiles || []).length > 0;
      grid.hidden = !hasTiles;
      gridK.hidden = !hasTiles;
      gridK.textContent = s.tilesTitle || '';
      if (hasTiles) renderTiles(s.tiles);
      edges();
    },
    /** The cursor moved: show the toggle's name for 4 s (not hands-on). */
    wake() {
      if (document.body.classList.contains('tt-wst-open')) return;
      hint.hidden = false;
      aperture.classList.add('awake');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => {
        hint.hidden = true;
        aperture.classList.remove('awake');
      }, 4000);
    },
    sleep() {
      clearTimeout(hintTimer);
      hint.hidden = true;
      aperture.classList.remove('awake');
    },
    focusName: () => name.focus({ preventScroll: true }),
    scrollTop: () => {
      middle.scrollTop = 0;
    },
    focusAperture: () => aperture.focus({ preventScroll: true }),
    contains: (n) => rail.contains(n) || aperture.contains(n),
  };
}
