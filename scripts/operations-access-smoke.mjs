import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';
import { demoSnapshot } from '../src/operations/demo.js';
import { TRIP_COLLECTIONS } from '../src/operations/access.js';

// Real login UI and Supabase SDK; synthetic Auth/Core responses and a small
// globe adapter. No credentials, private production data, or paid feeds used.
const origin = process.env.OPERATIONS_TEST_URL || 'http://127.0.0.1:4174';
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await mkdir('output/operations', { recursive: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  let account = 'org-a';
  let access = 'org-a';
  let forbiddenTrip = null;
  let corrupt = false;
  let holdReload = false;
  let heldRequest;
  const sent = [];
  let failSend = false;
  const accounts = new Map();
  const json = (request, value, status = 200) =>
    request.respond({
      status,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'cache-control': 'no-store',
      },
      body: JSON.stringify(value),
    });
  const snapshot = (scope, query) => {
    const result = demoSnapshot();
    result.scope =
      scope === 'platform'
        ? { kind: 'platform', org_id: null }
        : { kind: 'organization', org_id: scope };
    result.trips = [];
    for (const key of TRIP_COLLECTIONS) result[key] = [];
    for (const organization of scope === 'platform'
      ? ['org-a', 'org-b']
      : scope === 'empty-org'
        ? []
        : [scope]) {
      const fixture = demoSnapshot();
      const tripId = `trip-${organization}`;
      if (query.get('trip_id') && query.get('trip_id') !== tripId) continue;
      result.trips.push({
        ...fixture.trips[0],
        id: tripId,
        org_id: organization,
        title: `Trip ${organization}`,
      });
      for (const key of TRIP_COLLECTIONS)
        result[key].push(
          ...fixture[key].map((record) => ({
            ...record,
            trip_id: tripId,
            ...(record.id ? { id: `${organization}-${record.id}` } : {}),
            ...(record.name ? { name: `${organization}: ${record.name}` } : {}),
            ...(record.participant_ids
              ? {
                  participant_ids: record.participant_ids.map(
                    (id) => `${organization}-${id}`,
                  ),
                }
              : {}),
          })),
        );
    }
    result.page.total = result.trips.length;
    if (corrupt)
      result.participants.push({
        trip_id: 'foreign-trip',
        name: 'Must never render',
      });
    return result;
  };
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS')
      return request.respond({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,DELETE',
        },
      });
    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname.endsWith('/token')) {
        account = JSON.parse(request.postData()).email.split('@')[0];
        access = account;
        const user = {
          id: account,
          email: `${account}@example.test`,
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: { provider: 'email' },
          user_metadata: { role: 'hq_admin', org_id: 'org-b' },
          factors: [],
        };
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const encode = (value) =>
          Buffer.from(JSON.stringify(value)).toString('base64url');
        const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: account, exp, aud: 'authenticated', aal: 'aal1', role: 'authenticated', amr: [] })}.c3ludGhldGlj`;
        accounts.set(token, user);
        return json(request, {
          access_token: token,
          refresh_token: `synthetic-${account}`,
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: exp,
          user,
        });
      }
      if (url.pathname.endsWith('/user'))
        return json(
          request,
          accounts.get(request.headers().authorization?.replace('Bearer ', '')),
        );
      return json(request, {});
    }
    if (url.pathname.startsWith('/api/safetrekr/operations/trips/')) {
      assert.ok(
        accounts.has(request.headers().authorization?.replace('Bearer ', '')),
      );
      assert.equal(request.method(), 'POST');
      sent.push({ path: url.pathname, body: JSON.parse(request.postData()) });
      return json(
        request,
        failSend
          ? {}
          : {
              alert_id: 'synthetic-alert',
              push_delivery: {
                provider_accepted: 2,
                attempted: 3,
                unreached_recipients: 1,
              },
            },
        failSend ? 502 : 201,
      );
    }
    if (url.pathname === '/api/safetrekr/operations') {
      assert.ok(
        accounts.has(request.headers().authorization?.replace('Bearer ', '')),
      );
      assert.equal(url.searchParams.has('org_id'), false);
      assert.equal(url.searchParams.has('role'), false);
      if (access === 'denied') return json(request, {}, 403);
      if (forbiddenTrip && url.searchParams.get('trip_id') === forbiddenTrip)
        return json(request, {}, 404);
      if (holdReload && !url.searchParams.has('trip_id')) {
        heldRequest = request;
        return;
      }
      return json(request, snapshot(access, url.searchParams));
    }
    if (url.pathname === '/src/operations/globe.js')
      return request.respond({
        status: 200,
        contentType: 'application/javascript',
        body: `
      export async function createOperationsGlobe() {
        window.testGlobe = { snapshot: null, stopCount: 0 };
        return {
          mapMode: 'Synthetic globe',
          setSnapshot(data) { window.testGlobe.snapshot = data; },
          frameTrip() {}, focus() {}, setRole() {}, follow() {}, resetView() {},
          stopFollowing() { window.testGlobe.stopCount++; },
          flights: { setContactPresentation() {}, getContactById() { return null; } },
          cameras: { getCameras() { return []; } },
          async dispose() { window.testGlobe.snapshot = null; }
        };
      }
    `,
      });
    if (url.pathname === '/src/operations/worldControls.js')
      return request.respond({
        status: 200,
        contentType: 'application/javascript',
        body: 'export function mountWorldControls() { return { dispose() {} }; }',
      });
    if (url.origin !== origin) return request.abort();
    if (url.pathname.startsWith('/api/')) return json(request, {});
    return request.continue();
  });
  await page.goto(origin, { waitUntil: 'networkidle2' });
  const text = (selector) => page.$eval(selector, (el) => el.textContent);
  const login = async (name) => {
    await page.waitForSelector('#ops-login:not([hidden])');
    await page.type('#ops-login-form [name=email]', `${name}@example.test`);
    await page.type('#ops-login-form [name=password]', 'synthetic-password');
    await page.click('#ops-login-form button');
  };
  const ready = () =>
    page.waitForSelector('#ops-console:not([hidden]) #ops-loading[hidden]');
  const poll = () =>
    page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const openTab = (name) =>
    page.evaluate(
      (name) =>
        [...document.querySelectorAll('#ops-tabs button')]
          .find((el) => el.textContent === name)
          .click(),
      name,
    );
  const logout = async () => {
    await page.click('#ops-signout');
    await page.waitForSelector('#ops-login:not([hidden])');
    await page.waitForFunction(
      () => document.querySelector('#ops-login-form [name=email]').value === '',
    );
    assert.equal(await text('#ops-list'), '');
    assert.equal(await text('#ops-detail'), '');
    assert.equal(await page.evaluate(() => window.testGlobe.snapshot), null);
  };

  assert.match(
    await text('#ops-login'),
    /Organization administrators see only/,
  );
  await login('org-a');
  await ready();
  assert.equal(await text('#ops-access-scope'), 'ORGANIZATION VIEW');
  assert.match(await text('#ops-list'), /Trip org-a/);
  assert.doesNotMatch(await text('#ops-console'), /org-b/);
  await page.click('[data-action="broadcast"]');
  await page.type('#ops-action-form [name=title]', 'Meeting update');
  await page.type(
    '#ops-action-form [name=message]',
    'Meet in the lobby at 3 PM.',
  );
  await page.select('#ops-action-form [name=audience]', 'travelers');
  await page.click('#ops-action-form button[type=submit]');
  assert.equal(sent.length, 0, 'Review must not send');
  assert.match(await text('.ops-action-review'), /Meeting update/);
  await page.evaluate(() => {
    const f = document.getElementById('ops-action-form');
    f.requestSubmit();
    f.requestSubmit();
  });
  await page.waitForFunction(() =>
    document
      .querySelector('.ops-action-review')
      .textContent.includes('Alert created'),
  );
  assert.equal(sent.length, 1, 'Double submission must send once');
  assert.equal(sent[0].body.recipient_group, 'travelers');
  assert.match(
    await text('.ops-action-review'),
    /accepted 2 device notifications/,
  );
  await page.click('.ops-action-close');
  await page.click('[data-action="direct-group"]');
  const destination = await page.$eval(
    '#ops-action-form [name=destination]',
    (el) => el.options[1].value,
  );
  await page.select('#ops-action-form [name=destination]', destination);
  await page.$eval('#ops-action-form [name=minutes]', (el) => {
    el.value = '10';
  });
  await page.type('#ops-action-form [name=note]', 'Use the main entrance.');
  await page.click('#ops-action-form button[type=submit]');
  assert.equal(sent.length, 1);
  assert.match(await text('.ops-action-review'), /Arrive within 10 minutes/);
  await page.screenshot({ path: 'output/operations/direct-group-review.png' });
  await page.click('#ops-action-form button[type=submit]');
  await page.waitForFunction(() =>
    document
      .querySelector('.ops-action-review')
      .textContent.includes('Alert created'),
  );
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.arrival_minutes, 10);
  assert.equal(sent[1].body.destination_source, 'rally_point');
  assert.equal(sent[1].body.note, 'Use the main entrance.');
  assert.equal(
    sent[1].body.address,
    undefined,
    'Server resolves destination details',
  );
  await page.click('.ops-action-close');
  failSend = true;
  await page.click('[data-action="broadcast"]');
  await page.type('#ops-action-form [name=title]', 'Uncertain test');
  await page.type('#ops-action-form [name=message]', 'Synthetic send only.');
  await page.click('#ops-action-form button[type=submit]');
  await page.click('#ops-action-form button[type=submit]');
  await page.waitForFunction(() =>
    document
      .querySelector('#ops-action-form .ops-error')
      .textContent.includes('may already exist'),
  );
  assert.equal(
    await page.$eval('#ops-action-form button[type=submit]', (el) => el.hidden),
    true,
  );
  assert.equal(sent.length, 3, 'Uncertain sends must not retry automatically');
  failSend = false;
  await page.click('.ops-action-close');
  await openTab('Trips');
  await page.select('#ops-window', 'all');
  await page.waitForFunction(() =>
    document.querySelector('#ops-list').textContent.includes('Trip org-a'),
  );
  assert.equal(
    await text('#ops-window option[value=all]'),
    'All organization trips',
  );
  await mkdir('output/operations', { recursive: true });
  await page.screenshot({ path: 'output/operations/organization-access.png' });
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.equal(await text('#ops-access-scope'), 'ORGANIZATION VIEW');
  await page.setViewport({ width: 1440, height: 1000 });
  await page.click('#ops-list .ops-row');
  await page.waitForFunction(
    () =>
      document.querySelector('#ops-scope-title').textContent === 'Trip org-a',
  );
  await openTab('Flights');
  await page.click('#ops-list .ops-row');
  await page.focus('#ops-aircraft-form input');
  forbiddenTrip = 'trip-org-a';
  holdReload = true;
  await poll();
  await page.waitForFunction(() =>
    document
      .querySelector('#ops-list')
      .textContent.includes('Loading authorized trips'),
  );
  assert.doesNotMatch(await text('#ops-detail'), /org-a/);
  assert.equal(
    await page.evaluate(() => window.testGlobe.snapshot.participants.length),
    0,
  );
  holdReload = false;
  access = 'org-b';
  for (let attempt = 0; !heldRequest && attempt < 100; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(
    heldRequest,
    'The inaccessible trip must reload the authorized index',
  );
  await json(heldRequest, snapshot(access, new URLSearchParams()));
  await page.waitForFunction(
    () => window.testGlobe.snapshot.scope?.org_id === 'org-b',
  );
  assert.doesNotMatch(await text('#ops-console'), /org-a/);
  forbiddenTrip = null;
  await logout();

  await login('platform');
  await ready();
  assert.equal(await text('#ops-access-scope'), 'ALL ORGANIZATIONS');
  assert.match(await text('#ops-list'), /Trip org-a/);
  assert.match(await text('#ops-list'), /Trip org-b/);
  await openTab('Flights');
  await page.click('#ops-list .ops-row');
  await page.focus('#ops-aircraft-form input');
  access = 'org-b';
  await poll();
  await page.waitForFunction(
    () =>
      document.querySelector('#ops-access-scope').textContent ===
      'ORGANIZATION VIEW',
  );
  assert.doesNotMatch(await text('#ops-console'), /org-a/);
  assert.equal(await page.$('#ops-aircraft-form'), null);
  corrupt = true;
  await poll();
  await page.waitForSelector('#ops-login:not([hidden])');
  assert.match(await text('#ops-auth-error'), /could not be verified/);
  assert.equal(await text('#ops-list'), '');
  assert.equal(await page.evaluate(() => window.testGlobe.snapshot), null);
  await page.click('#ops-switch-account');
  await page.waitForFunction(
    () => document.querySelector('#ops-login-form [name=email]').value === '',
  );
  corrupt = false;
  await login('empty-org');
  await ready();
  assert.equal(await text('#ops-access-scope'), 'ORGANIZATION VIEW');
  assert.match(await text('#ops-pagination'), /0 trips/);
  await logout();
  await login('denied');
  await page.waitForFunction(() =>
    document
      .querySelector('#ops-auth-error')
      .textContent.includes('World View requires'),
  );
  assert.equal(await page.$('#ops-console:not([hidden])'), null);
  assert.deepEqual(errors, []);
  console.log(
    'Access/action browser smoke passed: organization/platform login, scope isolation, alert and direction review/send, single submission, delivery receipt, uncertain-send handling, filters, empty organization, denied access, narrow layout, permission changes, and account cleanup.',
  );
} finally {
  await browser.close();
}
