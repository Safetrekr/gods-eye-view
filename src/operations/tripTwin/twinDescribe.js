// Trip Twin describer (Phase CF K8; cf/05-supervision.md SUP-1 core,
// SUP-4, SUP-5; cf/04-client.md CL-11; cf/07-reasoning.md ET-5;
// PHASE-CF-PLAN Appendix D). One pure module turns a change into words on
// every surface: the walls' chip, the remote's result bar and its
// active-station card, the log row and (V1) the spoken read-back.
//
// - A change is structured parts, never a string: `{scope, field, key?,
//   to}` with scope 'wall' (every screen) or a slot. People and places
//   travel as ids and are named per surface: a full name on the remote,
//   `wallName` on a wall (initials in Visitor mode), the id in the log.
// - describeCommand(cmd, before) is a dry run of the reducer, so it names
//   only what will really change; describeChange(before, after, info) is
//   the same from a state broadcast (walls and other remotes).
// - render(change, {audience}) for 'remote' | 'wall' | 'log' | 'voice'.
// - byText names a device, never a person: the host's kind name ("iPad",
//   "iPad 2", "Trip Twin computer"); a raw id is never shown.
// - chipText is the wall chip, at most 56 characters: the time goes
//   first, then the summary is cut with "…"; a device name is never cut.
// - wallCard is the copy of every wall card (Appendix D 1a, 6c, 6d, 7, 7a;
//   SUP-5); controlText the remote's status-strip control cell.
// Times are 24 h HH:MM on the wall's own computer (real operator times,
// not the sample clock). No word here says "safe" or "all clear".
import { applyCommand } from './twinSession.js';
import { LAYER_CATALOG, ROLES, wallName } from './twinScreenRoles.js';
import { tripById } from './demoTrips.js';
import { siteConfig } from './twinSites.js';

/** The wall chip's limit (SUP-4). */
export const CHIP_MAX = 56;
/** A change shows in the chip for 3 s, then as "last change … ago". */
export const CHIP_RECENT_MS = 3000;

/** Field labels: one table, used for "Not undone: …" and as a fallback. */
export const FIELD_LABELS = Object.freeze({
  role: 'role',
  scale: 'scale',
  mode: 'Live/Advance',
  day: 'day',
  textScale: 'text size',
  pinned: 'pin',
  layers: 'layer',
  motion: 'motion',
  frame: 'camera',
  tripId: 'trip',
  siteKey: 'site',
  wxAt: 'time lens',
  report: 'reported floor',
  incidentAck: 'acknowledgement',
  spotlight: 'spotlight',
  visitor: 'Visitor mode',
  simStorm: 'demo storm',
  count: 'number of screens',
});

/** Wall-wide fields (twinSession.js SESSION_FIELDS), in reading order. */
export const SESSION_KEYS = Object.freeze([
  'tripId',
  'siteKey',
  'report',
  'incidentAck',
  'spotlight',
  'visitor',
  'simStorm',
  'wxAt',
]);
/** Per-screen fields (twinSession.js SCREEN_FIELDS), in reading order. */
export const SCREEN_KEYS = Object.freeze([
  'role',
  'mode',
  'day',
  'scale',
  'layers',
  'motion',
  'frame',
  'textScale',
  'pinned',
]);

const MOTION_LABELS = { live: 'Live', event: 'Event', cine: 'Cinematic' };
const LAYER_LABELS = Object.fromEntries(
  LAYER_CATALOG.flatMap((g) => g.layers.map((L) => [L.key, L.label])),
);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Lower-case the first letter unless the word is an acronym ("3D"). */
const low = (s) =>
  s && !/^[A-Z0-9]{2}/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
const slotsOf = (state) =>
  Object.keys(state?.screens || {})
    .map(Number)
    .sort((a, b) => a - b);
const sList = (slots) => slots.map((s) => `S${s}`).join(', ');

/** "21:32": 24 h, local to this computer (or a time zone for tests). */
export function hhmm(ms, timeZone) {
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
}
/** "21:32:05". */
export function hhmmss(ms, timeZone) {
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
}
/** An age: "0:42", "2:14", then "1 h 05 min" from an hour. */
export function agoText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 3600)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const m = Math.floor(s / 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
/** "45 s", "12 min", "1 h 02 min": how long a state has lasted. */
export function forText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

// ------------------------------------------------------------------ parts

/** Parts for one screen field that changed. */
function screenParts(slot, field, from, to) {
  if (field === 'layers' || field === 'motion') {
    const out = [];
    const keys = new Set([
      ...Object.keys(from || {}),
      ...Object.keys(to || {}),
    ]);
    for (const key of [...keys].sort())
      if (!same(from?.[key], to?.[key]))
        out.push({ scope: slot, field, key, to: { value: to?.[key] ?? null } });
    return out;
  }
  if (field === 'frame') {
    // A frame is a one-shot request: only a new nonce is a change.
    if (!to?.nonce || to.nonce === from?.nonce) return [];
    return [{ scope: slot, field, to: { value: to.subject || null } }];
  }
  return [{ scope: slot, field, to: { value: to ?? null } }];
}

/** Parts for one wall-wide field that changed. */
function sessionPart(field, from, to, at) {
  if (field === 'spotlight' && to?.id)
    return { scope: 'wall', field, to: { kind: to.kind, id: to.id } };
  if (field === 'wxAt' && to != null)
    return {
      scope: 'wall',
      field,
      to: { value: to, min: at ? Math.round((to - at) / 60000) : null },
    };
  if (field === 'report' && to)
    return {
      scope: 'wall',
      field,
      to: { value: { floor: to.floor, kind: to.kind ?? null } },
    };
  return { scope: 'wall', field, to: { value: to ?? null } };
}

/**
 * What differs between two states, as parts (no names, no ids of devices).
 * A screen replaced whole (reset, Return all, a new screen) is one part
 * `{scope, field: 'whole'}`. `at` (ms): when, for the time lens's offset.
 */
export function diffParts(before, after, { at = null, undo = false } = {}) {
  const parts = [];
  if (!after) return parts;
  const b = before || { session: {}, screens: {} };
  const ss0 = b.session || {};
  const ss1 = after.session || {};
  for (const k of SESSION_KEYS)
    if (!same(ss0[k], ss1[k])) {
      // A new report clears the acknowledgement: say the report only.
      if (
        k === 'incidentAck' &&
        ss1[k] == null &&
        !same(ss0.report, ss1.report)
      )
        continue;
      parts.push(sessionPart(k, ss0[k], ss1[k], at));
    }
  if ((b.count ?? null) !== null && b.count !== after.count)
    parts.push({ scope: 'wall', field: 'count', to: { value: after.count } });
  for (const slot of slotsOf(after)) {
    const s0 = b.screens?.[slot];
    const s1 = after.screens[slot];
    if (!s0) {
      if (before)
        parts.push({ scope: slot, field: 'whole', to: { value: 'added' } });
      continue;
    }
    // Replaced whole: no field of this revision is stamped, yet it differs
    // (an undo writes old values back unstamped: never "whole").
    const stamped = Object.values(s1.meta || {}).some(
      (m) => m?.rev === after.rev,
    );
    let fields = SCREEN_KEYS.filter((k) => !same(s0[k], s1[k]));
    // A new role brings its own scale: say the role only.
    if (fields.includes('role')) fields = fields.filter((k) => k !== 'scale');
    if (!fields.length) continue;
    if (
      !undo &&
      !stamped &&
      after.rev !== b.rev &&
      fields.some((k) => k !== 'frame')
    ) {
      parts.push({ scope: slot, field: 'whole', to: { value: 'defaults' } });
      continue;
    }
    for (const k of fields) parts.push(...screenParts(slot, k, s0[k], s1[k]));
  }
  return parts;
}

/** Return all stamps the lens, the spotlight and the demo storm at once. */
function isReturnAll(after) {
  const m = after?.session?.meta || {};
  return ['wxAt', 'spotlight', 'simStorm'].every(
    (k) => m[k]?.rev === after.rev,
  );
}

/**
 * A change from a state broadcast: `info` is the message's {cause, by,
 * changed, skipped, undone}. Returns {kind, parts, pinned, returnAll,
 * ended, by, at, rev} or null when nothing the walls show changed.
 */
export function describeChange(before, after, info = {}, at = Date.now()) {
  if (!after) return null;
  const parts = diffParts(before, after, {
    at,
    undo: info.cause === 'undo' || Boolean(info.undone),
  });
  const pinned = (info.skipped || []).map(Number).filter(Boolean);
  if (!parts.length && !pinned.length) return null;
  const returnAll = info.cause !== 'undo' && isReturnAll(after);
  const ended = [];
  if (returnAll) {
    const ss0 = before?.session || {};
    if (ss0.simStorm) ended.push('demo storm');
    if (ss0.wxAt != null) ended.push('lens');
    if (ss0.spotlight) ended.push('spotlight');
  }
  return {
    kind: info.cause === 'undo' || info.undone ? 'undo' : 'cmd',
    parts,
    pinned,
    returnAll,
    ended,
    by: info.by || null,
    at,
    rev: after.rev,
  };
}

/**
 * The change a command will make, from a dry run of the same reducer (the
 * remote's result line; K10 asks with the same words). Null for a command
 * the reducer refuses.
 */
export function describeCommand(
  cmd,
  before,
  { at = Date.now(), by = null } = {},
) {
  if (!before) return null;
  const r = applyCommand(before, cmd, { at });
  if (r.error) return null;
  return describeChange(
    before,
    r.state,
    { cause: 'cmd', skipped: r.skipped, by },
    at,
  );
}

// --------------------------------------------------------------- phrases

/** Default name lookups: nothing is known, so nobody is named. */
const NO_NAMES = { person: () => null, place: () => null };

/** The words for one part (no scope), for an audience. */
export function phrase(
  part,
  { audience = 'remote', visitor = false, names = NO_NAMES } = {},
) {
  const v = part.to?.value;
  switch (part.field) {
    case 'role':
      return (ROLES[v] || ROLES.site).label;
    case 'mode':
      return v === 'advance' ? 'Advance' : 'Live';
    case 'day':
      return v == null ? 'today' : `Day ${v}`;
    case 'scale':
      return v ? `${v} scale` : 'role scale';
    case 'textScale':
      return `text ×${v}`;
    case 'pinned':
      return v ? 'pinned' : 'unpinned';
    case 'layers':
      return `${low(LAYER_LABELS[part.key] || part.key)} ${v ? 'on' : 'off'}`;
    case 'motion':
      return `${MOTION_LABELS[part.key] || part.key} motion ${v === false ? 'off' : 'on'}`;
    case 'frame': {
      if (v?.kind === 'floor') return `frames floor ${v.label}`;
      if (v?.kind === 'storm') return 'frames the storm';
      if (v?.kind === 'clear') return 'selection cleared';
      if (v?.kind === 'scale') return `${v.scale} scale`;
      return 'camera moved';
    }
    case 'whole':
      return v === 'added' ? 'added' : 'back to role defaults';
    case 'tripId':
      return tripById(v).title;
    case 'siteKey': {
      const s = v ? siteConfig(v) : null;
      return s ? s.short || s.label : 'the hotel';
    }
    case 'report':
      return v ? `reported floor ${v.floor}` : 'reported floor cleared';
    case 'incidentAck':
      return v ? 'incident acknowledged' : 'acknowledgement cleared';
    case 'spotlight': {
      if (!part.to?.id) return 'spotlight off';
      if (audience === 'log') return `spotlight ${part.to.kind} ${part.to.id}`;
      const full =
        part.to.kind === 'person'
          ? names.person(part.to.id)
          : names.place(part.to.id);
      if (!full)
        return `spotlight ${part.to.kind === 'person' ? 'a person' : 'a place'}`;
      return `spotlight ${part.to.kind === 'person' && audience === 'wall' ? wallName(full, { visitor }) : full}`;
    }
    case 'visitor':
      return v ? 'Visitor mode on' : 'Visitor mode off';
    case 'simStorm':
      return v ? 'demo storm started' : 'demo storm ended';
    case 'wxAt': {
      if (v == null) return 'weather now';
      const m = part.to.min;
      return m == null
        ? 'weather at another time'
        : `weather ${m < 0 ? '−' : '+'}${Math.abs(m)} min`;
    }
    case 'count':
      return `${v} screen${v === 1 ? '' : 's'}`;
    default:
      return FIELD_LABELS[part.field] || part.field;
  }
}

/** Parts of one scope, as one phrase list ("Advance · Day 2"). */
const joinParts = (parts, o) => parts.map((p) => phrase(p, o)).join(' · ');

/**
 * Render a change for a surface.
 *   remote: "S4: radar on" · "S1, S2, S4, S5: Advance · Day 2 · S3 pinned,
 *     unchanged" · "Every screen: spotlight Jay Patel" · "Every screen back
 *     to Live and role defaults · pinned too · demo storm ended"
 *   wall (o.slot): the chip's summary for that wall, or null when the
 *     change does not touch it: "Radar on" · "Every screen: Youth choir
 *     tour" · "Pinned: kept as it is"
 *   log: "21:32:05 · iPad · S4: radar on" (ids only, never a name)
 *   voice: the remote's words (V1 reads them aloud)
 * o: {audience, slot, visitor, names, timeZone}
 */
export function render(change, o = {}) {
  if (!change) return '';
  const audience = o.audience || 'remote';
  if (audience === 'wall') return wallSummary(change, o);
  if (audience === 'log') return logRow(change, o);
  return remoteText(change, o);
}

function groupByScope(parts) {
  const wall = parts.filter((p) => p.scope === 'wall');
  const screens = new Map();
  for (const p of parts)
    if (p.scope !== 'wall') {
      if (!screens.has(p.scope)) screens.set(p.scope, []);
      screens.get(p.scope).push(p);
    }
  return { wall, screens };
}

function remoteText(change, o) {
  const undo = change.kind === 'undo';
  if (change.returnAll && !undo) {
    const tail = change.ended.includes('demo storm')
      ? ' · demo storm ended'
      : '';
    return `Every screen back to Live and role defaults · pinned too${tail}`;
  }
  const { wall, screens } = groupByScope(change.parts);
  const out = [];
  if (wall.length) out.push(`Every screen: ${joinParts(wall, o)}`);
  // Screens with the same words share one line: "S1, S2, S4, S5: Advance".
  const lines = new Map();
  for (const [slot, ps] of [...screens].sort((a, b) => a[0] - b[0])) {
    const t = joinParts(ps, o);
    if (!lines.has(t)) lines.set(t, []);
    lines.get(t).push(slot);
  }
  for (const [t, slots] of lines) out.push(`${sList(slots)}: ${t}`);
  let text = out.join(' · ');
  if (undo)
    text = text
      ? `Undone on ${text.replace(/^Every screen: /, 'every screen: ')}`
      : 'Nothing undone';
  if (change.pinned.length)
    text += `${text ? ' · ' : ''}${sList(change.pinned)} pinned, unchanged`;
  return text;
}

function wallSummary(change, o) {
  const slot = Number(o.slot);
  if (change.pinned.includes(slot)) return 'Pinned: kept as it is';
  const undo = change.kind === 'undo';
  if (change.returnAll && !undo) return 'Every screen: back to Live';
  const mine = change.parts.filter((p) => p.scope === slot);
  const wall = change.parts.filter((p) => p.scope === 'wall');
  let text = '';
  if (mine.length) text = cap(joinParts(mine, { ...o, audience: 'wall' }));
  else if (wall.length)
    text = `Every screen: ${joinParts(wall, { ...o, audience: 'wall' })}`;
  else return null;
  return undo ? `Undone: ${low(text)}` : text;
}

/**
 * One scope's part of a change, for a card line: {on, text} with `on`
 * "S4" or "every screen" (slot null: the wall-wide part). "Last change on
 * S4 · 21:32 · radar on · by Laptop" is built from it. Null if untouched.
 */
export function scopeLine(change, slot, o = {}) {
  if (!change) return null;
  const undo = change.kind === 'undo';
  const pre = (t) => (undo ? `undone: ${t}` : t);
  if (slot == null) {
    if (change.returnAll && !undo)
      return { on: 'every screen', text: 'back to Live and role defaults' };
    const wall = change.parts.filter((p) => p.scope === 'wall');
    return wall.length
      ? { on: 'every screen', text: pre(joinParts(wall, o)) }
      : null;
  }
  const n = Number(slot);
  if (change.pinned.includes(n))
    return { on: `S${n}`, text: 'pinned, unchanged' };
  if (change.returnAll && !undo)
    return { on: `S${n}`, text: 'back to Live and role defaults' };
  const mine = change.parts.filter((p) => p.scope === n);
  return mine.length ? { on: `S${n}`, text: pre(joinParts(mine, o)) } : null;
}

function logRow(change, o) {
  const when = hhmmss(change.at, o.timeZone);
  const who = byText(change.by);
  if (change.returnAll && change.kind !== 'undo')
    return `${when} · ${who} · Return all${change.ended.length ? ` · ended: ${change.ended.join(', ')}` : ''}`;
  const { wall, screens } = groupByScope(change.parts);
  const lo = { ...o, audience: 'log' };
  const out = [];
  if (wall.length) out.push(`Every screen: ${joinParts(wall, lo)}`);
  const slots = [...screens.keys()].sort((a, b) => a - b);
  if (change.pinned.length && slots.length) {
    // An All push: what it set, where it applied and what it left.
    out.push(
      `All: ${joinParts(screens.get(slots[0]), lo)} · applied ${sList(slots)} · ${sList(change.pinned)} pinned`,
    );
  } else
    for (const s of slots) out.push(`S${s}: ${joinParts(screens.get(s), lo)}`);
  return `${when} · ${who} · ${change.kind === 'undo' ? 'Undo · ' : ''}${out.join(' · ')}`;
}

// ------------------------------------------------------------ attribution

/**
 * A device's name from an actor `{ref, kind, name}` (a broadcast's `by`)
 * or a ref looked up in presence `actors`. Never an id: an actor nobody
 * knows is "another device". A wall acts only from its own keyboard sheet
 * (shell D5), so a screen reads "S4 keyboard". V1 prefixes "Voice · " for
 * via 'voice'.
 */
export function byText(actor, actors = []) {
  const a =
    typeof actor === 'string'
      ? actors.find((x) => x.ref === actor) || null
      : actor;
  const name =
    a?.name && typeof a.name === 'string' ? a.name : 'another device';
  if (a?.kind === 'screen' && a.name) return `${name} keyboard`;
  return a?.via === 'voice' ? `Voice · ${name}` : name;
}

/**
 * The newest change a wall shows, from the state's field meta: its slot's
 * fields and the wall-wide ones. {at, ref, field, scope, rev} or null.
 */
export function lastChangeOf(state, slot = null) {
  let best = null;
  const take = (meta, scope) => {
    for (const [field, m] of Object.entries(meta || {}))
      if (
        m &&
        Number.isFinite(m.at) &&
        (!best || m.rev > best.rev || (m.rev === best.rev && m.at > best.at))
      )
        best = { at: m.at, ref: m.by ?? null, field, scope, rev: m.rev };
  };
  take(state?.session?.meta, 'wall');
  const slots = slot == null ? slotsOf(state) : [Number(slot)];
  for (const s of slots) take(state?.screens?.[s]?.meta, s);
  return best;
}

/**
 * The words for a change known only from meta (a page opened after it):
 * the field's current value where it says what changed ("Advance",
 * "Day plan"), else the field's label ("layer").
 */
export function metaPhrase(state, last, o = {}) {
  if (!last) return '';
  const src =
    last.scope === 'wall' ? state?.session : state?.screens?.[last.scope];
  if (!src || ['layers', 'motion', 'frame'].includes(last.field))
    return FIELD_LABELS[last.field] || last.field;
  return phrase(sessionOrScreenPart(last, src[last.field]), o);
}
const sessionOrScreenPart = (last, v) =>
  last.scope === 'wall'
    ? sessionPart(last.field, undefined, v, null)
    : { scope: last.scope, field: last.field, to: { value: v ?? null } };

/** Cut a string to `n` characters with "…". */
const cut = (s, n) =>
  s.length <= n ? s : n <= 1 ? '…' : `${s.slice(0, n - 1).trimEnd()}…`;

/**
 * The wall chip (SUP-4), at most CHIP_MAX characters.
 * o: {slot, online, controller: name|null, lastController: name|null,
 *   remoteGoneAt, change: {summary, byName, at} (the first 3 s),
 *   last: {at, byName} (idle), now, suffix (' · pinned' …),
 *   clock(ms) → "21:32", ages: true on a wall}
 * With `ages` (walls-live W5) the chip carries no clock time: a wall's
 * header clock is the trip's, so "Remote offline · 12 min", and a change
 * shows without its time (it is 3 s old).
 */
export function chipText(o) {
  const s = `S${o.slot ?? '?'}`;
  const clock = o.clock || ((ms) => hhmm(ms));
  const suffix = o.suffix || '';
  const fit = (head, flex, tail) => {
    // Fixed head and tail; the flexible middle is cut with "…".
    const room = CHIP_MAX - head.length - tail.length - suffix.length;
    return `${head}${cut(flex, Math.max(1, room))}${tail}${suffix}`;
  };
  if (!o.online) return `${s} · not connected${suffix}`.slice(0, CHIP_MAX);
  if (!o.controller) {
    const who = o.lastController ? ` (${o.lastController})` : '';
    const since = !o.remoteGoneAt
      ? ''
      : o.ages
        ? ` · ${forText((o.now ?? Date.now()) - o.remoteGoneAt)}`
        : ` · since ${clock(o.remoteGoneAt)}`;
    const full = `${s} · Remote offline${who}${since}${suffix}`;
    return full.length <= CHIP_MAX
      ? full
      : `${s} · Remote offline${who}${suffix}`;
  }
  if (o.change) {
    const c = o.change;
    const pinned = c.summary === 'Pinned: kept as it is';
    const by = ` · ${pinned ? 'push ' : ''}by ${c.byName}`;
    const time = o.ages ? '' : ` · ${clock(c.at)}`;
    const head = `${s} · `;
    // The time goes first, then the summary is cut; the name never is.
    if ((head + c.summary + by + time + suffix).length <= CHIP_MAX)
      return head + c.summary + by + time + suffix;
    if (CHIP_MAX - head.length - by.length - suffix.length >= 10)
      return fit(head, c.summary, by);
    // A long name and suffixes: the suffixes give way before the words.
    return `${head}${cut(c.summary, Math.max(1, CHIP_MAX - head.length - by.length))}${by}`;
  }
  const base = `${s} · Remote: ${o.controller}`;
  if (!o.last) return `${base}${suffix}`;
  const other =
    o.last.byName && o.last.byName !== o.controller
      ? ` by ${o.last.byName}`
      : '';
  const full = `${base} · last change ${agoText(o.now - o.last.at)} ago${other}${suffix}`;
  if (full.length <= CHIP_MAX) return full;
  // Too long with the other device's name: the last change goes as a whole.
  return `${base}${suffix}`;
}

// ------------------------------------------------------- operator states

/**
 * The remote's control cell (Appendix D, SUP-4): "In control · this remote
 * (iPad)", "View only · iPad in control since 21:20", "View only · no
 * remote in control", "Not connected · retrying", and after 15 s "Can't
 * reach the Trip Twin computer from {host} · retrying" (2d).
 * o: {link: 'online'|…, offlineMs, host, controller, me, ctl, since, clock}
 */
export function controlText(o) {
  const clock = o.clock || ((ms) => hhmm(ms));
  if (o.link !== 'online')
    return o.offlineMs >= 15000
      ? `Can't reach the Trip Twin computer from ${o.host} · retrying`
      : 'Not connected · retrying';
  if (o.controller)
    return `In control · this remote (${o.me || 'this device'})`;
  if (o.ctl)
    return `View only · ${o.ctl}${Number.isFinite(o.since) ? ` in control since ${clock(o.since)}` : ' in control'}`;
  return 'View only · no remote in control';
}

/** Status-strip items (Appendix D 1, 3): one list for remote and launcher. */
export const STATUS = Object.freeze({
  LOG: 'Log not writing',
  RELOAD_REMOTE: 'This remote page is out of date · nothing was sent',
  RELOAD_PAGE: 'This page is out of date',
  RELOAD: 'Reload',
});

/**
 * A wall card (Appendix D 1a, 6c, 6d, 7, 7a; SUP-5): {kind, kicker,
 * lines, code?, button?, foot?}. Cards with a code are pairing cards; the
 * others replace the scene and show no code. d: {slot, at, until, code,
 * expires, host, retryAfterMs, error, clock}.
 */
export function wallCard(kind, d = {}) {
  const clock = d.clock || ((ms) => hhmm(ms));
  const S = d.slot ? `S${d.slot}` : 'This screen';
  const how =
    'On the remote in control: Screens & devices › Pair a screen. Enter this code and pick the screen number.';
  const valid = d.expires
    ? `Code valid until ${clock(d.expires)} · a new one appears then`
    : '';
  const foot = `${d.host || ''} · this window shows nothing from the wall until it is paired`;
  const pairing = (kicker, lines = []) => ({
    kind,
    kicker,
    lines,
    code: d.code,
    how,
    valid,
    foot,
  });
  switch (kind) {
    case 'pair':
      return pairing('PAIR THIS SCREEN');
    case 'link-expired':
      return pairing('PAIR THIS SCREEN', [
        'This screen link was already used or has expired · pair with the code below',
      ]);
    case 'lost':
      return pairing('PAIR THIS SCREEN AGAIN', [
        `This window lost its pairing at ${clock(d.at)}: another window took it over.`,
      ]);
    case 'slot-taken':
      return pairing('PAIR THIS SCREEN AGAIN', [
        `${S} moved to another device at ${clock(d.at)}. Pair this window again with this code if you need it.`,
      ]);
    case 'token-expired':
      return pairing('PAIR THIS SCREEN AGAIN', [
        'its pairing ended after 30 days without use · enter this code on the remote',
      ]);
    case 'replaced':
      return {
        kind,
        kicker: `${S.toUpperCase()} IS SHOWN IN ANOTHER WINDOW`,
        lines: [`since ${clock(d.at)} · this window can be closed`],
        button: 'Use this window instead',
      };
    case 'reload':
      return {
        kind,
        kicker: 'THIS SCREEN NEEDS A RELOAD',
        lines: [
          `refused as out of date at ${clock(d.at)} · it shows nothing from the wall until reloaded`,
        ],
      };
    case 'rate-limited':
      return {
        kind,
        kicker: 'REJOINING PAUSED',
        lines: [
          `Rejoining paused on this computer until ${clock(d.until)} · too many tries · screens already on the wall are not affected`,
        ],
      };
    case 'busy':
      return {
        kind,
        kicker: 'WAITING TO PAIR',
        lines: [
          `Too many screens are waiting to pair · trying again in ${Math.max(1, Math.ceil((d.retryAfterMs || 60000) / 60000))} min`,
        ],
      };
    default:
      // Any other refusal: what the Trip Twin computer said, no code.
      return {
        kind: 'denied',
        kicker: "THIS SCREEN CAN'T JOIN THE WALL",
        lines: [
          `${d.error || 'Refused by the Trip Twin computer'} · it shows nothing from the wall until it joins`,
        ],
      };
  }
}
