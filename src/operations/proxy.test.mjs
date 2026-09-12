import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { staffCoreProxy } from '../../server/standalone/staffCoreProxy.js';

test('Core proxy is GET-only, fixed-target, and forwards only the staff session', async () => {
  const requests = [];
  const upstream = http.createServer((req, res) => {
    requests.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end('{"schema_version":1}');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  let middleware;
  staffCoreProxy({
    coreUrl: `http://127.0.0.1:${upstream.address().port}`,
  }).configureServer({
    middlewares: {
      use: (_path, handler) => {
        middleware = handler;
      },
    },
  });
  const proxy = http.createServer(middleware);
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${proxy.address().port}`;
  try {
    assert.equal((await fetch(origin)).status, 401);
    assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
    assert.equal(
      (
        await fetch(`${origin}/another-route`, {
          headers: { Authorization: 'Bearer synthetic' },
        })
      ).status,
      404,
    );
    const result = await fetch(
      `${origin}/?window=all&limit=10&role=hq_admin&url=https://untrusted.invalid`,
      { headers: { Authorization: 'Bearer synthetic' } },
    );
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(requests, [
      {
        url: '/v1/staff/operations?window=all&limit=10',
        auth: 'Bearer synthetic',
      },
    ]);
  } finally {
    await new Promise((resolve) => proxy.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});
