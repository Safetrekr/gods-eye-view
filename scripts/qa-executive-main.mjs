#!/usr/bin/env node
// SafeTrekr Executive B4a: MAIN (its own page, EP-52) and the roster map,
// beat by beat, headless.
//   node scripts/qa-executive-main.mjs --dir <fresh scratch folder>
//     [--out <folder>] [--beats 0,1,2,3,4,5] [--settle 25000]
// Reuses qa-executive-walls.mjs's server, room and beat times (imported,
// not edited). Port 4198 only (strict: refuses if busy; never 4173, 4191 or
// 4199). TRIP_TWIN_DATA_DIR, TRIP_TWIN_AUDIT_DIR and TMPDIR sit in --dir,
// which must not exist yet. Saves <out>/beatN-main.png and
// beatN-roster.png and results-main.json. Checks per shot: SAMPLE shown;
// MAIN carries no roster name, intel title, post or DL reason (DOM text);
// the OSM notice wherever a path is drawn; and on MAIN: one counter, the
// watch line on one line (or broken only at a ·), rows in the storyboard's
// words, the map mode (3D site, flat or neutral field) with the 3D canvas
// hidden whenever the top row has no site twin. The server is stopped at
// the end (and on any exit).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import {
  openRoom,
  SHOWCASE,
  SITE_LAYERS,
  startExecServer,
} from './qa-executive-walls.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d = null) =>
  argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// --port (B7: one isolated port for every capture), else the default.
const PORT = Number(arg('port', 4198));
const OUT = path.resolve(
  arg('out') ||
    path.join(ROOT, '..', 'plans', 'trip-twin', 'executive', 'review', 'b4'),
);
const DIR = arg('dir') ? path.resolve(arg('dir')) : null;
const BEATS = (arg('beats') || '0,1,2,3,4,5').split(',').map(Number);
const WALLS = [
  { slot: 1, ex: 'main', session: 'site', name: 'main' },
  { slot: 4, ex: 'roster', session: 'trips', name: 'roster' },
];
/** What MAIN's map shows at each showcase moment (EP-52 §States). */
const MAP_MODE = {
  0: 'field',
  1: '3d',
  2: '3d',
  3: '3d',
  4: 'flat',
  5: 'field',
};
/** The storyboard's words on MAIN at each beat (EP-20, EP-36 §2). */
const MAIN_WORDS = {
  0: [/DAILY BRIEF 1200Z · 7 LEGS TODAY/, /No active situations/],
  1: [/KESTREL/, /Lunch 1230L/, /Barton Springs Rd side/, /ACCEPTED/],
  2: [/ATLAS/, /DL: NON-CONCUR/, /original plan, \+1 post north door/],
  3: [/WREN/, /NO READ 10 MIN · CALLING/],
  4: [/SWIFT 1–2/, /No change/, /READ/, /no 3D site twin/],
  // B7 #5 (F1): the daily SITREP signature moves the stamp to 0100Z.
  5: [/CLOSED TODAY · 6/, /214/, /Last verified by a human 0100Z · VALE/],
};

const FLAGS = [
  '--enable-webgl',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

function forbiddenStrings(day) {
  const out = new Set();
  for (const p of Object.values(day.people)) out.add(p.name);
  for (const s of day.watch.staff) out.add(s.name);
  for (const b of Object.values(day.bundles)) {
    if (b.title?.length >= 12) out.add(b.title);
    for (const p of b.posts || []) if (p.text?.length >= 12) out.add(p.text);
  }
  for (const e of day.events)
    if (e.type === 'dl.respond' && e.reason) out.add(e.reason);
  return [...out].filter(Boolean);
}

/** Visible text of the page, and MAIN's own layout facts. */
async function inspect(page) {
  return page.evaluate(() => {
    const vis = (n) => {
      for (let e = n; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (e.hidden) return false;
      }
      return true;
    };
    const parts = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode())
      if (n.nodeValue.trim() && vis(n.parentElement)) parts.push(n.nodeValue);
    const text = parts.join(' ').replace(/\s+/g, ' ');
    // A dot line breaks only between its segments; report the line count.
    const lines = (sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const tops = new Set(
        [...n.querySelectorAll('.seg')].map((s) =>
          Math.round(s.getBoundingClientRect().top),
        ),
      );
      const midBreak = [...n.querySelectorAll('.seg')].some(
        (s) => s.getClientRects().length > 1,
      );
      return { lines: tops.size, midBreak };
    };
    const cz = document.getElementById('cesiumContainer');
    const cr = cz?.getBoundingClientRect();
    const mapEl = document.querySelector('.exm-map');
    const mr = mapEl?.getBoundingClientRect();
    return {
      text,
      paths: document.body.dataset.exPaths === '1',
      mapMode: document.body.dataset.exMainMap ?? null,
      canvasVisible: cz ? getComputedStyle(cz).visibility !== 'hidden' : false,
      canvasInMap:
        cr && mr
          ? Math.abs(cr.left - mr.left) < 3 &&
            Math.abs(cr.top - mr.top) < 3 &&
            Math.abs(cr.right - mr.right) < 3 &&
            Math.abs(cr.bottom - mr.bottom) < 3
          : null,
      counters: document.querySelectorAll('.exm-counter').length,
      counterLines: document.querySelectorAll('.ex-main-cline').length,
      watch: lines('.exm-watch'),
      site: globalThis.tripTwin?.siteKey ?? null,
      scene: document.body.dataset.exScene ?? null,
    };
  });
}

async function main() {
  must(DIR, '--dir <fresh scratch folder> is required');
  must(!fs.existsSync(DIR), `--dir must be fresh: ${DIR} exists`);
  fs.mkdirSync(OUT, { recursive: true });
  const day = JSON.parse(
    fs.readFileSync(
      path.join(
        ROOT,
        'src/operations/tripTwin/products/executive/data/day.json',
      ),
      'utf8',
    ),
  );
  const BAD = forbiddenStrings(day);
  console.log(`executive server on :${PORT} · scratch ${DIR}`);
  const server = await startExecServer({ dir: DIR, port: PORT });
  const base = server.url;
  const results = [];
  let browser = null;
  let room = null;
  try {
    room = await openRoom(base);
    for (const w of WALLS) {
      const a = await room.cmd({
        type: 'screens',
        target: w.slot,
        patch: { role: w.session },
      });
      must(a.ok !== false, `role on S${w.slot}: ${a.error || a.code}`);
      if (w.session === 'site') {
        const l = await room.cmd({
          type: 'screens',
          target: w.slot,
          patch: { layers: SITE_LAYERS, textScale: 2 },
        });
        must(l.ok !== false, `layers on S${w.slot}: ${l.error || l.code}`);
      }
      const r = await room.loop({
        type: 'wall.role',
        slot: w.slot,
        role: w.ex,
      });
      must(r.ok, `wall.role ${w.ex} on S${w.slot}: ${r.code || r.error}`);
    }
    browser = await puppeteer.launch({ headless: true, args: FLAGS });
    const pages = [];
    for (const w of WALLS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      page.setDefaultNavigationTimeout(180000);
      await page.setViewport({ width: 1920, height: 1080 });
      page.on('pageerror', (e) =>
        console.log(
          `  page error S${w.slot}: ${String(e?.message || e).slice(0, 200)}`,
        ),
      );
      await page.goto(
        `${base}/twin-executive.html?view=screen&slot=${w.slot}&setup=${room.setup}&city=austin&scenario=baseline`,
        { waitUntil: 'domcontentloaded' },
      );
      pages.push({ w, page });
    }
    for (const { w, page } of pages)
      await page.waitForFunction(
        (ex) => document.body.dataset.exRole === ex,
        { timeout: 180000 },
        w.ex,
      );
    await sleep(Number(arg('settle', 25000)));
    for (const b of BEATS) {
      const target = SHOWCASE[b];
      await room.loop({ type: 'clock.pause' });
      const r = await room.loop({ type: 'clock.jump', to: target });
      if (!r.ok && r.code === 'I12_TIME') {
        const ask = await room.loop({ type: 'reset' });
        if (ask.ask) await room.loop({ type: 'confirm', id: ask.ask.id });
        await room.loop({ type: 'clock.jump', to: target });
      }
      for (const { page } of pages)
        await page
          .waitForFunction(
            (t) => document.body.dataset.exSim === t,
            { timeout: 30000 },
            target,
          )
          .catch(() => {});
      const mainPage = pages.find((p) => p.w.ex === 'main').page;
      if (MAP_MODE[b] === '3d')
        await mainPage
          .waitForFunction(() => document.body.dataset.exScene === 'settled', {
            timeout: 120000,
          })
          .catch(() => console.log('  MAIN: scene not settled'));
      await sleep(Number(arg('hold', MAP_MODE[b] === '3d' ? 16000 : 9000)));
      for (const { w, page } of pages) {
        const file = path.join(OUT, `beat${b}-${w.name}.png`);
        await page.screenshot({ path: file });
        const f = await inspect(page);
        const sample = /\bSAMPLE\b/.test(f.text);
        const osm = !f.paths || /OpenStreetMap contributors/.test(f.text);
        const checks = { sample, osm };
        let hits = [];
        if (w.ex === 'main') {
          hits = BAD.filter((s) => f.text.includes(s));
          checks.forbidden = hits.length === 0;
          checks.oneCounter = f.counters === 1 && f.counterLines === 0;
          checks.watchOneLine =
            f.watch && f.watch.lines === 1 && !f.watch.midBreak;
          checks.words = MAIN_WORDS[b].every((re) => re.test(f.text));
          checks.mapMode = f.mapMode === MAP_MODE[b];
          checks.canvas =
            MAP_MODE[b] === '3d'
              ? f.canvasVisible && f.canvasInMap
              : !f.canvasVisible;
        }
        const ok = Object.values(checks).every(Boolean);
        results.push({
          beat: b,
          wall: w.name,
          ok,
          checks,
          hits,
          mapMode: f.mapMode,
          site: w.ex === 'main' ? f.site : null,
        });
        const failed = Object.entries(checks)
          .filter(([, v]) => !v)
          .map(([k]) => k);
        console.log(
          `  ${ok ? 'PASS' : 'FAIL'} beat ${b} ${w.name.padEnd(7)}${w.ex === 'main' ? ` map ${f.mapMode}${f.mapMode === '3d' ? ` (${f.site})` : ''}` : ''}${failed.length ? ` · failed: ${failed.join(', ')}` : ''}`,
        );
        if (hits.length)
          console.log(`       hits: ${hits.slice(0, 5).join(' | ')}`);
      }
    }
    fs.writeFileSync(
      path.join(OUT, 'results-main.json'),
      `${JSON.stringify({ at: new Date().toISOString(), port: PORT, results }, null, 1)}\n`,
    );
  } finally {
    if (browser) await browser.close();
    room?.close();
    await server.stop();
    console.log('server stopped');
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} shots pass`);
  process.exitCode = failed.length ? 1 : 0;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) await main();
