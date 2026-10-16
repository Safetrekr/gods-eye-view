// SOC multi-view session state (phase 10; review: supervision spec). Three
// tiers: one shared session, per-screen state, local-only (never here).
// The remote is the only writer; every write gets a monotonic rev. "All"
// writes only the fields it names and skips pinned screens. Pure.
import { ROLES, defaultRoles } from './twinScreenRoles.js';

const SESSION_FIELDS = new Set([
  'tripId',
  'siteKey',
  'mode', // 'live' | 'advance'
  'day', // Advance day number, null = today
  'wxAt', // weather time (ms) or null = now
  'report', // {floor, kind} reported floor or null
  'incidentAck', // the remote acknowledged the incident banner
  'spotlight', // {kind: 'person'|'place', id} or null
  'visitor', // visitor mode: walls show initials and counts only
]);
const SCREEN_FIELDS = new Set([
  'role',
  'scale', // 'building' | 'neighborhood' | 'city'
  'textScale', // wall text multiplier
  'pinned',
  'layers', // {[layer]: bool}, merged
  'frame', // one-shot camera intent {subject, nonce}; never a copied camera
]);

const clone = (x) => JSON.parse(JSON.stringify(x));

export function screenDefaults(role) {
  const r = ROLES[role] || ROLES.site;
  return {
    role: r.key,
    scale: r.scale || null,
    textScale: r.textScale || 2,
    pinned: false,
    layers: {},
    frame: null,
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
      mode: 'live',
      day: null,
      wxAt: null,
      report: null,
      incidentAck: false,
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
 * Apply one command. Returns {state, changed, skipped, undo} — undo is the
 * snapshot to restore (whole session + touched screens) for 10 s.
 * cmd:
 *   {type: 'session', patch}
 *   {type: 'screens', target: 1..6 | 'all', patch}
 *   {type: 'reset', target}            role defaults (keeps role and pin)
 *   {type: 'count', n}                 number of screens
 *   {type: 'returnLive'}               Live, now, no spotlight; screens to
 *                                      role defaults (the wall kill switch)
 */
export function applyCommand(
  state,
  cmd,
  { by = 'remote', at = Date.now() } = {},
) {
  const next = clone(state);
  const undo = { session: clone(state.session), screens: {} };
  const changed = [];
  const skipped = [];
  const rev = state.rev + 1;
  const mark = (s, field, source) => {
    s.meta = s.meta || {};
    s.meta[field] = { source, rev, by, at };
  };
  const touch = (slot) => {
    if (!(slot in undo.screens))
      undo.screens[slot] = clone(state.screens[slot]);
  };
  switch (cmd?.type) {
    case 'session': {
      for (const [k, v] of Object.entries(cmd.patch || {}))
        if (SESSION_FIELDS.has(k)) {
          next.session[k] = v;
          if (!changed.includes('session')) changed.push('session');
        }
      // A new report needs a fresh acknowledgement.
      if ('report' in (cmd.patch || {}) && !('incidentAck' in cmd.patch))
        next.session.incidentAck = false;
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
        touch(slot);
        for (const [k, v] of Object.entries(cmd.patch || {})) {
          if (!SCREEN_FIELDS.has(k)) continue;
          if (k === 'pinned' && all) continue; // pins are per screen
          if (k === 'layers') s.layers = { ...s.layers, ...v };
          else if (k === 'role') {
            const d = screenDefaults(v);
            s.role = d.role;
            s.scale = d.scale;
            s.merged = [];
          } else s[k] = v;
          mark(s, k, all ? 'all' : 'override');
        }
        changed.push(slot);
      }
      break;
    }
    case 'reset': {
      for (const slot of slotsFor(state, cmd.target)) {
        const s = next.screens[slot];
        touch(slot);
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
          touch(slot);
          delete next.screens[slot];
        }
      for (const d of roles) {
        if (!next.screens[d.slot])
          next.screens[d.slot] = {
            ...screenDefaults(d.role),
            merged: d.merged,
          };
        else next.screens[d.slot].merged = d.merged;
        changed.push(d.slot);
      }
      next.count = n;
      break;
    }
    case 'returnLive': {
      Object.assign(next.session, {
        mode: 'live',
        day: null,
        wxAt: null,
        spotlight: null,
      });
      changed.push('session');
      for (const slot of Object.keys(state.screens).map(Number)) {
        const s = next.screens[slot];
        touch(slot);
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

/** Restore an undo snapshot as a new revision (never rewinds rev). */
export function applyUndo(
  state,
  undo,
  { by = 'remote', at = Date.now() } = {},
) {
  if (!undo) return state;
  const next = clone(state);
  next.session = clone(undo.session);
  for (const [slot, s] of Object.entries(undo.screens)) {
    if (s) next.screens[slot] = clone(s);
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
    text: `${fields.join(', ') || 'context'} → ${applied.map((s) => `S${s}`).join(', ') || 'no screen'}${pinned.length ? ` (${pinned.map((s) => `S${s}`).join(', ')} pinned, skipped)` : ''}`,
  };
}

/** Pushes that change what a screen is about ask before they run. */
export function needsConfirm(cmd) {
  if (cmd?.type === 'returnLive' || cmd?.type === 'count') return true;
  if (cmd?.type === 'session')
    return ['mode', 'tripId', 'day'].some((k) => k in (cmd.patch || {}));
  if (cmd?.type === 'screens' && cmd.target === 'all')
    return ['role', 'frame', 'scale'].some((k) => k in (cmd.patch || {}));
  return false;
}
