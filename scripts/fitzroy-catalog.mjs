#!/usr/bin/env node
// Writes the generated views of the Fitzroy command catalog
// (review/fitzroy-commands F5 D10). The voice lab (outside this repo) reads
// them, as it reads its entity dump; this repo never names a lab path.
//   node scripts/fitzroy-catalog.mjs          write the files
//   node scripts/fitzroy-catalog.mjs --check  fail if any file differs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFitzroyOutputs } from './fitzroy-catalog-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const outputs = await buildFitzroyOutputs(root);
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
  console.error('Run: node scripts/fitzroy-catalog.mjs');
  process.exit(1);
}
if (check) console.log('Fitzroy catalog outputs are up to date.');
