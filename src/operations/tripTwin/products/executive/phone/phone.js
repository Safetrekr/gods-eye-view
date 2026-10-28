// SafeTrekr Executive B5: the mock phone (twin-phone.html) in the SafeTrekr
// Traveler app's look (EP-32 §4, EP-36 §2, EP-37 §§3–4, 8, EP-38 #12).
//   twin-phone.html                 the chooser: the storyboard phones
//   twin-phone.html?p=p-kestrel     a phone on this computer, by participant
//   twin-phone.html?ticket=…        a LAN phone, by the presenter's one-time
//                                   ticket (B2); the ticket leaves the URL
//   &frame=1 | &frame=0             force the iPhone frame on or off
// The relay sends this phone its own view (phone/phoneView.js through
// loopHost.phoneView); the page draws it and sends taps as phone-cmd. In
// scripted mode the phone shows the script's rungs as they happen; a tap
// answers early and pre-empts the scripted reply on the relay. Forms open
// pre-filled with the scripted reply (the view's `script` hints) so a tap
// says what the script says unless the person changes it. A new push sits
// on the lock screen until opened (opening is the READ); a P1 opens as the
// app's critical takeover. WREN's location sharing is her own act: the
// watch's request shows "Turn sharing on" and "Not now", never a switch
// thrown for her. SAMPLE is always on screen. Every string goes through
// textContent.
import './phone.css';
import { connectExec, simNowOf } from '../host/execClient.js';
import { EXEC_MSG } from '../host/execProtocol.js';

const params = new URLSearchParams(location.search);
const root = document.getElementById('ph-app');
const MARK = '/trip-twin/apple-touch-icon.png';

/** The storyboard phones (EP-20): callsigns and roles only, no names. */
export const STORYBOARD = Object.freeze([
  ['p-kestrel', 'KESTREL', 'VP · remote protection · Austin'],
  ['p-harrier', 'HARRIER', 'Chief of staff · monitored · Austin'],
  ['p-atlas6', 'ATLAS 6', 'Detail leader · London'],
  ['p-atlas3', 'ATLAS 3', 'Advance agent · London'],
  ['p-wren', 'WREN', 'Adult child · monitored · Washington DC'],
  ['p-swift1', 'SWIFT 1', 'Pilot · monitored · Washington DC'],
]);

// ----------------------------------------------------------------- dom
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(cls, text, onClick, act) {
  const b = el('button', `ph-btn ${cls || ''}`.trim(), text);
  b.type = 'button';
  if (act) b.dataset.act = act;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick?.(e);
  });
  return b;
}
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  alert: 'M12 3 2 20h20L12 3Zm0 6v5m0 3v.01',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z',
  pin: 'M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Zm0-9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  check: 'M4 12.5 9.5 18 20 6.5',
  phone:
    'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
  radio: 'M12 14v7M8 21h8M5 9a7 7 0 0 1 14 0M8 9a4 4 0 0 1 8 0',
  doc: 'M7 3h7l5 5v13H7V3Zm7 0v5h5M10 13h6M10 17h6',
  info: 'M12 8v.01M11 12h1v5h1',
};
function icon(name, size = 20) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.info);
  s.append(p);
  if (name === 'info') {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', '12');
    c.setAttribute('cy', '12');
    c.setAttribute('r', '9');
    s.append(c);
  }
  return s;
}
function glyphs() {
  const g = el('span', 'ph-glyphs');
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 60 12');
  s.setAttribute('width', '60');
  s.setAttribute('height', '12');
  s.setAttribute('fill', 'currentColor');
  for (const [x, h] of [
    [0, 4],
    [5, 6],
    [10, 8],
    [15, 11],
  ]) {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', x);
    r.setAttribute('y', 11 - h);
    r.setAttribute('width', '3.5');
    r.setAttribute('height', h);
    r.setAttribute('rx', '1');
    s.append(r);
  }
  const b = document.createElementNS(SVG_NS, 'rect');
  b.setAttribute('x', '33');
  b.setAttribute('y', '0.5');
  b.setAttribute('width', '23');
  b.setAttribute('height', '11');
  b.setAttribute('rx', '3');
  b.setAttribute('fill', 'none');
  b.setAttribute('stroke', 'currentColor');
  const f = document.createElementNS(SVG_NS, 'rect');
  f.setAttribute('x', '35');
  f.setAttribute('y', '2.5');
  f.setAttribute('width', '16');
  f.setAttribute('height', '7');
  f.setAttribute('rx', '1.5');
  s.append(b, f);
  g.append(s);
  return g;
}

// ------------------------------------------------------------- frame
const frameParam = params.get('frame');
const framed =
  frameParam === '1' ||
  (frameParam !== '0' &&
    matchMedia('(pointer: fine)').matches &&
    innerWidth >= 480 &&
    innerHeight >= 700);
document.body.classList.add(framed ? 'ph-framed' : 'ph-fill');

// ----------------------------------------------------------- chooser
if (!params.get('p') && !params.get('ticket')) {
  document.body.classList.remove('ph-framed');
  document.body.classList.add('ph-fill');
  document.body.dataset.phScreen = 'chooser';
  const c = el('div', 'ph-choose');
  const head = el('div', 'ph-apphead');
  const img = el('img', 'ph-mark');
  img.src = MARK;
  img.alt = '';
  head.append(img, el('span', 'ph-brand', 'SafeTrekr'));
  head.append(el('span', 'ph-brand-sub', 'Executive · phones'));
  const strip = el('div', 'ph-sample');
  strip.append(el('b', null, 'SAMPLE'), el('span', null, 'fictional people'));
  c.append(
    strip,
    head,
    el(
      'p',
      'ph-foot',
      'Open one phone per window or tab on this computer. Each follows the day as scripted; a tap answers early.',
    ),
  );
  for (const [pid, cs, line] of STORYBOARD) {
    const a = el('a', 'ph-card');
    a.href = `?p=${encodeURIComponent(pid)}`;
    a.dataset.pid = pid;
    a.append(el('span', 'ph-cs', cs), el('span', 'ph-callout', line));
    c.append(a);
  }
  c.append(
    el(
      'p',
      'ph-foot',
      'A phone or iPad on the network pairs with a one-time link from the presenter (it expires in a few minutes and works once).',
    ),
  );
  root.replaceChildren(c);
} else startPhone();

// ------------------------------------------------------------- phone
function startPhone() {
  const ui = {
    phone: null,
    clock: null,
    clockAt: Date.now(),
    open: null, // alert id on screen
    sheet: null, // {kind, …}
    seen: new Set(), // message ids opened here
    later: new Set(), // sharing requests answered "Not now" here
    takeoverLater: new Set(),
    toast: null,
    busy: false,
    denied: null,
    form: {}, // live form values by key
  };
  const store = (() => {
    try {
      return sessionStorage;
    } catch {
      return null;
    }
  })();
  const SKEY = 'safetrekr.exec.phone.ui';
  try {
    const s = JSON.parse(store?.getItem(SKEY) || '{}');
    for (const id of s.seen || []) ui.seen.add(id);
    for (const id of s.later || []) ui.later.add(id);
  } catch {
    /* fresh */
  }
  const keep = () => {
    try {
      store?.setItem(
        SKEY,
        JSON.stringify({ seen: [...ui.seen], later: [...ui.later] }),
      );
    } catch {
      /* private window */
    }
  };

  const device = el('div', 'ph-device');
  const screen = el('div', 'ph-screen');
  device.append(screen);
  root.replaceChildren(device);

  // -------------------------------------------------------- the relay
  const client = connectExec({
    kind: 'phone',
    participantId: params.get('p'),
    ticket: params.get('ticket'),
    on: {
      status: (s) => {
        document.body.dataset.phLink = s;
      },
      welcome: () => {
        ui.denied = null;
        if (params.get('ticket')) {
          // A ticket is used once: keep it out of the address bar.
          history.replaceState(null, '', location.pathname);
        }
      },
      loop: (m) => {
        if (m.view !== 'phone' || !m.phone) return;
        ui.phone = m.phone;
        if (m.clock) {
          ui.clock = m.clock;
          ui.clockAt = Date.now();
        }
        render();
      },
      clock: (c) => {
        ui.clock = c;
        ui.clockAt = Date.now();
        paintTime();
      },
      denied: (m) => {
        ui.denied = m;
        render();
      },
    },
  });

  function toast(text, bad = false) {
    ui.toast = { text, bad, until: Date.now() + 2600 };
    render();
    setTimeout(() => {
      if (ui.toast && Date.now() >= ui.toast.until) {
        ui.toast = null;
        render();
      }
    }, 2700);
  }
  /** Send phone commands in order; stop at the first refusal. */
  async function send(cmds, done) {
    if (ui.busy) return false;
    ui.busy = true;
    render();
    let ok = true;
    for (const cmd of cmds.filter(Boolean)) {
      const r = await client.request({ t: EXEC_MSG.PHONE_CMD, cmd });
      if (!r.ok) {
        ok = false;
        toast(
          `Not sent · ${String(r.code || r.error || 'refused').replace(/_/g, ' ')}`,
          true,
        );
        break;
      }
    }
    ui.busy = false;
    if (ok && done) toast(done);
    else render();
    return ok;
  }

  // ------------------------------------------------------- helpers
  const P = () => ui.phone;
  const hint = (type, pred = () => true) =>
    (P()?.script || []).find((h) => h.type === type && pred(h)) || null;
  const strip = (h) => {
    if (!h) return null;
    const { at: _a, ...rest } = h;
    void _a;
    return rest;
  };
  /** The rungs below READ a phone still owes, then READ (opening is reading). */
  const toRead = (a) => {
    const out = [];
    if (!a.rung)
      out.push({
        type: 'ack',
        push_id: a.id,
        sit_id: a.sit_id,
        rung: 'delivered',
      });
    if (!a.rung || a.rung === 'delivered')
      out.push({
        type: 'ack',
        push_id: a.id,
        sit_id: a.sit_id,
        rung: 'read',
        source: 'app open',
      });
    return out;
  };
  const rungAt = (a, r) =>
    ['delivered', 'read', 'accepted', 'done'].indexOf(r) <=
    ['delivered', 'read', 'accepted', 'done'].indexOf(a.rung);
  const unread = (a) =>
    a.state === 'active' && (!a.rung || a.rung === 'delivered');
  const simNow = () => simNowOf(ui.clock, ui.clockAt) ?? Date.parse(P()?.now);
  function localHM(t) {
    const tz = P()?.tz || 'UTC';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: tz,
      }).format(new Date(t));
    } catch {
      return new Date(t).toISOString().slice(11, 16);
    }
  }
  function localDate(t) {
    const tz = P()?.tz || 'UTC';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: tz,
      }).format(new Date(t));
    } catch {
      return '';
    }
  }
  const pendingAsk = () =>
    (P()?.messages || []).find(
      (m) =>
        m.card &&
        (m.card.buttons || []).includes('Turn sharing on') &&
        P().sharing.requested &&
        !ui.later.has(m.id),
    ) || null;
  const lockNotes = () => {
    const p = P();
    if (!p) return [];
    const notes = [];
    for (const a of p.alerts)
      if (unread(a)) notes.push({ kind: 'alert', a, at: a.sentAt });
    for (const m of p.messages)
      if (
        m.card &&
        !ui.seen.has(m.id) &&
        (pendingAsk()?.id === m.id || !m.card.buttons?.length)
      )
        notes.push({ kind: 'msg', m, at: m.at });
    return notes.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  };

  // ------------------------------------------------------- painting
  const timeEls = new Set();
  function paintTime() {
    if (!P()) return;
    const t = simNow();
    for (const e of timeEls) {
      if (!e.isConnected) {
        timeEls.delete(e);
        continue;
      }
      e.textContent = e.dataset.kind === 'date' ? localDate(t) : localHM(t);
    }
    for (const e of document.querySelectorAll('.ph-rate'))
      e.textContent = rateText();
  }
  setInterval(paintTime, 1000);
  const rateText = () => {
    const c = ui.clock;
    if (!c) return '';
    if (c.paused) return 'paused';
    return String(c.label || '').replace(/^SAMPLE · /, '');
  };
  function statusBar() {
    const s = el('div', 'ph-status');
    const t = el('span', 'ph-time');
    timeEls.add(t);
    s.append(t, glyphs());
    return s;
  }
  function sampleStrip() {
    const s = el('div', 'ph-sample');
    s.dataset.sample = '1';
    const l = el('span');
    l.append(
      el('b', null, 'SAMPLE'),
      document.createTextNode(' · fictional people and messages'),
    );
    s.append(l, el('span', 'ph-rate', rateText()));
    return s;
  }

  function render() {
    const p = P();
    const nodes = [statusBar(), sampleStrip()];
    if (ui.denied && !p) {
      const sc = el('div', 'ph-scroll');
      sc.append(
        el('div', 'ph-sect', 'Not paired'),
        el('div', 'ph-card ph-callout', ui.denied.error || ui.denied.code),
      );
      nodes.push(sc);
      screen.replaceChildren(...nodes);
      document.body.dataset.phScreen = 'denied';
      paintTime();
      return;
    }
    if (!p) {
      const sc = el('div', 'ph-scroll');
      sc.append(el('div', 'ph-sect', 'Pairing…'));
      nodes.push(sc);
      screen.replaceChildren(...nodes);
      document.body.dataset.phScreen = 'pairing';
      paintTime();
      return;
    }
    document.title = `SafeTrekr · ${p.callsign} (SAMPLE)`;
    const open = ui.open && p.alerts.find((a) => a.id === ui.open);
    const body = open ? detailView(open) : homeView();
    nodes.push(body);
    let mode = open ? 'alert' : 'home';
    // The critical takeover (the app's AlertAckModal) for an unread P1.
    const crit = p.alerts.find(
      (a) => unread(a) && a.priority === 'P1' && !ui.takeoverLater.has(a.id),
    );
    const notes = lockNotes();
    if (crit) {
      nodes.push(takeover(crit));
      mode = 'takeover';
    } else if (notes.length && !open && !ui.sheet) {
      nodes.push(lockScreen(notes));
      mode = 'lock';
    }
    if (ui.sheet) {
      nodes.push(sheetView());
      mode = `sheet-${ui.sheet.kind}`;
    }
    if (ui.toast) {
      nodes.push(
        el('div', `ph-toast${ui.toast.bad ? ' ph-bad' : ''}`, ui.toast.text),
      );
    }
    const y = screen.querySelector('.ph-scroll')?.scrollTop ?? 0;
    screen.replaceChildren(...nodes);
    const sc = screen.querySelector('.ph-scroll');
    if (sc && ui.keepScroll) sc.scrollTop = y;
    ui.keepScroll = true;
    document.body.dataset.phScreen = mode;
    document.body.dataset.phParticipant = p.participant_id;
    paintTime();
  }

  // --------------------------------------------------------- lock
  function noteCard({ title, body, when, crit, onOpen, act }) {
    const n = el('button', `ph-note${crit ? ' ph-crit' : ''}`);
    n.type = 'button';
    if (act) n.dataset.act = act;
    const h = el('div', 'ph-note-head');
    const img = el('img');
    img.src = MARK;
    img.alt = '';
    h.append(img, el('span', null, 'SAFETREKR'), el('span', 'ph-when', when));
    n.append(h, el('div', 'ph-note-title', title));
    if (body) n.append(el('div', 'ph-note-body', body));
    n.addEventListener('click', onOpen);
    return n;
  }
  const whenOf = (at) => {
    const d = simNow() - Date.parse(at);
    return d < 120_000 ? 'now' : localHM(Date.parse(at));
  };
  function lockScreen(notes) {
    const p = P();
    const l = el('div', 'ph-lock');
    const date = el('div', 'ph-lockdate');
    date.dataset.kind = 'date';
    timeEls.add(date);
    const big = el('div', 'ph-locktime');
    timeEls.add(big);
    const list = el('div', 'ph-notes');
    for (const n of notes) {
      if (n.kind === 'alert')
        list.append(
          noteCard({
            title: n.a.title,
            body: n.a.body,
            when: whenOf(n.a.sentAt),
            crit: n.a.severity === 'critical',
            act: `open-${n.a.id}`,
            onOpen: () => openAlert(n.a),
          }),
        );
      else
        list.append(
          noteCard({
            title: n.m.card.title || 'From the watch',
            body: n.m.card.body,
            when: whenOf(n.m.at),
            act: `msg-${n.m.id}`,
            onOpen: () => {
              ui.seen.add(n.m.id);
              keep();
              if (pendingAsk()?.id === n.m.id)
                ui.sheet = { kind: 'share', id: n.m.id };
              render();
            },
          }),
        );
    }
    for (const c of p.calls.filter(
      (x) => !x.answered && x.outcome !== 'reached',
    ))
      list.append(
        noteCard({
          title: c.line,
          body: `${c.atLine} · no voicemail in the demo`,
          when: whenOf(c.at),
          act: 'call',
          onOpen: () => {},
        }),
      );
    l.append(
      statusBar(),
      sampleStrip(),
      date,
      big,
      list,
      el('div', 'ph-lockhint', 'Tap a notification to open'),
    );
    return l;
  }

  function takeover(a) {
    const t = el('div', 'ph-take');
    t.dataset.act = 'takeover';
    const b = el('div', 'ph-take-body');
    const ring = el('div', 'ph-take-ring');
    ring.append(icon('alert', 56));
    b.append(
      ring,
      el('div', 'ph-take-kick', `CRITICAL · ${a.header || 'SAMPLE'}`),
      el('div', 'ph-take-title', a.title),
      el('div', 'ph-take-msg', a.body),
    );
    const f = el('div', 'ph-take-foot');
    const go = el(
      'button',
      'ph-take-btn',
      a.kind === 'recommendation' ? 'Open and answer' : 'Open',
    );
    go.type = 'button';
    go.dataset.act = `open-${a.id}`;
    go.addEventListener('click', () => openAlert(a));
    f.append(go);
    t.append(statusBar(), sampleStrip(), b, f);
    return t;
  }

  function openAlert(a) {
    ui.open = a.id;
    ui.keepScroll = false;
    ui.takeoverLater.add(a.id);
    render();
    if (a.state === 'active' && (!a.rung || a.rung === 'delivered'))
      send(toRead(a));
  }

  // --------------------------------------------------------- home
  function homeView() {
    const p = P();
    const sc = el('div', 'ph-scroll');
    const head = el('div', 'ph-apphead');
    const img = el('img', 'ph-mark');
    img.src = MARK;
    img.alt = '';
    const av = el('span', 'ph-avatar', p.initials || p.callsign.slice(0, 2));
    head.append(
      img,
      el('span', 'ph-brand', 'SafeTrekr'),
      el('span', 'ph-brand-sub', 'Executive'),
      av,
    );
    const who = el('div', 'ph-who');
    who.append(el('div', 'ph-name', p.name));
    const wl = el('div', 'ph-wholine');
    wl.append(
      el('span', 'ph-mono', p.callsign),
      document.createTextNode(
        ` · ${p.detail ? `${p.detail.roleLine}, ${p.detail.name}` : p.protectionLine}`,
      ),
    );
    who.append(wl);
    if (p.city) who.append(el('div', 'ph-wholine', `${p.city} · ${p.nowLine}`));
    sc.append(head, who);

    if (p.retier) {
      const r = el('div', 'ph-banner ph-grey');
      r.append(document.createTextNode(p.retier.line));
      if (p.retier.untilLine)
        r.append(
          el(
            'div',
            'ph-cap',
            `until ${p.retier.untilLine} · decided by the watch supervisor`,
          ),
        );
      sc.append(r);
    }

    // Privacy: the sharing state, and the watch's request if there is one.
    if (p.sharing.line) {
      const c = el('div', 'ph-card');
      c.dataset.card = 'privacy';
      const row = el('div', 'ph-card-row');
      const ic = el('span', 'ph-ico');
      ic.append(icon('pin'));
      const g = el('div', 'ph-grow');
      g.append(el('div', 'ph-title', p.sharing.line));
      if (p.sharing.sub) g.append(el('div', 'ph-foot', p.sharing.sub));
      row.append(ic, g);
      c.append(row);
      if (p.sharing.requested) {
        const acts = el('div', 'ph-actions ph-two');
        acts.append(
          btn('ph-primary', 'Turn sharing on', () => turnOn(), 'share-on'),
          btn('', 'Not now', () => notNow(), 'share-later'),
        );
        c.append(acts);
      } else if (p.sharing.state === 'on' && p.sharing.canPause) {
        const acts = el('div', 'ph-actions');
        acts.append(
          btn(
            'ph-ghost',
            'Pause sharing',
            () =>
              send(
                [{ type: 'sharing.set', on: false, state: 'paused' }],
                'Sharing paused',
              ),
            'share-pause',
          ),
        );
        c.append(acts);
      }
      sc.append(c);
    }

    if (p.checkin) {
      const c = el('div', 'ph-card');
      c.dataset.card = 'checkin';
      c.append(
        el('div', 'ph-title', 'Check-in due'),
        el('div', 'ph-foot', p.checkin.dueLine),
      );
      const acts = el('div', 'ph-actions');
      acts.append(
        btn(
          'ph-primary ph-stress ph-block',
          'Check in',
          () =>
            send(
              [
                {
                  type: 'checkin.respond',
                  status: 'ok',
                  text: 'OK',
                  ...(p.checkin.point ? { point: p.checkin.point } : {}),
                },
              ],
              'Checked in',
            ),
          'checkin',
        ),
      );
      c.append(acts);
      sc.append(c);
    }

    if (p.comms && p.comms.due) {
      const c = el('div', 'ph-card');
      c.dataset.card = 'comms';
      c.append(
        el(
          'div',
          'ph-title',
          p.comms.overdue ? 'Comms check overdue' : 'Comms check due',
        ),
        el('div', 'ph-foot', `${p.comms.dueLine} · detail net, DL to watch`),
      );
      const acts = el('div', 'ph-actions');
      acts.append(
        btn(
          'ph-primary ph-block',
          'COMMS OK',
          () =>
            send(
              [
                {
                  type: 'checkin.respond',
                  kind: 'comms_check',
                  status: 'COMMS OK',
                  text: 'COMMS OK',
                },
              ],
              'Comms check sent',
            ),
          'comms-ok',
        ),
      );
      c.append(acts);
      sc.append(c);
    }

    sc.append(el('div', 'ph-sect', 'Alerts'));
    if (!p.alerts.length)
      sc.append(
        el(
          'div',
          'ph-card ph-foot',
          'No alerts. The watch will message you here.',
        ),
      );
    for (const a of p.alerts) sc.append(alertCard(a));

    // The advance (and any detail agent): the field report.
    if (p.detail && !p.detail.leader) {
      sc.append(el('div', 'ph-sect', 'Field report'));
      const c = el('div', 'ph-card');
      c.dataset.card = 'salute';
      const row = el('div', 'ph-card-row');
      const ic = el('span', 'ph-ico');
      ic.append(icon('doc'));
      const g = el('div', 'ph-grow');
      g.append(
        el('div', 'ph-title', 'SALUTE report'),
        el(
          'div',
          'ph-foot',
          'Size · Activity · Location · Unit · Time · Equipment. Files to the watch as HUMAN intelligence.',
        ),
      );
      row.append(ic, g);
      c.append(row);
      const acts = el('div', 'ph-actions');
      acts.append(
        btn(
          'ph-primary ph-block',
          'File a SALUTE',
          () => openSalute(),
          'salute-open',
        ),
      );
      c.append(acts);
      sc.append(c);
      for (const s of p.salutes) sc.append(saluteCard(s));
    }

    // The detail leader's stand-down, once the item is answered.
    if (p.detail?.leader) {
      const answered = p.alerts.some((a) => a.dl);
      const sd = hint('checkin.respond', (h) => h.status === 'stand_down');
      if (p.standDown) {
        const c = el('div', 'ph-card');
        c.append(
          el('div', 'ph-kick', `STAND-DOWN · ${p.standDown.atLine}`),
          el('div', 'ph-quote', p.standDown.text),
        );
        sc.append(c);
      } else if (answered) {
        const c = el('div', 'ph-card');
        c.append(
          el('div', 'ph-title', 'Stand the detail down'),
          el(
            'div',
            'ph-foot',
            'Principal location, posture, incidents, next movement.',
          ),
        );
        const acts = el('div', 'ph-actions');
        acts.append(
          btn(
            '',
            'Report stand-down',
            () => {
              ui.form = { text: sd?.text || '' };
              ui.sheet = { kind: 'standdown', hint: sd };
              render();
            },
            'standdown-open',
          ),
        );
        c.append(acts);
        sc.append(c);
      }
    }

    if (p.messages.length) {
      sc.append(el('div', 'ph-sect', 'From the watch'));
      for (const m of [...p.messages].reverse()) sc.append(messageCard(m));
    }
    if (p.calls.length) {
      sc.append(el('div', 'ph-sect', 'Calls'));
      for (const c of p.calls) {
        const k = el('div', 'ph-card ph-card-row');
        const ic = el('span', 'ph-ico');
        ic.append(icon('phone'));
        const g = el('div', 'ph-grow');
        g.append(
          el('div', 'ph-callout', c.line),
          el('div', 'ph-cap', c.atLine),
        );
        k.append(ic, g);
        sc.append(k);
      }
    }
    const foot = el('div', 'ph-cap');
    foot.style.marginTop = '20px';
    foot.textContent = [
      p.lastCheckinLine ? `Last check-in ${p.lastCheckinLine}` : null,
      p.nextCheckinLine ? `next ${p.nextCheckinLine}` : null,
      p.phoneLine ? `Your phone on file: ${p.phoneLine}` : null,
      'SafeTrekr Executive · SAMPLE',
    ]
      .filter(Boolean)
      .join(' · ');
    sc.append(foot);
    return sc;
  }

  function statusChip(a) {
    if (a.state === 'recalled')
      return el('span', 'ph-chip ph-grey', `RECALLED ${a.recalled.line}`);
    if (a.state === 'superseded')
      return el('span', 'ph-chip ph-grey', 'SUPERSEDED');
    if (a.state === 'expired')
      return el('span', 'ph-chip ph-grey', `EXPIRED ${a.expired.line}`);
    if (a.dl)
      return el(
        'span',
        `ph-chip ${a.dl.answer === 'nonconcur' ? 'ph-amber' : 'ph-green'}`,
        `DL: ${a.dl.word}`,
      );
    if (a.rung === 'done') return el('span', 'ph-chip ph-green', 'DONE');
    if (a.rung === 'accepted')
      return el('span', 'ph-chip ph-green', 'ACCEPTED');
    if (a.rung === 'read')
      return el(
        'span',
        'ph-chip ph-amber',
        a.kind === 'recommendation' ? 'ANSWER NEEDED' : 'READ',
      );
    return el('span', 'ph-chip ph-red', 'NEW');
  }

  function alertCard(a) {
    const gone = a.state !== 'active';
    const c = el(
      'div',
      `ph-card ph-alert ph-tap ph-sev-${a.severity}${gone ? ' ph-gone' : ''}`,
    );
    c.dataset.alert = a.id;
    c.dataset.state = a.state;
    const row = el('div', 'ph-card-row');
    const ic = el('span', 'ph-ico');
    ic.append(
      icon(
        a.kind === 'advisory'
          ? 'info'
          : a.kind === 'recommendation'
            ? 'shield'
            : 'alert',
      ),
    );
    const g = el('div', 'ph-grow');
    if (a.header) g.append(el('div', 'ph-kick', a.header));
    g.append(el('div', 'ph-title', a.title));
    g.append(el('div', 'ph-cap', `${a.kindLine} · ${a.sentLine}`));
    row.append(ic, g);
    if (unread(a)) row.append(el('span', 'ph-dot'));
    c.append(row);
    const b = el('div', 'ph-callout', a.body);
    b.style.marginTop = '8px';
    c.append(b);
    if (a.state === 'superseded')
      c.append(
        el(
          'div',
          'ph-banner ph-grey',
          `SUPERSEDED ${a.superseded.line} · see ${a.superseded.byTitle ? `“${a.superseded.byTitle}”` : 'the new card'} above`,
        ),
      );
    if (a.state === 'recalled')
      c.append(
        el(
          'div',
          'ph-banner ph-grey',
          `RECALLED ${a.recalled.line}${a.recalled.reason ? ` · ${a.recalled.reason}` : ''} · no action needed`,
        ),
      );
    const chips = el('div', 'ph-chips');
    chips.append(statusChip(a));
    c.append(chips);
    c.addEventListener('click', () => openAlert(a));
    return c;
  }

  function messageCard(m) {
    const c = el('div', 'ph-card');
    c.dataset.msg = m.id;
    const row = el('div', 'ph-card-row');
    const ic = el('span', 'ph-ico');
    ic.append(
      icon(
        m.kind === 'watch_ack'
          ? 'check'
          : m.kind === 'request'
            ? 'radio'
            : 'shield',
      ),
    );
    const g = el('div', 'ph-grow');
    g.append(el('div', 'ph-cap', `${m.fromLine} · ${m.atLine}`));
    if (m.card?.title) g.append(el('div', 'ph-title', m.card.title));
    g.append(el('div', 'ph-callout', m.card?.body || m.text || ''));
    if (m.signature && m.signature !== m.from)
      g.append(el('div', 'ph-cap', `— ${m.signature}`));
    row.append(ic, g);
    c.append(row);
    if (pendingAsk()?.id === m.id) {
      const acts = el('div', 'ph-actions ph-two');
      acts.append(
        btn('ph-primary', 'Turn sharing on', () => turnOn(), 'share-on'),
        btn('', 'Not now', () => notNow(), 'share-later'),
      );
      c.append(acts);
    }
    return c;
  }

  function saluteCard(s) {
    const c = el('div', 'ph-card');
    c.dataset.card = 'salute-filed';
    c.append(el('div', 'ph-kick', `FILED ${s.filedLine} · ${s.tag}`));
    const rows = el('div', 'ph-rows');
    for (const r of s.rows) {
      const kv = el('div', 'ph-rowkv');
      kv.append(el('span', 'ph-k', r.k), el('span', 'ph-v', r.v));
      rows.append(kv);
    }
    c.append(rows);
    return c;
  }

  function turnOn() {
    const ask = pendingAsk();
    if (ask) ui.seen.add(ask.id);
    keep();
    ui.sheet = null;
    send(
      [{ type: 'sharing.set', on: true, state: 'sharing_on' }],
      'Location sharing on · you can pause it any time',
    );
  }
  function notNow() {
    const ask = pendingAsk();
    if (ask) {
      ui.later.add(ask.id);
      ui.seen.add(ask.id);
    }
    keep();
    ui.sheet = null;
    toast('Sharing stays off · the watch will call if it needs you');
  }

  // ------------------------------------------------------- detail
  function detailView(a) {
    const sc = el('div', 'ph-scroll');
    const back = el('button', 'ph-back', '‹ Home');
    back.type = 'button';
    back.dataset.act = 'back';
    back.addEventListener('click', () => {
      ui.open = null;
      ui.keepScroll = false;
      render();
    });
    sc.append(back);
    const card = el(
      'div',
      `ph-card ph-alert ph-sev-${a.severity}${a.state !== 'active' ? ' ph-gone' : ''}`,
    );
    card.dataset.detail = a.id;
    if (a.header) card.append(el('div', 'ph-kick', a.header));
    card.append(el('div', 'ph-cap', a.kindLine));
    card.append(el('div', 'ph-bluf', a.bluf));
    if (a.state === 'recalled')
      card.append(
        el(
          'div',
          'ph-banner ph-grey',
          `RECALLED ${a.recalled.line}${a.recalled.reason ? ` · ${a.recalled.reason}` : ''}. The watch withdrew this message; no action needed.`,
        ),
      );
    if (a.state === 'superseded')
      card.append(
        el(
          'div',
          'ph-banner ph-grey',
          `SUPERSEDED ${a.superseded.line} · see ${a.superseded.byTitle ? `“${a.superseded.byTitle}”` : 'the new card'}. Follow the new card.`,
        ),
      );
    if (a.state === 'expired')
      card.append(el('div', 'ph-banner ph-grey', `EXPIRED ${a.expired.line}`));
    const rows = el('div', 'ph-rows');
    for (const r of a.rows) {
      const kv = el('div', 'ph-rowkv');
      kv.append(el('span', 'ph-k', r.k), el('span', 'ph-v', r.v));
      rows.append(kv);
    }
    card.append(rows);
    const sender = el('div', 'ph-sender');
    const img = el('img', 'ph-mark');
    img.src = MARK;
    img.alt = '';
    const sg = el('div', 'ph-grow');
    sg.append(el('div', 'ph-callout', a.sender));
    if (a.signed)
      sg.append(el('div', 'ph-cap', `${a.signed} · sent ${a.sentLine}`));
    sender.append(img, sg);
    card.append(sender);
    card.append(ladder(a));
    sc.append(card);
    sc.append(actionsFor(a));
    const full = el('details', 'ph-full');
    full.append(el('summary', null, 'Full message'));
    for (const l of a.card) full.append(el('p', null, l));
    sc.append(full);
    // The watch's answers on this item (a DETAIL item's acknowledgement).
    const msgs = P().messages.filter((m) => !m.card);
    if (a.dl && msgs.length) {
      sc.append(el('div', 'ph-sect', 'From the watch'));
      for (const m of [...msgs].reverse()) sc.append(messageCard(m));
    }
    return sc;
  }

  function ladder(a) {
    const l = el('div', 'ph-ladder');
    l.dataset.rung = a.rung || 'none';
    for (const r of a.ladder) {
      const amber = r.rung === 'accepted' && a.dl?.answer === 'nonconcur';
      const row = el(
        'div',
        `ph-rung${r.at ? (amber ? ' ph-amber' : ' ph-done') : ''}`,
      );
      row.append(
        el('span', 'ph-tick'),
        el('span', null, r.word),
        el('span', 'ph-mono', r.line || '—'),
      );
      l.append(row);
    }
    return l;
  }

  function actionsFor(a) {
    const box = el('div');
    box.dataset.actions = a.id;
    if (!a.canAct) {
      box.append(
        el(
          'div',
          'ph-foot',
          a.closed ? 'Closed by the watch.' : 'No action on this card.',
        ),
      );
      return box;
    }
    const acts = el('div', 'ph-actions');
    const read = toRead(a);
    const b = a.buttons || [];
    if (a.kind === 'recommendation' && P().detail?.leader) {
      if (a.dl) {
        const c = el('div', 'ph-card');
        c.append(el('div', 'ph-kick', `${a.dl.word} SENT · ${a.dl.line}`));
        if (a.dl.reason) c.append(el('div', 'ph-quote', a.dl.reason));
        if (a.dl.plan) c.append(el('div', 'ph-foot', `Plan: ${a.dl.plan}`));
        c.append(
          el(
            'div',
            'ph-cap',
            a.dl.principalInformed
              ? 'Principal informed'
              : 'Principal not informed',
          ),
        );
        box.append(c);
        return box;
      }
      box.append(dlForm(a, read));
      return box;
    }
    if (b.includes('Car service informed')) {
      if (!rungAt(a, 'accepted'))
        acts.append(
          btn(
            'ph-primary ph-stress ph-block',
            'Car service informed',
            () => {
              const h = strip(
                hint('checkin.respond', (x) => x.push_id === a.id),
              );
              send(
                [
                  ...read,
                  {
                    type: 'checkin.respond',
                    status: 'informed',
                    push_id: a.id,
                    sit_id: a.sit_id,
                    text: 'Car service informed.',
                    ...h,
                  },
                  {
                    type: 'ack',
                    push_id: a.id,
                    sit_id: a.sit_id,
                    rung: 'accepted',
                    source: 'reply word',
                    reply_word: 'Car service informed',
                  },
                ],
                'Sent to the watch',
              );
            },
            'informed',
          ),
        );
    }
    if (b.includes('Check in')) {
      if (!rungAt(a, 'accepted')) {
        acts.append(
          btn(
            'ph-primary ph-stress ph-block',
            'Check in',
            () => {
              const h = strip(
                hint(
                  'checkin.respond',
                  (x) => x.push_id === a.id && x.status === 'status',
                ),
              );
              send(
                [
                  ...read,
                  {
                    type: 'checkin.respond',
                    status: 'status',
                    push_id: a.id,
                    sit_id: a.sit_id,
                    text: 'STATUS: OK.',
                    ...h,
                  },
                  {
                    type: 'ack',
                    push_id: a.id,
                    sit_id: a.sit_id,
                    rung: 'accepted',
                    source: 'reply word',
                    reply_word: 'STATUS',
                  },
                ],
                'Checked in',
              );
            },
            'checkin-status',
          ),
        );
      } else if (a.rung !== 'done') {
        acts.append(
          btn(
            'ph-primary ph-stress ph-block',
            'Check in on arrival',
            () => {
              const h = strip(
                hint(
                  'checkin.respond',
                  (x) => x.push_id === a.id && x.status === 'arrival',
                ),
              );
              send(
                [
                  {
                    type: 'checkin.respond',
                    status: 'arrival',
                    push_id: a.id,
                    sit_id: a.sit_id,
                    text: 'Arrived.',
                    ...h,
                  },
                  {
                    type: 'ack',
                    push_id: a.id,
                    sit_id: a.sit_id,
                    rung: 'done',
                    source: 'reply',
                    reply_word: 'DONE',
                  },
                ],
                'Arrival sent',
              );
            },
            'checkin-arrival',
          ),
        );
      }
    }
    if (b.includes('Accept') && !rungAt(a, 'accepted'))
      acts.append(
        btn(
          'ph-primary ph-block',
          'Accept',
          () =>
            send(
              [
                ...read,
                {
                  type: 'ack',
                  push_id: a.id,
                  sit_id: a.sit_id,
                  rung: 'accepted',
                  source: 'reply word',
                  reply_word: 'ACCEPT',
                },
              ],
              'Accepted · the watch can see it',
            ),
          'accept',
        ),
      );
    if (b.includes('Reply'))
      acts.append(
        btn(
          'ph-block',
          'Reply with your status',
          () => {
            const h = hint(
              'checkin.respond',
              (x) => x.push_id === a.id && x.status !== 'done',
            );
            ui.form = {
              text: h?.text || '',
              accept: !rungAt(a, 'accepted'),
              share: false,
            };
            ui.sheet = { kind: 'reply', id: a.id, hint: h };
            render();
          },
          'reply-open',
        ),
      );
    if (
      a.kind === 'instruction' &&
      rungAt(a, 'accepted') &&
      a.rung !== 'done' &&
      !b.includes('Car service informed')
    )
      acts.append(
        btn(
          'ph-block',
          'Done',
          () => {
            const h = strip(
              hint(
                'checkin.respond',
                (x) => x.push_id === a.id && x.status === 'done',
              ),
            );
            send(
              [
                h ? { type: 'checkin.respond', ...h } : null,
                {
                  type: 'ack',
                  push_id: a.id,
                  sit_id: a.sit_id,
                  rung: 'done',
                  source: 'reply',
                  reply_word: 'DONE',
                },
              ],
              'Done · sent to the watch',
            );
          },
          'done',
        ),
      );
    if (b.includes('Call the watch'))
      acts.append(
        btn(
          'ph-ghost ph-block',
          'Call the watch',
          () => {
            ui.sheet = { kind: 'call' };
            render();
          },
          'call-watch',
        ),
      );
    if (!acts.childElementCount)
      acts.append(
        el(
          'div',
          'ph-foot',
          a.rung === 'done'
            ? 'Done. The watch closes the item.'
            : 'Nothing more to send.',
        ),
      );
    box.append(acts);
    return box;
  }

  function dlForm(a, read) {
    const f = el('div', 'ph-card');
    f.dataset.card = 'dl';
    const h = hint('dl.respond', (x) => x.push_id === a.id);
    const form = ui.form.dl && ui.form.dl.push === a.id ? ui.form.dl : null;
    f.append(
      el('div', 'ph-title', 'Your answer'),
      el(
        'div',
        'ph-foot',
        'The watch advises; you decide. Your answer and reason go on the record.',
      ),
    );
    const grid = el('div', 'ph-actions ph-two');
    const ANS = [
      ['concur', 'Concur'],
      ['nonconcur', 'Non-concur'],
      ['executing', 'Executing'],
      ['request_support', 'Request support'],
    ];
    for (const [k, label] of ANS) {
      const on = form?.answer === k;
      grid.append(
        btn(
          `ph-out${on ? ' ph-on' : ''}`,
          label,
          () => {
            const same = h && h.answer === k;
            ui.form.dl = {
              push: a.id,
              answer: k,
              reason: same ? h.reason || '' : '',
              plan: same ? h.plan || '' : '',
              informed: same ? Boolean(h.principal_informed) : false,
            };
            render();
          },
          `dl-${k}`,
        ),
      );
    }
    f.append(grid);
    if (form) {
      const reason = el('label', 'ph-field');
      reason.append(el('span', null, 'REASON (ON THE RECORD)'));
      const ta = el('textarea');
      ta.maxLength = 200;
      ta.value = form.reason;
      ta.dataset.field = 'reason';
      const cnt = el('div', 'ph-count', `${form.reason.length}/200`);
      ta.addEventListener('input', () => {
        form.reason = ta.value;
        cnt.textContent = `${ta.value.length}/200`;
      });
      reason.append(ta, cnt);
      f.append(reason);
      if (form.answer === 'nonconcur') {
        const plan = el('label', 'ph-field');
        plan.append(el('span', null, 'YOUR PLAN (ONE LINE)'));
        const inp = el('input');
        inp.maxLength = 40;
        inp.value = form.plan;
        inp.dataset.field = 'plan';
        inp.addEventListener('input', () => (form.plan = inp.value));
        plan.append(inp);
        f.append(plan);
      }
      const tg = el('label', 'ph-toggle');
      tg.append(el('span', null, a.toggle || 'Principal informed'));
      const sw = el('input', 'ph-switch');
      sw.type = 'checkbox';
      sw.checked = form.informed;
      sw.dataset.field = 'informed';
      sw.addEventListener('change', () => (form.informed = sw.checked));
      tg.append(sw);
      f.append(tg);
      const word = ANS.find((x) => x[0] === form.answer)[1];
      const acts = el('div', 'ph-actions');
      acts.append(
        btn(
          'ph-primary ph-block',
          `Send ${word.toLowerCase()}`,
          () => {
            const cmd = {
              type: 'dl.respond',
              push_id: a.id,
              sit_id: a.sit_id,
              answer: form.answer,
              principal_informed: form.informed,
            };
            if (form.reason.trim()) cmd.reason = form.reason.trim();
            if (form.answer === 'nonconcur' && form.plan.trim())
              cmd.plan = form.plan.trim();
            send([...read, cmd], `${word} sent · on the record`).then((ok) => {
              if (ok) ui.form.dl = null;
            });
          },
          'dl-send',
        ),
      );
      f.append(acts);
    }
    return f;
  }

  // ------------------------------------------------------- SALUTE
  function openSalute() {
    const h = hint('salute.file');
    const now = simNow();
    const useHint = h && Math.abs(Date.parse(h.time || h.at) - now) <= 120_000;
    const t = useHint
      ? h.time
      : new Date(Math.floor(now / 60000) * 60000)
          .toISOString()
          .replace('.000Z', 'Z');
    ui.form = {
      size: h?.size || '',
      activity: h?.activity || '',
      locName: h?.location?.name || '',
      unit: h?.unit || '',
      time: t,
      equipment: h?.equipment || '',
    };
    ui.sheet = { kind: 'salute', hint: h };
    render();
  }

  // -------------------------------------------------------- sheets
  function field(label, key, { area = false, max = 280, mono = false } = {}) {
    const l = el('label', 'ph-field');
    l.append(el('span', null, label));
    const i = el(area ? 'textarea' : 'input');
    i.maxLength = max;
    i.value = ui.form[key] ?? '';
    i.dataset.field = key;
    if (mono) i.style.fontFamily = 'var(--ph-mono)';
    i.addEventListener('input', () => (ui.form[key] = i.value));
    l.append(i);
    return l;
  }
  function sheetView() {
    const s = ui.sheet;
    const wrap = el('div', 'ph-sheetwrap');
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) {
        ui.sheet = null;
        render();
      }
    });
    const sh = el('div', 'ph-sheet');
    sh.dataset.sheet = s.kind;
    sh.append(el('div', 'ph-grab'));
    const close = () => {
      ui.sheet = null;
      render();
    };
    const p = P();
    if (s.kind === 'share') {
      const m = p.messages.find((x) => x.id === s.id);
      sh.append(
        el('div', 'ph-kick', 'WATCH CHANGE · SAMPLE'),
        el('div', 'ph-bluf', m?.card?.title || 'Watch change'),
        el('div', 'ph-callout', m?.card?.body || ''),
      );
      sh.append(
        el(
          'div',
          'ph-foot',
          'You decide. Sharing stays off unless you turn it on, and you can pause it any time.',
        ),
      );
      const acts = el('div', 'ph-actions ph-two');
      acts.append(
        btn('ph-primary', 'Turn sharing on', () => turnOn(), 'share-on'),
        btn('', 'Not now', () => notNow(), 'share-later'),
      );
      sh.append(acts);
    } else if (s.kind === 'reply') {
      const a = p.alerts.find((x) => x.id === s.id);
      sh.append(
        el('div', 'ph-kick', 'REPLY TO THE WATCH'),
        el('div', 'ph-title', a?.title || ''),
      );
      sh.append(field('YOUR STATUS', 'text', { area: true }));
      const tg = (label, key, act) => {
        const t = el('label', 'ph-toggle');
        t.append(el('span', null, label));
        const sw = el('input', 'ph-switch');
        sw.type = 'checkbox';
        sw.checked = Boolean(ui.form[key]);
        sw.dataset.field = key;
        sw.dataset.act = act;
        sw.addEventListener('change', () => (ui.form[key] = sw.checked));
        t.append(sw);
        return t;
      };
      if (a && !rungAt(a, 'accepted'))
        sh.append(tg('Accept the instruction', 'accept', 'reply-accept'));
      if (p.sharing.requested)
        sh.append(
          tg(
            'Turn location sharing on (you can pause it any time)',
            'share',
            'reply-share',
          ),
        );
      const acts = el('div', 'ph-actions');
      acts.append(
        btn(
          'ph-primary ph-block',
          'Send reply',
          () => {
            const text = String(ui.form.text || '').trim() || 'OK';
            const h = strip(s.hint);
            const cmds = [
              ...(a ? toRead(a) : []),
              {
                ...(h || {}),
                type: 'checkin.respond',
                status: h?.status || 'reply',
                push_id: s.id,
                sit_id: a?.sit_id,
                text,
              },
            ];
            if (ui.form.share)
              cmds.push({ type: 'sharing.set', on: true, state: 'sharing_on' });
            if (ui.form.accept && a && !rungAt(a, 'accepted'))
              cmds.push({
                type: 'ack',
                push_id: s.id,
                sit_id: a.sit_id,
                rung: 'accepted',
                source: 'reply word',
                reply_word: 'ACCEPT',
              });
            if (ui.form.share) {
              const ask = pendingAsk();
              if (ask) ui.seen.add(ask.id);
              keep();
            }
            ui.sheet = null;
            send(cmds, 'Reply sent to the watch');
          },
          'reply-send',
        ),
        btn('ph-ghost ph-block', 'Cancel', close),
      );
      sh.append(acts);
    } else if (s.kind === 'salute') {
      sh.append(
        el('div', 'ph-kick', 'SALUTE · FILES AS HUMAN'),
        el('div', 'ph-title', 'Field report to the watch'),
      );
      sh.append(
        field('S · SIZE', 'size', { max: 48 }),
        field('A · ACTIVITY', 'activity', { max: 48 }),
        field('L · LOCATION', 'locName', { max: 48 }),
      );
      if (s.hint?.location?.mgrs)
        sh.append(
          el(
            'div',
            'ph-cap ph-mono',
            `Grid ${s.hint.location.mgrs} · from your phone's fix`,
          ),
        );
      sh.append(field('U · UNIT', 'unit', { max: 48 }));
      const tl = el('label', 'ph-field');
      tl.append(el('span', null, 'T · TIME (OBSERVED)'));
      const ti = el('input');
      ti.readOnly = true;
      ti.value = ui.form.time
        ? `${ui.form.time.slice(11, 13)}${ui.form.time.slice(14, 16)}Z (${localHM(Date.parse(ui.form.time)).replace(':', '')}L)`
        : '—';
      ti.style.fontFamily = 'var(--ph-mono)';
      tl.append(ti);
      sh.append(tl, field('E · EQUIPMENT', 'equipment', { max: 48 }));
      const acts = el('div', 'ph-actions');
      acts.append(
        btn(
          'ph-primary ph-block',
          'File SALUTE',
          () => {
            const f = ui.form;
            const loc =
              s.hint?.location && s.hint.location.name === f.locName
                ? { ...s.hint.location }
                : { name: f.locName };
            delete loc.mgrs;
            const cmd = {
              type: 'salute.file',
              size: f.size || '—',
              activity: f.activity || '—',
              unit: f.unit || 'unknown',
              equipment: f.equipment || '—',
              time: f.time,
              location: loc,
            };
            if (s.hint?.sit_id) cmd.sit_id = s.hint.sit_id;
            ui.sheet = null;
            send([cmd], 'SALUTE filed · in the watch feed as HUMAN');
          },
          'salute-send',
        ),
        btn('ph-ghost ph-block', 'Cancel', close),
      );
      sh.append(acts);
    } else if (s.kind === 'standdown') {
      sh.append(
        el('div', 'ph-kick', 'STAND-DOWN'),
        el('div', 'ph-title', 'Stand the detail down'),
      );
      sh.append(
        field(
          'PRINCIPAL LOCATION · POSTURE · INCIDENTS · NEXT MOVEMENT',
          'text',
          { area: true },
        ),
      );
      const acts = el('div', 'ph-actions');
      acts.append(
        btn(
          'ph-primary ph-block',
          'Send stand-down',
          () => {
            const h = strip(s.hint);
            ui.sheet = null;
            send(
              [
                {
                  ...(h || {}),
                  type: 'checkin.respond',
                  status: 'stand_down',
                  kind: 'stand_down',
                  text: String(ui.form.text || '').trim() || 'Stand down.',
                },
              ],
              'Stand-down sent',
            );
          },
          'standdown-send',
        ),
        btn('ph-ghost ph-block', 'Cancel', close),
      );
      sh.append(acts);
    } else if (s.kind === 'call') {
      sh.append(
        el('div', 'ph-kick', 'SAMPLE'),
        el('div', 'ph-title', `Call ${p.watch.name}`),
        el(
          'div',
          'ph-callout',
          'In the app this calls the watch floor, staffed around the clock. In the demo no call is placed.',
        ),
      );
      const acts = el('div', 'ph-actions');
      acts.append(btn('ph-block', 'Close', close, 'call-close'));
      sh.append(acts);
    }
    wrap.append(sh);
    return wrap;
  }

  // QA and the presenter's own checks read the view, never write it.
  globalThis.__phone = {
    view: () => ui.phone,
    screen: () => document.body.dataset.phScreen,
  };
  render();
}
