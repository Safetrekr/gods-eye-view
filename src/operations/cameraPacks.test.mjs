import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import {
  normalizeCameraPack,
  saveCameraPack,
  loadCameraPack,
  fetchPublicCameraImage,
  isPublicCameraAddress,
  CAMERA_PACK_FILE,
} from '../../server/providers/camera-packs.js';
import { operationsProviders } from '../../server/standalone/operationsProviders.js';

const camera = {
  id: 'city-square',
  name: 'City square',
  city: 'Example City',
  provider: 'City transport',
  license: 'Public camera attribution',
  lat: 0,
  lon: 0,
  url: 'https://cameras.city.gov/square.jpg',
  feedType: 'image',
};

test('camera packs preserve zero coordinates and reject malformed or unsafe inputs', () => {
  assert.equal(normalizeCameraPack([camera])[0].lat, 0);
  for (const update of [
    { lat: '' },
    { lon: 181 },
    { lat: null },
    { url: 'http://cameras.city.gov/x.jpg' },
    { url: 'https://127.0.0.1/x' },
    { url: 'https://user:pass@cameras.city.gov/x' },
    { feedType: 'hls' },
    { name: '' },
  ])
    assert.throws(() => normalizeCameraPack([{ ...camera, ...update }]));
  assert.throws(() => normalizeCameraPack(Array(101).fill(camera)));
});

test('saved cameras upsert in an owner-only local pack', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safetrekr-cameras-'));
  try {
    assert.deepEqual(saveCameraPack([camera], root), { added: 1, total: 1 });
    saveCameraPack([{ ...camera, name: 'Updated name' }], root);
    assert.equal(loadCameraPack(root).length, 1);
    assert.equal(loadCameraPack(root)[0].name, 'Updated name');
    assert.equal(
      fs.statSync(path.join(root, CAMERA_PACK_FILE)).mode & 0o777,
      0o600,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('camera requests reject nonpublic DNS answers and pin accepted addresses', async () => {
  for (const address of [
    '127.0.0.1',
    '10.2.3.4',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
    '2001:10::1',
  ])
    assert.equal(isPublicCameraAddress(address), false);
  let called = false;
  await assert.rejects(
    fetchPublicCameraImage(camera.url, {
      lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
      requestImpl: () => {
        called = true;
      },
    }),
  );
  assert.equal(called, false);
  const response = await fetchPublicCameraImage(camera.url, {
    lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
    requestImpl: (_url, options, respond) => {
      options.lookup('cameras.city.gov', {}, (_error, address) =>
        assert.equal(address, '8.8.8.8'),
      );
      const request = new EventEmitter();
      request.end = () => {
        const stream = new EventEmitter();
        stream.statusCode = 200;
        stream.headers = { 'content-type': 'image/jpeg' };
        respond(stream);
        stream.emit('data', Buffer.from('synthetic'));
        stream.emit('end');
      };
      return request;
    },
  });
  assert.equal(await response.text(), 'synthetic');
});

test('camera mutation requires a local same-origin JSON request and never echoes URLs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safetrekr-cameras-api-'));
  const routes = new Map();
  let invalidated = 0;
  operationsProviders({
    root,
    invalidateCameras: () => {
      invalidated++;
    },
  }).configureServer({
    middlewares: { use: (url, handle) => routes.set(url, handle) },
  });
  const server = http.createServer((req, res) =>
    routes.get(req.url)?.(req, res),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const send = (headers) =>
      fetch(`${origin}/api/safetrekr/cameras`, {
        method: 'POST',
        headers,
        body: JSON.stringify([camera]),
      });
    assert.equal(
      (
        await send({
          'content-type': 'application/json',
          origin: 'https://unrelated.example',
        })
      ).status,
      403,
    );
    assert.equal(
      (await send({ 'content-type': 'application/json' })).status,
      403,
    );
    const result = await send({ 'content-type': 'application/json', origin });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { added: 1, total: 1 });
    assert.equal(invalidated, 1);
    assert.deepEqual(
      await (await fetch(`${origin}/api/safetrekr/cameras`)).json(),
      { count: 1 },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
