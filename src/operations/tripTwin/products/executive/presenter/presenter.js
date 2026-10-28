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
import QRCode from 'qrcode';
import { connectSync } from '../../../twinSync.js';
import { lz, watchTime } from '../format.js';
import { ASK } from '../record/printPages.js';

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
/**
 * What the presenter says at each beat (EP-20: beat 0's presenter line,
 * the point of beats 1–4, beat 5's one line and the ask, verbatim).
 */
export const SAY = Object.freeze({
  0: [
    "186 items so far today. A human looked at the two that touched your people, and neither needed you. Our intake and our partners' feeds both land here. We don't claim to see everything. We claim that what reaches your people is checked by a person.",
  ],
  1: [
    'A VP with no detail, protected by the watch: one instruction, acknowledged, followed through, recorded.',
  ],
  2: [
    "The watch advises; the detail leader decides on evidence from his own advance. Both decisions are on the record. That's how protective operations work.",
  ],
  3: [
    "People don't always answer; the system doesn't stop asking, and a supervisor decided the change.",
  ],
  4: ["Most items end 'no change'. That's what verification is for."],
  5: [
    "SafeTrekr's watch floor is staffed around the clock. Your lead sees what we see.",
    ASK,
  ],
});

/**
 * The storyboard's moments per beat, in order, each with how the loop
 * shows it done: the presenter's "next on the script" when the host sends
 * no `next` of its own (F2-NOTES ask 6). Reads the loop only.
 */
const sit = (l, id) => l?.situations?.[id];
const pushOf = (l, id) => {
  const s = sit(l, id);
  return s?.push_id ? l.pushes?.[s.push_id] : null;
};
const rungOf = (l, id, pid, rung) =>
  Boolean(pushOf(l, id)?.recipients?.[pid]?.at?.[rung]);
const closed = (l, id) => sit(l, id)?.state === 'CLOSED';
export const CUES = Object.freeze({
  0: [['Nothing waits · Next opens Austin', () => false]],
  1: [
    ['KESTREL raised: the march near lunch', (l) => sit(l, 's-kestrel-01')],
    ['VALE verifies KESTREL', (l) => sit(l, 's-kestrel-01')?.verification_id],
    ['VALE pushes the reroute', (l) => sit(l, 's-kestrel-01')?.push_id],
    [
      'KESTREL accepts',
      (l) => rungOf(l, 's-kestrel-01', 'p-kestrel', 'accepted'),
    ],
    ['KESTREL done', (l) => rungOf(l, 's-kestrel-01', 'p-kestrel', 'done')],
    ['VALE signs the SITREP · closed', (l) => closed(l, 's-kestrel-01')],
  ],
  2: [
    ['ATLAS raised: the post before the keynote', (l) => sit(l, 's-atlas-01')],
    ['VALE assesses ATLAS', (l) => sit(l, 's-atlas-01')?.verification_id],
    [
      'ORTEGA countersigns',
      (l) =>
        l?.verifications?.[sit(l, 's-atlas-01')?.verification_id]
          ?.countersigned_by,
    ],
    ['VALE pushes to ATLAS 6', (l) => sit(l, 's-atlas-01')?.push_id],
    [
      'ATLAS 3 files the SALUTE',
      (l) => (sit(l, 's-atlas-01')?.salute_ids || []).length,
    ],
    [
      'ATLAS 6 answers: NON-CONCUR',
      (l) =>
        Object.values(pushOf(l, 's-atlas-01')?.recipients || {}).some(
          (r) => r.dl,
        ),
    ],
    [
      'The watch acknowledges',
      (l) =>
        (l?.messages || []).some(
          (m) => m.sit_id === 's-atlas-01' && m.kind === 'watch_ack',
        ),
    ],
    ['Stand-down · VALE signs · closed', (l) => closed(l, 's-atlas-01')],
  ],
  3: [
    ['WREN raised: the doxx', (l) => sit(l, 's-wren-01')],
    ['VALE verifies WREN', (l) => sit(l, 's-wren-01')?.verification_id],
    [
      'ORTEGA re-tiers WREN',
      (l) => (l?.retiers || []).some((r) => r.person_id === 'p-wren'),
    ],
    ['VALE pushes the car service', (l) => sit(l, 's-wren-01')?.push_id],
    [
      'No read · the call-back runs',
      (l) => l?.callbacks?.[sit(l, 's-wren-01')?.push_id],
    ],
    ['WREN answers', (l) => rungOf(l, 's-wren-01', 'p-wren', 'accepted')],
    ['WREN done · closed', (l) => closed(l, 's-wren-01')],
  ],
  4: [
    ['SWIFT raised: the storm line', (l) => sit(l, 's-swift-01')],
    ['VALE pushes the advisory', (l) => sit(l, 's-swift-01')?.push_id],
    [
      'Both check in',
      (l) =>
        rungOf(l, 's-swift-01', 'p-swift1', 'accepted') &&
        rungOf(l, 's-swift-01', 'p-swift2', 'accepted'),
    ],
    ['VALE signs · closed', (l) => closed(l, 's-swift-01')],
  ],
  5: [
    [
      'Daily SITREP signed · the record opens',
      (l) =>
        Object.values(l?.sitreps || {}).some((r) => r.daily && r.signed_at),
    ],
  ],
});
/** The next storyboard moment in this beat not yet in the loop. */
export function nextCue(loop, beat) {
  for (const [label, done] of CUES[beat] || []) if (!done(loop)) return label;
  return beat < 5 ? 'Beat done · Next when ready' : 'The day is closed';
}

/** The storyboard phones a presenter can pair (twin-phone.html's chooser). */
const PHONES = [
  ['p-kestrel', 'KESTREL'],
  ['p-harrier', 'HARRIER'],
  ['p-atlas6', 'ATLAS 6'],
  ['p-atlas3', 'ATLAS 3'],
  ['p-wren', 'WREN'],
  ['p-swift1', 'SWIFT 1'],
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
  loop: null,
  link: null,
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
      if (m.loop) S.loop = m.loop;
      if (m.next !== undefined) S.next = m.next;
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

/** Held phone replies (live mode): the host's count, under any name it sends. */
function heldOf(c) {
  const n = Number(c?.heldReplies ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const VERB = {
  'intel.dismiss': 'dismisses an item',
  'intel.watch': 'watches an item',
  'verification.decide': 'verifies',
  'verification.countersign': 'countersigns',
  'recommendation.approve': 'approves',
  'push.send': 'pushes',
  'notify.send': 'notifies',
  'message.send': 'messages',
  'message.countersign': 'countersigns the reply',
  'posture.retier': 're-tiers',
  'callback.step': 'calls',
  'sitrep.sign': 'signs the SITREP',
  'situation.close': 'closes',
  'dl.respond': 'the detail leader answers',
  'salute.file': 'the advance files a SALUTE',
  ack: 'answers',
  'checkin.respond': 'checks in',
  'sharing.set': 'turns sharing on',
};
/** `1604Z · VALE verifies KESTREL · in 0:06` (the host's nextScript, ids only). */
function nextLine(c, beat) {
  const n = c?.nextScript || c?.next || S.next;
  if (n && n.at && (n.beat == null || n.beat === beat)) {
    const sim = Date.parse(c.simNow);
    const rate = c.paused ? 0 : Number(c.rate) || 1;
    const real = rate ? Math.max(0, (Date.parse(n.at) - sim) / rate) : null;
    const mmss =
      real == null
        ? 'paused'
        : `in ${Math.floor(real / 60e3)}:${String(Math.floor((real % 60e3) / 1000)).padStart(2, '0')}`;
    const cs = S.loop?.situations?.[n.sit_id]?.callsign ?? null;
    const verb = VERB[n.type] || n.type;
    const what = n.by
      ? `${n.by} ${verb}${cs ? ` ${cs}` : ''}`
      : `${cs ? `${cs} · ` : ''}${verb}`;
    return `${watchTime(n.at)} · ${what} · ${mmss}`;
  }
  return nextCue(S.loop, beat);
}

async function phoneLink(pid, label) {
  const r = await cmd({ type: 'phone.ticket', participant_id: pid });
  if (!r?.ok || !r.ticket) return;
  const url = `${location.origin}/twin-phone.html?ticket=${encodeURIComponent(r.ticket)}`;
  S.link = {
    pid,
    label,
    url,
    until: Date.now() + (r.ttlMs || 600e3),
    qr: null,
  };
  render();
  QRCode.toDataURL(url, {
    margin: 1,
    width: 220,
    color: { dark: '#040c12', light: '#eef5f3' },
  })
    .then((src) => {
      if (S.link?.url === url) {
        S.link.qr = src;
        render();
      }
    })
    .catch(() => {});
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
      ${heldOf(c) > 0 ? `<div class="pr-warn">${heldOf(c)} phone ${heldOf(c) === 1 ? 'reply' : 'replies'} held · the scripted close will refuse · set phones to Scripted</div>` : ''}
      <div class="pr-next"><span class="pr-k">NEXT ON THE SCRIPT</span><span>${esc(nextLine(c, beat))}</span></div>
    </section>
    <section class="pr-say"><h2>SAY · BEAT ${beat}</h2>${(SAY[beat] || []).map((l) => `<p>${esc(l)}</p>`).join('')}</section>`;
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
      <section class="pr-short"><h2>ORTEGA (SUPERVISOR) · PRESENTER SHORTCUTS</h2>${shortcuts}<p class="pr-dim">Scripted at their times; pressing one sends ORTEGA’s decision now. On the relay audit as from the presenter; the day’s record shows ORTEGA.</p></section>
      <section class="pr-phones"><h2>PHONES</h2><div class="pr-row">${phones}</div>
        <div class="pr-row pr-links"><span class="pr-k">PHONE LINK</span>${PHONES.map(([pid, cs]) => `<button type="button" class="pr-seg" data-link="${pid}" data-cs="${esc(cs)}"${off}>${esc(cs)}</button>`).join('')}</div>
        ${S.link && Date.now() < S.link.until ? `<div class="pr-link"><div class="pr-link-txt"><b>${esc(S.link.label)}</b><span class="pr-mono">${esc(S.link.url)}</span><em>once only · expires ${esc(new Date(S.link.until).toTimeString().slice(0, 5))} · open on the phone or scan</em></div>${S.link.qr ? `<img src="${S.link.qr}" alt="QR code: the phone link for ${esc(S.link.label)}" width="132" height="132">` : ''}</div>` : ''}
      </section>
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
  if (t.dataset.link) return phoneLink(t.dataset.link, t.dataset.cs);
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
