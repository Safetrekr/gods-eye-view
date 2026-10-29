// Trip Twin live aircraft (Jesse, 29 Oct 2026), dev server only. A small room
// cache over upstream's own flights route (server/providers/aircraft/
// opensky.js: OpenSky states/all, ~1.6 MB worldwide, with its adsb.lol point
// fallback and rate-limit cooldowns), reached over loopback HTTP so none of
// that code changes:
//   GET /api/twin-aircraft?lat=&lon=&r=   aircraft within r km (default 40, max 80)
// Six walls, the All-in-one and the remote may all poll; upstream is read at
// most once per 10 s for the whole room, parsed once, and each answer is only
// the aircraft near the asked point (a few kB). A failed read keeps the last
// good snapshot, marked stale with its age, for at most five minutes; then
// the answer is "unavailable" with no aircraft, never old planes passed off
// as current. TRIP_TWIN_AIRCRAFT=fixture serves a recorded OpenSky snapshot
// (scripts/fixtures/trip-twin/aircraft/) and never uses the network: its
// status is 'recorded', never 'live'.
import { readFileSync } from 'node:fs';
import { normalizeAdsbLolPointResponse } from '../../src/data/adsbLolFallback.js';
import { hostCheckFor } from './twinHostCheck.js';
import { twinHostGuard } from './twinHosts.js';

/** Upstream is read at most this often for the whole room. */
export const AIRCRAFT_FRESH_MS = 10e3;
/** A snapshot older than this (feed time) is 'stale'. */
export const AIRCRAFT_STALE_AFTER_S = 60;
/** The last good snapshot is kept this long after reads start failing. */
export const AIRCRAFT_KEEP_MS = 5 * 60e3;
export const AIRCRAFT_R_DEFAULT_KM = 40;
export const AIRCRAFT_R_MAX_KM = 80;
/** At most this many aircraft per answer, nearest first. */
export const AIRCRAFT_MAX = 150;
/** A position older than this at the snapshot is not drawn. */
export const POSITION_MAX_AGE_S = 60;
const FETCH_TIMEOUT_MS = 15e3;
const REGIONAL_MAX = 8;
export const AIRCRAFT_FIXTURE = new URL(
  '../../scripts/fixtures/trip-twin/aircraft/heathrow-opensky.json',
  import.meta.url,
);

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
export function kmBetween(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return (2 * R * Math.asin(Math.min(1, Math.sqrt(h)))) / 1000;
}
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, d = 0) => (fin(v) ? Number(v.toFixed(d)) : null);
const ICAO_RE = /^~?[0-9a-z]{6}$/;
/**
 * Airport vehicles and obstacles carry transponders too (tugs, ops cars,
 * the tower's vehicles): not aircraft, never drawn as planes. adsb.lol:
 * emitter category C* (surface vehicle or obstacle) or type TWR/SERV/GND;
 * OpenSky: category 16-20.
 */
const VEHICLE_TYPES = new Set(['TWR', 'SERV', 'GND']);
export const isAdsbLolVehicle = (row) =>
  /^C/i.test(String(row?.category || '').trim()) ||
  VEHICLE_TYPES.has(
    String(row?.t || '')
      .trim()
      .toUpperCase(),
  );

/**
 * An OpenSky body ({time, states}) → {feedAt ms, states}; null when it is
 * not one (an error body, HTML, a missing clock).
 */
export function parseFlights(body) {
  let json = body;
  if (typeof body === 'string') {
    try {
      json = JSON.parse(body);
    } catch {
      return null;
    }
  }
  const time = Number(json?.time);
  if (!Number.isFinite(time) || time <= 0) return null;
  if (json.states !== null && !Array.isArray(json.states)) return null;
  return { feedAt: time * 1000, states: json.states || [] };
}

/**
 * The aircraft within rKm of center, nearest first, trimmed to what the
 * layer draws. State vector: [icao24, callsign, origin_country,
 * time_position, last_contact, lon, lat, baro_altitude, on_ground, velocity,
 * true_track, vertical_rate, sensors, geo_altitude, squawk, spi,
 * position_source, category]. Ages are seconds before the snapshot time
 * (feedS); a position older than POSITION_MAX_AGE_S is left out.
 */
export function nearbyAircraft(states, center, rKm, feedS, max = AIRCRAFT_MAX) {
  const out = [];
  const seen = new Set();
  for (const s of Array.isArray(states) ? states : []) {
    if (!Array.isArray(s)) continue;
    const lon = s[5];
    const lat = s[6];
    if (!fin(lat) || !fin(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      continue;
    const icao24 = String(s[0] || '')
      .trim()
      .toLowerCase();
    if (!ICAO_RE.test(icao24) || seen.has(icao24)) continue;
    if (fin(s[17]) && s[17] >= 16 && s[17] <= 20) continue;
    const posT = fin(s[3]) ? s[3] : fin(s[4]) ? s[4] : null;
    const posAgeS = posT === null ? null : feedS - posT;
    if (posAgeS === null || posAgeS > POSITION_MAX_AGE_S) continue;
    const dKm = kmBetween(center, { lat, lon });
    if (dKm > rKm) continue;
    seen.add(icao24);
    const callsign =
      String(s[1] || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '')
        .slice(0, 8) || null;
    const onGround = s[8] === true;
    const alt = fin(s[7]) ? s[7] : fin(s[13]) ? s[13] : null;
    out.push({
      icao24,
      callsign,
      lat: round(lat, 5),
      lon: round(lon, 5),
      altM: onGround ? null : round(alt),
      onGround,
      speedMs: round(s[9], 1),
      trackDeg: round(s[10], 1),
      vRateMs: round(s[11], 1),
      posAgeS: Math.max(0, Math.round(posAgeS)),
      ageS: fin(s[4]) ? Math.max(0, Math.round(feedS - s[4])) : null,
      dKm: round(dKm, 1),
    });
  }
  out.sort((a, b) => a.dKm - b.dKm);
  return out.slice(0, max);
}

/** A radius from the query: default 40 km, at most 80, at least 1. */
export function radiusKm(value) {
  if (value === null || value === undefined || value === '')
    return AIRCRAFT_R_DEFAULT_KM;
  const r = Number(value);
  if (!Number.isFinite(r)) return null;
  return Math.max(1, Math.min(AIRCRAFT_R_MAX_KM, r));
}

const regionKey = (lat, lon) =>
  `${(Math.round(lat * 4) / 4).toFixed(2)},${(Math.round(lon * 4) / 4).toFixed(2)}`;

/** adsb.lol's point query, in nautical miles: covers the 80 km maximum. */
export const ADSBLOL_POINT_NM = Math.ceil(AIRCRAFT_R_MAX_KM / 1.852);

/**
 * The room's aircraft cache. point(lat, lon, init) → fetch Response from
 * adsb.lol's free point query, asked first: around a site it sees more
 * aircraft than anonymous OpenSky (ground traffic at the stands too) and
 * has no daily quota to run out (Jesse, 29 Oct: three planes at Heathrow
 * where adsb.lol saw seventeen). upstream(path, init) → fetch Response from
 * this server's own /api/flights, the fallback when the point query fails.
 * fixture: a recorded body (served as 'recorded', never fetched).
 */
export function createTwinAircraft({
  upstream,
  point = null,
  fixture = null,
  now = () => Date.now(),
} = {}) {
  // The worldwide OpenSky snapshot answers every point; an adsb.lol point
  // fallback (upstream's, when OpenSky is down) only the points near it.
  let global = null; // {at, feedAt, states, source}
  const regional = new Map(); // regionKey → snapshot
  const failedAt = new Map(); // regionKey → last failed read (ms)
  const inflight = new Map();
  let reads = 0;
  const fx = fixture ? parseFlights(fixture) : null;

  function best(key) {
    const r = regional.get(key);
    if (!global) return r || null;
    if (!r) return global;
    return r.at > global.at ? r : global;
  }

  function keepRegional(key, snap) {
    regional.delete(key);
    regional.set(key, snap);
    while (regional.size > REGIONAL_MAX)
      regional.delete(regional.keys().next().value);
  }

  /** adsb.lol around the point; null when it fails or is not a snapshot. */
  async function readPoint(lat, lon, signal) {
    if (!point) return null;
    try {
      const res = await point(lat, lon, { signal });
      if (!res.ok) return null;
      const payload = JSON.parse(await res.text());
      const ac = Array.isArray(payload?.ac) ? payload.ac : [];
      const parsed = parseFlights(
        normalizeAdsbLolPointResponse({
          ...payload,
          ac: ac.filter((row) => !isAdsbLolVehicle(row)),
        }),
      );
      return parsed
        ? {
            at: now(),
            feedAt: parsed.feedAt,
            states: parsed.states,
            source: 'adsb.lol',
          }
        : null;
    } catch {
      return null;
    }
  }

  async function read(lat, lon, key) {
    reads += 1;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const near = await readPoint(lat, lon, ctl.signal);
      if (near) {
        keepRegional(key, near);
        failedAt.delete(key);
        return near;
      }
      const q = `lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`;
      const res = await upstream(`/api/flights?${q}`, { signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseFlights(await res.text());
      if (!parsed) throw new Error('not a flights snapshot');
      const fallback =
        String(res.headers?.get?.('x-flight-source') || '').toLowerCase() ===
        'adsb.lol';
      const snap = {
        at: now(),
        feedAt: parsed.feedAt,
        states: parsed.states,
        source: fallback ? 'adsb.lol' : 'OpenSky Network',
      };
      if (fallback) keepRegional(key, snap);
      else global = snap;
      failedAt.delete(key);
      return snap;
    } catch {
      failedAt.set(key, now());
      return best(key);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The snapshot for a point: cached, or one read for the whole room. */
  async function snapshot(lat, lon) {
    if (fx) return { at: now(), ...fx, source: 'OpenSky Network' };
    const key = regionKey(lat, lon);
    const have = best(key);
    const t = now();
    if (have && t - have.at < AIRCRAFT_FRESH_MS) return have;
    // A failed read is not repeated for the room within 10 s.
    if (t - (failedAt.get(key) ?? -Infinity) < AIRCRAFT_FRESH_MS) return have;
    if (inflight.has(key)) return inflight.get(key);
    const p = read(lat, lon, key).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  /** {status, source, servedAt, feedAt, feedAgeS, staleS, rKm, count, aircraft}. */
  async function near(lat, lon, rKm = AIRCRAFT_R_DEFAULT_KM) {
    const snap = await snapshot(lat, lon);
    const t = now();
    const base = { center: { lat, lon }, rKm, servedAt: t };
    // Kept for a bounded time only: after that, none rather than old.
    if (
      !snap ||
      (!fx &&
        (t - snap.at > AIRCRAFT_KEEP_MS || t - snap.feedAt > AIRCRAFT_KEEP_MS))
    )
      return {
        ...base,
        status: 'unavailable',
        source: snap?.source || null,
        feedAt: snap?.feedAt ?? null,
        feedAgeS: snap ? Math.round((t - snap.feedAt) / 1000) : null,
        staleS: snap ? Math.round((t - snap.feedAt) / 1000) : null,
        count: 0,
        aircraft: [],
      };
    const feedAgeS = Math.max(0, Math.round((t - snap.feedAt) / 1000));
    const status = fx
      ? 'recorded'
      : feedAgeS > AIRCRAFT_STALE_AFTER_S
        ? 'stale'
        : 'live';
    const aircraft = nearbyAircraft(
      snap.states,
      { lat, lon },
      rKm,
      snap.feedAt / 1000,
    );
    return {
      ...base,
      status,
      source: snap.source,
      feedAt: snap.feedAt,
      // A recording's age is not news: its time is said instead.
      feedAgeS: fx ? null : feedAgeS,
      staleS: status === 'stale' ? feedAgeS : 0,
      count: aircraft.length,
      aircraft,
    };
  }

  return { near, stats: () => ({ reads, regional: regional.size }) };
}

// ---------------------------------------------------------------- HTTP

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

export function readAircraftFixture(file = AIRCRAFT_FIXTURE) {
  return JSON.parse(readFileSync(file, 'utf8')).response;
}

export function twinAircraftProxy({ env = process.env, service = null } = {}) {
  return {
    name: 'safetrekr-trip-twin-aircraft',
    configureServer(server) {
      const port = () =>
        server.httpServer?.address?.()?.port || server.config?.server?.port;
      const air =
        service ||
        createTwinAircraft({
          fixture:
            env.TRIP_TWIN_AIRCRAFT === 'fixture' ? readAircraftFixture() : null,
          upstream: (p, init = {}) =>
            // localhost, not 127.0.0.1: Vite may listen on ::1 only.
            fetch(`http://localhost:${port()}${p}`, {
              ...init,
              headers: { Via: '1.1 trip-twin', Host: `localhost:${port()}` },
            }),
          point: (lat, lon, init = {}) =>
            fetch(
              `https://api.adsb.lol/v2/lat/${lat.toFixed(2)}/lon/${lon.toFixed(2)}/dist/${ADSBLOL_POINT_NM}`,
              {
                ...init,
                headers: {
                  Accept: 'application/json',
                  'User-Agent': 'safetrekr-trip-twin-aircraft/1.0',
                },
              },
            ),
        });
      server.middlewares.use(
        '/api/twin-aircraft',
        twinHostGuard({ check: hostCheckFor(server) }),
      );
      server.middlewares.use('/api/twin-aircraft', async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { ok: false });
        const url = new URL(req.url, 'http://local');
        if (url.pathname !== '/')
          return sendJson(res, 404, { ok: false, error: 'unknown endpoint' });
        const q = url.searchParams;
        const lat = Number(q.get('lat'));
        const lon = Number(q.get('lon'));
        const r = radiusKm(q.get('r'));
        if (
          !q.get('lat') ||
          !q.get('lon') ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          Math.abs(lat) > 90 ||
          Math.abs(lon) > 180 ||
          r === null
        )
          return sendJson(res, 400, { ok: false, error: 'query' });
        try {
          return sendJson(res, 200, await air.near(lat, lon, r));
        } catch (error) {
          return sendJson(res, 502, {
            ok: false,
            error: String(error?.message || error).slice(0, 80),
          });
        }
      });
    },
  };
}
