// Trip Twin custom paths (phase 4): POST /api/twin-path → FOSSGIS Valhalla,
// which honours waypoints (through-locations) and avoid-areas
// (exclude_polygons). Dev-server prototype only; production needs its own
// routing service (07-production-delta, phase 4). Fair use: one request per
// operator action, cached. Phase CF K3: both endpoints sit behind the Trip
// Twin Host guard (twinHosts.js): cross-site requests get 403, and a Host
// the new allowlist would refuse is recorded (report mode, S-11).
import { hostCheckFor } from './twinHostCheck.js';
import { twinHostGuard } from './twinHosts.js';

const UA = 'SafeTrekr-TripTwin-prototype/0.1 (+https://safetrekr.com)';
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

/** Valhalla polyline6 → [{lat, lon}]. */
export function decodePolyline6(str) {
  const out = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let shift = 0;
      let result = 0;
      let b;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lon += delta;
    }
    out.push({ lat: lat / 1e6, lon: lon / 1e6 });
  }
  return out;
}

/** Validate and build a Valhalla request from the client body. */
export function valhallaRequest(body) {
  const pts = Array.isArray(body?.points) ? body.points : [];
  if (pts.length < 2 || pts.length > 12) throw new Error('2–12 points needed');
  for (const p of pts)
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon))
      throw new Error('bad point');
  const costing = body.profile === 'car' ? 'auto' : 'pedestrian';
  const avoid = (Array.isArray(body.avoid) ? body.avoid : [])
    .slice(0, 20)
    .map((ring) => ring.map((p) => [p.lon, p.lat]));
  return {
    locations: pts.map((p, i) => ({
      lat: p.lat,
      lon: p.lon,
      type: i === 0 || i === pts.length - 1 ? 'break' : 'through',
    })),
    costing,
    ...(avoid.length ? { exclude_polygons: avoid } : {}),
    directions_options: { units: 'kilometers' },
  };
}

function send(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64 * 1024) throw new Error('body too large');
  }
  return JSON.parse(raw || '{}');
}

// Street names for operator waypoints (phase 4 deferred): Nominatim reverse,
// used only when the site's own OpenStreetMap streets don't reach the point.
// Fair use: at most one request a second, cached by ~10 m cell.
const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const placeCache = new Map();
let nextSlot = 0;

/** Nominatim reverse json → {ok, name} (street, else the place name). */
export function placeFromNominatim(json) {
  const a = json?.address || {};
  const name =
    a.road || a.pedestrian || a.footway || a.square || json?.name || null;
  return name ? { ok: true, name } : { ok: false, error: 'no street here' };
}

export function twinRoutingProxy({ fetchImpl = fetch } = {}) {
  return {
    name: 'safetrekr-trip-twin-routing',
    configureServer(server) {
      const guard = twinHostGuard({ check: hostCheckFor(server) });
      server.middlewares.use('/api/twin-place', guard);
      server.middlewares.use('/api/twin-path', guard);
      server.middlewares.use('/api/twin-place', async (req, res) => {
        try {
          const q = new URL(req.url, 'http://x').searchParams;
          const lat = Number(q.get('lat'));
          const lon = Number(q.get('lon'));
          if (!Number.isFinite(lat) || !Number.isFinite(lon))
            return send(res, 400, { ok: false, error: 'bad point' });
          const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
          const hit = placeCache.get(key);
          if (hit) return send(res, 200, { ...hit, cached: true });
          const wait = Math.max(0, nextSlot - Date.now());
          nextSlot = Date.now() + wait + 1100;
          if (wait) await new Promise((r) => setTimeout(r, wait));
          const r = await fetchImpl(
            `${NOMINATIM}?format=jsonv2&zoom=17&addressdetails=1&lat=${lat}&lon=${lon}`,
            {
              headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
              signal: AbortSignal.timeout(10000),
            },
          );
          const value = r.ok
            ? {
                ...placeFromNominatim(await r.json()),
                credit:
                  'Street names: Nominatim · © OpenStreetMap contributors',
              }
            : { ok: false, error: `Nominatim HTTP ${r.status}` };
          placeCache.set(key, value);
          if (placeCache.size > 500)
            placeCache.delete(placeCache.keys().next().value);
          return send(res, 200, value);
        } catch (error) {
          return send(res, 200, {
            ok: false,
            error: String(error?.message || error),
          });
        }
      });
      server.middlewares.use('/api/twin-path', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { ok: false });
        try {
          const request = valhallaRequest(await readJson(req));
          const key = JSON.stringify(request);
          const hit = cache.get(key);
          if (hit && Date.now() - hit.at < TTL_MS)
            return send(res, 200, { ...hit.value, cached: true });
          const r = await fetchImpl(VALHALLA, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(20000),
          });
          const json = await r.json().catch(() => null);
          // 200 with ok:false: the client falls back and explains why.
          if (!r.ok || !json?.trip)
            return send(res, 200, {
              ok: false,
              error: json?.error || `Valhalla HTTP ${r.status}`,
            });
          const geometry = json.trip.legs.flatMap((leg, i) => {
            const pts = decodePolyline6(leg.shape);
            return i === 0 ? pts : pts.slice(1);
          });
          const value = {
            ok: true,
            engine: 'valhalla',
            distanceM: Math.round(json.trip.summary.length * 1000),
            durationS: Math.round(json.trip.summary.time),
            geometry,
            credit:
              'Routing: Valhalla on FOSSGIS servers · map data © OpenStreetMap contributors',
          };
          cache.set(key, { at: Date.now(), value });
          if (cache.size > 200) cache.delete(cache.keys().next().value);
          return send(res, 200, value);
        } catch (error) {
          return send(res, 400, {
            ok: false,
            error: String(error?.message || error),
          });
        }
      });
    },
  };
}
