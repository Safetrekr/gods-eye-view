// Trip Twin standalone harness. Stands in for World View hooks H-1..H-9
// (PROJECT-PLAN update box): builds its own viewer, feeds mock data, and owns
// the page chrome wiring. Edits none of Justin's files.
import * as Cesium from 'cesium';
import './tripTwin.css';
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
import { SCENARIOS, tripTwinDemoSnapshot } from './demoTripTwin.js';
import {
  createCard,
  createHud,
  renderRouteSection,
  responderText,
} from './twinHud.js';
import { groupCentre, planRouteSet, routeCards } from './twinRoutes.js';
import {
  areaLabel,
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

// ---- popovers: one open at a time; Esc closes them before anything else ----
const POPS = {
  'tt-layers': 'tt-layers-btn',
  'tt-display': 'tt-display-btn',
  'tt-report': 'tt-report-btn',
  'tt-proto': 'tt-proto-btn',
  'tt-help': 'tt-help-btn',
  'tt-sites': 'tt-hotel',
};
function openPop(id) {
  for (const [pop, btn] of Object.entries(POPS)) {
    const on = pop === id && $(pop).hidden;
    $(pop).hidden = !on;
    $(btn)?.setAttribute('aria-expanded', String(on));
  }
  if (id === 'tt-report' && !$(id).hidden)
    setTimeout(() => $('tt-report-floor').focus(), 0);
}
function closePops() {
  let closed = false;
  for (const [pop, btn] of Object.entries(POPS)) {
    if (!$(pop).hidden) closed = true;
    $(pop).hidden = true;
    $(btn)?.setAttribute('aria-expanded', 'false');
  }
  return closed;
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
  }
  cutHead.addEventListener('click', () => {
    cutawayOpen = !cutawayOpen;
    save('cutawayOpen', String(cutawayOpen));
    setCutHead();
  });
  cutBox.append(cutHead, cutaway.el);
  setCutHead();
  // During an incident the floors sit in the incident panel; one copy only.
  const cutPointer = document.createElement('div');
  cutPointer.className = 'tt-card-line tt-dim tt-cut-pointer';
  cutPointer.textContent = 'Floors: in the incident panel above · H';
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

  function renderChips(chips) {
    const max = 4;
    const list = chips.slice(0, max).map((c) => {
      const b = document.createElement(c.onClick ? 'button' : 'span');
      if (c.onClick) {
        b.type = 'button';
        b.addEventListener('click', c.onClick);
      }
      b.className = `tt-chip${c.draft || c.missing ? ' draft' : ''}${c.hazard ? ' hazard' : ''}${c.people ? ' people' : ''}${c.site ? ' site' : ''}`;
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

  const twin = createTripTwin({
    viewer,
    tileset,
    glowStyle: glowParam,
    simulateFires: $('tt-simfire').checked,
    onEntityPick: (id) => {
      const m = /^twin-site:(.+)$/.exec(id);
      if (m) {
        switchSite(m[1]);
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
      if (!sel) {
        if (!placeSelecting) {
          clearRoute();
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
        } else if (!sel.geom.isHotel) clearRoute();
        showBuilding(sel.geom);
      }
    },
    onAssess: (a, info) => {
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
          ? {
              kind: info.operatorReport.kind,
              source: 'operator entry',
              clock,
              ageMin: 0,
            }
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
      // Top bar: mode chip, data age, sample clock, trip in the breadcrumb.
      const chip = $('tt-mode');
      chip.textContent = mode.chip + (mode.degraded ? ' · DATA DELAYED' : '');
      chip.className = `tt-mode ${mode.mode}${mode.degraded ? ' degraded' : ''}`;
      $('tt-age').textContent = `data ${formatAge(ageS)}`;
      $('tt-age').title = `Traveler data ${formatAge(ageS)} old`;
      $('tt-age').classList.toggle('warn', mode.degraded);
      $('tt-clock').textContent = `${clock} local · sample`;
      $('tt-crumb-trip').textContent = snap.trips[0].title;
      const reportBtn = $('tt-report-btn');
      reportBtn.textContent = Number.isFinite(info.reportedLabel)
        ? `Reported floor ${info.reportedLabel}`
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
          ? docked.el
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
    onReady: (site) => {
      queueMicrotask(() => applyGround());
      wxLayer?.dispose();
      wxLayer = createWeatherLayer(viewer, site);
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
    const title = document.createElement('div');
    title.className = 'tt-kicker';
    title.textContent = 'SITES ON THIS TRIP';
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
      duration: matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : 1.4,
    });
  }
  /** Fly out, rebuild for another site, fly in. Trip-wide state is kept. */
  async function switchSite(key) {
    if (key === siteKey || !siteConfig(key)) return;
    if (pathEditor.blockIfDirty('switch site')) return;
    clearFloorFocus();
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

  // ---- route from any place (phase 3 Part C) ----
  // One route set at a time; it belongs to the card it was asked from.
  const routeNode = document.createElement('section');
  routeNode.className = 'tt-route';
  let routeTarget = null; // {key, kind: 'place'|'person', label, point}
  let routeModel = null;
  let routeAbort = null;
  let lastPersonId = null;
  let placeSelecting = false;
  const sitePoint = () => ({
    lat: (city.anchors?.inside || city.center).lat,
    lon: (city.anchors?.inside || city.center).lon,
  });
  function routeEnds() {
    const rows = lastA?.rows || [];
    if (routeTarget.kind === 'person') {
      // From this person to the site or this site's nearest rally point.
      const here = twin.activePlace()?.id;
      const rally = (lastCtx?.snapshot?.safety_points || [])
        .filter(
          (p) =>
            p.location_id === here &&
            /^rally/.test(p.category) &&
            p.coordinates,
        )
        .map((p) => ({
          p,
          d: haversineM(routeTarget.point, {
            lat: p.coordinates.lat,
            lon: p.coordinates.lng,
          }),
        }))
        .sort((a, b) => a.d - b.d)[0]?.p;
      const hospital = (lastCtx?.snapshot?.safety_points || []).find(
        (p) =>
          p.location_id === here && p.category === 'hospital' && p.coordinates,
      );
      const hotel = SITES[0];
      return [
        {
          key: 'site',
          label: `To ${city.short}`,
          to: sitePoint(),
          toLabel: city.short,
        },
        // At a venue, the hotel is a destination too (review/phase3 G12).
        city.key !== hotel.key && {
          key: 'hotel',
          label: `To ${hotel.short}`,
          to: { lat: hotel.anchors.inside.lat, lon: hotel.anchors.inside.lon },
          toLabel: hotel.short,
        },
        hospital && {
          key: 'hospital',
          label: 'To nearest hospital',
          to: { lat: hospital.coordinates.lat, lon: hospital.coordinates.lng },
          toLabel: hospital.name || 'the hospital',
        },
        rally && {
          key: 'rally',
          label: `To nearest rally point${rally.approval_status !== 'active' ? ' (draft)' : ''}`,
          to: { lat: rally.coordinates.lat, lon: rally.coordinates.lng },
          toLabel: 'the rally point',
        },
      ].filter(Boolean);
    }
    const person = rows.find((r) => r.person.id === lastPersonId);
    const centre = groupCentre(rows, sitePoint());
    const age = (r) =>
      Number.isFinite(r?.pos?.age)
        ? ` (position ${formatAge(r.pos.age)} old)`
        : '';
    return [
      {
        key: 'site',
        label: `From ${city.short}`,
        from: sitePoint(),
        fromLabel: city.short,
      },
      {
        key: 'person',
        label: person ? `From ${person.person.name}` : 'From selected person',
        fromLabel: person ? `${person.person.name}${age(person)}` : '',
        disabled: !person?.person.coordinates,
        title: person ? '' : 'Select a person first',
        from: person?.person.coordinates
          ? {
              lat: person.person.coordinates.lat,
              lon: person.person.coordinates.lng,
            }
          : null,
      },
      {
        key: 'group',
        label: centre ? `From group centre (${centre.n})` : 'From group centre',
        disabled: !centre,
        title: centre
          ? 'Median of current positions at this site'
          : 'Fewer than 3 current positions here',
        from: centre,
        fromLabel: centre ? `the group centre (${centre.n} people)` : '',
      },
    ];
  }
  function drawRouteSection() {
    if (!routeTarget) return;
    const ends = routeEnds();
    if (!ends.some((e) => e.key === routeModel.originKey && !e.disabled))
      routeModel.originKey = ends.find((e) => !e.disabled)?.key;
    renderRouteSection(
      routeNode,
      {
        ...routeModel,
        title:
          routeTarget.kind === 'person' ? 'PATH FROM THIS PERSON' : 'PATH HERE',
        origins: ends,
      },
      {
        onOrigin: (k) => {
          routeModel.originKey = k;
          if (routeModel.status !== 'idle') runRoute(routeModel.profile);
          else drawRouteSection();
        },
        onMode: (profile) => runRoute(profile),
        onClear: () => clearRoute({ keepTarget: true }),
        onFrame: () => twin.frameRoute(),
        onEdit: () => {
          const ep = routeEndpoints();
          if (!ep) return;
          clearRoute({ keepTarget: true });
          const fromPerson = routeTarget.kind === 'person';
          pathEditor.start({
            ...ep,
            // A traveler's position is never stored by name (H4).
            fromLabel: fromPerson ? 'a traveler’s position' : ep.fromLabel,
            fromPerson,
            profile: routeModel.profile || 'foot',
            day: appMode === 'advance' ? currentAdvanceDay() : todayDay(),
          });
        },
      },
    );
  }
  function setRouteTarget(t) {
    if (routeTarget?.key === t.key) return drawRouteSection();
    clearRoute();
    routeTarget = t;
    routeModel = {
      originKey: null,
      profile: 'foot',
      status: 'idle',
      cards: [],
    };
    drawRouteSection();
  }
  /** Clear the drawn route; keepTarget leaves the card's section in place. */
  function clearRoute({ keepTarget = false } = {}) {
    routeAbort?.abort();
    routeAbort = null;
    const had = twin.hasRoute;
    twin.clearRoute();
    if (keepTarget && routeTarget) {
      routeModel = { ...routeModel, status: 'idle', cards: [] };
      drawRouteSection();
    } else {
      routeTarget = null;
      routeModel = null;
    }
    return had;
  }
  /** The chosen origin and destination of the card's path section. */
  function routeEndpoints() {
    const end = routeEnds().find((e) => e.key === routeModel.originKey);
    if (!end) return null;
    const from = routeTarget.kind === 'person' ? routeTarget.point : end.from;
    const to = routeTarget.kind === 'person' ? end.to : routeTarget.point;
    const toLabel =
      routeTarget.kind === 'person' ? end.toLabel : routeTarget.label;
    const personRow = (lastA?.rows || []).find(
      (r) => `person:${r.person.id}` === routeTarget.key,
    );
    const fromLabel =
      routeTarget.kind === 'person'
        ? `${routeTarget.label}${Number.isFinite(personRow?.pos?.age) ? ` (position ${formatAge(personRow.pos.age)} old)` : ''}`
        : end.fromLabel;
    return { from, to, fromLabel, toLabel };
  }
  async function runRoute(profile) {
    const ep = routeEndpoints();
    if (!ep) return;
    const { from, to, fromLabel, toLabel } = ep;
    routeAbort?.abort();
    routeAbort = new AbortController();
    const signal = routeAbort.signal;
    routeModel = { ...routeModel, profile, status: 'loading' };
    drawRouteSection();
    try {
      const paths = await planRouteSet(from, to, {
        profile,
        signal,
        hazards: twin.hazardPoints(),
      });
      if (signal.aborted) return;
      twin.showRoute(paths, { fromLabel, toLabel });
      routeModel = {
        ...routeModel,
        status: 'ready',
        cards: routeCards(
          paths,
          { profile, toLabel, fromLabel },
          {
            areas: pathStore.areas,
            pace: profile === 'foot' ? lastCtx?.weather?.pace : null,
            simulatedFires: lastCtx?.fires?.simulated,
          },
        ),
      };
    } catch (error) {
      if (signal.aborted) return;
      routeModel = {
        ...routeModel,
        status: 'error',
        error: String(error?.message || error),
        straight: formatDistance(haversineM(from, to)),
      };
    }
    drawRouteSection();
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
    });
    card.place(
      {
        kind: `${label.toUpperCase()}${p.approval_status !== 'active' ? ' · DRAFT · NOT APPROVED' : ''}`,
        name: p.name || label,
        lines: [
          [
            '',
            `${formatDistance(haversineM(sitePoint(), ll))} ${bearingLabel(sitePoint(), ll)} of ${city.short}`,
          ],
          ...(p.address ? [['', p.address]] : []),
          ...(p.contact ? [['', p.contact]] : []),
          ...(p.chaperone_only ? [['tt-dim', 'Chaperones only']] : []),
          [
            'tt-dim',
            p.source === 'poi'
              ? 'OpenStreetMap place · not verified by SafeTrekr'
              : 'Trip safety point (sample)',
          ],
        ],
      },
      [routeNode],
    );
    $('tt-crumb-focus').textContent = `› ${p.name || label}`;
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
      route: drawn ? adv.pathText[ev.key] : null,
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
    adv.pathText[ev.key] = 'Asking OpenStreetMap routing…';
    renderAdvance();
    try {
      const paths = await planRouteSet(
        { lat: h.lat, lon: h.lon },
        { lat: t.lat, lon: t.lon },
        { profile: 'foot', signal: abort.signal, hazards: twin.hazardPoints() },
      );
      twin.showRoute(paths, {
        fromLabel: SITES[0].short,
        toLabel: site.short,
      });
      const p = paths[0];
      adv.pathText[ev.key] =
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
      const go = el('button', 'tt-btn primary', `Go to ${site.short}`);
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
        drawn ? 'Clear walking path' : `Walking path from ${SITES[0].short}`,
      );
      r.type = 'button';
      r.dataset.focusKey = 'path';
      r.addEventListener('click', () => {
        if (drawn) {
          clearAdvancePath();
          renderAdvance(true);
        } else pathFromHotel(ev, site);
      });
      acts.append(r);
      // Phase 4: turn the suggested path into the operator's own.
      const h = SITES[0].anchors.inside;
      const t = site.anchors.inside;
      const e2 = el('button', 'tt-btn', 'Plan your own path');
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
      acts.append(e2);
    }
    box.append(acts);
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
            simulated: wx.sim.rain || wx.sim.lightning,
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
  }
  /** The scrubbed event's forecast, for the weather chip in Advance. */
  function advanceChipParts() {
    const ev = advEvents().find((e) => e.key === adv.eventKey);
    if (!ev) return null;
    const met = adv.met[ev.siteKey];
    if (!met || met === 'error') return null;
    const end = ev.end ? zonedToEpoch(ev.date, ev.end, city.timezone) : null;
    const fc = forecastWindow(met, ev.epoch, end);
    if (!fc) return null;
    return {
      live: 'FCST',
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
  function setAppMode(next) {
    if (next === appMode) return;
    if (pathEditor.blockIfDirty('switch to ' + next)) return;
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
    if (isHotelSel()) showBuilding(selection.geom);
    renderSites();
    renderBeacons();
    renderWeather();
  }
  for (const b of document.querySelectorAll('#tt-appmode button'))
    b.addEventListener('click', () => setAppMode(b.dataset.mode));
  $('tt-live-alert').addEventListener('click', () => setAppMode('live'));

  // ---- custom paths (phase 4): saved paths, avoid-areas, editor ----
  const pathStore = loadStore(pref(`paths.${cityKey}`, '{}'));
  const persistPaths = () =>
    save(`paths.${cityKey}`, JSON.stringify(pathStore));
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
    customLayer.drawSaved(
      customVis.saved
        ? pathStore.paths.filter(
            (p) => day == null || p.day == null || p.day === day,
          )
        : [],
      { selectedId: selectedSavedId, areas: pathStore.areas },
    );
  }
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
      },
    );
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
  const pathEditor = createPathEditor({
    twin,
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
    siteKeysFor,
    stamp,
    isDark,
    hazardsStatus: () => (firesUnavailable() ? 'unavailable' : 'ok'),
    onCrumb: (t) => ($('tt-crumb-focus').textContent = t),
    onClose: (saved) => {
      $('tt-crumb-focus').textContent = '';
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
    confirmTimer = setTimeout(() => {
      confirmKey = null;
      b.textContent = label;
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
  /** Card for a saved path: edit, duplicate, review, delete. */
  function selectSaved(id) {
    const p = pathStore.paths.find((x) => x.id === id);
    if (!p) return;
    placeSelecting = true;
    twin.select(null);
    placeSelecting = false;
    clearRoute();
    selection = { kind: 'saved', id };
    selectedSavedId = id;
    renderCustom();
    const flags = checksFor(p);
    const st = avoidStatus(p, pathStore.areas);
    const review = reviewState(p, pathStore.areas, flags);
    const open = flags.filter((f) => f.warn);
    const acts = document.createElement('div');
    acts.className = 'tt-actions tt-saved-acts';
    acts.append(
      actBtn('Edit saved path', () => pathEditor.start({ saved: p })),
      actBtn('Duplicate', () =>
        pathEditor.start({
          saved: { ...p, id: null, name: `${p.name} (copy)` },
        }),
      ),
      actBtn('Frame path', () => twin.frameGeometry(p.geometry)),
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
    const danger = document.createElement('div');
    danger.className = 'tt-actions tt-danger-row';
    danger.append(
      actBtn(
        'Delete saved path',
        (b) =>
          confirmOnce(
            `del:${id}`,
            () => {
              pathStore.paths = pathStore.paths.filter((x) => x.id !== id);
              persistPaths();
              selectedSavedId = null;
              selection = null;
              card.hide();
              renderCustom();
              renderLayers();
              adv.sig = '';
              renderAdvance();
            },
            b,
            'Delete saved path',
          ),
        'tt-btn danger',
      ),
    );
    card.place(
      {
        kind: `SAVED PATH · ${review.ok ? 'REVIEWED' : review.text.toUpperCase()}`,
        name: p.name,
        lines: [
          [
            '',
            `${p.day ? `Day ${p.day}` : 'Any day'} · ${p.profile === 'car' ? 'drive' : 'walk'} · ${formatDistance(p.distanceM)} · ${p.profile === 'car' ? 'drive time from the router' : 'group pace'}`,
          ],
          ...(st.text ? [[st.warn ? 'tt-edit-flag' : '', st.text]] : []),
          ...flags
            .filter((f) => !/^avoid/.test(f.key))
            .map((f) => [f.warn ? 'tt-edit-flag' : 'tt-dim', f.text]),
          ...(p.notes ? [['', `Notes: ${p.notes}`]] : []),
          [
            'tt-dim',
            `Saved by ${p.savedBy}${p.reviewedBy ? ` · ${review.text}` : ''}`,
          ],
          [
            'tt-dim',
            p.engine === 'valhalla'
              ? 'Suggested by Valhalla (FOSSGIS) · unverified · a review is a check, not an approval'
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
    clearRoute();
    selection = { kind: 'area', id };
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
              pathStore.areas = pathStore.areas.filter((x) => x.id !== id);
              persistPaths();
              selection = null;
              card.hide();
              renderCustom();
              adv.sig = '';
              renderAdvance();
            },
            b,
            'Remove avoid-area',
          ),
        'tt-btn danger',
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

  // ---- Layers: the five groups (06 §2.2); each row that is on shows its key ----
  const KEY = {
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
    fires: [['', '#ee7789', 'Heat detection (375 m pixel)']],
    safety: [
      ['', '#4ba467', 'Approved place'],
      ['dash', '#9aa8ac', 'Draft · not approved'],
    ],
    paths: [
      ['', '#3b82f6', 'Suggested path'],
      ['dash', '#3b82f6', 'Alternate'],
      ['dash', '#f59e0b', 'Within 1 km of a heat detection'],
    ],
    buildings: [['', '#80959b', 'Mapped height · fainter = approximate']],
    grid: [['', '#80959b', 'Spacing and units in Display (D)']],
    savedPaths: [
      [
        'dash',
        '#93bafa',
        'Saved by an operator · long dash · Advance shows the selected day',
      ],
    ],
    avoidAreas: [
      ['', '#f59e0b', 'Avoid-area · applies to every path on this trip'],
    ],
    elevation: [
      ['', '#80959b', 'Contour · relative to hotel street level'],
      ['', '#80959b', 'Interval in Display (D)'],
    ],
  };
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
        ['paths', 'Suggested walking paths', false],
        ['savedPaths', 'Saved paths (operator)', false],
        ['avoidAreas', 'Avoid-areas', false],
      ],
    ],
    [
      'Site',
      [
        ['hotel', 'Hotel', true],
        ['buildings', 'Surrounding buildings', false],
        ['grid', 'Scale grid', false],
        ['elevation', 'Elevation (terrain contours)', false],
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
    };
    const root = $('tt-layers');
    root.replaceChildren();
    const title = document.createElement('div');
    title.className = 'tt-kicker';
    title.textContent = 'LAYERS';
    root.append(title);
    for (const [group, rows] of GROUPS) {
      const g = document.createElement('div');
      g.className = 'tt-layer-group';
      const gh = document.createElement('div');
      gh.className = 'tt-kicker';
      gh.textContent = group;
      g.append(gh);
      for (const [key, label, locked] of rows) {
        const on = locked ? true : state[key];
        const row = document.createElement('label');
        row.className = 'tt-layer-row';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = on;
        box.disabled = locked;
        box.addEventListener('change', () => {
          if (key === 'grid' || key === 'elevation') {
            ground[key === 'grid' ? 'grid' : 'contours'] = box.checked;
            applyGround();
          } else if (key === 'savedPaths' || key === 'avoidAreas') {
            customVis[key === 'savedPaths' ? 'saved' : 'avoid'] = box.checked;
            renderCustom();
          } else twin.setLayer(key, box.checked);
          renderLayers();
        });
        row.append(box, document.createTextNode(label));
        if (locked) {
          const l = document.createElement('span');
          l.className = 'lock';
          l.textContent = 'always on';
          row.append(l);
        }
        g.append(row);
        if (on && KEY[key]) {
          const k = document.createElement('div');
          k.className = 'tt-key';
          for (const [style, color, text] of KEY[key]) {
            const item = document.createElement('span');
            const sw = document.createElement('span');
            sw.className = `tt-swatch ${style}`;
            sw.style.color = color;
            item.append(sw, document.createTextNode(text));
            k.append(item);
          }
          g.append(k);
        }
      }
      if (group === 'Hazards') g.append(weatherGroup());
      if (group === 'Paths') g.append(savedIndex());
      root.append(g);
    }
  }

  /** Layers › Paths index: every saved path by day, every avoid-area (H16). */
  function savedIndex() {
    const d = document.createElement('details');
    d.className = 'tt-layer-sub';
    d.open = Boolean(savedIndex.open);
    d.addEventListener('toggle', () => (savedIndex.open = d.open));
    const sm = document.createElement('summary');
    sm.textContent = `Saved paths ${pathStore.paths.length} · avoid-areas ${pathStore.areas.length}`;
    d.append(sm);
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
        b.addEventListener('click', () => {
          closePops();
          selectSaved(p.id);
        });
        d.append(b);
      }
    }
    if (pathStore.areas.length) {
      const h = document.createElement('div');
      h.className = 'tt-key';
      h.textContent = 'Avoid-areas (whole trip)';
      d.append(h);
      for (const a of pathStore.areas) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tt-link tt-index-row';
        b.textContent = areaLabel(a);
        b.addEventListener('click', () => {
          closePops();
          selectArea(a.id);
        });
        d.append(b);
      }
    }
    if (!pathStore.paths.length && !pathStore.areas.length) {
      const n = document.createElement('div');
      n.className = 'tt-key';
      n.textContent =
        'None yet · plan your own path from a place card or the Advance brief';
      d.append(n);
    }
    return d;
  }

  // ---- Weather (phase 2): free / open sources, off by default ----
  const region = city.timezone.startsWith('America') ? 'us' : 'eu';
  const useF = region === 'us';
  const WX = weatherSources(region);
  let wxBox = boxAround(city.center);
  // Lightning is fetched over the 10 km watch distance plus one grid cell, so
  // the rule can see everything it is checking (review/phase2 F12).
  const ltgBoxFor = (c) =>
    boxAround(c, 2 * (LIGHTNING_WATCH_KM + (WX.lightning?.gridKm || 0)));
  let ltgBox = ltgBoxFor(city.center);
  const boxFor = (key) => (key === 'lightning' ? ltgBox : wxBox);
  const wx = {
    layers: { lightning: false, precip: false, totals: false, clouds: false },
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
    },
  };
  let wxLayer = null;
  const hhmm = (iso) =>
    iso
      ? new Date(iso).toLocaleTimeString('en-GB', {
          timeZone: city.timezone,
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
  const wxSummary = () =>
    wx.sim.rain ? simulatedRain(wx.summary) : wx.summary;
  async function loadWeatherNow() {
    try {
      const res = await fetch(
        `/api/twin-weather/now?lat=${city.center.lat}&lon=${city.center.lon ?? city.center.lng}`,
        { signal: abort.signal },
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      wx.summary = summarizeMet(json.json);
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
    if (key === 'lightning' && wx.sim.lightning)
      return 'SIMULATED lightning (prototype)';
    const src = WX[key];
    if (!src) return '';
    return `${src.label}${wx.imageAt[key] ? ` · fetched ${hhmm(wx.imageAt[key])}` : ''}`;
  };
  function drawWeather() {
    if (!wxLayer) return;
    const images = {
      precip: wx.sim.rain
        ? simulatedRainCanvas()
        : wx.images.precip?.canvas || null,
      totals: wx.images.totals?.canvas || null,
      lightning: wx.sim.lightning ? null : wx.images.lightning?.canvas || null,
    };
    for (const k of ['precip', 'totals', 'lightning'])
      if (wx.images[k]?.noData && !(k === 'precip' && wx.sim.rain))
        images[k] = null;
    wxLayer.set(wx.layers, {
      bbox: wxBox,
      ltgBbox: ltgBox,
      images,
      strikes: wx.sim.lightning ? strikes() : [],
      summary: wxSummary(),
      simulated: wx.sim,
      watchCenter: lastWatchCenter || city.center,
      labels: {
        precip: wxLabel('precip'),
        totals: wxLabel('totals'),
        lightning: wxLabel('lightning'),
      },
    });
    // Credits for every weather layer that is on (UI P0-1).
    const credits = ['Weather: MET Norway (CC BY 4.0)'];
    for (const k of ['precip', 'totals', 'lightning'])
      if (wx.layers[k] && WX[k] && !(k === 'precip' && wx.sim.rain))
        credits.push(WX[k].credit);
    $('tt-wx-credit').textContent = credits.join(' · ');
  }
  function renderWeather() {
    const sum = wxSummary();
    const chip = $('tt-wx');
    // Advance: the scrubbed event's forecast, not "now" (review/phase3 G13).
    const parts =
      typeof appMode !== 'undefined' && appMode === 'advance'
        ? advanceChipParts() || {
            live: 'FCST',
            temp: '—',
            condition: 'forecast loading',
            source: 'MET Norway',
          }
        : wx.status === 'loading' && !wx.sim.rain
          ? null
          : weatherChipParts(sum, {
              useF,
              clock: hhmm(sum?.validTime),
              simulated: wx.sim.rain,
            });
    if (!parts)
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
      chip.replaceChildren(
        span(`wx-live${wx.sim.rain ? ' sim' : ''}`, parts.live),
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
  function wxRowNote(key) {
    if (key === 'clouds')
      return wxSummary()
        ? `MET Norway · ${hhmm(wxSummary().validTime)} · low ${Math.round(wxSummary().cloud.low ?? 0)}% · mid ${Math.round(wxSummary().cloud.mid ?? 0)}% · high ${Math.round(wxSummary().cloud.high ?? 0)}%`
        : 'Weather unavailable';
    if (!WX[key]) return 'Not available here (radar licence not verified)';
    if (key === 'lightning' && wx.sim.lightning)
      return 'SIMULATED lightning (prototype) · 10 km watch ring';
    if (wx.images[key]?.noData)
      return `${WX[key].label} · no data in this area right now`;
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
    sm.textContent = `Weather${on ? ` · ${on} on` : ''}`;
    d.append(sm);
    for (const [key, label] of [
      ['lightning', 'Lightning'],
      ['precip', 'Precipitation now'],
      ['totals', 'Rain & snow totals (24 h)'],
      ['clouds', 'Cloud cover (forecast)'],
    ]) {
      const row = document.createElement('label');
      row.className = 'tt-layer-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = wx.layers[key];
      box.disabled = key === 'totals' && !WX.totals;
      box.addEventListener('change', () => {
        wx.layers[key] = box.checked;
        if (box.checked && key !== 'clouds') ensureImage(key);
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
          { useF, simulated: wx.sim.rain },
        )
      : null;
    return {
      lightning,
      lightningDown,
      exposure,
      pace: rainPace(wxSummary(), { simulated: wx.sim.rain }),
      official:
        wx.warningsStatus === 'unavailable'
          ? ['Official weather alerts unavailable right now']
          : wx.warnings.map((w) => warningLine(w, city.timezone)),
    };
  }
  $('tt-simlightning').checked = wx.sim.lightning;
  $('tt-simrain').checked = wx.sim.rain;
  $('tt-simlightning').addEventListener('change', (e) => {
    wx.sim.lightning = e.target.checked;
    renderWeather();
    twin.refresh?.();
  });
  $('tt-simrain').addEventListener('change', (e) => {
    wx.sim.rain = e.target.checked;
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
    unit: params.get('units') || pref('units', 'm'),
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
    $('tt-spacing').replaceChildren(
      ...u.grid.map((v) => new Option(`${v} ${u.label}`, v)),
    );
    $('tt-contour').replaceChildren(
      ...u.contour.map((v) => new Option(`${v} ${u.label}`, v)),
    );
    $('tt-spacing').value = ground.spacing;
    $('tt-contour').value = ground.contour;
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
    if (st?.relief)
      $('tt-relief').textContent =
        `Ground in this view: ${formatLength(st.relief.low, ground.unit, { signed: true })} to ${formatLength(st.relief.high, ground.unit, { signed: true })} vs hotel street level`;
    save('groundGrid', ground.grid);
    save('groundElevation', ground.contours);
    save('units', ground.unit);
    save(`spacing.${ground.unit}`, ground.spacing);
    save(`contour.${ground.unit}`, ground.contour);
  }
  fillOptions();
  $('tt-ground-line').textContent = groundLine(ground);
  $('tt-units').addEventListener('change', (e) => {
    ground.unit = e.target.value;
    ground.spacing = Number(
      pref(`spacing.${ground.unit}`, UNIT[ground.unit].gridDefault),
    );
    ground.contour = Number(
      pref(`contour.${ground.unit}`, UNIT[ground.unit].contourDefault),
    );
    fillOptions();
    applyGround();
  });
  $('tt-spacing').addEventListener('change', (e) => {
    ground.spacing = Number(e.target.value);
    applyGround();
  });
  $('tt-contour').addEventListener('change', (e) => {
    ground.contour = Number(e.target.value);
    applyGround();
  });
  $('tt-reduce-motion').checked = pref('reduceMotion', '0') === '1';
  $('tt-reduce-motion').addEventListener('change', (e) =>
    save('reduceMotion', e.target.checked ? '1' : '0'),
  );

  // ---- toolbar, popovers, report form ----
  for (const [pop, btn] of Object.entries(POPS))
    $(btn)?.addEventListener('click', () => {
      openPop(pop);
      if (pop === 'tt-layers') renderLayers();
      if (pop === 'tt-sites') renderSites();
    });
  $('tt-help-link').addEventListener('click', () => openPop('tt-help'));
  $('tt-help-close').addEventListener('click', closePops);
  $('tt-report-cancel').addEventListener('click', closePops);
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
  $('tt-simfire').addEventListener('change', (e) =>
    twin.setSimulatedFires(e.target.checked),
  );
  $('tt-osmids').addEventListener('change', (e) => {
    save('osmIds', e.target.checked ? '1' : '0');
    if (selection?.kind === 'building') twin.select(selection.geom.building.id);
  });

  // ---- keyboard (no key sends a message or dismisses a report) ----
  let attentionIndex = -1;
  const flatNeeds = () => (lastCtx?.mode.groups || []).flatMap((g) => g.rows);
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // The path editor owns the keyboard while it is open (phase 4).
    if (pathEditor.handleKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.target.closest?.('input, select, textarea')) return;
    const k = e.key;
    if (k === 'Escape') {
      // popover → person opened from a floor card → floor card → selection
      if (closePops()) return;
      if (adv.pathFor) {
        clearAdvancePath();
        return renderAdvance(true);
      }
      if (twin.hasRoute) return clearRoute({ keepTarget: true });
      if (selection?.kind === 'place') {
        clearRoute();
        selection = null;
        card.hide();
        $('tt-crumb-focus').textContent = '';
        return;
      }
      if (selection?.kind === 'person' && floorReturn !== null)
        return focusFloor(floorReturn);
      if (!clearFloorFocus()) twin.select(null);
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
    if (k === 'v' || k === 'V')
      return setAppMode(appMode === 'advance' ? 'live' : 'advance');
    // People and report keys act on live data only.
    if (appMode === 'advance' && /^[rRaA[\]]$/.test(k)) return;
    if (k === 'r' || k === 'R') return openPop('tt-report');
    if (k === '?') return openPop('tt-help');
    if (k === '`') return openPop('tt-proto');
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
  const feed = () => {
    lastFeed = Date.now();
    twin.setSnapshot(
      applyOperatorNumbering(
        tripTwinDemoSnapshot(cityKey, scenario, { pois, poisBySite }),
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
  $('tt-exit').addEventListener('click', async () => {
    if (twin.state === 'ready' || twin.state === 'degraded') {
      wxLayer?.dispose();
      wxLayer = null;
      if (pathEditor.blockIfDirty('exit')) return;
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
  });
  void lastA;
  await twin.open(siteKey, { osmMode });
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
