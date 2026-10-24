// Trip Twin SOC multi-view relay (phase 10; review/phase10 R1, R10, R17,
// R18): one WebSocket endpoint on the dev server, /api/twin-sync, that hosts
// the session (pairing, lease, commands, presence) and forwards screen
// snapshots and hands-on state to remotes. Plus GET /api/twin-sync/info with
// this machine's LAN addresses for the QR.
// A socket's identity is bound only after an accepted hello; refused
// sockets get nothing; presence never carries device ids. The wall is saved
// to a file so a restart keeps screens and the remote paired.
// Prototype only: plain ws, LAN, no login — production needs TLS, device
// enrolment, SSO, signed commands and an audit log (07-production-delta).
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { createSessionHost } from '../../src/operations/tripTwin/twinSessionHost.js';

const PATH = '/api/twin-sync';
const STORE = path.join(os.tmpdir(), 'trip-twin-soc-session.json');

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
  const sockets = new Map(); // ws → {id, kind} once accepted
  const local = new WeakMap(); // ws → opened from this computer
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
        const meta = { id: String(m.id), kind: m.kind };
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
        // The launcher may watch who joins (R17); it can never command.
        sockets.set(ws, {
          id: `launcher-${String(m.id || 'local')}`,
          kind: 'launcher',
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

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch {
    return null;
  }
}

export function twinSyncRelay() {
  return {
    name: 'trip-twin-sync-relay',
    configureServer(server) {
      // A restart keeps the wall: session, devices and tokens (R18).
      let timer = null;
      const save = (snap) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          fs.promises.writeFile(STORE, JSON.stringify(snap)).catch(() => {});
        }, 300);
      };
      const relay = createRelay({
        host: createSessionHost({ restore: loadStore() }),
        save,
      });
      const wss = new WebSocketServer({ noServer: true });
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith(PATH)) return; // Vite's HMR keeps its own
        // Same origin only: no other web page can open the wall's socket.
        const origin = req.headers.origin || '';
        const hostHeader = req.headers.host || '';
        if (origin && origin.replace(/^https?:\/\//, '') !== hostHeader) {
          socket.destroy();
          return;
        }
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
