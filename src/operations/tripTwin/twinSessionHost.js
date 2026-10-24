// SOC multi-view session host (phase 10; review/phase10 R1, R10, R14, R17,
// R18): pairing, one controller at a time (lease), presence, commands
// through the pure reducer and 10 s undo. Runs inside the dev-server relay
// (server/tripTwin/syncRelay.js). Pure: no I/O; snapshot()/restore for the
// relay to keep the wall across restarts.
// Phase CF K4 (CF-2, C16): hello refusals carry a code (twinProtocol.js);
// one live identity per device id — the relay says which id has a live
// socket, and a newcomer with the same token for the same place replaces
// it, while one for another place is told ID_COPIED; an expired setup
// link says so instead of falling silently to a pair code.
// Phase CF K5 (BE-1, SEC-11, CF-D8, §4.4, F-0003): every paired device has
// a public ref ('D3', persisted, sequential, never the device id) and a
// name the host owns — kind names only ("iPad", "iPad 2", "Phone",
// "Laptop"; a remote on this computer is "Trip Twin computer"; screens
// "S4"). State holds refs only; the ref table keeps every ref ever issued
// with its name, so a change still names a device that is gone. Setup and
// pairing write as the host (D0, "Trip Twin computer", via 'system').
// Command refusals carry a code (twinProtocol.js CODE).
// Phase CF K6 (BE-5, D32): every operation emits one audit event,
// synchronously, so the log's order is the order things happened:
// `emit(type, {actor, rev, data})` (and listeners added with onEvent).
// Refs only, never a device id, a token, a code or a page's own name; the
// relay adds the socket's context and auditLog.js keeps named fields only.
// Phase CF K7 (SEC-4, SEC-7, SEC-8, ET-7 R6a–R6c, S-7, S-16): tokens are
// 256 bits from the platform CSPRNG (crypto.getRandomValues, as
// randomBytes(32), base64url), codes are uniform 0000–9999 (as randomInt),
// undo ids are 128-bit hex; no node: import, since src/ is also built for
// the browser (browserModuleBoundary.test.mjs). A test passes `random` for
// deterministic values, never Math.random. Existing tokens stay valid
// (nobody re-pairs). A screen waiting for a code is not a device record:
// its code lives in the code map only, so it is never saved. Codes are
// purged on every hello and by the relay's sweep; at most 20 are
// outstanding and 6 per IP (loopback exempt, review B4); a free code takes
// at most 50 draws, then BUSY with retryAfterMs (never a spin). A good code
// with a wrong slot counts against that code (burnt after 3).
// Phase CF L5 (SEC-6 hashing, S-14): a device record holds `tokenHash`
// (sha256), never the token. A presented token is checked with
// `tokens.same` (timingSafeEqual); the plain token leaves the host only in
// the reply that issues it, or echoed back to the device that sent it. The
// relay passes `tokens` (server/tripTwin/twinTokens.js); the default here
// is the same sha256 and compare, reached without a node: import. A record
// restored with a plain `token` (a v1 store, an older test) is hashed on
// the way in.
//
// Phase CF K8 (SUP-5): a wrong code says how many tries are left before
// the 1-minute pause, and the pause says when it ends (the same words on
// the remote; values only, no new fields).
// Prototype only — production needs TLS, device enrolment, operator SSO,
// signed commands and an audit log (07-production-delta).
import { LIMITS } from '../../../server/tripTwin/twinLimits.js';
import { applyCommand, applyUndo, createSession } from './twinSession.js';
import {
  ACTOR_FIELDS as ACTOR_KEYS,
  CODE,
  DENY,
  HOST_NAME,
  HOST_REF,
  REMOTE_NAMES,
  VIA,
  isRef,
  pairLockedText,
  pairWrongText,
} from './twinProtocol.js';
import { LAYER_CATALOG } from './twinScreenRoles.js';

const LAYER_KEYS = new Set(
  LAYER_CATALOG.flatMap((g) => g.layers.map((L) => L.key)),
);
const MOTION_KEYS = new Set(['live', 'event', 'cine']);
const SCALES = new Set(['building', 'neighborhood', 'city']);

export const CODE_TTL_MS = 5 * 60 * 1000;
export const LEASE_MS = 30 * 1000;
export const UNDO_MS = 10 * 1000;
export const MAX_TRIES = 5;
export const SETUP_TTL_MS = 10 * 60 * 1000;
/** Pair code caps (S-16): in all, per IP (loopback exempt), draws. */
export const CODES_TOTAL = LIMITS.codesTotal;
export const CODES_PER_IP = LIMITS.codesPerIp;
export const CODE_DRAWS = LIMITS.codeDraws;
export const CODE_TRIES = LIMITS.codeTries;
/** BUSY text (Appendix D 6d; the card itself is K8). */
export const BUSY_TEXT =
  'Too many screens are waiting to pair · trying again in 1 min';

/** `n` bytes from the CSPRNG. */
const bytesOf = (cryptoObj, n) => cryptoObj.getRandomValues(new Uint8Array(n));
/** Bytes as base64url, no padding (as Buffer's 'base64url'). */
const B64URL =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function base64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const left = bytes.length - i;
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
    if (left > 1) out += B64URL[(n >> 6) & 63];
    if (left > 2) out += B64URL[n & 63];
  }
  return out;
}
/** A uniform integer in [0, n) from the CSPRNG (rejection, no bias). */
function uniformInt(cryptoObj, n) {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    cryptoObj.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/**
 * Random values (S-7, SEC-4). From the CSPRNG (`crypto.getRandomValues`,
 * in Node and in every browser, secure context or not) unless a test
 * passes `random` (a function → [0, 1)), which keeps the old shapes so
 * seeded tests stay deterministic. Never Math.random.
 */
export function randomSource(random = null, cryptoObj = globalThis.crypto) {
  if (typeof random === 'function')
    return {
      token: () =>
        Array.from({ length: 24 }, () =>
          Math.floor(random() * 36).toString(36),
        ).join(''),
      code: () => Math.floor(random() * 10000),
      id: () =>
        Array.from({ length: 16 }, () =>
          Math.floor(random() * 256)
            .toString(16)
            .padStart(2, '0'),
        ).join(''),
    };
  return {
    token: () => base64url(bytesOf(cryptoObj, 32)),
    code: () => uniformInt(cryptoObj, 10000),
    id: () =>
      Array.from(bytesOf(cryptoObj, 16), (x) =>
        x.toString(16).padStart(2, '0'),
      ).join(''),
  };
}

/**
 * sha256 and a constant-time compare from node:crypto, reached at the
 * first use through process.getBuiltinModule (Node ≥ 22.3): no static
 * node: import, so the module still loads in a browser bundle; there it
 * throws at the first token, and the host never runs there.
 */
function builtinTokens() {
  let c = null;
  const crypto = () => {
    c ||= globalThis.process?.getBuiltinModule?.('node:crypto');
    if (!c) throw new Error('twinSessionHost: no sha256 here; pass `tokens`');
    return c;
  };
  const hash = (t) =>
    crypto().createHash('sha256').update(String(t), 'utf8').digest('hex');
  return {
    hash,
    same(t, h) {
      if (typeof t !== 'string' || !t) return false;
      if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) return false;
      return crypto().timingSafeEqual(
        Buffer.from(hash(t), 'hex'),
        Buffer.from(h, 'hex'),
      );
    },
  };
}

const refNo = (ref) => (isRef(ref) ? Number(ref.slice(1)) : 0);
const HOST_ENTRY = Object.freeze({ kind: 'host', name: HOST_NAME, slot: null });

/**
 * The kind name for a remote (CF-D8): the Trip Twin computer when its
 * socket is on this computer, else the page's kind from a closed list
 * (remote.js sends 'iPad', 'Phone' or 'Laptop'); anything else is a
 * Laptop, as remote.js itself decides. Never free text.
 */
export function remoteKindName(name, { local = false } = {}) {
  if (local) return HOST_NAME;
  return REMOTE_NAMES.includes(name) ? name : 'Laptop';
}

/** "iPad", then "iPad 2", "iPad 3" … : the first name not in `taken`. */
export function uniqueName(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1)
    if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/**
 * Rewrite every attribution in a state to a ref (restore migration,
 * BE-1): a ref the table knows stays; a device id becomes that device's
 * ref; 'setup' (the pre-K5 host writer) becomes the host; anything else
 * (an unknown id, the old default 'remote') becomes null. In place.
 */
export function migrateAttribution(session, { refs, refOfId }) {
  const fix = (by) =>
    by == null
      ? null
      : refs[by] || by === HOST_REF
        ? by
        : refOfId(by) || (by === 'setup' ? HOST_REF : null);
  const fixMeta = (meta) => {
    if (!meta || typeof meta !== 'object') return;
    for (const m of Object.values(meta))
      if (m && typeof m === 'object' && 'by' in m) m.by = fix(m.by);
  };
  for (const s of Object.values(session?.screens || {})) fixMeta(s?.meta);
  fixMeta(session?.session?.meta);
  if (session?.lastUndo && typeof session.lastUndo === 'object')
    session.lastUndo.by = fix(session.lastUndo.by);
  return session;
}

/** Every ref a state names (to resolve in presence `actors`). */
export function refsInState(session) {
  const out = new Set();
  const add = (meta) => {
    for (const m of Object.values(meta || {})) if (isRef(m?.by)) out.add(m.by);
  };
  for (const s of Object.values(session?.screens || {})) add(s?.meta);
  add(session?.session?.meta);
  if (isRef(session?.lastUndo?.by)) out.add(session.lastUndo.by);
  return out;
}

/** Slots 1–6 a value names, or null. */
const slotOr = (v) => (Number(v) >= 1 && Number(v) <= 6 ? Number(v) : null);

/**
 * What one command changed, field by field, for the audit (`cmd.applied`
 * diffs): raw values here; auditLog.js keeps only what each field allows.
 */
export function commandDiffs(before, after, cmd, changed = []) {
  const out = [];
  const patch = cmd?.patch && typeof cmd.patch === 'object' ? cmd.patch : {};
  const same = (a, b) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (cmd?.type === 'session') {
    const keys = new Set(Object.keys(patch));
    if (keys.has('report')) keys.add('incidentAck');
    for (const k of keys)
      if (
        k in (after.session || {}) &&
        !same(before.session?.[k], after.session[k])
      )
        out.push({
          scope: 'session',
          field: k,
          from: before.session?.[k] ?? null,
          to: after.session[k] ?? null,
        });
  }
  if (cmd?.type === 'screens')
    for (const slot of changed)
      for (const k of Object.keys(patch)) {
        const b = after.screens?.[slot];
        if (!b || !(k in b)) continue;
        const a = before.screens?.[slot]?.[k];
        if (same(a, b[k])) continue;
        out.push({
          scope: `S${slot}`,
          field: k,
          from: a ?? null,
          to: b[k] ?? null,
        });
      }
  return out;
}

export function createSessionHost({
  now = () => Date.now(),
  random = null,
  restore = null,
  emit = null,
  tokens = builtinTokens(),
} = {}) {
  // Audit listeners (K6): called synchronously, in order; a listener that
  // throws never stops the operation.
  const listeners = emit ? [emit] : [];
  const say = (type, ev) => {
    for (const fn of listeners)
      try {
        fn(type, ev);
      } catch {
        /* the log never stops the wall */
      }
  };
  let session = restore?.session || createSession({ epochMs: now() });
  // id → {kind, slot, tokenHash, name, ref, lastSeen, online} (L5: never
  // the token; a restored plain `token` is hashed here).
  const devices = new Map(
    (restore?.devices || []).map(([id, d]) => {
      const { token: plain, ...rest } = d || {};
      if (typeof plain === 'string' && plain && !rest.tokenHash)
        rest.tokenHash = tokens.hash(plain);
      return [id, { ...rest, online: false }];
    }),
  );
  /** Does this record's pairing match the token presented? */
  const holds = (d, tk) =>
    Boolean(d?.tokenHash) && tokens.same(tk, d.tokenHash);
  // ref → {kind, name, slot}: every ref ever issued (F-0003). D0 is the host.
  const refs = {};
  for (const [r, e] of Object.entries(restore?.refs || {}))
    if (isRef(r) && r !== HOST_REF && e && typeof e === 'object')
      refs[r] = {
        kind: String(e.kind || ''),
        name: String(e.name || '').slice(0, 24),
        slot: Number.isInteger(e.slot) ? e.slot : null,
      };
  // A build from before K5 that ran on this store (a revert) keeps the
  // devices' refs but drops the table: rebuild those entries, so a ref in
  // the state still names the device it named, and is never issued again.
  for (const [, d] of devices)
    if (isRef(d.ref) && d.ref !== HOST_REF && !refs[d.ref]) {
      if (d.kind === 'remote' && d.tokenHash)
        refs[d.ref] = {
          kind: 'remote',
          name:
            REMOTE_NAMES.includes(d.name) || d.name === HOST_NAME
              ? d.name
              : 'Laptop',
          slot: null,
        };
      else if (d.kind === 'screen' && d.slot)
        refs[d.ref] = { kind: 'screen', name: `S${d.slot}`, slot: d.slot };
    }
  let nextRef = Math.max(
    1,
    Number.isInteger(restore?.nextRef) ? restore.nextRef : 1,
    ...Object.keys(refs).map((r) => refNo(r) + 1),
    ...[...devices.values()].map((d) => refNo(d.ref) + 1),
    // A ref the state names but no record holds (dropped by a reverted
    // build) is never issued again; the migration below clears it.
    ...[...refsInState(session)].map((r) => refNo(r) + 1),
  );
  const rng = randomSource(random);
  // code → {deviceId, expires, ip, local, tries}: a waiting screen's only
  // record (K7: never saved).
  const codes = new Map();
  let tokensIssued = 0;
  let tries = 0;
  let lockedUntil = 0;
  let lease = restore?.lease || { holder: null, at: 0 };
  let handover = null; // {from, at}
  // Setup tokens: the computer that chose Multi-view opens its own screen
  // windows and shows a QR for the remote; both carry this token.
  const setups = new Map(); // token → {expires}
  const undos = new Map(); // id → {undo, expires, of}

  /** Names taken by devices on the wall now, for one kind. */
  const namesInUse = (kind, notId = null) => {
    const out = new Set();
    for (const [id, d] of devices)
      if (id !== notId && d.kind === kind && refs[d.ref])
        out.add(refs[d.ref].name);
    return out;
  };
  /** A new ref for this device, with its name fixed for good. */
  const issueRef = (id, d, name) => {
    const ref = `D${nextRef++}`;
    refs[ref] = {
      kind: d.kind,
      name,
      slot: d.kind === 'screen' ? d.slot : null,
    };
    d.ref = ref;
    return ref;
  };
  /**
   * A paired screen's ref names its slot ("S4"). A screen moved to
   * another slot gets a new ref, so an old "by S2" never reads "S4".
   */
  const screenRef = (id, d) =>
    refs[d.ref]?.kind === 'screen' && refs[d.ref].slot === d.slot
      ? d.ref
      : issueRef(id, d, `S${d.slot}`);
  const refOfId = (id) => {
    const r = devices.get(id)?.ref;
    return refs[r] ? r : null;
  };

  // Restore migration (BE-1): before the first broadcast. Devices from a
  // pre-K5 store (or written by a reverted build) get refs; a ref two
  // records claim stays with the first; attributions become refs.
  {
    const seen = new Set();
    // First the records whose ref is good, so new names avoid theirs.
    for (const [, d] of devices)
      if (refs[d.ref] && !seen.has(d.ref) && refs[d.ref].kind === d.kind)
        seen.add(d.ref);
      else delete d.ref;
    for (const [id, d] of devices) {
      if (!d.ref && d.kind === 'screen' && d.slot && d.tokenHash)
        screenRef(id, d);
      if (!d.ref && d.kind === 'remote' && d.tokenHash) {
        const base =
          REMOTE_NAMES.includes(d.name) || d.name === HOST_NAME
            ? d.name
            : 'Laptop';
        issueRef(id, d, uniqueName(base, namesInUse('remote', id)));
      }
      if (d.kind === 'remote' && refs[d.ref]) d.name = refs[d.ref].name;
    }
    migrateAttribution(session, { refs, refOfId });
  }

  /** The public actor for a ref (§4.4); null for a ref never issued. */
  function actor(ref, via = VIA.TOUCH) {
    if (ref === HOST_REF) return { ref, ...HOST_ENTRY, via: VIA.SYSTEM };
    const e = refs[ref];
    return e ? { ref, kind: e.kind, name: e.name, slot: e.slot, via } : null;
  }
  /** Presence `actors`: devices on the wall, the host, refs the state names. */
  function actors() {
    const out = new Map([
      [HOST_REF, { ref: HOST_REF, ...HOST_ENTRY, online: true }],
    ]);
    for (const [, d] of devices)
      if (refs[d.ref])
        out.set(d.ref, {
          ref: d.ref,
          ...refs[d.ref],
          online:
            d.online !== false && (d.kind !== 'screen' || Boolean(d.slot)),
        });
    for (const r of refsInState(session))
      if (!out.has(r) && refs[r])
        out.set(r, { ref: r, ...refs[r], online: false });
    return [...out.values()].sort((a, b) => refNo(a.ref) - refNo(b.ref));
  }

  /** The actor of a device id for an event, or null (no ref yet). */
  const actorOfId = (id, via = VIA.TOUCH) => {
    const r = refOfId(id);
    return r ? actor(r, via) : null;
  };
  const refsOf = (ids = []) => ids.map(refOfId).filter(Boolean);

  /** A setup token (not saved). */
  const token = () => rng.token();
  /**
   * A device token for `d`: its hash goes on the record, the token goes
   * back to the caller (to send once). Counted, so the relay writes the
   * store at once.
   */
  const deviceToken = (d) => {
    tokensIssued += 1;
    const tk = rng.token();
    d.tokenHash = tokens.hash(tk);
    return tk;
  };
  /** A free code in at most CODE_DRAWS draws, else null (never a spin). */
  const newCode = () => {
    for (let i = 0; i < CODE_DRAWS; i += 1) {
      const c = String(rng.code()).padStart(4, '0');
      if (!codes.has(c)) return c;
    }
    return null;
  };
  /** Drop expired codes; the device ids they were for. */
  const purge = (t) => {
    const out = [];
    for (const [c, v] of codes)
      if (v.expires <= t) {
        codes.delete(c);
        out.push(v.deviceId);
      }
    return out;
  };
  const deny = (code, error, extra = {}) => ({
    type: 'denied',
    code,
    error,
    ...extra,
  });
  /** BUSY until the soonest code expires (1 s … 5 min). */
  const busy = (t, limit) =>
    deny(DENY.BUSY, BUSY_TEXT, {
      limit,
      retryAfterMs: Math.max(
        1000,
        Math.min(
          CODE_TTL_MS,
          Math.min(...[...codes.values()].map((v) => v.expires)) - t,
        ) || CODE_TTL_MS,
      ),
    });
  /**
   * A code for a waiting screen, within the caps (S-16): 20 in all, 6 per
   * IP unless on this computer. Returns {code, expires} or a BUSY refusal.
   */
  function issueCode(id, t, { ip = null, local = false } = {}) {
    purge(t);
    for (const [c, v] of codes) if (v.deviceId === id) codes.delete(c);
    if (codes.size >= CODES_TOTAL) return busy(t, 'codes-total');
    if (!local) {
      let mine = 0;
      for (const v of codes.values()) if (v.ip === ip) mine += 1;
      if (mine >= CODES_PER_IP) return busy(t, 'codes-ip');
    }
    const code = newCode();
    if (!code) return busy(t, 'code-draws');
    codes.set(code, {
      deviceId: id,
      expires: t + CODE_TTL_MS,
      ip,
      local: Boolean(local),
      tries: 0,
    });
    return { code, expires: t + CODE_TTL_MS };
  }
  const leaseLive = () => lease.holder && now() - lease.at < LEASE_MS;
  const holderOnline = () =>
    leaseLive() && devices.get(lease.holder)?.online !== false;
  /** Free the slot for a new device; the old device is told (R10). */
  function freeSlot(slot, keepId) {
    const out = [];
    for (const [id, d] of devices)
      if (d.kind === 'screen' && d.slot === slot && id !== keepId) {
        d.slot = null;
        d.tokenHash = null;
        out.push(id);
      }
    return out;
  }

  /** Presence with device ids — the relay strips ids per socket. */
  function presence() {
    const screens = {};
    const remotes = [];
    for (const [id, d] of devices) {
      if (d.kind === 'screen' && d.slot)
        screens[d.slot] = {
          online: d.online !== false,
          lastSeen: d.lastSeen,
          id,
          ref: d.ref ?? null,
        };
      if (d.kind === 'remote')
        remotes.push({
          id,
          ref: d.ref ?? null,
          name: refs[d.ref]?.name || d.name,
          online: d.online !== false,
          // A dropped remote keeps the lease for 30 s so it can come back,
          // but walls say "Remote offline" at once.
          controller: lease.holder === id && holderOnline(),
          controlSince:
            lease.holder === id && holderOnline()
              ? (lease.since ?? lease.at)
              : null,
        });
    }
    return {
      screens,
      remotes,
      actors: actors(),
      controller: holderOnline() ? lease.holder : null,
      handover: handover && {
        from: handover.from,
        fromRef: devices.get(handover.from)?.ref ?? null,
        fromName: devices.get(handover.from)?.name || 'Another remote',
        at: handover.at,
      },
    };
  }
  /** The lease to a new holder: `since` is when it changed hands. */
  const grant = (id) => {
    const t = now();
    lease = {
      holder: id,
      at: t,
      since: lease.holder === id ? (lease.since ?? t) : t,
    };
  };

  const api = {
    get state() {
      return session;
    },
    presence,
    actor,
    /** Add an audit listener `(type, {actor, rev, data})` (K6). */
    onEvent(fn) {
      if (typeof fn === 'function') listeners.push(fn);
    },
    /** The ref of a device id, or null (K6: for the relay's own events). */
    refOf: refOfId,
    /** The actor for a device id (the relay's socket), or null. */
    actorOf(id, via = VIA.TOUCH) {
      const r = refOfId(id);
      return r ? actor(r, via) : null;
    },
    /** What the relay saves to disk (no setup tokens or codes; L5: hashes). */
    snapshot() {
      return {
        session,
        devices: [...devices],
        lease,
        refs: { ...refs },
        nextRef,
      };
    },
    /** Start a multi-view setup for N screens: a fresh wall. */
    setup({ count = 4, tripId = null, siteKey = null } = {}) {
      const t = now();
      const prevRev = session.rev;
      session = createSession({ count, epochMs: t });
      session.rev = prevRev + 1;
      session = applyCommand(
        session,
        { type: 'session', patch: { tripId, siteKey } },
        { by: HOST_REF, at: t },
      ).state;
      session.session.epochMs = t;
      const tk = token();
      setups.set(tk, { expires: t + SETUP_TTL_MS });
      say('session.setup', {
        actor: actor(HOST_REF),
        rev: { before: prevRev, after: session.rev },
        data: { ok: true, count: session.count, tripId, siteKey },
      });
      return { setup: tk, expires: t + SETUP_TTL_MS, count: session.count };
    },
    /**
     * A device says hello. Returns {type, …, unpaired: [ids to tell]}; a
     * refusal is {type: 'denied', code, error} (twinProtocol.js DENY).
     * An id that holds a token belongs to that device: claiming it without
     * the token is refused (review/phase10 R1).
     * `live` (from the relay): {kind, slot} of a socket that already holds
     * this id. The same token for the same place is a reload, a restored
     * window or a duplicated tab: accepted, and the relay replaces the old
     * socket. Another place means the id was copied into a second window
     * (window.open copies sessionStorage): ID_COPIED, the newcomer takes
     * a fresh id (C16, SEC-9).
     */
    hello({
      id,
      kind,
      token: tk = null,
      name = '',
      setup = null,
      slot = null,
      live = null,
      local = false,
      ip = null,
    }) {
      const t = now();
      if (!id || typeof id !== 'string')
        return deny(DENY.NO_ID, 'No device id');
      const known = devices.get(id);
      const setupOk = Boolean(setup) && setups.get(setup)?.expires > t;
      if (known?.tokenHash && !holds(known, tk))
        return deny(DENY.ID_IN_USE, 'This device id is already in use');
      if (kind === 'launcher')
        return setupOk
          ? { type: 'launcher' }
          : setup
            ? deny(
                DENY.TICKET_EXPIRED,
                'This launch link has expired · start Multi-view again on the Trip Twin computer',
              )
            : deny(DENY.NOT_TRUSTED, 'Start multi-view on this computer');
      if (kind !== 'screen' && kind !== 'remote')
        return deny(DENY.UNKNOWN_KIND, 'Unknown device');
      // A token proves the device, not a change of kind.
      if (known?.tokenHash && known.kind !== kind)
        return deny(DENY.ID_IN_USE, 'This device id is already in use');
      const hint = Number(slot) >= 1 && Number(slot) <= 6 ? Number(slot) : null;
      if (live) {
        const place = kind === 'screen' ? (hint ?? known?.slot ?? null) : null;
        if (live.kind !== kind || (live.slot ?? null) !== place)
          return deny(
            DENY.ID_COPIED,
            'This device id is open in another window · this window takes a new one',
          );
      }
      if (kind === 'screen') {
        if (setupOk && hint) {
          const s = hint;
          const unpaired = freeSlot(s, id);
          const d = {
            kind: 'screen',
            slot: s,
            tokenHash: null,
            ref: known?.ref,
            lastSeen: t,
            online: true,
          };
          const issued = deviceToken(d);
          devices.set(id, d);
          screenRef(id, d);
          if (!session.screens[s])
            session = applyCommand(
              session,
              { type: 'count', n: Math.max(s, session.count) },
              { by: HOST_REF, at: t },
            ).state;
          return { type: 'paired', slot: s, token: issued, unpaired };
        }
        if (known?.tokenHash && known.slot) {
          known.lastSeen = t;
          known.online = true;
          // The token it showed (checked above): the host has only its hash.
          return { type: 'paired', slot: known.slot, token: tk };
        }
        // Say why instead of a bare code (R-1): the window drops the link
        // and asks again without it, which gives the pair card.
        if (setup && !setupOk)
          return deny(
            DENY.TICKET_EXPIRED,
            'This screen link has expired · open the screen from the launcher again, or pair it with a code',
          );
        const got = issueCode(id, t, { ip, local });
        if (got.type === 'denied') return got;
        // A screen this host knew keeps its ref (it may pair back); a new
        // one is not a device until it is paired (K7: nothing saved).
        if (known)
          devices.set(id, {
            kind,
            ...(known.ref ? { ref: known.ref } : {}),
            lastSeen: t,
            online: true,
          });
        return {
          type: 'pair-code',
          code: got.code,
          expires: got.expires,
          ttlMs: CODE_TTL_MS,
        };
      }
      // Remotes need the setup QR or their own token from an earlier pairing.
      const trusted = setupOk || (known?.kind === 'remote' && known.tokenHash);
      if (!trusted) {
        // The token is the pairing: when it is gone, say that first.
        if (tk)
          return deny(
            DENY.FORGOTTEN,
            'The Trip Twin computer no longer knows this remote · scan the QR on the Trip Twin computer to pair it again',
          );
        if (setup)
          return deny(
            DENY.TICKET_EXPIRED,
            'This pairing code has expired · scan the QR on the Trip Twin computer again',
          );
        return deny(
          DENY.NOT_TRUSTED,
          'Scan the QR on the Trip Twin computer to pair this remote',
        );
      }
      // The host names a remote once, at pairing; later hellos keep it.
      const d = {
        kind: 'remote',
        name: '',
        tokenHash: known?.tokenHash || null,
        ref: known?.ref,
        lastSeen: t,
        online: true,
      };
      // A known remote showed its token (checked above); a new one gets one.
      const rt = d.tokenHash ? tk : deviceToken(d);
      if (!(refs[d.ref]?.kind === 'remote'))
        issueRef(
          id,
          d,
          uniqueName(remoteKindName(name, { local }), namesInUse('remote', id)),
        );
      d.name = refs[d.ref].name;
      devices.set(id, d);
      if (!holderOnline()) grant(id);
      return { type: 'remote', token: rt, controller: lease.holder === id };
    },
    /** The remote enters a screen's code and gives it a slot (1–6). */
    pair({ by, code, slot }) {
      const t = now();
      const failed = (reason, r) => {
        say('pair.failed', {
          actor: actorOfId(by),
          data: { reason, tries, locked: t < lockedUntil },
        });
        return r;
      };
      if (lease.holder !== by || !leaseLive())
        return failed('lease', {
          ok: false,
          code: CODE.LEASE_NOT_CONTROLLER,
          error: 'Only the remote in control can pair',
        });
      // The words the remote shows as they are (K8, SUP-5): tries left,
      // and when a pause ends (this computer's clock).
      if (t < lockedUntil)
        return failed('locked', {
          ok: false,
          error: pairLockedText(lockedUntil),
        });
      purge(t);
      const c = codes.get(String(code));
      if (!c) {
        tries += 1;
        if (tries >= MAX_TRIES) {
          lockedUntil = t + 60000;
          tries = 0;
          return failed('code', {
            ok: false,
            error: pairLockedText(lockedUntil),
          });
        }
        return failed('code', {
          ok: false,
          error: pairWrongText(MAX_TRIES - tries),
        });
      }
      tries = 0;
      const s = Number(slot);
      // A wrong slot is a slip, not a guess: the code stays for 3 tries.
      if (!(s >= 1 && s <= 6)) {
        c.tries += 1;
        if (c.tries >= CODE_TRIES) codes.delete(String(code));
        return failed('slot', { ok: false, error: 'Slot must be 1–6' });
      }
      codes.delete(String(code)); // single use
      const unpaired = freeSlot(s, c.deviceId);
      const d = devices.get(c.deviceId) || { kind: 'screen' };
      d.slot = s;
      const issued = deviceToken(d);
      d.lastSeen = t;
      devices.set(c.deviceId, d);
      screenRef(c.deviceId, d);
      const revBefore = session.rev;
      // The wall grows to fit as part of pairing: written by the host.
      if (!session.screens[s])
        session = applyCommand(
          session,
          { type: 'count', n: Math.max(s, session.count) },
          { by: HOST_REF, at: t },
        ).state;
      say('device.paired', {
        actor: actorOfId(by),
        rev:
          session.rev !== revBefore
            ? { before: revBefore, after: session.rev }
            : null,
        data: {
          slot: s,
          screenRef: refOfId(c.deviceId),
          method: 'code',
          unpairedRefs: refsOf(unpaired),
        },
      });
      return {
        ok: true,
        deviceId: c.deviceId,
        slot: s,
        token: issued,
        unpaired,
      };
    },
    /** Heartbeat from any device; the controller's renews the lease. */
    beat(id) {
      const d = devices.get(id);
      if (!d) return;
      d.lastSeen = now();
      d.online = true;
      if (lease.holder === id) lease.at = now();
    },
    gone(id) {
      const d = devices.get(id);
      if (d) d.online = false;
      // A remote that asked for control and left takes its request with it.
      if (handover?.from === id) handover = null;
    },
    /**
     * A viewer asks for control. Granted at once only when nobody is in
     * control (offline or lapsed); otherwise the controller decides —
     * never silently (review/phase10 R14).
     */
    requestControl(id) {
      if (!holderOnline() || lease.holder === id) {
        const how = lease.holder === id ? 'renewed' : 'request';
        grant(id);
        handover = null;
        say('lease.granted', { actor: actorOfId(id), data: { how } });
        return { granted: true };
      }
      handover = { from: id, at: now() };
      say('handover.requested', {
        actor: actorOfId(id),
        data: { toRef: refOfId(lease.holder) },
      });
      return { granted: false, pending: true };
    },
    answerHandover(by, accept) {
      const from = handover?.from ?? null;
      const ok = by === lease.holder && Boolean(handover);
      if (ok && accept) grant(handover.from);
      if (ok) handover = null;
      say('handover.answered', {
        actor: actorOfId(by),
        data: { ok, accept: Boolean(accept), fromRef: refOfId(from) },
      });
      return ok;
    },
    isController(id) {
      return lease.holder === id && leaseLive();
    },
    /** Run a command from the controlling remote. */
    command({ by, cmd }) {
      const refused = (r, field = null) => {
        say('cmd.refused', {
          actor: actorOfId(by),
          data: { type: cmd?.type, code: r.code, field },
        });
        return r;
      };
      if (!(lease.holder === by && leaseLive()))
        return refused({
          ok: false,
          code: CODE.LEASE_NOT_CONTROLLER,
          error: 'This remote is not in control',
        });
      // Attribution is the socket's, never the message's (S-18, F-0009).
      const claimed =
        cmd && typeof cmd === 'object'
          ? ACTOR_KEYS.find((k) => Object.hasOwn(cmd, k))
          : null;
      if (claimed)
        return refused(
          {
            ok: false,
            code: CODE.VALIDATION_COMMAND,
            error: `Not applied: ${claimed} is not valid`,
          },
          claimed,
        );
      const r = applyCommand(session, cmd, { by: refOfId(by), at: now() });
      if (r.error)
        return refused({
          ok: false,
          code: CODE.UNKNOWN_COMMAND,
          error: r.error,
        });
      const before = session;
      session = r.state;
      lease.at = now();
      const undoId = rng.id();
      undos.set(undoId, {
        undo: r.undo,
        expires: now() + UNDO_MS,
        of: session.rev,
      });
      for (const [k, v] of undos) if (v.expires < now()) undos.delete(k);
      say('cmd.applied', {
        actor: actorOfId(by),
        rev: { before: before.rev, after: session.rev },
        corr: { undoId },
        data: {
          type: cmd.type,
          target: cmd.target ?? null,
          fields: Object.keys(cmd.patch || {}),
          diffs: commandDiffs(before, session, cmd, r.changed),
          changed: r.changed,
          skipped: r.skipped,
        },
      });
      return {
        ok: true,
        rev: session.rev,
        changed: r.changed,
        skipped: r.skipped,
        undoId,
      };
    },
    /**
     * A paired screen changes its own layers and display from its keyboard
     * (L / D at the wall; Jesse, 23 Oct 2026). Its own slot only, these
     * fields only, no lease needed: the session stays the one truth, so
     * the remote shows the change at once. Role, mode, pin and anything
     * wall-wide stay on the remote.
     * CF: attributed to the wall's own ref with via 'keyboard', logged as
     * cmd.applied / cmd.refused like a remote's command; no Undo entry
     * (the wall's sheet sets the value back itself). The command is
     * rebuilt from the allowlist below, so no actor field can ride along.
     */
    screenCommand({ by, cmd }) {
      const refused = (error, code = CODE.VALIDATION_COMMAND) => {
        say('cmd.refused', {
          actor: actorOfId(by, VIA.KEYBOARD),
          data: { type: cmd?.type, code, field: null },
        });
        return { ok: false, code, error };
      };
      const d = devices.get(by);
      if (d?.kind !== 'screen' || !d.slot)
        return refused('This screen is not paired');
      const own = Number(cmd?.target) === d.slot;
      let safe = null;
      if (cmd?.type === 'reset' && own)
        safe = { type: 'reset', target: d.slot };
      if (cmd?.type === 'screens' && own) {
        const p = cmd.patch || {};
        const patch = {};
        const flags = (o, keys) =>
          Object.fromEntries(
            Object.entries(o && typeof o === 'object' ? o : {})
              .filter(([k, v]) => keys.has(k) && typeof v === 'boolean')
              .slice(0, 40),
          );
        if ('layers' in p) {
          const l = flags(p.layers, LAYER_KEYS);
          if (Object.keys(l).length) patch.layers = l;
        }
        if ('motion' in p) {
          const m = flags(p.motion, MOTION_KEYS);
          if (Object.keys(m).length) patch.motion = m;
        }
        if (SCALES.has(p.scale)) patch.scale = p.scale;
        if (Number.isFinite(p.textScale))
          patch.textScale = Math.max(1, Math.min(3.5, p.textScale));
        if (Object.keys(patch).length)
          safe = { type: 'screens', target: d.slot, patch };
      }
      if (!safe)
        return refused('A screen changes only its own layers and display');
      const r = applyCommand(session, safe, { by: refOfId(by), at: now() });
      if (r.error) return refused(r.error, CODE.UNKNOWN_COMMAND);
      const before = session;
      session = r.state;
      say('cmd.applied', {
        actor: actorOfId(by, VIA.KEYBOARD),
        rev: { before: before.rev, after: session.rev },
        data: {
          type: safe.type,
          target: safe.target,
          fields: Object.keys(safe.patch || {}),
          diffs: commandDiffs(before, session, safe, r.changed),
          changed: r.changed,
          skipped: r.skipped || [],
        },
      });
      return {
        ok: true,
        rev: session.rev,
        changed: r.changed,
        skipped: r.skipped || [],
      };
    },
    undo({ by, undoId }) {
      const u = undos.get(undoId);
      const refused = (r) => {
        say('undo.refused', { actor: actorOfId(by), data: { code: r.code } });
        return r;
      };
      if (!(lease.holder === by && leaseLive()))
        return refused({
          ok: false,
          code: CODE.LEASE_NOT_CONTROLLER,
          error: 'This remote is not in control',
        });
      if (!u || u.expires < now())
        return refused({
          ok: false,
          code: CODE.UNDO_EXPIRED,
          error: 'Undo is no longer available',
        });
      undos.delete(undoId);
      const before = session.rev;
      session = applyUndo(session, u.undo, {
        by: refOfId(by),
        at: now(),
        of: u.of,
      });
      say('undo.applied', {
        actor: actorOfId(by),
        rev: { before, after: session.rev },
        corr: { undoId },
        data: { of: u.of },
      });
      return { ok: true, rev: session.rev, of: u.of };
    },
    /** A device's slot (to address thumbnails and identify). */
    slotOf(id) {
      return devices.get(id)?.slot ?? null;
    },
    kindOf(id) {
      return devices.get(id)?.kind ?? null;
    },
    /**
     * The relay's sweep (K7, SUP-5): expired codes go; the device ids they
     * were for, so a screen still waiting is given a new one.
     */
    purgeCodes() {
      return purge(now());
    },
    /** A new code for a screen still waiting (its old one expired). */
    reissueCode(id, { ip = null, local = false } = {}) {
      const got = issueCode(String(id), now(), { ip, local });
      return got.type === 'denied'
        ? got
        : { type: 'pair-code', ...got, ttlMs: CODE_TTL_MS };
    },
    /** True when this device has a code that has not expired. */
    hasCode(id) {
      const t = now();
      for (const v of codes.values())
        if (v.deviceId === id && v.expires > t) return true;
      return false;
    },
    /** A waiting screen closed: its code goes with it. */
    dropCode(id) {
      for (const [c, v] of codes) if (v.deviceId === id) codes.delete(c);
    },
    /** Outstanding codes (tests, health). */
    codesOut() {
      purge(now());
      return codes.size;
    },
    /** Device tokens minted so far: a change means write the store now. */
    get tokensIssued() {
      return tokensIssued;
    },
  };

  // One `device.hello` per hello, whatever the outcome (K6; CF-D11: the
  // fields that tell the next lost pairing apart). Never the id, the
  // token, the setup link or the page's own name.
  const helloOf = api.hello;
  api.hello = (args = {}) => {
    const id = typeof args.id === 'string' ? args.id : '';
    const before = (id && devices.get(id)?.tokenHash) || null;
    const r = helloOf(args);
    const accepted = r.type !== 'denied';
    say('device.hello', {
      actor: accepted && args.kind !== 'launcher' ? actorOfId(id) : null,
      data: {
        outcome: r.type,
        code: r.code ?? null,
        kind: args.kind,
        slotAsked: slotOr(args.slot),
        slotGiven: r.slot ?? null,
        viaSetup: Boolean(args.setup),
        viaToken: Boolean(args.token),
        // Kept: it had a pairing and was handed back the token it showed.
        token: !r.token
          ? 'none'
          : before && r.token === args.token
            ? 'kept'
            : 'issued',
        replaces: accepted && Boolean(args.live),
        unpairedRefs: refsOf(r.unpaired),
        controller: r.type === 'remote' ? Boolean(r.controller) : null,
      },
    });
    return r;
  };
  return api;
}
