// Trip Twin SOC multi-view relay (phase 10): one WebSocket endpoint on the
// dev server, /api/twin-sync, that hosts the session (pairing, lease,
// commands, presence) and forwards screen snapshots to remotes. Plus
// GET /api/twin-sync/info with this machine's LAN addresses for the QR.
// Prototype only: plain ws, LAN, no login — production needs TLS, device
// enrolment, SSO, signed commands and an audit log (07-production-delta).
import os from 'node:os';
import { WebSocketServer } from 'ws';
import { createSessionHost } from '../../src/operations/tripTwin/twinSessionHost.js';

const PATH = '/api/twin-sync';

/** IPv4 LAN addresses (no loopback, no link-local). */
export function lanAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const list of Object.values(ifaces || {}))
    for (const a of list || [])
      if (
        (a.family === 'IPv4' || a.family === 4) &&
        !a.internal &&
        !a.address.startsWith('169.254.')
      )
        out.push(a.address);
  return out;
}

/** Wire a host to sockets. Exposed for tests (no Vite needed). */
export function createRelay({ host = createSessionHost() } = {}) {
  const sockets = new Map(); // ws → {id, kind, local}
  const local = new WeakMap(); // ws → opened from this computer
  const send = (ws, msg) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  };
  const each = (fn) => {
    for (const [ws, meta] of sockets) fn(ws, meta);
  };
  const broadcastState = (extra = {}) =>
    each((ws) =>
      send(ws, {
        t: 'state',
        state: host.state,
        presence: host.presence(),
        ...extra,
      }),
    );
  const presence = () =>
    each((ws) => send(ws, { t: 'presence', presence: host.presence() }));

  function onMessage(ws, raw) {
    let m;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    const me = sockets.get(ws) || {};
    switch (m.t) {
      case 'hello': {
        const r = host.hello({
          id: m.id,
          kind: m.kind,
          token: m.token,
          name: m.name,
          setup: m.setup,
          slot: m.slot,
        });
        sockets.set(ws, { id: m.id, kind: m.kind, local: local.get(ws) });
        send(ws, {
          t: 'welcome',
          ...r,
          state: host.state,
          presence: host.presence(),
        });
        presence();
        break;
      }
      case 'setup': {
        // Only the Trip Twin computer itself (localhost) starts a setup.
        if (!local.get(ws)) {
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
        send(ws, { t: 'setup', ...r });
        broadcastState();
        break;
      }
      case 'pair': {
        const r = host.pair({ by: me.id, code: m.code, slot: m.slot });
        send(ws, { t: 'pair-result', reqId: m.reqId, ...r });
        if (r.ok) {
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
          broadcastState({ changed: r.changed, skipped: r.skipped, by: me.id });
        break;
      }
      case 'undo': {
        const r = host.undo({ by: me.id, undoId: m.undoId });
        send(ws, { t: 'ack', reqId: m.reqId, ...r });
        if (r.ok) broadcastState({ undone: true, by: me.id });
        break;
      }
      case 'hb':
        host.beat(me.id);
        break;
      case 'request-control': {
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
      case 'local': {
        // Hands-on on a wall and what was picked there: remotes only.
        const slot = host.slotOf(me.id);
        if (!slot) break;
        each(
          (s, meta) =>
            meta.kind === 'remote' &&
            send(s, {
              t: 'local',
              slot,
              on: Boolean(m.on),
              text: String(m.text || '').slice(0, 120),
            }),
        );
        break;
      }
      case 'thumb': {
        // Screens send snapshots; only remotes receive them.
        const slot = host.slotOf(me.id);
        if (!slot) break;
        each(
          (s, meta) =>
            meta.kind === 'remote' &&
            send(s, { t: 'thumb', slot, data: m.data, at: Date.now() }),
        );
        break;
      }
      default:
        break;
    }
  }

  return {
    host,
    attach(ws, { isLocal = true } = {}) {
      local.set(ws, isLocal);
      ws.on('message', (raw) => onMessage(ws, raw));
      ws.on('close', () => {
        const me = sockets.get(ws);
        sockets.delete(ws);
        if (me?.id) host.gone(me.id);
        presence();
      });
    },
    presenceTick: presence,
  };
}

export function twinSyncRelay() {
  return {
    name: 'trip-twin-sync-relay',
    configureServer(server) {
      const relay = createRelay();
      const wss = new WebSocketServer({ noServer: true });
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith(PATH)) return; // Vite's HMR keeps its own
        const ip = req.socket.remoteAddress || '';
        const isLocal = /^(127\.|::1$|::ffff:127\.)/.test(ip);
        wss.handleUpgrade(req, socket, head, (ws) =>
          relay.attach(ws, { isLocal }),
        );
      });
      // Presence every 5 s so links and leases age visibly.
      const tick = setInterval(() => relay.presenceTick(), 5000);
      server.httpServer?.on('close', () => clearInterval(tick));
      server.middlewares.use(`${PATH}/info`, (req, res) => {
        const addr = server.httpServer?.address();
        const port = typeof addr === 'object' && addr ? addr.port : null;
        const host = server.config.server.host;
        const lan = host === true || host === '0.0.0.0';
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            ok: true,
            port,
            lanListening: lan,
            addresses: lan ? lanAddresses() : [],
          }),
        );
      });
    },
  };
}
