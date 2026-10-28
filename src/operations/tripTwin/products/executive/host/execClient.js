// SafeTrekr Executive: a small relay client for the executive's own kinds
// (EP-35 §7): a phone bound to one participant, and this computer's
// read-only monitor. The walls and the remote keep using twinSync.js
// (connectSync); this client exists because a phone's hello carries a
// participant and a ticket, which connectSync does not send. One socket,
// a heartbeat every 5 s, reconnects with back-off; the id and token live
// in this tab's sessionStorage, so several phones can share one browser.
import { PROTO } from '../../../twinProtocol.js';
import { EXEC_MSG } from './execProtocol.js';

const TERMINAL = new Set([
  'ID_IN_USE',
  'TICKET_EXPIRED',
  'I10_NOT_BOUND',
  'UNKNOWN_PERSON',
  'NOT_TRUSTED',
  'RELOAD',
]);

function tabStore(prefix) {
  const s = (() => {
    try {
      return globalThis.sessionStorage;
    } catch {
      return null;
    }
  })();
  return {
    get(k) {
      try {
        return s?.getItem(`${prefix}.${k}`) ?? null;
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        if (v == null) s?.removeItem(`${prefix}.${k}`);
        else s?.setItem(`${prefix}.${k}`, v);
      } catch {
        /* a private window: this tab pairs again on reload */
      }
    },
  };
}

function freshId(kind) {
  const b = new Uint8Array(9);
  globalThis.crypto.getRandomValues(b);
  return `${kind}-${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * connectExec({kind: 'phone'|'monitor', participantId?, ticket?, on}) →
 * {request(msg), close()}. `on`: {welcome, loop, clock, denied, status}.
 */
export function connectExec({
  kind,
  participantId = null,
  ticket = null,
  on = {},
}) {
  const store = tabStore(`safetrekr.exec.${kind}`);
  let id = store.get('id') || freshId(kind);
  store.set('id', id);
  let link = ticket;
  let ws = null;
  let retry = 0;
  let beat = null;
  let stopped = false;
  let reqSeq = 0;
  const pending = new Map();
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/twin-sync`;

  function hello() {
    ws.send(
      JSON.stringify({
        t: 'hello',
        proto: PROTO,
        kind,
        id,
        participant_id: participantId,
        ticket: link,
        token: store.get('token'),
      }),
    );
  }
  function open() {
    if (stopped) return;
    on.status?.('connecting');
    ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      on.status?.('online');
      hello();
      clearInterval(beat);
      beat = setInterval(
        () => ws?.readyState === 1 && ws.send('{"t":"hb"}'),
        5000,
      );
    });
    ws.addEventListener('message', (e) => {
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
      if (m.t === 'welcome' && m.type === 'denied') {
        if (m.code === 'ID_IN_USE') {
          // Another tab holds this id, or the relay forgot it: a fresh one.
          id = freshId(kind);
          store.set('id', id);
          store.set('token', null);
        }
        on.denied?.(m);
        if (m.code === 'ID_IN_USE') hello();
        else {
          // A terminal refusal stops here; any other waits for the back-off.
          if (TERMINAL.has(m.code)) stopped = true;
          ws.close();
        }
        return;
      }
      if (m.t === 'welcome') {
        retry = 0;
        link = null;
        if (m.token) store.set('token', m.token);
        on.welcome?.(m);
      }
      if (m.t === EXEC_MSG.LOOP) on.loop?.(m);
      if (m.t === EXEC_MSG.CLOCK) on.clock?.(m.clock);
      if (m.t === 'replaced') {
        stopped = true;
        on.denied?.({
          code: 'REPLACED',
          error: 'This phone opened in another tab',
        });
      }
    });
    ws.addEventListener('close', () => {
      clearInterval(beat);
      on.status?.('offline');
      if (stopped) return;
      retry = Math.min(retry + 1, 6);
      setTimeout(open, 500 * 2 ** retry);
    });
  }
  open();
  return {
    request(msg) {
      const reqId = ++reqSeq;
      return new Promise((resolve) => {
        if (ws?.readyState !== 1) {
          resolve({
            ok: false,
            error: 'Not connected to the Trip Twin computer',
          });
          return;
        }
        pending.set(reqId, resolve);
        ws.send(JSON.stringify({ ...msg, reqId }));
        setTimeout(() => {
          if (pending.delete(reqId))
            resolve({
              ok: false,
              error: 'No answer from the Trip Twin computer',
            });
        }, 5000);
      });
    },
    close() {
      stopped = true;
      ws?.close();
    },
  };
}

/** The sim clock now, from the last clock the relay sent (EP-35 §5). */
export function simNowOf(clock, receivedAt, localNow = Date.now()) {
  if (!clock) return null;
  const base = Date.parse(clock.simNow);
  return clock.paused ? base : base + (localNow - receivedAt) * clock.rate;
}
