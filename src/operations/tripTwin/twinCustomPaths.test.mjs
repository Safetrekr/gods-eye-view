import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePolyline6,
  valhallaRequest,
} from '../../../server/tripTwin/routingProxy.js';
import { bannedWordHits, haversineM } from './twinData.js';
import {
  avoidCrossings,
  circleRing,
  defaultName,
  insertWaypoint,
  loadStore,
  avoidStatus,
  pathChecks,
  requestPath,
  reviewSignature,
  reviewState,
  savedPathLines,
} from './twinCustomPaths.js';

const A = { lat: 30.2621, lon: -97.7382 };
const B = { lat: 30.2602, lon: -97.7511 };

test('polyline6 decode (Valhalla shape)', () => {
  // "_izlhA~rlgdF" encodes (38.5, -120.2) at precision 6
  const pts = decodePolyline6('_izlhA~rlgdF_{geC~ywl@');
  assert.equal(pts[0].lat, 38.5);
  assert.equal(pts[0].lon, -120.2);
  assert.equal(pts.length, 2);
});

test('valhalla request: break ends, through waypoints, avoid polygons', () => {
  const r = valhallaRequest({
    points: [A, { lat: 30.261, lon: -97.746 }, B],
    profile: 'car',
    avoid: [circleRing({ lat: 30.262, lon: -97.744 }, 100, 8)],
  });
  assert.equal(r.costing, 'auto');
  assert.deepEqual(
    r.locations.map((l) => l.type),
    ['break', 'through', 'break'],
  );
  assert.equal(r.exclude_polygons[0].length, 9);
  assert.throws(() => valhallaRequest({ points: [A] }), /2–12 points/);
});

test('circle ring is closed and has the radius', () => {
  const ring = circleRing(A, 100, 12);
  assert.deepEqual(ring[0], ring[12]);
  assert.ok(Math.abs(haversineM(A, ring[3]) - 100) < 1);
});

test('waypoint goes where it adds the least distance', () => {
  const mid = { lat: 30.2611, lon: -97.7446 };
  const pts = insertWaypoint([A, B], mid);
  assert.deepEqual(pts, [A, mid, B]);
  const near = { lat: 30.2603, lon: -97.75 };
  assert.deepEqual(insertWaypoint(pts, near), [A, mid, near, B]);
});

test('avoid-area crossing is found even for a short pass', () => {
  const area = {
    id: 'x',
    center: { lat: 30.2611, lon: -97.7446 },
    radiusM: 50,
    reason: 'crowd',
  };
  assert.equal(avoidCrossings([A, B], [area]).length, 1);
  const far = { ...area, center: { lat: 30.27, lon: -97.7446 } };
  assert.equal(avoidCrossings([A, B], [far]).length, 0);
});

test('checks: avoid entered on fallback, much longer, does not reach, after dark', () => {
  const area = {
    id: 'x',
    center: { lat: 30.2611, lon: -97.7446 },
    radiusM: 50,
    reason: 'construction',
    note: 'Cesar Chavez',
  };
  const straight = haversineM(A, B);
  const flags = pathChecks(
    {
      geometry: [
        A,
        { lat: 30.2611, lon: -97.7446 },
        { lat: 30.265, lon: -97.7511 },
      ],
      distanceM: straight * 2,
      avoidApplied: false,
    },
    {
      points: [A, B],
      areas: [area],
      hazards: [],
      dark: true,
      day: 2,
      profile: 'foot',
    },
  );
  assert.deepEqual(
    flags.map((f) => f.key),
    ['avoid', 'long', 'reach', 'dark'],
  );
  assert.match(
    flags[0].text,
    /Construction \(Cesar Chavez\) — avoid-areas could not be applied by the router/,
  );
  assert.deepEqual(bannedWordHits(JSON.stringify(flags)), []);
});

test('router fallback: OSRM through waypoints, avoid not applied', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === '/api/twin-path')
      return { json: async () => ({ ok: false, error: 'down' }) };
    return {
      json: async () => ({
        ok: true,
        distanceM: 1500,
        durationS: 1100,
        geometry: [
          [A.lon, A.lat],
          [B.lon, B.lat],
        ],
      }),
    };
  };
  const r = await requestPath({ points: [A, B] }, { fetchImpl });
  assert.equal(r.engine, 'osrm');
  assert.equal(r.avoidApplied, false);
  assert.match(
    calls[1],
    /^\/api\/route\?profile=foot&coords=-97\.738200,30\.262100;-97\.751100,30\.260200$/,
  );
});

test('saved path lines: plain outcome, never "avoids" next to "enters"', () => {
  const area = {
    id: 'x',
    center: { lat: 30.2611, lon: -97.7446 },
    radiusM: 50,
    reason: 'lighting',
  };
  const p = {
    id: 'p1',
    name: defaultName({ fromLabel: 'Fairmont Austin', toLabel: 'Long Center' }),
    day: 2,
    profile: 'foot',
    siteKeys: ['austin', 'austin-long-center'],
    areaIds: ['x'],
    routedAroundIds: ['x'],
    avoidApplied: true,
    distanceM: 1900,
    geometry: [A, B],
    reviewedBy: null,
  };
  const [line] = savedPathLines([p], {
    day: 2,
    siteKey: 'austin-long-center',
    areas: [area],
  });
  assert.equal(
    line.text,
    'Fairmont Austin → Long Center · Day 2 · walk: 1.9 km · walk 30–38 min (group pace) · ENTERS avoid-area: poor lighting · not reviewed',
  );
  assert.doesNotMatch(line.text, /avoids/);
  // Routed around: the path stays clear of the area.
  const clear = { ...p, geometry: [A, { lat: 30.265, lon: -97.745 }, B] };
  assert.match(
    avoidStatus(clear, [area]).text,
    /^routed around: poor lighting$/,
  );
  // An area added after saving makes the path out of date, and the review too.
  const later = {
    id: 'y',
    center: { lat: 30.3, lon: -97.7 },
    radiusM: 50,
    reason: 'crowd',
  };
  const reviewed = {
    ...clear,
    reviewedBy: 'you · Thu 16 Oct 22:00 CDT',
    reviewedStatus: reviewSignature(clear, [area], []),
  };
  assert.equal(reviewState(reviewed, [area]).ok, true);
  assert.equal(reviewState(reviewed, [area, later]).ok, false);
  assert.match(
    avoidStatus(clear, [area, later]).text,
    /planned before 1 newer avoid-area/,
  );
  assert.equal(savedPathLines([p], { day: 3, siteKey: 'austin' }).length, 0);
  assert.deepEqual(loadStore('nonsense'), { paths: [], areas: [] });
});

test('an avoid-area holding the start is left out of the request and named', async () => {
  let body = null;
  const fetchImpl = async (url, opts) => {
    body = JSON.parse(opts.body);
    return {
      json: async () => ({
        ok: true,
        engine: 'valhalla',
        distanceM: 1500,
        durationS: 1100,
        geometry: [A, B],
      }),
    };
  };
  const atStart = { id: 's', center: A, radiusM: 60, reason: 'crowd' };
  const elsewhere = {
    id: 'e',
    center: { lat: 30.27, lon: -97.745 },
    radiusM: 60,
    reason: 'traffic',
  };
  const r = await requestPath(
    { points: [A, B], areas: [atStart, elsewhere] },
    { fetchImpl },
  );
  assert.equal(body.avoid.length, 1, 'only the avoidable area is sent');
  const flags = pathChecks(r, {
    points: [A, B],
    areas: [atStart, elsewhere],
    hazards: [],
  });
  assert.equal(flags[0].key, 'avoid_endpoint');
  assert.match(flags[0].text, /inside an avoid-area \(Crowd \/ event\)/);
  assert.ok(
    !flags.some((f) => f.key === 'avoid'),
    'not double-reported as a crossing',
  );
});
