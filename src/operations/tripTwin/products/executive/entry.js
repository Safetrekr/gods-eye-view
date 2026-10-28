// SafeTrekr Executive B2: the diagnostic page (twin-executive.html). No
// Cesium: enough text to watch the scripted day run on the relay (EP-50
// B2). B3 replaces it with the walls. Three ways in:
//   twin-executive.html                    the monitor (this computer only):
//                                          the loop, read-only
//   twin-executive.html?as=presenter[&setup=…]  a remote (the iPad's
//                                          pairing, or the setup link): the
//                                          loop plus the presenter's clock
//   twin-executive.html?slot=N[&setup=…]   a wall: exactly what wall N gets
//                                          (role main: selectMain only)
// Every rendered string goes through textContent; nothing is parsed as HTML.
import { connectSync } from '../../twinSync.js';
import { connectExec, simNowOf } from './host/execClient.js';
import { EXEC_MSG, RATES, clockLabel } from './host/execProtocol.js';
import {
  queueLine,
  selectCounter,
  selectMain,
  selectQueue,
} from './loop/select.js';
import { counter as counterLine, watchTime } from './format.js';

const params = new URLSearchParams(location.search);
const slot = Number(params.get('slot')) || null;
const mode = slot
  ? 'screen'
  : params.get('as') === 'presenter'
    ? 'presenter'
    : 'monitor';
const app = document.getElementById('ex-app');

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const section = (title) => {
  const s = el('section', 'ex-sec');
  s.append(el('h2', 'ex-h', title));
  const body = el('div', 'ex-body');
  s.append(body);
  app.append(s);
  return body;
};

const head = el('header', 'ex-head');
const chip = el('span', 'ex-chip', 'SAMPLE');
const title = el(
  'span',
  'ex-title',
  `SafeTrekr Executive · diagnostic · ${mode}${slot ? ` ${slot}` : ''}`,
);
const link = el('span', 'ex-link', 'connecting');
head.append(chip, title, link);
app.append(head);

const clockBox = section('Clock');
const counterBox = section('Counter');
const mainBox = section('MAIN rows (selectMain)');
const queueBox = section('Queue');
const logBox = section('Last loop events');
const controlBox = mode === 'presenter' ? section('Presenter') : null;
const phoneBox = mode !== 'screen' ? section('Phones') : null;
const sayBox = section('Messages');

let clock = null;
let clockAt = 0;
let lastLoop = null;
let lastMain = null;

function say(text) {
  sayBox.prepend(
    el('div', 'ex-say', `${new Date().toLocaleTimeString('en-GB')} · ${text}`),
  );
  while (sayBox.childElementCount > 12) sayBox.lastChild.remove();
}

function renderClock() {
  if (!clock) return;
  const sim = simNowOf(clock, clockAt);
  const cp = clock.checkpoint;
  clockBox.replaceChildren(
    el(
      'div',
      'ex-big',
      `${watchTime(sim)} · beat ${clock.beat}${cp ? ` · checkpoint ${cp.beat}.${cp.checkpoint} (${watchTime(cp.from)}–${watchTime(cp.to)})` : ' · between checkpoints'}`,
    ),
    el(
      'div',
      'ex-line',
      `${clock.paused ? 'PAUSED' : 'RUNNING'}${clock.held ? ` · held at ${clock.held} end` : ''} · ${clockLabel(clock.rate)} · auto ${clock.auto ? 'on' : 'off'} · run ${clock.run}`,
    ),
  );
  chip.textContent = clockLabel(clock.rate);
}
setInterval(renderClock, 500);

function rows(box, list, empty) {
  box.replaceChildren(
    ...(list.length
      ? list.map((t) => el('div', 'ex-row', t))
      : [el('div', 'ex-dim', empty)]),
  );
}

function renderMain(main) {
  counterBox.replaceChildren(el('div', 'ex-big', main.counterLine));
  rows(
    mainBox,
    [
      ...main.rows.map(
        (r) => r.text || `${r.callsign} · ${r.leg} · ${r.ladder}`,
      ),
      ...main.closed.map((c) => c.text),
      ...main.bands.map((b) => b.text),
      ...(main.verifiedLine ? [main.verifiedLine] : []),
    ],
    main.empty || 'No active situations',
  );
}

function onLoop(m) {
  if (m.clock) {
    clock = m.clock;
    clockAt = Date.now();
  }
  if (m.view === 'main') {
    lastMain = m.main;
    renderMain(m.main);
    rows(queueBox, [m.main.queueLine], 'Queue: empty');
    logBox.replaceChildren(
      el('div', 'ex-dim', 'A MAIN wall gets no log and no queue items (I3).'),
    );
    return;
  }
  if (m.view !== 'loop') return;
  lastLoop = m.loop;
  const main = selectMain(m.loop);
  renderMain(main);
  const q = selectQueue(m.loop);
  rows(
    queueBox,
    [
      queueLine(q),
      ...q.map(
        (i) =>
          `${i.callsign} · ${i.awaiting} · ${i.why_raised ?? ''}${i.overdue ? ' · OVERDUE' : ''}`,
      ),
    ],
    'Queue: empty',
  );
  counterBox.replaceChildren(
    el('div', 'ex-big', counterLine(selectCounter(m.loop))),
  );
  rows(
    logBox,
    m.loop.log
      .slice(-10)
      .reverse()
      .map(
        (l) =>
          `${watchTime(l.at)} · ${l.type} · ${l.by ?? ''}${l.ids?.sit_id ? ` · ${l.ids.sit_id}` : ''}`,
      ),
    'No events yet',
  );
  renderPhones();
}

/** Phone links: this computer pairs by participant; the presenter issues tickets. */
function renderPhones(tickets = {}) {
  if (!phoneBox || !lastLoop) return;
  const ids = new Set();
  for (const p of Object.values(lastLoop.pushes))
    for (const pid of p.order) ids.add(pid);
  for (const pid of [
    'p-kestrel',
    'p-harrier',
    'p-atlas6',
    'p-atlas3',
    'p-wren',
    'p-swift1',
    'p-swift2',
  ])
    ids.add(pid);
  const list = [...ids].filter((pid) => lastLoop.people[pid]);
  phoneBox.replaceChildren(
    ...list.map((pid) => {
      const row = el('div', 'ex-row');
      const cs = lastLoop.people[pid].callsign;
      if (mode === 'presenter') {
        const b = el('button', 'ex-btn', `Phone link · ${cs}`);
        b.onclick = async () => {
          const r = await client.request({
            t: EXEC_MSG.LOOP_CMD,
            cmd: { type: 'phone.ticket', participant_id: pid },
          });
          if (!r.ok) return say(`phone link refused: ${r.code || r.error}`);
          const url = `${location.origin}/twin-phone.html?ticket=${encodeURIComponent(r.ticket)}`;
          renderPhones({ ...tickets, [pid]: url });
        };
        row.append(b);
        if (tickets[pid]) row.append(el('code', 'ex-code', tickets[pid]));
      } else {
        const a = el('a', 'ex-a', `${cs} · open phone (this computer)`);
        a.href = `/twin-phone.html?p=${encodeURIComponent(pid)}`;
        a.target = '_blank';
        row.append(a);
      }
      return row;
    }),
  );
}

let client;
if (mode === 'monitor') {
  client = connectExec({
    kind: 'monitor',
    on: {
      status: (s) => (link.textContent = s),
      welcome: (m) => {
        clock = m.clock;
        clockAt = Date.now();
        say('monitor connected (read-only)');
      },
      loop: onLoop,
      clock: (c) => {
        clock = c;
        clockAt = Date.now();
      },
      denied: (m) => say(`refused: ${m.code} · ${m.error || ''}`),
    },
  });
} else {
  const on = {
    status: (s) => (link.textContent = s),
    welcome: (m) => {
      if (m.type === 'pair-code')
        say(`pair this wall from the remote: code ${m.code}`);
      else if (m.type === 'denied')
        say(`refused: ${m.code} · ${m.error || ''}`);
      else
        say(
          `joined as ${m.type}${m.slot ? ` ${m.slot}` : ''}${m.controller ? ' · in control' : ''}`,
        );
    },
    paired: (m) => say(`paired as wall ${m.slot}`),
    control: (m) => say(m.ok ? 'in control' : `control: ${m.error || 'asked'}`),
    [EXEC_MSG.LOOP]: onLoop,
    [EXEC_MSG.CLOCK]: (m) => {
      clock = m.clock;
      clockAt = Date.now();
    },
  };
  client = connectSync({
    kind: mode === 'screen' ? 'screen' : 'remote',
    slot,
    setup: params.get('setup'),
    name: 'iPad',
    on,
  });
}

if (controlBox) {
  const btn = (label, cmd) => {
    const b = el('button', 'ex-btn', label);
    b.onclick = () => presenter(cmd);
    controlBox.append(b);
  };
  async function presenter(cmd) {
    const r = await client.request({ t: EXEC_MSG.LOOP_CMD, cmd });
    if (r.ok) return say(`${cmd.type}: done`);
    if (r.code === 'CONFIRM_REQUIRED' && r.ask) {
      // Ask first (EP-33 §7): one closed question, 10 s.
      if (window.confirm(r.ask.text)) {
        const c = await client.request({
          t: EXEC_MSG.LOOP_CMD,
          cmd: { type: 'confirm', id: r.ask.id },
        });
        return say(`${cmd.type}: ${c.ok ? 'done' : c.code}`);
      }
      await client.request({
        t: EXEC_MSG.LOOP_CMD,
        cmd: { type: 'cancel', id: r.ask.id },
      });
      return say(`${cmd.type}: cancelled`);
    }
    say(`${cmd.type}: refused ${r.code || ''} ${r.error || ''}`);
  }
  const take = el('button', 'ex-btn', 'Take control');
  take.onclick = () => client.send({ t: 'request-control' });
  controlBox.append(take);
  btn('Start (auto, ×10)', { type: 'clock.start', rate: 10, auto: true });
  btn('Start', { type: 'clock.start' });
  btn('Pause', { type: 'clock.pause' });
  btn('Resume', { type: 'clock.resume' });
  for (const r of RATES) btn(`×${r}`, { type: 'clock.rate', rate: r });
  btn('Next', { type: 'next' });
  btn('Previous', { type: 'previous' });
  for (let n = 0; n <= 5; n++) btn(`Beat ${n}`, { type: 'beat.go', n });
  btn('Reset', { type: 'reset' });
  btn('Auto off', { type: 'clock.auto', on: false });
}

void lastMain;
