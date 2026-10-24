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
// Phase CF K8 (SUP-4, SUP-5, CL-11, Appendix D): the chip names the device
// that made a change ("S4 · Radar on · by iPad · 21:32", then "last change
// 2:14 ago by Laptop"), in steel only (C65); its words come from
// twinDescribe.js. A window that is not on the wall shows one calm card
// and nothing else (body.tt-unpaired: field, dot grid, the card, 3D
// paused): the pair card (also after a lost pairing, a used link or a slot
// given away), or a card with no code: shown in another window, out of
// date, rejoining paused (RATE_LIMITED), too many waiting (BUSY), refused.
// The band under the chip stays free for the V1 voice strip.
import { toJpeg } from 'html-to-image';
import { ROLES, wallName } from './twinScreenRoles.js';
import { connectSync } from './twinSync.js';
import { DENY, UNPAIRED, driftState, reloadGuard } from './twinProtocol.js';
import { setNameStyle } from './twinHud.js';
import { createWallSheet } from './twinWallSheet.js';
import {
  CHIP_RECENT_MS,
  byText,
  chipText,
  describeChange,
  lastChangeOf,
  render,
  wallCard,
} from './twinDescribe.js';

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
  pair.dataset.ttCard = '';
  // A card with no code (K8): replaced, out of date, paused, refused.
  const card = el('div', 'tt-wall-card');
  card.hidden = true;
  card.setAttribute('role', 'status');
  chip.dataset.ttChip = '';
  const ident = el('div', 'tt-wall-ident');
  ident.hidden = true;
  const banner = el('div', 'tt-wall-banner');
  banner.hidden = true;
  banner.setAttribute('role', 'alert');
  // No dot grid over the 3D view (Jesse, 23 Oct 2026). The calm unpaired
  // card draws its own on the field while the scene is paused (K8).
  document.body.append(head, wxStrip, stale, panel, banner, pair, card, ident);

  let state = null;
  let presence = null;
  let mySlot = slot ? Number(slot) : null;
  let applied = {};
  // K8: the change shown in the chip for 3 s ({summary, byName, at}), the
  // newest change this window saw arrive ({rev, at, byName}: its own
  // clock), and the name of the last remote in control.
  let change = null;
  let seen = null;
  let lastCtl = null;
  // Why the next pair card asks again: {kind, at} (lost, link, slot).
  let pairNote = null;
  let cardOn = null; // the card shown, or null
  let sheet = null; // this screen's L / D / K sheets (D5), made below
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

  /**
   * One calm card and nothing else (SUP-5): the field, the dot grid, the
   * card; the 3D scene paused. `kind` per twinDescribe.js wallCard.
   */
  function showCard(kind, data = {}) {
    const c = wallCard(kind, { slot: mySlot, host: location.host, ...data });
    const box = el('div', 'box tt-panel');
    box.append(el('div', 'k', c.kicker));
    for (const line of c.lines) box.append(el('div', 'lead', line));
    if (c.code) {
      box.append(el('div', 'code', c.code), el('div', 'how', c.how));
      if (c.valid) box.append(el('div', 'valid', c.valid));
      const foot = el('div', 'foot');
      foot.append(
        el('span', 'url', location.host),
        el(
          'span',
          'note',
          ' · this window shows nothing from the wall until it is paired',
        ),
      );
      box.append(foot);
    }
    if (c.button) {
      const b = el('button', 'tt-btn', c.button);
      b.type = 'button';
      b.addEventListener('click', useThisWindow);
      box.append(b);
    }
    const node = c.code ? pair : card;
    (c.code ? card : pair).hidden = true;
    node.dataset.ttCard = c.kind;
    node.replaceChildren(box);
    node.hidden = false;
    cardOn = c.kind;
    // A card replaces the scene: no wall sheet stays open behind it.
    sheet?.close();
    const b = document.body;
    b.classList.add('tt-unpaired');
    b.dataset.ttCard = c.kind;
    // Nothing from the wall shows, and the 3D scene stops (K8).
    b.dataset.role = '';
    api.pauseRender(true);
  }
  /** Back on the wall: the scene returns with this screen's role. */
  function hideCard() {
    if (!cardOn) return;
    cardOn = null;
    pair.hidden = true;
    card.hidden = true;
    const b = document.body;
    b.classList.remove('tt-unpaired');
    delete b.dataset.ttCard;
  }
  function showPair(code, ttlMs) {
    const note = pairNote;
    showCard(note?.kind || 'pair', {
      code,
      at: note?.at,
      slot: note?.slot ?? mySlot,
      expires: ttlMs ? Date.now() + ttlMs : null,
    });
  }
  /**
   * "Use this window instead" (sup S8): this window takes a fresh id and
   * asks for a code; the shared slot record stays the other window's.
   */
  function useThisWindow() {
    try {
      sessionStorage.removeItem('tripTwin.soc.device.screen');
    } catch {
      /* no storage: a fresh id anyway */
    }
    const q = new URLSearchParams(location.search);
    q.delete('setup');
    q.delete('slot');
    location.search = `?${q}`;
  }

  /** Apply the role's look (CSS) and its defaults (once per role). */
  function applyRole(s) {
    const role = ROLES[s.role] || ROLES.site;
    const b = document.body;
    if (b.dataset.role !== role.key) {
      b.dataset.role = role.key;
      api.pauseRender(!role.canvas || Boolean(cardOn));
      // A new role starts at its own scale (the operator can change it).
      if (role.scale && !s.meta?.scale) api.scale(role.scale);
      api.applyRoleDefaults?.(role.key);
    }
    b.dataset.merged = (s.merged || []).join(' ');
    const ws = String(s.textScale || 2);
    if (b.style.getPropertyValue('--wall-scale') !== ws) {
      b.style.setProperty('--wall-scale', ws);
      // New text size: the lists fit again (W3).
      requestAnimationFrame(() => api.refitRail?.());
    }
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
      const where = api.incidentElsewhere?.();
      // A report at another site of this trip (W2): the red header, then
      // the usual board, since there is no floor board for the site on screen.
      document.body.classList.toggle('tt-incident-open', open && !where);
      document.body.classList.toggle('tt-incident-elsewhere', Boolean(where));
      if (where) {
        const board = el('div');
        api.idlePanel(board, { reported: true });
        panel.replaceChildren(
          el(
            'div',
            'tt-kicker tt-wall-inc',
            `INCIDENT REPORTED AT ${where.toUpperCase()} · NOT VERIFIED`,
          ),
          el(
            'div',
            'tt-wall-note',
            `At ${where}, not the site on screen · the list on the left includes who may be there`,
          ),
          ...board.childNodes,
        );
      } else if (open)
        panel.replaceChildren(
          el('div', 'tt-kicker', 'INCIDENT REPORTED · NOT VERIFIED'),
          el(
            'div',
            'tt-wall-note',
            'Reported, not verified · the board below follows the report',
          ),
        );
      else api.idlePanel(panel);
      fitPanel();
    }
  }

  /**
   * S3's board never runs off the screen silently (walls-live W3): the
   * last lines go, and a line says how many.
   */
  function fitPanel() {
    if (panel.hidden || !panel.clientHeight) return;
    const over = () => panel.scrollHeight > panel.clientHeight + 2;
    let hidden = 0;
    while (over() && panel.children.length > 3) {
      const last = panel.lastElementChild;
      if (last.classList.contains('tt-wall-line')) hidden += 1;
      last.remove();
    }
    // A kicker left without its lines goes too.
    if (panel.lastElementChild?.classList.contains('tt-kicker'))
      panel.lastElementChild.remove();
    if (!hidden) return;
    const more = el('div', 'tt-wall-more');
    panel.append(more);
    // The line itself may push one more out.
    for (;;) {
      more.textContent = `+${hidden} more line${hidden > 1 ? 's' : ''} · not shown on this screen`;
      if (!over() || panel.children.length <= 4) break;
      const prev = more.previousElementSibling;
      if (prev.classList.contains('tt-wall-line')) hidden += 1;
      prev.remove();
    }
  }

  function applyState(next, info = {}) {
    if (!next) return;
    if (next.rev === applied.rev && !info.force) return;
    const prev = state;
    state = next;
    const s = me();
    const ss = next.session;
    // Where the full attention list is (a wall list ends "+n · all on S3").
    document.body.dataset.boardSlot =
      Object.keys(next.screens).find(
        (k) => next.screens[k].role === 'incident',
      ) || '';
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
    // Who changed this wall, in the chip's words (SUP-4, CL-11).
    if (prev && info.by) {
      const at = Date.now();
      const c = describeChange(prev, next, info, at);
      const summary = render(c, {
        audience: 'wall',
        slot: mySlot,
        visitor: Boolean(ss.visitor),
        names: api.names || undefined,
      });
      if (summary) {
        const byName = byText(info.by, presence?.actors);
        change = { summary, byName, at };
        seen = { rev: next.rev, at, byName };
      }
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
    if (ctl?.name) lastCtl = ctl.name;
    const hands = handsOn() ? ' · hands-on' : drifting ? ' · drifting' : '';
    const now = Date.now();
    const online = Boolean(sync?.online);
    if (online && !ctl && !remoteGoneAt) remoteGoneAt = now;
    if (ctl) remoteGoneAt = null;
    const recent = Boolean(change) && now - change.at < CHIP_RECENT_MS;
    // The last change this wall shows: the one seen arriving (this
    // computer's clock), else the state's meta (a page opened after it).
    const meta = lastChangeOf(state, mySlot);
    const last =
      seen && (!meta || seen.rev >= meta.rev)
        ? seen
        : meta && { at: meta.at, byName: byText(meta.ref, presence?.actors) };
    chip.textContent = chipText({
      slot: mySlot,
      online,
      controller: ctl ? ctl.name || 'a remote' : null,
      lastController: lastCtl,
      remoteGoneAt,
      change: recent ? change : null,
      last,
      now,
      suffix: `${s?.pinned ? ' · pinned' : ''}${hands}`,
    });
    // Steel only (C65): the words carry the state, not a colour.
    chip.className = `tt-wall-chip${!online || !ctl ? ' warn' : ''}${recent ? ' changed' : ''}`;
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
  sheet = createWallSheet({
    screen: me,
    slot: () => mySlot,
    online: () => Boolean(sync?.online && mySlot),
    // Not while a card replaces the scene (K8): nothing to change yet.
    blocked: () => Boolean(cardOn),
    write: (cmd, label) => sync.request({ t: 'screen-cmd', cmd, label }),
  });
  // A resized wall (another display, full screen) fits its lists again.
  let refitTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => api.refitRail?.(), 200);
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
    if (g.reload) return location.reload();
    // Refused again within 2 minutes: say so, show nothing (Appendix D 1a).
    showCard('reload', { at: Date.now() });
    if (g.waitMs) reloadTimer = setTimeout(reloadOutOfDate, g.waitMs);
  };
  /** A refusal the page itself shows (not the ones twinSync answers). */
  function denied(m) {
    if (m.code === DENY.RELOAD) return reloadOutOfDate();
    if (m.code === DENY.RATE_LIMITED)
      return showCard('rate-limited', {
        until: Date.now() + (m.retryAfterMs || 60000),
      });
    if (m.code === DENY.BUSY)
      return showCard('busy', { retryAfterMs: m.retryAfterMs });
    showCard('denied', { error: m.error });
  }
  // A slot given away reloads this window into a pair card that says so.
  const NOTE_KEY = 'tripTwin.soc.wallNote';
  try {
    pairNote = JSON.parse(sessionStorage.getItem(NOTE_KEY) || 'null');
    sessionStorage.removeItem(NOTE_KEY);
  } catch {
    pairNote = null;
  }

  sync = connectSync({
    kind: 'screen',
    slot,
    setup,
    on: {
      welcome(m) {
        if (m.type === 'denied') return denied(m);
        // A wall waiting for a code gets no presence or state (K7).
        if (m.presence) presence = m.presence;
        if (m.type === 'paired') {
          mySlot = m.slot;
          pairNote = null;
          hideCard();
          restoredAt = null;
          dropSetupFromUrl();
          keepSlotInUrl(m.slot);
          applyState(m.state, { force: true });
        } else if (m.type === 'pair-code') {
          // No cached state behind a code: this window holds no pairing.
          state = null;
          applied = {};
          restoredAt = null;
          showPair(m.code, m.ttlMs);
        }
      },
      // A terminal refusal twinSync answered with a fresh id (S-16): the
      // next pair card says why.
      refused(m) {
        const kind =
          m.code === DENY.TICKET_EXPIRED || m.code === DENY.TICKET_USED
            ? 'link-expired'
            : m.code === DENY.TOKEN_EXPIRED
              ? 'token-expired'
              : m.code === DENY.ID_IN_USE
                ? 'lost'
                : null;
        if (kind) pairNote = { kind, at: Date.now() };
      },
      // Another window took this identity (C16): stop, keep storage as it
      // is — the shared token is the winner's. The card has no code (sup
      // S8); data-tt-link is for the harness.
      replaced() {
        document.body.dataset.ttLink = 'replaced';
        state = null;
        showCard('replaced', { at: Date.now() });
        paint();
      },
      // This slot went to another device: back to a pairing code (R10).
      unpaired(m) {
        sync.forget();
        try {
          localStorage.removeItem(`tripTwin.soc.lastState.${mySlot}`);
          if (m?.reason === UNPAIRED.SLOT_TAKEN)
            sessionStorage.setItem(
              NOTE_KEY,
              JSON.stringify({
                kind: 'slot-taken',
                at: Date.now(),
                slot: mySlot,
              }),
            );
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
        pairNote = null;
        hideCard();
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
