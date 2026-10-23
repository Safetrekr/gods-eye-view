// Trip Twin Host and Origin rules (Phase CF K3; cf/01-security.md SEC-1,
// SEC-2, SEC-14; cf/06-qa.md QA-3 T3.1–T3.4 and T3.4b; PHASE-CF-PLAN C22,
// §4.4): the pure rules as tables. No network, no files.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTRA_MAX,
  FIELD_MAX,
  allowedOrigins,
  fetchSiteOk,
  hostLists,
  hostVerdict,
  isSyncPath,
  isSyncUpgrade,
  localOnly,
  localOnlyRequest,
  machineNames,
  normalizeOrigin,
  parseAllowedHosts,
  parseHostHeader,
  todayVerdict,
  upgradeVerdict,
  wouldRefuseLine,
} from '../../../server/tripTwin/twinHosts.js';

/** The Mac Studio as it looks on the office network. */
const IFACES = {
  lo0: [
    { family: 'IPv4', address: '127.0.0.1', internal: true },
    { family: 'IPv6', address: '::1', internal: true },
  ],
  en0: [
    { family: 'IPv4', address: '192.168.1.3', internal: false },
    { family: 'IPv6', address: 'fe80::1c2b:3a4d', internal: false },
  ],
  bridge100: [{ family: 'IPv4', address: '169.254.10.2', internal: false }],
};
const LISTS = hostLists({
  port: 4173,
  ifaces: IFACES,
  hostname: 'Jesses-Mac-Studio.lan',
  bonjour: 'Jesses-Mac-Studio-2',
  extra: parseAllowedHosts('studio.example.net, 10.0.0.9:8443').entries,
});

test('hosts T3.1: the Host allowlist (loopback, LAN, .local, Bonjour, env; IPv6; port exact)', () => {
  const allowed = [
    'localhost:4173',
    '127.0.0.1:4173',
    '[::1]:4173',
    '192.168.1.3:4173',
    'jesses-mac-studio.lan:4173',
    'jesses-mac-studio.local:4173',
    'Jesses-Mac-Studio.local:4173', // upper case: compared lower-cased
    'jesses-mac-studio:4173',
    'jesses-mac-studio-2.local:4173', // Bonjour name after a clash
    'studio.example.net:4173', // TRIP_TWIN_ALLOWED_HOSTS, this port
    '10.0.0.9:8443', // TRIP_TWIN_ALLOWED_HOSTS with its own port
  ];
  const refused = [
    'evil.example:4173',
    'localhost:4174', // wrong port
    'localhost', // port 80
    '192.168.1.3', // port 80
    '169.254.10.2:4173', // link-local is not a LAN address
    '[fe80::1c2b:3a4d]:4173', // IPv6 LAN addresses are not listed
    '10.0.0.9:4173', // an env entry with a port is exact
    'localhost.:4173', // trailing dot
    'user@localhost:4173',
    'local host:4173',
    '',
    undefined,
    null,
  ];
  for (const h of allowed)
    assert.deepEqual(hostVerdict(h, LISTS), { ok: true }, `allowed: ${h}`);
  for (const h of refused)
    assert.deepEqual(
      hostVerdict(h, LISTS),
      { ok: false, reason: 'host' },
      `refused: ${h}`,
    );
  // A TLS request with no port means 443.
  const tls = hostLists({ port: 443 });
  assert.equal(hostVerdict('localhost', tls, { secure: true }).ok, true);
  assert.equal(hostVerdict('localhost', tls).ok, false);
});

test('hosts T3.2: the Origin allowlist, including an Origin equal to an evil Host (rebinding)', () => {
  const rows = [
    [{ host: 'localhost:4173', origin: 'http://localhost:4173' }, null],
    [{ host: '[::1]:4173', origin: 'http://[::1]:4173' }, null],
    [{ host: '192.168.1.3:4173', origin: 'http://192.168.1.3:4173' }, null],
    [
      {
        host: 'Jesses-Mac-Studio.local:4173',
        origin: 'http://Jesses-Mac-Studio.local:4173',
      },
      null,
    ],
    // TLS-ready (SEC-14): https origins are on the list too.
    [{ host: 'localhost:4173', origin: 'https://localhost:4173' }, null],
    // The rebinding pair: both name the attacker; the Host refuses it.
    [{ host: 'evil.example:4173', origin: 'http://evil.example:4173' }, 'host'],
    [{ host: 'localhost:4173', origin: 'http://evil.example:4173' }, 'origin'],
    [{ host: 'localhost:4173', origin: 'http://evil.example' }, 'origin'],
    [{ host: 'localhost:4173', origin: 'http://localhost:4174' }, 'origin'],
    [{ host: 'localhost:4173', origin: 'http://localhost' }, 'origin'],
    [{ host: 'localhost:4173', origin: 'ftp://localhost:4173' }, 'origin'],
    [{ host: 'localhost:4173', origin: 'http://localhost:4173/x' }, 'origin'],
    [{ host: 'localhost:4173', origin: 'not a url' }, 'origin'],
  ];
  for (const [seen, reason] of rows)
    assert.deepEqual(
      upgradeVerdict(seen, LISTS),
      reason ? { ok: false, reason } : { ok: true },
      JSON.stringify(seen),
    );
});

test('hosts T3.3: a missing or null Origin is refused by the new rule, for every peer', () => {
  for (const origin of [undefined, null, ''])
    assert.deepEqual(
      upgradeVerdict({ host: 'localhost:4173', origin }, LISTS),
      {
        ok: false,
        reason: 'no-origin',
      },
    );
  assert.deepEqual(
    upgradeVerdict({ host: 'localhost:4173', origin: 'null' }, LISTS),
    { ok: false, reason: 'null-origin' },
  );
  assert.deepEqual(normalizeOrigin('NULL'), { reason: 'null-origin' });
});

test('hosts: only the exact relay path is the relay (SEC-1); a query string is fine', () => {
  const ok = { host: 'localhost:4173', origin: 'http://localhost:4173' };
  assert.deepEqual(upgradeVerdict({ ...ok, url: '/api/twin-sync' }, LISTS), {
    ok: true,
  });
  assert.deepEqual(
    upgradeVerdict({ ...ok, url: '/api/twin-sync?v=2' }, LISTS),
    {
      ok: true,
    },
  );
  for (const url of [
    '/api/twin-sync2',
    '/api/twin-sync/x',
    '/api/twin-syncanything',
  ])
    assert.deepEqual(upgradeVerdict({ ...ok, url }, LISTS), {
      ok: false,
      reason: 'path',
    });
  assert.equal(isSyncUpgrade('/api/twin-sync2'), true); // the relay answers it
  assert.equal(isSyncPath('/api/twin-sync2'), false); // …by refusing it
  assert.equal(isSyncUpgrade('/@vite/client'), false); // Vite's own
});

test('hosts T3.4: today’s rule, unchanged: same-origin and no Origin pass, a foreign Origin is refused', () => {
  const pass = [
    { host: 'localhost:4173', origin: 'http://localhost:4173' },
    { host: '[::1]:4173', origin: 'http://[::1]:4173' },
    { host: '192.168.1.3:4173', origin: 'http://192.168.1.3:4173' },
    { host: 'localhost:4173', origin: 'https://localhost:4173' },
    { host: 'localhost:4173' }, // no Origin: passes today
    // Today a rebinding pair passes; only the new rule refuses it.
    { host: 'evil.example:4173', origin: 'http://evil.example:4173' },
  ];
  for (const seen of pass)
    assert.deepEqual(todayVerdict(seen), { ok: true }, JSON.stringify(seen));
  assert.deepEqual(
    todayVerdict({ host: 'localhost:4173', origin: 'http://127.0.0.1:4173' }),
    { ok: false, reason: 'origin-not-host' },
  );
});

test('hosts T3.4b (rule): today’s floor refuses Origin http://evil.example with Host 192.168.1.3:4173 and with Host localhost:4173', () => {
  for (const host of ['192.168.1.3:4173', 'localhost:4173']) {
    const seen = { host, origin: 'http://evil.example' };
    assert.equal(todayVerdict(seen).ok, false, host);
    assert.equal(upgradeVerdict(seen, LISTS).ok, false, host);
  }
});

test('hosts C22: machine names (hostname plain and .local, Bonjour .local); TRIP_TWIN_ALLOWED_HOSTS has no wildcards', () => {
  assert.deepEqual(
    machineNames({
      hostname: 'Jesses-Mac-Studio.local',
      bonjour: 'Jesses-Mac-Studio',
    }).sort(),
    ['jesses-mac-studio', 'jesses-mac-studio.local'],
  );
  assert.deepEqual(
    machineNames({
      hostname: 'mac-studio.lan',
      bonjour: 'Jesses-Mac-Studio-2.local',
    }).sort(),
    [
      'jesses-mac-studio-2.local',
      'mac-studio',
      'mac-studio.lan',
      'mac-studio.local',
    ],
  );
  assert.deepEqual(machineNames({ hostname: 'bad name!', bonjour: '' }), []);

  const p = parseAllowedHosts(
    ' Studio.Example.net ,10.0.0.9:8443, [fd00::3]:4173, *, *.local, .local, http://x.example, a/b, x:70000, ,',
  );
  assert.deepEqual(p.entries, [
    { name: 'studio.example.net', port: null },
    { name: '10.0.0.9', port: 8443 },
    { name: '[fd00::3]', port: 4173 },
  ]);
  assert.deepEqual(
    p.refused.map((r) => r.reason),
    [
      'wildcard',
      'wildcard',
      'wildcard',
      'not a host name',
      'not a host name',
      'bad port',
    ],
  );
  const many = parseAllowedHosts(
    Array.from({ length: EXTRA_MAX + 2 }, (_, i) => `h${i}.example`).join(','),
  );
  assert.equal(many.entries.length, EXTRA_MAX);
  assert.equal(many.refused.length, 2);
  assert.deepEqual(parseAllowedHosts(undefined), { entries: [], refused: [] });
});

test('hosts: Host and Origin parsing (default ports, IPv6, case)', () => {
  assert.equal(parseHostHeader('LOCALHOST:4173'), 'localhost:4173');
  assert.equal(parseHostHeader('localhost'), 'localhost:80');
  assert.equal(parseHostHeader('localhost', { secure: true }), 'localhost:443');
  assert.equal(parseHostHeader('[::1]:4173'), '[::1]:4173');
  assert.equal(parseHostHeader('localhost:0'), null);
  assert.equal(parseHostHeader('localhost:99999'), null);
  assert.equal(parseHostHeader(['localhost:4173']), null);
  assert.deepEqual(normalizeOrigin('http://LocalHost:4173'), {
    value: 'http://localhost:4173',
  });
  assert.deepEqual(normalizeOrigin('https://localhost'), {
    value: 'https://localhost:443',
  });
  assert.deepEqual(normalizeOrigin('http://[::1]:4173'), {
    value: 'http://[::1]:4173',
  });
  assert.deepEqual(
    [...allowedOrigins(new Set(['localhost:4173']))],
    ['http://localhost:4173', 'https://localhost:4173'],
  );
});

test('hosts §4.4: localOnly() = loopback peer, a loopback Host with the port, same-origin or no Sec-Fetch-Site', () => {
  const base = {
    remoteAddress: '127.0.0.1',
    host: 'localhost:4173',
    port: 4173,
  };
  const rows = [
    [{}, null],
    [{ secFetchSite: 'same-origin' }, null],
    [{ remoteAddress: '::1', host: '[::1]:4173' }, null],
    [{ remoteAddress: '::ffff:127.0.0.1', host: '127.0.0.1:4173' }, null],
    [{ remoteAddress: '192.168.1.40' }, 'peer'],
    [{ host: '192.168.1.3:4173' }, 'host'], // a LAN Host, even from loopback
    [{ host: 'jesses-mac-studio.local:4173' }, 'host'],
    [{ host: 'evil.example:4173' }, 'host'], // rebinding
    [{ host: 'localhost:4174' }, 'host'],
    [{ secFetchSite: 'same-site' }, 'fetch-site'], // another localhost port
    [{ secFetchSite: 'cross-site' }, 'fetch-site'],
    [{ secFetchSite: 'none' }, 'fetch-site'],
  ];
  for (const [over, reason] of rows)
    assert.deepEqual(
      localOnly({ ...base, ...over }),
      reason ? { ok: false, reason } : { ok: true },
      JSON.stringify(over),
    );
  const req = {
    socket: { remoteAddress: '127.0.0.1', localPort: 4173 },
    headers: { host: 'localhost:4173', 'sec-fetch-site': 'cross-site' },
  };
  assert.deepEqual(localOnlyRequest(req, 4173), {
    ok: false,
    reason: 'fetch-site',
  });
});

test('hosts: Sec-Fetch-Site gate (same-origin or absent only)', () => {
  for (const v of [undefined, null, '', 'same-origin'])
    assert.equal(fetchSiteOk(v), true);
  for (const v of ['same-site', 'cross-site', 'none', 'SAME-ORIGIN'])
    assert.equal(fetchSiteOk(v), false, v);
});

test('hosts: a would-refuse record is clipped, printable and has no query string', () => {
  const line = wouldRefuseLine({
    at: '2026-10-23T20:00:00.000Z',
    kind: 'http',
    mode: 'report',
    reason: 'host',
    today: 'allowed',
    effect: 'allowed',
    host: `evil.example:4173\r\nX-Injected: 1${'a'.repeat(100)}`,
    origin: undefined,
    peer: '192.168.1.40',
    path: '/api/twin-weather/now?lat=51.5&lon=-0.1',
  });
  assert.equal(line.type, 'host.would_refuse');
  assert.equal(line.host.length, FIELD_MAX);
  assert.ok(!/[\r\n]/.test(line.host));
  assert.equal(line.origin, null);
  assert.equal(line.path, '/api/twin-weather/now');
  assert.equal(line.secure, false);
});
