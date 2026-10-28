#!/usr/bin/env node
// SafeTrekr Executive B3: the six walls, beat by beat, headless (EP-50 B3
// "screenshots per beat, as in the walls reviews").
//   node scripts/qa-executive-walls.mjs [--out <folder>] [--dir <scratch>]
//     [--port 4199] [--beats 0,1,2,3,4,5] [--b4 <folder>] [--keep]
// Starts its own executive server (TRIP_TWIN_PRODUCT=executive) on a free
// port, never 4173 or 4191, serving the working tree with HMR off and its
// own Vite cache; TRIP_TWIN_DATA_DIR, TRIP_TWIN_AUDIT_DIR and TMPDIR sit in
// a fresh folder under --dir, so the live wall's store and audit are never
// touched. Only the two map keys are passed from .env.local (as
// qa-twin-server.mjs); nothing from it is printed.
// The room: a launcher sets up six walls; a Node remote pairs and takes
// control. B4: the host applies the room preset itself (each slot's
// executive role, the school session role it is built on, the 3D walls'
// layers and MAIN's text scale); this script only checks it arrived. Six
// headless pages open twin-executive.html?view=screen&slot=N at
// 1920×1080. For each beat the remote cuts the loop clock to the beat's
// showcase time (paused), waits for the walls, and saves
// <out>/beatN-<wall>.png, then a contact sheet. Checks: MAIN carries no
// roster name and no intel title (DOM text), every wall shows SAMPLE, and
// a wall that draws a path shows the OpenStreetMap notice.
// B4 (EP-50 row B4): then one scripted run where the desk (a Node desk
// socket) verifies and pushes beat 1 a minute ahead of the script; the
// counter must still end 214·11·6·4·6 and the four scripted events must
// be pre-empted. Last, the Node remote leaves, the presenter page
// (twin-executive-remote.html, an iPad viewport) takes control and drives
// beats 1–3 while the desk page (twin-executive.html?as=desk) is open;
// <b4>/beatN-desk.png and beatN-presenter.png are saved.
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
import {
  SITE_LAYERS as PRESET_LAYERS,
  roomPreset,
} from '../src/operations/tripTwin/products/executive/host/execProtocol.js';
import { selectCounter } from '../src/operations/tripTwin/products/executive/loop/select.js';

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
const BEATS = (arg('beats') ?? '0,1,2,3,4,5')
  .split(',')
  .filter((x) => x !== '')
  .map(Number);
const B4 = path.resolve(
  arg('b4') ||
    path.join(ROOT, '..', 'plans', 'trip-twin', 'executive', 'review', 'b4'),
);
const FORBIDDEN_PORTS = new Set([4173, 4191, 4198]);

/** The executive walls in slot order (execProtocol.js EXEC_ROLE_ORDER). */
export const WALLS = Object.freeze([
  { slot: 1, ex: 'main', session: 'site', name: 'main' },
  { slot: 2, ex: 'verify', session: 'trips', name: 'verify' },
  { slot: 3, ex: 'intel', session: 'trips', name: 'intel' },
  { slot: 4, ex: 'roster', session: 'trips', name: 'roster' },
  { slot: 5, ex: 'principal', session: 'site', name: 'principal' },
  { slot: 6, ex: 'trips', session: 'trips', name: 'trips' },
]);

/** Session layers for the executive 3D walls: the host's preset (B4). */
export const SITE_LAYERS = PRESET_LAYERS;

/** The desk and presenter moments per beat (B4): a decision waiting. */
export const DESK_SHOWCASE = Object.freeze({
  1: '2026-10-27T16:03:00Z', // KESTREL raised, awaiting VALE
  2: '2026-10-27T18:05:30Z', // ATLAS assessed, awaiting ORTEGA's countersign
  3: '2026-10-27T22:11:00Z', // WREN verified, the re-tier waiting for ORTEGA
});
const END = '2026-10-28T01:00:00Z';

/**
 * Each beat's showcase moment (sim time, paused): the beat's decision is
 * on the walls (EP-20). Beat 0 is its anchor; the others a few minutes in.
 */
/**
 * SWIFT's showcase follows the day (B7 #15 moves the storm line earlier):
 * a minute after the advisory's push, when SWIFT 1 has read it.
 */
export function swiftShowcase(day) {
  const p = (day?.events || []).find(
    (e) => e.type === 'push.send' && e.push_id === 'push-swift-01',
  );
  return p
    ? new Date(Date.parse(p.at) + 60e3).toISOString().replace('.000Z', 'Z')
    : '2026-10-28T00:36:00Z';
}
const DAY_FILE = path.join(
  ROOT,
  'src/operations/tripTwin/products/executive/data/day.json',
);
export const SHOWCASE = Object.freeze({
  0: '2026-10-27T14:30:00Z', // quiet, the brief, noise handled
  1: '2026-10-27T16:12:00Z', // KESTREL reroute ACCEPTED
  2: '2026-10-27T18:25:00Z', // ATLAS: DL NON-CONCUR after the SALUTE
  3: '2026-10-27T22:24:00Z', // WREN: no read 10 min, the call-back chain
  4: swiftShowcase(JSON.parse(fs.readFileSync(DAY_FILE, 'utf8'))), // SWIFT advisory, read
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
    /** The last session state the remote heard. */
    state: () =>
      [...remote.out]
        .reverse()
        .find((m) => (m.t === 'state' || m.t === 'welcome') && m.state)
        ?.state ?? null,
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

// -------------------------------------------------------------- B4
/** A desk socket from this computer (kind 'desk'). */
async function deskClient(base) {
  const d = await client(base);
  const w = d.next('welcome', 8000, 'desk welcome');
  d.say({ t: 'hello', proto: PROTO, id: 'desk-qa', kind: 'desk' });
  const welcome = await w;
  must(
    welcome.type === 'desk',
    `desk got ${welcome.type} ${welcome.code ?? ''}`,
  );
  let seq = 1000;
  d.act = async (cmd, as = 'VALE') => {
    seq += 1;
    const reqId = seq;
    const p = d.next(
      (m) => m.t === 'loop-ack' && m.reqId === reqId,
      8000,
      `desk ack ${reqId}`,
    );
    d.say({ t: 'desk-cmd', reqId, as, cmd });
    return p;
  };
  d.view = () =>
    [...d.out].reverse().find((m) => m.t === 'loop' && m.view === 'desk');
  return d;
}

/** Ask first, then yes from the same remote. */
async function confirmed(room, cmd) {
  const a = await room.loop(cmd);
  if (a.code === 'CONFIRM_REQUIRED')
    return room.loop({ type: 'confirm', id: a.ask.id });
  return a;
}

/**
 * EP-50 B4: beat 1 with the desk's verify and push a minute ahead of the
 * script (1603Z and 1604Z, the script's 1604Z and 1605Z), then the rest
 * of the day on the script: the counter ends 214·11·6·4·6.
 */
async function earlyDeskRun(base, room) {
  const desk = await deskClient(base);
  try {
    must((await confirmed(room, { type: 'reset' })).ok, 'reset');
    await room.loop({ type: 'beat.go', n: 1 });
    must(
      (await room.loop({ type: 'clock.jump', to: '2026-10-27T16:03:00Z' })).ok,
      'jump 1603Z',
    );
    const v = await desk.act({
      type: 'verification.decide',
      sit_id: 's-kestrel-01',
      decision: 'verified',
      grade: { source: 'C', info: 2 },
    });
    must(v.ok, `desk verify: ${v.code} ${v.error ?? ''}`);
    must(
      (await room.loop({ type: 'clock.jump', to: '2026-10-27T16:04:00Z' })).ok,
      'jump 1604Z',
    );
    const a = await desk.act({
      type: 'recommendation.approve',
      recommendation_id: 'r-kestrel-01',
    });
    must(a.ok, `desk approve: ${a.code} ${a.error ?? ''}`);
    const p = await desk.act({
      type: 'push.send',
      recommendation_id: 'r-kestrel-01',
    });
    must(p.ok, `desk push: ${p.code} ${p.error ?? ''}`);
    must((await room.loop({ type: 'clock.jump', to: END })).ok, 'jump 0100Z');
    await sleep(1500);
    const view = desk.view();
    const c = selectCounter(view.loop);
    const counter = [c.in, c.matched, c.raised, c.pushed, c.closed].join('·');
    const preempted = Object.keys(view.desk.preempted).sort();
    const push = view.loop.pushes['push-kestrel-01'];
    const ok =
      counter === '214·11·6·4·6' &&
      ['e-0012', 'e-0013', 'e-0014', 'e-0015'].every((id) =>
        preempted.includes(id),
      ) &&
      push?.sent_at === '2026-10-27T16:04:00Z' &&
      view.desk.scriptRefused.length === 0;
    return {
      check: 'desk-early',
      ok,
      counter,
      preempted,
      pushSentAt: push?.sent_at ?? null,
      scriptRefused: view.desk.scriptRefused,
      run: view.run,
    };
  } finally {
    desk.ws.close();
  }
}

/** Beats 1–3 driven from the presenter page; the desk and the iPad captured. */
async function deskAndPresenter(browser, base, room) {
  const out = [];
  fs.mkdirSync(B4, { recursive: true });
  // The Node remote leaves: the iPad page takes control.
  room.remote.ws.close();
  await sleep(1000);
  const dctx = await browser.createBrowserContext();
  const deskPage = await dctx.newPage();
  await deskPage.setViewport({ width: 1920, height: 1080 });
  deskPage.on('pageerror', (e) =>
    console.log(`  page error desk: ${String(e?.message || e).slice(0, 200)}`),
  );
  await deskPage.goto(`${base}/twin-executive.html?as=desk`, {
    waitUntil: 'domcontentloaded',
  });
  const pctx = await browser.createBrowserContext();
  const ipad = await pctx.newPage();
  await ipad.setViewport({ width: 1180, height: 820, deviceScaleFactor: 2 });
  ipad.on('pageerror', (e) =>
    console.log(
      `  page error presenter: ${String(e?.message || e).slice(0, 200)}`,
    ),
  );
  await ipad.goto(`${base}/twin-executive-remote.html?setup=${room.setup}`, {
    waitUntil: 'domcontentloaded',
  });
  await ipad.waitForFunction(() => window.__exPresenter, { timeout: 60000 });
  await ipad.waitForFunction(() => document.body.dataset.exSim, {
    timeout: 60000,
  });
  await ipad.evaluate(() => window.__exPresenter.takeControl());
  await ipad.waitForFunction(() => window.__exPresenter.controller, {
    timeout: 15000,
  });
  const P = (cmd) => ipad.evaluate((c) => window.__exPresenter.loop(c), cmd);
  const yes = async (cmd) => {
    const a = await P(cmd);
    return a.code === 'CONFIRM_REQUIRED'
      ? P({ type: 'confirm', id: a.ask.id })
      : a;
  };
  must((await yes({ type: 'reset' })).ok, 'presenter reset');
  for (const n of [1, 2, 3]) {
    const r = await P({ type: 'beat.go', n });
    must(r.ok, `presenter beat ${n}: ${r.code}`);
    const j = await P({ type: 'clock.jump', to: DESK_SHOWCASE[n] });
    must(j.ok, `presenter jump: ${j.code}`);
    for (const pg of [deskPage, ipad])
      await pg
        .waitForFunction(
          (t) => document.body.dataset.exSim === t,
          { timeout: 30000 },
          DESK_SHOWCASE[n],
        )
        .catch(() => console.log(`  beat ${n}: a page did not reach the time`));
    // The desk: A opens the oldest raised item; at beat 3 the situation
    // row (WREN, verified) and the supervisor switch for the re-tier.
    await deskPage.keyboard.press('Escape');
    if (n === 3) {
      await deskPage.click('[data-as="ORTEGA"]');
      await deskPage.click('[data-sit="s-wren-01"]').catch(() => {});
    } else {
      await deskPage.click('[data-as="VALE"]');
      await deskPage.keyboard.press('a');
    }
    await sleep(1500);
    const df = path.join(B4, `beat${n}-desk.png`);
    const pf = path.join(B4, `beat${n}-presenter.png`);
    await deskPage.screenshot({ path: df });
    await ipad.screenshot({ path: pf, fullPage: true });
    const deskText = await wallText(deskPage);
    const ipadText = await wallText(ipad);
    const sel = await deskPage.evaluate(() => window.__exDesk?.selected);
    const sc = await ipad.evaluate(() =>
      [...document.querySelectorAll('[data-short]')].map(
        (b) => `${b.dataset.short}:${b.disabled ? 'off' : 'ready'}`,
      ),
    );
    // B7: the presenter shows what fires next and the words to say.
    const cue =
      /NEXT ON THE SCRIPT/.test(ipadText) && /SAY · BEAT/.test(ipadText);
    const ok =
      cue &&
      /\bSAMPLE\b/.test(deskText) &&
      /\bSAMPLE\b/.test(ipadText) &&
      Boolean(sel) &&
      (n !== 2 || sc.includes('ortega.countersign:ready')) &&
      (n !== 3 || sc.includes('ortega.retier:ready'));
    out.push({
      check: `beat${n}-desk-presenter`,
      ok,
      selected: sel,
      shortcuts: sc,
    });
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'} beat ${n} desk (${sel ?? 'nothing selected'}) · presenter ${sc.join(' ')}`,
    );
  }
  await deskPage.close();
  await ipad.close();
  return out;
}

// ------------------------------------------------------------------ run
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const port = await freePort(Number(arg('port', 4199)));
  must(!FORBIDDEN_PORTS.has(port), 'refusing 4173/4191/4198');
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
    // B4: the host's room preset, applied once the remote holds control.
    const preset = roomPreset(6);
    const t0 = Date.now();
    let st = null;
    while (Date.now() - t0 < 10000) {
      st = room.state();
      if (
        st &&
        preset.every(
          (p) =>
            st.screens?.[p.slot]?.role === p.patch.role &&
            (p.patch.textScale == null ||
              st.screens[p.slot].textScale === p.patch.textScale),
        )
      )
        break;
      await sleep(200);
    }
    for (const w of WALLS)
      must(
        st?.screens?.[w.slot]?.role === w.session,
        `preset: S${w.slot} is ${st?.screens?.[w.slot]?.role}, not ${w.session}`,
      );
    must(st.screens[1].textScale === 2, 'preset: MAIN text scale 2');
    console.log(
      `room preset from the host: ${WALLS.map((w) => `S${w.slot} ${w.ex}/${st.screens[w.slot].role}`).join(' · ')} · MAIN text ×${st.screens[1].textScale}`,
    );
    browser = await puppeteer.launch({ headless: true, args: FLAGS });
    const pages = [];
    for (const w of BEATS.length ? WALLS : []) {
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
    if (BEATS.length)
      for (const { w, page } of pages)
        await page.waitForFunction(
          (ex) => document.body.dataset.exRole === ex,
          { timeout: 180000 },
          w.ex,
        );
    // The 3D walls need their tiles; give the scene time once.
    if (BEATS.length) await sleep(Number(arg('settle', 25000)));
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
    if (BEATS.length) {
      const sheet = await contactSheet(browser, files);
      console.log(`contact sheet ${sheet}`);
      fs.writeFileSync(
        path.join(OUT, 'results.json'),
        `${JSON.stringify({ at: new Date().toISOString(), port, results }, null, 1)}\n`,
      );
    }
    for (const { page } of pages) await page.close();
    // ------------------------------------------------------------- B4
    const early = await earlyDeskRun(base, room);
    results.push(early);
    console.log(
      `  ${early.ok ? 'PASS' : 'FAIL'} desk verify+push live a minute early: counter ${early.counter} · pre-empted ${early.preempted.join(', ')}`,
    );
    const shots = await deskAndPresenter(browser, base, room);
    results.push(...shots);
    fs.mkdirSync(B4, { recursive: true });
    fs.writeFileSync(
      path.join(B4, 'results-desk.json'),
      `${JSON.stringify({ at: new Date().toISOString(), port, early, shots }, null, 1)}\n`,
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
