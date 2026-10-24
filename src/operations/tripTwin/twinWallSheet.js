// Wall sheets (Jesse, 23 Oct 2026, D5): L / D / K at a wall open the same
// full-screen Layers, Display and Keys sheets as the All-in-one, for this
// screen only. Every change goes through the session (screen-cmd), so the
// remote shows it at once and stays the one truth; role, mode, pin and
// anything wall-wide stay on the remote.
import { LAYER_CATALOG, ROLES, layerValue } from './twinScreenRoles.js';
import { MOTION_TIERS } from './twinMotion.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const btn = (cls, text, fn, attrs = {}) => {
  const b = el('button', cls, text);
  b.type = 'button';
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  b.addEventListener('click', fn);
  return b;
};

const TITLES = { layers: 'Layers', display: 'Display', keys: 'Keyboard' };
const KEYS = { layers: 'L', display: 'D', keys: 'K' };
const SCALES = [
  ['building', 'Building', '1'],
  ['neighborhood', 'Neighborhood', '2'],
  ['city', 'City', '3'],
];
/** What a hand at this wall can do (page.js WALL_KEYS plus the sheets). */
const WALL_KEYS = [
  [
    'This screen',
    [
      ['L', 'Layers for this screen'],
      ['D', 'Display for this screen: scale, text size, motion'],
      ['K', 'This list'],
      ['Esc', 'Close a sheet'],
    ],
  ],
  [
    'The view',
    [
      ['Drag', 'Turn and tilt'],
      ['Scroll', 'Zoom'],
      ['1 2 3', 'Building, neighborhood, city · until the remote changes it'],
      [', .', 'Turn left or right'],
      ['N', 'Face north'],
      ['F', 'Frame what is selected'],
      ['H', 'Hotel floors'],
      ['↑ ↓', 'Step floors while a floor card is open'],
    ],
  ],
  [
    'People',
    [
      ['A', 'First person who needs attention'],
      ['[ ]', 'Previous or next who needs attention'],
      ['Esc', 'Clear the selection'],
    ],
  ],
];

/**
 * createWallSheet({screen: () => this screen's state, slot: () => n,
 *   online: () => bool, write: (cmd, label) => Promise<{ok, error}>,
 *   blocked: () => bool (a K8 card replaces the scene: no sheet opens)})
 *   → {open(kind), close(), toggle(kind), refresh(), kind}
 */
export function createWallSheet({
  screen,
  slot,
  online,
  write,
  blocked = () => false,
}) {
  const root = el('section', 'tt-wall-sheet');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.hidden = true;
  document.body.append(root);
  let kind = null;
  let error = '';
  let busy = false;
  let returnFocus = null;

  async function send(cmd, label) {
    if (busy) return;
    busy = true;
    error = '';
    const r = await write(cmd, label).catch(() => ({ ok: false }));
    busy = false;
    if (!r?.ok) error = r?.error || 'Not saved · try again';
    render();
  }
  const patch = (p, label) =>
    send({ type: 'screens', target: slot(), patch: p }, label);

  function head() {
    const h = el('div', 'tt-pop-head');
    const t = el('div', 't', TITLES[kind]);
    t.append(el('span', 'kbd', KEYS[kind]));
    t.append(el('span', 'scope', `S${slot() ?? '?'} only`));
    h.append(
      t,
      btn('tt-x', '×', close, { 'aria-label': `Close ${TITLES[kind]}` }),
    );
    return h;
  }

  function foot() {
    const f = el('div', 'tt-wall-sheet-foot');
    const off = !online();
    f.classList.toggle('warn', off || Boolean(error));
    f.textContent = off
      ? 'Not connected to the Trip Twin computer · changes cannot be saved now'
      : error ||
        (kind === 'keys'
          ? 'Everything else is on the remote. Esc or K closes.'
          : `Changes apply to S${slot()} only and show on the remote. Esc or ${KEYS[kind]} closes.`);
    return f;
  }

  function layers(s) {
    const off = !online();
    const out = [];
    for (const g of LAYER_CATALOG) {
      const card = el('div', 'tt-layer-group');
      card.append(el('div', 'tt-kicker', g.group.toUpperCase()));
      for (const L of g.layers) {
        const on = layerValue(s, L.key);
        const row = el('label', 'tt-layer-row');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = on;
        box.disabled = off;
        box.dataset.focus = `layer:${L.key}`;
        box.addEventListener('change', () =>
          patch(
            { layers: { [L.key]: box.checked } },
            `${L.label} ${box.checked ? 'on' : 'off'}`,
          ),
        );
        row.append(box, el('span', '', L.label));
        card.append(row);
      }
      out.push(card);
    }
    return out;
  }

  function display(s) {
    const off = !online();
    const g1 = el('div', 'tt-pop-group');
    g1.append(el('div', 'tt-kicker', 'SCALE'));
    const seg = el('div', 'tt-wall-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Scale');
    const canvas = ROLES[s?.role]?.canvas !== false;
    for (const [k, label, key] of SCALES) {
      const b = btn(
        s?.scale === k ? 'on' : '',
        label,
        () => patch({ scale: k }, `Scale · ${label}`),
        { 'aria-pressed': String(s?.scale === k), 'data-focus': `scale:${k}` },
      );
      b.append(el('span', 'kbd', key));
      b.disabled = off || !canvas;
      seg.append(b);
    }
    g1.append(seg);
    if (!canvas)
      g1.append(el('div', 'tt-note', 'This screen shows no 3D view.'));

    const ts = Number(s?.textScale || 2);
    const g2 = el('div', 'tt-pop-group');
    g2.append(el('div', 'tt-kicker', 'TEXT SIZE'));
    const row = el('div', 'tt-wall-seg');
    const minus = btn(
      '',
      'Smaller',
      () => patch({ textScale: Math.max(1, ts - 0.25) }, 'Text smaller'),
      { 'data-focus': 'text:-' },
    );
    const plus = btn(
      '',
      'Larger',
      () => patch({ textScale: Math.min(3.5, ts + 0.25) }, 'Text larger'),
      { 'data-focus': 'text:+' },
    );
    minus.disabled = off || ts <= 1;
    plus.disabled = off || ts >= 3.5;
    row.append(minus, el('span', 'val', `×${ts}`), plus);
    g2.append(row);

    const g3 = el('div', 'tt-pop-group');
    g3.append(el('div', 'tt-kicker', 'MOTION'));
    for (const T of MOTION_TIERS) {
      const r = el('label', 'tt-check');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = s?.motion?.[T.key] !== false;
      box.disabled = off;
      box.dataset.focus = `motion:${T.key}`;
      box.addEventListener('change', () =>
        patch(
          { motion: { [T.key]: box.checked } },
          `${T.label} motion ${box.checked ? 'on' : 'off'}`,
        ),
      );
      const t = el('span', '', T.label);
      t.append(el('small', '', T.sub));
      r.append(box, t);
      g3.append(r);
    }
    g3.append(
      el(
        'div',
        'tt-note',
        'A screen whose system asks for reduced motion stays still whatever these say.',
      ),
    );

    const g4 = el('div', 'tt-pop-group');
    g4.append(el('div', 'tt-kicker', 'THIS SCREEN'));
    const reset = btn(
      'tt-wall-reset',
      'Reset to role defaults',
      () => send({ type: 'reset', target: slot() }, 'Reset to role defaults'),
      { 'data-focus': 'reset' },
    );
    reset.disabled = off;
    g4.append(
      reset,
      el(
        'div',
        'tt-note',
        `Role (${ROLES[s?.role]?.label || 'Site'}), Live or Advance and pinning are set on the remote.`,
      ),
    );
    return [g1, g2, g3, g4];
  }

  function keys() {
    return WALL_KEYS.map(([h, rows]) => {
      const g = el('div', 'tt-pop-group');
      g.append(el('div', 'tt-keys-h', h));
      const dl = el('dl', 'tt-keys');
      for (const [k, t] of rows) dl.append(el('dt', '', k), el('dd', '', t));
      g.append(dl);
      return g;
    });
  }

  function render() {
    if (!kind) return;
    const s = screen();
    // Keep the focus on the same control through a re-render.
    const focused = document.activeElement?.dataset?.focus;
    root.className = `tt-wall-sheet tt-wall-sheet-${kind}`;
    root.setAttribute('aria-label', `${TITLES[kind]} · S${slot() ?? '?'}`);
    const body = el('div', 'tt-wall-sheet-body');
    body.append(
      ...(kind === 'layers'
        ? layers(s)
        : kind === 'display'
          ? display(s)
          : keys()),
    );
    root.replaceChildren(head(), body, foot());
    const again = focused && root.querySelector(`[data-focus="${focused}"]`);
    if (again) again.focus();
  }

  function open(k) {
    if (!kind) returnFocus = document.activeElement;
    kind = k;
    error = '';
    root.hidden = false;
    document.body.classList.add('tt-wall-sheet-open');
    render();
    if (!root.contains(document.activeElement))
      (
        root.querySelector(
          'input:not(:disabled), button.on, button:not(.tt-x)',
        ) || root.querySelector('.tt-x')
      )?.focus();
  }
  function close() {
    if (!kind) return;
    kind = null;
    root.hidden = true;
    root.replaceChildren();
    document.body.classList.remove('tt-wall-sheet-open');
    returnFocus?.focus?.();
    returnFocus = null;
  }

  // The sheet owns the keyboard while it is open: nothing reaches the 3D
  // view behind it. Buttons and boxes still answer Enter and Space.
  const KEY_TO = { l: 'layers', d: 'display', k: 'keys', '?': 'keys' };
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const to = KEY_TO[e.key.length === 1 ? e.key.toLowerCase() : ''];
      if (kind) {
        e.stopPropagation();
        if (e.key === 'Escape' || to === kind) {
          e.preventDefault();
          close();
        } else if (to) {
          e.preventDefault();
          open(to);
        } else if (e.key === 'Tab') {
          // Focus stays inside the sheet.
          const f = [...root.querySelectorAll('input, button')].filter(
            (n) => !n.disabled,
          );
          if (!f.length) return;
          const i = f.indexOf(document.activeElement);
          const next = e.shiftKey
            ? i <= 0
              ? f.length - 1
              : i - 1
            : i === f.length - 1
              ? 0
              : i + 1;
          e.preventDefault();
          f[next].focus();
        }
        return;
      }
      if (!to || blocked() || e.target.closest?.('input, textarea, select'))
        return;
      e.preventDefault();
      e.stopPropagation();
      open(to);
    },
    true,
  );

  return {
    open,
    close,
    get kind() {
      return kind;
    },
    /** The session or the link changed: show what is true now. */
    refresh() {
      if (kind && !busy) render();
    },
  };
}
