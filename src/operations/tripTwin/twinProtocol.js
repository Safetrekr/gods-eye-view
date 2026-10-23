// Trip Twin multi-view wire names and codes (Phase CF K4, K5;
// PHASE-CF-PLAN S-8, S-15, S-16, S-18, §4.4, C16). One list for the relay,
// the session host, the walls and the remote: hello deny codes, command
// codes, the protocol version, actor refs and kind names, and the message
// shape used by the schema-hash test. Pure: constants and small helpers.

/** Hello deny codes: `{t:'welcome', type:'denied', code, error}`. */
export const DENY = Object.freeze({
  NO_ID: 'NO_ID',
  ID_IN_USE: 'ID_IN_USE',
  ID_COPIED: 'ID_COPIED',
  TICKET_USED: 'TICKET_USED',
  TICKET_EXPIRED: 'TICKET_EXPIRED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORGOTTEN: 'FORGOTTEN',
  RATE_LIMITED: 'RATE_LIMITED',
  BUSY: 'BUSY',
  NOT_TRUSTED: 'NOT_TRUSTED',
  UNKNOWN_KIND: 'UNKNOWN_KIND',
  ALREADY_IDENTIFIED: 'ALREADY_IDENTIFIED',
  BOOT_STALE: 'BOOT_STALE',
  RELOAD: 'RELOAD',
});

/**
 * Terminal deny codes (S-16): the client drops that token or ticket and
 * stops reconnecting with it. A wall falls to a fresh id and the pair
 * card; a remote or a launcher shows its refusal and stops.
 */
export const TERMINAL_DENY = Object.freeze([
  DENY.FORGOTTEN,
  DENY.TOKEN_EXPIRED,
  DENY.ID_IN_USE,
  DENY.TICKET_USED,
  DENY.TICKET_EXPIRED,
]);

export const isTerminalDeny = (code) => TERMINAL_DENY.includes(code);

/**
 * Why a device lost its pairing: `{t:'unpaired', reason}`. Only these
 * clear a window's identity (C16, review/cf/01-reasoning.md S2).
 */
export const UNPAIRED = Object.freeze({
  FORGOTTEN: 'FORGOTTEN',
  SLOT_TAKEN: 'SLOT_TAKEN',
  EXPIRED: 'EXPIRED',
});

/**
 * A same-id takeover is its own message (C16, sec S13): the older window
 * gets `{t:'replaced'}`, which never touches storage. Old pages ignore an
 * unknown type, so an old `unpaired` handler can never wipe the winner.
 */
export const REPLACED = 'replaced';

/** WebSocket close codes the relay uses. */
export const CLOSE = Object.freeze({
  ALREADY_IDENTIFIED: 4002,
  REPLACED: 4003,
});

// ---------------------------------------------------------------- K5
// Protocol version (S-15, review U-B1, ET S1). Every slice that changes a
// message shape raises PROTO and sets PROTO_MIN = PROTO: K5 → 2, K7 → 3,
// K9 → 4, K10 → 5, K11 → 6. A hello below PROTO_MIN (or with no `proto`:
// every page from before K5) is refused RELOAD with text an old page can
// show. twinProtocol.test.mjs keeps one schema hash per PROTO: a shape
// change without a bump fails it.

/** The wire protocol this build speaks. */
export const PROTO = 2;
/** The oldest page the relay still talks to. */
export const PROTO_MIN = 2;

/** True when a page says a protocol this relay still talks to. */
export const protoOk = (proto) => Number.isInteger(proto) && proto >= PROTO_MIN;

/**
 * The RELOAD text, readable by an old page as it is: the remote shows
 * `error` in its refusal card (remote.js renderDenied), the launcher in
 * its card. Appendix D rows 1, 1a, 1c.
 */
export function reloadText(kind) {
  if (kind === 'remote')
    return 'This remote page is out of date · nothing was sent · Reload';
  if (kind === 'screen')
    return 'This screen page is out of date · it reloads itself';
  return 'This page is out of date · Reload';
}

/**
 * Command refusal codes (02 §3.3, S-8, S-18). Every refusal carries one.
 * 02's IDEMPOTENCY_CONFLICT is CMDID_REUSED here (S-18). Codes not yet
 * sent are listed so the remote and the walls share one list from now on.
 */
export const CODE = Object.freeze({
  LEASE_NOT_CONTROLLER: 'LEASE_NOT_CONTROLLER',
  VALIDATION_COMMAND: 'VALIDATION_COMMAND',
  UNKNOWN_COMMAND: 'UNKNOWN_COMMAND',
  CONFIRM_REQUIRED: 'CONFIRM_REQUIRED',
  CONFIRM_UNKNOWN: 'CONFIRM_UNKNOWN',
  CONFIRM_NOT_YOURS: 'CONFIRM_NOT_YOURS',
  CONFIRM_STALE: 'CONFIRM_STALE',
  CONFIRM_SUPERSEDED: 'CONFIRM_SUPERSEDED',
  PENDING_BUSY: 'PENDING_BUSY',
  UNDO_EXPIRED: 'UNDO_EXPIRED',
  CMDID_REUSED: 'CMDID_REUSED',
  RATE_LIMITED: 'RATE_LIMITED',
  RELOAD: 'RELOAD',
});

/** Why a state broadcast went out: `{t:'state', cause, by?}`. */
export const CAUSE = Object.freeze({
  CMD: 'cmd',
  UNDO: 'undo',
  SETUP: 'setup',
  PAIR: 'pair',
  JOIN: 'join', // a paired screen (re)joined: nothing on the wall changed
});

/**
 * How an actor acted (§4.4). Set by the relay from the socket, never taken
 * from a message. V1 adds 'voice', relay-verified, never client-claimed.
 */
export const VIA = Object.freeze({ TOUCH: 'touch', SYSTEM: 'system' });

/**
 * Attribution (§4.4, CF-D8, F-0003). An actor is
 * `{ref: 'D3', kind, name, slot, via}`; `ref` is public, sequential and
 * persisted, never the device id. State holds only the ref; the host keeps
 * a ref table `{D3: {kind, name, slot}}` for every ref it ever issued, and
 * a ref's name never changes, so a label always reads as it did when the
 * change was made, also after the device is gone.
 */
export const HOST_REF = 'D0';
export const HOST_NAME = 'Trip Twin computer';
/** Kind names only in CF (CF-D8): no initials, no free text. */
export const REMOTE_NAMES = Object.freeze(['iPad', 'Phone', 'Laptop']);
export const isRef = (v) => typeof v === 'string' && /^D\d{1,9}$/.test(v);
/**
 * Fields a client may not set inside `cmd` (S-18, F-0009): refused with
 * VALIDATION_COMMAND. The same names beside `cmd` (the envelope) are
 * ignored: the relay never reads them.
 */
export const ACTOR_FIELDS = Object.freeze([
  'by',
  'via',
  'name',
  'actor',
  'ref',
  'proposalId',
]);

/**
 * The shape of a message: keys and value types, recursively. Keys that
 * are slot numbers fold into one `<n>` key; an array's items merge into
 * one item shape; a field seen with several types lists them (`|`). Two
 * messages with the same fields and types have the same shape, whatever
 * their values, and however many items their lists hold.
 */
export function shapeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v))
    return { '[]': v.reduce((acc, x) => mergeShape(acc, shapeOf(x)), null) };
  if (typeof v !== 'object') return typeof v;
  const out = {};
  for (const k of Object.keys(v).sort()) {
    const key = /^\d+$/.test(k) ? '<n>' : k;
    out[key] = mergeShape(out[key] ?? null, shapeOf(v[k]));
  }
  return sortKeys(out);
}

const sortKeys = (o) =>
  Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );

/**
 * The union of two shapes: at most one object (keys merged), one list
 * (items merged) and a set of primitive types. `null` (JS) is "nothing
 * seen yet" (an empty list's items).
 */
export function mergeShape(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  const prims = new Set();
  let obj = null;
  let arr;
  let hasArr = false;
  for (const x of [...(a['|'] || [a]), ...(b['|'] || [b])]) {
    if (typeof x === 'string') prims.add(x);
    else if ('[]' in x) {
      arr = hasArr ? mergeShape(arr, x['[]']) : x['[]'];
      hasArr = true;
    } else if (obj) {
      const o = { ...obj };
      for (const [k, v] of Object.entries(x))
        o[k] = mergeShape(o[k] ?? null, v);
      obj = sortKeys(o);
    } else obj = x;
  }
  const alts = [
    ...[...prims].sort(),
    ...(hasArr ? [{ '[]': arr ?? null }] : []),
    ...(obj ? [obj] : []),
  ];
  return alts.length === 1 ? alts[0] : { '|': alts };
}

/**
 * The out-of-date reload guard for walls (S-15, Appendix D 1a): reload at
 * most once per `everyMs`, stamped in this window's sessionStorage. With
 * no working storage a wall never reloads itself (it could not tell a
 * loop from a first try) and keeps what it shows.
 * Returns {reload: true} (stamp written), {waitMs} or {reload: false}.
 */
export const RELOAD_EVERY_MS = 2 * 60 * 1000;
export const RELOAD_KEY = 'tripTwin.soc.protoReloadAt';
export function reloadGuard({ storage, now, everyMs = RELOAD_EVERY_MS }) {
  let last;
  try {
    last = Number(storage.getItem(RELOAD_KEY)) || 0;
    const t = now();
    if (last && t - last < everyMs)
      return { reload: false, waitMs: last + everyMs - t };
    storage.setItem(RELOAD_KEY, String(t));
    if (storage.getItem(RELOAD_KEY) !== String(t)) return { reload: false };
    return { reload: true };
  } catch {
    return { reload: false };
  }
}
