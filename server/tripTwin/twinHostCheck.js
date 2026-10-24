// Trip Twin host check for one dev server (Phase CF K3; PHASE-CF-PLAN S-1,
// S-2, S-11, C22; cf/01-security.md SEC-1, SEC-2; review/cf/02-security.md
// B1, S14, N2, N6). The rules are pure (twinHosts.js); this file feeds them
// the machine's names and keeps the would-refuse record.
//   - Lists per request, memo 1 s: os.networkInterfaces(), os.hostname(),
//     the Bonjour LocalHostName (`scutil --get LocalHostName`, macOS; memo
//     60 s, refreshed in the background) and TRIP_TWIN_ALLOWED_HOSTS.
//   - TRIP_TWIN_HOST_CHECK: `report` is the only mode until K12. Any other
//     value stays `report` (today's floor) and says so at boot.
//   - Would-refuse lines go to TRIP_TWIN_AUDIT_DIR/would-refuse.jsonl
//     (default ~/Library/Logs/trip-twin/, folder 0700, file 0600; refused
//     inside the repo or Vite's root, never swapped for the default). At
//     most 60 lines a minute (the rest are counted), and the file stops at
//     20 MB. K6 takes the file over: auditLog.js keeps it to the audit's
//     30 days and 200 MB, and health reports it.
//   - One check per dev server: the relay, the routing proxy and the
//     weather proxy share it (hostCheckFor), and the server's audit log
//     (K6): real refusals (`upgrade.refused`, `http.refused`) are audit
//     events with the peer, at most 60 a minute (the rest counted).
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIT_DIR_MODE,
  AUDIT_FILE_MODE,
  WOULD_REFUSE_FILE,
  auditLogFor,
  defaultAuditDir,
  resolveAuditDir,
} from './auditLog.js';
import {
  DEFAULT_HOST_CHECK,
  HOST_CHECK_MODES,
  hostLists,
  lanAddresses,
  parseAllowedHosts,
} from './twinHosts.js';

// The folder rules live with the audit log since K6; re-exported for K3's
// callers and tests.
export {
  AUDIT_DIR_MODE,
  AUDIT_FILE_MODE,
  WOULD_REFUSE_FILE,
  defaultAuditDir,
  resolveAuditDir,
};
export const LIST_MEMO_MS = 1000;
export const BONJOUR_MEMO_MS = 60 * 1000;
export const LINES_PER_MINUTE = 60;
export const FILE_CAP_BYTES = 20 * 1024 * 1024;

/** This checkout: an audit folder inside it is refused (S-1, sec N2). */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/** TRIP_TWIN_HOST_CHECK → {mode, asked, note}. Never weaker than report. */
export function hostCheckMode(env = process.env) {
  const asked = env.TRIP_TWIN_HOST_CHECK ?? null;
  const want = String(asked ?? '')
    .trim()
    .toLowerCase();
  if (!want || HOST_CHECK_MODES.includes(want))
    return { mode: want || DEFAULT_HOST_CHECK, asked, note: null };
  return {
    mode: DEFAULT_HOST_CHECK,
    asked,
    note:
      want === 'enforce'
        ? 'enforce lands in K12; running report (today’s rule still enforced)'
        : `unknown mode; running ${DEFAULT_HOST_CHECK}`,
  };
}

/** The Bonjour LocalHostName, or null (not macOS, or scutil failed). */
export function readBonjourName({ platform = process.platform } = {}) {
  if (platform !== 'darwin') return null;
  try {
    return (
      execFileSync('scutil', ['--get', 'LocalHostName'], {
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

/** A memo of the Bonjour name that refreshes in the background. */
function bonjourSource({ now, platform = process.platform }) {
  let value = readBonjourName({ platform });
  let at = now();
  let pending = false;
  return () => {
    if (platform === 'darwin' && !pending && now() - at > BONJOUR_MEMO_MS) {
      pending = true;
      execFile(
        'scutil',
        ['--get', 'LocalHostName'],
        { encoding: 'utf8', timeout: 2000 },
        (err, out) => {
          pending = false;
          at = now();
          if (!err) value = String(out).trim() || null;
        },
      );
    }
    return value;
  };
}

/**
 * The would-refuse record: append-only JSONL, 0600, in a 0700 folder.
 * `dir` null (refused or unset) writes nothing. Returns {record, status}.
 */
export function openWouldRefuse({
  dir,
  now = Date.now,
  log = () => {},
  fs: fsi = fs,
  perMinute = LINES_PER_MINUTE,
  capBytes = FILE_CAP_BYTES,
}) {
  const file = dir ? path.join(dir, WOULD_REFUSE_FILE) : null;
  let minute = -1;
  let inMinute = 0;
  let dropped = 0;
  let size = null;
  let lines = 0;
  let lastError = null;
  let full = false;
  function write(text) {
    if (size == null) {
      fsi.mkdirSync(dir, { recursive: true, mode: AUDIT_DIR_MODE });
      fsi.chmodSync(dir, AUDIT_DIR_MODE);
      try {
        size = fsi.statSync(file).size;
      } catch {
        size = 0;
      }
    }
    fsi.appendFileSync(file, text, { mode: AUDIT_FILE_MODE });
    fsi.chmodSync(file, AUDIT_FILE_MODE); // an old file may have kept a looser mode
    size += Buffer.byteLength(text);
  }
  return {
    file,
    record(line) {
      const m = Math.floor(now() / 60000);
      if (m !== minute) {
        minute = m;
        inMinute = 0;
      }
      if (inMinute >= perMinute || full) {
        dropped += 1;
        return false;
      }
      inMinute += 1;
      const out = dropped ? { ...line, dropped } : line;
      log('host.would_refuse', out);
      if (!file) return false;
      const text = `${JSON.stringify(out)}\n`;
      if (size != null && size + Buffer.byteLength(text) > capBytes) {
        full = true;
        log('host.would_refuse_full', { file, capBytes });
        return false;
      }
      try {
        write(text);
        dropped = 0;
        lines += 1;
        return true;
      } catch (e) {
        const msg = String(e?.code || e?.message || e);
        if (msg !== lastError)
          log('host.would_refuse_error', { file, error: msg });
        lastError = msg;
        return false;
      }
    },
    status: () => ({ file, lines, dropped, full, lastError }),
    /** After the audit's retention trimmed the file (K6): look again. */
    resync() {
      size = null;
      full = false;
    },
  };
}

/**
 * The host check for one server. Everything outside is injectable for
 * tests: env, os (networkInterfaces, hostname), the Bonjour name, the
 * clock, the fallback port and the log.
 */
export function createHostCheck({
  env = process.env,
  viteRoot = null,
  log = () => {},
  osi = os,
  bonjour = null,
  now = Date.now,
  port = () => null,
  fs: fsi = fs,
  audit = null,
} = {}) {
  const { mode, asked, note } = hostCheckMode(env);
  const extra = parseAllowedHosts(env.TRIP_TWIN_ALLOWED_HOSTS);
  const where = resolveAuditDir({
    env,
    fences: [
      { name: 'the repo', path: REPO_ROOT },
      viteRoot && { name: "Vite's root", path: viteRoot },
    ],
    fs: fsi,
  });
  const bonjourName = bonjour || bonjourSource({ now });
  const sink = openWouldRefuse({ dir: where.dir, now, log, fs: fsi });
  audit?.onPrune?.(() => sink.resync());
  let memo = null;
  // Dev-log lines and audit events for real refusals: at most 60 a
  // minute; the next one written says how many were left out.
  let noteMinute = -1;
  let notes = 0;
  let notesDropped = 0;
  log('hosts.check', {
    mode,
    asked,
    ...(note ? { note } : {}),
    allowedHostsExtra: extra.entries.map((e) =>
      e.port ? `${e.name}:${e.port}` : e.name,
    ),
    ...(extra.refused.length ? { allowedHostsRefused: extra.refused } : {}),
    wouldRefuse: sink.file,
    ...(where.refused
      ? {
          auditDirRefused: where.refused,
          effect: 'would-refuse lines go to the dev log only',
        }
      : {}),
  });
  return {
    mode,
    now,
    port,
    /** The allowlists for `port`, rebuilt at most once a second (C22). */
    lists(p) {
      const t = now();
      if (memo && memo.port === p && t - memo.at < LIST_MEMO_MS)
        return memo.value;
      const value = hostLists({
        port: p,
        ifaces: osi.networkInterfaces(),
        hostname: osi.hostname(),
        bonjour: bonjourName(),
        extra: extra.entries,
      });
      memo = { port: p, at: t, value };
      return value;
    },
    /** This machine's LAN addresses now (for /api/twin-sync/info). */
    addresses: () => lanAddresses(osi.networkInterfaces()),
    record: (line) => sink.record(line),
    /**
     * A real refusal: a dev-log line and (K6) an audit event. `ctx` is
     * {peer, secure, data}: the peer and any extra fields go to the audit
     * only (C38), never to the dev log.
     */
    note(event, data, ctx = {}) {
      const m = Math.floor(now() / 60000);
      if (m !== noteMinute) {
        noteMinute = m;
        notes = 0;
      }
      if (notes++ >= LINES_PER_MINUTE) {
        notesDropped += 1;
        return;
      }
      log(event, data);
      audit?.emit?.(event, {
        data: {
          ...data,
          ...ctx.data,
          ...(notesDropped ? { dropped: notesDropped } : {}),
        },
        peer: ctx.peer,
        secure: ctx.secure,
      });
      notesDropped = 0;
    },
    status: () => ({ mode, wouldRefuse: sink.status() }),
  };
}

/** `[trip-twin] event {json}` on the Vite logger, as the relay logs. */
export function twinLogger(server) {
  const logger = server?.config?.logger;
  return (event, data) => {
    const line = `[trip-twin] ${event} ${JSON.stringify(data)}`;
    if (/error|refused|full|quarantined|reset/.test(event))
      logger?.warn?.(line);
    else logger?.info?.(line);
  };
}

const perServer = new WeakMap();

/** Tests: use this check for `server` instead of building one. */
export function useHostCheck(server, check) {
  perServer.set(server, check);
  return check;
}

/** The one host check of a Vite dev server (shared by the three plugins). */
export function hostCheckFor(server) {
  let check = perServer.get(server);
  if (!check) {
    const log = twinLogger(server);
    check = createHostCheck({
      viteRoot: server?.config?.root || null,
      log,
      audit: auditLogFor(server, { log }),
      port: () => {
        const a = server?.httpServer?.address?.();
        return typeof a === 'object' && a ? a.port : null;
      },
    });
    perServer.set(server, check);
  }
  return check;
}
