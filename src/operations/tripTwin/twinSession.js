// SOC multi-view session state (phase 10; review: supervision spec and
// review/phase10 R2/R4/R12). Three tiers: one shared session (wall-wide),
// per-screen state, local-only (never here). The remote is the only writer;
// every write gets a monotonic rev. "All" writes only the fields it names
// and skips pinned screens. Live / Advance and the day are per screen, so a
// pinned incident board stays Live. Pure.
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
]);

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
 *   {type: 'reset', target}            role defaults (keeps role and pin)
 *   {type: 'count', n}                 number of screens
 *   {type: 'returnLive'}               every screen Live, now, role
 *                                      defaults — pins included (the wall
 *                                      kill switch says so)
 */
export function applyCommand(
  state,
  cmd,
  { by = 'remote', at = Date.now() } = {},
) {
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
      for (const [k, v] of Object.entries(patch))
        if (SESSION_FIELDS.has(k)) {
          if (!(k in undo.session))
            undo.session[k] = clone(state.session[k] ?? null);
          next.session[k] = v;
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
            const d = screenDefaults(v);
            s.role = d.role;
            s.scale = d.scale;
            s.merged = [];
          } else {
            keepField(slot, k);
            if (k === 'layers' || k === 'motion')
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
      for (const k of ['wxAt', 'spotlight']) {
        undo.session[k] = clone(state.session[k] ?? null);
        next.session[k] = null;
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
 * A camera framing is never replayed by an undo.
 */
export function applyUndo(
  state,
  undo,
  { by = 'remote', at = Date.now() } = {},
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
  next.lastUndo = { by, at };
  return next;
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
      ('visitor' in p && p.visitor === false)
    );
  }
  if (cmd?.type === 'screens' && cmd.target === 'all')
    return ['role', 'frame', 'scale', 'mode', 'day'].some(
      (k) => k in (cmd.patch || {}),
    );
  return false;
}
