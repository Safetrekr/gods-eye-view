// Development-only fictional fixtures. Never fetched from production.
// Trip Twin sample trip (PROJECT-PLAN §7.3): one 27-person cast (24 travelers,
// 3 chaperones) placed around a real hotel. Same envelope and field names as
// demoSnapshot() and Core's v1 snapshot; new fields use the production names
// proposed in 07-production-delta.md. Floor estimates come from floorEstimate
// over seeded mock barometer traces — never typed in.
import { TWIN_CITIES } from './twinCities.js';
import { sitesForCity } from './twinSites.js';
import { estimateFloor, pressureAt } from './floorEstimate.js';
import { makeTrace, mulberry32, weather } from './floorTraces.js';

export const TRIP_ID = 'twin-sample-trip';
const TRIP = TRIP_ID;
const FRESH = 120;
const STALE = 600;
const LOBBY = 4.5;

// Fictional people. Initials appear on the scene; names only in cards.
const CAST = [
  ['MR', 'Maya Ruiz', 'traveler'],
  ['AK', 'Aron Kim', 'traveler'],
  ['SD', 'Sam Diaz', 'traveler'],
  ['LB', 'Leo Brandt', 'traveler'],
  ['IS', 'Ivy Stone', 'traveler'],
  ['T15', 'Nia Park', 'traveler'],
  ['T16', 'Omar Hale', 'traveler'],
  ['T17', 'Priya Nair', 'traveler'],
  ['RO', 'Rory Owen', 'traveler'],
  ['EW', 'Eli West', 'traveler'],
  ['TC', 'Tess Cole', 'chaperone'],
  ['KV', 'Kai Vance', 'chaperone'],
  ['HL', 'Hana Lee', 'chaperone'],
  ['T01', 'Ada Brooks', 'traveler'],
  ['T02', 'Ben Ito', 'traveler'],
  ['T03', 'Cara Moss', 'traveler'],
  ['T04', 'Dev Shah', 'traveler'],
  ['T05', 'Emi Sato', 'traveler'],
  ['T06', 'Finn Gray', 'traveler'],
  ['T07', 'Gia Romano', 'traveler'],
  ['T08', 'Hugo Lind', 'traveler'],
  ['T09', 'Iris Bell', 'traveler'],
  ['T10', 'Jon Reyes', 'traveler'],
  ['T11', 'Kira Wolfe', 'traveler'],
  ['NF', 'Noah Fox', 'traveler'],
  ['JO', 'June Ortiz', 'traveler'],
  ['JP', 'Jay Patel', 'traveler'],
];

// Rooming list, floor only (never a room number). Prototype stand-in for the
// production `room_assignments` field (07-production-delta, phase 2).
// Demo A is chosen so the cutaway shows every state: M.R. is assigned 11 but
// reads ~9, L.B. is assigned 11 with no pressure sensor, N.P. is assigned 9
// but reads lower, chaperones sit on 8 and 11.
const ROOMING = Object.freeze({
  11: ['MR', 'LB', 'HL', 'T01', 'T02', 'T03', 'T04', 'T05'],
  9: ['AK', 'T15', 'T16', 'T17', 'T06', 'T07', 'T08', 'T09'],
  8: ['TC', 'KV', 'SD', 'IS', 'RO', 'EW', 'T10', 'T11', 'NF', 'JO', 'JP'],
});

export function roomAssignments() {
  return Object.entries(ROOMING).flatMap(([floor, ids]) =>
    ids.map((id) => ({
      participant_id: `twin-${id}`,
      floor_label: Number(floor),
    })),
  );
}

export const SCENARIOS = Object.freeze({
  baseline: { label: 'Evening at the hotel', clock: '21:32:00' },
  a: { label: 'Hotel fire alarm (Demo A)', clock: '02:14:00' },
  b: { label: 'Evening concert (Demo B)', clock: '19:40:00', day: 2 },
});

/**
 * Trip day N as a date. The sample trip starts today (Day 1) so the advance
 * view's forecast applies; the dates are shifted, the people fictional.
 */
const tripDate = (day, now = Date.now()) =>
  new Date(now + (day - 1) * 86400000).toISOString().slice(0, 10);

// Scenario clock starts when the module loads, like demo.js's demoFlightStart.
const scenarioStart = Date.now();

const RAD = Math.PI / 180;
function offset(p, bearingDeg, meters) {
  const mLat = 110540;
  const mLon = 111320 * Math.cos(p.lat * RAD);
  return {
    lat: p.lat + (meters * Math.cos(bearingDeg * RAD)) / mLat,
    lng: (p.lng ?? p.lon) + (meters * Math.sin(bearingDeg * RAD)) / mLon,
  };
}
const asLL = (p) => ({ lat: p.lat, lng: p.lng ?? p.lon });
function bearing(a, b) {
  const y =
    Math.sin(((b.lon ?? b.lng) - (a.lon ?? a.lng)) * RAD) *
    Math.cos(b.lat * RAD);
  const x =
    Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) -
    Math.sin(a.lat * RAD) *
      Math.cos(b.lat * RAD) *
      Math.cos(((b.lon ?? b.lng) - (a.lon ?? a.lng)) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
function meters(a, b) {
  const mLat = 110540;
  const mLon = 111320 * Math.cos(a.lat * RAD);
  return Math.hypot(
    (b.lat - a.lat) * mLat,
    ((b.lng ?? b.lon) - (a.lng ?? a.lon)) * mLon,
  );
}

/** Height (m above street) of a phone on a given level above the lobby. */
const zOnLevel = (level, floorH) =>
  level <= 0 ? 1.2 : LOBBY + (level - 1) * floorH + 1.5;

/**
 * Floor estimate for a person from a mock trace. spec = {level | path, seed,
 * hvacHpa, anchorAgo, barometer, consent, jump, lastSampleAgo}. t = scenario
 * seconds; times converted to ISO at the end.
 */
function floorFor(spec, t, ctx) {
  const { building, wx, ref, toIso, placeId } = ctx;
  const anchorT = t - (spec.anchorAgo ?? 1800);
  const lastT = t - (spec.lastSampleAgo ?? 40);
  const path = spec.path
    ? spec.path(t)
    : [
        { t: anchorT - 60, z: 0, inside: false },
        { t: anchorT + 60, z: 0, inside: true },
        {
          t: anchorT + 150,
          z: zOnLevel(spec.level, building.floor_height_m || 3.3),
          inside: true,
        },
        {
          t: t + 600,
          z: zOnLevel(spec.level, building.floor_height_m || 3.3),
          inside: true,
        },
      ];
  const samples = makeTrace({
    seed: spec.seed,
    path,
    tStart: lastT - 90,
    tEnd: lastT,
    wx,
    hvacHpa: spec.hvacHpa ?? 0.25,
  });
  if (spec.jump) samples.at(-1).pressure_hpa -= 0.8;
  const anchorNoise = (mulberry32(spec.seed + 1000)() - 0.5) * 0.06;
  const anchor =
    spec.anchor === false
      ? null
      : {
          t: anchorT,
          pressure_hpa: pressureAt(0, wx(anchorT)) + anchorNoise,
          ground_m: 0,
        };
  const est = estimateFloor({
    now: t,
    samples,
    anchor,
    entrance_ground_m: 0,
    reference: ref,
    barometer: spec.barometer ?? 'available',
    consent: spec.consent,
    building,
    place_id: placeId,
  });
  const out = { ...est };
  for (const k of ['sample_at', 'anchor_at'])
    if (Number.isFinite(out[k])) out[k] = toIso(out[k]);
  if (spec.trueLevel !== undefined) out._fixture_true_level = spec.trueLevel; // QA only
  return out;
}

function freshnessFields(age, extra = {}) {
  if (age === null)
    return {
      capturedAt: null,
      locationAgeSeconds: null,
      freshness: 'unknown',
      isFresh: false,
    };
  return {
    locationAgeSeconds: age,
    freshness: age <= FRESH ? 'fresh' : age <= STALE ? 'aging' : 'stale',
    isFresh: age <= FRESH,
    ...extra,
  };
}

/**
 * pois: the recorded <city>.pois.json `pois` array (real public places).
 * Returns a v1-shaped snapshot plus Trip Twin fields.
 */
export function tripTwinDemoSnapshot(
  cityKey = 'austin',
  scenario = 'baseline',
  {
    now = Date.now(),
    pois = [],
    poisBySite = {},
    elapsed = null,
    // SOC multi-view (phase 10): every screen counts scenario time from the
    // session's epoch, so all screens show the same moment.
    startMs = null,
  } = {},
) {
  const city = TWIN_CITIES[cityKey] || TWIN_CITIES.austin;
  const sc = SCENARIOS[scenario] ? scenario : 'baseline';
  // Scenario seconds since load; tests pin it with `elapsed` for determinism.
  const t = Number.isFinite(elapsed)
    ? elapsed
    : Math.max(
        0,
        (now - (Number.isFinite(startMs) ? startMs : scenarioStart)) / 1000,
      );
  const iso = (secondsAgo) => new Date(now - secondsAgo * 1000).toISOString();
  const toIso = (scenarioSeconds) =>
    new Date(now - (t - scenarioSeconds) * 1000).toISOString();
  const placeId = `fixture-hotel-${city.key}`;
  const A = city.anchors;
  const inside = asLL(A.inside);
  const edge = asLL(A.edge);
  const assembly = asLL(A.assembly);
  const outward = bearing(A.inside, A.assembly);
  const insideAcc = Math.min(12, Math.floor(A.insideClearanceM / 2.6));
  const levels = city.levels ?? null;
  const building = {
    levels_above_ground: levels,
    floor_height_m: city.floorHeightM ?? null,
    ground_floor_label: city.groundFloorLabel,
    levels_source: levels ? 'osm_levels' : null,
  };
  const wx = weather({ base: 1009.4, trendHpaPerHour: -0.8 });
  const ref = Array.from({ length: 60 }, (_, i) => ({
    t: t - 6 * 3600 + i * 600,
    pressure_hpa: wx(t - 6 * 3600 + i * 600),
  }));
  const ctx = { building, wx, ref, toIso, placeId };
  const venue = offset(A.inside, (outward + 40) % 360, 2050);
  const bar = offset(A.inside, (outward + 200) % 360, 600);
  const farAway = offset(A.inside, (outward + 120) % 360, 900);
  const topLevel = levels ? Math.max(3, levels - 2) : 3;
  const lv = (n) => (levels ? Math.min(topLevel, n) : Math.min(3, n));
  // Phase 3: the trip's other sites (venues), hotel first.
  const venues = sitesForCity(city.key).filter((v) => v.kind === 'venue');
  const venuePlaceId = (v) => `fixture-venue-${v.key}`;
  const concert = venues.find((v) => v.role === 'performance');

  const people = {};
  const P = (id, fields) => (people[id] = fields);
  let venueCtx = null;
  const around = (center, i, spread = 8) =>
    offset(
      center,
      (outward - 70 + ((i * 47) % 140)) % 360,
      2 + ((i * 3.7) % spread),
    );

  if (sc === 'a') {
    // Demo A, 02:14: smoke reported on floor 9; most of the group is across
    // the street at the hotel's assembly point.
    const MR_LEVEL = lv(9);
    const AK_START = lv(10);
    P('MR', {
      at: offset(A.inside, 30, 6),
      acc: insideAcc,
      age: 34,
      floor: {
        level: MR_LEVEL,
        seed: 11,
        anchorAgo: 1800,
        hvacHpa: 0.05,
        trueLevel: MR_LEVEL,
      },
    });
    // A.K. started down the stairs from level 10 a minute before load (0.3 m/s): at the last
    // reading (40 s ago) the band reads "likely 9 (8-10) · descending".
    const fh = building.floor_height_m || 3.3;
    const akZ0 = zOnLevel(AK_START, fh);
    const akStart = -60; // descending across the 20 s window before the last reading
    P('AK', {
      at: offset(A.inside, 200, 8),
      acc: Math.min(10, insideAcc),
      age: 21,
      floor: {
        seed: 12,
        anchorAgo: 1800,
        hvacHpa: 0.05,
        path: () => [
          { t: -1860, z: 0, inside: false },
          { t: -1740, z: 0, inside: true },
          { t: -1650, z: akZ0, inside: true },
          { t: akStart, z: akZ0, inside: true },
          { t: akStart + (akZ0 - 1.2) / 0.3, z: 1.2, inside: true },
          { t: 1e6, z: 1.2, inside: true },
        ],
      },
    });
    P('SD', {
      at: offset(A.inside, 300, 5),
      acc: 30,
      stopped: { since: 1200, contact: 180, fixAge: 1500 },
      floor: { level: 0, seed: 13, anchorAgo: 1500, lastSampleAgo: 1320 },
    });
    P('LB', {
      at: offset(A.edge, outward, 1),
      acc: 30,
      age: 45,
      floor: { level: 6, seed: 14, barometer: 'missing' },
    });
    P('IS', {
      at: offset(A.edge, outward + 30, 3),
      acc: 26,
      age: 52,
      floor: { level: 4, seed: 15, anchor: false },
    });
    // Fixes just outside the wall with wide accuracy: the 2x circle crosses the
    // outline, so they stay undetermined even with a floor reading (06 HTL-02).
    P('T15', {
      at: offset(A.edge, outward - 25, 13),
      acc: 48,
      age: 30,
      floor: { level: lv(6), seed: 16, trueLevel: lv(6) },
    });
    P('T16', {
      at: offset(A.edge, outward + 25, 13),
      acc: 60,
      age: 40,
      floor: { level: lv(5), seed: 17, hvacHpa: 0.25 + 0.12, trueLevel: lv(5) },
    });
    P('T17', {
      at: offset(A.edge, outward, 12),
      acc: 35,
      age: 26,
      floor: { level: lv(3), seed: 18, trueLevel: lv(3) },
    });
    P('RO', { at: bar, acc: 15, age: 34 * 60, battery: [0.06, 'discharging'] });
    P('EW', { at: null });
    P('TC', { at: around(assembly, 1), acc: 12, age: 240 });
    const group = [
      'KV',
      'HL',
      'T01',
      'T02',
      'T03',
      'T04',
      'T05',
      'T06',
      'T07',
      'T08',
      'T09',
      'T10',
      'T11',
      'NF',
      'JO',
      'JP',
    ];
    group.forEach((id, i) =>
      P(id, {
        at: around(assembly, i + 2),
        acc: 8 + ((i * 5) % 13),
        age: 10 + ((i * 7) % 60),
      }),
    );
  } else if (sc === 'b' && concert) {
    // Demo B, Day 2 19:40: the concert. Most of the group is inside the
    // venue, a few outside its doors, three back at the hotel, two walking
    // between the hotel and the venue, one away, one not located.
    const V = concert.anchors;
    const vBuilding = {
      levels_above_ground: concert.levels ?? null,
      floor_height_m: concert.floorHeightM ?? null,
      ground_floor_label: concert.groundFloorLabel,
      levels_source: concert.levels ? 'osm_levels' : null,
    };
    venueCtx = { ...ctx, building: vBuilding, placeId: venuePlaceId(concert) };
    const vOut = bearing(V.inside, V.assembly);
    const vAcc = Math.min(12, Math.floor(V.insideClearanceM / 2.6));
    const top = concert.levels ? concert.levels - 1 : 1;
    const inVenue = [
      'MR',
      'AK',
      'SD',
      'LB',
      'T15',
      'T16',
      'T17',
      'KV',
      'HL',
      'T01',
      'T02',
      'T03',
      'T04',
      'T05',
      'T06',
      'T07',
      'T08',
    ];
    inVenue.forEach((id, i) =>
      P(id, {
        at: offset(V.inside, (i * 37) % 360, 3 + ((i * 5.3) % 14)),
        acc: vAcc,
        age: 15 + ((i * 11) % 70),
        floor: {
          level: i % 4 === 0 ? Math.min(1, top) : 0,
          seed: 60 + i,
          site: 'venue',
          ...(id === 'LB' ? { barometer: 'missing' } : {}),
        },
      }),
    );
    ['T10', 'T11', 'NF'].forEach((id, i) =>
      P(id, {
        at: offset(V.assembly, vOut + 40 * i, 4 + i * 3),
        acc: 10,
        age: 25 + i * 9,
      }),
    );
    // Back at the hotel: one unwell with a chaperone, one resting.
    P('TC', {
      at: offset(A.inside, 30, 5),
      acc: insideAcc,
      age: 60,
      floor: { level: lv(11), seed: 70 },
    });
    P('RO', {
      at: offset(A.inside, 200, 6),
      acc: insideAcc,
      age: 90,
      floor: { level: lv(11), seed: 71 },
    });
    P('IS', {
      at: offset(A.inside, 120, 6),
      acc: insideAcc,
      stopped: { since: 3000, contact: 400, fixAge: 3100 },
      floor: { level: lv(8), seed: 72, lastSampleAgo: 2900 },
    });
    // Walking from the hotel to the venue (between sites).
    const hv = { lat: V.inside.lat, lon: V.inside.lon };
    const leg = (f) => ({
      lat: A.inside.lat + (hv.lat - A.inside.lat) * f,
      lng: A.inside.lon + (hv.lon - A.inside.lon) * f,
    });
    P('JO', { at: leg(0.45), acc: 12, age: 20 });
    P('T09', { at: leg(0.52), acc: 14, age: 26 });
    P('JP', { at: farAway, acc: 16, age: 55, unaccompanied: true });
    P('EW', { at: null });
  } else {
    // Baseline, 21:32: covers every position and floor state.
    P('MR', {
      at: offset(A.inside, 30, 6),
      acc: insideAcc,
      age: 34,
      floor: { level: lv(9), seed: 21, anchorAgo: 1700, trueLevel: lv(9) },
    });
    P('AK', {
      at: offset(A.edge, outward, 12),
      acc: 45,
      age: 50,
      floor: { level: lv(7), seed: 22, anchorAgo: 3.2 * 3600, hvacHpa: 0.4 },
    });
    P('SD', {
      at: offset(A.inside, 300, 5),
      acc: 30,
      stopped: { since: 2400, contact: 300, fixAge: 2700 },
      floor: { level: lv(5), seed: 23, anchorAgo: 2700, lastSampleAgo: 2300 },
    });
    P('LB', {
      at: offset(A.inside, 90, 8),
      acc: insideAcc,
      age: 20,
      floor: { level: lv(6), seed: 24, barometer: 'missing' },
    });
    P('IS', {
      at: offset(A.inside, 160, 8),
      acc: insideAcc,
      age: 25,
      floor: { level: lv(4), seed: 25, anchor: false },
    });
    ['T15', 'T16', 'T17'].forEach((id, i) =>
      P(id, {
        at: offset(A.inside, 40 + i * 110, 9),
        acc: insideAcc,
        stopped: {
          since: 3600 + i * 600,
          contact: 240 + i * 60,
          fixAge: 3700 + i * 600,
        },
        floor: {
          level: lv(3 + i * 2),
          seed: 26 + i,
          anchorAgo: 3800 + i * 600,
          lastSampleAgo: 3500 + i * 600,
        },
      }),
    );
    P('JO', {
      at: offset(A.inside, 220, 7),
      acc: insideAcc,
      age: 15,
      floor: { level: lv(8), seed: 30 },
    });
    P('KV', {
      at: offset(A.inside, 0, 3),
      acc: insideAcc,
      age: 18,
      floor: { level: lv(8), seed: 31 },
    });
    P('T01', {
      at: offset(A.inside, 70, 4),
      acc: insideAcc,
      age: 22,
      floor: { level: lv(8), seed: 32, consent: false },
    });
    P('T02', {
      at: offset(A.inside, 140, 4),
      acc: insideAcc,
      age: 28,
      floor: { level: lv(9), seed: 33, anchorAgo: 6 * 3600 },
    });
    P('T03', {
      at: offset(A.inside, 210, 4),
      acc: insideAcc,
      age: 31,
      floor: { level: lv(9), seed: 34, jump: true },
    });
    P('T04', {
      at: offset(A.inside, 280, 4),
      acc: insideAcc,
      age: 19,
      floor: { level: (levels || 4) + 6, seed: 35 },
    });
    P('T05', {
      at: offset(A.inside, 350, 4),
      acc: insideAcc,
      age: 44,
      floor: { level: lv(11), seed: 36, anchorAgo: 2.5 * 3600, hvacHpa: 0.35 },
    });
    // T11 walks out of the hotel to the street over three minutes (03 §6.1).
    const walk = Math.min(1, t / 180);
    const T11pos = offset(
      offset(A.inside, 0, 0),
      outward,
      walk * meters(A.inside, A.assembly),
    );
    P('T11', {
      at: T11pos,
      acc: Math.min(10, insideAcc),
      age: 12,
      floor: walk < 0.4 ? { level: 0, seed: 37 } : null,
    });
    P('T06', { at: offset(A.edge, outward + 90, 2), acc: 180, age: 60 });
    P('T07', { at: offset(A.edge, outward - 90, 2), acc: null, age: 70 });
    P('T08', { at: around(assembly, 3), acc: 12, age: 30 });
    P('NF', { at: offset(venue, 90, 6), acc: 14, age: 40 });
    P('HL', { at: offset(venue, 270, 4), acc: 10, age: 25 });
    P('JP', { at: farAway, acc: 16, age: 55, unaccompanied: true });
    P('RO', {
      at: bar,
      acc: 15,
      age: 2 * 3600,
      battery: [0.18, 'discharging'],
    });
    P('TC', { at: offset(A.inside, 180, 4), acc: insideAcc, age: 300 });
    P('T09', {
      at: offset(A.inside, 45, 5),
      acc: insideAcc,
      stopped: { since: 9000, contact: 3100, fixAge: 9100 },
    });
    P('T10', {
      at: offset(A.inside, 135, 5),
      acc: insideAcc,
      age: null,
      timeUnknown: true,
    });
    P('EW', { at: null });
  }

  // Chaperone-anchored group zones (nearest_chaperone, 400 m).
  const chaperoneCenters = [];
  const participants = CAST.map(([id, name, role]) => {
    const s = people[id];
    const base = {
      id: `twin-${id}`,
      trip_id: TRIP,
      user_id: `twin-${id}`,
      name,
      role,
      status: 'active',
      avatar_url: null,
      freshMaxAgeSeconds: FRESH,
      staleAgeSeconds: STALE,
      battery_level: s?.battery?.[0] ?? 0.62,
      battery_state: s?.battery?.[1] ?? 'unplugged',
    };
    if (!s || !s.at)
      return {
        ...base,
        coordinates: null,
        capturedAt: null,
        locationAgeSeconds: null,
        freshness: 'unknown',
        isFresh: false,
        accuracy_m: null,
        group_zone_state: 'unknown',
      };
    let fresh;
    if (s.stopped) {
      fresh = {
        ...freshnessFields(s.stopped.fixAge),
        capturedAt: iso(s.stopped.fixAge),
        presence: s.stopped.contact < 2400 ? 'stopped' : 'stopped_no_answer',
        stationarySince: iso(s.stopped.since),
        lastContactAt: iso(s.stopped.contact),
      };
    } else if (s.timeUnknown) {
      fresh = {
        capturedAt: null,
        locationAgeSeconds: null,
        freshness: 'unknown',
        isFresh: false,
      };
    } else {
      fresh = { ...freshnessFields(s.age), capturedAt: iso(s.age) };
    }
    const person = {
      ...base,
      coordinates: { lat: s.at.lat, lng: s.at.lng },
      accuracy_m: s.acc,
      ...fresh,
      unaccompanied: Boolean(s.unaccompanied),
    };
    if (role === 'chaperone' && (fresh.isFresh || fresh.presence === 'stopped'))
      chaperoneCenters.push(person.coordinates);
    if (s.floor)
      person.floor_estimate = floorFor(
        s.floor,
        t,
        s.floor.site === 'venue' && venueCtx ? venueCtx : ctx,
      );
    return person;
  });
  for (const p of participants) {
    if (!p.coordinates) continue;
    const current = p.isFresh || p.presence === 'stopped';
    p.group_zone_state = !current
      ? 'unknown'
      : chaperoneCenters.some((c) => meters(c, p.coordinates) <= 400)
        ? 'inside'
        : 'outside';
  }

  const geofenceId = `${placeId}-perimeter`;
  const geofence_events = [];
  for (const p of participants) {
    if (p.presence === 'stopped' || p.presence === 'stopped_no_answer') {
      const since = Date.parse(p.stationarySince);
      geofence_events.push({
        id: `ev-${p.id}`,
        trip_id: TRIP,
        participant_id: p.id,
        geofence_id: geofenceId,
        geofence_name: 'Hotel perimeter',
        direction: 'enter',
        timestamp: new Date(since - 180000).toISOString(),
        coordinates: p.coordinates,
      });
    }
  }

  const snapshot = {
    schema_version: 1,
    generated_at: new Date(now).toISOString(),
    scope: { kind: 'organization', org_id: 'sample-org' },
    capabilities: { send_alert: true, direct_group: true },
    page: { offset: 0, limit: 10, total: 1, has_more: false },
    source_issues: [],
    trips: [
      {
        id: TRIP,
        title: 'Spring choir tour (sample)',
        destination: city.label,
        status: 'active',
        start_date: tripDate(1, now),
        end_date: tripDate(4, now),
        dates_note: 'sample dates shifted to start today',
        timezone: city.timezone,
        loaded_participants: CAST.length,
      },
    ],
    participants,
    places: [
      {
        id: placeId,
        trip_id: TRIP,
        kind: 'lodging',
        site_key: city.key,
        name: city.label,
        address: city.address || null,
        lat: A.inside.lat,
        lon: A.inside.lon,
        coordinates: { lat: A.inside.lat, lng: A.inside.lon },
        osm_id: city.osm,
        participant_ids: participants.map((p) => p.id),
        levels_above_ground: levels,
        floor_height_m: city.floorHeightM ?? null,
        lobby_height_m: null,
        ground_floor_label: city.groundFloorLabel,
        // Only where the floor count is mapped: an unverified numbering
        // (London) cannot carry a floor-level rooming list.
        room_assignments: levels ? roomAssignments() : [],
        ...(sc === 'a'
          ? {
              hotel_card: {
                // Floor labels as the hotel numbers them (US: lobby = 1).
                group_floors: [8, 9, 11],
                chaperone_floors: [8, 11],
                assembly_point: {
                  label: "Hotel's assembly point (across the street)",
                  coordinates: assembly,
                },
                stair_help: 1,
                provenance: 'from chaperone, 18:05',
              },
            }
          : {}),
      },
      ...venues.map((v) => ({
        id: venuePlaceId(v),
        trip_id: TRIP,
        kind: 'venue',
        site_key: v.key,
        name: v.label,
        address: null,
        lat: v.anchors.inside.lat,
        lon: v.anchors.inside.lon,
        coordinates: { lat: v.anchors.inside.lat, lng: v.anchors.inside.lon },
        osm_id: v.osm,
        participant_ids: participants.map((p) => p.id),
        levels_above_ground: v.levels ?? null,
        floor_height_m: v.floorHeightM ?? null,
        lobby_height_m: null,
        ground_floor_label: v.groundFloorLabel,
        visit_date: tripDate(v.day, now),
        room_assignments: [],
        assembly_point: {
          label: `${v.short} assembly point (outside the main doors)`,
          coordinates: {
            lat: v.anchors.assembly.lat,
            lng: v.anchors.assembly.lon,
          },
        },
      })),
    ],
    itinerary: venues.map((v) => ({
      id: `ev-${v.key}`,
      trip_id: TRIP,
      title: `${v.role === 'performance' ? 'Concert' : 'Visit'} · ${v.short}`,
      event_date: tripDate(v.day, now),
      start_time: v.start,
      end_time: v.end,
      location_name: v.label,
      place_id: venuePlaceId(v),
      coordinates: { lat: v.anchors.inside.lat, lng: v.anchors.inside.lon },
    })),
    safety_points: [
      ...safetyPoints(city, pois, A, outward, placeId),
      ...venues.flatMap((v) =>
        safetyPoints(
          v,
          poisBySite[v.key] || [],
          v.anchors,
          bearing(v.anchors.inside, v.anchors.assembly),
          venuePlaceId(v),
          // Advance demo: the day visit's rally point is still a draft.
          { rallyDraft: v.role === 'visit', relocation: false },
        ),
      ),
    ],
    geofences: [
      {
        id: geofenceId,
        trip_id: TRIP,
        name: 'Hotel perimeter',
        type: 'circle',
        radius: 400,
        category: 'safe_zone',
        source_type: 'location',
        source_id: placeId,
        center_lat: A.inside.lat,
        center_lng: A.inside.lon,
        active: true,
      },
    ],
    geofence_events,
    group_zones: [
      {
        trip_id: TRIP,
        model: 'nearest_chaperone',
        radius_m: 400,
        centers: chaperoneCenters,
        valid_for_seconds: sc === 'a' ? 45 : 30,
        degraded: false,
      },
    ],
    musters: [],
    morning_musters: [],
    alerts: [],
    flights: [],
    reported_incidents:
      sc === 'a'
        ? [
            {
              id: 'rep-smoke-9',
              place_id: placeId,
              kind: 'smoke',
              floor_label: 9,
              source: 'hotel desk',
              reported_at: toIso(-120),
              verified: false,
            },
          ]
        : [],
    scenario: {
      key: sc,
      label: SCENARIOS[sc].label,
      clock: SCENARIOS[sc].clock,
      elapsed_s: t,
    },
  };
  return snapshot;
}

/** Real public safety resources + fictional rally points on real open spaces. */
function safetyPoints(
  city,
  pois,
  A,
  outward,
  placeId,
  { rallyDraft = false, relocation = true } = {},
) {
  const here = A.inside;
  const near = (kind, pred = () => true) =>
    pois
      .filter((p) => p.kind === kind && pred(p))
      .map((p) => ({ ...p, d: meters(here, p) }))
      .sort((a, b) => a.d - b.d);
  const point = (id, category, p, extra = {}) => ({
    id: `sp-${city.key}-${id}`,
    trip_id: TRIP,
    location_id: placeId,
    category,
    source: extra.source || 'poi',
    name: extra.name || p.name || category,
    address: p.address || null,
    coordinates: p.lat !== undefined ? { lat: p.lat, lng: p.lon } : null,
    contact: p.phone || null,
    emergency: p.emergency || null,
    instructions: extra.instructions || null,
    approval_status: extra.approval_status || 'active',
    priority: extra.priority || null,
    visibility: extra.visibility || 'travelers',
    chaperone_only: Boolean(extra.chaperone_only),
    reviewed_at: extra.reviewed_at || null,
  });
  const out = [];
  const hospital =
    near('hospital', (p) => p.emergency === 'yes')[0] || near('hospital')[0];
  if (hospital) out.push(point('hospital', 'hospital', hospital));
  const police = near('police')[0];
  if (police) out.push(point('police', 'police', police));
  const fire = near('fire_station')[0];
  if (fire)
    out.push(point('fire', 'fire', fire, { reviewed_at: '2025-08-02' }));
  const embassy = near('diplomatic')[0];
  if (embassy && embassy.d < 3000)
    out.push(point('embassy', 'embassy', embassy));
  const open = [...near('park'), ...near('square'), ...near('pedestrian_area')]
    .filter((p) => p.d > 150 && p.d < 900)
    .sort((a, b) => a.d - b.d);
  if (open[0])
    out.push(
      point('rally-1', 'rally_primary', open[0], {
        source: 'trip',
        name: `Rally point (primary) · ${open[0].name || 'open space'}`,
        priority: 1,
        ...(rallyDraft ? { approval_status: 'draft' } : {}),
      }),
    );
  const second = open.find(
    (p) => open[0] && Math.abs(bearing(here, p) - bearing(here, open[0])) > 70,
  );
  if (second)
    out.push(
      point('rally-2', 'rally_secondary', second, {
        source: 'trip',
        name: `Rally point (secondary) · ${second.name || 'open space'}`,
        approval_status: 'draft',
      }),
    );
  const sh = open.find((p) => p !== open[0] && p !== second && p.d > 300);
  if (sh)
    out.push(
      point('safe-house', 'safe_house', sh, {
        source: 'trip',
        name: `Group shelter · ${sh.name || 'nearby'}`,
        chaperone_only: true,
        visibility: 'chaperones',
      }),
    );
  if (!relocation) return out;
  const reloc = offset(here, (outward + 160) % 360, 4100);
  out.push(
    point(
      'relocation',
      'relocation',
      { lat: reloc.lat, lon: reloc.lng, name: 'Relocation site (sample)' },
      { source: 'trip' },
    ),
  );
  return out;
}
