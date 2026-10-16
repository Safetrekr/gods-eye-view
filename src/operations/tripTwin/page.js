// Trip Twin standalone harness. Stands in for World View hooks H-1..H-9
// (PROJECT-PLAN update box): builds its own viewer, feeds mock data, and owns
// the page chrome wiring. Edits none of Justin's files.
import * as Cesium from 'cesium';
import './tripTwin.css';
import './tripTwin.instrument.css';
import { createMotion, MOTION_DEFAULTS } from './twinMotion.js';
import { createStandaloneScene } from '../../standalone/scene.js';
import { createTripTwin, flightMs } from './tripTwin.js';
import { TWIN_CITIES } from './twinCities.js';
import {
  cityOfSite,
  siteConfig,
  siteCounts,
  siteCountsLine,
  siteOptionLabel,
  sitesForCity,
} from './twinSites.js';
import { createSiteBeacons } from './twinSiteBeacons.js';
import { DEFAULT_GLOW, GLOW_STYLES } from './twinSelect.js';
import { UNIT, formatLength, groundLine } from './twinUnits.js';
import { SCENARIOS, TRIP_ID, tripTwinDemoSnapshot } from './demoTripTwin.js';
import {
  createCard,
  createHud,
  renderRouteSection,
  responderText,
  resultEl,
} from './twinHud.js';
import {
  MODES,
  defaultMode,
  groupCentre,
  pathSummaryText,
  planRouteSet,
  primaryEstimate,
  routeCards,
  shortName,
} from './twinRoutes.js';
import {
  areaLabel,
  nearestStreet,
  chaperoneShareText,
  seedWaypoints,
  coversEnds,
  defaultName,
  pathVia,
  legWindow,
  waypointText,
  avoidStatus,
  loadStore,
  pathChecks,
  reviewSignature,
  reviewState,
  savedPathLines,
} from './twinCustomPaths.js';
import { createCustomPathsLayer } from './twinCustomPathsLayer.js';
import { createPathEditor } from './twinPathEditor.js';
import {
  briefText,
  forecastWindow,
  siteBrief,
  sunTimes,
  tripEvents,
  zonedToEpoch,
} from './twinAdvance.js';
import { createCutaway, floorRosterText } from './twinCutaway.js';
import {
  atHotelVerdict,
  deriveMode,
  withTripIncidents,
  floorOccupancy,
  floorRoster,
  footerLine,
  formatAge,
  formatDistance,
  formatRadius,
  formatShort,
  setDistanceUnit,
  haversineM,
  bearingLabel,
} from './twinData.js';
import { SAFETY_LABEL } from './twinSafety.js';
import { createCompass, rotated } from './twinCompass.js';
import {
  applyOperatorNumbering,
  createNumberingForm,
  validEntry,
} from './twinNumbering.js';
import {
  boxAround,
  cellsToPoints,
  createWeatherLayer,
  exposureException,
  gatheringInUse,
  lightningException,
  loadWeatherImage,
  loadWeatherUrl,
  parseNwsAlerts,
  rainPace,
  simulatedRain,
  simulatedRainCanvas,
  simulatedStrikes,
  summarizeMet,
  warningLine,
  weatherChipParts,
  fahrenheit,
  weatherSources,
  heldLightning,
  LIGHTNING_WATCH_KM,
} from './twinWeather.js';
import { coverageFromCanvas, createWeatherFx } from './twinWeatherFx.js';
import { KIND_TEXT, createWeatherTimeline } from './twinWeatherTimeline.js';
import {
  intensity,
  metSteps,
  precipKind,
  precipRowText,
  relText,
  stepAt,
  timeSources,
} from './twinWeatherTime.js';
import { createScreenMode } from './twinScreen.js';
import { showEntry, showLaunch } from './twinEntry.js';
import {
  DEMO_TRIPS,
  sortTiles,
  tripById,
  tripForCity,
  tripTile,
} from './demoTrips.js';

const params = new URLSearchParams(location.search);
// Phase 3: ?site= picks any site (hotel or venue); ?city= the trip's city.
const siteParam = siteConfig(params.get('site')) ? params.get('site') : null;
const cityKey = siteParam
  ? cityOfSite(siteParam)
  : TWIN_CITIES[params.get('city')]
    ? params.get('city')
    : 'austin';
const osmMode = params.get('osm') === 'live' ? 'live' : 'fixture';
const scenario = SCENARIOS[params.get('scenario')]
  ? params.get('scenario')
  : 'baseline';
const $ = (id) => document.getElementById(id);
const status = $('tt-status');
const cleanups = [];
const abort = new AbortController();

const pref = (k, d) => {
  try {
    return localStorage.getItem(`tripTwin.${k}`) ?? d;
  } catch {
    return d;
  }
};
const save = (k, v) => {
  try {
    localStorage.setItem(`tripTwin.${k}`, v);
  } catch {
    /* per-viewer convenience only */
  }
};
// Motion tiers (phase 11): Live · Event · Cinematic, each with a switch.
// A wall takes its tiers from the session; the All-in-one from Display.
// Reduce motion (the system or the setting) wins over all three.
const reducedMotion = () =>
  pref('reduceMotion', '0') === '1' ||
  matchMedia('(prefers-reduced-motion: reduce)').matches;
const motion = createMotion({
  reduced: reducedMotion,
  tiers:
    params.get('view') === 'screen'
      ? MOTION_DEFAULTS.wall
      : {
          live: pref('motionLive', '1') === '1',
          event: pref('motionEvent', '1') === '1',
          cine:
            pref('motionCine', MOTION_DEFAULTS.all.cine ? '1' : '0') === '1',
        },
});

// ---- popovers: one open at a time; Esc closes them before anything else ----
const POPS = {
  'tt-layers': 'tt-layers-btn',
  'tt-display': 'tt-display-btn',
  'tt-report': 'tt-report-btn',
  'tt-proto': 'tt-proto-btn',
  'tt-help': 'tt-help-btn',
  'tt-sites': 'tt-hotel',
};
let popTrigger = null;
function openPop(id) {
  for (const [pop, btn] of Object.entries(POPS)) {
    const on = pop === id && $(pop).hidden;
    $(pop).hidden = !on;
    $(btn)?.setAttribute('aria-expanded', String(on));
    if (on) popTrigger = $(btn);
  }
  setReportPending('');
  if (id === 'tt-report' && !$(id).hidden)
    setTimeout(() => $('tt-report-floor').focus(), 0);
}
/** Close every popover; restoreFocus (Esc) puts focus back on the trigger. */
function closePops({ restoreFocus = false } = {}) {
  let closed = false;
  for (const [pop, btn] of Object.entries(POPS)) {
    if (!$(pop).hidden) closed = true;
    $(pop).hidden = true;
    $(btn)?.setAttribute('aria-expanded', 'false');
  }
  setReportPending('');
  if (closed && restoreFocus) popTrigger?.focus();
  return closed;
}
const openPopId = () => Object.keys(POPS).find((id) => !$(id).hidden);
/** A typed floor in the report form is unsaved work (review/phase5 J7). */
const reportDirty = () =>
  !$('tt-report').hidden && $('tt-report-floor').value.trim() !== '';
function setReportPending(text) {
  const n = $('tt-report-pending');
  if (!n) return;
  if (!text) delete n.dataset.esc;
  n.textContent = text;
  n.hidden = !text;
}

async function main() {
  const { viewer, tileset } = await createStandaloneScene({
    googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
    loaderStatus: status,
    signal: abort.signal,
    defer: (fn) => cleanups.push(fn),
  });
  // Credits live inside the source line, where no panel can cover them.
  const credits = $('cesium-credits');
  if (credits) $('tt-credits-slot').append(credits);
  if (params.has('twinDebug')) viewer.scene.debugShowFramesPerSecond = true;
  window.testTwinViewer = viewer;
  window.testCesium = Cesium;
  // `city` is the site on screen (hotel or venue); the trip's city is cityKey.
  const SITES = sitesForCity(cityKey);
  let siteKey =
    siteParam ||
    (scenario === 'b'
      ? SITES.find((s) => s.role === 'performance')?.key || cityKey
      : cityKey);
  let city = siteConfig(siteKey);
  $('tt-hotel').textContent = `${city.short} ▾`;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(
      city.center.lon,
      city.center.lat - 0.03,
      4200,
    ),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-38), roll: 0 },
  });

  // ---- prototype drawer ----
  const glowParam = GLOW_STYLES[params.get('glow')]
    ? params.get('glow')
    : DEFAULT_GLOW;
  for (const [value, label] of Object.entries(GLOW_STYLES))
    $('tt-glow').add(new Option(label, value));
  $('tt-glow').value = glowParam;
  $('tt-scenario').value = scenario;
  $('tt-city').value = cityKey;
  $('tt-simfire').checked = params.get('fire') === '1';
  $('tt-osmids').checked = pref('osmIds', '0') === '1';

  let lastFeed = Date.now();
  let lastCtx = null;
  let lastA = null;
  // Change log (phase 11): what moved, for the S3 idle board. Counts and
  // attention-group membership are compared on every data tick.
  const changeLog = [];
  let prevLogCounts = null;
  let prevGroups = null;
  function logChanges(a, m, clock) {
    const now = Date.now();
    if (prevLogCounts)
      for (const [k, v] of Object.entries(a.counts || {}))
        if (prevLogCounts[k] !== undefined && prevLogCounts[k] !== v)
          changeLog.unshift({
            at: now,
            clock,
            text: `${k === 'Away' ? 'Away from this site' : k} · ${prevLogCounts[k]} → ${v}`,
            warn: k === 'Not current' || k === 'Not located',
          });
    prevLogCounts = { ...(a.counts || {}) };
    const groups = new Map(
      (m?.groups || []).map((g) => [
        g.key,
        {
          label: g.label,
          ids: new Map(g.rows.map((r) => [r.person.id, r.person.name])),
        },
      ]),
    );
    if (prevGroups)
      for (const [key, g] of groups) {
        const before = prevGroups.get(key)?.ids || new Map();
        for (const [id, name] of g.ids)
          if (!before.has(id))
            changeLog.unshift({
              at: now,
              clock,
              text: `${shortName(name)} · ${g.label.toLowerCase()}`,
              warn: true,
            });
      }
    prevGroups = groups;
    if (changeLog.length > 30) changeLog.length = 30;
  }
  let selection = null;
  const open = {
    safety: false,
    hazards: false,
    sources: false,
    why: false,
    hotelCard: false,
  };
  // Operator floor numbering per site (Part E): browser-only convenience.
  let numberingEntries = {};
  try {
    // Per trip (this sample trip = this city), per site.
    numberingEntries = JSON.parse(pref(`numbering.${cityKey}`, '{}')) || {};
  } catch {
    numberingEntries = {};
  }
  const opEntry = () =>
    validEntry(numberingEntries[siteKey]) ? numberingEntries[siteKey] : null;
  const computeNumbering = () => city.levels != null || Boolean(opEntry());
  let numbering = computeNumbering();
  let numberingForm = null;
  let numberingFormSig = '';
  function numberingNode() {
    const sig = `${siteKey}:${JSON.stringify(opEntry())}`;
    if (numberingForm && sig === numberingFormSig) return numberingForm;
    numberingFormSig = sig;
    numberingForm = createNumberingForm({
      entry: opEntry(),
      onSave: (entry) => {
        if (entry) numberingEntries[siteKey] = entry;
        else delete numberingEntries[siteKey];
        save(`numbering.${cityKey}`, JSON.stringify(numberingEntries));
        numbering = computeNumbering();
        feed();
      },
    });
    return numberingForm;
  }

  const card = createCard($('tt-card'), {
    onClose: () => {
      twin.select(null);
    },
  });
  const hud = createHud({
    rail: $('tt-rail'),
    incident: $('tt-incident'),
    onSelectPerson: (id, opts) => {
      floorReturn = null;
      twin.selectPerson(id, opts);
    },
    onOpenFloor: (label) => focusFloor(label),
    // Hero link when the floor can't be matched: open the site card's form.
    onSetNumbering: () => {
      if (!isHotelSel()) twin.select(hotelId());
      setTimeout(() => {
        const f = document.querySelector('.tt-numbering');
        f?.scrollIntoView({ block: 'center' });
        f?.querySelector('input, button')?.focus();
      }, 50);
    },
    onDismissReport: (reason) => twin.dismissReport(reason),
    onUndoDismiss: () => twin.undoDismiss(),
    onCopy: async () => {
      try {
        await navigator.clipboard.writeText(responderText(lastCtx));
        return true;
      } catch {
        return false;
      }
    },
  });

  // ---- cutaway (phase 2): hotel card + docked in the incident panel ----
  let lastOcc = null;
  let cutawayOpen = pref('cutawayOpen', 'true') !== 'false';
  const cutaway = createCutaway({ onPick: (l) => focusFloor(l) });
  const docked = createCutaway({
    compact: true,
    onPick: (l) => focusFloor(l),
  });
  const cutBox = document.createElement('section');
  cutBox.className = 'tt-cut-box';
  const cutHead = document.createElement('button');
  cutHead.type = 'button';
  cutHead.className = 'tt-cut-head';
  function setCutHead() {
    cutHead.textContent = `Floors ${cutawayOpen ? '▾' : '▸'}`;
    cutHead.setAttribute('aria-expanded', String(cutawayOpen));
    cutaway.el.hidden = !cutawayOpen;
    goFloor.hidden = !cutawayOpen;
  }
  cutHead.addEventListener('click', () => {
    cutawayOpen = !cutawayOpen;
    save('cutawayOpen', String(cutawayOpen));
    setCutHead();
  });
  // Go to floor (phase 2 deferred): type the number as the hotel shows it.
  // One on the hotel card and one over the incident panel's floor list.
  function makeGoFloor(idSuffix) {
    const form = document.createElement('form');
    form.className = 'tt-gofloor';
    const lab = document.createElement('label');
    lab.textContent = 'Go to floor';
    const input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.setAttribute('aria-label', 'Go to floor (as the hotel numbers it)');
    lab.append(input);
    const go = document.createElement('button');
    go.type = 'submit';
    go.className = 'tt-btn sm';
    go.textContent = 'Go';
    const msg = document.createElement('div');
    msg.className = 'tt-note tt-gofloor-msg';
    msg.id = `tt-gofloor-msg-${idSuffix}`;
    msg.setAttribute('role', 'status');
    input.setAttribute('aria-describedby', msg.id);
    form.append(lab, go, msg);
    const clear = () => {
      msg.textContent = '';
      input.removeAttribute('aria-invalid');
    };
    input.addEventListener('input', clear);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = Number(input.value);
      const labels = (lastOcc?.floors || []).map((f) => f.label);
      if (input.value === '' || !Number.isFinite(n)) return;
      if (!Number.isInteger(n)) {
        input.setAttribute('aria-invalid', 'true');
        msg.textContent = 'Enter a whole floor number, as on the lift buttons';
        return;
      }
      if (!labels.includes(n)) {
        input.setAttribute('aria-invalid', 'true');
        msg.textContent = labels.length
          ? `Floor ${n} is outside this building's floors (${Math.min(...labels)}–${Math.max(...labels)})`
          : 'Floors are not available for this building';
        return;
      }
      clear();
      input.value = '';
      focusFloor(n);
    });
    return form;
  }
  const goFloor = makeGoFloor('card');
  const dockedBox = document.createElement('div');
  dockedBox.className = 'tt-docked-box';
  dockedBox.append(makeGoFloor('incident'), docked.el);
  cutBox.append(cutHead, goFloor, cutaway.el);
  setCutHead();
  // During an incident the floors sit in the incident panel; one copy only.
  const cutPointer = document.createElement('div');
  cutPointer.className = 'tt-card-line tt-dim tt-cut-pointer';
  cutPointer.textContent = 'Floors and people are in the incident panel above';
  const hotelId = () => twin.site?.hotel.building.id;
  const isHotelSel = () =>
    selection?.kind === 'building' && selection.geom.isHotel;
  const cutCtx = () => ({
    numbering,
    reportKind: lastCtx?.incident?.kind || null,
    focusLabel: twin.floorFocus,
  });
  function renderCutaways() {
    if (!lastOcc) return;
    cutaway.render(lastOcc, cutCtx());
    docked.render(lastOcc, cutCtx());
  }
  function showBuilding(geom) {
    card.building(
      geom,
      {
        numbering,
        groundLabel: opEntry()?.groundLabel ?? city.groundFloorLabel,
        showOsmIds: $('tt-osmids').checked,
        hotelLabel: city.label,
        siteKind: city.kind === 'lodging' ? 'hotel' : 'venue',
        siteWhen: city.day ? `DAY ${city.day} · ${city.start}` : '',
        doors: twin.streets?.counts || null,
        // During an incident here the panel carries the floors; the hotel
        // card folds to its title so the panel keeps the height (J13).
        compact:
          geom.isHotel &&
          Boolean(lastCtx?.dockedCutaway) &&
          appMode !== 'advance',
      },
      geom.isHotel
        ? [
            // Unmapped numbering: ask the operator (Part E).
            ...(city.levels == null ? [numberingNode()] : []),
            // Advance is a planning view: Floors come from live positions.
            ...(appMode === 'advance'
              ? []
              : [lastCtx?.dockedCutaway ? cutPointer : cutBox]),
          ]
        : [],
      !geom.isHotel && geom.building.name && routeTarget ? [routeNode] : [],
    );
    $('tt-crumb-focus').textContent = geom.isHotel
      ? ''
      : `› ${geom.building.name || 'Building'}`;
  }
  const inIncident = () => lastCtx?.mode.mode === 'incident';
  // People at the hotel with no floor estimate: "could be on any floor".
  const atHotelNoFloor = () =>
    (lastA?.rows || []).filter(
      (r) =>
        r.floor.kind === 'unknown' ||
        r.floor.kind === 'not_shared' ||
        (r.floor.kind === 'none' && atHotelVerdict(r.verdict)),
    ).length;
  let floorReturn = null; // floor card a person was opened from (‹ Floor N)
  function renderFloorCard() {
    const label = twin.floorFocus;
    const roster =
      label === null || !lastOcc
        ? null
        : floorRoster(lastOcc, label, { numbering });
    if (!roster) return;
    card.floor(
      roster,
      {
        numbering,
        siteShort: city.short,
        footer: footerLine(lastOcc.footer),
        canCopy: inIncident(),
        reportedLabel: lastCtx?.reportedLabel,
        // During an incident the compact floors travel with the floor card.
        top: inIncident() && lastOcc.available ? [docked.el] : [],
      },
      {
        onBack: () => clearFloorFocus(),
        onPerson: (id) => {
          floorReturn = label;
          twin.selectPerson(id, { frame: true });
        },
        onCopy: async () => {
          try {
            await navigator.clipboard.writeText(
              floorRosterText(lastOcc, label, {
                ...cutCtx(),
                hotelLabel: city.label,
                asOf: lastCtx ? sampleClock(lastCtx.snapshot) : '',
                atHotelNoFloor: atHotelNoFloor(),
              }),
            );
            return true;
          } catch {
            return false;
          }
        },
      },
    );
    $('tt-crumb-focus').textContent =
      `› ${numbering ? 'Floor' : 'Level'} ${label}`;
  }
  /** Click / Enter on a floor: hotel selected, floor framed, roster shown. */
  function focusFloor(label) {
    if (!lastOcc?.available) return;
    floorReturn = null;
    if (!isHotelSel()) twin.select(hotelId());
    twin.setFloorFocus(
      label,
      lastOcc.floors.find((f) => f.label === label),
    );
    twin.frameFloor(label);
    renderFloorCard();
    renderCutaways();
    if (lastA && lastCtx) hud.render(lastA, lastCtx);
  }
  /** Back / Esc from a floor card: hotel card, camera as it was before. */
  function clearFloorFocus() {
    if (twin.floorFocus === null) return false;
    twin.setFloorFocus(null);
    twin.restoreView();
    if (isHotelSel()) showBuilding(selection.geom);
    renderCutaways();
    if (lastA && lastCtx) hud.render(lastA, lastCtx);
    return true;
  }

  function sampleClock(snap) {
    const sc = snap.scenario;
    const [h, m] = sc.clock.split(':').map(Number);
    const mins =
      h * 60 +
      m +
      Math.floor((sc.elapsed_s + (Date.now() - lastFeed) / 1000) / 60);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }

  function firesLine(f) {
    if (!f) return { line: 'Satellite heat detections · loading' };
    if (!f.visible) return { line: 'Satellite heat detections · layer off' };
    const base = {
      live: `NASA FIRMS · updated ${f.fetchedAt ? `${formatAge((Date.now() - Date.parse(f.fetchedAt)) / 1000)} ago` : 'recently'}`,
      stale: 'NASA FIRMS · from cache',
      simulated: 'SIMULATED heat detections (prototype)',
      no_key: 'Satellite heat detections unavailable · no FIRMS key',
      unavailable: 'Satellite heat detections unavailable right now',
      loading: 'Satellite heat detections · loading',
    }[f.status];
    if (!['live', 'stale', 'simulated'].includes(f.status))
      return { line: base, details: [] };
    return {
      line: f.summary.text,
      details: [base, 'Heat detections are not fire perimeters.'],
      hazard:
        f.summary.count > 0
          ? {
              text: `${f.simulated ? 'SIMULATED heat' : 'Heat'} detection ${formatDistance(f.summary.nearest.d)} ${bearingLabel(city.center, f.summary.nearest)}`,
            }
          : null,
    };
  }

  function safetyLines(snap) {
    const here = twin.activePlace()?.id;
    return (snap.safety_points || [])
      .filter((p) => !p.location_id || p.location_id === here)
      .filter((p) => p.category !== 'rally_primary')
      .map((p) => {
        const label = SAFETY_LABEL[p.category] || p.category;
        if (!p.coordinates) return `${label} · location not set`;
        const ll = { lat: p.coordinates.lat, lon: p.coordinates.lng };
        const d = haversineM(city.center, ll);
        const st =
          p.approval_status !== 'active' ? ' · Draft · not approved' : '';
        return `${label} · ${formatDistance(d)} ${bearingLabel(city.center, ll)}${st}`;
      });
  }

  /** The place whose card is open glows on the map and in the chips. */
  function syncPlaceHighlight() {
    if (selection?.kind !== 'suggested') twin.setPathSelected?.(null);
    twin.setSelectedPlace(
      selection?.kind === 'place' ? selection.place.id : null,
    );
    renderChips(lastChips);
  }
  let lastChips = [];
  function renderChips(chips) {
    lastChips = chips;
    const max = 4;
    const selId = selection?.kind === 'place' ? selection.place.id : null;
    const list = chips.slice(0, max).map((c) => {
      const b = document.createElement(c.onClick ? 'button' : 'span');
      if (c.onClick) {
        b.type = 'button';
        b.addEventListener('click', c.onClick);
      }
      b.className = `tt-chip${c.draft || c.missing ? ' draft' : ''}${c.hazard ? ' hazard' : ''}${c.people ? ' people' : ''}${c.site ? ' site' : ''}${c.id && c.id === selId ? ' on' : ''}`;
      if (c.id && c.id === selId) b.setAttribute('aria-current', 'true');
      b.textContent =
        c.missing || c.people
          ? c.label
          : `${c.label} ${c.distance} ${c.bearing}`;
      return b;
    });
    if (chips.length > max) {
      const more = document.createElement('span');
      more.className = 'tt-chip draft';
      more.textContent = `+${chips.length - max} more`;
      list.push(more);
    }
    $('tt-chips').replaceChildren(...list);
  }

  let lastModeKey = null;
  const twin = createTripTwin({
    viewer,
    tileset,
    glowStyle: glowParam,
    simulateFires: $('tt-simfire').checked,
    // Phase 9 (review O1): a path card never outlives its line.
    onDrawnPaths: (id) => onDrawnPathsChange(id),
    onEntityPick: (id) => {
      const m = /^twin-site:(.+)$/.exec(id);
      if (m) {
        switchSite(m[1]);
        return true;
      }
      // Phase 9: a drawn suggested path (its line or its casing).
      const sp9 = /^twin-path:(primary|alternate)/.exec(id);
      if (sp9) {
        selectSuggestedPath(sp9[1]);
        return true;
      }
      const sv = /^twin-saved:([^:]+)/.exec(id);
      if (sv) {
        selectSaved(sv[1]);
        return true;
      }
      const av = /^twin-avoid:(.+)$/.exec(id);
      if (av) {
        selectArea(av[1]);
        return true;
      }
      const sp = /^twin-safety:(.+)$/.exec(id);
      const p =
        sp &&
        (lastCtx?.snapshot?.safety_points || []).find((x) => x.id === sp[1]);
      if (!p?.coordinates) return false;
      selectPlace(p);
      return true;
    },
    onSelect: (sel) => {
      selection = sel;
      if (!placeSelecting) syncPlaceHighlight();
      if (!sel) {
        if (!placeSelecting) {
          releaseCard();
          card.hide();
          $('tt-crumb-focus').textContent = '';
        }
        return;
      }
      if (sel.kind === 'person') {
        lastPersonId = sel.row.person.id;
        setRouteTarget({
          key: `person:${sel.row.person.id}`,
          kind: 'person',
          label: sel.row.person.name,
          row: sel.row,
          point: sel.row.person.coordinates
            ? {
                lat: sel.row.person.coordinates.lat,
                lon: sel.row.person.coordinates.lng,
              }
            : null,
        });
        const fr = floorReturn;
        card.person(
          sel.row,
          {
            hotelPoint: city.center,
            noun: city.kind === 'lodging' ? 'hotel' : 'venue',
          },
          { numbering },
          fr !== null
            ? { label: `‹ Floor ${fr}`, onClick: () => focusFloor(fr) }
            : null,
          routeTarget?.point ? [routeNode] : [],
        );
        $('tt-crumb-focus').textContent =
          `${fr !== null ? `› Floor ${fr} ` : ''}› ${sel.row.person.name}`;
      } else if (sel.geom.isHotel && twin.floorFocus !== null)
        renderFloorCard();
      else {
        const b = sel.geom.building;
        if (!sel.geom.isHotel && b.name) {
          const c = b.rings[0].reduce(
            (a, q) => ({
              lat: a.lat + q.lat / b.rings[0].length,
              lon: a.lon + q.lon / b.rings[0].length,
            }),
            { lat: 0, lon: 0 },
          );
          setRouteTarget({
            key: `building:${b.id}`,
            kind: 'place',
            label: b.name,
            point: c,
          });
        } else if (!sel.geom.isHotel) releaseCard();
        showBuilding(sel.geom);
      }
    },
    onAssess: (a, info) => {
      // The open path card follows the clock, the roster and the checks (O2, O4).
      queueMicrotask(() => renderPathCard());
      const snap = info.snapshot;
      const clock = sampleClock(snap);
      const ageS = (Date.now() - lastFeed) / 1000;
      const rep = snap.reported_incidents?.[0];
      const fromSnapshot =
        rep && rep.floor_label === info.reportedLabel && !info.operatorReport;
      const incident = fromSnapshot
        ? {
            kind: rep.kind,
            source: rep.source,
            clock: '02:12',
            ageMin: Math.max(
              1,
              Math.round((Date.now() - Date.parse(rep.reported_at)) / 60000),
            ),
          }
        : info.operatorReport
          ? (() => {
              // The report's own time and real age (review/phase10 R4).
              const at = info.operatorReport.at ?? Date.now();
              const ago = Math.max(0, Math.round((Date.now() - at) / 60000));
              const [h, m] = clock.split(':').map(Number);
              const mins = (((h * 60 + m - ago) % 1440) + 1440) % 1440;
              return {
                kind: info.operatorReport.kind,
                source: 'operator entry',
                clock: `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`,
                ageMin: ago,
              };
            })()
          : null;
      const fires = firesLine(info.fires);
      const weather = weatherLines(a, snap, incident);
      const siteName = (placeId) => {
        const key = snap.places.find((p) => p.id === placeId)?.site_key;
        return SITES.find((x) => x.key === key)?.short || 'another site';
      };
      const baseMode = deriveMode(a, {
        reportedLabel: info.reportedLabel,
        incident,
        delayedS: info.delayed ? ageS : 0,
        asOf: new Date(lastFeed).toLocaleTimeString(),
        // EX-WX-01 outranks a heat detection: it is about people outdoors.
        hazard: weather.lightning
          ? { text: weather.lightning.text }
          : fires.hazard || null,
        dataAgeS: ageS,
      });
      // An incident anywhere on the trip is never hidden (review/phase3 G3).
      const mode = withTripIncidents(baseMode, {
        snapshot: snap,
        activePlaceId: twin.activePlace()?.id,
        siteName,
        rows: a.rows,
      });
      // An incident arriving while the weather shows another time snaps the
      // view back to now and says so (phase 6): live data first.
      if (
        ['incident', 'incident_elsewhere', 'watch'].includes(mode.mode) &&
        lastModeKey !== mode.mode &&
        wx.at != null &&
        appMode === 'live'
      ) {
        timeline?.stop();
        wx.at = null;
        queueMicrotask(() => {
          renderWeather();
          offerNotice(
            mode.mode === 'watch'
              ? 'Lightning watch — weather is back to now'
              : 'Incident reported — weather is back to now',
          );
        });
      }
      if (mode.mode !== lastModeKey) queueMicrotask(() => syncContextDim());
      if (waysOut && mode.mode !== lastModeKey) {
        applyWaysOut();
        queueMicrotask(renderWaysTag);
      }
      lastModeKey = mode.mode;
      // Top bar: mode chip, data age, sample clock, trip in the breadcrumb.
      const chip = $('tt-mode');
      chip.textContent =
        mode.chip +
        (mode.degraded ? ' · DATA DELAYED' : '') +
        (simulationOn() ? ' · SIMULATED DATA' : '') +
        (wx.at != null && appMode === 'live'
          ? ` · WEATHER ${relText(wx.at, Math.floor(Date.now() / 9e5) * 9e5)}`
          : '');
      chip.className = `tt-mode ${mode.mode}${mode.degraded ? ' degraded' : ''}`;
      $('tt-age').textContent = `data ${formatAge(ageS)}`;
      $('tt-age').title = `Traveler data ${formatAge(ageS)} old`;
      $('tt-age').classList.toggle('warn', mode.degraded);
      // The trip clock is fictional; weather times are real (phase 6 UX P0-1).
      $('tt-clock').textContent = `${clock} sample clock`;
      $('tt-clock').title =
        'Sample trip clock (fictional). Weather times are real local time with their zone.';
      $('tt-crumb-trip').textContent = snap.trips[0].title;
      const reportBtn = $('tt-report-btn');
      reportBtn.textContent = Number.isFinite(info.reportedLabel)
        ? `Reported floor ${info.reportedLabel}`
        : innerWidth < 1440
          ? 'Report floor'
          : 'Add reported floor';
      // Lightning outside the view gets an edge chip (nearest point).
      const ltg = strikes()
        .map((pt) => ({ pt, d: haversineM(city.center, pt) }))
        .sort((x, y) => x.d - y.d)[0];
      const wxChips =
        ltg && ltg.d <= 15000
          ? [
              {
                label: `${wx.sim.lightning ? 'SIMULATED ' : ''}Lightning`,
                distance: formatDistance(ltg.d),
                bearing: bearingLabel(city.center, ltg.pt),
                hazard: true,
              },
            ]
          : [];
      lastSiteCounts = siteCounts(snap.participants, SITES);
      renderBeacons();
      // A reported incident at another site of the trip is never hidden.
      const here = twin.activePlace()?.id;
      const elsewhere = (snap.reported_incidents || []).find(
        (r) => r.place_id !== here,
      );
      const elsewhereSite = elsewhere
        ? SITES.find(
            (s2) =>
              snap.places.find((p) => p.id === elsewhere.place_id)?.site_key ===
              s2.key,
          )
        : null;
      const incidentChips = elsewhereSite
        ? [
            {
              label: `Reported ${elsewhere.kind} at ${elsewhereSite.short}, floor ${elsewhere.floor_label} · not verified — show`,
              hazard: true,
              missing: true,
              onClick: () => switchSite(elsewhereSite.key),
            },
          ]
        : [];
      // Off-screen places open the same card as on-screen ones (Part C).
      const placeChips = (info.chips || []).map((c) => {
        const sp =
          c.id &&
          (snap.safety_points || []).find(
            (x) => x.id === c.id && x.coordinates,
          );
        return sp ? { ...c, onClick: () => selectPlace(sp) } : c;
      });
      // Other sites of the trip as edge chips (review/phase3 G15).
      const here2 = city.anchors?.inside || city.center;
      const siteChips = SITES.filter((x) => x.key !== siteKey).map((x) => {
        const pt = x.anchors?.inside || x.center;
        return {
          label: `${x.short}${x.day ? ` · Day ${x.day}` : ' · hotel'}`,
          distance: formatDistance(haversineM(here2, pt)),
          bearing: bearingLabel(here2, pt),
          site: true,
          onClick: () => switchSite(x.key),
        };
      });
      placeChips.push(...siteChips);
      renderChips(
        appMode === 'advance'
          ? [
              ...incidentChips,
              ...wxChips,
              ...placeChips.filter((c) => !c.people),
            ]
          : [...incidentChips, ...wxChips, ...placeChips],
      );
      lastA = a;
      logChanges(a, mode, sampleClock(snap));
      lastCtx = {
        mode,
        numbering,
        night: info.night,
        paths: info.paths,
        pathsLoading: info.pathsLoading,
        fires: { ...fires, simulated: info.fires.simulated },
        reportedLabel: info.reportedLabel,
        incident,
        weather,
        avoidAreas: pathStore.areas,
        hotelCard: twin.activePlace()?.hotel_card || null,
        siteNoun: city.kind === 'lodging' ? 'hotel' : 'venue',
        siteLine: lastSiteCounts ? siteCountsLine(lastSiteCounts, siteKey) : '',
        hotelApproximate: twin.site?.hotel.approximate,
        dismissed: info.dismissed,
        selectedPersonId:
          selection?.kind === 'person' ? selection.row.person.id : null,
        safetyLines: safetyLines(snap),
        open,
        sources: [
          `Traveler data · sample feed · updated ${formatAge(ageS)} ago`,
          `Floor estimates · phone barometer · not verified · ${snap.participants.filter((p) => p.floor_estimate).length} phones`,
          twin.site?.osmSource === 'live'
            ? 'Buildings · OpenStreetMap · live'
            : `Buildings · OpenStreetMap · recorded ${twin.site?.osmFetchedAt?.slice(0, 10) || ''}`,
          `Terrain · Re:Earth · ${twin.site?.terrainSource || ''}`,
          fires.details?.[0] || fires.line,
          wx.status === 'live'
            ? `Weather · MET Norway · forecast for ${hhmm(wxSummary()?.validTime)} · fetched ${hhmm(wx.fetchedAt)}`
            : 'Weather · unavailable',
          `Official warnings · ${WX.warnings === 'nws' ? 'NWS' : 'MeteoAlarm'} · ${wx.warningsStatus}`,
        ],
      };
      lastOcc = floorOccupancy(a, twin.activePlace(), info.reportedLabel);
      lastCtx.snapshot = snap;
      lastCtx.asOf = clock;
      lastCtx.dockedCutaway =
        mode.mode === 'incident' &&
        lastOcc.available &&
        twin.floorFocus === null &&
        lastOcc.floors.some((f) => f.state === 'reported')
          ? dockedBox
          : null;
      renderCutaways();
      hud.render(a, lastCtx);
      if (twin.floorFocus !== null && lastOcc.available)
        twin.setFloorFocus(
          twin.floorFocus,
          lastOcc.floors.find((f) => f.label === twin.floorFocus),
        );
      if (isHotelSel())
        if (twin.floorFocus !== null) renderFloorCard();
        else showBuilding(selection.geom);
      renderLayers();
      if (appMode === 'advance') applyAppMode();
      else if (!document.body.classList.contains('tt-live-init')) {
        document.body.classList.add('tt-live-init');
        applyAppMode();
      }
    },
    onStatus: (state, detail) => {
      status.textContent = ['ready', 'idle', 'entering'].includes(state)
        ? ''
        : detail || state;
      document.body.dataset.twinState = state;
      // Harness only: hide the scene while primitives compile.
      $('tt-veil').classList.toggle('on', state === 'loading');
    },
    onContext: () => renderLayers(),
    onContextClick: () =>
      offerNotice(
        'Wider area — no details on click · the detailed area is selectable',
      ),
    onReady: (site) => {
      queueMicrotask(() => applyGround());
      wxLayer?.dispose();
      wxLayer = createWeatherLayer(viewer, site);
      fxLayer?.dispose();
      fxLayer = createWeatherFx(viewer, site);
      renderWeather();
      beacons?.dispose();
      beacons = createSiteBeacons(viewer, site);
      renderBeacons();
      customLayer?.dispose();
      customLayer = createCustomPathsLayer(viewer, site);
      renderCustom();
      $('tt-osm-source').textContent =
        site.osmSource === 'live'
          ? 'OSM buildings · live'
          : `OSM buildings · recorded ${site.osmFetchedAt?.slice(0, 10) || ''}`;
      $('tt-proto-note').textContent =
        `OSM source: ${site.osmSource} · terrain: ${site.terrainSource}`;
    },
  });
  window.tripTwin = twin;

  // ---- sites (phase 3 Part A): switcher, beacons, per-site counts ----
  let beacons = null;
  let lastSiteCounts = null;
  function renderBeacons() {
    if (!beacons) return;
    beacons.update(SITES, {
      activeKey: siteKey,
      counts:
        appMode === 'advance'
          ? {}
          : Object.fromEntries(
              (lastSiteCounts?.bySite || []).map((x) => [x.key, x.n]),
            ),
    });
  }
  function renderSites() {
    const root = $('tt-sites');
    const title = popHead('Sites on this trip', 'S');
    const list = document.createElement('ul');
    list.className = 'tt-site-list';
    for (const s of SITES) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = s.key === siteKey ? 'on' : '';
      const n = lastSiteCounts?.bySite.find((x) => x.key === s.key)?.n ?? 0;
      const name = document.createElement('span');
      name.textContent = siteOptionLabel(s);
      const meta = document.createElement('span');
      meta.className = 'tt-dim';
      // Advance shows no traveler positions, so no counts either.
      const here = appMode === 'advance' ? '' : ` · ${n} here`;
      meta.textContent =
        s.key === siteKey
          ? `on screen${here} · select the building`
          : here.replace(/^ · /, '') || 'switch to this site';
      b.append(name, meta);
      b.addEventListener('click', () => {
        closePops();
        if (s.key === siteKey) {
          if (hotelId()) twin.select(hotelId());
        } else switchSite(s.key);
      });
      li.append(b);
      list.append(li);
    }
    const whole = document.createElement('button');
    whole.type = 'button';
    whole.className = 'tt-link';
    whole.textContent = 'Whole trip — frame every site';
    whole.addEventListener('click', () => {
      closePops();
      frameWholeTrip();
    });
    root.replaceChildren(title, list, whole);
    setTimeout(() => list.querySelector('button.on')?.focus(), 0);
  }
  /** Operator action: fit every site of the trip in the clear map area. */
  function frameWholeTrip() {
    const pts = SITES.map((x) => x.anchors?.inside || x.center);
    const sphere = Cesium.BoundingSphere.fromPoints(
      pts.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)),
    );
    // Panels cover the sides: pull back so the sites sit in the middle third.
    viewer.camera.flyToBoundingSphere(sphere, {
      offset: new Cesium.HeadingPitchRange(
        0,
        Cesium.Math.toRadians(-60),
        Math.max(2500, sphere.radius * 4.2),
      ),
      // Display › Reduce motion counts as well as the system setting.
      duration:
        matchMedia('(prefers-reduced-motion: reduce)').matches ||
        $('tt-reduce-motion').checked
          ? 0
          : 1.4,
    });
  }
  /** Fly out, rebuild for another site, fly in. Trip-wide state is kept. */
  /** A live incident at the site on screen (any mode: it is live data). */
  const liveIncidentHere = () => lastCtx?.mode?.mode === 'incident';
  async function switchSite(key, { confirmed = false } = {}) {
    if (key === siteKey || !siteConfig(key)) return;
    if (pathEditor.blockIfDirty('switch site')) return;
    // Leaving the site of a live incident asks once (phase 3 deferred).
    if (!confirmed && liveIncidentHere()) {
      closePops();
      return confirmToast(
        `Incident at ${city.short} — switch to ${siteConfig(key).short}? The incident stays on screen with a way back.`,
        `Switch to ${siteConfig(key).short}`,
        () => switchSite(key, { confirmed: true }),
        `Stay at ${city.short}`,
      );
    }
    clearFloorFocus();
    closePathCard();
    clearRoute();
    floorReturn = null;
    siteKey = key;
    city = siteConfig(key);
    numbering = computeNumbering();
    wxBox = boxAround(city.center);
    ltgBox = ltgBoxFor(city.center);
    wx.images = {};
    wx.imageAt = {};
    wx.imageErr = {};
    wx.lastLightning = null;
    $('tt-hotel').textContent = `${city.short} ▾`;
    const next = new URLSearchParams(location.search);
    next.set('site', key);
    history.replaceState(null, '', `?${next}`);
    await twin.switchSite(key, { osmMode });
    loadWeatherNow();
    loadWarnings();
    ensureImage('lightning');
    for (const k of ['precip', 'totals']) if (wx.layers[k]) ensureImage(k);
  }

  // Framing lands in the area the panels leave free (phase 5b).
  const visibleBox = (id) => {
    const e = $(id);
    // Fixed panels have no offsetParent; client rects tell if it is laid out.
    if (!e || e.hidden || !e.getClientRects().length) return null;
    const r = e.getBoundingClientRect();
    return r.width && r.height ? r : null;
  };
  twin.setSafeArea(() => {
    const left = visibleBox('tt-rail') || visibleBox('tt-advance');
    const right = ['tt-editor', 'tt-incident', 'tt-card']
      .map(visibleBox)
      .filter(Boolean);
    const bar = $('tt-bar').getBoundingClientRect();
    const tools = $('tt-toolbar').getBoundingClientRect();
    return {
      left: left ? left.right : 0,
      right: right.length
        ? innerWidth - Math.min(...right.map((r) => r.left))
        : 0,
      top: bar.bottom + 40,
      bottom: innerHeight - tools.top,
    };
  });
  /** Any simulated feed on (review/phase5 J9). */
  function simulationOn() {
    return (
      $('tt-simfire').checked ||
      $('tt-simlightning').checked ||
      $('tt-simrain').checked ||
      $('tt-simsnow').checked
    );
  }
  /** The Prototype pill says SIM ON while any simulated feed is on. */
  function renderSimFlag() {
    const on = simulationOn();
    const b = $('tt-proto-btn');
    b.classList.toggle('sim', on);
    b.firstChild.textContent = on ? 'Prototype · SIM ON ' : 'Prototype ';
    b.title = on
      ? 'Simulated data is on — Prototype controls (`)'
      : 'Prototype controls (`)';
  }
  // ---- paths from any place or person (phase 3 Part C; review/phase5) ----
  // The card owns the choice (J1); a drawn path outlives its card (J6) until
  // it is removed, Esc, or another path is drawn. One path on the map.
  const routeNode = document.createElement('section');
  routeNode.className = 'tt-route';
  let routeTarget = null; // {key, kind: 'place'|'person', label, point, row?, place?}
  let routeModel = null;
  let routeAbort = null;
  let lastPersonId = null;
  let placeSelecting = false;
  let drawn = null; // {targetKey, model, summary, pill}
  let sessionProfile = null; // the operator's last explicit Walk / Drive
  const sitePoint = () => ({
    lat: (city.anchors?.inside || city.center).lat,
    lon: (city.anchors?.inside || city.center).lon,
  });
  const llOf = (p) => ({ lat: p.coordinates.lat, lon: p.coordinates.lng });
  // Times on the sample trip read on the sample clock (the top bar's), so a
  // position "at 21:31" agrees with "21:32 local · sample".
  const clock = (ms) => {
    const snap = lastCtx?.snapshot;
    if (!snap?.scenario) return '';
    const [h, m] = sampleClock(snap).split(':').map(Number);
    const mins =
      (((h * 60 + m + Math.round((ms - Date.now()) / 60000)) % 1440) + 1440) %
      1440;
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  };
  const firstName = (n) => String(n || '').split(/\s+/)[0];
  const emergencyLine = () =>
    city.timezone.startsWith('America')
      ? 'Medical emergency: call 911. This path is for an escort, not dispatch.'
      : 'Medical emergency: call 999 or 112. This path is for an escort, not dispatch.';
  /** Address, phone and emergency-department status for a hospital (J3). */
  function hospitalLines(h) {
    if (h?.category !== 'hospital') return [];
    return [
      ...(h.address ? [h.address] : []),
      ...(h.contact ? [h.contact] : []),
      h.emergency === 'yes'
        ? 'Emergency department listed in OpenStreetMap · not verified'
        : 'Emergency department not listed in OpenStreetMap — call ahead',
      emergencyLine(),
    ];
  }
  /** The person's current fix: point, clock time, age, current or not. */
  function personFix(row) {
    const c = row?.person?.coordinates;
    if (!c) return null;
    const age = Number.isFinite(row.pos?.age) ? row.pos.age : null;
    return {
      lat: c.lat,
      lon: c.lng,
      age,
      atMs: age === null ? null : Date.now() - age * 1000,
      current: Boolean(row.pos?.current),
    };
  }
  function routeEnds() {
    const points = lastCtx?.snapshot?.safety_points || [];
    const here = twin.activePlace()?.id;
    if (routeTarget.kind === 'person') {
      const from = routeTarget.point;
      const who = firstName(routeTarget.label);
      // Nearest to the person among every hospital on file (J2).
      const hospitals = points
        .filter((p) => p.category === 'hospital' && p.coordinates)
        .map((p) => ({ p, d: haversineM(from, llOf(p)) }))
        .sort((x, y) => x.d - y.d);
      const rallies = points
        .filter(
          (p) =>
            p.location_id === here &&
            /^rally_/.test(p.category) &&
            p.coordinates,
        )
        .sort((x) => (x.category === 'rally_primary' ? -1 : 1));
      const atSite = haversineM(from, sitePoint()) < 80;
      const hotel = SITES[0];
      const hosp = hospitals[0];
      return [
        hosp && {
          key: 'hospital',
          label: 'Nearest listed hospital',
          meta: `${hosp.p.name} · ${formatDistance(hosp.d)} straight line`,
          title: `Nearest in a straight line of ${hospitals.length} hospital${hospitals.length > 1 ? 's' : ''} on file`,
          to: llOf(hosp.p),
          toLabel: hosp.p.name || 'the hospital',
          place: hosp.p,
        },
        {
          key: 'site',
          label: city.short,
          meta: atSite
            ? `${who} is here (likely)`
            : `${formatDistance(haversineM(from, sitePoint()))} straight line`,
          disabled: atSite,
          title: atSite ? `${who} is at ${city.short} (likely)` : '',
          to: sitePoint(),
          toLabel: city.short,
        },
        // At a venue, the hotel is a destination too (review/phase3 G12).
        city.key !== hotel.key && {
          key: 'hotel',
          label: hotel.short,
          meta: `${formatDistance(haversineM(from, hotel.anchors.inside))} straight line`,
          to: { lat: hotel.anchors.inside.lat, lon: hotel.anchors.inside.lon },
          toLabel: hotel.short,
        },
        ...rallies.map((r) => ({
          key: `rally:${r.id}`,
          label:
            r.category === 'rally_primary'
              ? 'Rally point (primary)'
              : 'Rally point (secondary)',
          tag: r.approval_status !== 'active' ? 'not approved' : '',
          meta: `${formatDistance(haversineM(from, llOf(r)))} straight line`,
          to: llOf(r),
          toLabel: r.name || 'the rally point',
        })),
      ].filter(Boolean);
    }
    const rows = lastA?.rows || [];
    const person = rows.find((r) => r.person.id === lastPersonId);
    const centre = groupCentre(rows, sitePoint());
    return [
      {
        key: 'site',
        label: city.short,
        meta: `${formatDistance(haversineM(sitePoint(), routeTarget.point))} straight line`,
        from: sitePoint(),
        fromLabel: city.short,
      },
      {
        key: 'group',
        label: centre ? `Group center · ${centre.n} people` : 'Group center',
        meta: centre ? 'median of current positions' : '',
        disabled: !centre,
        title: centre
          ? 'Median of current positions at this site'
          : 'Fewer than 3 current positions here',
        from: centre,
        fromLabel: centre ? `the group center (${centre.n} people)` : '',
      },
      ...(person?.person.coordinates
        ? [
            {
              key: 'person',
              label: `${person.person.name} · last selected`,
              meta: person.pos.current ? '' : 'not current',
              from: llOf(person.person),
              row: person,
            },
          ]
        : []),
    ];
  }
  const modeTime = (card) => card?.metric?.split(' · ')[1] || '';
  function drawRouteSection() {
    if (!routeTarget) return;
    const ends = routeEnds();
    if (
      routeModel.originKey &&
      !ends.some((e) => e.key === routeModel.originKey && !e.disabled)
    )
      routeModel.originKey = null;
    const person = routeTarget.kind === 'person';
    const end = ends.find((e) => e.key === routeModel.originKey);
    renderRouteSection(
      routeNode,
      {
        ...routeModel,
        title: person
          ? `PATH FROM ${routeTarget.label}`
          : `PATH TO ${routeTarget.label}`,
        stepLabel: person ? 'To' : 'From',
        idleHint: person
          ? 'Choose where to — the path appears on the map.'
          : 'Choose where from — the path appears on the map.',
        origins: ends,
        extras: hospitalLines(person ? end?.place : routeTarget.place),
      },
      {
        onOrigin: (k) => {
          routeModel.originKey = k;
          routeModel.stale = '';
          runRoute();
        },
        onMode: (profile) => {
          sessionProfile = profile;
          routeModel = { ...routeModel, profile, chosen: true };
          if (routeModel.originKey) runRoute({ profile });
          else drawRouteSection();
        },
        onClear: () => removePath(),
        onFrame: () => twin.frameRoute(),
        onCopy: () => copyPathSummary(),
        onReplan: () => runRoute({ profile: routeModel.profile }),
        onEdit: () => {
          const ep = routeModel.originKey ? routeEndpoints() : null;
          const fromPerson = person || routeModel.originKey === 'person';
          const startAt = ep || {
            from: person ? routeTarget.point : sitePoint(),
            to: person ? sitePoint() : routeTarget.point,
            fromLabel: person ? routeTarget.label : city.short,
            toLabel: person ? city.short : routeTarget.label,
          };
          removePath();
          pathEditor.start({
            ...startAt,
            // A traveler's position is never stored by name (H4).
            fromLabel: fromPerson ? 'a traveler’s position' : startAt.fromLabel,
            fromPerson,
            profile: routeModel.profile || 'foot',
            day: appMode === 'advance' ? currentAdvanceDay() : todayDay(),
          });
        },
      },
    );
  }
  function freshModel() {
    return {
      originKey: null,
      profile: sessionProfile || 'foot',
      chosen: Boolean(sessionProfile),
      status: 'idle',
      cards: [],
      times: {},
      reason: '',
      stale: '',
    };
  }
  function setRouteTarget(t) {
    if (routeTarget?.key === t.key) {
      // Same card refreshed: keep the plan, notice when the person moved (J4).
      routeTarget = { ...routeTarget, ...t };
      checkStale();
      return drawRouteSection();
    }
    if (routeModel?.status === 'loading') routeAbort?.abort();
    routeTarget = t;
    routeModel = drawn?.targetKey === t.key ? { ...drawn.model } : freshModel();
    drawRouteSection();
    renderPill();
  }
  /** The card went away; a drawn path stays on the map with its pill (J6). */
  function releaseCard() {
    if (routeModel?.status === 'loading') routeAbort?.abort();
    routeTarget = null;
    routeModel = null;
    renderPill();
  }
  /** Remove the drawn path (Remove, Esc, pill ×). */
  function removePath() {
    routeAbort?.abort();
    routeAbort = null;
    const had = twin.hasRoute;
    twin.clearRoute();
    drawn = null;
    if (routeModel) {
      routeModel = { ...routeModel, status: 'idle', cards: [], stale: '' };
      drawRouteSection();
    }
    renderPill();
    return had;
  }
  /** Everything: the path and the card's plan (site or mode switch). */
  function clearRoute() {
    removePath();
    releaseCard();
  }
  function checkStale() {
    const m = routeModel;
    if (m?.status !== 'ready' || !m.fix || routeTarget.kind !== 'person')
      return;
    const now = personFix(routeTarget.row);
    if (!now) return;
    const moved = haversineM(now, m.fix) > 50;
    const newer =
      Number.isFinite(now.atMs) &&
      Number.isFinite(m.fix.atMs) &&
      now.atMs - m.fix.atMs >= 120000;
    m.stale = moved
      ? `${firstName(routeTarget.label)} has moved since this path was planned`
      : newer
        ? `${firstName(routeTarget.label)} has a newer position than this path`
        : '';
  }
  /** The chosen start and end of the card's path section. */
  function routeEndpoints() {
    const end = routeEnds().find((e) => e.key === routeModel.originKey);
    if (!end) return null;
    if (routeTarget.kind === 'person') {
      const fix = personFix(routeTarget.row);
      const age = fix?.age != null ? formatAge(fix.age) : null;
      const fromLabel = !fix
        ? routeTarget.label
        : fix.current
          ? `${routeTarget.label} (position at ${clock(fix.atMs)} · ${age} old)`
          : `${routeTarget.label} (last known position, ${age} old)`;
      return {
        from: routeTarget.point,
        to: end.to,
        fromLabel,
        toLabel: end.toLabel,
        fix,
        place: end.place,
        personId: routeTarget.row?.person?.id || null,
        personName: routeTarget.label,
      };
    }
    let fromLabel = end.fromLabel;
    let fix = null;
    if (end.key === 'person') {
      fix = personFix(end.row);
      fromLabel = `${end.row.person.name} (${fix.current ? `position at ${clock(fix.atMs)}` : 'last known position'} · ${formatAge(fix.age)} old)`;
    }
    return {
      from: end.from,
      to: routeTarget.point,
      fromLabel,
      toLabel: routeTarget.label,
      fix,
      place: routeTarget.place,
      personId: end.key === 'person' ? end.row.person.id : null,
      personName: end.key === 'person' ? end.row.person.name : null,
    };
  }
  async function runRoute({ profile: asked } = {}) {
    const ep = routeEndpoints();
    if (!ep) return;
    const { from, to, fromLabel, toLabel } = ep;
    const straight = haversineM(from, to);
    const auto = defaultMode(straight);
    const profile =
      asked || (routeModel.chosen ? routeModel.profile : auto.profile);
    const reason = asked || routeModel.chosen ? '' : auto.reason;
    const other = profile === 'foot' ? 'car' : 'foot';
    routeAbort?.abort();
    routeAbort = new AbortController();
    const signal = routeAbort.signal;
    const target = routeTarget;
    routeModel = {
      ...routeModel,
      profile,
      status: 'loading',
      reason,
      straightM: straight,
      stale: '',
    };
    drawRouteSection();
    try {
      const [paths, est] = await Promise.all([
        planRouteSet(from, to, {
          profile,
          signal,
          hazards: twin.hazardPoints(),
        }),
        primaryEstimate(from, to, { profile: other, signal }).catch(() => null),
      ]);
      if (signal.aborted) return;
      // The Advance path replaces any drawn card path (one path on the map).
      drawn = null;
      renderPill();
      // A traveler's position is never stored: the set says so as data, so
      // the gate never depends on a label (review/phase9 O15). Its age is
      // read live wherever the start is named (O2).
      const person = routeTarget.kind === 'person' || ep.personId;
      twin.showRoute(paths, {
        fromLabel: person ? ep.personName || fromLabel : fromLabel,
        toLabel,
        ends: { from, to },
        fix: ep.fix,
        fromPerson: Boolean(person || ep.fix),
        personId: ep.personId,
        startText: person
          ? () => fixText(shortName(ep.personName || ''), ep.fix)
          : null,
      });
      const cards = routeCards(
        paths,
        { profile, toLabel, fromLabel },
        {
          areas: pathStore.areas,
          pace: profile === 'foot' ? lastCtx?.weather?.pace : null,
          simulatedFires: lastCtx?.fires?.simulated,
        },
      );
      routeModel = {
        ...routeModel,
        status: 'ready',
        cards,
        paths,
        req: { profile, toLabel, fromLabel },
        est: est ? { ...est, profile: other } : null,
        fix: ep.fix,
        times: {
          [profile]: modeTime(cards[0]),
          [other]: est?.range
            ? `${est.range[0]}–${est.range[1]} min`
            : 'unavailable',
        },
        other: est?.range
          ? {
              verb: MODES[other].verb,
              text: `${formatDistance(est.distanceM)} · ${est.range[0]}–${est.range[1]} min`,
            }
          : null,
      };
      drawn = {
        targetKey: target.key,
        targetLabel: target.label,
        model: routeModel,
        ep,
        pill: `${cards[0].route.replace(/ \(.*?\)/, '')} · ${MODES[profile].verb} ${cards[0].metric}`,
      };
    } catch (error) {
      if (signal.aborted) return;
      routeModel = {
        ...routeModel,
        status: 'error',
        error: String(error?.message || error),
        straight: formatDistance(straight),
      };
    }
    if (routeTarget === target) {
      drawRouteSection();
      // Bring the answer into view in the card (the camera never moves).
      routeNode
        .querySelector('.tt-route-out')
        ?.scrollIntoView({ block: 'nearest' });
    }
    renderPill();
  }
  /** Rebuild the path texts in the current units (Display › Units). */
  function rebuildRouteText(m) {
    if (!m?.paths) return m;
    const cards = routeCards(m.paths, m.req, {
      areas: pathStore.areas,
      pace: m.req.profile === 'foot' ? lastCtx?.weather?.pace : null,
      simulatedFires: lastCtx?.fires?.simulated,
    });
    return {
      ...m,
      cards,
      reason: m.reason ? defaultMode(m.straightM).reason : '',
      other: m.est?.range
        ? {
            verb: MODES[m.est.profile].verb,
            text: `${formatDistance(m.est.distanceM)} · ${m.est.range[0]}–${m.est.range[1]} min`,
          }
        : null,
    };
  }
  function refreshRouteUnits() {
    if (routeModel) routeModel = rebuildRouteText(routeModel);
    if (drawn) {
      drawn.model = rebuildRouteText(drawn.model);
      const c = drawn.model.cards[0];
      drawn.pill = `${c.route.replace(/ \(.*?\)/, '')} · ${MODES[drawn.model.req.profile].verb} ${c.metric}`;
    }
    drawRouteSection();
    renderPill();
  }
  /** Copy path summary (J5): no coordinates; a traveler as first name + initial. */
  async function copyPathSummary(model = routeModel, ep = null) {
    const d = ep || drawn?.ep || routeEndpoints();
    const card0 = model?.cards?.[0];
    if (!d || !card0) return false;
    const person =
      d.fix && routeTarget?.kind === 'person' ? routeTarget.label : null;
    const fromText = d.fix
      ? `${shortName(person || d.fromLabel.replace(/ \(.*$/, ''))}, ${d.fix.current ? `position as of ${clock(d.fix.atMs)}` : `last known position (${formatAge(d.fix.age)} old)`}`
      : d.fromLabel;
    const text = pathSummaryText({
      title: d.place?.category === 'hospital' ? 'Hospital run' : 'Path',
      stamp: stamp().replace(/^you · /, ''),
      from: fromText,
      to: `${d.toLabel}${d.place?.address ? `, ${d.place.address}` : ''}${d.place?.contact ? ` · ${d.place.contact}` : ''}`,
      toExtra: hospitalLines(d.place).filter(
        (l) => l !== d.place?.address && l !== d.place?.contact,
      ),
      shown: card0,
      other: model.other,
      simulated: simulationOn(),
    });
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  // The path pill (J6): the drawn path when its card is not open.
  const pill = document.createElement('div');
  pill.id = 'tt-path-pill';
  pill.className = 'tt-path-pill tt-panel';
  pill.hidden = true;
  document.body.append(pill);
  cleanups.push(() => pill.remove());
  function renderPill() {
    // Hidden while its card is open, the path card is open, or a copy is
    // being edited: each verb once on screen (review/phase9 O10).
    const show =
      Boolean(drawn) &&
      routeTarget?.key !== drawn.targetKey &&
      selection?.kind !== 'suggested' &&
      !document.body.classList.contains('tt-editing');
    pill.hidden = !show;
    if (!show) return;
    const mk = (label, fn, cls = 'tt-btn sm') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.addEventListener('click', () => fn(b));
      return b;
    };
    // The title opens the path card (review/phase9 O11).
    const open = mk(
      `Path: ${drawn.pill}`,
      () => {
        if (twin.drawnPaths?.source === 'route') selectSuggestedPath('primary');
      },
      'tt-link t',
    );
    open.title = 'Open the path card';
    pill.replaceChildren(
      open,
      mk('Frame path', () => twin.frameRoute()),
      mk('Copy path summary', async (b) => {
        const ok = drawn ? await copyPathSummary(drawn.model, drawn.ep) : false;
        b.textContent = ok ? 'Copied' : 'Copy failed';
      }),
      mk('Remove path', () => removePath()),
    );
  }
  /** Card for a clicked safety place (hospital, police, rally point, …). */
  function selectPlace(p) {
    placeSelecting = true;
    twin.select(null);
    placeSelecting = false;
    selection = { kind: 'place', place: p };
    const ll = { lat: p.coordinates.lat, lon: p.coordinates.lng };
    const label = SAFETY_LABEL[p.category] || p.category;
    setRouteTarget({
      key: `place:${p.id}`,
      kind: 'place',
      label: p.name || label,
      point: ll,
      place: p,
    });
    card.place(
      {
        kind: `${label.toUpperCase()}${p.approval_status !== 'active' ? ' · DRAFT · NOT APPROVED' : ''}`,
        name: p.name || label,
        lines: [
          [
            'lead',
            `${formatDistance(haversineM(sitePoint(), ll))} ${bearingLabel(sitePoint(), ll)} of ${city.short}`,
          ],
          ...(p.address ? [['', p.address]] : []),
          ...(p.contact ? [['', p.contact]] : []),
          ...(p.category === 'hospital'
            ? [
                [
                  '',
                  p.emergency === 'yes'
                    ? 'Emergency department listed in OpenStreetMap · not verified'
                    : 'Emergency department not listed in OpenStreetMap',
                ],
              ]
            : []),
          ...(p.chaperone_only ? [['', 'Chaperones only']] : []),
          [
            'foot',
            p.source === 'poi'
              ? 'OpenStreetMap place · not verified by SafeTrekr'
              : 'Trip safety point (sample)',
          ],
        ],
      },
      [routeNode],
    );
    $('tt-crumb-focus').textContent = `› ${p.name || label}`;
    syncPlaceHighlight();
  }

  // ---- advance mode (phase 3 Part B; review/phase3 G6–G9) ----
  let appMode = params.get('mode') === 'advance' ? 'advance' : 'live';
  const adv = {
    eventKey: null,
    met: {}, // siteKey → MET Norway json | null (loading) | 'error'
    checks: {}, // `${eventKey}:${item}` → "you · Thu 22:21 CDT"
    notes: {}, // eventKey → text
    pathFor: null, // event key whose hotel path is drawn
    pathText: {}, // event key → path summary while drawn
    sig: '',
  };
  const stamp = () =>
    `you · ${new Date().toLocaleString('en-US', {
      timeZone: city.timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    })}`;
  async function loadSiteForecast(site) {
    if (adv.met[site.key] !== undefined) return;
    adv.met[site.key] = null;
    try {
      const c = site.anchors?.inside || site.center;
      const res = await fetch(
        `/api/twin-weather/now?lat=${c.lat}&lon=${c.lon}`,
        { signal: abort.signal },
      );
      const json = await res.json();
      adv.met[site.key] = json.ok ? json.json : 'error';
    } catch {
      if (!abort.signal.aborted) adv.met[site.key] = 'error';
    }
    renderAdvance();
  }
  const advEvents = () =>
    lastCtx?.snapshot ? tripEvents(lastCtx.snapshot, SITES, city.timezone) : [];
  function briefFor(ev) {
    const site = SITES.find((x) => x.key === ev.siteKey);
    const op = validEntry(numberingEntries[site.key])
      ? numberingEntries[site.key]
      : null;
    loadSiteForecast(site);
    const drawn = adv.pathFor === ev.key && twin.hasRoute;
    const b = siteBrief({
      site,
      hotel: SITES[0],
      event: ev,
      snapshot: lastCtx.snapshot,
      pois: poisBySite[site.key] || [],
      metJson: adv.met[site.key],
      alerts: wx.warnings,
      alertsStatus: wx.warningsStatus,
      numbering: { mapped: site.levels != null, operator: op },
      useF,
      route: drawn
        ? typeof adv.pathText[ev.key] === 'function'
          ? adv.pathText[ev.key]()
          : adv.pathText[ev.key]
        : null,
      routeChecked: drawn,
      timeZone: city.timezone,
    });
    for (const it of b.items)
      it.checked = adv.checks[`${ev.key}:${it.key}`] || null;
    b.notes = adv.notes[ev.key] || '';
    // The stop's own saved walking path from the hotel answers "From the
    // hotel" (review/phase4 H18).
    const own = pathStore.paths.find(
      (x) =>
        x.profile === 'foot' &&
        (x.day == null || x.day === ev.day) &&
        x.siteKeys.includes(SITES[0].key) &&
        x.siteKeys.includes(site.key) &&
        site.key !== SITES[0].key,
    );
    const fromHotel = b.items.find((it) => it.key === 'from_hotel');
    if (own && fromHotel) {
      const r = reviewState(own, pathStore.areas, checksFor(own));
      fromHotel.text = `Saved walking path “${own.name}”: ${formatDistance(own.distanceM)} · ${avoidStatus(own, pathStore.areas).text || 'no avoid-area entered'} · ${r.text}`;
      fromHotel.ok = r.ok;
      fromHotel.warn = !r.ok;
    }
    b.savedLines = savedPathLines(pathStore.paths, {
      checks: checksFor,
      leg: (p) => legFor(p),
      day: ev.day,
      siteKey: site.key,
      areas: pathStore.areas,
    });
    return b;
  }
  async function pathFromHotel(ev, site) {
    const h = SITES[0].anchors.inside;
    const t = site.anchors.inside;
    adv.pathFor = ev.key;
    adv.pathText[ev.key] = 'Finding a suggested path…';
    renderAdvance();
    try {
      const paths = await planRouteSet(
        { lat: h.lat, lon: h.lon },
        { lat: t.lat, lon: t.lon },
        { profile: 'foot', signal: abort.signal, hazards: twin.hazardPoints() },
      );
      // One path on the map: the card path's pill and Copy go with it (O3).
      drawn = null;
      renderPill();
      twin.showRoute(paths, {
        fromLabel: SITES[0].short,
        toLabel: site.short,
        ends: {
          from: { lat: h.lat, lon: h.lon },
          to: { lat: t.lat, lon: t.lon },
        },
      });
      const p = paths[0];
      // Built at render so it follows Display › Units.
      adv.pathText[ev.key] = () =>
        `Walking path from ${SITES[0].short}: ${formatDistance(p.distanceM)} · ${p.walk[0]}–${p.walk[1]} min (group pace) · shown on the map · suggested, unverified`;
    } catch (error) {
      adv.pathText[ev.key] = `Path unavailable (${error?.message || error})`;
    }
    renderAdvance();
  }
  /** Clear the advance path (event change, Esc, mode switch). */
  function clearAdvancePath() {
    if (adv.pathFor) {
      twin.clearRoute();
      delete adv.pathText[adv.pathFor];
      adv.pathFor = null;
    }
  }
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  function liveStrip() {
    const m = lastCtx?.mode;
    if (!m) return null;
    const hot = m.mode === 'incident' || m.mode === 'incident_elsewhere';
    const b = el('button', `tt-adv-live${hot ? '' : ' calm'}`);
    b.type = 'button';
    b.textContent = hot
      ? `LIVE INCIDENT · ${m.topLine.split(' — ')[0]} — switch to Live`
      : `Live: ${m.chip.toLowerCase()}${m.degraded ? ' · data delayed' : ''} · ${m.topLine} — switch to Live`;
    b.addEventListener('click', () => setAppMode('live'));
    return b;
  }
  function renderAdvance(force = false) {
    const panel = $('tt-advance');
    if (appMode !== 'advance' || !lastCtx?.snapshot) return;
    const events = advEvents();
    if (!events.length) return;
    if (!events.some((e) => e.key === adv.eventKey)) {
      const here = events.find((e) => e.siteKey === siteKey);
      adv.eventKey = (here || events[0]).key;
    }
    const ev = events.find((e) => e.key === adv.eventKey);
    const brief = briefFor(ev);
    const site = brief.site;
    // Rebuild only when something visible changed (G7).
    const sig = JSON.stringify([
      ev.key,
      siteKey,
      events.map((e) => e.key),
      brief.items.map((i) => [i.text, i.checked, i.warn]),
      brief.savedLines.map((l) => l.text),
      lastCtx.mode?.topLine,
      lastCtx.mode?.mode,
    ]);
    if (!force && sig === adv.sig) return;
    adv.sig = sig;
    const scroll = panel.scrollTop;
    const focusKey = document.activeElement?.dataset?.focusKey || null;
    const live = liveStrip();
    const head = el(
      'div',
      'tt-topline advance',
      'Advance planning · no traveler positions shown',
    );
    const sub = el(
      'div',
      'tt-subline',
      `${lastCtx.snapshot.trips[0].title} · sample dates start today · times are ${city.timezone.split('/')[1].replace('_', ' ')} time`,
    );
    const scrub = el('div', 'tt-adv-scrub');
    const range = el('input');
    range.type = 'range';
    range.min = '0';
    range.max = String(events.length - 1);
    range.step = '1';
    range.value = String(events.indexOf(ev));
    range.dataset.focusKey = 'range';
    range.setAttribute('aria-label', 'Trip timeline');
    range.setAttribute(
      'aria-valuetext',
      `Day ${ev.day} · ${ev.start} · ${ev.title}`,
    );
    range.addEventListener('input', () =>
      selectEvent(events[Number(range.value)].key),
    );
    const list = el('ol', 'tt-adv-events');
    for (const e of events) {
      const li = el('li');
      const b = el('button', e.key === ev.key ? 'on' : '');
      b.type = 'button';
      b.dataset.focusKey = `ev:${e.key}`;
      b.append(
        el(
          'span',
          'num',
          `Day ${e.day} · ${e.start}${e.end ? `–${e.end}` : ''}`,
        ),
        el('span', 't', e.title),
      );
      b.addEventListener('click', () => selectEvent(e.key));
      li.append(b);
      list.append(li);
    }
    scrub.append(range, list);
    const box = el('section', 'tt-adv-brief');
    box.append(
      el('div', 'tt-kicker', `SITE BRIEF · DAY ${ev.day} · ${ev.start}`),
      el('div', 'tt-adv-title', site.label),
    );
    if (site.key !== siteKey)
      box.append(
        el(
          'div',
          'tt-adv-onscreen',
          `Not on screen · on screen: ${city.short}`,
        ),
      );
    const acts = el('div', 'tt-actions');
    if (site.key !== siteKey) {
      const go = el('button', 'tt-btn', `Switch to ${site.short}`);
      go.type = 'button';
      go.dataset.focusKey = 'go';
      go.addEventListener('click', () => switchSite(site.key));
      acts.append(go);
    }
    if (site.key !== SITES[0].key) {
      const drawn = adv.pathFor === ev.key && twin.hasRoute;
      const r = el(
        'button',
        'tt-btn',
        drawn ? 'Remove walking path' : `Show walking path`,
      );
      r.type = 'button';
      r.dataset.focusKey = 'path';
      r.addEventListener('click', () => {
        if (drawn) {
          clearAdvancePath();
          renderAdvance(true);
        } else pathFromHotel(ev, site);
      });
      // The hotel path as its own labelled section (review/phase5 J15).
      const pathSec = el('div', 'tt-adv-pathsec');
      pathSec.append(el('div', 'tt-kicker', `PATH FROM ${SITES[0].short}`), r);
      // Phase 4: turn the suggested path into the operator's own.
      const h = SITES[0].anchors.inside;
      const t = site.anchors.inside;
      const e2 = el('button', 'tt-link', 'Plan your own path');
      e2.type = 'button';
      e2.dataset.focusKey = 'plan';
      e2.addEventListener('click', () => {
        clearAdvancePath();
        pathEditor.start({
          from: { lat: h.lat, lon: h.lon },
          to: { lat: t.lat, lon: t.lon },
          fromLabel: SITES[0].short,
          toLabel: site.short,
          profile: 'foot',
          day: ev.day,
        });
      });
      const or = el('span', 'tt-or');
      or.append('or ', e2);
      pathSec.append(or);
      box.append(acts, pathSec);
    } else box.append(acts);
    box.append(
      el(
        'div',
        'tt-kicker tt-adv-checks-k',
        'CHECKS · tick each when reviewed',
      ),
    );
    const items = el('ul', 'tt-adv-items');
    for (const it of brief.items) {
      const li = el('li', it.warn ? 'warn' : it.ok ? 'ok' : '');
      const lab = el('label', 'tt-adv-check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = Boolean(it.checked);
      cb.dataset.focusKey = `chk:${it.key}`;
      cb.setAttribute('aria-label', `Reviewed: ${it.label}`);
      cb.addEventListener('change', () => {
        const k = `${ev.key}:${it.key}`;
        if (cb.checked) adv.checks[k] = stamp();
        else delete adv.checks[k];
        renderAdvance(true);
      });
      lab.append(cb, el('span', 'tt-adv-label', it.label));
      li.append(lab, el('div', 'tt-adv-text', it.text));
      if (it.checked)
        li.append(el('div', 'tt-dim tt-adv-by', `Reviewed by ${it.checked}`));
      items.append(li);
    }
    box.append(items);
    // Saved paths for this day touching this stop (phase 4 Part D).
    const savedLines = brief.savedLines;
    const sv = el('section', 'tt-adv-saved');
    sv.append(
      el(
        'div',
        'tt-kicker',
        `SAVED PATHS · DAY ${ev.day} · ${savedLines.length}`,
      ),
    );
    if (!savedLines.length)
      sv.append(el('div', 'tt-note', 'None saved for this stop yet.'));
    const sul = el('ul');
    for (const l of savedLines) {
      const li = el('li', l.warn ? 'warn' : '');
      const open = el('button', 'tt-link', l.text);
      open.type = 'button';
      open.addEventListener('click', () => selectSaved(l.id));
      li.append(open);
      sul.append(li);
    }
    sv.append(sul);
    box.append(sv);
    const notes = el('textarea', 'tt-adv-notes');
    notes.placeholder = 'Notes for this stop (session only)';
    notes.value = brief.notes;
    notes.dataset.focusKey = 'notes';
    notes.setAttribute('aria-label', `Notes for ${ev.title}`);
    notes.addEventListener('input', () => (adv.notes[ev.key] = notes.value));
    box.append(notes);
    const copy = el(
      'button',
      'tt-btn primary',
      `Copy Day ${ev.day} brief (draft)`,
    );
    copy.type = 'button';
    copy.dataset.focusKey = 'copy';
    copy.addEventListener('click', async () => {
      const dayBriefs = events.filter((e) => e.day === ev.day).map(briefFor);
      try {
        await navigator.clipboard.writeText(
          briefText(dayBriefs, {
            trip: lastCtx.snapshot.trips[0].title,
            day: ev.day,
            asOf: stamp().replace(/^you · /, ''),
            simulated: wx.sim.rain || wx.sim.snow || wx.sim.lightning,
            alertSource: WX.warnings === 'nws' ? 'NWS' : 'MeteoAlarm',
          }),
        );
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Copy failed';
      }
      setTimeout(
        () => (copy.textContent = `Copy Day ${ev.day} brief (draft)`),
        1600,
      );
    });
    const foot = el('div', 'tt-adv-foot');
    foot.append(
      copy,
      el(
        'div',
        'tt-note',
        'Reviews and notes are kept for this session only (prototype).',
      ),
    );
    panel.replaceChildren(...(live ? [live] : []), head, sub, scrub, box, foot);
    panel.scrollTop = scroll;
    if (focusKey)
      panel
        .querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)
        ?.focus();
    renderWeather();
  }
  function selectEvent(key) {
    if (adv.eventKey === key) return;
    clearAdvancePath();
    adv.eventKey = key;
    renderAdvance(true);
    renderCustom();
    syncAdvanceWeather();
  }
  /** Advance: the 3D weather follows the picked event's time (phase 6). */
  function syncAdvanceWeather() {
    const ev = advEvents().find((e) => e.key === adv.eventKey);
    const last = wx.steps[wx.steps.length - 1];
    const ok =
      appMode === 'advance' &&
      ev?.epoch &&
      last &&
      ev.epoch >= Date.now() - 3600e3 &&
      ev.epoch < last.t + (last.stepH || 1) * 3600e3;
    wx.at = ok ? ev.epoch : null;
    renderWeather();
  }
  /** The scrubbed event's forecast, for the weather chip in Advance. */
  function advanceChipParts() {
    const ev = advEvents().find((e) => e.key === adv.eventKey);
    if (!ev) return null;
    const met = adv.met[ev.siteKey];
    if (!met || met === 'error') return null;
    const end = ev.end ? zonedToEpoch(ev.date, ev.end, city.timezone) : null;
    const fc = forecastWindow(met, ev.epoch, end);
    // Beyond the forecast range: say so, never "loading" (review/phase6 L10).
    if (!fc)
      return {
        live: `Day ${ev.day} ${ev.start}`,
        temp: '—',
        condition:
          ev.epoch < Date.now() - 3600e3
            ? 'event time has passed'
            : 'beyond the forecast range',
        source: 'MET Norway site forecast',
      };
    return {
      live: `Day ${ev.day} ${ev.start}`,
      temp: useF ? `${fahrenheit(fc.tempC)} °F` : `${Math.round(fc.tempC)} °C`,
      condition: fc.condition,
      source: `Day ${ev.day} ${ev.start} · MET Norway`,
    };
  }
  function applyAppMode() {
    const advance = appMode === 'advance';
    document.body.classList.toggle('tt-advance-mode', advance);
    $('tt-advance').hidden = !advance;
    for (const b of document.querySelectorAll('#tt-appmode button'))
      b.setAttribute('aria-pressed', String(b.dataset.mode === appMode));
    twin.setPeopleVisible(!advance);
    $('tt-report-btn').disabled = advance;
    $('tt-report-btn').title = advance
      ? 'Reports are live data — switch to Live'
      : '';
    const m = lastCtx?.mode;
    const hot = m && (m.mode === 'incident' || m.mode === 'incident_elsewhere');
    const alert = $('tt-live-alert');
    alert.hidden = !(advance && hot);
    if (advance) {
      const chip = $('tt-mode');
      chip.textContent = 'PLANNING';
      chip.className = 'tt-mode advance';
      $('tt-age').textContent = '';
      renderAdvance();
    }
  }
  function setAppMode(next, { confirmed = false } = {}) {
    if (next === appMode) return;
    if (pathEditor.blockIfDirty('switch to ' + next)) return;
    // Advance clears paths and selections: ask during a live incident (5b).
    if (next === 'advance' && !confirmed && liveIncidentHere())
      return confirmToast(
        `Incident at ${city.short} — switch to Advance planning? Paths and the selection here are cleared; the incident stays in the Live strip.`,
        'Switch to Advance',
        () => setAppMode('advance', { confirmed: true }),
        'Stay in Live',
      );
    appMode = next;
    const q = new URLSearchParams(location.search);
    if (appMode === 'advance') q.set('mode', 'advance');
    else q.delete('mode');
    history.replaceState(null, '', `?${q}`);
    // Paths and person cards belong to the mode they were opened in.
    clearAdvancePath();
    clearRoute();
    if (appMode === 'advance') {
      if (selection?.kind === 'person' || selection?.kind === 'place')
        twin.select(null);
      clearFloorFocus();
    } else twin.refresh();
    adv.sig = '';
    applyAppMode();
    syncAdvanceWeather();
    if (isHotelSel()) showBuilding(selection.geom);
    renderSites();
    renderBeacons();
    renderWeather();
  }
  for (const b of document.querySelectorAll('#tt-appmode button'))
    b.addEventListener('click', () => setAppMode(b.dataset.mode));
  $('tt-live-alert').addEventListener('click', () => setAppMode('live'));

  // ---- custom paths (phase 4): saved paths, avoid-areas, editor ----
  // Stored per trip and site, so two trips never share paths (phase 4
  // deferred). The old per-site key is moved over once.
  const storeKey = `paths.${TRIP_ID}.${cityKey}`;
  if (
    pref(storeKey, null) === null &&
    pref(`paths.${cityKey}`, null) !== null
  ) {
    save(storeKey, pref(`paths.${cityKey}`, '{}'));
    try {
      localStorage.removeItem(`tripTwin.paths.${cityKey}`);
    } catch {
      /* per-viewer convenience only */
    }
  }
  const pathStore = loadStore(pref(storeKey, '{}'));
  const persistPaths = () => save(storeKey, JSON.stringify(pathStore));
  // Undo for deletes: one toast, the last delete only, 10 s.
  const toast = document.createElement('div');
  toast.id = 'tt-toast';
  toast.className = 'tt-toast tt-panel';
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  document.body.append(toast);
  let toastTimer = null;
  /** A one-line question with an action and Stay (no modal). */
  let toastReturn = null;
  function dismissToast() {
    clearTimeout(toastTimer);
    toast.hidden = true;
    delete toast.dataset.ask;
    toast.setAttribute('role', 'status');
    toast.removeAttribute('aria-label');
    if (toast.contains(document.activeElement)) toastReturn?.focus?.();
  }
  function confirmToast(text, okLabel, onOk, stayLabel = 'Stay') {
    clearTimeout(toastTimer);
    toastReturn = document.activeElement;
    toast.dataset.ask = '1';
    toast.setAttribute('role', 'alertdialog');
    toast.setAttribute('aria-label', text);
    const t = document.createElement('span');
    t.textContent = text;
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'tt-btn';
    ok.textContent = okLabel;
    ok.addEventListener('click', () => {
      dismissToast();
      onOk();
    });
    const stay = document.createElement('button');
    stay.type = 'button';
    stay.className = 'tt-btn primary';
    stay.textContent = stayLabel;
    stay.addEventListener('click', dismissToast);
    toast.replaceChildren(t, stay, ok);
    toast.hidden = false;
    stay.focus();
    // No answer in 15 s counts as Stay.
    toastTimer = setTimeout(dismissToast, 15000);
  }
  /** A one-line notice in the toast slot (no action), 8 s. */
  function offerNotice(text) {
    clearTimeout(toastTimer);
    delete toast.dataset.ask;
    const t = document.createElement('span');
    t.textContent = text;
    toast.replaceChildren(t);
    toast.hidden = false;
    toastTimer = setTimeout(() => (toast.hidden = true), 8000);
  }
  function offerUndo(text, undo) {
    clearTimeout(toastTimer);
    delete toast.dataset.ask;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tt-btn';
    b.textContent = 'Undo';
    b.addEventListener('click', () => {
      toast.hidden = true;
      undo();
    });
    const t = document.createElement('span');
    t.textContent = text;
    toast.replaceChildren(t, b);
    toast.hidden = false;
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 10000);
  }
  cleanups.push(() => {
    clearTimeout(toastTimer);
    toast.remove();
  });
  const afterStoreChange = () => {
    persistPaths();
    renderCustom();
    renderLayers();
    adv.sig = '';
    renderAdvance();
  };
  const customVis = { saved: true, avoid: true };
  let customLayer = null;
  let selectedSavedId = null;
  function currentAdvanceDay() {
    return advEvents().find((e) => e.key === adv.eventKey)?.day ?? null;
  }
  /** Trip day of today (sample trips start today, so Day 1). */
  function todayDay() {
    const start = lastCtx?.snapshot?.trips?.[0]?.start_date;
    if (!start) return 1;
    const today = Date.parse(new Date().toISOString().slice(0, 10));
    return Math.floor((today - Date.parse(start)) / 86400000) + 1;
  }
  /** Live shows today's saved paths; Advance the selected day (H14). */
  const shownDay = () =>
    appMode === 'advance' ? currentAdvanceDay() : todayDay();
  function renderCustom() {
    if (!customLayer) return;
    customLayer.drawAreas(pathStore.areas, { show: customVis.avoid });
    const day = shownDay();
    const shown = customVis.saved
      ? pathStore.paths.filter(
          (p) => day == null || p.day == null || p.day === day,
        )
      : [];
    customLayer.drawSaved(shown, {
      selectedId: selectedSavedId,
      areas: pathStore.areas,
    });
    syncSuggestionFade(shown);
  }
  /** A saved path on the map with the same ends fades the suggestion (Jesse). */
  function syncSuggestionFade(shown = null) {
    const day = shownDay();
    const list =
      shown ||
      (customVis.saved
        ? pathStore.paths.filter(
            (p) => day == null || p.day == null || p.day === day,
          )
        : []);
    const ends = twin.drawnPaths?.ends;
    const covering = list.find((p) => coversEnds(p, ends)) || null;
    fadedBy = covering;
    twin.setSuggestionFaded?.(Boolean(covering));
  }
  let fadedBy = null; // the saved path that fades the drawn suggestion
  const firesUnavailable = () =>
    !['live', 'stale', 'simulated'].includes(lastCtx?.fires?.status || 'live');
  /** Every check for a saved path, re-run on display (H5/H6). */
  const checksFor = (p) =>
    pathChecks(
      {
        ...p,
        endpointAreas: pathStore.areas.filter((a) =>
          (p.endpointAreaIds || []).includes(a.id),
        ),
      },
      {
        points: p.points,
        areas: pathStore.areas,
        hazards: twin.hazardPoints(),
        hazardsStatus: firesUnavailable() ? 'unavailable' : 'ok',
        dark: isDark(p.day),
        day: p.day,
        profile: p.profile,
        leg: legFor(p),
      },
    );
  /** Out / back leg timing for a path tied to an event (phase 4 deferred). */
  function legFor(p, durationS = p.durationS) {
    if (!p.eventKey || !p.leg) return null;
    const e = advEvents().find((x) => x.key === p.eventKey);
    if (!e?.epoch) return null;
    const site = SITES.find((x) => x.key === e.siteKey);
    const c = site?.anchors?.inside || site?.center || city.center;
    const { set } = sunTimes(e.date, c.lat, c.lon ?? c.lng);
    return legWindow({
      leg: p.leg,
      event: {
        title: e.title,
        startMs: e.epoch,
        endMs: e.end ? zonedToEpoch(e.date, e.end, city.timezone) : NaN,
      },
      durationS,
      sunsetMs: set ?? NaN,
      fmt: (ms) =>
        new Date(ms).toLocaleTimeString('en-GB', {
          timeZone: city.timezone,
          hour: '2-digit',
          minute: '2-digit',
        }),
    });
  }
  /** Sites within 300 m of a path's ends (so the brief can list it). */
  const siteKeysFor = (points) =>
    SITES.filter((x) => {
      const c = x.anchors?.inside || x.center;
      return [points[0], points[points.length - 1]].some(
        (p) => haversineM(p, c) <= 300,
      );
    }).map((x) => x.key);
  /** Walking after sunset on that day (any stop ending after dark). */
  function isDark(day) {
    if (day == null) return false;
    return advEvents()
      .filter((e) => e.day === day && e.epoch)
      .some((e) => {
        const site = SITES.find((x) => x.key === e.siteKey);
        const c = site.anchors?.inside || site.center;
        const end = e.end
          ? zonedToEpoch(e.date, e.end, city.timezone)
          : e.epoch;
        const { set } = sunTimes(e.date, c.lat, c.lon);
        return set && end > set;
      });
  }
  // Street names for waypoints: the site's own streets first, then a
  // cached reverse lookup through the dev proxy (phase 4 deferred).
  const placeNames = new Map();
  function placeName(pt, onLoad) {
    const local = nearestStreet(pt, twin.site?.roads || []);
    if (local) return waypointText(pt, local);
    const key = `${pt.lat.toFixed(4)},${pt.lon.toFixed(4)}`;
    if (placeNames.has(key)) return placeNames.get(key);
    placeNames.set(key, null);
    fetch(`/api/twin-place?lat=${pt.lat}&lon=${pt.lon}`, {
      signal: abort.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) return;
        placeNames.set(key, `near ${j.name}`);
        onLoad?.();
      })
      .catch(() => {});
    return null;
  }
  const viaText = (p, onLoad) =>
    p.points
      .slice(1, -1)
      .map(
        (wp, i) =>
          `${i + 1}: ${placeName(wp, onLoad) || `${wp.lat.toFixed(5)}, ${wp.lon.toFixed(5)}`}`,
      )
      .join(' · ');
  const pathEditor = createPathEditor({
    twin,
    placeName,
    layer: () => customLayer,
    panel: $('tt-editor'),
    banner: $('tt-edit-banner'),
    store: pathStore,
    persist: persistPaths,
    hazards: () => twin.hazardPoints(),
    days: () =>
      [...new Set(advEvents().map((e) => e.day))].map((d) => ({
        day: d,
        label: `Day ${d}`,
      })),
    events: (day) =>
      advEvents()
        .filter((e) => e.day === day && e.epoch)
        .map((e) => ({ key: e.key, title: e.title, start: e.start })),
    legFor,
    siteKeysFor,
    stamp,
    isDark,
    hazardsStatus: () => (firesUnavailable() ? 'unavailable' : 'ok'),
    onCrumb: (t) => ($('tt-crumb-focus').textContent = t),
    onClose: (saved) => {
      $('tt-crumb-focus').textContent = '';
      const from = copiedFrom;
      copiedFrom = null;
      renderPill();
      // Discarding a copy goes back to the path it came from (UX 5).
      if (!saved && from && twin.drawnPaths?.id === from.setId) {
        renderCustom();
        renderLayers();
        return selectSuggestedPath(from.kind);
      }
      if (saved) selectedSavedId = saved.id;
      renderCustom();
      renderLayers();
      if (saved) selectSaved(saved.id);
      adv.sig = '';
      renderAdvance();
    },
  });
  // Delete / remove ask once (a second click within 4 s confirms).
  let confirmKey = null;
  let confirmTimer = null;
  const confirmOnce = (key, run, b, label) => {
    if (confirmKey === key) {
      clearTimeout(confirmTimer);
      confirmKey = null;
      return run();
    }
    confirmKey = key;
    b.textContent = `${label} — click again to confirm`;
    b.classList.add('confirm');
    confirmTimer = setTimeout(() => {
      confirmKey = null;
      b.textContent = label;
      b.classList.remove('confirm');
    }, 4000);
  };
  const actBtn = (text, onClick, cls = 'tt-btn') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', () => onClick(b));
    return b;
  };
  // ---- Phase 9: the drawn suggested-path card (review/phase9 O1–O15) ----
  const PTH03 =
    'OSM street path · not checked for closures, crowds, lighting, crime or damage';
  /** Main / Alternate when two are drawn; none for a single path (O9). */
  const rankOf = (set, kind) =>
    set.paths.filter((p) => p.kind !== 'unavailable').length < 2
      ? null
      : kind === 'alternate'
        ? 'alternate'
        : 'main';
  /** "Emi S. · position at 21:31 · 4 min old", read live from the fix (O2). */
  function fixText(name, fix) {
    if (!fix || !Number.isFinite(fix.atMs))
      return `${name} · position time unknown`;
    return `${name} · ${fix.current ? 'position' : 'last known position'} at ${clock(fix.atMs)} · ${formatAge((Date.now() - fix.atMs) / 1000)} old`;
  }
  const fixOld = (fix) =>
    !fix ||
    !fix.current ||
    !Number.isFinite(fix.atMs) ||
    Date.now() - fix.atMs > 300000;
  /** The card a card route came from: the path card is its child (O12). */
  function pathParent() {
    const key = drawn?.targetKey || '';
    const i = key.indexOf(':');
    const kind = key.slice(0, i);
    const id = key.slice(i + 1);
    const label = drawn?.targetLabel || '';
    const short = (t) => (t.length > 28 ? `${t.slice(0, 27).trim()}…` : t);
    if (kind === 'person')
      return {
        label: shortName(label),
        open: () => twin.selectPerson(id),
      };
    if (kind === 'place') {
      const p = (lastCtx?.snapshot?.safety_points || []).find(
        (x) => x.id === id,
      );
      return p ? { label: short(label), open: () => selectPlace(p) } : null;
    }
    if (kind === 'building')
      return { label: short(label), open: () => twin.select(id) };
    return null;
  }
  /** "Emi has moved since this path was planned" — while the card is open. */
  function staleFor(set) {
    if (!set.fromPerson || !set.fix || !set.personId) return '';
    const row = (lastA?.rows || []).find((r) => r.person.id === set.personId);
    const now = personFix(row);
    if (!now) return '';
    const name = firstName(row.person.name);
    if (haversineM(now, set.fix) > 50)
      return `${name} has moved since this path was planned`;
    if (
      Number.isFinite(now.atMs) &&
      Number.isFinite(set.fix.atMs) &&
      now.atMs - set.fix.atMs >= 120000
    )
      return `${name} has a newer position than this path`;
    return '';
  }
  /** The same checks as the editor and saved paths, on the true ends (O4, O5). */
  function suggestedChecks(set, p, profile) {
    const g = p.geometry;
    const ends = set.ends || { from: g[0], to: g[g.length - 1] };
    const inside = pathStore.areas.filter((a) =>
      [ends.from, ends.to].some((pt) => haversineM(pt, a.center) <= a.radiusM),
    );
    const live = appMode !== 'advance';
    const now = lastCtx?.snapshot ? sampleClock(lastCtx.snapshot) : '';
    const day = live ? null : currentAdvanceDay();
    return pathChecks(
      {
        geometry: g,
        distanceM: p.distanceM,
        avoidApplied: true,
        endpointAreas: inside,
      },
      {
        points: [ends.from, ends.to],
        areas: pathStore.areas,
        hazards: twin.hazardPoints(),
        hazardsStatus: firesUnavailable() ? 'unavailable' : 'ok',
        profile,
        day,
        dark: !live && isDark(day),
        // Live: the sample clock now, not the schedule (SUP 6).
        leg: live
          ? {
              dark: Boolean(lastCtx?.night),
              darkText: lastCtx?.night
                ? `After dark now (${now} local) — lighting not checked`
                : `Daylight now (${now} local)`,
            }
          : null,
      },
    );
  }
  /** Copy path summary for exactly this path (O3). */
  async function copySuggested(set, p) {
    const profile = p.profile || 'foot';
    const c = routeCards(
      [p],
      { profile, fromLabel: set.fromLabel, toLabel: set.toLabel },
      {
        areas: pathStore.areas,
        pace: profile === 'foot' ? lastCtx?.weather?.pace : null,
        simulatedFires: lastCtx?.fires?.simulated,
      },
    )[0];
    const rank = rankOf(set, p.kind);
    const text = pathSummaryText({
      title: `${rank === 'alternate' ? 'Alternate path' : rank === 'main' ? 'Main path' : 'Path'}${set.source === 'rally' ? ' to Rally point (primary)' : ''}`,
      stamp: stamp().replace(/^you · /, ''),
      from: set.fromPerson
        ? `${shortName(set.fromLabel)}, ${set.fix?.current ? `position as of ${clock(set.fix.atMs)}` : `last known position (${set.fix ? formatAge((Date.now() - set.fix.atMs) / 1000) : 'time unknown'} old)`}`
        : set.fromLabel,
      to: `${set.toLabel}${set.toName ? ` · ${set.toName}` : ''}`,
      toExtra: [],
      // The same flags the card shows (review/phase9 O3, O4).
      shown: {
        ...c,
        warnings: suggestedChecks(set, p, profile)
          .filter((f) => f.warn)
          .map((f) => f.text),
      },
      other: null,
      simulated: simulationOn(),
    });
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  let pathCardKey = '';
  // A polite live region for selections made off the map (SUP 9).
  const live = document.createElement('div');
  live.setAttribute('aria-live', 'polite');
  live.className = 'tt-sr';
  document.body.append(live);
  cleanups.push(() => live.remove());
  const announce = (t) => {
    live.textContent = '';
    setTimeout(() => (live.textContent = t), 30);
  };
  /** Close the path card; say why when the line changed under it (O1). */
  function closePathCard(why = null) {
    if (selection?.kind !== 'suggested') return;
    selection = null;
    pathCardKey = '';
    twin.setPathSelected(null);
    syncPlaceHighlight();
    card.hide();
    $('tt-crumb-focus').textContent = '';
    renderPill();
    if (why) offerNotice(why);
  }
  function onDrawnPathsChange(id) {
    if (id != null) syncSuggestionFade();
    if (selection?.kind === 'suggested' && selection.setId !== id)
      closePathCard(
        id == null
          ? 'That path is no longer on the map — card closed'
          : 'That path was replaced — card closed',
      );
    renderLayers(); // a no-op while Layers is closed
  }
  /** Back to the card the path came from, the path still drawn (O12). */
  function backToParent() {
    const parent = selection?.parent;
    closePathCard();
    parent?.open();
  }
  /**
   * Card for a drawn suggested path: what it is, where it starts (and how
   * old that is), the checks, then "Edit a copy of this path".
   */
  function selectSuggestedPath(kind, { frame = false, focus = false } = {}) {
    const set = twin.drawnPaths;
    const p = set?.paths.find((x) => x.kind === kind);
    if (!p || p.kind === 'unavailable') return;
    const parent = set.source === 'route' ? pathParent() : null;
    // Release a card plan still in flight, as a saved-path card does (O1).
    releaseCard();
    placeSelecting = true;
    twin.select(null);
    placeSelecting = false;
    selection = { kind: 'suggested', setId: set.id, pathKind: kind, parent };
    syncPlaceHighlight();
    twin.setPathSelected(kind);
    if (frame) twin.frameGeometry(p.geometry);
    pathCardKey = '';
    renderPathCard();
    renderPill();
    renderLayers(); // a no-op while Layers is closed
    if (focus) {
      const n = $('tt-card').querySelector('.tt-card-name');
      n?.setAttribute('tabindex', '-1');
      n?.focus();
    }
    announce(
      `${rankOf(set, kind) === 'alternate' ? 'Alternate' : rankOf(set, kind) === 'main' ? 'Main' : 'Suggested'} path selected, ${formatDistance(p.distanceM)}`,
    );
  }
  /** (Re)build the open path card; keyed, so a tick re-renders only on change. */
  function renderPathCard() {
    const sel = selection;
    if (sel?.kind !== 'suggested') return;
    const set = twin.drawnPaths;
    if (!set || set.id !== sel.setId)
      return closePathCard('That path is no longer on the map — card closed');
    const p = set.paths.find((x) => x.kind === sel.pathKind);
    if (!p) return closePathCard();
    const profile = p.profile || 'foot';
    const rank = rankOf(set, sel.pathKind);
    const c = routeCards(
      [p],
      { profile, fromLabel: set.fromLabel, toLabel: set.toLabel },
      {
        areas: pathStore.areas,
        pace: profile === 'foot' ? lastCtx?.weather?.pace : null,
        simulatedFires: lastCtx?.fires?.simulated,
      },
    )[0];
    const checks = suggestedChecks(set, p, profile);
    const person = set.fromPerson;
    const fromName = person ? shortName(set.fromLabel) : set.fromLabel;
    const lines = [];
    if (person) {
      const old = fixOld(set.fix);
      lines.push([
        old ? 'tt-age-old' : '',
        `Start: ${fixText(fromName, set.fix)}`,
      ]);
      if (old)
        lines.push([
          'tt-edit-flag',
          'Not a current position — the traveler may not be there now',
        ]);
      const stale = staleFor(set);
      if (stale)
        lines.push([
          'tt-edit-flag',
          `${stale} · open their card to plan from now`,
        ]);
    }
    const via = pathVia(p.geometry, twin.site?.roads || []);
    if (via.length) lines.push(['', `Via ${via.join(', ')}`]);
    for (const f of checks.filter((x) => !x.warn))
      lines.push(['tt-edit-info', f.text]);
    if (!checks.some((x) => x.warn))
      lines.push([
        'tt-dim',
        'Checks: none raised (not a verification of the path)',
      ]);
    for (const n of c.notes.filter((t) => /^Shares|rain: allow/i.test(t)))
      lines.push(['', n.replace('the primary path', 'the main path')]);
    const other = set.paths.find(
      (x) => x.kind !== sel.pathKind && x.kind !== 'unavailable',
    );
    if (other) {
      const d = other.distanceM - p.distanceM;
      lines.push([
        '',
        `${other.kind === 'alternate' ? 'Alternate' : 'Main'}: ${formatDistance(other.distanceM)} (${d >= 0 ? '+' : '−'}${formatDistance(Math.abs(d))})`,
      ]);
    }
    if (profile === 'car')
      lines.push(['', 'No traffic, parking or drop-off checked']);
    if (set.faded && fadedBy)
      lines.push([
        'tt-edit-info',
        `Drawn faded: the saved path “${fadedBy.name}” has the same start and end`,
      ]);
    lines.push(['', PTH03]);
    lines.push([
      'foot',
      `Planned ${clock(set.plannedAt)} · OSRM (OpenStreetMap data)${set.source === 'rally' ? ' · automatically to Rally point (primary)' : ''}`,
    ]);
    const result = {
      metric: `${profile === 'car' ? 'Drive' : 'Walk'} · ${c.metric}`,
      metricNote: c.metricNote,
      warnings: checks.filter((x) => x.warn).map((x) => x.text),
      notes: [],
      flagged: checks.some((x) => x.warn),
    };
    const info = {
      kind: rank
        ? `SUGGESTED · ${rank.toUpperCase()} · UNVERIFIED`
        : 'SUGGESTED PATH · UNVERIFIED',
      name: `${fromName} → ${set.toLabel}${set.toName ? ` · ${set.toName}` : ''}`,
      lines,
    };
    const key = JSON.stringify([info, result, sel.parent?.label, set.id]);
    if (key === pathCardKey && !$('tt-card').hidden) return;
    pathCardKey = key;
    const acts = document.createElement('div');
    acts.className = 'tt-actions tt-saved-acts';
    acts.append(
      actBtn(
        person ? 'Edit a copy (live only)' : 'Edit a copy of this path',
        () => editSuggestedCopy(set, p),
        'tt-btn primary',
      ),
      actBtn('Frame path', () => twin.frameGeometry(p.geometry)),
    );
    const links = document.createElement('div');
    links.className = 'tt-path-links';
    const copy = actBtn(
      'Copy path summary',
      async (b) => {
        const now = twin.drawnPaths;
        const ok = now?.id === set.id ? await copySuggested(set, p) : false;
        b.textContent = ok ? 'Copied' : 'Copy failed';
      },
      'tt-link',
    );
    links.append(copy);
    if (set.source === 'route')
      links.append(actBtn('Remove path', () => removePath(), 'tt-link'));
    const bottom = [acts, links];
    if (set.source === 'rally')
      bottom.push(
        Object.assign(document.createElement('div'), {
          className: 'tt-card-line foot',
          textContent:
            'Shown while a primary rally point is set · hide in Layers › Paths › Suggested paths',
        }),
      );
    if (person)
      bottom.unshift(
        Object.assign(document.createElement('div'), {
          className: 'tt-card-line tt-edit-info',
          textContent: 'Starts at a traveler’s position: a copy can’t be saved',
        }),
      );
    card.path(info, {
      top: [resultEl(result)],
      back: sel.parent
        ? { label: `‹ ${sel.parent.label}`, onClick: backToParent }
        : null,
      bottom,
    });
    $('tt-crumb-focus').textContent = sel.parent
      ? `› ${sel.parent.label} › Suggested path`
      : `› Suggested path${rank ? ` · ${rank}` : ''}`;
  }
  /** "Edit a copy of this path": the editor opens on this exact line (O13). */
  let copiedFrom = null;
  function editSuggestedCopy(set, p) {
    const g = p.geometry;
    const ends = set.ends || { from: g[0], to: g[g.length - 1] };
    const via = pathVia(g, twin.site?.roads || [])[0];
    const rank = rankOf(set, p.kind);
    copiedFrom = { setId: set.id, kind: p.kind };
    twin.setPathSelected(null);
    selection = null;
    pathCardKey = '';
    card.hide();
    pathEditor.start({
      from: ends.from,
      to: ends.to,
      points: [ends.from, ...seedWaypoints(g), ends.to],
      fromLabel: set.fromPerson ? 'a traveler’s position' : set.fromLabel,
      toLabel: set.toLabel,
      fromPerson: set.fromPerson,
      startText: set.fromPerson
        ? () => fixText(shortName(set.fromLabel), set.fix)
        : null,
      // Never the suggestion's own name (review/phase9 O14).
      name: set.fromPerson
        ? undefined
        : `${defaultName(set)} · ${via ? `via ${via}` : `planned ${clock(Date.now())}`}`.slice(
            0,
            80,
          ),
      origin: {
        kind: 'suggested',
        rank: rank || 'main',
        engine: 'OSRM',
        distanceM: p.distanceM,
        plannedAt: set.plannedAt,
      },
      profile: p.profile || 'foot',
      // The standing rally path applies every day (review/phase9 UX 9).
      day:
        set.source === 'rally'
          ? null
          : appMode === 'advance'
            ? currentAdvanceDay()
            : todayDay(),
      original: {
        geometry: g,
        distanceM: p.distanceM,
        durationS: p.durationS ?? null,
      },
    });
    renderPill();
  }
  /** Card for a saved path: edit, duplicate, review, delete. */
  function selectSaved(id) {
    const p = pathStore.paths.find((x) => x.id === id);
    if (!p) return;
    placeSelecting = true;
    twin.select(null);
    placeSelecting = false;
    releaseCard();
    selection = { kind: 'saved', id };
    syncPlaceHighlight();
    selectedSavedId = id;
    renderCustom();
    const flags = checksFor(p);
    const st = avoidStatus(p, pathStore.areas);
    const review = reviewState(p, pathStore.areas, flags);
    const open = flags.filter((f) => f.warn);
    const acts = document.createElement('div');
    acts.className = 'tt-actions tt-saved-acts';
    acts.append(
      actBtn(
        'Edit saved path',
        () => pathEditor.start({ saved: p }),
        'tt-btn primary',
      ),
      actBtn('Duplicate', () =>
        pathEditor.start({
          saved: { ...p, id: null, name: `${p.name} (copy)` },
        }),
      ),
      actBtn('Frame path', () => twin.frameGeometry(p.geometry)),
      ...(p.leg === 'back'
        ? []
        : [
            actBtn('Plan return leg', () =>
              pathEditor.start({
                saved: {
                  ...p,
                  id: null,
                  name: `${p.toLabel} → ${p.fromLabel}`.slice(0, 60),
                  points: [...p.points].reverse(),
                  fromLabel: p.toLabel,
                  toLabel: p.fromLabel,
                  leg: p.eventKey ? 'back' : null,
                  reviewedBy: null,
                },
              }),
            ),
          ]),
      actBtn(
        review.ok
          ? 'Mark not reviewed'
          : open.length
            ? `Mark reviewed (${open.length} open flag${open.length > 1 ? 's' : ''})`
            : 'Mark reviewed',
        (b) => {
          const apply = () => {
            if (review.ok) {
              p.reviewedBy = null;
              p.reviewedStatus = undefined;
            } else {
              p.reviewedBy = stamp();
              p.reviewedStatus = reviewSignature(p, pathStore.areas, flags);
            }
            persistPaths();
            selectSaved(id);
            adv.sig = '';
            renderAdvance();
          };
          // Reviewing with open flags asks once (H5).
          if (!review.ok && open.length)
            confirmOnce(`rev:${id}`, apply, b, b.textContent);
          else apply();
        },
      ),
    );
    // Chaperone sharing (phase 4 deferred): reviewed paths only, copied
    // as text — nothing is sent from the prototype.
    const share = actBtn('Copy for chaperones', async (b) => {
      const text = chaperoneShareText(p, {
        review,
        leg: legFor(p),
        via: p.points.length > 2 ? viaText(p) : '',
        flags,
        areas: pathStore.areas,
      });
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        p.sharedBy = stamp();
        persistPaths();
        selectSaved(id);
      } catch {
        b.textContent = 'Copy failed — clipboard blocked';
      }
    });
    share.disabled = !review.ok;
    share.title = review.ok
      ? 'Copies a summary for a chaperone message (prototype · not sent)'
      : 'Review the path first — only reviewed paths are shared';
    acts.append(share);
    const danger = document.createElement('div');
    danger.className = 'tt-actions tt-danger-row';
    danger.append(
      actBtn(
        'Delete saved path',
        (b) =>
          confirmOnce(
            `del:${id}`,
            () => {
              const at = pathStore.paths.indexOf(p);
              pathStore.paths = pathStore.paths.filter((x) => x.id !== id);
              selectedSavedId = null;
              selection = null;
              card.hide();
              afterStoreChange();
              offerUndo(`Deleted saved path “${p.name}”`, () => {
                pathStore.paths.splice(at, 0, p);
                afterStoreChange();
                selectSaved(p.id);
              });
            },
            b,
            'Delete saved path',
          ),
        'tt-btn destructive',
      ),
    );
    card.place(
      {
        kind: `SAVED PATH · ${review.ok ? 'REVIEWED' : review.text.toUpperCase()}`,
        name: p.name,
        lines: [
          [
            'lead',
            `${p.day ? `Day ${p.day}` : 'Any day'} · ${p.profile === 'car' ? 'drive' : 'walk'} · ${formatDistance(p.distanceM)} · ${p.profile === 'car' ? 'drive time from the router' : 'group pace'}`,
          ],
          ...(legFor(p) ? [['', legFor(p).text]] : []),
          ...(p.points.length > 2
            ? [
                [
                  '',
                  `Via ${viaText(p, () => {
                    if (selection?.kind === 'saved' && selection.id === id)
                      selectSaved(id);
                  })}`,
                ],
              ]
            : []),
          ...(st.text ? [[st.warn ? 'tt-edit-flag' : '', st.text]] : []),
          ...flags
            .filter((f) => !/^avoid/.test(f.key))
            .map((f) => [f.warn ? 'tt-edit-flag' : 'tt-dim', f.text]),
          ...(p.notes ? [['', `Notes: ${p.notes}`]] : []),
          // Where a copy began (review/phase9 O14).
          ...(p.origin?.kind === 'suggested'
            ? [
                [
                  'tt-dim',
                  `Started from the suggested path (${p.origin.rank}) · ${p.origin.engine} · ${formatDistance(p.origin.distanceM)}${Number.isFinite(p.origin.plannedAt) ? ` · planned ${clock(p.origin.plannedAt)}` : ''}`,
                ],
              ]
            : []),
          [
            'tt-dim',
            `Saved by ${p.savedBy}${p.reviewedBy ? ` · ${review.text}` : ''}`,
          ],
          ...(p.sharedBy
            ? [
                [
                  review.ok ? 'tt-dim' : 'tt-edit-flag',
                  `Copied for chaperones by ${p.sharedBy} (prototype · not sent)${review.ok ? '' : ' · the review is out of date since then — share again after a new review'}`,
                ],
              ]
            : []),
          [
            'tt-dim',
            p.engine === 'valhalla'
              ? 'Suggested by Valhalla (FOSSGIS) · unverified · a review is a check, not an approval'
              : p.origin?.kind === 'suggested'
                ? 'The suggested path as drawn (OSRM) · avoid-areas checked, not applied · unverified'
                : 'Suggested by OSRM (fallback) · avoid-areas checked, not applied · unverified',
          ],
        ],
      },
      [acts, danger],
    );
    $('tt-crumb-focus').textContent = `› Saved path: ${p.name}`;
  }
  function selectArea(id) {
    const a = pathStore.areas.find((x) => x.id === id);
    if (!a) return;
    placeSelecting = true;
    twin.select(null);
    placeSelecting = false;
    releaseCard();
    selection = { kind: 'area', id };
    syncPlaceHighlight();
    const used = pathStore.paths.filter((p) => p.areaIds.includes(id));
    const acts = document.createElement('div');
    acts.className = 'tt-actions';
    acts.append(
      actBtn(
        'Remove avoid-area',
        (b) =>
          confirmOnce(
            `area:${id}`,
            () => {
              const at = pathStore.areas.indexOf(a);
              pathStore.areas = pathStore.areas.filter((x) => x.id !== id);
              selection = null;
              card.hide();
              afterStoreChange();
              offerUndo(`Removed avoid-area (${areaLabel(a)})`, () => {
                pathStore.areas.splice(at, 0, a);
                afterStoreChange();
                selectArea(a.id);
              });
            },
            b,
            'Remove avoid-area',
          ),
        'tt-btn destructive',
      ),
    );
    card.place(
      {
        kind: 'AVOID-AREA · WHOLE TRIP',
        name: areaLabel(a),
        lines: [
          [
            '',
            `Applies to every path planned on this trip${used.length ? ` · used by ${used.length} saved path${used.length > 1 ? 's' : ''}` : ''}`,
          ],
          ['tt-dim', `Added by ${a.addedBy}`],
        ],
      },
      [acts],
    );
  }

  // QA hooks (prototype harness only).
  window.tripTwinPage = {
    selectPlace: (id) => {
      const p = (lastCtx?.snapshot?.safety_points || []).find(
        (x) => x.id === id || x.category === id,
      );
      if (p?.coordinates) selectPlace(p);
      return Boolean(p);
    },
    switchSite: (key) => switchSite(key),
    selectPerson: (id) => twin.selectPerson(id, { frame: true }),
    drawnPaths: () => twin.drawnPaths,
    dataSources: () =>
      Array.from({ length: viewer.dataSources.length }, (_, i) =>
        viewer.dataSources.get(i),
      ).map((d) => `${d.name}:${d.entities.values.length}`),
  };

  // ---- compass (phase 3 Part D): north always readable; click a side ----
  const compass = createCompass({
    onView: (h) => twin.viewFromSide(h),
    onNorthUp: () => twin.viewFromSide(0),
  });
  document.body.append(compass.el);
  const onPostRender = () => compass.update(twin.headingDeg);
  viewer.scene.postRender.addEventListener(onPostRender);
  cleanups.push(() =>
    viewer.scene.postRender.removeEventListener(onPostRender),
  );
  compass.update(twin.headingDeg);

  // ---- "Ways out" view (phase 7; review/phase7 M1–M4) ----
  // Adds and emphasises, never hides: streets, walkways, buildings, places,
  // suggested and saved paths and avoid-areas on; the scene steps back.
  // Never touches floors, hazards, weather or the weather time. Leaving
  // restores only the layers the operator did not touch.
  const WAYS_KEYS = [
    'streets',
    'walkways',
    'buildings',
    'safety',
    'paths',
    'savedPaths',
    'avoidAreas',
  ];
  let waysOut = null; // {saved, touched}
  function viewLayer(key) {
    if (key === 'context') return twin.context.ring;
    if (key === 'corridors') return twin.context.corridors;
    if (key === 'streets' || key === 'walkways') return twin.streets[key];
    if (key === 'savedPaths') return customVis.saved;
    if (key === 'avoidAreas') return customVis.avoid;
    return twin.layers[key];
  }
  function setViewLayer(key, on) {
    if (key === 'context' || key === 'corridors')
      return twin.setContext({
        [key === 'context' ? 'ring' : 'corridors']: on,
      });
    if (key === 'streets' || key === 'walkways')
      return twin.setStreets({ [key]: on });
    if (key === 'savedPaths' || key === 'avoidAreas') {
      customVis[key === 'savedPaths' ? 'saved' : 'avoid'] = on;
      return renderCustom();
    }
    twin.setLayer(key, on);
  }
  function setWaysOutUi() {
    const on = Boolean(waysOut);
    const b = $('tt-waysout-btn');
    b.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('tt-waysout', on);
    twin.setHotelStepBack(on);
    syncContextDim();
    renderWaysTag();
    renderLayers();
  }
  /** The wider area steps back in Ways out and during an incident; in an
   * incident the strip toward the hospital stays (review/phase8 N3). */
  function syncContextDim() {
    const incident = lastCtx?.mode?.mode === 'incident';
    twin.setContextDim?.(Boolean(waysOut) || incident, {
      keep: incident ? 'hospital' : null,
    });
  }
  /** The always-on set (again after an incident arrives). */
  function applyWaysOut() {
    for (const k of WAYS_KEYS) setViewLayer(k, true);
  }
  function enterWaysOut() {
    waysOut = {
      saved: Object.fromEntries(WAYS_KEYS.map((k) => [k, viewLayer(k)])),
      touched: new Set(),
    };
    applyWaysOut();
    setWaysOutUi();
  }
  function exitWaysOut({ keep = false } = {}) {
    const v = waysOut;
    if (!v) return;
    waysOut = null;
    if (!keep)
      for (const k of WAYS_KEYS)
        if (!v.touched.has(k)) setViewLayer(k, v.saved[k]);
    setWaysOutUi();
    return v;
  }
  function toggleWaysOut() {
    if (waysOut) exitWaysOut();
    else enterWaysOut();
  }
  /** A layer changed by hand while the view is on. */
  function waysOutTouched(key, on) {
    if (!waysOut || !WAYS_KEYS.includes(key)) return;
    waysOut.touched.add(key);
    // Turning off what the view is made of ends it, keeping your layers.
    if (!on && ['streets', 'walkways', 'buildings'].includes(key)) {
      const v = exitWaysOut({ keep: true });
      offerUndo('Ways out ended — your layer change kept', () => {
        for (const k of WAYS_KEYS) setViewLayer(k, v.saved[k]);
        renderLayers();
      });
      const undo = $('tt-toast').querySelector('.tt-btn');
      if (undo) undo.textContent = 'Back to my layers';
    }
  }
  // In-map tag while the view is on: what it is, where the data comes from,
  // what it does not know (review/phase7 M2). Never on the mode chip.
  const waysTag = document.createElement('div');
  waysTag.className = 'tt-ways-tag';
  waysTag.setAttribute('role', 'status');
  waysTag.hidden = true;
  document.body.append(waysTag);
  cleanups.push(() => waysTag.remove());
  function renderWaysTag() {
    waysTag.hidden = !waysOut;
    if (!waysOut) return;
    const c = twin.streets.counts;
    const recorded = twin.site?.osmFetchedAt
      ? new Date(twin.site.osmFetchedAt).toISOString().slice(0, 10)
      : '';
    const t = document.createElement('div');
    t.className = 'k';
    t.textContent = 'WAYS OUT VIEW';
    const d = document.createElement('div');
    d.textContent = `Streets and walkways from OpenStreetMap${recorded ? ` (recorded ${recorded})` : ''}, not checked for closures, locked gates or private access · beyond the detailed area only main streets are drawn${c ? ` · ${c.hotelDoors ? `${c.hotelDoors} mapped entrance${c.hotelDoors > 1 ? 's' : ''} at the hotel` : 'no entrances mapped at the hotel'} · fire exits are not mapped` : ''} · W or Esc returns`;
    waysTag.replaceChildren(t, d);
    if (lastCtx?.mode?.mode === 'incident') {
      const i = document.createElement('div');
      i.className = 'inside';
      i.textContent =
        'Inside the building: follow hotel staff and the posted evacuation plan.';
      waysTag.append(i);
    }
  }
  $('tt-waysout-btn').addEventListener('click', () => toggleWaysOut());
  $('tt-incident').addEventListener('click', (e) => {
    if (e.target.closest?.('.tt-ways-btn') && !waysOut) enterWaysOut();
    // Incident path titles open the path card (review/phase9 O9).
    const po = e.target.closest?.('.tt-path-open');
    if (po) {
      if (twin.drawnPaths?.source === 'rally')
        selectSuggestedPath(po.dataset.kind, { focus: true });
      else
        offerNotice(
          'Another path is drawn now · remove it to see the rally paths',
        );
    }
  });
  /** Popover header: title, key hint, close (review/phase5 J8). */
  function popHead(title, key) {
    const h = document.createElement('div');
    h.className = 'tt-pop-head';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = title;
    if (key) {
      const k = document.createElement('span');
      k.className = 'kbd';
      k.textContent = key;
      t.append(k);
    }
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'tt-x';
    x.textContent = '×';
    x.setAttribute('aria-label', `Close ${title}`);
    x.addEventListener('click', () => closePops({ restoreFocus: true }));
    h.append(t, x);
    return h;
  }
  function lockGlyph() {
    const s = document.createElement('span');
    s.className = 'tt-lock';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML =
      '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    return s;
  }
  $('tt-display').prepend(popHead('Display', 'D'));
  // ---- Layers: the five groups (06 §2.2); each row that is on shows its key ----
  // A function so legend distances follow Display › Units (phase 5b).
  const keys = () => ({
    people: [
      ['', '#eff7f3', 'Live / stopped · current'],
      ['dash', '#f59e0b', 'Aging'],
      ['dot', '#9aa8ac', 'Last known'],
    ],
    floors: [
      ['', '#eff7f3', 'Likely floor range'],
      ['dash', '#eff7f3', 'Rough range'],
      ['', '#ee7789', 'Reported floor'],
    ],
    // Sensor resolution stays as the source publishes it (review/phase5b IA F1).
    fires: [['', '#ee7789', 'Heat detection (375 m pixel)']],
    safety: [
      ['', '#4ba467', 'Approved place'],
      ['dash', '#9aa8ac', 'Draft · not approved'],
    ],
    paths: [
      ['', '#3b82f6', 'Suggested path'],
      ['dash', '#3b82f6', 'Alternate'],
      ['dash', '#f59e0b', `Within ${formatRadius(1000)} of a heat detection`],
    ],
    buildings: [['', '#80959b', 'Mapped height · fainter = approximate']],
    grid: [],
    savedPaths: [
      ['dash', '#93bafa', 'Saved path (long dash)'],
      ['note', '', 'Planned by an operator · Advance shows the selected day'],
    ],
    avoidAreas: [
      ['', '#f59e0b', 'Avoid-area · applies to every path on this trip'],
    ],
    elevation: [['', '#80959b', 'Contour · relative to hotel street level']],
    streets: [
      ['thick', '#eff7f3', 'Major street'],
      ['', '#b8c3c7', 'Minor street'],
      ['thin', '#9aa8ac', 'Alley or service road'],
      ['thick', '#415e6b', 'No walking (motorway, private)'],
      [
        'note',
        '',
        'OpenStreetMap · not checked for closures, locked gates or private access · tunnels not drawn',
      ],
    ],
    context: [
      [
        '',
        '#415e6b',
        'Plain buildings and main streets beyond the detailed area',
      ],
      [
        'note',
        '',
        twin.context.status === 'ready'
          ? twin.context.counts.ringHere
            ? `Out to ${formatRadius(twin.context.counts.ringM)} from the hotel · ${twin.context.counts.ringBuildings} buildings · OpenStreetMap, recorded ${String(twin.context.fetchedAt || '').slice(0, 10)} · no details on click · unmapped heights drawn low and fainter (not a measurement)`
            : `Recorded around the hotel, not this venue · only the strip toward this venue is drawn here`
          : twin.context.status === 'loading'
            ? 'Loading the wider area…'
            : 'Wider area not available for this site — not drawn',
      ],
    ],
    corridors: [
      [
        '',
        '#415e6b',
        'More buildings and streets toward each venue and the hospital',
      ],
      [
        'note',
        '',
        twin.context.status === 'ready'
          ? `Toward ${twin.context.counts.strips.join(', ') || 'no places recorded'} · map detail only, not a path · about ${formatRadius(150)} either side of a recorded walk`
          : 'Map detail only, not a path',
      ],
    ],
    walkways: [
      ['thin', '#b8c3c7', 'Walkway · pedestrian area'],
      ['stairs', '#e3e7e9', 'Steps'],
      ['door', '#eff7f3', 'Mapped entrance (OSM, unverified)'],
      [
        'note',
        '',
        'Sidewalks are part of the street · fire exits are not mapped',
      ],
    ],
  });
  const GROUPS = [
    [
      'People',
      [
        ['people', 'Travelers & chaperones', true],
        ['floors', 'Floor estimates', false],
      ],
    ],
    [
      'Hazards',
      [
        ['incidents', 'Reported incidents', true],
        ['fires', 'Satellite heat detections', false],
      ],
    ],
    ['Safety', [['safety', 'Safety resources', false]]],
    [
      'Paths',
      [
        ['paths', 'Suggested paths', false],
        ['savedPaths', 'Saved paths', false],
        ['avoidAreas', 'Avoid-areas', false],
      ],
    ],
    [
      'Site',
      [
        ['hotel', 'Hotel', true],
        ['buildings', 'Surrounding buildings', false],
        ['streets', 'Streets', false],
        ['walkways', 'Walkways, steps & entrances', false],
        ['#beyond', 'Beyond the detailed area', false],
        ['context', 'Wider area', false],
        ['corridors', 'Toward venues & hospital', false],
        ['grid', 'Scale grid', false],
        ['elevation', 'Elevation contours', false],
      ],
    ],
  ];
  function renderLayers() {
    if ($('tt-layers').hidden) return;
    const state = {
      ...twin.layers,
      grid: ground.grid,
      elevation: ground.contours,
      savedPaths: customVis.saved,
      avoidAreas: customVis.avoid,
      streets: twin.streets.streets,
      walkways: twin.streets.walkways,
      context: twin.context.ring,
      corridors: twin.context.corridors,
    };
    const root = $('tt-layers');
    const scroll = root.scrollTop;
    root.replaceChildren(popHead('Layers', 'L'));
    // Views (phase 7): a named preset over the layers below.
    {
      const g = document.createElement('div');
      g.className = 'tt-layer-group';
      const gh = document.createElement('div');
      gh.className = 'tt-kicker';
      gh.textContent = 'Views';
      const row = document.createElement('label');
      row.className = 'tt-layer-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = Boolean(waysOut);
      box.addEventListener('change', () => toggleWaysOut());
      const lab = document.createElement('span');
      lab.className = 'lab';
      lab.textContent = 'Ways out';
      const k = document.createElement('span');
      k.className = 'kbd';
      k.textContent = 'W';
      row.append(box, lab, k);
      const note = document.createElement('div');
      note.className = 'tt-key';
      const n = document.createElement('span');
      n.className = 'tt-key-note';
      n.textContent =
        'Turns on streets, walkways, places, paths and avoid-areas; the scene steps back. Floors and hazards stay as they are.';
      note.append(n);
      g.append(gh, row, note);
      root.append(g);
    }
    for (const [group, rows] of GROUPS) {
      const g = document.createElement('div');
      g.className = 'tt-layer-group';
      const gh = document.createElement('div');
      gh.className = 'tt-kicker';
      gh.textContent = group;
      g.append(gh);
      for (const [key, label, locked] of rows) {
        if (key.startsWith('#')) {
          const h = document.createElement('div');
          h.className = 'tt-key-note tt-onmap-h';
          h.textContent = label;
          g.append(h);
          continue;
        }
        const on = locked ? true : state[key];
        const row = document.createElement(locked ? 'div' : 'label');
        row.className = `tt-layer-row${locked ? ' locked' : ''}`;
        // A locked layer shows a lock, not a disabled checkbox (J8).
        const box = locked ? lockGlyph() : document.createElement('input');
        if (!locked) box.type = 'checkbox';
        box.checked = on;
        box.addEventListener('change', () => {
          if (key === 'grid' || key === 'elevation') {
            ground[key === 'grid' ? 'grid' : 'contours'] = box.checked;
            applyGround();
          } else if (key === 'context' || key === 'corridors') {
            twin.setContext({
              [key === 'context' ? 'ring' : 'corridors']: box.checked,
            });
            waysOutTouched(key, box.checked);
          } else if (key === 'streets' || key === 'walkways') {
            twin.setStreets({ [key]: box.checked });
            waysOutTouched(key, box.checked);
          } else if (key === 'savedPaths' || key === 'avoidAreas') {
            customVis[key === 'savedPaths' ? 'saved' : 'avoid'] = box.checked;
            renderCustom();
            waysOutTouched(key, box.checked);
          } else {
            twin.setLayer(key, box.checked);
            waysOutTouched(key, box.checked);
          }
          renderLayers();
        });
        const lab = document.createElement('span');
        lab.className = 'lab';
        lab.textContent = label;
        row.append(box, lab);
        if (locked) {
          const l = document.createElement('span');
          l.className = 'lock';
          l.textContent = 'always shown';
          row.append(l);
        }
        g.append(row);
        // Legends hang under their toggle; notes come after them (J8).
        const KEY = keys();
        if (on && KEY[key]) {
          const k = document.createElement('div');
          k.className = 'tt-key';
          const notes = [];
          for (const [style, color, text] of KEY[key]) {
            if (style === 'note') {
              notes.push(text);
              continue;
            }
            const item = document.createElement('span');
            const sw = document.createElement('span');
            sw.className = `tt-swatch ${style}`;
            sw.style.color = color;
            item.append(sw, document.createTextNode(text));
            k.append(item);
          }
          for (const t of notes) {
            const n = document.createElement('span');
            n.className = 'tt-key-note';
            n.textContent = t;
            k.append(n);
          }
          g.append(k);
        }
        if (on && (key === 'grid' || key === 'elevation'))
          g.append(groundOption(key));
      }
      if (group === 'Hazards') g.append(weatherGroup());
      if (group === 'Paths') g.append(onMapIndex(), savedIndex());
      if (group === 'Site') {
        // One pointer to the global units (review/phase5b IA F8).
        const u = document.createElement('button');
        u.type = 'button';
        u.className = 'tt-link tt-units-link';
        u.textContent = `Units: ${{ m: 'meters and kilometers', ft: 'feet and miles', yd: 'yards and miles' }[ground.unit]} · change in Display (D)`;
        u.addEventListener('click', () => openPop('tt-display'));
        g.append(u);
      }
      root.append(g);
    }
    root.scrollTop = scroll;
  }

  /**
   * Layers › Paths › SUGGESTED · DRAWN NOW (review/phase9 O11): each drawn
   * suggested path, with origin and mode, opening its card.
   */
  function onMapIndex() {
    const box = document.createElement('div');
    const set = twin.drawnPaths;
    const list = (set?.paths || []).filter((p) => p.kind !== 'unavailable');
    const h = document.createElement('div');
    h.className = 'tt-kicker tt-drawn-k';
    h.textContent = `SUGGESTED · DRAWN NOW · ${list.length}`;
    box.append(h);
    if (!list.length) {
      const n = document.createElement('div');
      n.className = 'tt-index-empty';
      n.textContent =
        'No suggested path drawn · open a person, place or site card to find one';
      box.append(n);
      return box;
    }
    const from = set.fromPerson ? shortName(set.fromLabel) : set.fromLabel;
    for (const p of list) {
      const rank = rankOf(set, p.kind);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tt-link tt-index-row tt-drawn-row';
      const cur =
        selection?.kind === 'suggested' &&
        selection.setId === set.id &&
        selection.pathKind === p.kind;
      if (cur) b.setAttribute('aria-current', 'true');
      const sw = document.createElement('span');
      sw.className = `sw${p.kind === 'alternate' ? ' alt' : ''}`;
      const tx = document.createElement('span');
      tx.className = 'tx';
      tx.textContent = `${rank === 'alternate' ? 'Alternate' : rank === 'main' ? 'Main' : 'Suggested'} · ${from} → ${set.toLabel}${set.faded ? ' · faded (saved path)' : ''}${cur ? ' · selected' : ''}`;
      const d = document.createElement('span');
      d.className = 'd';
      d.textContent = `${(p.profile || 'foot') === 'car' ? 'drive' : 'walk'} ${formatDistance(p.distanceM)}`;
      b.append(sw, tx, d);
      b.addEventListener('click', () => {
        closePops();
        selectSuggestedPath(p.kind, { frame: true, focus: true });
      });
      box.append(b);
    }
    return box;
  }
  /** Layers › Paths index: every saved path by day, every avoid-area (H16). */
  /** Saved paths and avoid-areas as two summaries, not one line (O11). */
  function savedIndex() {
    const frag = document.createDocumentFragment();
    const sub = (key, title, n, fill) => {
      const d = document.createElement('details');
      d.className = `tt-layer-sub${n ? '' : ' empty'}`;
      d.open = Boolean(savedIndex[key]);
      d.addEventListener('toggle', () => (savedIndex[key] = d.open));
      const sm = document.createElement('summary');
      sm.textContent = `${title} · ${n}`;
      d.append(sm);
      fill(d);
      frag.append(d);
    };
    sub('saved', 'SAVED ON THIS TRIP', pathStore.paths.length, (d) => {
      const days = [...new Set(pathStore.paths.map((p) => p.day ?? 0))].sort(
        (a, b) => a - b,
      );
      for (const day of days) {
        const h = document.createElement('div');
        h.className = 'tt-key';
        h.textContent = day
          ? `Day ${day}${day === todayDay() ? ' (today)' : ''}`
          : 'Any day';
        d.append(h);
        for (const p of pathStore.paths.filter((x) => (x.day ?? 0) === day)) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'tt-link tt-index-row';
          const r = reviewState(p, pathStore.areas, checksFor(p));
          b.textContent = `${p.name} · ${p.profile === 'car' ? 'drive' : 'walk'} · ${r.ok ? 'reviewed' : 'not reviewed'}`;
          if (selection?.kind === 'saved' && selection.id === p.id)
            b.setAttribute('aria-current', 'true');
          b.addEventListener('click', () => {
            closePops();
            selectSaved(p.id);
          });
          d.append(b);
        }
      }
      if (!pathStore.paths.length) {
        const n = document.createElement('div');
        n.className = 'tt-index-empty';
        n.textContent =
          'None yet · edit a copy of a suggested path, or plan your own from a place card or the Advance brief';
        d.append(n);
      }
    });
    sub('areas', 'AVOID-AREAS', pathStore.areas.length, (d) => {
      for (const a of pathStore.areas) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tt-link tt-index-row';
        b.textContent = `${areaLabel(a)} · whole trip`;
        b.addEventListener('click', () => {
          closePops();
          selectArea(a.id);
        });
        d.append(b);
      }
      if (!pathStore.areas.length) {
        const n = document.createElement('div');
        n.className = 'tt-index-empty';
        n.textContent = 'None yet · add one while planning a path (X)';
        d.append(n);
      }
    });
    return frag;
  }

  // ---- Weather (phase 2): free / open sources, off by default ----
  const region = city.timezone.startsWith('America') ? 'us' : 'eu';
  // Temperature unit: Display › Units › Temperature; default by region.
  let useF = pref('tempUnit', region === 'us' ? 'F' : 'C') === 'F';
  const WX = weatherSources(region);
  let wxBox = boxAround(city.center);
  // Lightning is fetched over the 10 km watch distance plus one grid cell, so
  // the rule can see everything it is checking (review/phase2 F12).
  const ltgBoxFor = (c) =>
    boxAround(c, 2 * (LIGHTNING_WATCH_KM + (WX.lightning?.gridKm || 0)));
  let ltgBox = ltgBoxFor(city.center);
  const boxFor = (key) => (key === 'lightning' ? ltgBox : wxBox);
  const wx = {
    layers: {
      lightning: false,
      precip: false,
      totals: false,
      clouds: false,
      fx: false,
    },
    steps: [], // MET Norway timeseries (phase 6)
    at: null, // timeline time (ms) or null = now
    open: false,
    summary: null,
    status: 'loading',
    fetchedAt: null,
    warnings: [],
    warningsStatus: 'loading',
    images: {},
    imageAt: {},
    imageErr: {},
    sim: {
      lightning: params.get('lightning') === '1',
      rain: params.get('rain') === '1',
      snow: params.get('snow') === '1',
    },
  };
  let wxLayer = null;
  let fxLayer = null;
  let timeline = null; // created below (phase 6)
  const hhmm = (iso) =>
    iso
      ? new Date(iso).toLocaleTimeString('en-GB', {
          timeZone: city.timezone,
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
  /** Real weather time with its zone and, when not today, its day. */
  const wxTime = (ms) => {
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms);
    const day = (x) =>
      x.toLocaleDateString('en-GB', {
        timeZone: city.timezone,
        weekday: 'short',
      });
    const zone =
      d
        .toLocaleTimeString('en-US', {
          timeZone: city.timezone,
          timeZoneName: 'short',
        })
        .split(' ')
        .pop() || '';
    return `${day(d) !== day(new Date()) ? `${day(d)} ` : ''}${hhmm(d.toISOString())} ${zone}`;
  };
  const wxSummary = () =>
    wx.sim.snow
      ? {
          ...simulatedRain(wx.summary),
          tempC: -1,
          apparentC: -4,
          precipMmH: 0.9,
          condition: 'snow',
        }
      : wx.sim.rain
        ? simulatedRain(wx.summary)
        : wx.summary;
  async function loadWeatherNow() {
    try {
      const res = await fetch(
        `/api/twin-weather/now?lat=${city.center.lat}&lon=${city.center.lon ?? city.center.lng}`,
        { signal: abort.signal },
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      wx.summary = summarizeMet(json.json);
      wx.steps = metSteps(json.json);
      if (appMode === 'advance') syncAdvanceWeather();
      wx.fetchedAt = json.fetchedAt;
      wx.status = 'live';
    } catch (error) {
      if (abort.signal.aborted) return;
      wx.status = 'unavailable';
      console.warn('[TripTwin] weather now unavailable', error?.message);
    }
    renderWeather();
  }
  async function loadWarnings() {
    try {
      if (WX.warnings === 'nws') {
        const res = await fetch(
          `https://api.weather.gov/alerts/active?point=${city.center.lat.toFixed(4)},${(city.center.lon ?? city.center.lng).toFixed(4)}`,
          { signal: abort.signal, headers: { Accept: 'application/geo+json' } },
        );
        if (!res.ok) throw new Error(`NWS HTTP ${res.status}`);
        wx.warnings = parseNwsAlerts(await res.json());
      } else {
        const res = await fetch(
          '/api/twin-weather/warnings?country=uk&area=london',
          { signal: abort.signal },
        );
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);
        wx.warnings = json.entries.map((e) => ({ ...e, source: 'MeteoAlarm' }));
      }
      wx.warningsStatus = 'live';
      wx.warningsAt = Date.now();
    } catch (error) {
      if (abort.signal.aborted) return;
      wx.warningsStatus = 'unavailable';
      console.warn('[TripTwin] official warnings unavailable', error?.message);
    }
    renderWeather();
  }
  async function ensureImage(key) {
    const src = WX[key];
    if (!src || wx.images[key] || wx.imageErr[key] === 'loading') return;
    wx.imageErr[key] = 'loading';
    try {
      wx.images[key] = await loadWeatherImage(src, boxFor(key), {
        signal: abort.signal,
        rgb: key === 'lightning' ? [238, 119, 137] : undefined,
      });
      wx.imageAt[key] = new Date().toISOString();
      wx.imageErr[key] = null;
    } catch (error) {
      if (abort.signal.aborted) return;
      wx.imageErr[key] = 'unavailable';
      console.warn(
        `[TripTwin] weather image ${key} unavailable`,
        error?.message,
      );
    }
    drawWeather();
    twin.refresh?.();
  }
  /** Points for the lightning rule: simulated strikes, else density cells. */
  function strikes() {
    if (wx.sim.lightning) return simulatedStrikes(city.center);
    const img = wx.images.lightning;
    return img ? cellsToPoints(img.cells, ltgBox) : [];
  }
  let lastWatchCenter = null;
  const wxLabel = (key) => {
    if (key === 'precip' && wx.sim.rain) return 'SIMULATED rain (prototype)';
    if (key === 'lightning' && wx.at != null)
      return 'Lightning is drawn for now only · the lightning check stays live in the rail';
    if (key === 'lightning' && wx.sim.lightning)
      return 'SIMULATED lightning (prototype)';
    const src = WX[key];
    if (!src) return '';
    return `${src.label}${wx.imageAt[key] ? ` · fetched ${hhmm(wx.imageAt[key])}` : ''}`;
  };
  /** The forecast step for the timeline time (or now), simulated or real. */
  function fxStep() {
    if (wx.sim.snow)
      return {
        precipMmH: 0.9,
        tempC: -1,
        symbol: 'snow',
        cloud: { low: 90, mid: 70, high: 30 },
        fogPct: 8,
        windMs: 3,
        windFromDeg: 300,
        simulated: 'snow',
      };
    if (wx.sim.rain)
      return {
        precipMmH: 4.2,
        tempC: 12,
        symbol: 'rain',
        cloud: { low: 85, mid: 70, high: 40 },
        fogPct: 0,
        windMs: 5,
        windFromDeg: 200,
        simulated: 'rain',
      };
    if (wx.at != null && wx.at < Date.now() - 15 * 60e3) return null;
    return stepAt(wx.steps, wx.at ?? Date.now());
  }
  const fxReduced = () =>
    $('tt-reduce-motion').checked ||
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Radar over the site, for where particles fall (null = not in use). */
  /**
   * Where precipitation is over the site, from the map frame for the
   * timeline time (review/phase6 L2): {state: covered | clear | widespread |
   * loading | missing, fn, sig, label} — or null when the map layer is off.
   */
  function radarCover() {
    if (!wx.layers.precip || wx.sim.rain || wx.sim.snow) return null;
    const f = wx.at != null ? frameAt(wx.at) : null;
    const kindLabel =
      f?.src?.kind === 'model'
        ? 'the forecast map'
        : region === 'us'
          ? 'radar'
          : `the satellite estimate${wx.at == null && wx.imageAt.precip ? ` (fetched ${hhmm(wx.imageAt.precip)}, about 1 h behind)` : ''}`;
    const base = {
      label: kindLabel,
      sig: wx.at != null ? `f${f?.ft}` : `${wx.imageAt.precip}`,
    };
    const img =
      wx.at != null ? (f?.status === 'ok' ? f.img : null) : wx.images.precip;
    if (wx.at != null && (!f || f.status === 'missing'))
      return { ...base, state: 'missing' };
    if (
      wx.at != null ? f.status === 'loading' : wx.imageErr.precip === 'loading'
    )
      return { ...base, state: 'loading' };
    if (!img)
      return {
        ...base,
        state: wx.imageErr.precip === 'unavailable' ? 'missing' : 'loading',
      };
    if (img.noData) return { ...base, state: 'widespread', fn: () => true };
    const c = { lat: city.center.lat, lon: city.center.lon ?? city.center.lng };
    const fn = coverageFromCanvas(img.canvas, wxBox, c);
    const R = Math.max(350, twin.site?.radius || 500);
    let any = false;
    for (let x = -R; x <= R && !any; x += R / 8)
      for (let y = -R; y <= R && !any; y += R / 8)
        if (x * x + y * y <= R * R && fn(x, y)) any = true;
    return { ...base, state: any ? 'covered' : 'clear', fn };
  }
  let fxText = '';
  function drawFx() {
    if (!fxLayer) return;
    const step = fxStep();
    let kind = precipKind(step);
    const radar = radarCover();
    const at = step?.t ? wxTime(step.t) : '';
    const placed = !radar || ['covered', 'widespread'].includes(radar.state);
    // Radar showing precipitation over the site wins over a dry forecast.
    const radarOnly = !kind && radar && placed;
    if (radarOnly) kind = 'rain';
    fxText = !radar
      ? precipRowText({
          step,
          kind,
          radar: null,
          simulated: step?.simulated,
          at,
        })
      : radar.state === 'loading'
        ? `${radar.label} frame loading — rain and snow not placed yet`
        : radar.state === 'missing'
          ? `No ${radar.label} frame for this time — rain and snow not placed`
          : radarOnly
            ? `Precipitation on ${radar.label} over the site · type not forecast (shown as rain)`
            : radar.state === 'widespread'
              ? `${precipRowText({ step, kind, radar: { covered: true, label: radar.label }, at })} · widespread on the map`
              : precipRowText({
                  step,
                  kind,
                  radar: {
                    covered: radar.state === 'covered',
                    label: radar.label,
                  },
                  at,
                });
    const falling =
      wx.layers.fx && kind && placed
        ? {
            kind,
            level: radarOnly ? 0.3 : intensity(step.precipMmH, kind).level,
            windMs: step?.windMs ?? 0,
            windFromDeg: step?.windFromDeg ?? 0,
          }
        : null;
    fxLayer.set({
      precip: falling,
      covered: radar?.fn || null,
      coverSig: radar ? `${radar.state}:${radar.sig}` : '',
      clouds: wx.layers.clouds && step ? step.cloud : null,
      fogPct: wx.layers.clouds && step ? step.fogPct : null,
      reduced: fxReduced(),
    });
  }
  function drawWeather() {
    if (!wxLayer) return;
    const frame =
      wx.at != null && wx.layers.precip && !wx.sim.rain ? frameAt(wx.at) : null;
    const images = {
      precip: wx.sim.rain
        ? simulatedRainCanvas()
        : wx.at != null
          ? frame?.status === 'ok' && !frame.img.noData
            ? frame.img.canvas
            : null
          : wx.images.precip?.canvas || null,
      totals: wx.images.totals?.canvas || null,
      lightning: wx.sim.lightning ? null : wx.images.lightning?.canvas || null,
    };
    for (const k of ['precip', 'totals', 'lightning'])
      if (wx.images[k]?.noData && !(k === 'precip' && wx.sim.rain))
        images[k] = null;
    drawFx();
    // Clouds are drawn in 3D by the effects layer now (phase 6). Lightning
    // has no forecast; ahead of now it is not drawn (the row says so).
    // Lightning frames exist for now only: hidden at any other time.
    const away = wx.at != null;
    wxLayer.set(
      { ...wx.layers, clouds: false, lightning: wx.layers.lightning && !away },
      {
        bbox: wxBox,
        ltgBbox: ltgBox,
        images,
        strikes: wx.sim.lightning ? strikes() : [],
        summary: wxSummary(),
        simulated: wx.sim,
        watchCenter: lastWatchCenter || city.center,
        labels: {
          precip:
            wx.at != null && !wx.sim.rain
              ? frames.label(wx.at)
              : wxLabel('precip'),
          totals: wxLabel('totals'),
          lightning: wxLabel('lightning'),
        },
      },
    );
    // Credits for every weather layer that is on (UI P0-1).
    const credits = ['Weather: MET Norway (CC BY 4.0)'];
    for (const k of ['precip', 'totals', 'lightning'])
      if (wx.layers[k] && WX[k] && !(k === 'precip' && wx.sim.rain))
        credits.push(WX[k].credit);
    const fsrc = wx.at != null && wx.layers.precip ? frameAt(wx.at)?.src : null;
    if (fsrc && !credits.includes(fsrc.credit)) credits.push(fsrc.credit);
    $('tt-wx-credit').textContent = credits.join(' · ');
    renderTimeline();
  }
  /** The chip's summary at the timeline time (phase 6), else now. */
  function wxSummaryAt() {
    if (wx.at == null || wx.sim.rain || wx.sim.snow) return wxSummary();
    // Past times show map frames only, never a forecast value (L9).
    if (wx.at < Date.now() - 15 * 60e3) return null;
    const st = stepAt(wx.steps, wx.at);
    if (!st) return null;
    return {
      validTime: new Date(st.t).toISOString(),
      tempC: st.tempC,
      apparentC: st.tempC,
      cloud: st.cloud,
      precipMmH: st.precipMmH,
      windMs: st.windMs,
      condition: st.condition,
    };
  }
  function renderWeather() {
    const sum = wxSummaryAt();
    const chip = $('tt-wx');
    // Advance: the scrubbed event's forecast, not "now" (review/phase3 G13).
    const parts =
      typeof appMode !== 'undefined' && appMode === 'advance'
        ? advanceChipParts() || {
            live: 'Advance',
            temp: '—',
            condition: 'forecast loading',
            source: 'MET Norway',
          }
        : wx.status === 'loading' && !wx.sim.rain && !wx.sim.snow
          ? null
          : weatherChipParts(sum, {
              useF,
              clock: hhmm(sum?.validTime),
              simulated: wx.sim.rain || wx.sim.snow,
            });
    if (!parts && wx.at != null && wx.at < Date.now() && appMode !== 'advance')
      chip.replaceChildren(
        `${relText(wx.at, Math.floor(Date.now() / 9e5) * 9e5)} · ${wxTime(wx.at)} · map frames only (no forecast for past times)`,
      );
    else if (!parts)
      chip.replaceChildren(
        wx.status === 'loading' ? 'Weather · loading' : 'Weather unavailable',
      );
    else {
      const span = (cls, t) => {
        const n = document.createElement('span');
        n.className = cls;
        n.textContent = t;
        return n;
      };
      if (wx.at != null && appMode !== 'advance')
        parts.live = relText(wx.at, Math.floor(Date.now() / 9e5) * 9e5);
      if (wx.sim.snow) parts.source = 'prototype · all values simulated';
      chip.replaceChildren(
        span(
          `wx-live${wx.sim.rain || wx.sim.snow ? ' sim' : ''}${wx.at != null ? ' away' : ''}`,
          parts.live,
        ),
        span('wx-t num', parts.temp),
        span('wx-c', parts.condition),
        span('wx-src', parts.source),
      );
    }
    chip.title = parts
      ? `${parts.live} · ${parts.temp} · ${parts.condition} · ${parts.source} — live weather; the sample clock is fictional`
      : 'Weather';
    chip.classList.toggle('off', !sum);
    drawWeather();
  }
  /** The weather chip and T: focus the timeline, else open Layers › Weather. */
  function focusWeather() {
    const r = document.querySelector('.tt-wxtl:not([hidden]) .tt-wxtl-range');
    if (r && !r.disabled) return r.focus();
    wx.open = true;
    openPop('tt-layers');
    renderLayers();
  }
  {
    const chip = $('tt-wx');
    chip.setAttribute('role', 'button');
    chip.tabIndex = 0;
    chip.addEventListener('click', focusWeather);
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        focusWeather();
      }
    });
  }
  // ---- weather timeline (phase 6) ----
  const H = 3600e3;
  timeline = createWeatherTimeline({
    onChange: (t) => setWxTime(t),
    clock: (ms) => wxTime(ms),
    tick: (ms) => {
      const d = new Date(ms);
      const h = hhmm(d.toISOString());
      return h === '00:00'
        ? d.toLocaleDateString('en-GB', {
            timeZone: city.timezone,
            weekday: 'short',
          })
        : h;
    },
  });
  document.body.append(timeline.el);
  cleanups.push(() => {
    timeline.stop();
    timeline.el.remove();
  });
  // Map frames over time (WEATHER-TIMELINE-SOURCES.md): past radar or
  // satellite frames, then a model forecast map. Loaded lazily, cached.
  const TS = timeSources(region);
  const frameMeta = { latestRadar: null, run: null };
  const frameCache = new Map(); // url → {status, img}
  async function loadFrameMeta() {
    try {
      if (TS.observed.latestUrl) {
        const r = await fetch(TS.observed.latestUrl, { signal: abort.signal });
        frameMeta.latestRadar = TS.observed.parseLatest(await r.json());
      }
    } catch {
      /* the observed range then ends 10 min before now */
    }
    try {
      if (TS.model.runUrl) {
        const r = await fetch(TS.model.runUrl, { signal: abort.signal });
        frameMeta.run = TS.model.parseRun(await r.json());
      } else frameMeta.run = TS.model.run(Date.now());
    } catch {
      frameMeta.run = null; // no model map; the site forecast still works
    }
    renderTimeline();
  }
  loadFrameMeta();
  const frameTimer = setInterval(loadFrameMeta, 10 * 60e3);
  cleanups.push(() => clearInterval(frameTimer));
  /** The frame source for time t, or null when no map exists for it. */
  function frameSourceAt(t) {
    const now = Date.now();
    const o = TS.observed;
    if (t >= o.from(now) && t <= o.until(now, frameMeta)) return o;
    const m = TS.model;
    const until = m.until(now, frameMeta);
    if (frameMeta.run && t > now && until && t <= until) return m;
    return null;
  }
  /** The recoloured frame for t: {status: 'ok'|'loading'|'missing', img}. */
  function frameAt(t) {
    const src = frameSourceAt(t);
    if (!src) return null;
    const url = src.url(wxBox, t, frameMeta);
    const hit = frameCache.get(url);
    if (hit) return { ...hit, src, ft: src.frameTime(t) };
    frameCache.set(url, { status: 'loading' });
    loadWeatherUrl(url, { signal: abort.signal })
      .then((img) => frameCache.set(url, { status: 'ok', img }))
      .catch(() => frameCache.set(url, { status: 'missing' }))
      .finally(() => {
        if (frameCache.size > 120)
          frameCache.delete(frameCache.keys().next().value);
        drawWeather();
        renderLayers();
      });
    return { status: 'loading', src, ft: src.frameTime(t) };
  }
  const frames = {
    get pastMs() {
      return 2 * H;
    },
    get modelUntil() {
      return frameMeta.run ? TS.model.until(Date.now(), frameMeta) : null;
    },
    label: (t) => {
      const f = frameAt(t);
      if (!f) return 'no map for this time';
      const when = wxTime(f.ft);
      return `${f.src.label()} ${when}${f.status === 'loading' ? ' · loading' : f.status === 'missing' ? ' · frame missing (not shown)' : f.img?.noData ? ' · no rain or snow in this frame' : ''}`;
    },
  };
  function timelineModel() {
    const on = Object.values(wx.layers).some(Boolean);
    if (!on) return null;
    if (wx.sim.rain || wx.sim.snow)
      return {
        disabled:
          'Timeline off while simulated weather is on (Prototype ▾) · the 3D weather is simulated',
      };
    if (!wx.steps.length) return null;
    const now = Math.floor(Date.now() / (15 * 60e3)) * 15 * 60e3;
    const last = wx.steps[wx.steps.length - 1];
    // 24 h ahead keeps the observed 2 h legible; later days: Advance.
    const siteUntil = Math.min(last.t + (last.stepH || 1) * H, now + 24 * H);
    const modelUntil = frames.modelUntil
      ? Math.min(frames.modelUntil, siteUntil)
      : null;
    const start = now - frames.pastMs;
    const obsUntil = Math.min(now, TS.observed.until(Date.now(), frameMeta));
    const segments = [
      { from: start, to: obsUntil, kind: 'observed' },
      ...(obsUntil < now ? [{ from: obsUntil, to: now, kind: 'none' }] : []),
      ...(modelUntil ? [{ from: now, to: modelUntil, kind: 'model' }] : []),
      { from: modelUntil || now, to: siteUntil, kind: 'site' },
    ];
    const kindAt = (t) =>
      t < start
        ? 'none'
        : t <= obsUntil
          ? 'observed'
          : t <= now
            ? 'none'
            : modelUntil && t <= modelUntil
              ? 'model'
              : t <= siteUntil
                ? 'site'
                : 'none';
    return {
      now,
      start,
      end: siteUntil,
      stepMs: 15 * 60e3,
      t: wx.at,
      segments,
      kindAt,
      sourceAt: (t) => {
        if (wx.at == null)
          return `latest ${region === 'us' ? 'radar' : 'satellite estimate'} and the site forecast · MET Norway, updated ${hhmm(wx.summary?.updatedAt)}`;
        const k = kindAt(t);
        if (k === 'none' && t <= now)
          return region === 'us'
            ? 'newest radar frame not in yet'
            : 'satellite estimate runs about 1 h behind — no frame yet for this time';
        if (k === 'observed') return frames.label(t);
        if (k === 'model')
          return `${frames.label(t)} · site forecast MET Norway${t - now > 24 * H ? ' · further out, less certain' : ''}`;
        return `site forecast · MET Norway, updated ${hhmm(wx.summary?.updatedAt)}${t - now > 24 * H ? ' · further out, less certain' : ''}`;
      },
    };
  }
  function renderTimeline() {
    if (!timeline) return;
    if (appMode === 'advance') return timeline.render(null);
    timeline.render(timelineModel());
  }
  function setWxTime(t) {
    wx.at = t;
    twin.setPeopleDim?.(t != null && appMode === 'live');
    renderWeather();
    renderLayers();
    twin.refresh?.();
  }
  function wxRowNote(key) {
    if (key === 'precip' && wx.at != null && !wx.sim.rain)
      return frames.label(wx.at);
    if (key === 'totals' && WX.totals)
      return `${WX.totals.label} · last 24 h to now · not on the timeline`;
    if (key === 'fx') {
      drawFx();
      return `${fxText}${fxReduced() ? ' · drawn still (Reduce motion)' : ''}`;
    }
    if (key === 'clouds') {
      const st = fxStep();
      if (!st) return 'Weather unavailable';
      const c = st.cloud || {};
      return `${st.simulated ? 'SIMULATED · ' : `MET Norway forecast ${hhmm(new Date(st.t).toISOString())} · `}low ${Math.round(c.low ?? 0)}% · mid ${Math.round(c.mid ?? 0)}% · high ${Math.round(c.high ?? 0)}%${Number.isFinite(st.fogPct) && st.fogPct >= 3 ? ` · fog ${Math.round(st.fogPct)}%` : ''} · cloud shapes illustrative, kept clear of the site`;
    }
    if (!WX[key]) return 'Not available here (radar licence not verified)';
    if (key === 'lightning' && wx.sim.lightning)
      return `SIMULATED lightning (prototype) · ${formatRadius(LIGHTNING_WATCH_KM * 1000)} watch ring`;
    if (wx.images[key]?.noData)
      return `${WX[key].label} · no rain or snow in this area right now`;
    if (key === 'precip' && wx.sim.rain) return 'SIMULATED rain (prototype)';
    if (wx.imageErr[key] === 'unavailable')
      return `${WX[key].label} · unavailable`;
    if (wx.imageErr[key] === 'loading') return `${WX[key].label} · loading`;
    return `${WX[key].label}${wx.imageAt[key] ? ` · fetched ${hhmm(wx.imageAt[key])}` : ''}`;
  }
  function weatherGroup() {
    const d = document.createElement('details');
    d.className = 'tt-layer-sub';
    d.open = wx.open;
    d.addEventListener('toggle', () => (wx.open = d.open));
    const sm = document.createElement('summary');
    const on = Object.values(wx.layers).filter(Boolean).length;
    sm.textContent = `Weather overlays · ${on} of 5 on`;
    d.append(sm);
    for (const [key, label] of [
      ['lightning', 'Lightning'],
      ['precip', 'Rain & snow map'],
      ['fx', 'Rain & snow at the site (3D)'],
      ['clouds', 'Clouds & haze at the site (3D)'],
      ['totals', 'Rain & snow totals, last 24 h'],
    ]) {
      const row = document.createElement('label');
      row.className = 'tt-layer-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = wx.layers[key];
      box.disabled = key === 'totals' && !WX.totals;
      box.addEventListener('change', () => {
        wx.layers[key] = box.checked;
        if (box.checked && !['clouds', 'fx'].includes(key)) ensureImage(key);
        drawWeather();
        renderLayers();
      });
      row.append(box, document.createTextNode(label));
      const note = document.createElement('div');
      note.className = 'tt-key tt-wx-note';
      note.textContent = wxRowNote(key);
      d.append(row, note);
    }
    return d;
  }
  /** Weather lines for the incident panel / rail / responders (exceptions). */
  function weatherLines(a, snap, incident) {
    const gatherings = gatheringInUse(a, snap);
    lastWatchCenter = gatherings[0]?.point || null;
    const live = lightningException(strikes(), gatherings, {
      simulated: wx.sim.lightning,
      gridKm: wx.sim.lightning ? null : WX.lightning?.gridKm,
    });
    if (live) wx.lastLightning = { ex: live, at: Date.now() };
    else if (!wx.sim.lightning && wx.lastLightning?.ex.text.startsWith('SIM'))
      wx.lastLightning = null;
    const lightning =
      live ||
      heldLightning(
        wx.lastLightning,
        Date.now(),
        hhmm(new Date(wx.lastLightning?.at || 0).toISOString()),
      );
    // Feed down while people are outdoors: say the check is not running.
    const lightningDown =
      !wx.sim.lightning &&
      gatherings.length &&
      wx.imageErr.lightning === 'unavailable'
        ? {
            text: `Lightning data unavailable — outdoor check not running (${gatherings[0].count} people at ${gatherings[0].label})`,
          }
        : null;
    const exposure = incident
      ? exposureException(
          wxSummary(),
          a.counts['Outside, nearby'],
          incident.ageMin,
          { useF, simulated: wx.sim.rain || wx.sim.snow },
        )
      : null;
    return {
      lightning,
      lightningDown,
      exposure,
      pace: rainPace(wxSummary(), { simulated: wx.sim.rain || wx.sim.snow }),
      official:
        wx.warningsStatus === 'unavailable'
          ? ['Official weather alerts unavailable right now']
          : wx.warnings.map((w) => warningLine(w, city.timezone)),
    };
  }
  $('tt-simlightning').checked = wx.sim.lightning;
  $('tt-simrain').checked = wx.sim.rain;
  $('tt-simsnow').checked = wx.sim.snow;
  $('tt-simsnow').addEventListener('change', (e) => {
    wx.sim.snow = e.target.checked;
    // Rain or snow, one at a time (review/phase6 L3).
    if (wx.sim.snow && wx.sim.rain) {
      wx.sim.rain = false;
      $('tt-simrain').checked = false;
    }
    if (wx.sim.snow) setWxTime(null);
    renderSimFlag();
    renderWeather();
    renderLayers();
  });
  $('tt-reduce-motion').addEventListener('change', () => drawFx());
  $('tt-simlightning').addEventListener('change', (e) => {
    wx.sim.lightning = e.target.checked;
    renderSimFlag();
    renderWeather();
    twin.refresh?.();
  });
  $('tt-simrain').addEventListener('change', (e) => {
    wx.sim.rain = e.target.checked;
    if (wx.sim.rain && wx.sim.snow) {
      wx.sim.snow = false;
      $('tt-simsnow').checked = false;
    }
    if (wx.sim.rain) setWxTime(null);
    renderSimFlag();
    renderWeather();
    twin.refresh?.();
  });

  // ---- Display: ground grid/contours/units + motion ----
  // Grid and elevation are independent layers (Layers › Site). The old single
  // "groundMode" preference / ?ground= value migrates to the two flags.
  const legacyMode = params.get('ground') || pref('groundMode', null);
  const fromMode = (m) => ({
    grid: m === 'grid' || m === 'both',
    contours: m === 'terrain' || m === 'both',
  });
  // US trips default to feet and miles, like °F (review/phase5b).
  const defaultUnit = city.timezone.startsWith('America') ? 'ft' : 'm';
  const ground = {
    ...(legacyMode && params.get('ground')
      ? fromMode(legacyMode)
      : {
          grid:
            String(
              pref('groundGrid', legacyMode ? fromMode(legacyMode).grid : true),
            ) === 'true',
          contours:
            String(
              pref(
                'groundElevation',
                legacyMode ? fromMode(legacyMode).contours : false,
              ),
            ) === 'true',
        }),
    unit: params.get('units') || pref('units', defaultUnit),
  };
  if (!UNIT[ground.unit]) ground.unit = 'm';
  ground.spacing = Number(
    pref(`spacing.${ground.unit}`, UNIT[ground.unit].gridDefault),
  );
  ground.contour = Number(
    pref(`contour.${ground.unit}`, UNIT[ground.unit].contourDefault),
  );
  function fillOptions() {
    const u = UNIT[ground.unit];
    if (!u.grid.includes(ground.spacing)) ground.spacing = u.gridDefault;
    if (!u.contour.includes(ground.contour)) ground.contour = u.contourDefault;
    $('tt-units').value = ground.unit;
  }
  function applyGround() {
    const u = UNIT[ground.unit];
    const st = twin.setGround({
      grid: ground.grid,
      contours: ground.contours,
      spacingM: ground.spacing * u.toM,
      contourM: ground.contour * u.toM,
    });
    $('tt-ground-line').textContent = groundLine(ground);
    // The drawn terrain's range lives under Layers › Site › Elevation (5b IA F2).
    const sign = (v) =>
      formatLength(v, ground.unit, { signed: true }).replace(/^-/, '−');
    if (st?.relief)
      reliefText = `Ground in view: ${sign(st.relief.low)} to ${sign(st.relief.high)} relative to hotel street level`;
    renderLayers();
    save('groundGrid', ground.grid);
    save('groundElevation', ground.contours);
    save('units', ground.unit);
    save(`spacing.${ground.unit}`, ground.spacing);
    save(`contour.${ground.unit}`, ground.contour);
  }
  fillOptions();
  setDistanceUnit(ground.unit);
  $('tt-ground-line').textContent = groundLine(ground);
  function refreshUnitsEverywhere() {
    refreshRouteUnits();
    twin.refresh?.();
    if (selection?.kind === 'place') selectPlace(selection.place);
    else if (selection?.kind === 'saved') selectSaved(selection.id);
    else if (selection?.kind === 'area') selectArea(selection.id);
    else if (selection?.kind === 'building' && !isHotelSel())
      showBuilding(selection.geom);
    else if (isHotelSel()) showBuilding(selection.geom);
    pathEditor.refresh?.();
    adv.sig = '';
    renderAdvance();
    renderWeather();
    renderLayers();
  }
  $('tt-units').addEventListener('change', (e) => {
    ground.unit = e.target.value;
    // Units apply to every distance on screen, not only the grid (phase 5b).
    setDistanceUnit(ground.unit);
    ground.spacing = Number(
      pref(`spacing.${ground.unit}`, UNIT[ground.unit].gridDefault),
    );
    ground.contour = Number(
      pref(`contour.${ground.unit}`, UNIT[ground.unit].contourDefault),
    );
    fillOptions();
    applyGround();
    refreshUnitsEverywhere();
  });
  let reliefText = '';
  // Grid spacing and contour interval live under their layers (phase 5b,
  // review/phase5 IA F11): Layers › Site › Scale grid / Elevation.
  function groundOption(kind) {
    const u = UNIT[ground.unit];
    const row = document.createElement('label');
    row.className = 'tt-layer-opt';
    row.append(kind === 'grid' ? 'Spacing' : 'Interval');
    const sel = document.createElement('select');
    for (const v of kind === 'grid' ? u.grid : u.contour)
      sel.append(new Option(`${v} ${u.label}`, v));
    sel.value = kind === 'grid' ? ground.spacing : ground.contour;
    sel.addEventListener('change', () => {
      ground[kind === 'grid' ? 'spacing' : 'contour'] = Number(sel.value);
      applyGround();
    });
    row.append(sel);
    if (kind !== 'grid' && reliefText) {
      const wrap = document.createElement('div');
      const n = document.createElement('div');
      n.className = 'tt-layer-opt-note';
      n.textContent = reliefText;
      wrap.append(row, n);
      return wrap;
    }
    return row;
  }
  $('tt-temp').value = useF ? 'F' : 'C';
  $('tt-temp').addEventListener('change', (e) => {
    useF = e.target.value === 'F';
    save('tempUnit', e.target.value);
    renderWeather();
    adv.sig = '';
    renderAdvance();
    twin.refresh?.();
  });
  $('tt-reduce-motion').checked = pref('reduceMotion', '0') === '1';
  $('tt-reduce-motion').addEventListener('change', (e) => {
    save('reduceMotion', e.target.checked ? '1' : '0');
    motion.apply();
  });
  for (const [tier, id, key] of [
    ['live', 'tt-motion-live', 'motionLive'],
    ['event', 'tt-motion-event', 'motionEvent'],
    ['cine', 'tt-motion-cine', 'motionCine'],
  ]) {
    const box = $(id);
    if (!box) continue;
    box.checked = motion.tiers[tier] !== false;
    box.addEventListener('change', (e) => {
      save(key, e.target.checked ? '1' : '0');
      motion.set({ [tier]: e.target.checked });
    });
  }

  // ---- toolbar, popovers, report form ----
  for (const [pop, btn] of Object.entries(POPS))
    $(btn)?.addEventListener('click', () => {
      openPop(pop);
      if (pop === 'tt-layers') renderLayers();
      if (pop === 'tt-sites') renderSites();
    });
  $('tt-help-link').addEventListener('click', () => openPop('tt-help'));
  $('tt-help-close').addEventListener('click', closePops);
  $('tt-report-cancel').addEventListener('click', () => {
    $('tt-report-floor').value = '';
    closePops({ restoreFocus: true });
  });
  // Click outside closes (review/phase5 J7). A click on another control
  // closes and still acts; a click on the 3D view closes and is swallowed,
  // so it never selects, deselects or adds a waypoint; a drag still orbits.
  // A report with a typed floor stays open and says so.
  const onOutside = (e) => {
    twin.swallowNextClick(false);
    const id = openPopId();
    if (!id) return;
    const pop = $(id);
    const trig = $(POPS[id]);
    if (pop.contains(e.target) || trig?.contains(e.target)) return;
    const onMap = Boolean(e.target.closest?.('#cesiumContainer'));
    if (id === 'tt-report' && reportDirty()) {
      setReportPending('Not shown yet — Show on twin or Cancel');
      if (onMap) twin.swallowNextClick(true);
      return;
    }
    closePops();
    if (onMap) twin.swallowNextClick(true);
  };
  document.addEventListener('pointerdown', onOutside, true);
  cleanups.push(() =>
    document.removeEventListener('pointerdown', onOutside, true),
  );
  // Focus leaving a popover closes it (keyboard parity), except a dirty report.
  for (const [pop, btn] of Object.entries(POPS))
    $(pop).addEventListener('focusout', (e) => {
      const to = e.relatedTarget;
      if (!to || $(pop).contains(to) || $(btn)?.contains(to)) return;
      if (pop === 'tt-report' && reportDirty()) return;
      if (!$(pop).hidden) closePops();
    });
  $('tt-report-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Number($('tt-report-floor').value);
    if ($('tt-report-floor').value === '' || !Number.isFinite(v)) return;
    twin.reportFloor(Math.round(v), $('tt-report-kind').value);
    $('tt-report-floor').value = '';
    closePops();
  });
  const presets = {
    building: { range: 260, pitch: -25, fit: true },
    neighborhood: { range: 1300, pitch: -45 },
    city: { range: 4000, pitch: -55 },
  };
  for (const btn of document.querySelectorAll('[data-scale]')) {
    btn.addEventListener('click', () => {
      if (twin.state !== 'ready') return;
      const p = { ...presets[btn.dataset.scale] };
      const c = twin.site.center;
      const s = twin.scene;
      if (p.fit)
        p.range = Math.max(p.range, (s.hotelTop - s.hotelBase) * 2.4 + 120);
      const target = new Cesium.BoundingSphere(
        Cesium.Cartesian3.fromDegrees(
          c.lon,
          c.lat,
          s.hotelBase + s.levels * s.floorH * 0.4,
        ),
        40,
      );
      const d = Cesium.Cartesian3.distance(
        viewer.camera.positionWC,
        target.center,
      );
      viewer.camera.flyToBoundingSphere(target, {
        offset: new Cesium.HeadingPitchRange(
          viewer.camera.heading,
          Cesium.Math.toRadians(p.pitch),
          p.range,
        ),
        duration: flightMs(Math.abs(d - p.range)) / 1000,
        easingFunction: Cesium.EasingFunction.QUARTIC_IN_OUT,
      });
      document
        .querySelectorAll('[data-scale]')
        .forEach((b) => b.classList.toggle('on', b === btn));
    });
  }

  // ---- prototype drawer behaviour ----
  const reloadWith = (k, v) => {
    const next = new URLSearchParams(location.search);
    next.set(k, v);
    location.search = next.toString();
  };
  $('tt-scenario').addEventListener('change', (e) =>
    reloadWith('scenario', e.target.value),
  );
  $('tt-city').addEventListener('change', (e) =>
    reloadWith('city', e.target.value),
  );
  $('tt-glow').addEventListener('change', () =>
    twin.setGlowStyle($('tt-glow').value),
  );
  $('tt-simfire').addEventListener('change', (e) => {
    twin.setSimulatedFires(e.target.checked);
    renderSimFlag();
  });
  renderSimFlag();
  $('tt-osmids').addEventListener('change', (e) => {
    save('osmIds', e.target.checked ? '1' : '0');
    if (selection?.kind === 'building') twin.select(selection.geom.building.id);
  });

  // ---- keyboard (no key sends a message or dismisses a report) ----
  let attentionIndex = -1;
  const flatNeeds = () => (lastCtx?.mode.groups || []).flatMap((g) => g.rows);
  // Walls: only view keys work by hand; every setting is on the remote.
  const WALL_KEYS = new Set([
    '1',
    '2',
    '3',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    ',',
    '.',
    'n',
    'N',
    'f',
    'F',
    'z',
    'Z',
    'h',
    'H',
    'Enter',
    'Escape',
    'a',
    'A',
    '[',
    ']',
  ]);
  window.addEventListener('keydown', (e) => {
    if (params.get('view') === 'screen' && !WALL_KEYS.has(e.key)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Esc answers an open question with Stay (review/phase5b supervision F4).
    if (
      e.key === 'Escape' &&
      !$('tt-toast')?.hidden &&
      $('tt-toast')?.dataset.ask
    ) {
      e.preventDefault();
      dismissToast();
      return;
    }
    // Esc closes an open popover first, also from inside its fields, and
    // returns focus to its trigger (review/phase5 J7). A typed report floor
    // asks once.
    if (e.key === 'Escape' && openPopId()) {
      e.preventDefault();
      if (reportDirty() && !$('tt-report-pending').dataset.esc) {
        setReportPending('Esc again to discard the floor you typed');
        $('tt-report-pending').dataset.esc = '1';
        return;
      }
      if ($('tt-report-pending')) delete $('tt-report-pending').dataset.esc;
      $('tt-report-floor').value = '';
      closePops({ restoreFocus: true });
      return;
    }
    // The path editor owns the keyboard while it is open (phase 4).
    if (pathEditor.handleKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.target.closest?.('input, select, textarea')) return;
    const k = e.key;
    if (
      k === 'Escape' &&
      wx.at != null &&
      appMode === 'live' &&
      !openPopId() &&
      !pathEditor.active
    ) {
      timeline?.stop();
      return setWxTime(null);
    }
    if (k === 'Escape') {
      // popover → person opened from a floor card → floor card → selection
      if (closePops()) return;
      // A path card first: back to the card it came from, else close (O1, O12).
      if (selection?.kind === 'suggested')
        return selection.parent ? backToParent() : closePathCard();
      if (adv.pathFor) {
        clearAdvancePath();
        return renderAdvance(true);
      }
      if (twin.hasRoute) return removePath();
      if (selection?.kind === 'place') {
        releaseCard();
        selection = null;
        syncPlaceHighlight();
        card.hide();
        $('tt-crumb-focus').textContent = '';
        return;
      }
      if (selection?.kind === 'person' && floorReturn !== null)
        return focusFloor(floorReturn);
      if (clearFloorFocus()) return;
      // Ways out ends last: after cards, paths, floor focus and selection.
      if (!selection && waysOut) return exitWaysOut();
      twin.select(null);
      return;
    }
    if (k === 'h' || k === 'H') {
      if (!isHotelSel()) twin.select(hotelId());
      if (!cutawayOpen) {
        cutawayOpen = true;
        save('cutawayOpen', 'true');
        setCutHead();
      }
      return (lastCtx?.dockedCutaway ? docked : cutaway).focus(
        twin.floorFocus ?? lastCtx?.reportedLabel,
      );
    }
    if (
      (k === 'ArrowUp' || k === 'ArrowDown') &&
      twin.floorFocus !== null &&
      lastOcc?.available
    ) {
      // ↑/↓ step floors whenever a floor card is open ([ ] stay on people).
      e.preventDefault();
      const next = twin.floorFocus + (k === 'ArrowUp' ? 1 : -1);
      if (lastOcc.floors.some((f) => f.label === next)) focusFloor(next);
      return;
    }
    if (k === 'f' || k === 'F' || k === 'z' || k === 'Z')
      return twin.frameSelection();
    if (k === ',' || k === '.')
      return twin.viewFromSide(rotated(twin.headingDeg, k === ',' ? -1 : 1));
    if (k === 'n' || k === 'N') return twin.viewFromSide(0);
    if (k === 's' || k === 'S') {
      openPop('tt-sites');
      return renderSites();
    }
    const scale = { 1: 'building', 2: 'neighborhood', 3: 'city' }[k];
    if (scale)
      return document.querySelector(`[data-scale="${scale}"]`)?.click();
    if (k === '/') {
      e.preventDefault();
      return hud.focusFind();
    }
    if (k === 'l' || k === 'L') {
      openPop('tt-layers');
      return renderLayers();
    }
    if (k === 'd' || k === 'D') return openPop('tt-display');
    // T: the weather timeline (or the weather layers when none is on).
    if (k === 't' || k === 'T') return focusWeather();
    if (k === 'v' || k === 'V')
      return setAppMode(appMode === 'advance' ? 'live' : 'advance');
    // People and report keys act on live data only.
    if (appMode === 'advance' && /^[rRaA[\]]$/.test(k)) return;
    if (k === 'r' || k === 'R') return openPop('tt-report');
    if (k === '?') return openPop('tt-help');
    if (k === '`') return openPop('tt-proto');
    if (k === 'w' || k === 'W') return toggleWaysOut();
    if (k === 'g' || k === 'G' || k === 'e' || k === 'E') {
      const flag = k === 'g' || k === 'G' ? 'grid' : 'contours';
      ground[flag] = !ground[flag];
      applyGround();
      return renderLayers();
    }
    const list = flatNeeds();
    if (!list.length) return;
    if (k === 'a' || k === 'A') attentionIndex = 0;
    else if (k === ']') attentionIndex = (attentionIndex + 1) % list.length;
    else if (k === '[')
      attentionIndex = (attentionIndex - 1 + list.length) % list.length;
    else return;
    twin.selectPerson(list[attentionIndex].person.id, { frame: true });
  });

  // ---- weather feeds: now 10 min, images 5 min, warnings 5 min ----
  loadWeatherNow();
  loadWarnings();
  ensureImage('lightning'); // the lightning rule runs whether or not it is drawn
  const wxTimer = setInterval(() => {
    loadWeatherNow();
  }, 10 * 60000);
  const wxImgTimer = setInterval(() => {
    loadWarnings();
    for (const k of ['lightning', 'precip', 'totals']) {
      if (k !== 'lightning' && !wx.layers[k]) continue;
      delete wx.images[k];
      ensureImage(k);
    }
  }, 5 * 60000);
  cleanups.push(
    () => clearInterval(wxTimer),
    () => clearInterval(wxImgTimer),
  );

  // ---- mock snapshot feed (stands in for hook H-2) ----
  // Every site's recorded POIs (hotel + venues) feed the trip's safety points.
  const poisBySite = {};
  await Promise.all(
    SITES.map(async (s) => {
      const res = await fetch(
        `/scripts/fixtures/trip-twin/${s.key}.pois.json`,
      ).catch(() => null);
      poisBySite[s.key] = res?.ok ? (await res.json()).pois : [];
    }),
  );
  const pois = poisBySite[cityKey] || [];
  // SOC multi-view: screens count scenario time from the session's epoch.
  let scenarioEpoch = null;
  const feed = () => {
    lastFeed = Date.now();
    twin.setSnapshot(
      applyOperatorNumbering(
        tripTwinDemoSnapshot(cityKey, scenario, {
          pois,
          poisBySite,
          startMs: scenarioEpoch,
        }),
        numberingEntries,
      ),
    );
  };
  feed();
  const feedTimer = setInterval(() => {
    if (!params.has('freeze')) feed();
  }, 15000);
  const ageTimer = setInterval(() => twin.age(), 5000);
  cleanups.push(
    () => clearInterval(feedTimer),
    () => clearInterval(ageTimer),
  );
  async function exitTwin({ confirmed = false } = {}) {
    if (twin.state === 'ready' || twin.state === 'degraded') {
      if (pathEditor.blockIfDirty('exit')) return;
      if (!confirmed && liveIncidentHere())
        return confirmToast(
          `Incident at ${city.short} — exit Trip Twin? The incident stays in World View.`,
          'Exit Trip Twin',
          () => exitTwin({ confirmed: true }),
          `Stay at ${city.short}`,
        );
      wxLayer?.dispose();
      wxLayer = null;
      fxLayer?.dispose();
      fxLayer = null;
      beacons?.dispose();
      beacons = null;
      customLayer?.dispose();
      customLayer = null;
      await twin.close();
      $('tt-exit').textContent = 'Open Trip Twin';
    } else if (twin.state === 'idle') {
      $('tt-exit').textContent = 'Exit Trip Twin';
      await twin.open(siteKey, { osmMode });
    }
  }
  $('tt-exit').addEventListener('click', () => exitTwin());
  void lastA;

  // ---- SOC multi-view (phase 10): wall screens and the entry choice ----
  const VIEW = params.get('view');
  const focusTrip = tripForCity(cityKey);
  let lastSessionReport = null; // the remote's report this wall shows
  /** What a wall screen can ask of this page (twinScreen.js). */
  let driftOff = null;
  const screenApi = {
    cityKey,
    tripCity: (id) => tripById(id).city,
    tripScenario: (id) => tripById(id).scenario,
    setEpoch(ms) {
      scenarioEpoch = ms;
      feed();
    },
    switchSite(key) {
      if (key !== siteKey && SITES.some((x) => x.key === key))
        switchSite(key, { confirmed: true });
    },
    setMode(mode, day) {
      setAppMode(mode === 'advance' ? 'advance' : 'live', { confirmed: true });
      if (mode === 'advance') {
        const d = day ?? todayDay();
        const ev = advEvents().find((e) => e.day === d);
        if (ev) selectEvent(ev.key);
      }
    },
    report(r) {
      lastSessionReport = r || null;
      if (r?.floor != null)
        twin.reportFloor(r.floor, r.kind || 'other', r.at ?? Date.now());
      else twin.reportFloor(null);
    },
    /** Which report a banner is about (an acknowledgement is per report). */
    incidentKey: () =>
      lastSessionReport?.id ||
      lastCtx?.snapshot?.reported_incidents?.[0]?.id ||
      null,
    spotlight(sp) {
      if (sp?.kind === 'person') twin.selectPerson(sp.id);
      else if (sp?.kind === 'place') {
        const p = (lastCtx?.snapshot?.safety_points || []).find(
          (x) => x.id === sp.id,
        );
        if (p) selectPlace(p);
      }
    },
    setWxTime(ms) {
      if ((ms ?? null) !== (wx.at ?? null)) setWxTime(ms ?? null);
    },
    scale(key) {
      document.querySelector(`[data-scale="${key}"]`)?.click();
    },
    setLayer(key, on) {
      if (key in wx.layers) {
        wx.layers[key] = on;
        if (on && !['clouds', 'fx'].includes(key)) ensureImage(key);
        drawWeather();
      } else if (key === 'waysOut') {
        if (Boolean(waysOut) !== on) toggleWaysOut();
      } else if (key === 'grid' || key === 'elevation') {
        ground[key === 'grid' ? 'grid' : 'contours'] = on;
        applyGround();
      } else setViewLayer(key, on);
    },
    /** Motion tiers for this wall, from the session (phase 11). */
    setMotion(tiers) {
      motion.set(tiers || {});
    },
    motionOn: (tier) => motion.on(tier),
    /**
     * Idle drift (Cinematic): the camera orbits the site slowly, one turn
     * in about 12 minutes. Only while the screen module asks for it; any
     * input stops it at once. Never rolls, never changes pitch.
     */
    drift(on) {
      if (!on) {
        driftOff?.();
        driftOff = null;
        return;
      }
      if (driftOff || twin.state !== 'ready' || !twin.site?.center) return;
      const c = twin.site.center;
      const center = Cesium.Cartesian3.fromDegrees(
        c.lon ?? c.lng,
        c.lat,
        twin.scene?.hotelBase || 0,
      );
      const frame = Cesium.Transforms.eastNorthUpToFixedFrame(center);
      const RATE = Cesium.Math.toRadians(0.5); // degrees per second
      let last = performance.now();
      const off = viewer.scene.preRender.addEventListener(() => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const cam = viewer.camera;
        cam.lookAtTransform(frame);
        cam.rotateRight(RATE * dt);
        cam.lookAtTransform(Cesium.Matrix4.IDENTITY);
      });
      driftOff = () => off();
    },
    applyRoleDefaults(role) {
      // Roles look different from across the room (review R7): weather
      // over the area with heat detections; people from straight above.
      if (role === 'weather') {
        for (const k of ['precip', 'clouds', 'lightning'])
          screenApi.setLayer(k, true);
        screenApi.setLayer('fires', true);
      }
      if (role === 'travelers') screenApi.frame({ kind: 'topdown' });
    },
    frame(subject) {
      if (twin.state !== 'ready') return;
      if (subject?.kind === 'clear') twin.select(null);
      else if (subject?.kind === 'topdown') {
        const c = twin.site.center;
        // Height follows the scale: people read at neighbourhood height.
        const sc = document.querySelector('.tt-tb.on[data-scale]')?.dataset
          .scale;
        const up = sc === 'building' ? 520 : sc === 'city' ? 2400 : 880;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            c.lon ?? c.lng,
            c.lat,
            twin.scene.hotelBase + up,
          ),
          orientation: {
            heading: 0,
            pitch: -Cesium.Math.PI_OVER_TWO,
            roll: 0,
          },
          duration:
            pref('reduceMotion', '0') === '1' ||
            matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 0
              : 1.2,
        });
      } else if (subject?.kind === 'floor') focusFloor(subject.label);
      else if (subject?.kind === 'person')
        twin.selectPerson(subject.id, { frame: true });
      else if (subject?.kind === 'scale') screenApi.scale(subject.scale);
    },
    // Roles without 3D stop rendering — only once the twin has finished
    // opening (its entry animation needs the render loop).
    pauseRender(off) {
      renderOff = off;
      if (twin.state !== 'ready' && twin.state !== 'degraded') return;
      viewer.useDefaultRenderLoop = !off;
      if (!off) viewer.scene.requestRender();
    },
    captureCanvas() {
      return new Promise((resolve) => {
        if (!viewer.useDefaultRenderLoop) return resolve(null);
        let done = false;
        const off = viewer.scene.postRender.addEventListener(() => {
          if (done) return;
          done = true;
          off();
          try {
            resolve(viewer.canvas.toDataURL('image/jpeg', 0.7));
          } catch {
            resolve(null);
          }
        });
        viewer.scene.requestRender();
        setTimeout(() => {
          if (!done) {
            done = true;
            off();
            resolve(null);
          }
        }, 1500);
      });
    },
    siteLabel: () =>
      document.body.dataset.role === 'trips'
        ? `Every active trip · in focus: ${focusTrip.title}`
        : `${focusTrip.title} · ${city.short || city.label}`,
    dayLabel: () => `DAY ${currentAdvanceDay() ?? todayDay()}`,
    todayDay: () => todayDay(),
    clockText: () =>
      lastCtx?.snapshot
        ? `${sampleClock(lastCtx.snapshot)} local · sample`
        : '',
    incidentOpen: () => lastCtx?.mode?.mode === 'incident',
    /** What a hands-on operator picked on this wall (for the remote). */
    selectionText() {
      const s = selection;
      if (!s) return '';
      if (s.kind === 'person')
        return `selected ${shortName(s.row.person.name)}`;
      if (s.kind === 'place') return `selected ${s.place.name || 'a place'}`;
      if (s.kind === 'building')
        return s.geom?.isHotel
          ? 'selected the hotel'
          : `selected ${s.geom?.building?.name || 'a building'}`;
      if (s.kind === 'suggested') return 'selected a suggested path';
      if (s.kind === 'saved') return 'selected a saved path';
      return '';
    },
    incidentText() {
      const m = lastCtx?.mode;
      // The banner names its trip (review R3).
      return m?.mode === 'incident'
        ? `${focusTrip.title} · ${m.topLine.split(' — ')[0]}`
        : '';
    },
    /** S3 idle: what changed, what is next, what is official. */
    idlePanel(node) {
      const add = (cls, t) => {
        const n = document.createElement('div');
        n.className = cls;
        n.textContent = t;
        node.append(n);
      };
      node.replaceChildren();
      add('tt-kicker', 'NO INCIDENT OPEN');
      add(
        'tt-wall-note',
        'A reported floor opens the board here · needs attention is on the left',
      );
      add('tt-kicker', 'CHANGED · LAST 10 MIN');
      const recent = changeLog.filter((e) => Date.now() - e.at < 600000);
      if (!recent.length)
        add(
          'tt-wall-line',
          `Nothing changed in the last 10 min · data every 5 s · ${lastCtx?.snapshot ? sampleClock(lastCtx.snapshot) : ''}`,
        );
      for (const e of recent.slice(0, 8))
        add(
          `tt-wall-line${e.warn ? ' warn' : ''}`,
          `${e.clock || ''} · ${e.text}`,
        );
      add('tt-kicker', 'NEXT ON THE PLAN');
      const now = Date.now();
      const next = advEvents()
        .filter((e) => Number.isFinite(e.epoch) && e.epoch > now)
        .slice(0, 3);
      if (!next.length) add('tt-wall-line', 'Nothing further on the plan');
      for (const e of next) {
        const site = SITES.find((x) => x.key === e.siteKey);
        add(
          'tt-wall-line',
          `Day ${e.day} · ${e.start} · ${e.title}${site ? ` · ${site.short || site.label || ''}` : ''}`,
        );
      }
      add(
        'tt-kicker',
        `OFFICIAL · ${WX.warnings === 'nws' ? 'NWS' : 'MeteoAlarm'}`,
      );
      if (wx.warningsStatus === 'unavailable')
        add(
          'tt-wall-line warn',
          'Official warnings unavailable right now — not checked',
        );
      else if (!wx.warnings.length)
        add(
          'tt-wall-line',
          `Checked ${wx.warningsAt ? hhmm(new Date(wx.warningsAt).toISOString()) : 'at load'}: no active alerts returned for this point`,
        );
      else
        for (const w of wx.warnings)
          add('tt-wall-line official', warningLine(w, city.timezone));
      try {
        const c = city.anchors?.inside || city.center;
        const today = new Date().toISOString().slice(0, 10);
        const { set } = sunTimes(today, c.lat, c.lon ?? c.lng);
        if (set)
          add(
            'tt-wall-note',
            `Sunset ${new Date(set).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: city.timezone })} local`,
          );
      } catch {
        /* no sunset line */
      }
    },
    /** Weather & alerts: official first, then sensed, then now (S4). */
    weatherPanel(node) {
      const add = (cls, t) => {
        const n = document.createElement('div');
        n.className = cls;
        n.textContent = t;
        node.append(n);
      };
      node.replaceChildren();
      const src = WX.warnings === 'nws' ? 'NWS' : 'MeteoAlarm';
      add('tt-kicker', `OFFICIAL · ${src}`);
      if (wx.warningsStatus === 'unavailable')
        add('tt-wall-line warn', `${src} unavailable right now — not checked`);
      else if (!wx.warnings.length)
        add(
          'tt-wall-line',
          `${src} checked ${wx.warningsAt ? hhmm(new Date(wx.warningsAt).toISOString()) : 'at load'}: no active alerts returned for this point`,
        );
      else
        for (const w of wx.warnings)
          add('tt-wall-line official', warningLine(w, city.timezone));
      add('tt-kicker', 'SENSED');
      // lastCtx.fires is already the formatted line (firesLine at assess).
      add(
        'tt-wall-line',
        lastCtx?.fires?.line || 'Satellite heat detections · loading',
      );
      add(
        'tt-wall-line',
        wx.layers.lightning
          ? `Lightning · ${WX.lightning?.label || 'strike density'} · shown on the map`
          : 'Lightning · layer off',
      );
      add('tt-kicker', 'NOW');
      const parts = [...$('tt-wx').children]
        .map((n) => n.textContent.trim())
        .filter(Boolean);
      add(
        'tt-wall-line',
        parts.length
          ? parts.join(' · ')
          : $('tt-wx').textContent || 'Weather · loading',
      );
      add(
        'tt-wall-note',
        'Sources and ages as shown · never a statement that conditions are fine',
      );
    },
    /** Trips on watch (S6): every sample trip, by need. */
    tripsPanel(node) {
      const now = Date.now();
      const ageS = (now - lastFeed) / 1000;
      // The trip in focus uses this wall's own counts, clock and report, so
      // S6 agrees with S1–S5 (review R3); other trips, the same clock rules.
      const own = lastA?.counts
        ? {
            notCurrent: lastA.counts['Not current'] ?? 0,
            notLocated: lastA.counts['Not located'] ?? 0,
            localTime: lastCtx?.snapshot ? sampleClock(lastCtx.snapshot) : null,
            incident:
              lastCtx?.mode?.mode === 'incident'
                ? lastCtx.mode.topLine.split(' — ')[0]
                : null,
          }
        : null;
      const tiles = sortTiles(
        DEMO_TRIPS.map((t) =>
          tripTile(
            t,
            tripTwinDemoSnapshot(t.city, t.scenario, {
              now,
              startMs: scenarioEpoch,
            }),
            {
              now,
              dataAgeS: ageS,
              override: t.id === focusTrip.id ? own : null,
            },
          ),
        ),
      );
      node.replaceChildren();
      const k = document.createElement('div');
      k.className = 'tt-kicker';
      k.textContent = `TRIPS ON WATCH · ${tiles.length} · IN FOCUS: ${focusTrip.title.toUpperCase()}`;
      const grid = document.createElement('div');
      grid.className = 'tt-trips';
      for (const t of tiles) {
        const c = document.createElement('div');
        c.className = `tt-trip${t.incident ? ' incident' : ''}${t.noData || t.stale ? ' grey' : ''}${t.id === focusTrip.id ? ' focus' : ''}`;
        const line = (cls, txt) => {
          const n = document.createElement('div');
          n.className = cls;
          n.textContent = txt;
          c.append(n);
        };
        line('t', t.title);
        line('o', `${t.org} · ${t.city}`);
        const ck = document.createElement('div');
        ck.className = 'clock';
        ck.textContent = t.localTime || '—';
        const sm = document.createElement('small');
        sm.textContent = 'LOCAL';
        ck.append(sm);
        c.append(ck);
        if (t.incident) line('i', t.incident);
        if (!t.noData)
          line(
            'n',
            `${t.people} people · ${t.notCurrent} not current · ${t.notLocated} not located`,
          );
        line('x', t.noData ? t.line : `Next: ${t.next}`);
        line('d', t.noData ? '' : t.data);
        grid.append(c);
      }
      node.append(k, grid);
    },
  };
  let screen = null;
  let renderOff = false;
  if (VIEW === 'screen') {
    screen = createScreenMode({
      api: screenApi,
      slot: params.get('slot'),
      setup: params.get('setup'),
    });
    cleanups.push(() => screen?.dispose());
  } else if (VIEW === 'launch')
    showLaunch({ setup: params.get('setup'), cityKey, scenario });
  else if (!params.has('freeze'))
    showEntry({
      cityKey,
      scenario,
      tripId: focusTrip.id,
      siteKey: () => siteKey,
      pref,
      save,
    });
  // The launch page (another computer's screens) needs no 3D of its own.
  if (VIEW === 'launch') return;
  await twin.open(siteKey, { osmMode });
  if (screen && renderOff) screenApi.pauseRender(true);
  // Role defaults (scale, top-down, layers) need the twin open.
  screen?.reapply();
}

main().catch((error) => {
  console.error('[TripTwin] harness failed', error);
  status.textContent = `Trip Twin could not start: ${error?.message || error}`;
});
window.addEventListener('pagehide', () => {
  abort.abort();
  for (const fn of cleanups.reverse()) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
});
