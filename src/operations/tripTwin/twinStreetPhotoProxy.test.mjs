// Street photos proxy (review/street-photos P5): one search for the room,
// KartaView only as a fallback, busy answers never cached, ids only (never a
// URL), a 360° turned into a fixed view, and the disk copy for offline use.
// No network: a fake fetch answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  createStreetPhotos,
  fixtureNear,
  parseViewQuery,
} from '../../../server/tripTwin/streetPhotoProxy.js';
import {
  projectEquirect,
  sourceWidthFor,
} from '../../../server/tripTwin/panoView.js';
import { stacItem } from '../../testSupport/panoramaxFixtures.mjs';

const HOTEL = { lat: 30.26218, lon: -97.73832 };
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** A fake Panoramax (and KartaView) that counts its calls. */
function fakeProviders({ pmx = [], kv = [], pmxStatus = 200 } = {}) {
  const calls = { pmx: 0, kv: 0, img: 0 };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.startsWith('https://api.panoramax.xyz/api/search')) {
      calls.pmx++;
      if (pmxStatus !== 200) return json({}, pmxStatus, { 'retry-after': '7' });
      return json({ type: 'FeatureCollection', features: pmx });
    }
    if (u.startsWith('https://api.kartaview.org/')) {
      calls.kv++;
      return json({ status: { apiCode: 600 }, result: { data: kv } });
    }
    calls.img++;
    return new Response('nope', { status: 409 });
  };
  return { calls, fetchImpl };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tt-photos-'));

test('fixtures: two 360° photos in Austin, a flat one in London, none in Washington', () => {
  const a = fixtureNear(HOTEL);
  assert.equal(a.length, 2);
  assert.ok(a.every((p) => p.isPano));
  const l = fixtureNear({ lat: 51.49817, lon: -0.11335 });
  assert.deepEqual([l.length, l[0].isPano, l[0].heading], [1, false, 180]);
  assert.equal(fixtureNear({ lat: 38.8969, lon: -77.0108 }).length, 0);
});

test('seven windows asking at once make one search; results within 250 m, nearest first', async () => {
  const near = stacItem({
    id: 'near',
    lon: HOTEL.lon + 0.001,
    lat: HOTEL.lat,
    pano: true,
  });
  const far = stacItem({ id: 'far', lon: HOTEL.lon + 0.01, lat: HOTEL.lat });
  const { calls, fetchImpl } = fakeProviders({ pmx: [far, near] });
  const s = createStreetPhotos({ fetchImpl });
  const all = await Promise.all(
    Array.from({ length: 7 }, () => s.near(HOTEL.lat, HOTEL.lon)),
  );
  // Upstream's lookup is two searches side by side (a point and a box).
  assert.equal(calls.pmx, 2);
  assert.equal(calls.kv, 0);
  assert.ok(all.every((r) => r === all[0]));
  assert.deepEqual(
    all[0].items.map((p) => p.id),
    ['near'],
  );
  assert.equal(all[0].items[0].fov, 360);
  assert.equal(all[0].status, 'ok');
  // Cached: asking again makes no call.
  await s.near(HOTEL.lat, HOTEL.lon);
  assert.equal(calls.pmx, 2);
});

test('KartaView only when Panoramax has nothing; a busy answer is never cached', async () => {
  const { calls, fetchImpl } = fakeProviders({ pmx: [] });
  const s = createStreetPhotos({ fetchImpl });
  const r = await s.near(HOTEL.lat, HOTEL.lon);
  assert.equal(calls.kv, 1);
  assert.deepEqual(r.checked, ['panoramax', 'kartaview']);
  assert.equal(r.items.length, 0);
  assert.equal(r.status, 'ok');

  const busy = fakeProviders({ pmxStatus: 429 });
  let t = 1_000_000;
  const b = createStreetPhotos({ fetchImpl: busy.fetchImpl, now: () => t });
  const first = await b.near(HOTEL.lat, HOTEL.lon);
  // KartaView alone finding nothing is not a check: busy, never "none".
  assert.equal(first.status, 'busy');
  assert.equal(first.retryAfterSec, 7);
  // KartaView waits out Panoramax's window too (AIA round 2).
  assert.deepEqual(first.checked, []);
  assert.equal(busy.calls.kv, 0);
  const asked = busy.calls.pmx;
  // Inside Panoramax's retry-after the room does not ask again (AIA P1-4)…
  t += 3000;
  const again = await b.near(HOTEL.lat, HOTEL.lon);
  assert.equal(again.status, 'busy');
  assert.equal(busy.calls.pmx, asked);
  // …and after it, it does: busy was never cached.
  t += 5000;
  await b.near(HOTEL.lat, HOTEL.lon);
  assert.ok(busy.calls.pmx > asked);
});

test('both down: unavailable, never "none"; the disk copy answers offline', async () => {
  const dir = tmp();
  const up = fakeProviders({
    pmx: [
      stacItem({
        id: 'p1',
        lon: HOTEL.lon + 0.001,
        lat: HOTEL.lat,
        pano: true,
      }),
    ],
  });
  await createStreetPhotos({ fetchImpl: up.fetchImpl, dataDir: dir }).near(
    HOTEL.lat,
    HOTEL.lon,
  );
  const down = async () => {
    throw new TypeError('fetch failed');
  };
  const cold = await createStreetPhotos({ fetchImpl: down }).near(
    HOTEL.lat,
    HOTEL.lon,
  );
  assert.equal(cold.status, 'unavailable');
  assert.equal(cold.items.length, 0);
  const warm = await createStreetPhotos({ fetchImpl: down, dataDir: dir }).near(
    HOTEL.lat,
    HOTEL.lon,
  );
  assert.equal(warm.offline, true);
  assert.deepEqual(
    warm.items.map((p) => p.id),
    ['p1'],
  );
  const files = fs.readdirSync(path.join(dir, 'street-photos'));
  assert.ok(files.length >= 1);
  assert.equal(
    fs.statSync(path.join(dir, 'street-photos')).mode & 0o777,
    0o700,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('not street photos: MapComplete uploads and photos described as indoors are dropped', async () => {
  const at = { lon: HOTEL.lon + 0.0005, lat: HOTEL.lat };
  const room = stacItem({ id: 'room', ...at });
  room.properties.semantics = [
    {
      key: 'description:en:generated',
      value: 'A dark countertop holds a kettle beside an induction cooktop.',
    },
  ];
  const prompt = stacItem({ id: 'street', ...at, sequenceId: 's2' });
  // A prompt or the model's reasoning never counts: only the description.
  prompt.properties.semantics = [
    {
      key: 'description:en:generated',
      value: 'A brick hotel front with a glass door.',
    },
    {
      key: 'description:en:generated:prompt',
      value: 'Never describe the interior',
    },
  ];
  const mc = stacItem({
    id: 'mc',
    ...at,
    sequenceId: 's3',
    host: 'https://panoramax.mapcomplete.org',
  });
  mc.links = [
    ...(mc.links || []),
    { rel: 'via', href: 'https://panoramax.mapcomplete.org' },
  ];
  const { fetchImpl } = fakeProviders({ pmx: [room, prompt, mc] });
  const r = await createStreetPhotos({ fetchImpl }).near(HOTEL.lat, HOTEL.lon);
  assert.deepEqual(
    r.items.map((p) => p.id),
    ['street'],
  );
});

test('the view route takes a provider and an id in fixed buckets, never a URL', () => {
  const q = (s) => parseViewQuery(new URLSearchParams(s));
  assert.deepEqual(q('p=panoramax&id=abc-1&w=960&yaw=110&pitch=10&fov=75'), {
    p: 'panoramax',
    id: 'abc-1',
    w: 960,
    yaw: 110,
    pitch: 10,
    fov: 75,
  });
  assert.equal(q('p=panoramax&id=https://evil.example/x.jpg'), null);
  assert.equal(q('p=flickr&id=a'), null);
  assert.equal(q('p=panoramax&id=a&w=1000'), null);
  assert.equal(q('p=panoramax&id=a&yaw=7'), null);
  assert.equal(q('p=panoramax&id=a&pitch=-10'), null);
  assert.equal(q('p=panoramax&id=a&fov=120'), null);
});

test('an image that is gone (409) is 410; an unknown id is 404', async () => {
  const { fetchImpl } = fakeProviders({
    pmx: [stacItem({ id: 'gone', lon: HOTEL.lon + 0.001, lat: HOTEL.lat })],
  });
  const s = createStreetPhotos({ fetchImpl });
  await s.near(HOTEL.lat, HOTEL.lon);
  await assert.rejects(s.view('panoramax', 'gone', { w: 480 }), {
    status: 410,
  });
  const empty = fakeProviders({ pmx: [] });
  await assert.rejects(
    createStreetPhotos({ fetchImpl: empty.fetchImpl }).view(
      'panoramax',
      'nope',
      { w: 480 },
    ),
    { status: 404 },
  );
});

test('fixture mode renders a 360° as a fixed 2:1 view and a flat photo inside the width', async () => {
  const s = createStreetPhotos({
    fixture: true,
    fetchImpl: () => assert.fail('no network'),
  });
  const [p] = (await s.near(HOTEL.lat, HOTEL.lon)).items;
  const jpg = await s.view(p.provider, p.id, {
    w: 480,
    yaw: 90,
    pitch: 10,
    fov: 75,
  });
  const meta = await sharp(jpg).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 480, 240]);
  const [f] = (await s.near(51.49817, -0.11335)).items;
  const flat = await sharp(
    await s.view(f.provider, f.id, { w: 960 }),
  ).metadata();
  assert.ok(flat.width <= 960 && flat.height <= 960);
});

test('projection: the view centre at yaw 90 samples longitude 90° east of the heading', () => {
  const W = 360;
  const H = 180;
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      data[(y * W + x) * 3] = Math.round((x / W) * 255);
  const src = { data, width: W, height: H, channels: 3 };
  const centre = (yaw) => {
    const out = projectEquirect(src, { yaw, fov: 60, outW: 41, outH: 21 });
    return out[(10 * 41 + 20) * 3];
  };
  assert.ok(Math.abs(centre(0) - 128) <= 2);
  assert.ok(Math.abs(centre(90) - 191) <= 2);
  assert.ok(Math.abs(centre(270) - 64) <= 2);
  // Never decode more than the view needs.
  assert.equal(sourceWidthFor({ fov: 60, outW: 960, srcW: 8000 }), 5760);
  assert.equal(sourceWidthFor({ fov: 75, outW: 960, srcW: 2048 }), 2048);
});
