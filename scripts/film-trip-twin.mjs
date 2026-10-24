#!/usr/bin/env node
// Trip Twin film recorder (24 Oct 2026): records each wall (S1–S6) and the
// All-in-one full screen on one 5K display, one take at a time, for the
// explainer film. Every take is a fresh six-wall session whose remote runs
// the same cue list at the same second, and the pages run in filming mode
// (?film: the feed lands on 15 s steps from the session's start), so the
// seven recordings show the same clock, data and changes at the same second
// and can be laid together in the edit.
//
//   node scripts/film-trip-twin.mjs --check            display, permission,
//                                                      one wall, no recording
//   node scripts/film-trip-twin.mjs [--takes S1,S2,S3,S4,S5,S6,all]
//     [--display "UltraFine (1)" | <index>] [--cues scripts/film/…json]
//     [--out <folder>] [--port 4188] [--warmup 40] [--fps 30]
//     [--any-size] [--url http://localhost:4173]
//     [--no-record]   a rehearsal: the same takes, stills after each cue
//
// It runs its own server on --port with its own data folder (never the live
// wall's), and its own Chrome profile (never yours). It installs nothing:
// it needs Google Chrome and ffmpeg, and macOS Screen Recording permission
// for the terminal it runs in. The display must look like 2560 × 1440 (the
// walls' size) unless --any-size. Recordings go to ~/Movies/Trip Twin film/
// with take.json (session start, cue times) beside each, and IPAD-CUES.md,
// the same cues as taps for the iPad recording.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import WebSocket from 'ws';
import { PROTO } from '../src/operations/tripTwin/twinProtocol.js';
import { DEMO_TRIPS } from '../src/operations/tripTwin/demoTrips.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WALL_W = 2560;
const WALL_H = 1440;
const PREROLL_S = 3;
const POSTROLL_S = 3;

// ------------------------------------------------------------------ args
function parseArgs(argv) {
  const o = {
    check: false,
    takes: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'all'],
    display: null,
    cues: path.join(ROOT, 'scripts/film/trip-twin-cues.json'),
    out: null,
    // Not 4190: browsers refuse that port (it is the sieve mail port).
    port: 4188,
    warmup: 40,
    fps: 30,
    anySize: false,
    noRecord: false,
    url: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--check') o.check = true;
    else if (a === '--takes')
      o.takes = v()
        .split(',')
        .map((s) => s.trim());
    else if (a === '--display') o.display = v();
    else if (a === '--cues') o.cues = path.resolve(v());
    else if (a === '--out') o.out = path.resolve(v());
    else if (a === '--port') o.port = Number(v());
    else if (a === '--warmup') o.warmup = Number(v());
    else if (a === '--fps') o.fps = Number(v());
    else if (a === '--any-size') o.anySize = true;
    else if (a === '--no-record') o.noRecord = true;
    else if (a === '--url') o.url = v().replace(/\/$/, '');
    else throw new Error(`Unknown option ${a}`);
  }
  for (const t of o.takes)
    if (!/^(S[1-6]|all)$/.test(t)) throw new Error(`Unknown take ${t}`);
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const log = (...a) => console.log(...a);
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const mmss = (s) =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// -------------------------------------------------------------- displays
/** The displays macOS knows, in points, with Chrome's top-left origin. */
function displays() {
  const js = `ObjC.import('AppKit');
var s = $.NSScreen.screens, out = [];
for (var i = 0; i < s.count; i++) {
  var x = s.objectAtIndex(i), f = x.frame;
  out.push({ i: i, name: ObjC.unwrap(x.localizedName), x: f.origin.x,
    y: f.origin.y, w: f.size.width, h: f.size.height,
    scale: x.backingScaleFactor });
}
JSON.stringify(out);`;
  const r = spawnSync('osascript', ['-l', 'JavaScript', '-e', js], {
    encoding: 'utf8',
  });
  must(r.status === 0, `Could not list displays: ${r.stderr}`);
  const list = JSON.parse(r.stdout);
  const mainH = list[0].h;
  // NSScreen counts y up from the main display's bottom; Chrome counts down
  // from its top.
  return list.map((d) => ({ ...d, left: d.x, top: mainH - (d.y + d.h) }));
}

function pickDisplay(list, want) {
  if (want != null && /^\d+$/.test(want)) return list[Number(want)];
  if (want) return list.find((d) => d.name.includes(want));
  // Default: the largest display that is not the built-in one.
  return [...list]
    .filter((d) => !/built-in/i.test(d.name))
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
}

// ---------------------------------------------------------------- ffmpeg
function ffmpegScreens() {
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
    { encoding: 'utf8' },
  );
  if (r.error) throw new Error('ffmpeg not found (it is not installed here)');
  return [...r.stderr.matchAll(/\[(\d+)\] Capture screen (\d+)/g)].map((m) => ({
    index: Number(m[1]),
    screen: Number(m[2]),
  }));
}

/**
 * One frame from an ffmpeg screen: its size and mean brightness. The frame
 * is read in memory and never written to disk.
 */
function probeScreen(index) {
  const size = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-f',
      'avfoundation',
      '-capture_cursor',
      '0',
      '-framerate',
      '30',
      '-i',
      `${index}:none`,
      '-frames:v',
      '1',
      '-f',
      'null',
      '-',
    ],
    // No frame in 10 s: macOS gave this terminal no Screen Recording.
    { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL' },
  );
  const m = (size.stderr || '').match(/Stream #0:0.*?, (\d{3,5})x(\d{3,5})/);
  const mean = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'avfoundation',
      '-capture_cursor',
      '0',
      '-framerate',
      '30',
      '-i',
      `${index}:none`,
      '-frames:v',
      '1',
      '-vf',
      'scale=8:8',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-',
    ],
    { maxBuffer: 1 << 20, timeout: 10000, killSignal: 'SIGKILL' },
  );
  const px = mean.stdout || Buffer.alloc(0);
  const avg = px.length ? px.reduce((a, b) => a + b, 0) / px.length : 0;
  return {
    w: m ? Number(m[1]) : 0,
    h: m ? Number(m[2]) : 0,
    max: px.length ? Math.max(...px) : 0,
    avg,
    ok: size.status === 0 && Boolean(m),
    error:
      size.status === 0
        ? ''
        : size.signal
          ? 'no frame in 10 s'
          : (size.stderr || '').split('\n').slice(-3).join(' '),
  };
}

/** The ffmpeg screen whose frame has the display's pixel size. */
function matchScreen(display) {
  const want = [display.w * display.scale, display.h * display.scale];
  const found = [];
  for (const s of ffmpegScreens()) {
    const p = probeScreen(s.index);
    found.push({ ...s, ...p });
    if (p.error === 'no frame in 10 s')
      throw new Error(
        'The screen gives no frames: this terminal has no Screen Recording permission. Turn it on in System Settings › Privacy & Security › Screen & System Audio Recording, quit and reopen the terminal, and run this again (or run it from Terminal.app with the permission on).',
      );
    if (p.ok && p.w === want[0] && p.h === want[1]) return { ...s, ...p };
  }
  throw new Error(
    `No ffmpeg screen is ${want[0]}×${want[1]} px. Seen: ${found
      .map((f) => `[${f.index}] ${f.ok ? `${f.w}×${f.h}` : f.error}`)
      .join(
        '; ',
      )}. If every screen failed, give the terminal Screen Recording permission (System Settings › Privacy & Security › Screen Recording) and run it again.`,
  );
}

// ---------------------------------------------------------------- server
async function waitInfo(base, ms = 90000) {
  const end = Date.now() + ms;
  let last = '';
  while (Date.now() < end) {
    try {
      const r = await fetch(`${base}/api/twin-sync/info`);
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last =
        [
          e.cause?.code,
          e.cause?.message,
          e.cause?.errors?.map((x) => x.code).join('+'),
        ]
          .filter(Boolean)
          .join(' · ') || e.message; // not up yet
    }
    await sleep(500);
  }
  throw new Error(`The film server did not answer at ${base} (${last})`);
}

/** Its own Vite on `port`: its own data folder and TMPDIR, never the wall's. */
async function startServer(out, port) {
  const data = path.join(out, 'server-data');
  const tmp = path.join(out, 'server-tmp');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  const logFile = fs.openSync(path.join(out, 'server.log'), 'a');
  const child = spawn(
    path.join(ROOT, 'node_modules/.bin/vite'),
    [
      '--config',
      'vite.twin.config.js',
      '--port',
      String(port),
      '--strictPort',
      // IPv4: Node's fetch and ws reach localhost there.
      '--host',
      '127.0.0.1',
    ],
    {
      cwd: ROOT,
      env: { ...process.env, TRIP_TWIN_DATA_DIR: data, TMPDIR: tmp },
      stdio: ['ignore', logFile, logFile],
    },
  );
  const base = `http://localhost:${port}`;
  const stop = () => child.kill('SIGTERM');
  await waitInfo(base).catch((e) => {
    stop();
    throw e;
  });
  return { base, stop };
}

// ---------------------------------------------------------- relay client
function client(base) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/twin-sync`, {
      headers: { Origin: base },
    });
    const c = {
      out: [],
      waiters: [],
      say: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)),
      next(pred, ms = 8000, what = 'a message') {
        const test = typeof pred === 'string' ? (m) => m.t === pred : pred;
        return new Promise((ok, no) => {
          const w = { test, ok };
          c.waiters.push(w);
          setTimeout(() => {
            c.waiters = c.waiters.filter((x) => x !== w);
            no(new Error(`timed out waiting for ${what}`));
          }, ms);
        });
      },
      close: () => ws.close(),
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
    // The remote keeps its lease with a heartbeat every 5 s (twinSync.js).
    const beat = setInterval(() => c.say({ t: 'hb' }), 5000);
    ws.once('close', () => clearInterval(beat));
    ws.once('open', () => resolve(c));
    ws.once('error', reject);
  });
}

/**
 * A fresh six-wall session for one take: the launcher's setup (from this
 * computer), then a remote that takes control. Returns the setup link and
 * the session's start (its scenario epoch).
 */
async function freshSession(base, { tripId }) {
  const launcher = await client(base);
  launcher.say({
    t: 'hello',
    proto: PROTO,
    id: 'film-launcher',
    kind: 'launcher',
  });
  await launcher.next('welcome', 8000, 'launcher welcome');
  const got = launcher.next('setup', 8000, 'setup answer');
  launcher.say({ t: 'setup', proto: PROTO, count: 6, tripId, siteKey: null });
  const s = await got;
  must(s.ok && s.setup, `setup refused: ${s.error || '?'}`);
  const remote = await client(base);
  const welcome = remote.next('welcome', 8000, 'remote welcome');
  remote.say({
    t: 'hello',
    proto: PROTO,
    id: `film-remote-${Date.now().toString(36)}`,
    kind: 'remote',
    // The relay names a remote by where it connects from (CF-D8): on
    // this computer the walls say "Remote: Trip Twin computer".
    name: 'Film cues',
    setup: s.setup,
  });
  const w = await welcome;
  must(
    w.type === 'remote' && w.controller === true,
    `the film remote got ${w.type} (controller ${w.controller})`,
  );
  // The launcher sees no state (K7); the paired remote's welcome has it.
  const epochMs = w.state?.session?.epochMs;
  must(epochMs, 'the remote welcome has no session start');
  return { setup: s.setup, epochMs, launcher, remote };
}

/** A cue's command with "$now", "$newReportId" and "$reportId" filled in. */
function resolveCmd(cmd, vars) {
  return JSON.parse(JSON.stringify(cmd), (k, v) => {
    if (v === '$now') return Date.now();
    if (v === '$newReportId') return (vars.reportId = `op-${Date.now()}`);
    if (v === '$reportId') return vars.reportId;
    return v;
  });
}

// --------------------------------------------------------------- browser
async function openBrowser(display, out) {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    defaultViewport: null,
    userDataDir: path.join(out, 'chrome-profile'),
    // No "controlled by automated test software" bar on camera.
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      `--window-position=${display.left},${display.top}`,
      `--window-size=${display.w},${display.h}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-crash-restore-bubble',
      '--disable-session-crashed-bubble',
      '--disable-features=Translate',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });
  const [page] = await browser.pages();
  const cdp = await page.createCDPSession();
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', {
    windowId,
    bounds: {
      left: display.left,
      top: display.top,
      width: display.w,
      height: display.h,
      windowState: 'normal',
    },
  });
  // Page full screen (no toolbar) on every load, a trip switch's reload
  // too: macOS window full screen keeps Chrome's toolbar, and so does
  // --kiosk. Not awaited: the page answers when it is ready.
  const full = () =>
    cdp
      .send('Runtime.evaluate', {
        expression:
          'document.fullscreenElement || document.documentElement.requestFullscreen().catch(() => {}); 0',
        userGesture: true,
      })
      .catch(() => {});
  page.on('load', full);
  page.on('domcontentloaded', full);
  return { browser, page, cdp };
}

/** A clean page for the next take: no pairing left from the last one. */
async function cleanPage({ page, cdp }, base) {
  await page.goto('about:blank');
  await cdp.send('Storage.clearDataForOrigin', {
    origin: base,
    storageTypes: 'all',
  });
}

async function wallState(page) {
  return page
    .evaluate(() => ({
      chip: document.querySelector('[data-tt-chip]')?.textContent || '',
      unpaired: document.body.classList.contains('tt-unpaired'),
      w: innerWidth,
      h: innerHeight,
      bars: outerHeight - innerHeight,
    }))
    .catch(() => null);
}

// ----------------------------------------------------------------- takes
async function runTake(take, ctx) {
  const { base, opts, cues, view, screen, out } = ctx;
  const trip = DEMO_TRIPS.find((t) => t.id === cues.tripId) || DEMO_TRIPS[0];
  const isWall = take !== 'all';
  await cleanPage(view, base);
  const sess = isWall
    ? await freshSession(base, { tripId: trip.id })
    : { epochMs: Date.now() };
  const url = isWall
    ? `${base}/twin.html?view=screen&slot=${take.slice(1)}&setup=${encodeURIComponent(sess.setup)}&film`
    : `${base}/twin.html?city=${trip.city}&scenario=${trip.scenario}&film=${sess.epochMs}`;
  await view.page.goto(url, { waitUntil: 'domcontentloaded' });
  const start = sess.epochMs + opts.warmup * 1000;
  const recSeconds = cues.seconds + PREROLL_S + POSTROLL_S;
  const file = path.join(out, `${take}.mov`);
  const record = {
    take,
    trip: trip.id,
    url: url.replace(/setup=[^&]+/, 'setup=…'),
    sessionStartMs: sess.epochMs,
    takeStartMs: start,
    recordFrom: `${PREROLL_S} s before the take start`,
    cues: [],
  };
  // Ready by the take start: paired, the remote named in the chip.
  // 8 s before the recording: full screen settles and its "Esc" note fades.
  await sleep(start - PREROLL_S * 1000 - 8000 - Date.now());
  // Full screen settles before the check (see openBrowser).
  const st = await wallState(view.page);
  record.ready = st;
  if (isWall)
    must(
      st && !st.unpaired && / · Remote: /.test(st.chip),
      `${take} is not ready at the take start (chip "${st?.chip}")`,
    );
  must(
    st && st.w === screen.display.w && st.h === screen.display.h,
    `${take} page is ${st?.w}×${st?.h}, not full screen ${screen.display.w}×${screen.display.h}`,
  );
  if (opts.check) {
    sess.remote?.close();
    sess.launcher?.close();
    return record;
  }
  await sleep(start - PREROLL_S * 1000 - Date.now());
  // A rehearsal (--no-record) runs the same take with stills, no video.
  const ff = opts.noRecord
    ? null
    : spawn(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'avfoundation',
          '-capture_cursor',
          '0',
          '-framerate',
          String(opts.fps),
          '-i',
          `${screen.index}:none`,
          '-t',
          String(recSeconds),
          '-c:v',
          'hevc_videotoolbox',
          '-b:v',
          '80M',
          '-tag:v',
          'hvc1',
          '-pix_fmt',
          'yuv420p',
          file,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
  record.recordSpawnMs = Date.now();
  let ffErr = '';
  ff?.stderr.on('data', (d) => (ffErr += d));
  const done = ff
    ? new Promise((r) => ff.once('exit', r))
    : sleep(recSeconds * 1000).then(() => 0);
  const vars = {};
  let reqId = 0;
  // The cues, at the same second of every take: walls by the remote's
  // command, the All-in-one (not on the session) by the same functions its
  // buttons call (window.__ttFilm, page.js).
  for (const cue of cues.cues.filter((c) => (isWall ? c.cmd : c.aio))) {
    await sleep(start + cue.at * 1000 - Date.now());
    const sentMs = Date.now();
    let a;
    if (isWall) {
      const id = ++reqId;
      const ack = sess.remote.next(
        (m) => m.t === 'ack' && m.reqId === id,
        5000,
        `ack for "${cue.tap}"`,
      );
      sess.remote.say({
        t: 'cmd',
        reqId: id,
        cmd: resolveCmd(cue.cmd, vars),
        label: cue.tap || cue.note,
      });
      a = await ack.catch((e) => ({ ok: false, error: e.message }));
    } else {
      a = await view.page
        .evaluate(({ fn, args }) => {
          const f = window.__ttFilm?.[fn];
          if (!f) return { ok: false, error: `no film action ${fn}` };
          const r = f(...(args || []));
          return r === false
            ? { ok: false, error: `${fn} did nothing` }
            : { ok: true };
        }, cue.aio)
        .catch((e) => ({ ok: false, error: e.message }));
    }
    const what = cue.tap || cue.note;
    record.cues.push({
      at: cue.at,
      what,
      sentMs,
      lateMs: sentMs - (start + cue.at * 1000),
      ok: a.ok,
      ...(a.ok ? {} : { error: a.error || a.code }),
    });
    log(
      `  ${mmss(cue.at)} ${a.ok ? '✓' : '✗'} ${what}${a.ok ? '' : ` · ${a.error || a.code}`}`,
    );
    if (opts.noRecord)
      setTimeout(() => {
        view.page
          .screenshot({
            path: path.join(
              out,
              `${take}-${String(cue.at).padStart(3, '0')}.jpg`,
            ),
            type: 'jpeg',
            quality: 70,
          })
          .catch(() => {});
      }, 4000);
  }
  const code = await done;
  must(code === 0, `ffmpeg stopped with ${code}: ${ffErr.trim()}`);
  if (opts.noRecord) {
    sess.remote?.close();
    sess.launcher?.close();
    return record;
  }
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height:format=duration',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8' },
  );
  const info = JSON.parse(probe.stdout || '{}');
  record.file = path.basename(file);
  record.video = {
    width: info.streams?.[0]?.width,
    height: info.streams?.[0]?.height,
    seconds: Number(info.format?.duration),
  };
  sess.remote?.close();
  sess.launcher?.close();
  return record;
}

function cueSheet(cues) {
  const rows = cues.cues.map((c) =>
    c.tap
      ? `| ${mmss(c.at)} | ${c.tap} |`
      : `| ${mmss(c.at)} | (no tap · on the big screen: ${c.note}) |`,
  );
  return `# iPad cues · Trip Twin film

Record the iPad (Control Center › Screen Recording, or QuickTime by cable).
Start a ${cues.seconds} s timer when the recording starts; tap at each time.
The wall takes ran these same cues at the same seconds.

| Time | Tap on the iPad |
|---|---|
${rows.join('\n')}
| ${mmss(cues.seconds)} | Stop the recording |
`;
}

// ------------------------------------------------------------------ main
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cues = JSON.parse(fs.readFileSync(opts.cues, 'utf8'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out =
    opts.out ||
    path.join(
      os.homedir(),
      'Movies',
      'Trip Twin film',
      `${opts.check ? 'check' : 'takes'}-${stamp}`,
    );
  fs.mkdirSync(out, { recursive: true });

  const list = displays();
  log('Displays:');
  for (const d of list)
    log(`  [${d.i}] ${d.name} · ${d.w}×${d.h} pt @${d.scale}x`);
  const display = pickDisplay(list, opts.display);
  must(display, `No display matches "${opts.display}"`);
  log(`Filming on [${display.i}] ${display.name}`);
  if (!opts.anySize)
    must(
      display.w === WALL_W && display.h === WALL_H,
      `${display.name} looks like ${display.w}×${display.h}; set it to ${WALL_W}×${WALL_H} (System Settings › Displays › Default) so the walls look as they do on the wall, or pass --any-size`,
    );
  // A check goes on without the capture, to test the walls on the display.
  let screen = { display };
  try {
    screen = { ...matchScreen(display), display };
    must(
      screen.max > 0,
      'The screen recording came back black: give the terminal Screen Recording permission (System Settings › Privacy & Security › Screen & System Audio Recording) and run it again',
    );
    log(
      `Recording ffmpeg screen [${screen.index}] at ${screen.w}×${screen.h} px`,
    );
  } catch (e) {
    if (!opts.check && !opts.noRecord) throw e;
    log(`CAPTURE NOT READY · ${e.message}`);
  }

  const server = opts.url
    ? { base: opts.url, stop: () => {} }
    : await startServer(out, opts.port);
  log(`Server ${server.base}${opts.url ? '' : ' (its own data folder)'}`);
  const view = await openBrowser(display, out);
  const ctx = { base: server.base, opts, cues, view, screen, out };
  const records = [];
  try {
    for (const take of opts.check ? ['S1'] : opts.takes) {
      log(`${take}: warming up ${opts.warmup} s, then ${cues.seconds} s`);
      const r = await runTake(take, ctx);
      records.push(r);
      if (opts.check) {
        const shot = path.join(out, 'check-S1.png');
        await view.page.screenshot({ path: shot });
        log(`Check OK: S1 full screen, chip "${r.ready.chip}". Shot: ${shot}`);
      } else {
        fs.writeFileSync(
          path.join(out, `${take}.json`),
          `${JSON.stringify(r, null, 2)}\n`,
        );
        if (r.video)
          log(
            `  ${r.file} · ${r.video.width}×${r.video.height} · ${r.video.seconds.toFixed(1)} s`,
          );
      }
    }
  } finally {
    await view.browser.close().catch(() => {});
    server.stop();
  }
  if (!opts.check) {
    fs.writeFileSync(path.join(out, 'IPAD-CUES.md'), cueSheet(cues));
    fs.writeFileSync(
      path.join(out, 'takes.json'),
      `${JSON.stringify({ cues: opts.cues, takes: records }, null, 2)}\n`,
    );
  }
  log(`Done: ${out}`);
}

main().catch((e) => {
  console.error(`FAIL · ${e.message}`);
  process.exit(1);
});
