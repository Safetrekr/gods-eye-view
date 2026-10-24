// SOC multi-view wall screen (phase 10). A screen is twin.html?view=screen:
// display only (no toolbar, popovers or settings — those live on the
// remote). It follows the session from the relay, applies its role, says
// who controls it and how old its link is, and sends a snapshot to the
// remote every few seconds. It never moves its camera on its own: camera
// changes come only from an operator's frame request.
// Phase CF K5 (S-15): a wall the relay calls out of date (RELOAD) reloads
// itself at most once per 2 minutes and otherwise keeps what it shows
// (K8 adds the card). Non-visual.
// Phase CF K6 (BE-6, ET-5): the `local` message also says `drift` and
// `driftReason` (twinProtocol.js DRIFT_REASONS), so the relay logs drift
// and hands-on from fields, never from the text. Non-visual.
import { toJpeg } from 'html-to-image';
import { ROLES, wallName } from './twinScreenRoles.js';
import { connectSync } from './twinSync.js';
import { DENY, driftState, reloadGuard } from './twinProtocol.js';
import { setNameStyle } from './twinHud.js';
import { createWallSheet } from './twinWallSheet.js';

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
  // Phase 12: the approach line and the lens line, under the header.
  const wxStrip = el('div', 'tt-wall-wx');
  wxStrip.hidden = true;
  wxStrip.setAttribute('role', 'status');
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
  // No dot grid over the 3D view (Jesse, 23 Oct 2026).
  document.body.append(head, wxStrip, stale, panel, banner, pair, ident);

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
  let lastActivity = Date.now(); // the drift clock: input or a camera change
  let dragging = false;
  let drifting = false;
  const DRIFT_AFTER_MS = 60000;
  let pendingCamera = [];
  let sentLocal = '';
  // What last reset the idle clock: 'input' or 'command' (K6 driftReason).
  let stopCause = 'input';
  let remoteGoneAt = null; // when the controlling remote went away
  let restoredAt = null; // a cached state shown before the link connects
  // Assigned below; the client reports status while it is being created.
  let sync = null;

  const me = () => (state && mySlot ? state.screens[mySlot] : null);
  /** Stop the idle drift at once and restart its 60 s clock (F2). */
  const stopDrift = (cause = 'command') => {
    lastActivity = Date.now();
    stopCause = cause;
    if (!drifting) return;
    drifting = false;
    api.drift?.(false);
    document.body.classList.remove('tt-drifting');
  };
  const linkLost = () =>
    !sync?.online || (sync?.linkAgeS != null && sync.linkAgeS > 15);

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
      role === 'incident' ||
      role === 'day'
    );
    if (role === 'weather') api.weatherPanel(panel);
    else if (role === 'trips') api.tripsPanel(panel);
    else if (role === 'day') api.dayPanel?.(panel);
    else if (role === 'incident') {
      // Idle: say so plainly; the board fills when a floor is reported.
      const open = api.incidentOpen();
      document.body.classList.toggle('tt-incident-open', open);
      if (open)
        panel.replaceChildren(
          el('div', 'tt-kicker', 'INCIDENT REPORTED · NOT VERIFIED'),
          el(
            'div',
            'tt-wall-note',
            'Reported, not verified · the board below follows the report',
          ),
        );
      else api.idlePanel(panel);
    }
  }

  function applyState(next, info = {}) {
    if (!next) return;
    if (next.rev === applied.rev && !info.force) return;
    const prev = state;
    state = next;
    const s = me();
    const ss = next.session;
    // A trip in another city needs that city's twin: reload into it —
    // only on live state from the relay. A cached state may name the old
    // trip; acting on it bounced walls between cities (Jesse, 16 Oct).
    if (ss.tripId && api.tripCity(ss.tripId) !== api.cityKey) {
      if (info.cached) return;
      // Remember the new state first, so the reloaded page starts there.
      try {
        localStorage.setItem(
          `tripTwin.soc.lastState.${mySlot}`,
          JSON.stringify({ state: next, at: Date.now() }),
        );
      } catch {
        /* ignore */
      }
      // Never reload twice for the same trip within a few seconds.
      const key = `tripTwin.soc.reloadFor.${mySlot}`;
      try {
        const last = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (last?.trip === ss.tripId && Date.now() - last.at < 8000) return;
        sessionStorage.setItem(
          key,
          JSON.stringify({ trip: ss.tripId, at: Date.now() }),
        );
      } catch {
        /* ignore */
      }
      const q = new URLSearchParams(location.search);
      q.set('city', api.tripCity(ss.tripId));
      q.set('scenario', api.tripScenario(ss.tripId));
      q.delete('site');
      location.search = `?${q}`;
      return;
    }
    if (ss.epochMs && ss.epochMs !== applied.epochMs) api.setEpoch(ss.epochMs);
    // No site chosen (e.g. just after a trip switch): the trip's hotel.
    const site = ss.siteKey || api.cityKey;
    if (site !== applied.siteKey) {
      stopDrift();
      api.switchSite(site);
    }
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
      // Motion tiers are this wall's own (phase 11).
      const mkey = JSON.stringify(s.motion || {});
      if (mkey !== applied.motionKey) {
        api.setMotion?.(s.motion || {});
        applied.motionKey = mkey;
      }
      // Camera changes never yank a view someone is dragging: they wait
      // for the mouse to be released.
      const camera = (fn) => (dragging ? pendingCamera.push(fn) : fn());
      if (s.meta?.scale && s.scale && s.meta.scale.rev !== applied.scaleRev) {
        const sc = s.scale;
        camera(() => api.scale(sc));
        applied.scaleRev = s.meta.scale.rev;
        stopDrift();
      }
      // Camera intent: only an operator's explicit request, once.
      if (s.frame?.nonce && s.frame.nonce !== applied.frameNonce) {
        const subject = s.frame.subject;
        camera(() => api.frame(subject));
        applied.frameNonce = s.frame.nonce;
        stopDrift();
      }
    }
    if (JSON.stringify(ss.report) !== JSON.stringify(applied.report)) {
      stopDrift();
      api.report(ss.report);
    }
    if (JSON.stringify(ss.spotlight) !== JSON.stringify(applied.spotlight)) {
      stopDrift();
      api.spotlight(ss.spotlight);
    }
    if (ss.wxAt !== applied.wxAt) api.setWxTime(ss.wxAt);
    if ((ss.simStorm || null) !== (applied.simStorm || null))
      api.setSimStorm?.(ss.simStorm || null);
    applied = {
      ...applied,
      rev: next.rev,
      epochMs: ss.epochMs,
      siteKey: ss.siteKey || api.cityKey,
      report: ss.report,
      spotlight: ss.spotlight,
      wxAt: ss.wxAt,
      simStorm: ss.simStorm || null,
    };
    if (prev && info.by) {
      lastChangeAt = Date.now();
      changeText = info.undone
        ? 'Undone'
        : info.by === 'screen' && info.slot === mySlot
          ? 'Set at this screen'
          : 'Updated';
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
    sheet?.refresh();
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
    const badgeText = advance
      ? `ADVANCE · ${api.dayLabel()}`
      : dayPlan
        ? `TODAY'S PLAN · ${api.dayLabel()}`
        : ss.simStorm
          ? 'LIVE · DEMO STORM'
          : 'LIVE';
    if (badge.dataset.text !== badgeText) {
      badge.dataset.text = badgeText;
      // The live dot breathes under the Live tier (phase 11).
      badge.replaceChildren(
        ...(badgeText.startsWith('LIVE') ? [el('span', 'tt-livedot')] : []),
        badgeText,
      );
    }
    badge.classList.toggle(
      'demo',
      Boolean(ss.simStorm) && !advance && !dayPlan,
    );
    badge.classList.toggle('adv', advance || dayPlan);
    document.body.classList.toggle('tt-dayplan-live', dayPlan && !advance);
    time.textContent = api.clockText();
    visitorMark.hidden = !ss.visitor;
    const ctl = presence?.remotes?.find((r) => r.controller);
    const hands = handsOn() ? ' · hands-on' : drifting ? ' · drifting' : '';
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
    document.body.classList.toggle('tt-stale', Boolean(lost && state));
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
    // The approach (arriving, near or over) and the lens line, every wall:
    // a big lead figure, the claim, then the detail (phase 12 review).
    const ap = api.approachLine?.();
    const lens = api.lensLine?.() || '';
    const showAp = ['arriving', 'near', 'over'].includes(ap?.status);
    wxStrip.hidden = !(showAp || lens);
    document.body.classList.toggle('tt-wx-strip-on', !wxStrip.hidden);
    if (!wxStrip.hidden) {
      const who = s?.role === 'trips' ? api.tripTitle?.() : '';
      const key = JSON.stringify([
        lens,
        showAp && ap.lead,
        showAp && ap.claim,
        showAp && ap.detail,
        who,
      ]);
      if (wxStrip.dataset.key !== key) {
        wxStrip.dataset.key = key;
        const parts = [];
        if (lens) parts.push(el('div', 'tt-wx-lens', lens));
        if (showAp) {
          const row = el('div', 'tt-wx-tiers');
          if (ap.lead) row.append(el('div', 'tt-wx-lead', ap.lead));
          const txt = el('div', 'tt-wx-text');
          txt.append(
            el('div', 'tt-wx-claim', who ? `${who} · ${ap.claim}` : ap.claim),
          );
          if (ap.detail && !lens)
            txt.append(el('div', 'tt-wx-detail', ap.detail));
          row.append(txt);
          parts.push(row);
        }
        wxStrip.replaceChildren(...parts);
      }
      wxStrip.className = `tt-wall-wx ${showAp ? ap.level : 'info'}${lens ? ' lens' : ''}`;
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
    stopDrift('input');
    if (!b.classList.contains('tt-hands-on')) {
      b.classList.add('tt-hands-on');
      paint();
    }
    b.classList.remove('tt-idle-cursor');
  }
  for (const t of ['pointermove', 'pointerdown', 'wheel', 'keydown'])
    window.addEventListener(t, onInput, { capture: true, passive: true });
  // L / D / K: this screen's own Layers, Display and Keys sheets (D5),
  // written through the session so the remote stays the truth.
  const sheet = createWallSheet({
    screen: me,
    slot: () => mySlot,
    online: () => Boolean(sync?.online && mySlot),
    write: (cmd, label) => sync.request({ t: 'screen-cmd', cmd, label }),
  });
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
    // Idle drift (Cinematic tier, Jesse 16 Oct): only the Site wall, only
    // after 60 s with no hands on, never during an incident, never while a
    // camera change is pending. The wall says so in its chip.
    // The same conditions, in the same order, named (K6 driftReason).
    const s = me();
    const why = driftState([
      ['role', Boolean(s && s.role === 'site')],
      ['tier', s?.motion?.cine !== false && Boolean(api.motionOn?.('cine'))],
      ['input', !handsOn() && !dragging],
      ['camera', !pendingCamera.length],
      [stopCause, now - lastActivity > DRIFT_AFTER_MS],
      ['incident', !api.incidentOpen() && !api.anyIncidentOpen?.()],
      [
        'link',
        !linkLost() &&
          // Phase 11 F2: no drift while the controlling remote is offline.
          Boolean(presence?.remotes?.some((r) => r.controller)),
      ],
    ]);
    const wantDrift = why.drift;
    if (wantDrift !== drifting) {
      drifting = wantDrift;
      api.drift?.(drifting);
      b.classList.toggle('tt-drifting', drifting);
    }
    const text = handsOn()
      ? ['hands-on', api.selectionText?.()].filter(Boolean).join(' · ')
      : drifting
        ? ['drifting · idle camera', api.selectionText?.()]
            .filter(Boolean)
            .join(' · ')
        : api.selectionText?.()
          ? `shows: ${api.selectionText()}`
          : '';
    const said = `${drifting ? 1 : 0}${text}`;
    if (said !== sentLocal && sync?.online && mySlot) {
      sentLocal = said;
      sync.send({
        t: 'local',
        on: handsOn(),
        text,
        drift: drifting,
        driftReason: why.reason,
      });
    }
  }

  /** The setup token has done its job once the screen has joined (R1). */
  function dropSetupFromUrl() {
    const q = new URLSearchParams(location.search);
    if (!q.has('setup')) return;
    q.delete('setup');
    history.replaceState(null, '', `?${q}`);
  }

  /**
   * The slot stays in the URL (also after pairing by code), so a reload or
   * a restored window finds this wall's slot record (Phase CF K4).
   */
  function keepSlotInUrl(n) {
    const q = new URLSearchParams(location.search);
    if (!n || q.get('slot') === String(n)) return;
    q.set('slot', String(n));
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
      g.fillStyle = '#040c12';
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

  // Out of date (RELOAD): reload once; refused again within 2 minutes,
  // try again when the 2 minutes are up. No sessionStorage: never.
  let reloadTimer = null;
  const reloadOutOfDate = () => {
    clearTimeout(reloadTimer);
    let store = null;
    try {
      store = sessionStorage;
    } catch {
      /* no storage: the guard says no */
    }
    const g = reloadGuard({ storage: store, now: () => Date.now() });
    if (g.reload) location.reload();
    else if (g.waitMs) reloadTimer = setTimeout(reloadOutOfDate, g.waitMs);
  };

  sync = connectSync({
    kind: 'screen',
    slot,
    setup,
    on: {
      welcome(m) {
        if (m.type === 'denied' && m.code === DENY.RELOAD)
          return reloadOutOfDate();
        welcomeAt = Date.now();
        // A wall waiting for a code gets no presence or state (K7).
        if (m.presence) presence = m.presence;
        if (m.type === 'paired') {
          mySlot = m.slot;
          pair.hidden = true;
          restoredAt = null;
          dropSetupFromUrl();
          keepSlotInUrl(m.slot);
          applyState(m.state, { force: true });
        } else if (m.type === 'pair-code') showPair(m.code);
      },
      // Another window took this identity (C16): stop, keep storage as it
      // is — the shared token is the winner's. The chip says "not
      // connected" until K8 adds the card; data-tt-link is for the harness.
      replaced() {
        document.body.dataset.ttLink = 'replaced';
        paint();
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
        keepSlotInUrl(m.slot);
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
      status: () => {
        paint();
        sheet.refresh();
      },
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
      applyState(last.state, { force: true, cached: true });
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
      clearTimeout(reloadTimer);
      clearInterval(tick);
      clearInterval(snapTimer);
      clearInterval(panelTimer);
      sync.close();
    },
  };
}
