// The relay's voice policy (VOICE-CONTROL §3.2, §4, A2; review/voice
// 03-security C2, 04-supervision #1; PRE-V1 carry-over). Voice proposes and
// the source device submits: a Fitzroy proposal arrives as an ordinary
// `{t:'cmd'}` (or `{t:'undo'}`) on the device's own socket, with
// `voice: {intent}` beside it. The relay checks it against the table
// generated from the Fitzroy catalog (voicePolicy.table.js), and only then
// stamps `via: 'voice'`. Anything not on the table is refused, whatever a
// model says; incident actions, pairing, Visitor off, unpin, starting a
// demo and the screen count are touch only (Tier C). Never less safe
// (CF-D4): a command that lowers protection is refused even when its
// intent emits that field. Voice never asks less than touch: the tier is
// raised by needsConfirm, a pinned screen, an open report, never lowered.
//
// verdict → {ok: true, intent, tier: 'act'|'ask', why} or {ok: false,
// intent, reason (twinProtocol.js VOICE_REFUSALS), field?, tier?, say}.
// Pure. The envelope's other fields (a transcript, a proposal id) are never
// read, so they can never reach a log line.
import {
  lowersProtection,
  tierFor,
} from '../../src/operations/tripTwin/fitzroy/fitzroyPolicy.js';
import { VOICE_POLICY } from './voicePolicy.table.js';

const SAY = Object.freeze({
  touch_only: 'Touch only: do that on the remote.',
  unknown_intent: "I didn't catch a command. Nothing changed.",
  not_a_command: 'Nothing changed.',
  undeclared: 'Nothing changed.',
  lowers_protection: 'Touch only: do that on the remote.',
  undo_protective:
    'Touch only: undo that on the remote, in Screens and devices.',
  log_down: 'Voice is off while the log is not writing. Use the remote.',
  not_controller: 'This device is not in control. Nothing changed.',
});

const refuse = (reason, intent, extra = {}) => ({
  ...extra,
  ok: false,
  intent,
  reason,
  say: extra.say || SAY[reason] || 'Nothing changed.',
});

/** The table row for an intent, or null (own keys only). */
export const voiceEntry = (intent) =>
  typeof intent === 'string' && Object.hasOwn(VOICE_POLICY, intent)
    ? VOICE_POLICY[intent]
    : null;

/**
 * Check one voice proposal. `voice`: the envelope ({intent}); `msg`:
 * {t:'cmd', cmd} or {t:'undo'}; `state`: the session now; `controller`:
 * does this device hold the lease; `logOk`: is the audit log writing.
 */
export function voiceVerdict({ voice, msg, state, controller, logOk }) {
  const intent = typeof voice?.intent === 'string' ? voice.intent : null;
  if (!logOk) return refuse('log_down', intent);
  if (!controller) return refuse('not_controller', intent);
  const entry = voiceEntry(intent);
  if (!entry) return refuse('unknown_intent', intent);
  if (entry.tier.one === 'touch')
    return refuse('touch_only', intent, { tier: 'touch', say: entry.say });
  if (entry.effect !== 'relay') return refuse('not_a_command', intent);
  if (msg?.t === 'undo')
    return entry.emits?.t === 'undo'
      ? { ok: true, intent, tier: 'act', why: null }
      : refuse('undeclared', intent);
  const cmd = msg?.t === 'cmd' ? msg.cmd : null;
  if (!cmd || typeof cmd !== 'object' || entry.emits?.t === 'undo')
    return refuse('undeclared', intent);
  if (cmd.type !== entry.emits?.type)
    return refuse('undeclared', intent, { field: null });
  const fields = Object.keys(
    cmd.patch && typeof cmd.patch === 'object' ? cmd.patch : {},
  );
  const extra = entry.emits.fields
    ? fields.find((f) => !entry.emits.fields.includes(f))
    : null;
  if (extra) return refuse('undeclared', intent, { field: extra });
  const ctx = { incidentOpen: Boolean(state?.session?.report) };
  if (lowersProtection({ t: 'cmd', cmd }, state, ctx))
    return refuse('lowers_protection', intent, { tier: 'touch' });
  const args = {
    screen: cmd.target === 'all' ? 'all' : String(cmd.target ?? ''),
  };
  const { tier, why } = tierFor(entry, args, { t: 'cmd', cmd }, state, ctx);
  if (tier === 'touch')
    return refuse('touch_only', intent, { tier, say: entry.say });
  return { ok: true, intent, tier, why };
}
