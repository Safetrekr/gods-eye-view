import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { staffCoreProxy } from '../../server/standalone/staffCoreProxy.js';

test('Core proxy fixes the upstream and permits only snapshots and explicit trip actions', async () => {
  const requests = [];
  const upstream = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({
      url: req.url,
      auth: req.headers.authorization,
      ...(body ? { body: JSON.parse(body) } : {}),
    });
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
    const action = '/trips/00000000-0000-4000-8000-000000000001/broadcast';
    const headers = {
      Authorization: 'Bearer synthetic',
      'Content-Type': 'application/json',
    };
    assert.equal(
      (
        await fetch(`${origin}${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${origin}${action}`, {
          method: 'POST',
          headers: { ...headers, Origin: 'https://other.example' },
          body: '{}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${origin}${action}`, {
          method: 'POST',
          headers,
          body: '{broken',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${origin}${action}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ message: 'x'.repeat(17000) }),
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await fetch(`${origin}${action.replace('broadcast', 'delete')}`, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${origin}${action}?org_id=other`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ title: 'Fixture', message: 'Test' }),
        })
      ).status,
      200,
    );
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], {
      url: `/v1/staff/operations${action}`,
      auth: 'Bearer synthetic',
      body: { title: 'Fixture', message: 'Test' },
    });
  } finally {
    await new Promise((resolve) => proxy.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});
