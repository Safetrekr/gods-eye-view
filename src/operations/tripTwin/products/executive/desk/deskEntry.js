// SafeTrekr Executive B4: the analyst's desk (twin-executive.html?as=desk),
// the single view on this computer (EP-31 §3, EP-34 §4). Its own socket
// (kind 'desk', this computer only); every action is a desk intent the
// relay turns into loop events, pre-empting the scripted one it stands
// for. Keys (EP-34 §4): A oldest raised, ] [ next and previous in the
// queue, ↑ ↓ selection, E evidence, R recommendation, K record, Enter the
// card's primary action, Esc back one level (sheet → confirm → card),
// letters inside a card (V U W D G B X C N M S T O), Z undo (10 s). The
// supervisor switch is visible: acting as ORTEGA turns the header amber.
import './desk.css';
import '../record/record.css';
import { deskDayNode, deskRecordNode } from './deskRecord.js';
import { connectExec, simNowOf } from '../host/execClient.js';
import { dtg, zl } from '../format.js';
import {
  crumb,
  deskActions,
  deskLists,
  esc,
  evidenceHtml,
  recommendationHtml,
  recordHtml,
  stateWord,
  tte,
  who,
} from './deskView.js';

const BEAT_TZ = {
  0: 'America/Chicago',
  1: 'America/Chicago',
  2: 'Europe/London',
  3: 'America/New_York',
  4: 'America/New_York',
  5: 'America/New_York',
};
const S = {
  loop: null,
  desk: null,
  clock: null,
  clockAt: 0,
  undo: null,
  undoAt: 0,
  sel: null,
  tab: 'evidence',
  as: 'VALE',
  sheet: null,
  confirm: null,
  status: 'connecting',
  busy: false,
};

document.title = 'SafeTrekr Executive · Analyst desk (SAMPLE)';
document.body.className = 'dk-body';
const app = document.createElement('div');
app.id = 'dk-app';
app.innerHTML = `
  <header class="dk-bar">
    <span class="dk-brand"><img src="/safetrekr-logo.svg" alt="SafeTrekr" width="89" height="16"><span class="dk-brand-sep"></span><span class="dk-brand-name">Executive</span><span class="dk-brand-sub">Analyst desk</span></span>
    <span class="dk-bar-mid"><span class="dk-sample">SAMPLE</span><span id="dk-rate" class="dk-rate"></span><span id="dk-clock" class="dk-clock"></span><span id="dk-link" class="dk-link"></span></span>
    <span class="dk-as" role="group" aria-label="Acting as">
      <button type="button" data-as="VALE" aria-pressed="true">VALE · analyst</button>
      <button type="button" data-as="ORTEGA" aria-pressed="false">ORTEGA · supervisor</button>
    </span>
  </header>
  <div id="dk-asline" class="dk-asline" hidden>Acting as ORTEGA · supervisor · countersign and re-tier are yours</div>
  <aside id="dk-left" class="dk-left"></aside>
  <main id="dk-main" class="dk-main"></main>
  <footer id="dk-foot" class="dk-foot"></footer>
  <div id="dk-sheet" class="dk-sheet" hidden></div>
  <div id="dk-toast" class="dk-toast" hidden></div>`;
document.body.replaceChildren(app);
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- render
const simNow = () =>
  S.clock ? simNowOf(S.clock, S.clockAt, Date.now()) : null;
const selSit = () => S.sel && S.loop?.situations[S.sel];
const tzNow = () =>
  (selSit() && S.loop.legs[selSit().leg_id]?.tz) ||
  BEAT_TZ[S.clock?.beat ?? 0] ||
  'UTC';

function renderBar() {
  const t = simNow();
  if (t != null) {
    // Minutes only; seconds never tick (EP-32 §0).
    const at = Math.floor(t / 60e3) * 60e3;
    $('dk-clock').textContent =
      `${dtg(at)} · ${zl(at, tzNow()).split(' ')[1].replace(/[()]/g, '')}`;
  }
  const c = S.clock;
  $('dk-rate').textContent = c
    ? c.paused
      ? 'paused'
      : Number(c.rate) > 1
        ? `accelerated ×${c.rate}`
        : 'real time'
    : '';
  $('dk-link').textContent =
    S.status === 'online'
      ? ''
      : S.status === 'offline'
        ? 'offline'
        : 'connecting';
  for (const b of document.querySelectorAll('.dk-as button'))
    b.setAttribute('aria-pressed', String(b.dataset.as === S.as));
  document.body.classList.toggle('as-ortega', S.as === 'ORTEGA');
  $('dk-asline').hidden = S.as !== 'ORTEGA';
  renderUndo();
}

function renderLeft() {
  const L = deskLists(S.loop);
  const loop = S.loop;
  const q = L.queue
    .map((x) => {
      const s = loop.situations[x.sit_id];
      const script = (S.desk?.pending || []).find(
        (p) => p.sit_id === x.sit_id && p.type === 'verification.decide',
      );
      return `<li class="dk-q${x.sit_id === S.sel ? ' sel' : ''}${x.overdue ? ' overdue' : ''}" data-sit="${esc(x.sit_id)}">
        <div class="dk-q-top"><span class="dk-mono">raised ${esc(x.raised_at.slice(11, 16).replace(':', ''))}Z</span>${s.tier === 'DETAIL' ? '<span class="dk-tag">2-PERSON</span>' : ''}<span class="dk-grade">${esc(s.grade ?? '')}</span><span class="dk-q-tte ${x.overdue ? 'amber' : ''}">${x.overdue ? 'OVERDUE' : esc(tte(x.time_to_exposure_s))}</span></div>
        <div class="dk-q-who">${who(loop, s.person_id)}</div>
        <div class="dk-q-why">${esc(x.why_raised || '')}</div>
        <div class="dk-q-foot">${x.awaiting === 'countersign' ? '<span class="amber">awaiting ORTEGA</span>' : 'awaiting verification'}${script ? ` · <span class="dk-dim">script ${esc(script.at.slice(11, 16).replace(':', ''))}Z</span>` : ''}</div>
      </li>`;
    })
    .join('');
  const sits = L.situations
    .map((x) => {
      const s = loop.situations[x.sit_id];
      return `<li class="dk-s${x.sit_id === S.sel ? ' sel' : ''}" data-sit="${esc(x.sit_id)}"><div>${who(loop, s.person_id)}</div><div class="dk-mono dk-s-state">${esc(stateWord(loop, s))}</div></li>`;
    })
    .join('');
  const closed = L.closed
    .map(
      (s) =>
        `<li class="dk-c${s.sit_id === S.sel ? ' sel' : ''}" data-sit="${esc(s.sit_id)}"><span class="dk-cs">${esc(s.callsign)}</span> <span class="dk-mono dk-dim">${esc(stateWord(loop, s))}</span></li>`,
    )
    .join('');
  const decided = L.decided
    .map(
      (b) =>
        `<li class="dk-d"><span class="dk-mono">${esc(b.decided.at.slice(11, 16).replace(':', ''))}Z</span> ${esc(b.decided.kind === 'dismiss' ? 'dismissed' : 'watch')} · <span class="dk-dim">${esc(b.decided.reason || b.title || b.bundle_id)}</span> · ${esc(b.decided.by)} <button type="button" class="dk-mini" data-restore="${esc(b.bundle_id)}">Restore</button></li>`,
    )
    .join('');
  $('dk-left').innerHTML = `
    <div class="dk-watch">Watch: SafeTrekr Watch Floor · VALE · ORTEGA · Your lead: viewing${loop.lastHuman ? ` · last verified by a human ${esc(loop.lastHuman.at.slice(11, 16).replace(':', ''))}Z · ${esc(loop.lastHuman.by)}` : ''}</div>
    <section><h2 class="dk-h">NEEDS VERIFICATION <span class="${L.queue.length ? 'amber' : ''}">${L.queue.length}</span></h2>
      <div class="dk-qline">${esc(L.queueLine.replace('Queue: empty', 'Queue: 0 awaiting'))} <kbd>A</kbd></div>
      <ol class="dk-list">${q || '<li class="dk-none">No one awaiting verification</li>'}</ol></section>
    <section><h2 class="dk-h">SITUATIONS <span>${L.situations.length}</span></h2><ol class="dk-list">${sits || '<li class="dk-none">No active situations</li>'}</ol></section>
    <section><h2 class="dk-h">CLOSED TODAY <span>${L.closed.length}</span></h2><ol class="dk-list dk-closed">${closed || '<li class="dk-none">—</li>'}</ol></section>
    <section><h2 class="dk-h">DECIDED IN THE FEED</h2><ol class="dk-list dk-decided">${decided || '<li class="dk-none">—</li>'}</ol></section>`;
  const c = L.counter;
  $('dk-foot').innerHTML = [
    ['IN (INTAKE + PARTNER FEEDS)', c.in],
    ['MATCHED', c.matched],
    ['RAISED', c.raised],
    ['PUSHED', c.pushed],
    ['CLOSED', c.closed],
  ]
    .map(([k, n]) => `<span class="dk-num"><b>${n}</b><i>${k}</i></span>`)
    .join('');
  document.body.dataset.exCounter = [
    c.in,
    c.matched,
    c.raised,
    c.pushed,
    c.closed,
  ].join('·');
}

function renderMain() {
  const loop = S.loop;
  const sit = selSit();
  if (!sit) {
    if (S.tab === 'record') {
      // K with nothing selected: the day's record (B6).
      $('dk-main').replaceChildren(deskDayNode(loop));
      return;
    }
    $('dk-main').innerHTML =
      `<div class="dk-empty"><div class="dk-empty-big">${deskLists(loop).queue.length ? 'Press A for the oldest raised item' : 'Queue: 0 awaiting'}</div><div class="dk-dim">A oldest raised · ] [ next and previous · ↑ ↓ select · E evidence · R recommendation · K record (the day's record when nothing is selected) · Esc back</div></div>`;
    return;
  }
  const body =
    S.tab === 'rec'
      ? recommendationHtml(loop, S.desk, sit.sit_id)
      : S.tab === 'record'
        ? recordHtml(loop, S.desk, sit.sit_id)
        : evidenceHtml(loop, S.desk, sit.sit_id);
  const acts = deskActions(loop, S.desk, sit.sit_id, S.as);
  const primary = acts.find((a) => a.primary && !a.disabled);
  const tabs = [
    ['evidence', 'E', 'Evidence'],
    ['rec', 'R', 'Recommendation'],
    ['record', 'K', 'Record'],
  ]
    .map(
      ([k, key, word]) =>
        `<button type="button" class="dk-tab" data-tab="${k}" aria-pressed="${S.tab === k}"><kbd>${key}</kbd> ${word}</button>`,
    )
    .join('');
  const buttons = acts
    .map(
      (a) =>
        `<button type="button" class="dk-act${a === primary ? ' primary' : ''}${a.needs ? ' sup' : ''}" data-act="${esc(a.id)}"${a.disabled ? ` disabled title="${esc(a.disabled)}"` : ''}>${a.key ? `<kbd>${esc(a === primary ? 'Enter' : a.key)}</kbd>` : ''}${esc(a.label)}${a.needs ? ` <span class="dk-needs">${esc(a.needs)}</span>` : ''}</button>`,
    )
    .join('');
  const person = loop.people[sit.person_id];
  $('dk-main').innerHTML = `
    <div class="dk-crumb">${crumb(loop, sit.sit_id, S.tab)}</div>
    <div class="dk-person">${who(loop, sit.person_id)} <span class="dk-tag">${esc(person?.protection ?? '')}</span> <span class="dk-tag dim">${esc(person?.posture ?? '')}</span> <span class="dk-mono dk-dim">${esc(stateWord(loop, sit))}</span></div>
    <nav class="dk-tabs">${tabs}</nav>
    <div class="dk-body-card">${body}</div>
    <div id="dk-confirm" class="dk-confirm" ${S.confirm ? '' : 'hidden'}>${S.confirm ? `${esc(S.confirm.text)} <kbd>Enter</kbd> yes · <kbd>Esc</kbd> no` : ''}</div>
    <div class="dk-acts">${buttons}</div>`;
  const slot = document.getElementById('dk-record-slot');
  if (slot) slot.replaceChildren(deskRecordNode(loop, sit.sit_id));
}

function renderUndo() {
  const el = $('dk-undo');
  const left = S.undo ? S.undo.inMs - (Date.now() - S.undoAt) : 0;
  if (!el) return;
  if (left > 0) {
    el.hidden = false;
    el.innerHTML = `<kbd>Z</kbd> Undo (${Math.ceil(left / 1000)} s) · ${esc(S.undo.type === 'verification.decide' ? 'decision' : S.undo.type.split('.')[1])}`;
  } else el.hidden = true;
}

function render() {
  if (!S.loop) return;
  renderBar();
  renderLeft();
  if (!S.sheet) renderMain();
  if (!$('dk-undo')) {
    const u = document.createElement('button');
    u.id = 'dk-undo';
    u.type = 'button';
    u.className = 'dk-undo';
    u.hidden = true;
    u.addEventListener('click', () => send([{ type: 'undo' }]));
    app.appendChild(u);
  }
  renderUndo();
}
setInterval(() => {
  renderBar();
}, 1000);

// --------------------------------------------------------------- actions
let toastTimer = null;
function toast(text) {
  const el = $('dk-toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4500);
}

const SAID = {
  ALREADY: 'Already done',
  I11_EDIT_IN_PLACE: 'Already on the record: nothing is edited in place',
  ROLE: 'Not for this role: switch the supervisor toggle',
};
async function send(cmds) {
  if (S.busy) return;
  S.busy = true;
  try {
    for (const cmd of cmds) {
      const r = await conn.request({ t: 'desk-cmd', as: S.as, cmd });
      if (!r.ok) {
        let text = SAID[r.code] || r.error || r.code || 'Refused';
        if (r.code === 'ALREADY' && cmd.type === 'verification.decide') {
          const v =
            S.loop.verifications[
              S.loop.situations[cmd.sit_id]?.verification_id
            ];
          if (v)
            text = `already ${v.decision === 'verified' ? 'verified' : v.decision} ${v.verified_at.slice(11, 16).replace(':', '')}Z`;
        }
        toast(`${text} · nothing changed`);
        return false;
      }
    }
    return true;
  } finally {
    S.busy = false;
  }
}

function run(a) {
  if (!a) return;
  if (a.disabled) return toast(a.disabled);
  if (a.sheet) return openSheet(a);
  if (a.confirm) {
    S.confirm = { text: a.confirm, cmds: a.cmds };
    return renderMain();
  }
  return send(a.cmds);
}

function openSheet(a) {
  S.sheet = a;
  const el = $('dk-sheet');
  const fields = a.sheet.fields
    .map((f) => {
      if (f.kind === 'select')
        return `<label><span class="dk-k">${esc(f.name.toUpperCase())}</span><select name="${esc(f.name)}">${f.options.map(([v, l]) => `<option value="${esc(v)}"${String(f.value) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
      return `<label><span class="dk-k">${esc(f.name.toUpperCase())}</span><input name="${esc(f.name)}" value="${esc(f.value ?? '')}" ${f.max ? `maxlength="${f.max}"` : 'maxlength="140"'} autocomplete="off"><em class="dk-count"></em></label>`;
    })
    .join('');
  el.innerHTML = `<form class="dk-sheet-card"><h3>${esc(a.sheet.title)}</h3>${fields}<div class="dk-sheet-acts"><button type="submit" class="dk-act primary"><kbd>Enter</kbd> ${esc(a.label.split(' · ')[0])}</button><button type="button" class="dk-act" data-close><kbd>Esc</kbd> Cancel</button></div></form>`;
  el.hidden = false;
  const form = el.querySelector('form');
  const count = () => {
    for (const i of form.querySelectorAll('input[maxlength]')) {
      const em = i.nextElementSibling;
      if (em) em.textContent = `${[...i.value].length}/${i.maxLength}`;
    }
  };
  form.addEventListener('input', count);
  count();
  form.querySelector('input,select')?.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    for (const k of a.sheet.require || [])
      if (!String(values[k] || '').trim()) return toast(`${k} is needed`);
    const ok = await send(a.sheet.build(values));
    if (ok) closeSheet();
  });
  el.querySelector('[data-close]').addEventListener('click', closeSheet);
}
function closeSheet() {
  S.sheet = null;
  $('dk-sheet').hidden = true;
  $('dk-sheet').innerHTML = '';
  render();
}

function select(sitId, tab = 'evidence') {
  S.sel = sitId;
  S.tab = tab;
  S.confirm = null;
  render();
}
function queueIds() {
  return S.loop ? deskLists(S.loop).queue.map((q) => q.sit_id) : [];
}
function allIds() {
  if (!S.loop) return [];
  const L = deskLists(S.loop);
  return [
    ...L.situations.map((s) => s.sit_id),
    ...L.queue.map((q) => q.sit_id),
  ];
}

app.addEventListener('click', (e) => {
  const t = e.target.closest(
    '[data-sit],[data-tab],[data-act],[data-as],[data-restore]',
  );
  if (!t) return;
  if (t.dataset.as) {
    S.as = t.dataset.as;
    return render();
  }
  if (t.dataset.restore)
    return send([{ type: 'intel.restore', bundle_id: t.dataset.restore }]);
  if (t.dataset.sit) return select(t.dataset.sit);
  if (t.dataset.tab) {
    S.tab = t.dataset.tab;
    return renderMain();
  }
  if (t.dataset.act && S.sel)
    run(
      deskActions(S.loop, S.desk, S.sel, S.as).find(
        (a) => a.id === t.dataset.act,
      ),
    );
});

document.addEventListener('keydown', (e) => {
  if (!S.loop || e.metaKey || e.ctrlKey || e.altKey) return;
  if (S.sheet) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSheet();
    }
    return;
  }
  if (e.target.closest?.('input,select,textarea')) return;
  if (S.confirm) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const c = S.confirm;
      S.confirm = null;
      send(c.cmds).then(() => renderMain());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      S.confirm = null;
      renderMain();
    }
    return;
  }
  const k = e.key;
  const q = queueIds();
  const i = q.indexOf(S.sel);
  if (k === 'a' || k === 'A') {
    if (q.length) select(q[0]);
    else toast('Queue: 0 awaiting');
    return e.preventDefault();
  }
  if (k === ']' || k === '[') {
    if (!q.length) return;
    const n = i < 0 ? 0 : (i + (k === ']' ? 1 : q.length - 1)) % q.length;
    select(q[n]);
    return e.preventDefault();
  }
  if (k === 'ArrowDown' || k === 'ArrowUp') {
    const all = allIds();
    if (!all.length) return;
    const j = all.indexOf(S.sel);
    const n =
      j < 0
        ? 0
        : Math.max(
            0,
            Math.min(all.length - 1, j + (k === 'ArrowDown' ? 1 : -1)),
          );
    select(all[n], S.tab);
    return e.preventDefault();
  }
  if (k === 'z' || k === 'Z') {
    send([{ type: 'undo' }]);
    return e.preventDefault();
  }
  if (!S.sel && (k === 'k' || k === 'K' || k === 'Escape')) {
    // K with nothing selected opens the day's record; Esc closes it.
    S.tab = k === 'Escape' ? 'evidence' : 'record';
    renderMain();
    return e.preventDefault();
  }
  if (!S.sel) return;
  if (k === 'Escape') {
    if (S.tab !== 'evidence') S.tab = 'evidence';
    else S.sel = null;
    render();
    return e.preventDefault();
  }
  const tab = { e: 'evidence', r: 'rec', k: 'record' }[k.toLowerCase()];
  if (tab) {
    S.tab = tab;
    renderMain();
    return e.preventDefault();
  }
  const acts = deskActions(S.loop, S.desk, S.sel, S.as);
  if (k === 'Enter') {
    run(acts.find((a) => a.primary && !a.disabled));
    return e.preventDefault();
  }
  const a = acts.find(
    (x) =>
      x.key && x.key.length === 1 && x.key.toLowerCase() === k.toLowerCase(),
  );
  if (a) {
    run(a);
    e.preventDefault();
  }
});

// ------------------------------------------------------------------ link
// Opened last: its first status call renders.
const conn = connectExec({
  kind: 'desk',
  on: {
    status(s) {
      S.status = s;
      renderBar();
    },
    welcome(m) {
      S.clock = m.clock;
      S.clockAt = Date.now();
    },
    denied(m) {
      toast(m.error || m.code || 'Refused');
      $('dk-main').innerHTML =
        `<div class="dk-empty">${esc(m.error || 'The desk runs on the Trip Twin computer only')}</div>`;
    },
    loop(m) {
      if (m.view !== 'desk') return;
      S.loop = m.loop;
      S.desk = m.desk;
      S.clock = m.clock;
      S.clockAt = Date.now();
      S.undo = m.undo;
      S.undoAt = Date.now();
      document.body.dataset.exSim = m.clock?.simNow ?? '';
      document.body.dataset.exRun = String(m.run ?? '');
      render();
    },
    clock(c) {
      S.clock = c;
      S.clockAt = Date.now();
      renderBar();
    },
  },
});

// A small seam for the QA script: the state the page holds (read only).
window.__exDesk = {
  get selected() {
    return S.sel;
  },
  get as() {
    return S.as;
  },
};
