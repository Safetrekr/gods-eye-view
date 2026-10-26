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
import {
  ROLES,
  SAFETY_LAYERS,
  WALL_TEXT_MAX,
  WALL_TEXT_MIN,
  layerValue,
  wallShellOn,
  layoutValue,
  wallName,
} from './twinScreenRoles.js';
import { connectSync } from './twinSync.js';
import { DENY, UNPAIRED, driftState, reloadGuard } from './twinProtocol.js';
import { setNameStyle } from './twinHud.js';
import { createWallSheet } from './twinWallSheet.js';
import { createWallRail } from './twinWallRail.js';
import { MAP_ROLES, wallPage } from './twinWallPages.js';
import {
  CHIP_RECENT_MS,
  agoText,
  byText,
  chipText,
  describeChange,
  forText,
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
  // The All-in-one's top bar on every wall (screens/05-S1-PLAN §2): the
  // SafeTrekr lockup with this screen's number and role · trip › site │
  // LIVE, another trip's report, data age and the trip's clock │ who is in
  // control (short) and the HANDS-ON / SET AT WALL / VISITOR tags.
  const head = el('header', 'tt-bar tt-wall-bar');
  head.id = 'tt-wall-head';
  head.dataset.ttBar = 'wall';
  const left = el('div', 'tt-bar-place tt-wall-left');
  const brand = el('span', 'tt-brand');
  const clip = el('span', 'tt-brand-clip');
  const mark = el('img', 'tt-brand-mark');
  mark.src = '/safetrekr-logo.svg';
  mark.alt = 'SafeTrekr';
  clip.append(mark);
  const sep = el('span', 'tt-brand-sep');
  sep.setAttribute('aria-hidden', 'true');
  // "S1" small mono + the role in Manrope (walls-live D2).
  const kicker = el('span', 'tt-wall-slot');
  const roleName = el('span', 'tt-brand-name tt-wall-role');
  brand.append(clip, sep, kicker, roleName);
  const where = el('nav', 'tt-crumbs tt-wall-where');
  where.setAttribute('aria-label', 'Trip and site');
  left.append(brand, where);
  const status = el('div', 'tt-bar-status tt-wall-status');
  const badge = el('div', 'tt-wall-badge');
  // This trip's state, as the All-in-one's pill (F1): red INCIDENT · THIS
  // TRIP while a report is open, WATCH in amber; nothing when calm.
  const modePill = el('span', 'tt-mode tt-wall-mode');
  modePill.hidden = true;
  modePill.setAttribute('role', 'status');
  // Another trip's report, on every wall (walls-live W1, D1): red, points
  // to the Trips wall, never switches this one.
  const other = el('div', 'tt-other-alert tt-wall-other');
  other.hidden = true;
  other.setAttribute('role', 'status');
  // The trip's clock and the data age, one place on every wall (W11).
  const clockRow = el('span', 'tt-bar-read tt-wall-clockrow');
  const data = el('span', 'tt-age tt-wall-data');
  const time = el('span', 'tt-clock tt-wall-time');
  clockRow.append(data, time);
  status.append(badge, modePill, other, clockRow);
  const right = el('div', 'tt-bar-cond tt-wall-right');
  const chip = el('div', 'tt-wall-chip');
  chip.setAttribute('role', 'status');
  // Tags. Hands-on is a tag, not a frame round the wall (W4).
  const tags = el('div', 'tt-wall-tags');
  const handsTag = el('span', 'tt-wall-tag tt-wall-hands', 'HANDS-ON');
  handsTag.hidden = true;
  // Set here, not on the remote (screens/03-spec-aia §4).
  const wallTag = el('span', 'tt-wall-tag tt-wall-set', 'SET AT WALL');
  wallTag.hidden = true;
  // Visitor mode is visible on every wall (review/phase10 R6).
  const visitorMark = el('span', 'tt-wall-visitor', 'VISITOR MODE');
  visitorMark.title = 'Visitor mode · initials and counts only';
  visitorMark.hidden = true;
  tags.append(handsTag, wallTag, visitorMark);
  right.append(chip, tags);
  head.append(left, status, right);
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
  let myRef = null; // this wall's attribution ref, once it has made a change
  let handsEndedAt = null; // when the last hand left (S2 back-to-group)
  let wallPick = null; // a person selected by a hand at this wall
  const s0 = () => (state && mySlot ? state.screens[mySlot] : null);
  // Why the next pair card asks again: {kind, at} (lost, link, slot).
  let pairNote = null;
  let cardOn = null; // the card shown, or null
  let sheet = null; // this screen's L / D / K sheets (D5), made below
  let rail = null; // this screen's own menu (screens/05-S1-PLAN), made below
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
    // A card replaces the scene: no wall sheet or menu stays open behind it.
    sheet?.close();
    if (rail) setRail(false, { focus: false });
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
    // The new frame, role by role (05-S1-PLAN): S1 first; a one-screen
    // (merged) wall keeps its old layout until S2's turn (F21).
    const shell = wallShellOn(s);
    b.classList.toggle('tt-wall-shell', shell);
    // A map wall in the new frame: the map bar and the compass top right.
    b.classList.toggle('tt-wall-map', shell && Boolean(ROLES[s.role]?.canvas));
    // More than one role on this wall: a second card column (S2 plan §2).
    b.classList.toggle('tt-wall-two', shell && (s.merged || []).length > 0);
    // A board wall in the new frame (S3; 95-S3-PLAN): two card columns.
    b.classList.toggle('tt-wall-board', shell && s.role === 'incident');
    setWallScale(s.textScale);
    applyLayout(s);
    renderPanel();
  }

  /**
   * Text size follows the display, not the role (walls-live D4, W6): the
   * session's text size times the display's height against a 1440 px LG
   * 5K, clamped. The menu reads at arm's length: it follows the display
   * only (screens/02-spec-ux §2–3).
   */
  function setWallScale(ts) {
    const disp = Math.max(0.85, Math.min(1.35, innerHeight / 1440));
    const t = Math.max(
      WALL_TEXT_MIN,
      Math.min(WALL_TEXT_MAX, Number(ts) || 1.75),
    );
    const ws = String(+(t * disp).toFixed(3));
    const b = document.body;
    b.style.setProperty('--wall-disp', String(+disp.toFixed(3)));
    if (b.style.getPropertyValue('--wall-scale') !== ws) {
      b.style.setProperty('--wall-scale', ws);
      // New text size: the lists fit again (W3).
      requestAnimationFrame(() => api.refitRail?.());
    }
  }

  /** This wall's layout (cards or map only, column width, hidden cards). */
  function applyLayout(s) {
    const l = layoutValue(s);
    const b = document.body;
    b.dataset.wallCards = l.cards;
    b.dataset.wallWidth = l.width;
    b.dataset.wallOff = l.off.join(' ');
    refitOnChange();
  }
  // The columns change width when the menu opens or closes or Columns
  // changes: the lists fit again (S3 reviews).
  let fitKey = '';
  function refitOnChange() {
    const b = document.body;
    const k = `${b.classList.contains('tt-wst-open')}|${b.dataset.wallWidth}`;
    if (k === fitKey) return;
    const first = !fitKey;
    fitKey = k;
    if (first) return;
    requestAnimationFrame(() => {
      api.refitRail?.();
      if (b.classList.contains('tt-wall-board') || b.dataset.role === 'weather')
        renderPanel();
    });
  }

  function renderPanel() {
    const role = document.body.dataset.role;
    // Off the board wall the panel goes back to the page.
    const shellWx =
      role === 'weather' && document.body.classList.contains('tt-wall-shell');
    if (
      panel.parentNode !== document.body &&
      !(
        role === 'incident' && document.body.classList.contains('tt-wall-board')
      ) &&
      !shellWx
    )
      document.body.append(panel);
    panel.hidden = !(
      role === 'weather' ||
      role === 'trips' ||
      role === 'incident' ||
      role === 'day'
    );
    if (shellWx) {
      // S4 in the new frame (A5-S4-PLAN): the cards sit in the left column.
      const rcol = document.getElementById('tt-rcol');
      if (rcol && panel.parentNode !== rcol) rcol.append(panel);
      api.weatherPanel(panel, { cards: true });
      fitWeather();
    } else if (role === 'weather') api.weatherPanel(panel);
    else if (role === 'trips') api.tripsPanel(panel);
    else if (role === 'day') api.dayPanel?.(panel);
    else if (
      role === 'incident' &&
      document.body.classList.contains('tt-wall-board')
    ) {
      // The new frame (95-S3-PLAN): the board's cards sit in the right
      // column, under the report card.
      const rcol = document.getElementById('tt-rcol');
      if (rcol && panel.parentNode !== rcol) rcol.append(panel);
      const open = api.incidentOpen();
      const where = api.incidentElsewhere?.();
      document.body.classList.toggle('tt-incident-open', open && !where);
      document.body.classList.toggle('tt-incident-elsewhere', Boolean(where));
      const roles = Object.values(state?.screens || {}).flatMap((x) => [
        x.role,
        ...(x.merged || []),
      ]);
      api.boardPanel(panel, {
        report: open && !where,
        where: where || null,
        hasWeather: roles.includes('weather'),
        hasDay: roles.includes('day'),
      });
      fitBoard();
    } else if (role === 'incident') {
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
   * S3's board in the new frame (95-S3-PLAN): the right column never runs
   * off the wall silently. Stand-ins step out first; Changed keeps its
   * newest three lines and says how many earlier; only then does the
   * report card fit itself (fitIncident calls this first). Official
   * warnings never step out.
   */
  api.setBoardFit?.(() => fitBoard());
  function fitBoard() {
    const rcol = document.getElementById('tt-rcol');
    if (!rcol) return;
    const over = () => rcol.scrollHeight > rcol.clientHeight + 2;
    for (const c of [
      ...panel.querySelectorAll('.tt-board-card.standin'),
    ].reverse()) {
      if (!over()) break;
      c.remove();
    }
    const ch = panel.querySelector('.tt-board-changed');
    if (ch && over()) {
      const lines = [...ch.querySelectorAll('.tt-wall-line')];
      const total = Math.max(lines.length, Number(ch.dataset.total) || 0);
      if (lines.length > 3) {
        // The newest three, the report's own line always among them.
        const rep = lines.find((l) => l.dataset.report === '1');
        const keep = new Set(
          rep && lines.indexOf(rep) > 2
            ? [...lines.slice(0, 2), rep]
            : lines.slice(0, 3),
        );
        for (const l of lines) if (!keep.has(l)) l.remove();
        const more = el(
          'div',
          'tt-wall-note',
          `+${total - 3} earlier · on the remote`,
        );
        ch.append(more);
      }
    }
    const paths = panel.querySelector('.tt-board-paths');
    if (paths && over()) paths.remove();
  }

  /**
   * S4's cards never run off the wall silently (A5-S4-PLAN): the sources
   * note goes, then At the hotel and Sensed fold to their first line,
   * then Outdoors keeps three names and counts the rest. Official and the
   * approach never step out.
   */
  function fitWeather() {
    const rcol = document.getElementById('tt-rcol');
    if (!rcol) return;
    const over = () => rcol.scrollHeight > rcol.clientHeight + 2;
    const steps = [
      () => {
        for (const n of panel.querySelectorAll(
          '.tt-board-approach .tt-wall-note',
        ))
          n.remove();
      },
      () => panel.querySelector('.tt-board-hotel .tt-wall-note')?.remove(),
      () => {
        for (const n of [
          ...panel.querySelectorAll('.tt-board-hotel .tt-wall-line'),
        ].slice(1))
          n.remove();
      },
      () => {
        const lines = [
          ...panel.querySelectorAll('.tt-board-sensed .tt-wall-line'),
        ];
        for (const n of lines.slice(1)) n.remove();
        if (lines.length > 1)
          panel
            .querySelector('.tt-board-sensed')
            ?.append(
              el(
                'div',
                'tt-wall-note',
                `+${lines.length - 1} more · on the remote`,
              ),
            );
      },
      () => {
        const lines = [
          ...panel.querySelectorAll('.tt-board-outdoors .tt-wall-line'),
        ];
        const total = Number(
          panel.querySelector('.tt-board-outdoors')?.dataset.total || 0,
        );
        if (lines.length <= 3) return;
        for (const n of lines.slice(3)) n.remove();
        panel.querySelector('.tt-board-outdoors .tt-wall-note')?.remove();
        panel
          .querySelector('.tt-board-outdoors')
          ?.append(
            el(
              'div',
              'tt-wall-note',
              `+${Math.max(total, lines.length) - 3} more · on People`,
            ),
          );
      },
      // Last: At the hotel folds to its kicker and a pointer.
      () => {
        const h = panel.querySelector('.tt-board-hotel');
        if (!h) return;
        for (const n of h.querySelectorAll('.tt-wall-line, .tt-wall-note'))
          n.remove();
        h.append(el('div', 'tt-wall-note', 'On the remote'));
      },
    ];
    for (const step of steps) {
      if (!over()) break;
      step();
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
    // …or the wall that carries Incident & attention on one or two
    // screens (S2 round 2, a).
    document.body.dataset.boardSlot =
      Object.keys(next.screens).find(
        (k) => next.screens[k].role === 'incident',
      ) ||
      Object.keys(next.screens).find((k) =>
        (next.screens[k].merged || []).includes('incident'),
      ) ||
      '';
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
    // View only: the toggle steps away too (screens Q2).
    document.body.classList.toggle(
      'tt-wall-viewonly',
      ss.wallControls === false,
    );
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
      // The saved scale: flown when its value or its rev changes (a Reset
      // clears the rev), and only recorded once the twin can fly (F20).
      const scaleKey = s.scale
        ? `${s.scale}|${s.meta?.scale?.rev ?? 'role'}`
        : '';
      if (scaleKey && scaleKey !== applied.scaleKey) {
        const saved = Boolean(s.meta?.scale);
        // No record: the role's own scale, which applyRole set with its
        // defaults (People looks straight down). Fly only back from a saved
        // scale (a Reset), never over those defaults (round 2 N2).
        const fromSaved =
          applied.scaleKey && !applied.scaleKey.endsWith('|role');
        if (saved || fromSaved) {
          const sc = s.scale;
          camera(() => api.scale(sc));
          // Back to the role's own view: its defaults too (People looks
          // straight down; round 3).
          if (!saved) camera(() => api.applyRoleDefaults?.(s.role));
        }
        if (api.twinReady?.() !== false) applied.scaleKey = scaleKey;
        if (saved) stopDrift();
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
    // This wall's own ref, from a change it made (SET AT WALL, aia §4).
    if (info.by?.kind === 'screen' && Number(info.by.slot) === mySlot)
      myRef = info.by.ref;
    // An Undo never overwrites a newer decision made elsewhere (F5): a
    // field changed by anyone else since, or whose record is gone (a
    // remote Reset, Return all or role change rebuilds the screen).
    if (railNote?.guard && s) {
      const g = railNote.guard;
      const moved =
        s.role !== g.role ||
        g.fields.some((f) => {
          const m = s.meta?.[f];
          // A wall's own Reset clears the records itself (round 3).
          return (!m && !g.reset) || (m && m.rev > g.rev && m.by !== myRef);
        });
      if (moved)
        railNote = {
          id: ++noteSeq,
          text: 'Changed since on the remote · nothing to undo',
          level: '',
          undo: null,
          until: Date.now() + 6000,
        };
    }
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
      // A remote Reset of this screen or Return all puts the wall back to
      // display: the menu and any sheet close (F25).
      const mine =
        info.by?.kind === 'screen' && Number(info.by.slot) === mySlot;
      if (
        !mine &&
        (c?.returnAll ||
          c?.parts?.some(
            (x) => x.field === 'whole' && Number(x.scope) === mySlot,
          ))
      ) {
        if (railNote?.undo) railNote = null;
        closeMenus();
      }
    }
    if (rail) railGuards();
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
    kicker.textContent = mySlot ? `S${mySlot}` : '';
    kicker.hidden = !mySlot;
    roleName.textContent = role.label;
    // Trip › site, as the All-in-one's crumbs (the trip gives way first).
    const label = api.siteLabel();
    if (where.dataset.text !== label) {
      where.dataset.text = label;
      const i = label.indexOf(' · ');
      const parts = i < 0 ? [label] : [label.slice(0, i), label.slice(i + 3)];
      where.replaceChildren(
        ...parts.flatMap((t, n) => [
          ...(n ? [el('span', 'tt-crumb-sep', '›')] : []),
          el('span', n ? 'tt-bar-hotel' : 'tt-crumb-trip', t),
        ]),
      );
      where.title = label.replace(' · ', ' › ');
    }
    // F9: a place name shows enough to read, or not at all (S3 reviews:
    // the hotel read "F.." beside a report's chips).
    for (const n of where.querySelectorAll('.tt-bar-hotel, .tt-crumb-trip')) {
      n.hidden = false;
      const cut = n.scrollWidth > n.clientWidth + 1;
      n.hidden = cut && n.clientWidth < Math.min(n.scrollWidth * 0.6, 120);
    }
    for (const sep of where.querySelectorAll('.tt-crumb-sep'))
      sep.hidden = Boolean(
        sep.previousElementSibling?.hidden || sep.nextElementSibling?.hidden,
      );
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
    badgeNow = badgeText;
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
    const m = api.modeChip?.();
    const showMode =
      Boolean(m) && m.mode !== 'monitoring' && !advance && !dayPlan;
    modePill.hidden = !showMode;
    if (showMode) {
      modePill.textContent =
        m.mode === 'incident'
          ? 'INCIDENT · THIS TRIP'
          : m.chip || m.mode.toUpperCase();
      modePill.className = `tt-mode tt-wall-mode ${m.mode}`;
    }
    time.textContent = api.clockText();
    // Data age as an age, never a clock time (W5, W11). Amber past 2 min,
    // the threshold the trip tiles use.
    const ageS = api.dataAgeS?.();
    data.hidden = !Number.isFinite(ageS);
    if (!data.hidden) {
      const late = ageS > 120;
      // One readout form on the wall and in its menu (F28).
      data.textContent = late
        ? `data delayed · ${mmss(ageS)}`
        : `data ${Math.max(0, Math.round(ageS))} s`;
      data.classList.toggle('late', late);
    }
    visitorMark.hidden = !ss.visitor;
    handsTag.hidden = !handsOn();
    wallTag.hidden = !setAtWall(s);
    // Another trip's report (W1): "› S6" names the Trips wall when there is
    // one and it is not this wall.
    const rep = api.otherTripReport?.();
    other.hidden = !rep;
    if (rep) {
      const tripsSlot = Object.entries(state?.screens || {}).find(
        ([, x]) => x?.role === 'trips',
      )?.[0];
      // Only the trip's name ellipsises; where to look never does (S3
      // reviews: "› S6" was lost at 1728). No Trips wall: the remote.
      const to =
        tripsSlot && Number(tripsSlot) !== mySlot
          ? ` › S${tripsSlot}`
          : tripsSlot
            ? ''
            : ' › remote';
      const more = rep.count > 1 ? ` +${rep.count - 1}` : '';
      other.replaceChildren(
        el('span', 'k', 'OTHER TRIP · '),
        el('span', 'n', rep.title.toUpperCase()),
        el('span', 'k', ` · REPORTED${more}${to}`),
      );
      other.title = `Other trip · ${rep.title} · reported${more}${to}`;
    }
    const ctl = presence?.remotes?.find((r) => r.controller);
    if (ctl?.name) lastCtl = ctl.name;
    const hands = drifting && !handsOn() ? ' · drifting' : '';
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
    renderChip(
      chipText({
        slot: mySlot,
        online,
        controller: ctl ? ctl.name || 'a remote' : null,
        lastController: lastCtl,
        remoteGoneAt,
        change: recent ? change : null,
        last,
        now,
        suffix: '',
        ages: true,
        short: true,
      }),
    );
    chip.title = chipText({
      slot: mySlot,
      online,
      controller: ctl ? ctl.name || 'a remote' : null,
      lastController: lastCtl,
      remoteGoneAt,
      change: null,
      last,
      now,
      suffix: `${s?.pinned ? ' · pinned' : ''}${hands}`,
      ages: true,
    });
    // Steel only (C65): the words carry the state, not a colour.
    chip.className = `tt-wall-chip${!online || !ctl ? ' warn' : ''}${recent ? ' changed' : ''}`;
    fitChip();
    // Link age, separate from data age (supervision spec).
    const link = sync?.linkAgeS ?? null;
    const lost = !sync?.online || (link != null && link > 15);
    document.body.classList.toggle('tt-stale', Boolean(lost && state));
    stale.hidden = !lost || !state;
    if (lost && state) {
      if (link == null && restoredAt)
        stale.textContent = `STALE · showing the state saved ${forText(Date.now() - restoredAt)} ago · not connected to the Trip Twin computer`;
      else {
        // An age, not a clock time: the header clock is the trip's (W5).
        const since = link ?? 0;
        stale.textContent = `STALE · last update ${mmss(since)} ago · showing the last state`;
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
    const repOpen = api.incidentOpen();
    if (document.body.classList.contains('tt-report-open') !== repOpen) {
      document.body.classList.toggle('tt-report-open', repOpen);
      requestAnimationFrame(() => api.refitRail?.());
    }
    // The second card column shows something (a body class, not :has —
    // a card hidden by CSS still has no hidden attribute; G9).
    const rcol = document.getElementById('tt-rcol');
    document.body.classList.toggle(
      'tt-rcol-on',
      Boolean(rcol) &&
        [...rcol.children].some((c) => c.getClientRects().length > 0),
    );
    measureZones();
    paintSafetyNote(s);
    paintCheckNote(s);
    fitChips();
    paintRail();
  }

  /**
   * The alert zone (top bar, STALE band, weather strip, incident banner)
   * is never covered (screens/02-spec-ux §1): everything else is placed
   * between --w-top and --w-bot, real pixels from the window's edges.
   */
  function measureZones() {
    let top = head.getBoundingClientRect().bottom;
    for (const n of [stale, wxStrip])
      if (!n.hidden) top = Math.max(top, n.getBoundingClientRect().bottom);
    const credits = 26;
    const bot = banner.hidden
      ? credits
      : Math.max(credits, innerHeight - banner.getBoundingClientRect().top);
    const b = document.body;
    const t = `${Math.round(top)}px`;
    const u = `${Math.round(bot)}px`;
    if (b.style.getPropertyValue('--w-top') !== t)
      b.style.setProperty('--w-top', t);
    if (b.style.getPropertyValue('--w-bot') !== u)
      b.style.setProperty('--w-bot', u);
  }

  /**
   * The chip in the bar (F7): the slot prefix is read aloud but not shown
   * (the lockup says S1), and "by S1 at the wall" never truncates — the
   * summary does. textContent stays the whole sentence.
   */
  function renderChip(text) {
    if (chip.dataset.text === text) return;
    chip.dataset.text = text;
    const pre = mySlot ? `S${mySlot} · ` : '';
    const body = pre && text.startsWith(pre) ? text.slice(pre.length) : text;
    const parts = [];
    if (body !== text) parts.push(el('span', 'tt-sr', pre));
    // The actor ("· by …", "· push by …") or the remote's name is kept;
    // the words before it give way (round 2 N3).
    const by = Math.max(
      body.lastIndexOf(' · by '),
      body.lastIndexOf(' · push by '),
    );
    const rm = body.startsWith('Remote: ') ? 'Remote:'.length : -1;
    const i = by > 0 ? by : rm;
    if (i > 0)
      parts.push(
        el('span', 'tt-chip-sum', body.slice(0, i)),
        el('span', 'tt-chip-by', body.slice(i)),
      );
    else parts.push(el('span', 'tt-chip-sum', body));
    chip.replaceChildren(...parts);
    fitChip();
  }
  /** Too long for the bar: the words before the name step out whole. */
  function fitChip() {
    chip.classList.remove('tight');
    if (
      chip.querySelector('.tt-chip-by') &&
      chip.scrollWidth > chip.clientWidth + 1
    )
      chip.classList.add('tight');
  }

  /**
   * The map bar's chips stay on one row (ux §2, F8): the caption steps out
   * first, then chips hide — places that matter (approved sites, hazards,
   * weather) last — and one "+n more" says how many. Never a second row.
   */
  let chipsWatch = null;
  function fitChips() {
    const box = document.getElementById('tt-chips');
    const bar = document.getElementById('tt-mapbar');
    if (!box || !bar) return;
    const shell = getComputedStyle(bar).display !== 'contents';
    if (!chipsWatch) {
      chipsWatch = new MutationObserver(() => requestAnimationFrame(fitChips));
      new ResizeObserver(() => fitChips()).observe(bar);
    }
    chipsWatch.disconnect();
    box.querySelector('.tt-chip-more')?.remove();
    const chips = [...box.children];
    for (const c of chips) c.classList.remove('tt-chip-fit');
    // The page's own "+n more" (it shows four) joins the count.
    const pageMore = chips.find((c) => /^\+\d+ more$/.test(c.textContent));
    if (pageMore) {
      pageMore.dataset.n ??= pageMore.textContent.match(/\d+/)[0];
      pageMore.textContent = `+${pageMore.dataset.n} more`;
    }
    bar.classList.remove('tight');
    const over = () =>
      box.scrollWidth > box.clientWidth + 1 ||
      bar.scrollWidth > bar.clientWidth + 1;
    if (shell && over()) {
      bar.classList.add('tight');
      // People beyond the area, hazards and weather hide last; approved
      // places next; the trip's other sites first (70-S2-FIX-LIST G14).
      const keep = (c) =>
        c.classList.contains('people') ||
        c.classList.contains('hazard') ||
        c.classList.contains('wx')
          ? 3
          : c.classList.contains('site')
            ? 1
            : 2;
      const items = chips.filter((c) => c !== pageMore);
      const order = items
        .map((c, i) => ({ c, i }))
        .sort((a, b) => keep(a.c) - keep(b.c) || b.i - a.i)
        .map((x) => x.c);
      const more = pageMore || el('span', 'tt-chip tt-chip-more');
      const base = pageMore ? Number(pageMore.dataset.n) : 0;
      if (!pageMore) box.append(more);
      let hidden = 0;
      for (const c of order) {
        if (!over()) break;
        c.classList.add('tt-chip-fit');
        hidden += 1;
        more.textContent = `+${base + hidden} more`;
      }
      if (!hidden && !pageMore) more.remove();
    }
    chipsWatch.observe(box, { childList: true });
  }

  /**
   * People: who the wall is checking, in the map bar, so a person picked
   * with Next to check is always named (70-S2-FIX-LIST G7).
   */
  let checkNote = null;
  function paintCheckNote(s) {
    const bar = document.getElementById('tt-mapbar');
    if (!bar) return;
    if (!checkNote) {
      checkNote = el('span', 'tt-mapbar-check');
      checkNote.setAttribute('role', 'status');
    }
    if (checkNote.parentNode !== bar) bar.prepend(checkNote);
    const at = s?.role === 'travelers' ? api.checkPosition?.() || '' : '';
    const who = at
      ? (api.selectionText?.() || '').replace(/^selected /, '')
      : '';
    checkNote.hidden = !at;
    checkNote.textContent = at ? `Checking · ${who} · ${at}` : '';
  }

  /** "2 safety layers off" in the map bar while any is off (aia §3). */
  let safetyNote = null;
  function paintSafetyNote(s) {
    const bar = document.getElementById('tt-mapbar');
    if (!bar || !s) return;
    if (!safetyNote) {
      safetyNote = el('span', 'tt-mapbar-note');
      safetyNote.setAttribute('role', 'status');
    }
    if (safetyNote.parentNode !== bar) bar.prepend(safetyNote);
    const n = SAFETY_LAYERS.filter((k) => !layerValue(s, k)).length;
    const parts = n ? [`${n} safety layer${n > 1 ? 's' : ''} off`] : [];
    // S4 (A5-S4-PLAN, S4 AIA): what the map leaves out and when it is for.
    if (s.role === 'weather') {
      const t = api.wxTimeText?.() || '';
      if (t) parts.unshift(`${t} · set on the remote`);
      const wg = api.weatherGuard?.() || {};
      if (wg.warning || wg.near) {
        if (!layerValue(s, 'lightning')) parts.push('Lightning off');
        if (!layerValue(s, 'precip') && !layerValue(s, 'radar3d'))
          parts.push('Storm pictures off');
      }
    }
    safetyNote.hidden = parts.length === 0;
    safetyNote.textContent = parts.join(' · ');
  }

  // The menu open counts as hands on the wall (screens/05-S1-PLAN §12).
  const handsOn = () => railOpen || Date.now() - lastInput < HANDS_MS;
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
    // A hand is back: the back-to-group count starts again when it leaves.
    handsEndedAt = null;
    stopDrift('input');
    if (!b.classList.contains('tt-hands-on')) {
      b.classList.add('tt-hands-on');
      paint();
      // A hand shows the card's controls: fit the report card again.
      requestAnimationFrame(() => api.refitRail?.());
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
    online: () => canSave().ok,
    offText: () => canSave().why,
    // Not while a card replaces the scene (K8), nor on a view-only wall.
    blocked: () => Boolean(cardOn) || viewOnly(),
    write: (cmd, label) => save(cmd, label),
  });

  // ---- the wall's own menu (screens/05-S1-PLAN §6–§12) ----
  const RAIL_IDLE_MS = 30000;
  let railOpen = false;
  let railInput = 0; // the menu's own idle clock
  let railNote = null; // {text, level, undo, until}
  let saving = false;
  let badgeNow = ''; // the top bar's mode words, for the menu (F17)
  let noteSeq = 0; // each note is its own (a repeated action, its own Undo)

  /** Whether this wall may save now, and why not (aia §2): never queued. */
  function canSave() {
    const s = me();
    if (!mySlot || cardOn || !s)
      return { ok: false, why: 'This screen is not on the wall yet' };
    // Amber only for link health; pinned and visitor are steel (F22).
    if (linkLost())
      return {
        ok: false,
        level: 'warn',
        why: 'Not connected to the Trip Twin computer · changes cannot be saved now',
      };
    if (s.pinned)
      return {
        ok: false,
        level: '',
        why: `S${mySlot} is pinned on the remote · unpin it there`,
      };
    if (state?.session?.visitor)
      return {
        ok: false,
        level: '',
        why: 'Visitor mode · settings are read-only at the wall',
      };
    if (viewOnly())
      return {
        ok: false,
        level: '',
        why: 'View only · wall controls are off on the remote',
      };
    return { ok: true, why: '' };
  }

  /** The values a command will change, for its Undo (fields it names). */
  function before(cmd) {
    const s = me() || {};
    if (cmd.type === 'reset')
      return {
        layers: Object.fromEntries(
          Object.entries(s.layers || {}).filter(
            // A layer the wall would refuse now would get the whole Undo
            // refused (F39; the weather rules too).
            ([k, v]) => !layerRefusal({ [k]: v }, s),
          ),
        ),
        motion: { ...(s.motion || {}) },
        scale: s.scale,
        textScale: s.textScale,
        layout: layoutValue(s),
      };
    const out = {};
    for (const [k, v] of Object.entries(cmd.patch || {})) {
      if (k === 'layers') {
        out.layers = Object.fromEntries(
          Object.keys(v)
            .map((x) => [x, layerValue(s, x)])
            .filter(([x, old]) => !layerRefusal({ [x]: old }, s)),
        );
        if (!Object.keys(out.layers).length) delete out.layers;
      } else if (k === 'motion')
        out.motion = Object.fromEntries(
          Object.keys(v).map((x) => [x, s.motion?.[x] !== false]),
        );
      else if (k === 'layout') {
        const l = layoutValue(s);
        out.layout = Object.fromEntries(Object.keys(v).map((x) => [x, l[x]]));
      } else out[k] = s[k] ?? null;
    }
    return out;
  }

  /**
   * Why a layers patch would be refused at this wall, or ''. A report from
   * any source keeps the safety layers on (F6). Weather (A5-S4-PLAN):
   * alert areas and heat stay on under an official warning or the demo
   * storm (as the host); on S4, while a warning is active or the storm is
   * near, lightning and one storm picture stay on too.
   */
  function layerRefusal(lay, s) {
    const offs = Object.keys(lay).filter(
      (k) => lay[k] === false && SAFETY_LAYERS.includes(k),
    );
    if (offs.length && api.incidentOpen())
      return 'A report is open · safety layers stay on at the wall';
    const wg = api.weatherGuard?.() || {};
    // Alert areas under a warning or the demo storm; heat only under a
    // fire or smoke warning (travel-risk advice, 25 Oct).
    if (offs.includes('alertAreas') && (wg.warning || wg.sim))
      return `${wg.warning ? 'An official warning is active' : 'The demo storm is running (SIMULATED)'} · alert areas stay on at the wall`;
    if (offs.includes('fires') && wg.fireWarning)
      return 'A fire or smoke warning is active · heat detections stay on at the wall';
    if (s?.role === 'weather' && (wg.warning || wg.near)) {
      const val = (k) => (k in lay ? lay[k] : layerValue(s, k));
      if (
        lay.lightning === false ||
        (('precip' in lay || 'radar3d' in lay) &&
          !val('precip') &&
          !val('radar3d'))
      )
        return `${wg.warning ? 'A warning is active' : 'The storm is near'} · lightning and one storm picture stay on`;
    }
    return '';
  }

  /**
   * Every saved change at this wall (the menu and the L / D sheets): the
   * guard first, then `screen-cmd`; a 10 s Undo that sends the old values
   * back the same way (aia §4). Refusals say why, in amber.
   */
  async function save(cmd, label, { undo = true } = {}) {
    const g = canSave();
    if (!g.ok) {
      note(g.why, g.level);
      return { ok: false, error: g.why };
    }
    if (saving) return { ok: false, error: 'Saving…' };
    const refusal = layerRefusal(cmd.patch?.layers || {}, me());
    if (refusal) {
      note(refusal, '');
      return { ok: false, error: refusal };
    }
    if (cmd.type === 'screens') cmd = { ...cmd, target: mySlot };
    const old = undo ? before(cmd) : null;
    saving = true;
    paintRail();
    const r = await sync
      .request({ t: 'screen-cmd', cmd, label })
      .catch(() => ({ ok: false }));
    saving = false;
    if (!r?.ok)
      note(
        r?.error === 'No answer'
          ? 'No answer · check the remote to see if it was saved'
          : `Not saved · ${r?.error || 'try again'}`,
        linkLost() ? 'warn' : '',
      );
    else if (old && Object.keys(old).length)
      note(
        `${label} · saved`,
        'ok',
        () =>
          save(
            { type: 'screens', target: mySlot, patch: old },
            `Undo · ${label}`,
            { undo: false },
          ),
        // What this Undo may restore, and from which revision (F5).
        {
          fields: Object.keys(old),
          rev: r.rev ?? state?.rev ?? 0,
          role: me()?.role,
          reset: cmd.type === 'reset',
        },
      );
    else note(`${label} · saved`, 'ok');
    paintRail();
    return r;
  }
  function note(text, level, undoFn = null, guard = null) {
    railNote = {
      id: ++noteSeq,
      text,
      level,
      guard,
      undo: undoFn
        ? () => {
            railNote = null;
            undoFn();
          }
        : null,
      until: Date.now() + 10000,
    };
    paintRail();
  }

  /** Any field of this screen last set from this wall (aia §4). */
  function setAtWall(s) {
    if (!s?.meta || !mySlot) return false;
    const mine =
      myRef ||
      presence?.actors?.find(
        (a) => a.kind === 'screen' && Number(a.slot) === mySlot,
      )?.ref;
    return Boolean(
      mine &&
      Object.values(s.meta).some(
        (m) => m?.by === mine && m.source === 'override',
      ),
    );
  }

  /** The remote set every wall to view only (screens Q2). */
  function viewOnly() {
    return state?.session?.wallControls === false;
  }
  function setRail(on, { focus = true } = {}) {
    if (on && (cardOn || !mySlot || viewOnly())) return;
    if (on === railOpen) return;
    railOpen = on;
    railInput = Date.now();
    // Opening is hands-on; closing restarts the 60 s drift count (F23).
    stopDrift('input');
    if (on) rail.sleep();
    paintRail();
    if (on) rail.scrollTop();
    if (on && focus) rail.focusName();
    else if (!on && rail.contains(document.activeElement))
      document.activeElement.blur();
    sentLocal = '';
  }
  /** The menu and any sheet, closed together (F2). */
  function closeMenus() {
    sheet?.close();
    if (rail) setRail(false, { focus: false });
  }

  /** The aperture's signal: the All-in-one's list (shell X4, aia §3). */
  function signal() {
    // Incident first, as on the All-in-one; a lost link is an extra state
    // shown with it, never instead of it (F24).
    const lost = linkLost();
    const why = (t) =>
      [t, lost ? 'not connected' : ''].filter(Boolean).join(' · ');
    if (api.incidentOpen()) return ['incident', why('Incident reported'), lost];
    if (api.otherTripReport?.())
      return ['other', why('Another trip has a report'), lost];
    const ap = api.approachLine?.();
    if (
      ['arriving', 'near', 'over'].includes(ap?.status) &&
      ap.level !== 'info'
    )
      return ['attention', why('Weather approaching'), lost];
    return [lost ? 'stale' : 'calm', lost ? 'Not connected' : '', lost];
  }

  const viewApi = {
    ...api,
    // The remote's spotlight stays through Frame the group (G11).
    frameGroup: (o = {}) =>
      api.frameGroup?.({
        keepSelection: Boolean(state?.session?.spotlight),
        ...o,
      }),
    faceNorth: () => api.faceNorth?.(),
    restoreView: () => {
      // People rests straight down on the whole group, north up.
      if (me()?.role === 'travelers')
        return api.frameGroup?.({
          north: true,
          keepSelection: Boolean(state?.session?.spotlight),
        });
      api.faceNorth?.();
      api.scale(me()?.scale || ROLES[me()?.role]?.scale);
    },
  };

  function paintRail() {
    if (!rail) return;
    const s = me();
    const role = ROLES[s?.role] || ROLES.site;
    const now = Date.now();
    if (railNote && now > railNote.until) railNote = null;
    const [sig, sigText, lost] = signal();
    const g = canSave();
    const page = s
      ? wallPage(role.key, {
          screen: s,
          shell: document.body.classList.contains('tt-wall-shell'),
          canSave: g,
          save: (patch, label) =>
            save({ type: 'screens', target: mySlot, patch }, label),
          api: viewApi,
          reportOpen: api.incidentOpen(),
        })
      : { groups: [], tiles: [] };
    const ctl = presence?.remotes?.find((r) => r.controller);
    const meta = lastChangeOf(state, mySlot);
    const ageS = api.dataAgeS?.();
    const advance = s?.mode === 'advance' || s?.role === 'day';
    const link = sync?.linkAgeS;
    // Who decides, in the Role pane where it is always seen (F10).
    const who = [
      ctl
        ? `Remote: ${ctl.name || 'a remote'} · in control`
        : sync?.online
          ? `No remote in control${lastCtl ? ` (last: ${lastCtl})` : ''}`
          : 'Not connected to the Trip Twin computer',
      meta
        ? `Last change ${agoText(now - meta.at)} ago · by ${byText(meta.ref, presence?.actors)}`
        : 'No change yet in this session',
      'Role, Live/Advance and pin: set on the remote.',
    ];
    const control = [
      s?.pinned ? 'Pinned on the remote · keeps its state through All' : null,
      link != null ? `Link ${Math.round(link)} s` : null,
      drifting ? 'Drifting · idle camera (Cinematic)' : null,
      setAtWall(s) ? 'Some settings were set at this wall' : null,
    ].filter(Boolean);
    queueMicrotask(refitOnChange);
    rail.render({
      open: railOpen,
      slot: mySlot ?? '?',
      role: role.label,
      sub: role.sub,
      headRight: '',
      // The top bar's own words for the mode (F17).
      statusText: lost
        ? 'NOT CONNECTED'
        : `${badgeNow || 'LIVE'}${Number.isFinite(ageS) ? ` · data ${Math.max(0, Math.round(ageS))} s` : ''}`,
      statusLevel: lost ? 'stale' : advance ? 'advance' : 'live',
      who,
      groups: page.groups,
      control,
      // A refusal reason is always in view while it holds (round 3).
      note:
        !g.ok && mySlot
          ? {
              id: `why:${g.why}`,
              text: g.why,
              level: g.level,
              undo: null,
            }
          : railNote,
      // While the menu is closed, a save's note shows by the aperture (F14).
      toast: railNote,
      tiles:
        MAP_ROLES.has(role.key) || role.key === 'incident' ? page.tiles : [],
      tilesTitle: page.tilesTitle,
      stale: lost,
      closingIn:
        railOpen && !saving
          ? (() => {
              const left = Math.ceil((RAIL_IDLE_MS - (now - railInput)) / 1000);
              return left <= 5 ? Math.max(0, left) : null;
            })()
          : null,
      signal: sig,
      signalText: sigText,
    });
  }

  rail = createWallRail({
    onToggle: (on) => setRail(on),
    onKeep: () => {
      railInput = Date.now();
      paintRail();
    },
    menu: [
      { label: 'Layers', key: 'L', action: () => sheet.open('layers') },
      { label: 'Display', key: 'D', action: () => sheet.open('display') },
      { label: 'Keys', key: 'K', action: () => sheet.open('keys') },
    ],
  });
  // M opens and closes the menu; Esc closes it (a sheet first: the sheet
  // owns the keyboard while it is open). Option+0 stays off walls.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || sheet.kind) return;
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        e.stopPropagation();
        setRail(!railOpen);
      } else if (e.key === 'Escape' && railOpen) {
        e.preventDefault();
        e.stopPropagation();
        setRail(false);
      }
    },
    true,
  );
  // The menu's idle clock: a press, scroll or key anywhere, or the
  // pointer moving over the menu (ux §4).
  for (const t of ['pointerdown', 'wheel', 'keydown'])
    window.addEventListener(t, () => (railInput = Date.now()), {
      capture: true,
      passive: true,
    });
  rail.rail.addEventListener('pointermove', () => (railInput = Date.now()), {
    passive: true,
  });
  window.addEventListener('pointermove', () => rail.wake(), { passive: true });

  /**
   * Close the menu and any sheet at once when the room's state asks for
   * the display (aia §3) — when a state *starts*, not while it lasts: a
   * pinned, visitor or stale wall may open its menu again, see why it
   * cannot save, and still move the view (F4). A report from any source,
   * this trip's data too, or a new report on another trip (by id) closes
   * them (F6, F38); so does a role or mode change from the remote (F25).
   */
  let prevGuard = null;
  function railGuards() {
    const s = me();
    const g = {
      report: api.incidentOpen() ? String(api.incidentKey?.() || 'open') : '',
      others: (api.otherTripIds?.() || []).join(','),
      lost: linkLost(),
      pinned: Boolean(s?.pinned),
      visitor: Boolean(state?.session?.visitor),
      viewOnly: viewOnly(),
      role: s?.role || '',
      mode: s?.mode || '',
    };
    const p = prevGuard;
    prevGuard = g;
    const open = railOpen || Boolean(sheet?.kind);
    if (!p || !open) return;
    const newOther = g.others
      .split(',')
      .some((id) => id && !p.others.split(',').includes(id));
    const started = (k) => g[k] && !p[k];
    if (
      (g.report && g.report !== p.report) ||
      newOther ||
      started('lost') ||
      started('pinned') ||
      started('visitor') ||
      started('viewOnly') ||
      (p.role && g.role !== p.role) ||
      (p.mode && g.mode !== p.mode) ||
      cardOn
    )
      return closeMenus();
    // The menu and the sheets share one 30 s idle (ux §4, F2).
    if (!saving && Date.now() - railInput > RAIL_IDLE_MS) closeMenus();
  }
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
    // People: a selection made at the wall goes back to the group 60 s
    // after the hand leaves — never during a report, never over the
    // remote's spotlight (55-S2-PLAN; Reduce motion lands at once).
    // Only the wall's own pick returns; a report postpones it until the
    // report ends; with the remote's spotlight set, the wall goes back to
    // the spotlighted person (70-S2-FIX-LIST G10).
    const picked = api.selectedPersonId?.() || null;
    if (handsOn() && picked) wallPick = picked;
    if (
      handsEndedAt &&
      now - handsEndedAt > 60000 &&
      (s0()?.role === 'incident' ||
        (s0()?.role === 'travelers' && !api.incidentOpen())) &&
      !handsOn()
    ) {
      handsEndedAt = null;
      const sp = state?.session?.spotlight;
      if (wallPick && picked === wallPick) {
        if (sp) api.spotlight(sp);
        // S3 has no map: the list just lets go of the row (S3 reviews).
        else if (s0()?.role === 'incident') api.frame({ kind: 'clear' });
        else api.frameGroup?.();
      }
      wallPick = null;
    }
    if (!handsOn() && b.classList.contains('tt-hands-on')) {
      handsEndedAt = now;
      b.classList.remove('tt-hands-on');
      paint();
      requestAnimationFrame(() => api.refitRail?.());
    }
    // Idle drift (Cinematic tier, Jesse 16 Oct): only the Site wall, only
    // after 60 s with no hands on, never during an incident, never while a
    // camera change is pending. The wall says so in its chip.
    // The same conditions, in the same order, named (K6 driftReason).
    const s = me();
    const why = driftState([
      ['role', Boolean(s && s.role === 'site')],
      ['tier', s?.motion?.cine !== false && Boolean(api.motionOn?.('cine'))],
      // An open menu is hands-on; the 60 s count starts when it closes.
      ['rail', !railOpen],
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
      ? ['hands-on', railOpen ? 'menu open' : '', api.selectionText?.()]
          .filter(Boolean)
          .join(' · ')
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
    railGuards();
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
    /**
     * A scale picked by hand at this wall (map bar, keys 1–3): saved
     * through the session so the remote stays the truth; the echo flies.
     * Not savable now: the camera moves anyway and the menu says why.
     */
    requestScale(k) {
      const label = {
        building: 'Building',
        neighborhood: 'Neighborhood',
        city: 'City',
      }[k];
      if (!label) return;
      stopDrift('input');
      const g = canSave();
      if (!g.ok) {
        api.scale(k);
        note(`${label} · this view only, not saved · ${g.why}`, g.level);
        return;
      }
      // Not saved after all (a refusal, no answer, a save in flight): the
      // camera moves anyway and the note says so (F14, round 2 N7).
      save(
        { type: 'screens', target: mySlot, patch: { scale: k } },
        `Scale · ${label}`,
      ).then((r) => {
        if (r?.ok) return;
        api.scale(k);
        // The camera moved anyway; the save's own note (refused, no
        // answer) stays as it is.
        if (!railNote) note(`${label} · this view only, not saved`, '');
      });
    },
    refresh() {
      renderPanel();
      paint();
    },
    /** Once the twin is open: run the role's defaults again (scale etc.). */
    reapply() {
      document.body.dataset.role = '';
      applied.modeKey = null;
      // The twin is open now: fly to the saved scale (F20).
      applied.scaleKey = null;
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
