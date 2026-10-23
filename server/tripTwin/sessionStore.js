// Trip Twin session store (Phase CF K2; PHASE-CF-PLAN S-1, S-2, S-14;
// cf/02-backend.md BE-9, cf/01-security.md SEC-6, cf/07-reasoning.md ET-3
// R0.2): where the relay keeps the wall (session, devices with their
// tokens, lease) across restarts.
//   - Folder: TRIP_TWIN_DATA_DIR, default
//     ~/Library/Application Support/SafeTrekr/trip-twin/ (mode 0700). A
//     path inside the repo or Vite's root is refused (Vite could serve it):
//     the wall then runs unsaved, and never falls back to another folder.
//   - Files (0600): session.json (v:1), session.prev.json (one rolling
//     backup: the store as it was at the last good start; restored by hand
//     only), migrated.json (the one-time migration marker), quarantine/
//     (a bad store moved aside; never read again by code).
//   - Every write is atomic: temp file, fsync, rename. A crash part-way
//     leaves the old file whole; the leftover temp is deleted unread.
//   - Migration (S-14): the first start with no store and no marker reads
//     the old os.tmpdir() store once, writes session.json with migratedAt,
//     and writes the marker. After that nothing reads the tmp file again,
//     even if session.json is deleted (no fallback read).
//   - Dual write until K11: every save also goes to the old tmp path (with
//     migratedAt, so it is never migrated twice), so a revert to older code
//     still finds the wall. K11 (Forget) deletes that file and stops this.
// Logs carry counts, paths and reasons only, never a token.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const STORE_VERSION = 1;
export const STORE_FILE = 'session.json';
export const BACKUP_FILE = 'session.prev.json';
export const MARKER_FILE = 'migrated.json';
export const QUARANTINE_DIR = 'quarantine';
/** The pre-K2 store, in os.tmpdir() (syncRelay.js at 3431392, line 18). */
export const LEGACY_FILE = 'trip-twin-soc-session.json';
export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;
export const SAVE_DEBOUNCE_MS = 300;
const TEMP_SUFFIX = '.tmp';

/** macOS convention (S-1); tmp is purged after about 3 days. */
export const defaultDataDir = (home = os.homedir()) =>
  path.join(home, 'Library', 'Application Support', 'SafeTrekr', 'trip-twin');
export const legacyStorePath = (tmp = os.tmpdir()) =>
  path.join(tmp, LEGACY_FILE);

/** realpath of the deepest existing ancestor, plus the rest (symlink-proof). */
function realish(p, fsi = fs) {
  const abs = path.resolve(p);
  const rest = [];
  let cur = abs;
  for (;;) {
    try {
      return path.join(fsi.realpathSync(cur), ...rest.reverse());
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return abs;
      rest.push(path.basename(cur));
      cur = up;
    }
  }
}
const inside = (child, parent) => {
  const r = path.relative(parent, child);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};

/**
 * A folder named by an env variable (else `fallback`), fenced (S-1, sec
 * N2): relative paths and paths inside a fence (the repo, Vite's root) are
 * refused. Returns {dir, source} or {dir: null, source, refused: {path,
 * reason}}: a refused path is never swapped for the default. Shared by the
 * data folder (K2) and the audit folder (K3).
 */
export function resolveFencedDir({
  name,
  env = process.env,
  fallback,
  fences = [],
  fs: fsi = fs,
}) {
  const asked = env[name];
  const source = asked ? name : 'default';
  const want = asked || fallback;
  if (!path.isAbsolute(want))
    return {
      dir: null,
      source,
      refused: { path: want, reason: 'not an absolute path' },
    };
  const real = realish(want, fsi);
  for (const f of fences.filter(Boolean)) {
    if (inside(real, realish(f.path, fsi)))
      return {
        dir: null,
        source,
        refused: { path: want, reason: `inside ${f.name} (${f.path})` },
      };
  }
  return { dir: path.resolve(want), source };
}

/**
 * The data folder, fenced (S-1, sec N2): TRIP_TWIN_DATA_DIR, else
 * Application Support. A refused path is never swapped for the default, so
 * a QA server can never land on the live wall.
 */
export function resolveDataDir({
  env = process.env,
  home = os.homedir(),
  fences = [],
  fs: fsi = fs,
} = {}) {
  return resolveFencedDir({
    name: 'TRIP_TWIN_DATA_DIR',
    env,
    fallback: defaultDataDir(home),
    fences,
    fs: fsi,
  });
}

/**
 * Shape check on load. A store that fails is never half-loaded.
 * `legacy` allows the pre-K2 file (no `v`).
 */
export function checkSnapshot(doc, { legacy = false } = {}) {
  const bad = (reason) => ({ ok: false, reason });
  if (!doc || typeof doc !== 'object' || Array.isArray(doc))
    return bad('not an object');
  if ('v' in doc ? doc.v !== STORE_VERSION : !legacy)
    return bad(
      `version ${JSON.stringify(doc.v ?? null)}, expected ${STORE_VERSION}`,
    );
  const s = doc.session;
  if (!s || typeof s !== 'object') return bad('no session');
  if (!Number.isFinite(s.rev)) return bad('session.rev not a number');
  if (!Number.isFinite(s.count)) return bad('session.count not a number');
  if (!s.session || typeof s.session !== 'object')
    return bad('no session.session');
  if (!s.screens || typeof s.screens !== 'object' || Array.isArray(s.screens))
    return bad('no session.screens');
  if (!Array.isArray(doc.devices)) return bad('devices not a list');
  for (const [i, e] of doc.devices.entries()) {
    if (!Array.isArray(e) || e.length !== 2)
      return bad(`device ${i}: not a pair`);
    const [id, d] = e;
    if (typeof id !== 'string' || !id) return bad(`device ${i}: no id`);
    if (!d || typeof d !== 'object') return bad(`device ${i}: no record`);
    if (d.kind !== 'screen' && d.kind !== 'remote')
      return bad(`device ${i}: kind ${JSON.stringify(d.kind)}`);
    if (d.token != null && typeof d.token !== 'string')
      return bad(`device ${i}: token not a string`);
    if (
      d.slot != null &&
      !(Number.isInteger(d.slot) && d.slot >= 1 && d.slot <= 6)
    )
      return bad(`device ${i}: slot ${JSON.stringify(d.slot)}`);
  }
  const l = doc.lease;
  if (l != null) {
    if (typeof l !== 'object') return bad('lease not an object');
    if (l.holder != null && typeof l.holder !== 'string')
      return bad('lease.holder not a string');
    if (l.at != null && !Number.isFinite(l.at))
      return bad('lease.at not a number');
  }
  return { ok: true };
}

/** Counts for a log line: never an id or a token. */
export const describe = (doc) => {
  const devices = doc?.devices || [];
  const screens = devices.filter(([, d]) => d.kind === 'screen' && d.slot);
  return {
    rev: doc?.session?.rev ?? null,
    screens: screens.map(([, d]) => d.slot).sort((a, b) => a - b),
    remotes: devices.filter(([, d]) => d.kind === 'remote').length,
  };
};

/**
 * Write `text` to `file` atomically: `<file>.tmp` (0600), fsync, rename,
 * then fsync the folder. A crash at any point leaves the old file whole.
 */
export function writeFileAtomic(file, text, { fs: fsi = fs } = {}) {
  const tmp = `${file}${TEMP_SUFFIX}`;
  const fd = fsi.openSync(tmp, 'w', FILE_MODE);
  try {
    fsi.fchmodSync(fd, FILE_MODE); // an old temp file may have kept a looser mode
    const buf = Buffer.from(text);
    let at = 0;
    while (at < buf.length) at += fsi.writeSync(fd, buf, at, buf.length - at);
    fsi.fsyncSync(fd);
  } finally {
    fsi.closeSync(fd);
  }
  fsi.renameSync(tmp, file);
  try {
    const dfd = fsi.openSync(path.dirname(file), 'r');
    try {
      fsi.fsyncSync(dfd);
    } finally {
      fsi.closeSync(dfd);
    }
  } catch {
    /* some file systems refuse a folder fsync; the rename already happened */
  }
}

function ensureDir(dir, fsi) {
  fsi.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  fsi.chmodSync(dir, DIR_MODE);
}

/** Read and parse; {missing} when absent, {error} when unreadable. */
function readJson(file, fsi) {
  let text;
  try {
    text = fsi.readFileSync(file, 'utf8');
  } catch (e) {
    return e?.code === 'ENOENT'
      ? { missing: true }
      : { error: e?.code || 'read failed' };
  }
  try {
    return { doc: JSON.parse(text) };
  } catch {
    return { error: 'not JSON (torn or damaged)' };
  }
}

const stampOf = (t) =>
  new Date(t)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

/**
 * Open the store: load (or migrate once, or start fresh), then hand the
 * relay what to restore and how to save. `dir: null` runs unsaved.
 * Returns {restore, info, queue, flush, save, forget, close, status, paths}.
 */
export function openSessionStore({
  dir,
  legacyFile = legacyStorePath(),
  dualWrite = true,
  now = () => Date.now(),
  log = () => {},
  fs: fsi = fs,
  debounceMs = SAVE_DEBOUNCE_MS,
} = {}) {
  const paths = dir
    ? {
        dir,
        store: path.join(dir, STORE_FILE),
        backup: path.join(dir, BACKUP_FILE),
        marker: path.join(dir, MARKER_FILE),
        quarantine: path.join(dir, QUARANTINE_DIR),
        legacy: legacyFile,
      }
    : { dir: null, legacy: legacyFile };
  const info = {
    dir: dir || null,
    loaded: 'memory',
    quarantined: [],
    legacyRead: false,
    migratedAt: null,
  };
  const health = { ok: Boolean(dir), lastError: null, lastSavedAt: null };
  let restore = null;
  let pending = null;
  let timer = null;
  let closed = false;
  // One log line per new error, not one per failed save (a folder that
  // cannot be written would otherwise log every 300 ms).
  const fail = (event, e) => {
    const error = String(e?.code || e?.message || e);
    const repeat = !health.ok && health.lastError === error;
    health.ok = false;
    health.lastError = error;
    if (!repeat) log(event, { error });
  };

  function quarantine(file, reason) {
    fsi.mkdirSync(paths.quarantine, { recursive: true, mode: DIR_MODE });
    fsi.chmodSync(paths.quarantine, DIR_MODE);
    let to = path.join(paths.quarantine, `session-${stampOf(now())}.json`);
    for (let n = 2; fsi.existsSync(to); n += 1)
      to = path.join(paths.quarantine, `session-${stampOf(now())}-${n}.json`);
    fsi.renameSync(file, to);
    fsi.chmodSync(to, FILE_MODE);
    info.quarantined.push(to);
    log('store.quarantined', { reason, to });
  }

  const docOf = (snap) => ({
    v: STORE_VERSION,
    savedAt: now(),
    migratedAt: info.migratedAt,
    session: snap.session,
    devices: snap.devices,
    lease: snap.lease,
  });

  /** Write the store now (and the tmp-path copy until K11). */
  function save(snap) {
    if (!dir || !snap) return false;
    const text = JSON.stringify(docOf(snap));
    try {
      writeFileAtomic(paths.store, text, { fs: fsi });
      health.ok = true;
      health.lastError = null;
      health.lastSavedAt = now();
    } catch (e) {
      fail('store.saved_error', e);
      return false;
    }
    if (dualWrite)
      try {
        writeFileAtomic(paths.legacy, text, { fs: fsi });
      } catch (e) {
        log('store.dual_write_error', { error: String(e?.code || e) });
      }
    return true;
  }

  if (dir) {
    try {
      ensureDir(dir, fsi);
      // A temp left by a crash is never read: the file it was replacing is
      // whole. Deleting it also drops a stray copy of the tokens.
      for (const f of [paths.store, paths.backup, paths.marker, paths.legacy])
        if (fsi.existsSync(`${f}${TEMP_SUFFIX}`)) {
          fsi.rmSync(`${f}${TEMP_SUFFIX}`, { force: true });
          log('store.temp_removed', { file: `${f}${TEMP_SUFFIX}` });
        }
      const marker = readJson(paths.marker, fsi);
      if (marker.doc?.migratedAt) info.migratedAt = marker.doc.migratedAt;
      const cur = readJson(paths.store, fsi);
      if (!cur.missing) {
        const check = cur.doc
          ? checkSnapshot(cur.doc)
          : { ok: false, reason: cur.error };
        if (check.ok) {
          restore = cur.doc;
          info.loaded = 'store';
          if (!info.migratedAt && cur.doc.migratedAt)
            info.migratedAt = cur.doc.migratedAt;
          log('store.loaded', describe(cur.doc));
        } else {
          // Never half-loaded, never replaced by the backup or the tmp file
          // (S-14): the wall starts fresh; the operator restores by hand.
          quarantine(paths.store, check.reason);
          info.loaded = 'fresh';
          log('store.reset', {
            reason: check.reason,
            backup: fsi.existsSync(paths.backup) ? paths.backup : null,
            hint: 'restore by hand: docs/trip-twin/runbooks/re-pair.md',
          });
        }
      } else if (marker.doc || !marker.missing) {
        // Migrated before (or the marker is unreadable: treat as migrated).
        // No fallback read of the tmp file, ever (S-14).
        info.loaded = 'fresh';
        log('store.fresh', {
          reason: 'no session.json; tmp file not read (migrated before)',
        });
      } else {
        // First start of this code here: migrate the tmp store once.
        info.legacyRead = true;
        const old = readJson(paths.legacy, fsi);
        const check = old.doc ? checkSnapshot(old.doc, { legacy: true }) : null;
        const t = now();
        if (old.doc && check.ok && !old.doc.migratedAt) {
          restore = old.doc;
          info.loaded = 'migrated';
          info.migratedAt = t;
          log('store.migrated', { from: paths.legacy, ...describe(old.doc) });
        } else {
          info.loaded = 'fresh';
          log('store.fresh', {
            reason: old.missing
              ? 'nothing to migrate'
              : old.doc?.migratedAt
                ? 'tmp file is a copy written after a migration; not read as a store'
                : `tmp file not usable (${check?.reason || old.error}); left in place`,
          });
        }
        if (!info.migratedAt) info.migratedAt = t;
        // The store first, the marker second: if the store cannot be
        // written, the next start migrates again instead of losing the wall.
        if (!restore || save(restore))
          writeFileAtomic(
            paths.marker,
            JSON.stringify({
              v: STORE_VERSION,
              migratedAt: info.migratedAt,
              from: info.loaded === 'migrated' ? paths.legacy : null,
            }),
            { fs: fsi },
          );
      }
      // One rolling backup: the store as it was at this good start.
      if (restore)
        writeFileAtomic(paths.backup, JSON.stringify(docOf(restore)), {
          fs: fsi,
        });
    } catch (e) {
      fail('store.open_error', e);
    }
  } else
    log('store.memory_only', {
      reason: 'no data folder; the wall is not saved',
    });

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!pending) return false;
    const snap = pending;
    pending = null;
    return save(snap);
  }

  return {
    restore,
    info,
    paths,
    save,
    /** Debounced save (300 ms after the last change, as before K2). */
    queue(snap) {
      if (!dir || closed) return;
      pending = snap;
      clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
      timer.unref?.();
    },
    flush,
    /** Flush the last change at once and stop saving (server close). */
    close() {
      const r = flush();
      closed = true;
      return r;
    },
    /**
     * Forget (lands with K11): write the store from the host's snapshot
     * (which no longer holds those devices) and rewrite the backup without
     * them. A backup that cannot be read is deleted, not kept.
     */
    forget(snap, ids = []) {
      const gone = new Set(ids);
      const wrote = save(snap);
      let backup = 'absent';
      const b = dir ? readJson(paths.backup, fsi) : { missing: true };
      if (b.doc && checkSnapshot(b.doc).ok) {
        b.doc.devices = b.doc.devices.filter(([id]) => !gone.has(id));
        if (gone.has(b.doc.lease?.holder))
          b.doc.lease = { holder: null, at: 0 };
        writeFileAtomic(paths.backup, JSON.stringify(b.doc), { fs: fsi });
        backup = 'rewritten';
      } else if (!b.missing) {
        fsi.rmSync(paths.backup, { force: true });
        backup = 'deleted';
      }
      log('store.forget', { devices: gone.size, backup });
      return { store: wrote, backup };
    },
    status: () => ({ ...health, dir: dir || null, loaded: info.loaded }),
  };
}
