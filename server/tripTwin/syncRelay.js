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
// One identity per wall (Phase CF K4, CF-2, C16): one live socket per
// device id — a reload, a restored window or a duplicated tab with the same
// token for the same place replaces the older socket, which gets
// {t:'replaced'} and is closed (4003); a device is offline only when its
// last socket closes; `paired` goes only to the socket that showed the
// code; one accepted hello per socket (a second one closes it, 4002).
// Protocol and attribution (Phase CF K5, S-15, §4.4): a hello (and a setup)
// from a page below PROTO_MIN is refused RELOAD; welcomes say PROTO. A
// change is broadcast with `by` (the actor from the socket: ref, kind, the
// host's name for it, slot, via) and every state broadcast says its
// `cause`; state and presence carry refs, never a device id, and a pair
// result never carries the screen's id or token.
// Audit and health (Phase CF K6, BE-5, BE-6, BE-10, CF-D9): the host emits
// one event per operation and the relay adds its own (refusals before the
// host, identify, the walls' hands-on and drift from `local` fields,
// devices going offline), with the socket's peer for refusals only (C38).
// auditLog.js writes them (allowlists, async, fail open). Heartbeats and
// thumbnails are never logged. GET /api/twin-sync/health and /log answer
// only this computer (localOnly()).
// Prototype only: plain ws, LAN, no login — production needs TLS, device
// enrolment, SSO, signed commands and an append-only audit store off the
// host (07-production-delta).
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createSessionHost } from '../../src/operations/tripTwin/twinSessionHost.js';
import {
  CAUSE,
  CLOSE,
  CODE,
  DENY,
  PROTO,
  DRIFT_REASONS,
  REPLACED,
  UNPAIRED,
  VIA,
  protoOk,
  reloadText,
} from '../../src/operations/tripTwin/twinProtocol.js';
import { auditLogFor } from './auditLog.js';
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
  twinLocalOnly,
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

/**
 * Presence as one socket may see it: no device ids, its own flag. Actors
 * by ref (K5): who is on the wall and every ref the state names.
 */
export function presenceFor(p, meId) {
  const screens = {};
  for (const [slot, s] of Object.entries(p.screens || {}))
    screens[slot] = {
      online: s.online,
      lastSeen: s.lastSeen,
      ref: s.ref ?? null,
      you: s.id === meId,
    };
  return {
    screens,
    remotes: (p.remotes || []).map((r) => ({
      ref: r.ref ?? null,
      name: r.name,
      online: r.online,
      controller: r.controller,
      controlSince: r.controlSince ?? null,
      you: r.id === meId,
    })),
    actors: (p.actors || []).map((a) => ({
      ref: a.ref,
      kind: a.kind,
      name: a.name,
      slot: a.slot ?? null,
      online: Boolean(a.online),
    })),
    youControl: Boolean(meId) && p.controller === meId,
    anyController: Boolean(p.controller),
    handover: p.handover && {
      fromRef: p.handover.fromRef ?? null,
      fromName: p.handover.fromName,
      at: p.handover.at,
      you: p.handover.from === meId,
    },
  };
}

/** The 95th percentile of a list of numbers (ms, 0.1 ms steps), or null. */
export function p95(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return (
    Math.round(s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] * 10) /
    10
  );
}
export const TIMING_SAMPLES = 200;

/** Store log events that are also audit events (`store.error`, K6). */
const STORE_AUDIT = Object.freeze({
  'store.saved_error': 'saved_error',
  'store.open_error': 'open_error',
  'store.quarantined': 'quarantined',
  'store.reset': 'reset',
  'store.dir_refused': 'dir_refused',
  'store.memory_only': 'memory_only',
});

/**
 * Wire a host to sockets. Exposed for tests (no Vite needed). `audit`
 * (auditLog.js, K6) gets every event; without one nothing is written, and
 * the counters and timings for health are kept all the same.
 */
export function createRelay({
  host = createSessionHost(),
  save = () => {},
  audit = null,
} = {}) {
  const sockets = new Map(); // ws → {id, kind, secure, place} once accepted
  const conns = new Map(); // ws → {isLocal, secure, peer, proto} from its upgrade
  const waiting = new Map(); // device id → the socket that shows its code
  // Health (BE-10): counters from the events, timings of commands.
  const counters = {
    cmdApplied: 0,
    cmdRefused: {},
    undoApplied: 0,
    undoRefused: {},
    helloDenied: {},
    pairFailed: {},
    setupRefused: 0,
    // A command the policy asks about applied without the server's
    // question. Stays 0: K10 moves the question to the server and asserts
    // this after every apply; until then the remote asks (CF-core K10).
    confirmBypass: 0,
    thumbs: 0,
    msgDropped: 0,
  };
  const timings = { applyMs: [], applyToBroadcastMs: [] };
  const sample = (k, ms) => {
    timings[k].push(ms);
    if (timings[k].length > TIMING_SAMPLES) timings[k].shift();
  };
  const bump = (o, k) => (o[k || '?'] = (o[k || '?'] || 0) + 1);
  function count(type, data = {}) {
    if (type === 'cmd.applied') counters.cmdApplied += 1;
    else if (type === 'cmd.refused') bump(counters.cmdRefused, data.code);
    else if (type === 'undo.applied') counters.undoApplied += 1;
    else if (type === 'undo.refused') bump(counters.undoRefused, data.code);
    else if (type === 'device.hello' && data.outcome === 'denied')
      bump(counters.helloDenied, data.code);
    else if (type === 'pair.failed') bump(counters.pairFailed, data.reason);
    else if (type === 'session.setup' && data.ok === false)
      counters.setupRefused += 1;
  }
  // The message being handled (synchronous): its socket's peer and
  // reqId, added to every event it causes.
  let ctx = null;
  function record(type, ev = {}) {
    count(type, ev.data || {});
    if (!audit) return;
    const reqId = ctx?.reqId;
    audit.emit(type, {
      ...ev,
      corr: { ...(ev.corr || {}), ...(reqId != null ? { reqId } : {}) },
      peer: ev.peer ?? ctx?.peer,
      secure: ev.secure ?? ctx?.secure,
    });
  }
  host.onEvent?.(record);
  // Each wall's last hands-on and drift, so only a change is logged.
  const walls = new Map(); // slot → {on, drift}
  const send = (ws, msg) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  };
  const each = (fn) => {
    for (const [ws, meta] of sockets) fn(ws, meta);
  };
  const view = (meta) => presenceFor(host.presence(), meta.id);
  /** The accepted socket that holds this device id, other than `not`. */
  const liveOf = (id, not = null) => {
    for (const [ws, meta] of sockets)
      if (ws !== not && meta.id === id && meta.kind !== 'launcher')
        return { ws, meta };
    return null;
  };
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
        send(ws, { t: 'unpaired', reason: UNPAIRED.SLOT_TAKEN });
        sockets.delete(ws);
      }
    });
  /**
   * The older window of one identity (C16): its own message, never
   * `unpaired`, so no handler — old or new — clears the shared token.
   */
  const replace = (ws) => {
    sockets.delete(ws);
    for (const [id, w] of waiting) if (w === ws) waiting.delete(id);
    send(ws, { t: REPLACED });
    ws.close(CLOSE.REPLACED, 'replaced');
  };

  function onMessage(ws, raw) {
    let m;
    try {
      m = JSON.parse(String(raw));
    } catch {
      counters.msgDropped += 1;
      return;
    }
    // Not an object (`null`, a number): dropped, never dispatched.
    if (!m || typeof m !== 'object') {
      counters.msgDropped += 1;
      return;
    }
    const me = sockets.get(ws);
    // Before an accepted hello, only hello and (from this computer) setup.
    if (!me && m.t !== 'hello' && m.t !== 'setup') {
      counters.msgDropped += 1;
      return;
    }
    const conn = conns.get(ws);
    ctx = {
      peer: conn && { ip: conn.peer, local: conn.isLocal },
      secure: Boolean(conn?.secure),
      reqId: Number.isInteger(m.reqId) ? m.reqId : null,
    };
    try {
      handle(ws, m, me, conn);
    } finally {
      ctx = null;
    }
  }

  function handle(ws, m, me, conn) {
    switch (m.t) {
      case 'hello': {
        // One accepted hello per socket (SEC-7): a second one closes it.
        if (me) {
          record('device.hello', {
            actor: host.actorOf?.(me.id) ?? null,
            data: {
              outcome: 'denied',
              code: DENY.ALREADY_IDENTIFIED,
              kind: me.kind,
              proto: m.proto,
            },
          });
          send(ws, {
            t: 'welcome',
            type: 'denied',
            code: DENY.ALREADY_IDENTIFIED,
            error: 'This connection has already said hello',
            proto: PROTO,
          });
          ws.close(CLOSE.ALREADY_IDENTIFIED, 'already identified');
          break;
        }
        // A page older than PROTO_MIN reloads (S-15); nothing else reaches
        // the host. Its socket stays open, as for every refusal today.
        if (conn) conn.proto = m.proto;
        if (!protoOk(m.proto)) {
          record('device.hello', {
            data: {
              outcome: 'denied',
              code: DENY.RELOAD,
              kind: m.kind,
              proto: m.proto,
            },
          });
          send(ws, {
            t: 'welcome',
            type: 'denied',
            code: DENY.RELOAD,
            error: reloadText(m.kind),
            proto: PROTO,
          });
          break;
        }
        const id = String(m.id || '');
        const prev = m.kind === 'launcher' ? null : liveOf(id, ws);
        const r = host.hello({
          id,
          kind: m.kind,
          token: m.token,
          name: m.name,
          setup: m.setup,
          slot: m.slot,
          live: prev && { kind: prev.meta.kind, slot: prev.meta.place },
          local: Boolean(conn?.isLocal),
        });
        if (r.type === 'denied') {
          send(ws, {
            t: 'welcome',
            type: 'denied',
            code: r.code,
            error: r.error,
            proto: PROTO,
          });
          break;
        }
        // Accepted with the same token for the same place: the newest
        // window is the wall, the older one is told and closed.
        if (prev) replace(prev.ws);
        const hint = Number(m.slot) >= 1 && Number(m.slot) <= 6;
        const meta = {
          id,
          kind: m.kind,
          secure: Boolean(conns.get(ws)?.secure),
          place: r.slot ?? (hint ? Number(m.slot) : null),
        };
        sockets.set(ws, meta);
        if (r.type === 'pair-code') waiting.set(id, ws);
        else waiting.delete(id);
        tellUnpaired(r.unpaired);
        const { unpaired: _u, ...rest } = r;
        void _u;
        send(ws, {
          t: 'welcome',
          ...rest,
          proto: PROTO,
          state: host.state,
          presence: view(meta),
        });
        if (r.type === 'paired') broadcastState({ cause: CAUSE.JOIN });
        else presence();
        break;
      }
      case 'setup': {
        // Only the Trip Twin computer itself (localhost) starts a setup.
        if (!conn?.isLocal) {
          record('session.setup', { data: { ok: false, reason: 'not-local' } });
          send(ws, {
            t: 'setup',
            ok: false,
            error: 'Start multi-view on the Trip Twin computer',
          });
          break;
        }
        // The launcher's page says its protocol in its hello (or here).
        if (!protoOk(m.proto ?? conn?.proto)) {
          record('session.setup', { data: { ok: false, reason: 'reload' } });
          send(ws, {
            t: 'setup',
            ok: false,
            code: CODE.RELOAD,
            error: reloadText('launcher'),
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
        broadcastState({ cause: CAUSE.SETUP });
        break;
      }
      case 'pair': {
        const r = host.pair({ by: me.id, code: m.code, slot: m.slot });
        // The screen's id and token are for that screen only (K5, SEC-11).
        const { unpaired, deviceId: _d, token: _t, ...rest } = r;
        void _d;
        void _t;
        send(ws, { t: 'pair-result', reqId: m.reqId, ...rest });
        if (r.ok) {
          tellUnpaired(unpaired);
          // Only the socket that showed this code (SEC-9 rule 2, T14).
          const to = waiting.get(r.deviceId);
          waiting.delete(r.deviceId);
          const meta = to && sockets.get(to);
          if (meta?.id === r.deviceId) {
            meta.place = r.slot;
            send(to, { t: 'paired', slot: r.slot, token: r.token });
          }
          broadcastState({ cause: CAUSE.PAIR });
        }
        break;
      }
      // `by` comes from this socket's device, never from the message: an
      // envelope `by`, `via` or `name` beside `cmd` is not read (S-18).
      case 'cmd': {
        const t0 = performance.now();
        const r = host.command({ by: me.id, cmd: m.cmd });
        const t1 = performance.now();
        send(ws, { t: 'ack', reqId: m.reqId, ...r });
        if (r.ok) {
          broadcastState({
            cause: CAUSE.CMD,
            changed: r.changed,
            skipped: r.skipped,
            by: host.actorOf(me.id, VIA.TOUCH),
          });
          sample('applyMs', t1 - t0);
          sample('applyToBroadcastMs', performance.now() - t0);
        }
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
        if (r.ok)
          broadcastState({
            cause: CAUSE.UNDO,
            undone: { of: r.of },
            by: host.actorOf(me.id, VIA.TOUCH),
          });
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
      case 'identify': {
        const ok = host.isController(me.id);
        let screens = 0;
        if (ok)
          each((s, meta) => {
            if (meta.kind !== 'screen') return;
            screens += 1;
            send(s, { t: 'identify' });
          });
        record('wall.identify', {
          actor: host.actorOf(me.id),
          data: { ok, screens },
        });
        break;
      }
      case 'local':
      case 'thumb': {
        // Only paired screens send these; only remotes receive them.
        if (me.kind !== 'screen') break;
        const slot = host.slotOf(me.id);
        if (!slot) break;
        if (m.t === 'thumb') counters.thumbs += 1;
        else wallFlags(me, slot, m);
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

  /**
   * A wall's hands-on and drift (BE-6): one line for a `local` message
   * that changes either. Hands-on wins when both change (the drift it
   * stopped is in the same line). `text` is never read here.
   */
  function wallFlags(me, slot, m) {
    const before = walls.get(slot) || { on: false, drift: false };
    const on = Boolean(m.on);
    // A wall from before K6 sends no drift: hands-on only.
    const drift = typeof m.drift === 'boolean' ? m.drift : before.drift;
    const reason = DRIFT_REASONS.includes(m.driftReason) ? m.driftReason : null;
    walls.set(slot, { on, drift });
    // Hands on the wall are someone's touch; drift is the wall's own.
    if (on !== before.on)
      record('wall.hands', {
        actor: host.actorOf(me.id, VIA.TOUCH),
        data: { slot, on, drift, reason },
      });
    else if (drift !== before.drift)
      record('wall.drift', {
        actor: host.actorOf(me.id, VIA.SYSTEM),
        data: { slot, on: drift, reason },
      });
  }

  return {
    host,
    /**
     * `secure`: the upgrade came over TLS (SEC-14; recorded, not used yet).
     * `peer`: its address, written only on refusals (C38).
     */
    attach(ws, { isLocal = true, secure = false, peer = null } = {}) {
      conns.set(ws, {
        isLocal: Boolean(isLocal),
        secure: Boolean(secure),
        peer: peer ?? (isLocal ? '127.0.0.1' : null),
      });
      ws.on('message', (raw) => onMessage(ws, raw));
      ws.on('close', () => {
        const me = sockets.get(ws);
        sockets.delete(ws);
        conns.delete(ws);
        if (me && waiting.get(me.id) === ws) waiting.delete(me.id);
        // Offline only when the last socket of this id has closed (H2).
        if (me?.id && !liveOf(me.id)) {
          host.gone(me.id);
          const actor =
            me.kind === 'launcher' ? null : host.actorOf(me.id, VIA.SYSTEM);
          if (actor)
            record('device.offline', {
              actor,
              data: { kind: me.kind, slot: host.slotOf(me.id) },
            });
        }
        presence();
      });
    },
    /** Relay events that are not a host operation (boot, stop, store). */
    record,
    presenceTick: presence,
    /** Health (BE-10): devices, counters, timings; no ids, no content. */
    health() {
      const p = host.presence();
      const screens = Object.values(p.screens || {});
      return {
        proto: PROTO,
        rev: host.state.rev,
        devices: {
          screensPaired: screens.length,
          screensOnline: screens.filter((x) => x.online).length,
          remotesOnline: (p.remotes || []).filter((r) => r.online).length,
          controller: Boolean(p.controller),
        },
        sockets: conns.size,
        counters: JSON.parse(JSON.stringify(counters)),
        timings: {
          applyMsP95: p95(timings.applyMs),
          applyToBroadcastMsP95: p95(timings.applyToBroadcastMs),
          samples: timings.applyMs.length,
        },
      };
    },
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
      check.note(
        'upgrade.refused',
        { reason: floor.reason },
        {
          peer: { ip: peer, local: isLoopbackPeer(peer) },
          secure,
          data: { host: h.host },
        },
      );
      socket.destroy();
      return true;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      relay.attach(ws, { isLocal: isLoopbackPeer(peer), secure, peer }),
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

/**
 * The health body (BE-10, K6): store, audit, host check, counters and
 * timings. No session content, no ids, no tokens. Exposed for tests.
 */
export function healthOf({
  relay,
  store,
  audit,
  check,
  startedAt,
  now = Date.now,
}) {
  const a = audit?.health?.() ?? { ok: false, lastError: 'no audit log' };
  const st = store?.status?.() ?? { ok: false, lastError: 'no store' };
  return {
    ok: Boolean(a.ok && st.ok),
    boot: a.boot ?? null,
    startedAt: new Date(startedAt).toISOString(),
    uptimeS: Math.round((now() - startedAt) / 1000),
    ...relay.health(),
    store: st,
    audit: a,
    hostCheck: check?.status?.() ?? null,
    // Where the confirm question is asked: the remote, until K10 moves it
    // to the server (counters.confirmBypass is asserted from then on).
    confirm: 'remote',
  };
}

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

export function twinSyncRelay() {
  return {
    name: 'trip-twin-sync-relay',
    configureServer(server) {
      const startedAt = Date.now();
      // A restart keeps the wall: session, devices and tokens (R18).
      const log = twinLogger(server);
      const check = hostCheckFor(server);
      // The audit log first, so a store problem at start is in it (K6).
      const audit = auditLogFor(server, { log });
      const storeLog = (event, data) => {
        log(event, data);
        if (STORE_AUDIT[event])
          audit.emit('store.error', {
            data: { what: STORE_AUDIT[event], error: data?.error },
          });
      };
      const store = openRelayStore({
        viteRoot: server.config?.root,
        log: storeLog,
      });
      const relay = createRelay({
        host: createSessionHost({ restore: store.restore }),
        save: (snap) => store.queue(snap),
        audit,
      });
      const host = server.config?.server?.host;
      relay.record('relay.boot', {
        data: {
          proto: PROTO,
          rev: relay.host.state.rev,
          store: store.info?.loaded,
          hostCheck: check.mode,
          lanListening: host === true || host === '0.0.0.0',
          retentionDays: audit.health().retentionDays,
        },
      });
      // The last change is written at once when the server stops; the
      // audit queue too (synchronously, as a last resort).
      const flushOnExit = () => {
        store.flush();
        audit.closeSync();
      };
      process.once('exit', flushOnExit);
      // Same origin only (today's rule), plus the would-refuse record.
      server.httpServer?.on('upgrade', createTwinUpgrade({ relay, check }));
      // Presence every 5 s so links and leases age visibly.
      const tick = setInterval(() => relay.presenceTick(), 5000);
      server.httpServer?.on('close', () => {
        clearInterval(tick);
        store.close();
        relay.record('relay.stop', {
          data: {
            rev: relay.host.state.rev,
            uptimeS: Math.round((Date.now() - startedAt) / 1000),
          },
        });
        audit.close();
        process.removeListener('exit', flushOnExit);
      });
      // Every /api/twin-sync HTTP path: the Host guard first (SEC-2).
      server.middlewares.use(PATH, twinHostGuard({ check }));
      // Health and the log: this computer only, in every mode (§4.4).
      server.middlewares.use(
        `${PATH}/health`,
        twinLocalOnly({
          check,
          handler: (req, res) =>
            json(res, 200, healthOf({ relay, store, audit, check, startedAt })),
        }),
      );
      server.middlewares.use(
        `${PATH}/log`,
        twinLocalOnly({
          check,
          handler: (req, res) => {
            const q = new URL(req.url || '/', 'http://localhost').searchParams;
            json(res, 200, {
              ok: true,
              ...audit.tail(
                Number(q.get('since')) || 0,
                Number(q.get('limit')) || 50,
              ),
            });
          },
        }),
      );
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
