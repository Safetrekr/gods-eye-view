// Trip Twin audit log, lean (Phase CF K6; PHASE-CF-PLAN §4.4, S-1, S-19,
// CF-D9, C38, C39, F-0004; cf/02-backend.md BE-5, BE-6, BE-10, BE-11;
// cf/01-security.md SEC-12, C23; cf/07-reasoning.md ET-5 R3; cf/06-qa.md
// QA-7). An accountability and debug log, not tamper evidence: the hash
// chain, the verifier and the Log view are CF-later L8.
//   - One JSON object per line: `{v:1, seq, boot, at, type, actor, rev,
//     corr, data}`, plus `peer` and `secure` on refusal and security
//     events. `seq` continues across restarts and files; `at` is this
//     server's clock only.
//   - Daily files `audit-YYYY-MM-DD.jsonl` (UTC day, as `at`) in
//     TRIP_TWIN_AUDIT_DIR (default ~/Library/Logs/trip-twin/; folder 0700,
//     files 0600; refused inside the repo or Vite's root). A day file rolls
//     to `audit-YYYY-MM-DD.2.jsonl` at 20 MB.
//   - Retention (S-19): 30 days (TRIP_TWIN_AUDIT_DAYS), 200 MB in all,
//     oldest first; pruned at start and every 6 h. The would-refuse file
//     (K3) is kept to the same 30 days and counts in the 200 MB.
//   - Allowlist serialisers: every event type names its fields and what
//     each may hold (a ref, a slot, a code from the protocol list, an id
//     with a separator, a value from a closed list …). Anything else is
//     dropped or replaced, so no token, setup or ticket value, pairing
//     code, confirm id, raw device id, user agent, thumbnail, free text,
//     full state, environment value or audio can reach a line. Confirm
//     events keep question parts (ids), never the rendered text (F-0004).
//   - Writes never block the relay: `emit()` is synchronous and cheap; an
//     async queue (capped at 10,000; the rest counted and written as one
//     `audit.dropped` line) appends in batches. Fail open (CF-D9): a full
//     disk or an unwritable folder never stops a command; health says so,
//     the queue is kept, the folder is tried again every 30 s, and a
//     `log.gap` row is written when it reopens.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveFencedDir } from './sessionStore.js';
import {
  ACTOR_FIELDS,
  CODE,
  DENY,
  DRIFT_REASONS,
  HOST_NAME,
  MSG_TYPES,
  REMOTE_NAMES,
  isRef,
  REVIEW_ITEMS,
  UNDO_SKIP,
  VOICE_REFUSALS,
} from '../../src/operations/tripTwin/twinProtocol.js';
import { LIMIT_NAMES } from './twinLimits.js';
import { VOICE_INTENTS } from './voicePolicy.table.js';
import { ROLES } from '../../src/operations/tripTwin/twinScreenRoles.js';

export const AUDIT_VERSION = 1;
export const AUDIT_DAYS = 30;
export const AUDIT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
export const AUDIT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const AUDIT_QUEUE_CAP = 10000;
export const AUDIT_BATCH = 500;
export const AUDIT_REOPEN_MS = 30 * 1000;
export const AUDIT_PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;
export const AUDIT_RING = 1000;
export const AUDIT_TAIL_MAX = 200;
/** One field's JSON is at most this long (BE-5). */
export const VALUE_MAX = 256;
export const AUDIT_DIR_MODE = 0o700;
export const AUDIT_FILE_MODE = 0o600;
/** K3's record of what the new Host rules would refuse (same folder). */
export const WOULD_REFUSE_FILE = 'would-refuse.jsonl';
const DAY_MS = 24 * 60 * 60 * 1000;
const FILE_RE = /^audit-(\d{4}-\d{2}-\d{2})(?:\.(\d{1,4}))?\.jsonl$/;

/** This checkout: an audit folder inside it is refused (S-1, sec N2). */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/** macOS convention (S-1). */
export const defaultAuditDir = (home = os.homedir()) =>
  path.join(home, 'Library', 'Logs', 'trip-twin');

/** The audit folder, fenced like the data folder (K3). */
export function resolveAuditDir({
  env = process.env,
  home = os.homedir(),
  fences = [],
  fs: fsi = fs,
} = {}) {
  // A test run (node --test) never writes the live folder: without its
  // own TRIP_TWIN_AUDIT_DIR the default is refused (K6 safety net).
  if (
    !env.TRIP_TWIN_AUDIT_DIR &&
    (env.NODE_TEST_CONTEXT || process.env.NODE_TEST_CONTEXT)
  )
    return {
      dir: null,
      source: 'default',
      refused: {
        path: defaultAuditDir(home),
        reason: 'a test run never writes the live log folder',
      },
    };
  return resolveFencedDir({
    name: 'TRIP_TWIN_AUDIT_DIR',
    env,
    fallback: defaultAuditDir(home),
    fences,
    fs: fsi,
  });
}

/** TRIP_TWIN_AUDIT_DAYS: whole days, 1–365; anything else is 30. */
export function auditDays(env = process.env) {
  const n = Number(env.TRIP_TWIN_AUDIT_DAYS);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : AUDIT_DAYS;
}

// ------------------------------------------------------------ field kinds
// Each returns the value as it may be written, or `undefined` (dropped).

/** An id: letters and digits in at least two parts (`twin-MR`, `trip-x`). */
const ID_RE = /^[A-Za-z0-9]+(?:[-_:.][A-Za-z0-9]+)+$/;
const WORD_RE = /^[a-z][a-z-]{0,23}$/;
/** A layer key (`radar3d`, `alertAreas`): shorter than any token. */
const LAYER_RE = /^[a-z][a-zA-Z0-9]{1,19}$/;
const ERR_RE = /^E[A-Z0-9]{2,20}$/;
const UNDO_RE = /^(?:u\d{1,9}|[0-9a-f]{32})$/;
const SLOT_LABELS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
const KNOWN_CODES = new Set([...Object.values(DENY), ...Object.values(CODE)]);
const ROLE_KEYS = Object.keys(ROLES);
const SCREEN_FIELDS = [
  'role',
  'mode',
  'day',
  'scale',
  'textScale',
  'pinned',
  'layers',
  'frame',
  'motion',
  'layout',
];
const SESSION_FIELDS = [
  'tripId',
  'siteKey',
  'wxAt',
  'report',
  'incidentAck',
  'spotlight',
  'visitor',
  'simStorm',
  'simFire',
  'simCyclone',
  'wallControls',
];

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const num = (v) =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e15
    ? v
    : undefined;
const int = (v) => (Number.isInteger(v) && Math.abs(v) <= 1e15 ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const nul = (f) => (v) => (v === null ? null : f(v));
/** A raw device id's shape (twinIdentity.js): never an id here. */
const DEVICE_ID_RE = /^(?:screen|remote|launcher)-/i;
const id = (v) =>
  typeof v === 'string' &&
  v.length <= 64 &&
  ID_RE.test(v) &&
  !DEVICE_ID_RE.test(v) &&
  // No part as long as a token or a hex secret.
  v.split(/[-_:.]/).every((p) => p.length < 20)
    ? v
    : undefined;
const word = (v) => (typeof v === 'string' && WORD_RE.test(v) ? v : undefined);
const oneOf = (list) => (v) =>
  list.includes(v) ? v : v == null ? undefined : 'other';
const slot = (v) => (Number.isInteger(v) && v >= 1 && v <= 6 ? v : undefined);
const ref = (v) => (isRef(v) ? v : undefined);
const code = (v) => (v == null ? undefined : KNOWN_CODES.has(v) ? v : 'other');
const errCode = (v) =>
  typeof v === 'string' && ERR_RE.test(v) ? v : v == null ? undefined : 'other';
/**
 * A field name a command may carry (patch keys come from the page, so
 * only the session's own names; anything else is '?').
 */
const field = (v) =>
  typeof v !== 'string'
    ? undefined
    : SESSION_FIELDS.includes(v) ||
        SCREEN_FIELDS.includes(v) ||
        ACTOR_FIELDS.includes(v)
      ? v
      : '?';
const CMD_TYPES = ['session', 'screens', 'reset', 'count', 'returnLive'];
const list = (f, max) => (v) =>
  Array.isArray(v)
    ? v
        .slice(0, max)
        .map(f)
        .filter((x) => x !== undefined)
    : undefined;
/** A header value as recorded on security events: printable, ≤ 64. */
const clip64 = (v) =>
  v == null
    ? undefined
    : String(v)
        .replace(/[^\x20-\x7e]/g, '?')
        .slice(0, 64);
const pathOnly = (v) =>
  v == null ? undefined : clip64(String(v).split('?')[0]);
// What a refused peer sent (its Host, Sec-Fetch-Site, path) or its
// address: written as received, clipped, on security events only (C38).
clip64.echo = true;
pathOnly.echo = true;
const iso = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v)
    ? v
    : undefined;
const target = (v) => (v === 'all' ? 'all' : slot(v));
const scope = (v) =>
  v === 'session' || SLOT_LABELS.includes(v) ? v : undefined;
const changedSlot = (v) => (v === 'session' ? v : slot(v));

/** A host-owned device name (CF-D8): kind names and S1–S6, never free text. */
const NAME_RE = new RegExp(
  `^(?:(?:${[...REMOTE_NAMES, HOST_NAME].join('|')})(?: \\d{1,3})?|S[1-6])$`,
);
const actorName = (v) =>
  typeof v === 'string' && NAME_RE.test(v) ? v : undefined;

/** What each wall and session field may log as a value (diffs). */
const FIELD_VALUE = {
  role: nul(oneOf(ROLE_KEYS)),
  mode: nul(oneOf(['live', 'advance'])),
  day: nul(num),
  scale: nul(oneOf(['building', 'neighborhood', 'city'])),
  textScale: nul(num),
  pinned: bool,
  layers: (v) => {
    if (!isObj(v)) return v === null ? null : undefined;
    const out = {};
    for (const [k, on] of Object.entries(v).slice(0, 32))
      if (LAYER_RE.test(k) && typeof on === 'boolean') out[k] = on;
    return out;
  },
  // A framing is a one-shot camera intent; its subject is never logged.
  frame: (v) => (v == null ? null : 'set'),
  motion: (v) => {
    if (!isObj(v)) return v === null ? null : undefined;
    const out = {};
    for (const k of ['live', 'event', 'cine'])
      if (typeof v[k] === 'boolean') out[k] = v[k];
    return out;
  },
  // A wall's layout (screens/05-S1-PLAN §13): enums and card keys only.
  layout: (v) => {
    if (!isObj(v)) return v === null ? null : undefined;
    const out = {};
    if (['shown', 'map'].includes(v.cards)) out.cards = v.cards;
    if (['standard', 'wide'].includes(v.width)) out.width = v.width;
    if (Array.isArray(v.off))
      out.off = v.off
        .filter((k) => typeof k === 'string' && WORD_RE.test(k))
        .slice(0, 12);
    return out;
  },
  tripId: nul(id),
  siteKey: nul(id),
  wxAt: nul(num),
  // BE-5: a report logs {id, floor, kind}.
  report: (v) =>
    v === null
      ? null
      : isObj(v)
        ? pick(v, { id, floor: num, kind: word })
        : undefined,
  incidentAck: nul(id),
  // BE-5: a spotlight logs {kind, id}, never a name.
  spotlight: (v) =>
    v === null
      ? null
      : isObj(v)
        ? pick(v, { kind: oneOf(['person', 'place']), id })
        : undefined,
  visitor: bool,
  wallControls: bool,
  simStorm: nul(num),
  simFire: nul(num),
  simCyclone: nul(num),
};

/** Copy only the named fields, each through its kind; drop the rest. */
function pick(src, spec) {
  const out = {};
  if (!isObj(src)) return out;
  for (const [k, f] of Object.entries(spec)) {
    if (!Object.hasOwn(src, k)) continue;
    let v;
    try {
      v = f(src[k]);
    } catch {
      v = undefined;
    }
    if (v === undefined) continue;
    // A field too long for a line is replaced, never cut (BE-5); in a
    // list, each item is capped on its own.
    const cap = (x) => (JSON.stringify(x).length > VALUE_MAX ? '…' : x);
    out[k] = Array.isArray(v) ? v.map(cap) : cap(v);
  }
  return out;
}

/** One `cmd.applied` diff: the scope, the field, and its allowed values. */
const diff = (v) => {
  if (!isObj(v)) return undefined;
  const s = scope(v.scope);
  const f = typeof v.field === 'string' ? v.field : null;
  const value = FIELD_VALUE[f];
  if (!s || !value) return undefined;
  if ((s === 'session') !== SESSION_FIELDS.includes(f)) return undefined;
  const out = { scope: s, field: f };
  for (const k of ['from', 'to']) {
    let x;
    try {
      x = value(v[k]);
    } catch {
      x = undefined;
    }
    out[k] = x === undefined ? '?' : JSON.stringify(x).length > 96 ? '…' : x;
  }
  return out;
};

/**
 * Confirm question parts (K10 sends them; F-0004): ids and closed-list
 * words only. Never the question's text.
 */
const PART_WORDS = new Set([
  ...ROLE_KEYS,
  ...SCREEN_FIELDS,
  ...SESSION_FIELDS,
  'all',
  'live',
  'advance',
  'person',
  'place',
  'on',
  'off',
  'session',
  'count',
  'reset',
  'returnLive',
  'screens',
]);
const partValue = (v) =>
  typeof v === 'boolean' || num(v) !== undefined
    ? v
    : isRef(v) || SLOT_LABELS.includes(v) || PART_WORDS.has(v)
      ? v
      : (id(v) ?? undefined);
const part = (v) => {
  if (!isObj(v)) return undefined;
  const out = {};
  for (const [k, x] of Object.entries(v).slice(0, 6))
    if (/^[a-z][a-zA-Z]{0,15}$/.test(k) && k !== 'text') {
      const y = partValue(x);
      if (y !== undefined) out[k] = y;
    }
  return Object.keys(out).length ? out : undefined;
};

const CONFIRM_DATA = {
  parts: list(part, 12),
  // K10: an undo whose inverse lowers protection is asked too (CF-D4).
  cmdType: oneOf([...CMD_TYPES, 'undo']),
  applied: list(slot, 6),
  pinned: list(slot, 6),
  answer: oneOf(['confirm', 'cancel']),
  waitedMs: int,
  reason: oneOf([
    'timeout',
    'stale',
    'superseded',
    'cancelled',
    'gone',
    // K10: the question goes with its device's lease.
    'lease',
  ]),
};

// ------------------------------------------------------------ catalogue
/**
 * The event catalogue (the union of 02 BE-5 and 01 SEC-12, C39, lean).
 * `peer`: 'always' (security events), 'refused' (only when the line is a
 * refusal: `data.ok === false` or `data.outcome === 'denied'`), or false.
 * `data`: the allowlist for this type. A type not here is never written.
 * Exported: the canary fixtures are generated from it (sec S8).
 */
export const AUDIT_EVENTS = Object.freeze({
  // The relay and its store.
  'relay.boot': {
    peer: false,
    data: {
      proto: int,
      rev: int,
      // L5: 'hashed' is a v1 store migrated in place to v2.
      store: oneOf(['store', 'hashed', 'migrated', 'fresh', 'memory']),
      hostCheck: oneOf(['report', 'enforce']),
      lanListening: bool,
      retentionDays: int,
    },
  },
  'relay.stop': { peer: false, data: { rev: int, uptimeS: int } },
  'store.error': {
    peer: false,
    data: {
      what: oneOf([
        'saved_error',
        'open_error',
        'dual_write_error',
        'quarantined',
        'reset',
        'dir_refused',
        'memory_only',
      ]),
      error: errCode,
    },
  },
  // The log itself.
  'log.opened': {
    peer: false,
    data: { reason: oneOf(['boot', 'day', 'size', 'reopen']) },
  },
  'log.gap': {
    peer: false,
    data: { since: iso, downMs: int, lost: int, error: errCode },
  },
  'log.pruned': {
    peer: false,
    data: { files: int, bytes: int, trimmed: int },
  },
  'audit.dropped': { peer: false, data: { count: int } },
  // Security: refusals before any hello (C38: with the peer).
  'upgrade.refused': {
    peer: 'always',
    data: {
      reason: oneOf([
        'origin',
        'origin-not-host',
        'host',
        'path',
        'no-origin',
        'null-origin',
      ]),
      host: clip64,
      dropped: int,
    },
  },
  'http.refused': {
    peer: 'always',
    data: {
      reason: oneOf([
        'fetch-site',
        'host',
        'local-peer',
        'local-host',
        'local-fetch-site',
      ]),
      site: clip64,
      path: pathOnly,
      dropped: int,
    },
  },
  // Devices and pairing (CF-D11: the fields that tell a lost pairing).
  'device.hello': {
    peer: 'refused',
    data: {
      outcome: oneOf(['paired', 'pair-code', 'remote', 'launcher', 'denied']),
      code,
      kind: oneOf(['screen', 'remote', 'launcher']),
      slotAsked: slot,
      slotGiven: slot,
      viaSetup: bool,
      viaToken: bool,
      token: oneOf(['issued', 'kept', 'none']),
      replaces: bool,
      unpairedRefs: list(ref, 6),
      controller: bool,
      proto: int,
    },
  },
  'device.offline': {
    peer: false,
    data: { kind: oneOf(['screen', 'remote']), slot },
  },
  'session.setup': {
    peer: 'refused',
    data: {
      ok: bool,
      reason: oneOf(['not-local', 'reload']),
      count: int,
      tripId: id,
      siteKey: id,
    },
  },
  'device.paired': {
    peer: false,
    data: {
      slot,
      screenRef: ref,
      method: oneOf(['code', 'setup']),
      unpairedRefs: list(ref, 6),
    },
  },
  'pair.failed': {
    peer: 'always',
    data: {
      reason: oneOf(['lease', 'locked', 'code', 'slot']),
      tries: int,
      locked: bool,
    },
  },
  // Control.
  'lease.granted': {
    peer: false,
    data: { how: oneOf(['request', 'renewed']) },
  },
  'handover.requested': { peer: false, data: { toRef: ref } },
  'handover.answered': {
    peer: false,
    data: { ok: bool, accept: bool, fromRef: ref },
  },
  // Commands and undo.
  'cmd.applied': {
    peer: false,
    data: {
      type: oneOf(CMD_TYPES),
      target,
      fields: list(field, 24),
      diffs: list(diff, 24),
      changed: list(changedSlot, 7),
      skipped: list(slot, 6),
    },
  },
  'cmd.refused': {
    peer: false,
    data: {
      type: oneOf(CMD_TYPES),
      code,
      field,
    },
  },
  // K9: how many fields went back, and why the others did not (reasons
  // from a closed list; never the values or who).
  'undo.applied': {
    peer: false,
    data: { of: int, restored: int, skipped: list(oneOf(UNDO_SKIP), 24) },
  },
  'undo.refused': { peer: false, data: { code } },
  // Server-held questions (K10 emits them; parts only, F-0004).
  'confirm.asked': { peer: false, data: CONFIRM_DATA },
  'confirm.answered': { peer: false, data: CONFIRM_DATA },
  'confirm.expired': { peer: false, data: CONFIRM_DATA },
  'confirm.stale': { peer: false, data: CONFIRM_DATA },
  'confirm.superseded': { peer: false, data: CONFIRM_DATA },
  'confirm.cancelled': { peer: false, data: CONFIRM_DATA },
  // The walls' session log (phase 11 SUP P1-14; BE-6): one line per
  // `local` message that changes hands-on or drift; the text never.
  'wall.hands': {
    peer: false,
    data: { slot, on: bool, drift: bool, reason: oneOf(DRIFT_REASONS) },
  },
  'wall.drift': {
    peer: false,
    data: { slot, on: bool, reason: oneOf(DRIFT_REASONS) },
  },
  'wall.identify': { peer: false, data: { ok: bool, screens: int } },
  // A review tick from the All-in-one: the row and on/off, never who.
  'review.set': {
    peer: false,
    data: { on: bool, item: oneOf(REVIEW_ITEMS) },
  },
  // The wall's traffic camera: shown, stopped or expired and which wall,
  // never the camera (review/traffic-cameras T5).
  'camera.set': {
    peer: false,
    data: {
      action: oneOf(['show', 'stop', 'expired']),
      slot: int,
    },
  },
  // A kept or hidden street photo: what and which kind of place, never the
  // photo or who (review/street-photos P5).
  'photo.set': {
    peer: false,
    data: {
      action: oneOf(['keep', 'hide', 'clear']),
      place: oneOf(['hotel', 'stop', 'place']),
    },
  },
  // Limits (K7, S-16): one line per limit per 10 s; `dropped` counts the
  // lines left out since. Wrong tokens are a signal here, never a lockout.
  'limit.hit': {
    peer: 'always',
    data: {
      limit: oneOf(LIMIT_NAMES),
      kind: oneOf(['screen', 'remote', 'launcher']),
      retryAfterMs: int,
      count: int,
      dropped: int,
    },
  },
  // One message the relay could not handle (K7, SEC-8): its type only.
  'msg.error': { peer: 'always', data: { type: oneOf(MSG_TYPES) } },
  // A Fitzroy proposal the relay's voice policy refused (VOICE-CONTROL
  // §3.6, PRE-V1): the intent from the generated table's closed list, the
  // reason, the command's type and field name, the tier. Never a
  // transcript, a heard word, a proposal id or anything else the device
  // put in its envelope.
  'voice.refused': {
    peer: false,
    data: {
      intent: oneOf(VOICE_INTENTS),
      reason: oneOf(VOICE_REFUSALS),
      cmdType: oneOf([...CMD_TYPES, 'undo']),
      field,
      tier: oneOf(['act', 'ask', 'touch']),
    },
  },
  // Fitzroy hands-free (29 Oct 2026): a remote's microphone opened or
  // closed for "Fitzroy…" (closed also when its socket goes). On or off
  // only: never what was heard.
  'voice.listening': { peer: false, data: { on: bool } },
});

export const AUDIT_EVENT_TYPES = Object.freeze(Object.keys(AUDIT_EVENTS));

// ------------------------------------------------------------ executive
// SafeTrekr Executive (B2; EP-35 §7, EP-33 §3): the loop's own lines,
// written only by a log opened for the executive product
// (TRIP_TWIN_PRODUCT=executive, or `product: 'executive'`). The school
// catalogue above, its canary and AUDIT_EVENT_TYPES are unchanged, and a
// school log never writes these types. Ids, codes and closed lists only:
// never a BLUF, a name, a reason or any other free text. The lists are
// spelled out here so the school relay loads no executive module
// (products/executive/host/loopHost.test.mjs keeps them equal).
export const LOOP_EVENT_NAMES = Object.freeze([
  'intel.received',
  'intel.raise',
  'position.fix',
  'leg.changed',
  'checkin.due',
  'comms.due',
  'comms.overdue',
  'recommendation.draft',
  'sitrep.draft',
  'intel.dismiss',
  'intel.watch',
  'verification.decide',
  'verification.countersign',
  'notify.send',
  'recommendation.edit',
  'recommendation.approve',
  'push.send',
  'message.send',
  // B7: the supervisor's countersign of a watch reply; the client viewer's open.
  'message.countersign',
  'record.view',
  'callback.step',
  'posture.retier',
  'sitrep.sign',
  'situation.close',
  // EP-33 §3 reversals (B4).
  'intel.restore',
  'verification.reopen',
  'push.recall',
  'situation.reopen',
  'ack',
  'dl.respond',
  'salute.file',
  'checkin.respond',
  'sharing.set',
  'clock.start',
  'clock.pause',
  'clock.resume',
  'clock.jump',
  'beat.go',
  'reset',
]);
/** Presenter commands that are not loop events (execProtocol.js PRESENTER_CMDS). */
export const PRESENTER_CMD_NAMES = Object.freeze([
  'clock.rate',
  'clock.auto',
  'next',
  'previous',
  'confirm',
  'cancel',
  'wall.role',
  'phone.ticket',
  // B4: the presenter's two ORTEGA shortcuts (EP-38 #8) and the phones'
  // scripted/live switch (EP-38 #12).
  'ortega.countersign',
  'ortega.retier',
  'phones.mode',
]);
const LOOP_TYPES = [...LOOP_EVENT_NAMES, ...PRESENTER_CMD_NAMES];
const LOOP_FROM = ['phone', 'desk', 'presenter', 'host'];
const LOOP_VIA = ['touch', 'keyboard', 'phone', 'presenter', 'voice'];
/** B7: the analyst desk's own device id (it has no host device ref). */
const deskDevice = (v) =>
  typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,40}$/.test(v) ? v : undefined;
/** Who acted: the system, the presenter, a watch callsign or a participant id. */
const loopBy = (v) =>
  ['generator', 'presenter', 'VALE', 'ORTEGA'].includes(v) ? v : id(v);
/** A refusal code: upper case and underscores, never text. */
const loopCode = (v) =>
  v == null
    ? undefined
    : typeof v === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(v)
      ? v
      : 'other';
export const LOOP_AUDIT_EVENTS = Object.freeze({
  // One line per accepted live loop event (a phone's, the desk's, the
  // presenter's); the scripted timeline is the fixture and is not logged.
  'loop.event': {
    peer: false,
    data: {
      type: oneOf(LOOP_TYPES),
      by: loopBy,
      sit_id: id,
      push_id: id,
      rung: oneOf(['delivered', 'read', 'accepted', 'done']),
      answer: oneOf(['concur', 'nonconcur', 'executing', 'request_support']),
      code: loopCode,
      from: oneOf(LOOP_FROM),
      run: int,
      // B4: a reversal names what it reverses; a live event the scripted
      // one it pre-empts (EP-33 §3, EP-31 §3).
      reverses: id,
      preempts: id,
      // B7 (review R13 S2-3/S2-4): how it was sent, and from which desk.
      via: oneOf(LOOP_VIA),
      device: deskDevice,
    },
  },
  'loop.refused': {
    peer: false,
    data: {
      type: oneOf(LOOP_TYPES),
      code: loopCode,
      from: oneOf(LOOP_FROM),
      device: deskDevice,
    },
  },
  // B7 (review R13 S2-3): one keyboard switched between VALE and ORTEGA.
  'desk.as': {
    peer: false,
    data: { device: deskDevice, from: loopBy, to: loopBy, run: int },
  },
  // A rewind is on record too (EP-33 §7).
  'presenter.beat': {
    peer: false,
    data: {
      from: iso,
      to: iso,
      how: oneOf(['next', 'previous', 'beat', 'reset', 'jump']),
      run: int,
    },
  },
  // B4: the room preset the host applies once per setup (slot roles,
  // layers, MAIN's text scale): counts only.
  'room.preset': { peer: false, data: { count: int, slots: int } },
});
const EXECUTIVE_EVENTS = Object.freeze({
  ...AUDIT_EVENTS,
  ...LOOP_AUDIT_EVENTS,
});
/** The catalogue a log writes: the school one, plus the loop's for the executive. */
export const auditCatalogue = (product = process.env.TRIP_TWIN_PRODUCT) =>
  product === 'executive' ? EXECUTIVE_EVENTS : AUDIT_EVENTS;

const ACTOR_SPEC = {
  ref,
  kind: oneOf(['remote', 'screen', 'launcher', 'host']),
  name: actorName,
  slot: nul(slot),
  // 'voice': stamped by the relay on a proposal its voice policy passed.
  via: oneOf(['touch', 'system', 'keyboard', 'voice']),
};
const CORR_SPEC = {
  reqId: (v) => (Number.isInteger(v) && v >= 0 && v <= 1e12 ? v : undefined),
  undoId: (v) => (typeof v === 'string' && UNDO_RE.test(v) ? v : undefined),
};
const PEER_SPEC = { ip: clip64, local: bool };

/**
 * One event as it may be written (no `seq` yet): every part through its
 * allowlist. Returns null for a type not in the catalogue.
 */
export function serialiseEvent(
  type,
  ev = {},
  at = Date.now(),
  catalogue = AUDIT_EVENTS,
) {
  const entry = catalogue[type];
  if (!entry) return null;
  const data = pick(ev.data, entry.data);
  const out = {
    v: AUDIT_VERSION,
    at: new Date(at).toISOString(),
    type,
    actor: isObj(ev.actor) ? pick(ev.actor, ACTOR_SPEC) : null,
    rev: isObj(ev.rev) ? pick(ev.rev, { before: int, after: int }) : null,
    corr: pick(ev.corr, CORR_SPEC),
    data,
  };
  if (out.actor && !out.actor.ref) out.actor = null;
  const refused = data.ok === false || data.outcome === 'denied';
  if (entry.peer === 'always' || (entry.peer === 'refused' && refused)) {
    out.peer = isObj(ev.peer) ? pick(ev.peer, PEER_SPEC) : null;
    out.secure = Boolean(ev.secure);
  }
  return out;
}

/** The form a page or a check may read (BE-11): no peer, no prev. */
export function publicEvent(e) {
  const { peer: _p, secure: _s, prev: _v, ...rest } = e;
  void _p;
  void _s;
  void _v;
  return rest;
}

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const fileName = (day, part = 1) =>
  part > 1 ? `audit-${day}.${part}.jsonl` : `audit-${day}.jsonl`;
const errOf = (e) => String(e?.code || e?.message || e).slice(0, 40);

/** Audit files in a folder listing, oldest first: {name, day, part}. */
export function auditFiles(names) {
  return names
    .map((name) => {
      const m = FILE_RE.exec(name);
      return m ? { name, day: m[1], part: Number(m[2] || 1) } : null;
    })
    .filter(Boolean)
    .sort((a, b) =>
      a.day === b.day ? a.part - b.part : a.day < b.day ? -1 : 1,
    );
}

/** The last whole JSON line's `seq` in a file's text, or 0. */
function lastSeqOf(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    try {
      const j = JSON.parse(l);
      if (Number.isInteger(j.seq)) return j.seq;
    } catch {
      /* a torn last line: look at the one before */
    }
  }
  return 0;
}

/**
 * The audit log. `dir` null (unset or refused) writes nothing and says so
 * in health. Everything outside is injectable for tests: `fs` (the
 * promise API: mkdir, chmod, readdir, stat, readFile, appendFile, unlink),
 * `syncFs` (exit flush and the would-refuse trim), the clock, the timers.
 */
export function createAuditLog({
  dir = null,
  now = Date.now,
  log = () => {},
  fs: fsi = fsp,
  syncFs = fs,
  boot = randomBytes(6).toString('hex'),
  retentionDays = AUDIT_DAYS,
  maxTotalBytes = AUDIT_MAX_TOTAL_BYTES,
  maxFileBytes = AUDIT_MAX_FILE_BYTES,
  queueCap = AUDIT_QUEUE_CAP,
  batch = AUDIT_BATCH,
  reopenMs = AUDIT_REOPEN_MS,
  pruneEveryMs = AUDIT_PRUNE_EVERY_MS,
  sideFiles = [WOULD_REFUSE_FILE],
  refused = null,
  // SafeTrekr Executive (B2): the loop's lines too (auditCatalogue).
  product = process.env.TRIP_TWIN_PRODUCT,
} = {}) {
  const catalogue = auditCatalogue(product);
  const st = {
    ok: Boolean(dir),
    ready: false, // folder made and the last seq read
    seq: 0,
    file: null,
    day: null,
    part: 1,
    size: 0,
    lastWriteAt: null,
    lastError: dir ? null : refused ? 'folder refused' : 'no audit folder',
    downSince: dir ? null : now(),
    dropped: 0, // since the last good write: audit.dropped or log.gap
    droppedTotal: 0,
    written: 0,
    failures: 0,
    gapSince: null, // the log could not write from then; a gap row is owed
    gapError: null,
    lastPrune: null,
  };
  const queue = [];
  const ring = [];
  let draining = false;
  let retry = null;
  let closed = false;
  let waiters = [];
  const pruneHooks = [];
  const unref = (t) => (t?.unref?.(), t);

  function schedule() {
    if (draining || retry || closed || !dir) return;
    draining = true;
    setImmediate(() => {
      drain().finally(() => {
        draining = false;
        if (queue.length && !retry && !closed) schedule();
        else settle();
      });
    });
  }
  function settle() {
    if (draining || (queue.length && !retry && dir)) return;
    const ok = !queue.length;
    const w = waiters;
    waiters = [];
    for (const fn of w) fn(ok);
  }

  /** Make the folder (0700) and find the last seq on disk. */
  async function init() {
    await fsi.mkdir(dir, { recursive: true, mode: AUDIT_DIR_MODE });
    await fsi.chmod(dir, AUDIT_DIR_MODE);
    const files = auditFiles(await fsi.readdir(dir));
    let seq = 0;
    for (let i = files.length - 1; i >= 0 && !seq; i--) {
      const text = await fsi.readFile(path.join(dir, files[i].name), 'utf8');
      seq = lastSeqOf(text);
    }
    st.seq = Math.max(st.seq, seq);
    const today = dayOf(now());
    const parts = files.filter((f) => f.day === today);
    st.day = today;
    st.part = parts.length ? parts[parts.length - 1].part : 1;
    st.file = fileName(st.day, st.part);
    try {
      st.size = (await fsi.stat(path.join(dir, st.file))).size;
    } catch {
      st.size = 0;
    }
    st.ready = true;
  }

  const make = (type, ev) => serialiseEvent(type, ev, now(), catalogue);

  async function drain() {
    try {
      if (!st.ready) await init();
      while (queue.length || st.dropped || st.gapSince != null) {
        const take = queue.slice(0, batch);
        // The batch's own time: rows written for it never read later
        // than the events they come before (T7.3: `at` in order).
        const first = take[0]?.at ?? new Date(now()).toISOString();
        // The day or the size moves the log to a new file.
        const day = first.slice(0, 10);
        let reason = null;
        if (day > st.day) {
          st.day = day;
          st.part = 1;
          reason = 'day';
        } else if (st.size >= maxFileBytes) {
          st.part += 1;
          reason = 'size';
        }
        if (reason) {
          st.file = fileName(st.day, st.part);
          st.size = 0;
        }
        const head = reason
          ? [{ ...make('log.opened', { data: { reason } }), at: first }]
          : [];
        // After the last queued event: what was lost, and for how long
        // the folder could not be written (CF-D9 gap rows on reopen).
        const tail = [];
        if (take.length === queue.length) {
          if (st.gapSince != null)
            tail.push(
              make('log.gap', {
                data: {
                  since: new Date(st.gapSince).toISOString(),
                  downMs: Math.max(0, now() - st.gapSince),
                  lost: st.dropped,
                  error: st.gapError,
                },
              }),
            );
          else if (st.dropped)
            tail.push(make('audit.dropped', { data: { count: st.dropped } }));
        }
        let seq = st.seq;
        const rows = [...head, ...take, ...tail].map((e) => ({
          ...e,
          seq: ++seq,
        }));
        // `seq` second in each line, after `v`, as the envelope reads.
        const text = rows
          .map(({ v, seq: n, ...rest }) =>
            JSON.stringify({ v, seq: n, boot, ...rest }),
          )
          .join('\n')
          .concat('\n');
        const file = path.join(dir, st.file);
        const fresh = st.size === 0;
        await fsi.appendFile(file, text, { mode: AUDIT_FILE_MODE });
        if (fresh) await fsi.chmod(file, AUDIT_FILE_MODE);
        // Written: commit.
        queue.splice(0, take.length);
        st.seq = seq;
        st.size += Buffer.byteLength(text);
        st.written += rows.length;
        st.lastWriteAt = now();
        if (!st.ok) log('audit.reopened', { file: st.file });
        st.ok = true;
        st.lastError = null;
        st.downSince = null;
        if (tail.length) {
          st.dropped = 0;
          st.gapSince = null;
          st.gapError = null;
        }
        for (const r of rows) {
          ring.push({ boot, ...r });
          if (ring.length > AUDIT_RING) ring.shift();
        }
        // Let the event loop breathe between batches (SEC-12: 10,000
        // events never delay a heartbeat by more than 50 ms).
        if (queue.length) await new Promise((r) => setImmediate(r));
      }
    } catch (e) {
      const error = errOf(e);
      if (st.ok || st.lastError !== error)
        log('audit.write_error', { error, file: st.file });
      st.ok = false;
      st.lastError = error;
      if (st.downSince == null) st.downSince = now();
      if (st.gapSince == null) {
        st.gapSince = st.downSince;
        st.gapError = error;
      }
      st.failures += 1;
      st.ready = false; // look again when it reopens (the folder may be new)
      if (!closed)
        retry = unref(
          setTimeout(() => {
            retry = null;
            schedule();
          }, reopenMs),
        );
    }
  }

  /** Delete what is past retention or over the cap; trim side files. */
  async function prune() {
    if (!dir) return { files: 0, bytes: 0, trimmed: 0 };
    let files = 0;
    let bytes = 0;
    let trimmed = 0;
    try {
      const t = now();
      const today = Date.parse(`${dayOf(t)}T00:00:00Z`);
      const all = auditFiles(await fsi.readdir(dir));
      const sizes = new Map();
      for (const f of all)
        try {
          sizes.set(f.name, (await fsi.stat(path.join(dir, f.name))).size);
        } catch {
          sizes.set(f.name, 0);
        }
      const keep = [];
      for (const f of all) {
        const age = Math.round(
          (today - Date.parse(`${f.day}T00:00:00Z`)) / DAY_MS,
        );
        if (age > retentionDays && f.name !== st.file) {
          await fsi.unlink(path.join(dir, f.name));
          files += 1;
          bytes += sizes.get(f.name);
        } else keep.push(f);
      }
      // Side files keep the same days, line by line (sync: they are
      // appended synchronously, so nothing lands between read and write).
      let side = 0;
      for (const name of sideFiles) {
        const r = trimSide(path.join(dir, name), t - retentionDays * DAY_MS);
        trimmed += r.trimmed;
        side += r.size;
      }
      let total = side + keep.reduce((n, f) => n + sizes.get(f.name), 0);
      for (const f of keep) {
        if (total <= maxTotalBytes) break;
        if (f.name === st.file) continue;
        await fsi.unlink(path.join(dir, f.name));
        files += 1;
        bytes += sizes.get(f.name);
        total -= sizes.get(f.name);
      }
      st.lastPrune = t;
      if (trimmed) for (const fn of pruneHooks) fn();
      if (files || trimmed)
        emit('log.pruned', { data: { files, bytes, trimmed } });
    } catch (e) {
      // No folder yet (nothing written so far) is not an error.
      if (e?.code !== 'ENOENT') log('audit.prune_error', { error: errOf(e) });
    }
    return { files, bytes, trimmed };
  }

  /** Keep a side file's lines from `cutoff` on; returns {trimmed, size}. */
  function trimSide(file, cutoff) {
    const atOf = (l) => {
      try {
        return Date.parse(JSON.parse(l).at);
      } catch {
        return NaN;
      }
    };
    let text;
    try {
      // The oldest line first: when it is inside the days, keep the file.
      const fd = syncFs.openSync(file, 'r');
      let size = 0;
      let first = '';
      try {
        size = syncFs.fstatSync(fd).size;
        const buf = Buffer.alloc(Math.min(size, 4096));
        syncFs.readSync(fd, buf, 0, buf.length, 0);
        first = buf.toString('utf8').split('\n')[0];
      } finally {
        syncFs.closeSync(fd);
      }
      if (!(atOf(first) < cutoff)) return { trimmed: 0, size };
      text = syncFs.readFileSync(file, 'utf8');
    } catch {
      return { trimmed: 0, size: 0 };
    }
    const lines = text.split('\n').filter(Boolean);
    const keep = lines.filter((l) => !(atOf(l) < cutoff));
    if (keep.length === lines.length)
      return { trimmed: 0, size: Buffer.byteLength(text) };
    const out = keep.length ? `${keep.join('\n')}\n` : '';
    const tmp = `${file}.tmp`;
    syncFs.writeFileSync(tmp, out, { mode: AUDIT_FILE_MODE });
    syncFs.chmodSync(tmp, AUDIT_FILE_MODE);
    syncFs.renameSync(tmp, file);
    return {
      trimmed: lines.length - keep.length,
      size: Buffer.byteLength(out),
    };
  }

  /**
   * Record one event. Synchronous, cheap and never throws: the relay's
   * work never waits for a disk. Returns false when it was not queued.
   */
  function emit(type, ev = {}) {
    try {
      if (closed) return false;
      const line = serialiseEvent(type, ev, now(), catalogue);
      if (!line) return false;
      // No folder (unset or refused): nothing is kept in memory either.
      if (!dir || queue.length >= queueCap) {
        st.dropped += 1;
        st.droppedTotal += 1;
        return false;
      }
      queue.push(line);
      schedule();
      return true;
    } catch {
      return false;
    }
  }

  // The first line of every start: when this boot's log begins.
  if (dir) queue.push(make('log.opened', { data: { reason: 'boot' } }));

  let pruneTimer = null;
  if (dir && pruneEveryMs > 0) {
    // At start (after the first write has found the folder) and every 6 h.
    setImmediate(() => !closed && prune());
    pruneTimer = unref(setInterval(() => prune(), pruneEveryMs));
  }

  return {
    dir,
    boot,
    emit,
    prune,
    /** Called after a prune trimmed a side file (its writer re-stats). */
    onPrune(fn) {
      if (typeof fn === 'function') pruneHooks.push(fn);
    },
    /** Resolves true once everything queued is on disk (false: down). */
    flush() {
      return new Promise((resolve) => {
        if (!dir) return resolve(!queue.length);
        waiters.push(resolve);
        if (queue.length && !retry) schedule();
        else settle();
      });
    },
    /** Health (BE-10): no event content. */
    health() {
      return {
        ok: st.ok,
        dir,
        file: st.file,
        seq: st.seq,
        boot,
        lastWriteAt: st.lastWriteAt && new Date(st.lastWriteAt).toISOString(),
        queued: queue.length,
        dropped: st.droppedTotal,
        written: st.written,
        failures: st.failures,
        lastError: st.lastError,
        downSince: st.downSince && new Date(st.downSince).toISOString(),
        retentionDays,
        lastPruneAt: st.lastPrune && new Date(st.lastPrune).toISOString(),
      };
    },
    /** Written events after `since` (seq), public form (BE-11, lean). */
    tail(since = 0, limit = AUDIT_TAIL_MAX) {
      const n = Math.max(1, Math.min(AUDIT_TAIL_MAX, Number(limit) || 50));
      const from = Number(since) || 0;
      const events = ring
        .filter((e) => e.seq > from)
        .slice(0, n)
        .map(publicEvent);
      return {
        events,
        next: events.length ? events[events.length - 1].seq : from,
      };
    },
    /** Stop: write what is queued (async) and stop the timers. */
    async close() {
      clearInterval(pruneTimer);
      clearTimeout(retry);
      retry = null;
      const ok = await this.flush();
      closed = true;
      return ok;
    },
    /** Last resort on process exit: write the queue synchronously. */
    closeSync() {
      clearInterval(pruneTimer);
      clearTimeout(retry);
      closed = true;
      if (!dir || !queue.length || draining) return false;
      try {
        let seq = st.seq;
        const text = queue
          .map(({ v, ...rest }) =>
            JSON.stringify({ v, seq: ++seq, boot, ...rest }),
          )
          .join('\n')
          .concat('\n');
        syncFs.mkdirSync(dir, { recursive: true, mode: AUDIT_DIR_MODE });
        const file = path.join(dir, st.file || fileName(dayOf(now())));
        syncFs.appendFileSync(file, text, { mode: AUDIT_FILE_MODE });
        st.seq = seq;
        queue.length = 0;
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** The folder for one dev server: TRIP_TWIN_AUDIT_DIR, fenced (S-1). */
export function openAuditLog({
  env = process.env,
  viteRoot = null,
  log = () => {},
  ...opts
} = {}) {
  const where = resolveAuditDir({
    env,
    fences: [
      { name: 'the repo', path: REPO_ROOT },
      viteRoot && { name: "Vite's root", path: viteRoot },
    ],
  });
  if (where.refused)
    log('audit.dir_refused', {
      ...where.refused,
      effect: 'the audit log is not written until this is fixed',
    });
  return createAuditLog({
    dir: where.dir,
    refused: where.refused || null,
    retentionDays: auditDays(env),
    log,
    ...opts,
  });
}

const perServer = new WeakMap();

/** Tests: use this audit log for `server` instead of opening one. */
export function useAuditLog(server, audit) {
  perServer.set(server, audit);
  return audit;
}

/** The one audit log of a Vite dev server (the relay and the host check). */
export function auditLogFor(server, { log = () => {} } = {}) {
  let audit = perServer.get(server);
  if (!audit) {
    audit = openAuditLog({ viteRoot: server?.config?.root || null, log });
    perServer.set(server, audit);
  }
  return audit;
}
