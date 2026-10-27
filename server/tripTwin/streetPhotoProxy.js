// Trip Twin street photos (review/street-photos P5), dev server only. Two
// keyless public providers, asked once for the whole room:
//   /api/twin-photos/near?lat=&lon=            photos within 250 m, normalised
//   /api/twin-photos/view?p=&id=&w=[&yaw=&pitch=&fov=]  one JPEG: a flat photo resized,
//                                               or a fixed view out of a 360°
//   /api/twin-photos/full?p=&id=               the All-in-one viewer's image
// Seven wall windows share one limiter, one backoff and one render, so the
// providers' politeness rules (upstream policy.js) hold for the room, and a
// 360° photo is decoded once, not seven times. The routes take a provider
// and an id, never a URL: they can only fetch images the provider listed.
// Panoramax first; KartaView only when Panoramax has nothing or is down.
// Searches and rendered views are kept in TRIP_TWIN_DATA_DIR/street-photos
// (fenced off the repo) for 30 days, so a demo works offline.
// TRIP_TWIN_PHOTOS=fixture answers from canned photos and never the network.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createPanoramaxSource } from '../../src/layers/streetLevel/providers/panoramax/source.js';
import { normalizeItem } from '../../src/layers/streetLevel/providers/panoramax/policy.js';
import { createKartaViewSource } from '../../src/layers/streetLevel/providers/kartaview/source.js';
import { normalizePhoto } from '../../src/layers/streetLevel/providers/kartaview/policy.js';
import { createLimiter } from '../../src/layers/streetLevel/limiter.js';
import { hostCheckFor } from './twinHostCheck.js';
import { twinHostGuard } from './twinHosts.js';
import { resolveDataDir } from './sessionStore.js';
import { projectEquirect, sourceWidthFor } from './panoView.js';

export const RADIUS_M = 250;
export const VIEW_WIDTHS = Object.freeze([480, 960, 1440]);
const SEARCH_TTL_MS = 24 * 3600e3;
const EMPTY_TTL_MS = 30 * 60e3;
const DISK_TTL_MS = 30 * 24 * 3600e3;
const DISK_MAX_BYTES = 200 * 1024 * 1024;
const MEMORY_MAX_BYTES = 64 * 1024 * 1024;
const IMAGE_MAX_BYTES = 48 * 1024 * 1024;
const IMAGE_MAX_PIXELS = 64e6;
const IMAGE_TIMEOUT_MS = 30_000;
const PANO_SRC_MAX_W = 8192;
const FULL_MAX_W = 6144;
const KV_PROBES = 6;
const ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
/**
 * Not street photos (review/street-photos round 1): MapComplete uploads are
 * single photos attached to a map feature, often taken indoors (a hotel
 * room's kitchen came first at the Park Plaza); and any photo whose own
 * description says it is inside. Strangers' rooms never reach a wall.
 */
const NOT_STREET_INSTANCES = new Set(['panoramax.mapcomplete.org']);
const INDOOR_RE =
  /\b(bathroom|bedroom|kitchen|toilet|shower|bathtub|washbasin|bed|sofa|couch|hallway|corridor|living room|hotel room|interior|indoors?|countertop|ceiling|wardrobe)\b/i;
/** The photo's own descriptions (not the model's prompt or reasoning). */
export function describedIndoors(raw) {
  const text = (raw?.properties?.semantics || [])
    .filter(
      (x) =>
        /^description/.test(String(x?.key)) &&
        !/:(model|prompt|thinking)$/.test(String(x?.key)),
    )
    .map((x) => String(x.value || ''))
    .join(' ');
  return INDOOR_RE.test(text);
}
const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../..',
);

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

/** A gone image (404/409/410), a too-large one, or a provider that is busy. */
export class PhotoError extends Error {
  constructor(message, { status = 502, retryAfterSec = null } = {}) {
    super(message);
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

// ---------------------------------------------------------------- fixtures

/**
 * Canned photos for tests and smoke: around any US point except
 * Washington, two 360° photos 190 m SE (like the Fairmont's); around a
 * European point one flat photo 63 m N looking S (like Waterloo's); around
 * Washington none.
 */
export function fixtureNear({ lat, lon }) {
  const here = { lat, lon };
  const tag = `${lat.toFixed(3)}_${lon.toFixed(3)}`.replace(/[^0-9_]/g, '');
  if (lat > 38.8 && lat < 39 && lon > -77.1 && lon < -76.9) return [];
  if (lon > -30) {
    const p = offset(here, 0, 63);
    return [
      {
        provider: 'panoramax',
        id: `fx-flat-${tag}`,
        ...p,
        heading: 180,
        fov: 104,
        isPano: false,
        capturedAt: Date.UTC(2026, 8, 29),
        creator: 'Fixture photographer',
        via: 'fixture.invalid',
        license: 'CC BY-SA 4.0',
        seq: `fx-seq-flat-${tag}`,
      },
    ];
  }
  return [190, 195].map((m, i) => ({
    provider: 'panoramax',
    id: `fx-pano-${tag}-${i}`,
    ...offset(here, 150 + i, m),
    heading: 20,
    fov: 360,
    isPano: true,
    capturedAt: Date.UTC(2025, 3, 3),
    creator: 'Fixture photographer',
    via: 'fixture.invalid',
    license: 'CC BY-SA 4.0',
    seq: `fx-seq-pano-${tag}`,
  }));
}

/** A synthetic image: a 360° coloured by longitude (so a view's yaw shows), or a flat gradient. */
export async function fixtureImage(isPano) {
  const W = isPano ? 2048 : 1600;
  const H = isPano ? 1024 : 1200;
  const data = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const sky = y < H / 2;
      data[o] = Math.round((x / W) * 255);
      data[o + 1] = sky ? 150 : 80;
      data[o + 2] = sky ? 200 : 60;
    }
  return sharp(data, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 80 })
    .toBuffer();
}

// ---------------------------------------------------------------- the proxy

/**
 * The room's photo service. `fetchImpl` reaches the providers; `dataDir`
 * (null: memory only) holds the 30-day copies; `fixture` never fetches.
 */
export function createStreetPhotos({
  fetchImpl = (...a) => globalThis.fetch(...a),
  dataDir = null,
  fixture = false,
  now = () => Date.now(),
} = {}) {
  const pmx = createPanoramaxSource({ fetchImpl });
  const kv = createKartaViewSource({ fetchImpl });
  const images = createLimiter(2);
  const renders = createLimiter(1);
  const searches = new Map(); // key → {at, ttl, value}
  const inflight = new Map(); // key → Promise
  const known = new Map(); // `${p}:${id}` → {item, urls}
  const memory = new Map(); // view key → Buffer (insertion order = LRU)
  let memoryBytes = 0;
  const dir = dataDir ? path.join(dataDir, 'street-photos') : null;
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch {
      /* memory only */
    }
  }

  const diskPath = (key, ext) =>
    dir &&
    path.join(
      dir,
      `${crypto.createHash('sha1').update(key).digest('hex')}.${ext}`,
    );
  function diskRead(key, ext) {
    const file = diskPath(key, ext);
    if (!file) return null;
    try {
      const st = fs.statSync(file);
      if (now() - st.mtimeMs > DISK_TTL_MS) return null;
      return fs.readFileSync(file);
    } catch {
      return null;
    }
  }
  function diskWrite(key, ext, buf) {
    const file = diskPath(key, ext);
    if (!file) return;
    try {
      fs.writeFileSync(`${file}.tmp`, buf, { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
      prune();
    } catch {
      /* best effort */
    }
  }
  let lastPrune = 0;
  function prune() {
    if (!dir || now() - lastPrune < 60e3) return;
    lastPrune = now();
    try {
      const files = fs
        .readdirSync(dir)
        .map((f) => {
          const p = path.join(dir, f);
          const st = fs.statSync(p);
          return { p, at: st.mtimeMs, size: st.size };
        })
        .sort((a, b) => b.at - a.at);
      let total = 0;
      for (const f of files) {
        total += f.size;
        if (total > DISK_MAX_BYTES || now() - f.at > DISK_TTL_MS)
          fs.rmSync(f.p, { force: true });
      }
    } catch {
      /* best effort */
    }
  }
  function remember(key, buf) {
    if (memory.has(key)) memoryBytes -= memory.get(key).length;
    memory.delete(key);
    memory.set(key, buf);
    memoryBytes += buf.length;
    for (const [k, v] of memory) {
      if (memoryBytes <= MEMORY_MAX_BYTES) break;
      memory.delete(k);
      memoryBytes -= v.length;
    }
  }
  const once = (key, load) => {
    if (inflight.has(key)) return inflight.get(key);
    const p = load().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };

  function fromPanoramax(raw) {
    const n = normalizeItem(raw);
    if (!n) return null;
    if (NOT_STREET_INSTANCES.has(n.via) || describedIndoors(raw)) return null;
    const fov = Number(
      raw.properties?.['pers:interior_orientation']?.field_of_view,
    );
    const item = {
      provider: 'panoramax',
      id: n.id,
      lat: n.lat,
      lon: n.lon,
      heading: n.heading,
      fov: n.isPano ? 360 : Number.isFinite(fov) && fov > 0 ? fov : null,
      isPano: n.isPano,
      capturedAt: n.capturedAt,
      creator: n.creator,
      via: n.via,
      license: n.license,
      seq: n.sequenceId,
    };
    known.set(`panoramax:${n.id}`, { item, urls: n.urls, width: n.width });
    return item;
  }
  function fromKartaView(raw) {
    const n = normalizePhoto(raw);
    if (!n) return null;
    const isPano = Boolean(n.isPano && n.urls.pano);
    const item = {
      provider: 'kartaview',
      id: n.id,
      lat: n.lat,
      lon: n.lon,
      // A device compass: 0 without one, far off inside a car (upstream
      // policy.js). Unknown, so no direction is claimed (every-time P1-2).
      heading: null,
      fov: isPano ? 360 : null,
      isPano,
      capturedAt: n.capturedAt,
      creator: null,
      via: null,
      license: 'CC BY-SA 4.0',
      seq: n.sequenceId,
    };
    known.set(`kartaview:${n.id}`, { item, urls: n.urls, width: null });
    return item;
  }

  // Panoramax's own retry-after, for the whole room (AIA round 1): asks
  // inside it answer busy without calling again.
  let pmxBusyUntil = 0;
  async function searchPanoramax(here) {
    if (now() < pmxBusyUntil)
      return {
        status: 'busy',
        retryAfterSec: Math.ceil((pmxBusyUntil - now()) / 1000),
        items: [],
      };
    try {
      const raw = await pmx.nearestItems({
        lat: here.lat,
        lon: here.lon,
        radius: RADIUS_M,
        limit: 30,
      });
      return { status: 'ok', items: raw.map(fromPanoramax).filter(Boolean) };
    } catch (error) {
      if (error?.retryAfterSec) {
        pmxBusyUntil = now() + error.retryAfterSec * 1000;
        return {
          status: 'busy',
          retryAfterSec: error.retryAfterSec,
          items: [],
        };
      }
      return { status: 'unavailable', items: [] };
    }
  }
  async function searchKartaView(here) {
    try {
      const raw = await kv.nearestPhotos({ lat: here.lat, lon: here.lon });
      const items = raw
        .map(fromKartaView)
        .filter((x) => x && metresBetween(here, x) <= RADIUS_M)
        .slice(0, KV_PROBES);
      // Many KartaView photos are archived (409): keep only those that load.
      const ok = await Promise.all(
        items.map((x) =>
          kv
            .probeImage(known.get(`kartaview:${x.id}`).urls.view)
            .catch(() => false),
        ),
      );
      return { status: 'ok', items: items.filter((_, i) => ok[i]) };
    } catch (error) {
      return error?.retryAfterSec
        ? { status: 'busy', retryAfterSec: error.retryAfterSec, items: [] }
        : { status: 'unavailable', items: [] };
    }
  }

  /** Photos within 250 m of a point, nearest first, and who was asked. */
  async function near(lat, lon) {
    const here = { lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)) };
    const key = `near:${here.lat},${here.lon}`;
    const hit = searches.get(key);
    if (hit && now() - hit.at < hit.ttl) return hit.value;
    return once(key, async () => {
      let value;
      if (fixture) {
        const items = fixtureNear(here);
        for (const item of items)
          known.set(`${item.provider}:${item.id}`, { item, urls: {} });
        value = {
          status: 'ok',
          provider: 'panoramax',
          checked: ['panoramax'],
          items,
        };
      } else {
        const a = await searchPanoramax(here);
        const checked = a.status === 'ok' ? ['panoramax'] : [];
        let res = a;
        let provider = 'panoramax';
        // Panoramax busy: KartaView waits out the same window (AIA round 2).
        if (a.status !== 'busy' && (a.status !== 'ok' || !a.items.length)) {
          const b = await searchKartaView(here);
          if (b.status === 'ok') checked.push('kartaview');
          if (b.status === 'ok' && b.items.length) {
            res = b;
            provider = 'kartaview';
          }
        }
        // "None" needs Panoramax's answer: KartaView alone finding nothing
        // while Panoramax is busy or down is not a check (P5).
        const answered = a.status === 'ok' || res.items.length > 0;
        value = {
          status: answered ? 'ok' : a.status,
          retryAfterSec: answered ? null : (a.retryAfterSec ?? null),
          provider,
          checked,
          items: res.items
            .map((x) => ({ ...x, d: metresBetween(here, x) }))
            .filter((x) => x.d <= RADIUS_M)
            .sort((x, y) => x.d - y.d)
            .map(({ d, ...x }) => x),
        };
      }
      value = { servedAt: now(), ...value };
      if (value.status === 'ok') {
        searches.set(key, {
          at: now(),
          // KartaView's photos while Panoramax was busy: ask again soon.
          ttl:
            value.items.length && value.checked?.[0] === 'panoramax'
              ? SEARCH_TTL_MS
              : EMPTY_TTL_MS,
          value,
        });
        diskWrite(key, 'json', Buffer.from(JSON.stringify(value)));
      } else {
        // Offline: the last copy on disk, marked as such.
        const disk = diskRead(key, 'json');
        if (disk) {
          try {
            const old = JSON.parse(disk);
            for (const item of old.items || [])
              known.set(`${item.provider}:${item.id}`, { item, urls: {} });
            return { ...old, offline: true };
          } catch {
            /* fall through */
          }
        }
      }
      return value;
    });
  }

  /** Where a listed photo's image is; a photo not seen in a search is looked up by id. */
  async function lookup(p, id) {
    const hit = known.get(`${p}:${id}`);
    if (hit?.urls && (hit.urls.sd || hit.urls.view || fixture)) return hit;
    if (fixture) {
      if (!/^fx-(pano|flat)-/.test(id))
        throw new PhotoError('unknown photo', { status: 404 });
      return { item: { isPano: id.startsWith('fx-pano') }, urls: {} };
    }
    if (p === 'panoramax') {
      const raw = await pmx.getItem(id).catch(() => null);
      if (raw && fromPanoramax(raw)) return known.get(`${p}:${id}`);
    } else {
      const raw = await kv.getPhoto(id).catch(() => null);
      if (raw && fromKartaView(raw)) return known.get(`${p}:${id}`);
    }
    throw new PhotoError('unknown photo', { status: 404 });
  }

  // Source images for 10 min: one download serves every width and Open.
  const sources = new Map(); // url → {at, buf}
  async function download(url) {
    if (!/^https:\/\//.test(url || ''))
      throw new PhotoError('no image', { status: 410 });
    const hit = sources.get(url);
    if (hit && now() - hit.at < 10 * 60e3) return hit.buf;
    // Two sizes asked at once share one download (AIA round 2).
    const buf = await once(`dl:${url}`, () =>
      images.run(() => fetchImage(url)),
    );
    sources.set(url, { at: now(), buf });
    for (const [k, v] of sources)
      if (sources.size > 6 || now() - v.at > 10 * 60e3) sources.delete(k);
      else break;
    return buf;
  }
  async function fetchImage(url) {
    {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), IMAGE_TIMEOUT_MS);
      try {
        const res = await fetchImpl(url, { signal: ctl.signal });
        if ([404, 409, 410].includes(res.status))
          throw new PhotoError('image gone', { status: 410 });
        if (res.status === 429 || res.status === 503)
          throw new PhotoError('busy', { status: 503, retryAfterSec: 30 });
        if (!res.ok) throw new PhotoError(`HTTP ${res.status}`);
        if (Number(res.headers.get('content-length')) > IMAGE_MAX_BYTES)
          throw new PhotoError('too large', { status: 413 });
        if (res.url && !/^https:\/\//.test(res.url))
          throw new PhotoError('no image', { status: 410 });
        // Capped while reading, not after (AIA round 1).
        const reader = res.body?.getReader?.();
        if (!reader) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > IMAGE_MAX_BYTES)
            throw new PhotoError('too large', { status: 413 });
          return buf;
        }
        const parts = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > IMAGE_MAX_BYTES) {
            reader.cancel().catch(() => {});
            throw new PhotoError('too large', { status: 413 });
          }
          parts.push(value);
        }
        return Buffer.concat(parts);
      } catch (error) {
        if (error instanceof PhotoError) throw error;
        throw new PhotoError('unreachable');
      } finally {
        clearTimeout(timer);
      }
    }
  }

  async function sourceImage(found, { full = false } = {}) {
    if (fixture) return fixtureImage(found.item.isPano);
    const { item, urls, width } = found;
    if (item.provider === 'kartaview')
      return download(item.isPano ? urls.pano : full ? urls.full : urls.view);
    // A 360° photo's HD image unless it is wider than a GPU texture.
    if (item.isPano)
      return download(
        urls.hd && (!width || width <= PANO_SRC_MAX_W) ? urls.hd : urls.sd,
      );
    return download(urls.sd || urls.hd);
  }

  /**
   * A wall view's exposure evened (brand round 1): a daylight photo
   * otherwise outshines the red report pill. Mean brought towards ~105.
   */
  async function even(img) {
    const flat = await img.jpeg({ quality: 92 }).toBuffer();
    const { channels } = await sharp(flat).stats();
    const rgb = channels.slice(0, 3);
    const mean = rgb.reduce((n, c) => n + c.mean, 0) / rgb.length;
    const k = Math.max(0.6, Math.min(1, 105 / Math.max(1, mean)));
    return sharp(flat).linear(k, 0).jpeg({ quality: 78 }).toBuffer();
  }
  const decode = (buf) =>
    sharp(buf, { limitInputPixels: IMAGE_MAX_PIXELS, failOn: 'error' });

  /** One JPEG for a wall, the remote or a thumbnail. */
  async function view(p, id, { w, yaw = null, pitch = null, fov = null }) {
    const key = `view:${p}:${id}:${w}:${yaw}:${pitch}:${fov}`;
    const mem = memory.get(key);
    if (mem) {
      remember(key, mem);
      return mem;
    }
    const disk = diskRead(key, 'jpg');
    if (disk) {
      remember(key, disk);
      return disk;
    }
    return once(key, async () => {
      const found = await lookup(p, id);
      const buf = await sourceImage(found);
      const out = await renders.run(async () => {
        try {
          if (found.item.isPano) {
            const outW = w;
            const outH = Math.round(w / 2);
            const f = fov ?? 75;
            const meta = await decode(buf).metadata();
            const tw = sourceWidthFor({ fov: f, outW, srcW: meta.width });
            const { data, info } = await decode(buf)
              .resize(tw, Math.round(tw / 2), { fit: 'fill' })
              .removeAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });
            const px = projectEquirect(
              {
                data,
                width: info.width,
                height: info.height,
                channels: info.channels,
              },
              { yaw: yaw ?? 0, pitch: pitch ?? 0, fov: f, outW, outH },
            );
            return even(
              sharp(px, { raw: { width: outW, height: outH, channels: 3 } }),
            );
          }
          return even(
            decode(buf)
              .rotate()
              .resize(w, w, { fit: 'inside', withoutEnlargement: true }),
          );
        } catch (error) {
          if (/pixel limit/i.test(String(error?.message)))
            throw new PhotoError('too large', { status: 413 });
          throw new PhotoError('unreadable image');
        }
      });
      remember(key, out);
      diskWrite(key, 'jpg', out);
      return out;
    });
  }

  /** The All-in-one viewer's image: the 360° whole (for dragging) or the flat photo. */
  async function full(p, id) {
    const key = `full:${p}:${id}`;
    const disk = diskRead(key, 'jpg');
    if (disk) return disk;
    return once(key, async () => {
      const found = await lookup(p, id);
      const buf = await sourceImage(found, { full: true });
      const out = await renders.run(() =>
        decode(buf)
          .rotate()
          .resize(FULL_MAX_W, FULL_MAX_W, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 82 })
          .toBuffer()
          .catch(() => {
            throw new PhotoError('unreadable image');
          }),
      );
      diskWrite(key, 'jpg', out);
      return out;
    });
  }

  return { near, view, full, lookup };
}

// ---------------------------------------------------------------- HTTP

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

/** The query checked: a provider, an id and fixed buckets, or null. */
export function parseViewQuery(q) {
  const p = q.get('p');
  const id = q.get('id');
  if (!['panoramax', 'kartaview'].includes(p) || !ID_RE.test(id || ''))
    return null;
  const w = Number(q.get('w') || 960);
  if (!VIEW_WIDTHS.includes(w)) return null;
  const step = (name, lo, hi) => {
    if (!q.has(name)) return { ok: true, v: null };
    const v = Number(q.get(name));
    return Number.isInteger(v) && v % 5 === 0 && v >= lo && v <= hi
      ? { ok: true, v }
      : { ok: false };
  };
  const yaw = step('yaw', 0, 355);
  // Up only: a tall building seen from down the street (P5).
  const pitch = step('pitch', 0, 30);
  const fov = step('fov', 40, 90);
  if (!yaw.ok || !pitch.ok || !fov.ok) return null;
  return { p, id, w, yaw: yaw.v, pitch: pitch.v, fov: fov.v };
}

export function twinStreetPhotoProxy({
  fetchImpl,
  env = process.env,
  service = null,
} = {}) {
  return {
    name: 'safetrekr-trip-twin-photos',
    configureServer(server) {
      const where = resolveDataDir({
        env,
        fences: [
          { name: 'the repo', path: REPO_ROOT },
          { name: "Vite's root", path: server.config?.root || REPO_ROOT },
        ],
      });
      const photos =
        service ||
        createStreetPhotos({
          fetchImpl,
          dataDir: where.refused ? null : where.dir,
          fixture: env.TRIP_TWIN_PHOTOS === 'fixture',
        });
      server.middlewares.use(
        '/api/twin-photos',
        twinHostGuard({ check: hostCheckFor(server) }),
      );
      server.middlewares.use('/api/twin-photos', async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { ok: false });
        const url = new URL(req.url, 'http://local');
        try {
          if (url.pathname === '/near') {
            const lat = Number(url.searchParams.get('lat'));
            const lon = Number(url.searchParams.get('lon'));
            if (
              !url.searchParams.get('lat') ||
              !url.searchParams.get('lon') ||
              !Number.isFinite(lat) ||
              !Number.isFinite(lon) ||
              Math.abs(lat) > 90 ||
              Math.abs(lon) > 180
            )
              return sendJson(res, 400, { ok: false, error: 'lat/lon' });
            return sendJson(res, 200, await photos.near(lat, lon));
          }
          if (url.pathname === '/view' || url.pathname === '/full') {
            const q = parseViewQuery(url.searchParams);
            if (!q) return sendJson(res, 400, { ok: false, error: 'query' });
            const jpg =
              url.pathname === '/view'
                ? await photos.view(q.p, q.id, q)
                : await photos.full(q.p, q.id);
            res.writeHead(200, {
              'Content-Type': 'image/jpeg',
              'Cache-Control': 'private, max-age=86400, immutable',
            });
            return res.end(jpg);
          }
          return sendJson(res, 404, { ok: false, error: 'unknown endpoint' });
        } catch (error) {
          const status = error instanceof PhotoError ? error.status : 502;
          if (error?.retryAfterSec)
            res.setHeader('Retry-After', String(error.retryAfterSec));
          return sendJson(res, status, {
            ok: false,
            error: String(error?.message || error).slice(0, 120),
          });
        }
      });
    },
  };
}
