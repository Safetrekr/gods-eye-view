// "Never less safe", mechanically (review/fitzroy-commands F5 D5, D7). Pure:
// the catalog's guard uses it now; the relay checks the same on voice
// commands later (V1, after K10).
import { SIM_KEYS, needsConfirm } from '../twinSession.js';
import { SAFETY_LAYERS } from '../twinScreenRoles.js';

/** Fields a command may never carry (the relay stamps the actor). */
export const ACTOR_FIELDS = Object.freeze(['by', 'via', 'proposalId']);

const targets = (cmd, state) =>
  cmd.target === 'all'
    ? Object.keys(state?.screens || {}).map(Number)
    : [Number(cmd.target)];

/**
 * Why a command would make the wall less safe, or null (CF-D4). A value
 * that does not change is never "lowering": a trip switch writes nulls
 * that are already null.
 */
export function lowersProtection(message, state = {}) {
  if (message?.t !== 'cmd') return null;
  const cmd = message.cmd || {};
  const ss = state.session || {};
  if (cmd.type === 'count') return 'screen count';
  if (cmd.type === 'session') {
    const p = cmd.patch || {};
    if (p.visitor === false && ss.visitor) return 'visitor off';
    if ('report' in p && (p.report ?? null) !== (ss.report ?? null))
      return p.report ? 'report added' : 'report cleared';
    if (
      'incidentAck' in p &&
      (p.incidentAck ?? null) !== (ss.incidentAck ?? null)
    )
      return 'incident acknowledged';
    for (const k of SIM_KEYS) if (p[k] && !ss[k]) return 'demo started';
    if (
      'wallControls' in p &&
      p.wallControls !== false &&
      ss.wallControls === false
    )
      return 'wall controls on';
  }
  if (cmd.type === 'screens') {
    const p = cmd.patch || {};
    if (p.pinned === false) return 'unpinned';
    if (ss.report && p.layers)
      for (const k of SAFETY_LAYERS)
        if (p.layers[k] === false) return 'safety layer off';
  }
  return null;
}

/**
 * The tier for this proposal: the entry's base tier (one screen or all),
 * raised, never lowered: by needsConfirm (voice never asks less than touch),
 * by the remote's Advance-during-incident ask, and by the entry's raiseWhen.
 * Protective proposals always act.
 */
export function tierFor(policy, args, message, state = {}) {
  const all = args?.screen === 'all';
  const base = all ? policy.tier.all : policy.tier.one;
  const prot =
    typeof policy.protective === 'function'
      ? policy.protective(args)
      : policy.protective;
  if (base === 'touch' || prot) return base === 'touch' ? 'touch' : 'act';
  if (base === 'ask') return 'ask';
  const cmd = message?.t === 'cmd' ? message.cmd : null;
  if (cmd && needsConfirm(cmd)) return 'ask';
  const ss = state.session || {};
  if (cmd?.type === 'screens') {
    const slots = targets(cmd, state);
    if (ss.report && cmd.patch?.mode === 'advance') return 'ask';
    if (
      policy.raiseWhen.includes('pinned') &&
      cmd.target !== 'all' &&
      slots.some((s) => state.screens?.[s]?.pinned)
    )
      return 'ask';
    if (
      policy.raiseWhen.includes('reportOpen') &&
      ss.report &&
      slots.some((s) => state.screens?.[s]?.role === 'incident')
    )
      return 'ask';
  }
  if (
    policy.raiseWhen.includes('reportOpen') &&
    ss.report &&
    cmd?.type === 'session'
  )
    return 'ask';
  return 'act';
}

/** Is this proposal protective (always act, no speaker check)? */
export const isProtective = (policy, args) =>
  typeof policy.protective === 'function'
    ? Boolean(policy.protective(args))
    : Boolean(policy.protective);
