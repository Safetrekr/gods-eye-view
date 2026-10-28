// SOC multi-view session state (phase 10; review: supervision spec and
// review/phase10 R2/R4/R12). Three tiers: one shared session (wall-wide),
// per-screen state, local-only (never here). The remote is the only writer;
// every write gets a monotonic rev. "All" writes only the fields it names
// and skips pinned screens. Live / Advance and the day are per screen, so a
// pinned incident board stays Live. Pure.
// Phase CF K5 (BE-1, SEC-11): `by` is the actor's public ref ('D3'), never
// a device id; session fields get `session.meta[field]` like screen fields.
import { ROLES, defaultRoles } from './twinScreenRoles.js';

/** Wall-wide: one value for every screen. */
const SESSION_FIELDS = new Set([
  'tripId',
  'siteKey',
  'wxAt', // weather time (ms) or null = now
  'report', // {id, floor, kind, at} operator's reported floor, or null
  'incidentAck', // id of the report the remote acknowledged, or null
  'spotlight', // {kind: 'person'|'place', id} or null
  'visitor', // visitor mode: walls show initials and counts only
  'simStorm', // demo: start (ms) of the simulated storm, or null (phase 12)
  // demo: start (ms) of the simulated fire boundary / hurricane, or null
  // (review/hazards H5-PLAN).
  'simFire',
  'simCyclone',
  // The one traffic camera on the walls: {tripId, place, slot, id, at, by}
  // or null (review/traffic-cameras T5). Set by the All-in-one only (host
  // camera()); a command may only clear it.
  'camera',
  // false = every wall view only: no menu or sheets, nothing saved at a
  // wall (Jesse, 25 Oct 2026: screens/20-S1-FIX-LIST Q2). Missing = on.
  'wallControls',
]);
/** Per screen: the target picker decides which screens. */
const SCREEN_FIELDS = new Set([
  'role',
  'mode', // 'live' | 'advance'
  'day', // Advance / day-plan day number, null = today
  'scale', // 'building' | 'neighborhood' | 'city'
  'textScale', // wall text multiplier
  'pinned',
  'layers', // {[layer]: bool}, merged
  'frame', // one-shot camera intent {subject, nonce}; never a copied camera
  'motion', // {live, event, cine}: this wall's motion tiers (phase 11)
  'layout', // {cards, width, order, off}: this wall's layout (screens/05-S1-PLAN)
]);

/** The demos (start ms or null): Return all and a trip switch end them all. */
export const SIM_KEYS = Object.freeze(['simStorm', 'simFire', 'simCyclone']);
/** The host ends a demo this long after it started (hazards H5). */
export const SIM_DEMO_MAX_MS = 45 * 60e3;

const clone = (x) => JSON.parse(JSON.stringify(x));

export function screenDefaults(role) {
  const r = ROLES[role] || ROLES.site;
  return {
    role: r.key,
    mode: 'live',
    day: null,
    scale: r.scale || null,
    textScale: r.textScale || 2,
    pinned: false,
    layers: {},
    frame: null,
    motion: { live: true, event: true, cine: true },
    layout: {},
    meta: {},
  };
}

/** A new session for N screens, roles from the defaults. */
export function createSession({ count = 4, tripId = null, epochMs = 0 } = {}) {
  const screens = {};
  for (const d of defaultRoles(count))
    screens[d.slot] = { ...screenDefaults(d.role), merged: d.merged };
  return {
    rev: 0,
    count: Object.keys(screens).length,
    session: {
      tripId,
      siteKey: null,
      wxAt: null,
      report: null,
      incidentAck: null,
      spotlight: null,
      visitor: false,
      simStorm: null,
      simFire: null,
      simCyclone: null,
      wallControls: true,
      epochMs,
    },
    screens,
  };
}

const slotsFor = (state, target) =>
  target === 'all'
    ? Object.keys(state.screens).map(Number)
    : [Number(target)].filter((s) => state.screens[s]);

/**
 * Apply one command. Returns {state, changed, skipped, undo}. undo holds
 * only what this command changed (field-level), for 10 s.
 * cmd:
 *   {type: 'session', patch}
 *   {type: 'screens', target: 1..6 | 'all', patch}
 *   {type: 'reset', target, keep?}     role defaults (keeps role and pin;
 *                                      keep: ['mode', 'day'] from a wall)
 *   {type: 'count', n}                 number of screens
 *   {type: 'returnLive'}               every screen Live, now, role
 *                                      defaults — pins included (the wall
 *                                      kill switch says so)
 */
export function applyCommand(state, cmd, { by = null, at = Date.now() } = {}) {
  const next = clone(state);
  // Undo: session fields → old value; screens → {fields} or {whole}.
  const undo = { session: {}, screens: {} };
  const changed = [];
  const skipped = [];
  const rev = state.rev + 1;
  const mark = (s, field, source) => {
    s.meta = s.meta || {};
    s.meta[field] = { source, rev, by, at };
  };
  const markSession = (field) => mark(next.session, field, 'session');
  const keepField = (slot, field) => {
    const u = (undo.screens[slot] = undo.screens[slot] || { fields: {} });
    if (u.fields && !(field in u.fields))
      u.fields[field] = clone(state.screens[slot]?.[field] ?? null);
  };
  const keepWhole = (slot) => {
    undo.screens[slot] = { whole: clone(state.screens[slot] ?? null) };
  };
  switch (cmd?.type) {
    case 'session': {
      const patch = { ...(cmd.patch || {}) };
      // A new report needs a fresh acknowledgement.
      if ('report' in patch && !('incidentAck' in patch))
        patch.incidentAck = null;
      // Another trip: the wall camera belonged to the last one (AIA round 1).
      if (
        'tripId' in patch &&
        patch.tripId !== state.session.tripId &&
        state.session.camera
      )
        patch.camera = null;
      for (const [k, v] of Object.entries(patch))
        if (SESSION_FIELDS.has(k)) {
          // A command stops the wall camera; it never puts one up.
          if (k === 'camera' && v !== null) continue;
          if (!(k in undo.session))
            undo.session[k] = clone(state.session[k] ?? null);
          next.session[k] = v;
          markSession(k);
          if (!changed.includes('session')) changed.push('session');
        }
      break;
    }
    case 'screens': {
      const all = cmd.target === 'all';
      for (const slot of slotsFor(state, cmd.target)) {
        const s = next.screens[slot];
        // Pinned screens keep their state through an All push.
        if (all && s.pinned) {
          skipped.push(slot);
          continue;
        }
        for (const [k, v] of Object.entries(cmd.patch || {})) {
          if (!SCREEN_FIELDS.has(k)) continue;
          if (k === 'pinned' && all) continue; // pins are per screen
          if (k === 'role') {
            for (const f of ['role', 'scale', 'merged']) keepField(slot, f);
            // The wall camera goes with the role it was sent to (AIA round 1).
            if (
              state.session.camera?.slot === slot &&
              v !== state.screens[slot]?.role
            ) {
              if (!('camera' in undo.session))
                undo.session.camera = clone(state.session.camera);
              next.session.camera = null;
              markSession('camera');
              if (!changed.includes('session')) changed.push('session');
            }
            const d = screenDefaults(v);
            s.role = d.role;
            s.scale = d.scale;
            s.merged = [];
          } else {
            keepField(slot, k);
            if (k === 'layers' || k === 'motion' || k === 'layout')
              s[k] = { ...(s[k] || {}), ...v };
            else s[k] = v;
          }
          mark(s, k, all ? 'all' : 'override');
        }
        changed.push(slot);
      }
      break;
    }
    case 'reset': {
      for (const slot of slotsFor(state, cmd.target)) {
        const s = next.screens[slot];
        keepWhole(slot);
        next.screens[slot] = {
          ...screenDefaults(s.role),
          pinned: s.pinned,
          merged: s.merged || [],
        };
        // A wall's own Reset keeps what the remote decides (mode, day).
        for (const k of Array.isArray(cmd.keep) ? cmd.keep : [])
          if (k === 'mode' || k === 'day') next.screens[slot][k] = s[k];
        changed.push(slot);
      }
      break;
    }
    case 'count': {
      const n = Math.max(1, Math.min(6, Math.round(Number(cmd.n) || 1)));
      const roles = defaultRoles(n);
      for (const slot of Object.keys(state.screens).map(Number))
        if (slot > n) {
          keepWhole(slot);
          delete next.screens[slot];
          // The wall camera goes with its wall (every-time round 2).
          if (state.session.camera?.slot === slot) {
            undo.session.camera = clone(state.session.camera);
            next.session.camera = null;
            markSession('camera');
            if (!changed.includes('session')) changed.push('session');
          }
        }
      for (const d of roles) {
        if (!next.screens[d.slot]) {
          undo.screens[d.slot] = { whole: null };
          next.screens[d.slot] = {
            ...screenDefaults(d.role),
            merged: d.merged,
          };
        } else next.screens[d.slot].merged = d.merged;
        changed.push(d.slot);
      }
      next.count = n;
      break;
    }
    case 'returnLive': {
      // Return all also ends every demo (phase 12 review; hazards H5).
      for (const k of SIM_KEYS.concat(['wxAt', 'spotlight', 'camera'])) {
        undo.session[k] = clone(state.session[k] ?? null);
        next.session[k] = null;
        markSession(k);
      }
      changed.push('session');
      for (const slot of Object.keys(state.screens).map(Number)) {
        const s = next.screens[slot];
        keepWhole(slot);
        next.screens[slot] = {
          ...screenDefaults(s.role),
          pinned: s.pinned,
          merged: s.merged || [],
        };
        changed.push(slot);
      }
      break;
    }
    default:
      return {
        state,
        changed: [],
        skipped: [],
        undo: null,
        error: 'unknown command',
      };
  }
  next.rev = rev;
  return { state: next, changed, skipped, undo };
}

/**
 * Restore what one command changed, as a new revision (never rewinds rev).
 * A camera framing is never replayed by an undo. `of`: the rev undone.
 */
export function applyUndo(
  state,
  undo,
  { by = null, at = Date.now(), of = null } = {},
) {
  if (!undo) return state;
  const next = clone(state);
  for (const [k, v] of Object.entries(undo.session || {}))
    next.session[k] = clone(v);
  for (const [slot, u] of Object.entries(undo.screens || {})) {
    if ('whole' in u) {
      if (u.whole)
        next.screens[slot] = {
          ...clone(u.whole),
          frame: next.screens[slot]?.frame ?? null,
        };
      else delete next.screens[slot];
      continue;
    }
    if (!next.screens[slot]) continue;
    for (const [k, v] of Object.entries(u.fields || {}))
      if (k !== 'frame') next.screens[slot][k] = clone(v);
  }
  next.count = Object.keys(next.screens).length;
  next.rev = state.rev + 1;
  next.lastUndo = { by, at, of };
  return next;
}

// ---------------------------------------------------------------- A9
// Revision-checked undo (Phase CF K9; cf/02-backend.md BE-4, C10, C11;
// VOICE-CONTROL §3.4). The host keeps a ledger: for every field (screen
// layers, motion and layout per key; a screen itself as `S4`), the
// revision that last wrote it. An undo restores a field only while the
// ledger still names the undone command's revision; anything changed since
// is skipped and named ("Not undone: role, changed 21:32 by iPad"). The
// broadcast `meta` keeps its meaning (C10): the ledger is the host's alone.

const SUBKEYED = new Set(['layers', 'motion', 'layout']);
/** Screen fields the ledger follows: the reducer's, plus `merged`. */
const SCREEN_LEDGER = [...SCREEN_FIELDS, 'merged'];
const sameValue = (a, b) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Every field that differs between two states, as ledger entries
 * `{key, scope, field, sub?, from, to}`: `session.visitor`, `S4.role`,
 * `S4.layers.radar`, and `S4` (field null) for a screen added or removed.
 * Pure; `meta`, `rev` and `count` are not fields (count follows screens).
 */
export function changeList(before, after) {
  const out = [];
  const b = before || { session: {}, screens: {} };
  const a = after || { session: {}, screens: {} };
  for (const f of SESSION_FIELDS)
    if (!sameValue(b.session?.[f], a.session?.[f]))
      out.push({
        key: `session.${f}`,
        scope: 'session',
        field: f,
        from: b.session?.[f] ?? null,
        to: a.session?.[f] ?? null,
      });
  const slots = [
    ...new Set([
      ...Object.keys(b.screens || {}),
      ...Object.keys(a.screens || {}),
    ]),
  ]
    .map(Number)
    .sort((x, y) => x - y);
  for (const slot of slots) {
    const s0 = b.screens?.[slot];
    const s1 = a.screens?.[slot];
    const scope = `S${slot}`;
    if (!s0 || !s1) {
      out.push({
        key: scope,
        scope,
        field: null,
        from: s0 ? 'screen' : null,
        to: s1 ? 'screen' : null,
      });
      continue;
    }
    for (const f of SCREEN_LEDGER) {
      if (SUBKEYED.has(f)) {
        const keys = new Set([
          ...Object.keys(s0[f] || {}),
          ...Object.keys(s1[f] || {}),
        ]);
        for (const k of [...keys].sort())
          if (!sameValue(s0[f]?.[k], s1[f]?.[k]))
            out.push({
              key: `${scope}.${f}.${k}`,
              scope,
              field: f,
              sub: k,
              from: s0[f]?.[k] ?? null,
              to: s1[f]?.[k] ?? null,
            });
      } else if (!sameValue(s0[f], s1[f]))
        out.push({
          key: `${scope}.${f}`,
          scope,
          field: f,
          from: s0[f] ?? null,
          to: s1[f] ?? null,
        });
    }
  }
  return out;
}

/**
 * The ledger keys a command NAMES on the screens it reached, changed or
 * not: a second writer who sets the same value still owns the field, so
 * an undo of the first leaves it (BE-4). Keys only.
 */
export function namedKeys(cmd, state, skipped = []) {
  const out = [];
  const patch = cmd?.patch && typeof cmd.patch === 'object' ? cmd.patch : {};
  if (cmd?.type === 'session')
    for (const k of Object.keys(patch))
      if (SESSION_FIELDS.has(k)) out.push(`session.${k}`);
  if (cmd?.type === 'screens')
    for (const slot of slotsFor(state, cmd.target)) {
      if (skipped.includes(slot)) continue;
      for (const [k, v] of Object.entries(patch)) {
        if (!SCREEN_FIELDS.has(k)) continue;
        if (SUBKEYED.has(k) && v && typeof v === 'object')
          for (const sub of Object.keys(v)) out.push(`S${slot}.${k}.${sub}`);
        else if (k === 'role')
          for (const f of ['role', 'scale', 'merged'])
            out.push(`S${slot}.${f}`);
        else out.push(`S${slot}.${k}`);
      }
    }
  return out;
}

/** Stamp the ledger (in place) with what one write touched. */
export function stampLedger(ledger, keys, { rev, by = null, via = null, at }) {
  for (const k of keys) ledger[k] = { rev, by, via, at };
  return ledger;
}

/**
 * The undo of one command, field by field against the ledger (A9).
 * record: {rev, before, changes, type} (the command's revision, the state
 * before it, its changeList, its type). Returns {state, restored, skipped,
 * changes}: `restored` [{scope, field}], `skipped` [{scope, field, reason,
 * by, via, at, rev}] with reason 'changed' (written since; `by`/`at` say
 * who and when), 'camera' (a framing is never replayed), 'gone' (the
 * screen is not there any more) or 'recreated' (a removed screen came
 * back). Nothing restored → the same state, no new revision.
 */
export function applyUndoChecked(
  state,
  record,
  ledger = {},
  { by = null, at = Date.now() } = {},
) {
  const restored = [];
  const skipped = [];
  if (!record?.before || !Array.isArray(record.changes))
    return { state, restored, skipped, changes: [] };
  const before = record.before;
  const next = clone(state);
  const newRev = state.rev + 1;
  // Reset, Return all and count replace whole screens with empty meta: the
  // fields they put back get the meta they had (as the old whole undo did).
  const whole = ['reset', 'returnLive', 'count'].includes(record.type);
  const owned = (key) => ledger[key]?.rev === record.rev;
  const who = (key, reason) => {
    const l = ledger[key];
    return {
      reason,
      by: l?.by ?? null,
      via: l?.via ?? null,
      at: l?.at ?? null,
      rev: l?.rev ?? null,
    };
  };
  const name = (c) => (c.sub != null ? `${c.field}.${c.sub}` : c.field);
  for (const c of record.changes) {
    const slot = c.scope === 'session' ? null : Number(c.scope.slice(1));
    if (c.field === 'frame') {
      skipped.push({ scope: c.scope, field: 'frame', ...who(c.key, 'camera') });
      continue;
    }
    if (c.field === null) {
      // A screen the command added or removed.
      const here = Boolean(next.screens[slot]);
      if (c.from == null) {
        if (!here)
          skipped.push({
            scope: c.scope,
            field: 'screen',
            ...who(c.key, 'gone'),
          });
        else {
          // Deleted only if nothing on it was written since (BE-4).
          const later = Object.entries(ledger).find(
            ([k, v]) =>
              (k === c.scope || k.startsWith(`${c.scope}.`)) &&
              v.rev > record.rev,
          );
          if (later || !owned(c.key))
            skipped.push({
              scope: c.scope,
              field: 'screen',
              ...who(later ? later[0] : c.key, 'changed'),
            });
          else {
            delete next.screens[slot];
            restored.push({ scope: c.scope, field: 'screen' });
          }
        }
      } else if (here)
        skipped.push({
          scope: c.scope,
          field: 'screen',
          ...who(c.key, 'recreated'),
        });
      else if (!owned(c.key))
        skipped.push({
          scope: c.scope,
          field: 'screen',
          ...who(c.key, 'changed'),
        });
      else {
        next.screens[slot] = { ...clone(before.screens[slot]), frame: null };
        restored.push({ scope: c.scope, field: 'screen' });
      }
      continue;
    }
    if (slot === null) {
      if (!owned(c.key)) {
        skipped.push({
          scope: 'session',
          field: c.field,
          ...who(c.key, 'changed'),
        });
        continue;
      }
      next.session[c.field] = clone(before.session?.[c.field] ?? null);
      if (whole) {
        const m = before.session?.meta?.[c.field];
        next.session.meta = { ...(next.session.meta || {}) };
        if (m) next.session.meta[c.field] = clone(m);
        else delete next.session.meta[c.field];
      }
      restored.push({ scope: 'session', field: c.field });
      continue;
    }
    const s = next.screens[slot];
    if (!s) {
      skipped.push({ scope: c.scope, field: name(c), ...who(c.key, 'gone') });
      continue;
    }
    if (!owned(c.key)) {
      skipped.push({
        scope: c.scope,
        field: name(c),
        ...who(c.key, 'changed'),
      });
      continue;
    }
    const old = before.screens?.[slot];
    if (c.sub != null) {
      s[c.field] = { ...(s[c.field] || {}) };
      const v = old?.[c.field]?.[c.sub];
      if (v === undefined) delete s[c.field][c.sub];
      else s[c.field][c.sub] = clone(v);
    } else
      s[c.field] = clone(old?.[c.field] ?? (c.field === 'merged' ? [] : null));
    s.meta = { ...(s.meta || {}) };
    if (
      c.field === 'scale' &&
      state.screens[slot]?.meta?.scale?.rev === record.rev
    )
      // C11: a scale write undone gets a new rev, so the wall flies back.
      s.meta.scale = { source: 'undo', rev: newRev, by, at };
    else if (
      whole &&
      !restored.some((r) => r.scope === c.scope && r.field === c.field)
    ) {
      const m = old?.meta?.[c.field];
      if (m) s.meta[c.field] = clone(m);
      else delete s.meta[c.field];
    }
    restored.push({ scope: c.scope, field: name(c) });
  }
  if (!restored.length) return { state, restored, skipped, changes: [] };
  next.count = Object.keys(next.screens).length;
  next.rev = newRev;
  next.lastUndo = { by, at, of: record.rev };
  return { state: next, restored, skipped, changes: changeList(state, next) };
}

/** What an All push would change, for the confirm line on the remote. */
export function previewAll(state, patch) {
  const slots = Object.keys(state.screens).map(Number);
  const pinned = slots.filter((s) => state.screens[s].pinned);
  const applied = slots.filter((s) => !state.screens[s].pinned);
  const fields = Object.keys(patch || {}).filter((k) => SCREEN_FIELDS.has(k));
  return {
    applied,
    pinned,
    text: `${fields.join(', ') || 'context'} → ${applied.map((s) => `S${s}`).join(', ') || 'no screen'}${pinned.length ? ` · ${pinned.map((s) => `S${s}`).join(', ')} pinned, unchanged` : ''}`,
  };
}

/** Pushes that change what a screen is about, or every screen, ask first. */
export function needsConfirm(cmd) {
  if (cmd?.type === 'returnLive' || cmd?.type === 'count') return true;
  if (cmd?.type === 'reset' && cmd.target === 'all') return true;
  if (cmd?.type === 'session') {
    const p = cmd.patch || {};
    return (
      'tripId' in p ||
      'siteKey' in p ||
      ('report' in p && p.report === null) ||
      ('visitor' in p && p.visitor === false) ||
      // Starting a demo puts SIMULATED weather or hazards on every wall.
      SIM_KEYS.some((k) => Boolean(p[k]))
    );
  }
  if (cmd?.type === 'screens' && cmd.target === 'all')
    return ['role', 'frame', 'scale', 'mode', 'day'].some(
      (k) => k in (cmd.patch || {}),
    );
  return false;
}
