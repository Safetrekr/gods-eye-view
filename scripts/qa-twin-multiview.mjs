#!/usr/bin/env node
// Trip Twin multi-view headless harness (Phase CF K1; PHASE-CF-PLAN S-5,
// cf/06-qa.md QA-4, QA-16; cf/02-backend.md BE-7; cf/07-reasoning.md
// ET-3 R0.1, ET-4).
//   node scripts/qa-twin-multiview.mjs smoke [--dir <qa folder>] [--keep]
//     [--ref HEAD|worktree] [--revert-ref <ref>]
//   node scripts/qa-twin-multiview.mjs repro-pairing [--dir …]
//     [--wait-expiry] [--strict]
//   node scripts/qa-twin-multiview.mjs full        (after shell step C)
// K8: the smoke drives the remote page, the walls' cards and the
// All-in-one rail through the data-tt-* hooks (K1's T1–T6 are real).
// Runs against the isolated QA server (scripts/qa-twin-server.mjs): a git
// archive of HEAD on :4181, HMR off, its own cacheDir, data folder and
// TMPDIR. --ref worktree serves the working tree (a slice gate before its
// commit). The smoke's revert drill restarts on --revert-ref (default: the
// commit before the one under test; HEAD for the working tree) and then on
// the build under test again. --url runs against a server you started
// (restart steps are then skipped). Results go to
// <qa folder>/runs/<mode>-<time>/ (results.json, results.md, shots).
// From L5 (hashed tokens, v:2 store) a revert to a build below L5 is a
// re-pair by design: the drill checks the walls and the remote are told so
// and nothing crashes, then re-pairs on the build under test; L5-S1 scans
// the QA data folder and TMPDIR for every token the run held.
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
import { plainTokenFiles, tokenHash } from '../server/tripTwin/twinTokens.js';

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
/** Every device token this run was given (never printed; L5-S1 scan). */
const SEEN_TOKENS = new Set();
/** A build from L5 on keeps token hashes only (twinTokens.js exists). */
const hashedBuild = (server) =>
  Boolean(server.app) &&
  fs.existsSync(path.join(server.app, 'server/tripTwin/twinTokens.js'));

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
    if (w.token) {
      d.token = w.token;
      SEEN_TOKENS.add(w.token);
    }
    // As twinSync.js from K4: once joined, a device rejoins by its token
    // and no longer sends the setup link (older builds ignore it then).
    if (w.type === 'paired' || w.type === 'remote') d.setup = null;
    return w;
  };
  return d;
}

/**
 * K10: a command as the remote's Confirm sends it: when the server asks
 * (CONFIRM_REQUIRED), answer with `confirm` and the same reqId. Resolves
 * with the final ack.
 */
async function cmdAnswered(dev, reqId, cmd, ms = 8000) {
  const first = dev.c.next(
    (m) => m.t === 'ack' && m.reqId === reqId,
    ms,
    'ack',
  );
  dev.c.say({ t: 'cmd', reqId, cmd });
  const a = await first;
  if (a.code !== 'CONFIRM_REQUIRED') return a;
  const second = dev.c.next(
    (m) => m.t === 'ack' && m.reqId === reqId,
    ms,
    'confirm ack',
  );
  dev.c.say({ t: 'confirm', reqId, confirmId: a.confirmId });
  return second;
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
/** The live audit folder (K6); only ever stat'ed, never created. */
const LIVE_AUDIT_DIR = path.dirname(LIVE_WOULD_REFUSE);
/** Every audit line in the QA server's folder (K6), oldest file first. */
function auditLines(server) {
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(server.auditDir);
  } catch {
    return out;
  }
  for (const n of names.filter((x) => /^audit-.*\.jsonl$/.test(x)).sort())
    for (const l of fs
      .readFileSync(path.join(server.auditDir, n), 'utf8')
      .split('\n')
      .filter(Boolean))
      try {
        out.push(JSON.parse(l));
      } catch {
        out.push({ torn: true });
      }
  return out;
}
/** All the bytes in the QA audit folder (the K6 canary greps them). */
function auditFolderText(server) {
  let text = '';
  try {
    for (const n of fs.readdirSync(server.auditDir))
      text += fs.readFileSync(path.join(server.auditDir, n), 'utf8');
  } catch {
    /* no folder */
  }
  return text;
}
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
  // And a fresh audit folder (K7): a second run in the same QA folder
  // would otherwise read the first run's would-refuse probes in K3-S1.
  fs.rmSync(path.join(QA_DIR, 'audit'), { recursive: true, force: true });
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
// ===================================================================== K8
// Phase CF K8 (operator states, part 1): the wall cards and chip, the
// remote's status strip, active-station card and Screens & devices, the
// launcher's strip and the All-in-one rail, through the data-tt-* hooks.
// K1's six DOM stubs (T1–T6) are real steps here.

/** Wait in a page until fn(arg) is truthy there; returns its value. */
async function pageUntil(p, fn, arg = null, ms = 15000, what = 'a page state') {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    try {
      last = await p.evaluate(fn, arg);
      if (last) return last;
    } catch {
      /* navigating */
    }
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const textIn = (p, sel) =>
  p.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
/** Press a button by its hook (it must be there and enabled). */
async function press(p, sel) {
  const ok = await p.evaluate((s) => {
    const b = document.querySelector(s);
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }, sel);
  must(ok, `nothing to press at ${sel}`);
  await sleep(150);
}
/** Type into the remote's pairing fields (as a person would). */
const fillPair = (p, code, slot) =>
  p.evaluate(
    (code, slot) => {
      const i = document.querySelector('[aria-label="Pairing code"]');
      const s = document.querySelector('[aria-label="Screen number"]');
      i.value = code;
      i.dispatchEvent(new Event('input', { bubbles: true }));
      s.value = String(slot);
      s.dispatchEvent(new Event('change', { bubbles: true }));
    },
    code,
    slot,
  );
/**
 * A page whose hello is changed before it leaves: `proto` sent instead of
 * this build's (a real relay then says RELOAD), or the first `fakes`
 * answered by a scripted relay message (the K7 relay tests prove the relay
 * sends them; this checks only what the page shows).
 */
async function scriptHello(p, { proto = null, fakes = [] } = {}) {
  await p.evaluateOnNewDocument(
    (proto, fakes) => {
      const send = WebSocket.prototype.send;
      let n = 0;
      WebSocket.prototype.send = function (data) {
        try {
          const m = JSON.parse(data);
          if (m.t === 'hello') {
            const fake = fakes[n++];
            if (fake) {
              setTimeout(
                () =>
                  this.dispatchEvent(
                    new MessageEvent('message', { data: JSON.stringify(fake) }),
                  ),
                30,
              );
              return undefined;
            }
            if (proto != null)
              return send.call(this, JSON.stringify({ ...m, proto }));
          }
        } catch {
          /* not JSON */
        }
        return send.call(this, data);
      };
    },
    proto,
    fakes,
  );
}
/** What a wall window shows: its card, and what else is visible. */
const cardIn = (p) =>
  p.evaluate(() => {
    const b = document.body;
    const node = [
      ...document.querySelectorAll('.tt-wall-pair, .tt-wall-card'),
    ].find((n) => !n.hidden);
    const q = (s) => node?.querySelector(s)?.textContent ?? null;
    return {
      card: b.dataset.ttCard || null,
      unpaired: b.classList.contains('tt-unpaired'),
      render: b.dataset.ttRender || null,
      // The dot grid is the unpaired field's own (never over live 3D).
      grid: /radial-gradient/.test(getComputedStyle(b).backgroundImage),
      gridNode: Boolean(document.querySelector('.tt-wall-grid')),
      kicker: q('.k'),
      lines: [...(node?.querySelectorAll('.lead') || [])].map(
        (x) => x.textContent,
      ),
      code: q('.code'),
      how: q('.how'),
      valid: q('.valid'),
      foot: q('.foot'),
      button: q('button'),
      host: location.host,
      visible: [...b.children]
        .filter((c) => {
          if (c.hidden) return false;
          const st = getComputedStyle(c);
          return st.visibility !== 'hidden' && st.display !== 'none';
        })
        .map((c) => String(c.className || c.id || c.tagName).split(' ')[0]),
    };
  });
const ONLY_CARD = (x) =>
  x.unpaired &&
  x.render === 'paused' &&
  x.grid &&
  !x.gridNode &&
  x.visible.every((v) => ['tt-wall-pair', 'tt-wall-card'].includes(v));
const HHMM = '\\d\\d:\\d\\d';
const STEEL_SHOTS = []; // [{file, box?}] checked for saturated colour (K8-S9)
/**
 * Pixels that are clearly coloured (HSV saturation > 0.35 and value >
 * 0.35) in a PNG, inside an optional box {x, y, w, h} (CSS px × dpr).
 */
async function saturatedIn(file, box = null) {
  const { PNG } = await import('pngjs');
  const png = PNG.sync.read(fs.readFileSync(file));
  const x0 = box?.x ?? 0;
  const y0 = box?.y ?? 0;
  const x1 = Math.min(png.width, x0 + (box?.w ?? png.width));
  const y1 = Math.min(png.height, y0 + (box?.h ?? png.height));
  let n = 0;
  let worst = null;
  for (let y = y0; y < y1; y += 1)
    for (let x = x0; x < x1; x += 1) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const v = max / 255;
      const s = max ? (max - min) / max : 0;
      if (s > 0.35 && v > 0.35) {
        n += 1;
        if (!worst) worst = { x, y, rgb: [r, g, b] };
      }
    }
  return { n, worst, px: (x1 - x0) * (y1 - y0) };
}
/**
 * The wall's status column (clock, data age, chip, tags): the chrome C65
 * keeps steel. The header's other-trip chip is red on purpose (walls-live
 * W1: an incident), so the band is sampled without it.
 */
async function chipBand(p) {
  const r = await p.evaluate(() => {
    const b = document.querySelector('.tt-wall-right')?.getBoundingClientRect();
    const d = window.devicePixelRatio || 1;
    return (
      b && { x: b.left * d, y: b.top * d, w: b.width * d, h: b.height * d }
    );
  });
  return r
    ? {
        x: Math.floor(r.x),
        y: Math.floor(r.y),
        w: Math.ceil(r.w),
        h: Math.ceil(r.h),
      }
    : { x: 0, y: 0, w: 1280, h: 96 };
}

async function shotSteel(p, name, box = null) {
  await shot(p, name);
  STEEL_SHOTS.push({ file: path.join(OUT, 'shots', `${name}.png`), box, name });
}

async function smoke(server, browser) {
  const base = server.url;
  const { needsConfirm } = await importBase(
    server,
    'src/operations/tripTwin/twinSession.js',
  );
  const live0 = liveStoreStat();
  const liveRefuse0 = statOf(LIVE_WOULD_REFUSE);
  const liveAudit0 = statOf(LIVE_AUDIT_DIR);
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
    'K8-S1',
    'calm unpaired wall (SUP-5): only the field, the dot grid and the pair card; the 3D scene paused; the card’s words as Appendix D',
    async () => {
      must(page, 'no S6 page');
      await pageUntil(
        page,
        () => document.body.dataset.ttCard === 'pair',
        null,
        30000,
        'the pair card',
      );
      const x = await cardIn(page);
      must(
        ONLY_CARD(x),
        `not calm: unpaired ${x.unpaired}, render ${x.render}, grid ${x.grid}, grid node ${x.gridNode}, visible ${x.visible.join(', ')}`,
      );
      must(x.kicker === 'PAIR THIS SCREEN', `kicker "${x.kicker}"`);
      must(
        x.how ===
          'On the remote in control: Screens & devices › Pair a screen. Enter this code and pick the screen number.',
        `how "${x.how}"`,
      );
      must(
        new RegExp(`^Code valid until ${HHMM} · a new one appears then$`).test(
          x.valid || '',
        ),
        `valid "${x.valid}"`,
      );
      must(
        x.foot ===
          `${x.host} · this window shows nothing from the wall until it is paired`,
        `foot "${x.foot}"`,
      );
      await shotSteel(page, 'K8-S1-wall-unpaired');
      return {
        detail: `card "${x.kicker}" with a code; visible: ${x.visible.join(', ')}; 3D ${x.render}`,
      };
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
      // K10: the server asks; nothing changes until the remote confirms.
      const asked = remote.c.next(
        (m) => m.t === 'ack' && m.reqId === 3,
        8000,
        'ack',
      );
      remote.c.say({ t: 'cmd', reqId: 3, cmd });
      const q = await asked;
      must(
        q.code === 'CONFIRM_REQUIRED' && q.confirmId,
        `the server did not ask: ${q.code || q.ok}`,
      );
      const acks = remote.c.next(
        (m) => m.t === 'ack' && m.reqId === 3,
        8000,
        'confirm ack',
      );
      const st = walls[0].c.next('state', 8000, 'state');
      remote.c.say({ t: 'confirm', reqId: 3, confirmId: q.confirmId });
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
        detail: `rev ${a.rev}; the server asked and the remote confirmed (K10)`,
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
      // The real S6 page names the device in its chip (K8: the words come
      // from twinDescribe.js).
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
        (x) => /^S6 · .+ · by (Trip Twin computer|iPad)\b/.test(x.chip),
        8000,
        'the S6 chip to name the remote',
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
    'H5-S1',
    'hazard demos (review/hazards H5): the remote starts the demo fire; the S6 wall shows LIVE · DEMO FIRE and the SIMULATED fire line on the trip in focus; Return all ends it on the wall',
    async () => {
      // A demo start and Return all ask first (K10): confirmed here.
      const send = async (reqId, cmd) => {
        const a = await cmdAnswered(remote, reqId, cmd);
        must(a.ok, `${cmd.type} refused: ${a.code || a.error}`);
      };
      const look = () =>
        page.evaluate(() => ({
          badge: document.querySelector('.tt-wall-badge')?.textContent || '',
          hz: [...document.querySelectorAll('.tt-trip-hz')].map(
            (n) => n.textContent,
          ),
        }));
      const until = async (pred, what, ms = 45000) => {
        const t0 = Date.now();
        let last = null;
        while (Date.now() - t0 < ms) {
          last = await look().catch(() => null);
          if (last && pred(last)) return last;
          await sleep(500);
        }
        throw new Error(
          `timed out waiting for ${what}: ${JSON.stringify(last)}`,
        );
      };
      await send(61, { type: 'session', patch: { simFire: Date.now() } });
      const on = await until(
        (x) =>
          /LIVE · DEMO FIRE/.test(x.badge) &&
          x.hz.some((t) => /^SIMULATED · Demo Fire boundary/.test(t)),
        'the demo fire on S6',
      );
      await send(62, { type: 'returnLive' });
      const off = await until(
        (x) =>
          x.badge.trim() === 'LIVE' && !x.hz.some((t) => /SIMULATED/.test(t)),
        'Return all to end the demo on S6',
      );
      return {
        detail: `on: "${on.badge}" · "${on.hz[0]}"; after Return all: "${off.badge}", ${off.hz.length} hazard lines`,
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

  // ---- K8: the chip names the device; the remote page (T1–T3, T5) -----
  await step(
    'K8-S2',
    'E8.1: the S6 wall names the device within 2 s of its change ("S6 · Scale grid off · by …", no clock time: walls-live W5), then the short chip "S6 · Remote: …" after 3 s, with "last change m:ss ago" in its title (the menu says it: screens/05-S1-PLAN §2)',
    async () => {
      await sleep(3500); // past any earlier 3 s window
      const ack = remote.c.next(
        (m) => m.t === 'ack' && m.reqId === 81,
        8000,
        'ack',
      );
      const t0 = Date.now();
      remote.c.say({
        t: 'cmd',
        reqId: 81,
        cmd: { type: 'screens', target: 6, patch: { layers: { grid: false } } },
      });
      must((await ack).ok, 'S6 command refused');
      const chip = await pageUntil(
        page,
        (re) => {
          const t = document.querySelector('[data-tt-chip]')?.textContent || '';
          return new RegExp(re).test(t) && t;
        },
        // No clock time in a wall chip (walls-live W5).
        '^S6 · Scale grid off · by Trip Twin computer$',
        2000,
        'the S6 chip to name the remote within 2 s',
      );
      const ms = Date.now() - t0;
      await shotSteel(page, 'K8-S2-wall-chip-change', await chipBand(page));
      const idle = await pageUntil(
        page,
        () => {
          const c = document.querySelector('[data-tt-chip]');
          const t = c?.textContent || '';
          return (
            /^S6 · Remote: Trip Twin computer$/.test(t) &&
            /^S6 · Remote: Trip Twin computer · last change 0:0\d ago$/.test(
              c.title,
            ) &&
            `${t} (title "${c.title}")`
          );
        },
        null,
        8000,
        'the idle chip',
      );
      await shotSteel(page, 'K8-S2-wall-chip-idle', await chipBand(page));
      return { detail: `"${chip}" ${ms} ms after the command; then "${idle}"` };
    },
  );

  // ---- Shell D5 (CF contract): a wall's own L sheet --------------------
  await step(
    'D5-S1',
    'shell D5 under CF: the S6 wall opens its own L sheet and turns the grid back on; the remote hears a CMD state by S6 via keyboard (no label, no raw id) and the chip says "S6 · Scale grid on · by S6 at the wall · HH:MM"',
    async () => {
      await sleep(3500); // past the K8-S2 chip window
      const heard = remote.c.next(
        (m) => m.t === 'state' && m.by?.via === 'keyboard',
        8000,
        'the keyboard state',
      );
      await page.keyboard.press('l');
      await page.waitForSelector('.tt-wall-sheet:not([hidden])', {
        timeout: 5000,
      });
      await page.click('.tt-wall-sheet [data-focus="layer:grid"]');
      const st = await heard;
      must(st.cause === 'cmd', `cause ${st.cause}`);
      must(
        st.by.kind === 'screen' && st.by.slot === 6 && st.by.name === 'S6',
        `by ${JSON.stringify(st.by)}`,
      );
      must(/^D\d+$/.test(st.by.ref), 'by.ref is a ref');
      must(!('label' in st) && !('slot' in st), 'no label or slot beside by');
      must(st.state.screens[6].layers.grid === true, 'S6 grid on');
      const chip = await pageUntil(
        page,
        (re) => {
          const t = document.querySelector('[data-tt-chip]')?.textContent || '';
          return new RegExp(re).test(t) && t;
        },
        // A wall chip carries no clock time (walls-live W5); hands-on is a
        // tag in the header, not in the chip (W4).
        '^S6 · Scale grid on · by S6 at the wall$',
        3000,
        'the S6 chip to name the wall',
      ).catch(async (e) => {
        const now = await page.evaluate(
          () => document.querySelector('[data-tt-chip]')?.textContent || '',
        );
        throw new Error(`${e.message} (chip says "${now}")`);
      });
      await page.keyboard.press('Escape');
      return {
        detail: `by ${st.by.ref} (${st.by.name}, via ${st.by.via}); chip "${chip}"`,
      };
    },
  );

  // The remote page on this computer joins as a second remote (view only).
  let rmCtx = null;
  let rm = null;
  const control = () => textIn(rm, '[data-tt-control]');
  const barText = () => textIn(rm, '[data-tt-bar] .t');
  const wallState = (n) => walls[n - 1].c.last('state')?.state;
  await step(
    'K1-T5 / K8-R1',
    'T5: a second remote page at 1180×820 is view only ("View only · … in control since HH:MM"), asks for control and does not take it; handed over, its status strip says "In control · this remote (…)"',
    async () => {
      rmCtx = await BROWSER.createBrowserContext();
      rm = await rmCtx.newPage();
      rm.setDefaultNavigationTimeout(120000);
      watch(rm, 'remote-page');
      await rm.setViewport({ width: 1180, height: 820 });
      await rm.goto(`${base}/twin-remote.html?setup=${setup}`, {
        waitUntil: 'domcontentloaded',
      });
      const view = await pageUntil(
        rm,
        (re) => {
          const t =
            document.querySelector('[data-tt-control]')?.textContent || '';
          return new RegExp(re).test(t) && t;
        },
        `^View only · Trip Twin computer in control since ${HHMM}$`,
        30000,
        'the view-only control cell',
      );
      await shot(rm, 'K8-R1-remote-view-only');
      const asked = remote.c.next(
        (m) => m.presence?.handover && !m.presence.handover.you,
        8000,
        'the handover request',
      );
      await press(rm, '[data-tt-ask-control]');
      const h = (await asked).presence.handover;
      must(h.fromName === 'Trip Twin computer 2', `asked by "${h.fromName}"`);
      must(/^View only/.test(await control()), 'took control without asking');
      must(
        (await textIn(rm, '[data-tt-ask-control]')) === 'Asked for control…',
        'the button does not say it asked',
      );
      remote.c.say({ t: 'handover', accept: true });
      const inc = await pageUntil(
        rm,
        () => {
          const t =
            document.querySelector('[data-tt-control]')?.textContent || '';
          return t === 'In control · this remote (Trip Twin computer 2)' && t;
        },
        null,
        10000,
        'the page to be in control',
      );
      await shot(rm, 'K8-R1-remote-in-control');
      return { detail: `"${view}" → asked → "${inc}"` };
    },
  );

  await step(
    'K1-T1 / K8-R2',
    'T1: target S2, Layers & display, a layer on, then Undo: S2 changes and goes back; the bar and the active-station card say it in the describer’s words',
    async () => {
      must(rm, 'no remote page');
      await press(rm, '[data-tt-target="2"]');
      await press(rm, '[data-tt-station="layers"]');
      const on = walls[1].c.next(
        (m) => m.t === 'state' && m.state.screens[2]?.layers?.streets === true,
        8000,
        'S2 streets on',
      );
      await press(rm, '[data-tt-layer="streets:on"]');
      const st = await on;
      must(st.by?.name === 'Trip Twin computer 2', `by ${st.by?.name}`);
      const said = await pageUntil(
        rm,
        () =>
          document.querySelector('[data-tt-bar] .t')?.textContent ===
            'S2: streets on' && 'S2: streets on',
        null,
        5000,
        'the result line',
      );
      const card = await pageUntil(
        rm,
        (re) => {
          const t =
            document.querySelector('[data-tt-last-change]')?.textContent || '';
          return new RegExp(re).test(t) && t;
        },
        `^Last change on S2 · ${HHMM} · streets on · by Trip Twin computer 2$`,
        5000,
        'the last-change line',
      );
      await shot(rm, 'K8-R2-remote-result');
      const back = walls[1].c.next(
        (m) => m.t === 'state' && m.cause === 'undo',
        8000,
        'S2 undone',
      );
      await press(rm, '[data-tt-undo]');
      const u = await back;
      must(!u.state.screens[2].layers?.streets, 'S2 streets still on');
      const undone = await pageUntil(
        rm,
        () => {
          const t = document.querySelector('[data-tt-bar] .t')?.textContent;
          return t === 'Undone on S2: streets off' && t;
        },
        null,
        5000,
        'the undo line',
      );
      return { detail: `"${said}" · "${card}" · "${undone}"` };
    },
  );

  await step(
    'K1-T2 / K8-R3',
    'T2: pin S3 in Screens & devices, then an All push of a layer: every other screen changes, S3 does not; the bar says "S3 pinned, unchanged"',
    async () => {
      must(rm, 'no remote page');
      await press(rm, '[data-tt-target="3"]');
      await press(rm, '[data-tt-station="screens"]');
      const pinned = walls[2].c.next(
        (m) => m.t === 'state' && m.state.screens[3]?.pinned === true,
        8000,
        'S3 pinned',
      );
      await press(rm, '[data-tt-pin]');
      await pinned;
      await press(rm, '[data-tt-target="all"]');
      await press(rm, '[data-tt-station="layers"]');
      const pushed = walls[0].c.next(
        (m) =>
          m.t === 'state' && m.state.screens[1]?.layers?.lightning === true,
        8000,
        'the All push',
      );
      await press(rm, '[data-tt-layer="lightning:on"]');
      const st = (await pushed).state;
      must(!st.screens[3].layers?.lightning, 'S3 changed though pinned');
      must(
        [1, 2, 4, 5, 6].every((n) => st.screens[n].layers?.lightning === true),
        'not every other screen changed',
      );
      const said = await pageUntil(
        rm,
        () => {
          const t =
            document.querySelector('[data-tt-bar] .t')?.textContent || '';
          return /S3 pinned, unchanged$/.test(t) && t;
        },
        null,
        5000,
        'the pinned line',
      );
      must(
        said === 'S1, S2, S4, S5, S6: lightning on · S3 pinned, unchanged',
        `bar "${said}"`,
      );
      await shot(rm, 'K8-R3-remote-all-push');
      // Unpin S3 again (later steps expect a plain wall).
      await press(rm, '[data-tt-target="3"]');
      await press(rm, '[data-tt-station="screens"]');
      const un = walls[2].c.next(
        (m) => m.t === 'state' && m.state.screens[3]?.pinned === false,
        8000,
        'S3 unpinned',
      );
      await press(rm, '[data-tt-pin]');
      await un;
      return { detail: `"${said}"` };
    },
  );

  await step(
    'K1-T3 / K8-R4',
    'T3: Return all asks first (confirm bar); Confirm puts every wall back to Live; the bar says so in the describer’s words',
    async () => {
      must(rm, 'no remote page');
      await press(rm, '[data-tt-return-all]');
      const ask = await pageUntil(
        rm,
        () => {
          const b = document.querySelector('[data-tt-bar]');
          return (
            b &&
            !b.hidden &&
            b.querySelector('[data-tt-confirm="yes"]') &&
            b.querySelector('.t').textContent
          );
        },
        null,
        5000,
        'the confirm bar',
      );
      must(/^Confirm: /.test(ask), `ask "${ask}"`);
      await shot(rm, 'K8-R4-remote-confirm');
      const live = walls[0].c.next(
        (m) =>
          m.t === 'state' &&
          m.cause === 'cmd' &&
          Object.values(m.state.screens).every(
            (s) => s.mode === 'live' && !s.layers?.lightning,
          ),
        8000,
        'every wall Live',
      );
      await press(rm, '[data-tt-confirm="yes"]');
      await live;
      const said = await pageUntil(
        rm,
        () => {
          const t =
            document.querySelector('[data-tt-bar] .t')?.textContent || '';
          return (
            /^Every screen back to Live and role defaults · pinned too/.test(
              t,
            ) && t
          );
        },
        null,
        5000,
        'the Return all line',
      );
      return { detail: `"${ask}" → "${said}"` };
    },
  );

  await step(
    'K8-R5',
    'hand control back: the socket remote asks, the page shows Hand over, the page answers; its status strip goes back to view only',
    async () => {
      must(rm, 'no remote page');
      remote.c.say({ t: 'request-control' });
      await pageUntil(
        rm,
        () => Boolean(document.querySelector('[data-tt-handover="accept"]')),
        null,
        8000,
        'Hand over',
      );
      await shot(rm, 'K8-R5-remote-asked');
      const back = remote.c.next(
        (m) => m.presence?.youControl === true,
        8000,
        'control back',
      );
      await press(rm, '[data-tt-handover="accept"]');
      await back;
      const v = await pageUntil(
        rm,
        (re) => {
          const t =
            document.querySelector('[data-tt-control]')?.textContent || '';
          return new RegExp(re).test(t) && t;
        },
        `^View only · Trip Twin computer in control since ${HHMM}$`,
        8000,
        'view only again',
      );
      return { detail: `"${v}"` };
    },
  );

  await step(
    'K8-R6',
    'Log not writing (CF-D9, Appendix D 3): with the audit file read-only, the remote page and the launch page say "Log not writing" in their status strips within one presence tick; touch keeps working; with the file writable again it goes',
    async () => {
      if (server.external) return { notRun: true, ok: true };
      must(rm, 'no remote page');
      const launchPage = await rmCtx.newPage();
      watch(launchPage, 'launch-page');
      await launchPage.setViewport({ width: 1280, height: 900 });
      await launchPage.goto(
        `${base}/twin.html?view=launch&setup=${setup}&${CITY}`,
        { waitUntil: 'domcontentloaded' },
      );
      await pageUntil(
        launchPage,
        () => document.querySelectorAll('.tt-entry-opens button').length === 6,
        null,
        60000,
        'the launch card',
      );
      await shot(launchPage, 'K8-R6-launcher');
      const files = fs
        .readdirSync(server.auditDir)
        .filter((n) => /^audit-.*\.jsonl$/.test(n))
        .map((n) => path.join(server.auditDir, n));
      for (const f of files) fs.chmodSync(f, 0o400);
      let stripRm = '';
      let stripL = '';
      try {
        const ack = remote.c.next(
          (m) => m.t === 'ack' && m.reqId === 82,
          8000,
          'ack',
        );
        remote.c.say({
          t: 'cmd',
          reqId: 82,
          cmd: { type: 'screens', target: 4, patch: { textScale: 2.5 } },
        });
        must((await ack).ok, 'a command was refused while the log was down');
        stripRm = await pageUntil(
          rm,
          () =>
            document.querySelector('[data-tt-status-item="log"]')?.textContent,
          null,
          12000,
          '"Log not writing" on the remote',
        );
        stripL = await pageUntil(
          launchPage,
          () =>
            document.querySelector('[data-tt-status-item="log"]')?.textContent,
          null,
          12000,
          '"Log not writing" on the launcher',
        );
        must(
          stripRm === 'Log not writing' && stripL === 'Log not writing',
          `"${stripRm}" / "${stripL}"`,
        );
        await shot(rm, 'K8-R6-remote-log-not-writing');
        await shot(launchPage, 'K8-R6-launcher-log-not-writing');
        const wallSees = await page.evaluate(() =>
          document.body.innerText.includes('Log not writing'),
        );
        must(!wallSees, 'a wall says "Log not writing"');
      } finally {
        for (const f of files) fs.chmodSync(f, 0o600);
      }
      const ack2 = remote.c.next(
        (m) => m.t === 'ack' && m.reqId === 83,
        8000,
        'ack',
      );
      remote.c.say({
        t: 'cmd',
        reqId: 83,
        cmd: { type: 'screens', target: 4, patch: { textScale: 2 } },
      });
      must((await ack2).ok, 'refused');
      await pageUntil(
        rm,
        () => !document.querySelector('[data-tt-status-item="log"]'),
        null,
        45000, // the audit log tries again every 30 s (K6)
        'the log item to go',
      );
      await launchPage.close();
      return {
        detail: `remote "${stripRm}", launcher "${stripL}", walls never; gone once the file was writable`,
      };
    },
  );
  // The page closes; its context keeps the pairing for T4 after the
  // restarts (a page left open could take the lease back first).
  await rm?.close().catch(() => {});
  rm = null;

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
      // K2: the store is 0600 in a 0700 folder. Before L5 the old tmp
      // path holds the same wall (dual write); from L5 there is none, and
      // the store is v:2 with token hashes only.
      const modes = `${modeOf(server.dataDir)}/${modeOf(server.storeFile)}`;
      must(modes === '700/600', `data folder/store modes ${modes}`);
      if (hashedBuild(server)) {
        must(!fs.existsSync(server.legacyFile), 'a tmp-path copy was written');
        const text = fs.readFileSync(server.storeFile, 'utf8');
        must(JSON.parse(text).v === 2, 'store is not v:2');
        must(
          [...walls, remote].every(
            (d) => !text.includes(d.token) && text.includes(tokenHash(d.token)),
          ),
          'a device is not saved as its hash only',
        );
        return {
          detail: `QA store v:2 holds S${slots.join(', S')} (modes ${modes}), token hashes only; no tmp-path copy (L5)`,
        };
      }
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
      // The Vite client may reload the page just after its socket came
      // back (K8 run): then it must rejoin once more.
      let mark = await page
        .evaluate(() => window.__ttQaMark ?? null)
        .catch(() => 'reloading');
      if (mark === 'reloading') {
        await waitWall(
          page,
          (x) => !x.pairShown && REMOTE_CHIP.test(x.chip),
          60000,
          'S6 to rejoin after its reload',
        );
        mark = null;
      }
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
  // L5: a build under test that hashes tokens, reverted to one that does
  // not, is a re-pair by design (S-14, re-pair.md): the older build finds
  // a v:2 store it cannot read, sets it aside and starts a fresh wall.
  const repair = !server.external && hashedBuild(server);
  let revertHashed = null;
  let revertCode = null; // the S6 card's code on the reverted build
  await step(
    'P5-S1',
    "street photos (review/street-photos P5): S6 as Site shows the hotel's street photo plate from the proxy's fixtures; the All-in-one's kept photo reaches it (KEPT); no page asks a provider",
    async () => {
      const providerHits = [];
      const onReq = (r) => {
        if (/panoramax|kartaview/i.test(new URL(r.url()).host))
          providerHits.push(r.url());
      };
      page.on('request', onReq);
      let req = 900;
      const send = async (cmd) => {
        const id = ++req;
        const ack = remote.c.next(
          (m) => m.t === 'ack' && m.reqId === id,
          8000,
          'ack',
        );
        remote.c.say({ t: 'cmd', reqId: id, cmd });
        must((await ack).ok, `${cmd.type} refused`);
      };
      const plate = () =>
        page.evaluate(() => {
          const n = document.querySelector('.tt-photo-plate');
          return {
            shown: Boolean(n && !n.hidden && n.offsetWidth > 0),
            state: n?.dataset.ttPhotoState || '',
            kicker: n?.querySelector('.tt-photo-kicker')?.textContent || '',
            dir: n?.querySelector('.tt-photo-dir')?.textContent || '',
            img:
              n?.querySelector('.tt-photo-frame img')?.getAttribute('src') ||
              '',
            loaded: Boolean(n?.querySelector('.tt-photo-frame img.in')),
            credit: n?.querySelector('.tt-photo-credit')?.textContent || '',
          };
        });
      const until = async (pred, what, ms = 60000) => {
        const t0 = Date.now();
        let last = null;
        while (Date.now() - t0 < ms) {
          last = await plate().catch(() => null);
          if (last && pred(last)) return last;
          await sleep(500);
        }
        throw new Error(
          `timed out waiting for ${what}: ${JSON.stringify(last)}`,
        );
      };
      // Its own launcher link: the first one died with K1's restart.
      const lp = await client(base);
      const lw = lp.next('welcome', 8000, 'launcher welcome');
      lp.say({
        t: 'hello',
        proto: PROTO,
        id: 'launcher-qa-photo',
        kind: 'launcher',
        // Once a session exists a launcher rejoins with its setup code.
        setup,
      });
      const lwm = await lw;
      must(
        lwm.type !== 'denied',
        `photo launcher refused: ${lwm.code || ''} ${lwm.error || ''}`,
      );
      try {
        await send({ type: 'screens', target: 6, patch: { role: 'site' } });
        const auto = await until(
          (x) => x.shown && x.state === 'found-pano' && x.loaded,
          'the hotel photo plate',
        );
        must(
          /^STREET PHOTO · PANORAMAX · 360°$/.test(auto.kicker),
          `kicker "${auto.kicker}"`,
        );
        must(
          /^\/api\/twin-photos\/view\?p=panoramax&id=fx-pano-/.test(auto.img),
          `img ${auto.img}`,
        );
        must(/via Panoramax/.test(auto.credit), `credit "${auto.credit}"`);
        // Keep the second fixture photo from the All-in-one (launcher).
        const near = await page.evaluate(async () =>
          (
            await fetch('/api/twin-photos/near?lat=30.26218&lon=-97.73832')
          ).json(),
        );
        const second = near.items[1];
        must(second, 'a second fixture photo');
        lp.say({
          t: 'photo',
          place: 'hotel:austin',
          provider: second.provider,
          id: second.id,
          yaw: 0,
          pitch: 0,
        });
        let kept;
        try {
          kept = await until(
            (x) => /· KEPT$/.test(x.kicker) && x.img.includes(second.id),
            'the kept photo on the wall',
          );
        } catch (e) {
          const st = [...remote.c.out].reverse().find((m) => m.state)?.state;
          throw new Error(
            `${e.message}; launcher welcome ${lwm?.type || '?'}; session.photos ${JSON.stringify(st?.session?.photos || null)}; tripId ${st?.session?.tripId}`,
          );
        }
        lp.say({ t: 'photo', place: 'hotel:austin', clear: true });
        must(
          providerHits.length === 0,
          `provider requests: ${providerHits.slice(0, 2).join(', ')}`,
        );
        return {
          detail: `auto "${auto.kicker}" · ${auto.dir}; kept "${kept.kicker}"; 0 provider requests`,
        };
      } finally {
        await lp.close();
        page.off('request', onReq);
        await send({
          type: 'screens',
          target: 6,
          patch: { role: 'trips' },
        }).catch(() => {});
      }
    },
  );

  await step(
    'L6-S1',
    "map labels (review/map-labels L5): S6 as People paints Trip Twin's words on upstream's world overlay inside the 3D view (same box), with the panels as keep-out areas and the floor instrument painted on top; no Cesium label is left but the storm's",
    async () => {
      let req = 950;
      const send = async (cmd) => {
        const id = ++req;
        const ack = remote.c.next(
          (m) => m.t === 'ack' && m.reqId === id,
          8000,
          'ack',
        );
        remote.c.say({ t: 'cmd', reqId: id, cmd });
        must((await ack).ok, `${cmd.type} refused`);
      };
      try {
        await send({ type: 'screens', target: 6, patch: { role: 'people' } });
        const t0 = Date.now();
        let d = null;
        while (Date.now() - t0 < 60000) {
          d = await page
            .evaluate(() => {
              const r = document.getElementById('world-overlay-root');
              const c = document.getElementById('cesiumContainer');
              const rb = r?.getBoundingClientRect();
              const cb = c?.getBoundingClientRect();
              const cv = document.getElementById('world-overlay-canvas');
              let ink = 0;
              if (cv?.width) {
                const px = cv
                  .getContext('2d')
                  .getImageData(0, 0, cv.width, cv.height).data;
                for (let i = 3; i < px.length; i += 64) if (px[i] > 0) ink++;
              }
              let cesiumLabels = 0;
              const v = window.testTwinViewer;
              for (let i = 0; i < v.dataSources.length; i++) {
                const ds = v.dataSources.get(i);
                if (/storm/i.test(ds.name || '')) continue;
                for (const e of ds.entities.values) if (e.label) cesiumLabels++;
              }
              return {
                ...window.testTwinLabels?.(),
                inContainer: r?.parentElement === c,
                sameBox:
                  Boolean(rb && cb) &&
                  Math.abs(rb.left - cb.left) < 1 &&
                  Math.abs(rb.width - cb.width) < 1 &&
                  Math.abs(rb.height - cb.height) < 1,
                ink,
                cesiumLabels,
              };
            })
            .catch(() => null);
          if (d && d.painted > 0 && d.floorPainted > 0 && d.ink > 0) break;
          await sleep(1000);
        }
        must(d, 'no label diagnostics');
        must(d.inContainer && d.sameBox, `overlay root ${JSON.stringify(d)}`);
        must(d.painted > 0, `no overlay label painted: ${JSON.stringify(d)}`);
        must(
          d.floorPainted > 0,
          `no floor words painted: ${JSON.stringify(d)}`,
        );
        // The panel bands (left and top at least) are in place.
        must(d.bands >= 2, `keep-out bands: ${JSON.stringify(d)}`);
        must(d.cesiumLabels === 0, `${d.cesiumLabels} Cesium labels left`);
        must(d.protectedShown > 0, `no protected label: ${JSON.stringify(d)}`);
        // Sources are let go: people swap with the 15 s feed (AIA P1-1).
        await sleep(20000);
        const later = await page.evaluate(() => ({
          ...window.testTwinLabels?.(),
          render: window.testTwinRender?.(),
        }));
        must(
          later.sources <= d.sources + 2,
          `data sources kept: ${d.sources} → ${later.sources}`,
        );
        // No continuous render added by the labels (governor idle).
        must(
          later.render?.mode === 'idle' ||
            !later.render?.holds?.some((h) => /label|overlay/i.test(h)),
          `render held: ${JSON.stringify(later.render?.holds)}`,
        );
        return {
          detail: `${d.labels} labels (${d.painted} painted, ${d.tags} edge tags, ${d.protectedShown} protected), ${d.floorPainted} floor words on top, ${d.bands} keep-out bands, scale ${d.scale.toFixed(2)}, sources ${d.sources}→${later.sources}, 0 Cesium labels`,
        };
      } finally {
        await send({
          type: 'screens',
          target: 6,
          patch: { role: 'trips' },
        }).catch(() => {});
      }
    },
  );

  await step(
    'T5-S1',
    "traffic cameras (review/traffic-cameras T5): the All-in-one sends a fixture camera to the Site wall; S6 as Site shows it in the plate's slot as TRAFFIC CAMERA with a still; Stop takes it off; no page asks an agency",
    async () => {
      const hits = [];
      const onReq = (r) => {
        const u = r.url();
        if (/\/api\/cctv\/|austintexas|tfl\.gov|txdot/i.test(u)) hits.push(u);
      };
      page.on('request', onReq);
      let req = 950;
      const send = async (cmd) => {
        const id = ++req;
        const ack = remote.c.next(
          (m) => m.t === 'ack' && m.reqId === id,
          8000,
          'ack',
        );
        remote.c.say({ t: 'cmd', reqId: id, cmd });
        must((await ack).ok, `${cmd.type} refused`);
      };
      const look = () =>
        page.evaluate(() => {
          const n = document.querySelector('.tt-photo-plate.cam');
          return {
            shown: Boolean(n && !n.hidden && n.offsetWidth > 0),
            kicker: n?.querySelector('.tt-photo-kicker')?.textContent || '',
            name: n?.querySelector('.tt-cam-name')?.textContent || '',
            loaded: Boolean(n?.querySelector('.tt-cam-frame img.in')),
          };
        });
      const until = async (pred, what, ms = 60000) => {
        const t0 = Date.now();
        let last = null;
        while (Date.now() - t0 < ms) {
          last = await look().catch(() => null);
          if (last && pred(last)) return last;
          await sleep(500);
        }
        throw new Error(
          `timed out waiting for ${what}: ${JSON.stringify(last)}`,
        );
      };
      const lp = await client(base);
      const lw = lp.next('welcome', 8000, 'launcher welcome');
      lp.say({
        t: 'hello',
        proto: PROTO,
        id: 'launcher-qa-camera',
        kind: 'launcher',
        setup,
      });
      const lwm = await lw;
      must(lwm.type !== 'denied', `camera launcher refused: ${lwm.code || ''}`);
      try {
        // The camera goes to the first wall with the role: S6 is the only
        // Site wall for the step.
        await send({ type: 'screens', target: 1, patch: { role: 'trips' } });
        await send({ type: 'screens', target: 6, patch: { role: 'site' } });
        lp.say({
          t: 'camera',
          place: 'hotel:austin',
          role: 'site',
          id: 'fx-austin-1',
        });
        const on = await until(
          (x) =>
            x.shown &&
            x.loaded &&
            /^TRAFFIC CAMERA · TEST FIXTURE · STILL$/.test(x.kicker),
          'the camera on the wall',
        );
        lp.say({ t: 'camera', stop: true });
        await until((x) => !x.shown, 'the camera to go');
        must(
          hits.length === 0,
          `agency requests from the page: ${hits.slice(0, 2).join(', ')}`,
        );
        return {
          detail: `"${on.kicker}" · ${on.name}; stopped; 0 agency requests`,
        };
      } finally {
        await lp.close();
        page.off('request', onReq);
        await send({
          type: 'screens',
          target: 6,
          patch: { role: 'trips' },
        }).catch(() => {});
        await send({
          type: 'screens',
          target: 1,
          patch: { role: 'site' },
        }).catch(() => {});
      }
    },
  );

  await step(
    'K2-S1',
    `revert-and-restart: restart on ${REVERT_REF}; S1–S6 and the remote rejoin (below L5: they are told to re-pair, nothing crashes)`,
    async () => {
      if (server.external) return { notRun: true, ok: true };
      await sleep(900);
      const from = serverLogSize(server);
      await quietRestart(server, { ref: REVERT_REF });
      revertHashed = hashedBuild(server);
      if (!repair || revertHashed) {
        await rejoinAll();
        const w = await s6Back('S6 to rejoin on the reverted code');
        return {
          detail: `${server.sha}: walls and remote rejoined; S6 page "${w.chip}"`,
        };
      }
      const told = [];
      for (const d of walls) {
        await d.c.close();
        const w = await d.hello();
        must(
          w.type === 'pair-code' && /^\d{4}$/.test(w.code || ''),
          `S${d.slot} got ${w.type}${w.code ? '' : ' (no code)'}`,
        );
        told.push(`S${d.slot} code`);
        await d.c.close();
      }
      await remote.c.close();
      const r = await remote.hello();
      must(
        r.type === 'denied' && r.code === 'FORGOTTEN',
        `remote got ${r.type} ${r.code ?? ''}`,
      );
      told.push('remote FORGOTTEN');
      await remote.c.close();
      const w = await waitWall(
        page,
        (x) => x.pairShown && /^\d{4}$/.test(x.code || ''),
        90000,
        'the S6 pair card on the reverted code',
      );
      revertCode = w.code;
      await shot(page, 'K2-S1-wall-repair-after-revert');
      const info = await fetch(`${server.url}/api/twin-sync/info`).then((x) =>
        x.json(),
      );
      must(info.ok, 'the reverted server is not answering');
      const said = serverLogSince(server, from);
      must(
        /store\.quarantined/.test(said),
        'the reverted build did not set the v:2 store aside',
      );
      return {
        detail: `${server.sha} (below L5): v:2 store quarantined, fresh wall; ${told.join(', ')}; S6 shows the pair card; server up`,
      };
    },
  );
  await step(
    'K2-S2',
    'forward again: restart on the build under test; everything rejoins from the data folder, no second migration (after a re-pair revert: the tmp file is gone, then S1–S6 and the remote pair again)',
    async () => {
      if (server.external) return { notRun: true, ok: true };
      await sleep(900);
      const from = serverLogSize(server);
      await quietRestart(server, { ref: REF });
      if (!repair || revertHashed) {
        await rejoinAll();
        await s6Back('S6 to rejoin on the build under test');
        const said = serverLogSince(server, from);
        must(!/store\.migrated/.test(said), 'migrated a second time');
        must(/store\.loaded/.test(said), 'did not load the data-folder store');
        return {
          detail: `${server.sha} (was ${built}): store.loaded, no store.migrated`,
        };
      }
      const said = serverLogSince(server, from);
      must(!/store\.migrated/.test(said), 'read the tmp file again');
      must(
        !fs.existsSync(server.legacyFile),
        'the tmp-path file is still there',
      );
      const how = /store\.hashed/.test(said)
        ? "the reverted build's v1 store hashed in place"
        : 'fresh wall';
      // Re-pair as re-pair.md says: Start on the launcher, the QR, a code.
      SEEN_TOKENS.add(setup); // the old setup link: never saved either
      let l;
      ({ c: l, setup } = await startSetup(server.url, 6));
      launcher = l;
      for (const d of walls) {
        d.token = null;
        d.setup = setup;
        const w = await d.hello();
        must(
          w.type === 'paired' && w.slot === d.slot,
          `S${d.slot} got ${w.type}`,
        );
      }
      remote.token = null;
      remote.setup = setup;
      const r = await remote.hello();
      must(
        r.type === 'remote' && r.controller === true,
        `remote got ${r.type}, controller ${r.controller}`,
      );
      // A new code from this build, not the reverted build's card.
      const card = await waitWall(
        page,
        (x) =>
          x.pairShown && /^\d{4}$/.test(x.code || '') && x.code !== revertCode,
        90000,
        'the S6 pair card with a new code',
      );
      page.__code = card.code;
      const ans = remote.c.next('pair-result', 8000, 'pair-result');
      remote.c.say({ t: 'pair', reqId: 21, code: card.code, slot: 6 });
      const pr = await ans;
      must(pr.ok && pr.slot === 6, `pair-result ${pr.ok} ${pr.error || ''}`);
      const w = await s6Back('S6 to pair again on the build under test');
      return {
        detail: `${server.sha} (was ${built}): ${how}; no store.migrated; tmp file absent; S1–S5 and the remote re-paired from a new launcher setup, S6 by code ("${w.chip}")`,
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
    'host check, report mode: today’s rule refuses a foreign Origin; a foreign Host’s socket is served and recorded, its HTTP refused by the base host check; cross-site GET 403; nothing recorded for the smoke’s own traffic',
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
      // Since the upstream sync (26 Oct 2026) the base config's host check
      // (build/allowedHosts.js) refuses an unlisted Host on every HTTP
      // request before a Trip Twin route sees it.
      const info = await rawGet(port, '/api/twin-sync/info', { host: evil });
      must(
        info.status === 403,
        `info with a foreign Host: ${info.status}, expected 403 from the base host check`,
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

  // ---- K7: crypto ids, no state before pairing, loopback-aware limits ----
  // Secrets K7's steps hold (searched by the K6 canary below; never printed).
  const k7Secrets = [];
  /** A raw relay socket from this computer, as a page opens it. */
  const rawSock = () =>
    new Promise((resolve) => {
      const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/twin-sync`, {
        headers: { Origin: base },
      });
      ws.got = [];
      ws.closedWith = null;
      ws.on('message', (raw) => {
        try {
          ws.got.push(JSON.parse(String(raw)));
        } catch {
          /* ignore */
        }
      });
      ws.on('close', (code) => (ws.closedWith = code));
      ws.once('open', () => resolve({ ws, ok: true }));
      ws.once('unexpected-response', (req, res) => {
        ws.terminate();
        resolve({ ws, ok: false, status: res.statusCode });
      });
      ws.once('error', () => resolve({ ws, ok: false, status: null }));
    });
  const until = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (!fn() && Date.now() < end) await sleep(50);
    return fn();
  };
  let pend = null;
  await step(
    'K7-S1',
    'no state before pairing: a screen waiting for a code hears only {pair-code, code, ttlMs}, across a command, an identify and a presence tick; the launcher heard presence only; presence says health {audit, store}',
    async () => {
      pend = await device(base, { id: 'screen-qa-k7-pending', kind: 'screen' });
      const w = await pend.hello();
      must(w.type === 'pair-code' && /^\d{4}$/.test(w.code), `got ${w.type}`);
      const keys = Object.keys(w).sort().join(',');
      must(keys === 'code,proto,t,ttlMs,type', `welcome keys ${keys}`);
      k7Secrets.push(`"${w.code}"`);
      const ack = remote.c.next(
        (m) => m.t === 'ack' && m.reqId === 71,
        8000,
        'ack',
      );
      remote.c.say({
        t: 'cmd',
        reqId: 71,
        cmd: { type: 'screens', target: 3, patch: { textScale: 2 } },
      });
      must((await ack).ok, 'command refused');
      remote.c.say({ t: 'identify' });
      await sleep(5600); // one presence tick
      const heard = pend.c.out.map((m) => m.t);
      must(heard.join() === 'welcome', `the waiting screen heard ${heard}`);
      const lState = launcher.all('state').length;
      const lPresence = launcher.all('presence').length;
      must(lState === 0, `the launcher heard ${lState} state message(s)`);
      must(lPresence > 0, 'the launcher heard no presence');
      const h = presenceOf(remote.c)?.health;
      must(
        h && h.audit === true && h.store === true,
        `presence health ${JSON.stringify(h)}`,
      );
      return {
        detail: `waiting screen heard [${heard}] only; launcher: ${lPresence} presence, 0 state; presence health {audit: true, store: true}`,
      };
    },
  );

  await step(
    'K7-S2',
    'crypto ids: the setup link and every token are 256-bit base64url; a token issued by pairing is in the store at once (no 300 ms debounce); the wall paired back into its slot',
    async () => {
      if (server.external) return { notRun: true, ok: true };
      const b64 = /^[A-Za-z0-9_-]{43}$/;
      must(b64.test(setup), 'setup link is not 256-bit base64url');
      for (const d of [...walls, remote])
        must(b64.test(d.token || ''), `${d.kind} token shape`);
      // Pair the waiting screen into S5 (the Node S5 is told unpaired), read
      // the store at once, then pair S5 back by its new code.
      const paired = pend.c.next('paired', 8000, 'paired');
      const res = remote.c.next('pair-result', 8000, 'pair-result');
      remote.c.say({ t: 'pair', reqId: 72, code: pend.c.out[0].code, slot: 5 });
      must((await res).ok, 'pair refused');
      const p = await paired;
      const t0 = Date.now();
      // From L5 the store holds the token's hash, never the token.
      const want = hashedBuild(server) ? tokenHash(p.token) : p.token;
      const inStore = await until(() => {
        try {
          return fs.readFileSync(server.storeFile, 'utf8').includes(want);
        } catch {
          return false;
        }
      }, 2000);
      const ms = Date.now() - t0;
      must(inStore, 'the new token is not in the store');
      SEEN_TOKENS.add(p.token);
      must(ms < 250, `in the store after ${ms} ms (debounce is 300)`);
      must(b64.test(p.token), 'paired token shape');
      k7Secrets.push(p.token, pend.id);
      const s5 = walls[4];
      await until(() => s5.c.last('unpaired'), 4000);
      await s5.c.close();
      const back = await s5.hello();
      must(back.type === 'pair-code', `S5 got ${back.type}`);
      const p5 = s5.c.next('paired', 8000, 'S5 paired');
      const r5 = remote.c.next(
        (m) => m.t === 'pair-result' && m.reqId === 73,
        8000,
        'pair-result',
      );
      remote.c.say({ t: 'pair', reqId: 73, code: back.code, slot: 5 });
      must((await r5).ok, 'S5 pair refused');
      s5.token = (await p5).token;
      SEEN_TOKENS.add(s5.token);
      await pend.c.close();
      return {
        detail: `setup link, ${walls.length + 1} tokens and the new one are 43-character base64url; the new token was in the store after ${ms} ms; S5 paired back by code`,
      };
    },
  );

  await step(
    'K7-S3',
    'stale page: a page from K5/K6 (proto 2) is told RELOAD with readable text, and its socket is closed at the 5 s hello deadline (4004)',
    async () => {
      const { ws, ok } = await rawSock();
      must(ok, 'no socket');
      ws.send(
        JSON.stringify({
          t: 'hello',
          proto: 2,
          id: 'screen-qa-k6-page',
          kind: 'screen',
        }),
      );
      await until(() => ws.got.length > 0, 4000);
      const w = ws.got[0];
      must(
        w?.code === 'RELOAD' && w.proto === PROTO && !w.state && !w.presence,
        `got ${JSON.stringify(w && { code: w.code, proto: w.proto })}`,
      );
      const t0 = Date.now();
      await until(() => ws.closedWith != null, 8000);
      must(ws.closedWith === 4004, `closed with ${ws.closedWith}`);
      return {
        detail: `RELOAD "${w.error}"; closed 4004 after ${((Date.now() - t0) / 1000).toFixed(1)} s more`,
      };
    },
  );

  await step(
    'K7-S4',
    '64 sockets that never say hello, then S1–S5 and the remote reconnect: all rejoin at once; the oldest idle sockets give way (1013) and the rest are closed at the 5 s hello deadline (4004)',
    async () => {
      const idle = [];
      for (let i = 0; i < 64; i += 1) idle.push(await rawSock());
      const opened = idle.filter((x) => x.ok).length;
      const refused = idle.filter((x) => !x.ok);
      must(
        refused.every((x) => x.status === 503 || x.status === 429),
        `refused with ${[...new Set(refused.map((x) => x.status))]}`,
      );
      const t0 = Date.now();
      await rejoinAll();
      const rejoinMs = Date.now() - t0;
      await until(
        () => idle.every((x) => !x.ok || x.ws.closedWith != null),
        7000,
      );
      const left = idle.filter((x) => x.ok && x.ws.closedWith == null).length;
      must(left === 0, `${left} idle socket(s) still open`);
      const codes = [
        ...new Set(idle.filter((x) => x.ok).map((x) => x.ws.closedWith)),
      ];
      return {
        detail: `${opened} opened, ${refused.length} refused (${[...new Set(refused.map((x) => x.status))].join('/') || '—'}); S1–S5 and the remote rejoined in ${rejoinMs} ms; idle closed with ${codes.join('/')}`,
      };
    },
  );

  await step(
    'K7-S5',
    'a 2 MiB frame closes only its own socket (1009); the walls beside it hear the next change',
    async () => {
      const { ws, ok } = await rawSock();
      must(ok, 'no socket');
      ws.send(
        JSON.stringify({
          t: 'thumb',
          data: `data:image/jpeg;base64,${'A'.repeat(2 * 1024 * 1024)}`,
        }),
      );
      await until(() => ws.closedWith != null, 5000);
      must(ws.closedWith === 1009, `closed with ${ws.closedWith}`);
      const st = walls[0].c.next(
        (m) => m.t === 'state' && m.cause === 'cmd',
        8000,
        'S1 state',
      );
      remote.c.say({
        t: 'cmd',
        reqId: 74,
        cmd: { type: 'screens', target: 3, patch: { textScale: 1 } },
      });
      await st;
      must(
        walls.every((d) => d.c.open) && remote.c.open,
        'a wall or the remote lost its socket',
      );
      return {
        detail:
          'closed 1009; S1–S5 and the remote still open; S1 heard the change',
      };
    },
  );

  await step(
    'K7-S6',
    'thumbnails: JPEG only, at most one per screen per 2 s; the largest from S6 at 5K (2560×1440 @2x) is under 1 MiB',
    async () => {
      if (!page) return { notRun: true, ok: true, detail: 'no S6 page' };
      const before = remote.c.all('thumb').length;
      await page.setViewport({
        width: 2560,
        height: 1440,
        deviceScaleFactor: 2,
      });
      // 60 s: a 5K page drawn to JPEG in software (SwiftShader) on a busy
      // machine missed 30 s once in four runs (24 Oct); this step checks
      // format, size and spacing, not speed.
      await until(
        () => remote.c.all('thumb').filter((m) => m.slot === 6).length >= 2,
        60000,
      );
      await page.setViewport({ width: 1280, height: 760 });
      const thumbs = remote.c.all('thumb');
      must(thumbs.length > before, 'no thumbnail at 5K');
      const max = Math.max(...thumbs.map((m) => m.data.length));
      must(
        thumbs.every((m) => /^data:image\/jpeg;base64,/.test(m.data)),
        'a thumbnail that is not JPEG',
      );
      must(max < 1024 * 1024, `largest thumbnail ${max} characters`);
      const six = thumbs.filter((m) => m.slot === 6).map((m) => m.at);
      const gaps = six.slice(1).map((t, i) => t - six[i]);
      must(
        gaps.every((g) => g >= 1990),
        `thumb gaps ${gaps.join(', ')} ms`,
      );
      return {
        detail: `${thumbs.length} thumbnails heard; largest ${(max / 1024).toFixed(1)} KiB (limit 1024 KiB); S6 gaps ≥ ${Math.min(...gaps, Infinity)} ms`,
      };
    },
  );

  await step(
    'K7-S7',
    'health: codes, sockets waiting and the limits hit are counted; no message made the relay throw; limit.hit lines carry the peer',
    async () => {
      if (server.external) return { notRun: true, ok: true };
      const h = await rawGet(server.port, '/api/twin-sync/health', {
        host: `localhost:${server.port}`,
      });
      must(h.status === 200, `health ${h.status}`);
      const j = JSON.parse(h.body);
      must(j.codes != null && j.codes <= 20, `codes ${j.codes}`);
      must(j.socketsUnpaired <= 16, `unpaired sockets ${j.socketsUnpaired}`);
      const lim = j.counters?.limits || {};
      must(lim['hello-deadline'] > 0, 'no hello-deadline counted');
      must(j.counters.msgError === 0, `msgError ${j.counters.msgError}`);
      const lines = auditLines(server).filter((l) => l.type === 'limit.hit');
      must(lines.length > 0, 'no limit.hit line');
      must(
        lines.every((l) => l.peer && typeof l.peer.local === 'boolean'),
        'a limit.hit line without its peer',
      );
      return {
        detail: `codes ${j.codes}; sockets waiting ${j.socketsUnpaired}; limits ${Object.entries(
          lim,
        )
          .map(([k, v]) => `${k} ${v}`)
          .join(', ')}; ${lines.length} limit.hit line(s), each with its peer`,
      };
    },
  );

  // ---- K8, after the restarts: T4, the cards, the All-in-one (T6) ------
  await step(
    'K1-T4 / K8-R7',
    'T4: pair a screen by code in Screens & devices: a wrong code says the tries left before the pause; the right code pairs it into S5 ("Paired S5 · …"); the old S5 is told its slot was taken and is paired back the same way',
    async () => {
      must(rmCtx, 'no remote page context');
      rm = await rmCtx.newPage();
      rm.setDefaultNavigationTimeout(120000);
      watch(rm, 'remote-page');
      await rm.setViewport({ width: 1180, height: 820 });
      // No link: the page rejoins by the pairing its context kept.
      await rm.goto(`${base}/twin-remote.html`, {
        waitUntil: 'domcontentloaded',
      });
      await pageUntil(
        rm,
        () =>
          /^View only/.test(
            document.querySelector('[data-tt-control]')?.textContent || '',
          ),
        null,
        30000,
        'the page to rejoin',
      );
      const asked = remote.c.next(
        (m) => m.presence?.handover && !m.presence.handover.you,
        8000,
        'the handover request',
      );
      await press(rm, '[data-tt-ask-control]');
      await asked;
      remote.c.say({ t: 'handover', accept: true });
      await pageUntil(
        rm,
        () =>
          /^In control/.test(
            document.querySelector('[data-tt-control]')?.textContent || '',
          ),
        null,
        10000,
        'control',
      );
      await press(rm, '[data-tt-station="screens"]');
      const fresh = await device(base, {
        id: 'screen-qa-k8-fresh',
        kind: 'screen',
      });
      const w = await fresh.hello();
      must(
        w.type === 'pair-code' && /^\d{4}$/.test(w.code),
        `fresh screen got ${w.type}`,
      );
      k7Secrets.push(`"${w.code}"`);
      await fillPair(rm, w.code === '0000' ? '0001' : '0000', 5);
      await press(rm, '[data-tt-pair-go]');
      const wrong = await pageUntil(
        rm,
        () =>
          document.querySelector('[data-tt-pair-result="refused"]')
            ?.textContent,
        null,
        8000,
        'the refusal',
      );
      must(
        /^Code not recognised or expired · [1-4] tr(y|ies) left before a 1-minute pause$/.test(
          wrong,
        ),
        `wrong code: "${wrong}"`,
      );
      await shot(rm, 'K8-R7-remote-pair-wrong');
      const s5 = walls[4];
      const told = s5.c.next('unpaired', 8000, 'S5 told');
      const joined = fresh.c.next('paired', 8000, 'the fresh screen paired');
      await fillPair(rm, w.code, 5);
      await press(rm, '[data-tt-pair-go]');
      const ok = await pageUntil(
        rm,
        () => document.querySelector('[data-tt-pair-result="ok"]')?.textContent,
        null,
        8000,
        'the pairing result',
      );
      must(ok === "Paired S5 · it shows S5's role now", `result "${ok}"`);
      const p = await joined;
      k7Secrets.push(p.token, fresh.id);
      must((await told).reason === 'SLOT_TAKEN', 'S5 not told SLOT_TAKEN');
      await shot(rm, 'K8-R7-remote-paired');
      // The old S5 asks again and is paired back by the page.
      s5.token = null;
      await s5.c.close();
      const w2 = await s5.hello();
      must(w2.type === 'pair-code', `old S5 got ${w2.type}`);
      k7Secrets.push(`"${w2.code}"`);
      const back = s5.c.next('paired', 8000, 'S5 paired back');
      await fillPair(rm, w2.code, 5);
      await press(rm, '[data-tt-pair-go]');
      s5.token = (await back).token;
      // Control back to the socket remote.
      remote.c.say({ t: 'request-control' });
      await pageUntil(
        rm,
        () => Boolean(document.querySelector('[data-tt-handover="accept"]')),
        null,
        8000,
        'Hand over',
      );
      await press(rm, '[data-tt-handover="accept"]');
      await sleep(500);
      return {
        detail: `"${wrong}" → "${ok}"; the old S5 was told SLOT_TAKEN and paired back`,
      };
    },
  );

  await step(
    'K8-S4',
    'replaced (Appendix D 7, sup S8): a second window for S6 takes it; the first shows "S6 IS SHOWN IN ANOTHER WINDOW · since HH:MM · this window can be closed" with no code; "Use this window instead" gives it a fresh pair card, and the new window stays S6',
    async () => {
      must(page, 'no S6 page');
      const ctx = page.browserContext();
      const p2 = await ctx.newPage();
      p2.setDefaultNavigationTimeout(120000);
      watch(p2, 'wall-S6-second');
      await p2.setViewport({ width: 1280, height: 760 });
      await p2.goto(page.url(), { waitUntil: 'domcontentloaded' });
      await pageUntil(
        page,
        () => document.body.dataset.ttCard === 'replaced',
        null,
        60000,
        'the replaced card',
      );
      const x = await cardIn(page);
      must(
        ONLY_CARD(x),
        `not calm: ${x.visible.join(', ')} · render ${x.render}`,
      );
      must(
        x.kicker === 'S6 IS SHOWN IN ANOTHER WINDOW',
        `kicker "${x.kicker}"`,
      );
      must(
        new RegExp(`^since ${HHMM} · this window can be closed$`).test(
          x.lines[0] || '',
        ),
        `line "${x.lines[0]}"`,
      );
      must(
        x.button === 'Use this window instead' && x.code === null,
        `button "${x.button}", code ${x.code}`,
      );
      await shotSteel(page, 'K8-S4-wall-replaced');
      const w2 = await waitWall(
        p2,
        (v) => /^S6 · Remote/.test(v.chip),
        60000,
        'the second window as S6',
      );
      await press(page, '.tt-wall-card button');
      await pageUntil(
        page,
        () => document.body.dataset.ttCard === 'pair',
        null,
        60000,
        'a fresh pair card',
      );
      const y = await cardIn(page);
      must(
        /^\d{4}$/.test(y.code || '') && y.kicker === 'PAIR THIS SCREEN',
        `after: ${y.kicker} ${y.code}`,
      );
      await sleep(5500);
      must(presenceOf(remote.c)?.screens?.[6]?.online, 'S6 went offline');
      await shot(page, 'K8-S4-wall-use-this-window');
      return {
        detail: `"${x.kicker} · ${x.lines[0]}" [${x.button}]; then a fresh code; the second window: "${w2.chip}"`,
      };
    },
  );

  await step(
    'K8-S5',
    'out of date (Appendix D 1, 1a, 1c): a wall page the relay calls out of date reloads once, then shows "THIS SCREEN NEEDS A RELOAD"; a remote page keeps its page and says "This remote page is out of date · nothing was sent" with Reload; a launch page says "This page is out of date" with Reload',
    async () => {
      const ctx = await newCtx();
      const wall = await newPage(ctx, 'wall-old');
      await wall.setViewport({ width: 1280, height: 760 });
      await scriptHello(wall, { proto: PROTO - 1 });
      await wall.goto(`${base}/twin.html?view=screen&${CITY}`, {
        waitUntil: 'domcontentloaded',
      });
      await pageUntil(
        wall,
        () => document.body.dataset.ttCard === 'reload',
        null,
        90000,
        'the reload card',
      );
      const x = await cardIn(wall);
      const reloads = await wall.evaluate(() =>
        sessionStorage.getItem('tripTwin.soc.protoReloadAt'),
      );
      must(reloads, 'it never reloaded itself first');
      must(
        ONLY_CARD(x) && x.kicker === 'THIS SCREEN NEEDS A RELOAD',
        `${x.kicker} · ${x.visible.join(', ')}`,
      );
      must(
        new RegExp(
          `^refused as out of date at ${HHMM} · it shows nothing from the wall until reloaded$`,
        ).test(x.lines[0] || ''),
        `line "${x.lines[0]}"`,
      );
      await shotSteel(wall, 'K8-S5-wall-out-of-date');
      const rp = await newPage(ctx, 'remote-old');
      await rp.setViewport({ width: 1180, height: 820 });
      await scriptHello(rp, { proto: PROTO - 1 });
      await rp.goto(`${base}/twin-remote.html`, {
        waitUntil: 'domcontentloaded',
      });
      const item = await pageUntil(
        rp,
        () =>
          document.querySelector('[data-tt-status-item="reload"]')?.textContent,
        null,
        30000,
        'the remote out-of-date item',
      );
      must(
        item === 'This remote page is out of date · nothing was sent',
        `remote "${item}"`,
      );
      must(
        (await textIn(rp, '[data-tt-reload]')) === 'Reload',
        'no Reload button',
      );
      must(
        (await textIn(rp, '[data-tt-bar="reload"] .t')) === item,
        'no error bar',
      );
      await shot(rp, 'K8-S5-remote-out-of-date');
      const lp = await newPage(ctx, 'launch-old');
      await lp.setViewport({ width: 1280, height: 900 });
      await scriptHello(lp, { proto: PROTO - 1 });
      await lp.goto(`${base}/twin.html?view=launch&setup=qa-old&${CITY}`, {
        waitUntil: 'domcontentloaded',
      });
      const li = await pageUntil(
        lp,
        () =>
          document.querySelector('[data-tt-status-item="reload"]')?.textContent,
        null,
        60000,
        'the launcher out-of-date item',
      );
      must(li === 'This page is out of date', `launcher "${li}"`);
      await shot(lp, 'K8-S5-launcher-out-of-date');
      return {
        detail: `wall "${x.kicker} · ${x.lines[0]}"; remote "${item}" + Reload; launcher "${li}" + Reload`,
      };
    },
    { cleanup: true },
  );

  await step(
    'K8-S6',
    'wall cards with no code (Appendix D 6c, 6d; SUP-5): rejoining paused (RATE_LIMITED) and too many waiting (BUSY) and any other refusal from scripted relay answers; a lost pairing (ID_IN_USE, scripted once) and a used link (a real expired link) fall to a pair card that says why',
    async () => {
      const ctx = await newCtx();
      const seen = [];
      const open = async (
        name,
        fakes,
        url = `${base}/twin.html?view=screen&${CITY}`,
      ) => {
        const p = await newPage(ctx, name);
        await p.setViewport({ width: 1280, height: 760 });
        if (fakes) await scriptHello(p, { fakes });
        await p.goto(url, { waitUntil: 'domcontentloaded' });
        return p;
      };
      const deny = (code, extra = {}) => ({
        t: 'welcome',
        type: 'denied',
        code,
        error: 'scripted',
        proto: PROTO,
        ...extra,
      });
      const rl = await open('wall-rate', [
        deny('RATE_LIMITED', { retryAfterMs: 120000 }),
        deny('RATE_LIMITED', { retryAfterMs: 120000 }),
      ]);
      await pageUntil(
        rl,
        () => document.body.dataset.ttCard === 'rate-limited',
        null,
        60000,
        'the paused card',
      );
      const a = await cardIn(rl);
      must(
        ONLY_CARD(a) && a.code === null,
        `paused card: ${a.visible.join(', ')}`,
      );
      must(
        new RegExp(
          `^Rejoining paused on this computer until ${HHMM} · too many tries · screens already on the wall are not affected$`,
        ).test(a.lines[0] || ''),
        `"${a.lines[0]}"`,
      );
      await shotSteel(rl, 'K8-S6-wall-rate-limited');
      // One WebGL page at a time (SwiftShader runs out of contexts).
      await rl.close();
      seen.push(a.lines[0]);
      const busy = await open('wall-busy', [
        deny('BUSY', { retryAfterMs: 45000 }),
        deny('BUSY', { retryAfterMs: 45000 }),
      ]);
      await pageUntil(
        busy,
        () => document.body.dataset.ttCard === 'busy',
        null,
        60000,
        'the busy card',
      );
      const b = await cardIn(busy);
      must(
        b.lines[0] ===
          'Too many screens are waiting to pair · trying again in 1 min' &&
          b.code === null,
        `"${b.lines[0]}"`,
      );
      await shotSteel(busy, 'K8-S6-wall-busy');
      await busy.close();
      seen.push(b.lines[0]);
      const other = await open('wall-denied', [
        deny('UNKNOWN_KIND', { error: 'Unknown device' }),
        deny('UNKNOWN_KIND', { error: 'Unknown device' }),
      ]);
      await pageUntil(
        other,
        () => document.body.dataset.ttCard === 'denied',
        null,
        60000,
        'the refused card',
      );
      const c = await cardIn(other);
      must(
        c.kicker === "THIS SCREEN CAN'T JOIN THE WALL" &&
          c.lines[0] ===
            'Unknown device · it shows nothing from the wall until it joins',
        `"${c.kicker}" "${c.lines[0]}"`,
      );
      await shotSteel(other, 'K8-S6-wall-denied');
      await other.close();
      const lost = await open('wall-lost', [
        deny('ID_IN_USE', { error: 'This device id is already in use' }),
      ]);
      await pageUntil(
        lost,
        () => document.body.dataset.ttCard === 'lost',
        null,
        60000,
        'the lost card',
      );
      const d = await cardIn(lost);
      must(
        d.kicker === 'PAIR THIS SCREEN AGAIN' && /^\d{4}$/.test(d.code || ''),
        `${d.kicker} ${d.code}`,
      );
      must(
        new RegExp(
          `^This window lost its pairing at ${HHMM}: another window took it over\\.$`,
        ).test(d.lines[0] || ''),
        `"${d.lines[0]}"`,
      );
      await shotSteel(lost, 'K8-S6-wall-lost');
      await lost.close();
      // A real used link: the K1 setup did not survive the restarts.
      const link = await open(
        'wall-link',
        null,
        `${base}/twin.html?view=screen&slot=5&setup=${setup}&${CITY}`,
      );
      await pageUntil(
        link,
        () => document.body.dataset.ttCard === 'link-expired',
        null,
        60000,
        'the link card',
      );
      const e = await cardIn(link);
      must(
        e.lines[0] ===
          'This screen link was already used or has expired · pair with the code below' &&
          /^\d{4}$/.test(e.code || ''),
        `"${e.lines[0]}" ${e.code}`,
      );
      await shotSteel(link, 'K8-S6-wall-link-expired');
      await link.close();
      for (const x of [d, e]) k7Secrets.push(`"${x.code}"`);
      return {
        detail: `${seen.join(' | ')} | "${c.lines[0]}" | lost → "${d.lines[0]}" + code | link → "${e.lines[0]}" + code`,
      };
    },
    { cleanup: true },
  );

  await step(
    'K1-T6 / K8-T6',
    'T6: the All-in-one at 2560×1440 and 1728×1117: the stations rail (data-tt-rail), its active pane, six station tiles, the foot menu (Layers, Display, Keys) and the aperture, which opens and closes the rail',
    async () => {
      const ctx = await newCtx();
      const out = [];
      for (const [w, h] of [
        [2560, 1440],
        [1728, 1117],
      ]) {
        const p = await newPage(ctx, `all-in-one-${w}`);
        await p.setViewport({ width: w, height: h });
        await p.evaluateOnNewDocument(() => {
          try {
            localStorage.setItem('tripTwin.layout', 'all');
          } catch {
            /* the entry card then shows; the rail is under it */
          }
        });
        await p.goto(`${base}/twin.html?${CITY}`, {
          waitUntil: 'domcontentloaded',
        });
        const r = await pageUntil(
          p,
          () => {
            const rail = document.querySelector('[data-tt-rail]');
            const tiles = document.querySelectorAll(
              '[data-tt-rail] [data-tt-station]',
            );
            const menu = [
              ...document.querySelectorAll('[data-tt-foot] [data-tt-menu]'),
            ].map((b) => b.dataset.ttMenu);
            return rail &&
              tiles.length >= 6 &&
              document.querySelector('[data-tt-aperture]') &&
              document.querySelector('[data-tt-active]')
              ? {
                  tiles: tiles.length,
                  menu: menu.join(','),
                  open: document.body.classList.contains('tt-st-open'),
                }
              : null;
          },
          null,
          120000,
          'the stations rail',
        );
        must(r.menu === 'layers,display,keys', `menu ${r.menu}`);
        await shot(p, `K8-T6-all-in-one-${w}`);
        await press(p, '[data-tt-aperture]');
        const flipped = await pageUntil(
          p,
          (was) =>
            document.body.classList.contains('tt-st-open') !== was && 'flipped',
          r.open,
          5000,
          'the aperture to toggle the rail',
        );
        await press(p, '[data-tt-aperture]');
        out.push(
          `${w}×${h}: ${r.tiles} tiles, menu ${r.menu}, rail ${r.open ? 'open' : 'closed'} → ${flipped} → back`,
        );
        await p.close();
      }
      return { detail: out.join('; ') };
    },
    { cleanup: true },
  );

  await step(
    'K8-S9',
    'C65 steel only: no saturated colour in the wall chrome K8 adds (the chip band, the pair card and every card with no code), sampled from the shots',
    async () => {
      const rows = [];
      for (const s of STEEL_SHOTS) {
        if (!fs.existsSync(s.file)) throw new Error(`no shot ${s.name}`);
        const r = await saturatedIn(s.file, s.box);
        rows.push(`${s.name} ${r.n}/${r.px}`);
        must(
          r.n === 0,
          `${s.name}: ${r.n} saturated pixels (first ${JSON.stringify(r.worst)})`,
        );
      }
      return {
        detail: `${STEEL_SHOTS.length} shots, 0 saturated pixels: ${rows.join(', ')}`,
      };
    },
  );
  await rmCtx?.close().catch(() => {});

  await step(
    'K6-S1',
    'audit log: 0600 files in a 0700 folder; envelope v1, seq rising across the restarts and the revert drill; the smoke’s events are there; no setup token, token, pairing code, device id, thumbnail or wall text in the folder',
    async () => {
      if (server.external) return { notRun: true, ok: true };
      const dir = server.auditDir;
      must(modeOf(dir) === '700', `audit folder mode ${modeOf(dir)}`);
      const files = fs
        .readdirSync(dir)
        .filter((n) => /^audit-.*\.jsonl$/.test(n));
      must(files.length >= 1, 'no audit file');
      for (const f of files)
        must(
          modeOf(path.join(dir, f)) === '600',
          `${f} mode ${modeOf(path.join(dir, f))}`,
        );
      const lines = auditLines(server);
      must(!lines.some((l) => l.torn), 'a line is not JSON');
      let seq = 0;
      for (const l of lines) {
        must(l.v === 1 && typeof l.type === 'string', `envelope ${l.type}`);
        must(l.seq > seq, `seq ${l.seq} after ${seq}`);
        seq = l.seq;
      }
      const types = new Map();
      for (const l of lines) types.set(l.type, (types.get(l.type) || 0) + 1);
      for (const t of [
        'relay.boot',
        'session.setup',
        'device.hello',
        'device.paired',
        'cmd.applied',
        'undo.applied',
        'upgrade.refused',
        'http.refused',
      ])
        must(types.get(t) > 0, `no ${t} line`);
      const boots = new Set(lines.map((l) => l.boot));
      must(
        boots.size >= 2,
        `${boots.size} boot(s): the restarts are not in it`,
      );
      for (const l of lines.filter((x) => x.type === 'upgrade.refused'))
        must(l.peer?.ip, 'upgrade.refused without its peer');
      for (const l of lines.filter((x) =>
        ['cmd.applied', 'device.paired', 'undo.applied'].includes(x.type),
      ))
        must(!('peer' in l), `${l.type} has a peer`);
      // The canary: every secret this run held (never printed).
      const s6 = await page
        ?.evaluate(() =>
          JSON.parse(localStorage.getItem('tripTwin.soc.slot.6') || 'null'),
        )
        .catch(() => null);
      const secrets = [
        setup,
        remote?.token,
        remote?.id,
        ...walls.flatMap((d) => [d.token, d.id]),
        s6?.token,
        s6?.id,
        page?.__code && `"${page.__code}"`,
        ...k7Secrets,
        // L5: every token and setup link this run was given, the ones
        // from before the re-pair too.
        ...SEEN_TOKENS,
        'data:image',
        'hands-on',
        'shows:',
      ].filter(Boolean);
      const text = auditFolderText(server);
      const hits = secrets.filter((x) => text.includes(x));
      must(
        hits.length === 0,
        `${hits.length} secret(s) in the audit folder (kinds: ${hits.map((h) => (h.startsWith('"') ? 'code' : h.length > 20 ? 'id or token' : h)).join(', ')})`,
      );
      return {
        detail: `${files.length} file(s), ${lines.length} lines, seq 1…${seq}, ${boots.size} boots; ${[...types].map(([t, n]) => `${t} ${n}`).join(', ')}; ${secrets.length} secrets searched: 0 hits`,
      };
    },
  );

  await step(
    'K6-S2',
    'health and log: this computer gets /api/twin-sync/health (audit, store, host check, confirmBypass 0) and /log (no peer); a LAN Host gets 403 for both; the audit file is not served',
    async () => {
      if (server.external) return { notRun: true, ok: true };
      const port = server.port;
      const own = { host: `localhost:${port}` };
      const h = await rawGet(port, '/api/twin-sync/health', own);
      must(h.status === 200, `health ${h.status}`);
      const j = JSON.parse(h.body);
      must(j.audit?.ok === true, `audit not ok: ${j.audit?.lastError}`);
      must(j.store?.ok === true, `store not ok: ${j.store?.lastError}`);
      must(j.hostCheck?.mode === 'report', `host check ${j.hostCheck?.mode}`);
      must(j.counters?.confirmBypass === 0, 'confirmBypass is not 0');
      must(j.proto === PROTO, `proto ${j.proto}`);
      const lg = await rawGet(port, '/api/twin-sync/log?limit=200', own);
      must(lg.status === 200, `log ${lg.status}`);
      const events = JSON.parse(lg.body).events || [];
      must(events.length > 0, 'log: no events');
      must(
        events.every((e) => !('peer' in e)),
        'log: an event carries a peer',
      );
      for (const p of ['/api/twin-sync/health', '/api/twin-sync/log']) {
        const lan = await rawGet(port, p, { host: `192.168.1.3:${port}` });
        must(lan.status === 403, `${p} with a LAN Host: ${lan.status}`);
      }
      const file = fs
        .readdirSync(server.auditDir)
        .filter((n) => /^audit-.*\.jsonl$/.test(n))
        .map((n) => path.join(server.auditDir, n))[0];
      const served = await rawGet(port, `/@fs${file}`, own);
      must(
        !(served.status === 200 && served.body.includes('"seq"')),
        `the audit file is served (${served.status})`,
      );
      const live = statOf(LIVE_AUDIT_DIR);
      must(
        live.exists === liveAudit0.exists &&
          live.mtimeMs === liveAudit0.mtimeMs,
        'the live ~/Library/Logs/trip-twin/ changed',
      );
      return {
        detail: `health ${h.status}: audit ok (seq ${j.audit.seq}), store ok, host check report, confirmBypass 0, apply→broadcast p95 ${j.timings?.applyToBroadcastMsP95} ms; log ${events.length} events, no peer; LAN Host 403 ×2; /@fs audit file ${served.status}; live audit folder ${live.exists ? 'unchanged' : 'absent'}`,
      };
    },
  );

  await step(
    'L5-S1',
    'token scan (S-14): no plain token at rest in the QA data folder (store, backup, marker, quarantine/) or the QA TMPDIR, for every token this run was given, across the restarts and the revert drill',
    async () => {
      if (server.external) return { notRun: true, ok: true };
      if (!hashedBuild(server))
        return { notRun: true, ok: true, detail: 'build below L5' };
      const s6 = await page
        ?.evaluate(() =>
          JSON.parse(localStorage.getItem('tripTwin.soc.slot.6') || 'null'),
        )
        .catch(() => null);
      if (s6?.token) SEEN_TOKENS.add(s6.token);
      for (const d of [...walls, remote])
        if (d?.token) SEEN_TOKENS.add(d.token);
      const tokens = [...SEEN_TOKENS];
      const hits = plainTokenFiles({
        dirs: [server.dataDir, server.tmp],
        tokens,
      });
      must(
        hits.length === 0,
        `plain token at rest: ${hits.map((h) => `${path.relative(server.dir, h.file)} (${h.why})`).join('; ')}`,
      );
      const files = [server.dataDir, server.tmp].flatMap((d) =>
        fs.existsSync(d)
          ? fs.readdirSync(d, { recursive: true }).map(String)
          : [],
      );
      return {
        detail: `${tokens.length} tokens searched in ${files.length} entries (data folder: ${fs.readdirSync(server.dataDir).sort().join(', ')}): 0 hits`,
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
    'live: close S4, wait past the setup expiry while a stuck remote retries a forgotten token on loopback every second (K7, review B4), Open S4 again from the launcher',
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
        `          waiting ${Math.round((SETUP_TTL_MS + 30000) / 60000)} min for the setup link to expire (a stuck remote retries meanwhile)…`,
      );
      // K7 gate (B4): one stuck remote on loopback, a forgotten token, a new
      // socket every second for the whole wait: faster than twinSync.js
      // retries. Wrong tokens never lock anyone out, so S4 must rejoin.
      let stop = false;
      const stuck = { told: 0, other: 0 };
      const stuckLoop = (async () => {
        while (!stop) {
          const c = await client(base).catch(() => null);
          if (!c) {
            stuck.other += 1;
            await sleep(1000);
            continue;
          }
          const w = c.next('welcome', 4000, 'stuck welcome');
          c.say({
            t: 'hello',
            proto: PROTO,
            id: 'remote-qa-stuck',
            kind: 'remote',
            token: 'k7-stuck-remote-token-forgotten-0000000000',
          });
          const m = await w.catch(() => null);
          if (m?.code === 'FORGOTTEN') stuck.told += 1;
          else stuck.other += 1;
          await c.close();
          await sleep(1000);
        }
      })();
      await sleep(SETUP_TTL_MS + 30000);
      stop = true;
      await stuckLoop;
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
        x.pairShown || !s4?.online || stuck.other > 0 || stuck.told < 300,
        `${
          x.pairShown
            ? 'the reopened S4 shows a PAIR CODE'
            : `rejoined: "${x.chip}"; presence S4 ${s4?.online ? 'online' : 'NOT online'}`
        }; stuck remote: ${stuck.told} hellos told FORGOTTEN, ${stuck.other} other`,
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
