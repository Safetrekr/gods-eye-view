import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validPoint,
  currentFreshness,
  derivePresence,
  STATIONARY_CONTACT_MAX_AGE_SECONDS,
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

const SERVER_NOW = Date.parse('2026-10-14T15:00:00.000Z');
const stoppedPerson = (contactAgeSeconds, extra = {}) => ({
  coordinates: { lat: 30.26, lng: -97.74 },
  freshness: 'stale',
  isFresh: false,
  locationAgeSeconds: 3 * 3600,
  freshMaxAgeSeconds: 120,
  staleAgeSeconds: 600,
  capturedAt: new Date(SERVER_NOW - 3 * 3600 * 1000).toISOString(),
  stationarySince: new Date(SERVER_NOW - 3 * 3600 * 1000).toISOString(),
  lastContactAt: new Date(SERVER_NOW - contactAgeSeconds * 1000).toISOString(),
  presence: 'stopped',
  ...extra,
});

test('a stopped traveler with a stale fix but recent contact reads as current', () => {
  assert.equal(STATIONARY_CONTACT_MAX_AGE_SECONDS, 2400);
  const f = currentFreshness(stoppedPerson(600), 0);
  assert.equal(f.state, 'fresh');
  assert.equal(f.label, 'At this location for 3h');
  assert.equal(f.age, 600);
  assert.equal(f.presence, 'stopped');
});

test('stay duration formats minutes, hours, and hours with minutes', () => {
  const at = (stayS) =>
    currentFreshness(
      stoppedPerson(60, {
        stationarySince: new Date(SERVER_NOW - stayS * 1000).toISOString(),
      }),
      0,
    ).label;
  assert.equal(at(25 * 60), 'At this location for 25m');
  assert.equal(at(3600 + 15 * 60), 'At this location for 1h 15m');
  assert.equal(at(2 * 3600), 'At this location for 2h');
});

test('contact age is capped at 2400 s, including elapsed time', () => {
  assert.equal(currentFreshness(stoppedPerson(2399), 0).state, 'fresh');
  const gone = currentFreshness(stoppedPerson(2400), 0);
  assert.equal(gone.state, 'stale');
  assert.equal(gone.presence, 'stopped_no_answer');
  assert.equal(gone.label, 'Did not answer a location check · Updated 40m ago');
  assert.equal(currentFreshness(stoppedPerson(2390), 20).state, 'stale');
  assert.equal(currentFreshness(stoppedPerson(2390), 5).state, 'fresh');
});

test('presence is re-derived and ignores the payload presence field', () => {
  assert.equal(
    derivePresence(stoppedPerson(2500, { presence: 'stopped' }), 0).presence,
    'stopped_no_answer',
  );
  assert.equal(
    derivePresence(stoppedPerson(60, { presence: 'moving' }), 0).presence,
    'stopped',
  );
});

test('contact in the future is unusable beyond 120 s and zero within it', () => {
  const p = stoppedPerson(-121);
  assert.equal(derivePresence(p, 0), null);
  assert.equal(currentFreshness(p, 0).label, 'Last known · 3h ago');
  const near = currentFreshness(stoppedPerson(-100), 0);
  assert.equal(near.state, 'fresh');
  assert.equal(near.age, 0);
});

test('without stationarySince or lastContactAt the old logic applies', () => {
  const p = stoppedPerson(60);
  assert.equal(derivePresence({ ...p, stationarySince: null }, 0), null);
  assert.equal(derivePresence({ ...p, lastContactAt: 'junk' }, 0), null);
  assert.equal(
    currentFreshness({ ...p, stationarySince: null }, 0).label,
    'Last known · 3h ago',
  );
});

test('missing capturedAt falls back to the payload presence', () => {
  const p = stoppedPerson(60, { capturedAt: null });
  const stopped = currentFreshness(p, 0);
  assert.equal(stopped.state, 'fresh');
  assert.equal(stopped.label, 'At this location');
  const noAnswer = currentFreshness({ ...p, presence: 'stopped_no_answer' }, 0);
  assert.equal(noAnswer.state, 'stale');
  assert.match(noAnswer.label, /^Did not answer a location check/);
  assert.equal(
    currentFreshness({ ...p, presence: 'moving' }, 0).label,
    'Last known · 3h ago',
  );
});

test('payloads without the new fields behave exactly as before', () => {
  const p = {
    coordinates: { lat: 0, lng: 0 },
    freshness: 'fresh',
    locationAgeSeconds: 110,
    freshMaxAgeSeconds: 120,
    staleAgeSeconds: 600,
    capturedAt: new Date(SERVER_NOW).toISOString(),
  };
  assert.equal(derivePresence(p, 0), null);
  assert.deepEqual(currentFreshness(p, 0), {
    state: 'fresh',
    age: 110,
    label: '1m ago',
  });
});
