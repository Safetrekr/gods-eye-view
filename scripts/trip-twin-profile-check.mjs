#!/usr/bin/env node
// The school Trip Twin stays byte-identical to trip-twin-clean-2026-10-27
// while SafeTrekr Executive is built beside it (EP-35 §6, EP-50).
//   node scripts/trip-twin-profile-check.mjs           rebuild and compare
//   node scripts/trip-twin-profile-check.mjs --record  write the hashes (HEAD must be the tag)
// 1. Builds the school twin (`vite build --config vite.twin.config.js`) into
//    a temporary folder, never dist/, and compares sha256 of twin.html and
//    assets/twin-*.js with products/school/BUILD-HASHES.json.
// 2. Walks the import graph of twin.html and twin-remote.html and fails if
//    any module on it lives under products/executive/.
// Read-only towards git (rev-parse, status); removes its temporary folder.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleImports } from './module-analysis.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HASHES =
  'src/operations/tripTwin/products/school/BUILD-HASHES.json';
export const TAG = 'trip-twin-clean-2026-10-27';
export const ENTRIES = ['twin.html', 'twin-remote.html'];
export const FORBIDDEN = 'src/operations/tripTwin/products/executive/';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const git = (...a) => {
  const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

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

/** Build the school twin into a temporary folder; sha256 of the pinned files. */
export function buildHashes(root = ROOT) {
  const out = mkdtempSync(path.join(os.tmpdir(), 'trip-twin-profile-'));
  try {
    const vite = path.join(root, 'node_modules/vite/bin/vite.js');
    const r = spawnSync(
      process.execPath,
      [
        vite,
        'build',
        '--config',
        'vite.twin.config.js',
        '--outDir',
        out,
        '--emptyOutDir',
        '--logLevel',
        'warn',
      ],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    if (r.status !== 0)
      throw new Error(
        `school twin build failed:\n${(r.stderr || r.stdout || '').slice(-2000)}`,
      );
    const files = {
      'twin.html': sha256(readFileSync(path.join(out, 'twin.html'))),
    };
    for (const f of readdirSync(path.join(out, 'assets')).sort())
      if (/^twin-[^.]+\.js$/.test(f))
        files[`assets/${f}`] = sha256(
          readFileSync(path.join(out, 'assets', f)),
        );
    if (Object.keys(files).length < 2)
      throw new Error('no assets/twin-*.js in the build');
    return files;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function main() {
  const record = process.argv.includes('--record');
  let failed = false;
  const graph = twinGraph();
  const leaks = graph.filter((f) => f.startsWith(FORBIDDEN));
  console.log(`Import graph · ${ENTRIES.join(', ')} · ${graph.length} modules`);
  if (leaks.length) {
    failed = true;
    for (const f of leaks) console.log(`  FAIL ${f} is on the school graph`);
  } else console.log(`  clean: nothing under ${FORBIDDEN}`);

  if (record) {
    const head = git('rev-parse', 'HEAD');
    const tag = git('rev-parse', `${TAG}^{commit}`);
    if (!head || head !== tag) {
      console.error(`--record needs HEAD = ${TAG} (HEAD ${head}, tag ${tag})`);
      return 1;
    }
    const dirty = git(
      'status',
      '--porcelain',
      '--',
      'vite.twin.config.js',
      ...ENTRIES,
      ...graph,
    );
    if (dirty) {
      console.error(
        `--record needs the school graph unchanged from the tag:\n${dirty}`,
      );
      return 1;
    }
    const files = buildHashes();
    const doc = {
      note: 'sha256 of the school Trip Twin build at the clean tag; scripts/trip-twin-profile-check.mjs rebuilds and compares.',
      tag: TAG,
      commit: tag,
      built_with: {
        node: process.versions.node,
        command: 'vite build --config vite.twin.config.js',
      },
      files,
    };
    writeFileSync(path.join(ROOT, HASHES), `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`wrote ${HASHES}`);
    for (const [f, h] of Object.entries(files)) console.log(`  ${h}  ${f}`);
    return failed ? 1 : 0;
  }

  const want = JSON.parse(readFileSync(path.join(ROOT, HASHES), 'utf8'));
  const got = buildHashes();
  console.log(
    `School build · against ${want.tag} (${String(want.commit).slice(0, 8)})`,
  );
  const names = [
    ...new Set([...Object.keys(want.files), ...Object.keys(got)]),
  ].sort();
  for (const n of names) {
    const ok = want.files[n] && want.files[n] === got[n];
    if (!ok) failed = true;
    console.log(
      `  ${ok ? 'same' : 'DIFF'} ${n}${ok ? '' : ` · recorded ${want.files[n] || '—'} · built ${got[n] || '—'}`}`,
    );
  }
  console.log(
    failed ? 'FAIL' : 'PASS · the school twin is byte-identical to the tag',
  );
  return failed ? 1 : 0;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) process.exitCode = main();
