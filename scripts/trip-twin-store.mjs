#!/usr/bin/env node
// Trip Twin store, by hand (Phase CF L5; PHASE-CF-PLAN S-14, SEC-6):
//   node scripts/trip-twin-store.mjs scan [--keep-plain-copy]
//   node scripts/trip-twin-store.mjs drop-plain-copy
// The data folder is TRIP_TWIN_DATA_DIR, else Application Support (as the
// relay resolves it); the old tmp-path store is the one in os.tmpdir() of
// this shell, so run it from the same kind of shell that starts Vite.
//   scan             the whole-folder token scan: every file in the data
//                    folder (store, backup, marker, quarantine/, any copy
//                    left there) and the relay's os.tmpdir() files. Exit 0
//                    when no plain token is at rest, 1 when one is.
//                    --keep-plain-copy leaves session.v1.json out (it is
//                    kept on purpose until the deploy's revert drill).
//   drop-plain-copy  after the deploy's revert drill passes: delete the
//                    plain pre-migration copy (session.v1.json), note it in
//                    the marker, then scan. After this a revert below L5
//                    means a re-pair (docs/trip-twin/runbooks/re-pair.md).
// The server never deletes the copy itself, at any start or on a timer.
// Prints paths, counts and reasons only: never a token. Safe while the
// server runs (it never reads these files after start).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLAIN_COPY_FILE,
  STORE_FILE,
  dropPlainCopy,
  legacyStorePath,
  resolveDataDir,
  scanForPlainTokens,
} from '../server/tripTwin/sessionStore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, ...rest] = process.argv.slice(2);
const has = (n) => rest.includes(`--${n}`);

function storeLine(dir) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, STORE_FILE), 'utf8'));
    const devices = Array.isArray(doc.devices) ? doc.devices : [];
    const hashed = devices.filter(([, d]) => d?.tokenHash).length;
    return `session.json v:${doc.v ?? '?'} · ${devices.length} device record(s), ${hashed} with a token hash`;
  } catch (e) {
    return `session.json ${e?.code === 'ENOENT' ? 'absent' : 'not readable'}`;
  }
}

function report(findings) {
  if (!findings.length) {
    console.log('  clean: no plain token at rest');
    return 0;
  }
  for (const f of findings) console.log(`  FOUND ${f.file} (${f.why})`);
  console.log(
    `  ${findings.length} file(s) hold a plain token: delete or Forget as the runbook says (a deploy-copy.json from before L5 is one: delete it once the deploy passes)`,
  );
  return 1;
}

function main() {
  if (cmd !== 'scan' && cmd !== 'drop-plain-copy') {
    console.log(
      'usage: node scripts/trip-twin-store.mjs scan [--keep-plain-copy] | drop-plain-copy',
    );
    return 2;
  }
  const where = resolveDataDir({
    fences: [{ name: 'the repo', path: ROOT }],
  });
  if (!where.dir) {
    console.log(
      `data folder refused (${where.source}): ${where.refused.reason}`,
    );
    return 2;
  }
  const dir = where.dir;
  const legacyFile = legacyStorePath();
  console.log(`Trip Twin store · ${dir} (${where.source})`);
  console.log(`  ${storeLine(dir)}`);
  const copy = path.join(dir, PLAIN_COPY_FILE);
  if (cmd === 'drop-plain-copy') {
    const r = dropPlainCopy({ dir, legacyFile });
    console.log(
      `  ${r.removed ? 'deleted' : 'no'} ${PLAIN_COPY_FILE}${r.removed ? '' : ' (nothing to delete)'}; a revert below L5 now means a re-pair`,
    );
    return report(r.findings);
  }
  const keep = has('keep-plain-copy');
  console.log(
    `  ${PLAIN_COPY_FILE} ${fs.existsSync(copy) ? (keep ? 'present (left out of this scan)' : 'present') : 'absent'}`,
  );
  return report(scanForPlainTokens({ dir, legacyFile, keepPlainCopy: keep }));
}

process.exitCode = main();
