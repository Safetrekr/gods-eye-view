// Live aircraft (Jesse, 29 Oct 2026): the room's aircraft route (filter,
// shared cache, stale handling, recorded fixture, HTTP), the page's poll
// (nothing fetched while the layer is off or the page hidden), the words
// (LIVE / STALE / RECORDED, never sample), the sums, and the toggle through
// the session, a wall's own sheet, Fitzroy and the relay's voice policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AIRCRAFT_FRESH_MS,
  AIRCRAFT_KEEP_MS,
  POSITION_MAX_AGE_S,
  createTwinAircraft,
  isAdsbLolVehicle,
  nearbyAircraft,
  parseFlights,
  radiusKm,
  readAircraftFixture,
  twinAircraftProxy,
} from '../../../server/tripTwin/aircraftProxy.js';
import { voiceVerdict } from '../../../server/tripTwin/voicePolicy.js';
import {
  AIRCRAFT_POLL_MS,
  aircraftHeightM,
  aircraftLine,
  aircraftTitle,
  aircraftUrl,
  aircraftView,
  createAircraftFeed,
  extrapolate,
} from './twinAircraft.js';
import { LAYER_CATALOG, layerValue } from './twinScreenRoles.js';
import { applyCommand, createSession } from './twinSession.js';
import { clockHost, confirmed } from './twinTestKit.mjs';
import { createFitzroyCatalog } from './fitzroy/fitzroyCatalog.js';
import { LAYERS, SPOKEN } from './fitzroy/fitzroyCommands.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-aircraft-test-'));
process.env.TMPDIR = path.join(scratch, 'tmp');
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit');
fs.mkdirSync(process.env.TMPDIR);
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const T5 = { lat: 51.4717, lon: -0.48771 };
const FEED_S = 1_793_312_276;
/** One OpenSky state vector (fields as upstream sends them). */
const sv = (icao, cs, lon, lat, o = {}) => [
  icao,
  cs,
  'United Kingdom',
  o.tPos ?? FEED_S - 2,
  o.tContact ?? FEED_S - 1,
  lon,
  lat,
  'baro' in o ? o.baro : 900,
  o.ground ?? false,
  o.v ?? 80,
  o.track ?? 270,
  o.vr ?? -3,
  null,
  'geo' in o ? o.geo : 950,
  '1234',
  false,
  0,
];
const STATES = [
  sv('4007f7', 'BAW59   ', -0.4836, 51.4714, { ground: true, baro: null }),
  sv('406a3b', 'BAW877  ', -0.45, 51.48),
  // 60 km away: outside 40 km.
  sv('400aaa', 'EZY12   ', 0.38, 51.5),
  // Position 3 minutes old at the snapshot: not drawn.
  sv('400bbb', 'OLD1    ', -0.5, 51.47, { tPos: FEED_S - 180 }),
  // Not an aircraft address; a duplicate; no position.
  sv('nothex!', 'X', -0.49, 51.47),
  sv('406a3b', 'BAW877  ', -0.45, 51.48),
  sv('400ccc', 'NOPOS', null, null),
  // No baro altitude: the geometric one.
  sv('400ddd', '', -0.6, 51.4, { baro: null, geo: 1200 }),
];

test('aircraft route: within r km only, nearest first, trimmed; old positions, bad addresses, duplicates and missing positions left out', () => {
  const out = nearbyAircraft(STATES, T5, 40, FEED_S);
  assert.deepEqual(
    out.map((a) => a.icao24),
    ['4007f7', '406a3b', '400ddd'],
  );
  const [ground, air, geo] = out;
  assert.equal(ground.callsign, 'BAW59');
  assert.equal(ground.onGround, true);
  assert.equal(ground.altM, null);
  assert.equal(ground.posAgeS, 2);
  assert.equal(ground.ageS, 1);
  assert.equal(air.altM, 900);
  assert.equal(air.trackDeg, 270);
  assert.equal(air.vRateMs, -3);
  assert.equal(geo.callsign, null, 'an empty callsign is null');
  assert.equal(geo.altM, 1200, 'geometric altitude when baro is missing');
  assert.ok(out.every((a) => a.dKm <= 40));
  assert.deepEqual(Object.keys(air).sort(), [
    'ageS',
    'altM',
    'callsign',
    'dKm',
    'icao24',
    'lat',
    'lon',
    'onGround',
    'posAgeS',
    'speedMs',
    'trackDeg',
    'vRateMs',
  ]);
  assert.equal(nearbyAircraft(STATES, T5, 80, FEED_S).length, 4);
  assert.ok(POSITION_MAX_AGE_S < 180);
  // r: default 40, at most 80, at least 1; junk refused.
  assert.equal(radiusKm(null), 40);
  assert.equal(radiusKm('120'), 80);
  assert.equal(radiusKm('0'), 1);
  assert.equal(radiusKm('x'), null);
  assert.equal(parseFlights('<html>'), null);
  assert.equal(parseFlights({ error: 'no' }), null);
  assert.deepEqual(parseFlights({ time: 10, states: null }), {
    feedAt: 10_000,
    states: [],
  });
});

/** A fake upstream /api/flights on a fake clock. */
function rig({ body = () => ({ time: FEED_S, states: STATES }) } = {}) {
  let t = FEED_S * 1000 + 3000;
  const calls = [];
  let fail = false;
  let source = null;
  const upstream = async (p) => {
    calls.push(p);
    if (fail) throw new Error('down');
    return {
      ok: true,
      status: 200,
      headers: { get: (k) => (k === 'x-flight-source' ? source : null) },
      text: async () => JSON.stringify(body(t)),
    };
  };
  const air = createTwinAircraft({ upstream, now: () => t });
  return {
    air,
    calls,
    tick: (ms) => (t += ms),
    fail: (v = true) => (fail = v),
    source: (s) => (source = s),
  };
}

test('aircraft route: upstream is read once per 10 s for the whole room (any point, concurrent asks share one read)', async () => {
  const k = rig();
  const [a, b] = await Promise.all([
    k.air.near(T5.lat, T5.lon, 40),
    k.air.near(T5.lat, T5.lon, 40),
  ]);
  assert.equal(k.calls.length, 1, 'concurrent asks share one read');
  assert.match(k.calls[0], /^\/api\/flights\?lat=51\.47&lon=-0\.49$/);
  assert.equal(a.status, 'live');
  assert.equal(a.source, 'OpenSky Network');
  assert.equal(a.count, 3);
  assert.equal(a.feedAgeS, 3);
  assert.equal(b.count, 3);
  // Another wall, another site: the worldwide snapshot answers it.
  k.tick(4000);
  const far = await k.air.near(40.0, -3.7, 40);
  assert.equal(k.calls.length, 1);
  assert.equal(far.count, 0);
  k.tick(AIRCRAFT_FRESH_MS);
  await k.air.near(T5.lat, T5.lon, 40);
  assert.equal(k.calls.length, 2, 'a read again after 10 s');
  // A small answer: the near list only, never the worldwide body.
  assert.ok(JSON.stringify(a).length < 2000);
});

test('aircraft route stale handling: the last good snapshot is kept and aged (STALE after a minute), a failed read is not repeated within 10 s, and after five minutes none is drawn', async () => {
  const k = rig();
  await k.air.near(T5.lat, T5.lon, 40);
  k.fail();
  k.tick(AIRCRAFT_FRESH_MS + 1000);
  let r = await k.air.near(T5.lat, T5.lon, 40);
  assert.equal(k.calls.length, 2);
  assert.equal(r.status, 'live', 'still within a minute of the feed time');
  assert.equal(r.count, 3);
  await k.air.near(T5.lat, T5.lon, 40);
  assert.equal(k.calls.length, 2, 'no retry within 10 s of a failure');
  k.tick(60_000);
  r = await k.air.near(T5.lat, T5.lon, 40);
  assert.equal(r.status, 'stale');
  assert.ok(r.staleS > 60);
  assert.equal(r.count, 3, 'last good planes, marked stale');
  k.tick(AIRCRAFT_KEEP_MS);
  r = await k.air.near(T5.lat, T5.lon, 40);
  assert.equal(r.status, 'unavailable');
  assert.deepEqual(r.aircraft, []);
  // Back: live again.
  k.fail(false);
  k.tick(AIRCRAFT_FRESH_MS);
  r = await k.air.near(T5.lat, T5.lon, 40);
  assert.equal(r.status, 'unavailable', 'the feed time is still old');
  // Upstream serving its own old body (OpenSky cooldown): STALE by feed time.
  const old = rig({ body: () => ({ time: FEED_S - 120, states: STATES }) });
  const s = await old.air.near(T5.lat, T5.lon, 40);
  assert.equal(s.status, 'stale');
  assert.equal(s.staleS, 123);
  // Nothing ever: unavailable, no planes.
  const none = rig();
  none.fail();
  const u = await none.air.near(T5.lat, T5.lon, 40);
  assert.equal(u.status, 'unavailable');
  assert.equal(u.count, 0);
});

test('aircraft route: upstream’s adsb.lol fallback is named as the source and only answers near its own point', async () => {
  const k = rig({ body: (t) => ({ time: t / 1000, states: STATES }) });
  k.source('adsb.lol');
  const r = await k.air.near(T5.lat, T5.lon, 40);
  assert.equal(r.source, 'adsb.lol');
  await k.air.near(40.0, -3.7, 40);
  assert.equal(k.calls.length, 2, 'a regional snapshot does not answer Madrid');
});

test('aircraft route fixture: the recorded Heathrow snapshot is RECORDED, never live, and never fetched', async () => {
  const body = readAircraftFixture();
  let fetched = 0;
  const air = createTwinAircraft({
    fixture: body,
    upstream: async () => {
      fetched += 1;
      throw new Error('never');
    },
  });
  const r = await air.near(T5.lat, T5.lon, 40);
  assert.equal(fetched, 0);
  assert.equal(r.status, 'recorded');
  assert.equal(r.feedAgeS, null);
  assert.ok(r.count >= 10, `aircraft near T5 in the recording (${r.count})`);
  assert.ok(r.aircraft.some((a) => a.onGround && a.dKm < 1.5));
  assert.ok(r.aircraft.some((a) => !a.onGround));
});

test('aircraft route HTTP: GET only, lat and lon required, r clamped, the Trip Twin host guard in front', async () => {
  const uses = [];
  const server = {
    config: { root: scratch },
    httpServer: { address: () => ({ port: 4999 }) },
    middlewares: { use: (p, fn) => uses.push([p, fn]) },
  };
  const seen = [];
  const service = {
    near: async (lat, lon, r) => {
      seen.push([lat, lon, r]);
      return { status: 'live', aircraft: [] };
    },
  };
  twinAircraftProxy({ service }).configureServer(server);
  assert.deepEqual(
    uses.map(([p]) => p),
    ['/api/twin-aircraft', '/api/twin-aircraft'],
  );
  const [, guard] = uses[0];
  const [, handler] = uses[1];
  const call = async (url, method = 'GET', fn = handler, headers = {}) => {
    const res = {
      status: 0,
      body: '',
      writeHead(s) {
        this.status = s;
      },
      setHeader() {},
      end(b) {
        this.body = String(b || '');
      },
    };
    await fn(
      {
        method,
        url,
        originalUrl: `/api/twin-aircraft${url}`,
        headers: { host: 'localhost:4999', ...headers },
        socket: { remoteAddress: '127.0.0.1', localPort: 4999 },
      },
      res,
      () => (res.status = 'next'),
    );
    return res;
  };
  assert.equal((await call('/?lat=51.47&lon=-0.49')).status, 200);
  assert.equal((await call('/?lat=51.47&lon=-0.49&r=500')).status, 200);
  assert.deepEqual(seen, [
    [51.47, -0.49, 40],
    [51.47, -0.49, 80],
  ]);
  assert.equal((await call('/?lat=51.47')).status, 400);
  assert.equal((await call('/?lat=x&lon=1')).status, 400);
  assert.equal((await call('/?lat=95&lon=1')).status, 400);
  assert.equal((await call('/?lat=1&lon=1', 'POST')).status, 405);
  assert.equal((await call('/other?lat=1&lon=1')).status, 404);
  const blocked = await call('/?lat=1&lon=1', 'GET', guard, {
    'sec-fetch-site': 'cross-site',
  });
  assert.equal(blocked.status, 403, 'a cross-site page cannot ask');
});

/** Fake timers for the page's poll. */
function timers() {
  let t = 0;
  let id = 0;
  const q = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      id += 1;
      q.set(id, { fn, at: t + ms });
      return id;
    },
    clearTimer: (i) => q.delete(i),
    pending: () => q.size,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...q.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        q.delete(next[0]);
        t = next[1].at;
        next[1].fn();
        await new Promise((r) => setImmediate(r));
      }
      t = end;
    },
  };
}
const settle = () => new Promise((r) => setImmediate(r));

test('page poll: nothing is fetched while the layer is off; on asks at once and every 15 s; a hidden page stops; off forgets the planes', async () => {
  const tm = timers();
  let visible = true;
  const urls = [];
  const changes = [];
  const feed = createAircraftFeed({
    ...tm,
    visible: () => visible,
    center: () => T5,
    fetchJson: async (u) => {
      urls.push(u);
      return {
        status: 'live',
        feedAgeS: 2,
        rKm: 40,
        aircraft: [{ icao24: 'a' }],
      };
    },
    onChange: (s) => changes.push(s),
  });
  await tm.advance(10 * AIRCRAFT_POLL_MS);
  feed.visibilityChanged();
  feed.recenter();
  assert.equal(urls.length, 0, 'off: no aircraft fetch at all');
  assert.equal(tm.pending(), 0);
  feed.setOn(true);
  await settle();
  assert.equal(urls.length, 1);
  assert.equal(urls[0], '/api/twin-aircraft?lat=51.4717&lon=-0.4877&r=40');
  assert.equal(feed.state().data.aircraft.length, 1);
  await tm.advance(AIRCRAFT_POLL_MS - 1);
  assert.equal(urls.length, 1);
  await tm.advance(1);
  assert.equal(urls.length, 2, 'every 15 s');
  visible = false;
  feed.visibilityChanged();
  await tm.advance(5 * AIRCRAFT_POLL_MS);
  assert.equal(urls.length, 2, 'hidden: no fetch');
  visible = true;
  feed.visibilityChanged();
  await settle();
  assert.equal(urls.length, 3, 'visible again and due: asks at once');
  feed.setOn(false);
  assert.equal(feed.state().data, null, 'off forgets the planes');
  await tm.advance(5 * AIRCRAFT_POLL_MS);
  assert.equal(urls.length, 3);
  assert.equal(tm.pending(), 0);
  // A failing poll keeps the last answer and says so; never throws.
  const bad = createAircraftFeed({
    ...tm,
    center: () => T5,
    fetchJson: async () => {
      throw new Error('HTTP 502');
    },
  });
  bad.setOn(true);
  await settle();
  assert.equal(bad.state().error, 'HTTP 502');
  assert.equal(aircraftView(bad.state()).status, 'unavailable');
  bad.dispose();
});

test('aircraft words: LIVE with source, count, radius and age; STALE and RECORDED say so; nothing drawn when too old; never sample', () => {
  const at = 1_000_000;
  const feed = (d, o = {}) => ({ on: true, data: d, receivedAt: at, ...o });
  const live = aircraftView(
    feed({
      status: 'live',
      source: 'OpenSky Network',
      feedAgeS: 4,
      rKm: 40,
      aircraft: new Array(19).fill({ icao24: 'x' }),
    }),
    at + 2000,
  );
  assert.equal(
    aircraftLine(live),
    'LIVE aircraft · OpenSky Network · 19 within 40 km · updated 6 s ago',
  );
  const aging = aircraftView(
    feed({ status: 'live', feedAgeS: 4, rKm: 40, aircraft: [{}] }),
    at + 90_000,
  );
  assert.equal(aging.status, 'stale');
  assert.match(
    aircraftLine(aging),
    /^STALE aircraft · OpenSky Network · 1 within 40 km · last update 2 min ago$/,
  );
  const gone = aircraftView(
    feed({ status: 'live', feedAgeS: 4, aircraft: [{}] }),
    at + 400_000,
  );
  assert.equal(gone.status, 'unavailable');
  assert.deepEqual(gone.aircraft, []);
  const rec = aircraftView(
    feed({
      status: 'recorded',
      source: 'OpenSky Network',
      feedAt: FEED_S * 1000,
      rKm: 40,
      aircraft: [{}, {}],
    }),
    at,
  );
  const recLine = aircraftLine(rec);
  assert.match(
    recLine,
    /^RECORDED aircraft · OpenSky Network · 2 within 40 km · recorded \d+ Oct \d\d:\d\d UTC$/,
  );
  assert.doesNotMatch(recLine, /LIVE/);
  assert.equal(
    aircraftLine(
      aircraftView(
        feed({ status: 'live', source: 'adsb.lol', feedAgeS: 1, aircraft: [] }),
        at,
      ),
    ),
    'LIVE aircraft · adsb.lol · 0 within 40 km · updated 1 s ago',
  );
  assert.equal(
    aircraftLine(aircraftView({ on: true, data: null }, at)),
    'Aircraft · OpenSky Network · loading',
  );
  assert.equal(aircraftLine(aircraftView({ on: false }, at)), '');
  for (const v of [live, aging, gone, rec])
    assert.doesNotMatch(aircraftLine(v), /sample|fictional/i);
  assert.equal(aircraftTitle({ callsign: null, icao24: '4007f7' }), '4007F7');
  assert.equal(aircraftUrl({ lat: 'x' }), null);
});

test('aircraft sums: carried forward along the track (airborne only, at most 25 s); drawn at altitude plus the geoid, never under the ground; ground aircraft just above it', () => {
  const a = {
    lat: 51.47,
    lon: -0.49,
    altM: 600,
    onGround: false,
    speedMs: 100,
    trackDeg: 90,
    vRateMs: -4,
  };
  const p = extrapolate(a, 10);
  assert.equal(p.lat, 51.47);
  assert.ok(p.lon > -0.49);
  const metres = (p.lon + 0.49) * 111_320 * Math.cos((51.47 * Math.PI) / 180);
  assert.ok(Math.abs(metres - 1000) < 1);
  assert.equal(p.altM, 560);
  const capped = extrapolate(a, 600);
  assert.ok(
    Math.abs(
      (capped.lon + 0.49) * 111_320 * Math.cos((51.47 * Math.PI) / 180) - 2500,
    ) < 1,
  );
  assert.deepEqual(extrapolate({ ...a, onGround: true }, 10), {
    lat: a.lat,
    lon: a.lon,
    altM: 600,
  });
  assert.deepEqual(extrapolate(a, 0), { lat: a.lat, lon: a.lon, altM: 600 });
  // Heights: ellipsoidal frame (ground 70 m at Heathrow, N ≈ 46 m).
  assert.equal(aircraftHeightM(a, 70, 46), 646);
  assert.equal(aircraftHeightM({ onGround: true, altM: null }, 70, 46), 71.5);
  assert.equal(
    aircraftHeightM({ onGround: false, altM: -99 }, 70, 46),
    74,
    'a landing baro reading never goes under the ground',
  );
});

test('aircraft toggle: its own layer, off by default on every role; through the session (remote, All and Reset), a wall’s own sheet, Fitzroy and the relay voice policy', async () => {
  const entry = LAYER_CATALOG.flatMap((g) => g.layers).find(
    (L) => L.key === 'aircraft',
  );
  assert.deepEqual(entry, {
    key: 'aircraft',
    label: 'Live aircraft (adsb.lol · OpenSky)',
    def: false,
  });
  let state = createSession({ count: 6 });
  for (const s of Object.values(state.screens))
    assert.equal(layerValue(s, 'aircraft'), false);
  // The remote, one wall then all.
  state = applyCommand(state, {
    type: 'screens',
    target: 1,
    patch: { layers: { aircraft: true } },
  }).state;
  assert.equal(layerValue(state.screens[1], 'aircraft'), true);
  assert.equal(layerValue(state.screens[2], 'aircraft'), false);
  state = applyCommand(state, {
    type: 'screens',
    target: 'all',
    patch: { layers: { aircraft: true } },
  }).state;
  assert.ok(
    Object.values(state.screens).every((s) => layerValue(s, 'aircraft')),
  );
  // Reset: back to the default (off); the wall turns it off again (twinScreen).
  state = applyCommand(state, { type: 'reset', target: 'all' }).state;
  assert.ok(
    Object.values(state.screens).every((s) => !layerValue(s, 'aircraft')),
  );
  // Through the session host: the remote, and a wall's own L sheet.
  const k = clockHost({ count: 6 });
  k.host.hello({ id: 'r1', kind: 'remote', setup: k.setup, name: 'iPad' });
  k.host.hello({ id: 'w1', kind: 'screen', setup: k.setup, slot: 1 });
  assert.equal(
    confirmed(k.host, 'r1', {
      type: 'screens',
      target: 3,
      patch: { layers: { aircraft: true } },
    }).ok,
    true,
  );
  assert.equal(k.host.state.screens[3].layers.aircraft, true);
  const w = k.host.screenCommand({
    by: 'w1',
    cmd: { type: 'screens', target: 1, patch: { layers: { aircraft: true } } },
  });
  assert.equal(w.ok, true, w.error);
  assert.equal(k.host.state.screens[1].layers.aircraft, true);
  // Fitzroy: "show the planes" is set_screen_layer with layer aircraft (act).
  assert.ok(LAYERS.includes('aircraft'));
  assert.equal(SPOKEN.layer.aircraft, 'live aircraft');
  assert.ok(SPOKEN.layerAlso.aircraft.includes('planes'));
  let fz = createSession({ count: 6 });
  const cat = createFitzroyCatalog({
    twin: {
      state: () => fz,
      now: () => 0,
      lastUndo: () => null,
      incidentOpen: () => false,
      tripDays: () => 3,
      reportedFloor: () => null,
      names: { person: () => null, place: () => null, placeWord: () => null },
    },
  });
  const show = await cat.propose('set_screen_layer', {
    screen: 'all',
    layer: 'aircraft',
    on: true,
  });
  assert.equal(show.tier, 'act');
  assert.deepEqual(show.message.cmd, {
    type: 'screens',
    target: 'all',
    patch: { layers: { aircraft: true } },
  });
  assert.equal(show.say, 'Every screen: live aircraft on.');
  const hide = await cat.propose('set_screen_layer', {
    screen: '1',
    layer: 'aircraft',
    on: false,
  });
  fz = applyCommand(fz, show.message.cmd).state;
  assert.equal(hide.say, 'Screen 1, Site: live aircraft off.');
  // The relay's voice table lets it through as act (Tier A), for one and all.
  for (const cmd of [show.message.cmd, hide.message.cmd]) {
    const v = voiceVerdict({
      voice: { intent: 'set_screen_layer' },
      msg: { t: 'cmd', cmd },
      state: fz,
      controller: true,
      logOk: true,
    });
    assert.equal(v.ok, true, v.reason);
    assert.equal(v.tier, 'act');
  }
});

// Jesse, 29 Oct: anonymous OpenSky showed three planes at Heathrow where
// adsb.lol saw many more, and adsb.lol also reports airport vehicles.
const pointBody = (now, rows) => JSON.stringify({ now: now * 1000, ac: rows });
const row = (hex, flight, extra = {}) => ({
  hex,
  flight,
  lat: 51.4705,
  lon: -0.4877,
  alt_baro: 'ground',
  seen_pos: 1,
  seen: 1,
  ...extra,
});

test('aircraft: adsb.lol around the point is asked first; OpenSky only when it fails', async () => {
  const t = 1_793_316_600;
  const calls = [];
  const air = createTwinAircraft({
    now: () => t * 1000,
    point: async () => {
      calls.push('point');
      return {
        ok: true,
        text: async () =>
          pointBody(t, [
            row('40688c', 'BAW57K', { category: 'A5', t: 'B77W' }),
            row('43c001', 'SQUID32', { category: 'C2' }),
            row('43c002', '', { t: 'TWR' }),
            row('43c003', 'AOPS', { category: 'C2', t: 'SERV' }),
          ]),
      };
    },
    upstream: async () => {
      calls.push('upstream');
      return { ok: false, status: 503, text: async () => '' };
    },
  });
  const a = await air.near(51.4723, -0.4885, 40);
  assert.deepEqual(calls, ['point']);
  assert.equal(a.source, 'adsb.lol');
  assert.equal(a.status, 'live');
  assert.deepEqual(
    a.aircraft.map((x) => x.callsign),
    ['BAW57K'],
    'vehicles and the tower are not aircraft',
  );

  const failing = createTwinAircraft({
    now: () => t * 1000,
    point: async () => ({ ok: false, status: 429, text: async () => '' }),
    upstream: async () => ({
      ok: true,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          time: t,
          states: [
            [
              '4bb203',
              'THY8EF',
              'Turkey',
              t,
              t,
              -0.4469,
              51.4704,
              null,
              true,
              0,
              270,
              null,
              null,
              null,
              null,
              false,
              0,
              0,
            ],
            [
              '43c009',
              'TUG1',
              'United Kingdom',
              t,
              t,
              -0.47,
              51.47,
              null,
              true,
              0,
              0,
              null,
              null,
              null,
              null,
              false,
              0,
              17,
            ],
          ],
        }),
    }),
  });
  const b = await failing.near(51.4723, -0.4885, 40);
  assert.equal(b.source, 'OpenSky Network');
  assert.deepEqual(
    b.aircraft.map((x) => x.callsign),
    ['THY8EF'],
  );
});

test('aircraft: vehicle rows are recognised by category and type', () => {
  assert.equal(isAdsbLolVehicle({ category: 'C1' }), true);
  assert.equal(isAdsbLolVehicle({ category: 'c3' }), true);
  assert.equal(isAdsbLolVehicle({ t: 'SERV' }), true);
  assert.equal(isAdsbLolVehicle({ t: 'twr' }), true);
  assert.equal(isAdsbLolVehicle({ category: 'A3', t: 'A21N' }), false);
  assert.equal(isAdsbLolVehicle({}), false);
});
