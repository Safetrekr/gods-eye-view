#!/usr/bin/env node
// SafeTrekr Executive B6: the day's record, headless.
//   node scripts/qa-executive-record.mjs --dir <fresh scratch folder>
//     [--out <folder>] [--settle 20000]
// Reuses qa-executive-walls.mjs's server and room (imported, not edited).
// Port 4194 only (strict: refuses if busy). TRIP_TWIN_DATA_DIR,
// TRIP_TWIN_AUDIT_DIR and TMPDIR sit in --dir, which must not exist yet.
// Runs the day to 0100Z (paused), then saves into <out>:
//   beat5-record-wall.png   the Verify wall at beat 5: ATLAS's record opens
//   beat5-desk-record.png   the desk's Record card (K) on ATLAS
//   beat5-desk-day.png      the desk's day record (K, nothing selected)
//   leave-behind.pdf        twin-executive-record.html, A4, Chrome page.pdf
//   leave-behind-letter.pdf the same on US Letter
//   leave-behind-pN.png     its first pages, the ATLAS page and the
//                           white-label sheet, as printed (print media)
//   results-record.json
// Checks: SAMPLE shown; the wall carries callsigns only (no roster name)
// and the access log; nowhere "no one else"; the counter 214·11·6·4·6
// reconciled; the PDF has one page per section (cover, six situations,
// the summary, the white label), no section overflows its page, on A4
// and on Letter; ?source=script prints the same counter with no relay.
// The server is stopped at the end (and on any exit).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { openRoom, startExecServer } from './qa-executive-walls.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d = null) =>
  argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// --port (B7: one isolated port for every capture), else the default.
const PORT = Number(arg('port', 4194));
const OUT = path.resolve(
  arg('out') ||
    path.join(ROOT, '..', 'plans', 'trip-twin', 'executive', 'review', 'b6'),
);
const DIR = arg('dir') ? path.resolve(arg('dir')) : null;
const END = '2026-10-28T01:00:00Z';
const COUNTER = '214·11·6·4·6';
const FLAGS = [
  '--enable-webgl',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

async function visibleText(page) {
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
const pdfPages = (file) =>
  (fs.readFileSync(file, 'latin1').match(/\/Type\s*\/Page(?![s\w])/g) || [])
    .length;

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
  const NAMES = [
    ...Object.values(day.people).map((p) => p.name),
    ...day.watch.staff.map((s) => s.name),
  ].filter(Boolean);
  console.log(`executive server on :${PORT} · scratch ${DIR}`);
  const server = await startExecServer({ dir: DIR, port: PORT });
  const base = server.url;
  const results = [];
  const note = (name, checks, extra = {}) => {
    const ok = Object.values(checks).every(Boolean);
    results.push({ name, ok, checks, ...extra });
    const failed = Object.entries(checks)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'} ${name}${failed.length ? ` · failed: ${failed.join(', ')}` : ''}`,
    );
  };
  let browser = null;
  let room = null;
  try {
    room = await openRoom(base);
    const a = await room.cmd({
      type: 'screens',
      target: 2,
      patch: { role: 'trips' },
    });
    must(a.ok !== false, `role on S2: ${a.error || a.code}`);
    const r = await room.loop({ type: 'wall.role', slot: 2, role: 'verify' });
    must(r.ok, `wall.role verify on S2: ${r.code || r.error}`);
    browser = await puppeteer.launch({ headless: true, args: FLAGS });
    const open = async (url, viewport = { width: 1920, height: 1080 }) => {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      page.setDefaultNavigationTimeout(180000);
      await page.setViewport(viewport);
      page.on('pageerror', (e) =>
        console.log(
          `  page error ${url.slice(0, 40)}: ${String(e?.message || e).slice(0, 200)}`,
        ),
      );
      await page.goto(`${base}${url}`, { waitUntil: 'domcontentloaded' });
      return page;
    };
    const wall = await open(
      `/twin-executive.html?view=screen&slot=2&setup=${room.setup}&city=austin&scenario=baseline`,
    );
    await wall.waitForFunction(
      () => document.body.dataset.exRole === 'verify',
      {
        timeout: 180000,
      },
    );
    const desk = await open('/twin-executive.html?as=desk');
    await sleep(Number(arg('settle', 20000)));

    // The day to its close, paused.
    await room.loop({ type: 'clock.pause' });
    let j = await room.loop({ type: 'clock.jump', to: END });
    if (!j.ok && j.code === 'I12_TIME') {
      const ask = await room.loop({ type: 'reset' });
      if (ask.ask) await room.loop({ type: 'confirm', id: ask.ask.id });
      j = await room.loop({ type: 'clock.jump', to: END });
    }
    must(j.ok !== false, `clock.jump: ${j.code || j.error}`);

    // 1. The Verify wall at beat 5: ATLAS's record opens.
    await wall.waitForFunction(
      () => document.body.dataset.exRecord === 's-atlas-01',
      { timeout: 60000 },
    );
    await sleep(3000);
    await wall.screenshot({ path: path.join(OUT, 'beat5-record-wall.png') });
    const wt = await visibleText(wall);
    const wallFit = await wall.evaluate(() => {
      const c = document.querySelector('.ex-rc-card');
      return c ? c.scrollHeight <= c.clientHeight + 2 : false;
    });
    note('beat 5 · the record on the Verify wall', {
      sample: /\bSAMPLE\b/.test(wt),
      title: /RECORD · ATLAS · 27 OCT 26 · SAMPLE/.test(wt),
      counter: /214/.test(wt) && /Matches the close counter/.test(wt),
      twoPerson: /ORTEGA 1806Z/.test(wt),
      salute: /SALUTE · HUMAN · ATLAS 3/.test(wt),
      nonConcur: /DL: NON-CONCUR/.test(wt),
      standDown: /STAND-DOWN ATLAS 6 2105Z/.test(wt),
      sitrep: /SITREP ATLAS · s-atlas-01 · 272109Z OCT 26/.test(wt),
      accessLog: /ACCESS LOG/.test(wt) && /OSPREY/.test(wt),
      disclosures: /Local police · outside/.test(wt),
      retention: /legal hold on request \(SAMPLE policy\)/.test(wt),
      callsignsOnly: NAMES.every((n) => !wt.includes(n)),
      noOverclaim: !/no one else/i.test(wt),
      fits: wallFit,
      // B7: the wall says Record; the lead is labelled, not "opened".
      recordLabel: await wall.evaluate(
        () => document.querySelector('.ex-role')?.textContent === 'Record',
      ),
      viewerLabel: /OSPREY · viewing/.test(wt) && !/OSPREY · opened/.test(wt),
      seenBy: /SEEN BY/.test(wt),
    });

    // 2. The desk: the Record card (K) on ATLAS, then the day (K, none).
    await desk.waitForFunction(
      (c) => document.body.dataset.exCounter === c,
      { timeout: 60000 },
      COUNTER,
    );
    await desk.click('[data-sit="s-atlas-01"]');
    await desk.keyboard.press('k');
    await desk.waitForSelector('#dk-record-slot .rc-sit', { timeout: 15000 });
    await sleep(800);
    await desk.screenshot({ path: path.join(OUT, 'beat5-desk-record.png') });
    const dt = await visibleText(desk);
    note('desk · Record card (K) on ATLAS', {
      sample: /\bSAMPLE\b/.test(dt),
      name: dt.includes(day.people['p-atlas'].name),
      slots: [
        'RAISED',
        'VERIFIED',
        'COUNTERSIGNED',
        'FIELD',
        'ANSWER',
        'LADDER',
        'CLOSED',
      ].every((k) => dt.includes(k)),
      accessLog: /ACCESS LOG/.test(dt),
      // B7 #14, #8: the lead labelled; the DETAIL recommendation, no ACTION.
      viewer: /OSPREY \(your security lead\) · viewing/.test(dt),
      dlReply:
        /REPLY Concur \/ Non-concur \/ Executing \/ Request support/.test(dt),
      noHoldOrder: !/HOLD \+ REROUTE/.test(dt),
      timeline: /TIMELINE · Z first, local beside/.test(dt),
      noOverclaim: !/no one else/i.test(dt),
    });
    await desk.keyboard.press('Escape');
    await desk.keyboard.press('Escape');
    await desk.keyboard.press('k');
    await desk.waitForSelector('.dk-main .rc-summary', { timeout: 15000 });
    await sleep(500);
    await desk.screenshot({ path: path.join(OUT, 'beat5-desk-day.png') });
    const dd = await visibleText(desk);
    note('desk · the day record (K, nothing selected)', {
      counter: /Matches the close counter/.test(dd) && /214/.test(dd),
      daily: /Signed VALE 280100Z OCT 26/.test(dd),
      noOverclaim: !/no one else/i.test(dd),
    });

    // 3. The leave-behind, from the live loop (this computer's monitor).
    const printed = [];
    for (const paper of ['a4', 'letter']) {
      const pr = await open(
        `/twin-executive-record.html${paper === 'letter' ? '?paper=letter' : ''}`,
        { width: 1100, height: 1400 },
      );
      await pr.waitForFunction(
        (c) =>
          document.body.dataset.recordReady === '1' &&
          document.body.dataset.recordCounter === c,
        { timeout: 60000 },
        COUNTER,
      );
      await pr.evaluate(() => document.fonts?.ready);
      await sleep(1500);
      await pr.emulateMediaType('print');
      const facts = await pr.evaluate(() => ({
        sections: document.querySelectorAll('section.pg').length,
        overflow: [...document.querySelectorAll('section.pg')]
          .map((s, i) => {
            const body = s.querySelector('.pg-body');
            const foot = s.querySelector('.pg-foot');
            const last = body?.lastElementChild;
            const bottom = last ? last.getBoundingClientRect().bottom : 0;
            const limit = foot ? foot.getBoundingClientRect().top : Infinity;
            return bottom > limit + 1 ? i + 1 : null;
          })
          .filter(Boolean),
        footers: [...document.querySelectorAll('section.pg .pg-foot')].every(
          (f) => /SAMPLE\./.test(f.textContent),
        ),
        reconciled: document.body.dataset.recordReconciled === 'true',
      }));
      const text = await visibleText(pr);
      const cover = await pr.evaluate(
        () => document.querySelector('section.pg')?.textContent || '',
      );
      const white = await pr.evaluate(
        () => document.querySelector('section.pg-white')?.textContent || '',
      );
      const file = path.join(
        OUT,
        paper === 'a4' ? 'leave-behind.pdf' : 'leave-behind-letter.pdf',
      );
      await pr.pdf({
        path: file,
        preferCSSPageSize: true,
        printBackground: true,
      });
      const pages = pdfPages(file);
      printed.push({ paper, pages, ...facts });
      note(
        `leave-behind · ${paper}`,
        {
          nineSections: facts.sections === 9,
          onePagePerSection: pages === facts.sections,
          noOverflow: facts.overflow.length === 0,
          sampleFooterEveryPage: facts.footers,
          reconciled: facts.reconciled,
          whiteLabel:
            /\[Your family office\] Watch Floor/.test(text) &&
            /Operated with SafeTrekr/.test(text),
          ask: text.includes(
            "We'd like a conversation with your head of security",
          ),
          noOverclaim: !/no one else/i.test(text),
          zFirst: /1803Z \(1803L\)/.test(text),
          // B7 #16 and #10.
          askOnCover:
            cover.includes("We'd like a conversation") &&
            cover.includes('mike@safetrekr.com · 903.805.9225'),
          askOnWhiteLabel:
            white.includes("We'd like a conversation") &&
            white.includes('mike@safetrekr.com · 903.805.9225'),
          pilot: /THE TWO-WEEK PILOT/.test(white),
          noBuildNotes:
            !/Counted from this record/.test(cover) &&
            !/from the live loop/.test(cover),
          noPlaceholders:
            !/\[price\]|\[contact name\]|\[number\]|\[your SafeTrekr contact\]|\[INSERT\]/i.test(
              text,
            ),
          noPrice: !/\bprice\b|pricing/i.test(text),
          officialText:
            !/oi-austin-road-closure-01/.test(text) &&
            /OFFICIAL Road closure · W Riverside Dr/.test(text),
          noDraftedSystem: !/drafted system|drafted by system/.test(text),
        },
        { pages, overflow: facts.overflow },
      );
      if (paper === 'a4') {
        // The first pages, the ATLAS page and the white label, as printed.
        const n = facts.sections;
        const atlas = await pr.evaluate(
          () =>
            [...document.querySelectorAll('section.pg')].findIndex((s) =>
              s.textContent.includes('s-atlas-01 · raised'),
            ) + 1,
        );
        for (const i of [...new Set([1, 2, 3, atlas, n - 1, n])]) {
          const el = (await pr.$$('section.pg'))[i - 1];
          if (el)
            await el.screenshot({
              path: path.join(OUT, `leave-behind-p${i}.png`),
            });
        }
      }
      await pr.browserContext().close();
    }

    // 4. With no relay: the scripted day folded in the page, same counter.
    const sp = await open('/twin-executive-record.html?source=script', {
      width: 1100,
      height: 1400,
    });
    await sp.waitForFunction(() => document.body.dataset.recordReady === '1', {
      timeout: 120000,
    });
    const sc = await sp.evaluate(() => document.body.dataset.recordCounter);
    note('leave-behind · ?source=script', { counter: sc === COUNTER });

    fs.writeFileSync(
      path.join(OUT, 'results-record.json'),
      `${JSON.stringify({ at: new Date().toISOString(), port: PORT, results, printed }, null, 1)}\n`,
    );
  } finally {
    if (browser) await browser.close();
    room?.close();
    await server.stop();
    console.log('server stopped');
  }
  const failed = results.filter((r) => !r.ok);
  console.log(
    `${results.length - failed.length}/${results.length} checks pass`,
  );
  process.exitCode = failed.length ? 1 : 0;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) await main();
