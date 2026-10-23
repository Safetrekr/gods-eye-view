#!/usr/bin/env node
// Isolated Trip Twin QA server (Phase CF K1; PHASE-CF-PLAN S-5, cf/06-qa.md
// QA-16). The live :4173 server is never stopped, edited or shared with:
//   - the code is a `git archive` of a commit (default HEAD), so edits in the
//     working tree never hot-reload a page under test;
//   - Vite runs on :4181 (loopback only), HMR off, no file watching, its own
//     cacheDir;
//   - TMPDIR points into the QA folder, so the relay's session file
//     (os.tmpdir()/trip-twin-soc-session.json) is never the live wall's;
//   - the server's environment is built from scratch: only
//     GOOGLE_MAPS_API_KEY and CESIUM_ION_TOKEN are read from .env.local, so
//     3D tiles load and FIRMS still answers 503. Nothing from that file is
//     ever printed, logged or written.
// CLI (runs until Ctrl-C):
//   node scripts/qa-twin-server.mjs --dir <qa folder> [--port 4181]
//     [--ref HEAD] [--env-file <path>]
// Module: startQaServer({dir, port, ref, envFile}) → {url, restart, stop, …}
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The only keys the QA server gets (S-5). FIRMS is left out on purpose. */
export const PASSED_KEYS = Object.freeze([
  'GOOGLE_MAPS_API_KEY',
  'CESIUM_ION_TOKEN',
]);
export const QA_PORT = 4181;
const SESSION_FILE = 'trip-twin-soc-session.json';

const git = (...a) =>
  spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout?.trim() || '';

/**
 * .env.local of this checkout, or of the main checkout when this is a git
 * worktree (worktrees have no .env.local of their own).
 */
export function defaultEnvFile() {
  const here = path.join(ROOT, '.env.local');
  if (fs.existsSync(here)) return here;
  const common = git('rev-parse', '--path-format=absolute', '--git-common-dir');
  const main = common ? path.join(path.dirname(common), '.env.local') : '';
  return main && fs.existsSync(main) ? main : null;
}

/**
 * Read only the passed keys from a dotenv file. Values never leave this
 * function except into the child's environment; callers get a count.
 */
export function readPassedKeys(file) {
  const out = {};
  if (!file) return out;
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || !PASSED_KEYS.includes(m[1])) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.endsWith(q)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (v) out[m[1]] = v;
  }
  return out;
}

/** `git archive <ref>` into <dir>/app, with node_modules linked in. */
export function archiveApp(dir, ref = 'HEAD') {
  const sha = git('rev-parse', '--short', ref);
  if (!sha) throw new Error(`qa-twin-server: unknown ref ${ref}`);
  const app = path.join(dir, 'app');
  fs.rmSync(app, { recursive: true, force: true });
  fs.mkdirSync(app, { recursive: true });
  const tar = spawnSync(
    'sh',
    ['-c', `git archive --format=tar "$0" | tar -x -C "$1"`, ref, app],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (tar.status !== 0)
    throw new Error(`qa-twin-server: git archive failed: ${tar.stderr}`);
  const modules = fs.realpathSync(path.join(ROOT, 'node_modules'));
  fs.symlinkSync(modules, path.join(app, 'node_modules'));
  return { app, sha, modules };
}

// Runs inside the child, with cwd = the archived app.
const RUNNER = `
import path from 'node:path';
const { createServer } = await import('vite');
const app = process.cwd();
const server = await createServer({
  configFile: path.join(app, 'vite.twin.config.js'),
  root: app,
  cacheDir: process.env.QA_CACHE_DIR,
  clearScreen: false,
  server: {
    host: process.env.QA_HOST,
    port: Number(process.env.QA_PORT),
    strictPort: true,
    // No hot updates. The Vite client still holds its socket (ws: false
    // would leave that socket hanging, and Chrome then queues the wall's own
    // socket behind it), so a restart reloads open pages as on :4173.
    hmr: false,
    watch: null,
    fs: { allow: [app, process.env.QA_MODULES, process.env.QA_CACHE_DIR] },
  },
});
await server.listen();
process.stdout.write('QA-SERVER-READY\\n');
const stop = () => server.close().finally(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
`;

/**
 * Start the isolated server. Returns {url, origin, app, sha, storeFile,
 * restart(), stop(), keysPassed}. `restart` keeps the QA TMPDIR, so the
 * relay restores its wall from the QA store, as a real restart does.
 */
export async function startQaServer({
  dir,
  port = QA_PORT,
  host = '127.0.0.1',
  ref = 'HEAD',
  envFile = defaultEnvFile(),
  log = () => {},
} = {}) {
  if (!dir) throw new Error('qa-twin-server: --dir is required');
  fs.mkdirSync(dir, { recursive: true });
  const { app, sha, modules } = archiveApp(dir, ref);
  const tmp = path.join(dir, 'tmp');
  const cacheDir = path.join(dir, 'vite-cache');
  fs.mkdirSync(tmp, { recursive: true });
  const keys = readPassedKeys(envFile);
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    LANG: process.env.LANG || 'en_GB.UTF-8',
    TMPDIR: tmp,
    QA_HOST: host,
    QA_PORT: String(port),
    QA_CACHE_DIR: cacheDir,
    QA_MODULES: modules,
    ...keys,
  };
  const logFile = path.join(dir, 'server.log');
  let child = null;
  let exited = true;
  let stopping = false;

  function launch() {
    return new Promise((resolve, reject) => {
      const out = fs.openSync(logFile, 'a');
      child = spawn(process.execPath, ['--input-type=module', '-e', RUNNER], {
        cwd: app,
        env,
        stdio: ['ignore', 'pipe', out],
      });
      exited = false;
      child.once('exit', () => (exited = true));
      const timer = setTimeout(
        () =>
          reject(new Error(`qa-twin-server: no start in 60 s (${logFile})`)),
        60000,
      );
      let buf = '';
      child.stdout.on('data', (d) => {
        fs.appendFileSync(logFile, d);
        buf += d;
        if (buf.includes('QA-SERVER-READY')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        fs.closeSync(out);
        if (!stopping)
          log(
            `QA server exited on its own (${code ?? signal}); see ${logFile}`,
          );
        reject(
          new Error(`qa-twin-server: exited ${code ?? signal} (${logFile})`),
        );
      });
    });
  }
  function kill() {
    return new Promise((resolve) => {
      if (!child || exited) return resolve();
      stopping = true;
      const hard = setTimeout(() => child?.kill('SIGKILL'), 5000);
      child.once('exit', () => {
        clearTimeout(hard);
        stopping = false;
        resolve();
      });
      child.kill('SIGTERM');
    });
  }

  // Never leave a QA server behind, even if the caller crashes.
  process.once('exit', () => {
    if (child && !exited) child.kill('SIGKILL');
  });
  await launch();
  const origin = `http://localhost:${port}`;
  log(
    `QA server ${origin} · ${sha} · TMPDIR in QA folder · ${Object.keys(keys).length} of ${PASSED_KEYS.length} map keys passed`,
  );
  return {
    url: origin,
    origin,
    port,
    app,
    sha,
    dir,
    tmp,
    storeFile: path.join(tmp, SESSION_FILE),
    keysPassed: Object.keys(keys).length,
    async restart() {
      await kill();
      await launch();
    },
    stop: kill,
    get pid() {
      return child?.pid;
    },
  };
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (n, d) => (a.includes(`--${n}`) ? a[a.indexOf(`--${n}`) + 1] : d);
  const s = await startQaServer({
    dir: arg('dir', path.join(os.tmpdir(), 'trip-twin-qa')),
    port: Number(arg('port', QA_PORT)),
    ref: arg('ref', 'HEAD'),
    envFile: arg('env-file', defaultEnvFile()),
    log: (m) => console.log(m),
  });
  console.log(`Ctrl-C to stop (pid ${s.pid})`);
  const bye = () => s.stop().then(() => process.exit(0));
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
