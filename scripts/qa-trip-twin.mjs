#!/usr/bin/env node
// Trip Twin browser QA (plans/trip-twin/03 §15.2). Needs a dev server:
//   npm run dev -- --host 127.0.0.1 --port 4173
//   node scripts/qa-trip-twin.mjs [--city austin] [--scenario a] [--shots]
//   node scripts/qa-trip-twin.mjs --sites   (phase 3: every hotel and venue)
// SwiftShader gives counts and relative cost only; measure fps by hand.
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { sitesForCity } from '../src/operations/tripTwin/twinSites.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--'))
    args.set(
      a.slice(2),
      process.argv[i + 1]?.startsWith('--')
        ? true
        : (process.argv[++i] ?? true),
    );
}
const BASE = process.env.TRIP_TWIN_URL || 'http://127.0.0.1:4173';
const cityKeys = args.get('city')
  ? [args.get('city')]
  : ['austin', 'dc', 'london'];
// --sites opens every site of each trip (hotel + venues) by ?site=.
const cities = args.get('sites')
  ? cityKeys.flatMap((c) => sitesForCity(c).map((s) => s.key))
  : cityKeys;
const outDir = new URL('../output/trip-twin/', import.meta.url);
await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--enable-webgl',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});
let failures = 0;
const report = [];
try {
  for (const city of cities) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // Expected: /api/firms answers 503 {error:'no_key'} without a FIRMS key;
    // the twin shows "unavailable" honestly. Only that response is allowed.
    const allowed503 = new Set();
    page.on('response', (r) => {
      if (r.status() === 503 && new URL(r.url()).pathname === '/api/firms')
        allowed503.add('firms');
    });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (/status of 503/.test(m.text()) && allowed503.size) return;
      errors.push(`console: ${m.text()}`);
    });
    const q = new URLSearchParams({
      ...(args.get('sites') ? { site: city } : { city }),
      ...(args.get('scenario') ? { scenario: args.get('scenario') } : {}),
    });
    if (args.has('reduced'))
      await page.emulateMediaFeatures([
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ]);
    await page.goto(`${BASE}/twin.html?${q}`, {
      waitUntil: 'domcontentloaded',
    });
    const shot = async (name) => {
      if (!args.has('shots') && !args.has('all-shots')) return;
      const file = new URL(`${city}-${name}.png`, outDir);
      await page.screenshot({ path: fileURLToPath(file) });
    };
    if (args.has('all-shots')) {
      await page
        .waitForFunction(() => window.__tripTwinStats?.status === 'loading', {
          timeout: 60000,
        })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      await shot('0-arriving');
      await page
        .waitForFunction(
          () =>
            performance.getEntriesByName('trip-twin:entry:dissolve').length > 0,
          { timeout: 120000 },
        )
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 450));
      await shot('1-dissolve');
    }
    await page.waitForFunction(
      () => ['ready', 'degraded'].includes(window.__tripTwinStats?.status),
      { timeout: 180000 },
    );
    await new Promise((r) => setTimeout(r, 1500));
    await shot('2-ready');
    const stats = await page.evaluate(() =>
      JSON.parse(JSON.stringify(window.__tripTwinStats)),
    );
    const bodyText = await page.evaluate(() => document.body.innerText);
    const state = stats.status;
    const ok = state === 'ready' && !errors.length;
    if (!ok) failures++;
    report.push({ city, ok, state, stats, errors });
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${city}: ${state} · buildings ${stats.buildings} · roads ${stats.roads} · osm ${stats.osmSource} · terrain ${stats.terrainSource} · dissolve ${JSON.stringify(stats.motion?.dissolve)} · ready ${Math.round(stats.timings?.readyMs || 0)} ms`,
    );
    for (const e of errors.slice(0, 8)) console.log('   ', e);
    if (args.has('shots')) {
      for (const scale of ['building', 'city']) {
        await page.click(`[data-scale="${scale}"]`);
        await new Promise((r) => setTimeout(r, 3200));
        await shot(`3-${scale}`);
      }
    }
    if (args.has('lifecycle')) {
      const before = await page.evaluate(
        () => window.testTwinViewer.scene.primitives.length,
      );
      for (let i = 0; i < 2; i++) {
        await page.click('#tt-exit');
        await page.waitForFunction(
          () => window.__tripTwinStats.status === 'idle',
          { timeout: 60000 },
        );
        const restored = await page.evaluate(() => ({
          globe: window.testTwinViewer.scene.globe.show,
          prims: window.testTwinViewer.scene.primitives.length,
        }));
        if (i === 0) await shot('4-exited');
        await page.click('#tt-exit');
        await page.waitForFunction(
          () => window.__tripTwinStats.status === 'ready',
          { timeout: 120000 },
        );
        const after = await page.evaluate(
          () => window.testTwinViewer.scene.primitives.length,
        );
        const lifecycleOk = restored.globe === true && after === before;
        if (!lifecycleOk) failures++;
        console.log(
          `   lifecycle ${i + 1}: exit restored globe=${restored.globe} prims ${before}->${restored.prims}->${after} ${lifecycleOk ? 'ok' : 'FAIL'}`,
        );
      }
    }
    report.at(-1).text = bodyText;
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(
    fileURLToPath(new URL('report.json', outDir)),
    JSON.stringify(report, null, 2),
  );
}
process.exitCode = failures ? 1 : 0;
