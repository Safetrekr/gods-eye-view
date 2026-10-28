#!/usr/bin/env node
// SafeTrekr Executive never changes the school Trip Twin's bytes (EP-35 §6,
// EP-50). The rule, from 28 Oct 2026 (review/voice/PRE-V1-NOTES.md):
//
//   The school build of HEAD must be byte-identical to the school build of
//   the same tree with products/executive/ taken out of its source graph.
//   School changes are allowed; executive code reaching a school byte is
//   not.
//
// Until then the school build was pinned to tag trip-twin-clean-2026-10-27
// (products/school/BUILD-HASHES.json). That proved the executive work left
// school bytes alone while no school change was intended; intentional
// school changes (the voice platform's pre-V1 work) began after it, so the
// pin and its --record mode are retired. Three checks:
//   1. Import graph (unchanged): no module on twin.html's or
//      twin-remote.html's graph lives under products/executive/.
//   2. No flag: no module on that graph names the executive product flag
//      (TRIP_TWIN_PRODUCT) or the executive folder, so no executive branch
//      can sit in school code waiting for a flag.
//   3. Out-of-graph proof: the working tree (tracked and untracked files,
//      as they are on disk) is copied to a temporary folder and built twice
//      with the school config and no product flag: once as is, and once
//      with the executive pages (twin-executive*.html, twin-phone.html)
//      deleted and EVERY file under products/executive/ changed by a random
//      probe that no bundler may drop (a `globalThis` write in each module,
//      a rule in each stylesheet, a key in each JSON file). Every output
//      file (twin.html, twin-remote.html, index.html and every asset) must
//      hash the same in both, and the probe must appear in none. If any
//      executive byte reached the school build, its bytes would change.
//      (The folder is changed rather than deleted because the dev server's
//      config bundles syncRelay.js, whose executive seam — loaded only
//      under TRIP_TWIN_PRODUCT=executive — names loopHost.js; that seam is
//      server-only and never in a school byte.)
//   node scripts/trip-twin-profile-check.mjs        run the three checks
//   node scripts/trip-twin-profile-check.mjs --graph checks 1 and 2 only
// Read-only towards the repo and git (ls-files); removes its temporary
// folder; never writes dist/.
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleImports } from './module-analysis.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENTRIES = ['twin.html', 'twin-remote.html'];
export const FORBIDDEN = 'src/operations/tripTwin/products/executive/';
/** Executive pages at the repo root (built only under the flag). */
export const EXECUTIVE_PAGES = /^twin-(?:executive[\w-]*|phone)\.html$/;
/** Words a school module may not hold (check 2). */
export const FLAG_WORDS = Object.freeze([
  'TRIP_TWIN_PRODUCT',
  'products/executive',
]);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Every repo module reachable from the HTML entries (static + literal dynamic imports). */
export function twinGraph(root = ROOT) {
  const seen = new Set();
  const queue = [];
  for (const html of ENTRIES) {
    const text = readFileSync(path.join(root, html), 'utf8');
    for (const m of text.matchAll(
      /<script[^>]*type="module"[^>]*src="([^"]+)"/g,
    ))
      queue.push(path.join(root, m[1].replace(/^\//, '')));
  }
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file) || !/\.[cm]?js$/.test(file) || !existsSync(file))
      continue;
    seen.add(file);
    let specs = [];
    try {
      specs = moduleImports(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const s of specs) {
      if (!s.startsWith('.') && !s.startsWith('/')) continue;
      const target = s.startsWith('/')
        ? path.join(root, s.split('?')[0])
        : path.resolve(path.dirname(file), s.split('?')[0]);
      queue.push(target);
    }
  }
  return [...seen]
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .sort();
}

/** Modules on the school graph that name the executive flag or folder. */
export function flagHits(graph, root = ROOT) {
  const out = [];
  for (const f of graph) {
    let text = '';
    try {
      text = readFileSync(path.join(root, f), 'utf8');
    } catch {
      continue;
    }
    for (const w of FLAG_WORDS) if (text.includes(w)) out.push(`${f}: ${w}`);
  }
  return out;
}

/** Tracked and untracked (not ignored) files, as git lists them. */
function treeFiles(root) {
  const r = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  return [...new Set(r.stdout.split('\0').filter(Boolean))];
}

/** Copy the working tree into `dest` (node_modules linked, not copied). */
export function copyTree(root, dest) {
  let n = 0;
  for (const rel of treeFiles(root)) {
    const from = path.join(root, rel);
    let st;
    try {
      st = statSync(from);
    } catch {
      continue; // deleted in the working tree
    }
    if (!st.isFile()) continue;
    const to = path.join(dest, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    n += 1;
  }
  symlinkSync(path.join(root, 'node_modules'), path.join(dest, 'node_modules'));
  return n;
}

/**
 * Take the executive product out of a copied tree's source graph: delete
 * its pages, and change every file under products/executive/ with `probe`
 * (kept by any bundler that includes the file). Returns {pages, probed}.
 */
export function probeExecutive(dir, probe) {
  const pages = [];
  for (const f of readdirSync(dir))
    if (EXECUTIVE_PAGES.test(f)) {
      rmSync(path.join(dir, f), { force: true });
      pages.push(f);
    }
  let probed = 0;
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      const text = readFileSync(abs, 'utf8');
      let next = null;
      if (/\.[cm]?js$/.test(e.name))
        next = `${text}\n;globalThis[${JSON.stringify(probe)}] = ${JSON.stringify(`${probe}:${e.name}`)};\n`;
      else if (e.name.endsWith('.css'))
        next = `${text}\n.${probe} { --${probe}: 1; }\n`;
      else if (e.name.endsWith('.json')) {
        const v = JSON.parse(text);
        next = JSON.stringify(
          v && typeof v === 'object' && !Array.isArray(v)
            ? { ...v, [probe]: probe }
            : { [probe]: v },
        );
      } else next = `${text}\n${probe}\n`;
      writeFileSync(abs, next);
      probed += 1;
    }
  };
  walk(path.join(dir, FORBIDDEN));
  return { pages, probed };
}

/** Every file under `dir`, relative, with its sha256. */
export function hashTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile())
        out[path.relative(dir, abs).split(path.sep).join('/')] = sha256(
          readFileSync(abs),
        );
    }
  };
  walk(dir);
  return Object.fromEntries(
    Object.keys(out)
      .sort()
      .map((k) => [k, out[k]]),
  );
}

/** The school build of `src` into `out` (no product flag). */
export function schoolBuild(src, out) {
  const env = { ...process.env };
  delete env.TRIP_TWIN_PRODUCT;
  const r = spawnSync(
    process.execPath,
    [
      path.join(src, 'node_modules/vite/bin/vite.js'),
      'build',
      '--config',
      'vite.twin.config.js',
      '--outDir',
      out,
      '--emptyOutDir',
      '--logLevel',
      'warn',
    ],
    { cwd: src, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0)
    throw new Error(
      `school build failed in ${path.basename(src)}:\n${(r.stderr || r.stdout || '').slice(-2000)}`,
    );
  return hashTree(out);
}

/** Two hash maps → [{file, a, b}] where they differ (or one is missing). */
export function diffHashes(a, b) {
  const out = [];
  for (const f of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort())
    if (a[f] !== b[f]) out.push({ file: f, a: a[f] || null, b: b[f] || null });
  return out;
}

function main() {
  let failed = false;
  const graph = twinGraph();
  const leaks = graph.filter((f) => f.startsWith(FORBIDDEN));
  console.log(
    `1 · Import graph · ${ENTRIES.join(', ')} · ${graph.length} modules`,
  );
  if (leaks.length) {
    failed = true;
    for (const f of leaks) console.log(`  FAIL ${f} is on the school graph`);
  } else console.log(`  clean: nothing under ${FORBIDDEN}`);
  const flags = flagHits(graph);
  console.log(`2 · No executive flag in school modules`);
  if (flags.length) {
    failed = true;
    for (const f of flags) console.log(`  FAIL ${f}`);
  } else console.log(`  clean: no module names ${FLAG_WORDS.join(' or ')}`);
  if (process.argv.includes('--graph')) {
    console.log(failed ? 'FAIL' : 'PASS (graph checks only)');
    return failed ? 1 : 0;
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'trip-twin-profile-'));
  try {
    const src = path.join(tmp, 'tree');
    mkdirSync(src);
    const n = copyTree(ROOT, src);
    const a = schoolBuild(src, path.join(tmp, 'with'));
    const probe = `ttExecProbe${randomBytes(6).toString('hex')}`;
    const { pages, probed } = probeExecutive(src, probe);
    let b = null;
    let error = null;
    try {
      b = schoolBuild(src, path.join(tmp, 'without'));
    } catch (e) {
      error = e;
    }
    console.log(
      `3 · School build with and without the executive product · ${n} files copied · ${probed} executive files probed · ${pages.length} executive pages removed`,
    );
    if (error) {
      failed = true;
      console.log(
        `  FAIL the school build needs the executive product:\n${error.message}`,
      );
    } else {
      const d = diffHashes(a, b);
      const files = Object.keys(a).length;
      // The probe in any output byte is a leak, whatever the hashes say.
      const seen = Object.keys(b).filter((f) =>
        readFileSync(path.join(tmp, 'without', f)).includes(probe),
      );
      for (const f of seen) {
        failed = true;
        console.log(`  FAIL the executive probe is in ${f}`);
      }
      if (d.length) {
        failed = true;
        for (const x of d)
          console.log(
            `  DIFF ${x.file} · with ${x.a || '—'} · without ${x.b || '—'}`,
          );
      } else
        console.log(
          `  same: ${files} files (${ENTRIES.join(', ')}, index.html, every asset)`,
        );
      for (const f of ['twin.html', 'twin-remote.html'])
        if (a[f]) console.log(`  ${a[f]}  ${f}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(
    failed
      ? 'FAIL'
      : 'PASS · no executive byte reaches the school build (the same with products/executive/ taken out of its source graph)',
  );
  return failed ? 1 : 0;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) process.exitCode = main();
