// SOC multi-view client (phase 10): one WebSocket to the dev-server relay
// (/api/twin-sync). Reconnects with backoff, heartbeats every 5 s, keeps
// the time of the last message so a screen can say how old its link is.
// Phase CF K4 (CF-2): the device id and token come from twinIdentity.js
// (a wall window's slot record, the remote's record, Web Locks where they
// exist), so a window opened again rejoins as the same device. Refusals
// carry a code (twinProtocol.js): a copied id takes a fresh one and asks
// again; a terminal code (S-16) drops that token or link and stops
// reconnecting with it — a wall falls to a fresh id and the pair card, a
// remote shows its refusal. A replaced window (another window took this
// identity) stops reconnecting and never touches storage (C16).
// Phase CF K5 (S-15): every hello says this build's protocol (`proto`). A
// relay that needs a newer page answers RELOAD, which is not terminal:
// the page decides (a wall reloads itself at most once per 2 minutes).
// Phase CF K7 (S-16): BUSY and RATE_LIMITED say `retryAfterMs`; the next
// connection waits at least that long (the relay closes a socket with no
// accepted hello after 5 s). A wall waiting for a code hears only its code
// (no state, no presence). The back-off is reset by an accepted welcome,
// not by an open socket, so a page that is refused (and closed at the
// relay's hello deadline) backs off instead of reconnecting every second.
import {
  acquireIdentity,
  browserEnv,
  hasIdentity,
  localhostUrl,
  safeStorage,
} from './twinIdentity.js';
import {
  CLOSE,
  DENY,
  PROTO,
  REPLACED,
  isTerminalDeny,
} from './twinProtocol.js';

const store = (() => {
  const s = safeStorage(() => globalThis.localStorage);
  return {
    get: (k) => s.get(`tripTwin.soc.${k}`),
    set: (k, v) => s.set(`tripTwin.soc.${k}`, v),
  };
})();

export const socStore = store;

/** A client that never connects: the page is on its way to localhost. */
function inert(id) {
  return {
    id,
    send: () => false,
    request: () =>
      Promise.resolve({
        ok: false,
        error: 'Not connected to the Trip Twin computer',
      }),
    linkAgeS: null,
    online: false,
    forget() {},
    close() {},
  };
}

/**
 * connectSync({kind: 'screen'|'remote'|'launcher', slot?, setup?, name?,
 *   on: {welcome, state, presence, thumb, identify, paired, unpaired,
 *   replaced, control, setup, status}, env?}) → {send, request, close,
 *   forget, id, online, get linkAgeS}
 */
export function connectSync({
  kind,
  slot = null,
  setup = null,
  name = '',
  on = {},
  env = browserEnv(),
}) {
  // S-23: 127.0.0.1 and [::1] are their own origins; go to localhost,
  // unless this origin already holds this window's pairing (migration).
  const away = localhostUrl(env.location);
  if (away && !hasIdentity({ kind, slot, env })) {
    env.location.replace(away);
    return inert(null);
  }
  const identity = acquireIdentity({ kind, slot, env });
  let ticket = setup; // the setup link, until it is refused
  let ws = null;
  let closed = false;
  let stopped = null; // 'replaced' | 'denied' | 'closed'
  let retry = 0;
  let beat = null;
  let lastMsgAt = 0;
  let reqSeq = 0;
  let asked = 0; // hellos on this socket after a refusal
  let notBefore = 0; // no new connection before this (retryAfterMs)
  let sent = null; // the token the last hello carried
  const pending = new Map();
  const url = `${env.location.protocol === 'https:' ? 'wss' : 'ws'}://${env.location.host}/api/twin-sync`;

  const status = (s) => on.status?.(s);
  /** No more reconnects. Storage is left exactly as it is. */
  function stop(why) {
    if (stopped) return;
    stopped = why;
    closed = true;
    env.clearInterval(beat);
  }
  function hello() {
    sent = identity.token ?? null;
    ws.send(
      JSON.stringify({
        t: 'hello',
        proto: PROTO,
        id: identity.id,
        kind,
        name,
        slot: identity.slot ?? slot,
        setup: ticket,
        token: sent,
      }),
    );
  }
  /** True when the refusal was handled here (a new hello was sent). */
  function refused(m) {
    const code = m.code;
    if (code === DENY.ID_COPIED && asked < 3) {
      // Another window here holds this id: take a fresh one, ask again.
      identity.renew({ sent, shared: false });
      asked += 1;
      hello();
      return true;
    }
    if (!isTerminalDeny(code)) return false;
    if (code === DENY.TICKET_EXPIRED || code === DENY.TICKET_USED)
      ticket = null; // drop the link, keep the id
    else identity.renew({ sent }); // drop the token: a fresh id
    if (kind === 'screen' && asked < 3) {
      // A wall falls to the pair card (or joins by a still-valid link).
      asked += 1;
      hello();
      return true;
    }
    // A remote or a launcher shows its refusal and stops retrying.
    stop('denied');
    env.setTimeout(() => ws?.close(), 0);
    return false;
  }
  function open() {
    if (closed) return;
    status('connecting');
    try {
      ws = new env.WebSocket(url);
    } catch {
      return schedule();
    }
    asked = 0;
    ws.addEventListener('open', () => {
      if (closed) return ws.close();
      status('online');
      hello();
      env.clearInterval(beat);
      beat = env.setInterval(() => send({ t: 'hb' }), 5000);
    });
    ws.addEventListener('message', (e) => {
      lastMsgAt = env.now();
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.reqId != null && pending.has(m.reqId)) {
        pending.get(m.reqId)(m);
        pending.delete(m.reqId);
      }
      if (
        m.t === 'welcome' &&
        m.type === 'denied' &&
        Number.isFinite(m.retryAfterMs) &&
        m.retryAfterMs > 0
      )
        notBefore = env.now() + Math.min(m.retryAfterMs, 10 * 60 * 1000);
      if (m.t === 'welcome' && m.type === 'denied' && refused(m)) return;
      if (m.t === 'welcome' && m.type !== 'denied') {
        asked = 0;
        // Back-off starts again only once the relay took this device (K7):
        // a page refused again and again backs off to 32 s.
        retry = 0;
        // A paired device rejoins by its token; a launcher keeps its link.
        if (m.type === 'paired' || m.type === 'remote') ticket = null;
      }
      if ((m.t === 'welcome' || m.t === 'paired') && m.token)
        identity.save(m.token, m.slot);
      if (m.t === REPLACED) stop('replaced');
      on[m.t]?.(m);
    });
    ws.addEventListener('close', (e) => {
      env.clearInterval(beat);
      if (e?.code === CLOSE.REPLACED && !stopped) {
        stop('replaced');
        on.replaced?.({ t: REPLACED });
      }
      status('offline');
      schedule();
    });
    ws.addEventListener('error', () => {});
  }
  function schedule() {
    if (closed) return;
    retry = Math.min(retry + 1, 6);
    env.setTimeout(open, Math.max(500 * 2 ** retry, notBefore - env.now()));
  }
  function send(msg) {
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }
  /** Send and wait for the matching ack (or a 5 s timeout). */
  function request(msg) {
    const reqId = ++reqSeq;
    return new Promise((resolve) => {
      pending.set(reqId, resolve);
      if (!send({ ...msg, reqId })) {
        pending.delete(reqId);
        resolve({
          ok: false,
          error: 'Not connected to the Trip Twin computer',
        });
        return;
      }
      env.setTimeout(() => {
        if (pending.has(reqId)) {
          pending.delete(reqId);
          resolve({
            ok: false,
            error: 'No answer from the Trip Twin computer',
          });
        }
      }, 5000);
    });
  }
  // A newer window on this computer took this slot: stop reconnecting and
  // wait for the relay to replace this socket (no flicker on the wall).
  identity.onStolen(() => {
    if (stopped) return;
    stop('replaced');
    on.replaced?.({ t: REPLACED, local: true });
  });
  identity.ready.then(open);
  return {
    get id() {
      return identity.id;
    },
    send,
    request,
    /** Seconds since the relay last said anything (link age). */
    get linkAgeS() {
      return lastMsgAt ? (env.now() - lastMsgAt) / 1000 : null;
    },
    get online() {
      return ws?.readyState === 1;
    },
    /** Why this client stopped reconnecting (null while it still does). */
    get stopped() {
      return stopped;
    },
    /** The relay unpaired this device (slot taken, forgotten). */
    forget() {
      identity.clear();
    },
    close() {
      stop('closed');
      ws?.close();
      identity.release();
    },
  };
}
