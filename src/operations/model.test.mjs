import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validPoint,
  currentFreshness,
  nearbyCameras,
  makeAircraftLink,
  liveAircraftLink,
} from './model.js';
import { SnapshotPoller } from './api.js';

test('zero coordinates and aging are preserved without relying on updated_at', () => {
  assert.ok(validPoint({ lat: 0, lng: 0 }));
  assert.equal(validPoint({ lat: null, lng: 0 }), false);
  const p = {
    coordinates: { lat: 0, lng: 0 },
    freshness: 'fresh',
    locationAgeSeconds: 110,
    freshMaxAgeSeconds: 120,
    staleAgeSeconds: 600,
  };
  assert.equal(currentFreshness(p, 20).state, 'aging');
  assert.equal(currentFreshness(p, 500).state, 'stale');
  assert.equal(
    currentFreshness({ ...p, freshness: 'unknown' }, 0).state,
    'unknown',
  );
  assert.equal(
    currentFreshness({ ...p, coordinates: null }).label,
    'No location reported',
  );
});

test('nearby cameras are measured from the subject, with an explicit radius', () => {
  const cameras = [
    { id: 'far', lat: 40, lon: 0 },
    { id: 'near', lat: 0.001, lon: 0 },
    { id: 'unknown', lat: null, lon: 0 },
  ];
  assert.deepEqual(
    nearbyCameras(cameras, { lat: 0, lng: 0 }, 1).map((c) => c.id),
    ['near'],
  );
  assert.deepEqual(nearbyCameras(cameras, null), []);
});

const now = Date.parse('2026-09-12T15:00:00Z');
const flight = {
  id: 'leg-1',
  participant_ids: ['p1'],
  departure_time: '2026-09-12T14:00:00Z',
  arrival_time: '2026-09-12T17:00:00Z',
  departure_airport: 'JFK',
  arrival_airport: 'AUS',
};
const aircraft = {
  icao24: 'a1b2c3',
  callsign: 'TEST123',
  origin: 'JFK',
  destination: 'AUS',
  stale: false,
};

test('aircraft links require explicit confirmation, assigned passengers, and a dated leg', () => {
  assert.throws(
    () => makeAircraftLink(flight, aircraft, false, now),
    /Confirm/,
  );
  assert.throws(
    () =>
      makeAircraftLink({ ...flight, participant_ids: [] }, aircraft, true, now),
    /assignments/,
  );
  assert.throws(
    () =>
      makeAircraftLink(
        { ...flight, departure_time: '14:00' },
        aircraft,
        true,
        now,
      ),
    /timezones/,
  );
  assert.throws(
    () => makeAircraftLink(flight, { ...aircraft, stale: true }, true, now),
    /stale/,
  );
  assert.throws(
    () =>
      makeAircraftLink(flight, { ...aircraft, destination: 'LAX' }, true, now),
    /conflicts/,
  );
  assert.throws(
    () => makeAircraftLink(flight, aircraft, true, now + 86400000),
    /window/,
  );
});

test('links expire and are invalidated when an aircraft changes flights or schedule', () => {
  const link = makeAircraftLink(flight, aircraft, true, now);
  assert.equal(liveAircraftLink(link, flight, aircraft, now + 1000), true);
  assert.equal(liveAircraftLink(link, flight, aircraft, now + 7200000), false);
  assert.equal(
    liveAircraftLink(link, flight, { ...aircraft, callsign: 'TEST124' }, now),
    false,
  );
  assert.equal(
    liveAircraftLink(
      link,
      { ...flight, departure_time: '2026-09-12T14:01:00Z' },
      aircraft,
      now,
    ),
    false,
  );
  assert.equal(liveAircraftLink(link, flight, null, now), false);
});

test('a late account/filter response cannot repopulate a stopped poller', async () => {
  let resolve;
  const published = [];
  const poller = new SnapshotPoller({
    request: () =>
      new Promise((done) => {
        resolve = done;
      }),
    onData: (x) => published.push(x),
    onError: () => {},
    interval: 60000,
  });
  poller.start();
  poller.stop();
  resolve({ private: true });
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(published, []);
});
