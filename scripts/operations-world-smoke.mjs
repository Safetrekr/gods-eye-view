import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';

// Synthetic providers exercise the real Cesium layers without keys or Core writes.
const origin = process.env.OPERATIONS_TEST_URL || 'http://127.0.0.1:4173';
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--enable-webgl',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const page = await browser.newPage();
  const errors = [];
  let savedCamera = null;
  let cameraModuleUrl = null;
  const moduleUrls = new Map();
  let configured = true;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /shader|rendering has stopped/i.test(message.text())
    )
      errors.push(message.text());
  });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    const reply = (data) =>
      request.respond({
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: 'application/json',
        body: JSON.stringify(data),
      });
    const path = url.pathname;
    if (path.startsWith('/src/data/') && !moduleUrls.has(path))
      moduleUrls.set(path, request.url());
    if (url.hostname === 'earthquake.usgs.gov' && !configured)
      return void request.respond({
        status: 503,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    if (path === '/src/data/cctv.js' && !cameraModuleUrl)
      cameraModuleUrl = request.url();
    if (path === '/api/safetrekr/providers')
      return void reply({
        traffic: false,
        fires: configured,
        ships: configured,
        cameraEditing: true,
      });
    if (path === '/api/safetrekr/cameras' && request.method() === 'POST') {
      savedCamera = JSON.parse(request.postData());
      return void reply({ added: 1, total: 1 });
    }
    if (path === '/api/opensky')
      return void reply({ time: Date.now() / 1000, states: [] });
    if (path === '/api/adsblol/mil')
      return void reply({
        ac: [
          {
            hex: 'a1b2c3',
            flight: 'TESTMIL',
            lat: 30.267,
            lon: -97.741,
            alt_baro: 12000,
            gs: 250,
            track: 90,
            seen: 0,
            seen_pos: 0,
          },
        ],
      });
    if (path.startsWith('/api/celestrak/'))
      return void request.respond({
        status: 200,
        contentType: 'text/plain',
        body: 'TEST SATELLITE\n1 25544U 98067A   26255.51782528 -.00002182  00000-0 -11606-4 0  2927\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537\n',
      });
    if (url.hostname === 'earthquake.usgs.gov')
      return void reply({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'synthetic-quake',
            geometry: { type: 'Point', coordinates: [-97.74, 30.26, 10] },
            properties: {
              mag: 3,
              time: Date.now(),
              title: 'Synthetic test earthquake',
              place: 'Sample area',
              url: 'https://earthquake.usgs.gov/',
            },
          },
        ],
      });
    if (path === '/api/firms')
      return void reply({
        fetchedAt: Date.now(),
        stale: false,
        fires: [
          {
            lat: 30.267,
            lon: -97.74,
            frp: 35,
            confidence: 'h',
            brightness: 330,
            daynight: 'D',
            acqDate: new Date().toISOString().slice(0, 10),
            acqTime: '1800',
            instrument: 'VIIRS',
            satellite: 'NOAA20',
          },
        ],
      });
    if (path === '/api/ais-live')
      return void reply({
        status: 'open',
        lastMessageAt: Date.now(),
        rows: [
          {
            mmsi: '123456789',
            name: 'Synthetic test vessel',
            lat: 30.25,
            lon: -97.74,
            speed: 10,
            course: 90,
            last_position_epoch: Date.now() / 1000,
          },
        ],
      });
    if (path === '/api/tomtom/status')
      return void reply({ hasKey: false, dailyCount: 0, budget: 40000 });
    if (path.startsWith('/api/overpass'))
      return void reply({
        elements: [
          { type: 'node', id: 1, lat: 30.26, lon: -97.75 },
          { type: 'node', id: 2, lat: 30.27, lon: -97.74 },
          { type: 'way', id: 3, nodes: [1, 2], tags: { highway: 'primary' } },
        ],
      });
    if (path === '/api/cctv/sources')
      return void reply({
        sources: [
          {
            id: 'sample-austin',
            name: 'Sample Austin camera',
            city: 'Austin',
            cityId: 'austin',
            provider: 'Synthetic fixture',
            lat: 30.267,
            lon: -97.74,
            feedType: 'image',
          },
          {
            id: 'sample-london',
            name: 'Sample London camera',
            city: 'London',
            cityId: 'london',
            provider: 'Synthetic fixture',
            lat: 51.5,
            lon: -0.12,
            feedType: 'image',
          },
          {
            id: 'sample-la',
            name: 'Sample LA camera',
            city: 'Los Angeles',
            cityId: 'ca-d7',
            provider: 'Synthetic fixture',
            lat: 34.05,
            lon: -118.25,
            feedType: 'image',
          },
        ],
      });
    if (path.startsWith('/api/cctv/stream/'))
      return void reply({
        feedType: 'image',
        frameUrl: '/api/cctv/frame/test',
        provider: 'Synthetic fixture',
      });
    if (path.startsWith('/api/cctv/frame/'))
      return void request.respond({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq8kAAAAASUVORK5CYII=',
          'base64',
        ),
      });
    void request.continue();
  });
  await mkdir('output/operations', { recursive: true });
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle2' });
  await page.waitForSelector(
    '#ops-console:not([hidden]) #ops-loading[hidden]',
    { timeout: 60000 },
  );
  await page.click('#ops-layers-button');
  assert.equal(
    await page.$$eval('[data-layer] input', (rows) => rows.length),
    8,
  );
  for (const id of [
    'military',
    'satellites',
    'ais-live-vessels',
    'traffic',
    'local-firms',
    'earthquakes',
    'cctv',
  ]) {
    await page.$eval(`[data-layer="${id}"] input`, (input) => {
      if (!input.checked) input.click();
    });
    await page.waitForFunction(
      (id) => !document.querySelector(`[data-layer="${id}"] input`).disabled,
      { timeout: 45000 },
      id,
    );
    console.log(
      id,
      await page.$eval(`[data-layer="${id}"]`, (el) => el.textContent),
    );
  }
  for (const id of [
    'military',
    'satellites',
    'ais-live-vessels',
    'local-firms',
    'earthquakes',
  ]) {
    await page.waitForFunction(
      (id) =>
        /[1-9][\d,]* loaded/.test(
          document.querySelector(`[data-layer="${id}"] .ops-feed-badge`)
            .textContent,
        ),
      { timeout: 20000 },
      id,
    );
  }
  assert.match(
    await page.$eval(
      '[data-layer="traffic"] .ops-feed-badge',
      (el) => el.textContent,
    ),
    /Simulated traffic/,
  );
  assert.ok(await page.$('#world-overlay-canvas'));
  const tracking = await page.evaluate(
    async (urls) => {
      const military = (await import(urls.military)).default;
      const satellites = (await import(urls.satellites)).default;
      const plane = military.trackById('a1b2c3', { origin: 'user' });
      const satellite = satellites.trackById(25544, { origin: 'user' });
      return {
        plane,
        satellite,
        planeReleased: military.getTrackedInfo() === null,
        satelliteTracked: !!satellites.getTrackedInfo(),
      };
    },
    {
      military: moduleUrls.get('/src/data/militaryFlights.js'),
      satellites: moduleUrls.get('/src/data/satellites.js'),
    },
  );
  assert.deepEqual(tracking, {
    plane: true,
    satellite: true,
    planeReleased: true,
    satelliteTracked: true,
  });
  await page.click('#ops-stop-follow');
  assert.equal(
    await page.evaluate(
      async (url) => (await import(url)).default.getTrackedInfo(),
      moduleUrls.get('/src/data/satellites.js'),
    ),
    null,
  );
  await page.click('#ops-frame');
  await page.$eval('.ops-world-content', (el) => (el.scrollTop = 240));
  await page.screenshot({ path: 'output/operations/world-layers.png' });
  await page.click('[data-world-tab="views"]');
  await page.$eval('.ops-world-content', (el) => (el.scrollTop = 0));
  for (const mode of [
    'normal',
    'surveillance',
    'thermal',
    'blackhot',
    'ironbow',
    'retro',
    'noir',
    'snow',
    'anime',
  ]) {
    await page.click(`[data-mode="${mode}"]`);
    await pause(600);
    assert.equal(
      await page.$eval(`[data-mode="${mode}"]`, (el) =>
        el.getAttribute('aria-pressed'),
      ),
      'true',
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.gevStyle),
      ['blackhot', 'ironbow'].includes(mode) ? 'thermal' : mode,
    );
  }
  await page.click('[data-mode="thermal"]');
  await pause(800);
  await page.screenshot({ path: 'output/operations/world-flir.png' });
  assert.match(
    await page.$eval('#ops-visual-badge', (el) => el.textContent),
    /Visual effect/,
  );
  await page.click('[data-world-tab="cameras"]');
  await page.waitForSelector('.ops-camera-directory-row');
  await page.select('select[aria-label="Camera city"]', 'london');
  assert.match(
    await page.$eval('.ops-camera-directory', (el) => el.textContent),
    /Sample London/,
  );
  await page.type('input[aria-label="Find a camera"]', '1');
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.gevStyle),
    'thermal',
  );
  await page.$eval('input[aria-label="Find a camera"]', (el) => {
    el.value = '';
    el.dispatchEvent(new Event('input'));
  });
  await page.click('.ops-add-camera summary');
  const formValues = {
    name: 'New test camera',
    city: 'Test City',
    provider: 'Sample city agency',
    url: 'https://cameras.city.gov/test.jpg',
    lat: '0',
    lon: '0',
    license: 'Test attribution',
  };
  for (const [name, value] of Object.entries(formValues))
    await page.type(`.ops-add-camera input[name="${name}"]`, value);
  await page.click('.ops-add-camera button[type="submit"]');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.ops-add-camera button')].some(
      (el) => el.textContent.startsWith('Reload view') && !el.hidden,
    ),
  );
  assert.equal(savedCamera[0].lat, 0);
  assert.equal(savedCamera[0].url, formValues.url);
  await page.click('.ops-add-camera summary');
  await page.$eval('.ops-world-content', (el) => (el.scrollTop = 0));
  await page.screenshot({ path: 'output/operations/world-cameras.png' });
  await page.click('.ops-camera-directory-row');
  await page.waitForSelector('#ops-layers[hidden]');
  await page.waitForFunction(
    async (url) =>
      (await import(url)).default.getUIState().activeCameraId ===
      'sample-london',
    { timeout: 15000 },
    cameraModuleUrl,
  );
  await page.waitForSelector('.ops-camera-player[open] img');
  await page.click('button[aria-label="Close camera"]');
  await page.click('#ops-layers-button');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  const box = await page.$eval('#ops-layers', (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  assert.ok(
    box.left >= 0 && box.right <= 390 && box.top >= 0 && box.bottom <= 844,
  );
  assert.ok(
    box.bottom <=
      (await page.$eval(
        '.ops-map-controls',
        (el) => el.getBoundingClientRect().top,
      )),
  );
  await page.screenshot({ path: 'output/operations/world-mobile.png' });
  await page.keyboard.press('Escape');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'ops-layers-button',
  );
  await page.click('#ops-signout');
  await page.waitForSelector('#ops-login:not([hidden])');
  for (const selector of [
    '#cesiumContainer',
    '#ops-layers',
    '#ops-world-shortcuts',
  ])
    assert.equal(await page.$eval(selector, (el) => el.children.length), 0);
  assert.equal(await page.$('#world-overlay-root'), null);
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.gevStyle),
    undefined,
  );
  configured = false;
  await page.click('#ops-demo');
  await page.waitForSelector(
    '#ops-console:not([hidden]) #ops-loading[hidden]',
    { timeout: 60000 },
  );
  await page.click('#ops-layers-button');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-layer="local-firms"] .ops-feed-badge')
        .textContent === 'Key needed',
  );
  assert.match(
    await page.$eval('[data-layer="ais-live-vessels"]', (el) => el.textContent),
    /AISSTREAM_API_KEY/,
  );
  await page.$eval('[data-layer="earthquakes"] input', (el) => el.click());
  await page.waitForFunction(() =>
    document
      .querySelector('[data-layer="earthquakes"] .ops-error')
      .textContent.includes('Could not start'),
  );
  assert.equal(
    await page.$eval('[data-layer="earthquakes"] input', (el) => el.checked),
    false,
  );
  await page.click('#ops-signout');
  await page.waitForSelector('#ops-login:not([hidden])');
  assert.deepEqual(errors, []);
  console.log(
    'World controls smoke passed: seven enabled layers, nine rendered styles, city selection, local camera form, keyboard/mobile controls, missing-key states, logout cleanup and re-entry. Provider data was synthetic.',
  );
} finally {
  await browser.close();
}
