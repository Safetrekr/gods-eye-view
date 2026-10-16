// SOC multi-view entry (phase 10): on entering Trip Twin the operator picks
// All in one (today) or Multi-view (1–6 wall screens + a remote). This
// computer starts the session: it opens screen windows on its monitors and
// shows a QR code the iPad scans to open the remote, already paired.
import QRCode from 'qrcode';
import { connectSync } from './twinSync.js';
import { ROLES, defaultRoles } from './twinScreenRoles.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const btn = (cls, text, fn) => {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
};

let screensCache = null;
let openedHere = 0; // windows this computer has opened, for monitor order
/**
 * Open one wall window, on its own monitor when Chrome allows it: the nth
 * window opened on this computer goes to its nth monitor (review R17).
 */
async function openScreenWindow(slot, url) {
  try {
    if (!screensCache && 'getScreenDetails' in window)
      screensCache = (await window.getScreenDetails()).screens;
  } catch {
    screensCache = null;
  }
  const s = screensCache?.[openedHere++ % screensCache.length];
  const features = s
    ? `left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`
    : 'width=1280,height=760';
  window.open(url, `tt-screen-${slot}`, features);
}

/**
 * Another computer's screens (e.g. a Mac Studio with 4 monitors): opened
 * from twin.html?view=launch&setup=…; each button opens one wall window
 * that joins its slot directly — no codes to type.
 */
/**
 * Open buttons that say which screens have joined, and where (R17). Clicking
 * a screen already open on another computer asks once before taking it.
 */
function openButtons(slots, urlFor) {
  const opens = el('div', 'tt-entry-opens');
  const here = new Set();
  const buttons = new Map();
  let presence = null;
  const label = (slot, role) => {
    const p = presence?.screens?.[slot];
    const where = !p?.online
      ? ''
      : here.has(slot)
        ? ' · open here'
        : ' · open on another computer';
    return `Open S${slot} · ${ROLES[role].label}${where}`;
  };
  for (const d of slots) {
    const b = btn('tt-btn', label(d.slot, d.role), () => {
      const p = presence?.screens?.[d.slot];
      if (p?.online && !here.has(d.slot) && b.dataset.ask !== '1') {
        b.dataset.ask = '1';
        b.textContent = `S${d.slot} is open on another computer · click again to move it here`;
        return;
      }
      delete b.dataset.ask;
      here.add(d.slot);
      openScreenWindow(d.slot, urlFor(d.slot));
    });
    buttons.set(d.slot, [b, d.role]);
    opens.append(b);
  }
  return {
    el: opens,
    update(p) {
      presence = p;
      for (const [slot, [b, role]] of buttons)
        if (b.dataset.ask !== '1') {
          b.textContent = label(slot, role);
          b.classList.toggle('on', Boolean(p?.screens?.[slot]?.online));
        }
    },
  };
}

export function showLaunch({ setup, cityKey, scenario }) {
  const box = el('div', 'tt-entry');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Open wall screens on this computer');
  const card = el('div', 'tt-entry-card tt-panel');
  box.append(card);
  document.body.append(box);
  const ob = openButtons(
    defaultRoles(6),
    (slot) =>
      `${location.origin}/twin.html?view=screen&slot=${slot}&setup=${setup}&city=${cityKey}&scenario=${scenario}`,
  );
  const opens = ob.el;
  // Watch who joins (a launcher can never command).
  connectSync({
    kind: 'launcher',
    setup,
    on: {
      welcome: (m) => ob.update(m.presence),
      presence: (m) => ob.update(m.presence),
      state: (m) => ob.update(m.presence),
    },
  });
  card.append(
    el('div', 'tt-kicker', 'MULTI-VIEW · SCREENS ON THIS COMPUTER'),
    el(
      'div',
      'tt-note',
      'Open the screens this computer shows (e.g. S3–S6 on four monitors). One window per click; Chrome places each on its own monitor when you allow window placement. Press ⌃⌘F for full screen.',
    ),
    opens,
    el(
      'div',
      'tt-note',
      'This link works for 10 minutes after Multi-view was started; screens opened from it rejoin on their own after that.',
    ),
  );
}

/**
 * showEntry({cityKey, scenario, tripId, siteKey(), pref, save, force})
 * Shows the choice unless one was remembered (force: always show).
 */
export function showEntry(o) {
  const remembered = o.pref('layout', null);
  if (remembered === 'all' && !o.force) return null;
  const box = el('div', 'tt-entry');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'How do you want to work?');
  const card = el('div', 'tt-entry-card tt-panel');
  box.append(card);
  document.body.append(box);
  let count = Number(o.pref('screens', 6)) || 6;
  let sync = null;
  let launchButtons = null;

  const close = () => {
    sync?.close();
    box.remove();
  };

  function choose() {
    card.replaceChildren(
      el('div', 'tt-kicker', 'TRIP TWIN · HOW DO YOU WANT TO WORK?'),
      (() => {
        const row = el('div', 'tt-entry-choices');
        const all = btn('tt-entry-choice', '', () => {
          o.save('layout', 'all');
          close();
        });
        all.append(
          el('span', 'n', '01'),
          el('span', 't', 'All in one'),
          el('span', 's', 'Everything on this screen'),
        );
        const multi = btn('tt-entry-choice', '', () => pickCount());
        multi.append(
          el('span', 'n', '02'),
          el('span', 't', 'Multi-view'),
          el(
            'span',
            's',
            '1–6 wall screens, each with its own role, controlled from an iPad or laptop',
          ),
        );
        row.append(all, multi);
        return row;
      })(),
      el('div', 'tt-note', 'You can switch later in Display (D).'),
    );
    card.querySelector('button')?.focus();
  }

  function pickCount() {
    const seg = el('div', 'tt-entry-count');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Number of wall screens');
    const roles = el('ol', 'tt-entry-roles');
    const paint = () => {
      for (const b of seg.children) {
        const on = Number(b.dataset.n) === count;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      }
      roles.replaceChildren(
        ...defaultRoles(count).map((d) =>
          el(
            'li',
            '',
            `S${d.slot} · ${ROLES[d.role].label}${d.merged.length ? ` (with ${d.merged.map((m) => ROLES[m].label.toLowerCase()).join(' and ')})` : ''} — ${ROLES[d.role].sub}`,
          ),
        ),
      );
    };
    for (let n = 1; n <= 6; n++) {
      const b = btn('tt-tb', String(n), () => {
        count = n;
        paint();
      });
      b.dataset.n = String(n);
      b.setAttribute('role', 'radio');
      seg.append(b);
    }
    paint();
    card.replaceChildren(
      el('div', 'tt-kicker', 'MULTI-VIEW · HOW MANY WALL SCREENS?'),
      seg,
      el(
        'div',
        'tt-entry-sub',
        'Suggested roles (change any of them from the remote)',
      ),
      roles,
      (() => {
        const a = el('div', 'tt-actions');
        a.append(
          btn('tt-btn primary', 'Start multi-view', () => start()),
          btn('tt-btn', 'Back', () => choose()),
        );
        return a;
      })(),
    );
  }

  async function start() {
    o.save('layout', 'multi');
    o.save('screens', String(count));
    card.replaceChildren(el('div', 'tt-note', 'Starting the session…'));
    const info = await fetch('/api/twin-sync/info')
      .then((r) => r.json())
      .catch(() => null);
    let asked = false;
    sync = connectSync({
      kind: 'launcher',
      on: {
        // Setup once — never again on a reconnect, which would wipe a live
        // wall (review R1).
        welcome() {
          if (asked) return;
          asked = true;
          sync.send({
            t: 'setup',
            count,
            tripId: o.tripId,
            siteKey: o.siteKey(),
          });
        },
        setup(m) {
          if (m.ok === false) {
            card.replaceChildren(
              el('div', 'tt-edit-flag', m.error),
              btn('tt-btn', 'Back', () => choose()),
            );
            return;
          }
          launch(m.setup, info);
        },
        presence: (m) => launchButtons?.update(m.presence),
        state: (m) => launchButtons?.update(m.presence),
      },
    });
  }

  async function launch(setup, info) {
    const port = info?.port || location.port;
    const lanHost = info?.lanListening && info.addresses?.[0];
    const base = lanHost
      ? `${location.protocol}//${lanHost}:${port}`
      : location.origin;
    const remoteUrl = `${base}/twin-remote.html?setup=${setup}`;
    const screenUrl = (slot) =>
      `${location.origin}/twin.html?view=screen&slot=${slot}&setup=${setup}&city=${o.cityKey}&scenario=${o.scenario}`;
    const openScreen = (slot) => openScreenWindow(slot, screenUrl(slot));
    const launchUrl = `${base}/twin.html?view=launch&setup=${setup}&city=${o.cityKey}&scenario=${o.scenario}`;
    const qr = el('img', 'tt-entry-qr');
    qr.alt = `QR code: open the remote at ${remoteUrl}`;
    QRCode.toDataURL(remoteUrl, {
      margin: 1,
      width: 220,
      color: { dark: '#040c12', light: '#eff7f3' },
    })
      .then((src) => (qr.src = src))
      .catch(() => {});
    launchButtons = openButtons(defaultRoles(count), screenUrl);
    const opens = launchButtons.el;
    void openScreen;
    const stepCard = (n, title, ...kids) => {
      const c = el('div', 'tt-entry-stepcard');
      c.append(el('div', 'tt-entry-step', `${n} · ${title}`), ...kids);
      return c;
    };
    const steps = el('div', 'tt-entry-steps');
    steps.append(
      stepCard(
        '1',
        'Screens on this computer',
        el(
          'div',
          'tt-note',
          'One window per click. Chrome places each on its own monitor when you allow window placement; ⌃⌘F for full screen.',
        ),
        opens,
      ),
      stepCard(
        '2',
        'The remote · iPad or laptop',
        (() => {
          const r = el('div', 'tt-entry-remote');
          const t = el('div');
          t.append(
            el(
              'div',
              '',
              'Point the iPad camera at this code. The remote opens already paired.',
            ),
            el('div', 'tt-entry-url', remoteUrl),
            lanHost
              ? el('div', 'tt-note', 'Same Wi-Fi as this computer.')
              : el(
                  'div',
                  'tt-edit-flag',
                  'Not listening on the network, so an iPad cannot reach it. Restart with HOST=0.0.0.0 npx vite --config vite.twin.config.js',
                ),
            (() => {
              const a = el('a', 'tt-link', 'Open the remote in this window');
              a.href = `/twin-remote.html?setup=${setup}`;
              return a;
            })(),
          );
          r.append(qr, t);
          return r;
        })(),
      ),
      stepCard(
        '3',
        'Screens on another computer',
        el(
          'div',
          'tt-note',
          'Open this link in Chrome on that computer (a Mac Studio, a TV), then open its screens there.',
        ),
        (() => {
          const r = el('div', 'tt-entry-copy');
          r.append(
            el('div', 'tt-entry-url', launchUrl),
            btn('tt-btn sm', 'Copy link', async (e) => {
              try {
                await navigator.clipboard.writeText(launchUrl);
                e.target.textContent = 'Copied';
              } catch {
                e.target.textContent = 'Copy failed';
              }
            }),
          );
          return r;
        })(),
        el(
          'div',
          'tt-note',
          `Any other device: open ${lanHost ? `${base}/twin.html?view=screen` : 'twin.html?view=screen'} for a 4-digit code, then Screens › Pair a screen on the remote.`,
        ),
      ),
    );
    card.replaceChildren(
      el(
        'div',
        'tt-kicker',
        `MULTI-VIEW · ${count} SCREEN${count > 1 ? 'S' : ''} + REMOTE`,
      ),
      steps,
      el(
        'div',
        'tt-note',
        'Setup codes last 10 minutes; paired devices rejoin on their own. Prototype: local network only, no sign-in.',
      ),
      (() => {
        const a = el('div', 'tt-actions');
        a.append(
          btn('tt-btn', 'Keep this window as All in one', close),
          btn('tt-btn', 'Start again', () => {
            sync?.close();
            choose();
          }),
        );
        return a;
      })(),
    );
  }

  if (remembered === 'multi' && !o.force) pickCount();
  else choose();
  return { close };
}
