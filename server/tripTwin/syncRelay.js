// Trip Twin SOC multi-view relay (phase 10; review/phase10 R1, R10, R17,
// R18): one WebSocket endpoint on the dev server, /api/twin-sync, that hosts
// the session (pairing, lease, commands, presence) and forwards screen
// snapshots and hands-on state to remotes. Plus GET /api/twin-sync/info with
// this machine's LAN addresses for the QR.
// A socket's identity is bound only after an accepted hello; refused
// sockets get nothing; presence never carries device ids. The wall is saved
// so a restart keeps screens and the remote paired: sessionStore.js (Phase
// CF K2) keeps it in TRIP_TWIN_DATA_DIR, written atomically.
// Host and Origin (Phase CF K3, S-11): the upgrade keeps today's rule (an
// Origin, when present, must equal Host) and records what the new
// allowlist (twinHosts.js) would refuse; only the exact path is served.
// Every /api/twin-sync HTTP path goes through the Host guard first.
// Prototype only: plain ws, LAN, no login — production needs TLS, device
// enrolment, SSO, signed commands and an audit log (07-production-delta).
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createSessionHost } from '../../src/operations/tripTwin/twinSessionHost.js';
import { openSessionStore, resolveDataDir } from './sessionStore.js';
import { hostCheckFor, twinLogger } from './twinHostCheck.js';
import {
  SYNC_PATH,
  hostVerdict,
  isLoopbackPeer,
  isSyncUpgrade,
  lanAddresses as lanAddressesOf,
  todayVerdict,
  twinHostGuard,
  upgradeVerdict,
  wouldRefuseLine,
} from './twinHosts.js';

const PATH = SYNC_PATH;
/** This checkout: a data folder inside it is refused (S-1, sec N2). */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/** IPv4 LAN addresses (no loopback, no link-local). */
export function lanAddresses(ifaces = os.networkInterfaces()) {
  return lanAddressesOf(ifaces);
}

/** Presence as one socket may see it: no device ids, its own flag. */
export function presenceFor(p, meId) {
  const screens = {};
  for (const [slot, s] of Object.entries(p.screens || {}))
    screens[slot] = {
      online: s.online,
      lastSeen: s.lastSeen,
      you: s.id === meId,
    };
  return {
    screens,
    remotes: (p.remotes || []).map((r) => ({
      name: r.name,
      online: r.online,
      controller: r.controller,
      you: r.id === meId,
    })),
    youControl: Boolean(meId) && p.controller === meId,
    anyController: Boolean(p.controller),
    handover: p.handover && {
      fromName: p.handover.fromName,
      at: p.handover.at,
      you: p.handover.from === meId,
    },
  };
}

/** Wire a host to sockets. Exposed for tests (no Vite needed). */
export function createRelay({
  host = createSessionHost(),
  save = () => {},
} = {}) {
  const sockets = new Map(); // ws → {id, kind, secure} once accepted
  const conns = new Map(); // ws → {isLocal, secure} from its upgrade
  const send = (ws, msg) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  };
  const each = (fn) => {
    for (const [ws, meta] of sockets) fn(ws, meta);
  };
  const view = (meta) => presenceFor(host.presence(), meta.id);
  const broadcastState = (extra = {}) => {
    save(host.snapshot());
    each((ws, meta) =>
      send(ws, {
        t: 'state',
        state: host.state,
        presence: view(meta),
        ...extra,
      }),
    );
  };
  const presence = () =>
    each((ws, meta) => send(ws, { t: 'presence', presence: view(meta) }));
  /** Tell devices their slot went to another device (R10). */
  const tellUnpaired = (ids = []) =>
    each((ws, meta) => {
      if (ids.includes(meta.id)) {
        send(ws, { t: 'unpaired' });
        sockets.delete(ws);
      }
    });

  function onMessage(ws, raw) {
    let m;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    const me = sockets.get(ws);
    // Before an accepted hello, only hello and (from this computer) setup.
    if (!me && m.t !== 'hello' && m.t !== 'setup') return;
    switch (m.t) {
      case 'hello': {
        const r = host.hello({
          id: String(m.id || ''),
          kind: m.kind,
          token: m.token,
          name: m.name,
          setup: m.setup,
          slot: m.slot,
        });
        if (r.type === 'denied') {
          send(ws, { t: 'welcome', type: 'denied', error: r.error });
          break;
        }
        const meta = {
          id: String(m.id),
          kind: m.kind,
          secure: Boolean(conns.get(ws)?.secure),
        };
        sockets.set(ws, meta);
        tellUnpaired(r.unpaired);
        const { unpaired: _u, ...rest } = r;
        void _u;
        send(ws, {
          t: 'welcome',
          ...rest,
          state: host.state,
          presence: view(meta),
        });
        if (r.type === 'paired') broadcastState();
        else presence();
        break;
      }
      case 'setup': {
        // Only the Trip Twin computer itself (localhost) starts a setup.
        if (!conns.get(ws)?.isLocal) {
          send(ws, {
            t: 'setup',
            ok: false,
            error: 'Start multi-view on the Trip Twin computer',
          });
          break;
        }
        const r = host.setup({
          count: m.count,
          tripId: m.tripId,
          siteKey: m.siteKey,
        });
        // The launcher may watch who joins (R17); it can never command.
        sockets.set(ws, {
          id: `launcher-${String(m.id || 'local')}`,
          kind: 'launcher',
          secure: Boolean(conns.get(ws)?.secure),
        });
        send(ws, { t: 'setup', ok: true, ...r });
        broadcastState();
        break;
      }
      case 'pair': {
        const r = host.pair({ by: me.id, code: m.code, slot: m.slot });
        const { unpaired, ...rest } = r;
        send(ws, { t: 'pair-result', reqId: m.reqId, ...rest });
        if (r.ok) {
          tellUnpaired(unpaired);
          each((s, meta) => {
            if (meta.id === r.deviceId)
              send(s, { t: 'paired', slot: r.slot, token: r.token });
          });
          broadcastState();
        }
        break;
      }
      case 'cmd': {
        const r = host.command({ by: me.id, cmd: m.cmd });
        send(ws, { t: 'ack', reqId: m.reqId, ...r });
        if (r.ok)
          broadcastState({
            changed: r.changed,
            skipped: r.skipped,
            by: 'remote',
          });
        break;
      }
      case 'screen-cmd': {
        // A wall's own L / D sheet: its own slot, display fields only.
        if (me.kind !== 'screen') break;
        const r = host.screenCommand({ by: me.id, cmd: m.cmd });
        send(ws, { t: 'ack', reqId: m.reqId, ...r });
        if (r.ok)
          broadcastState({
            changed: r.changed,
            by: 'screen',
            slot: r.slot,
            label: String(m.label || '').slice(0, 80),
          });
        break;
      }
      case 'undo': {
        const r = host.undo({ by: me.id, undoId: m.undoId });
        send(ws, { t: 'ack', reqId: m.reqId, ...r });
        if (r.ok) broadcastState({ undone: true, by: 'remote' });
        break;
      }
      case 'hb':
        host.beat(me.id);
        break;
      case 'request-control': {
        if (me.kind !== 'remote') break;
        const r = host.requestControl(me.id);
        send(ws, { t: 'control', ...r });
        presence();
        break;
      }
      case 'handover':
        host.answerHandover(me.id, Boolean(m.accept));
        presence();
        break;
      case 'identify':
        if (host.isController(me.id))
          each(
            (s, meta) => meta.kind === 'screen' && send(s, { t: 'identify' }),
          );
        break;
      case 'local':
      case 'thumb': {
        // Only paired screens send these; only remotes receive them.
        if (me.kind !== 'screen') break;
        const slot = host.slotOf(me.id);
        if (!slot) break;
        const msg =
          m.t === 'thumb'
            ? {
                t: 'thumb',
                slot,
                data: String(m.data || '').slice(0, 400000),
                at: Date.now(),
              }
            : {
                t: 'local',
                slot,
                on: Boolean(m.on),
                text: String(m.text || '').slice(0, 120),
              };
        each((s, meta) => meta.kind === 'remote' && send(s, msg));
        break;
      }
      default:
        break;
    }
  }

  return {
    host,
    /** `secure`: the upgrade came over TLS (SEC-14; recorded, not used yet). */
    attach(ws, { isLocal = true, secure = false } = {}) {
      conns.set(ws, { isLocal: Boolean(isLocal), secure: Boolean(secure) });
      ws.on('message', (raw) => onMessage(ws, raw));
      ws.on('close', () => {
        const me = sockets.get(ws);
        sockets.delete(ws);
        conns.delete(ws);
        if (me?.id) host.gone(me.id);
        presence();
      });
    },
    presenceTick: presence,
    /** Open connections as the relay sees them (no ids): tests, health. */
    connections: () =>
      [...conns].map(([ws, c]) => ({
        local: c.isLocal,
        secure: c.secure,
        kind: sockets.get(ws)?.kind ?? null,
      })),
  };
}

/**
 * The relay's HTTP upgrade listener (SEC-15: exported, so a test can drive
 * it with real `ws` clients on a plain http server). Returns false for an
 * upgrade that is not the relay's (Vite's HMR keeps its own), else true.
 * Report mode (K3, S-11): the new allowlist verdict is recorded when it
 * refuses, and today's rule decides, so nothing refused today is allowed.
 * Only the exact path is served (a /api/twin-sync… look-alike is refused).
 */
export function createTwinUpgrade({
  relay,
  check,
  wss = new WebSocketServer({ noServer: true }),
}) {
  return function twinUpgrade(req, socket, head) {
    if (!isSyncUpgrade(req.url)) return false;
    const h = req.headers || {};
    const peer = req.socket?.remoteAddress || '';
    const secure = Boolean(req.socket?.encrypted);
    const seen = { url: req.url, host: h.host, origin: h.origin, secure };
    const port = req.socket?.localPort || check.port();
    const verdict = upgradeVerdict(seen, check.lists(port));
    const today = todayVerdict({ host: h.host, origin: h.origin });
    // The exact path is enforced in every mode; Host/Origin report only.
    const floor = verdict.reason === 'path' ? verdict : today;
    if (!verdict.ok)
      check.record(
        wouldRefuseLine({
          at: new Date(check.now()).toISOString(),
          kind: 'upgrade',
          mode: check.mode,
          reason: verdict.reason,
          today: today.ok ? 'allowed' : 'refused',
          effect: floor.ok ? 'allowed' : 'refused',
          host: h.host,
          origin: h.origin,
          peer,
          path: req.url,
          secure,
        }),
      );
    if (!floor.ok) {
      // As today: the socket is closed and nothing is written.
      check.note('upgrade.refused', { reason: floor.reason });
      socket.destroy();
      return true;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      relay.attach(ws, { isLocal: isLoopbackPeer(peer), secure }),
    );
    return true;
  };
}

/**
 * The store for this server: TRIP_TWIN_DATA_DIR (fenced off the repo and
 * Vite's root), else Application Support. Exposed for tests.
 */
export function openRelayStore({
  env = process.env,
  viteRoot = null,
  log = () => {},
  ...opts
} = {}) {
  const where = resolveDataDir({
    env,
    fences: [
      { name: 'the repo', path: REPO_ROOT },
      viteRoot && { name: "Vite's root", path: viteRoot },
    ],
  });
  if (where.refused)
    log('store.dir_refused', {
      source: where.source,
      ...where.refused,
      effect: 'the wall runs unsaved until this is fixed',
    });
  return openSessionStore({ dir: where.dir, log, ...opts });
}

export function twinSyncRelay() {
  return {
    name: 'trip-twin-sync-relay',
    configureServer(server) {
      // A restart keeps the wall: session, devices and tokens (R18).
      const log = twinLogger(server);
      const check = hostCheckFor(server);
      const store = openRelayStore({ viteRoot: server.config?.root, log });
      const relay = createRelay({
        host: createSessionHost({ restore: store.restore }),
        save: (snap) => store.queue(snap),
      });
      // The last change is written at once when the server stops.
      const flushOnExit = () => store.flush();
      process.once('exit', flushOnExit);
      // Same origin only (today's rule), plus the would-refuse record.
      server.httpServer?.on('upgrade', createTwinUpgrade({ relay, check }));
      // Presence every 5 s so links and leases age visibly.
      const tick = setInterval(() => relay.presenceTick(), 5000);
      server.httpServer?.on('close', () => {
        clearInterval(tick);
        store.close();
        process.removeListener('exit', flushOnExit);
      });
      // Every /api/twin-sync HTTP path: the Host guard first (SEC-2).
      server.middlewares.use(PATH, twinHostGuard({ check }));
      // hostAllowed/reason let a page say why before it opens a socket
      // (browsers hide a refused upgrade). No addresses for a refused Host.
      server.middlewares.use(`${PATH}/info`, (req, res) => {
        const addr = server.httpServer?.address();
        const port = typeof addr === 'object' && addr ? addr.port : null;
        const host = server.config.server.host;
        const lan = host === true || host === '0.0.0.0';
        const allowed = hostVerdict(
          req.headers.host,
          check.lists(req.socket?.localPort || port),
          { secure: Boolean(req.socket?.encrypted) },
        );
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            ok: true,
            port,
            lanListening: lan,
            addresses: lan && allowed.ok ? check.addresses() : [],
            hostAllowed: allowed.ok,
            reason: allowed.ok ? null : allowed.reason,
            hostCheck: check.mode,
          }),
        );
      });
    },
  };
}
