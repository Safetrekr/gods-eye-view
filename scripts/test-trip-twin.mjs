#!/usr/bin/env node
// Trip Twin gate command (Phase CF K1; PHASE-CF-PLAN S-4, cf/06-qa.md QA-1):
//   node scripts/test-trip-twin.mjs [--names] [--json <file>] [--no-repo]
// 1. Runs every Trip Twin test (src/operations/tripTwin/**, server/tripTwin/**)
//    with node:test and prints counts per file, plus every name on --names.
// 2. Prints the Node version (the shared runner skips its allocation probes
//    off Node 24; Trip Twin tests do not depend on that).
// 3. Wiring checks: no `/api/route` in Trip Twin source (a warning until
//    CF-later L1 moves routing to /api/twin-route); no `Math.random` in the
//    relay, its limits, the session host or the client identity
//    (twinSync.js, twinIdentity.js; K4, K7). The Math.random rule is a
//    failure from K7 on (S-4, S-7).
// 4. Shared-file guard: no CF commit (on top of the CF base) touches one of
//    Justin's seven shared paths, and neither does the working tree.
// 4b. Audit canary (K6, §6.2 rule 8): the canary tests generated from the
//    audit event catalogue must be there and pass, every run. From L5 the
//    whole-folder token scan and the v1 migration with rejoin (S-14) are
//    required the same way.
// 5. Repo tests: runs the shared `npm test` runner as it is (never edits
//    it). Any failure there fails this gate too; skips are listed. --no-repo
//    leaves it out for a quick loop, and the run then says INCOMPLETE.
// Exits non-zero on any failed, skipped or todo test, a count below the
// baseline, an enforced wiring finding, a guard hit or a repo-test failure.
// Read-only: it runs git only to read history.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/**
 * 150 tests at 3431392; K1 adds three upgrade tests; K2 adds thirteen store
 * tests (twinStore.test.mjs); K3 adds eleven host-rule tables
 * (twinHosts.test.mjs) and thirteen host-check tests (twinHostCheck.test.mjs);
 * K4 adds twenty-three identity tests (twinIdentity.test.mjs); K5 adds
 * thirteen attribution tests (twinAttribution.test.mjs) and eight protocol
 * tests (twinProtocol.test.mjs); K6 adds seventeen audit and health tests
 * (twinAudit.test.mjs); K7 adds twenty-three limits, pending-socket and
 * crypto-id tests (twinLimits.test.mjs); L5 adds seven hashed-store tests
 * (twinTokens.test.mjs) and retires K2's dual-write revert test. Raise per
 * slice. K8 adds fifteen describer, chip, card-copy and status-strip tests
 * (twinDescribe.test.mjs). The voice platform's pre-V1 carry-over (review/
 * voice/PRE-V1-NOTES.md) raises it to the count at that change: K9
 * revision-checked undo (twinUndo.test.mjs), K10 server confirm
 * (twinConfirm.test.mjs) and the voice policy (twinVoice.test.mjs).
 * Fitzroy V1 adds eight voice-glue, relay, audio and dev-route tests
 * (fitzroy/fitzroyVoice.test.mjs). Fitzroy's 29 Oct round adds five
 * (fitzroy/fitzroyListen.test.mjs: the default screen, the hands-free
 * segmenter and its self-trigger mute, the relay's listening flag, the
 * dev route's new paths). Heathrow T5 and Demo C (29 Oct) add seven (the
 * site and its anchors, the scenario's placement, the other scenarios kept,
 * Demo C elsewhere, the trip demo pick, London's Day 1, the coach brief).
 */
export const BASELINE = 630;
/**
 * From K6 every gate re-runs the audit canary (PHASE-CF-PLAN §6.2 rule 8);
 * from L5 the token scan and the v1 migration (§6.6 L5 gate, S-14): these
 * tests must be found and pass, or the gate fails.
 */
export const REQUIRED_TESTS = Object.freeze([
  {
    file: 'src/operations/tripTwin/twinAudit.test.mjs',
    name: /^K6 canary \(catalogue\)/,
  },
  {
    file: 'src/operations/tripTwin/twinAudit.test.mjs',
    name: /^K6 canary \(relay run\)/,
  },
  {
    file: 'src/operations/tripTwin/twinTokens.test.mjs',
    name: /^L5 gate: the whole-folder token scan/,
  },
  {
    file: 'src/operations/tripTwin/twinTokens.test.mjs',
    name: /^L5 gate: a v1 store \(K2–K7\) migrates once/,
  },
  // K10 gate (sec S4): nothing confirm-class applies without the question.
  {
    file: 'src/operations/tripTwin/twinConfirm.test.mjs',
    name: /^K10 oracle \(sec S4\)/,
  },
]);
/** The commit CF-core branches from (cf/core). */
export const CF_BASE = process.env.TRIP_TWIN_CF_BASE || '3431392';
/** CF slice commits say so in their subject ("Trip Twin CF K1: …"). */
export const CF_SUBJECT = /^Trip Twin CF\b/;
/**
 * Wiring rules that fail the gate (S-4, S-7): Math.random from K7 on. The
 * /api/route rule stays a warning until CF-later L1 (RT-7).
 */
export const WIRING_ENFORCED = Object.freeze({
  'math-random': true,
  'api-route': false,
});

/** Justin's shared files (PHASE-CF-PLAN §1): no CF commit may touch them. */
export const SHARED_PATHS = Object.freeze([
  'server/providers/places/routes.js',
  'src/data/placeProviderPayloads.js',
  'server/providers/common/',
  'build/vite.js',
  'server/standalone/vite.config.js',
  'package.json',
  'scripts/run-unit-tests.mjs',
]);

export const isShared = (file) =>
  SHARED_PATHS.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

function walk(dir, keep, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, keep, out);
    else if (e.isFile() && keep(e.name)) out.push(abs);
  }
  return out.sort();
}

const TEST_DIRS = ['src/operations/tripTwin', 'server/tripTwin'];
export function testFiles() {
  return TEST_DIRS.flatMap((d) =>
    walk(path.join(ROOT, d), (n) => n.endsWith('.test.mjs')),
  );
}

/** Run the tests; collect one row per top-level test. */
async function runTests(files) {
  const rows = [];
  const stream = run({
    files,
    concurrency: Math.max(1, os.availableParallelism?.() ?? 4),
  });
  for await (const ev of stream) {
    if (ev.type !== 'test:pass' && ev.type !== 'test:fail') continue;
    const d = ev.data;
    if (d.nesting !== 0 || d.details?.type === 'suite') continue;
    rows.push({
      file: d.file ? rel(d.file) : '?',
      name: d.name,
      status: d.skip ? 'skip' : d.todo ? 'todo' : ev.type.slice(5),
      error:
        ev.type === 'test:fail'
          ? String(
              d.details?.error?.cause?.message ||
                d.details?.error?.message ||
                '',
            )
              .split('\n')[0]
              .slice(0, 200)
          : undefined,
    });
  }
  return rows;
}

/** Drop comments so a note about a rule does not trip the rule. */
const code = (src) =>
  src
    // Keep the line breaks of a block comment so line numbers stay true.
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

export function wiringFindings() {
  const found = [];
  const source = [
    ...walk(
      path.join(ROOT, 'src/operations/tripTwin'),
      (n) => /\.(m?js)$/.test(n) && !/\.test\.mjs$|^twinTestKit\.mjs$/.test(n),
    ),
    ...walk(
      path.join(ROOT, 'server/tripTwin'),
      (n) => /\.(m?js)$/.test(n) && !n.endsWith('.test.mjs'),
    ),
    path.join(ROOT, 'twin.html'),
    path.join(ROOT, 'twin-remote.html'),
  ];
  for (const f of source) {
    let text = '';
    try {
      text = code(readFileSync(f, 'utf8'));
    } catch {
      continue;
    }
    text.split('\n').forEach((line, i) => {
      if (/\/api\/route(?![\w-])/.test(line))
        found.push({
          id: 'api-route',
          rule: 'no shared /api/route in Trip Twin source (RT-7: use /api/twin-route)',
          at: `${rel(f)}:${i + 1}`,
        });
    });
  }
  for (const f of [
    'server/tripTwin/syncRelay.js',
    'server/tripTwin/twinLimits.js',
    'src/operations/tripTwin/twinSessionHost.js',
    'src/operations/tripTwin/twinSync.js',
    'src/operations/tripTwin/twinIdentity.js',
  ]) {
    let text = '';
    try {
      text = code(readFileSync(path.join(ROOT, f), 'utf8'));
    } catch {
      continue;
    }
    text.split('\n').forEach((line, i) => {
      if (/\bMath\.random\b/.test(line))
        found.push({
          id: 'math-random',
          rule: 'no Math.random in the relay, the session host or the client identity (S-7: crypto ids)',
          at: `${f}:${i + 1}`,
        });
    });
  }
  return found;
}

const git = (...a) => {
  const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  return {
    ok: r.status === 0,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim(),
  };
};

/** Hits of the shared-file guard, plus what it looked at. */
export function sharedGuard(base = CF_BASE) {
  const hits = [];
  const notes = [];
  if (!git('rev-parse', '--git-dir').ok)
    return { hits: [`not a git checkout: ${ROOT}`], notes, checked: 0 };
  if (!git('merge-base', '--is-ancestor', base, 'HEAD').ok)
    return {
      hits: [`CF base ${base} is not an ancestor of HEAD`],
      notes,
      checked: 0,
    };
  const shas = git('rev-list', '--no-merges', '--reverse', `${base}..HEAD`)
    .out.split('\n')
    .filter(Boolean);
  let checked = 0;
  for (const sha of shas) {
    const subject = git('log', '-1', '--format=%s', sha).out;
    if (!CF_SUBJECT.test(subject)) {
      notes.push(
        `${sha.slice(0, 7)} not a CF slice, not guarded: ${subject.slice(0, 70)}`,
      );
      continue;
    }
    checked += 1;
    const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', sha)
      .out.split('\n')
      .filter(Boolean);
    for (const f of files.filter(isShared))
      hits.push(`${sha.slice(0, 7)} touches ${f} (${subject.slice(0, 50)})`);
  }
  // What is about to be committed counts too.
  const status = git('status', '--porcelain', '--untracked-files=no').out;
  for (const line of status.split('\n').filter(Boolean)) {
    const file = line.slice(3).split(' -> ').pop();
    if (isShared(file))
      hits.push(`working tree changes ${file} (${line.slice(0, 2).trim()})`);
  }
  return { hits, notes, checked, total: shas.length };
}

/** The shared runner, run as `npm test` runs it; TAP summary parsed. */
export function repoTests() {
  const r = spawnSync(process.execPath, ['scripts/run-unit-tests.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const num = (k) => {
    const m = new RegExp(`^# ${k} (\\d+)$`, 'm').exec(out);
    return m ? Number(m[1]) : null;
  };
  const names = (re) => [...out.matchAll(re)].map((m) => m[1].trim());
  return {
    exit: r.status ?? 1,
    tests: num('tests'),
    pass: num('pass'),
    fail: num('fail'),
    skipped: num('skipped'),
    todo: num('todo'),
    failed: names(/^not ok \d+ - (.*)$/gm),
    skippedNames: names(/^ok \d+ - (.*) # SKIP/gm),
    allocationSkip: /\[unit\] SKIPPED (.*?):/.exec(out)?.[0] || null,
  };
}

async function main() {
  const t0 = Date.now();
  const head = git('rev-parse', '--short', 'HEAD').out || '?';
  console.log(
    `Trip Twin gate · ${head} · Node ${process.versions.node} · ${new Date().toISOString()}`,
  );
  const files = testFiles();
  const rows = await runTests(files);
  const by = (s) => rows.filter((r) => r.status === s);
  const [pass, fail, skip, todo] = ['pass', 'fail', 'skip', 'todo'].map(by);
  let failed = false;

  console.log(`\nTests · ${files.length} files`);
  const perFile = new Map();
  for (const r of rows) perFile.set(r.file, (perFile.get(r.file) || 0) + 1);
  for (const f of files.map(rel))
    console.log(`  ${String(perFile.get(f) || 0).padStart(3)}  ${f}`);
  if (flag('names'))
    for (const r of rows) console.log(`  [${r.status}] ${r.file} › ${r.name}`);
  const dupes = rows
    .map((r) => `${r.file} › ${r.name}`)
    .filter((k, i, a) => a.indexOf(k) !== i);
  for (const d of new Set(dupes))
    console.log(`  WARN duplicate test name: ${d}`);
  console.log(
    `  total ${rows.length} · pass ${pass.length} · fail ${fail.length} · skip ${skip.length} · todo ${todo.length} · baseline ${BASELINE}`,
  );
  for (const r of [...fail, ...skip, ...todo]) {
    console.log(
      `  ${r.status.toUpperCase()} ${r.file} › ${r.name}${r.error ? ` — ${r.error}` : ''}`,
    );
    failed = true;
  }
  if (rows.length < BASELINE) {
    console.log(
      `  FAIL ${rows.length} tests, fewer than the baseline ${BASELINE}`,
    );
    failed = true;
  }

  console.log(
    '\nRequired every run · audit canary (K6) · token scan and v1 migration (L5)',
  );
  for (const req of REQUIRED_TESTS) {
    const hit = rows.find((r) => r.file === req.file && req.name.test(r.name));
    const ok = hit?.status === 'pass';
    console.log(
      `  ${ok ? 'pass' : 'FAIL'} ${req.file} › ${hit ? hit.name : `${req.name} (not found)`}`,
    );
    if (!ok) failed = true;
  }

  const wiring = wiringFindings();
  console.log(
    '\nWiring checks · Math.random ENFORCED (K7) · /api/route warnings until L1',
  );
  for (const [id, on] of Object.entries(WIRING_ENFORCED))
    if (!wiring.some((w) => w.id === id))
      console.log(`  clean ${id}${on ? ' (enforced)' : ''}`);
  for (const w of wiring) {
    const on = WIRING_ENFORCED[w.id] === true;
    console.log(`  ${on ? 'FAIL' : 'WARN'} ${w.at} — ${w.rule}`);
    if (on) failed = true;
  }

  const guard = sharedGuard();
  console.log(
    `\nShared-file guard · base ${CF_BASE} · ${guard.checked} CF commit(s) checked${guard.total != null ? ` of ${guard.total}` : ''} · working tree`,
  );
  for (const n of guard.notes) console.log(`  note ${n}`);
  if (!guard.hits.length) console.log('  clean');
  for (const h of guard.hits) console.log(`  FAIL ${h}`);
  if (guard.hits.length) failed = true;

  const repo = flag('no-repo') ? null : repoTests();
  console.log(
    '\nRepo tests · npm test (scripts/run-unit-tests.mjs, unchanged)',
  );
  if (!repo) console.log('  not run (--no-repo): this gate run is INCOMPLETE');
  else {
    console.log(
      `  exit ${repo.exit} · tests ${repo.tests ?? '?'} · pass ${repo.pass ?? '?'} · fail ${repo.fail ?? '?'} · skipped ${repo.skipped ?? '?'} · todo ${repo.todo ?? '?'}`,
    );
    for (const n of repo.failed) console.log(`  FAIL ${n}`);
    for (const n of repo.skippedNames) console.log(`  skip ${n}`);
    if (repo.allocationSkip) console.log(`  note ${repo.allocationSkip}`);
    if (repo.exit !== 0 || repo.fail) failed = true;
  }

  const jsonOut = value('json');
  if (jsonOut)
    writeFileSync(
      jsonOut,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          commit: head,
          node: process.versions.node,
          counts: {
            total: rows.length,
            pass: pass.length,
            fail: fail.length,
            skip: skip.length,
            todo: todo.length,
          },
          baseline: BASELINE,
          tests: rows,
          wiring,
          guard,
          repo,
        },
        null,
        2,
      ),
    );
  console.log(
    `\n${failed ? 'FAIL' : 'PASS'} · ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
  return failed ? 1 : 0;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) process.exitCode = await main();
