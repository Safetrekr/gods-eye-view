// Trip Twin weather proxy (prototype, dev server only). Two endpoints:
//   /api/twin-weather/now?lat=&lon=       MET Norway Locationforecast 2.0 (complete)
//   /api/twin-weather/warnings?country=uk&area=London   MeteoAlarm Atom → JSON
// MET Norway requires an identifying User-Agent and asks browsers not to call
// it directly; MeteoAlarm sends no CORS headers. Image layers (IEM, nowCOAST,
// EUMETView) and NWS alerts are CORS-open and are fetched by the browser.
// Licences: plans/trip-twin/WEATHER-SOURCES.md.
// Phase CF K3: behind the Trip Twin Host guard (twinHosts.js): cross-site
// GETs get 403, so no other page can spend the upstream quotas (sec N7),
// and a Host the new allowlist would refuse is recorded (report, S-11).
import { hostCheckFor } from './twinHostCheck.js';
import { twinHostGuard } from './twinHosts.js';

const UA = 'SafeTrekr-TripTwin-prototype/0.1 (+https://safetrekr.com)';
const MET_TTL_MS = 10 * 60 * 1000;
const ALARM_TTL_MS = 5 * 60 * 1000;
const FEEDS = { uk: 'meteoalarm-legacy-atom-united-kingdom' };

const cache = new Map();

async function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return { ...hit.value, cached: true };
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

function send(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

/** Round to ~1 km so the cache is shared and no precise point leaves the server. */
const coarse = (v) => Math.round(Number(v) * 100) / 100;

export async function fetchMetNow(lat, lon, fetchImpl = fetch) {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${coarse(lat)}&lon=${coarse(lon)}`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`MET Norway HTTP ${res.status}`);
  const json = await res.json();
  return {
    ok: true,
    source: 'MET Norway',
    credit: 'Data from MET Norway (CC BY 4.0)',
    fetchedAt: new Date().toISOString(),
    json,
  };
}

/** Minimal Atom/CAP reader: one object per <entry>. */
export function parseMeteoAlarmAtom(xml) {
  const pick = (block, tag) => {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
    return m ? m[1].trim() : null;
  };
  const entries = [];
  for (const m of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const b = m[1];
    entries.push({
      title: pick(b, 'title'),
      event: pick(b, 'cap:event'),
      severity: pick(b, 'cap:severity'),
      certainty: pick(b, 'cap:certainty'),
      area: pick(b, 'cap:areaDesc'),
      onset: pick(b, 'cap:onset'),
      expires: pick(b, 'cap:expires'),
      awarenessLevel: pick(b, 'cap:awareness_level'),
    });
  }
  return entries;
}

export async function fetchMeteoAlarm(country, fetchImpl = fetch) {
  const feed = FEEDS[country];
  if (!feed) throw new Error(`No MeteoAlarm feed for ${country}`);
  const res = await fetchImpl(`https://feeds.meteoalarm.org/feeds/${feed}`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`MeteoAlarm HTTP ${res.status}`);
  return {
    ok: true,
    source: 'MeteoAlarm',
    credit:
      'MeteoAlarm.org (terms equivalent to CC BY 4.0; redistribution terms not yet verified)',
    fetchedAt: new Date().toISOString(),
    entries: parseMeteoAlarmAtom(await res.text()),
  };
}

export function twinWeatherProxy({ fetchImpl = fetch } = {}) {
  return {
    name: 'safetrekr-trip-twin-weather',
    configureServer(server) {
      server.middlewares.use(
        '/api/twin-weather',
        twinHostGuard({ check: hostCheckFor(server) }),
      );
      server.middlewares.use('/api/twin-weather', async (req, res) => {
        if (req.method !== 'GET') return send(res, 405, { ok: false });
        const url = new URL(req.url, 'http://local');
        try {
          if (url.pathname === '/now') {
            const lat = Number(url.searchParams.get('lat'));
            const lon = Number(url.searchParams.get('lon'));
            if (!Number.isFinite(lat) || !Number.isFinite(lon))
              return send(res, 400, { ok: false, error: 'lat/lon required' });
            return send(
              res,
              200,
              await cached(
                `met:${coarse(lat)},${coarse(lon)}`,
                MET_TTL_MS,
                () => fetchMetNow(lat, lon, fetchImpl),
              ),
            );
          }
          if (url.pathname === '/warnings') {
            const country = url.searchParams.get('country') || 'uk';
            const area = (url.searchParams.get('area') || '').toLowerCase();
            const all = await cached(`alarm:${country}`, ALARM_TTL_MS, () =>
              fetchMeteoAlarm(country, fetchImpl),
            );
            return send(res, 200, {
              ...all,
              entries: area
                ? all.entries.filter((e) =>
                    String(e.area || '')
                      .toLowerCase()
                      .includes(area),
                  )
                : all.entries,
            });
          }
          return send(res, 404, { ok: false, error: 'unknown endpoint' });
        } catch (error) {
          return send(res, 503, {
            ok: false,
            error: String(error?.message || error),
          });
        }
      });
    },
  };
}
