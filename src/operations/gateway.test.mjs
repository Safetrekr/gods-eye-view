import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import handler from '../../api/gateway.js';

test('deployed gateway grants public feeds only after Core authorizes staff, and never substitutes its cookie for private auth', async () => {
  let authorized = true;
  const core = createServer((req, res) => {
    assert.equal(req.url, '/v1/staff/operations');
    assert.equal(req.headers.authorization, 'Bearer synthetic-test-session');
    res.writeHead(authorized ? 200 : 403, {
      'Content-Type': 'application/json',
    });
    res.end(
      JSON.stringify(
        authorized ? { trips: [], participants: [] } : { error: 'Forbidden' },
      ),
    );
  });
  const gateway = createServer(handler);
  await new Promise((resolve) => core.listen(0, '127.0.0.1', resolve));
  process.env.SAFETREKR_CORE_URL = `http://127.0.0.1:${core.address().port}`;
  process.env.PROVIDER_SESSION_SECRET =
    'synthetic-provider-session-secret-for-tests';
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${gateway.address().port}`;
  const request = (path, options) =>
    fetch(`${origin}/api/gateway?path=${path}`, options);
  try {
    assert.equal((await request('safetrekr/providers')).status, 401);
    assert.equal((await request('safetrekr/operations')).status, 401);
    const response = await request('safetrekr/operations', {
      headers: { Authorization: 'Bearer synthetic-test-session' },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const providers = await request('safetrekr/providers', {
      headers: { cookie },
    });
    assert.equal(providers.status, 200);
    assert.equal((await providers.json()).cameraEditing, false);
    assert.equal(
      (await request('safetrekr/operations', { headers: { cookie } })).status,
      401,
    );
    assert.equal(
      (await request('key-setup', { headers: { cookie } })).status,
      404,
    );
    assert.equal(
      (
        await request('safetrekr/cameras', {
          method: 'POST',
          headers: { cookie },
        })
      ).status,
      405,
    );
    authorized = false;
    const denied = await request('safetrekr/operations', {
      headers: { Authorization: 'Bearer synthetic-test-session' },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('set-cookie'), null);
    const logout = await request('safetrekr/logout', {
      method: 'POST',
      headers: { cookie },
    });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  } finally {
    await Promise.all([
      new Promise((resolve) => core.close(resolve)),
      new Promise((resolve) => gateway.close(resolve)),
    ]);
  }
});
