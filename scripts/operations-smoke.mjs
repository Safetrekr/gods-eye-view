import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';

const origin = process.env.OPERATIONS_TEST_URL || 'http://127.0.0.1:4173';
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--enable-webgl',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/opensky') {
      const time = Math.floor(Date.now() / 1000);
      const state = (id, callsign, lng) => [
        id,
        callsign,
        'United States',
        time,
        time,
        lng,
        30.267,
        1000,
        false,
        100,
        90,
        0,
        null,
        1000,
        '2000',
        false,
        0,
      ];
      void request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          time,
          states: [
            state('a1b2c3', 'TEST123', -97.741),
            state('d4e5f6', 'OTHER456', -97.744),
          ],
        }),
      });
    } else void request.continue();
  });
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(origin, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#ops-login:not([hidden])');
  assert.equal(await page.$('#ops-console:not([hidden])'), null);
  await mkdir('output/operations', { recursive: true });
  await page.screenshot({ path: 'output/operations/login.png' });
  await page.click('#ops-demo');
  await page.waitForSelector(
    '#ops-console:not([hidden]) #ops-loading[hidden]',
    { timeout: 60000 },
  );
  assert.equal(
    await page.$eval('#ops-environment', (el) => el.textContent),
    'SIMULATED DATA · SAMPLE TRIP',
  );
  assert.match(
    await page.$eval('#ops-totals', (el) => el.textContent),
    /4\/5 people located/,
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('#ops-tabs button')]
      .find((el) => el.textContent === 'People')
      .click(),
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('#ops-list .ops-row')]
      .find((el) => el.textContent.includes('Casey Morgan'))
      .click(),
  );
  assert.match(
    await page.$eval('#ops-detail', (el) => el.textContent),
    /Last known/,
  );
  assert.match(await page.$eval('#ops-detail', (el) => el.textContent), /8%/);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await page.screenshot({ path: 'output/operations/worldview.png' });
  await page.evaluate(() =>
    [...document.querySelectorAll('#ops-tabs button')]
      .find((el) => el.textContent === 'Flights')
      .click(),
  );
  await page.click('#ops-list .ops-row');
  assert.match(
    await page.$eval('#ops-detail', (el) => el.textContent),
    /ICAO24 address/,
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('#ops-detail button')]
      .find((el) => el.textContent === 'Enable live flight layer')
      .click(),
  );
  await page.waitForFunction(
    async () => {
      const flights = (await import('/src/data/flights.js')).default;
      return (
        flights.getContactById('a1b2c3') &&
        flights.getDetectableObjects({ maxCount: 20 }).length === 2
      );
    },
    { timeout: 30000 },
  );
  await page.type('#ops-aircraft-form input[name="icao"]', 'a1b2c3');
  await page.click('#ops-aircraft-form input[type="checkbox"]');
  await page.click('#ops-aircraft-form button[type="submit"]');
  await page.waitForFunction(() =>
    document
      .getElementById('ops-detail')
      .textContent.includes('Staff linked: A1B2C3'),
  );
  await page.click('#ops-list > .ops-checkbox input');
  await page.waitForFunction(
    async () => {
      const objects = (
        await import('/src/data/flights.js')
      ).default.getDetectableObjects({ maxCount: 20 });
      return objects.length === 1 && objects[0].sourceId === 'a1b2c3';
    },
    { timeout: 10000 },
  );
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: 'output/operations/mobile.png' });
  await page.click('#ops-signout');
  await page.waitForSelector('#ops-login:not([hidden])');
  assert.equal(await page.$eval('#ops-list', (el) => el.textContent), '');
  assert.equal(await page.$eval('#ops-detail', (el) => el.textContent), '');
  assert.equal(await page.$('#cesiumContainer canvas'), null);
  await page.click('#ops-demo');
  await page.waitForSelector(
    '#ops-console:not([hidden]) #ops-loading[hidden]',
    { timeout: 60000 },
  );
  await page.click('#ops-signout');
  await page.waitForSelector('#ops-login:not([hidden])');
  assert.deepEqual(errors, []);
  console.log(
    'Operations browser smoke passed: login gate, synthetic globe, stale fix, battery, aircraft association and map filter, narrow layout, private data cleanup and scene re-entry.',
  );
} finally {
  await browser.close();
}
