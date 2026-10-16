// SOC multi-view wall screen (phase 10). A screen is twin.html?view=screen:
// display only (no toolbar, popovers or settings — those live on the
// remote). It follows the session from the relay, applies its role, says
// who controls it and how old its link is, and sends a snapshot to the
// remote every few seconds. It never moves its camera on its own: camera
// changes come only from an operator's frame request.
import { toJpeg } from 'html-to-image';
import { ROLES, wallName } from './twinScreenRoles.js';
import { connectSync } from './twinSync.js';
import { setNameStyle } from './twinHud.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const clock = (ms) =>
  new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
const mmss = (s) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * api (from page.js): {tripCity, cityKey, setEpoch(ms), switchSite(key),
 * setMode(mode, day), report(r), spotlight(s), setWxTime(ms), scale(key),
 * setLayer(key, on), setWxLayer(key, on), frame(subject), pauseRender(on),
 * captureCanvas() → Promise<dataURL|null>, siteLabel(), dayLabel(),
 * weatherPanel(node), tripsPanel(node), incidentOpen()}
 */
export function createScreenMode({ api, slot = null, setup = null }) {
  document.body.dataset.view = 'screen';
  const head = el('header', 'tt-wall-head');
  head.id = 'tt-wall-head';
  const left = el('div', 'tt-wall-left');
  const kicker = el('div', 'tt-wall-kicker');
  const where = el('div', 'tt-wall-where');
  left.append(kicker, where);
  const badge = el('div', 'tt-wall-badge');
  const right = el('div', 'tt-wall-right');
  const time = el('div', 'tt-wall-time');
  const chip = el('div', 'tt-wall-chip');
  chip.setAttribute('role', 'status');
  const sample = el('div', 'tt-wall-sample', 'SAMPLE TRIP · FICTIONAL PEOPLE');
  // Visitor mode is visible on every wall (review/phase10 R6).
  const visitorMark = el(
    'div',
    'tt-wall-visitor',
    'VISITOR MODE · INITIALS ONLY',
  );
  visitorMark.hidden = true;
  right.append(time, chip, visitorMark, sample);
  head.append(left, badge, right);
  const stale = el('div', 'tt-wall-stale');
  stale.hidden = true;
  const panel = el('section', 'tt-wall-panel tt-panel');
  panel.id = 'tt-wall-panel';
  panel.hidden = true;
  const pair = el('div', 'tt-wall-pair');
  pair.hidden = true;
  const ident = el('div', 'tt-wall-ident');
  ident.hidden = true;
  const banner = el('div', 'tt-wall-banner');
  banner.hidden = true;
  banner.setAttribute('role', 'alert');
  document.body.append(head, stale, panel, banner, pair, ident);

  let state = null;
  let presence = null;
  let mySlot = slot ? Number(slot) : null;
  let applied = {};
  let lastChangeAt = 0;
  let changeText = '';
  let welcomeAt = 0;
  // Hands-on (Jesse): reach in with the mouse on any wall — rotate, zoom,
  // select. Settings stay on the remote. 20 s after the last input the
  // wall is display-only again; the camera stays where it was left.
  const HANDS_MS = 20000;
  const IDLE_CURSOR_MS = 3000;
  let lastInput = 0;
  let dragging = false;
  let pendingCamera = [];
  let sentLocal = '';
  let remoteGoneAt = null; // when the controlling remote went away
  let restoredAt = null; // a cached state shown before the link connects
  // Assigned below; the client reports status while it is being created.
  let sync = null;

  const me = () => (state && mySlot ? state.screens[mySlot] : null);

  function showPair(code) {
    pair.replaceChildren(
      el('div', 'k', 'PAIR THIS SCREEN'),
      el('div', 'code', code),
      el(
        'div',
        'how',
        'On the remote: Screens › Pair a screen › enter this code and pick a screen number. Codes expire after 5 minutes.',
      ),
      el('div', 'url', location.host),
    );
    pair.hidden = false;
  }

  /** Apply the role's look (CSS) and its defaults (once per role). */
  function applyRole(s) {
    const role = ROLES[s.role] || ROLES.site;
    const b = document.body;
    if (b.dataset.role !== role.key) {
      b.dataset.role = role.key;
      api.pauseRender(!role.canvas);
      // A new role starts at its own scale (the operator can change it).
      if (role.scale && !s.meta?.scale) api.scale(role.scale);
      api.applyRoleDefaults?.(role.key);
    }
    b.dataset.merged = (s.merged || []).join(' ');
    b.style.setProperty('--wall-scale', String(s.textScale || 2));
    renderPanel();
  }

  function renderPanel() {
    const role = document.body.dataset.role;
    panel.hidden = !(
      role === 'weather' ||
      role === 'trips' ||
      role === 'incident'
    );
    if (role === 'weather') api.weatherPanel(panel);
    else if (role === 'trips') api.tripsPanel(panel);
    else if (role === 'incident') {
      // Idle: say so plainly; the board fills when a floor is reported.
      const open = api.incidentOpen();
      panel.replaceChildren(
        el('div', 'tt-kicker', open ? 'INCIDENT OPEN' : 'NO INCIDENT OPEN'),
        el(
          'div',
          'tt-wall-note',
          open
            ? 'Reported, not verified · the board below follows the report'
            : 'Needs attention and the people roster are on the left · a reported floor opens the board here',
        ),
      );
    }
  }

  function applyState(next, info = {}) {
    if (!next) return;
    if (next.rev === applied.rev && !info.force) return;
    const prev = state;
    state = next;
    const s = me();
    const ss = next.session;
    // A trip in another city needs that city's twin: reload into it.
    if (ss.tripId && api.tripCity(ss.tripId) !== api.cityKey) {
      const q = new URLSearchParams(location.search);
      q.set('city', api.tripCity(ss.tripId));
      q.set('scenario', api.tripScenario(ss.tripId));
      q.delete('site');
      location.search = `?${q}`;
      return;
    }
    if (ss.epochMs && ss.epochMs !== applied.epochMs) api.setEpoch(ss.epochMs);
    if (ss.siteKey && ss.siteKey !== applied.siteKey)
      api.switchSite(ss.siteKey);
    setNameStyle(
      ss.visitor ? (n) => wallName(n, { visitor: true }) : (n) => wallName(n),
    );
    document.body.classList.toggle('tt-visitor', Boolean(ss.visitor));
    if (s) {
      applyRole(s);
      // Live / Advance and the day are this screen's own (review R2).
      const dayRole = s.role === 'day';
      const mode = dayRole ? 'advance' : s.mode || 'live';
      const key = `${mode}:${s.day}:${s.role}`;
      if (key !== applied.modeKey) api.setMode(mode, s.day);
      applied.modeKey = key;
      for (const [k, v] of Object.entries(s.layers || {}))
        if (applied.layers?.[k] !== v) api.setLayer(k, v);
      applied.layers = { ...(s.layers || {}) };
      // Camera changes never yank a view someone is dragging: they wait
      // for the mouse to be released.
      const camera = (fn) => (dragging ? pendingCamera.push(fn) : fn());
      if (s.meta?.scale && s.scale && s.meta.scale.rev !== applied.scaleRev) {
        const sc = s.scale;
        camera(() => api.scale(sc));
        applied.scaleRev = s.meta.scale.rev;
      }
      // Camera intent: only an operator's explicit request, once.
      if (s.frame?.nonce && s.frame.nonce !== applied.frameNonce) {
        const subject = s.frame.subject;
        camera(() => api.frame(subject));
        applied.frameNonce = s.frame.nonce;
      }
    }
    if (JSON.stringify(ss.report) !== JSON.stringify(applied.report))
      api.report(ss.report);
    if (JSON.stringify(ss.spotlight) !== JSON.stringify(applied.spotlight))
      api.spotlight(ss.spotlight);
    if (ss.wxAt !== applied.wxAt) api.setWxTime(ss.wxAt);
    applied = {
      ...applied,
      rev: next.rev,
      epochMs: ss.epochMs,
      siteKey: ss.siteKey,
      report: ss.report,
      spotlight: ss.spotlight,
      wxAt: ss.wxAt,
    };
    if (prev && info.by) {
      lastChangeAt = Date.now();
      changeText = info.undone ? 'Undone' : 'Updated';
    }
    try {
      localStorage.setItem(
        `tripTwin.soc.lastState.${mySlot}`,
        JSON.stringify({ state: next, at: Date.now() }),
      );
    } catch {
      /* ignore */
    }
    paint();
  }

  /** Header, chip, badge and stale band — repainted every second. */
  function paint() {
    const s = me();
    const role = ROLES[s?.role] || ROLES.site;
    kicker.textContent = mySlot ? `S${mySlot} · ${role.kicker}` : role.kicker;
    where.textContent = api.siteLabel();
    const ss = state?.session || {};
    const advance = s?.mode === 'advance';
    const dayPlan = s?.role === 'day';
    // The day plan in Live shows today's plan: say so, not "Advance".
    badge.textContent = advance
      ? `ADVANCE · ${api.dayLabel()}`
      : dayPlan
        ? `TODAY'S PLAN · ${api.dayLabel()}`
        : 'LIVE';
    badge.classList.toggle('adv', advance || dayPlan);
    document.body.classList.toggle('tt-dayplan-live', dayPlan && !advance);
    time.textContent = api.clockText();
    visitorMark.hidden = !ss.visitor;
    const ctl = presence?.remotes?.find((r) => r.controller);
    const hands = handsOn() ? ' · hands-on' : '';
    const changed = lastChangeAt || welcomeAt;
    if (!sync?.online) {
      chip.textContent = `S${mySlot ?? '?'} · not connected${hands}`;
      chip.className = 'tt-wall-chip warn';
    } else if (!ctl) {
      if (!remoteGoneAt) remoteGoneAt = Date.now();
      chip.textContent = `S${mySlot ?? '?'} · Remote offline · since ${clock(remoteGoneAt).slice(0, 5)}${hands}`;
      chip.className = 'tt-wall-chip warn';
    } else {
      remoteGoneAt = null;
      const recent = Date.now() - lastChangeAt < 3000;
      chip.textContent = `S${mySlot} · Remote: ${ctl.name || 'remote'}${recent ? ` · ${changeText}` : changed ? ` · changed ${mmss((Date.now() - changed) / 1000)} ago` : ''}${hands}`;
      chip.className = `tt-wall-chip${recent ? ' changed' : ''}${s?.pinned ? ' pinned' : ''}`;
    }
    // Link age, separate from data age (supervision spec).
    const link = sync?.linkAgeS ?? null;
    const lost = !sync?.online || (link != null && link > 15);
    stale.hidden = !lost || !state;
    if (lost && state) {
      if (link == null && restoredAt)
        stale.textContent = `STALE · showing the state saved at ${clock(restoredAt)} · not connected to the Trip Twin computer`;
      else {
        const since = link ?? 0;
        stale.textContent = `STALE · last update ${clock(Date.now() - since * 1000)} · ${mmss(since)} ago · showing the last state`;
        stale.classList.toggle('heavy', since > 120);
      }
    }
    // Incident banner: from this screen's own data, remote or not. An
    // acknowledgement belongs to one report (review R4).
    const inc = api.incidentText();
    banner.hidden = !inc;
    document.body.classList.toggle('tt-banner-on', Boolean(inc));
    if (inc) {
      banner.textContent = inc;
      banner.classList.toggle(
        'acked',
        Boolean(ss.incidentAck) && ss.incidentAck === api.incidentKey(),
      );
    }
  }

  const handsOn = () => Date.now() - lastInput < HANDS_MS;
  let lastMove = 0;
  function onInput(e) {
    const b = document.body;
    b.classList.remove('tt-idle-cursor');
    lastMove = Date.now();
    // A cursor passing over a wall is not hands-on: a press, a scroll or a
    // key is (review R9).
    if (e.type === 'pointermove') return;
    if (e.type === 'pointerdown') dragging = true;
    lastInput = Date.now();
    if (!b.classList.contains('tt-hands-on')) {
      b.classList.add('tt-hands-on');
      paint();
    }
    b.classList.remove('tt-idle-cursor');
  }
  for (const t of ['pointermove', 'pointerdown', 'wheel', 'keydown'])
    window.addEventListener(t, onInput, { capture: true, passive: true });
  window.addEventListener('pointerup', () => {
    dragging = false;
    const run = pendingCamera;
    pendingCamera = [];
    for (const fn of run) fn();
  });
  /** Hands-on state and what was picked here, for the remote's card. */
  function syncLocal() {
    const b = document.body;
    const now = Date.now();
    if (now - lastMove > IDLE_CURSOR_MS) b.classList.add('tt-idle-cursor');
    // Queued camera moves run 3 s after the last input, released or not.
    if (pendingCamera.length && now - lastInput > 3000) {
      dragging = false;
      const run = pendingCamera;
      pendingCamera = [];
      for (const fn of run) fn();
    }
    if (!handsOn() && b.classList.contains('tt-hands-on')) {
      b.classList.remove('tt-hands-on');
      paint();
    }
    const text = handsOn()
      ? ['hands-on', api.selectionText?.()].filter(Boolean).join(' · ')
      : api.selectionText?.()
        ? `shows: ${api.selectionText()}`
        : '';
    if (text !== sentLocal && sync?.online && mySlot) {
      sentLocal = text;
      sync.send({ t: 'local', on: handsOn(), text });
    }
  }

  /** The setup token has done its job once the screen has joined (R1). */
  function dropSetupFromUrl() {
    const q = new URLSearchParams(location.search);
    if (!q.has('setup')) return;
    q.delete('setup');
    history.replaceState(null, '', `?${q}`);
  }

  function identify() {
    ident.textContent = mySlot ? `S${mySlot}` : '?';
    ident.hidden = false;
    setTimeout(() => (ident.hidden = true), 3000);
  }

  // Snapshots for the remote's preview: the 3D frame plus the panels.
  let snapping = false;
  async function snapshot() {
    if (snapping || !sync?.online || !mySlot || document.hidden) return;
    snapping = true;
    try {
      const W = 320;
      const H = Math.round((W * innerHeight) / innerWidth);
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = '#061a23';
      g.fillRect(0, 0, W, H);
      const frame = ROLES[me()?.role]?.canvas
        ? await api.captureCanvas()
        : null;
      const draw = (src) =>
        new Promise((res) => {
          const img = new Image();
          img.onload = () => {
            g.drawImage(img, 0, 0, W, H);
            res();
          };
          img.onerror = res;
          img.src = src;
        });
      if (frame) await draw(frame);
      const dom = await toJpeg(document.body, {
        quality: 0.6,
        pixelRatio: W / innerWidth,
        skipFonts: true,
        backgroundColor: 'transparent',
        filter: (n) =>
          !(
            n.id === 'cesiumContainer' || n.classList?.contains('tt-wall-pair')
          ),
      }).catch(() => null);
      // JPEG has no alpha: draw the panels with a screen blend over the 3D.
      if (dom) {
        g.globalCompositeOperation = frame ? 'lighten' : 'source-over';
        await draw(dom);
        g.globalCompositeOperation = 'source-over';
      }
      sync.send({ t: 'thumb', data: c.toDataURL('image/jpeg', 0.6) });
    } finally {
      snapping = false;
    }
  }

  sync = connectSync({
    kind: 'screen',
    slot,
    setup,
    on: {
      welcome(m) {
        welcomeAt = Date.now();
        presence = m.presence;
        if (m.type === 'paired') {
          mySlot = m.slot;
          pair.hidden = true;
          restoredAt = null;
          dropSetupFromUrl();
          applyState(m.state, { force: true });
        } else if (m.type === 'pair-code') showPair(m.code);
      },
      // This slot went to another device: back to a pairing code (R10).
      unpaired() {
        sync.forget();
        try {
          localStorage.removeItem(`tripTwin.soc.lastState.${mySlot}`);
        } catch {
          /* ignore */
        }
        const q = new URLSearchParams(location.search);
        q.delete('setup');
        q.delete('slot');
        location.search = `?${q}`;
      },
      paired(m) {
        mySlot = m.slot;
        pair.hidden = true;
        dropSetupFromUrl();
        identify();
        // The state follows in the next broadcast.
      },
      state(m) {
        presence = m.presence || presence;
        applyState(m.state, m);
      },
      presence(m) {
        presence = m.presence;
        paint();
      },
      identify,
      status: () => paint(),
    },
  });

  // Never blank: the last state comes back before the relay answers.
  try {
    const last = mySlot
      ? JSON.parse(
          localStorage.getItem(`tripTwin.soc.lastState.${mySlot}`) || 'null',
        )
      : null;
    if (last?.state) {
      restoredAt = last.at || null;
      applyState(last.state, { force: true });
    }
  } catch {
    /* ignore */
  }
  const tick = setInterval(() => {
    syncLocal();
    paint();
  }, 1000);
  const snapTimer = setInterval(snapshot, 4000);
  // Weather, trips and the incident board follow their data.
  const panelTimer = setInterval(renderPanel, 5000);
  paint();
  return {
    get slot() {
      return mySlot;
    },
    refresh() {
      renderPanel();
      paint();
    },
    /** Once the twin is open: run the role's defaults again (scale etc.). */
    reapply() {
      document.body.dataset.role = '';
      applied.modeKey = null;
      if (state) applyState(state, { force: true });
      renderPanel();
      paint();
    },
    dispose() {
      clearInterval(tick);
      clearInterval(snapTimer);
      clearInterval(panelTimer);
      sync.close();
    },
  };
}
