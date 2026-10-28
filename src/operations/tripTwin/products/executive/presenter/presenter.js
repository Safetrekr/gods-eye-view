// SafeTrekr Executive B4: the presenter's iPad (twin-executive-remote.html;
// EP-31 §7, EP-33 §7, EP-36 §2.8, EP-38 #8/#12). It pairs like the school
// remote (connectSync, kind 'remote': the setup link once, then its
// token) and only the remote in control runs anything. The beat list
// (Next acts; Previous and a backward beat ask first), Pause / Resume,
// ×1 / ×10 / ×60, Reset the day (hold 2 s, then ask), phones scripted or
// live, each wall's role, and ORTEGA's two shortcuts, enabled only at
// their beats while the scripted event is still to come. Never a loop
// decision otherwise: the relay refuses one (EP-33 §1).
import './presenter.css';
import { connectSync } from '../../../twinSync.js';
import { lz } from '../format.js';

const BEATS = [
  [0, 'Quiet watch · the brief', 'America/Chicago'],
  [1, 'Austin · KESTREL reroute', 'America/Chicago'],
  [2, 'London · ATLAS keynote, two-person', 'Europe/London'],
  [3, 'DC · WREN doxx, re-tier, call-back', 'America/New_York'],
  [4, 'Storm line · SWIFT advisory', 'America/New_York'],
  [5, 'Close · six SITREPs, the record', 'America/New_York'],
];
const ROLES = [
  ['main', 'MAIN'],
  ['verify', 'Verify'],
  ['intel', 'Intel feed'],
  ['roster', 'Roster map'],
  ['principal', 'Principal view'],
  ['trips', 'Roster by trip'],
];
const SHORT = {
  'ortega.countersign': ['Countersign as ORTEGA now', 2],
  'ortega.retier': ['Confirm re-tier as ORTEGA now', 3],
};
const S = {
  clock: null,
  clockAt: 0,
  beats: null,
  count: 6,
  controller: false,
  anyController: false,
  status: 'connecting',
  ask: null,
  denied: null,
};

const app = document.getElementById('pr-app');
const params = new URLSearchParams(location.search);
const sync = connectSync({
  kind: 'remote',
  setup: params.get('setup'),
  name: 'iPad',
  on: {
    status(s) {
      S.status = s;
      render();
    },
    welcome(m) {
      if (m.type === 'denied') {
        S.denied = m.error || m.code;
        return render();
      }
      S.denied = null;
      if (params.has('setup')) {
        params.delete('setup');
        history.replaceState(null, '', `?${params}`);
      }
      S.controller = Boolean(m.controller);
      S.count = m.state?.count ?? S.count;
      S.anyController = Boolean(m.presence?.anyController);
      render();
    },
    state(m) {
      S.count = m.state?.count ?? S.count;
      if (m.presence) {
        S.controller = Boolean(m.presence.youControl);
        S.anyController = Boolean(m.presence.anyController);
      }
      render();
    },
    presence(m) {
      S.controller = Boolean(m.presence?.youControl);
      S.anyController = Boolean(m.presence?.anyController);
      render();
    },
    control(m) {
      if (m.granted) S.controller = true;
      toast(
        m.granted
          ? 'You are in control'
          : 'Asked for control · the remote in control decides',
      );
      render();
    },
    loop(m) {
      S.clock = m.clock;
      S.clockAt = Date.now();
      S.beats = m.loop?.beats ?? S.beats;
      document.body.dataset.exSim = m.clock?.simNow ?? '';
      render();
    },
    'loop-clock'(m) {
      S.clock = m.clock;
      S.clockAt = Date.now();
      document.body.dataset.exSim = m.clock?.simNow ?? '';
      render();
    },
  },
});

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );

let toastTimer = null;
function toast(text) {
  let el = document.getElementById('pr-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pr-toast';
    el.className = 'pr-toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

const WORDS = {
  WRONG_BEAT: 'Not at this beat',
  NOT_PENDING: 'Already done in this run',
  NO_CHECKPOINT: 'No checkpoint that way',
  LEASE_NOT_CONTROLLER: 'Only the remote in control',
  NOT_FOUND: 'Not yet: VALE has not assessed it',
  CONFIRM_STALE: 'The question timed out · ask again',
};
/** One presenter command; an ask-first answer opens the question. */
async function cmd(c) {
  const r = await sync.request({ t: 'loop-cmd', cmd: c });
  if (r.code === 'CONFIRM_REQUIRED' && r.ask) {
    S.ask = { ...r.ask, until: Date.now() + r.ask.expiresInMs };
    render();
    return r;
  }
  if (!r.ok)
    toast(
      `${WORDS[r.code] || r.error || r.code || 'Refused'} · nothing changed`,
    );
  return r;
}

function beatTime(n) {
  const a = S.beats?.[n];
  return a ? lz(a, BEATS[n][2]) : '';
}

function render() {
  const c = S.clock;
  if (S.denied) {
    app.innerHTML = `<div class="pr-denied"><h1>SafeTrekr Executive · Presenter</h1><p>${esc(S.denied)}</p><p class="pr-dim">Open the presenter link from the setup code on the Trip Twin computer.</p></div>`;
    return;
  }
  const beat = c?.beat ?? 0;
  const sim = c ? Date.parse(c.simNow) : null;
  const tz = BEATS[beat]?.[2] ?? 'UTC';
  const head = `<header class="pr-head">
      <span class="pr-brand"><img src="/safetrekr-logo.svg" alt="SafeTrekr" width="89" height="16"><span class="pr-sep"></span><span class="pr-name">Executive</span><span class="pr-sub">Presenter</span></span>
      <span class="pr-sample">SAMPLE</span>
      <span class="pr-ctl ${S.controller ? 'on' : ''}">${S.status !== 'online' ? esc(S.status) : S.controller ? 'In control' : `Viewing <button type="button" class="pr-btn small" data-take>Take control</button>`}</span>
    </header>`;
  const clock = `<section class="pr-clock">
      <div class="pr-beat">Beat ${beat}${c?.checkpoint ? ` · checkpoint ${c.checkpoint.checkpoint}` : ''}</div>
      <div class="pr-time">${sim ? esc(lz(Math.floor(sim / 60e3) * 60e3, tz)) : '—'}</div>
      <div class="pr-state">${c ? (c.paused ? (c.held === 'checkpoint' ? 'held at the checkpoint' : c.held === 'end' ? 'end of the day' : 'paused') : `running ×${c.rate}`) : 'connecting'}${c?.setAside ? ` · ${c.setAside} live actions set aside` : ''}</div>
    </section>`;
  const beats = BEATS.map(
    ([n, title]) =>
      `<button type="button" class="pr-tile${n === beat ? ' cur' : ''}" data-beat="${n}"><b>${n}</b><span>${esc(title)}</span><em>${esc(beatTime(n))}</em></button>`,
  ).join('');
  const rate = [1, 10, 60]
    .map(
      (r) =>
        `<button type="button" class="pr-seg${c?.rate === r ? ' on' : ''}" data-rate="${r}">×${r}</button>`,
    )
    .join('');
  const shortcuts = Object.entries(SHORT)
    .map(([name, [label, at]]) => {
      const s = c?.shortcuts?.[name];
      const ready = Boolean(s?.ready);
      const hint = s
        ? ready
          ? `script ${s.at.slice(11, 16).replace(':', '')}Z · now takes its place`
          : `waiting for VALE · script ${s.at.slice(11, 16).replace(':', '')}Z`
        : beat === at
          ? 'done in this run'
          : `beat ${at} only`;
      return `<button type="button" class="pr-big${ready ? ' ready' : ''}" data-short="${name}" ${ready ? '' : 'disabled'}><b>${esc(label)}</b><em>${esc(hint)}</em></button>`;
    })
    .join('');
  const phones = ['scripted', 'live']
    .map(
      (m) =>
        `<button type="button" class="pr-seg${(c?.phones ?? 'scripted') === m ? ' on' : ''}" data-phones="${m}">${m === 'scripted' ? 'Scripted' : 'Live (tap answers)'}</button>`,
    )
    .join('');
  const walls = Array.from(
    { length: Math.min(6, S.count || 6) },
    (_, i) => i + 1,
  )
    .map(
      (n) =>
        `<label class="pr-wall"><span>S${n}</span><select data-wall="${n}">${ROLES.map(([k, l]) => `<option value="${k}"${c?.roles?.[n] === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`,
    )
    .join('');
  const ask = S.ask
    ? `<div class="pr-ask"><div class="pr-ask-card"><p>${esc(S.ask.text)}</p><div class="pr-row"><button type="button" class="pr-btn primary" data-yes>Yes</button><button type="button" class="pr-btn" data-no>No</button></div></div></div>`
    : '';
  const off = S.controller ? '' : ' disabled';
  app.innerHTML = `${head}
    <main class="pr-grid${S.controller ? '' : ' viewing'}">
      ${clock}
      <section class="pr-beats"><h2>BEATS</h2><div class="pr-tiles">${beats}</div>
        <div class="pr-row">
          <button type="button" class="pr-btn" data-prev${off}>‹ Previous beat</button>
          <button type="button" class="pr-btn" data-pause${off}>${c?.paused ? 'Resume' : 'Pause'}</button>
          <button type="button" class="pr-btn primary" data-next${off}>Next beat ›</button>
        </div>
        <div class="pr-row"><span class="pr-k">SPEED</span>${rate}<span class="pr-gap"></span><button type="button" class="pr-btn danger" data-reset${off}>Reset the day <em>hold 2 s</em></button></div>
      </section>
      <section class="pr-short"><h2>ORTEGA (SUPERVISOR) · PRESENTER SHORTCUTS</h2>${shortcuts}<p class="pr-dim">Scripted at their times; pressing one sends ORTEGA’s decision now. On record as from the presenter.</p></section>
      <section class="pr-phones"><h2>PHONES</h2><div class="pr-row">${phones}</div></section>
      <section class="pr-walls"><h2>WALLS</h2><div class="pr-wall-grid">${walls}</div></section>
    </main>${ask}`;
}

app.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t || t.disabled) return;
  if (t.hasAttribute('data-take')) return sync.send({ t: 'request-control' });
  if (t.hasAttribute('data-yes') && S.ask) {
    const id = S.ask.id;
    S.ask = null;
    render();
    return cmd({ type: 'confirm', id });
  }
  if (t.hasAttribute('data-no') && S.ask) {
    const id = S.ask.id;
    S.ask = null;
    render();
    return cmd({ type: 'cancel', id });
  }
  if (!S.controller) return toast('Viewing · take control first');
  if (t.dataset.beat != null)
    return cmd({ type: 'beat.go', n: Number(t.dataset.beat) });
  if (t.hasAttribute('data-next')) return cmd({ type: 'next' });
  if (t.hasAttribute('data-prev')) return cmd({ type: 'previous' });
  if (t.hasAttribute('data-pause'))
    return cmd({ type: S.clock?.paused ? 'clock.resume' : 'clock.pause' });
  if (t.dataset.rate)
    return cmd({ type: 'clock.rate', rate: Number(t.dataset.rate) });
  if (t.dataset.short) return cmd({ type: t.dataset.short });
  if (t.dataset.phones)
    return cmd({ type: 'phones.mode', mode: t.dataset.phones });
});
app.addEventListener('change', (e) => {
  const t = e.target.closest('select[data-wall]');
  if (!t) return;
  if (!S.controller) return toast('Viewing · take control first');
  cmd({ type: 'wall.role', slot: Number(t.dataset.wall), role: t.value });
});
// Reset is hidden behind a 2 s hold (EP-36 §2.8), then asks first.
let hold = null;
app.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('[data-reset]');
  if (!t || t.disabled) return;
  t.classList.add('holding');
  hold = setTimeout(() => {
    hold = null;
    t.classList.remove('holding');
    cmd({ type: 'reset' });
  }, 2000);
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel'])
  app.addEventListener(ev, () => {
    if (hold) clearTimeout(hold);
    hold = null;
    document.querySelector('[data-reset].holding')?.classList.remove('holding');
  });
setInterval(() => {
  if (S.ask && Date.now() > S.ask.until) {
    S.ask = null;
    render();
  }
}, 500);
render();

// A seam for the QA script: the same controller socket, nothing more.
window.__exPresenter = {
  loop: (c) => sync.request({ t: 'loop-cmd', cmd: c }),
  takeControl: () => sync.send({ t: 'request-control' }),
  get controller() {
    return S.controller;
  },
};
