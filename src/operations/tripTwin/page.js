// Trip Twin standalone harness. Stands in for World View hooks H-1..H-9
// (PROJECT-PLAN update box): builds its own viewer, feeds mock data, and owns
// the page chrome wiring. Edits none of Justin's files.
import * as Cesium from 'cesium';
import './tripTwin.css';
import './tripTwin.instrument.css';
import './tripTwin.walls.css';
import { createMotion, MOTION_DEFAULTS } from './twinMotion.js';
import { createStandaloneScene } from '../../standalone/scene.js';
import {
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  installRenderGovernor,
  releaseContinuousRender,
  uninstallRenderGovernor,
} from '../../renderGovernor.js';
import { createTripTwin, flightMs } from './tripTwin.js';
import { createTwinMapLabels } from './twinMapLabels.js';
import { PAGE_LABEL_SCALE, wallLabelScale } from './twinMapLabelEntries.js';
import { createHazardLoad } from './twinHazardLoad.js';
import { drawHazards } from './twinHazardsLayer.js';
import {
  assessFires,
  assessTropical,
  compassWord,
  fireLines,
  fireChip,
  fireName,
  fireShort,
  hazardCoverage,
  hazardPicture,
  nearestFire,
  tropicalLines,
  tropicalShort,
} from './twinHazards.js';
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
  styledName,
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
  getDistanceUnit,
  setDistanceUnit,
  haversineM,
  bearingLabel,
} from './twinData.js';
import { SIM_DEMO_MAX_MS } from './twinSession.js';
import { SAFETY_LABEL } from './twinSafety.js';
import {
  LONG_FOOT as PHOTO_LONG_FOOT,
  photoCredit,
  photoLines,
  photoTarget,
  photoUrl,
  pickPhoto,
  rankPhotos,
  wallView,
} from './twinStreetPhotos.js';
import { createPhotoLoader } from './twinStreetPhotoLoad.js';
import { lookOf, openPhotoViewer, photoBlock } from './twinStreetPhoto.js';
import { drawPhotoMarker } from './twinStreetPhotoMarker.js';
import {
  INCIDENT_M as CAMERA_INCIDENT_M,
  NEAR_M as CAMERA_NEAR_M,
  cameraLines,
  cameraName,
  noCameraLine,
  rankCameras,
} from './twinCameras.js';
import { cameraBlock, openCameraViewer } from './twinCameraView.js';
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
  weatherChipParts,
  fahrenheit,
  weatherSources,
  heldLightning,
  LIGHTNING_WATCH_KM,
} from './twinWeather.js';
import { coverageFromCanvas, createWeatherFx } from './twinWeatherFx.js';
import { KIND_TEXT, createWeatherTimeline } from './twinWeatherTimeline.js';
import {
  NOWCAST_PX,
  PROJECT_MAX_MIN,
  approach,
  approachNow,
  approachText,
  boxKm,
  findCores,
  inEta,
  hasMotion,
  nearestPoint,
  projectGrid,
  simulatedStorm,
  trendOf,
} from './twinNowcast.js';
import {
  loadAlertAreas,
  loadPastGrid,
  runNowcast,
  simNowcast,
  simulatedAlert,
} from './twinNowcastLoad.js';
import {
  HEIGHT_RULE,
  HEIGHT_RULE_EST,
  SEVERITY_KEY,
  createStormLayer,
} from './twinStorm3d.js';
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
import {
  ICON,
  STATIONS,
  createStationRail,
  stationKey,
  weatherPill,
} from './twinStations.js';
import { ROLES } from './twinScreenRoles.js';
import {
  onReviewLink,
  resumeReviewLink,
  reviewLinkState,
  onCameraState,
  sendCamera,
  sendPhoto,
  sendReview,
  setPhotoSnapshot,
  setReviewSnapshot,
  showEntry,
  showLaunch,
} from './twinEntry.js';
import {
  DEMO_TRIPS,
  TIER,
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
// ?motion=preview (prototype): every tier on for this page only, and the
// rail's alert hold lifted, so Cinematic can be seen with the sample data
// (which always carries another trip's report). Nothing is saved.
const motionPreview = params.get('motion') === 'preview';
if (motionPreview) document.body.classList.add('tt-motion-preview');
const motion = createMotion({
  reduced: reducedMotion,
  tiers:
    params.get('view') === 'screen'
      ? MOTION_DEFAULTS.wall
      : motionPreview
        ? { live: true, event: true, cine: true }
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
  // The top bar's ⋯ menu holds the Prototype and shortcut buttons.
  'tt-more': 'tt-more-btn',
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
  // Idle rendering (upstream src/renderGovernor.js): the map redraws only
  // while something moves (holds: opening/closing, cine drift, weather
  // particles, filming), on camera input and tile loads, on request, and
  // twice a second as a heartbeat, so every data change reaches the screen
  // within 0.5 s without each one asking. ?twinRender=continuous keeps the
  // old always-on loop.
  if (params.get('twinRender') === 'continuous')
    holdContinuousRender('twin-pref');
  if (params.has('film')) holdContinuousRender('twin-film');
  installRenderGovernor(viewer);
  const renderBeat = setInterval(
    () => governorRequestRender('twin-heartbeat'),
    500,
  );
  cleanups.push(() => {
    clearInterval(renderBeat);
    uninstallRenderGovernor(viewer);
  });
  window.testTwinRender = getRenderGovernorDiagnostics;
  // Map words on upstream's world overlay (review/map-labels L5): one host
  // per page; walls read their own scale.
  const mapLabels = createTwinMapLabels(viewer, {
    wall: () => document.body.dataset.view === 'screen',
    scale: () =>
      document.body.dataset.view === 'screen'
        ? wallLabelScale(
            parseFloat(
              getComputedStyle(document.body).getPropertyValue('--wall-scale'),
            ),
          )
        : PAGE_LABEL_SCALE,
  });
  const labelBeat = setInterval(() => mapLabels.beat(), 500);
  cleanups.push(() => {
    clearInterval(labelBeat);
    mapLabels.dispose();
  });
  window.testTwinLabels = () => mapLabels.diagnostics();
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
  // Fire boundaries and hurricanes (review/hazards H5-PLAN), set up below.
  let hazardLoad = null;
  let hzPic = null;
  let lastA = null;
  // Change log (phase 11): what moved, for the S3 idle board. Counts and
  // attention-group membership are compared on every data tick.
  const changeLog = [];
  let prevLogCounts = null;
  let prevGroups = null;
  let prevLogReport; // the open report's id (S3 reviews); undefined at load
  /** One Changed line: clock · name · what, the name written as the
   *  screen writes names now (visitor mode: initials; S3 reviews). */
  const changeText = (e) =>
    [e.clock, e.name && styledName(e.name), e.text].filter(Boolean).join(' · ');
  function logChanges(a, m, clock, incident = null) {
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
        const joined = [...g.ids].filter(([id]) => !before.has(id));
        // Many joining at once (a report opening) read as one line.
        if (joined.length > 3)
          changeLog.unshift({
            at: now,
            clock,
            text: `${joined.length} · ${g.label.toLowerCase()}`,
            warn: true,
          });
        else
          for (const [, name] of joined)
            changeLog.unshift({
              at: now,
              clock,
              name,
              text: g.label.toLowerCase(),
              warn: true,
            });
      }
    prevGroups = groups;
    // The report itself last, so it leads the card (S3 reviews). Tracked
    // by its id, so a new report replacing an open one is a line too; a
    // wall that loads during a report logs it at the report's own time.
    const rep = m?.mode === 'incident' || m?.mode === 'incident_elsewhere';
    const key = rep
      ? lastSessionReport?.id ||
        lastCtx?.snapshot?.reported_incidents?.[0]?.id ||
        String(m.topLine || 'report').split(' — ')[0]
      : null;
    if (key !== prevLogReport) {
      const first = prevLogReport === undefined;
      const age = Number(incident?.ageMin) || 0;
      if (key && (!first || age < 10))
        changeLog.unshift({
          at: now - (first ? age * 60000 : 0),
          clock: incident?.clock || clock,
          // "Smoke reported, floor 9 · not verified": the banner's words
          // without the trip and the age.
          text: `${
            String(m.topLine || 'Incident reported')
              .split(' — ')[0]
              .split(' · ')
              .slice(-1)[0]
              .replace(/\s*\(.*$/, '') || 'Incident reported'
          } · not verified`,
          warn: true,
          report: true,
        });
      else if (!key && !first)
        changeLog.unshift({
          at: now,
          clock,
          text: 'Report closed',
          report: true,
        });
    }
    prevLogReport = key;
    if (changeLog.length > 30) changeLog.length = 30;
  }
  let selection = null;
  // Rail cards (shell review, 23 Oct 2026): Needs attention opens on every
  // load; People, Hazards, Safety & paths and Sources remember the viewer's
  // choice (browser-only convenience).
  const open = {
    needs: true,
    people: pref('card.people', '1') === '1',
    safety: pref('card.safety', '0') === '1',
    hazards: pref('card.hazards', '0') === '1',
    sources: pref('card.sources', '0') === '1',
    why: false,
    hotelCard: false,
  };
  // ---- stations rail (shell steps B–C, 23 Oct 2026; review/shell) ----
  // The All-in-one's right-hand rail: six stations = the six wall roles.
  // Picking a station redraws the screen for it (scale, camera, layers,
  // the panel in the rail, the rail card on the left) and swaps the tile
  // grid to that station's own tiles, Back first. Leaving a station puts
  // back the layers it switched on. An incident never moves the camera or
  // switches station by itself: it badges (Jesse, 23 Oct).
  let stations = null;
  let station = STATIONS.some((s) => s.id === pref('station', 'site'))
    ? pref('station', 'site')
    : 'site';
  let stationsOpen = pref('stationsOpen', '1') === '1';
  // The picker shows on load; a station's tiles after a pick.
  let gridMode = 'picker';
  const STATION_CARD = {
    travelers: 'people',
    incident: 'needs',
    weather: 'hazards',
    day: 'safety',
  };
  // Layers a station switches on, and what they were before (restored on
  // leaving, unless the operator changed them in between).
  const STATION_LAYERS = {
    weather: ['precip', 'clouds', 'lightning', 'radar3d', 'fires'],
  };
  let layerSnap = null;
  const layerOn = (k) => (k in wx.layers ? wx.layers[k] : twin.layers[k]);
  function setStationsOpen(on) {
    stationsOpen = on;
    save('stationsOpen', on ? '1' : '0');
    renderStations();
  }
  function stationBack() {
    gridMode = 'picker';
    renderStations();
    stations?.focusTile(station);
  }
  /** Weather that matters now: storm layers must stay on (D2). */
  const stormActive = () =>
    Boolean(
      lastCtx?.weather?.approach ||
      lastCtx?.weather?.official?.length ||
      lastCtx?.weather?.lightning ||
      lastCtx?.weather?.lightningNear?.inside ||
      nc.simStart,
    );
  function leaveStation() {
    // Leaving Site lets go of a plain hotel selection (the app's own or
    // Site's), unless the operator went to a floor; people and places the
    // operator picked are kept (D3).
    if (station === 'site' && isHotelSel() && twin.floorFocus === null)
      twin.select(null);
    siteAutoSel = null;
    if (!layerSnap) return;
    // Put back only what this station switched on, only if the operator
    // has not changed it since, and never while weather matters (D2).
    if (!stormActive())
      for (const [k, was] of Object.entries(layerSnap.before))
        if (!was && layerOn(k) === layerSnap.set[k])
          screenApi.setLayer(k, false);
    layerSnap = null;
    renderLayers();
  }
  // The hotel Site selected by itself is the station's, not the
  // operator's: leaving Site releases it so the next station's panel shows
  // (review/shell round 2). A selection the operator made is kept (D3).
  let siteAutoSel = null;
  let stormFramedOnce = false;
  function enterStation(id) {
    const role = ROLES[id];
    // One camera move per pick (motion round 2): skip the scale flight
    // when a framing flight follows.
    const framesItself =
      !selection &&
      (id === 'travelers' ||
        (id === 'weather' && ncView()?.ap?.core && !stormFramedOnce));
    if (role?.scale && !framesItself) screenApi.scale(role.scale);
    const keys = STATION_LAYERS[id];
    if (keys) {
      const before = Object.fromEntries(keys.map((k) => [k, layerOn(k)]));
      for (const k of keys) screenApi.setLayer(k, true);
      layerSnap = {
        before,
        set: Object.fromEntries(keys.map((k) => [k, true])),
      };
      renderLayers();
    }
    if (STATION_CARD[id]) hud.openCard(STATION_CARD[id]);
    // A station change keeps the operator's selection (D3): the station's
    // panel shows in the rail only when nothing is selected. Site picks
    // the hotel only when nothing is selected.
    if (id === 'site' && !selection && hotelId()) {
      twin.select(hotelId());
      siteAutoSel = hotelId();
    }
    if (id === 'travelers' && !selection) screenApi.frame({ kind: 'topdown' });
    // Frame the storm by itself only the first time Weather opens in a
    // session (R2-5); the tile does it on demand after that.
    if (
      id === 'weather' &&
      ncView()?.ap?.core &&
      !selection &&
      !stormFramedOnce
    ) {
      stormFramedOnce = true;
      frameStorm();
    }
  }
  function pickStation(id) {
    if (!stationsOpen) setStationsOpen(true);
    if (id !== station) {
      leaveStation();
      station = id;
      save('station', id);
      enterStation(id);
    }
    gridMode = 'station';
    renderStations();
  }
  const scaleNow = () =>
    document.querySelector('.tt-tb.on[data-scale]')?.dataset.scale;
  const openLayers = () => {
    openPop('tt-layers');
    renderLayers();
  };
  /** Each station's own tiles (Back is added by the rail). Five at most. */
  function stationTiles(id) {
    const m = lastCtx?.mode;
    const incident = m?.mode === 'incident';
    const scaleTile = (key, label) => ({
      key,
      label,
      icon: ICON[key],
      on: scaleNow() === key,
      title: `${label} scale (${{ building: 1, neighborhood: 2, city: 3 }[key]})`,
      action: () => screenApi.scale(key),
    });
    const T = {
      layers: {
        key: 'layers',
        label: 'Layers',
        icon: ICON.layers,
        title: 'Layers (L)',
        action: openLayers,
      },
      waysOut: {
        key: 'waysOut',
        label: 'Ways out',
        icon: ICON.waysOut,
        on: Boolean(waysOut),
        title: 'Ways out view (W)',
        action: () => {
          toggleWaysOut();
          renderStations();
        },
      },
      next: {
        key: 'next',
        label: 'Next to check',
        icon: ICON.next,
        disabled: !flatNeeds().length,
        reason: 'No one to check',
        title: 'Select the next person to check (A, then ] and [)',
        action: () => {
          const list = flatNeeds();
          if (!list.length) return;
          attentionIndex = (attentionIndex + 1) % list.length;
          twin.selectPerson(list[attentionIndex].person.id, { frame: true });
        },
      },
      find: {
        key: 'find',
        label: 'Find a person',
        icon: ICON.find,
        title: 'Find a person (/)',
        action: () => hud.focusFind(),
      },
      sites: {
        key: 'sites',
        label: 'Sites & trips',
        icon: ICON.sites,
        title: 'Sites on this trip and trips on watch (S)',
        action: () => {
          openPop('tt-sites');
          renderSites();
        },
      },
    };
    const flag = (key, label, icon, on, title, toggle) => ({
      key,
      label,
      icon,
      on,
      title,
      action: () => {
        toggle(!on);
        renderLayers();
        renderStations();
      },
    });
    switch (id) {
      case 'site':
        return [
          scaleTile('building', 'Building'),
          scaleTile('neighborhood', 'Neighborhood'),
          scaleTile('city', 'City'),
          {
            key: 'floors',
            label: 'Floors',
            icon: ICON.building,
            title: 'The hotel card and its floors (go to a floor)',
            action: () => {
              if (!isHotelSel() && hotelId()) twin.select(hotelId());
              setTimeout(() => {
                const f = document.querySelector(
                  '#tt-card input[aria-label^="Go to floor"]',
                );
                f?.focus();
              }, 300);
            },
          },
          T.waysOut,
        ];
      case 'travelers':
        return [
          T.find,
          T.next,
          {
            key: 'topdown',
            label: 'From above',
            icon: ICON.topdown,
            title: 'Look straight down on the group (keeps the heading)',
            action: () => screenApi.frame({ kind: 'topdown' }),
          },
          flag(
            'floorsLayer',
            'Floor estimates',
            ICON.building,
            twin.layers.floors !== false,
            'People by floor estimate inside the hotel',
            (on) => screenApi.setLayer('floors', on),
          ),
        ];
      case 'incident': {
        const label = lastCtx?.reportedLabel;
        const has = Number.isFinite(label);
        return [
          {
            key: 'report',
            label: has ? `Floor ${label}` : 'Report floor',
            icon: ICON.report,
            on: has,
            disabled: appMode === 'advance',
            reason: 'Live only',
            title:
              appMode === 'advance'
                ? 'Reports are live data — switch to Live'
                : 'Add or change the reported floor (R)',
            action: () => openPop('tt-report'),
          },
          T.next,
          T.waysOut,
          {
            key: 'copy',
            label: 'Copy for responders',
            icon: ICON.copy,
            disabled: !incident,
            reason: 'Needs an incident',
            title: incident
              ? 'Copy the incident summary for responders'
              : 'Available with an incident',
            action: () =>
              document
                .querySelector('#tt-incident button.tt-btn.primary')
                ?.click(),
          },
          {
            key: 'frameFloor',
            label: has ? `Frame floor ${label}` : 'Frame floor',
            icon: ICON.topdown,
            disabled: !has,
            reason: 'Needs a floor',
            title: has
              ? `Look at floor ${label} and who may be on it`
              : 'Available once a floor is reported',
            action: () => focusFloor(label),
          },
        ];
      }
      case 'weather':
        return [
          {
            key: 'storm',
            label: 'Frame the storm',
            icon: ICON.storm,
            disabled: !ncView()?.ap?.core && !lastCtx?.weather?.approach,
            reason: 'No storm near',
            title:
              ncView()?.ap?.core || lastCtx?.weather?.approach
                ? 'Fit the site and the storm core in view'
                : 'No storm core on radar near the site',
            action: () => frameStorm(),
          },
          {
            key: 'timeline',
            label: 'Timeline',
            icon: ICON.timeline,
            title: 'Weather timeline (T)',
            action: () => focusWeather(),
          },
          flag(
            'radar',
            'Storm shells (3D)',
            ICON.radar,
            wx.layers.radar3d,
            'Storm shells from radar',
            (on) => screenApi.setLayer('radar3d', on),
          ),
          flag(
            'lightning',
            'Lightning',
            ICON.lightning,
            wx.layers.lightning,
            'Lightning strike density',
            (on) => screenApi.setLayer('lightning', on),
          ),
          flag(
            'alertAreas',
            'Official alert areas',
            ICON.sites,
            wx.layers.alertAreas,
            'Official warning areas',
            (on) => screenApi.setLayer('alertAreas', on),
          ),
        ];
      case 'day':
        return [
          {
            key: 'advance',
            label: appMode === 'advance' ? 'Back to Live' : 'Advance',
            icon: ICON.advance,
            on: appMode === 'advance',
            title: 'Live or Advance planning (V)',
            action: () =>
              setAppMode(appMode === 'advance' ? 'live' : 'advance'),
          },
          {
            key: 'sites',
            label: 'Sites',
            icon: ICON.sites,
            title: 'Sites on this trip (S)',
            action: () => {
              openPop('tt-sites');
              renderSites();
            },
          },
          {
            key: 'paths',
            label: 'Paths',
            icon: ICON.paths,
            title: 'Paths to the rally points',
            action: () => hud.openCard('safety'),
          },
        ];
      case 'trips':
        return [
          {
            key: 'switch',
            label: 'Switch trip',
            icon: ICON.trips,
            title: 'Trips on watch and their sites (S)',
            action: () => {
              openPop('tt-sites');
              renderSites();
            },
          },
        ];
      default:
        return [];
    }
  }
  /** 02 People's own panel (review/shell X8): headcount first. */
  function peoplePanel(node) {
    const add = (cls, t) => {
      const n = document.createElement('div');
      n.className = cls;
      n.textContent = t;
      node.append(n);
      return n;
    };
    node.replaceChildren();
    const a = lastA;
    if (!a?.counts) return add('tt-wall-note', 'People · loading');
    const c = a.counts;
    const hero = document.createElement('div');
    hero.className = 'tt-st-hero';
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(a.rows.length);
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = `people · ${c['Inside (likely)'] ?? 0} inside · ${(c['Not current'] ?? 0) + (c['Not located'] ?? 0)} not current or located · as of ${lastCtx?.asOf || ''}`;
    hero.append(n, t);
    node.append(hero);
    if (lastSiteCounts) {
      add('tt-kicker', 'BY SITE');
      add('tt-wall-line', siteCountsLine(lastSiteCounts, siteKey));
    }
    const ch = a.chaperones || [];
    if (ch.length) {
      const cur = ch.filter((r) => r.pos.current).length;
      add('tt-kicker', 'CHAPERONES');
      add(
        `tt-wall-line${ch.length - cur ? ' warn' : ''}`,
        `${ch.length} · ${cur} current${ch.length - cur ? ` · ${ch.length - cur} not current` : ''}`,
      );
    }
    add('tt-kicker', 'CHANGED · LAST 10 MIN');
    const recent = changeLog.filter((e) => Date.now() - e.at < 600000);
    if (!recent.length)
      add('tt-wall-line', 'Nothing changed in the last 10 min');
    for (const e of recent.slice(0, 6))
      add(`tt-wall-line${e.warn ? ' warn' : ''}`, changeText(e));
  }
  // ---- station panels (review/shell R2-1…R2-3) ----
  // One home per fact: the left cards keep the lists; a station panel
  // shows what the cards cannot, led by one big thin number.
  const elx = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  function heroRow(n, caption, level = '') {
    const h = elx('div', `tt-st-hero ${level}`);
    h.append(elx('span', 'n', n), elx('span', 't', caption));
    return h;
  }
  // R2-1: the Day plan panel's day (null = the default below).
  let stationDay = null;
  function defaultPlanDay() {
    const evs = advEvents();
    const today = todayDay();
    const now = planNow();
    const left = evs.filter(
      (e) => e.day === today && Number.isFinite(e.epoch) && e.epoch > now,
    );
    if (left.length || !evs.some((e) => e.day > today)) return today;
    return evs.find((e) => e.day > today)?.day ?? today;
  }
  // R2-2: another trip's report the operator has seen (this screen only,
  // logged; a new report on that trip raises the signal again).
  const seenReports = new Set();
  const reportKey = (o) =>
    `${o.trip.id}:${o.inc.id || `${o.inc.kind}-${o.inc.floor_label}`}`;
  let flashTrip = null;
  function switchToTrip(t) {
    const q = new URLSearchParams(location.search);
    q.set('city', t.city);
    q.set('scenario', t.scenario);
    q.set('site', t.city);
    location.search = `?${q}`;
  }
  function incidentCalmPanel(node) {
    const m = lastCtx?.mode;
    node.replaceChildren(
      heroRow(
        String(m?.total ?? 0),
        'to check on · no incident reported',
        m?.total ? 'attn' : '',
      ),
      elx('div', 'tt-kicker', 'WHEN A FLOOR IS REPORTED'),
      elx(
        'div',
        'tt-wall-line',
        'The incident board opens here: who may be at or above the floor, the floors, Copy for responders.',
      ),
      elx('div', 'tt-wall-note', 'Report floor is the first tile (R).'),
    );
  }
  function weatherHero() {
    const pill = weatherPill(nc.text, Boolean(nc.simStart), region === 'us');
    if (pill)
      return heroRow(
        pill.replace(/^SIM /, ''),
        `storm${nc.simStart ? ' (simulated)' : ''} · ${nc.text?.lead || 'radar track'}`,
        'attn',
      );
    const parts = [...$('tt-wx').children].map((n) => n.textContent.trim());
    return heroRow(parts[1] || '—', parts[2] || 'at the site');
  }
  function dayHero(day) {
    const now = planNow();
    const next =
      advEvents().find(
        (e) => e.day === day && Number.isFinite(e.epoch) && e.epoch > now,
      ) || advEvents().find((e) => e.day === day);
    return next
      ? heroRow(next.start, `Day ${day} · ${next.title}`)
      : heroRow('—', `Day ${day} · nothing on the plan`);
  }
  function dayChips(day) {
    const days = [...new Set(advEvents().map((e) => e.day))].sort(
      (x, y) => x - y,
    );
    const row = elx('div', 'tt-st-days');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Day');
    for (const d of days) {
      const b = elx(
        'button',
        `tt-st-day${d === day ? ' on' : ''}`,
        `Day ${d}${d === todayDay() ? ' · today' : ''}`,
      );
      b.type = 'button';
      b.setAttribute('aria-pressed', String(d === day));
      b.addEventListener('click', () => {
        stationDay = d;
        renderStations();
      });
      row.append(b);
    }
    return row;
  }
  function tripActions(node) {
    // Wall panel content, plus actions on the All-in-one: switch, seen.
    const others = otherTripIncidents();
    for (const card of node.querySelectorAll('.tt-trip')) {
      const title = card.querySelector('.t')?.textContent;
      const t = DEMO_TRIPS.find((x) => x.title === title);
      if (!t || t.id === focusTrip.id) continue;
      const acts = elx('div', 'tt-trip-acts');
      const sw = elx('button', 'tt-btn', 'Switch to this trip');
      sw.type = 'button';
      sw.title = 'Reloads the twin into this trip and its city';
      sw.addEventListener('click', () => switchToTrip(t));
      acts.append(sw);
      const o = others.find((x) => x.trip.id === t.id);
      if (o) {
        const key = reportKey(o);
        const seen = seenReports.has(key);
        const sb = elx(
          'button',
          `tt-btn${seen ? ' on' : ''}`,
          seen ? 'Seen' : 'Mark seen',
        );
        sb.type = 'button';
        sb.disabled = seen;
        sb.title =
          'This screen only: the aperture stops signalling this report; a new report raises it again';
        sb.addEventListener('click', () => {
          seenReports.add(key);
          changeLog.unshift({
            at: Date.now(),
            clock: lastCtx?.snapshot ? sampleClock(lastCtx.snapshot) : '',
            text: `Seen on this screen: report on ${t.title}`,
          });
          renderStations();
        });
        acts.append(sb);
      }
      if (flashTrip === t.id) card.classList.add('flash');
      card.append(acts);
    }
    flashTrip = null;
  }
  /** The station's panel in the rail's middle (rail size). */
  function renderStationPanel() {
    const p = stations?.panel;
    if (!p) return;
    const busy = ['tt-editor', 'tt-incident', 'tt-card'].some(
      (i) => $(i) && !$(i).hidden,
    );
    if (busy) return busy;
    // Leave the panel alone while the operator reads or scrolls it.
    if (p.matches(':hover') && p.childElementCount) return busy;
    if (station === 'site') {
      p.replaceChildren(
        elx('div', 'tt-kicker', 'NOTHING SELECTED'),
        elx(
          'div',
          'tt-wall-note',
          'Select the hotel, a place or a person on the map; its card shows here. Building, Neighborhood and City change the scale.',
        ),
      );
    } else if (station === 'travelers') peoplePanel(p);
    else if (station === 'incident') incidentCalmPanel(p);
    else if (station === 'weather') {
      const body = elx('div', 'tt-st-body');
      screenApi.weatherPanel(body);
      p.replaceChildren(weatherHero(), body);
    } else if (station === 'day') {
      const day = stationDay ?? defaultPlanDay();
      const body = elx('div', 'tt-st-body');
      screenApi.dayPanel(body, day);
      p.replaceChildren(dayHero(day), dayChips(day), body);
    } else if (station === 'trips') {
      screenApi.tripsPanel(p);
      tripActions(p);
    }
    return busy;
  }
  // Another trip on watch with a reported incident (D1). Cached 30 s:
  // building every trip's snapshot is not free.
  let otherIncCache = { at: 0, v: [] };
  function otherTripIncidents() {
    const now = Date.now();
    if (otherIncCache.at > now - 30000) return otherIncCache.v;
    const v = DEMO_TRIPS.filter((t) => t.id !== focusTrip.id)
      .map((t) => ({
        trip: t,
        inc: (tripTwinDemoSnapshot(t.city, t.scenario, {
          now,
          startMs: scenarioEpoch,
        }).reported_incidents || [])[0],
      }))
      .filter((x) => x.inc);
    otherIncCache = { at: now, v };
    return v;
  }
  /**
   * Every signal the shell shows, worst first (review/shell X4): an
   * incident here, an incident on another trip, an official warning, a
   * storm on its way, people to check, delayed data, simulated data. The
   * station tiles, Back, the aperture and the top bar all read this list.
   */
  function shellSignals() {
    const m = lastCtx?.mode;
    const w = lastCtx?.weather;
    const out = [];
    if (m && (m.mode === 'incident' || m.mode === 'incident_elsewhere'))
      out.push({
        station: 'incident',
        level: 'hazard',
        text: 'REPORTED',
        say: 'incident reported',
      });
    for (const o of otherTripIncidents())
      out.push({
        station: 'trips',
        level: 'hazard',
        text: 'REPORTED',
        say: `incident reported on ${o.trip.title}`,
        other: o,
        seen: seenReports.has(reportKey(o)),
      });
    // Official lines (round 2): a real warning says WARNING; the demo
    // alert SIM WARNING; a source that is down NOT CHECKED.
    const off = officialLines();
    const real = off.find((l) => l.official);
    const sim = off.find((l) => l.sim);
    const down = off.find((l) => l.warn);
    if (real)
      out.push({
        station: 'weather',
        level: 'attn',
        text: 'WARNING',
        say: 'official weather warning',
      });
    else if (sim)
      out.push({
        station: 'weather',
        level: 'attn',
        text: 'SIM WARNING',
        say: 'simulated weather warning',
      });
    const pill = weatherPill(nc.text, Boolean(nc.simStart), region === 'us');
    if (pill)
      out.push({
        station: 'weather',
        level:
          nc.text?.status === 'arriving' && nc.text?.level !== 'attention'
            ? 'watch'
            : 'attn',
        text: pill,
        say: `storm ${pill.toLowerCase()}`,
      });
    // Lightning near the site, or a heat detection nearby (round 2).
    if (w?.lightningNear?.inside || w?.lightning)
      out.push({
        station: 'weather',
        level: 'attn',
        text: 'LIGHTNING',
        say: 'lightning near the site',
      });
    if (/heat detection [\d.]/i.test(lastCtx?.fires?.line || ''))
      out.push({
        station: 'weather',
        level: 'attn',
        text: 'HEAT',
        say: 'heat detection nearby',
      });
    if (down)
      out.push({
        station: 'weather',
        level: 'attn',
        text: 'NOT CHECKED',
        say: 'official alerts not checked',
      });
    if (m?.total)
      out.push({
        station: 'incident',
        level: 'attn',
        text: String(m.total),
        say: `${m.total} to check on`,
      });
    if (m?.degraded)
      out.push({
        station: null,
        level: 'attn',
        text: 'DELAYED',
        say: 'traveler data delayed',
      });
    if (simulationOn())
      out.push({
        station: null,
        level: 'sim',
        text: 'SIM',
        say: 'simulated data on',
      });
    return out;
  }
  function renderStations() {
    if (!stations) return;
    // The top-bar chip for another trip's incident (D1).
    const other = otherTripIncidents()[0];
    const chip = $('tt-other-alert');
    chip.hidden = !other;
    if (other) {
      const seen = seenReports.has(reportKey(other));
      chip.textContent = `OTHER TRIP · ${other.trip.title.toUpperCase()} · REPORTED${seen ? ' · SEEN' : ''} › 06`;
      chip.classList.toggle('seen', seen);
    }
    const m = lastCtx?.mode;
    const age = formatAge((Date.now() - lastFeed) / 1000);
    const advance = appMode === 'advance';
    const sig = shellSignals();
    const badges = {};
    for (const x of sig)
      if (x.station && !badges[x.station])
        badges[x.station] = { text: x.text, level: x.level };
    // Back carries this trip's worst signal; another trip's report lives on
    // 06, the top-bar chip and the aperture bead (review/shell round 2).
    const mine = sig.filter((x) => !x.other);
    const top = mine.find((x) => x.level !== 'sim') || null;
    const otherOn = sig.some((x) => x.other && !x.seen);
    const busy = renderStationPanel();
    stations.render({
      station,
      mode: gridMode,
      tiles: gridMode === 'station' ? stationTiles(station) : [],
      panelBusy: busy,
      open: stationsOpen,
      statusText: advance
        ? `ADVANCE${m?.degraded ? ' · DATA DELAYED' : ''}${simulationOn() ? ' · SIMULATED' : ''} · data ${age}`
        : `${m?.degraded ? '● DATA DELAYED' : simulationOn() ? '● SIMULATED' : '● LIVE'} · data ${age}`,
      statusLevel: advance ? 'advance' : m?.degraded ? 'stale' : 'live',
      badges,
      backBadge: top ? { text: top.text, level: top.level } : null,
      // Ring and bead red for this trip's incident; bead only for another
      // trip's; amber for attention; steel when calm.
      signal:
        top?.level === 'hazard'
          ? 'incident'
          : otherOn
            ? 'other'
            : top
              ? 'attention'
              : 'calm',
      signalText: sig.map((x) => x.say).join(' · '),
    });
  }
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
  let boardFit = null;
  const hud = createHud({
    fitFirst: () => boardFit?.(),
    rail: $('tt-rail'),
    incident: $('tt-incident'),
    onCardToggle: (key, on) => save(`card.${key}`, on ? '1' : '0'),
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
    // The caret is a control: a wall at rest hides it (screens F27).
    cutHead.replaceChildren(
      'Floors ',
      Object.assign(document.createElement('span'), {
        className: 'tt-caret',
        textContent: cutawayOpen ? '▾' : '▸',
      }),
    );
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
            // Street photo of the site, after Floors (IA round 1).
            ...(photoOnWall
              ? []
              : [
                  photoNode(
                    photoTargetFor('site', {
                      site: SITES.find((x) => x.key === siteKey) || SITES[0],
                    }),
                    city.short || city.label,
                  ),
                  // Traffic cameras near the site; during a report here
                  // they go to the Incident wall (traffic-cameras T5).
                  cameraNode(
                    `${inIncident() ? 'incident' : siteKey === SITES[0].key ? 'hotel' : 'stop'}:${siteKey}`,
                  ),
                ]),
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
      live: `NASA FIRMS · ${f.fetchedAt && formatAge((Date.now() - Date.parse(f.fetchedAt)) / 1000) ? `updated ${formatAge((Date.now() - Date.parse(f.fetchedAt)) / 1000)} ago` : 'update time not reported'}`,
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
    // S5's shown stop is among the four shown, first (S5 r2).
    // Hazard and weather chips come next, so the four-chip cut never drops
    // one silently (hazards H4).
    const rank = (c) =>
      (c.hz ? 4 : 0) + (c.shown ? 2 : 0) + (c.wx || c.hazard ? 1 : 0);
    const list = [...chips]
      .sort((x, y) => rank(y) - rank(x))
      .slice(0, max)
      .map((c) => {
        const b = document.createElement(c.onClick ? 'button' : 'span');
        if (c.onClick) {
          b.type = 'button';
          b.addEventListener('click', c.onClick);
        }
        b.className = `tt-chip${c.hz ? ' hz' : ''}${c.wx ? ` wx ${c.wx}` : ''}${c.draft || c.missing ? ' draft' : ''}${c.hazard ? ' hazard' : ''}${c.people ? ' people' : ''}${c.site ? ' site' : ''}${c.shown ? ' shown' : ''}${c.id && c.id === selId ? ' on' : ''}`;
        if (c.id && c.id === selId) b.setAttribute('aria-current', 'true');
        if (c.merged) b.dataset.merged = c.merged;
        b.textContent =
          c.missing || c.people || c.plain
            ? c.label
            : // "Long Center · Day 2 · 0.8 mi W": a label ending in a number
              // gets a dot, so "Day 2 0.8" never reads as one figure (S5 IA).
              `${c.label}${/\d$/.test(c.label) ? ' ·' : ''} ${c.distance} ${c.bearing}`;
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
    mapLabels,
    glowStyle: glowParam,
    simulateFires: $('tt-simfire').checked,
    // Phase 9 (review O1): a path card never outlives its line.
    onDrawnPaths: (id) => onDrawnPathsChange(id),
    onEntityPick: (id) => {
      if (/^wx-/.test(id)) return showInspect(id);
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
      hzPic = hazardNow(a, info);
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
        // A fire boundary or a cone at amber outranks a heat detection
        // (hazards H5 badge order).
        hazard: weather.lightning
          ? { text: weather.lightning.text }
          : hzPic?.check
            ? { text: hazardLead(hzPic), next: hazardNext(hzPic) }
            : fires.hazard || null,
        dataAgeS: ageS,
        // People inside or within 1 km of a fire boundary (hazards H5).
        nearFire: new Set(hzPic?.peopleNearFire || []),
        nearFireSim: Boolean(hzPic?.fireCheck?.some((f) => f.simulated)),
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
      chip.textContent = mode.chip + chipSuffix();
      chip.className = `tt-mode ${mode.mode}${mode.degraded ? ' degraded' : ''}`;
      $('tt-age').textContent = `data ${formatAge(ageS)}`;
      $('tt-age').title = `Traveler data ${formatAge(ageS)} old`;
      $('tt-age').classList.toggle('warn', mode.degraded);
      // The trip clock is fictional; weather times are real (phase 6 UX P0-1).
      $('tt-clock').textContent = `${clock} sample`;
      $('tt-clock').title =
        'Sample trip clock (fictional). Weather times are real local time with their zone.';
      // The trip on watch for this city names the crumb; the sample
      // snapshot's own title is generic.
      $('tt-crumb-trip').textContent =
        tripForCity(cityKey)?.title || snap.trips[0].title;
      $('tt-crumb-trip').title = 'Trips on watch · switch trip (S)';
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
      const ncChip = approachChip();
      const wxChips =
        ltg && ltg.d <= 15000
          ? [
              {
                label: `${wx.sim.lightning || nc.sim ? 'SIMULATED ' : ''}Lightning`,
                distance: formatDistance(ltg.d),
                bearing: bearingLabel(city.center, ltg.pt),
                // Amber: lightning is attention; red is reported incidents.
                wx: 'attention',
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
              // Never folds, and ranks with the hazards (round 2).
              hz: true,
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
          // S5: the shown stop's chip is marked and steps out last.
          shown:
            document.body.classList.contains('tt-wall-shell') &&
            appMode === 'advance' &&
            advEvents().find((e) => e.key === adv.eventKey)?.siteKey === x.key,
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
              ...ncChip,
              ...wxChips,
              ...hazardChips(hzPic),
              ...placeChips.filter((c) => !c.people),
            ]
          : [
              ...incidentChips,
              ...ncChip,
              ...wxChips,
              ...hazardChips(hzPic),
              ...placeChips,
            ],
      );
      lastA = a;
      logChanges(a, mode, sampleClock(snap), incident);
      if (document.body.dataset.view !== 'screen')
        document.body.classList.toggle(
          'tt-incident-open',
          mode?.mode === 'incident',
        );
      lastCtx = {
        mode,
        numbering,
        night: info.night,
        paths: info.paths,
        pathsLoading: info.pathsLoading,
        fires: { ...fires, simulated: info.fires.simulated },
        hazards: hzPic,
        fireBounds: hzPic?.fires.map((f) => f.row) || [],
        hazardLines: hazardCardLines(hzPic),
        hazardLead: hzPic?.check ? hazardLead(hzPic) : null,
        reportedLabel: info.reportedLabel,
        incident,
        weather,
        avoidAreas: pathStore.areas,
        hotelCard: twin.activePlace()?.hotel_card || null,
        siteNoun: city.kind === 'lodging' ? 'hotel' : 'venue',
        // Walls name the trip a calm line is about (walls-live W1).
        tripTitle: focusTrip.title,
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
          ...(hzPic ? [hzPic.fireStatus, hzPic.tropStatus] : []),
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
      redrawHazards();
      compass.setHazards?.(hazardTicks(hzPic));
      renderStations();
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
      // The opening and closing animations need every frame.
      if (['loading', 'entering', 'closing'].includes(state))
        holdContinuousRender('twin-transition');
      else releaseContinuousRender('twin-transition');
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
      stormLayer?.dispose();
      stormLayer = createStormLayer(viewer, site);
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
    // Trips on watch (Jesse, 16 Oct): the All-in-one switches trip and city
    // here too, not only from the remote or the URL. A switch reloads the
    // twin into that trip's city with its own sample scenario.
    const CITY_LABEL = {
      austin: 'Austin',
      dc: 'Washington DC',
      london: 'London',
    };
    const tripsHead = document.createElement('div');
    tripsHead.className = 'tt-kicker tt-pop-group';
    tripsHead.textContent = 'TRIPS ON WATCH · SWITCH TRIP AND CITY';
    const trips = document.createElement('ul');
    trips.className = 'tt-site-list';
    for (const t of DEMO_TRIPS) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const here = t.id === focusTrip.id;
      b.className = here ? 'on' : '';
      const name = document.createElement('span');
      name.textContent = `${t.title} · ${t.org}`;
      const meta = document.createElement('span');
      meta.className = 'tt-dim';
      meta.textContent = `${CITY_LABEL[t.city] || t.city}${here ? ' · on screen' : ' · switch (reloads the twin)'}`;
      b.append(name, meta);
      b.addEventListener('click', () => {
        closePops();
        if (here) return;
        const q = new URLSearchParams(location.search);
        q.set('city', t.city);
        q.set('scenario', t.scenario);
        q.set('site', t.city); // land on that trip's hotel
        location.search = `?${q}`;
      });
      li.append(b);
      trips.append(li);
    }
    root.replaceChildren(title, list, whole, tripsHead, trips);
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
    // Nothing from the old site carries over (QA D13).
    nc.res = null;
    nc.sim = null;
    nc.text = null;
    nc.realText = null;
    nc.alerts = [];
    nc.past.clear();
    nc.simGrid.clear();
    nc.ltgSeenAt = nc.ltgLastKm = nc.ltgPrevKm = null;
    inspectEl.hidden = true;
    stormKey = '';
    loadNowcast();
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
    // Each panel counts on the side of the screen it sits on: a wall puts
    // its cards on the left (screens/70-S2-FIX-LIST G1).
    const mid = innerWidth / 2;
    const boxes = ['tt-editor', 'tt-incident', 'tt-card', 'tt-st', 'tt-wst']
      .map(visibleBox)
      .filter(Boolean);
    // S4's cards are a panel in the left column; its dock along the
    // bottom (S4 reviews: labels under the cards, framing off-centre).
    const box = (el) => {
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height ? r : null;
    };
    // The panel is display: contents there; the column is the box.
    const wxCards =
      ['weather', 'day'].includes(document.body.dataset.role) &&
      document.body.classList.contains('tt-wall-shell')
        ? box($('tt-rcol'))
        : null;
    const dock = document.body.classList.contains('tt-wall-map')
      ? box(document.querySelector('.tt-wxtl')) ||
        box(document.querySelector('.tt-wxdock'))
      : null;
    // On S5 the Advance panel steps away for the cards (B5-S5-PLAN).
    const leftBoxes = [
      visibleBox('tt-rail') || (wxCards ? null : visibleBox('tt-advance')),
      wxCards,
      ...boxes.filter((r) => r.left + r.width / 2 < mid),
    ].filter(Boolean);
    const left = leftBoxes.length
      ? { right: Math.max(...leftBoxes.map((r) => r.right)) }
      : null;
    const right = boxes.filter((r) => r.left + r.width / 2 >= mid);
    const bar = $('tt-bar').getBoundingClientRect();
    // The dock hides while the stations rail is open: use the footer then.
    const tools = visibleBox('tt-toolbar') || {
      top: innerHeight - 40,
    };
    return {
      left: left ? left.right : 0,
      right: right.length
        ? innerWidth - Math.min(...right.map((r) => r.left))
        : 0,
      top: (visibleBox('tt-mapbar') || bar).bottom + 24,
      bottom:
        innerHeight - Math.min(tools.top, dock ? dock.top - 24 : Infinity),
    };
  });
  /** Any simulated feed on (review/phase5 J9). */
  function simulationOn() {
    return (
      $('tt-simfire').checked ||
      $('tt-simlightning').checked ||
      $('tt-simrain').checked ||
      $('tt-simsnow').checked ||
      Boolean(nc.simStart) ||
      Boolean(hazardLoad?.sim().fire || hazardLoad?.sim().cyclone)
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
    // The menu button carries the flag while its contents are hidden.
    $('tt-more-btn').classList.toggle('sim', on);
    $('tt-more-btn').title = on
      ? 'Simulated data is on · Prototype controls (`) · Keyboard shortcuts (?)'
      : 'Prototype controls (`) · Keyboard shortcuts (?)';
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
          fireBounds: twin.fireBounds?.() || [],
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
      [
        // What the open space looks like; never for a hospital, police or
        // fire station, where a door in a photo can read as "open" (P5).
        ...(!photoOnWall &&
        /^(rally_primary|rally_secondary|safe_house|shelter|relocation)$/.test(
          p.category,
        )
          ? [
              photoNode(
                photoTargetFor('place', { place: p }),
                p.name || label,
                { controls: false },
              ),
            ]
          : []),
        routeNode,
      ],
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
  /** The initials walls show beside a review tick (this viewer's). */
  const reviewer = () => {
    const v = String(pref('reviewer', '') || '').toUpperCase();
    return /^[A-Z]{1,3}$/.test(v) ? v : null;
  };
  const stamp = () =>
    `${reviewer() || 'you'} · ${new Date().toLocaleString('en-US', {
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
  // Ticks survive a reload of this tab (the walls keep theirs, so the two
  // agree); notes stay this page's only.
  try {
    Object.assign(
      adv.checks,
      JSON.parse(sessionStorage.getItem('tripTwin.reviewChecks') || '{}'),
    );
  } catch {
    /* no tab storage: ticks live as long as this page */
  }
  function keepChecks() {
    try {
      sessionStorage.setItem(
        'tripTwin.reviewChecks',
        JSON.stringify(adv.checks),
      );
    } catch {
      /* per-tab convenience only */
    }
  }
  // Whether ticks reach the walls, beside the checks; never silent.
  onReviewLink(() => renderAdvance(true));
  // Every tick made here, for the walls whenever the link joins.
  setReviewSnapshot(() =>
    Object.keys(adv.checks).map((k) => {
      const i = k.lastIndexOf(':');
      return {
        stop: k.slice(0, i),
        item: k.slice(i + 1),
        on: true,
        initials: reviewer(),
      };
    }),
  );
  // ---- street photos (review/street-photos P5) ----
  // The proxy finds public photos near each place; twinStreetPhotos.js picks
  // one and words it. Walls show S1's hotel and S5's stop on a plate (see
  // twinScreen.js) with the session's kept photos; the All-in-one shows a
  // block in the site, place and stop-brief cards, keeps its picks in this
  // browser per trip and sends them to the walls (the review tick's pattern).
  const photoOnWall = Boolean(params.get('view'));
  const FAILED_FOR_MS = 5 * 60e3;
  const photoFailed = new Map(); // `${provider}:${id}` → failed at
  const photoBrowse = {}; // place key → index browsed here (All-in-one)
  const photoWatchers = new Set();
  const notifyPhotos = () => {
    for (const fn of photoWatchers) fn();
  };
  const photoLoader = createPhotoLoader({ onChange: notifyPhotos });
  const photoTripId = () => tripForCity(cityKey)?.id || '';
  const PICKS = 'tripTwin.photoPicks.';
  function localPicks(trip = photoTripId()) {
    try {
      return JSON.parse(localStorage.getItem(PICKS + trip) || '{}') || {};
    } catch {
      return {};
    }
  }
  /** This browser's pick for a place: a keep or a hide, never a clear. */
  const activePick = (key) => {
    const r = localPicks()[key];
    return r && !r.clear ? r : null;
  };
  function setLocalPick(place, rec) {
    const trip = photoTripId();
    const all = localPicks(trip);
    // A clear stays as a marker, so it reaches walls that missed it
    // (every-time P1-4).
    all[place] = rec || { clear: true, at: Date.now() };
    try {
      localStorage.setItem(PICKS + trip, JSON.stringify(all));
    } catch {
      /* this page only */
    }
    sendPhoto(
      rec
        ? { tripId: trip, place, ...rec, initials: reviewer() }
        : { tripId: trip, place, clear: true },
    );
    notifyPhotos();
  }
  // Every trip's picks, clears included, for the walls whenever the link
  // joins (every-time P0-2, P1-4).
  setPhotoSnapshot(() => {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(PICKS)) continue;
        const trip = k.slice(PICKS.length);
        for (const [place, r] of Object.entries(localPicks(trip)))
          out.push(
            r.clear
              ? { tripId: trip, place, clear: true }
              : { tripId: trip, place, ...r, initials: reviewer() },
          );
      }
    } catch {
      /* no storage: nothing to send */
    }
    return out;
  });
  onReviewLink(() => notifyPhotos());
  /** An image that would not load: the next photo is tried for 5 min. */
  function markPhotoFailed(url) {
    try {
      const q = new URL(url, location.href).searchParams;
      photoFailed.set(`${q.get('p')}:${q.get('id')}`, Date.now());
    } catch {
      return;
    }
    notifyPhotos();
  }
  const hasFailed = (p) => {
    const k = `${p.provider}:${p.id}`;
    const at = photoFailed.get(k);
    if (at && Date.now() - at > FAILED_FOR_MS) photoFailed.delete(k);
    return photoFailed.has(k);
  };
  /** The site a stop photo shows: S5's shown stop, else the hotel. */
  function shownStopSite() {
    const k = advEvents().find((e) => e.key === adv.eventKey)?.siteKey;
    return SITES.find((x) => x.key === k) || SITES[0];
  }
  /** What a photo is of: the hotel (S1), a stop's site, or a safety place. */
  function photoTargetFor(kind, { site = null, place = null } = {}) {
    if (kind === 'place') return photoTarget({ kind, place });
    const s = site || (kind === 'hotel' ? SITES[0] : shownStopSite());
    const k = s.key === SITES[0].key ? 'hotel' : 'stop';
    // Aimed at the building, not a mapped door: the remote has no map data,
    // and every surface must show the same photo (round 1).
    return photoTarget({ kind: k, site: s });
  }
  /**
   * One place's photo for a surface: {target, ranked, pick, index, wallsIndex,
   * lines, url}. kept: the session's choice (walls) or this browser's
   * (All-in-one, where = 'aio': a hidden photo stays visible to the operator,
   * and browsing shows other photos without changing the walls).
   */
  function photoInfo(
    target,
    { kept = null, w = 960, browse = false, where = 'wall' } = {},
  ) {
    photoLoader.want(target);
    const search = photoLoader.get(target);
    const hiddenHere = where === 'aio' && Boolean(kept?.hide);
    const use = hiddenHere ? null : kept;
    const all = rankPhotos(search?.items || [], target, { keep: use });
    const ranked = all.filter((p) => !hasFailed(p));
    const failed =
      all.length > 0 && (!ranked.length || all.length - ranked.length >= 3);
    let pick = pickPhoto(failed ? [] : ranked, target, use);
    const wallsIndex = pick.photo ? ranked.indexOf(pick.photo) : -1;
    let index = wallsIndex;
    const b = photoBrowse[target.key];
    if (browse && Number.isInteger(b) && ranked.length && pick.photo) {
      index = Math.min(b, ranked.length - 1);
      const p = ranked[index];
      const isKept = use?.id === p.id && use?.provider === p.provider;
      pick = {
        photo: p,
        kept: isKept,
        view:
          isKept && Number.isFinite(use.yaw)
            ? { ...wallView(p, target), yaw: use.yaw, pitch: use.pitch ?? 0 }
            : wallView(p, target),
      };
    }
    const lines = photoLines({
      search,
      pick,
      target,
      failed,
      now: planNow(),
      unit: getDistanceUnit(),
      where,
    });
    const notes = [lines.note];
    if (hiddenHere) notes.unshift('Hidden on walls');
    else if (browse && index !== wallsIndex && wallsIndex >= 0)
      notes.unshift(
        `Browsing here · walls show ${use?.id ? 'the kept photo' : 'photo'} ${wallsIndex + 1} of ${ranked.length}`,
      );
    lines.note = notes.filter(Boolean).join(' · ') || null;
    return {
      target,
      ranked,
      pick,
      index,
      wallsIndex,
      hidden: hiddenHere,
      lines,
      url: photoUrl(pick, w),
    };
  }
  /**
   * Where the shown photo was taken, on the map (UI spec §4): only while a
   * plate or block shows it and it stands on this site's ground. owner: the
   * block's place key (its marker goes when the block leaves the page).
   */
  let photoMark = null;
  let photoMarkSig = '';
  let photoMarkOwner = null;
  function markPhoto(info, owner = null) {
    const p = info?.pick?.photo;
    const site = twin.site;
    const ready = twin.state === 'ready' || twin.state === 'degraded';
    const near = p && haversineM(city.center, p) < 1500;
    const look = info?.lines?.look ?? null;
    const fov = info?.pick?.view?.fov || p?.fov || 60;
    const sig =
      p && near && ready && site
        ? `${p.provider}:${p.id}:${Math.round(look ?? -1)}:${fov}:${scaleNow()}`
        : '';
    photoMarkOwner = sig ? owner : null;
    if (sig === photoMarkSig) return;
    photoMarkSig = sig;
    photoMark?.();
    photoMark = null;
    if (sig)
      photoMark = drawPhotoMarker(viewer, site, {
        photo: p,
        look,
        fov,
        scale: scaleNow(),
        wall: photoOnWall,
      });
  }
  const photoNodes = new Map(); // place key → {box, redraw} (reused)
  // A block's marker goes with its card (every-time P2-6).
  const markWatch = setInterval(() => {
    const n = photoMarkOwner && photoNodes.get(photoMarkOwner);
    if (n && !n.box.isConnected) markPhoto(null);
  }, 1500);
  cleanups.push(() => clearInterval(markWatch));
  const linkNote = () => {
    const st = reviewLinkState();
    if (st === 'ok') return null;
    return st === 'none'
      ? 'No walls linked to this All-in-one · picks are kept here'
      : 'Not reaching the walls right now · picks are sent when the link rejoins';
  };
  /**
   * The All-in-one's block for one place. controls: Keep / Hide reach the
   * walls (the hotel, a stop); a rally point or shelter only browses and
   * opens, since no wall shows it (IA round 1).
   */
  function photoNode(target, title, { controls = true } = {}) {
    const old = photoNodes.get(target.key);
    if (old) {
      old.redraw();
      return old.box;
    }
    const box = document.createElement('div');
    box.className = 'tt-photo-slot';
    let sig = '';
    let latest = null;
    const step = (d) => {
      if (!latest?.ranked.length) return;
      photoBrowse[target.key] =
        (Math.max(0, latest.index) + d + latest.ranked.length) %
        latest.ranked.length;
      draw();
    };
    const keep = (view = null) => {
      const p = latest?.pick.photo;
      if (!p) return;
      const v = view || latest.pick.view;
      delete photoBrowse[target.key];
      setLocalPick(target.key, {
        provider: p.provider,
        id: p.id,
        ...(v ? { yaw: v.yaw, pitch: v.pitch } : {}),
      });
    };
    // Hide also deletes the photo's saved images on this server (Jesse, 27
    // Oct): the one walls show and the one shown here.
    const hide = () => {
      const seen = [latest?.ranked[latest.wallsIndex], latest?.pick.photo];
      for (const p of new Set(seen.filter(Boolean)))
        fetch(
          `/api/twin-photos/forget?p=${p.provider}&id=${encodeURIComponent(p.id)}`,
          { method: 'POST' },
        ).catch(() => {});
      setLocalPick(target.key, { hide: true });
    };
    // Reads the latest state each time: Previous / Next reopen on the new
    // photo (AIA round 1).
    const open = () => {
      const info = latest;
      const p = info?.pick.photo;
      if (!p) return;
      openPhotoViewer({
        title: `STREET PHOTO · ${title}`,
        pick: info.pick,
        fullUrl: `/api/twin-photos/full?p=${p.provider}&id=${encodeURIComponent(p.id)}`,
        lines: info.lines,
        longFoot: PHOTO_LONG_FOOT,
        index: info.index,
        count: info.ranked.length,
        faceLabel: `Face ${target.words}`,
        controls,
        linkNote: controls ? linkNote() : null,
        onPrev: () => {
          step(-1);
          open();
        },
        onNext: () => {
          step(1);
          open();
        },
        onUseView: (v) => keep(v),
        onKeep: () => keep(),
        onHide: hide,
      });
    };
    function draw() {
      const kept = activePick(target.key);
      const info = photoInfo(target, {
        kept,
        w: 480,
        browse: true,
        where: 'aio',
      });
      latest = info;
      // The site's own photo marks the map; a rally point's while open.
      if (box.isConnected) markPhoto(info, target.key);
      const link = controls ? linkNote() : null;
      // Redrawn only when what it shows changes: no image reload per tick.
      const next = JSON.stringify([
        info.url,
        info.lines,
        info.index,
        kept,
        link,
      ]);
      if (next === sig) return;
      sig = next;
      box.replaceChildren(
        photoBlock({
          ...info,
          // Hidden on walls: seen here, never saved again.
          url: info.hidden && info.url ? `${info.url}&store=0` : info.url,
          count: info.ranked.length,
          kept: Boolean(info.pick.kept),
          hidden: info.hidden,
          controls,
          linkNote: link,
          longFoot: PHOTO_LONG_FOOT,
          onPrev: () => step(-1),
          onNext: () => step(1),
          onOpen: open,
          onKeep: () => keep(),
          onHide: hide,
          onAuto: () => {
            delete photoBrowse[target.key];
            setLocalPick(target.key, null);
          },
          onFail: markPhotoFailed,
        }),
      );
    }
    photoWatchers.add(draw);
    photoNodes.set(target.key, { box, redraw: draw });
    draw();
    return box;
  }
  // ---- traffic cameras (review/traffic-cameras T5) ----
  // The proxy lists public cameras near a place and shares their stills.
  // The All-in-one sends one camera to one wall (by its role); the walls
  // show the session's camera; nothing starts by itself.
  const camWatchers = new Set();
  const notifyCameras = () => {
    for (const fn of camWatchers) fn();
  };
  const camLoader = createPhotoLoader({
    onChange: notifyCameras,
    url: (t) =>
      `/api/twin-cameras/near?lat=${t.lat.toFixed(5)}&lon=${t.lon.toFixed(5)}&r=${t.r || CAMERA_NEAR_M}`,
  });
  const CAMERA_ROLE = { hotel: 'site', stop: 'day', incident: 'incident' };
  const CAMERA_WALL = {
    site: 'the Site wall',
    day: 'the Day plan wall',
    incident: 'the Incident wall',
  };
  // What the walls show, as the relay tells it (the All-in-one sees no
  // session): {camera, refused}; pending while a send is on its way.
  let camOnWalls = { camera: null, refused: null };
  let camPending = null;
  onCameraState((m) => {
    camOnWalls = m;
    camPending = null;
    notifyCameras();
  });
  // A send with no answer is said, never "Sending…" for ever (round 2).
  let camPendingTimer = null;
  const camAwait = () => {
    clearTimeout(camPendingTimer);
    camPendingTimer = setTimeout(() => {
      if (!camPending) return;
      camPending = null;
      camOnWalls = { ...camOnWalls, refused: 'no answer from the walls' };
      notifyCameras();
    }, 8000);
  };
  onReviewLink(() => notifyCameras());
  /** A camera place key → {lat, lon, words, key, r}. */
  function cameraTarget(placeKey) {
    const [kind, k] = String(placeKey || '').split(':');
    const site = SITES.find((x) => x.key === k) || SITES[0];
    const words = photoTarget({
      kind: site.key === SITES[0].key ? 'hotel' : 'stop',
      site,
    }).words;
    return {
      lat: site.center.lat,
      lon: site.center.lon ?? site.center.lng,
      words,
      key: `${kind}:${site.key}`,
      r: kind === 'incident' ? CAMERA_INCIDENT_M : CAMERA_NEAR_M,
    };
  }
  function camerasNear(target) {
    camLoader.want(target);
    const search = camLoader.get(target);
    return { search, cameras: rankCameras(search?.cameras || [], target) };
  }
  /** What a wall shows for the session's camera, or null while it loads. */
  function cameraForWall(sc, frame) {
    if (!sc?.id || !sc.place) return null;
    const target = cameraTarget(sc.place);
    const { search } = camerasNear(target);
    const camera = (search?.cameras || []).find((c) => c.id === sc.id);
    if (!camera) return null;
    return {
      camera,
      lines: cameraLines({
        camera,
        target,
        frame,
        state: frame?.state || 'loading',
        unit: getDistanceUnit(),
      }),
    };
  }
  let cameraPlayer = null;
  async function openCamera(c, target) {
    // A still opens in Trip Twin's own viewer, through the proxy: Justin's
    // player fetches upstream frames directly, which can fall back to Street
    // View (UI round 1, P0).
    if (c.kind === 'still') {
      openCameraViewer({
        camera: c,
        lines: (frame) =>
          cameraLines({
            camera: c,
            target,
            frame,
            state: frame?.state || 'loading',
            unit: getDistanceUnit(),
          }),
      });
      return;
    }
    // Clips and live video: Justin's player, loaded on demand (hls.js).
    if (!cameraPlayer) {
      const { createCameraPlayer } = await import('../cameraPlayer.js');
      cameraPlayer = createCameraPlayer();
      cleanups.push(() => cameraPlayer?.dispose?.());
    }
    cameraPlayer.open({ id: c.id, name: cameraName(c.name) });
    hideReferenceImages();
  }
  /** In Justin's player, a Street View or drawn fallback is not shown. */
  function hideReferenceImages() {
    const dlg = document.querySelector('dialog.ops-camera-player');
    if (!dlg || dlg.dataset.ttWatched) return;
    dlg.dataset.ttWatched = '1';
    const check = () => {
      const st = dlg.querySelector('.ops-camera-status')?.textContent || '';
      dlg.classList.toggle('tt-ref-only', /reference image/i.test(st));
    };
    new MutationObserver(check).observe(dlg, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }
  const cameraNodes = new Map(); // place key → {box, redraw}
  /** The All-in-one's camera list for a place (hotel, stop or incident). */
  function cameraNode(placeKey) {
    const old = cameraNodes.get(placeKey);
    if (old) {
      old.redraw();
      return old.box;
    }
    const box = document.createElement('div');
    box.className = 'tt-cam-slot';
    let sig = '';
    let open = false;
    const role = CAMERA_ROLE[placeKey.split(':')[0]] || 'site';
    function draw() {
      const target = cameraTarget(placeKey);
      const { search, cameras } = camerasNear(target);
      const up = camOnWalls.camera;
      const shownId = up?.place === target.key ? up.id : null;
      const linked = reviewLinkState() === 'ok';
      const rows = cameras.map((c) => ({
        ...c,
        distText: `${formatDistance(c.d)} ${bearingLabel(target, c)}`,
      }));
      // What the walls show, whichever list this is (IA, every-time P1).
      const upName =
        up && (rows.find((c) => c.id === up.id)?.name || 'a traffic camera');
      const status = !linked
        ? up
          ? 'Not linked to the walls · what they show is not known here'
          : null
        : camPending
          ? 'Sending to the walls…'
          : camOnWalls.refused
            ? `Not sent: ${String(camOnWalls.refused).replace(/^Not applied: /, '')}`
            : up
              ? `On S${up.slot} now: ${cameraName(upName)} · stops by itself after 30 min`
              : null;
      const next = JSON.stringify([rows, search?.status, up, status, linked]);
      if (next === sig) return;
      sig = next;
      const block = cameraBlock({
        cameras: rows,
        line: noCameraLine(search, { radius: target.r }),
        wallLabel: CAMERA_WALL[role],
        shownId,
        status,
        stopAny: Boolean(up),
        canSend: linked,
        linkNote: linked
          ? role === 'day'
            ? 'The Day plan wall shows it only while it shows this stop; otherwise it stops at once'
            : null
          : 'Not linked to the walls · a traffic camera can only be opened here',
        open,
        onOpen: (c) => openCamera(c, target),
        onShow: (c) => {
          camPending = { place: target.key, id: c.id };
          camAwait();
          sendCamera({
            tripId: photoTripId(),
            place: target.key,
            role,
            id: c.id,
            initials: reviewer(),
          });
          notifyCameras();
        },
        onStop: () => {
          camPending = { stop: true };
          camAwait();
          sendCamera({ stop: true });
          notifyCameras();
        },
      });
      block.addEventListener('toggle', () => {
        open = block.open;
      });
      box.replaceChildren(block);
    }
    camWatchers.add(draw);
    cameraNodes.set(placeKey, { box, redraw: draw });
    draw();
    return box;
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
    b.items.push(stopHazardItem(site));
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
      el('div', 'tt-kicker', `STOP BRIEF · DAY ${ev.day} · ${ev.start}`),
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
    // Initials beside a tick on the walls (blank: the tick and time only).
    const who = el('label', 'tt-adv-reviewer');
    const whoIn = el('input');
    whoIn.type = 'text';
    whoIn.maxLength = 3;
    whoIn.value = reviewer() || '';
    whoIn.placeholder = 'JT';
    whoIn.dataset.focusKey = 'reviewer';
    whoIn.setAttribute(
      'aria-label',
      'Your initials, shown on walls beside a tick',
    );
    whoIn.addEventListener('change', () => {
      whoIn.value = whoIn.value
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 3);
      save('reviewer', whoIn.value);
    });
    who.append(
      el(
        'span',
        'tt-dim',
        'Initials on walls · ticks show on every wall, notes never',
      ),
      whoIn,
    );
    box.append(who);
    const ls = reviewLinkState();
    box.append(
      el(
        'div',
        `tt-adv-link ${ls}`,
        {
          none: 'Ticks stay on this computer until multi-view starts',
          connecting: 'Joining the walls…',
          ok: 'Ticks reach the walls',
          offline: 'Ticks not reaching the walls · reconnecting',
          expired: 'Ticks not reaching the walls · start multi-view again',
        }[ls],
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
        keepChecks();
        // The tick reaches the walls (Jesse, 26 Oct): who and when only.
        sendReview({
          stop: ev.key,
          item: it.key,
          on: cb.checked,
          initials: reviewer(),
        });
        renderAdvance(true);
      });
      lab.append(cb, el('span', 'tt-adv-label', it.label));
      li.append(lab, el('div', 'tt-adv-text', it.text));
      if (it.checked)
        li.append(el('div', 'tt-dim tt-adv-by', `Reviewed by ${it.checked}`));
      items.append(li);
    }
    box.append(items);
    // The stop's street photo, the one S5 shows, after the review rows:
    // kept or hidden here (IA rounds 1–2, UX, every-time).
    if (!photoOnWall)
      box.append(
        photoNode(photoTargetFor('stop', { site }), site.short || site.label),
        cameraNode(
          `${site.key === SITES[0].key ? 'hotel' : 'stop'}:${site.key}`,
        ),
      );
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
    // S5's plate follows the stop at once (every-time P2-1).
    notifyPhotos();
  }
  /** Advance: the 3D weather follows the picked event's time (phase 6). */
  function syncAdvanceWeather() {
    const ev = advEvents().find((e) => e.key === adv.eventKey);
    const last = wx.steps[wx.steps.length - 1];
    // S5 shows the weather now during a warning, a near storm or this
    // trip's report: a calm forecast never stands in for a live storm
    // (B5-S5-PLAN).
    const ok =
      appMode === 'advance' &&
      !adv.wxNow &&
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
  /** What the mode chip adds in Live and in Advance alike (review X5). */
  function chipSuffix() {
    const m = lastCtx?.mode;
    return (
      (m?.degraded ? ' · DATA DELAYED' : '') +
      (simulationOn() ? ' · SIMULATED DATA' : '') +
      (wx.at != null
        ? ` · WEATHER ${relText(wx.at, Math.floor(Date.now() / 9e5) * 9e5)}`
        : '')
    );
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
      chip.textContent = 'PLANNING' + chipSuffix();
      chip.className = 'tt-mode advance';
      // The live data age stays visible while planning (shell review 03).
      renderAdvance();
    }
    renderStations();
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
    // The trip's own calendar day, not UTC's (S5 every-time P0-1).
    const today = Date.parse(
      new Date().toLocaleDateString('en-CA', { timeZone: city.timezone }),
    );
    return Math.floor((today - Date.parse(start)) / 86400000) + 1;
  }
  /**
   * "Now" for the plan: today at the clock every wall header shows (the
   * sample clock), as S6's Next uses — so S5 and S6 agree (S5 reviews,
   * P0). Jesse's two-clocks answer changes this one place.
   */
  function planNow() {
    const snap = lastCtx?.snapshot;
    if (!snap?.scenario?.clock) return Date.now();
    const iso = new Date().toLocaleDateString('en-CA', {
      timeZone: city.timezone,
    });
    return zonedToEpoch(iso, sampleClock(snap), city.timezone);
  }
  /** Where this trip's open report is (a site key), else null. */
  function reportSiteKey() {
    const m = lastCtx?.mode?.mode;
    if (m === 'incident') return siteKey;
    if (m !== 'incident_elsewhere') return null;
    const snap = lastCtx.snapshot;
    const here = twin.activePlace()?.id;
    const r = (snap?.reported_incidents || []).find((x) => x.place_id !== here);
    return snap?.places?.find((p) => p.id === r?.place_id)?.site_key || null;
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
        fireBounds: twin.fireBounds?.() || [],
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
    fireBounds: () => twin.fireBounds?.() || [],
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
        fireBounds: twin.fireBounds?.() || [],
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
  // All-in-one: the place chips, the scale and the compass share one glass
  // map bar across the top of the map, between the cards and the stations
  // rail (Jesse, 23 Oct: "put all this in a top bar, like the cards").
  // The walls carry the same bar (screens/05-S1-PLAN §5).
  if (params.get('view') !== 'launch') {
    const mapbar = document.createElement('div');
    mapbar.id = 'tt-mapbar';
    mapbar.className = 'tt-mapbar';
    mapbar.append($('tt-chips'), $('tt-scale'), compass.el);
    document.body.append(mapbar);
  }
  const onPostRender = () =>
    compass.update(twin.headingDeg, viewer.camera.pitch);
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
      ['', '#eef5f3', 'Live / stopped · current'],
      ['dash', '#f59e0b', 'Aging'],
      ['dot', '#7f949b', 'Last known'],
    ],
    floors: [
      ['', '#eef5f3', 'Likely floor range'],
      ['dash', '#eef5f3', 'Rough range'],
      ['', '#ee7789', 'Reported floor'],
    ],
    // Sensor resolution stays as the source publishes it (review/phase5b IA F1).
    fires: [['', '#f59e0b', 'Heat detection (375 m pixel)']],
    safety: [
      ['', '#4ba467', 'Approved place'],
      ['dash', '#7f949b', 'Draft · not approved'],
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
      ['thick', '#eef5f3', 'Major street'],
      ['', '#b8c3c7', 'Minor street'],
      ['thin', '#7f949b', 'Alley or service road'],
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
      ['stairs', '#eef5f3', 'Steps'],
      ['door', '#eef5f3', 'Mapped entrance (OSM, unverified)'],
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
        ['fireBounds', 'Fire boundaries (NIFC)', false],
        ['tropical', 'Hurricanes & tropical storms (NHC)', false],
        ['fires', 'Satellite heat detections (FIRMS)', false],
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
      fireBounds: hzLayers.fireBounds,
      tropical: hzLayers.tropical,
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
          } else if (key === 'fireBounds' || key === 'tropical') {
            hzLayers[key] = box.checked;
            redrawHazards();
            twin.refresh?.();
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
      radar3d: params.get('storm') === '1',
      alertAreas: true,
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
  // ---- phase 12: see it coming (twinNowcast*, twinStorm3d) ----
  // The nearest rain core, its observed motion and when it reaches the site
  // on that track; official alert areas; the nearest lightning. The same
  // line goes to the rail, a chip, the walls and the remote.
  const nc = {
    res: null, // real radar (never replaced by the demo)
    sim: null, // the demo storm, drawn on top while it runs
    text: null,
    realText: null,
    alerts: [],
    cache: new Map(),
    past: new Map(),
    // ?storm=1 starts the demo now; &stormAgo=25 starts it 25 min ago.
    simStart:
      params.get('storm') === '1'
        ? Date.now() - Math.min(44, Number(params.get('stormAgo')) || 0) * 60e3
        : null,
    simGrid: new Map(),
    ltgSeenAt: null,
    ltgLastKm: null,
    ltgPrevKm: null,
    lensKind: null,
  };
  // ---- Fire boundaries and hurricanes (review/hazards H5-PLAN) ----
  // Upstream's NIFC and NHC routes, assessed against this site, its trip's
  // other stops and its people; the demos lie over the real feeds.
  const hzLayers = { fireBounds: true, tropical: true };
  let hzDispose = null;
  let hzKey = '';
  let hzRowsKey = '';
  const hzCenter = () => ({
    lat: city.center.lat,
    lon: city.center.lon ?? city.center.lng,
  });
  /** The real wind (MET Norway), for "upwind": {fromDeg, kmh, from} or null. */
  function hzWind() {
    const s = wx.summary;
    return s && Number.isFinite(s.windFromDeg) && Number.isFinite(s.windMs)
      ? {
          fromDeg: s.windFromDeg,
          kmh: s.windMs * 3.6,
          from: compassWord(s.windFromDeg),
        }
      : null;
  }
  hazardLoad = createHazardLoad({
    // Demos sit at the trip's hotel on every window and the remote (X18).
    center: (() => {
      const h = SITES[0]?.center || city.center;
      return { lat: h.lat, lon: h.lon ?? h.lng };
    })(),
    slot: Number(params.get('slot')) || 0,
    signal: abort.signal,
    onChange: () => {
      twin.setExtraHeat?.(hazardLoad.data().simHeat);
      twin.refresh?.();
    },
  });
  // ?fireDemo=1 / ?hurricaneDemo=1 start a demo here, as ?storm=1 does
  // (review shots); &fireDemoAgo=12 starts it 12 min ago (re-mapped).
  if (params.get('fireDemo') === '1')
    hazardLoad.setSim(
      'fire',
      Date.now() - Math.min(44, Number(params.get('fireDemoAgo')) || 0) * 60e3,
    );
  if (params.get('hurricaneDemo') === '1')
    hazardLoad.setSim('cyclone', Date.now());
  /** Start (ms) or stop (null) a hazard demo: 'fire' | 'cyclone'. */
  const simEnds = {};
  function setSimHazard(kind, start) {
    hazardLoad?.setSim(kind, start);
    // A local demo (All-in-one, URL) ends itself as the host ends a wall's.
    clearTimeout(simEnds[kind]);
    if (start)
      simEnds[kind] = setTimeout(
        () => setSimHazard(kind, null),
        Math.max(0, start + SIM_DEMO_MAX_MS - Date.now()),
      );
    const box = $(kind === 'fire' ? 'tt-simfirebound' : 'tt-simcyclone');
    if (box) box.checked = Boolean(start);
  }
  /** The hazard picture for this site from the latest feeds and demos. */
  function hazardNow(a, info = null) {
    if (!hazardLoad) return null;
    const now = Date.now();
    const d = hazardLoad.data(now);
    const center = hzCenter();
    const people = (a?.rows || [])
      .filter((r) => r.person?.coordinates)
      .map((r) => ({
        id: r.person.id,
        name: r.person.name,
        lat: r.person.coordinates.lat,
        lon: r.person.coordinates.lng ?? r.person.coordinates.lon,
      }));
    const stops = SITES.filter((s2) => s2.key !== siteKey).map((s2) => {
      const p = s2.anchors?.inside || s2.center;
      // The stop's day is named in the line (round 3 UX).
      const label = s2.day ? `${s2.short} (Day ${s2.day})` : s2.short;
      return { label, lat: p.lat, lon: p.lon ?? p.lng };
    });
    const wind = hzWind();
    const ctx = {
      center,
      stops,
      people,
      windFromDeg: wind?.fromDeg,
      windKmh: wind?.kmh,
    };
    const fires = assessFires(d.rows, ctx, now);
    const tropical = assessTropical(d.storms, ctx);
    // The heat detections a boundary claims follow the boundaries shown.
    const rowsKey = fires
      .map((f) => `${f.row.stableId}:${f.row.updatedTime}`)
      .join('|');
    if (rowsKey !== hzRowsKey) {
      hzRowsKey = rowsKey;
      twin.setFireBoundaries?.(fires.map((f) => f.row));
    }
    const pic = hazardPicture({
      fires,
      tropical,
      firesFeed: d.firesFeed,
      tropicalFeed: d.tropicalFeed,
      coverage: hazardCoverage(center),
      storms: d.realStorms,
      nearest: nearestFire(d.realRows, center),
      now,
      demo: d.demo,
      noun: siteNounNow(),
      heat: info?.fires?.byFire
        ? { byFire: info.fires.byFire, outside: null }
        : undefined,
    });
    return { ...pic, wind, now, demo: d.demo };
  }
  /** The worst hazard line, for the mode chip and the closed Hazards line. */
  function hazardLead(pic) {
    const f = pic?.fireCheck?.[0];
    const t = pic?.tropCheck?.[0];
    // FIRE › FIRE NEAR › CONE › TROPICAL NEAR (H5 order); both are named
    // when both need a check (X4).
    const parts = [
      f && fireShort(f, siteNounNow()),
      t && tropicalShort(t, pic.now),
    ].filter(Boolean);
    // SIMULATED once when both are the demo (round 2 brand).
    if (parts.length === 2 && f?.simulated && t?.simulated)
      parts[1] = parts[1].replace(/^SIMULATED · /, '');
    // "also in the forecast cone", not "also In" (round 3 UX).
    if (parts[1]) parts[1] = parts[1].replace(/^In /, 'in ');
    return parts.length ? parts.join(' · also ') : null;
  }
  /** What to do next, by hazard (X22). */
  function hazardNext(pic) {
    const f = pic?.fireCheck?.[0];
    const t = pic?.tropCheck?.[0];
    return [
      f && 'check paths and where the group is',
      t && "check the next days' plan · read the advisory",
    ]
      .filter(Boolean)
      .join(' · ');
  }
  /**
   * One short chip per fire or storm at amber (H5, X4): never the red
   * hazard chip, ranked first and never folded. They hold whatever the map
   * layers show (X19): the layers only draw.
   */
  function hazardChips(pic) {
    if (!pic) return [];
    const out = [];
    for (const f of pic.fireCheck.slice(0, 2))
      out.push({
        label: fireChip(f, siteNounNow()),
        wx: 'attention',
        plain: true,
        hz: true,
      });
    for (const t of pic.tropCheck.slice(0, 1))
      out.push({
        label: t.inCone
          ? `${t.simulated ? 'SIMULATED · ' : ''}In the forecast cone · ${t.title}`
          : tropicalShort(t, pic.now),
        wx: 'attention',
        plain: true,
        hz: true,
      });
    // A tight bar merges them into one chip before the compass loses room
    // (round 2 N1): "SIMULATED · Fire 2.5 mi W + forecast cone".
    if (out.length > 1) {
      const f = pic.fireCheck[0];
      const t = pic.tropCheck[0];
      const allSim = f?.simulated && t?.simulated;
      const strip = (x) => (allSim ? x.replace(/^SIMULATED · /, '') : x);
      out[0].merged = `${allSim ? 'SIMULATED · ' : ''}${[
        f && strip(fireChip(f, siteNounNow())),
        t && (t.inCone ? 'forecast cone' : 'storm near'),
      ]
        .filter(Boolean)
        .join(' + ')}`;
    }
    return out;
  }
  /** Compass ticks toward fires and storms at amber (hazards H4). */
  function hazardTicks(pic) {
    if (!pic) return [];
    const out = [];
    for (const f of pic.fireCheck)
      if (f.dHotel > 0 && Number.isFinite(f.bearingDeg))
        out.push({
          deg: f.bearingDeg,
          kind: 'fire',
          label: `fire boundary to the ${f.bearing}`,
        });
    for (const t of pic.tropCheck)
      if (Number.isFinite(t.towardDeg))
        out.push({
          deg: t.towardDeg,
          kind: 'cyclone',
          label: `${t.title} to the ${compassWord(t.towardDeg)}`,
        });
    return out;
  }
  /** S5's "Fire & hurricanes" row, checked at the stop itself (H5). */
  function stopHazardItem(site) {
    const item = { key: 'hazards', label: 'Fire & hurricanes' };
    const d = hazardLoad?.data();
    const p = site.anchors?.inside || site.center;
    const center = { lat: p.lat, lon: p.lon ?? p.lng };
    if (!d)
      return {
        ...item,
        text: 'Fire boundaries and hurricanes · loading',
        ok: false,
      };
    const ctx = { center, stops: [], people: [] };
    const pic = hazardPicture({
      fires: assessFires(d.rows, ctx),
      tropical: assessTropical(d.storms, ctx),
      coverage: hazardCoverage(center),
      firesFeed: d.firesFeed,
      tropicalFeed: d.tropicalFeed,
      storms: d.realStorms,
      demo: d.demo,
    });
    const now = Date.now();
    // SIMULATED already leads a demo line; real lines name their source.
    const src = (sim, real) => (sim ? '' : ` (${real})`);
    const lines = [
      ...pic.fires
        .slice(0, 1)
        .map((f) => `${fireShort(f, 'stop')}${src(f.simulated, 'NIFC')}`),
      ...pic.tropical
        .slice(0, 1)
        .map(
          (t) =>
            `${t.simulated ? 'SIMULATED · ' : ''}${t.inCone ? `${t.title} · its cone covers the stop` : tropicalShort(t, now).replace(/^SIMULATED · /, '')}${src(t.simulated, 'NHC')}`,
        ),
    ];
    const fireOff = pic.fireState === 'unavailable';
    const tropOff = pic.tropState === 'unavailable';
    const notChecked = [fireOff && 'fire boundaries', tropOff && 'hurricanes']
      .filter(Boolean)
      .join(' and ');
    const quiet = [
      !hazardCoverage(center).fire
        ? 'fire boundaries: not covered here'
        : !fireOff && !pic.fires.length
          ? 'no fire boundary within 31 mi'.replace(
              '31 mi',
              getDistanceUnit() === 'm' ? '50 km' : '31 mi',
            )
          : null,
      !hazardCoverage(center).tropical
        ? 'hurricanes: not covered here'
        : !tropOff && !pic.tropical.length
          ? `no storm forecast within ${getDistanceUnit() === 'm' ? '1,000 km' : '621 mi'}`
          : null,
    ].filter(Boolean);
    return {
      ...item,
      text: [
        ...lines,
        ...(lines.length ? [] : quiet),
        notChecked ? `${notChecked} not checked right now` : null,
        'checked now, not at the stop time',
      ]
        .filter(Boolean)
        .join(' · '),
      ok: !notChecked,
      warn: pic.check || Boolean(notChecked),
    };
  }
  /** Lines for the All-in-one Hazards card (and S3's closed line). */
  function hazardCardLines(pic) {
    if (!pic) return [];
    const out = [];
    const tone = (t) => (t === 'amber' ? 'warn' : t);
    for (const f of pic.fires.slice(0, 2))
      for (const l of fireLines(f, {
        heatInside: pic.heat?.byFire?.get(f.row.stableId) || 0,
        wind: pic.wind,
        noun: siteNounNow(),
      }))
        out.push({ text: l.text, tone: tone(l.tone) });
    for (const t of pic.tropical.slice(0, 2))
      for (const l of tropicalLines(t, pic.now, siteNounNow()))
        out.push({ text: l.text, tone: tone(l.tone) });
    out.push({ text: pic.fireStatus, tone: 'dim' });
    out.push({ text: pic.tropStatus, tone: 'dim' });
    return out;
  }
  /** Draw the boundaries and storm geometry when what is shown changes. */
  function redrawHazards() {
    const site = twin.site;
    const ready = twin.state === 'ready' || twin.state === 'degraded';
    if (!site || !ready || !hzPic) {
      hzDispose?.();
      hzDispose = null;
      hzKey = '';
      return;
    }
    const key = [
      scaleNow(),
      hzLayers.fireBounds,
      hzLayers.tropical,
      ...hzPic.fires.map(
        (f) => `${f.row.stableId}:${f.row.updatedTime}:${f.level}`,
      ),
      ...hzPic.tropical.map(
        (t) => `${t.storm.id}:${t.storm.issuedAt}:${t.level}`,
      ),
    ].join('|');
    if (key === hzKey) return;
    hzKey = key;
    hzDispose?.();
    hzDispose = drawHazards(viewer, site, {
      fires: hzPic.fires,
      tropical: hzPic.tropical,
      scale: scaleNow(),
      wall: document.body.dataset.view === 'screen',
      show: hzLayers,
    });
  }
  const ncCenter = () => ({
    lat: city.center.lat,
    lon: city.center.lon ?? city.center.lng,
  });
  let wxLayer = null;
  let fxLayer = null;
  let stormLayer = null; // phase 12: radar with height, track, alert areas
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
  /**
   * One clock on a wall (Jesse, 26 Oct): every clock time on a wall is
   * the header's (the sample clock in the demo). While that differs from
   * real time, live weather reads as durations ("in 1 h 13 min") and the
   * simulated storm moves onto the sample clock. In real use the two are
   * the same and nothing changes.
   */
  const wallClocks = () =>
    document.body.dataset.view === 'screen' &&
    Math.abs(planNow() - Date.now()) > 2 * 60e3;
  const durText = (ms) => {
    const r = relText(ms, Date.now());
    return r === 'now'
      ? 'now'
      : r.startsWith('+')
        ? `in ${r.slice(1)}`
        : `${r.slice(1)} ago`;
  };
  const wxTime = (ms, { sim = false } = {}) => {
    if (!Number.isFinite(ms)) return '';
    if (wallClocks()) {
      if (!sim) return durText(ms);
      const shift = planNow() - Date.now();
      return clockAt(ms + shift, Date.now() + shift);
    }
    return clockAt(ms, Date.now());
  };
  function clockAt(ms, nowMs) {
    const d = new Date(ms);
    const day = (x) =>
      x.toLocaleDateString('en-GB', {
        timeZone: city.timezone,
        weekday: 'short',
      });
    const zone =
      d
        .toLocaleTimeString(
          /^America\//.test(city.timezone) ? 'en-US' : 'en-GB',
          { timeZone: city.timezone, timeZoneName: 'short' },
        )
        .split(' ')
        .pop() || '';
    return `${day(d) !== day(new Date(nowMs)) ? `${day(d)} ` : ''}${hhmm(d.toISOString())} ${zone}`;
  }
  const wxSummary = () =>
    nc.simStart && stormStep(Date.now())
      ? {
          ...simulatedRain(wx.summary),
          precipMmH: stormStep(Date.now()).precipMmH,
          condition: stormStep(Date.now()).condition,
        }
      : wx.sim.snow
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
      loadAlertAreas(wx.warnings, ncCenter(), { signal: abort.signal })
        .then((list) => {
          nc.alerts = list;
          drawStorm();
        })
        .catch(() => {});
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
    if (nc.sim?.strikes) return nc.sim.strikes;
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
    const st = stormStep();
    if (st) return st;
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
    if (!wx.layers.precip || wx.sim.rain || wx.sim.snow || nc.simStart)
      return null;
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
    if (nc.simStart) {
      images.precip = null;
      images.lightning = null;
    }
    drawFx();
    drawStorm();
    // Clouds are drawn in 3D by the effects layer now (phase 6). Lightning
    // has no forecast; ahead of now it is not drawn (the row says so).
    // Lightning frames exist for now only: hidden at any other time.
    const away = wx.at != null;
    wxLayer.set(
      {
        ...wx.layers,
        clouds: false,
        // Under the simulated storm the real radar map is not drawn at all.
        precip: wx.layers.precip && !nc.simStart,
        lightning: wx.layers.lightning && !away,
      },
      {
        bbox: wxBox,
        ltgBbox: ltgBox,
        images,
        strikes: wx.sim.lightning || nc.simStart ? strikes() : [],
        summary: wxSummary(),
        simulated: {
          ...wx.sim,
          lightning: wx.sim.lightning || Boolean(nc.simStart),
        },
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
              // One clock on a wall: the forecast hour as an offset.
              clock: wallClocks()
                ? durText(Date.parse(sum?.validTime))
                : hhmm(sum?.validTime),
              simulated: wx.sim.rain || wx.sim.snow || Boolean(nc.simStart),
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
    // On a wall in the demo, live weather has no clock time (the caption
    // says the offset); the simulated storm reads the sample clock.
    clock: (ms) =>
      wallClocks() && !nc.simStart
        ? ''
        : wxTime(ms, { sim: Boolean(nc.simStart) }),
    tick: (ms) => {
      // One clock on a wall: ticks as offsets from now (live weather) or
      // on the sample clock (the simulated storm).
      if (wallClocks())
        return nc.simStart
          ? wxTime(ms, { sim: true }).replace(/ \S+$/, '')
          : `${ms >= Date.now() ? '+' : '−'}${Math.abs(Math.round((ms - Date.now()) / 3600e3))} h`;
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
    if (projectionOn() && t > now && t <= now + PROJECT_MAX_MIN * 60e3)
      return null;
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
    const on = [
      'lightning',
      'precip',
      'totals',
      'clouds',
      'fx',
      'radar3d',
    ].some((k) => wx.layers[k]);
    if (!on) return null;
    if (nc.simStart) return stormTimelineModel();
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
    // Phase 12: with radar in 3D and a measured motion, the first hour
    // ahead is the projection on the current track (labelled), then model.
    const projUntil = projectionOn() ? now + PROJECT_MAX_MIN * 60e3 : now;
    const segments = [
      { from: start, to: obsUntil, kind: 'observed' },
      ...(obsUntil < now ? [{ from: obsUntil, to: now, kind: 'none' }] : []),
      ...(projUntil > now
        ? [{ from: now, to: projUntil, kind: 'projected' }]
        : []),
      ...(modelUntil && modelUntil > projUntil
        ? [{ from: projUntil, to: modelUntil, kind: 'model' }]
        : []),
      {
        from: Math.max(modelUntil || now, projUntil),
        to: siteUntil,
        kind: 'site',
      },
    ];
    const kindAt = (t) =>
      t < start
        ? 'none'
        : t <= obsUntil
          ? 'observed'
          : t <= now
            ? 'none'
            : t <= projUntil
              ? 'projected'
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
          return `latest ${region === 'us' ? 'radar' : 'satellite estimate'} and the site forecast · MET Norway, ${updatedText(wx.summary?.updatedAt)}`;
        const k = kindAt(t);
        if (k === 'none' && t <= now)
          return region === 'us'
            ? 'newest radar frame not in yet'
            : 'satellite estimate runs about 1 h behind — no frame yet for this time';
        if (k === 'observed') return frames.label(t);
        if (k === 'projected') return projectionLabel(t);
        if (k === 'model')
          return `${frames.label(t)} · site forecast MET Norway${t - now > 24 * H ? ' · further out, less certain' : ''}`;
        return `site forecast · MET Norway, ${updatedText(wx.summary?.updatedAt)}${t - now > 24 * H ? ' · further out, less certain' : ''}`;
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
  const siteNounNow = () => (city.kind === 'lodging' ? 'hotel' : 'venue');
  const imperial = () => /mi$/.test(formatDistance(2000));
  const speedText = (kmh) =>
    imperial() ? `${Math.round(kmh / 1.609)} mph` : `${Math.round(kmh)} km/h`;
  const SIM_MAX_MS = 45 * 60e3; // the demo storm ends itself
  /**
   * A weather time with its age or its time to go: "20:21 CDT, 3 min ago".
   * A wall says the age only: its header clock is the trip's (walls-live W5).
   */
  const ago = (ms) => {
    const m = Math.round((Date.now() - ms) / 60e3);
    if (m >= 0 && document.body.dataset.view === 'screen')
      return `${m} min ago`;
    if (m < 0 && wallClocks()) return durText(ms);
    return m >= 0
      ? `${wxTime(ms)}, ${m} min ago`
      : `${wxTime(ms)}, in ${relText(ms, Date.now()).replace(/^\+/, '')}`;
  };
  /** "updated 20:17", or on a wall "updated 36 min ago" (W5). */
  const updatedText = (iso) =>
    document.body.dataset.view === 'screen' && Number.isFinite(Date.parse(iso))
      ? `updated ${ago(Date.parse(iso))}`
      : `updated ${hhmm(iso)}`;
  let ncSeq = 0;
  /** Real radar, every 3 min. The demo storm never replaces it. */
  async function loadNowcast() {
    // Nothing to fetch once Trip Twin is closed (QA D14).
    if (twin.state === 'idle') return;
    const seq = ++ncSeq;
    let res;
    try {
      res = await runNowcast({
        center: ncCenter(),
        region,
        signal: abort.signal,
        cache: nc.cache,
      });
    } catch {
      if (abort.signal.aborted) return;
      res = {
        status: 'unavailable',
        source: region === 'us' ? 'radar' : 'satellite estimate',
      };
    }
    if (seq !== ncSeq) return;
    nc.res = res;
    refreshNowcast();
  }
  /** Every 20 s: the arrival counts down; the demo storm moves. */
  function refreshNowcast() {
    if (twin.state === 'idle') {
      inspectEl.hidden = true;
      return;
    }
    if (nc.simStart && Date.now() - nc.simStart > SIM_MAX_MS) {
      setSimStorm(null);
      offerNotice?.('Demo storm ended after 45 min · real weather only');
      return;
    }
    nc.sim = nc.simStart
      ? simNowcast({ center: ncCenter(), simStart: nc.simStart })
      : null;
    nc.text = approachLine();
    nc.realText = nc.sim ? approachLine(nc.res) : null;
    drawStorm();
    renderTimeline();
    renderLayers();
  }
  /** What the storm visuals and the lead line show: the demo, else radar. */
  const ncView = () => nc.sim || nc.res;
  /** The approach line (three tiers) for every surface. */
  function approachLine(r = ncView()) {
    if (!r)
      return {
        status: 'loading',
        level: 'info',
        lead: '',
        claim: 'Storm approach · radar loading',
        detail: '',
        text: 'Storm approach · radar loading',
        short: '',
      };
    if (r.status !== 'live') {
      const t = `Storm approach unavailable · the ${r.source} frame${r.frameAt ? ` for ${wxTime(r.frameAt)}` : ''} did not load`;
      return {
        status: 'unavailable',
        level: 'info',
        lead: '',
        claim: t,
        detail: '',
        text: t,
        short: '',
      };
    }
    const ageMin = r.simulated ? 0 : (Date.now() - r.frameAt) / 60e3;
    const ap = r.simulated ? r.ap : approachNow(r.apFrame || r.ap, ageMin);
    return approachText(ap, {
      dist: (m) => formatDistance(m),
      speed: speedText,
      siteNoun: siteNounNow(),
      frame: wxTime(r.frameAt, { sim: Boolean(r.simulated) }),
      frameAge: r.simulated ? null : ageMin,
      source: r.source,
      simulated: r.simulated,
      positionOnly: r.positionOnly,
      unmeasured: r.motion?.unmeasured,
      boxText: imperial() ? '50 mi' : '80 km',
      nearText: imperial() ? '6 mi' : '10 km',
    });
  }
  const simAlert = () =>
    nc.simStart ? simulatedAlert(ncCenter(), Date.now(), nc.simStart) : null;
  // The simulated warning's end on the sample clock, with its duration.
  const untilText = (iso, sim = false) =>
    !iso
      ? ''
      : sim && wallClocks()
        ? `${wxTime(Date.parse(iso), { sim: true })}, ${durText(Date.parse(iso))}`
        : ago(Date.parse(iso));
  /**
   * Official lines, the same on every surface: the demo's warning first and
   * labelled, then every real alert with its time to go and whether the
   * site is inside its area, or the check that found none.
   */
  function officialLines() {
    const noun = siteNounNow();
    const src = WX.warnings === 'nws' ? 'NWS' : 'MeteoAlarm';
    const list = [];
    const a = simAlert();
    if (a)
      list.push({
        sim: true,
        text: `SIMULATED (demo) · ${a.event} · until ${untilText(a.ends, true)}${a.inside ? ` · the ${noun} is inside the area` : ''}`,
      });
    if (wx.warningsStatus === 'unavailable')
      list.push({
        warn: true,
        text: `${src} alerts unavailable right now · not checked`,
      });
    else if (!wx.warnings.length)
      list.push(
        // Under the demo the real check is a note, not a second answer
        // beside the simulated warning (A5-S4-PLAN).
        a
          ? {
              note: true,
              text: `Real ${src} under the demo: no active alerts returned · checked ${wx.warningsAt ? ago(wx.warningsAt) : 'at load'}`,
            }
          : hazardLoad?.sim().fire || hazardLoad?.sim().cyclone
            ? {
                // A hazard demo has no simulated NWS product: the real
                // state is said as the real state (round 2 UX).
                text: `Real ${src} under the demo: no active alerts returned · checked ${wx.warningsAt ? ago(wx.warningsAt) : 'at load'} · the demo adds none`,
              }
            : {
                text: `${src} checked ${wx.warningsAt ? ago(wx.warningsAt) : 'at load'}: no active alerts returned for this point`,
              },
      );
    else
      for (const w of nc.alerts?.length ? nc.alerts : wx.warnings)
        list.push({
          official: true,
          text: `${src}: ${w.event}${w.ends ? ` · until ${untilText(w.ends)}` : ''}${w.inside === true ? ` · the ${noun} is inside the area` : ''}`,
        });
    // The same notice for several areas reads once, with its count.
    const seen = new Map();
    for (const l of list) {
      const k = `${l.sim}|${l.official}|${l.text}`;
      if (seen.has(k)) seen.get(k).n += 1;
      else seen.set(k, { ...l, n: 1 });
    }
    return [...seen.values()].map(({ n, ...l }) =>
      n > 1 ? { ...l, text: `${l.text} · ${n} notices` } : l,
    );
  }
  function alertList() {
    const list = (nc.alerts || []).map((a) => ({
      ...a,
      untilText: a.ends ? untilText(a.ends) : '',
    }));
    const s = simAlert();
    if (s) list.unshift({ ...s, untilText: untilText(s.ends, true) });
    return list;
  }
  /** Whether the lightning grid has answered (a null ltgLine then means
   *  none near, not unknown; S4 every-time r2 N2). */
  function ltgKnown() {
    if (nc.sim?.strikes) return true;
    const img = wx.images.lightning;
    return Boolean(img) && !wx.imageErr?.lightning;
  }
  /** The nearest lightning: {point, distKm, dir, text, label} or null. */
  function ltgLine() {
    const site = ncCenter();
    const near = imperial() ? '6 mi' : '10 km';
    if (nc.sim?.strikes?.length) {
      const n = nearestPoint(site, nc.sim.strikes);
      return (
        n && {
          ...n,
          sim: true,
          inside: n.distKm <= 10,
          text: `SIMULATED lightning · ${formatDistance(n.distKm * 1000)} ${n.dir} · ${n.point.ageMin} min ago${n.distKm <= 10 ? ` · inside ${near}` : ''}`,
        }
      );
    }
    const img = wx.images.lightning;
    if (!img || img.noData || !img.cells?.length) return null;
    const n = nearestPoint(site, cellsToPoints(img.cells, ltgBox));
    if (!n || n.distKm > 40) return null;
    if (nc.ltgSeenAt !== wx.imageAt.lightning) {
      nc.ltgSeenAt = wx.imageAt.lightning;
      nc.ltgPrevKm = nc.ltgLastKm;
      nc.ltgLastKm = n.distKm;
    }
    const tr = trendOf(nc.ltgPrevKm, nc.ltgLastKm);
    const fetched = Date.parse(wx.imageAt.lightning);
    return {
      ...n,
      inside: n.distKm <= 10,
      text: `Lightning · nearest ${WX.lightning?.gridKm || 8} km grid cell ${formatDistance(n.distKm * 1000)} ${n.dir}${n.distKm <= 10 ? ` · inside ${near}` : ''} · ${region === 'us' ? 'nowCOAST 15-min density' : 'EUMETSAT MTG-LI'}, fetched ${Number.isFinite(fetched) ? ago(fetched) : ''} (data can be up to 15 min older)${tr ? ` · ${tr}` : ''}`,
    };
  }
  /** People outdoors near the site right now, with the walk to the hotel. */
  function outdoorsNow() {
    const rows = (lastA?.rows || []).filter(
      (r) => r.verdict?.bucket === 'Outside, nearby',
    );
    return rows.map((r) => ({
      id: r.person.id,
      // The screen's name style (visitor mode: initials; A5-S4-PLAN).
      name: styledName(r.person.name),
      distM: r.verdict.distM,
      walkMin: Number.isFinite(r.verdict.distM)
        ? Math.max(1, Math.round((r.verdict.distM * 1.3) / 80))
        : null,
    }));
  }
  /** The simulated storm's grid at time t (cached per 30 s). */
  function simGridAt(t) {
    const key = Math.floor(t / 30e3);
    if (nc.simGrid.has(key)) return nc.simGrid.get(key);
    const g = simulatedStorm({
      center: ncCenter(),
      bbox: nc.sim?.bbox || boxKm(ncCenter(), 160),
      w: NOWCAST_PX,
      h: NOWCAST_PX,
      tMs: t,
      startMs: nc.simStart,
    });
    nc.simGrid.set(key, g);
    if (nc.simGrid.size > 40) nc.simGrid.delete(nc.simGrid.keys().next().value);
    return g;
  }
  /** Weather at the site under the demo storm (or null when off). */
  function stormStep(at = wx.at ?? Date.now()) {
    if (!nc.simStart) return null;
    const g = simGridAt(at);
    const c = Math.floor(g.w / 2);
    let d = 0;
    for (let y = c - 2; y <= c + 2; y++)
      for (let x = c - 2; x <= c + 2; x++) d = Math.max(d, g.data[y * g.w + x]);
    const mm = d >= 60 ? 30 : d >= 50 ? 15 : d >= 40 ? 6 : d >= 25 ? 2 : 0;
    return {
      precipMmH: mm,
      tempC: mm ? 19 : 23,
      symbol: mm >= 15 ? 'heavyrainandthunder' : mm ? 'rain' : 'cloudy',
      condition: mm >= 15 ? 'heavy rain and thunder' : mm ? 'rain' : 'cloudy',
      cloud: { low: mm ? 92 : 55, mid: 80, high: 60 },
      fogPct: 0,
      windMs: mm ? 13 : 6,
      windFromDeg: 225,
      simulated: 'storm',
    };
  }
  // Europe's satellite estimate is position only: no projection (QA D5).
  const projectionOn = () =>
    wx.layers.radar3d &&
    Boolean(
      nc.simStart || (hasMotion(nc.res?.motion) && !nc.res?.positionOnly),
    );
  function projectionLabel(t) {
    if (nc.simStart)
      return `SIMULATED storm (prototype) · ${wxTime(t, { sim: true })}`;
    const r = nc.res;
    return `Projection on the current track · ${r?.source || 'radar'} ${wxTime(r?.frameAt)} + observed motion · not a forecast model`;
  }
  /** The timeline under the demo storm: 2 h back, 1 h ahead. */
  function stormTimelineModel() {
    const now = Math.floor(Date.now() / (5 * 60e3)) * 5 * 60e3;
    const start = now - 2 * H;
    const end = now + PROJECT_MAX_MIN * 60e3;
    return {
      now,
      start,
      end,
      stepMs: 5 * 60e3,
      t: wx.at,
      segments: [
        { from: start, to: now, kind: 'observed' },
        { from: now, to: end, kind: 'projected' },
      ],
      kindAt: (t) =>
        t < start || t > end ? 'none' : t <= now ? 'observed' : 'projected',
      sourceAt: (t) =>
        wx.at == null
          ? 'SIMULATED storm (prototype) · shells, track, lightning and the warning are simulated'
          : `SIMULATED storm (prototype) · ${wxTime(t, { sim: true })}`,
    };
  }
  /** The radar grid for the viewed time: {grid, kind}. */
  function stormGridAt() {
    if (nc.simStart)
      return { grid: simGridAt(wx.at ?? Date.now()), kind: 'simulated' };
    const r = nc.res;
    if (!r || r.status !== 'live') return { grid: null, kind: 'none' };
    const t = wx.at;
    if (t == null || Math.abs(t - r.frameAt) < 2.5 * 60e3)
      return { grid: r.latest, kind: 'observed' };
    if (t < r.frameAt) {
      const key = Math.floor(t / (5 * 60e3));
      if (!nc.past.has(key)) {
        nc.past.set(key, 'loading');
        loadPastGrid({
          region,
          center: ncCenter(),
          t,
          signal: abort.signal,
          cache: nc.cache,
        }).then((g) => {
          nc.past.set(key, g || null);
          drawStorm();
          renderLayers();
        });
      }
      const g = nc.past.get(key);
      return g === 'loading'
        ? { grid: null, kind: 'loading' }
        : { grid: g || null, kind: g ? 'observed' : 'missing' };
    }
    if (r.positionOnly)
      return { grid: null, kind: t <= Date.now() ? 'noframe' : 'nomotion' };
    if (!hasMotion(r.motion)) return { grid: null, kind: 'nomotion' };
    if (t - r.frameAt <= PROJECT_MAX_MIN * 60e3)
      return {
        grid: projectGrid(r.latest, r.motion, (t - r.frameAt) / 60e3),
        kind: 'projected',
      };
    return { grid: null, kind: 'beyond' };
  }
  /** What the viewed time shows at the site (lens), never the live figure. */
  function lensClaim() {
    if (wx.at == null) return '';
    const g = stormGridAt();
    if (!g.grid)
      return g.kind === 'beyond'
        ? 'beyond the 60 min projection'
        : g.kind === 'nomotion'
          ? 'no motion measured, no projection'
          : g.kind === 'noframe'
            ? 'no frame for this time yet'
            : '';
    const ap = approach({
      cores: findCores(g.grid),
      motion: null,
      site: ncCenter(),
      grid: g.grid,
    });
    const noun = siteNounNow();
    if (ap.status === 'over') return `rain core over the ${noun} at that time`;
    if (ap.status === 'near')
      return `rain core within ${imperial() ? '6 mi' : '10 km'} of the ${noun} at that time`;
    return ap.status === 'none'
      ? `no rain core within ${imperial() ? '50 mi' : '80 km'} at that time`
      : `nearest rain core ${formatDistance(ap.edgeKm * 1000)} ${ap.fromDir} at that time`;
  }
  let stormKey = '';
  // The colour key rides above the compass while storm shells are drawn.
  const sevKey = document.createElement('div');
  sevKey.className = 'tt-wx-key';
  sevKey.hidden = true;
  sevKey.setAttribute('aria-label', 'Storm colour key');
  const keyDock = document.createElement('div');
  keyDock.className = 'tt-wxdock';
  keyDock.hidden = true;
  function renderSevKey(show, simulated) {
    // A converted map wall docks the key with the timeline (A5-S4-PLAN):
    // the compass is in the map bar, by the alert zone.
    // With no timeline showing (S5's Advance, S4's Timeline off) the key
    // docks in its own element, in the same place (S4 W8, B5-S5-PLAN).
    const tl = document.querySelector('.tt-wxtl');
    const wall = document.body.classList.contains('tt-wall-map');
    const tlShown =
      tl &&
      !tl.hidden &&
      !document.body.dataset.wallOff?.split(' ').includes('timeline');
    if (wall && !tlShown && !keyDock.isConnected) document.body.append(keyDock);
    const host = wall
      ? tlShown
        ? tl
        : keyDock
      : document.querySelector('.tt-compass');
    if (host && sevKey.parentNode !== host) host.append(sevKey);
    keyDock.hidden = !(wall && !tlShown && show);
    sevKey.hidden = !show;
    if (!show) return;
    const k = simulated ? 'RAIN · SIMULATED' : 'RAIN · RADAR';
    if (sevKey.dataset.k === k) return;
    sevKey.dataset.k = k;
    const head = document.createElement('div');
    head.className = 'tt-kicker';
    head.textContent = k;
    sevKey.replaceChildren(
      head,
      ...[...SEVERITY_KEY].reverse().map(([dbz, color, words]) => {
        const row = document.createElement('div');
        row.className = 'row';
        const sw = document.createElement('i');
        sw.style.background = color;
        const t = document.createElement('span');
        t.textContent = words;
        const v = document.createElement('b');
        v.textContent = `${dbz}${dbz === 60 ? '+' : ''}`;
        row.append(sw, t, v);
        return row;
      }),
    );
  }
  function drawStorm() {
    if (!stormLayer) return;
    const v = ncView();
    const g = stormGridAt();
    nc.lensKind = g.kind;
    const line = nc.text || approachLine();
    const live = v?.status === 'live';
    const ap = live
      ? v.simulated
        ? v.ap
        : approachNow(v.apFrame || v.ap, (Date.now() - v.frameAt) / 60e3)
      : null;
    const six = imperial() ? '6 mi' : '10 km';
    const arrivalText =
      line.status === 'over'
        ? `over the ${siteNounNow()} now`
        : ['arriving', 'near'].includes(line.status)
          ? ap?.overMin != null
            ? `core over the ${siteNounNow()} ${inEta(ap.overMin)}`
            : line.status === 'near'
              ? `core within ${six} now`
              : `core within ${six} ${inEta(ap.nearMin)}`
          : '';
    const lensMin =
      wx.at != null && v?.frameAt ? (wx.at - v.frameAt) / 60e3 : null;
    const opts = {
      grid: g.grid,
      showShells: wx.layers.radar3d,
      ap: live ? ap : null,
      motion: v?.motion,
      level: line.level,
      trackText: line.short || line.claim,
      arrivalText,
      inspect: line.text,
      lensMin: lensMin > 0 ? lensMin : null,
      lensText:
        wx.at != null
          ? `${hhmm(new Date(wx.at).toISOString())} on this track`
          : '',
      alerts: alertList(),
      showAlerts: wx.layers.alertAreas,
      lightning: ltgLine(),
      siteNoun: siteNounNow(),
      nearLabel: imperial()
        ? '6 mi · lightning and gusts arrive before the rain core'
        : '10 km · lightning and gusts arrive before the rain core',
      labelScale: document.body.dataset.view === 'screen' ? 2 : 1,
    };
    // Rebuild only when something drawn changed (the shells are traced).
    const key = JSON.stringify([
      g.grid?.t,
      g.kind,
      opts.showShells,
      ap?.status,
      Math.round(ap?.nearMin ?? -1),
      Math.round(ap?.overMin ?? -1),
      opts.level,
      opts.trackText,
      opts.lensMin != null ? Math.round(opts.lensMin) : null,
      opts.alerts.map((x) => `${x.event}:${x.inside}`),
      opts.showAlerts,
      opts.lightning?.text,
      opts.labelScale,
    ]);
    renderSevKey(Boolean(opts.showShells && g.grid), Boolean(v?.simulated));
    if (key === stormKey) return;
    stormKey = key;
    stormLayer.set(opts);
  }
  function radar3dNote() {
    const v = ncView();
    if (!v) return 'Radar frames loading';
    if (v.status !== 'live')
      return `The ${v.source} frame did not load · not drawn`;
    if (v.simulated) return `SIMULATED storm (prototype) · ${HEIGHT_RULE}`;
    const k = nc.lensKind;
    const rule = v.latest?.tops ? HEIGHT_RULE : HEIGHT_RULE_EST;
    if (k === 'projected')
      return `PROJECTED to ${wxTime(wx.at)} on the current track · from ${v.source} ${wxTime(v.frameAt)} · ${rule}`;
    if (k === 'beyond')
      return 'Beyond the 60 min projection · the forecast map takes over';
    if (k === 'nomotion')
      return v.positionOnly
        ? 'Satellite estimate · position only · no projection ahead'
        : 'No motion measured · no projection ahead';
    if (k === 'noframe')
      return 'The satellite estimate runs about 1 h behind · no frame for this time yet';
    if (k === 'loading') return 'Radar frame loading';
    if (k === 'missing') return 'No radar frame for this time · not drawn';
    const claim = nc.text?.claim ? `${nc.text.claim} · ` : '';
    return `${claim}${v.source} ${ago(wx.at != null ? wx.at : v.frameAt)} · ${rule}`;
  }
  function alertAreasNote() {
    if (region !== 'us')
      return 'MeteoAlarm areas come without a shape · alerts are listed in the Summary';
    const list = alertList();
    if (!list.length)
      return `No official alerts for this point · NWS checked ${wx.warningsAt ? ago(wx.warningsAt) : 'at load'}`;
    const inside = list.filter((a) => a.inside).length;
    return `${list.length} alert area${list.length > 1 ? 's' : ''}${inside ? ` · the ${siteNounNow()} is inside ${inside === list.length ? (list.length > 1 ? 'all' : 'it') : inside}` : ''}`;
  }
  /** The chip on the map's edge (All-in-one only: walls show no controls). */
  function approachChip() {
    if (document.body.dataset.view === 'screen') return [];
    const t = nc.text;
    if (!['arriving', 'near', 'over'].includes(t?.status)) return [];
    return [
      {
        label: t.short,
        plain: true,
        wx: t.level,
        onClick: () => frameStorm(),
      },
    ];
  }
  /** Operator action: storm shells on; frame site and storm across the track. */
  function frameStorm() {
    wx.layers.radar3d = true;
    const v = ncView();
    const site = ncCenter();
    const pts = [site];
    const core = v?.ap?.core;
    if (core) {
      pts.push(core);
      // The storm body trails the core: take in 20 min of track behind it.
      if (hasMotion(v.motion)) {
        const km = (v.motion.speedKmh * 20) / 60;
        const h = Cesium.Math.toRadians(v.motion.headingDeg);
        pts.push({
          lat: core.lat - (km * Math.cos(h)) / 111.32,
          lon:
            core.lon -
            (km * Math.sin(h)) /
              (111.32 * Math.cos((core.lat * Math.PI) / 180)),
        });
      }
    }
    const sphere = Cesium.BoundingSphere.fromPoints(
      pts.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)),
    );
    // Look across the track, so the storm moves left to right in view —
    // but never swing more than 60° (motion review R2-5): beyond that keep
    // the operator's heading and pull back instead.
    const now = viewer.camera.heading;
    const across = hasMotion(v?.motion)
      ? Cesium.Math.toRadians((v.motion.headingDeg + 270) % 360)
      : now;
    const turn = Math.abs(Cesium.Math.negativePiToPi(across - now));
    const heading = turn > Cesium.Math.toRadians(60) ? now : across;
    const incidentNow = lastCtx?.mode?.mode === 'incident';
    twin.flySafe(sphere, {
      heading,
      pitch: Cesium.Math.toRadians(-30),
      range: Math.max(14000, sphere.radius * 3.4),
      fit: true,
      // 1.2 s; 600 ms during an incident; none with Reduce motion.
      duration: reducedMotion() ? 0 : incidentNow ? 0.6 : 1.2,
    });
    stormKey = '';
    drawWeather();
    renderLayers();
  }
  // Inspect card: value, source, age, place (phase 12, idea 8).
  const inspectEl = document.createElement('section');
  inspectEl.className = 'tt-wx-inspect tt-panel';
  inspectEl.hidden = true;
  inspectEl.setAttribute('role', 'status');
  document.body.append(inspectEl);
  let inspectTimer = null;
  function showInspect(id) {
    const v = ncView();
    const g = stormGridAt();
    const frameText = !v
      ? ''
      : v.simulated
        ? 'SIMULATED storm (prototype)'
        : g.kind === 'projected'
          ? `PROJECTED to ${wxTime(wx.at)} on the current track from ${v.source} ${wxTime(v.frameAt)}`
          : `${v.source} ${ago(g.grid?.t ?? v.frameAt)}`;
    const info = stormLayer?.info(id, {
      frameText,
      siteNoun: siteNounNow(),
      dist: (m) => formatDistance(m),
    });
    if (!info) return false;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tt-x';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => (inspectEl.hidden = true));
    const k = document.createElement('div');
    k.className = 'tt-kicker';
    k.textContent = `INSPECT · ${info.title.toUpperCase()}`;
    const head = document.createElement('div');
    head.className = 'tt-wx-inspect-head';
    head.append(k, close);
    inspectEl.replaceChildren(
      head,
      ...info.lines.map((t) => {
        const d = document.createElement('div');
        d.className = 'tt-wx-inspect-line';
        d.textContent = t;
        return d;
      }),
    );
    inspectEl.hidden = false;
    clearTimeout(inspectTimer);
    inspectTimer = setTimeout(() => (inspectEl.hidden = true), 25e3);
    return true;
  }
  /** Demo: the simulated storm on or off (Prototype, or the remote). */
  function setSimStorm(start) {
    // A demo older than 45 min has ended, whatever the session says.
    const s = start && Date.now() - start < SIM_MAX_MS ? start : null;
    if (s === nc.simStart) return;
    nc.simStart = s;
    nc.simGrid.clear();
    if (nc.simStart) {
      wx.layers.radar3d = true;
      wx.layers.lightning = true;
    } else if (wx.lastLightning?.simulated) wx.lastLightning = null;
    const box = $('tt-simstorm');
    if (box) box.checked = Boolean(nc.simStart);
    document.body.classList.toggle('tt-demo-storm', Boolean(nc.simStart));
    stormKey = '';
    renderSimFlag();
    refreshNowcast();
    renderWeather();
  }
  /** OFFICIAL kicker plus the same lines as every other surface. */
  /**
   * S4's left cards (A5-S4-PLAN): Official · Storm approach · Outdoors now
   * · Sensed · At the hotel, in the board-card recipe. The approach band
   * owns the numeral and claim, so the approach card keeps the detail.
   */
  let lastLtgNear = 0;
  function weatherCards(node) {
    const card = (key, kicker, cls = '') => {
      const sec = document.createElement('section');
      sec.className = `tt-board-card tt-board-${key}${cls ? ` ${cls}` : ''}`;
      const k = document.createElement('div');
      k.className = 'tt-kicker';
      k.textContent = kicker;
      sec.append(k);
      node.append(sec);
      const add = (c, t) => {
        const n = document.createElement('div');
        n.className = c;
        n.textContent = t;
        sec.append(n);
        return n;
      };
      add.sec = sec;
      return add;
    };
    const lines = officialLines();
    const warning = lines.some((l) => l.sim || l.official);
    const ap = nc.text || approachLine();
    const near = ['arriving', 'near', 'over'].includes(ap.status);
    {
      const add = card(
        'official',
        officialKicker(),
        warning ? 'attention' : '',
      );
      for (const l of lines)
        add(
          l.note
            ? 'tt-wall-note'
            : `tt-wall-line${l.sim ? ' sim' : l.official ? ' official' : l.warn ? ' warn' : ''}`,
          l.text,
        );
    }
    {
      const add = card(
        'approach',
        `STORM APPROACH · RADAR TRACK${nc.sim ? ' · SIMULATED' : ''}`,
        !warning && ['near', 'over'].includes(ap.status) ? 'attention' : '',
      );
      // The band says the numeral and the claim; here the track's detail
      // (and the claim only when there is no band, e.g. no storm).
      // With the band showing, its numeral, claim and track are not said
      // again: one row, where the core is and where it goes (S4 reviews:
      // four repeated lines pushed lightning out).
      const band = Boolean(ap.lead);
      add(
        'tt-wall-line',
        band
          ? String(ap.detail || ap.claim || ap.text)
              .split(' · ')
              .slice(0, 2)
              .join(' · ')
              .replace(/^./, (c) => c.toUpperCase())
          : ap.claim || ap.text,
      );
      if (!band && ap.detail) add('tt-wall-note', ap.detail);
      if (nc.realText)
        add('tt-wall-note', `Real radar under the demo: ${nc.realText.text}`);
      const pace = lastCtx?.weather?.pace;
      if (lastCtx?.mode?.mode === 'incident' && pace)
        add(
          'tt-wall-line',
          `If the group must move: allow ${pace.pct}% more walking time · ${pace.band} rain${pace.simulated ? ' (simulated)' : ''}`,
        );
    }
    const out = outdoorsNow();
    if (out.length && near) {
      const add = card('outdoors', `OUTDOORS NOW · ${out.length}`, 'amber');
      add.sec.dataset.total = String(out.length);
      for (const o of out.slice(0, 6))
        add(
          'tt-wall-line',
          `${o.name} · ${formatDistance(o.distM)} from the ${siteNounNow()}${o.walkMin ? ` · about ${o.walkMin} min walk` : ''}`,
        );
      if (out.length > 6)
        add('tt-wall-note', `+${out.length - 6} more · on People`);
    }
    // Lightning (Sensed, renamed): heat moves to the fire card (hazards
    // H5). In a storm, or with lightning found, it comes before the fires.
    const ltg = ltgLine();
    const lightningCard = () => {
      const add = card('sensed', 'LIGHTNING', ltg || near ? 'keep' : '');
      add(
        'tt-wall-line',
        ltg?.text ||
          (ltgKnown()
            ? `Lightning: none within ${imperial() ? '19 mi' : '30 km'} in the latest grid`
            : 'Lightning: grid not loaded · not checked'),
      );
    };
    if (ltg || near) lightningCard();
    hazardCards(card);
    if (!(ltg || near)) lightningCard();
    {
      const add = card('hotel', `AT THE ${siteNounNow().toUpperCase()}`);
      // From the chip's parts, said once: "Now · 73 °F · cloudy (SIMULATED)
      // · temperature MET Norway" (S4 reviews: "SIM · … prototype").
      const chip = $('tt-wx');
      const q = (sel) => chip.querySelector(sel)?.textContent.trim() || '';
      const sim =
        Boolean(chip.querySelector('.wx-live.sim')) ||
        q('.wx-live') === 'SIM' ||
        Boolean(nc.simStart);
      const parts = [
        sim ? 'Now' : q('.wx-live'),
        q('.wx-t'),
        `${q('.wx-c').replace(/^SIMULATED\s*/i, '')}${sim ? ' (SIMULATED)' : ''}`,
        q('.wx-src').replace(/^prototype\s*·\s*/i, ''),
      ].filter((t) => t && t !== ' (SIMULATED)');
      add(
        'tt-wall-line',
        q('.wx-t')
          ? parts.join(' · ')
          : chip.textContent || 'Weather · loading',
      );
      add(
        'tt-wall-note',
        'Sources and ages as shown · never a statement that conditions are fine',
      );
    }
  }
  /**
   * S4's fire and tropical cards (hazards H5): FIRE · NIFC + FIRMS and
   * HURRICANES & TROPICAL STORMS · NHC when something is within reach;
   * otherwise one quiet card. Amber at a check level, and then never folds.
   */
  function hazardCards(card) {
    const hz = lastCtx?.hazards;
    const heat = lastCtx?.fires?.line || 'Satellite heat detections · loading';
    const line = (add, l) =>
      add(
        l.tone === 'dim'
          ? 'tt-wall-note'
          : `tt-wall-line${l.tone === 'amber' ? ' warn' : ''}`,
        l.text,
      );
    if (!hz || (!hz.fires.length && !hz.tropical.length)) {
      const add = card('hazards', 'FIRES · HURRICANES & TROPICAL STORMS');
      add('tt-wall-line', heat);
      add('tt-wall-note', hz?.fireStatus || 'Fire boundaries · loading');
      add('tt-wall-note', hz?.tropStatus || 'Tropical storms · loading');
      return;
    }
    // An NWS fire or tropical product in Official leads; the cards then add
    // the shapes and drop their amber outline (X21).
    const official = officialLines()
      .map((l) => l.text)
      .join(' ');
    const nwsFire =
      /\b(Fire|Red Flag|Evacuation)\b[^·]*\b(Warning|Watch)\b/i.test(official);
    const nwsTrop =
      /\b(Hurricane|Tropical Storm)\b[^·]*\b(Warning|Watch)\b/i.test(official);
    if (hz.fires.length) {
      const sim = hz.fires.some((f) => f.simulated);
      const add = card(
        'fire',
        `FIRE · NIFC + FIRMS${sim ? ' · SIMULATED' : ''}${hz.fireState === 'stale' ? ' · DELAYED' : ''}`,
        hz.fireCheck.length && !nwsFire ? 'amber keep' : 'keep',
      );
      if (nwsFire)
        add(
          'tt-wall-note',
          'The NWS product in Official leads · this card adds the boundary',
        );
      const [top, ...rest] = hz.fires;
      for (const l of fireLines(top, {
        heatInside: hz.heat?.byFire?.get(top.row.stableId) || 0,
        wind: hz.wind,
        noun: siteNounNow(),
      }))
        line(add, l);
      for (const f of rest.slice(0, 2))
        line(add, {
          text: fireShort(f, siteNounNow()),
          tone: f.level === 'area' ? '' : 'amber',
        });
      add('tt-wall-line', heat);
      add('tt-wall-note hz-status', hz.fireStatus);
      if (!hz.tropical.length) add('tt-wall-note hz-status', hz.tropStatus);
    }
    if (hz.tropical.length) {
      const sim = hz.tropical.some((t) => t.simulated);
      const add = card(
        'tropical',
        `HURRICANES & TROPICAL STORMS · NHC${sim ? ' · SIMULATED' : ''}${hz.tropState === 'stale' ? ' · DELAYED' : ''}`,
        hz.tropCheck.length && !nwsTrop ? 'amber keep' : 'keep',
      );
      if (nwsTrop)
        add(
          'tt-wall-note',
          'The NWS product in Official leads · this card adds the cone',
        );
      const [top, ...rest] = hz.tropical;
      for (const l of tropicalLines(top, hz.now, siteNounNow())) line(add, l);
      for (const t of rest.slice(0, 1))
        line(add, { text: tropicalShort(t, hz.now), tone: '' });
      add('tt-wall-note hz-status', hz.tropStatus);
      if (!hz.fires.length) {
        add('tt-wall-line', heat);
        add('tt-wall-note hz-status', hz.fireStatus);
      }
    }
  }
  /** A day's first stop still ahead (today), else its first (B5-S5-PLAN). */
  function nextStop(day) {
    const evs = advEvents().filter((e) => e.day === day);
    const today = todayDay();
    if (day < today) return null;
    if (day > today) return evs[0] || null;
    // Today: the first stop still ahead on the plan's clock; none left,
    // none (never a past stop tagged NEXT: S5 reviews).
    const now = planNow();
    return evs.find((e) => Number.isFinite(e.epoch) && e.epoch > now) || null;
  }
  const dayDate = (iso) =>
    iso
      ? new Date(`${iso}T12:00:00Z`)
          .toLocaleDateString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
          })
          .replace(',', '')
          .toUpperCase()
      : '';
  const localHm = (ms) =>
    new Date(ms).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: city.timezone,
    });
  /**
   * S5 in the new frame (B5-S5-PLAN): the day's Schedule, the shown stop's
   * brief, and Official while a warning is active. o = {chosen, report:
   * {board, people}, weatherWall} — a stop picked at the wall; this trip's
   * report and which walls carry its board and its people.
   */
  function dayCards(node, o = {}) {
    node.replaceChildren();
    const card = (key, kicker, cls = '') => {
      const sec = document.createElement('section');
      sec.className = `tt-board-card tt-board-${key}${cls ? ` ${cls}` : ''}`;
      const k = document.createElement('div');
      k.className = 'tt-kicker';
      k.textContent = kicker;
      sec.append(k);
      node.append(sec);
      const add = (c, t) => {
        const n = document.createElement('div');
        n.className = c;
        if (t != null) n.textContent = t;
        sec.append(n);
        return n;
      };
      add.sec = sec;
      return add;
    };
    const ev = advEvents().find((e) => e.key === adv.eventKey);
    if (!ev || !lastCtx?.snapshot) {
      card('schedule', 'SCHEDULE')('tt-wall-line', 'Plan loading');
      return;
    }
    const day = ev.day;
    const today = day === todayDay();
    const dayWord = today ? 'TODAY' : dayDate(ev.date);
    const evs = advEvents().filter((e) => e.day === day);
    const next = nextStop(day);
    const now = planNow();
    // This trip's report and where it is (any site of the trip: S5 P0-4).
    const repKey = o.report ? reportSiteKey() : null;
    const repSite = o.report
      ? SITES.find((x) => x.key === repKey) || { label: 'this trip' }
      : null;
    const repHere = Boolean(repKey && repKey === ev.siteKey);
    const site = SITES.find((x) => x.key === ev.siteKey) || SITES[0];
    // The fit keeps what the situation needs (S5 P0-2).
    const warning = officialLines().some((l) => l.sim || l.official);
    node.dataset.ctx = repHere ? 'report' : warning ? 'warning' : '';
    // 1 · Schedule: the day in time order, the shown stop marked.
    {
      const add = card('schedule', `SCHEDULE · DAY ${day} · ${dayWord}`);
      if (repSite) {
        add(
          'tt-wall-line tt-day-report',
          `Report open · ${repSite.label} · details on ${o.report.board || 'the remote'}`,
        );
        add(
          'tt-wall-note keep',
          `Traveler positions are not on this wall${o.report.people ? ` · ${o.report.people}` : ''}`,
        );
      }
      // One sunset for the wall: the shown stop's, as its Light row says.
      let sunset = null;
      try {
        const c = site.anchors?.inside || site.center;
        sunset = sunTimes(ev.date, c.lat, c.lon ?? c.lng).set || null;
      } catch {
        /* no sunset row */
      }
      const rows = evs.map((e) => ({ e, t: e.epoch }));
      if (sunset) rows.push({ sun: true, t: +new Date(sunset) });
      rows.sort((x, y) => (x.t ?? 0) - (y.t ?? 0));
      for (const r of rows) {
        if (r.sun) {
          add('tt-wall-line tt-day-row sun', null).append(
            Object.assign(document.createElement('span'), {
              className: 't',
              textContent: localHm(r.t),
            }),
            ' · Sunset',
          );
          continue;
        }
        const e = r.e;
        const es = SITES.find((x) => x.key === e.siteKey);
        const shown = e.key === ev.key;
        const past = today && Number.isFinite(e.epoch) && e.epoch < now;
        const line = add(
          `tt-wall-line tt-day-row${shown ? ' shown' : ''}${past && !shown ? ' past' : ''}`,
          null,
        );
        line.dataset.stop = e.key;
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = `${e.start}${e.end ? `–${e.end}` : ''}`;
        line.append(
          t,
          ` · ${e.title}${es && !String(e.title).includes(es.short || '§') ? ` · ${es.short || es.label || ''}` : ''}`,
        );
        const tags = [];
        if (repKey && e.siteKey === repKey) tags.push(['rep', 'REPORT HERE']);
        // NEXT only on the next stop; the shown one says why it is shown.
        if (e.key === next?.key) tags.push(['', 'NEXT']);
        else if (shown && o.chosen) tags.push(['', 'CHOSEN HERE']);
        else if (past) tags.push(['dim', 'EARLIER']);
        for (const [c, txt] of tags) {
          const g = document.createElement('span');
          g.className = `tag${c ? ` ${c}` : ''}`;
          g.textContent = txt;
          line.append(g);
        }
      }
      if (today && !next) {
        const later = advEvents().find((e) => e.day > day);
        add(
          'tt-wall-note keep',
          `No stops left today${later ? ` · next: Day ${later.day} ${later.start}` : ''}`,
        );
      }
    }
    // 2 · Stop brief: label-led rows; no tick boxes, no review state
    // (reviews live at the All-in-one; a wall cannot see them).
    {
      const brief = briefFor(ev);
      const items = brief.items.map((it) => ({ ...it }));
      // Alerts: the warning every surface reads, timed against the stop
      // (S5 reviews): covering it needs a look; ending before it does not.
      const warns = [];
      const a = simAlert();
      if (a) warns.push({ sim: true, event: a.event, ends: a.ends });
      if (wx.warningsStatus !== 'unavailable')
        for (const w of wx.warnings || [])
          if (/warning/i.test(w.event)) warns.push(w);
      const alerts = items.find((it) => it.key === 'alerts');
      const src = WX.warnings === 'nws' ? 'NWS' : 'MeteoAlarm';
      if (alerts && warns.length && ev.epoch) {
        const parts = warns.map((w) => {
          const start =
            Date.parse(w.onset || w.effective || '') ||
            Number.NEGATIVE_INFINITY;
          const endRaw = Date.parse(w.ends || w.expires || '');
          const end = Number.isFinite(endRaw) ? endRaw : Infinity;
          const tag = w.sim ? ' (SIMULATED)' : '';
          const cover = start <= ev.epoch && ev.epoch <= end;
          const endTxt = Number.isFinite(endRaw)
            ? wallClocks()
              ? `until ${wxTime(endRaw, { sim: Boolean(w.sim) })}`
              : `until ${today ? '' : 'today '}${localHm(endRaw)}`
            : 'until further notice';
          return cover
            ? {
                cover,
                t: `${w.event}${tag} · covers ${ev.start}${o.weatherWall ? ` · on ${o.weatherWall}` : ''}`,
              }
            : {
                // The event's name is on the Official card above (S5 r2).
                t: `Warning now${tag} · ${endTxt}, before ${today ? 'the stop' : `Day ${day}`}`,
              };
        });
        alerts.text = parts.map((x) => x.t).join(' · ');
        alerts.warn = parts.some((x) => x.cover);
        // A live warning is never folded into the "No flags" line.
        alerts.keep = true;
      } else if (alerts && wx.warningsStatus !== 'unavailable') {
        // "Checked now" never ages on a wall (S5 AIA): say when.
        alerts.text = `None on file for ${ev.start} · ${src} checked ${wx.warningsAt ? ago(wx.warningsAt) : 'at load'} · alerts are issued close to the time`;
      }
      // Review ticks (the All-in-one's): who (none in visitor mode) and
      // when, on the walls' clock.
      const reviewOf = (it) =>
        (o.reviews || {})[`${o.tripId || ''}|${ev.key}|${it.key}`] || null;
      const reviewed = items.filter((it) => reviewOf(it)).length;
      const look = items.filter((it) => it.warn).length;
      // Never "READY": the wall cannot vouch for a stop (S5 reviews, P0).
      const state = repHere
        ? `REPORT OPEN HERE · ${o.report.board || 'REMOTE'}`
        : look
          ? `${look} NEED${look > 1 ? '' : 'S'} A LOOK`
          : 'NOTHING FLAGGED';
      const add = card(
        'brief',
        `STOP BRIEF · ${ev.start} · ${state}${reviewed ? ` · ${reviewed} OF ${items.length} REVIEWED` : ''}${o.chosen && ev.key !== next?.key ? ' · CHOSEN HERE' : ''}`,
        repHere ? 'rep' : '',
      );
      add(
        'tt-wall-line tt-day-title',
        String(ev.title).includes(site.short || '§') ||
          String(ev.title).includes(site.label)
          ? ev.title
          : `${site.label} · ${ev.title}`,
      );
      for (const it of items) {
        const wxRow = ['forecast', 'alerts', 'hazards'].includes(it.key);
        const line = add(
          `tt-wall-line tt-day-check${it.warn ? ` look${wxRow ? ' wx' : ''}` : it.keep ? ' keep' : ' ok'}`,
          null,
        );
        line.dataset.label = it.label.replace(/^Nearest /, '');
        line.dataset.key = it.key;
        const lab = document.createElement('b');
        lab.textContent = `${it.label}: `;
        line.append(
          lab,
          `${String(it.text)
            .replace(/ straight line/g, '')
            .replace(/ \(estimate ×1\.3 for streets\)/, '')
            // The hospital row in two lines, not five (S5 UI P1-2): the
            // name up to " at ", and a short source.
            .replace(
              ' · emergency department listed in OpenStreetMap',
              ' · emergency dept. listed (OSM)',
            )
            .replace(
              /^([^·]+?) at [^·]+ ·/,
              it.key === 'hospital' ? '$1 ·' : '$&',
            )}${it.warn ? ' · needs a look' : ''}`,
        );
        const rv = reviewOf(it);
        if (rv) {
          line.classList.add('reviewed');
          const tag = document.createElement('span');
          tag.className = 'rv';
          tag.textContent = ` · reviewed${rv.by && !o.visitor ? ` ${rv.by}` : ''} ${wxTime(rv.at, { sim: true }).replace(/ \S+$/, '')}`;
          line.append(tag);
        }
      }
      // The street photo stepped aside rather than cover a rally point or
      // shelter: say where it is (Jesse, 27 Oct).
      if (o.photoAside)
        add(
          'tt-wall-note keep tt-day-photo',
          'Street photo on the All-in-one · here it would cover a rally point',
        );
      add(
        'tt-wall-note tt-day-foot',
        'Distances are straight lines from OpenStreetMap · reviews are ticked at the All-in-one · notes are not shown on walls',
      );
    }
    // Official, only while a warning is active (one amber outline), right
    // under the Schedule: a warning reads before the stop's facts.
    if (warning) {
      const add = card('official', officialKicker(), 'attention keep');
      for (const l of officialLines()) {
        const n = add(
          l.note
            ? 'tt-wall-note'
            : `tt-wall-line${l.sim ? ' sim' : l.official ? ' official' : l.warn ? ' warn' : ''}`,
          l.text,
        );
        // One line when the column is short (S5 r2): what, until when,
        // where the full story is.
        if (!l.note)
          n.dataset.short = `${l.text.split(' · ').slice(0, 3).join(' · ')}${o.weatherWall ? ` · ${o.weatherWall}` : ''}`;
      }
      node.querySelector('.tt-board-schedule')?.after(add.sec);
    }
  }
  /** "OFFICIAL · NWS", "· SIMULATED" over the demo warning (S4 IA P1-3). */
  function officialKicker() {
    return `OFFICIAL · ${WX.warnings === 'nws' ? 'NWS' : 'MeteoAlarm'}${simAlert() ? ' · SIMULATED' : ''}`;
  }
  function officialInto(add) {
    add('tt-kicker', officialKicker());
    for (const l of officialLines())
      add(
        l.note
          ? 'tt-wall-note'
          : `tt-wall-line${l.sim ? ' sim' : l.official ? ' official' : l.warn ? ' warn' : ''}`,
        l.text,
      );
  }
  /** Lead numeral, claim, detail: readable from across the room. */
  function tierBlock(ap) {
    const box = document.createElement('div');
    box.className = `tt-wx-tiers ${ap.level || 'info'}`;
    if (ap.lead) {
      const n = document.createElement('div');
      n.className = 'tt-wx-lead';
      n.textContent = ap.lead;
      box.append(n);
    }
    const c = document.createElement('div');
    c.className = 'tt-wx-claim';
    c.textContent = ap.claim || ap.text;
    box.append(c);
    if (ap.detail) {
      const d = document.createElement('div');
      d.className = 'tt-wx-detail';
      d.textContent = ap.detail;
      box.append(d);
    }
    return box;
  }
  /** "VIEWING +30 MIN · 20:51 CDT · PROJECTION …" while the lens is away. */
  function lensLine() {
    if (wx.at == null) return '';
    const now = Date.now();
    const what = nc.simStart
      ? 'SIMULATED STORM'
      : wx.at <= now
        ? nc.res?.positionOnly
          ? 'SATELLITE ESTIMATE'
          : 'OBSERVED RADAR'
        : projectionOn() && wx.at - now <= PROJECT_MAX_MIN * 60e3
          ? 'PROJECTION ON THE CURRENT TRACK, NOT A FORECAST MODEL'
          : 'FORECAST';
    // Rounded to 5 min so every wall reads the same figure.
    const m = Math.round((wx.at - now) / 60e3);
    const rel =
      Math.abs(m) >= 10
        ? `${m > 0 ? '+' : '−'}${Math.round(Math.abs(m) / 5) * 5} MIN`
        : relText(wx.at, now).toUpperCase();
    const claim = lensClaim();
    // A duration already says when: no second time beside it.
    const at =
      wallClocks() && !nc.simStart
        ? ''
        : ` · ${wxTime(wx.at, { sim: Boolean(nc.simStart) })}`;
    return `VIEWING ${rel}${at} · ${what}${claim ? ` · ${claim}` : ''}`;
  }
  function wxRowNote(key) {
    if (key === 'radar3d') return radar3dNote();
    if (key === 'alertAreas') return alertAreasNote();
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
    sm.textContent = `Weather overlays · ${on} of 7 on`;
    d.append(sm);
    for (const [key, label] of [
      ['radar3d', 'Storm shells (3D)'],
      ['alertAreas', 'Official alert areas'],
      ['lightning', 'Lightning'],
      ['precip', 'Rain map (flat)'],
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
    // Demo storm strikes are simulated too (QA D1, P0).
    const simLtg = wx.sim.lightning || Boolean(nc.sim?.strikes?.length);
    const live = lightningException(strikes(), gatherings, {
      simulated: simLtg,
      gridKm: simLtg ? null : WX.lightning?.gridKm,
    });
    if (live)
      wx.lastLightning = { ex: live, at: Date.now(), simulated: simLtg };
    else if (!simLtg && wx.lastLightning?.simulated) wx.lastLightning = null;
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
      official: officialLines()
        .filter((l) => l.official || l.sim || l.warn)
        .map((l) => l.text),
      approach: ['arriving', 'near', 'over'].includes(nc.text?.status)
        ? nc.text
        : null,
      lightningNear: ltgLine(),
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
  // The hazard demos (hazards H5): All-in-one only; walls follow the session.
  for (const [id, kind] of [
    ['tt-simfirebound', 'fire'],
    ['tt-simcyclone', 'cyclone'],
  ]) {
    const box = $(id);
    if (!box) continue;
    box.checked = Boolean(hazardLoad?.sim()[kind]);
    box.addEventListener('change', (e) =>
      setSimHazard(kind, e.target.checked ? Date.now() : null),
    );
  }
  $('tt-simstorm').checked = Boolean(nc.simStart);
  $('tt-simstorm').addEventListener('change', (e) => {
    // All-in-one only: the demo starts at now. Walls keep the session lens.
    if (e.target.checked) setWxTime(null);
    setSimStorm(e.target.checked ? Date.now() : null);
  });
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
    // The approach line and storm labels follow the units at once (QA D8).
    nc.text = approachLine();
    nc.realText = nc.sim ? approachLine(nc.res) : null;
    stormKey = '';
    drawStorm();
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

  // Layers, Display and Keys open as full-screen sheets on the All-in-one
  // (Jesse, 23 Oct): one head with the title, its key and a close button.
  if (params.get('view') !== 'screen') {
    // Display already has its head (phase 5); Keys gets one here.
    $('tt-help').prepend(popHead('Keyboard shortcuts', 'K'));
    for (const id of ['tt-layers', 'tt-display', 'tt-help'])
      $(id).classList.add('tt-sheet');
  }
  // ---- toolbar, popovers, report form ----
  for (const [pop, btn] of Object.entries(POPS))
    $(btn)?.addEventListener('click', () => {
      openPop(pop);
      if (pop === 'tt-layers') renderLayers();
      if (pop === 'tt-sites') renderSites();
    });
  $('tt-help-link').addEventListener('click', () => openPop('tt-help'));
  // The trip crumb opens the same popover as the hotel: sites and trips.
  $('tt-crumb-trip').addEventListener('click', () => {
    openPop('tt-sites');
    renderSites();
  });
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
  // The wall module (twin.html?view=screen), made near the end of main().
  let screen = null;
  const presets = {
    building: { range: 260, pitch: -25, fit: true },
    neighborhood: { range: 1300, pitch: -45 },
    city: { range: 4000, pitch: -55 },
  };
  /** Fly to a scale preset (the button, key 1–3, a wall's session). */
  function flyScale(key) {
    const btn = document.querySelector(`[data-scale="${key}"]`);
    if (!btn) return;
    if (twin.state !== 'ready') return;
    {
      const p = { ...presets[key] };
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
        duration: reducedMotion() ? 0 : flightMs(Math.abs(d - p.range)) / 1000,
        easingFunction: Cesium.EasingFunction.QUARTIC_IN_OUT,
      });
      document
        .querySelectorAll('[data-scale]')
        .forEach((b) => b.classList.toggle('on', b === btn));
    }
  }
  /**
   * A scale chosen by hand. On a wall it is saved through the session, so
   * the remote stays the truth (screens/05-S1-PLAN §5); the echo flies.
   */
  function pickScale(key) {
    if (screen?.requestScale) return screen.requestScale(key);
    flyScale(key);
  }
  for (const btn of document.querySelectorAll('[data-scale]'))
    btn.addEventListener('click', () => pickScale(btn.dataset.scale));

  // ---- prototype drawer behaviour ----
  // A pinned ?site= outranks ?city= (phase 3), so changing the city or the
  // scenario drops it: the new city opens at the scenario's own default site
  // (Jesse, 16 Oct: the City select never changed the venue).
  const reloadWith = (k, v) => {
    const next = new URLSearchParams(location.search);
    next.set(k, v);
    if (k === 'city' || k === 'scenario') next.delete('site');
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
  // Walls: only view keys work by hand here; L / D / K open the wall's own
  // sheets (twinWallSheet.js) and every other setting is on the remote.
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
    // Stations (shell step B): Option+1–6 and Option+0, never on walls,
    // never while typing in a field.
    const sk = stations && stationKey(e);
    if (sk && !e.target.closest?.('input, textarea, select')) {
      e.preventDefault();
      // Option+0: back to the picker, then close; again opens.
      if (sk !== 'rail') pickStation(sk);
      else if (!stationsOpen) setStationsOpen(true);
      else if (gridMode === 'station') stationBack();
      else setStationsOpen(false);
      return;
    }
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
    if (scale) return pickScale(scale);
    if (k === '/') {
      e.preventDefault();
      return hud.focusFind();
    }
    // A board wall has no map, so no Layers (S3 reviews).
    if (
      (k === 'l' || k === 'L') &&
      !document.body.classList.contains('tt-wall-board')
    ) {
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
    if (k === '?' || k === 'k' || k === 'K') return openPop('tt-help');
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
    // ] and [ go on from the person selected now (S2 round 2, c).
    const at = list.findIndex((r) => r.person.id === twin.selectedPersonId);
    const base = at >= 0 ? at : attentionIndex;
    if (k === 'a' || k === 'A') attentionIndex = 0;
    else if (k === ']') attentionIndex = (base + 1) % list.length;
    else if (k === '[')
      attentionIndex =
        ((base < 0 ? list.length : base) - 1 + list.length) % list.length;
    else return;
    twin.selectPerson(list[attentionIndex].person.id, { frame: true });
  });

  // ---- weather feeds: now 10 min, images 5 min, warnings 5 min ----
  // Phase 12: real radar every 3 min (frames come every 5).
  loadNowcast();
  const ncTimer = setInterval(() => loadNowcast(), 3 * 60e3);
  // Every 20 s: arrival times count down from now; the demo storm moves.
  const ncSimTimer = setInterval(() => refreshNowcast(), 20e3);
  cleanups.push(
    () => clearInterval(ncTimer),
    () => clearInterval(ncSimTimer),
  );
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
  // Filming (?film, or ?film=<epoch ms> on a page outside a session): the
  // feed lands on 15 s steps from the epoch, so takes recorded minutes
  // apart show the same clock and data at the same second (film recording,
  // scripts/film-trip-twin.mjs).
  const FILM = params.has('film');
  const filmEpoch = Number(params.get('film'));
  let scenarioEpoch =
    FILM && Number.isFinite(filmEpoch) && filmEpoch > 0 ? filmEpoch : null;
  if (FILM) document.body.classList.add('tt-film');
  let filmStep = null;
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
  const feedTimer = FILM
    ? setInterval(() => {
        if (params.has('freeze') || scenarioEpoch == null) return;
        const k = Math.floor((Date.now() - scenarioEpoch) / 15000);
        if (k !== filmStep) {
          filmStep = k;
          feed();
        }
      }, 100)
    : setInterval(() => {
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
      stormLayer?.dispose();
      stormLayer = null;
      beacons?.dispose();
      beacons = null;
      customLayer?.dispose();
      customLayer = null;
      hzDispose?.();
      hzDispose = null;
      hzKey = '';
      await twin.close();
      $('tt-exit').textContent = 'Open Trip Twin';
    } else if (twin.state === 'idle') {
      $('tt-exit').textContent = '‹ World View';
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
  let anyIncCache = { at: 0, v: false };
  const screenApi = {
    cityKey,
    tripTitle: () => focusTrip.title,
    // People and places a change names, from this wall's own snapshot (K8).
    names: {
      person: (id) =>
        (lastCtx?.snapshot?.participants || []).find((p) => p.id === id)
          ?.name || null,
      place: (id) => {
        const p = (lastCtx?.snapshot?.safety_points || []).find(
          (x) => x.id === id,
        );
        return p ? p.label || p.name || null : null;
      },
    },
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
        const d = day ?? defaultPlanDay();
        // The day's next stop, not its first (B5-S5-PLAN).
        const ev = nextStop(d) || advEvents().find((e) => e.day === d) || null;
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
      flyScale(key);
    },
    // The wall menu's view moves (screens/05-S1-PLAN): the camera only.
    faceNorth: () => twin.viewFromSide(0),
    planView: () => screenApi.frame({ kind: 'topdown' }),
    viewFloors() {
      if (twin.state !== 'ready') return;
      if (!isHotelSel()) twin.select(hotelId());
      if (!cutawayOpen) {
        cutawayOpen = true;
        save('cutawayOpen', 'true');
        setCutHead();
      }
      (lastCtx?.dockedCutaway ? docked : cutaway).focus(
        twin.floorFocus ?? lastCtx?.reportedLabel,
      );
    },
    frameHotel() {
      if (twin.state !== 'ready') return;
      if (!isHotelSel()) twin.select(hotelId());
      twin.frameSelection();
    },
    firstToCheck() {
      const list = flatNeeds();
      if (!list.length) return;
      attentionIndex = 0;
      twin.selectPerson(list[0].person.id, { frame: true });
    },
    floorsAvailable: () => Boolean(lastOcc?.available),
    needsCount: () => flatNeeds().length,
    /** ] : the next person who needs attention, wrapping (S2 tiles). */
    nextToCheck() {
      const list = flatNeeds();
      if (!list.length) return;
      // From the person selected now, else from the last one walked.
      const i = list.findIndex((r) => r.person.id === twin.selectedPersonId);
      attentionIndex = ((i >= 0 ? i : attentionIndex) + 1) % list.length;
      twin.selectPerson(list[attentionIndex].person.id, { frame: true });
    },
    /** [ : the previous person who needs attention (S3 tiles). */
    prevToCheck() {
      const list = flatNeeds();
      if (!list.length) return;
      const i = list.findIndex((r) => r.person.id === twin.selectedPersonId);
      const base = i >= 0 ? i : list.length;
      attentionIndex = (base - 1 + list.length) % list.length;
      twin.selectPerson(list[attentionIndex].person.id, { frame: true });
    },
    /** Which of the list the selection is ("2 of 6"), or ''. */
    checkPosition() {
      const list = flatNeeds();
      const i = list.findIndex((r) => r.person.id === twin.selectedPersonId);
      return i >= 0 ? `${i + 1} of ${list.length}` : '';
    },
    hasSelection: () => Boolean(twin.selectedPersonId),
    selectedPersonId: () => twin.selectedPersonId || null,
    /** Straight down within ~10°. */
    isPlanView: () => Boolean(viewer) && viewer.camera.pitch < -1.4,
    /** Every located person in view, from straight above; no selection. */
    frameGroup({ north = false, keepSelection = false } = {}) {
      if (twin.state !== 'ready') return;
      // A remote's spotlight stays (70-S2-FIX-LIST G11).
      if (!keepSelection) twin.select(null);
      // The group here, not a traveler at the airport: within 2 km.
      const c0 = twin.site.center;
      const here = { lat: c0.lat, lng: c0.lon ?? c0.lng };
      const pts = (lastCtx?.snapshot?.participants || [])
        .map((p) => p.coordinates)
        .filter(
          (c) =>
            c &&
            Number.isFinite(c.lat) &&
            Number.isFinite(c.lng) &&
            haversineM(here, c) < 2000,
        )
        .map((c) =>
          Cesium.Cartesian3.fromDegrees(c.lng, c.lat, twin.scene.hotelBase),
        );
      if (!pts.length) return screenApi.frame({ kind: 'topdown' });
      const sphere = Cesium.BoundingSphere.fromPoints(pts);
      sphere.radius = Math.max(sphere.radius, 120);
      // Into the map area the cards leave free.
      twin.flySafe(sphere, {
        heading: north ? 0 : viewer.camera.heading,
        pitch: -Cesium.Math.PI_OVER_TWO + 0.001,
        range: Math.max(500, sphere.radius * 3.2),
        duration: reducedMotion() ? 0 : 1.2,
      });
    },
    /** Plan view ↔ the saved scale's tilted view (one S2 tile). */
    togglePlan() {
      if (screenApi.isPlanView()) {
        const sc = document.querySelector('.tt-tb.on[data-scale]')?.dataset
          .scale;
        flyScale(sc || 'neighborhood');
      } else screenApi.frame({ kind: 'topdown' });
    },
    setLayer(key, on) {
      if (key in wx.layers) {
        wx.layers[key] = on;
        if (on && !['clouds', 'fx'].includes(key)) ensureImage(key);
        drawWeather();
      } else if (key === 'fireBounds' || key === 'tropical') {
        hzLayers[key] = on;
        redrawHazards();
        twin.refresh?.();
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
      // Eased (motion review): heading = h0 + 10°·(1 − cos 2πt/125 s), so
      // it starts from rest, peaks at 0.5°/s and returns to the operator's
      // heading. Roll and pitch are never touched (05 §6.4).
      const AMP = Cesium.Math.toRadians(10);
      const PERIOD = 125000;
      const t0 = performance.now();
      let turned = 0;
      const off = viewer.scene.preRender.addEventListener(() => {
        const t = performance.now() - t0;
        const target = AMP * (1 - Math.cos((2 * Math.PI * t) / PERIOD));
        const step = target - turned;
        turned = target;
        const cam = viewer.camera;
        cam.lookAtTransform(frame);
        cam.rotateRight(step);
        cam.lookAtTransform(Cesium.Matrix4.IDENTITY);
      });
      holdContinuousRender('twin-cine');
      driftOff = () => {
        off();
        releaseContinuousRender('twin-cine');
      };
    },
    applyRoleDefaults(role) {
      // Roles look different from across the room (review R7): weather
      // over the area with heat detections; people from straight above.
      for (const k of ROLES[role]?.layersOn || []) screenApi.setLayer(k, true);
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
          // Keep the operator's heading (D6): only the pitch changes.
          orientation: {
            heading: viewer.camera.heading,
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
      else if (subject?.kind === 'storm') frameStorm();
    },
    // Roles without 3D stop rendering — only once the twin has finished
    // opening (its entry animation needs the render loop).
    pauseRender(off) {
      renderOff = off;
      // For the harness (K8): is the 3D scene paused on this wall?
      document.body.dataset.ttRender = off ? 'paused' : 'on';
      if (twin.state !== 'ready' && twin.state !== 'degraded') return;
      // No viewer (no WebGL on this window): nothing to pause (K8 pauses
      // every unpaired window, so this is reached far more often now).
      if (!viewer) return;
      viewer.useDefaultRenderLoop = !off;
      if (!off) viewer.scene.requestRender();
    },
    captureCanvas() {
      return new Promise((resolve) => {
        if (!viewer?.useDefaultRenderLoop) return resolve(null);
        let done = false;
        const off = viewer.scene.postRender.addEventListener(() => {
          if (done) return;
          done = true;
          off();
          try {
            // The map's words are on the overlay canvas (L5 D11).
            const c = document.createElement('canvas');
            c.width = viewer.canvas.width;
            c.height = viewer.canvas.height;
            const g = c.getContext('2d');
            g.drawImage(viewer.canvas, 0, 0);
            mapLabels.composite(g, c.width, c.height);
            resolve(c.toDataURL('image/jpeg', 0.7));
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
    /** S5's badge: TODAY · DAY 1, or PLAN · DAY 2 · TUE 27 OCT. */
    planBadge() {
      const ev = advEvents().find((e) => e.key === adv.eventKey);
      const d = ev?.day ?? currentAdvanceDay() ?? todayDay();
      // Another day reads as Advance, as on S1–S4 and the remote (S5 IA).
      return d === todayDay()
        ? `TODAY · DAY ${d}`
        : `ADVANCE · DAY ${d}${ev?.date ? ` · ${dayDate(ev.date)}` : ''}`;
    },
    todayDay: () => todayDay(),
    clockText: () =>
      lastCtx?.snapshot
        ? `${sampleClock(lastCtx.snapshot)} local · sample`
        : '',
    // A report at another site of this trip counts too (walls-live W2).
    incidentOpen: () =>
      ['incident', 'incident_elsewhere'].includes(lastCtx?.mode?.mode),
    /** Fit the wall's lists again (resize, text size). */
    refitRail: () => hud.refit(),
    /** S3: the board's own fit, run before the report card trims. */
    setBoardFit: (fn) => {
      boardFit = fn;
    },
    /** Where the report is when it is not the site on screen, else null. */
    incidentElsewhere: () =>
      lastCtx?.mode?.mode === 'incident_elsewhere'
        ? lastCtx.mode.elsewhere?.where || 'another site'
        : null,
    /**
     * Another trip on watch with a report (walls-live W1, D1): its title,
     * for the red chip in every wall header. Never switches the wall.
     */
    /** Other trips' reports by trip and report id (a new one is news). */
    otherTripIds: () =>
      otherTripIncidents().map((o) => `${o.trip.id}:${o.inc?.id || ''}`),
    /** This trip's state, as the All-in-one's pill (screens F1). */
    modeChip: () =>
      lastCtx?.mode
        ? {
            mode: lastCtx.mode.mode,
            chip: lastCtx.mode.chip,
            degraded: Boolean(lastCtx.mode.degraded),
          }
        : null,
    /** The 3D view can fly now (a cached state arrives before it). */
    twinReady: () => twin.state === 'ready',
    otherTripReport() {
      const o = otherTripIncidents()[0];
      return o
        ? { title: o.trip.title, count: otherTripIncidents().length }
        : null;
    },
    /** Seconds since this wall's traveler data last arrived (W11). */
    dataAgeS: () => (Date.now() - lastFeed) / 1000,
    /** A report open on any trip on watch (drift stops for all of them). */
    anyIncidentOpen() {
      const now = Date.now();
      if (anyIncCache.at > now - 30000) return anyIncCache.v;
      const v =
        screenApi.incidentOpen() ||
        DEMO_TRIPS.some(
          (t) =>
            t.id !== focusTrip.id &&
            (
              tripTwinDemoSnapshot(t.city, t.scenario, {
                now,
                startMs: scenarioEpoch,
              }).reported_incidents || []
            ).length > 0,
        );
      anyIncCache = { at: now, v };
      return v;
    },
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
      if (m?.mode === 'incident')
        return `${focusTrip.title} · ${m.topLine.split(' — ')[0]}`;
      // Another site of this trip: say so, the wall shows a different place.
      if (m?.mode === 'incident_elsewhere')
        return `${focusTrip.title} · ${m.topLine.split(' — ')[0]} · not the site on screen`;
      return '';
    },
    /** Phase 12: the approach line, the lens line, the demo storm. */
    approachLine: () => nc.text,
    lensLine: () => lensLine(),
    setSimStorm(start) {
      if ((start || null) !== nc.simStart) setSimStorm(start);
    },
    /** The hazard demos from the session (hazards H5). */
    setSimFire(start) {
      setSimHazard('fire', start || null);
    },
    setSimCyclone(start) {
      setSimHazard('cyclone', start || null);
    },
    /** S3 idle: what changed, what is next, what is official. */
    idlePanel(node, { reported = false } = {}) {
      const add = (cls, t) => {
        const n = document.createElement('div');
        n.className = cls;
        n.textContent = t;
        node.append(n);
      };
      node.replaceChildren();
      // Under a report at another site (W2) the caller writes the head.
      if (!reported) {
        add(
          'tt-kicker',
          `NO INCIDENT REPORTED · ${focusTrip.title.toUpperCase()}`,
        );
        add(
          'tt-wall-note',
          document.body.dataset.view === 'screen'
            ? 'A reported floor opens the board here · needs attention is on the left'
            : 'A reported floor opens the incident board here',
        );
      }
      if (lastA?.counts)
        add(
          'tt-wall-line',
          Object.entries(lastA.counts)
            .map(([k, v]) => `${k === 'Away' ? 'Away from this site' : k} ${v}`)
            .join(' · '),
        );
      // On the wall the list's summary already gives people by site.
      if (lastSiteCounts && document.body.dataset.view !== 'screen') {
        add('tt-kicker', 'PEOPLE BY SITE');
        add('tt-wall-line', siteCountsLine(lastSiteCounts, siteKey));
      }
      add('tt-kicker', 'CHANGED · LAST 10 MIN · SAMPLE CLOCK');
      const recent = changeLog.filter((e) => Date.now() - e.at < 600000);
      if (!recent.length)
        add(
          'tt-wall-line',
          document.body.dataset.view === 'screen'
            ? 'Nothing changed in the last 10 min'
            : `Nothing changed in the last 10 min · data every 5 s · ${lastCtx?.snapshot ? sampleClock(lastCtx.snapshot) : ''}`,
        );
      for (const e of recent.slice(0, 8))
        add(`tt-wall-line${e.warn ? ' warn' : ''}`, changeText(e));
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
          `Day ${e.day} · ${e.start} · ${e.title}${site && !String(e.title).includes(site.short || '§') ? ` · ${site.short || site.label || ''}` : ''}`,
        );
      }
      officialInto(add);
      // Hazards and Safety & paths live here on S3, beside the list
      // (walls-live W3: the left column is Needs attention only).
      const closed = hud.closedLines();
      // An official warning already listed above is not repeated.
      const official = officialLines().map((l) => l.text);
      if (
        !official.some((t) => closed.hazards && t.startsWith(closed.hazards))
      ) {
        add('tt-kicker', 'HAZARDS');
        add('tt-wall-line', closed.hazards || 'Nothing reported');
      }
      if (closed.safety) {
        add(
          'tt-kicker',
          `SAFETY & PATHS${closed.safetyCount ? ` · ${closed.safetyCount}` : ''}`,
        );
        add('tt-wall-line', closed.safety);
      }
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
    /**
     * S3 in the new frame (95-S3-PLAN): the board as glass cards under the
     * report card. o: {report (this trip's report is open), where (a
     * report at another site), hasWeather, hasDay (walls that own those
     * facts — else S3 stands in for them)}.
     */
    boardPanel(node, o = {}) {
      const card = (key, kicker, cls = '') => {
        const sec = document.createElement('section');
        sec.className = `tt-board-card tt-board-${key}${cls ? ` ${cls}` : ''}`;
        const k = document.createElement('div');
        k.className = 'tt-kicker';
        k.textContent = kicker;
        sec.append(k);
        node.append(sec);
        const add = (c, t) => {
          const n = document.createElement('div');
          n.className = c;
          n.textContent = t;
          sec.append(n);
          return n;
        };
        add.sec = sec;
        return add;
      };
      node.replaceChildren();
      // Status: names its trip, so a calm board never reads as all clear
      // for every trip (93-aia §4). A report on screen has the card above.
      if (o.where) {
        const add = card(
          'status',
          `REPORTED AT ${o.where.toUpperCase()} · NOT VERIFIED`,
          'hazard',
        );
        add(
          'tt-wall-line',
          `At ${o.where}, not the site on screen · the list on the left includes who may be there`,
        );
      }
      // What changed in the last 10 min: S3's own (no other wall shows it).
      {
        const add = card('changed', 'CHANGED · LAST 10 MIN');
        const recent = changeLog.filter((e) => Date.now() - e.at < 600000);
        // The true total, so "+n earlier" counts right (S3 reviews).
        add.sec.dataset.total = String(recent.length);
        if (!recent.length)
          add('tt-wall-line', 'Nothing changed in the last 10 min');
        // Every line of the last 10 min; fitBoard keeps the newest three
        // (the report's among them) and counts the rest — never a silent cap.
        // Steel lines; only the report's clock is red (S3 brand round 2:
        // an amber log competed with the report card).
        for (const e of recent) {
          const n = add('tt-wall-line', changeText(e));
          n.dataset.report = e.report ? '1' : '';
          if (e.report && e.warn && e.clock) {
            n.textContent = '';
            n.append(
              Object.assign(document.createElement('span'), {
                className: 'clk',
                textContent: e.clock,
              }),
              changeText({ ...e, clock: '' }).replace(/^/, ' · '),
            );
          }
        }
      }
      // Official warnings only while one is active; never steps out.
      const official = officialLines().filter(
        (l) => l.official || l.sim || l.warn,
      );
      if (official.length) {
        // One look for a warning on every wall: amber (S4 brand P1-1).
        const add = card('official', officialKicker(), 'keep attention');
        for (const l of official)
          add(
            `tt-wall-line${l.sim ? ' sim' : l.official ? ' official' : ' warn'}`,
            l.text,
          );
      }
      const closed = hud.closedLines();
      // In a report the card's "If the group must move" line carries it.
      if (closed.safety && !o.report) {
        const add = card(
          'paths',
          `SAFETY & PATHS${closed.safetyCount ? ` · ${closed.safetyCount}` : ''}`,
        );
        add('tt-wall-line', closed.safety);
      }
      // Stand-ins for walls this room does not have (91-ia): first to go.
      if (!o.hasWeather && closed.hazards) {
        const add = card('hazards', 'HAZARDS', 'standin');
        add('tt-wall-line', closed.hazards);
      }
      if (!o.hasDay && !o.report) {
        const add = card('next', 'NEXT ON THE PLAN', 'standin');
        const now = Date.now();
        const next = advEvents()
          .filter((e) => Number.isFinite(e.epoch) && e.epoch > now)
          .slice(0, 3);
        if (!next.length) add('tt-wall-line', 'Nothing further on the plan');
        for (const e of next) {
          const site = SITES.find((x) => x.key === e.siteKey);
          add(
            'tt-wall-line',
            `Day ${e.day} · ${e.start} · ${e.title}${site && !String(e.title).includes(site.short || '§') ? ` · ${site.short || site.label || ''}` : ''}`,
          );
        }
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
      }
    },
    /** S5 · Day plan: the day's schedule, sunset, official alerts. */
    dayPanel(node, dayOverride = null) {
      const add = (cls, t) => {
        const n = document.createElement('div');
        n.className = cls;
        n.textContent = t;
        node.append(n);
      };
      node.replaceChildren();
      const d = dayOverride ?? shownDay() ?? todayDay();
      add('tt-kicker', `SCHEDULE · DAY ${d}`);
      const evs = advEvents().filter((e) => e.day === d);
      if (!evs.length)
        add('tt-wall-line', 'No events on the plan for this day');
      for (const e of evs) {
        const site = SITES.find((x) => x.key === e.siteKey);
        add(
          'tt-wall-line',
          `${e.start}${e.end ? `–${e.end}` : ''} · ${e.title}${site && !String(e.title).includes(site.short || '§') ? ` · ${site.short || site.label || ''}` : ''}`,
        );
      }
      try {
        const c = city.anchors?.inside || city.center;
        const date = evs[0]?.date || new Date().toISOString().slice(0, 10);
        const { set } = sunTimes(date, c.lat, c.lon ?? c.lng);
        if (set)
          add(
            'tt-wall-line',
            `Sunset ${new Date(set).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: city.timezone })} local`,
          );
      } catch {
        /* no sunset line */
      }
      officialInto(add);
      if (document.body.dataset.view === 'screen')
        add(
          'tt-wall-note',
          'Checks and notes for each stop are in the brief on the left · reviewed on the All-in-one',
        );
    },
    /** Weather & alerts: official first, then sensed, then now (S4). */
    weatherPanel(node, o = {}) {
      node.replaceChildren();
      if (o.cards) return weatherCards(node);
      const add = (cls, t) => {
        const n = document.createElement('div');
        n.className = cls;
        n.textContent = t;
        node.append(n);
      };
      officialInto(add);
      const ap = nc.text || approachLine();
      add(
        'tt-kicker',
        `STORM APPROACH · RADAR TRACK${nc.sim ? ' · SIMULATED' : ''}`,
      );
      node.append(tierBlock(ap));
      if (nc.realText)
        add('tt-wall-note', `Real radar under the demo: ${nc.realText.text}`);
      const r = nc.res;
      if (!nc.sim && r?.status === 'live' && !r.positionOnly)
        add(
          'tt-wall-note',
          `Motion from two ${r.source} frames 20 min apart · a track, not a forecast model · ${r.latest?.tops ? HEIGHT_RULE : HEIGHT_RULE_EST}`,
        );
      const out = outdoorsNow();
      if (out.length && ['arriving', 'near', 'over'].includes(ap.status)) {
        add('tt-kicker attention', `OUTDOORS NOW · ${out.length}`);
        for (const o of out.slice(0, 6))
          add(
            'tt-wall-line',
            `${o.name} · ${formatDistance(o.distM)} from the ${siteNounNow()}${o.walkMin ? ` · about ${o.walkMin} min walk` : ''}`,
          );
        if (out.length > 6) add('tt-wall-note', `+${out.length - 6} more`);
      }
      add('tt-kicker', 'SENSED');
      // lastCtx.fires is already the formatted line (firesLine at assess).
      add(
        'tt-wall-line',
        lastCtx?.fires?.line || 'Satellite heat detections · loading',
      );
      add(
        'tt-wall-line',
        ltgLine()?.text ||
          `Lightning · ${WX.lightning?.label || 'strike density'} · none within 30 km in the latest grid`,
      );
      add('tt-kicker', `AT THE ${siteNounNow().toUpperCase()}`);
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
    /** What a wall keeps on in weather (A5-S4-PLAN): {warning, sim, near}. */
    weatherGuard() {
      const ap = nc.text || approachLine();
      // The 30-minute lightning rule (travel-risk advice, 25 Oct): the hold
      // lasts until no lightning within ~10 mi for 30 min.
      const ltg = ltgLine();
      if (ltg && (ltg.inside || ltg.distKm <= 16)) lastLtgNear = Date.now();
      // Not loaded is unknown, not clear: a hold already on stays on.
      else if (!ltg && lastLtgNear && !ltgKnown()) lastLtgNear = Date.now();
      const real = wx.warningsStatus !== 'unavailable' ? wx.warnings || [] : [];
      return {
        // Warnings for this point (the NWS point query: near the trip);
        // an advisory or a statement is not a warning (S4 AIA P1-2).
        warning:
          Boolean(simAlert()) || real.some((w) => /warning/i.test(w.event)),
        // Heat stays on for fire and smoke warnings, not a thunderstorm.
        fireWarning: real.some(
          (w) =>
            /fire|smoke|red flag/i.test(w.event) && /warning/i.test(w.event),
        ),
        sim: Boolean(nc.simStart),
        near:
          ['near', 'over'].includes(ap?.status) ||
          Date.now() - lastLtgNear < 30 * 60e3,
        // Fire boundaries and cones needing a check, or their demo (X19).
        fireCheck: Boolean(hzPic?.fireCheck?.length || hzPic?.demo?.fire),
        tropCheck: Boolean(hzPic?.tropCheck?.length || hzPic?.demo?.cyclone),
      };
    },
    /** Everyone outdoors in view, from above (S4 tile). */
    frameOutdoors() {
      const ids = new Set(outdoorsNow().map((o) => o.id));
      if (!ids.size || twin.state !== 'ready') return;
      if (ids.size === 1)
        return twin.selectPerson([...ids][0], { frame: true });
      const pts = (lastCtx?.snapshot?.participants || [])
        .filter((p) => ids.has(p.id) && p.coordinates)
        .map((p) =>
          Cesium.Cartesian3.fromDegrees(
            p.coordinates.lng,
            p.coordinates.lat,
            twin.scene.hotelBase,
          ),
        );
      if (!pts.length) return;
      const sphere = Cesium.BoundingSphere.fromPoints(pts);
      sphere.radius = Math.max(sphere.radius, 120);
      twin.flySafe(sphere, {
        heading: viewer.camera.heading,
        pitch: -Cesium.Math.PI_OVER_TWO + 0.001,
        range: Math.max(500, sphere.radius * 3.2),
        duration: reducedMotion() ? 0 : 1.2,
      });
    },
    outdoorsCount: () => outdoorsNow().length,
    /** S5's cards (B5-S5-PLAN). */
    dayCards: (node, o) => dayCards(node, o),
    /**
     * The S1/S5 plate (review/street-photos P5): 'site' is the hotel, 'day'
     * the shown stop. photos: the session's kept photos; w: the width bucket.
     * Returns photoInfo() plus the credit line and the place's key.
     */
    streetPhoto(kind, { photos = {}, tripId = '', w = 960, mark = true } = {}) {
      const target = photoTargetFor(kind === 'day' ? 'stop' : 'hotel');
      const kept = photos[`${tripId}|${target.key}`] || null;
      const info = photoInfo(target, { kept, w });
      markPhoto(mark ? info : null);
      return { ...info, credit: photoCredit(info.pick?.photo) };
    },
    onStreetPhoto: (fn) => photoWatchers.add(fn),
    streetPhotoFailed: (url) => markPhotoFailed(url),
    /**
     * Whether a rally point or shelter falls under a screen rectangle (the
     * plate steps aside rather than cover one; UI round 2).
     */
    safetyUnder(rect) {
      const snap = lastCtx?.snapshot;
      if (!snap || !rect?.width || twin.state !== 'ready') return false;
      const h = twin.scene?.hotelBase ?? 0;
      for (const p of snap.safety_points || []) {
        if (!/^(rally_|safe_house|shelter)/.test(p.category || '')) continue;
        const c = p.coordinates;
        if (!c) continue;
        const pos = Cesium.Cartesian3.fromDegrees(c.lng ?? c.lon, c.lat, h);
        // Behind the camera projects onto the screen too: not under it.
        const cam = viewer.camera;
        if (
          Cesium.Cartesian3.dot(
            cam.directionWC,
            Cesium.Cartesian3.subtract(
              pos,
              cam.positionWC,
              new Cesium.Cartesian3(),
            ),
          ) <= 0
        )
          continue;
        const w = Cesium.SceneTransforms.worldToWindowCoordinates(
          viewer.scene,
          pos,
        );
        if (
          w &&
          w.x >= rect.left - 12 &&
          w.x <= rect.right + 12 &&
          w.y >= rect.top - 12 &&
          w.y <= rect.bottom + 12
        )
          return true;
      }
      return false;
    },
    /** The wall's traffic camera: {camera, lines} or null (T5). */
    cameraForWall: (sc, frame) => cameraForWall(sc, frame),
    /** S5: is the camera's place the stop it shows? */
    cameraPlaceShown: (place) =>
      String(place || '').split(':')[1] === shownStopSite().key,
    onCamera: (fn) => camWatchers.add(fn),
    /** The plate stepped aside: its map marker goes too. */
    streetPhotoOff: () => markPhoto(null),
    /** The shown day's stops: {day, keys, shown, next}. */
    dayStops() {
      const ev = advEvents().find((e) => e.key === adv.eventKey);
      if (!ev) return null;
      const keys = advEvents()
        .filter((e) => e.day === ev.day)
        .map((e) => e.key);
      return { day: ev.day, keys, shown: ev.key, next: nextStop(ev.day)?.key };
    },
    /** Show a stop on S5; frame: fly to its place. */
    selectStop(key, { frame = false } = {}) {
      const ev = advEvents().find((e) => e.key === key);
      if (!ev) return;
      selectEvent(key);
      const site = SITES.find((x) => x.key === ev.siteKey);
      if (!frame || !site || twin.state !== 'ready') return;
      const c = site.anchors?.inside || site.center;
      twin.flySafe(
        new Cesium.BoundingSphere(
          Cesium.Cartesian3.fromDegrees(
            c.lon ?? c.lng,
            c.lat,
            twin.scene.hotelBase,
          ),
          150,
        ),
        {
          heading: viewer.camera.heading,
          pitch: viewer.camera.pitch,
          range: 900,
          duration: reducedMotion() ? 0 : 1.2,
        },
      );
    },
    /** Weather now on S5 (warning, near storm, report), else the stop's. */
    planWeatherNow(on) {
      // The stop's time again once the forecast has loaded (it may arrive
      // after the stop was picked), checked at most every 10 s.
      const late =
        !on && wx.at == null && Date.now() - (adv.wxTried || 0) > 10e3;
      if (Boolean(adv.wxNow) === Boolean(on) && !late) return;
      adv.wxNow = Boolean(on);
      adv.wxTried = Date.now();
      syncAdvanceWeather();
    },
    planWeatherIsNow: () => Boolean(adv.wxNow),
    /** The map bar's caption on S5: the plan's time, never "in n min". */
    planCaption() {
      // From the same guard that turned the weather to now, worst first
      // (S5 every-time P0-3): report › storm › warning › lightning. The
      // plan's time stays (S5 reviews); short, so the bar keeps its
      // compass at 1728 with the menu open.
      const ev = advEvents().find((e) => e.key === adv.eventKey);
      if (!ev) return '';
      const stop = `stop ${ev.start}`;
      if (adv.wxNow) {
        const report = ['incident', 'incident_elsewhere'].includes(
          lastCtx?.mode?.mode,
        );
        const ap = nc.text || approachLine();
        const sa = simAlert();
        const real = (wx.warnings || []).find((w) => /warning/i.test(w.event));
        const what = report
          ? 'report open'
          : ['arriving', 'near', 'over'].includes(ap?.status)
            ? `storm ${ap.status === 'over' ? 'over' : 'near'}${nc.simStart ? ' (SIMULATED)' : ''}`
            : sa
              ? 'warning (SIMULATED)'
              : real
                ? 'warning'
                : 'lightning near';
        return `Weather now · ${what} · ${stop}`;
      }
      if (wx.at == null) return `Weather now · no forecast map for ${ev.start}`;
      // The plan's clock decides "earlier" (S5 r2): the weather itself is
      // still the real forecast for that hour.
      return `Map at Day ${ev.day} · ${ev.start} · ${ev.epoch < planNow() ? 'earlier stop' : wx.at > Date.now() ? 'forecast' : 'past'}`;
    },
    /** S5's caption is a weather fact (amber) only for a weather reason. */
    planCaptionWeather: () =>
      Boolean(adv.wxNow) &&
      !['incident', 'incident_elsewhere'].includes(lastCtx?.mode?.mode),
    /** The day's stops and the hotel in one view (S5 tile). */
    frameDay({ tilt = false } = {}) {
      const ev = advEvents().find((e) => e.key === adv.eventKey);
      if (!ev || twin.state !== 'ready') return;
      const keys = new Set(
        advEvents()
          .filter((e) => e.day === ev.day)
          .map((e) => e.siteKey),
      );
      keys.add(SITES[0].key);
      const pts = SITES.filter((x) => keys.has(x.key)).map((x) => {
        const c = x.anchors?.inside || x.center;
        return Cesium.Cartesian3.fromDegrees(
          c.lon ?? c.lng,
          c.lat,
          twin.scene.hotelBase,
        );
      });
      const sphere = Cesium.BoundingSphere.fromPoints(pts);
      sphere.radius = Math.max(sphere.radius, 250);
      // tilt: the wall's own framing of the day (S5 r1), at its angle and
      // never closer than the neighborhood.
      twin.flySafe(sphere, {
        heading: viewer.camera.heading,
        pitch: tilt
          ? Math.min(viewer.camera.pitch, -0.6)
          : -Cesium.Math.PI_OVER_TWO + 0.001,
        range: Math.max(tilt ? 2200 : 900, sphere.radius * 3.2),
        duration: reducedMotion() ? 0 : 1.2,
      });
    },
    /** "Forecast 01:00" while the weather is not for now, else ''. */
    wxTimeText: () =>
      wx.at == null
        ? ''
        : `${wx.at > Date.now() ? 'Forecast' : 'Map at'} ${wxTime(wx.at)}`,
    frameStorm: () => frameStorm(),
    stormTracked: () =>
      Boolean(ncView()?.ap?.core || lastCtx?.weather?.approach),
    /**
     * S6 in the new frame (C5-S6-PLAN): one tile per trip, reason first,
     * every clock the header's moment in that trip's zone, counts that
     * add up, one report wording. o = {order, off, board, weatherWall}.
     */
    tripsBoard(node, o = {}) {
      const now = Date.now();
      const ageS = (now - lastFeed) / 1000;
      const at = planNow();
      // This trip's report at any of its sites (S6 r1 P0-1), as the pill.
      const mode = lastCtx?.mode?.mode;
      const reportOpen = mode === 'incident' || mode === 'incident_elsewhere';
      // One delay rule, the header's (S6 r1 P1-1): one feed for every tile.
      const degraded = Boolean(lastCtx?.mode?.degraded);
      const own = lastA?.counts
        ? {
            notCurrent: lastA.counts['Not current'] ?? 0,
            notLocated: lastA.counts['Not located'] ?? 0,
            incident: reportOpen ? lastCtx.mode.topLine.split(' — ')[0] : null,
          }
        : null;
      const ap = nc.text || approachLine();
      const stormNear = ['arriving', 'near', 'over'].includes(ap?.status);
      const headerIso = new Date(at).toLocaleDateString('en-CA', {
        timeZone: city.timezone,
      });
      // Fire boundaries and hurricanes for every trip (hazards H5): the
      // feeds are national. The trip in focus uses this wall's full
      // picture (demos too); the others the real feeds at their hotel.
      const hzData = hazardLoad?.data(now);
      const tripHz = (t) => {
        if (t.id === focusTrip.id) return hzPic;
        const c = TWIN_CITIES[t.city]?.center;
        if (!c || !hzData) return null;
        const ctx = { center: c, stops: [], people: [] };
        return hazardPicture({
          fires: assessFires(hzData.realRows, ctx, now),
          tropical: assessTropical(hzData.realStorms, ctx),
          coverage: hazardCoverage(c),
          firesFeed: hzData.firesFeed,
          tropicalFeed: hzData.tropicalFeed,
          storms: hzData.realStorms,
          now,
        });
      };
      // Both hazards when both need a check (X4).
      const hzLines = (pic) =>
        pic?.check
          ? [
              pic.fireCheck[0] && fireShort(pic.fireCheck[0]),
              pic.tropCheck[0] && tropicalShort(pic.tropCheck[0], now),
            ].filter(Boolean)
          : [];
      // A feed down, or a city outside both, is said on the tile (X11).
      const hzNotChecked = (pic, c) => {
        if (!pic) return null;
        const cov = hazardCoverage(c);
        if (!cov.fire && !cov.tropical) return 'not covered by NIFC or NHC';
        const off = [
          cov.fire && pic.fireState === 'unavailable' && 'fire boundaries',
          cov.tropical && pic.tropState === 'unavailable' && 'hurricanes',
        ].filter(Boolean);
        return off.length ? `${off.join(' and ')} not checked right now` : null;
      };
      const tiles = DEMO_TRIPS.map((t) => {
        const tile = tripTile(
          t,
          tripTwinDemoSnapshot(t.city, t.scenario, {
            now,
            startMs: scenarioEpoch,
          }),
          {
            now,
            dataAgeS: 0,
            at,
            override: t.id === focusTrip.id ? own : null,
          },
        );
        if (!tile || tile.noData) return tile;
        tile.stale = degraded;
        const hz = tripHz(t);
        tile.hzWord = hz?.check ? hz.word : null;
        tile.hzLines = hzLines(hz);
        tile.hzNote = hzNotChecked(
          hz,
          t.id === focusTrip.id ? hzCenter() : TWIN_CITIES[t.city]?.center,
        );
        // A storm on the trip in focus is a reason (S6 r1 P0-2): right
        // after a report, and the tile never folds. A fire boundary or a
        // cone at amber takes the same tier, on any trip (hazards H5).
        if (
          ((t.id === focusTrip.id && stormNear) || tile.hzWord) &&
          !tile.incident
        )
          tile.tier = TIER.report + 0.5;
        else if (degraded && !tile.incident) tile.tier = TIER.stale;
        return tile;
      }).filter(Boolean);
      // This trip's report before another trip's, within the report tier.
      for (const t of tiles)
        if (t.id === focusTrip.id && t.tier === TIER.report) t.tier = -0.5;
      const sorted = sortTiles(tiles, { order: o.order });
      const off = new Set(o.off || []);
      const reported = sorted.filter((t) => t.incident).length;
      node.replaceChildren();
      const head = document.createElement('div');
      head.className = 'tt-kicker tt-trips-head';
      head.textContent = [
        `TRIPS ON WATCH · ${sorted.length}`,
        reported ? `${reported} REPORTED` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      node.append(head);
      if (degraded) {
        const n = document.createElement('div');
        n.className = 'tt-wall-line tt-trips-link';
        n.textContent = `Data delayed for every trip · ${formatAge(ageS)} since the last update · the counts may be out of date`;
        node.append(n);
      }
      const grid = document.createElement('div');
      grid.className = 'tt-trips tt-trips-board';
      grid.dataset.n = String(sorted.length);
      node.append(grid);
      const headerDay = new Date(at).toLocaleDateString('en-GB', {
        timeZone: city.timezone,
        weekday: 'short',
      });
      const toCheckFocus = screenApi.needsCount?.();
      for (const t of sorted) {
        const focus = t.id === focusTrip.id;
        const sec = document.createElement('section');
        sec.className = `tt-trip tt-board-card${t.incident ? (focus ? ' rep' : ' rep-other') : ''}${t.noData ? ' nodata' : ''}${t.stale ? ' stale' : ''}${focus ? ' focus' : ''}`;
        sec.dataset.tier = String(t.tier ?? '');
        sec.dataset.title = t.title;
        const add = (cls, txt) => {
          const n = document.createElement('div');
          n.className = cls;
          if (txt != null) n.textContent = txt;
          sec.append(n);
          return n;
        };
        // 1 · The reason, worst first. The trip in focus counts as the
        // header and S3 do (S6 r1 P1-7).
        const toCheck =
          focus && Number.isFinite(toCheckFocus)
            ? toCheckFocus
            : (t.notCurrent || 0) + (t.notLocated || 0);
        sec.dataset.check = String(toCheck);
        const where =
          focus && mode === 'incident_elsewhere'
            ? lastCtx.mode.elsewhere?.where
            : '';
        const reason = t.incident
          ? focus
            ? [
                'rep',
                `REPORT OPEN${where ? ` · ${where}` : ''} · details on ${o.board || 'the remote'}`,
              ]
            : // Switching clears this trip's open report (S6 r1 P1-6).
              reportOpen
              ? ['rep', 'REPORT · see the remote']
              : ['rep', 'REPORT · switch trips on the remote']
          : t.noData
            ? ['grey', 'NO DATA · nothing received yet']
            : focus && stormNear
              ? [
                  'amber',
                  `STORM ${ap.status === 'over' ? 'OVER THE HOTEL' : 'NEAR'}${nc.simStart ? ' (SIMULATED)' : ''} · ${o.weatherWall || 'the remote'}`,
                ]
              : t.hzWord
                ? [
                    'amber',
                    `${t.hzWord} · ${focus ? o.weatherWall || 'the remote' : 'see the remote'}`,
                  ]
                : t.stale
                  ? ['amber', `DATA DELAYED · ${formatAge(ageS)}`]
                  : toCheck
                    ? ['amber', `${toCheck} TO CHECK`]
                    : ['', 'NOTHING FLAGGED'];
        add(`tt-kicker tt-trip-why ${reason[0]}`, reason[1]);
        // 2 · Title and tags.
        const title = add('t tt-trip-title', t.title);
        if (focus) {
          const g = document.createElement('span');
          g.className = 'tag';
          g.textContent = 'IN FOCUS';
          title.append(g);
        } else if (t.incident) {
          const g = document.createElement('span');
          g.className = 'tag rep-other';
          g.textContent = 'OTHER TRIP';
          title.append(g);
        }
        // 3 · The report, one wording; the storm's own line on the trip
        // in focus, with the band's figure.
        if (t.incident) add('tt-wall-line i tt-trip-rep', t.incident);
        for (const l of t.hzLines || []) add('tt-wall-line tt-trip-hz', l);
        if (t.hzNote) add('tt-wall-note tt-trip-hznote', t.hzNote);
        if (focus && stormNear)
          add(
            'tt-wall-line tt-trip-wx',
            // The claim once; the reason line already says SIMULATED.
            String(ap.claim || ap.text || '')
              .split(' · ')
              .filter((x) => !/^SIMULATED$/.test(x.trim()))[0] || '',
          );
        // 4 · Counts that add up.
        if (!t.noData) {
          const st = add('tt-trip-counts', null);
          const bit = (v, label, attn) => {
            const b = document.createElement('span');
            b.className = attn ? 'attn' : 'dim';
            b.textContent = `${v} ${label}`;
            return b;
          };
          st.append(
            bit(t.notCurrent, 'not current', t.notCurrent > 0 && !t.stale),
            ' · ',
            bit(t.notLocated, 'not located', t.notLocated > 0 && !t.stale),
          );
          // The reason's count can include checks beyond positions (the
          // header's): the difference is named, so the tile adds up.
          const pos = (t.notCurrent || 0) + (t.notLocated || 0);
          // Not during a report: S3's floor groups are mostly people
          // already current, and the reason line points to S3 (S6 r2).
          const extra = t.incident ? 0 : toCheck - pos;
          add(
            'tt-wall-note tt-trip-sum',
            `${t.people} people · ${Math.max(0, t.people - pos)} current${extra > 0 ? ` · +${extra} more check${extra > 1 ? 's' : ''} on ${o.board || 'the remote'}` : ''}${t.stale ? ' · counts may be out of date' : ''}`,
          );
        } else add('tt-trip-counts tt-trip-nodata', '— people · no positions');
        // 5 · Next stop, S5's words; "today" only on the header's day.
        if (!off.has('next') && !t.noData && t.nextParts)
          add(
            'tt-wall-line x tt-trip-next',
            `Next stop · ${t.nextParts.iso === headerIso ? 'today' : t.nextParts.day} · ${t.nextParts.start} · ${t.nextParts.title}`,
          );
        else if (!off.has('next') && !t.noData)
          add('tt-wall-line x tt-trip-next', 'No more stops on the plan');
        // 6 · The clock in the trip's zone, and where.
        if (!t.noData) {
          const ck = add('clock tt-trip-clock', t.localTime || '—');
          const sm = document.createElement('small');
          sm.textContent = `${t.place} · ${t.zone}${t.day && t.day !== headerDay ? ` · ${t.day}` : ''}`;
          ck.append(sm);
        }
        // Org · hotel; a reported tile keeps its hotel (S6 r1 IA P1-4).
        if (!off.has('org') || t.incident)
          add(
            `tt-wall-note o tt-trip-org${t.incident ? ' keep' : ''}`,
            `${t.org} · ${t.city}`,
          );
        grid.append(sec);
      }
      // The board's foot: what S6 does not watch. The data age is the
      // header's alone (S6 r1).
      const foot = document.createElement('div');
      foot.className = 'tt-wall-note tt-trips-foot';
      foot.textContent =
        'Weather is watched for the trip in focus only · fire boundaries (NIFC, US) and hurricanes (NHC) for every trip where covered · sample trips, fictional people';
      node.append(foot);
      // Nothing-flagged trips hidden by the menu: named, never silent;
      // the trip in focus never hides.
      if (off.has('quiet')) {
        const quiet = [...grid.querySelectorAll('.tt-trip:not(.focus)')].filter(
          (n) => n.dataset.tier === String(TIER.calm),
        );
        if (quiet.length) {
          for (const n of quiet) n.remove();
          const q = document.createElement('div');
          q.className = 'tt-wall-note tt-trips-quiet';
          q.textContent = `+${quiet.length} nothing flagged: ${quiet.map((n) => n.dataset.title).join(', ')} · on the remote`;
          node.insertBefore(q, foot);
        }
      }
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
        if (!t.noData) {
          const st = document.createElement('div');
          st.className = 'stats';
          for (const [v, l, attn] of [
            [t.people, 'people', false],
            [t.notCurrent, 'not current', t.notCurrent > 0],
            [t.notLocated, 'not located', t.notLocated > 0],
          ]) {
            const cell = document.createElement('div');
            const b = document.createElement('b');
            b.textContent = String(v);
            if (attn) b.className = 'attn';
            const sp = document.createElement('span');
            sp.textContent = l;
            cell.append(b, sp);
            st.append(cell);
          }
          c.append(st);
        }
        line('x', t.noData ? t.line : `Next: ${t.next}`);
        line('d', t.noData ? '' : t.data);
        grid.append(c);
      }
      node.append(k, grid);
    },
  };
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
  else {
    // The All-in-one gets the stations rail (shell step B).
    stations = createStationRail({
      onPick: (id) => pickStation(id),
      onBack: () => stationBack(),
      onToggle: (on) => setStationsOpen(on),
      // The dock steps aside while the rail is open; its panels live here.
      menu: [
        { label: 'Layers', key: 'L', action: () => openLayers() },
        { label: 'Display', key: 'D', action: () => openPop('tt-display') },
        { label: 'Keys', key: 'K', action: () => openPop('tt-help') },
      ],
    });
    cleanups.push(() => stations?.dispose());
    // Filming (?film): the big-screen take's actions, through the same
    // functions its buttons and keys call (scripts/film-trip-twin.mjs).
    if (FILM)
      window.__ttFilm = {
        /** Select and frame a person, as the A key or a list row does. */
        select: (id) => twin.selectPerson(id, { frame: true }),
        /** The open card's path to an end ('site', 'rally', …), as its buttons. */
        routeTo(prefix) {
          if (!routeTarget || !routeModel) return false;
          const end = routeEnds().find(
            (e) => e && !e.disabled && e.key.startsWith(prefix),
          );
          if (!end) return false;
          routeModel.originKey = end.key;
          routeModel.stale = '';
          runRoute();
          return end.label;
        },
        storm: (on) => setSimStorm(on ? Date.now() : null),
        report: (floor, kind) => twin.reportFloor(floor, kind),
        trip: (id) => switchToTrip(tripById(id)),
      };
    $('tt-other-alert').addEventListener('click', () => {
      flashTrip = otherTripIncidents()[0]?.trip.id || null;
      pickStation('trips');
      renderStations();
    });
    // A card opening or closing in the right column swaps the rail's
    // middle at once, not on the next 5 s refresh.
    let rcolFrame = 0;
    const rcolWatch = new MutationObserver(() => {
      cancelAnimationFrame(rcolFrame);
      rcolFrame = requestAnimationFrame(() => renderStations());
    });
    rcolWatch.observe($('tt-rcol'), {
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    });
    cleanups.push(() => rcolWatch.disconnect());
    renderStations();
  }
  // The All-in-one rejoins the walls with this tab's launch code, so its
  // review ticks keep reaching them after a reload (Jesse, 26 Oct).
  if (!VIEW) resumeReviewLink();
  // Filming opens straight on the All-in-one: no chooser on camera.
  if (!VIEW && !params.has('freeze') && !FILM)
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
  // A page that opens on a station other than Site shows that station's
  // panel, not the hotel the app selects on open (review/shell round 2).
  if (
    stations &&
    station !== 'site' &&
    isHotelSel() &&
    twin.floorFocus === null
  )
    twin.select(null);
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
