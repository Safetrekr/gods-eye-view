// Trip Twin multi-view device identity (Phase CF K4; CF-2, BE-8, SEC-9,
// C16). Which device id and token a window says hello with.
//
// Before K4 the id lived in sessionStorage, one per window, so a wall
// window opened again (closed by accident, Chrome restarted, "Open S4"
// after the 10-minute link) came back as a new device with no token, and
// window.open or a duplicated tab copied one id into two windows.
//
// Now:
// - A wall window opened for slot N uses the slot record
//   localStorage['tripTwin.soc.slot.<N>'] = {id, token} wherever
//   localStorage exists (also on a plain-http LAN address, where Web Locks
//   do not). A window opened again for S4 is the same device and rejoins
//   by its token at any time.
// - The Web Lock tt-slot-<N> is an extra guard where locks exist: the
//   newest window for a slot takes it ({steal: true}); the older one stops
//   reconnecting and never touches storage (it is replaced, not unpaired).
// - Other windows (a remote, a screen waiting for a code) check the lock
//   tt-id-<id>: if another window here holds it, the id was copied from an
//   opener, so this window takes a fresh one.
// - The remote keeps its id in localStorage too (F-0014 a), so a closed
//   Safari tab rejoins without a new QR.
// - Ids come from crypto.getRandomValues (S-7; randomUUID needs a secure
//   context and the iPad is on plain http).
// - Migration: a window that already holds a sessionStorage id with a
//   token is copied into its record. Nothing old is deleted until the
//   CF-core exit: the sessionStorage id and localStorage token.<id> are
//   still written, so a revert to older code finds the same pairing.

const P = 'tripTwin.soc.';
export const slotKey = (n) => `${P}slot.${n}`;
export const REMOTE_KEY = `${P}remote`;
export const sessionKey = (kind) => `${P}device.${kind}`;
export const tokenKey = (id) => `${P}token.${id}`;

/**
 * Storage that never throws (private mode, a blocked profile): falls back
 * to memory, so a pairing then lasts for this page only.
 */
export function safeStorage(get) {
  const mem = new Map();
  const real = () => {
    try {
      return get() || null;
    } catch {
      return null;
    }
  };
  return {
    get(k) {
      try {
        const s = real();
        return s ? s.getItem(k) : (mem.get(k) ?? null);
      } catch {
        return mem.get(k) ?? null;
      }
    },
    set(k, v) {
      try {
        const s = real();
        if (!s) throw new Error('no storage');
        if (v == null) s.removeItem(k);
        else s.setItem(k, v);
      } catch {
        if (v == null) mem.delete(k);
        else mem.set(k, v);
      }
    },
  };
}

/** The page's own globals (tests pass their own; see twinTestKit.mjs). */
export function browserEnv() {
  const g = globalThis;
  return {
    local: safeStorage(() => g.localStorage),
    session: safeStorage(() => g.sessionStorage),
    locks: g.navigator?.locks ?? null,
    crypto: g.crypto,
    location: g.location,
    WebSocket: g.WebSocket,
    setTimeout: (fn, ms) => g.setTimeout(fn, ms),
    clearTimeout: (h) => g.clearTimeout(h),
    setInterval: (fn, ms) => g.setInterval(fn, ms),
    clearInterval: (h) => g.clearInterval(h),
    now: () => Date.now(),
  };
}

/** `${kind}-` and 32 hex characters (128 bits) from getRandomValues. */
export function newDeviceId(kind, cryptoObj = globalThis.crypto) {
  const b = new Uint8Array(16);
  cryptoObj.getRandomValues(b);
  return `${kind}-${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

const validSlot = (n) => (Number(n) >= 1 && Number(n) <= 6 ? Number(n) : null);

function readRec(store, key) {
  try {
    const r = JSON.parse(store.get(key) || 'null');
    return r && typeof r.id === 'string' && r.id
      ? { id: r.id, token: typeof r.token === 'string' ? r.token : null }
      : null;
  } catch {
    return null;
  }
}
const writeRec = (store, key, rec) =>
  store.set(key, rec ? JSON.stringify(rec) : null);

/** Another slot's record already holds this id (a copied opener id). */
function heldElsewhere(store, id, n) {
  for (let i = 1; i <= 6; i++)
    if (i !== n && readRec(store, slotKey(i))?.id === id) return true;
  return false;
}

/**
 * Does this origin hold a pairing for such a window? (The loopback
 * redirect must never strand one: S-23 and the migration rule.)
 */
export function hasIdentity({ kind, slot = null, env }) {
  const n = kind === 'screen' ? validSlot(slot) : null;
  if (n && readRec(env.local, slotKey(n))?.token) return true;
  if (kind === 'remote' && readRec(env.local, REMOTE_KEY)?.token) return true;
  const s = env.session.get(sessionKey(kind));
  return Boolean(s && env.local.get(tokenKey(s)));
}

/**
 * `http://127.0.0.1:4173/…` and `http://[::1]:4173/…` → the same page on
 * `localhost` (S-23): they are different origins with their own storage,
 * so a wall reopened on one cannot see the pairing it made on the other.
 * Null when already on another name.
 */
export function localhostUrl(loc) {
  const h = String(loc?.hostname || '').toLowerCase();
  if (h !== '127.0.0.1' && h !== '[::1]' && h !== '::1') return null;
  try {
    const u = new URL(loc.href);
    u.hostname = 'localhost';
    return u.href;
  } catch {
    return null;
  }
}

/**
 * acquireIdentity({kind, slot, env}) → {id, token, slot, ready, save,
 * renew, clear, onStolen, release}. `ready` settles once the lock checks
 * are done (at once without Web Locks); say hello after it.
 */
export function acquireIdentity({ kind, slot = null, env = browserEnv() }) {
  const L = env.local;
  const S = env.session;
  const mint = () => newDeviceId(kind, env.crypto);
  let n = kind === 'screen' ? validSlot(slot) : null;
  let id;
  let tok = null;

  if (n) {
    const rec = readRec(L, slotKey(n));
    if (rec) {
      id = rec.id;
      tok = rec.token ?? L.get(tokenKey(rec.id));
    } else {
      // Migration: this window's pre-K4 id, when it is paired and no other
      // slot's record holds it (an id copied from an opener stays behind).
      const s = S.get(sessionKey(kind));
      const st = s && L.get(tokenKey(s));
      if (s && st && !heldElsewhere(L, s, n)) [id, tok] = [s, st];
      else id = mint();
      writeRec(L, slotKey(n), { id, token: tok });
    }
  } else if (kind === 'remote') {
    const s = S.get(sessionKey(kind));
    const st = s && L.get(tokenKey(s));
    const rec = readRec(L, REMOTE_KEY);
    if (s && st) {
      [id, tok] = [s, st]; // this tab's own pairing (kept across reloads)
      if (!rec) writeRec(L, REMOTE_KEY, { id, token: tok }); // migration
    } else if (rec) {
      id = rec.id; // a tab opened again: the remote this origin paired
      tok = rec.token ?? L.get(tokenKey(rec.id));
    } else id = s || mint();
  } else {
    id = S.get(sessionKey(kind)) || mint();
    tok = L.get(tokenKey(id));
  }
  S.set(sessionKey(kind), id);
  if (tok) L.set(tokenKey(id), tok);

  // ---- Web Locks (an extra guard where they exist) ----
  const stolen = [];
  const releases = new Map(); // lock name → release()
  function hold(name, opts) {
    return new Promise((granted) => {
      env.locks
        .request(name, opts, (lock) => {
          granted(Boolean(lock));
          if (!lock) return null;
          return new Promise((release) => releases.set(name, release));
        })
        .catch((e) => {
          granted(false);
          releases.delete(name);
          // {steal: true} from a newer window for this slot.
          if (e?.name === 'AbortError') for (const fn of stolen) fn();
        });
    });
  }
  const drop = (name) => {
    releases.get(name)?.();
    releases.delete(name);
  };
  async function guard() {
    if (!env.locks?.request) return;
    if (n) {
      await hold(`tt-slot-${n}`, { steal: true });
      return;
    }
    if (kind === 'launcher') return;
    if (await hold(`tt-id-${id}`, { ifAvailable: true })) return;
    // Held by another window here: the id was copied (window.open, a
    // duplicated tab). A fresh id for this window only; the shared record
    // still belongs to the other window.
    id = mint();
    tok = null;
    S.set(sessionKey(kind), id);
    await hold(`tt-id-${id}`, { ifAvailable: true });
  }
  const ready = guard().catch(() => {});

  /** The newest token for this id: another window may have saved it. */
  function currentToken() {
    const rec = n
      ? readRec(L, slotKey(n))
      : kind === 'remote'
        ? readRec(L, REMOTE_KEY)
        : null;
    if (rec?.id === id && rec.token) return rec.token;
    return L.get(tokenKey(id)) ?? tok;
  }

  /** Move this screen's record to the slot the relay says it holds. */
  function bind(to) {
    for (let i = 1; i <= 6; i++)
      if (i !== to && readRec(L, slotKey(i))?.id === id)
        writeRec(L, slotKey(i), null);
    if (env.locks?.request) {
      if (n) drop(`tt-slot-${n}`);
      else drop(`tt-id-${id}`);
      hold(`tt-slot-${to}`, { steal: true });
    }
    n = to;
  }

  return {
    get id() {
      return id;
    },
    get token() {
      return currentToken();
    },
    /** The slot this window's record is for (null: none yet). */
    get slot() {
      return n;
    },
    ready,
    /** A token from the relay (`welcome`, `paired`); `at` its slot. */
    save(token, at = null) {
      if (!token) return;
      tok = token;
      L.set(tokenKey(id), token);
      const to = kind === 'screen' ? validSlot(at) : null;
      if (to && to !== n) bind(to);
      if (n) writeRec(L, slotKey(n), { id, token });
      if (kind === 'remote') writeRec(L, REMOTE_KEY, { id, token });
    },
    /**
     * A fresh id for this window (ID_COPIED, ID_IN_USE, FORGOTTEN). A
     * record is rewritten only if it still holds what this window used
     * (compare and set), so a newer window's pairing is never lost.
     * `shared: false` (a copied id): the shared remote record belongs to
     * the other window and is left alone. Old keys are never deleted.
     */
    renew({ sent = null, shared = true } = {}) {
      const old = id;
      id = mint();
      tok = null;
      S.set(sessionKey(kind), id);
      const own = (rec) =>
        rec?.id === old && (!shared || (rec.token ?? null) === (sent ?? null));
      if (n && own(readRec(L, slotKey(n))))
        writeRec(L, slotKey(n), { id, token: null });
      if (kind === 'remote' && shared && own(readRec(L, REMOTE_KEY)))
        writeRec(L, REMOTE_KEY, { id, token: null });
      if (env.locks?.request && !n) {
        drop(`tt-id-${old}`);
        hold(`tt-id-${id}`, { ifAvailable: true });
      }
      return id;
    },
    /**
     * The relay unpaired this device (FORGOTTEN, SLOT_TAKEN): today's
     * forget(), plus its record. Never called for `replaced`.
     */
    clear() {
      tok = null;
      L.set(tokenKey(id), null);
      if (n && readRec(L, slotKey(n))?.id === id) writeRec(L, slotKey(n), null);
      if (kind === 'remote' && readRec(L, REMOTE_KEY)?.id === id)
        writeRec(L, REMOTE_KEY, null);
    },
    /** A newer window here took this slot's lock. */
    onStolen(fn) {
      stolen.push(fn);
    },
    release() {
      for (const name of [...releases.keys()]) drop(name);
    },
  };
}
