#!/usr/bin/env node
// SafeTrekr Executive B3: the six walls, beat by beat, headless (EP-50 B3
// "screenshots per beat, as in the walls reviews").
//   node scripts/qa-executive-walls.mjs [--out <folder>] [--dir <scratch>]
//     [--port 4197] [--beats 0,1,2,3,4,5] [--keep]
// Starts its own executive server (TRIP_TWIN_PRODUCT=executive) on a free
// port, never 4173 or 4191, serving the working tree with HMR off and its
// own Vite cache; TRIP_TWIN_DATA_DIR, TRIP_TWIN_AUDIT_DIR and TMPDIR sit in
// a fresh folder under --dir, so the live wall's store and audit are never
// touched. Only the two map keys are passed from .env.local (as
// qa-twin-server.mjs); nothing from it is printed.
// The room: a launcher sets up six walls; a Node remote pairs and takes
// control, gives each wall its school session role (site for MAIN and
// Principal, trips for the flat walls) and its executive role (wall.role);
// six headless pages open twin-executive.html?view=screen&slot=N at
// 1920×1080. For each beat the remote cuts the loop clock to the beat's
// showcase time (paused), waits for the walls, and saves
// <out>/beatN-<wall>.png, then a contact sheet. Checks: MAIN carries no
// roster name and no intel title (DOM text), every wall shows SAMPLE, and
// a wall that draws a path shows the OpenStreetMap notice.
// The server is stopped at the end (and on any exit). Never prints a token
// or a setup link.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import WebSocket from 'ws';
import { defaultEnvFile, readPassedKeys } from './qa-twin-server.mjs';
import { PROTO } from '../src/operations/tripTwin/twinProtocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d = null) =>
  argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d;
const has = (n) => argv.includes(`--${n}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const OUT = path.resolve(
  arg('out') ||
    path.join(ROOT, '..', 'plans', 'trip-twin', 'executive', 'review', 'b3'),
);
const DIR = path.resolve(
  arg('dir') ||
    path.join(
      process.env.TMPDIR || '/tmp',
      `executive-walls-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`,
    ),
);
const BEATS = (arg('beats') || '0,1,2,3,4,5').split(',').map(Number);
const FORBIDDEN_PORTS = new Set([4173, 4191]);

/** The executive walls in slot order (execProtocol.js EXEC_ROLE_ORDER). */
export const WALLS = Object.freeze([
  { slot: 1, ex: 'main', session: 'site', name: 'main' },
  { slot: 2, ex: 'verify', session: 'trips', name: 'verify' },
  { slot: 3, ex: 'intel', session: 'trips', name: 'intel' },
  { slot: 4, ex: 'roster', session: 'trips', name: 'roster' },
  { slot: 5, ex: 'principal', session: 'site', name: 'principal' },
  { slot: 6, ex: 'trips', session: 'trips', name: 'trips' },
]);

/** Session layers for the executive 3D walls (twinScreenRoles.js LAYER_CATALOG). */
export const SITE_LAYERS = Object.freeze({
  paths: false,
  savedPaths: false,
  avoidAreas: false,
  corridors: false,
  safety: false,
  floors: false,
  streetPhoto: false,
  streets: true,
  walkways: true,
});

/**
 * Each beat's showcase moment (sim time, paused): the beat's decision is
 * on the walls (EP-20). Beat 0 is its anchor; the others a few minutes in.
 */
export const SHOWCASE = Object.freeze({
  0: '2026-10-27T14:30:00Z', // quiet, the brief, noise handled
  1: '2026-10-27T16:12:00Z', // KESTREL reroute ACCEPTED
  2: '2026-10-27T18:25:00Z', // ATLAS: DL NON-CONCUR after the SALUTE
  3: '2026-10-27T22:24:00Z', // WREN: no read 10 min, the call-back chain
  4: '2026-10-28T00:36:00Z', // SWIFT advisory, read
  5: '2026-10-28T01:00:00Z', // close: six SITREPs, the counter
});

// ------------------------------------------------------------- the server
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}
async function freePort(start) {
  for (let p = start; p < start + 50; p++)
    if (!FORBIDDEN_PORTS.has(p) && (await portFree(p))) return p;
  throw new Error('no free port');
}

const RUNNER = `
const { createServer } = await import('vite');
const server = await createServer({
  configFile: process.env.QA_ROOT + '/vite.twin.config.js',
  root: process.env.QA_ROOT,
  cacheDir: process.env.QA_CACHE_DIR,
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: Number(process.env.QA_PORT),
    strictPort: true,
    hmr: false,
    watch: null,
  },
});
await server.listen();
process.stdout.write('EXEC-SERVER-READY\\n');
const stop = () => server.close().finally(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
`;

export async function startExecServer({ dir, port }) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    LANG: process.env.LANG || 'en_GB.UTF-8',
    TMPDIR: tmp,
    TRIP_TWIN_DATA_DIR: path.join(dir, 'data'),
    TRIP_TWIN_AUDIT_DIR: path.join(dir, 'audit'),
    TRIP_TWIN_PHOTOS: 'fixture',
    TRIP_TWIN_CAMERAS: 'fixture',
    TRIP_TWIN_PRODUCT: 'executive',
    QA_ROOT: ROOT,
    QA_PORT: String(port),
    QA_CACHE_DIR: path.join(dir, 'vite-cache'),
    ...readPassedKeys(defaultEnvFile()),
  };
  const logFile = path.join(dir, 'server.log');
  const out = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, ['--input-type=module', '-e', RUNNER], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', out],
  });
  let exited = false;
  child.once('exit', () => (exited = true));
  process.once('exit', () => {
    if (!exited) child.kill('SIGKILL');
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`server: no start in 90 s (${logFile})`)),
      90000,
    );
    let buf = '';
    child.stdout.on('data', (d) => {
      fs.appendFileSync(logFile, d);
      buf += d;
      if (buf.includes('EXEC-SERVER-READY')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code} (${logFile})`));
    });
  });
  return {
    url: `http://localhost:${port}`,
    port,
    logFile,
    stop: () =>
      new Promise((resolve) => {
        if (exited) return resolve();
        const hard = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.once('exit', () => {
          clearTimeout(hard);
          resolve();
        });
        child.kill('SIGTERM');
      }),
  };
}

// ------------------------------------------------------- a socket device
function client(base) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/twin-sync`, {
      headers: { Origin: base },
    });
    const c = {
      ws,
      out: [],
      waiters: [],
      say: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)),
      next(pred, ms = 8000, what = 'a message') {
        const test = typeof pred === 'string' ? (m) => m.t === pred : pred;
        const p = new Promise((ok, no) => {
          const w = { test, ok };
          c.waiters.push(w);
          setTimeout(() => {
            c.waiters = c.waiters.filter((x) => x !== w);
            no(new Error(`timed out waiting for ${what}`));
          }, ms);
        });
        p.catch(() => {});
        return p;
      },
    };
    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      c.out.push(m);
      if (c.out.length > 400) c.out.splice(0, 200);
      for (const w of [...c.waiters])
        if (w.test(m)) {
          c.waiters = c.waiters.filter((x) => x !== w);
          w.ok(m);
        }
    });
    const beat = setInterval(() => c.say({ t: 'hb' }), 5000);
    ws.once('close', () => clearInterval(beat));
    ws.once('open', () => resolve(c));
    ws.once('error', reject);
  });
}

export async function openRoom(base) {
  const launcher = await client(base);
  launcher.say({
    t: 'hello',
    proto: PROTO,
    id: 'launcher-exec',
    kind: 'launcher',
  });
  await launcher.next('welcome', 8000, 'launcher welcome');
  const got = launcher.next('setup', 8000, 'setup answer');
  launcher.say({ t: 'setup', count: 6, tripId: null, siteKey: null });
  const s = await got;
  must(s.ok && s.setup, `setup refused: ${s.error || '?'}`);
  const setup = s.setup;
  const remote = await client(base);
  const w = remote.next('welcome', 8000, 'remote welcome');
  remote.say({
    t: 'hello',
    proto: PROTO,
    id: 'remote-exec-presenter',
    kind: 'remote',
    name: 'iPad',
    setup,
  });
  const welcome = await w;
  must(welcome.type === 'remote', `remote got ${welcome.type}`);
  if (!welcome.controller) {
    remote.say({ t: 'request-control' });
    await sleep(500);
  }
  let seq = 0;
  const ask = async (msg, ackType) => {
    seq += 1;
    const reqId = seq;
    const p = remote.next(
      (m) => m.t === ackType && m.reqId === reqId,
      8000,
      `${ackType} ${reqId}`,
    );
    remote.say({ ...msg, reqId });
    return p;
  };
  return {
    setup,
    launcher,
    remote,
    /** A school session command (twinSession.js applyCommand). */
    cmd: (cmd) => ask({ t: 'cmd', cmd }, 'ack'),
    /** A presenter command on the loop (execProtocol.js PRESENTER_CMDS). */
    loop: (cmd) => ask({ t: 'loop-cmd', cmd }, 'loop-ack'),
    close() {
      launcher.ws.close();
      remote.ws.close();
    },
  };
}

// --------------------------------------------------------------- browser
const FLAGS = [
  '--enable-webgl',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

/** Everything the DOM text check needs from MAIN, from the page itself. */
function forbiddenStrings(day) {
  const out = new Set();
  for (const p of Object.values(day.people)) out.add(p.name);
  for (const s of day.watch.staff) out.add(s.name);
  for (const b of Object.values(day.bundles)) {
    if (b.title?.length >= 12) out.add(b.title);
    for (const p of b.posts || []) if (p.text?.length >= 12) out.add(p.text);
  }
  return [...out].filter(Boolean);
}

async function wallText(page) {
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
    return parts.join(' ').replace(/\s+/g, ' ');
  });
}

async function contactSheet(browser, files) {
  const page = await browser.newPage();
  await page.setViewport({ width: 2400, height: 60 + BEATS.length * 226 });
  const rows = BEATS.map(
    (b) =>
      `<tr><th>beat ${b}</th>${WALLS.map((w) => {
        const f = files[`${b}-${w.name}`];
        return `<td>${f ? `<img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}">` : '—'}</td>`;
      }).join('')}</tr>`,
  ).join('');
  await page.setContent(
    `<html><body style="margin:0;background:#061a23;color:#dfe9ee;font:14px Menlo,monospace">
    <table style="border-collapse:collapse"><tr><th></th>${WALLS.map((w) => `<th style="padding:6px">S${w.slot} · ${w.name}</th>`).join('')}</tr>${rows}</table>
    <style>img{width:384px;height:216px;display:block}td{padding:3px}th{padding:3px;text-align:left}</style></body></html>`,
    { waitUntil: 'load' },
  );
  const file = path.join(OUT, 'contact-sheet.png');
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
  return file;
}

// ------------------------------------------------------------------ run
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const port = await freePort(Number(arg('port', 4197)));
  must(!FORBIDDEN_PORTS.has(port), 'refusing 4173/4191');
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
  console.log(`executive server on :${port} · scratch ${DIR}`);
  const server = await startExecServer({ dir: DIR, port });
  const base = server.url;
  const results = [];
  const files = {};
  let browser = null;
  let room = null;
  try {
    room = await openRoom(base);
    // School session roles first (site for MAIN and Principal, trips for
    // the flat walls), then each wall's executive role on the loop host.
    for (const w of WALLS) {
      const a = await room.cmd({
        type: 'screens',
        target: w.slot,
        patch: { role: w.session },
      });
      must(
        a.ok !== false,
        `role ${w.session} on S${w.slot}: ${a.error || a.code}`,
      );
      if (w.session === 'site') {
        // The 3D walls: the school layers that draw their own content off
        // (suggested and saved paths, corridors, safety, floors, the
        // street photo); streets and entrances on. MAIN at the room tier.
        const l = await room.cmd({
          type: 'screens',
          target: w.slot,
          patch: {
            layers: SITE_LAYERS,
            ...(w.ex === 'main' ? { textScale: 2 } : {}),
          },
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
    // Wait for every wall to hold its executive role.
    for (const { w, page } of pages)
      await page.waitForFunction(
        (ex) => document.body.dataset.exRole === ex,
        { timeout: 180000 },
        w.ex,
      );
    // The 3D walls need their tiles; give the scene time once.
    await sleep(Number(arg('settle', 25000)));
    for (const b of BEATS) {
      const target = SHOWCASE[b];
      await room.loop({ type: 'clock.pause' });
      const r = await room.loop({ type: 'clock.jump', to: target });
      if (!r.ok && r.code === 'I12_TIME') {
        // Earlier than now: back to beat 0, then forward again.
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
      // The 3D walls: their site twin up (a switch can take a while).
      for (const { w, page } of pages)
        if (w.session === 'site')
          await page
            .waitForFunction(
              () => document.body.dataset.exScene === 'settled',
              {
                timeout: 120000,
              },
            )
            .catch(() => console.log(`  S${w.slot}: scene not settled`));
      await sleep(9000);
      for (const { w, page } of pages) {
        const file = path.join(OUT, `beat${b}-${w.name}.png`);
        await page.screenshot({ path: file });
        files[`${b}-${w.name}`] = file;
        const text = await wallText(page);
        const sample = /\bSAMPLE\b/.test(text);
        const hits = w.ex === 'main' ? BAD.filter((s) => text.includes(s)) : [];
        const drawsPath = await page.evaluate(
          () => document.body.dataset.exPaths === '1',
        );
        const site =
          w.session === 'site'
            ? await page.evaluate(
                () =>
                  `${globalThis.tripTwin?.siteKey ?? '-'}/${globalThis.tripTwin?.state ?? '-'}/school people ${document.body.dataset.exScene}`,
              )
            : null;
        const osm = !drawsPath || /OpenStreetMap contributors/.test(text);
        const ok = sample && hits.length === 0 && osm;
        results.push({
          beat: b,
          wall: w.name,
          ok,
          sample,
          hits,
          osm,
          drawsPath,
          site,
        });
        console.log(
          `  ${ok ? 'PASS' : 'FAIL'} beat ${b} ${w.name.padEnd(9)} SAMPLE ${sample ? 'yes' : 'NO'}${w.ex === 'main' ? ` · forbidden ${hits.length}` : ''}${drawsPath ? ` · OSM ${osm ? 'yes' : 'NO'}` : ''}${site ? ` · ${site}` : ''}`,
        );
        if (hits.length)
          console.log(`       hits: ${hits.slice(0, 5).join(' | ')}`);
      }
    }
    const sheet = await contactSheet(browser, files);
    console.log(`contact sheet ${sheet}`);
    // MAIN's hidden share (EP-51 item 4), measured on the beat-5 page.
    const share = await pages[0].page.evaluate(() => window.__exMainShare?.());
    if (share) console.log(`MAIN hidden share: ${JSON.stringify(share)}`);
    fs.writeFileSync(
      path.join(OUT, 'results.json'),
      `${JSON.stringify({ at: new Date().toISOString(), port, results, mainShare: share ?? null }, null, 1)}\n`,
    );
  } finally {
    if (browser && !has('keep')) await browser.close();
    room?.close();
    await server.stop();
    console.log('server stopped');
  }
  const failed = results.filter((r) => !r.ok);
  console.log(
    `${results.length - failed.length}/${results.length} wall shots pass`,
  );
  process.exitCode = failed.length ? 1 : 0;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) await main();
