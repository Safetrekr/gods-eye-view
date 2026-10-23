#!/usr/bin/env node
// Trip Twin multi-view headless harness (Phase CF K1; PHASE-CF-PLAN S-5,
// cf/06-qa.md QA-4, QA-16; cf/02-backend.md BE-7; cf/07-reasoning.md
// ET-3 R0.1, ET-4).
//   node scripts/qa-twin-multiview.mjs smoke [--dir <qa folder>] [--keep]
//     [--ref HEAD|worktree] [--revert-ref <ref>]
//   node scripts/qa-twin-multiview.mjs repro-pairing [--dir …]
//     [--wait-expiry] [--strict]
//   node scripts/qa-twin-multiview.mjs full        (after shell step C)
// Runs against the isolated QA server (scripts/qa-twin-server.mjs): a git
// archive of HEAD on :4181, HMR off, its own cacheDir, data folder and
// TMPDIR. --ref worktree serves the working tree (a slice gate before its
// commit). The smoke's revert drill restarts on --revert-ref (default: the
// commit before the one under test; HEAD for the working tree) and then on
// the build under test again. --url runs against a server you started
// (restart steps are then skipped). Results go to
// <qa folder>/runs/<mode>-<time>/ (results.json, results.md, shots).
// Never prints a token, a setup link or anything from .env.local.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import WebSocket from 'ws';
import { startQaServer } from './qa-twin-server.mjs';
import { fakeSocket } from '../src/operations/tripTwin/twinTestKit.mjs';
import { PROTO } from '../src/operations/tripTwin/twinProtocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const MODE = argv.find((a) => !a.startsWith('--')) || 'smoke';
const has = (n) => argv.includes(`--${n}`);
const arg = (n, d = null) =>
  argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d;
const QA_DIR = path.resolve(
  arg('dir') ||
    process.env.TRIP_TWIN_QA_DIR ||
    path.join(os.tmpdir(), 'trip-twin-qa'),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(QA_DIR, 'runs', `${MODE}-${stamp}`);
const CITY = 'city=austin&scenario=baseline';
/** The live wall's session files (read-only stat, to prove isolation). */
const LIVE_STORES = [
  path.join(os.tmpdir(), 'trip-twin-soc-session.json'),
  path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'SafeTrekr',
    'trip-twin',
    'session.json',
  ),
];
const REF = arg('ref', 'HEAD');
const REVERT_REF = arg('revert-ref', REF === 'worktree' ? 'HEAD' : `${REF}~1`);
const SETUP_TTL_MS = 10 * 60 * 1000; // twinSessionHost.js, base 3431392

// ---------------------------------------------------------------- results
const results = [];
const log = (m) => console.log(m);
const dbg = (m) => process.env.QA_DEBUG && console.log(`  · ${m}`);
/** Run one step; a throw is a failed step, never a crashed run. */
async function step(id, what, fn, extra = {}) {
  const t0 = Date.now();
  const row = { id, what, ...extra };
  try {
    const r = (await fn()) || {};
    Object.assign(row, { ok: r.ok !== false }, r);
  } catch (e) {
    Object.assign(row, { ok: false, detail: String(e?.message || e) });
  } finally {
    if (extra.cleanup) await cleanup();
  }
  delete row.cleanup;
  row.ms = Date.now() - t0;
  results.push(row);
  const tag =
    row.verdict ||
    (row.todo ? 'TODO' : row.notRun ? 'NOT RUN' : row.ok ? 'PASS' : 'FAIL');
  log(
    `  ${tag.padEnd(7)} ${id} · ${what}${row.detail ? ` — ${row.detail}` : ''}`,
  );
  return row;
}
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// --------------------------------------------------------- socket client
/**
 * A Node WebSocket client that speaks the wall protocol, as the pages do:
 * same-origin, and holding its own id and token (never printed).
 */
function client(base, { origin = base } = {}) {
  return new Promise((resolve, reject) => {
    const url = `${base.replace(/^http/, 'ws')}/api/twin-sync`;
    const ws = new WebSocket(url, { headers: { Origin: origin } });
    const c = {
      ws,
      out: [],
      waiters: [],
      say: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)),
      last: (t) => [...c.out].reverse().find((m) => m.t === t),
      all: (t) => c.out.filter((m) => m.t === t),
      /** Resolve with the first message (from now on) that matches. */
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
        // A wait left behind by a failed step must not crash the run.
        p.catch(() => {});
        return p;
      },
      close() {
        return new Promise((r) => {
          if (ws.readyState === 3) return r();
          ws.once('close', () => r());
          ws.close();
        });
      },
      get open() {
        return ws.readyState === 1;
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
      for (const w of [...c.waiters])
        if (w.test(m)) {
          c.waiters = c.waiters.filter((x) => x !== w);
          w.ok(m);
        }
    });
    // Heartbeat every 5 s, as twinSync.js does: it keeps a remote's lease.
    const beat = setInterval(() => c.say({ t: 'hb' }), 5000);
    ws.once('close', () => clearInterval(beat));
    ws.once('open', () => resolve(c));
    ws.once('error', reject);
    opened.socks.push(c);
  });
}

/** A device: an id, a kind, and the token it was given (kept in memory). */
async function device(base, { id, kind, slot = null, name = '' }) {
  const d = { id, kind, slot, name, setup: null, token: null, c: null };
  d.hello = async (extra = {}) => {
    d.c = await client(base);
    const welcome = d.c.next('welcome', 8000, `${id} welcome`);
    // As twinSync.js from K5: the hello says this build's protocol (an
    // older build ignores it).
    d.c.say({
      t: 'hello',
      proto: PROTO,
      id,
      kind,
      name,
      slot,
      setup: d.setup,
      token: d.token,
      ...extra,
    });
    const w = await welcome;
    if (w.token) d.token = w.token;
    // As twinSync.js from K4: once joined, a device rejoins by its token
    // and no longer sends the setup link (older builds ignore it then).
    if (w.type === 'paired' || w.type === 'remote') d.setup = null;
    return w;
  };
  return d;
}

/** The real launcher's sequence: hello (refused), then setup. */
async function startSetup(base, count = 6) {
  const c = await client(base);
  c.say({ t: 'hello', proto: PROTO, id: 'launcher-qa', kind: 'launcher' });
  await c.next('welcome', 8000, 'launcher welcome');
  const got = c.next('setup', 8000, 'setup answer');
  c.say({ t: 'setup', count, tripId: null, siteKey: null });
  const s = await got;
  must(s.ok && s.setup, `setup refused: ${s.error || '?'}`);
  return { c, setup: s.setup, count: s.count };
}

/** The newest presence a socket has seen (presence, state or welcome). */
const presenceOf = (c) =>
  [...c.out].reverse().find((m) => m.presence)?.presence || null;

// ---------------------------------------------------------------- browser
const FLAGS = [
  '--enable-webgl',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];
const pageErrors = [];
/** Console errors allowed: FIRMS answers 503 without its key (S-5). */
/** While the server restarts, refused connections are expected. */
// A count, not a flag: back-to-back restarts (K2's revert drill) must not
// end each other's quiet window early.
let restarting = 0;
/** Restart the QA server; refused connections are quiet for 15 s after. */
async function quietRestart(server, opts) {
  restarting += 1;
  try {
    await server.restart(opts);
  } finally {
    setTimeout(() => (restarting -= 1), 15000);
  }
}
function watch(page, name) {
  const firms503 = { seen: false };
  page.on('pageerror', (e) =>
    pageErrors.push({
      page: name,
      kind: 'pageerror',
      text: e.message.slice(0, 240),
    }),
  );
  page.on('response', (r) => {
    try {
      if (r.status() === 503 && new URL(r.url()).pathname === '/api/firms')
        firms503.seen = true;
    } catch {
      /* ignore */
    }
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/status of 503/.test(text) && firms503.seen) return;
    if (restarting && /ERR_CONNECTION_(REFUSED|RESET)/.test(text)) return;
    pageErrors.push({ page: name, kind: 'console', text: text.slice(0, 240) });
  });
}
async function shot(page, name) {
  try {
    fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'shots', `${name}.png`) });
  } catch {
    /* a closed page has no shot */
  }
}
/** Browser contexts and sockets a repro step opened, closed after it. */
const opened = { ctx: [], socks: [] };
let BROWSER = null;
async function newCtx() {
  const ctx = await BROWSER.createBrowserContext();
  opened.ctx.push(ctx);
  return ctx;
}
async function newPage(ctx, name) {
  const p = await ctx.newPage();
  p.setDefaultNavigationTimeout(120000);
  watch(p, name);
  return p;
}
async function cleanup() {
  for (const c of opened.ctx.splice(0)) await c.close().catch(() => {});
  for (const c of opened.socks.splice(0)) await c.close().catch(() => {});
}
/**
 * The next page window.open makes in this context. Call before the click;
 * await after it.
 */
function nextPopup(ctx, name, ms = 30000) {
  const before = new Set(ctx.targets());
  return ctx
    .waitForTarget((t) => t.type() === 'page' && !before.has(t), {
      timeout: ms,
    })
    .then(async (t) => {
      const p = await t.page();
      p.setDefaultNavigationTimeout(120000);
      watch(p, name);
      return p;
    });
}
const deviceIdIn = (page) =>
  page.evaluate(() => sessionStorage.getItem('tripTwin.soc.device.screen'));
/**
 * Joined slot n: connected and holding its token (K4 run). Every slot
 * window shows "Sn · not connected" before its socket opens, and "Sn ·
 * Remote offline" as soon as it opens, before the paired welcome lands:
 * a window closed then has no token to come back with.
 */
/**
 * The S6 chip names the QA remote. From K5 the relay names it: a remote on
 * this computer is "Trip Twin computer" (CF-D8); an older build shows the
 * name the page sent ("iPad").
 */
const REMOTE_CHIP = /^S6 · Remote: (Trip Twin computer|iPad)\b/;
const joined = (x, n) =>
  !x.pairShown && x.paired && new RegExp(`^S${n} · Remote`).test(x.chip);
/** K4: data-tt-link on a wall ('replaced' once another window took it). */
const linkIn = (page) =>
  page.evaluate(() => document.body.dataset.ttLink || null);
const wallText = (page) =>
  page.evaluate(() => {
    const pair = document.querySelector('.tt-wall-pair');
    return {
      chip: document.querySelector('.tt-wall-chip')?.textContent || '',
      pairShown: Boolean(pair && !pair.hidden),
      code:
        pair && !pair.hidden ? pair.querySelector('.code')?.textContent : null,
      how: pair?.querySelector('.how')?.textContent || '',
      url: pair?.querySelector('.url')?.textContent || '',
      host: location.host,
      // The page holds its token (base and K4 both write token.<id>).
      paired: (() => {
        const id = sessionStorage.getItem('tripTwin.soc.device.screen');
        return Boolean(id && localStorage.getItem(`tripTwin.soc.token.${id}`));
      })(),
    };
  });
async function waitWall(page, pred, ms = 90000, what = 'the wall') {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    try {
      last = await wallText(page);
      if (pred(last)) return last;
    } catch {
      /* navigating */
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what} (chip "${last?.chip || ''}")`);
}
/** Click a launcher button by its visible text. */
const clickOpen = (page, slot) =>
  page.evaluate((slot) => {
    const b = [...document.querySelectorAll('.tt-entry-opens button')].find(
      (x) => x.textContent.startsWith(`Open S${slot} `),
    );
    if (!b) return false;
    b.click();
    return true;
  }, slot);

// ------------------------------------------------------------------ server
/** The live server's would-refuse record (K3); only ever stat'ed. */
const LIVE_WOULD_REFUSE = path.join(
  os.homedir(),
  'Library',
  'Logs',
  'trip-twin',
  'would-refuse.jsonl',
);
function statOf(f) {
  try {
    const s = fs.statSync(f);
    return { exists: true, mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return { exists: false };
  }
}
/** The QA server's would-refuse lines (its own audit folder). */
function wouldRefuseLines(server) {
  try {
    return fs
      .readFileSync(server.wouldRefuseFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
/** One relay handshake with hand-set Host and Origin: 'open' or 'refused'. */
function dialRelay(port, { host, origin }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/twin-sync`, {
      headers: { Host: host, Origin: origin },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      resolve('timeout');
    }, 5000);
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
/** A GET with any headers (Host and Sec-Fetch-Site included). */
function rawGet(port, pathname, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (body += d));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}
function liveStoreStat() {
  return LIVE_STORES.map((f) => {
    try {
      const s = fs.statSync(f);
      return { exists: true, mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return { exists: false };
    }
  });
}
const modeOf = (f) => {
  try {
    return (fs.statSync(f).mode & 0o777).toString(8);
  } catch {
    return null;
  }
};
/** Lines the QA server logged since `from` (byte offset of server.log). */
function serverLogSince(server, from) {
  try {
    return fs
      .readFileSync(path.join(server.dir, 'server.log'), 'utf8')
      .slice(from);
  } catch {
    return '';
  }
}
const serverLogSize = (server) => {
  try {
    return fs.statSync(path.join(server.dir, 'server.log')).size;
  } catch {
    return 0;
  }
};
/** Screen devices with a slot in a saved store (no tokens read out). */
function storeSlots(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (j.devices || [])
      .filter(([, d]) => d.kind === 'screen' && d.slot)
      .map(([, d]) => d.slot)
      .sort();
  } catch {
    return null;
  }
}
async function startServer() {
  if (arg('url')) return { url: arg('url').replace(/\/$/, ''), external: true };
  // A fresh wall: the QA store from an earlier run is not restored (the
  // data folder and the old tmp-path copy both go).
  fs.rmSync(path.join(QA_DIR, 'tmp', 'trip-twin-soc-session.json'), {
    force: true,
  });
  fs.rmSync(path.join(QA_DIR, 'data'), { recursive: true, force: true });
  return startQaServer({ dir: QA_DIR, ref: REF, log });
}
async function importBase(server, rel) {
  // The relay fixes its store path from os.tmpdir() when it loads; keep it
  // off the live wall's file even though createRelay never saves here.
  process.env.TMPDIR = path.join(QA_DIR, 'tmp-harness');
  fs.mkdirSync(process.env.TMPDIR, { recursive: true });
  const file = server.app ? path.join(server.app, rel) : path.join(ROOT, rel);
  return import(pathToFileURL(file).href);
}

// =================================================================== smoke
async function smoke(server, browser) {
  const base = server.url;
  const { needsConfirm } = await importBase(
    server,
    'src/operations/tripTwin/twinSession.js',
  );
  const live0 = liveStoreStat();
  const liveRefuse0 = statOf(LIVE_WOULD_REFUSE);
  let setup = null;
  let launcher = null;
  const walls = [];
  let remote = null;
  let page = null;

  await step(
    'K1-S0',
    'isolated QA server is up (git archive, :4181, own data folder and TMPDIR)',
    async () => {
      const r = await fetch(`${base}/api/twin-sync/info`).then((x) => x.json());
      must(r.ok, 'info not ok');
      return {
        detail: server.external
          ? `external server ${base}`
          : `${server.sha} on :${server.port}; map keys passed ${server.keysPassed}/2`,
      };
    },
  );

  await step('K1-S1', 'launcher: hello, then setup for six walls', async () => {
    ({ c: launcher, setup } = await startSetup(base, 6));
    return { detail: 'setup token issued (not printed)' };
  });

  await step(
    'K1-S2',
    'walls S1–S5 join by the launcher link (setup + slot)',
    async () => {
      for (let n = 1; n <= 5; n++) {
        const d = await device(base, {
          id: `screen-qa-s${n}`,
          kind: 'screen',
          slot: n,
        });
        d.setup = setup;
        const w = await d.hello();
        must(
          w.type === 'paired' && w.slot === n,
          `S${n} got ${w.type} ${w.slot ?? ''}`,
        );
        walls.push(d);
      }
    },
  );

  await step(
    'K1-S3',
    'remote pairs from the QR link and takes control',
    async () => {
      remote = await device(base, {
        id: 'remote-qa-ipad',
        kind: 'remote',
        name: 'iPad',
      });
      remote.setup = setup;
      const w = await remote.hello();
      must(
        w.type === 'remote' && w.controller === true,
        `remote got ${w.type}, controller ${w.controller}`,
      );
    },
  );

  await step(
    'K1-S4',
    'wall page without a link shows the pair card (4-digit code)',
    async () => {
      const ctx = await browser.createBrowserContext();
      page = await ctx.newPage();
      page.setDefaultNavigationTimeout(120000);
      await page.setViewport({ width: 1280, height: 760 });
      watch(page, 'wall-S6');
      await page.goto(`${base}/twin.html?view=screen&${CITY}`, {
        waitUntil: 'domcontentloaded',
      });
      const w = await waitWall(
        page,
        (x) => /^\d{4}$/.test(x.code || ''),
        120000,
        'the pair card',
      );
      must(/Pair a screen/.test(w.how), `pair card text: "${w.how}"`);
      must(w.url === w.host, `pair card host "${w.url}" vs page "${w.host}"`);
      await shot(page, 'S4-wall-pair-card');
      page.__code = w.code;
      return { detail: `card shows a code and ${w.url}` };
    },
  );

  await step(
    'K1-S5',
    'remote pairs that screen by code into S6; its chip names the remote',
    async () => {
      must(page?.__code, 'no code from K1-S4');
      const ans = remote.c.next('pair-result', 8000, 'pair-result');
      remote.c.say({ t: 'pair', reqId: 1, code: page.__code, slot: 6 });
      const r = await ans;
      must(r.ok && r.slot === 6, `pair-result ${r.ok} ${r.error || ''}`);
      const w = await waitWall(
        page,
        (x) => !x.pairShown && REMOTE_CHIP.test(x.chip),
        30000,
        'the S6 chip',
      );
      await shot(page, 'S5-wall-chip-paired');
      return { detail: `chip "${w.chip}"` };
    },
  );

  await step(
    'K1-S6',
    'one command: S2 role → day; S2 changes, every wall gets the state',
    async () => {
      const acks = remote.c.next(
        (m) => m.t === 'ack' && m.reqId === 2,
        8000,
        'ack',
      );
      const states = walls.map((d) =>
        d.c.next('state', 8000, `S${d.slot} state`),
      );
      remote.c.say({
        t: 'cmd',
        reqId: 2,
        cmd: { type: 'screens', target: 2, patch: { role: 'day' } },
      });
      const a = await acks;
      must(a.ok, `ack: ${a.error}`);
      const got = await Promise.all(states);
      must(got[1].state.screens[2].role === 'day', 'S2 role not day');
      must(
        JSON.stringify(got[1].changed) === '[2]',
        `changed ${JSON.stringify(got[1].changed)}`,
      );
      must(
        got.every((s) => s.state.rev === got[0].state.rev),
        'walls disagree on rev',
      );
      return { detail: `rev ${a.rev}` };
    },
  );

  let before = null;
  let undoId = null;
  await step(
    'K1-S7',
    'one confirmed command: All → Advance (needsConfirm), applied on every wall',
    async () => {
      const cmd = {
        type: 'screens',
        target: 'all',
        patch: { mode: 'advance' },
      };
      must(needsConfirm(cmd), 'needsConfirm says no');
      before = Object.fromEntries(
        Object.entries(walls[0].c.last('state').state.screens).map(([s, v]) => [
          s,
          v.mode,
        ]),
      );
      // The remote asks first (its confirm bar); today the server takes the
      // command as sent. K10 moves the confirmation to the server.
      const acks = remote.c.next(
        (m) => m.t === 'ack' && m.reqId === 3,
        8000,
        'ack',
      );
      const st = walls[0].c.next('state', 8000, 'state');
      remote.c.say({ t: 'cmd', reqId: 3, cmd });
      const a = await acks;
      must(a.ok && a.undoId, `ack: ${a.error}`);
      undoId = a.undoId;
      const s = await st;
      const modes = Object.values(s.state.screens).map((v) => v.mode);
      must(
        modes.every((m) => m === 'advance'),
        `modes ${modes.join(',')}`,
      );
      return {
        detail: `rev ${a.rev}; confirmation is client-side today (K10)`,
      };
    },
  );

  await step('K1-S8', 'undo puts every wall back', async () => {
    must(undoId, 'no undo id');
    const acks = remote.c.next(
      (m) => m.t === 'ack' && m.reqId === 4,
      8000,
      'ack',
    );
    const st = walls[0].c.next(
      (m) => m.t === 'state' && m.undone,
      8000,
      'undone state',
    );
    remote.c.say({ t: 'undo', reqId: 4, undoId });
    const a = await acks;
    must(a.ok, `undo: ${a.error}`);
    const s = await st;
    const after = Object.fromEntries(
      Object.entries(s.state.screens).map(([k, v]) => [k, v.mode]),
    );
    must(
      JSON.stringify(after) === JSON.stringify(before),
      `modes ${JSON.stringify(after)}`,
    );
    return { detail: `rev ${a.rev}` };
  });

  // ---- K5: attribution by ref, no device ids, the protocol gate --------
  /** Every device id in play: the socket devices and the S6 page's own. */
  const idsOf = async () => {
    const s6 = await page
      ?.evaluate(() => {
        const rec = JSON.parse(
          localStorage.getItem('tripTwin.soc.slot.6') || 'null',
        );
        return rec?.id || sessionStorage.getItem('tripTwin.soc.device.screen');
      })
      .catch(() => null);
    return ['launcher-qa', remote.id, ...walls.map((d) => d.id), s6].filter(
      Boolean,
    );
  };
  /** Where any of `ids` appears in what these sockets heard. */
  const leaks = (socks, ids) => {
    const hits = [];
    for (const c of socks)
      for (const m of c.out) {
        const text = JSON.stringify(m);
        for (const id of ids)
          if (text.includes(id))
            hits.push(
              `${m.t}${m.type ? `:${m.type}` : ''} ∋ ${id.slice(0, 10)}…`,
            );
      }
    return hits;
  };
  let remoteRef = null;
  await step(
    'K5-S1',
    'attribution: the command and the undo name the remote by ref and host-made name (via touch); state holds refs; no device id in anything the launcher, walls or remote heard',
    async () => {
      const changes = walls[0].c.all('state').filter((m) => m.by);
      must(changes.length >= 3, `${changes.length} attributed broadcasts`);
      const by = changes.at(-1).by;
      must(/^D\d+$/.test(by.ref || ''), `by.ref ${by.ref}`);
      must(
        by.name === 'Trip Twin computer',
        `by.name "${by.name}" (a loopback remote)`,
      );
      must(
        by.via === 'touch' && by.kind === 'remote',
        `via ${by.via}, kind ${by.kind}`,
      );
      must(
        changes.every((m) => m.by.ref === by.ref) &&
          changes.map((m) => m.cause).join(',') === 'cmd,cmd,undo',
        `causes ${changes.map((m) => m.cause).join(',')}`,
      );
      const st = walls[0].c.last('state').state;
      must(
        st.screens[2].meta.role.by === by.ref,
        'S2 meta.role.by is not the ref',
      );
      must(st.lastUndo?.by === by.ref, 'lastUndo.by is not the ref');
      remoteRef = by.ref;
      const p = presenceOf(remote.c);
      const actors = (p?.actors || []).map((a) => `${a.ref} ${a.name}`);
      must(
        actors.includes(`${by.ref} Trip Twin computer`),
        `actors ${actors.join(', ')}`,
      );
      // The real S6 page still says "Updated" for a change (info.by is an
      // object now; the wall tests it for truthiness only).
      const ack = remote.c.next(
        (m) => m.t === 'ack' && m.reqId === 41,
        8000,
        'ack',
      );
      remote.c.say({
        t: 'cmd',
        reqId: 41,
        cmd: { type: 'screens', target: 6, patch: { layers: { qaK5: true } } },
      });
      must((await ack).ok, 'S6 command refused');
      const chip = await waitWall(
        page,
        (x) => /· Updated\b/.test(x.chip),
        8000,
        'S6 "Updated"',
      );
      const ids = await idsOf();
      const hits = leaks([launcher, remote.c, ...walls.map((d) => d.c)], ids);
      must(
        hits.length === 0,
        `device ids heard: ${hits.slice(0, 4).join('; ')}`,
      );
      return {
        detail: `by ${by.ref} "${by.name}" via ${by.via}; S6 chip "${chip.chip}"; ${actors.length} actors; ${ids.length} ids searched in ${[launcher, remote.c, ...walls.map((d) => d.c)].reduce((n, c) => n + c.out.length, 0)} messages: 0 hits`,
      };
    },
  );

  await step(
    'K5-S2',
    'protocol: a wall and a remote page from before K5 (no proto) are told RELOAD with readable text; nothing joins; the S6 chip still reads the remote',
    async () => {
      const told = [];
      for (const [kind, extra] of [
        ['screen', { slot: 3, setup }],
        ['remote', { name: 'iPad' }],
      ]) {
        const c = await client(base);
        const w = c.next('welcome', 8000, `${kind} welcome`);
        c.say({ t: 'hello', id: `${kind}-qa-stale-k5`, kind, ...extra });
        const m = await w;
        must(
          m.type === 'denied' && m.code === 'RELOAD' && m.proto === PROTO,
          `${kind} got ${m.type} ${m.code ?? ''}`,
        );
        must(/out of date/.test(m.error || ''), `${kind} text "${m.error}"`);
        must(!m.state && !m.presence, `${kind} got state or presence`);
        told.push(`${kind}: "${m.error}"`);
        await c.close();
      }
      await sleep(300);
      const p = presenceOf(remote.c);
      must(p?.screens?.[3]?.online, 'S3 left the wall');
      must(p.remotes.length === 1, `${p.remotes.length} remotes`);
      const w = await waitWall(
        page,
        (x) => !x.pairShown && REMOTE_CHIP.test(x.chip),
        15000,
        'the S6 chip',
      );
      return { detail: `${told.join('; ')}; chip "${w.chip}"` };
    },
  );

  await step(
    'K1-S9',
    'restart: kill the server and start it again (store in the QA data folder)',
    async () => {
      if (server.external)
        return { notRun: true, ok: true, detail: '--url: restart skipped' };
      await page.evaluate(() => (window.__ttQaMark = 1));
      await sleep(900); // the relay saves 300 ms after the last change
      await quietRestart(server);
      const slots = storeSlots(server.storeFile);
      must(slots && slots.join() === '1,2,3,4,5,6', `QA store slots ${slots}`);
      // K2: the store is 0600 in a 0700 folder; the old tmp path holds the
      // same wall until K11 (dual write, so a revert still loads).
      const modes = `${modeOf(server.dataDir)}/${modeOf(server.storeFile)}`;
      must(modes === '700/600', `data folder/store modes ${modes}`);
      const old = storeSlots(server.legacyFile);
      must(old && old.join() === slots.join(), `tmp-path copy slots ${old}`);
      return {
        detail: `QA store holds S${slots.join(', S')} (modes ${modes}); tmp-path copy the same`,
      };
    },
  );

  await step(
    'K1-S10',
    'after restart: S1–S5 rejoin their slots, no pair codes',
    async () => {
      if (server.external) return { notRun: true, ok: true };
      for (const d of walls) {
        await d.c.close();
        const w = await d.hello();
        must(
          w.type === 'paired' && w.slot === d.slot,
          `S${d.slot} got ${w.type} ${w.code ? '(pair code)' : ''}`,
        );
      }
    },
  );

  await step(
    'K1-S11',
    'after restart: the remote gets its lease back',
    async () => {
      if (server.external) return { notRun: true, ok: true };
      await remote.c.close();
      const w = await remote.hello();
      must(
        w.type === 'remote' && w.controller === true,
        `remote ${w.type}, controller ${w.controller}`,
      );
    },
  );

  await step(
    'K1-S12',
    'after restart: the S6 page rejoins on its own; its chip comes back',
    async () => {
      if (server.external) return { notRun: true, ok: true };
      const w = await waitWall(
        page,
        (x) => !x.pairShown && REMOTE_CHIP.test(x.chip),
        60000,
        'S6 to rejoin',
      ).catch(async (e) => {
        const st = await page
          .evaluate(() => ({
            href: location.href,
            mark: window.__ttQaMark ?? null,
            ready: document.readyState,
            chip: !!document.querySelector('.tt-wall-chip'),
          }))
          .catch((x) => ({ err: String(x) }));
        throw new Error(`${e.message} · page ${JSON.stringify(st)}`);
      });
      const mark = await page.evaluate(() => window.__ttQaMark ?? null);
      await shot(page, 'S12-wall-after-restart');
      return {
        // HMR is off, but Vite's client still reloads a page when its server
        // comes back (ET-3 R0.1 asked whether it does: it does).
        detail: `chip "${w.chip}"; page ${mark === 1 ? 'kept (socket reconnect)' : 'reloaded by the Vite client, then rejoined'}`,
      };
    },
  );

  await step(
    'K1-S13',
    'presence: six walls online, this remote in control',
    async () => {
      await sleep(5500); // one presence tick
      const p = presenceOf(remote.c);
      const online = [1, 2, 3, 4, 5, 6].filter((s) => p?.screens?.[s]?.online);
      must(online.length === 6, `online S${online.join(', S')}`);
      must(p.youControl === true, 'remote not in control');
    },
  );

  // ---- K2 relay-slice extras: revert-and-restart, then forward again ----
  /** S1–S5 and the remote say hello again; every one must rejoin. */
  const rejoinAll = async () => {
    for (const d of walls) {
      await d.c.close();
      const w = await d.hello();
      must(
        w.type === 'paired' && w.slot === d.slot,
        `S${d.slot} got ${w.type}${w.code ? ' (pair code)' : ''}`,
      );
    }
    await remote.c.close();
    const w = await remote.hello();
    must(w.type === 'remote', `remote got ${w.type}`);
  };
  const s6Back = (what) =>
    waitWall(
      page,
      (x) => !x.pairShown && REMOTE_CHIP.test(x.chip),
      90000,
      what,
    );
  const built = server.sha;
  await step(
    'K2-S1',
    `revert-and-restart: restart on ${REVERT_REF}; S1–S6 and the remote rejoin`,
    async () => {
      if (server.external) return { notRun: true, ok: true };
      await sleep(900);
      await quietRestart(server, { ref: REVERT_REF });
      await rejoinAll();
      const w = await s6Back('S6 to rejoin on the reverted code');
      return {
        detail: `${server.sha}: walls and remote rejoined; S6 page "${w.chip}"`,
      };
    },
  );
  await step(
    'K2-S2',
    'forward again: restart on the build under test; everything rejoins from the data folder, no second migration',
    async () => {
      if (server.external) return { notRun: true, ok: true };
      await sleep(900);
      const from = serverLogSize(server);
      await quietRestart(server, { ref: REF });
      await rejoinAll();
      await s6Back('S6 to rejoin on the build under test');
      const said = serverLogSince(server, from);
      must(!/store\.migrated/.test(said), 'migrated a second time');
      must(/store\.loaded/.test(said), 'did not load the data-folder store');
      return {
        detail: `${server.sha} (was ${built}): store.loaded, no store.migrated`,
      };
    },
  );

  await step(
    'K5-S3',
    'after the restarts and the revert drill: the state names refs only, the remote is attributed by a ref and a kind name, and no device id reaches any socket',
    async () => {
      if (server.external) return { notRun: true, ok: true };
      const acks = remote.c.next(
        (m) => m.t === 'ack' && m.reqId === 51,
        8000,
        'ack',
      );
      const st = walls[0].c.next(
        (m) => m.t === 'state' && m.by,
        8000,
        'attributed state',
      );
      remote.c.say({
        t: 'cmd',
        reqId: 51,
        cmd: { type: 'screens', target: 4, patch: { textScale: 3 } },
      });
      const a = await acks;
      must(a.ok, `ack: ${a.error}`);
      const s1 = await st;
      must(/^D\d+$/.test(s1.by?.ref || ''), `by ${JSON.stringify(s1.by)}`);
      // A pre-K5 build in between rewrites the remote's record (and may
      // name it as the page did): a new ref, never an old one reused.
      const bys = [];
      for (const v of Object.values(s1.state.screens))
        for (const m of Object.values(v.meta || {})) bys.push(m.by);
      for (const m of Object.values(s1.state.session.meta || {}))
        bys.push(m.by);
      must(
        bys.every((b) => b === null || /^D\d+$/.test(b)),
        `meta.by ${bys.filter((b) => !(b === null || /^D\d+$/.test(b))).length} not refs`,
      );
      const hits = leaks([remote.c, ...walls.map((d) => d.c)], await idsOf());
      must(
        hits.length === 0,
        `device ids heard: ${hits.slice(0, 4).join('; ')}`,
      );
      return {
        detail: `by ${s1.by.ref} "${s1.by.name}" (before the drill ${remoteRef}); ${bys.length} attributions, all refs or null; 0 id hits`,
      };
    },
  );

  await step(
    'K3-S1',
    'host check, report mode: today’s rule refuses a foreign Origin; a foreign Host is served and recorded; cross-site GET 403; nothing recorded for the smoke’s own traffic',
    async () => {
      if (server.external) return { notRun: true, ok: true };
      const port = server.port;
      const before = wouldRefuseLines(server);
      must(
        before.length === 0,
        `${before.length} would-refuse line(s) from the smoke's own localhost traffic: ${JSON.stringify(before[0])}`,
      );
      const evil = `evil.example:${port}`;
      const a = await dialRelay(port, { host: evil, origin: `http://${evil}` });
      must(a === 'open', `rebinding pair: ${a}, expected open (today's rule)`);
      for (const host of [`localhost:${port}`, `192.168.1.3:${port}`]) {
        const b = await dialRelay(port, {
          host,
          origin: 'http://evil.example',
        });
        must(
          b === 'refused',
          `Origin evil, Host ${host}: ${b}, expected refused`,
        );
      }
      const x = await rawGet(port, '/api/twin-weather/now?lat=51.5&lon=-0.12', {
        host: `localhost:${port}`,
        'sec-fetch-site': 'cross-site',
      });
      must(x.status === 403, `cross-site weather GET: ${x.status}`);
      must(!x.headers['access-control-allow-origin'], 'CORS header sent');
      const info = await rawGet(port, '/api/twin-sync/info', { host: evil });
      const j = JSON.parse(info.body);
      must(j.hostAllowed === false && j.reason === 'host', 'info: hostAllowed');
      must(
        Array.isArray(j.addresses) && !j.addresses.length,
        'info: addresses',
      );
      const own = JSON.parse(
        (
          await rawGet(port, '/api/twin-sync/info', {
            host: `localhost:${port}`,
          })
        ).body,
      );
      must(
        own.hostAllowed === true && own.hostCheck === 'report',
        'info: own host',
      );
      const lines = wouldRefuseLines(server);
      const kinds = lines.map((l) => `${l.kind}:${l.reason}:${l.effect}`);
      must(
        lines.some(
          (l) =>
            l.host === evil && l.reason === 'host' && l.effect === 'allowed',
        ),
        `no would-refuse line for ${evil}: ${kinds.join(', ')}`,
      );
      must(
        !lines.some(
          (l) =>
            l.effect === 'allowed' &&
            /^(localhost|127\.0\.0\.1|\[::1\]):/.test(l.host || '') &&
            l.origin === `http://${l.host}`,
        ),
        'a same-origin loopback request was recorded',
      );
      const mode = modeOf(server.wouldRefuseFile);
      must(mode === '600', `would-refuse file mode ${mode}`);
      const live1 = statOf(LIVE_WOULD_REFUSE);
      must(
        live1.exists === liveRefuse0.exists &&
          live1.mtimeMs === liveRefuse0.mtimeMs,
        'the live ~/Library/Logs/trip-twin/would-refuse.jsonl changed',
      );
      return {
        detail: `0 lines before the probes; then ${lines.length}: ${kinds.join(', ')}; file 0600; live audit file ${live1.exists ? 'unchanged' : 'absent'}`,
      };
    },
  );

  await step(
    'K1-S14',
    'the live wall session files were not touched',
    async () => {
      const live1 = liveStoreStat();
      const changed = live1
        .map((x, i) =>
          x.exists === live0[i].exists && x.mtimeMs === live0[i].mtimeMs
            ? null
            : `${i ? 'data folder' : 'tmp'} (${new Date(x.mtimeMs || 0).toTimeString().slice(0, 8)}, ${x.size ?? 0} B)`,
        )
        .filter(Boolean);
      if (changed.length) {
        // Still a failure: name the file and any other wall server, so the
        // next person can tell a live wall's own save from a leak (stat only;
        // the file is never opened).
        const r = spawnSync(
          'lsof',
          ['-nP', '-iTCP:4173', '-sTCP:LISTEN', '-Fp'],
          {
            encoding: 'utf8',
          },
        );
        const pid = /^p(\d+)/m.exec(r.stdout || '')?.[1];
        throw new Error(
          `a live store changed during the run: ${changed.join(', ')}${pid ? `; a live wall server listens on :4173 (pid ${pid})` : ''}`,
        );
      }
      return {
        detail: live1
          .map(
            (x, i) =>
              `${i ? 'data folder' : 'tmp'} ${x.exists ? 'unchanged' : 'absent before and after'}`,
          )
          .join('; '),
      };
    },
  );

  // Remote and All-in-one DOM steps: selectors come from the shell's
  // data-tt-* hooks after shell step C (S-5; §3.2 c). Stubs, not failures.
  const TODO = [
    [
      'K1-T1',
      'remote at 1180×820: target S2, Layers off/on, undo',
      'data-tt-target, data-tt-station="layers", data-tt-undo',
    ],
    [
      'K1-T2',
      'remote: All push with S3 pinned ("S3 pinned, unchanged")',
      'data-tt-scope="all", data-tt-pin',
    ],
    [
      'K1-T3',
      'remote: confirm bar for Return all; walls Live',
      'data-tt-confirm, data-tt-return-all',
    ],
    [
      'K1-T4',
      'remote: pair a screen by code through the Screens station',
      'data-tt-station="screens", data-tt-pair',
    ],
    [
      'K1-T5',
      'laptop remote at 1440×900 asks for control, not takes it',
      'data-tt-ask-control',
    ],
    [
      'K1-T6',
      'All-in-one at 2560×1440 and 1728×1117: stations rail, aperture',
      'data-tt-rail, data-tt-aperture',
    ],
  ];
  for (const [id, what, hooks] of TODO)
    await step(id, what, async () => ({
      todo: true,
      ok: true,
      detail: `TODO after shell step C · hooks ${hooks}`,
    }));

  dbg('smoke: closing sockets');
  await launcher?.close();
  for (const d of [...walls, remote]) await d?.c?.close();
  dbg('smoke: closing page');
  await page
    ?.browserContext()
    .close()
    .catch(() => {});
}

// =========================================================== repro-pairing
// CF-2, the lost pairing identity. Every step asserts what the product
// should do (cf/06-qa.md AC-2.1–2.3); on the base that is expected to fail.
// RED = reproduced on this build. GREEN = behaves as it should.
async function reproPairing(server, browser) {
  const base = server.url;
  const verdict = (red, observed, detail = '') => ({
    ok: true,
    verdict: red ? 'RED' : 'GREEN',
    observed,
    detail: `${observed}${detail ? ` · ${detail}` : ''}`,
  });
  const meta = (hyp, expect) => ({ hypothesis: hyp, expect, cleanup: true });

  // ---- In-process, fake clock (the base's own host code) ---------------
  await step(
    'R-1',
    'window reopened after the 10-min setup expiry (fake clock)',
    async () => {
      const { createRelay } = await importBase(
        server,
        'server/tripTwin/syncRelay.js',
      );
      const { createSessionHost } = await importBase(
        server,
        'src/operations/tripTwin/twinSessionHost.js',
      );
      let t = 1_000_000;
      const relay = createRelay({ host: createSessionHost({ now: () => t }) });
      const l = fakeSocket();
      relay.attach(l);
      l.say({ t: 'setup', count: 6 });
      const setup = l.last('setup').setup;
      const a = fakeSocket();
      relay.attach(a);
      a.say({ t: 'hello', id: 'screen-old', kind: 'screen', setup, slot: 4 });
      must(a.last('welcome').type === 'paired', 'first window did not pair');
      a.close(); // the S4 window is closed
      t += SETUP_TTL_MS + 60_000;
      const b = fakeSocket(); // "Open S4" again: a new window, a new id
      relay.attach(b);
      b.say({ t: 'hello', id: 'screen-new', kind: 'screen', setup, slot: 4 });
      const w = b.last('welcome');
      return verdict(
        w.type === 'pair-code',
        `reopened S4 (a new id) got "${w.type}"${w.code ? ` ${w.code}` : ''}`,
        w.type === 'pair-code'
          ? 'old device still listed as S4, offline'
          : 'told why; from K4 the window itself reuses its slot record (R-H4, R-K4a)',
      );
    },
    meta(
      'H4 / BE-7 cause 1 / QA H-c',
      'S4 rejoins (or says why), never a bare pair code',
    ),
  );

  // ---- Socket level, against the QA server ------------------------------
  await step(
    'R-2',
    'one id, two windows: S3 then S4 (socket level)',
    async () => {
      const { c: l, setup } = await startSetup(base, 6);
      const s3 = await device(base, {
        id: 'screen-qa-shared',
        kind: 'screen',
        slot: 3,
      });
      s3.setup = setup;
      await s3.hello();
      const s4 = await device(base, {
        id: 'screen-qa-shared',
        kind: 'screen',
        slot: 4,
      });
      s4.setup = setup;
      s4.token = s3.token; // the cloned window shares localStorage
      let w = await s4.hello();
      const told = w.type === 'denied' ? w.code : null;
      if (told === 'ID_COPIED') {
        // As twinSync.js does (K4): a fresh id, hello again on this socket.
        const again = s4.c.next('welcome', 8000, 'S4 welcome after ID_COPIED');
        s4.c.say({
          t: 'hello',
          proto: PROTO,
          id: 'screen-qa-fresh',
          kind: 'screen',
          slot: 4,
          setup,
        });
        w = await again;
      }
      await sleep(300);
      const p = presenceOf(l);
      const both = Boolean(p?.screens?.[3]?.online && p?.screens?.[4]?.online);
      await l.close();
      await s3.c.close();
      await s4.c.close();
      return verdict(
        !both,
        `${told ? `copy told ${told}, then ` : ''}S4 ${w.type}; presence S3 ${p?.screens?.[3]?.online ? 'online' : p?.screens?.[3] ? 'offline' : 'gone'}, S4 ${p?.screens?.[4]?.online ? 'online' : 'offline'}`,
      );
    },
    meta('H1 / BE-7 cause 2 / QA H-a', 'each window keeps its own slot'),
  );

  await step(
    'R-H2',
    'two live sockets with one id; closing either marks the wall offline',
    async () => {
      const { c: l, setup } = await startSetup(base, 6);
      const a = await device(base, {
        id: 'screen-qa-dup',
        kind: 'screen',
        slot: 2,
      });
      a.setup = setup;
      await a.hello();
      const b = await device(base, {
        id: 'screen-qa-dup',
        kind: 'screen',
        slot: 2,
      });
      b.token = a.token; // a duplicated tab: same sessionStorage, same token
      const w = await b.hello();
      await sleep(200);
      const twoLive =
        a.c.open &&
        b.c.open &&
        w.type === 'paired' &&
        !a.c.last('replaced') &&
        !a.c.last('unpaired');
      await a.c.close();
      await sleep(300);
      const p = presenceOf(l);
      const offline = p?.screens?.[2]?.online === false && b.c.open;
      await l.close();
      await b.c.close();
      return verdict(
        twoLive || offline,
        `second socket ${w.type}, both live ${twoLive}; after the first closes S2 ${offline ? 'OFFLINE while the copy is live' : 'online'}`,
      );
    },
    meta(
      'H2 / QA H-b / AC-2.3',
      'one live socket per id; the survivor stays online',
    ),
  );

  // ---- Headless pages ---------------------------------------------------
  await step(
    'R-H1',
    'launcher tab that once was a wall opens S3 and S4 (window.open copies sessionStorage)',
    async () => {
      const { c: l, setup } = await startSetup(base, 6);
      const ctx = await newCtx();
      const p = await newPage(ctx, 'opener');
      await p.evaluateOnNewDocument(() => {
        // Headless has no screen-placement prompt; placement is not under test.
        delete Window.prototype.getScreenDetails;
      });
      await p.goto(`${base}/twin.html?view=screen&${CITY}`, {
        waitUntil: 'domcontentloaded',
      });
      await waitWall(
        p,
        (x) => x.pairShown,
        120000,
        'the opener to become a screen',
      );
      const openerId = await deviceIdIn(p);
      await p.goto(`${base}/twin.html?view=launch&setup=${setup}&${CITY}`, {
        waitUntil: 'domcontentloaded',
      });
      await p.waitForSelector('.tt-entry-opens button', { timeout: 60000 });
      const pop3 = nextPopup(ctx, 'pop3');
      must(await clickOpen(p, 3), 'no Open S3 button');
      const w3 = await pop3;
      await waitWall(w3, (x) => joined(x, 3), 120000, 'S3');
      const pop4 = nextPopup(ctx, 'pop4');
      must(await clickOpen(p, 4), 'no Open S4 button');
      const w4 = await pop4;
      await waitWall(w4, (x) => joined(x, 4), 120000, 'S4');
      await sleep(1500);
      const [id3, id4] = [await deviceIdIn(w3), await deviceIdIn(w4)];
      const pr = presenceOf(l);
      await shot(w3, 'R-H1-S3');
      await shot(w4, 'R-H1-S4');
      const same = id3 === id4;
      await ctx.close();
      await l.close();
      return verdict(
        same,
        `S3 and S4 ids ${same ? 'EQUAL' : 'distinct'}${id3 === openerId ? ' (copied from the opener)' : ''}; presence S3 ${pr?.screens?.[3]?.online ? 'online' : 'gone/offline'}, S4 ${pr?.screens?.[4]?.online ? 'online' : 'offline'}`,
      );
    },
    meta('H1 / BE-7 H-2 / QA H-a', 'distinct ids; S3 and S4 both online'),
  );

  await step(
    'R-H1c',
    'control: a fresh launcher tab opens S1 and S2',
    async () => {
      const { c: l, setup } = await startSetup(base, 6);
      const ctx = await newCtx();
      const p = await newPage(ctx, 'launcher');
      await p.evaluateOnNewDocument(() => {
        delete Window.prototype.getScreenDetails;
      });
      await p.goto(`${base}/twin.html?view=launch&setup=${setup}&${CITY}`, {
        waitUntil: 'domcontentloaded',
      });
      await p.waitForSelector('.tt-entry-opens button', { timeout: 60000 });
      const pop1 = nextPopup(ctx, 'pop1');
      must(await clickOpen(p, 1), 'no Open S1 button');
      const w1 = await pop1;
      await waitWall(w1, (x) => joined(x, 1), 120000, 'S1');
      const pop2 = nextPopup(ctx, 'pop2');
      must(await clickOpen(p, 2), 'no Open S2 button');
      const w2 = await pop2;
      await waitWall(w2, (x) => joined(x, 2), 120000, 'S2');
      await sleep(1500);
      const same = (await deviceIdIn(w1)) === (await deviceIdIn(w2));
      let pr = presenceOf(l);
      const at = (p, n) =>
        p?.screens?.[n]
          ? p.screens[n].online
            ? 'online'
            : 'offline'
          : 'missing';
      const first = `S1 ${at(pr, 1)}, S2 ${at(pr, 2)} after 1.5 s`;
      // A wall page under SwiftShader can take a while to open its socket:
      // wait up to 10 s for presence before calling it.
      for (
        let i = 0;
        i < 20 && !(pr?.screens?.[1]?.online && pr?.screens?.[2]?.online);
        i++
      ) {
        await sleep(500);
        pr = presenceOf(l);
      }
      const both = Boolean(
        pr?.screens?.[1]?.online && pr?.screens?.[2]?.online,
      );
      const chips = [(await wallText(w1)).chip, (await wallText(w2)).chip];
      await ctx.close();
      await l.close();
      return verdict(
        same || !both,
        `ids ${same ? 'EQUAL' : 'distinct'}; S1 and S2 ${both ? 'both online' : 'not both online'} (${first}; then S1 ${at(pr, 1)}, S2 ${at(pr, 2)}; chips "${chips.join('" / "')}")`,
      );
    },
    meta(
      'control for R-H1',
      'distinct ids; both online (expected GREEN on the base)',
    ),
  );

  await step(
    'R-Hb',
    'duplicated wall tab (window.open of itself), then the original is closed',
    async () => {
      const { c: l, setup } = await startSetup(base, 6);
      const ctx = await newCtx();
      const w1 = await newPage(ctx, 'S5');
      await w1.goto(
        `${base}/twin.html?view=screen&slot=5&setup=${setup}&${CITY}`,
        { waitUntil: 'domcontentloaded' },
      );
      await waitWall(w1, (x) => joined(x, 5), 120000, 'S5');
      const pop = nextPopup(ctx, 'pop');
      await w1.evaluate(() => window.open(location.href, '_blank'));
      const w2 = await pop;
      await waitWall(w2, (x) => joined(x, 5), 120000, 'the copy');
      const same = (await deviceIdIn(w1)) === (await deviceIdIn(w2));
      await sleep(1000);
      // K4: one identity per wall, so the copy is S5 too (its slot
      // record), and the original must have been told and stopped.
      const told = await linkIn(w1);
      await w1.close();
      await sleep(1500);
      const pr = presenceOf(l);
      const off = pr?.screens?.[5]?.online === false;
      const copy = await wallText(w2);
      await shot(w2, 'R-Hb-copy-after-close');
      // The winner reloads: still S5, no pair code (ET S2).
      await w2.reload({ waitUntil: 'domcontentloaded' });
      const re = await waitWall(
        w2,
        (x) => x.pairShown || /^S5 · Remote/.test(x.chip),
        120000,
        'the reloaded copy',
      );
      await ctx.close();
      await l.close();
      return verdict(
        (same && told !== 'replaced') || off || re.pairShown,
        `ids ${same ? 'EQUAL' : 'distinct'}${same ? ` (original ${told === 'replaced' ? 'told: replaced, stopped' : 'NOT told'})` : ''}; after closing the original, S5 ${off ? 'OFFLINE' : 'online'} while the copy shows "${copy.chip}"; the copy reloaded: ${re.pairShown ? 'PAIR CODE' : `"${re.chip}"`}`,
      );
    },
    meta(
      'H2 / QA H-b (duplicate tab)',
      'the copy gets its own identity, or one of the two is told and stops; S5 stays online; the survivor reloads still paired',
    ),
  );

  await step(
    'R-K4a',
    'no Web Locks (as on a LAN address): S5 closed, opened again with an expired link and with none',
    async () => {
      const { c: l, setup } = await startSetup(base, 6);
      const ctx = await newCtx();
      const noLocks = async (pg) =>
        pg.evaluateOnNewDocument(() => {
          Object.defineProperty(Navigator.prototype, 'locks', {
            get: () => undefined,
          });
        });
      const w1 = await newPage(ctx, 'S5');
      await noLocks(w1);
      await w1.goto(
        `${base}/twin.html?view=screen&slot=5&setup=${setup}&${CITY}`,
        { waitUntil: 'domcontentloaded' },
      );
      await waitWall(w1, (x) => joined(x, 5), 120000, 'S5');
      const locksGone = await w1.evaluate(() => !navigator.locks);
      await w1.close();
      await sleep(1000);
      const seen = [];
      // A link the server no longer honours (as after the 10 minutes), then
      // a restored window with no link at all.
      for (const q of [`setup=${'0'.repeat(24)}&`, '']) {
        const w = await newPage(ctx, 'S5-again');
        await noLocks(w);
        await w.goto(`${base}/twin.html?view=screen&slot=5&${q}${CITY}`, {
          waitUntil: 'domcontentloaded',
        });
        const x = await waitWall(
          w,
          (v) => v.pairShown || /^S5 · Remote/.test(v.chip),
          120000,
          'S5 opened again',
        );
        seen.push(x.pairShown ? 'PAIR CODE' : x.chip.split(' · ')[0]);
        await shot(w, `R-K4a-${q ? 'expired' : 'nolink'}`);
        await w.close();
        await sleep(800);
      }
      await ctx.close();
      await l.close();
      return verdict(
        seen.some((x) => x !== 'S5') || !locksGone,
        `Web Locks ${locksGone ? 'off' : 'STILL ON'}; expired link → ${seen[0]}; no link → ${seen[1]}`,
      );
    },
    meta('sup S13 / C16 (slot record without locks)', 'S5 both times, no code'),
  );

  await step(
    'R-Hd',
    'origin switch: a wall paired on localhost reopened on 127.0.0.1',
    async () => {
      const { c: l, setup } = await startSetup(base, 6);
      const ctx = await newCtx();
      const w = await newPage(ctx, 'S6');
      await w.goto(
        `${base}/twin.html?view=screen&slot=6&setup=${setup}&${CITY}`,
        { waitUntil: 'domcontentloaded' },
      );
      await waitWall(w, (x) => joined(x, 6), 120000, 'S6');
      await sleep(500);
      // The page dropped its setup link once joined; reopen what it shows.
      const now = await w.evaluate(() => location.href);
      const other = now.replace('//localhost:', '//127.0.0.1:');
      await w.goto(other, { waitUntil: 'domcontentloaded' });
      const x = await waitWall(
        w,
        (v) => v.pairShown || /^S6 · Remote/.test(v.chip),
        120000,
        'the 127.0.0.1 page',
      );
      await shot(w, 'R-Hd-127');
      await ctx.close();
      await l.close();
      return verdict(
        x.pairShown,
        x.pairShown
          ? `on ${x.host} the wall shows a PAIR CODE (new id, no token)`
          : `sent to ${x.host} and rejoined: "${x.chip}"`,
        'LAN IP and .local: separate origins, by hand (S-23 covers loopback names only)',
      );
    },
    meta(
      'H3 / QA H-d',
      'rejoins S6, or the launcher sends 127.0.0.1 to localhost (S-23)',
    ),
  );

  await step(
    'R-H4',
    'live: close S4, wait past the setup expiry, Open S4 again from the launcher',
    async () => {
      if (!has('wait-expiry'))
        return {
          ok: true,
          notRun: true,
          detail:
            'needs --wait-expiry (10.5 min); R-1 covers it on a fake clock',
        };
      const { c: l, setup } = await startSetup(base, 6);
      const ctx = await newCtx();
      const p = await newPage(ctx, 'launcher');
      await p.evaluateOnNewDocument(() => {
        delete Window.prototype.getScreenDetails;
      });
      await p.goto(`${base}/twin.html?view=launch&setup=${setup}&${CITY}`, {
        waitUntil: 'domcontentloaded',
      });
      await p.waitForSelector('.tt-entry-opens button', { timeout: 60000 });
      let pop = nextPopup(ctx, 'S4');
      must(await clickOpen(p, 4), 'no Open S4 button');
      let w4 = await pop;
      await waitWall(w4, (x) => joined(x, 4), 120000, 'S4');
      await w4.close();
      log(
        `          waiting ${Math.round((SETUP_TTL_MS + 30000) / 60000)} min for the setup link to expire…`,
      );
      await sleep(SETUP_TTL_MS + 30000);
      pop = nextPopup(ctx, 'S4');
      must(await clickOpen(p, 4), 'no Open S4 button');
      w4 = await pop;
      // Connected: the pair card, or a chip past "not connected" (every
      // slot window says "S4 · not connected" before its socket opens).
      const x = await waitWall(
        w4,
        (v) => v.pairShown || /^S4 · Remote/.test(v.chip),
        120000,
        'the reopened S4',
      );
      await sleep(1000);
      const s4 = presenceOf(l)?.screens?.[4];
      await shot(w4, 'R-H4-reopened');
      await ctx.close();
      await l.close();
      return verdict(
        x.pairShown || !s4?.online,
        x.pairShown
          ? 'the reopened S4 shows a PAIR CODE'
          : `rejoined: "${x.chip}"; presence S4 ${s4?.online ? 'online' : 'NOT online'}`,
      );
    },
    meta(
      'H4 / BE-7 H-1 / QA H-c (live)',
      'the reopened window rejoins S4 or says why',
    ),
  );

  // ---- Server restart, and a torn store ---------------------------------
  let keep = null;
  await step(
    'R-He',
    'server restart: walls rejoin with their tokens',
    async () => {
      if (server.external) return { ok: true, notRun: true, detail: '--url' };
      const { c: l, setup } = await startSetup(base, 6);
      keep = await device(base, {
        id: 'screen-qa-keep',
        kind: 'screen',
        slot: 1,
      });
      keep.setup = setup;
      await keep.hello();
      await sleep(900);
      await l.close();
      await keep.c.close();
      await server.restart();
      const w = await keep.hello();
      await keep.c.close();
      return verdict(
        !(w.type === 'paired' && w.slot === 1),
        `rejoined as ${w.type} ${w.slot ?? ''}`,
      );
    },
    meta('H-e (QA)', 'rejoins S1 (expected GREEN on the base)'),
  );

  // A crash in the middle of a save. Before K2 the relay wrote the store in
  // place, so a cut-off save tore the store itself. From K2 a save writes
  // <store>.tmp, fsyncs and renames, so a cut-off save can only tear the
  // temp file; the last good store is still whole beside it.
  const atomic = server.app
    ? fs.existsSync(path.join(server.app, 'server/tripTwin/sessionStore.js'))
    : false;
  const storeNow = () =>
    atomic
      ? server.storeFile
      : path.join(server.tmp, 'trip-twin-soc-session.json');
  await step(
    'R-3',
    'a save cut off half-way (crash mid-write) at start-up',
    async () => {
      if (server.external || !keep)
        return { ok: true, notRun: true, detail: 'needs R-He' };
      await server.stop();
      const file = storeNow();
      const text = fs.readFileSync(file, 'utf8');
      const torn = atomic ? `${file}.tmp` : file;
      fs.writeFileSync(torn, text.slice(0, Math.floor(text.length / 2)));
      await server.restart();
      const w = await keep.hello();
      await keep.c.close();
      const left = atomic && fs.existsSync(torn);
      return verdict(
        w.type !== 'paired' || w.slot !== 1 || left,
        `${atomic ? 'torn temp file beside the store' : 'store torn in place (pre-K2 save)'}: S1 got ${w.type}${w.type === 'pair-code' ? ' (whole wall lost)' : ''}${atomic ? `; temp ${left ? 'still there' : 'deleted unread'}` : ''}`,
      );
    },
    meta(
      'BE-7 cause 3 (store)',
      'a cut-off save leaves the last good store whole and the wall rejoins (K2 atomic write)',
    ),
  );
  await step(
    'R-3q',
    'a store damaged outside a save (disk, hand edit) at start-up',
    async () => {
      if (server.external || !keep || !atomic)
        return {
          ok: true,
          notRun: true,
          detail: atomic ? 'needs R-He' : 'pre-K2 build: no quarantine',
        };
      await server.stop();
      const q = path.join(server.dataDir, 'quarantine');
      const before = fs.existsSync(q) ? fs.readdirSync(q).length : 0;
      const text = fs.readFileSync(server.storeFile, 'utf8');
      fs.writeFileSync(
        server.storeFile,
        text.slice(0, Math.floor(text.length / 2)),
      );
      await server.restart();
      const info = await fetch(`${base}/api/twin-sync/info`).then((x) =>
        x.json(),
      );
      const after = fs.existsSync(q) ? fs.readdirSync(q).length : 0;
      const backup = fs.existsSync(
        path.join(server.dataDir, 'session.prev.json'),
      );
      const w = await keep.hello();
      await keep.c.close();
      return verdict(
        !(info.ok && after === before + 1 && backup && w.type === 'pair-code'),
        `server up ${Boolean(info.ok)}; quarantine ${before}→${after}; backup ${backup ? 'kept for a hand restore' : 'missing'}; S1 got ${w.type} (fresh wall by design: S-14, no automatic restore)`,
      );
    },
    meta(
      'S-14 quarantine',
      'the bad file moves to quarantine/, the server starts fresh, the backup waits for a hand restore',
    ),
  );

  const BY_HAND = [
    'Chrome quit and relaunch with "Continue where you left off": do the four Mac Studio walls keep their slots? (QA H-c, AC-2.1)',
    'Mac Studio reboot, Vite started by hand, Chrome restores the walls (E14)',
    'Walls opened through the LAN IP or the .local name, then through localhost (QA H-d; the QA server is loopback-only so the keys never leave this machine)',
    'Tab › Duplicate on a wall window in real Chrome (QA H-b)',
    'A wall window closed by accident and reopened from the launcher after 10 minutes, in real time (H4)',
    'K4: on the iPad (plain http, no Web Locks), close the remote tab and open the remote page again after 10 minutes: it rejoins without a QR (F-0014 a)',
    'K4: open the same wall twice on the Mac Studio (a second launcher tab): the older window stops with "not connected" and the newer one is the wall (C16)',
  ];
  for (const [i, what] of BY_HAND.entries())
    await step(`M4.1-${i + 1}`, what, async () => ({
      ok: true,
      notRun: true,
      detail: 'by hand on the Mac Studio',
    }));
}

// ================================================================== main
async function main() {
  if (!['smoke', 'repro-pairing', 'full'].includes(MODE)) {
    console.error(`unknown mode ${MODE}: smoke | repro-pairing | full`);
    return 2;
  }
  if (MODE === 'full') {
    console.log(
      'full: TODO after shell step C (S-1 … S-9 need the data-tt-* hooks)',
    );
    return 2;
  }
  fs.mkdirSync(OUT, { recursive: true });
  log(`Trip Twin multi-view · ${MODE} · QA folder ${QA_DIR}`);
  let server = null;
  let browser = null;
  let code = 0;
  try {
    server = await startServer();
    browser = await puppeteer.launch({ headless: true, args: FLAGS });
    BROWSER = browser;
    if (MODE === 'smoke') await smoke(server, browser);
    else await reproPairing(server, browser);
  } catch (e) {
    results.push({
      id: 'harness',
      what: 'harness',
      ok: false,
      detail: String(e?.stack || e),
    });
    log(`  FAIL harness — ${e?.message || e}`);
  } finally {
    dbg('closing the browser');
    await browser?.close().catch(() => {});
    dbg('stopping the server');
    if (server && !server.external && !has('keep')) await server.stop();
    dbg('stopped');
  }
  const pageerrors = pageErrors.filter((e) => e.kind === 'pageerror');
  const failed = results.filter((r) => !r.ok);
  const red = results.filter((r) => r.verdict === 'RED');
  if (MODE === 'smoke' && (failed.length || pageerrors.length)) code = 1;
  if (
    MODE === 'repro-pairing' &&
    (failed.length || (has('strict') && red.length))
  )
    code = 1;
  log(
    `\nPage errors: ${pageerrors.length} pageerror, ${pageErrors.length - pageerrors.length} console.error (FIRMS 503 allowed)`,
  );
  for (const e of pageErrors.slice(0, 12))
    log(`  ${e.kind} ${e.page}: ${e.text}`);
  const summary = {
    mode: MODE,
    at: new Date().toISOString(),
    commit: server?.sha || null,
    node: process.versions.node,
    server: server
      ? {
          url: server.url,
          external: Boolean(server.external),
          keysPassed: server.keysPassed ?? null,
        }
      : null,
    steps: results,
    pageErrors,
    exit: code,
  };
  fs.writeFileSync(
    path.join(OUT, 'results.json'),
    JSON.stringify(summary, null, 2),
  );
  const md = [
    `# ${MODE} · ${summary.commit || '?'} · ${summary.at}`,
    '',
    '| Step | What | Result | Detail |',
    '|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.what} | ${r.verdict || (r.todo ? 'TODO' : r.notRun ? 'NOT RUN' : r.ok ? 'PASS' : 'FAIL')} | ${String(r.detail || '').replace(/\|/g, '/')} |`,
    ),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'results.md'), `${md}\n`);
  log(`\n${code ? 'FAIL' : 'DONE'} · ${MODE} · results ${OUT}`);
  return code;
}

process.exitCode = await main();
