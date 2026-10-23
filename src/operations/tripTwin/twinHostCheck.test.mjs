// Trip Twin host check in report mode (Phase CF K3 gate; PHASE-CF-PLAN
// S-11, S-1, S-2; cf/01-security.md SEC-1, SEC-2, SEC-14, SEC-15;
// cf/06-qa.md QA-3 T3.4b; review/cf/02-security.md B1, S14, N2, N7). Real
// `ws` clients against the relay's own upgrade handler on a loopback HTTP
// server, real HTTP requests against the proxies' guard, and the
// would-refuse file. Every folder is a throwaway one; nothing reaches the
// network (the proxies get a fake upstream) or the live wall's files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { fakeUpgrade, liveTwinServer } from './twinTestKit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-hosts-test-'));
process.env.TMPDIR = path.join(scratch, 'tmp');
process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, 'data');
process.env.TRIP_TWIN_AUDIT_DIR = path.join(scratch, 'audit-default');
fs.mkdirSync(process.env.TMPDIR);
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const { createRelay, createTwinUpgrade, twinSyncRelay } =
  await import('../../../server/tripTwin/syncRelay.js');
const { WOULD_REFUSE_FILE, createHostCheck, hostCheckMode, useHostCheck } =
  await import('../../../server/tripTwin/twinHostCheck.js');
const { twinWeatherProxy } =
  await import('../../../server/tripTwin/weatherProxy.js');
const { twinRoutingProxy } =
  await import('../../../server/tripTwin/routingProxy.js');

/** The Mac Studio's names: LAN IP, a DHCP hostname, a Bonjour clash name. */
const STUDIO_OS = {
  networkInterfaces: () => ({
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    en0: [{ family: 'IPv4', address: '192.168.1.3', internal: false }],
  }),
  hostname: () => 'Jesses-Mac-Studio.lan',
};
const BONJOUR = () => 'Jesses-Mac-Studio-2';

let n = 0;
/** A fresh audit folder and a host check that writes into it. */
function studioCheck({ env = {}, log = () => {}, osi = STUDIO_OS, now } = {}) {
  const dir = path.join(scratch, `audit-${++n}`);
  const check = createHostCheck({
    env: { TRIP_TWIN_AUDIT_DIR: dir, ...env },
    osi,
    bonjour: BONJOUR,
    log,
    ...(now ? { now } : {}),
  });
  return { check, dir, file: path.join(dir, WOULD_REFUSE_FILE) };
}
const linesOf = (file) =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

/** Plugins on a live loopback server, sharing one injected host check. */
async function live(plugins, check) {
  process.env.TRIP_TWIN_DATA_DIR = path.join(scratch, `data-${++n}`);
  return liveTwinServer({ plugins, before: (s) => useHostCheck(s, check) });
}

/** One real ws handshake: 'open' or 'refused'. */
function dial(port, { host, origin, pathname = '/api/twin-sync' } = {}) {
  return new Promise((resolve) => {
    const headers = {};
    if (host) headers.Host = host;
    if (origin) headers.Origin = origin;
    const ws = new WebSocket(`ws://127.0.0.1:${port}${pathname}`, { headers });
    const timer = setTimeout(() => {
      ws.terminate();
      resolve('timeout');
    }, 3000);
    const done = (v) => {
      clearTimeout(timer);
      resolve(v);
    };
    ws.once('open', () => {
      ws.close();
      done('open');
    });
    ws.once('unexpected-response', () => {
      ws.terminate();
      done('refused');
    });
    ws.once('error', () => done('refused'));
  });
}

test('host check: TRIP_TWIN_HOST_CHECK has one mode in K3; enforce and unknown values run report and say so', () => {
  assert.deepEqual(hostCheckMode({}), {
    mode: 'report',
    asked: null,
    note: null,
  });
  assert.equal(
    hostCheckMode({ TRIP_TWIN_HOST_CHECK: 'report' }).mode,
    'report',
  );
  const enforce = hostCheckMode({ TRIP_TWIN_HOST_CHECK: 'enforce' });
  assert.equal(enforce.mode, 'report');
  assert.match(enforce.note, /K12/);
  const odd = hostCheckMode({ TRIP_TWIN_HOST_CHECK: 'off' });
  assert.equal(odd.mode, 'report');
  assert.match(odd.note, /unknown/);
  const said = [];
  studioCheck({
    env: { TRIP_TWIN_HOST_CHECK: 'off' },
    log: (e, d) => said.push([e, d]),
  });
  const boot = said.find(([e]) => e === 'hosts.check')[1];
  assert.equal(boot.mode, 'report');
  assert.equal(boot.asked, 'off');
});

test('host check S-2: wildcards in TRIP_TWIN_ALLOWED_HOSTS are refused and logged at boot; real names are allowed', () => {
  const said = [];
  const { check } = studioCheck({
    env: { TRIP_TWIN_ALLOWED_HOSTS: 'venue-studio.example, *, .local' },
    log: (e, d) => said.push([e, d]),
  });
  const boot = said.find(([e]) => e === 'hosts.check')[1];
  assert.deepEqual(boot.allowedHostsExtra, ['venue-studio.example']);
  assert.deepEqual(
    boot.allowedHostsRefused.map((r) => r.reason),
    ['wildcard', 'wildcard'],
  );
  const lists = check.lists(4173);
  assert.ok(lists.hosts.has('venue-studio.example:4173'));
  assert.ok(
    ![...lists.hosts].some((h) => h.includes('*') || h.startsWith('.')),
  );
});

test('host check S-1: TRIP_TWIN_AUDIT_DIR inside the repo or Vite’s root, or relative, is refused; nothing is written', () => {
  const viteRoot = path.join(scratch, 'vite-root');
  fs.mkdirSync(viteRoot, { recursive: true });
  for (const [dir, why] of [
    [path.join(REPO, 'tmp-audit-should-not-exist'), /inside the repo/],
    [path.join(viteRoot, 'logs'), /inside Vite's root/],
    ['relative/audit', /not an absolute path/],
  ]) {
    const said = [];
    const check = createHostCheck({
      env: { TRIP_TWIN_AUDIT_DIR: dir },
      viteRoot,
      osi: STUDIO_OS,
      bonjour: BONJOUR,
      log: (e, d) => said.push([e, d]),
    });
    const boot = said.find(([e]) => e === 'hosts.check')[1];
    assert.equal(boot.wouldRefuse, null, dir);
    assert.match(boot.auditDirRefused.reason, why);
    check.record({ type: 'host.would_refuse', reason: 'host' });
    assert.ok(
      said.some(([e]) => e === 'host.would_refuse'),
      'still in the dev log',
    );
    assert.equal(fs.existsSync(dir), false, `nothing created at ${dir}`);
  }
});

test('host check S14: would-refuse lines are JSONL in a 0700 folder and a 0600 file, at most 60 a minute', () => {
  let t = Date.parse('2026-10-23T20:00:00Z');
  const { check, dir, file } = studioCheck({ now: () => t });
  for (let i = 0; i < 70; i++) check.record({ type: 'host.would_refuse', i });
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(linesOf(file).length, 60);
  t += 60_000;
  check.record({ type: 'host.would_refuse', i: 70 });
  const last = linesOf(file).at(-1);
  assert.equal(last.i, 70);
  assert.equal(last.dropped, 10, 'the dropped count rides on the next line');
  assert.equal(check.status().wouldRefuse.lines, 61);
});

test('host check C22: the lists are computed per request (memo 1 s): a new DHCP address is allowed a second later', () => {
  let t = 0;
  let ip = '192.168.1.3';
  const osi = {
    networkInterfaces: () => ({
      en0: [{ family: 'IPv4', address: ip, internal: false }],
    }),
    hostname: () => 'jesses-mac-studio.local',
  };
  const { check } = studioCheck({ osi, now: () => t });
  assert.ok(check.lists(4173).hosts.has('192.168.1.3:4173'));
  ip = '192.168.1.77';
  t += 500;
  assert.ok(!check.lists(4173).hosts.has('192.168.1.77:4173'), 'memo');
  t += 600;
  assert.ok(check.lists(4173).hosts.has('192.168.1.77:4173'));
  assert.ok(!check.lists(4173).hosts.has('192.168.1.3:4173'));
});

test('upgrade T3.4b (real ws, report): Origin http://evil.example with Host 192.168.1.3:4173 and with Host localhost:4173 is refused', async () => {
  const { check, file } = studioCheck();
  const srv = await live([twinSyncRelay()], check);
  try {
    for (const host of [
      '192.168.1.3:4173',
      'localhost:4173',
      `localhost:${srv.port}`,
    ])
      assert.equal(
        await dial(srv.port, { host, origin: 'http://evil.example' }),
        'refused',
        host,
      );
    // Each is also a new-rule refusal, recorded as refused today too.
    const lines = linesOf(file);
    assert.equal(lines.length, 3);
    for (const l of lines) {
      assert.equal(l.kind, 'upgrade');
      assert.equal(l.mode, 'report');
      assert.equal(l.today, 'refused');
      assert.equal(l.effect, 'refused');
    }
    assert.deepEqual(
      lines.map((l) => l.reason),
      ['host', 'host', 'origin'],
    );
  } finally {
    await srv.close();
  }
});

test('upgrade (real ws, report): no would-refuse for localhost, 127.0.0.1, [::1], the LAN IP, the .local name or the Bonjour name', async () => {
  const { check, file } = studioCheck();
  const srv = await live([twinSyncRelay()], check);
  try {
    for (const name of [
      'localhost',
      '127.0.0.1',
      '[::1]',
      '192.168.1.3',
      'jesses-mac-studio.local',
      'jesses-mac-studio-2.local',
    ]) {
      const host = `${name}:${srv.port}`;
      assert.equal(
        await dial(srv.port, { host, origin: `http://${host}` }),
        'open',
        host,
      );
    }
    assert.deepEqual(linesOf(file), [], 'no would-refuse line');
    assert.equal(fs.existsSync(file), false, 'the file is not even created');
  } finally {
    await srv.close();
  }
});

test('upgrade (real ws, report): Host evil.example:4173 is still served by today’s rule, and a would-refuse line is in the file', async () => {
  const { check, file } = studioCheck();
  const srv = await live([twinSyncRelay()], check);
  try {
    const pairs = [
      { host: 'evil.example:4173', origin: 'http://evil.example:4173' },
      {
        host: `evil.example:${srv.port}`,
        origin: `http://evil.example:${srv.port}`,
      },
      { host: `localhost:${srv.port}` }, // no Origin: allowed today
    ];
    for (const p of pairs)
      assert.equal(await dial(srv.port, p), 'open', p.host);
    const lines = linesOf(file);
    assert.deepEqual(
      lines.map((l) => [l.host, l.reason, l.today, l.effect]),
      [
        ['evil.example:4173', 'host', 'allowed', 'allowed'],
        [`evil.example:${srv.port}`, 'host', 'allowed', 'allowed'],
        [`localhost:${srv.port}`, 'no-origin', 'allowed', 'allowed'],
      ],
    );
    assert.equal(lines[0].type, 'host.would_refuse');
    assert.equal(lines[0].peer, '127.0.0.1');
    assert.equal(lines[0].path, '/api/twin-sync');
    assert.equal(lines[0].secure, false);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    await srv.close();
  }
});

test('upgrade (real ws): a look-alike path /api/twin-sync2 is refused; Vite’s own upgrades are left alone', async () => {
  const { check, file } = studioCheck();
  const srv = await live([twinSyncRelay()], check);
  try {
    const host = `localhost:${srv.port}`;
    assert.equal(
      await dial(srv.port, {
        host,
        origin: `http://${host}`,
        pathname: '/api/twin-sync2',
      }),
      'refused',
    );
    assert.deepEqual(
      linesOf(file).map((l) => [l.reason, l.today, l.effect]),
      [['path', 'allowed', 'refused']],
    );
  } finally {
    await srv.close();
  }
  const relay = createRelay();
  const up = createTwinUpgrade({ relay, check });
  const u = fakeUpgrade({ url: '/@vite/client' });
  assert.equal(up(u.req, u.socket, u.head), false);
  assert.equal(u.verdict, 'untouched');
});

test('upgrade SEC-14: each connection records secure; an https Origin on TLS is on the new list', () => {
  const { check, file } = studioCheck();
  const relay = createRelay();
  const up = createTwinUpgrade({ relay, check });
  const tls = fakeUpgrade({
    origin: 'https://localhost:4173',
    encrypted: true,
    localPort: 4173,
  });
  up(tls.req, tls.socket, tls.head);
  const plain = fakeUpgrade({ localPort: 4173 });
  up(plain.req, plain.socket, plain.head);
  assert.equal(tls.verdict, 'accepted');
  assert.equal(plain.verdict, 'accepted');
  assert.deepEqual(
    relay.connections().map((c) => c.secure),
    [true, false],
  );
  assert.deepEqual(linesOf(file), [], 'both pass the new rule too');
  // A TLS upgrade the new rule would refuse is recorded with secure: true.
  const odd = fakeUpgrade({
    host: 'evil.example:4173',
    origin: 'https://evil.example:4173',
    encrypted: true,
    localPort: 4173,
  });
  up(odd.req, odd.socket, odd.head);
  assert.equal(odd.verdict, 'accepted');
  assert.equal(linesOf(file)[0].secure, true);
});

/** A fake upstream: answers like MET Norway / Nominatim and counts calls. */
function fakeUpstream() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ properties: {}, address: { road: 'Main Street' } }),
      text: async () => '',
    };
  };
  return { calls, fetchImpl };
}

test('HTTP guard (fetch-metadata): a cross-site GET to a proxy gets 403 and never reaches upstream; no CORS headers', async () => {
  const said = [];
  const { check, file } = studioCheck({ log: (e, d) => said.push([e, d]) });
  const up = fakeUpstream();
  const srv = await live(
    [
      twinWeatherProxy({ fetchImpl: up.fetchImpl }),
      twinRoutingProxy({ fetchImpl: up.fetchImpl }),
      twinSyncRelay(),
    ],
    check,
  );
  try {
    const host = `localhost:${srv.port}`;
    const paths = [
      '/api/twin-weather/now?lat=51.5&lon=-0.12',
      '/api/twin-place?lat=51.5&lon=-0.12',
      '/api/twin-sync/info',
    ];
    for (const p of paths)
      for (const site of ['cross-site', 'same-site', 'none']) {
        const r = await srv.request(p, {
          headers: { host, 'sec-fetch-site': site },
        });
        assert.equal(r.status, 403, `${site} ${p}`);
        assert.equal(r.json.ok, false);
        assert.equal(r.headers['access-control-allow-origin'], undefined);
      }
    // POST /api/twin-path, cross-site: refused before the body is read.
    const post = await srv.request('/api/twin-path', {
      method: 'POST',
      headers: {
        host,
        'sec-fetch-site': 'cross-site',
        'content-type': 'text/plain',
      },
      body: JSON.stringify({ points: [] }),
    });
    assert.equal(post.status, 403);
    // A path the route matches case-insensitively is guarded as well.
    const upper = await srv.request('/API/TWIN-WEATHER/now?lat=1&lon=1', {
      headers: { host, 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(upper.status, 403);
    assert.deepEqual(up.calls, [], 'upstream never called');
    // Same-origin, and no Sec-Fetch-Site at all (old Safari, Node), pass.
    for (const headers of [
      { host, 'sec-fetch-site': 'same-origin' },
      { host },
    ]) {
      const r = await srv.request('/api/twin-weather/now?lat=51.5&lon=-0.12', {
        headers,
      });
      assert.equal(r.status, 200, JSON.stringify(headers));
      assert.equal(r.headers['access-control-allow-origin'], undefined);
    }
    const place = await srv.request('/api/twin-place?lat=51.5&lon=-0.12', {
      headers: { host, 'sec-fetch-site': 'same-origin' },
    });
    assert.equal(place.status, 200);
    assert.equal(place.json.name, 'Main Street');
    const refused = said.filter(([e]) => e === 'http.refused');
    assert.equal(refused.length, 11);
    assert.ok(
      refused.every(([, d]) => d.reason === 'fetch-site' && !('lat' in d)),
    );
    assert.deepEqual(linesOf(file), [], 'allowed Host: no would-refuse line');
  } finally {
    await srv.close();
  }
});

test('HTTP guard (report): a Host the new list would refuse is served and recorded; allowed Hosts are not recorded', async () => {
  const { check, file } = studioCheck();
  const up = fakeUpstream();
  const srv = await live(
    [twinWeatherProxy({ fetchImpl: up.fetchImpl })],
    check,
  );
  try {
    for (const name of [
      'localhost',
      '192.168.1.3',
      'jesses-mac-studio.local',
      'jesses-mac-studio-2.local',
    ]) {
      const r = await srv.request('/api/twin-weather/now?lat=51.5&lon=-0.12', {
        headers: {
          host: `${name}:${srv.port}`,
          'sec-fetch-site': 'same-origin',
        },
      });
      assert.equal(r.status, 200, name);
    }
    assert.deepEqual(linesOf(file), []);
    const r = await srv.request('/api/twin-weather/now?lat=51.5&lon=-0.12', {
      headers: { host: 'evil.example:4173', 'sec-fetch-site': 'same-origin' },
    });
    assert.equal(r.status, 200, 'report: today has no Host check here');
    assert.deepEqual(
      linesOf(file).map((l) => [
        l.kind,
        l.host,
        l.reason,
        l.today,
        l.effect,
        l.path,
      ]),
      [
        [
          'http',
          'evil.example:4173',
          'host',
          'allowed',
          'allowed',
          '/api/twin-weather/now',
        ],
      ],
    );
  } finally {
    await srv.close();
  }
});

test('/api/twin-sync/info: hostAllowed and reason; no addresses for a refused Host', async () => {
  const { check } = studioCheck();
  const srv = await live([twinSyncRelay()], check);
  try {
    const ok = await srv.request('/api/twin-sync/info', {
      headers: { host: `192.168.1.3:${srv.port}` },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.ok, true);
    assert.equal(ok.json.hostAllowed, true);
    assert.equal(ok.json.reason, null);
    assert.equal(ok.json.hostCheck, 'report');
    assert.deepEqual(ok.json.addresses, ['192.168.1.3']);
    const no = await srv.request('/api/twin-sync/info', {
      headers: { host: 'evil.example:4173' },
    });
    assert.equal(no.status, 200);
    assert.equal(no.json.hostAllowed, false);
    assert.equal(no.json.reason, 'host');
    assert.deepEqual(no.json.addresses, []);
    assert.ok(!no.body.includes('192.168.1.3'), 'no LAN address in the body');
  } finally {
    await srv.close();
  }
});
