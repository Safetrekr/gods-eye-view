// "Never less safe", mechanically (review/fitzroy-commands F5 D5, D7). Pure:
// the catalog's guard uses it now; the relay checks the same on voice
// commands later (V1, after K10).
import { SIM_KEYS, needsConfirm } from '../twinSession.js';
import { SAFETY_LAYERS } from '../twinScreenRoles.js';

/** Fields a command may never carry (the relay stamps the actor). */
export { ACTOR_FIELDS } from '../twinProtocol.js';

/** Layers a running demo keeps on at the wall (twinSessionHost.js). */
const DEMO_LAYERS = {
  simStorm: 'alertAreas',
  simFire: 'fireBounds',
  simCyclone: 'tropical',
};

const targets = (cmd, state) =>
  cmd.target === 'all'
    ? Object.keys(state?.screens || {}).map(Number)
    : [Number(cmd.target)];

/**
 * Is an incident open: the operator's report or the trip data's (the
 * remote's incidentOpen(): remote.js)? ctx.incidentOpen: the twin's word.
 */
export const incidentOpen = (state, ctx = {}) =>
  Boolean(state?.session?.report || ctx.incidentOpen);

/**
 * Why a command would make the wall less safe, or null (CF-D4). A value
 * that does not change is never "lowering": a trip switch writes nulls
 * that are already null.
 */
export function lowersProtection(message, state, ctx = {}) {
  if (message?.t !== 'cmd') return null;
  const cmd = message.cmd || {};
  const ss = state?.session || {};
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
    if (p.layers) {
      if (incidentOpen(state, ctx))
        for (const k of SAFETY_LAYERS)
          if (p.layers[k] === false) return 'safety layer off';
      for (const [sim, k] of Object.entries(DEMO_LAYERS))
        if (ss[sim] && p.layers[k] === false) return 'demo layer off';
    }
  }
  return null;
}

/**
 * The tier for this proposal and why it was raised: {tier, why}. The
 * entry's base tier (one screen or all), raised, never lowered: by
 * needsConfirm (voice never asks less than touch), by the remote's
 * Advance-during-incident ask, and by the entry's raiseWhen (a pinned
 * screen, an incident while the target is the incident board, merged in
 * on 1–2 screens). Protective proposals always act.
 */
export function tierFor(policy, args, message, state, ctx = {}) {
  const all = args?.screen === 'all';
  const base = all ? policy.tier.all : policy.tier.one;
  if (base === 'touch') return { tier: 'touch', why: null };
  if (isProtective(policy, args)) return { tier: 'act', why: null };
  if (base === 'ask') return { tier: 'ask', why: null };
  const cmd = message?.t === 'cmd' ? message.cmd : null;
  if (cmd && needsConfirm(cmd)) return { tier: 'ask', why: null };
  const incident = incidentOpen(state, ctx);
  if (cmd?.type === 'screens') {
    const slots = targets(cmd, state);
    if (incident && cmd.patch?.mode === 'advance')
      return {
        tier: 'ask',
        why: 'An incident is open: Advance hides traveller positions',
      };
    if (
      policy.raiseWhen.includes('pinned') &&
      cmd.target !== 'all' &&
      slots.some((s) => state?.screens?.[s]?.pinned)
    )
      return { tier: 'ask', why: `Screen ${slots[0]} is pinned` };
    if (
      policy.raiseWhen.includes('reportOpen') &&
      incident &&
      slots.some((s) => {
        const sc = state?.screens?.[s];
        return sc?.role === 'incident' || sc?.merged?.includes?.('incident');
      })
    )
      return { tier: 'ask', why: 'That screen shows the open incident' };
  }
  if (
    policy.raiseWhen.includes('reportOpen') &&
    incident &&
    cmd?.type === 'session'
  )
    return { tier: 'ask', why: 'An incident is open' };
  return { tier: 'act', why: null };
}

/** Is this proposal protective (always act, no speaker check)? */
export const isProtective = (policy, args) =>
  typeof policy.protective === 'function'
    ? Boolean(policy.protective(args))
    : Boolean(policy.protective);
