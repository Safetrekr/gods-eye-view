#!/usr/bin/env node
// SafeTrekr Executive B5: the mock phones, headless (EP-50 row B5).
//   node scripts/qa-executive-phones.mjs --dir <fresh scratch folder>
//     [--out <folder>]
// Reuses qa-executive-walls.mjs's server and room (imported, not edited).
// Port 4196 only (strict: refuses if busy; never 4173, 4191 or 4197).
// TRIP_TWIN_DATA_DIR, TRIP_TWIN_AUDIT_DIR and TMPDIR sit in --dir, which
// must not exist yet. Opens twin-phone.html for KESTREL, HARRIER, ATLAS 6,
// ATLAS 3, WREN (each by participant, this computer) and SWIFT 1 (by the
// presenter's one-time ticket, as a LAN phone pairs), each in the iPhone
// frame at 480×920 ×2. The remote cuts the loop clock (paused) to each
// key moment; the script taps as a person would, a little ahead of the
// script, so each tap pre-empts its scripted reply. Saves <out>/NN-*.png,
// contact-sheet.png and results-phones.json. Checks per shot: SAMPLE on
// screen; no other person's name, no intel title, no other phone's push
// text in the DOM; the screen the moment expects. Then the day runs to
// its end: the counter must read 214·11·6·4·6. The server is stopped at
// the end (and on any exit).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { openRoom, startExecServer } from './qa-executive-walls.mjs';
import { selectCounter } from '../src/operations/tripTwin/products/executive/loop/select.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d = null) =>
  argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const PORT = 4196;
const OUT = path.resolve(
  arg('out') ||
    path.join(ROOT, '..', 'plans', 'trip-twin', 'executive', 'review', 'b5'),
);
const DIR = arg('dir') ? path.resolve(arg('dir')) : null;
const PHONES = [
  ['p-kestrel', 'KESTREL'],
  ['p-harrier', 'HARRIER'],
  ['p-atlas6', 'ATLAS 6'],
  ['p-atlas3', 'ATLAS 3'],
  ['p-wren', 'WREN'],
  ['p-swift1', 'SWIFT 1'],
];

function forbiddenFor(day, pid) {
  const out = new Set();
  for (const p of Object.values(day.people)) if (p.id !== pid) out.add(p.name);
  for (const s of day.watch.staff) out.add(s.name);
  for (const b of Object.values(day.bundles))
    if (b.title?.length >= 16) out.add(b.title);
  for (const e of day.events) {
    if (e.type === 'dl.respond' && e.reason && pid !== e.by) out.add(e.reason);
    if (e.type === 'push.send')
      for (const [to, card] of Object.entries(e.phone || {}))
        if (to !== pid && !(e.recipients || []).includes(pid) && card.body)
          out.add(card.body);
  }
  return [...out].filter(Boolean);
}

async function pageText(page) {
  return page.evaluate(() => {
    const parts = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const cs = getComputedStyle(n.parentElement);
      if (
        n.nodeValue.trim() &&
        cs.display !== 'none' &&
        cs.visibility !== 'hidden'
      )
        parts.push(n.nodeValue);
    }
    // Form fields count as on screen too (a pre-filled reply, a reason).
    for (const f of document.querySelectorAll('textarea, input:not([type])'))
      if (f.value) parts.push(f.value);
    return parts.join(' ').replace(/\s+/g, ' ');
  });
}

async function contactSheet(browser, shots) {
  const page = await browser.newPage();
  const cols = 5;
  const rows = Math.ceil(shots.length / cols);
  await page.setViewport({ width: cols * 250 + 20, height: rows * 520 + 70 });
  const cells = shots
    .map(
      (s) =>
        `<figure><img src="data:image/png;base64,${fs.readFileSync(s.file).toString('base64')}"><figcaption>${s.name}</figcaption></figure>`,
    )
    .join('');
  await page.setContent(
    `<html><body style="margin:0;padding:10px;background:#cfd6d9;color:#061a23;font:13px Menlo,monospace">
    <div style="padding:4px 6px 10px">SafeTrekr Executive B5 · mock phones · SAMPLE</div>
    <div style="display:grid;grid-template-columns:repeat(${cols},250px)">${cells}</div>
    <style>figure{margin:0 0 10px}img{width:240px;height:460px;object-fit:contain;display:block}figcaption{padding:4px 2px}</style></body></html>`,
    { waitUntil: 'load' },
  );
  const file = path.join(OUT, 'contact-sheet.png');
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
  return file;
}

async function main() {
  must(DIR, '--dir <fresh folder> is required');
  must(!fs.existsSync(DIR), `--dir ${DIR} must not exist yet`);
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
  console.log(`executive server on :${PORT} · scratch ${DIR}`);
  const server = await startExecServer({ dir: DIR, port: PORT });
  const base = server.url;
  const shots = [];
  const checks = [];
  let browser = null;
  let room = null;
  try {
    room = await openRoom(base);
    const loop = async (cmd) => {
      let a = await room.loop(cmd);
      if (a.code === 'CONFIRM_REQUIRED')
        a = await room.loop({ type: 'confirm', id: a.ask.id });
      must(a.ok, `${cmd.type} ${cmd.to ?? cmd.n ?? ''}: ${a.code || a.error}`);
      return a;
    };
    const jump = async (to) => {
      await loop({ type: 'clock.jump', to });
      await sleep(400);
    };
    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 60000,
      args: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    });
    const pages = {};
    for (const [pid, cs] of PHONES) {
      const page = await browser.newPage();
      await page.setViewport({ width: 480, height: 920, deviceScaleFactor: 2 });
      page.on('pageerror', (e) => checks.push({ pid, error: String(e) }));
      let url = `${base}/twin-phone.html?p=${pid}&frame=1`;
      if (pid === 'p-swift1') {
        // The LAN way: the presenter's one-time ticket.
        const t = await room.loop({
          type: 'phone.ticket',
          participant_id: pid,
        });
        must(t.ok && t.ticket, `ticket: ${t.code}`);
        url = `${base}/twin-phone.html?ticket=${t.ticket}&frame=1`;
      }
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        (p) => document.body.dataset.phParticipant === p,
        { timeout: 20000, polling: 200 },
        pid,
      );
      if (pid === 'p-swift1')
        must(!page.url().includes('ticket='), 'the ticket leaves the URL');
      pages[pid] = { page, cs };
    }
    // The chooser.
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 480, height: 920, deviceScaleFactor: 2 });
      await page.goto(`${base}/twin-phone.html`, { waitUntil: 'networkidle0' });
      const listed = await page.$$eval('[data-pid]', (a) =>
        a.map((x) => x.dataset.pid),
      );
      must(
        listed.join() === PHONES.map((p) => p[0]).join(),
        `chooser lists ${listed}`,
      );
      const file = path.join(OUT, '00-chooser.png');
      await page.screenshot({ path: file });
      shots.push({ name: '00 chooser', file });
      await page.close();
    }

    let n = 0;
    async function shot(pid, name, { screen = null, contains = [] } = {}) {
      const { page } = pages[pid];
      await page.bringToFront();
      if (screen)
        await page
          .waitForFunction(
            (s) => document.body.dataset.phScreen === s,
            { timeout: 8000, polling: 200 },
            screen,
          )
          .catch(() => {});
      await sleep(350);
      const text = await pageText(page);
      const got = await page.evaluate(() => document.body.dataset.phScreen);
      const bad = forbiddenFor(day, pid).filter((s) => text.includes(s));
      n += 1;
      const label = `${String(n).padStart(2, '0')}-${name}`;
      const file = path.join(OUT, `${label}.png`);
      await page.screenshot({ path: file });
      const row = {
        shot: label,
        pid,
        screen: got,
        sample: /SAMPLE/.test(text),
        leaks: bad,
        missing: contains.filter((c) => !text.includes(c)),
      };
      checks.push(row);
      must(row.sample, `${label}: no SAMPLE on screen`);
      must(!bad.length, `${label}: another person's data: ${bad.join(' | ')}`);
      must(
        !screen || got === screen,
        `${label}: screen ${got}, expected ${screen}`,
      );
      must(!row.missing.length, `${label}: missing ${row.missing.join(' | ')}`);
      shots.push({ name: label, file });
      console.log(`  ${label} · ${got}`);
    }
    const click = async (pid, act) => {
      const { page } = pages[pid];
      await page.bringToFront();
      await page.waitForSelector(`[data-act="${act}"]`, { timeout: 8000 });
      await page.click(`[data-act="${act}"]`);
      await sleep(500);
    };
    const settle = (pid, fn, arg) =>
      pages[pid].page.waitForFunction(fn, { timeout: 8000, polling: 200 }, arg);

    // ---------------------------------------------- beat 1 · KESTREL
    await loop({ type: 'beat.go', n: 1 });
    await jump('2026-10-27T16:05:10Z');
    await shot('p-kestrel', 'kestrel-push', {
      screen: 'lock',
      contains: ['Reroute · Lunch 1230L', 'Tap to accept'],
    });
    await click('p-kestrel', 'open-push-kestrel-01');
    await settle(
      'p-kestrel',
      () => globalThis.__phone.view().alerts[0].rung === 'read',
    );
    await shot('p-kestrel', 'kestrel-card', {
      screen: 'alert',
      contains: [
        'BY',
        '1215L (1715Z)',
        'VALID UNTIL',
        'VALE · SafeTrekr Watch Floor',
        'Accept',
      ],
    });
    await click('p-kestrel', 'accept');
    await settle(
      'p-kestrel',
      () => globalThis.__phone.view().alerts[0].rung === 'accepted',
    );
    await shot('p-kestrel', 'kestrel-accepted', {
      screen: 'alert',
      contains: ['Accepted'],
    });
    await shot('p-harrier', 'harrier-push', {
      screen: 'lock',
      contains: ['Inform car service · KESTREL'],
    });
    await click('p-harrier', 'open-push-kestrel-01');
    await click('p-harrier', 'informed');
    await settle(
      'p-harrier',
      () => globalThis.__phone.view().alerts[0].rung === 'accepted',
    );
    await shot('p-harrier', 'harrier-informed', { screen: 'alert' });

    // ---------------------------------------------- beat 2 · ATLAS
    await loop({ type: 'beat.go', n: 2 });
    await jump('2026-10-27T18:08:20Z');
    await shot('p-atlas6', 'atlas6-takeover', {
      screen: 'takeover',
      contains: [
        'UNCONFIRMED · F3 · SAMPLE',
        'Watch recommendation · Keynote 1930L',
      ],
    });
    await click('p-atlas6', 'open-push-atlas-01');
    await settle(
      'p-atlas6',
      () => globalThis.__phone.view().alerts[0].rung === 'read',
    );
    await shot('p-atlas6', 'atlas6-recommendation', {
      screen: 'alert',
      contains: [
        'Recommend delay departure 20 min',
        'REQUEST',
        'Concur',
        'Non-concur',
        'Executing',
        'Request support',
      ],
    });
    await jump('2026-10-27T18:11:30Z');
    await click('p-atlas3', 'salute-open');
    await shot('p-atlas3', 'atlas3-salute', {
      screen: 'sheet-salute',
      contains: ['S · SIZE', 'E · EQUIPMENT', 'File SALUTE'],
    });
    await click('p-atlas3', 'salute-send');
    await settle(
      'p-atlas3',
      () => globalThis.__phone.view().salutes.length === 1,
    );
    await shot('p-atlas3', 'atlas3-salute-filed', {
      screen: 'home',
      contains: ['HUMAN · B2'],
    });
    await click('p-atlas6', 'dl-nonconcur');
    await shot('p-atlas6', 'atlas6-nonconcur-form', {
      screen: 'alert',
      contains: [
        'REASON (ON THE RECORD)',
        'Principal informed',
        'Send non-concur',
      ],
    });
    await click('p-atlas6', 'dl-send');
    await settle('p-atlas6', () =>
      Boolean(globalThis.__phone.view().alerts[0].dl),
    );
    await jump('2026-10-27T18:16:00Z');
    await shot('p-atlas6', 'atlas6-nonconcur-sent', {
      screen: 'alert',
      contains: ['NON-CONCUR SENT', 'Acknowledged. Monitoring'],
    });

    // ---------------------------------------------- beat 3 · WREN
    await loop({ type: 'beat.go', n: 3 });
    await jump('2026-10-27T22:05:00Z');
    await shot('p-wren', 'wren-privacy', {
      screen: 'home',
      contains: ['Location sharing paused · shared at check-ins only'],
    });
    await jump('2026-10-27T22:13:00Z');
    await shot('p-wren', 'wren-sharing-request-lock', {
      screen: 'lock',
      contains: ['Watch change · today'],
    });
    const ask = await pages['p-wren'].page.evaluate(
      () => globalThis.__phone.view().messages.find((m) => m.card)?.id,
    );
    await click('p-wren', `msg-${ask}`);
    await shot('p-wren', 'wren-sharing-request', {
      screen: 'sheet-share',
      contains: [
        'Turn sharing on',
        'Not now',
        'asks you to turn location sharing on',
      ],
    });
    await click('p-wren', 'share-later');
    await jump('2026-10-27T22:29:30Z');
    await shot('p-wren', 'wren-no-read', {
      screen: 'takeover',
      contains: ['Kennedy Center · 1930L'],
    });
    await click('p-wren', 'open-push-wren-01');
    await click('p-wren', 'reply-open');
    await click('p-wren', 'reply-share');
    await shot('p-wren', 'wren-reply', {
      screen: 'sheet-reply',
      contains: ['In class, phone off', 'Turn location sharing on'],
    });
    await click('p-wren', 'reply-send');
    await settle('p-wren', () => {
      const v = globalThis.__phone.view();
      return v.alerts[0].rung === 'accepted' && v.sharing.state === 'on';
    });
    await click('p-wren', 'back');
    await shot('p-wren', 'wren-replied', {
      screen: 'home',
      contains: ['Location sharing on: watch level raised.', 'ACCEPTED'],
    });

    // ---------------------------------------------- beat 4 · SWIFT
    await loop({ type: 'beat.go', n: 4 });
    await jump('2026-10-28T00:35:30Z');
    await shot('p-swift1', 'swift-push', {
      screen: 'lock',
      contains: ['Advisory · Hotel → IAD 2030L'],
    });
    await click('p-swift1', 'open-push-swift-01');
    await shot('p-swift1', 'swift-advisory', {
      screen: 'alert',
      contains: [
        'No change',
        'Flight decision stays with crew and dispatch',
        'Check in',
      ],
    });
    await click('p-swift1', 'checkin-status');
    await settle(
      'p-swift1',
      () => globalThis.__phone.view().alerts[0].rung === 'accepted',
    );
    await shot('p-swift1', 'swift-checked-in', {
      screen: 'alert',
      contains: ['Check in on arrival'],
    });

    // ---------------------------------------------- the close
    await jump(day.end);
    await sleep(1500);
    const lv = [...room.remote.out]
      .reverse()
      .find((m) => m.t === 'loop' && m.loop);
    const c = lv ? selectCounter(lv.loop) : null;
    const counter = c
      ? [c.in, c.matched, c.raised, c.pushed, c.closed].join('·')
      : null;
    must(counter === '214·11·6·4·6', `counter at the close: ${counter}`);
    await click('p-kestrel', 'back');
    await shot('p-kestrel', 'kestrel-close', {
      screen: 'home',
      contains: ['DONE'],
    });
    const sheet = await contactSheet(browser, shots);
    const results = {
      sample: true,
      at: new Date().toISOString(),
      port: PORT,
      counter,
      shots: checks,
      errors: checks.filter((x) => x.error),
      contactSheet: path.basename(sheet),
    };
    fs.writeFileSync(
      path.join(OUT, 'results-phones.json'),
      `${JSON.stringify(results, null, 2)}\n`,
    );
    must(
      !results.errors.length,
      `page errors: ${JSON.stringify(results.errors)}`,
    );
    console.log(`counter ${counter} · ${shots.length} shots · ${OUT}`);
  } finally {
    room?.close();
    await browser?.close().catch(() => {});
    await server.stop();
    console.log('server stopped');
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
