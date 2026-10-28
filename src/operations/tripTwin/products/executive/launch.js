// SafeTrekr Executive: the room launcher (twin-executive.html?view=launch),
// on the computer that runs the server. The school launcher builds its wall
// links on twin.html, so the executive room needs its own: one setup for six
// walls, then the links in the room preset's slot order (main, verify, intel,
// roster, principal, trips; the host applies the roles when the presenter
// takes control), the presenter's QR, and the desk, phone and record pages.
// The setup is asked once per launch code and kept for this tab, so a reload
// never wipes a live room; "New room" asks again.
import QRCode from 'qrcode';
import { connectSync } from '../../twinSync.js';

const KEY = 'tt-exec-launch';
const WALLS = [
  'MAIN',
  'Verify',
  'Intel feed',
  'Roster map',
  'Principal view',
  'Roster by trip',
];

const css = `
.ex-launch{position:fixed;inset:0;overflow:auto;background:#040c12;color:#e6eef0;
 font:15px/1.45 Inter,system-ui,sans-serif;padding:32px;z-index:99}
.ex-launch h1{font:300 30px Manrope,Inter,sans-serif;margin:0 0 4px}
.ex-launch .k{font:600 11px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.14em;
 text-transform:uppercase;color:#8aa3ab;margin:24px 0 10px}
.ex-launch .sample{display:inline-block;background:#e6eef0;color:#040c12;
 font:700 11px "JetBrains Mono",monospace;letter-spacing:.14em;padding:3px 8px;margin-left:10px}
.ex-launch .row{display:flex;gap:12px;align-items:center;margin:6px 0;flex-wrap:wrap}
.ex-launch button{background:#0d1c24;color:#e6eef0;border:1px solid #2b4450;border-radius:8px;
 padding:8px 14px;font:inherit;cursor:pointer}
.ex-launch button:hover{border-color:#8aa3ab}
.ex-launch code{font:12px "JetBrains Mono",monospace;color:#b8c9ce;word-break:break-all}
.ex-launch .slot{width:150px;font-weight:600}
.ex-launch img{background:#eef5f3;border-radius:8px}
.ex-launch .note{color:#8aa3ab;max-width:760px}
.ex-launch .err{color:#f0b35a}
`;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const style = el('style');
style.textContent = css;
const root = el('div', 'ex-launch');
document.head.append(style);
document.body.append(root);

function header() {
  const h = el('h1', null, 'SafeTrekr Executive · set up the room');
  h.append(el('span', 'sample', 'SAMPLE'));
  return h;
}

function choose(error) {
  root.replaceChildren(header());
  root.append(
    el(
      'p',
      'note',
      'Sets up six walls for the scripted demo day. Open the wall links on the wall screens (or here, one window per wall), then open the presenter page on the iPad from the QR code and take control: the walls get their roles from the room preset.',
    ),
  );
  if (error) root.append(el('p', 'err', error));
  const go = el('button', null, 'Set up six walls');
  go.onclick = () => start();
  root.append(go);
}

async function start() {
  root.replaceChildren(header(), el('p', 'note', 'Starting the room…'));
  const info = await fetch('/api/twin-sync/info')
    .then((r) => r.json())
    .catch(() => null);
  let asked = false;
  const sync = connectSync({
    kind: 'launcher',
    on: {
      welcome() {
        if (asked) return;
        asked = true;
        sync.send({ t: 'setup', count: 6, tripId: null, siteKey: null });
      },
      setup(m) {
        sync.close();
        if (m.ok === false || !m.setup) {
          choose(m.error || 'The relay refused the setup.');
          return;
        }
        try {
          sessionStorage.setItem(KEY, JSON.stringify({ setup: m.setup, info }));
        } catch {
          /* the links still work until this tab reloads */
        }
        show(m.setup, info);
      },
    },
  });
}

function show(setup, info) {
  const port = info?.port || location.port;
  const lanHost = info?.lanListening && info.addresses?.[0];
  const base = lanHost
    ? `${location.protocol}//${lanHost}:${port}`
    : location.origin;
  const wall = (slot, origin) =>
    `${origin}/twin-executive.html?view=screen&slot=${slot}&setup=${setup}&city=austin&scenario=baseline`;
  const presenter = `${base}/twin-executive-remote.html?setup=${setup}`;

  root.replaceChildren(header());
  root.append(el('div', 'k', '1 · Walls'));
  WALLS.forEach((role, i) => {
    const slot = i + 1;
    const row = el('div', 'row');
    const open = el('button', null, `Open S${slot} here`);
    open.onclick = () =>
      window.open(wall(slot, location.origin), `tt-exec-wall-${slot}`);
    row.append(el('span', 'slot', `S${slot} · ${role}`), open);
    row.append(el('code', null, wall(slot, base)));
    root.append(row);
  });
  root.append(
    el(
      'p',
      'note',
      'Each window: ⌃⌘F for full screen. A wall screen elsewhere on the network opens its link above.',
    ),
  );

  root.append(el('div', 'k', '2 · Presenter (iPad)'));
  const qr = el('img');
  qr.width = 220;
  qr.alt = `QR code: open the presenter at ${presenter}`;
  QRCode.toDataURL(presenter, {
    margin: 1,
    width: 220,
    color: { dark: '#040c12', light: '#eef5f3' },
  })
    .then((src) => (qr.src = src))
    .catch(() => {});
  const prow = el('div', 'row');
  prow.append(qr, el('code', null, presenter));
  root.append(
    prow,
    el(
      'p',
      'note',
      'Scan on the iPad, then take control: the room preset gives every wall its role. Keep phones on Scripted on stage.',
    ),
  );

  root.append(el('div', 'k', '3 · This computer and the phones'));
  const links = [
    [
      'Analyst desk (this computer only)',
      `${location.origin}/twin-executive.html?as=desk`,
    ],
    ['Phones (pair from the presenter page)', `${base}/twin-phone.html`],
    [
      'The day’s record (print)',
      `${location.origin}/twin-executive-record.html`,
    ],
  ];
  for (const [label, url] of links) {
    const row = el('div', 'row');
    const open = el('button', null, 'Open');
    open.onclick = () => window.open(url, '_blank');
    row.append(el('span', 'slot', label), open, el('code', null, url));
    root.append(row);
  }

  root.append(el('div', 'k', 'New room'));
  const again = el('button', null, 'Set up a new room');
  again.onclick = () => {
    if (!confirm('A new room unpairs every wall and the iPad. Continue?'))
      return;
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* nothing kept */
    }
    start();
  };
  root.append(again);
}

let kept = null;
try {
  kept = JSON.parse(sessionStorage.getItem(KEY) || 'null');
} catch {
  kept = null;
}
if (kept?.setup) show(kept.setup, kept.info);
else choose();
