// Trip Twin traffic cameras (review/traffic-cameras T5), dev server only. A
// thin proxy over upstream's own CCTV routes (server/providers/cctv.js),
// reached over loopback HTTP so none of that code changes:
//   /api/twin-cameras/near?lat=&lon=&r=500|1000   cameras near a point
//   /api/twin-cameras/frame?id=                    one still, shared by the room
// Upstream's /frame keeps no cache: seven wall windows would each ask the
// agency (Austin, TfL) on every refresh. Here each camera is fetched at most
// every 15 s for the whole room, two at a time, with a backoff. The loopback
// call carries a Via header, so upstream never falls back to Street View
// (no Google key spend); only frames upstream marks `upstream-image` are
// relayed — Street View, synthetic and placeholder frames are never shown
// as a camera. TRIP_TWIN_CAMERAS=fixture never uses the network.
import crypto from 'node:crypto';
import sharp from 'sharp';
import { createLimiter } from '../../src/layers/streetLevel/limiter.js';
import { hostCheckFor } from './twinHostCheck.js';
import { twinHostGuard } from './twinHosts.js';

const SOURCES_TTL_MS = 10 * 60e3;
const FRAME_FRESH_MS = 15e3;
const FRAME_TIMEOUT_MS = 10e3;
const BACKOFF_MAX_MS = 4 * 60e3;
const FRAME_MAX_W = 960;
const RADII = [500, 1000];
const ID_RE = /^[\w:.-]{1,96}$/;
/** Placeholder frames some agencies send as a 200 ("Image Unavailable"). */
const PLACEHOLDER_SIZES = new Set(['320x176']);

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
export function metresBetween(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const offset = (p, bearing, m) => ({
  lat: p.lat + (m * Math.cos(rad(bearing))) / 111_320,
  lon: p.lon + (m * Math.sin(rad(bearing))) / (111_320 * Math.cos(rad(p.lat))),
});

export class CameraError extends Error {
  constructor(message, { status = 502 } = {}) {
    super(message);
    this.status = status;
  }
}

/** still · clip · live, from upstream's feedType (its playbackKind says clip for stills). */
export function cameraKind(feedType) {
  const f = String(feedType || '').toLowerCase();
  if (f === 'hls' || f === 'mjpeg') return 'live';
  if (f === 'mp4' || f === 'webm') return 'clip';
  return 'still';
}

/** One upstream record, trimmed: a heading only when upstream trusts it. */
export function trimCamera(c, here) {
  return {
    id: String(c.id),
    name: String(c.name || c.id),
    pack: c.pack || null,
    provider: c.provider || null,
    city: c.city || null,
    lat: c.lat,
    lon: c.lon,
    d: Math.round(metresBetween(here, c)),
    kind: cameraKind(c.feedType),
    heading:
      c.headingConfidence === 'high' && Number.isFinite(c.headingDeg)
        ? c.headingDeg
        : null,
    license: c.license || null,
    credit: c.credit || null,
  };
}

// ---------------------------------------------------------------- fixtures

/** Canned cameras: near a US point (not DC) two Austin stills, near a European point one TfL clip, near DC none. */
export function fixtureCameras({ lat, lon }) {
  const here = { lat, lon };
  if (lat > 38.8 && lat < 39 && lon > -77.1 && lon < -76.9) return [];
  if (lon > -30)
    return [
      {
        id: 'fx-tfl-1',
        name: 'Test camera (fixture) · London',
        pack: 'fixture',
        provider: 'Test fixture',
        ...offset(here, 200, 87),
        feedType: 'mp4',
        headingConfidence: 'low',
        headingDeg: 202.5,
        license: 'Test image, not a camera',
      },
    ];
  return [63, 183].map((m, i) => ({
    id: `fx-austin-${i + 1}`,
    name: `Test camera ${i + 1} (fixture)`,
    pack: 'fixture',
    provider: 'Test fixture',
    ...offset(here, 120 + i * 30, m),
    feedType: 'image',
    headingConfidence: 'low',
    headingDeg: 315,
    license: 'Test image, not a camera',
  }));
}

async function fixtureFrame(id) {
  const W = 640;
  const H = 360;
  const data = Buffer.alloc(W * H * 3);
  const seed = [...id].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const road = y > H * 0.55;
      data[o] = road ? 70 : 120 + (seed % 40);
      data[o + 1] = road ? 72 : 140;
      data[o + 2] = road ? 75 : 170;
    }
  return sharp(data, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 80 })
    .toBuffer();
}

// ---------------------------------------------------------------- the proxy

/**
 * upstream(path) → fetch Response from this server's own /api/cctv routes.
 */
export function createTrafficCameras({
  upstream,
  fixture = false,
  now = () => Date.now(),
} = {}) {
  let sources = null; // {at, list, byId}
  let sourcesLoad = null;
  const frames = new Map(); // id → {at, jpg, hash, sameSince}
  const failed = new Map(); // id → {until, streak}
  const inflight = new Map();
  const limiter = createLimiter(2);
  const once = (key, load) => {
    if (inflight.has(key)) return inflight.get(key);
    const p = load().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };

  async function catalog() {
    if (fixture) return null;
    if (sources && now() - sources.at < SOURCES_TTL_MS) return sources;
    sourcesLoad ??= (async () => {
      try {
        const res = await upstream('/api/cctv/sources');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        // Real cameras only: never World View's seeds (every-time P2-7).
        const list = (json.sources || []).filter(
          (c) =>
            Number.isFinite(c.lat) &&
            Number.isFinite(c.lon) &&
            c.sourceKind !== 'fallback',
        );
        // Every pack failing reads as an empty list: that is "unavailable",
        // never "none nearby" (AIA round 1); asked again in a minute.
        if (!list.length) throw new Error('empty camera list');
        sources = {
          at: now(),
          // Upstream keeps the 250 nearest of a big pack (Austin, TfL): a
          // "none" there is "none among those loaded" (every-time P1-6).
          trimmed: Object.keys(json.trimmedPacks || {}).length > 0,
          list,
          byId: new Map(list.map((c) => [String(c.id), c])),
        };
      } catch {
        // Keep the last list; none at all is "unavailable". A failed load
        // is retried after a minute, not after ten.
        if (sources)
          sources.at = Math.min(sources.at, now() - SOURCES_TTL_MS + 60e3);
      } finally {
        sourcesLoad = null;
      }
      return sources;
    })();
    return sourcesLoad;
  }

  /** Cameras within r metres, nearest first (at most 8). */
  async function near(lat, lon, r = 500) {
    const here = { lat, lon };
    if (fixture) {
      const cams = fixtureCameras(here)
        .map((c) => trimCamera(c, here))
        .filter((c) => c.d <= r);
      return {
        status: 'ok',
        servedAt: now(),
        trimmed: false,
        nearestM: cams[0]?.d ?? null,
        cameras: cams,
      };
    }
    const cat = await catalog();
    if (!cat) return { status: 'unavailable', servedAt: now(), cameras: [] };
    const all = cat.list
      .map((c) => [metresBetween(here, c), c])
      .sort((a, b) => a[0] - b[0]);
    const cams = all
      .filter(([d]) => d <= r)
      .slice(0, 8)
      .map(([, c]) => trimCamera(c, here));
    return {
      status: 'ok',
      servedAt: cat.at,
      trimmed: cat.trimmed,
      // How far the nearest listed camera is: "no camera source here"
      // when it is another region (Washington: 121 km).
      nearestM: all.length ? Math.round(all[0][0]) : null,
      cameras: cams,
    };
  }

  /** One still for the room: {jpg, fetchedAt, sameSince}. */
  async function frame(id) {
    if (!ID_RE.test(id || '')) throw new CameraError('bad id', { status: 400 });
    if (!fixture) {
      const cat = await catalog();
      // Upstream answers an unknown id with 200 and a drawing: never here.
      if (!cat?.byId.has(id))
        throw new CameraError('unknown camera', { status: 404 });
    } else if (!/^fx-/.test(id))
      throw new CameraError('unknown camera', { status: 404 });
    const hit = frames.get(id);
    if (hit && now() - hit.at < FRAME_FRESH_MS) return hit;
    const f = failed.get(id);
    if (f && now() < f.until) {
      // The last picture, marked stale: never passed off as current
      // (every-time P0-1).
      if (hit) return { ...hit, stale: true };
      throw new CameraError('not answering', { status: 503 });
    }
    return once(id, () =>
      limiter.run(async () => {
        try {
          const raw = fixture ? await fixtureFrame(id) : await fetchFrame(id);
          const meta = await sharp(raw).metadata();
          if (PLACEHOLDER_SIZES.has(`${meta.width}x${meta.height}`))
            throw new CameraError('placeholder image', { status: 502 });
          const jpg = await sharp(raw)
            .resize(FRAME_MAX_W, FRAME_MAX_W, {
              fit: 'inside',
              withoutEnlargement: true,
            })
            .jpeg({ quality: 80 })
            .toBuffer();
          const hash = crypto.createHash('sha1').update(raw).digest('hex');
          const sameSince = hit && hit.hash === hash ? hit.sameSince : now();
          const out = { at: now(), jpg, hash, sameSince };
          frames.set(id, out);
          failed.delete(id);
          return out;
        } catch (error) {
          const streak = (failed.get(id)?.streak || 0) + 1;
          failed.set(id, {
            streak,
            until: now() + Math.min(BACKOFF_MAX_MS, 30e3 * 2 ** (streak - 1)),
          });
          if (hit) return { ...hit, stale: true };
          if (error instanceof CameraError) throw error;
          throw new CameraError('not answering', { status: 503 });
        }
      }),
    );
  }

  async function fetchFrame(id) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FRAME_TIMEOUT_MS);
    try {
      const res = await upstream(`/api/cctv/frame/${encodeURIComponent(id)}`, {
        signal: ctl.signal,
      });
      // Only a real camera image: never Street View or a drawing.
      if (res.headers.get('x-cctv-source') !== 'upstream-image')
        throw new CameraError('not a camera image', { status: 502 });
      if (!res.ok) throw new CameraError(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }

  return { near, frame, catalog };
}

// ---------------------------------------------------------------- HTTP

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

export function twinCameraProxy({ env = process.env, service = null } = {}) {
  return {
    name: 'safetrekr-trip-twin-cameras',
    configureServer(server) {
      const port = () =>
        server.httpServer?.address?.()?.port || server.config?.server?.port;
      const cams =
        service ||
        createTrafficCameras({
          fixture: env.TRIP_TWIN_CAMERAS === 'fixture',
          // This server's own upstream routes, over loopback. Via makes
          // upstream skip its Street View fallback.
          upstream: (p, init = {}) =>
            // localhost, not 127.0.0.1: Vite may listen on ::1 only.
            fetch(`http://localhost:${port()}${p}`, {
              ...init,
              headers: { Via: '1.1 trip-twin', Host: `localhost:${port()}` },
            }),
        });
      server.middlewares.use(
        '/api/twin-cameras',
        twinHostGuard({ check: hostCheckFor(server) }),
      );
      server.middlewares.use('/api/twin-cameras', async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { ok: false });
        const url = new URL(req.url, 'http://local');
        try {
          if (url.pathname === '/near') {
            const lat = Number(url.searchParams.get('lat'));
            const lon = Number(url.searchParams.get('lon'));
            const r = Number(url.searchParams.get('r') || 500);
            if (
              !url.searchParams.get('lat') ||
              !url.searchParams.get('lon') ||
              !Number.isFinite(lat) ||
              !Number.isFinite(lon) ||
              !RADII.includes(r)
            )
              return sendJson(res, 400, { ok: false, error: 'query' });
            return sendJson(res, 200, await cams.near(lat, lon, r));
          }
          if (url.pathname === '/frame') {
            const f = await cams.frame(url.searchParams.get('id'));
            res.writeHead(200, {
              'Content-Type': 'image/jpeg',
              'Cache-Control': 'no-store',
              'X-Twin-Fetched': String(f.at),
              'X-Twin-Same-Since': String(f.sameSince),
              ...(f.stale ? { 'X-Twin-Stale': '1' } : {}),
            });
            return res.end(f.jpg);
          }
          return sendJson(res, 404, { ok: false, error: 'unknown endpoint' });
        } catch (error) {
          const status = error instanceof CameraError ? error.status : 502;
          return sendJson(res, status, {
            ok: false,
            error: String(error?.message || error).slice(0, 80),
          });
        }
      });
    },
  };
}
