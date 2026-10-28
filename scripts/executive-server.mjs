// SafeTrekr Executive: start the room's server (plans/trip-twin/executive/
// RUNBOOK.md).
//   node scripts/executive-server.mjs [--port 4174] [--host 0.0.0.0]
// Runs the twin's Vite config with TRIP_TWIN_PRODUCT=executive beside the
// school server (4173), never sharing its folders. The data store, audit log,
// temp files and Vite cache sit in their own trip-twin-executive folders
// under ~/Library unless the TRIP_TWIN_* variables already name others.
// Live public feeds stay live; the people, trips and incidents are SAMPLE.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const port = Number(arg('port', 4174));
const host = arg('host', '0.0.0.0');
if (port === 4173) {
  console.error('4173 is the school Trip Twin; pick another port.');
  process.exit(1);
}

const home = os.homedir();
const lib = (...p) => path.join(home, 'Library', ...p);
const dirs = {
  TRIP_TWIN_DATA_DIR: lib(
    'Application Support',
    'SafeTrekr',
    'trip-twin-executive',
  ),
  TRIP_TWIN_AUDIT_DIR: lib('Logs', 'trip-twin-executive'),
  TMPDIR: lib('Caches', 'trip-twin-executive', 'tmp'),
};
for (const [key, dir] of Object.entries(dirs)) {
  if (!process.env[key] || key === 'TMPDIR') process.env[key] = dir;
  fs.mkdirSync(process.env[key], { recursive: true, mode: 0o700 });
}
process.env.TRIP_TWIN_PRODUCT = 'executive';

const { createServer } = await import('vite');
const server = await createServer({
  configFile: path.join(ROOT, 'vite.twin.config.js'),
  root: ROOT,
  cacheDir: lib('Caches', 'trip-twin-executive', 'vite'),
  clearScreen: false,
  server: { host, port, strictPort: true },
});
await server.listen();
console.log(`SafeTrekr Executive on port ${port}:`);
console.log(
  `  launcher   /twin-executive.html?view=launch (this computer: set up the room)`,
);
console.log(`  walls      the six links the launcher gives`);
console.log(`  desk       /twin-executive.html?as=desk (this computer only)`);
console.log(`  presenter  /twin-executive-remote.html (iPad)`);
console.log(`  phones     /twin-phone.html`);
console.log(`  record     /twin-executive-record.html`);
const stop = () => server.close().finally(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
