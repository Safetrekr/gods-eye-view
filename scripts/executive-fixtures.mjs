#!/usr/bin/env node
// Writes SafeTrekr Executive's engine fixtures (EP-50 B1) from the reviewed
// data in plans/trip-twin/executive/data/:
//   products/executive/data/day.json          the day, normalised (EP-35 §§2, 5)
//   products/executive/loop/replay.golden.json state hashes at the beat anchors
//   node scripts/executive-fixtures.mjs                 write the files
//   node scripts/executive-fixtures.mjs --check         fail if any file differs
//   node scripts/executive-fixtures.mjs --from <dir>    read another data folder
// The EP-41 ledger and every id are asserted before anything is written.
// The source folder defaults to ../plans/trip-twin/executive/data beside this
// repo (EXECUTIVE_DATA_DIR overrides); --check needs it to compare.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildExecutiveOutputs,
  readSources,
} from './executive-fixtures-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const at = args.indexOf('--from');
const from = resolve(
  at >= 0
    ? args[at + 1]
    : process.env.EXECUTIVE_DATA_DIR ||
        join(root, '..', 'plans', 'trip-twin', 'executive', 'data'),
);
if (!existsSync(join(from, 'loop.json'))) {
  console.error(
    `No Executive data at ${from} (use --from <dir> or EXECUTIVE_DATA_DIR).`,
  );
  process.exit(1);
}

let outputs;
try {
  outputs = await buildExecutiveOutputs(readSources(from));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
let drift = 0;
for (const [rel, text] of Object.entries(outputs)) {
  const path = join(root, rel);
  let old = null;
  try {
    old = readFileSync(path, 'utf8');
  } catch {
    old = null;
  }
  if (old === text) continue;
  if (check) {
    drift += 1;
    console.error(`out of date: ${rel}`);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote ${rel}`);
}
if (check && drift) {
  console.error('Run: node scripts/executive-fixtures.mjs');
  process.exit(1);
}
if (check) console.log('Executive fixtures are up to date.');
