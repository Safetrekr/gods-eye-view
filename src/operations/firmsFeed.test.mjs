import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { firmsProxy } from '../../server/providers/firms.js';

async function server(t, upstream) {
  const previous = process.cwd();
  const temp = await mkdtemp(path.join(tmpdir(), 'firms-test-'));
  const key = process.env.FIRMS_MAP_KEY;
  process.chdir(temp);
  process.env.FIRMS_MAP_KEY = 'synthetic-key';
  const fetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) =>
    String(url).startsWith('https://firms.')
      ? upstream(url)
      : fetch(url, options),
  );
  let middleware;
  firmsProxy().configureServer({
    middlewares: {
      use(_prefix, handler) {
        middleware = handler;
      },
    },
  });
  const http = createServer(middleware);
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => http.close(resolve));
    process.chdir(previous);
    if (key === undefined) delete process.env.FIRMS_MAP_KEY;
    else process.env.FIRMS_MAP_KEY = key;
    await rm(temp, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${http.address().port}`;
}

test('invalid NASA key is reported distinctly without exposing its value', async (t) => {
  let calls = 0;
  const origin = await server(t, () => {
    calls++;
    return new Response('Invalid MAP_KEY.', { status: 400 });
  });
  const response = await fetch(origin);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'invalid_key' });
  assert.equal(calls, 1);
});

test('worldwide fire responses stream with gzip and retain every detection', async (t) => {
  const date = new Date().toISOString().slice(0, 10);
  const time = new Date().toISOString().slice(11, 16).replace(':', '');
  const csv =
    'latitude,longitude,acq_date,acq_time,confidence,frp\n' +
    `1,2,${date},${time},n,4\n`.repeat(20000);
  const origin = await server(t, () => new Response(csv));
  const response = await fetch(origin, {
    headers: { 'Accept-Encoding': 'gzip' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  assert.equal(response.headers.get('content-length'), null);
  const body = await response.json();
  assert.equal(body.count, 60000);
  assert.equal(body.fires.length, 60000);
  assert.equal(body.sources.length, 3);
});
