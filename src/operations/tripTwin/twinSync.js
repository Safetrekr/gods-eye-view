// SOC multi-view client (phase 10): one WebSocket to the dev-server relay
// (/api/twin-sync). Reconnects with backoff, heartbeats every 5 s, keeps
// the time of the last message so a screen can say how old its link is.
// The device id lives in sessionStorage (one per window or tab, kept across
// reloads); tokens live in localStorage so a reload rejoins on its own.

const store = {
  get(k) {
    try {
      return localStorage.getItem(`tripTwin.soc.${k}`);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (v == null) localStorage.removeItem(`tripTwin.soc.${k}`);
      else localStorage.setItem(`tripTwin.soc.${k}`, v);
    } catch {
      /* private mode: pairing lasts for this page only */
    }
  },
};

function deviceId(kind) {
  const key = `tripTwin.soc.device.${kind}`;
  try {
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = `${kind}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return `${kind}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export const socStore = store;

/**
 * connectSync({kind: 'screen'|'remote'|'launcher', slot?, setup?, name?,
 *   on: {welcome, state, presence, thumb, identify, paired, control,
 *   setup, status}}) → {send, request, close, id, get linkAgeS}
 */
export function connectSync({
  kind,
  slot = null,
  setup = null,
  name = '',
  on = {},
}) {
  const id = deviceId(kind);
  let ws = null;
  let closed = false;
  let retry = 0;
  let beat = null;
  let lastMsgAt = 0;
  let reqSeq = 0;
  const pending = new Map();
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/twin-sync`;

  const status = (s) => on.status?.(s);
  function open() {
    if (closed) return;
    status('connecting');
    try {
      ws = new WebSocket(url);
    } catch {
      return schedule();
    }
    ws.addEventListener('open', () => {
      retry = 0;
      status('online');
      ws.send(
        JSON.stringify({
          t: 'hello',
          id,
          kind,
          name,
          slot,
          setup,
          token: store.get(`token.${id}`),
        }),
      );
      clearInterval(beat);
      beat = setInterval(() => send({ t: 'hb' }), 5000);
    });
    ws.addEventListener('message', (e) => {
      lastMsgAt = Date.now();
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
      if (m.t === 'welcome' && m.token) store.set(`token.${id}`, m.token);
      if (m.t === 'paired' && m.token) store.set(`token.${id}`, m.token);
      on[m.t]?.(m);
    });
    ws.addEventListener('close', () => {
      clearInterval(beat);
      status('offline');
      schedule();
    });
    ws.addEventListener('error', () => {});
  }
  function schedule() {
    if (closed) return;
    retry = Math.min(retry + 1, 6);
    setTimeout(open, 500 * 2 ** retry);
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
      setTimeout(() => {
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
  open();
  return {
    id,
    send,
    request,
    /** Seconds since the relay last said anything (link age). */
    get linkAgeS() {
      return lastMsgAt ? (Date.now() - lastMsgAt) / 1000 : null;
    },
    get online() {
      return ws?.readyState === 1;
    },
    forget() {
      store.set(`token.${id}`, null);
    },
    close() {
      closed = true;
      clearInterval(beat);
      ws?.close();
    },
  };
}
